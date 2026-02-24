import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './utils/logApiUsage.js';
import { db } from './firebase-admin.js';
import { compileReconForPrompt } from './utils/reconCompiler.js';

/**
 * BARRY SEQUENCE STEP CONTENT GENERATOR (Step 5)
 *
 * Just-in-time content generation for individual sequence steps.
 * Called when the user approves a step — NOT at sequence creation time.
 *
 * This is where Barry's adaptive logic lives. Barry generates content
 * for each step using the FULL context stack:
 *   - Contact: relationship_type, warmth_level, strategic_value, engagementIntent
 *   - Mission: outcome_goal, engagement_style, timeframe, next_step_type
 *   - Campaign: objective_type, time_horizon, strategic_priority
 *   - History: stepHistory (what was sent, what outcomes occurred)
 *   - Previous outcome: what happened after the last step
 *   - RECON training data
 *
 * Adaptive behavior:
 *   - No reply → softer follow-up, different angle
 *   - Positive reply → accelerate toward outcome_goal
 *   - Negative reply → graceful repositioning or exit
 *   - Timeframe approaching → increase urgency in tone and CTA
 *
 * GUARDRAIL: This function generates CONTENT. It never sends anything.
 * The user reviews, edits if desired, and explicitly sends.
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
    const {
      userId,
      authToken,
      contact,
      missionFields,
      stepPlan,
      stepIndex,
      stepHistory,
      previousOutcome
    } = JSON.parse(event.body);

    if (!userId || !authToken || !contact || !missionFields || !stepPlan) {
      throw new Error('Missing required parameters');
    }

    console.log('🐻 Barry generating step content:', stepPlan.stepType, 'for', contact.name || 'contact');

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

    // ─── Mission field labels ───
    const goalLabels = {
      schedule_meeting: 'Schedule a meeting',
      secure_commitment: 'Secure a commitment',
      rebuild_relationship: 'Rebuild the relationship',
      get_introduction: 'Get an introduction',
      gather_feedback: 'Gather feedback',
      ask_for_referral: 'Ask for a referral',
      close_deal: 'Close the deal'
    };

    const styleLabels = {
      light_touch: 'Light Touch (minimal, stay on radar)',
      moderate: 'Moderate (consistent follow-up)',
      high_touch: 'High-Touch (white glove, personal)'
    };

    // ─── Build step history narrative ───
    let historyNarrative = '';
    if (stepHistory && stepHistory.length > 0) {
      const historyLines = stepHistory.map(h => {
        let line = `  Step ${h.stepIndex + 1}: ${h.action}`;
        if (h.outcome) {
          const outcomeLabels = {
            no_reply: 'no reply received',
            replied_positive: 'contact replied positively',
            replied_negative: 'contact replied negatively or declined',
            not_sure: 'outcome unclear'
          };
          line += ` → ${outcomeLabels[h.outcome] || h.outcome}`;
        }
        return line;
      });
      historyNarrative = `\nENGAGEMENT HISTORY (what has happened so far in this sequence):
${historyLines.join('\n')}
`;
    }

    // ─── Build adaptive context ───
    let adaptiveInstruction = '';
    if (previousOutcome) {
      const adaptiveMap = {
        no_reply: `The previous step was sent and the contact DID NOT REPLY. Adjust your approach:
- Try a different angle or value proposition
- Consider a different channel if appropriate
- Soften the ask slightly but maintain direction toward the goal
- Reference the previous outreach briefly without being pushy`,

        replied_positive: `The previous step received a POSITIVE REPLY from the contact. The dialogue is active:
- Accelerate toward the outcome goal
- Build on the momentum — be direct about the next step
- Match their energy and enthusiasm
- Propose something concrete (specific time, specific ask)`,

        replied_negative: `The previous step received a NEGATIVE or DECLINING response:
- Acknowledge their position respectfully
- Consider if there's a reframe or alternative approach
- If this is the final step, propose a graceful exit that leaves the door open
- Do NOT be pushy or repeat the same ask`,

        not_sure: `The outcome of the previous step is unclear:
- Treat this as a soft follow-up opportunity
- Reference the previous outreach naturally
- Keep the tone warm and low-pressure
- Give them an easy way to re-engage`
      };
      adaptiveInstruction = `\nADAPTIVE CONTEXT — CRITICAL:
${adaptiveMap[previousOutcome] || 'No specific adaptation needed.'}
`;
    }

    // ─── Build timeframe urgency check ───
    let urgencyNote = '';
    if (missionFields.timeframe === 'this_week' && stepIndex >= 2) {
      urgencyNote = '\nURGENCY NOTE: The mission timeframe is "This Week" and this is a later step. Increase urgency in tone and CTA.';
    } else if (missionFields.timeframe === 'this_month' && stepIndex >= 3) {
      urgencyNote = '\nURGENCY NOTE: The mission timeframe is "This Month" and the sequence is nearing completion. Make this step count.';
    }

    // ─── Build the prompt ───
    const prompt = `You are Barry, a strategic engagement advisor. You are generating the actual content for Step ${stepIndex + 1} of a multi-step engagement sequence.

CRITICAL: You are generating a REAL message that the user will review, potentially edit, and then send. Make it natural, personal, and purposeful.
${reconContext}
CONTACT:
- Name: ${contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim()}
- Title: ${contact.title || 'Unknown'}
- Company: ${contact.company_name || 'Unknown'}
- Relationship: ${contact.relationship_type || 'unknown'}
- Warmth Level: ${contact.warmth_level || 'unknown'}
- Strategic Value: ${contact.strategic_value || 'unknown'}
- Engagement Intent: ${contact.engagementIntent || 'unknown'}

MISSION:
- Outcome Goal: ${goalLabels[missionFields.outcome_goal] || missionFields.outcome_goal}
- Engagement Style: ${styleLabels[missionFields.engagement_style] || missionFields.engagement_style}
- Timeframe: ${missionFields.timeframe}
- Next Step Type: ${missionFields.next_step_type}

THIS STEP:
- Step ${stepIndex + 1} of the sequence
- Step Type: ${stepPlan.stepType}
- Channel: ${stepPlan.channel}
- Purpose: ${stepPlan.purpose}
- Action: ${stepPlan.action}
${historyNarrative}${adaptiveInstruction}${urgencyNote}

GENERATE the message content for this step. Your output must be valid JSON:
{
  "subject": "Email subject line (only if channel is email, otherwise null)",
  "body": "The full message body. Write naturally. Use the contact's first name. Keep it appropriate for the channel.",
  "channel": "${stepPlan.channel}",
  "toneNote": "One sentence describing the tone Barry chose and why",
  "adaptationNote": ${previousOutcome ? '"One sentence explaining how Barry adapted based on the previous outcome"' : 'null'}
}

RULES:
1. Write as the USER, not as Barry. The user is sending this message.
2. Keep email messages under 150 words. Keep text messages under 50 words.
3. Phone/call steps: generate a brief talking points outline, not a script.
4. LinkedIn steps: generate a connection note or brief message.
5. Match tone to warmth_level: cold = professional, warm = friendly, hot = direct/personal.
6. Match depth to engagement_style: light_touch = brief, moderate = substantive, high_touch = detailed/personal.
7. Never use sales jargon, buzzwords, or generic filler.
8. If this is a follow_up step, reference the previous outreach naturally.
9. End with a clear but appropriate CTA aligned with the outcome_goal.

Respond ONLY with valid JSON.`;

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: claudeApiKey
    });

    const claudeResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const responseText = claudeResponse.content[0].text;
    console.log('🐻 Barry step content generated');

    // Parse response
    let generatedContent;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        generatedContent = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }

      // Validate required fields
      if (!generatedContent.body) {
        throw new Error('Generated content missing body');
      }

      // Normalize channel
      generatedContent.channel = generatedContent.channel || stepPlan.channel;

    } catch (parseError) {
      console.error('Error parsing Barry step content response:', parseError);
      throw new Error('Failed to generate step content');
    }

    // Log API usage
    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'barryGenerateSequenceStep', 'success', {
      responseTime,
      metadata: {
        stepIndex,
        stepType: stepPlan.stepType,
        channel: stepPlan.channel,
        outcome_goal: missionFields.outcome_goal,
        previousOutcome: previousOutcome || null,
        reconPresent: !!reconContext,
        hasHistory: (stepHistory?.length || 0) > 0,
        inputTokens: claudeResponse.usage?.input_tokens,
        outputTokens: claudeResponse.usage?.output_tokens
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
        generatedContent: {
          ...generatedContent,
          stepIndex,
          generatedAt: new Date().toISOString()
        }
      })
    };

  } catch (error) {
    console.error('❌ Error in barryGenerateSequenceStep:', error);

    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(userId, 'barryGenerateSequenceStep', 'error', {
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
