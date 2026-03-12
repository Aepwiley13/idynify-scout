/**
 * Barry Recon Interview — conversational guidance for RECON section editors.
 *
 * Two modes:
 *   intro  → Barry introduces a section, explains what he'll learn, why it matters
 *   ask    → User asks Barry a freeform question about the section
 *
 * POST /.netlify/functions/barryReconInterview
 */

import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './utils/logApiUsage.js';

// ─── Section context map ───────────────────────────────────────────────────────

const SECTION_CONTEXT = {
  1: {
    label: 'Business Foundation',
    whatBarryLearns: 'your company identity, what you sell, the problem you solve, and your 90-day goal',
    whatBarryCanDo: "generate context that actually references your product instead of generic filler, and prioritize prospects who match your current objective",
    whyItMatters: "Without this, every contact briefing I generate is blind — I'll talk about the industry but not your specific offering.",
    intro: "This is where I get to know your business. Tell me what you do, who you help, and what you're working toward — I'll use this in every interaction I have with your prospects from here on.",
  },
  2: {
    label: 'Product Deep Dive',
    whatBarryLearns: 'your pricing model, go-to-market approach, competitive advantages, and product-market fit',
    whatBarryCanDo: "reference your actual value drivers when scoring leads and tailor conversation openers to the economic case for your product",
    whyItMatters: "Without this, I can speak generally about your space but can't position your product specifically.",
    intro: "Now I want to understand your product at a deeper level — the economics, the advantages, how you go to market. This shapes how I frame your value in every outreach we create.",
  },
  3: {
    label: 'Target Market Firmographics',
    whatBarryLearns: 'which industries, company sizes, geographies, and revenue ranges make up your ideal customer profile',
    whatBarryCanDo: "score leads against your real ICP, filter out companies that don't fit, and focus your energy on the right targets",
    whyItMatters: "Without this, Scout treats all companies equally — no filtering, no scoring, no prioritization.",
    intro: "Let's define who you want to reach. Industry, size, geography, revenue — the firmographics that make a company a real opportunity versus a waste of time.",
  },
  4: {
    label: 'Customer Psychographics',
    whatBarryLearns: 'the values, priorities, buying philosophy, and mindset of your ideal customer',
    whatBarryCanDo: "go beyond job titles to understand what motivates the actual person you're selling to, making conversation starters feel personal rather than templated",
    whyItMatters: "Without this, I know the company profile but not what the person inside it actually cares about.",
    intro: "Same company, different culture — the psychographics of who you target change everything about how we talk to them. Let's map what your ideal customer actually values.",
  },
  5: {
    label: 'Pain Points & Motivations',
    whatBarryLearns: 'the core pain points your customers experience, trigger events that create urgency, and what ultimately drives the purchase decision',
    whatBarryCanDo: "open conversations that land because they speak directly to real pain, and time outreach around trigger events before competitors notice them",
    whyItMatters: "Without this, my conversation starters are interesting but not urgent — they don't create the need to reply.",
    intro: "Pain is what moves people to act. Tell me what's keeping your ideal customer up at night, and I'll start every conversation from that place of real relevance.",
  },
  6: {
    label: 'Buying Behavior & Triggers',
    whatBarryLearns: 'how long buying cycles take, who the key stakeholders are, how decisions actually get made, and where budget authority lives',
    whatBarryCanDo: "sequence outreach to match the real buying cycle, involve the right stakeholders at the right time, and avoid wasting effort on people who can't say yes",
    whyItMatters: "Without this, my sequences assume a simple, linear sale — but most B2B deals don't work that way.",
    intro: "B2B sales aren't a single conversation — they're a process. Walk me through how your customers actually buy, so I can design sequences that match how decisions really get made.",
  },
  7: {
    label: 'Decision Process',
    whatBarryLearns: 'how prospects evaluate options, who holds veto power, what the evaluation criteria are, and what a typical timeline looks like',
    whatBarryCanDo: "recommend outreach angles that align with evaluation criteria, and time follow-ups to match where a prospect is in their decision process",
    whyItMatters: "Without this, I sequence messages without knowing what stage the prospect is in or what's being evaluated.",
    intro: "The moment a prospect enters evaluation mode, the game changes. Tell me how your deals get evaluated — I'll use it to time follow-ups and frame the right conversation at the right moment.",
  },
  8: {
    label: 'Competitive Landscape',
    whatBarryLearns: 'your direct competitors, what alternatives prospects consider, how you differentiate, and where you clearly win or lose',
    whatBarryCanDo: "generate prospect briefings that reference competitive context, and position your outreach in contrast to alternatives without being aggressive",
    whyItMatters: "Without this, I can't help you stand out — every message sounds like it could be from any company in your space.",
    intro: "Your prospects are almost certainly talking to competitors. Tell me the landscape — who you're up against, where you win, where it's close — and I'll help you show up with differentiation, not just features.",
  },
  9: {
    label: 'Messaging & Value Proposition',
    whatBarryLearns: 'your core value proposition, messaging pillars, brand voice, and how you communicate what makes you different',
    whatBarryCanDo: "write in your actual voice, lead with your real value prop, and make every Hunter message sound like it came from your team — not a template",
    whyItMatters: "Without this, I write in a neutral corporate voice. Your brand voice and positioning disappear.",
    intro: "This is where your voice lives. Your value proposition, your messaging pillars, the way you want to show up — share it with me and every message we create will actually sound like you.",
  },
  10: {
    label: 'Behavioral Signals',
    whatBarryLearns: 'buying readiness signals, seasonal timing triggers, intent indicators, and the behaviors that predict a purchase is near',
    whatBarryCanDo: "flag leads who are showing active buying signals, time outreach to hit trigger moments before they go cold, and prioritize your deck by real urgency",
    whyItMatters: "Without this, all leads look equally ready — I can't surface the ones who are actually in motion.",
    intro: "Not all leads are equally ready — some are already in motion and just need the right nudge. Tell me what signals indicate readiness for your market, and I'll start flagging the hot ones.",
  },
};

