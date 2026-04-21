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

async function verifyAuthToken(authToken, userId) {
  const firebaseApiKey = process.env.FIREBASE_API_KEY;
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

    if (!userId || !authToken) throw new Error('Missing required parameters: userId, authToken');
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

    await verifyAuthToken(authToken, userId);

    const userRef = db.collection('users').doc(userId);

    const [dashboardDoc, missionsSnap, companiesSnap] = await Promise.all([
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
    ]);

    const dashboardData = dashboardDoc.exists ? dashboardDoc.data() : null;
    const { score: reconScore, missingNames } = computeReconState(dashboardData);

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

    const orientationPrompt = `You are Barry, Idynify's AI sales intelligence assistant. Generate a 2-3 sentence orientation message for a user opening Mission Control.

CURRENT PLATFORM STATE:
- ${reconLine}
- ${missionsLine}
- ${leadsLine}

RULES:
- Be specific to the numbers. Name stale contacts if available.
- If RECON is below 80%, mention the gap and its effect in one short clause.
- No "Welcome back!" or generic greetings. Lead with the most actionable signal.
- Confident and direct. Field commander reading the board.
- End with a clear nudge toward the highest-priority next move.
- 2-3 sentences maximum. No bullet points.

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

    try {
      const response = await anthropic.messages.create(
        {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          messages: [{ role: 'user', content: orientationPrompt }],
        },
        { signal: controller.signal }
      );
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

    if (!brief) {
      brief = missions.length > 0
        ? `${missions.length} active mission${missions.length !== 1 ? 's' : ''} in flight${staleMissions.length > 0 ? ` — ${staleMissions.length} need${staleMissions.length === 1 ? 's' : ''} a touchpoint` : ''}.${reconScore < 60 ? ` RECON at ${reconScore}% is limiting Barry's context — completing key sections will improve everything.` : ''} Tell me where you want to focus.`
        : `No active missions yet — ${recentLeads > 0 ? `${recentLeads} recent Daily Leads match${recentLeads !== 1 ? 'es' : ''} waiting for your review.` : 'Daily Leads has companies waiting for your review.'} Start here to build your pipeline.`;
      suggestedPrompts = ['Who should I focus on today?', 'Show me my pipeline status', 'What needs attention?'];
    }

    const mode = missions.length === 0 ? 'GROWTH' : staleMissions.length > 0 ? 'PRIORITIZE' : 'SUGGEST';

    await logApiUsage(userId, 'barryOrientationBrief', 'success', {
      responseTime: Date.now() - startTime,
      metadata: { reconScore, missionCount: missions.length, recentLeads },
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
      }),
    };

  } catch (error) {
    console.error('[barryOrientationBrief] Error:', error.message);
    try {
      if (userId) {
        await logApiUsage(userId, 'barryOrientationBrief', 'error', {
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
