/**
 * BARRY HUNTER PROCESS ENGAGE — Sprint 3 Orchestrator
 *
 * Called immediately after a contact is set to engaged_pending.
 * Performs the full processing chain:
 *   1. Load contact + RECON + mission history
 *   2. Determine outcome_goal
 *   3. Build mission step structure (2-3 steps)
 *   4. Generate step 1 message draft (4 angles, Hunter voice)
 *   5. Write mission to Firestore (users/{uid}/missions/{missionId})
 *   6. Update contact: hunter_status → active_mission
 *   7. Return { missionId, outcome_goal, isFirstContact }
 *
 * Error handling: writes processing_error to contact so UI surfaces it.
 * Never leaves a contact in engaged_pending without a resolution.
 */

import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './utils/logApiUsage.js';
import { db } from './firebase-admin.js';
import { compileReconForPrompt } from './utils/reconCompiler.js';
import { assembleBarryContext } from './utils/barryContextAssembler.js';
import { checkRelationshipGuardrail } from './utils/barryGuardrail.js';

// ── Outcome goal defaults by relationship state ──────────────────────────────
const DEFAULT_OUTCOME_GOALS = {
  unaware:          'enter_conversation',
  aware:            'build_rapport',
  engaged:          'schedule_meeting',
  warm:             'schedule_meeting',
  trusted:          'get_introduction',
  advocate:         'ask_for_referral',
  dormant:          'reconnect',
  strained:         'rebuild_relationship',
  strategic_partner: 'expand_relationship'
};

function getDefaultOutcomeGoal(relationshipState) {
  return DEFAULT_OUTCOME_GOALS[relationshipState] || 'enter_conversation';
}

// ── Mission step templates ──────────────────────────────────────────────────
function buildMissionSteps(outcomeGoal) {
  const base = [
    {
      stepNumber: 1,
      stepType: 'message',
      channel: 'email',
      action: 'Initial outreach',
      purpose: 'Establish contact and signal value',
      suggestedDayOffset: 0,
      status: 'current',
      draft: null,
      sent_at: null, sent_angle: null, sent_subject: null, sent_message: null,
      outcome: null, outcome_at: null, barry_note: null, completed_at: null
    },
    {
      stepNumber: 2,
      stepType: 'follow_up',
      channel: 'email',
      action: 'Follow up on initial outreach',
      purpose: 'Maintain momentum and handle response',
      suggestedDayOffset: 5,
      status: 'pending',
      draft: null,
      sent_at: null, sent_angle: null, sent_subject: null, sent_message: null,
      outcome: null, outcome_at: null, barry_note: null, completed_at: null
    },
    {
      stepNumber: 3,
      stepType: 'follow_up',
      channel: 'email',
      action: 'Final check-in',
      purpose: 'Close the loop gracefully',
      suggestedDayOffset: 12,
      status: 'pending',
      draft: null,
      sent_at: null, sent_angle: null, sent_subject: null, sent_message: null,
      outcome: null, outcome_at: null, barry_note: null, completed_at: null
    }
  ];

  // Tailor step 2 purpose by goal
  if (outcomeGoal === 'get_introduction' || outcomeGoal === 'ask_for_referral') {
    base[1].action = 'Propose the ask directly';
    base[1].purpose = 'Make the introduction or referral request';
  } else if (outcomeGoal === 'rebuild_relationship' || outcomeGoal === 'reconnect') {
    base.length = 2;  // Shorter mission — 2 steps for relationship repair
    base[0].action = 'Re-establish contact warmly';
    base[1].action = 'Deepen the reconnection';
    base[1].suggestedDayOffset = 7;
  } else if (outcomeGoal === 'schedule_meeting') {
    base[1].action = 'Propose a specific time to meet';
  }

  return base;
}