// ─── Prompt builders ───────────────────────────────────────────────────────────

function buildIntroPrompt(sectionId, existingAnswers) {
  const ctx = SECTION_CONTEXT[sectionId];
  if (!ctx) throw new Error(`Unknown section: ${sectionId}`);

  const hasAnswers = existingAnswers && Object.keys(existingAnswers).filter(k => existingAnswers[k]).length > 0;

  return `You are Barry, an AI sales intelligence engine that helps B2B sales teams. You are now greeting a user who just opened RECON Section ${sectionId}: ${ctx.label}.

Your role: You're their personal AI trainer who will become more useful the more they share with you. You're direct, smart, and conversational — not corporate.

What you'll learn from this section: ${ctx.whatBarryLearns}.
What you'll be able to do with it: ${ctx.whatBarryCanDo}.
${ctx.whyItMatters}

${hasAnswers ? `The user has already started filling in this section. Acknowledge their progress.` : `This is their first time on this section.`}

Write a short, personal intro message from Barry (2-4 sentences max).
- First-person: "I" not "Barry"
- Direct and confident, not sycophantic
- No bullet points or headers
- Tell them exactly what you'll learn and what you'll do with it
- End with one sentence that makes them want to fill this out
- No emojis
- DO NOT say "Great!" or "Awesome!" or use filler praise
- Sound like a knowledgeable colleague, not a chatbot

Respond with ONLY the message text, no JSON wrapper.`;
}

function buildAskPrompt(sectionId, userQuestion, existingAnswers) {
  const ctx = SECTION_CONTEXT[sectionId];
  if (!ctx) throw new Error(`Unknown section: ${sectionId}`);

  const answersContext = existingAnswers && Object.keys(existingAnswers).length > 0
    ? `What the user has shared so far: ${JSON.stringify(existingAnswers, null, 2)}`
    : 'The user has not filled in this section yet.';

  return `You are Barry, an AI sales intelligence engine. A user is filling in RECON Section ${sectionId}: ${ctx.label} and just asked you a question.

Section purpose: ${ctx.whatBarryLearns}
${answersContext}

User's question: "${userQuestion}"

Answer their question helpfully. Be direct and specific.
- 2-5 sentences max
- First-person voice
- If they're asking why a question matters, explain exactly how you'll use that data
- If they're asking what to write, give them a concrete example or framework
- No emojis
- No bullet lists unless absolutely necessary for clarity
- Sound like a smart colleague, not a help center article

Respond with ONLY the answer text, no JSON wrapper.`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  const startTime = Date.now();

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let userId, authToken, sectionId, mode, question, existingAnswers;

  try {
    ({ userId, authToken, sectionId, mode, question, existingAnswers } = JSON.parse(event.body));
    if (!userId || !authToken || !sectionId || !mode) {
      throw new Error('Missing required fields: userId, authToken, sectionId, mode');
    }
    if (mode === 'ask' && !question?.trim()) {
      throw new Error('mode=ask requires a question');
    }
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: err.message }) };
  }

  try {
    // ── Auth verification ────────────────────────────────────────────────────
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) throw new Error('Firebase API key not configured');

    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: authToken }),
      }
    );
    if (!verifyRes.ok) throw new Error('Invalid authentication token');
    const verifyData = await verifyRes.json();
    if (verifyData.users[0].localId !== userId) throw new Error('Token mismatch');

    // ── Claude call ──────────────────────────────────────────────────────────
    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeApiKey) throw new Error('Anthropic API key not configured');

    const prompt = mode === 'intro'
      ? buildIntroPrompt(sectionId, existingAnswers)
      : buildAskPrompt(sectionId, question, existingAnswers);

    const anthropic = new Anthropic({ apiKey: claudeApiKey });
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',  // Fast model for real-time guidance
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const message = response.content[0].text.trim();

    await logApiUsage(userId, 'barryReconInterview', 'success', {
      responseTime: Date.now() - startTime,
      metadata: { sectionId, mode, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message }),
    };

  } catch (err) {
    console.error('[barryReconInterview] error:', err);
    await logApiUsage(userId || 'unknown', 'barryReconInterview', 'error', {
      responseTime: Date.now() - startTime,
      errorCode: err.message,
    }).catch(() => {});

    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
