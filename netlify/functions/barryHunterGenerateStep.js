/**
 * BARRY HUNTER GENERATE STEP — Sprint 3
 *
 * Generates a 4-angle message draft for step 2+ of an active mission.
 * Called after the user records an outcome for the previous step.
 *
 * Input:
 *   { userId, authToken, contactId, missionId, stepIndex, previousOutcome }
 *
 * Output:
 *   Writes draft to mission.steps[stepIndex].draft in Firestore.
 *   Returns { success: true, stepIndex }
 *
 * Barry adapts the angle recommendation based on the previous outcome:
 *   positive_reply → direct_ask (move fast)
 *   no_reply       → pattern_interrupt (try something different)
 *   neutral_reply  → value_add (keep flowing, no ask yet)
 *   negative_reply → soft_reconnect (graceful repositioning)
 *   scheduled      → no draft needed (mission step complete)
 *   not_interested → no draft needed (close mission)
 */

import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './utils/logApiUsage.js';
import { db } from './firebase-admin.js';
import { compileReconForPrompt } from './utils/reconCompiler.js';
import { assembleBarryContext } from './utils/barryContextAssembler.js';
import { recommendStrategy } from './utils/barryStrategyRecommender.js';

// Barry's step adaptation map (spec-exact)
const STEP_ADAPTATION = {
  positive_reply: {
    recommended_angle: 'direct_ask',
    barry_note: "They replied positively. Move fast — I've drafted a meeting request.",
    tone_directive: 'Build on the positive momentum. Be direct about the next step. Propose something concrete — specific time, specific ask. Match their energy.'
  },
  no_reply: {
    recommended_angle: 'pattern_interrupt',
    barry_note: "No reply yet. That's normal. Here's a different angle.",
    tone_directive: "No reply to the last message. That's normal. Try a genuinely different approach — different hook, different value signal. Don't reference the previous message."
  },
  neutral_reply: {
    recommended_angle: 'value_add',
    barry_note: "Neutral reply — keep the value flowing, no ask yet.",
    tone_directive: "They responded but didn't commit. Keep adding value. No ask yet — build the case. Stay warm and patient."
  },
  negative_reply: {
    recommended_angle: 'soft_reconnect',
    barry_note: "Not interested right now. I've drafted a graceful repositioning — keep the relationship open.",
    tone_directive: "They pushed back or declined. Acknowledge their position. Gracefully reposition — keep the door open, don't push. This is about the long game."
  }
};

