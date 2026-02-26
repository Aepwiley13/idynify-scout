import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './utils/logApiUsage.js';
import { db } from './firebase-admin.js';
import { compileReconForPrompt } from './utils/reconCompiler.js';
import { getStaleContacts } from './utils/contactUtils.js';

// ── Helpers ──────────────────────────────────────────────

function daysSince(dateVal) {
  if (!dateVal) return Infinity;
  const date = dateVal?.toDate ? dateVal.toDate() : new Date(dateVal);
  if (isNaN(date.getTime())) return Infinity;
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

// ── Mode Determination ───────────────────────────────────

function determineBarryMode(recommendations, stats) {
  // PRIORITIZE only when genuinely time-sensitive:
  // - Critical contacts not touched in 7+ days (priorityWeight === 0)
  // - Missions approaching deadline (priorityWeight <= 1 AND type === 'momentum_compress')
  // - High-value contacts stalled in awaiting_reply 14+ days (priorityWeight <= 1)
  const genuinelyUrgent = recommendations.filter(r =>
    r.priorityWeight === 0 ||
    (r.priorityWeight <= 1 && r.type === 'momentum_compress') ||
    (r.priorityWeight <= 1 && r.type === 'stalled_awaiting_reply')
  );

  if (genuinelyUrgent.length > 0) return 'PRIORITIZE';
  if (stats.activeMissions === 0 || stats.scoutContacts < 5) return 'GROWTH';
  return 'SUGGEST';
}

// ── Server-side Recommendation Loader ───────────────────

/**
 * Derives a lightweight set of recommendations server-side using the
 * Firebase Admin SDK. Captures enough signal for mode determination and
 * opening brief generation. Mirrors the logic in the client-side
 * recommendationEngine.js but uses admin Firestore queries.
 */
async function loadServerSideRecommendations(userId) {
  const recommendations = [];
  const TIMEFRAME_DAYS = { this_week: 7, this_month: 30, this_quarter: 90 };

  try {
    const userRef = db.collection('users').doc(userId);

    // 1. High/critical contacts not yet in structured engagement
    const highValueSnap = await userRef
      .collection('contacts')
      .where('strategic_value', 'in', ['high', 'critical'])
      .where('contact_status', 'in', ['New', 'Engaged', 'Dormant'])
      .limit(20)
      .get();

    highValueSnap.forEach(docSnap => {
      const contact = docSnap.data();
      const isCritical = contact.strategic_value === 'critical';

      if (contact.contact_status === 'New') {
        const days = daysSince(contact.addedAt || contact.contact_status_updated_at);
        if (days >= 7) {
          recommendations.push({
            type: 'high_value_no_mission',
            priorityWeight: isCritical ? 0 : 2,
            contactName: contact.name || 'Unknown contact',
            contactId: docSnap.id
          });
        }
      } else if (contact.contact_status === 'Engaged') {
        const days = daysSince(contact.contact_status_updated_at);
        if (days >= 7) {
          recommendations.push({
            type: 'high_value_no_engagement',
            priorityWeight: isCritical ? 0 : 2,
            contactName: contact.name || 'Unknown contact',
            contactId: docSnap.id
          });
        }
      } else if (contact.contact_status === 'Dormant') {
        const days = daysSince(contact.contact_status_updated_at);
        if (days >= 30) {
          recommendations.push({
            type: 'high_value_dormant',
            priorityWeight: isCritical ? 0 : 2,
            contactName: contact.name || 'Unknown contact',
            contactId: docSnap.id
          });
        }
      }
    });

    // 2. Contacts awaiting reply beyond 14 days — critical ones trigger PRIORITIZE
    const staleContacts = await getStaleContacts(userRef, 14);
    staleContacts.forEach(contact => {
      const isCritical = contact.strategic_value === 'critical';
      recommendations.push({
        type: 'stalled_awaiting_reply',
        // critical contacts awaiting reply = priorityWeight 0 (PRIORITIZE)
        // high value = 1 (also PRIORITIZE)
        // others = 3 (general gap, won't trigger PRIORITIZE)
        priorityWeight: isCritical ? 0 : contact.strategic_value === 'high' ? 1 : 3,
        contactName: contact.name || 'Unknown contact',
        contactId: contact.id,
        daysSinceContact: contact.daysSince
      });
    });

    // 3. Missions with approaching deadlines (within 5 days)
    const missionsSnap = await userRef
      .collection('missions')
      .where('status', '==', 'autopilot')
      .limit(20)
      .get();

    missionsSnap.forEach(docSnap => {
      const mission = docSnap.data();
      const timeframeDays = TIMEFRAME_DAYS[mission.timeframe];
      if (!timeframeDays) return;

      const createdVal = mission.createdAt || mission.startedAt;
      const created = createdVal?.toDate ? createdVal.toDate() : new Date(createdVal);
      if (isNaN(created.getTime())) return;

      const deadline = new Date(created.getTime() + timeframeDays * 24 * 60 * 60 * 1000);
      const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

      if (daysLeft <= 5 && daysLeft > 0) {
        recommendations.push({
          type: 'momentum_compress',
          priorityWeight: 1, // approaching deadline = PRIORITIZE threshold
          missionName: mission.name || 'Unnamed Mission',
          missionId: docSnap.id,
          daysLeft
        });
      }
    });

  } catch (error) {
    console.warn('⚠️ Could not load recommendations (non-fatal):', error.message);
  }

  // Sort by priority weight (lower = more urgent)
  recommendations.sort((a, b) => a.priorityWeight - b.priorityWeight);
  return recommendations.slice(0, 5);
}

// ── Stats Loader ─────────────────────────────────────────

async function loadStats(userId) {
  try {
    const userRef = db.collection('users').doc(userId);

    const [companiesSnap, contactsSnap, missionsSnap, dashboardDoc] = await Promise.all([
      userRef.collection('companies').where('status', '==', 'accepted').limit(500).get(),
      userRef.collection('contacts').limit(500).get(),
      userRef.collection('missions').where('status', '==', 'autopilot').get(),
      db.collection('dashboards').doc(userId).get()
    ]);

    const dashboardData = dashboardDoc.exists ? dashboardDoc.data() : null;
    const reconModule = dashboardData?.modules?.find(m => m.id === 'recon');
    const reconCompletion = reconModule?.progressPercentage || 0;

    return {
      scoutCompanies: companiesSnap.size,
      scoutContacts: contactsSnap.size,
      activeMissions: missionsSnap.size,
      reconCompletion,
      dashboardData
    };
  } catch (error) {
    console.warn('⚠️ Could not load stats (non-fatal):', error.message);
    return {
      scoutCompanies: 0,
      scoutContacts: 0,
      activeMissions: 0,
      reconCompletion: 0,
      dashboardData: null
    };
  }
}

// ── Prompt Builders ──────────────────────────────────────

function buildSystemPrompt(mode, reconContext) {
  return `You are Barry, Idynify's AI sales intelligence assistant inside Mission Control. You are not a chatbot. You are the best analyst, strategist, and writing partner the user has ever had — and you know everything about their contacts, ICP, past messages, and pipeline.

CURRENT MODE: ${mode}
- PRIORITIZE: Time-sensitive items require action now. Name names, be specific, give the single most important next move.
- SUGGEST: Pipeline is healthy. Recommend next moves ranked by relational leverage.
- GROWTH: Pipeline is sparse. Focus on what's missing and how to build it.

PERSONALITY & VOICE:
- Calm confidence. Zero fluff. Maximum usefulness.
- Talk like a smart colleague who already did the research — not a robot reading a script.
- Ask ONE question at a time when you need to clarify. Never multiple questions at once.
- Say what you're about to do before doing it (the Confirm step).
- Use the contact's and company's real names in every response — nothing generic.
- Never hedge. Never say "I recommend" or "you should." State. Confident.
- Be brief in the confirm step — one to three sentences max.
- Never narrate internal thinking. Never say "Sure! I'd be happy to help!"

RELATIONSHIP INTELLIGENCE:
Contacts have a relationship_state from this arc:
  unaware → aware → engaged → warm → trusted → advocate
  (also: dormant, strained, strategic_partner)

When reasoning about contacts, always consider:
1. What is their current relationship_state?
2. What is the outcome_goal for this engagement?
3. What is the smallest next action with the highest relational leverage?
4. What risk flags exist? (strained relationship, long gap, no RECON data)
5. What leverage opportunities exist? (recent news, mutual connection, past positive interaction)

OUTCOME GOALS you can reference (organized by relationship arc stage):
- Awareness: establish_awareness, enter_conversation, clarify_intent, validate_alignment
- Engagement: build_rapport, demonstrate_value, deepen_conversation, gather_context
- Strategic: schedule_meeting, define_next_step, position_as_advisor, secure_commitment
- Maintenance: reconnect, stay_top_of_mind, celebrate_milestone, add_value_no_ask
- Expansion: get_introduction, ask_for_referral, create_case_study, strategic_alignment
- Validation: gather_feedback, pressure_test_idea, decision_criteria_discovery
- Transactional: close_deal, sign_agreement, confirm_satisfaction

THE THREE-STEP LOOP (follow this for every meaningful task):
1. INTAKE — Understand what the user wants. If intent is ambiguous, ask ONE clarifying question.
2. CONFIRM — Briefly restate what you understand and what you're about to do, including key context you're working from. One to three sentences. Give the user a chance to correct you.
3. EXECUTE — Deliver the output with clear options.

INTENT DETECTION — identify the user's primary intent:
- FOLLOW_UP: "follow up with [contact]", "haven't heard back", "check in on"
- NEW_OUTREACH: "reach out to", "start a sequence for", "draft intro email to"
- MESSAGE_REVIEW: "look at what I sent", "what have we said to", "recap on"
- SCHEDULE: "set up a call with", "book time with", "send calendar invite"
- RESEARCH: "find out more about", "who's the decision maker at", "what do we know about"
- PIPELINE_CHECK: "where are we with", "what's the status of", "how many contacts in"

WHEN DRAFTING OUTREACH — generate 4 options with different angles:
- Option A — Value Add: leads with a new insight or relevant content
- Option B — Direct Ask: short, confident, clear CTA
- Option C — Soft Check-In: lower pressure, acknowledges they're busy
- Option D — Pattern Interrupt: something unexpected that cuts through

Every drafted message must:
- Include at least one specific detail from RECON, the contact profile, or conversation history
- Have a subject line (under 8 words, no clickbait)
- Be under 120 words unless user asks for longer
- End with ONE clear next step — never two asks

STRUCTURED OUTPUT (use when triggered):
- When asked to schedule: [FOLLOW-UP]: { "contactName": "...", "contactId": "...", "dueDate": "...", "reason": "..." }
- When asked to move a contact: [PIPELINE-MOVE]: { "contactId": "...", "contactName": "...", "newStage": "..." }

If data is missing, say: "I don't have enough on [X] yet — if you drop any context here I'll sharpen this up." Never say "I don't have access."
${reconContext ? '\n' + reconContext : ''}`;
}

function buildOpeningBriefPrompt(mode, stats, recommendations) {
  const topRecs = recommendations.slice(0, 3);
  const recContext = topRecs.length > 0
    ? `\nActive pipeline signals:\n${topRecs.map(r => {
        if (r.contactName) return `- Contact "${r.contactName}": ${r.type.replace(/_/g, ' ')}${r.daysSinceContact ? ` (${r.daysSinceContact} days)` : ''}`;
        if (r.missionName) return `- Mission "${r.missionName}": ${r.type.replace(/_/g, ' ')}${r.daysLeft ? ` (${r.daysLeft} days left)` : ''}`;
        return `- ${r.type.replace(/_/g, ' ')}`;
      }).join('\n')}`
    : '\nNo urgent signals — pipeline appears healthy or empty.';

  const modeInstructions = {
    PRIORITIZE: 'Opening brief format: "[Contact/mission] needs your attention now — [specific urgency]. [Single most important action]. [Consequence of not acting]."',
    SUGGEST: 'Opening brief format: "Your pipeline is active — here\'s how to grow it. [Specific opportunity based on data]. [Suggested action]."',
    GROWTH: 'Opening brief format: "Welcome — let\'s build your pipeline. [What they should do first based on what exists]. [Encouraging next step]."'
  };

  const modePrompts = {
    PRIORITIZE: ['What needs attention right now?', 'Which contacts are going cold?', 'Show me my most urgent mission.'],
    SUGGEST: ['Who should I reach out to today?', 'Which contacts match my ICP?', 'How do I grow my pipeline this week?'],
    GROWTH: ['How do I find my first leads?', 'What is Scout?', 'Help me set up my first mission.']
  };

  return `Generate an opening brief for a user landing on Mission Control. Mode: ${mode}.

Pipeline stats:
- Scout contacts: ${stats.scoutContacts}
- Active missions: ${stats.activeMissions}
- Companies tracked: ${stats.scoutCompanies}
- RECON completion: ${stats.reconCompletion}%
${recContext}

${modeInstructions[mode]}

The brief should be 2-3 sentences, specific about actual numbers or names from the data above.
Barry's voice: confident, tactical, no fluff. No "Welcome back!" or "Great to see you!" openings.
If the pipeline is empty, orient the user on what to do first — not generic encouragement.

Return ONLY valid JSON in this exact format (no extra text):
{
  "brief": "2-3 sentences. Be specific about actual numbers or names from the data above.",
  "suggestedPrompts": []
}`;
}

function getModeDefaultBrief(mode, stats, recommendations) {
  if (mode === 'PRIORITIZE') {
    const urgentItem = recommendations[0];
    const name = urgentItem?.contactName || urgentItem?.missionName || 'a contact';
    return `${name} needs your attention now — don't let this slip. Take action on your most urgent item to keep momentum going. Act today to protect this opportunity.`;
  }
  if (mode === 'SUGGEST') {
    return `Your pipeline is active — here's how to grow it. You have ${stats.scoutContacts} contacts and ${stats.activeMissions} active mission${stats.activeMissions !== 1 ? 's' : ''}. Find your next high-value contact and start a mission today.`;
  }
  return `Welcome — let's build your pipeline. Start by exploring Scout to find companies that match your ideal customers. Your first lead is one search away.`;
}

function getModeDefaultPrompts(mode) {
  const defaults = {
    PRIORITIZE: ['What needs attention right now?', 'Which contacts are going cold?', 'Show me my most urgent mission.'],
    SUGGEST: ['Who should I reach out to today?', 'Which contacts match my ICP?', 'How do I grow my pipeline this week?'],
    GROWTH: ['How do I find my first leads?', 'What is Scout?', 'Help me set up my first mission.']
  };
  return defaults[mode] || defaults.SUGGEST;
}

// ── Handler ──────────────────────────────────────────────

export const handler = async (event) => {
  const startTime = Date.now();

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { userId, authToken, message, conversationHistory, mode } = body;

    if (!userId || !authToken) {
      throw new Error('Missing required parameters');
    }

    console.log('🐻 barryMissionChat called', { hasMessage: !!message, userId });

    // Validate environment variables
    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeApiKey) throw new Error('Claude API key not configured');

    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) throw new Error('Firebase API key not configured');

    // ── Verify Firebase Auth token ──
    const verifyResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: authToken })
      }
    );

    if (!verifyResponse.ok) {
      throw new Error('Invalid authentication token');
    }

    const verifyData = await verifyResponse.json();
    const tokenUserId = verifyData.users[0].localId;

    if (tokenUserId !== userId) {
      throw new Error('Token does not match user ID');
    }

    console.log('✅ Auth verified for barryMissionChat');

    // ── Load RECON context ──
    let reconContext = '';
    try {
      const dashboardDoc = await db.collection('dashboards').doc(userId).get();
      if (dashboardDoc.exists) {
        reconContext = compileReconForPrompt(dashboardDoc.data());
        if (reconContext) console.log('🧠 RECON loaded for mission chat');
      }
    } catch (reconError) {
      console.warn('⚠️ Could not load RECON (non-fatal):', reconError.message);
    }

    const anthropic = new Anthropic({ apiKey: claudeApiKey });
    const isOpeningBrief = !message;

    if (isOpeningBrief) {
      // ── Type A: Opening Brief ──
      console.log('📋 Generating opening brief...');

      const [recommendations, stats] = await Promise.all([
        loadServerSideRecommendations(userId),
        loadStats(userId)
      ]);

      const currentMode = determineBarryMode(recommendations, stats);
      console.log('🎯 Mode determined:', currentMode);

      const systemPrompt = buildSystemPrompt(currentMode, reconContext);
      const userPrompt = buildOpeningBriefPrompt(currentMode, stats, recommendations);

      const briefController = new AbortController();
      const briefTimeout = setTimeout(() => briefController.abort(), 10000);
      let claudeResponse;
      try {
        claudeResponse = await anthropic.messages.create(
          {
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 600,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }]
          },
          { signal: briefController.signal }
        );
      } catch (claudeErr) {
        if (briefController.signal.aborted) {
          console.warn('⚠️ Barry opening brief timed out after 10s — using fallback');
          const fallbackParsed = {
            brief: getModeDefaultBrief(currentMode, stats, recommendations),
            suggestedPrompts: getModeDefaultPrompts(currentMode)
          };
          const responseTime = Date.now() - startTime;
          await logApiUsage(userId, 'barryMissionChat', 'timeout', {
            responseTime,
            metadata: { mode: currentMode, type: 'opening_brief_timeout' }
          });
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
              success: true,
              mode: currentMode,
              brief: fallbackParsed.brief,
              suggestedPrompts: fallbackParsed.suggestedPrompts,
              recommendations
            })
          };
        }
        throw claudeErr;
      } finally {
        clearTimeout(briefTimeout);
      }

      const responseText = claudeResponse.content[0].text;
      let parsed;

      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found');
        parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.brief || !Array.isArray(parsed.suggestedPrompts)) throw new Error('Invalid structure');
      } catch (parseError) {
        console.warn('⚠️ Could not parse opening brief JSON, using fallback');
        parsed = {
          brief: getModeDefaultBrief(currentMode, stats, recommendations),
          suggestedPrompts: getModeDefaultPrompts(currentMode)
        };
      }

      const responseTime = Date.now() - startTime;
      await logApiUsage(userId, 'barryMissionChat', 'success', {
        responseTime,
        metadata: { mode: currentMode, type: 'opening_brief', reconEnhanced: !!reconContext }
      });

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: true,
          mode: currentMode,
          brief: parsed.brief,
          suggestedPrompts: parsed.suggestedPrompts,
          recommendations
        })
      };

    } else {
      // ── Type B: User Message (conversation) ──
      console.log('💬 Handling conversation message...');

      const [recommendations, stats] = await Promise.all([
        loadServerSideRecommendations(userId),
        loadStats(userId)
      ]);

      const currentMode = mode || determineBarryMode(recommendations, stats);

      const topRecs = recommendations.slice(0, 3);
      const recContext = topRecs.length > 0
        ? `\nActive pipeline signals:\n${topRecs.map(r => {
            if (r.contactName) return `- Contact "${r.contactName}": ${r.type.replace(/_/g, ' ')}`;
            if (r.missionName) return `- Mission "${r.missionName}": ${r.type.replace(/_/g, ' ')}`;
            return `- ${r.type.replace(/_/g, ' ')}`;
          }).join('\n')}`
        : '';

      const statsLine = `Pipeline: ${stats.scoutContacts} contacts, ${stats.activeMissions} active mission${stats.activeMissions !== 1 ? 's' : ''}, ${stats.scoutCompanies} companies tracked.`;

      const systemPrompt = buildSystemPrompt(currentMode, reconContext) + `\n\n${statsLine}${recContext}`;

      // Build full message history including the new user message
      const messages = [
        ...(conversationHistory || []),
        { role: 'user', content: message }
      ];

      const chatController = new AbortController();
      const chatTimeout = setTimeout(() => chatController.abort(), 10000);
      let chatResponse;
      try {
        chatResponse = await anthropic.messages.create(
          {
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 500,
            system: systemPrompt,
            messages
          },
          { signal: chatController.signal }
        );
      } catch (claudeErr) {
        if (chatController.signal.aborted) {
          console.warn('⚠️ Barry conversation timed out after 10s');
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
              success: false,
              error: 'timeout',
              response: "Intel processing is slow right now — try again in a moment. [SUGGESTION]: \"What should I focus on today?\""
            })
          };
        }
        throw claudeErr;
      } finally {
        clearTimeout(chatTimeout);
      }

      const responseText = chatResponse.content[0].text;

      // Append Barry's response to history
      const updatedHistory = [
        ...messages,
        { role: 'assistant', content: responseText }
      ];

      const responseTime = Date.now() - startTime;
      await logApiUsage(userId, 'barryMissionChat', 'success', {
        responseTime,
        metadata: {
          mode: currentMode,
          type: 'conversation',
          messageCount: updatedHistory.length,
          reconEnhanced: !!reconContext
        }
      });

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: true,
          response: responseText,
          updatedHistory
        })
      };
    }

  } catch (error) {
    console.error('❌ Error in barryMissionChat:', error);

    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        await logApiUsage(userId, 'barryMissionChat', 'error', {
          responseTime: Date.now() - startTime,
          errorCode: error.message,
          metadata: {}
        });
      }
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
