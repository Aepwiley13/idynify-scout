import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './utils/logApiUsage.js';
import { db } from './firebase-admin.js';
import { compileReconForPrompt } from './utils/reconCompiler.js';

/**
 * BARRY MISSION SEQUENCE GENERATOR (Step 4 → Step 5 Upgrade)
 *
 * Generates a 2-4 step engagement sequence plan based on structured
 * mission fields and contact context.
 *
 * Step 5 changes:
 *   - Expanded from 2-3 to 2-4 steps
 *   - Added stepType field (message, follow_up, call, resource, introduction)
 *   - Added suggestedTiming with day offsets for scheduling logic
 *   - Added reasoning per step (why Barry is suggesting this step)
 *   - Content is NOT generated here — content is generated just-in-time
 *     via barryGenerateSequenceStep when user approves each step
 *
 * Inputs:
 *   - Mission fields: outcome_goal, engagement_style, timeframe, next_step_type
 *   - Contact context: relationship_type, warmth_level, strategic_value
 *   - RECON training data (if available)
 *
 * Output:
 *   - A 2-4 step sequence plan with rationale
 *   - Each step: stepType, channel, action, purpose, reasoning, timing
 *   - All steps are suggestions — user must approve each one individually
 *   - Actual message content generated later (just-in-time)
 */

