/**
 * Barry RECON Section 0 — User Profile Coaching Conversation.
 *
 * Section 0 is the foundation conversation Barry has before building the ICP.
 * Barry learns who the user is: identity, communication style, sales background,
 * quantitative targets, and qualitative goals.
 *
 * Two modes:
 *   start    → Barry opens Section 0 for the first time (or resumes)
 *   message  → User sends a message in the ongoing coaching conversation
 *
 * Barry saves structured profile fields to Firestore silently after each
 * confirmed answer. The full profile lives at:
 *   users/{userId}/reconProfile/section0
 *
 * POST /.netlify/functions/barryReconSection0
 */

import Anthropic from '@anthropic-ai/sdk';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logApiUsage } from './utils/logApiUsage.js';

// Firebase Admin init
if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID || 'idynify-scout-dev',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}
const db = getFirestore();

// ─── System prompt ─────────────────────────────────────────────────────────────

const SECTION0_SYSTEM = `You are Barry, the AI intelligence engine inside Idynify — a B2B acquisition platform.

You are running RECON Section 0: the User Profile conversation. This is the most important conversation in the platform. Before you can help with ICP, targeting, or outreach, you need to know who you are working with.

Your goal in this conversation:
1. Learn the user's identity (first name, how they sign emails, company, role, LinkedIn URL)
2. Understand their communication style (direct vs. warm, short vs. detailed, a cold email example)
3. Understand their sales background (years in sales, industries, current tools and workflow)
4. Lock in quantitative targets (meetings/week goal, pipeline value, 90-day revenue target, deal size, close rate target)
5. Understand qualitative goals (what winning looks like in words, biggest current blocker, what "fixed" feels like)

Rules:
- Ask ONE question at a time — never dump multiple questions
- Paraphrase what they said back before moving on: "So you're targeting $2M pipeline in 90 days — got it."
- Push back gently on vague answers: "You said 'a few meetings' — can we put a number on that? I need specifics to tell you if we're winning."
- After you have all five categories covered, produce a brief inline summary for the user to confirm
- When summarizing, use the format: "Here's what I have on you so far — confirm or tell me what's off:"
- Key line to use when locking targets: "I want to lock in your targets now so I can actually tell you if we're winning together. What does 90 days from now look like if this works?"
- First person: "I" not "Barry"
- No emojis. No "Great!" or "Awesome!" or filler praise.
- Direct and confident — like a seasoned sales coach, not a chatbot.
- When all categories are captured, include in your response a JSON block wrapped in <profile_update>...</profile_update> tags with the structured fields.

Structured profile fields to extract and return when ready:
{
  "firstName": string,
  "emailSignature": string,
  "company": string,
  "role": string,
  "linkedinUrl": string,
  "communicationStyle": "direct" | "warm",
  "messageLength": "short" | "detailed",
  "salesYears": number,
  "industries": string[],
  "currentTools": string[],
  "meetingsPerWeekTarget": number,
  "pipelineValueTarget": number,
  "revenueTarget90Day": number,
  "avgDealSize": number,
  "closeRateTarget": number,
  "qualitativeGoal": string,
  "biggestBlocker": string,
  "whatFixedLooksLike": string
}

Only include fields you have confirmed. Do not include fields you're still gathering.`;

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function verifyAuth(userId, authToken) {
  const firebaseApiKey = process.env.FIREBASE_API_KEY;
  if (!firebaseApiKey) throw new Error('Firebase API key not configured');
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
  if (data.users[0].localId !== userId) throw new Error('Token mismatch');
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  const startTime = Date.now();

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let userId, authToken, mode, message, conversationHistory;
  try {
    ({ userId, authToken, mode, message, conversationHistory = [] } = JSON.parse(event.body));
    if (!userId || !authToken || !mode) throw new Error('Missing required fields: userId, authToken, mode');
    if (mode === 'message' && !message?.trim()) throw new Error('mode=message requires a message');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: err.message }) };
  }

  try {
    await verifyAuth(userId, authToken);

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    let messages;
    if (mode === 'start') {
      // Load any prior Section 0 data to give Barry context
      let existingProfile = {};
      try {
        const snap = await db.collection('users').doc(userId).collection('reconProfile').doc('section0').get();
        if (snap.exists) existingProfile = snap.data();
      } catch (_) {}

      const hasProfile = Object.keys(existingProfile).length > 0;
      const openingInstruction = hasProfile
        ? `The user already has a partial Section 0 profile: ${JSON.stringify(existingProfile)}. Greet them, acknowledge what you know, and continue from where you left off. Ask for the next missing piece.`
        : `This is the user's first time in Section 0. Open with a short, direct intro (2-3 sentences) that explains what Section 0 is about and why it matters — then ask your first question (start with their name and how they sign their emails).`;

      messages = [{ role: 'user', content: openingInstruction }];
    } else {
      // Ongoing conversation
      messages = [
        ...conversationHistory,
        { role: 'user', content: message },
      ];
    }

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: SECTION0_SYSTEM,
      messages,
    });

    const rawText = response.content[0].text.trim();

    // Extract and save any structured profile update
    let profileUpdate = null;
    const profileMatch = rawText.match(/<profile_update>([\s\S]*?)<\/profile_update>/);
    if (profileMatch) {
      try {
        profileUpdate = JSON.parse(profileMatch[1].trim());
        await db.collection('users').doc(userId).collection('reconProfile').doc('section0').set(
          { ...profileUpdate, updatedAt: new Date() },
          { merge: true }
        );
      } catch (_) { /* non-fatal */ }
    }

    // Strip the profile_update tag from the display text
    const displayText = rawText.replace(/<profile_update>[\s\S]*?<\/profile_update>/g, '').trim();

    const newHistory = [
      ...messages,
      { role: 'assistant', content: rawText },
    ];

    // Determine if section 0 is complete
    const sectionComplete = profileUpdate && [
      'firstName', 'meetingsPerWeekTarget', 'revenueTarget90Day', 'qualitativeGoal'
    ].every(f => profileUpdate[f] !== undefined);

    await logApiUsage(userId, 'barryReconSection0', 'success', {
      responseTime: Date.now() - startTime,
      metadata: { mode, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: displayText,
        profileUpdate,
        sectionComplete,
        updatedHistory: newHistory,
      }),
    };

  } catch (err) {
    console.error('[barryReconSection0] error:', err);
    await logApiUsage(userId || 'unknown', 'barryReconSection0', 'error', {
      responseTime: Date.now() - startTime,
      errorCode: err.message,
    }).catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