// Outcomes where no next step is needed
const TERMINAL_OUTCOMES = ['scheduled', 'not_interested'];

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
  if (!data.users || data.users[0].localId !== userId) throw new Error('Token/userId mismatch');
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const startTime = Date.now();
  let userId, missionId, stepIndex;

  try {
    const body = JSON.parse(event.body);
    userId = body.userId;
    const authToken = body.authToken;
    const contactId = body.contactId;
    missionId = body.missionId;
    stepIndex = body.stepIndex;  // 0-based index of the step to generate
    const previousOutcome = body.previousOutcome;  // outcome id from previous step

    if (!userId || !authToken || !contactId || !missionId || stepIndex === undefined) {
      throw new Error('Missing required parameters');
    }

    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

    await verifyAuthToken(authToken, userId);

    // For terminal outcomes, no draft needed — just mark mission complete
    if (TERMINAL_OUTCOMES.includes(previousOutcome)) {
      const adaptation = STEP_ADAPTATION[previousOutcome] || {};
      await db.collection('users').doc(userId).collection('missions').doc(missionId).update({
        status: previousOutcome === 'scheduled' ? 'completed' : 'abandoned',
        barry_terminal_note: adaptation.barry_note || null,
        updated_at: new Date().toISOString()
      });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true, terminal: true, previousOutcome })
      };
    }

    // Load contact
    const contactDoc = await db.collection('users').doc(userId).collection('contacts').doc(contactId).get();
    if (!contactDoc.exists) throw new Error('Contact not found');
    const contact = { id: contactId, ...contactDoc.data() };

    // Load mission
    const missionDoc = await db.collection('users').doc(userId).collection('missions').doc(missionId).get();
    if (!missionDoc.exists) throw new Error('Mission not found');
    const mission = missionDoc.data();

    // Build step history for context
    const completedSteps = (mission.steps || [])
      .filter((s, idx) => idx < stepIndex && s.outcome)
      .map(s => `Step ${s.stepNumber}: ${s.action} → ${s.outcome || 'pending'}`);

    // Load RECON + Barry intelligence layers in parallel (non-fatal)
    let reconContext = '';
    let barryMemoryContext = '';
    let strategyGuidance = '';
    try {
      const [dashboardDoc, barryCtx] = await Promise.all([
        db.collection('dashboards').doc(userId).get(),
        assembleBarryContext(db, userId, contactId)
      ]);
      if (dashboardDoc.exists) reconContext = compileReconForPrompt(dashboardDoc.data()) || '';
      barryMemoryContext = barryCtx.promptContext || '';

      // Get strategy recommendation using full contact + attribution data
      const { promptGuidance } = recommendStrategy({
        contact,
        engagementIntent: contact.engagement_intent || contact.engagementIntent || 'prospect',
        strategyStats: barryCtx.context?.strategy_stats || null,
        barryMemory: contact.barry_memory || null,
        recentAttributions: barryCtx.context?.recent_attributions || []
      });
      strategyGuidance = promptGuidance || '';
    } catch (_) {}

    const adaptation = STEP_ADAPTATION[previousOutcome] || {
      recommended_angle: 'value_add',
      barry_note: 'Continue the sequence.',
      tone_directive: 'Continue building the relationship naturally.'
    };

    const stepPlan = (mission.steps || [])[stepIndex];
    const name = contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Contact';
    const firstName = contact.first_name || name.split(' ')[0];

    const prompt = `You are Barry, Idynify's AI sales intelligence assistant operating in Hunter mode.

Generate a step ${stepIndex + 1} message draft in four angles for an ongoing engagement sequence.

Context:
- Contact: ${name}, ${contact.title || 'unknown title'} at ${contact.company_name || 'unknown company'}
- Relationship state: ${contact.relationship_state || 'unaware'}
- Outcome goal: ${mission.outcome_goal}
- This step: ${stepPlan?.action || 'Follow up'}
- Previous step outcome: ${previousOutcome}${reconContext ? `\n${reconContext}` : ''}${barryMemoryContext}${strategyGuidance}

Engagement history:
${completedSteps.length > 0 ? completedSteps.join('\n') : 'No prior steps completed.'}

Tone directive for this step:
${adaptation.tone_directive}

Rules:
1. Reference context — no generic templates.
2. Write as the USER, not Barry.
3. Each of the 4 angles must be genuinely different.
4. Exactly one CTA per message. No double-asks.
5. Subject lines under 8 words.
6. Under 120 words per message.
7. Use the contact's first name (${firstName}) naturally.

Output — valid JSON only:
{
  "outcome_goal": "${mission.outcome_goal}",
  "barry_reasoning": "One sentence explaining Barry's angle choice for this step.",
  "barry_note": "${adaptation.barry_note}",
  "limited_context": false,
  "recommended_angle": "${adaptation.recommended_angle}",
  "angles": [
    {"id": "value_add", "label": "Value Add", "subject": "...", "message": "..."},
    {"id": "direct_ask", "label": "Direct Ask", "subject": "...", "message": "..."},
    {"id": "soft_reconnect", "label": "Soft Reconnect", "subject": "...", "message": "..."},
    {"id": "pattern_interrupt", "label": "Pattern Interrupt", "subject": "...", "message": "..."}
  ]
}`;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in step draft response');

    const draft = JSON.parse(jsonMatch[0]);
    if (!draft.angles || draft.angles.length < 4) throw new Error('Invalid draft: need 4 angles');

    draft.generated_at = new Date().toISOString();

    // Write draft to mission.steps[stepIndex].draft using dot-notation path
    const updatePath = {};
    updatePath[`steps.${stepIndex}.draft`] = draft;
    updatePath[`steps.${stepIndex}.status`] = 'current';
    updatePath['updated_at'] = new Date().toISOString();

    await db.collection('users').doc(userId).collection('missions').doc(missionId).update(updatePath);

    await logApiUsage(userId, 'barryHunterGenerateStep', 'success', {
      responseTime: Date.now() - startTime,
      metadata: { stepIndex, previousOutcome, outcomeGoal: mission.outcome_goal }
    });

    console.log(`[barryHunterGenerateStep] ✓ Step ${stepIndex + 1} draft generated for mission ${missionId}`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, stepIndex, missionId })
    };

  } catch (error) {
    console.error('[barryHunterGenerateStep] Error:', error.message);

    // Write error to the step so UI can show retry
    if (userId && missionId && stepIndex !== undefined) {
      try {
        const updatePath = {};
        updatePath[`steps.${stepIndex}.draft_error`] = error.message;
        updatePath['updated_at'] = new Date().toISOString();
        await db.collection('users').doc(userId).collection('missions').doc(missionId).update(updatePath);
      } catch (_) {}
    }

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