// ── Step 1 draft generation (4 angles) ──────────────────────────────────────
async function generateStep1Draft(anthropic, contact, reconContext, outcomeGoal, isFirstContact, intake, barryMemoryContext = '') {
  const name = contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Contact';
  const firstName = contact.first_name || name.split(' ')[0];

  // Build intake context if available
  let intakeContext = '';
  if (intake && (intake.completed_at || intake.skipped_at)) {
    if (!intake.skipped) {
      intakeContext = `\nUser-provided intake context:
- Reason for reaching out: ${intake.reason || 'Not specified'}
- How they know this person: ${intake.how_know || 'Not specified'}
- What success looks like: ${intake.success_looks_like || 'Not specified'}`;
    }
  }

  const limitedContextNote = isFirstContact && !intakeContext
    ? '\nIMPORTANT: This is a first-contact with no prior history and no intake data. Flag this in barry_reasoning by saying you have limited context and that completing the intake will sharpen the draft.'
    : '';

  const prompt = `You are Barry, Idynify's AI sales intelligence assistant operating in Hunter mode.

Your job: generate one message draft in four distinct angles for the user to choose from.

Context:
- Contact: ${name}, ${contact.title || 'unknown title'} at ${contact.company_name || 'unknown company'}
- Relationship state: ${contact.relationship_state || 'unaware'}
- Outcome goal: ${outcomeGoal}
- Last interaction: ${contact.last_interaction_at ? new Date(contact.last_interaction_at).toLocaleDateString() : 'Never'}${reconContext ? `\n${reconContext}` : '\n- No RECON training data available'}${barryMemoryContext ? `\n${barryMemoryContext}` : ''}${intakeContext}${limitedContextNote}

Rules:
1. Every message must contain at least one specific detail from the contact or context. No generic templates.
2. Match the persona — VP gets a different message than a founder.
3. Write as the USER, not as Barry. The user sends this message.
4. Each angle must be genuinely different — not the same message with a different opener.
5. Every message ends with exactly one clear CTA. Never two asks.
6. Subject lines under 8 words. No clickbait.
7. Under 120 words per message unless outcome_goal requires more.
8. Use the contact's first name (${firstName}) naturally in the message.

Output format — return valid JSON only:
{
  "outcome_goal": "${outcomeGoal}",
  "barry_reasoning": "One sentence: why this approach given the relationship state and available context.",
  "limited_context": ${isFirstContact && !intakeContext ? 'true' : 'false'},
  "recommended_angle": "value_add",
  "angles": [
    {
      "id": "value_add",
      "label": "Value Add",
      "subject": "Subject line here",
      "message": "Message body here"
    },
    {
      "id": "direct_ask",
      "label": "Direct Ask",
      "subject": "Subject line here",
      "message": "Message body here"
    },
    {
      "id": "soft_reconnect",
      "label": "Soft Reconnect",
      "subject": "Subject line here",
      "message": "Message body here"
    },
    {
      "id": "pattern_interrupt",
      "label": "Pattern Interrupt",
      "subject": "Subject line here",
      "message": "Message body here"
    }
  ]
}`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2500,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in step 1 draft response');

  const draft = JSON.parse(jsonMatch[0]);
  if (!draft.angles || !Array.isArray(draft.angles) || draft.angles.length < 4) {
    throw new Error('Invalid draft: expected 4 angles');
  }

  return {
    ...draft,
    generated_at: new Date().toISOString()
  };
}

