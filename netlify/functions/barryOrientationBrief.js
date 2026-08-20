/**
 * barryOrientationBrief.js — Barry Mission Control orientation message.
 *
 * Reads actual platform state and returns a 2-3 sentence orientation
 * message that reflects where the user's RECON, missions, and leads stand.
 * Replaces the generic `__OPENING_BRIEF__` path in barryMissionChat.
 *
 * Cached 10 minutes client-side so it does not fire on every navigation.
 */

import Anthropic from '@anthropic-ai/sdk';
import { db } from './firebase-admin.js';
import { logApiUsage } from './utils/logApiUsage.js';
import { computeReconState } from './utils/reconCapability.js';
import { resolveActiveIcp, isResolved } from './utils/resolveActiveIcp.js';
import { LEGACY_HAIKU_4_5 } from './utils/models.js';

async function verifyAuthToken(authToken, userId) {
  const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
  if (!firebaseApiKey) throw new Error('Firebase API key not configured (set FIREBASE_API_KEY)');
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: authToken }),
    }
  );
  if (!res.ok) throw new Error('Invalid authentication token');
  const data = await res.json();
  if (!data.users || data.users[0].localId !== userId) throw new Error('Token/userId mismatch');
}

function daysSince(dateVal) {
  if (!dateVal) return null;
  const date = dateVal?.toDate ? dateVal.toDate() : new Date(dateVal);
  if (isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function extractJson(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const startTime = Date.now();
  let userId;

  try {
    const body = JSON.parse(event.body);
    userId = body.userId;
    const authToken = body.authToken;
    const context = body.context;

    if (!userId || !authToken) throw new Error('Missing required parameters: userId, authToken');

    // ── Normalize client-supplied KPI context at the boundary ──────────────────
    // These are contextual display values for an orientation message, not
    // authoritative analytics. Never insert raw client values into the prompt.
    // Callers that omit `context` resolve every field to null → 'unknown'.
    const normalizeCount = (value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) return null;
      return Math.floor(parsed);
    };

    const dashboardContext = {
      totalMatches: normalizeCount(context?.totalMatches),
      highFit: normalizeCount(context?.highFit),
      totalReplies: normalizeCount(context?.totalReplies),
    };

    // Sanitize the client-supplied top-priority action at the boundary too:
    // coerce to trimmed, length-capped strings so raw client text never flows
    // unbounded into the prompt. Absent/blank fields resolve to null.
    const normalizeText = (value, maxLen) => {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      if (!trimmed) return null;
      return trimmed.slice(0, maxLen);
    };

    const tp = context?.topPriority;
    const topPriority = tp
      ? {
          title: normalizeText(tp.title, 200),
          reason: normalizeText(tp.reason, 200),
          urgency: normalizeText(tp.urgency, 20),
        }
      : null;
    const hasTopPriority = !!(topPriority && topPriority.title);
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

    await verifyAuthToken(authToken, userId);

    const userRef = db.collection('users').doc(userId);

    const [dashboardDoc, missionsSnap, companiesSnap, pendingRepliesSnap] = await Promise.all([
      db.collection('dashboards').doc(userId).get(),
      userRef.collection('missions')
        .where('status', '==', 'active')
        .orderBy('updatedAt', 'desc')
        .limit(5)
        .get(),
      userRef.collection('companies')
        .where('status', '==', 'accepted')
        .orderBy('swipedAt', 'desc')
        .limit(20)
        .get(),
      // Sprint 3: contacts where Barry has read a reply and drafted an answer.
      // A failed read must not take the whole brief down — an empty result just
      // means the replies line is omitted.
      userRef.collection('contacts')
        .where('conversationState', '==', 'user_action_required')
        .limit(10)
        .get()
        .catch((err) => {
          console.warn('[barryOrientationBrief] pending replies query failed:', err.message);
          return { docs: [] };
        }),
    ]);

    const dashboardData = dashboardDoc.exists ? dashboardDoc.data() : null;
    const { score: reconScore, missingNames } = computeReconState(dashboardData);

    // User scope. `communicationStyle` was already on the dashboard document
    // this function fetches; it simply was not read, so the brief was written in
    // Barry's default voice regardless of the style the user chose.
    const userStyle = dashboardData?.communicationStyle || null;

    // ICP scope, "if ICP exists" (Appendix B, v0.4-amend). The brief talks about
    // companies "matching ICP" and high-fit counts, so which ICP it is talking
    // about is part of the decision. A zero-ICP Workspace is valid: the line is
    // omitted rather than the surface being treated as incomplete.
    const icpResolution = await resolveActiveIcp(db, userId);
    const icpLine = isResolved(icpResolution)
      ? `Active ICP: ${icpResolution.profile?.name || icpResolution.icpId}` +
        (icpResolution.profile?.industries?.length
          ? ` — targeting ${icpResolution.profile.industries.slice(0, 3).join(', ')}`
          : '')
      : icpResolution.reason === 'none-active'
        ? 'Active ICP: none selected — the user has target profiles but has not chosen one'
        : icpResolution.reason === 'read-failed'
          ? 'Active ICP: could not be determined'
          : 'Active ICP: none yet — this user has not defined a target profile';

    const missions = missionsSnap.docs.map(d => {
      const m = d.data();
      return {
        contact: m.contactName || null,
        goal: m.outcome_goal || 'engagement',
        lastTouchDays: daysSince(m.updatedAt),
      };
    });

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentLeads = companiesSnap.docs.filter(d => {
      const swipedAt = d.data().swipedAt;
      const t = swipedAt?.toDate ? swipedAt.toDate() : new Date(swipedAt);
      return !isNaN(t.getTime()) && t.getTime() > sevenDaysAgo;
    }).length;

    const staleMissions = missions.filter(m => m.lastTouchDays !== null && m.lastTouchDays > 14);
    const staleMissionNames = staleMissions
      .filter(m => m.contact)
      .map(m => m.contact)
      .slice(0, 2)
      .join(' and ');

    const reconLine = reconScore >= 80
      ? `RECON is strong at ${reconScore}%`
      : reconScore >= 40
      ? `RECON is at ${reconScore}% — ${missingNames.slice(0, 2).join(' and ')} ${missingNames.length <= 2 ? 'are' : 'and others are'} the gap${missingNames.length > 1 ? 's' : ''}`
      : `RECON is at ${reconScore}% — key training sections are missing and limiting Barry's context quality`;

    const missionsLine = missions.length === 0
      ? 'No active missions'
      : `${missions.length} active mission${missions.length !== 1 ? 's' : ''}${staleMissions.length > 0 ? `, ${staleMissions.length} stale over 14 days${staleMissionNames ? ` (${staleMissionNames})` : ''}` : ''}`;

    const leadsLine = recentLeads > 0
      ? `${recentLeads} new Daily Leads match${recentLeads !== 1 ? 'es' : ''} in the last 7 days`
      : 'No recent Daily Leads matches';

    // ── Sprint 3: replies waiting on the user ──────────────────────────────
    const pendingReplies = pendingRepliesSnap.docs.map(d => {
      const c = d.data();
      return {
        name: c.name || c.first_name || 'Unknown',
        company: c.company_name || c.current_company_name || '',
        lastInboundSubject: c.lastInboundSubject || '',
      };
    });

    const repliesLine = pendingReplies.length > 0
      ? `Replies needing your attention: ${pendingReplies.length}\n` +
        pendingReplies.slice(0, 3).map(r =>
          `  • ${r.name}${r.company ? ' at ' + r.company : ''}${r.lastInboundSubject ? `: "${r.lastInboundSubject}"` : ''}`
        ).join('\n')
      : 'No replies waiting on you';

    const orientationPrompt = `You are Barry, Idynify's AI sales intelligence assistant. Generate a 2-3 sentence orientation message for a user opening Mission Control.

CURRENT PLATFORM STATE:
- Highest priority action: ${hasTopPriority ? topPriority.title : 'none'}${hasTopPriority && topPriority.reason ? ` (${topPriority.reason})` : ''}
- Total companies matching ICP: ${dashboardContext.totalMatches ?? 'unknown'}
- High confidence matches (75%+ fit): ${dashboardContext.highFit ?? 'unknown'}
- Total replies received: ${dashboardContext.totalReplies ?? 'unknown'}
- ${icpLine}
- ${reconLine}
- ${missionsLine}
- ${leadsLine}
- ${repliesLine}

RULES:
- Be specific to the numbers. Name stale contacts if available.
- Open with the strongest AVAILABLE signal, in this priority order:
  1. Highest priority action — if "Highest priority action" is not "none", open with it. Reference it by name and work its reason into the first sentence. It outranks every other signal below.
  2. Replies needing attention — else if that count is above 0, a real person is waiting on an answer Barry has already drafted. Name them. This outranks every pipeline metric below.
  3. Replies — else if "Total replies received" > 0, someone responded and deserves attention now.
  4. High-fit matches — else if "High confidence matches" > 0, strong opportunities are ready to review.
  5. Total matches — else if "Total companies matching ICP" > 0, the pipeline is building.
  6. Otherwise, lead with the existing RECON, mission, and lead context.
  7. Generic welcome only when no meaningful signal exists at all.
- Do not describe any dashboard total as "new", "today", "this week", or "overnight". These are all-time account totals unless a time-bounded value is explicitly provided.
- If RECON is below 80%, mention the gap and its effect in one short clause.
- No "Welcome back!" or generic greetings. Lead with the most actionable signal.
- Confident and direct. Field commander reading the board.
- End with a clear nudge toward the highest-priority next move.
- 2-3 sentences maximum. No bullet points.
${userStyle ? `- Write in the user's chosen communication style: ${String(userStyle).replace(/_/g, ' ')}.` : ''}
- When no active ICP exists, do not treat that as a fault or an error. Most of
  Idynify works without one; mention it only if discovery is the strongest
  available signal, and then as a next step rather than a problem.

Return valid JSON only:
{
  "response_text": "The orientation message here.",
  "suggested_prompts": ["Short action prompt 1", "Short action prompt 2", "Short action prompt 3"]
}`;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let brief = '';
    let suggestedPrompts = [];
    // Hoisted so the telemetry call below can report tokens: the response is
    // scoped to the try block, and the AI call is allowed to fail without
    // failing the brief.
    let aiUsage = null;

    try {
      const response = await anthropic.messages.create(
        {
          model: LEGACY_HAIKU_4_5,
          max_tokens: 300,
          messages: [{ role: 'user', content: orientationPrompt }],
        },
        { signal: controller.signal }
      );
      aiUsage = response.usage || null;
      const parsed = extractJson(response.content[0].text);
      if (parsed?.response_text) {
        brief = parsed.response_text;
        suggestedPrompts = parsed.suggested_prompts || [];
      }
    } catch (aiErr) {
      if (controller.signal.aborted) console.warn('[barryOrientationBrief] AI call timed out');
      else console.warn('[barryOrientationBrief] AI call failed:', aiErr.message);
    } finally {
      clearTimeout(timeout);
    }

    // A reply someone is waiting on beats any pipeline metric — make sure the
    // prompt is offered it even when the AI call fails and the fallback runs.
    if (!brief && pendingReplies.length > 0) {
      const first = pendingReplies[0];
      brief =
        `${pendingReplies.length} repl${pendingReplies.length === 1 ? 'y is' : 'ies are'} waiting on you` +
        `${first.name !== 'Unknown' ? ` — ${first.name}${first.company ? ` at ${first.company}` : ''} replied` : ''}` +
        ` and Barry has a draft ready. Start there.`;
      suggestedPrompts = ['Review pending replies', 'Who should I focus on today?', 'What needs attention?'];
    }

    if (!brief) {
      brief = missions.length > 0
        ? `${missions.length} active mission${missions.length !== 1 ? 's' : ''} in flight${staleMissions.length > 0 ? ` — ${staleMissions.length} need${staleMissions.length === 1 ? 's' : ''} a touchpoint` : ''}.${reconScore < 60 ? ` RECON at ${reconScore}% is limiting Barry's context — completing key sections will improve everything.` : ''} Tell me where you want to focus.`
        : `No active missions yet — ${recentLeads > 0 ? `${recentLeads} recent Daily Leads match${recentLeads !== 1 ? 'es' : ''} waiting for your review.` : 'Daily Leads has companies waiting for your review.'} Start here to build your pipeline.`;
      suggestedPrompts = ['Who should I focus on today?', 'Show me my pipeline status', 'What needs attention?'];
    }

    // Sprint 3: let Barry walk the user through the replies from the chat panel.
    if (pendingReplies.length > 0 && !suggestedPrompts.includes('Review pending replies')) {
      suggestedPrompts = ['Review pending replies', ...suggestedPrompts].slice(0, 3);
    }

    const mode = missions.length === 0 ? 'GROWTH' : staleMissions.length > 0 ? 'PRIORITIZE' : 'SUGGEST';

    await logApiUsage(userId, 'barryOrientationBrief', 'success', {
      provider: 'anthropic',
      model: LEGACY_HAIKU_4_5,
      usage: aiUsage,
      responseTime: Date.now() - startTime,
      metadata: {
        reconScore,
        missionCount: missions.length,
        recentLeads,
        pendingReplies: pendingReplies.length,
      },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        brief,
        response_text: brief,
        suggestedPrompts,
        mode,
        pendingRepliesCount: pendingReplies.length,
        pendingRepliesPreview: pendingReplies.slice(0, 3),
      }),
    };

  } catch (error) {
    console.error('[barryOrientationBrief] Error:', error.message);
    try {
      if (userId) {
        await logApiUsage(userId, 'barryOrientationBrief', 'error', {
          provider: 'anthropic',
          model: LEGACY_HAIKU_4_5,
          responseTime: Date.now() - startTime,
          errorCode: error.message,
          metadata: {},
        });
      }
    } catch (_) {}
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