export const handler = async (event) => {
  const startTime = Date.now();

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, authToken, missionFields, contacts } = JSON.parse(event.body);

    if (!userId || !authToken || !missionFields) {
      throw new Error('Missing required parameters');
    }

    const { outcome_goal, engagement_style, timeframe, next_step_type } = missionFields;
    if (!outcome_goal || !engagement_style || !timeframe || !next_step_type) {
      throw new Error('All four mission fields are required: outcome_goal, engagement_style, timeframe, next_step_type');
    }

    console.log('🐻 Barry generating mission sequence:', outcome_goal);

    // Validate environment variables
    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeApiKey) {
      throw new Error('Claude API key not configured');
    }

    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
      throw new Error('Firebase API key not configured');
    }

    // Verify Firebase Auth token
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

    console.log('✅ Auth token verified');

    // ─── Fetch RECON training data ───
    let reconContext = '';
    try {
      const dashboardDoc = await db.collection('dashboards').doc(userId).get();
      if (dashboardDoc.exists) {
        reconContext = compileReconForPrompt(dashboardDoc.data());
        if (reconContext) {
          console.log('🧠 RECON training data loaded');
        }
      }
    } catch (reconError) {
      console.warn('⚠️ Could not load RECON data (non-fatal):', reconError.message);
    }

    // ─── Build contact context summary ───
    let contactContextBlock = '';
    if (contacts && contacts.length > 0) {
      const contactSummaries = contacts.slice(0, 5).map(c => {
        const parts = [`  - ${c.name || 'Unknown'}`];
        if (c.title) parts[0] += `, ${c.title}`;
        if (c.company_name) parts[0] += ` at ${c.company_name}`;
        if (c.relationship_type) parts.push(`    Relationship: ${c.relationship_type}`);
        if (c.warmth_level) parts.push(`    Warmth: ${c.warmth_level}`);
        if (c.strategic_value) parts.push(`    Strategic Value: ${c.strategic_value}`);
        return parts.join('\n');
      });

      contactContextBlock = `\nCONTACT CONTEXT (${contacts.length} contact${contacts.length !== 1 ? 's' : ''} in this mission):
${contactSummaries.join('\n')}${contacts.length > 5 ? `\n  ... and ${contacts.length - 5} more` : ''}
`;
    }

    // ─── Mission field label mappings ───
    const goalLabels = {
      schedule_meeting: 'Schedule Meeting',
      secure_commitment: 'Secure Commitment',
      rebuild_relationship: 'Rebuild Relationship',
      get_introduction: 'Get Introduction',
      gather_feedback: 'Gather Feedback',
      ask_for_referral: 'Ask for Referral',
      close_deal: 'Close Deal'
    };

    const styleLabels = {
      light_touch: 'Light Touch — minimal effort, low frequency',
      moderate: 'Moderate — consistent follow-up over weeks',
      high_touch: 'High-Touch — white glove, frequent personal engagement'
    };

    const timeframeLabels = {
      this_week: 'This Week — urgent, within 7 days',
      this_month: 'This Month — active, within 30 days',
      this_quarter: 'This Quarter — strategic, within 90 days',
      no_deadline: 'No Deadline — ongoing, no time pressure'
    };

    const nextStepLabels = {
      send_message: 'Send Message',
      book_call: 'Book Call',
      request_meeting: 'Request Meeting',
      send_resource: 'Send Resource',
      make_introduction: 'Make Introduction',
      follow_up: 'Follow Up'
    };

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: claudeApiKey
    });

    // ─── Build the prompt (Step 5 upgrade) ───
    const prompt = `You are Barry, a strategic engagement planner. You help users plan intentional, multi-step engagement sequences — not isolated messages.

You are given structured mission parameters and optional contact context. Your job is to generate a sequence plan: a 2-4 step engagement path that moves toward the stated outcome goal. Each step builds on the previous one.

IMPORTANT: You are generating a PLAN, not content. Actual message content will be generated later for each step individually, using the latest context including what happened in previous steps. Do NOT write actual message text.
${reconContext}
MISSION PARAMETERS:
- Outcome Goal: ${goalLabels[outcome_goal] || outcome_goal}
- Engagement Style: ${styleLabels[engagement_style] || engagement_style}
- Timeframe: ${timeframeLabels[timeframe] || timeframe}
- Next Step Type: ${nextStepLabels[next_step_type] || next_step_type}
${contactContextBlock}
YOUR TASK:
Generate a sequence plan of 2-4 steps that logically progresses toward the outcome goal.

RULES:
1. Step 1 must align with the next_step_type (${nextStepLabels[next_step_type] || next_step_type})
2. Each subsequent step escalates appropriately based on engagement_style
3. Timing between steps must respect the timeframe:
   - This Week: steps 1-2 days apart, 2-3 steps total
   - This Month: steps 3-7 days apart, 3-4 steps total
   - This Quarter: steps 1-3 weeks apart, 3-4 steps total
   - No Deadline: steps 1-2 weeks apart, 2-3 steps total
4. Light Touch = fewer steps (2-3), softer channels, longer spacing
5. High-Touch = more steps (3-4), personal/direct channels, tighter spacing
6. Moderate = balanced (2-4 steps depending on timeframe)
7. Each step must have a clear purpose that builds toward the outcome
8. All steps are SUGGESTIONS — the user approves each one individually
9. Do NOT write actual message content — describe what each step should accomplish
10. Be specific about channel (email, text, phone, linkedin) and step type
11. Include a reasoning field explaining WHY this step makes strategic sense at this point in the sequence
12. stepType must be one of: message, follow_up, call, resource, introduction

REQUIRED OUTPUT FORMAT (JSON):
{
  "sequenceRationale": "One sentence explaining why this sequence structure makes sense for the given parameters",
  "steps": [
    {
      "stepNumber": 1,
      "stepType": "message|follow_up|call|resource|introduction",
      "action": "Brief action description (e.g., 'Send personalized email introducing value proposition')",
      "channel": "email|text|phone|linkedin|calendar",
      "purpose": "What this step accomplishes toward the outcome goal",
      "reasoning": "Why Barry recommends this specific step at this point in the sequence",
      "suggestedTiming": "Day 0|Day 3|Day 7|etc",
      "suggestedDayOffset": 0,
      "approvalRequired": true
    }
  ],
  "expectedOutcome": "What success looks like if the full sequence is executed"
}

TONE: Strategic but practical. No fluff. No sales jargon. Focus on intent and progression.

Generate the sequence plan now. Respond ONLY with valid JSON.`;

    // Call Claude API
    const claudeResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1800,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const responseText = claudeResponse.content[0].text;
    console.log('🐻 Barry sequence generated');

    // Parse response
    let microSequence;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        microSequence = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }

      // Validate structure
      if (!microSequence.sequenceRationale || !microSequence.steps || !Array.isArray(microSequence.steps)) {
        throw new Error('Invalid sequence structure');
      }

      // Guardrails: enforce approval gate and normalize step structure
      const validStepTypes = ['message', 'follow_up', 'call', 'resource', 'introduction'];
      microSequence.steps = microSequence.steps.map((step, idx) => ({
        ...step,
        stepNumber: idx + 1,
        stepType: validStepTypes.includes(step.stepType) ? step.stepType : 'message',
        suggestedDayOffset: typeof step.suggestedDayOffset === 'number' ? step.suggestedDayOffset : idx * 3,
        reasoning: step.reasoning || step.purpose || '',
        approvalRequired: true  // GUARDRAIL: always true, no exceptions
      }));

      // Enforce 2-4 step limit
      if (microSequence.steps.length < 2) {
        throw new Error('Sequence must have at least 2 steps');
      }
      if (microSequence.steps.length > 4) {
        microSequence.steps = microSequence.steps.slice(0, 4);
      }

    } catch (parseError) {
      console.error('Error parsing Barry sequence response:', parseError);
      throw new Error('Failed to generate valid mission sequence');
    }

    // Log API usage
    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'barryGenerateMissionSequence', 'success', {
      responseTime,
      metadata: {
        outcome_goal,
        engagement_style,
        timeframe,
        next_step_type,
        contactCount: contacts?.length || 0,
        hasReconData: !!reconContext,
        stepsGenerated: microSequence.steps.length
      }
    });

    // Build the sequence plan object (Step 5 format)
    const sequencePlan = {
      ...microSequence,
      totalSteps: microSequence.steps.length,
      generatedAt: new Date().toISOString(),
      reconEnhanced: !!reconContext,
      missionFields: { outcome_goal, engagement_style, timeframe, next_step_type }
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'https://idynify.com'
      },
      body: JSON.stringify({
        success: true,
        microSequence: sequencePlan,
        // Step 5: Also return as 'sequence' for new consumers
        sequence: sequencePlan
      })
    };

  } catch (error) {
    console.error('❌ Error in barryGenerateMissionSequence:', error);

    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(userId, 'barryGenerateMissionSequence', 'error', {
          responseTime,
          errorCode: error.message,
          metadata: {}
        });
      }
    } catch (logError) {
      console.error('Failed to log API error:', logError);
    }

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'https://idynify.com'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
