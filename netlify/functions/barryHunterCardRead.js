/**
 * barryHunterCardRead
 *
 * Generates Barry's one-line "field commander" read for a Hunter card.
 * This is the single sentence on the card front that tells the user
 * what Barry sees and what move he recommends.
 *
 * Barry's voice here: tactical, brief, forward-moving. States situation +
 * recommended move. No hedging. No "I recommend". Uses real contact name.
 *
 * Caching: result is written back to the contact record as:
 *   barry_hunter_read:          string (the sentence)
 *   barry_hunter_read_at:       ISO timestamp
 *   barry_hunter_read_state:    relationship_state at time of generation
 *
 * Regenerate only when relationship_state, strategic_value, or
 * last_interaction has changed since barry_hunter_read_at.
 */

import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './utils/logApiUsage.js';
import { db } from './firebase-admin.js';

export const handler = async (event) => {
  const startTime = Date.now();

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { userId, authToken, contact } = JSON.parse(event.body);

    if (!userId || !authToken || !contact) {
      throw new Error('Missing required parameters: userId, authToken, contact');
    }

    // Validate auth
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    const verifyResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: authToken })
      }
    );

    if (!verifyResponse.ok) throw new Error('Invalid authentication token');
    const verifyData = await verifyResponse.json();
    if (verifyData.users[0].localId !== userId) throw new Error('Token does not match user ID');

    // ── Cache check ─────────────────────────────────────────
    // Return cached read if relationship_state hasn't changed since last generation
    const cachedRead = contact.barry_hunter_read;
    const cachedState = contact.barry_hunter_read_state;
    const currentState = contact.relationship_state;

    if (cachedRead && cachedState && cachedState === currentState) {
      console.log('🐻 Hunter read cache hit for:', contact.name);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true, read: cachedRead, cached: true })
      };
    }

    // ── Build context for the one-liner ────────────────────
    const name = contact.name || contact.first_name || 'this contact';
    const firstName = contact.first_name || name.split(' ')[0];
    const title = contact.title || 'unknown role';
    const company = contact.company_name || 'their company';
    const relationshipState = contact.relationship_state || 'unaware';
    const strategicValue = contact.strategic_value || 'medium';
    const lastInteraction = contact.last_interaction_at
      ? `${Math.round((Date.now() - new Date(contact.last_interaction_at).getTime()) / (1000 * 60 * 60 * 24))} days ago`
      : 'Never';

    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeApiKey) throw new Error('Claude API key not configured');

    const anthropic = new Anthropic({ apiKey: claudeApiKey });

    const prompt = `You are Barry — Hunter module field commander. Your job: write ONE sentence for a Hunter contact card.

CONTACT:
Name: ${name}
First name: ${firstName}
Title: ${title}
Company: ${company}
Relationship state: ${relationshipState}
Strategic value: ${strategicValue}
Last interaction: ${lastInteraction}

RELATIONSHIP STATE DEFINITIONS:
unaware = never been contacted, they don't know the user yet
aware = knows who the user is, no real engagement
engaged = active back-and-forth happening
warm = positive relationship, some trust built
trusted = deep relationship, proven value
advocate = actively referring the user to others
dormant = was warm/trusted, gone quiet
strained = something went wrong
strategic_partner = formal deep partnership

YOUR TASK: Write ONE sentence (field commander voice) that states:
1. The situation — what's the current state of this relationship?
2. The recommended move — what should happen next?

VOICE RULES:
- State facts, don't hedge. Never say "I recommend" or "you should" or "it might be worth".
- Use ${firstName}'s first name or refer to them directly.
- Maximum 15 words. Short sentences are better.
- No corporate language. No fluff.
- Examples of the right voice:
  "Strong fit, never engaged. Time to make contact."
  "Haven't touched this one in 6 weeks. Reconnect before it goes cold."
  "Warm relationship, no active mission. Pick an outcome and move."
  "Dormant partner. Low pressure reconnect would land well here."

RELATIONSHIP STATE → RECOMMENDED MOVE GUIDANCE:
unaware/aware + never interacted → suggest first contact
aware + some history → build rapport, go deeper
engaged → maintain momentum, advance
warm → schedule or deepen
trusted → leverage for intro or referral
dormant → reconnect, soft touch
strained → careful rebuild, acknowledge gap
strategic_partner → advance strategic goals
advocate → ask for referral or case study

Respond with ONLY the one sentence. No quotes. No explanation. Just the sentence.`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 60,
      messages: [{ role: 'user', content: prompt }]
    });

    const read = response.content[0].text.trim().replace(/^["']|["']$/g, '');

    // ── Write back to Firestore (fire-and-forget) ───────────
    if (contact.id) {
      db.collection('users').doc(userId).collection('contacts').doc(contact.id).update({
        barry_hunter_read: read,
        barry_hunter_read_at: new Date().toISOString(),
        barry_hunter_read_state: relationshipState
      }).catch(err => console.warn('⚠️ Could not cache hunter read:', err.message));
    }

    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'barryHunterCardRead', 'success', {
      responseTime,
      metadata: { contactName: name, relationshipState, cached: false }
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, read, cached: false })
    };

  } catch (error) {
    console.error('❌ barryHunterCardRead error:', error);

    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        await logApiUsage(userId, 'barryHunterCardRead', 'error', {
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