// ── Firebase auth verification ───────────────────────────────────────────────
async function verifyAuthToken(authToken, userId) {
  const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
  if (!firebaseApiKey) throw new Error('Firebase API key not configured');

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: authToken })
    }
  );

  if (!res.ok) throw new Error('Invalid authentication token');
  const data = await res.json();
  if (!data.users || data.users[0].localId !== userId) {
    throw new Error('Token does not match userId');
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const startTime = Date.now();
  let contactId, userId;

  try {
    const body = JSON.parse(event.body);
    contactId = body.contactId;
    userId = body.userId;
    const authToken = body.authToken;

    if (!contactId || !userId || !authToken) {
      throw new Error('Missing required parameters: contactId, userId, authToken');
    }

    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

    // Verify auth
    await verifyAuthToken(authToken, userId);

    console.log(`[barryHunterProcessEngage] Processing engage: contact=${contactId}`);

    // 1. Load contact from Firestore
    const contactDoc = await db
      .collection('users').doc(userId)
      .collection('contacts').doc(contactId)
      .get();

    if (!contactDoc.exists) throw new Error('Contact not found');
    const contact = { id: contactId, ...contactDoc.data() };

    // 1b. Pre-generation guardrail check (Sprint 2)
    let barryWarning = null;
    try {
      const intent = contact.engagementIntent || contact.engagement_intent || 'prospect';
      barryWarning = checkRelationshipGuardrail(contact, intent, contact.hunter_intake?.reason || '');
      if (barryWarning) {
        console.log(`[barryHunterProcessEngage] Guardrail triggered: ${barryWarning.type}`);
      }
    } catch (guardrailErr) {
      console.warn('[barryHunterProcessEngage] Guardrail check failed (non-blocking):', guardrailErr.message);
    }

    // 2. Load RECON data (non-fatal)
    let reconContext = '';
    try {
      const dashboardDoc = await db.collection('dashboards').doc(userId).get();
      if (dashboardDoc.exists) {
        reconContext = compileReconForPrompt(dashboardDoc.data()) || '';
      }
    } catch (err) {
      console.warn('[barryHunterProcessEngage] RECON load skipped:', err.message);
    }

    // 3. Load Barry's memory context (Sprint 0 — gives Barry history awareness)
    let barryMemoryContext = '';
    try {
      const { promptContext } = await assembleBarryContext(db, userId, contactId);
      barryMemoryContext = promptContext || '';
      if (barryMemoryContext) {
        console.log(`[barryHunterProcessEngage] Barry memory loaded for contact=${contactId}`);
      }
    } catch (memErr) {
      console.warn('[barryHunterProcessEngage] Barry memory unavailable:', memErr.message);
    }

    // 4. Check mission history (determines isFirstContact)
    let isFirstContact = true;
    try {
      const historySnap = await db
        .collection('users').doc(userId)
        .collection('missions')
        .where('contactId', '==', contactId)
        .limit(1)
        .get();
      isFirstContact = historySnap.empty;
    } catch (_) {
      // Non-fatal — default to true if query fails (conservative)
    }

    // Also consider last_interaction_at as a signal
    if (contact.last_interaction_at || contact.last_outcome) {
      isFirstContact = false;
    }

    // 5. Determine outcome_goal
    const outcomeGoal = contact.outcome_goal || getDefaultOutcomeGoal(contact.relationship_state);

    // 6. Build mission step structure
    const steps = buildMissionSteps(outcomeGoal);

    // 7. Generate step 1 draft (4 angles) — the main AI call
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const step1Draft = await generateStep1Draft(
      anthropic, contact, reconContext, outcomeGoal, isFirstContact, contact.hunter_intake, barryMemoryContext
    );
    steps[0].draft = step1Draft;

    // 8. Write mission to Firestore
    const missionRef = db.collection('users').doc(userId).collection('missions').doc();
    const missionId = missionRef.id;
    await missionRef.set({
      id: missionId,
      contactId,
      outcome_goal: outcomeGoal,
      engagement_style: contact.engagementStyle || 'moderate',
      status: 'active',
      isFirstContact,
      barry_reasoning: step1Draft.barry_reasoning,
      barry_warning: barryWarning || null,
      steps,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    // 9. Update contact to active_mission
    await db.collection('users').doc(userId).collection('contacts').doc(contactId).update({
      hunter_status: 'active_mission',
      active_mission_id: missionId,
      processing_error: null,
      processing_error_at: null,
      updated_at: new Date().toISOString()
    });

    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'barryHunterProcessEngage', 'success', {
      responseTime,
      metadata: { outcomeGoal, isFirstContact, hasRecon: !!reconContext, hasBarryMemory: !!barryMemoryContext, missionId }
    });

    console.log(`[barryHunterProcessEngage] ✓ Mission created: ${missionId} (${responseTime}ms)`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, missionId, outcome_goal: outcomeGoal, isFirstContact, barry_warning: barryWarning || null })
    };

  } catch (error) {
    console.error('[barryHunterProcessEngage] Error:', error.message);

    // Write error state so the UI never shows an infinite spinner
    if (contactId && userId) {
      try {
        await db.collection('users').doc(userId).collection('contacts').doc(contactId).update({
          hunter_status: 'active_mission',  // Move out of engaged_pending
          processing_error: error.message,
          processing_error_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      } catch (writeErr) {
        console.error('[barryHunterProcessEngage] Could not write error state:', writeErr.message);
      }
    }

    try {
      if (userId) {
        await logApiUsage(userId, 'barryHunterProcessEngage', 'error', {
          responseTime: Date.now() - startTime,
          errorCode: error.message,
          metadata: {}
        });
      }
    } catch (_) {}

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
