/**
 * Barry Template Generator
 *
 * Generates email templates based on stage context and user description.
 * Barry asks clarifying questions if needed, then produces a ready-to-save template.
 *
 * Input: { authToken, userId, stage, description, conversationHistory }
 * Output: { response_text, template (if ready), updatedHistory }
 */

import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './utils/logApiUsage.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Stage-specific context for Barry
const STAGE_CONTEXT = {
  scout: {
    label: 'Scout',
    goal: 'Initial outreach to new leads. First touch — get on their radar.',
    tones: 'Curious, lightweight, non-pushy. Show you did your homework.',
    examples: 'Cold intro, ICP-match outreach, "saw your company" opener, event follow-up',
  },
  hunter: {
    label: 'Hunter',
    goal: 'Active pursuit — get a meeting booked or a reply.',
    tones: 'Direct, value-forward, persistent but respectful. Create urgency without pressure.',
    examples: 'Follow-up sequences, meeting requests, value prop emails, break-up emails',
  },
  sniper: {
    label: 'Sniper',
    goal: 'Close zone — move deals forward, handle objections, get sign-off.',
    tones: 'Confident, consultative, trust-building. Speak to their specific situation.',
    examples: 'Post-demo follow-up, proposal recap, objection handling, decision-maker nudge, contract follow-up',
  },
  basecamp: {
    label: 'Basecamp',
    goal: 'Customer success — nurture, upsell, retain, delight.',
    tones: 'Warm, supportive, proactive. You\'re their partner, not just a vendor.',
    examples: 'Onboarding welcome, check-in, feature announcement, renewal reminder, referral ask',
  },
  fallback: {
    label: 'Fallback',
    goal: 'Re-engagement — win back churned or inactive contacts.',
    tones: 'Humble, curious, no guilt. Lead with new value or changed circumstances.',
    examples: 'Win-back email, "things have changed" update, re-engagement sequence, feedback request',
  },
};

function buildSystemPrompt(stage) {
  const ctx = STAGE_CONTEXT[stage] || STAGE_CONTEXT.scout;

  return `You are Barry, the AI assistant for Idynify — a sales engagement platform. You're helping the user create an email template for the "${ctx.label}" stage of their pipeline.

STAGE CONTEXT:
- Stage: ${ctx.label}
- Goal: ${ctx.goal}
- Tone: ${ctx.tones}
- Common templates: ${ctx.examples}

YOUR JOB:
1. If the user gives a clear description of what they want, generate the template immediately.
2. If the description is vague, ask 1-2 SHORT clarifying questions (max), then generate.
3. When generating a template, ALWAYS return it in this exact JSON format wrapped in <template> tags:

<template>
{
  "name": "Template Name",
  "subject": "Subject line with [placeholders]",
  "body": "Full email body with [FirstName] and other [placeholders]",
  "intent": "cold|warm|hot|followup|thank_you|onboarding"
}
</template>

RULES:
- Use [FirstName], [CompanyName], [Topic], [YourName] as placeholders
- Keep subject lines under 60 characters
- Keep body concise but complete (3-6 short paragraphs max)
- Match the tone to the stage context
- Include a clear CTA appropriate to the stage
- After generating, briefly explain why you structured it that way

INTENT MAPPING:
- Scout stage: usually "cold" or "warm"
- Hunter stage: usually "cold", "warm", or "followup"
- Sniper stage: usually "hot" or "followup"
- Basecamp stage: usually "onboarding", "followup", or "thank_you"
- Fallback stage: usually "warm" or "followup"`;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const startTime = Date.now();

  try {
    const { authToken, userId, stage, message, conversationHistory = [] } = JSON.parse(event.body);

    // Auth verification
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) throw new Error('Firebase API key not configured');

    const authRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: authToken }),
      }
    );
    if (!authRes.ok) throw new Error('Invalid authentication token');
    const authData = await authRes.json();
    if (!authData.users || authData.users[0].localId !== userId) throw new Error('Token/userId mismatch');

    // Build messages for Claude
    const systemPrompt = buildSystemPrompt(stage);
    const messages = [
      ...conversationHistory.map(h => ({
        role: h.role === 'user' ? 'user' : 'assistant',
        content: h.content,
      })),
      { role: 'user', content: message },
    ];

    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1500,
      system: systemPrompt,
      messages,
    });

    const responseText = response.content[0].text;

    // Extract template if present
    let template = null;
    const templateMatch = responseText.match(/<template>\s*([\s\S]*?)\s*<\/template>/);
    if (templateMatch) {
      try {
        template = JSON.parse(templateMatch[1]);
      } catch (e) {
        console.warn('[barryGenerateTemplate] Failed to parse template JSON:', e.message);
      }
    }

    // Clean response text (remove template tags for display)
    const cleanText = responseText
      .replace(/<template>[\s\S]*?<\/template>/g, '')
      .trim();

    const updatedHistory = [
      ...conversationHistory,
      { role: 'user', content: message },
      { role: 'assistant', content: responseText },
    ];

    await logApiUsage(userId, 'barryGenerateTemplate', 'success', {
      responseTime: Date.now() - startTime,
      metadata: { stage },
    }).catch(() => {});

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        response_text: cleanText,
        template,
        updatedHistory,
      }),
    };
  } catch (error) {
    console.error('[barryGenerateTemplate] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
