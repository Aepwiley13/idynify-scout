import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './utils/logApiUsage.js';
import { db } from './firebase-admin.js';
import { compileReconForPrompt } from './utils/reconCompiler.js';

/**
 * BARRY MISSION SEQUENCE GENERATOR (Step 4)
 *
 * Generates a micro-sequence (2-3 approval-gated steps) based on
 * structured mission fields and contact context.
 *
 * Inputs:
 *   - Mission fields: outcome_goal, engagement_style, timeframe, next_step_type
 *   - Contact context: relationship_type, warmth_level, strategic_value
 *   - RECON training data (if available)
 *
 * Output:
 *   - A 2-3 step micro-sequence with rationale
 *   - Each step: action, channel, description, timing
 *   - All steps are suggestions — user must approve each one
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

    // ─── Build the prompt ───
    const prompt = `You are Barry, a strategic engagement planner. You help users plan intentional engagement sequences — not isolated messages.

You are given structured mission parameters and optional contact context. Your job is to generate a micro-sequence: a 2-3 step plan that moves toward the stated outcome goal.
${reconContext}
MISSION PARAMETERS:
- Outcome Goal: ${goalLabels[outcome_goal] || outcome_goal}
- Engagement Style: ${styleLabels[engagement_style] || engagement_style}
- Timeframe: ${timeframeLabels[timeframe] || timeframe}
- Next Step Type: ${nextStepLabels[next_step_type] || next_step_type}
${contactContextBlock}
YOUR TASK:
Generate a micro-sequence of 2-3 steps that logically progresses toward the outcome goal.

RULES:
1. Step 1 must align with the next_step_type (${nextStepLabels[next_step_type] || next_step_type})
2. Each subsequent step escalates appropriately based on engagement_style
3. Timing between steps must respect the timeframe:
   - This Week: steps 1-2 days apart
   - This Month: steps 3-7 days apart
   - This Quarter: steps 1-3 weeks apart
   - No Deadline: steps 1-2 weeks apart
4. Light Touch sequences should be shorter and less aggressive
5. High-Touch sequences should include more personal/direct channels
6. Each step must have a clear purpose that builds toward the outcome
7. All steps are SUGGESTIONS — the user approves each one individually
8. Do NOT write actual message content — describe what each step should accomplish
9. Be specific about channel (email, text, phone, linkedin) and action type

REQUIRED OUTPUT FORMAT (JSON):
{
  "sequenceRationale": "One sentence explaining why this sequence makes sense for the given parameters",
  "steps": [
    {
      "stepNumber": 1,
      "action": "Brief action description (e.g., 'Send personalized email introducing value proposition')",
      "channel": "email|text|phone|linkedin|calendar",
      "purpose": "What this step accomplishes toward the outcome goal",
      "timing": "When this should happen relative to mission start (e.g., 'Day 1', 'Day 3')",
      "approvalRequired": true
    }
  ],
  "expectedOutcome": "What success looks like if the full sequence is executed"
}

TONE: Strategic but practical. No fluff. No sales jargon. Focus on intent and progression.

Generate the micro-sequence now. Respond ONLY with valid JSON.`;

    // Call Claude API
    const claudeResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1200,
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

      // Ensure all steps have approvalRequired: true (guardrail)
      microSequence.steps = microSequence.steps.map(step => ({
        ...step,
        approvalRequired: true
      }));

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

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        microSequence: {
          ...microSequence,
          generatedAt: new Date().toISOString(),
          reconEnhanced: !!reconContext,
          missionFields: { outcome_goal, engagement_style, timeframe, next_step_type }
        }
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
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
