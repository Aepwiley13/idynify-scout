/**
 * barryBulkPersonalize.js — Phase 1 Workstream A: Barry Bulk Personalization.
 *
 * Accepts up to 25 contacts and a shared email body. Generates one
 * personalized opening line per contact (2-3 sentences, not a full email)
 * via parallel Haiku calls — one Claude call per contact.
 *
 * Receives: { userId, authToken, contacts: [{ contactId, firstName, lastName,
 *             title, company, industry, job_start_date, barryContext }],
 *             sharedBody: string, recon: { section5, section9 },
 *             userContext: { name, company } }
 *
 * Returns: { results: [{ contactId, openingLine, success: true }] }
 *   On per-contact Claude failure: { contactId, openingLine: null, success: false, error }
 *   — a single contact failure never fails the batch.
 *
 * Hard cap: 25 contacts (400 if exceeded).
 * Deliberately does NOT load barry_memory, engagement history, or strategy
 * recommendations — this is bulk generation, not deep single-contact
 * personalization (see Phase 1 brief).
 */

import Anthropic from '@anthropic-ai/sdk';
import { verifyAuthToken } from './utils/verifyAuthToken.js';
import { logApiUsage } from './utils/logApiUsage.js';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_CONTACTS = 25;
const PER_CONTACT_TIMEOUT_MS = 15000;

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

function respond(statusCode, body) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(body) };
}

function clip(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Express job_start_date as "X months in role", or null if unusable. */
export function monthsInRole(jobStartDate) {
  if (!jobStartDate) return null;
  const start = new Date(jobStartDate);
  if (isNaN(start.getTime())) return null;
  const months = Math.floor((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
  if (months < 0) return null;
  if (months === 0) return 'less than 1 month in role';
  return `${months} month${months === 1 ? '' : 's'} in role`;
}

/**
 * RECON sections may arrive as raw dashboard section objects ({ userInput },
 * { data }) or as already-flattened answer objects. Normalize to the answers.
 */
function sectionAnswers(section) {
  if (!section || typeof section !== 'object') return null;
  if (section.userInput && typeof section.userInput === 'object') return section.userInput;
  if (section.data && typeof section.data === 'object') return section.data;
  return section;
}

/** Build the shared RECON intelligence block (section 5 pain, section 9 messaging). */
export function buildReconBlock(recon) {
  const pain = sectionAnswers(recon?.section5);
  const messaging = sectionAnswers(recon?.section9);
  const lines = [];

  if (pain) {
    const painLines = [
      pain.primaryPain ? `- Primary pain your buyers feel: ${clip(pain.primaryPain, 300)}` : null,
      pain.painCost ? `- Cost of that pain: ${clip(pain.painCost, 300)}` : null,
      pain.successLooksLike ? `- What success looks like for them: ${clip(pain.successLooksLike, 300)}` : null,
    ].filter(Boolean);
    if (painLines.length > 0) lines.push('Pain intelligence:', ...painLines);
  }

  if (messaging) {
    const msgLines = [
      messaging.emailTone ? `- Tone: ${clip(messaging.emailTone, 200)}` : null,
      Array.isArray(messaging.keyMessages) && messaging.keyMessages.length > 0
        ? `- Key messages: ${clip(messaging.keyMessages.join(', '), 300)}`
        : null,
    ].filter(Boolean);
    if (msgLines.length > 0) lines.push('Messaging preferences:', ...msgLines);
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/** Build the per-contact prompt. Exported for testing. */
export function buildPrompt(contact, sharedBody, reconBlock, userContext) {
  const firstName = clip(contact.firstName, 100);
  const title = clip(contact.title, 150);
  const company = clip(contact.company, 150);
  const industry = clip(contact.industry, 150);
  const tenure = monthsInRole(contact.job_start_date);
  const personaSummary = clip(contact.barryContext?.personaSummary, 500);

  const hasCriticalFields = Boolean(title || company);

  const contactLines = [
    firstName ? `First name: ${firstName}` : null,
    title ? `Title: ${title}` : null,
    company ? `Company: ${company}` : null,
    industry ? `Industry: ${industry}` : null,
    tenure ? `Tenure: ${tenure}${tenure.startsWith('less') || parseInt(tenure, 10) < 6 ? ' (recently started — a timing signal worth referencing)' : ''}` : null,
    personaSummary ? `Persona: ${personaSummary}` : null,
  ].filter(Boolean);

  const senderLine = [
    clip(userContext?.name, 100) ? `Sender: ${clip(userContext.name, 100)}` : null,
    clip(userContext?.company, 150) ? `Sender's company: ${clip(userContext.company, 150)}` : null,
  ].filter(Boolean).join('\n');

  const specificityRule = hasCriticalFields
    ? 'Reference something specific about this contact — their role, company, industry, or timing signal (e.g. recently started a new role). Pick the strongest single angle; do not cram in every field.'
    : 'Very little is known about this contact. Write a warm, genuine, generic opening line. Do NOT invent details about their role or company — no guessing, no placeholders.';

  return `You are Barry, an expert B2B outreach copywriter. Write ONLY a personalized opening line for an email. It will be placed directly before a shared email body that every recipient receives — it is not a full email.

CONTACT:
${contactLines.length > 0 ? contactLines.join('\n') : 'No details available.'}

${senderLine ? `${senderLine}\n\n` : ''}${reconBlock ? `SENDER'S BUSINESS INTELLIGENCE (for relevance — do not quote verbatim):\n${reconBlock}\n\n` : ''}SHARED EMAIL BODY (every recipient gets this after your opening line — do NOT repeat its content):
"""
${clip(sharedBody, 2000)}
"""

RULES:
1. 2-3 sentences maximum. No subject line. No greeting ("Hi ..."), no sign-off — just the opening line itself.
2. ${specificityRule}
3. Do not repeat or paraphrase anything already in the shared body — your line sets it up.
4. It must read naturally when placed immediately before the shared body.
5. Tone: confident, peer-to-peer, like someone who did their homework. Not salesy, no buzzwords, no flattery-bombing.

Return ONLY the opening line text. No quotes around it, no labels, no explanation.`;
}

/** Normalize model output to a clean opening line. Exported for testing. */
export function cleanOpeningLine(text) {
  if (typeof text !== 'string') return null;
  let line = text.trim();
  // Take only the first paragraph if the model returned more than one
  const paragraphBreak = line.indexOf('\n\n');
  if (paragraphBreak !== -1) line = line.slice(0, paragraphBreak).trim();
  // Strip wrapping quotes
  if ((line.startsWith('"') && line.endsWith('"')) || (line.startsWith('“') && line.endsWith('”'))) {
    line = line.slice(1, -1).trim();
  }
  return line || null;
}

async function generateForContact(anthropic, contact, sharedBody, reconBlock, userContext) {
  const contactId = contact?.contactId ?? null;

  if (!contact || typeof contact !== 'object' || !contactId) {
    return { contactId, openingLine: null, success: false, error: 'Missing contactId' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PER_CONTACT_TIMEOUT_MS);

  try {
    const prompt = buildPrompt(contact, sharedBody, reconBlock, userContext);
    const response = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal }
    );

    const openingLine = cleanOpeningLine(response.content?.[0]?.text);
    if (!openingLine) throw new Error('Model returned an empty opening line');

    return { contactId, openingLine, success: true };
  } catch (err) {
    const error = controller.signal.aborted ? 'Generation timed out' : (err.message || 'Generation failed');
    console.warn(`[barryBulkPersonalize] Contact ${contactId} failed: ${error}`);
    return { contactId, openingLine: null, success: false, error };
  } finally {
    clearTimeout(timeout);
  }
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const startTime = Date.now();
  let userId;

  try {
    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return respond(400, { error: 'Invalid JSON body' });
    }

    userId = body.userId;
    const { authToken, contacts, sharedBody, recon, userContext } = body;

    if (!userId || !authToken) {
      return respond(401, { error: 'Missing required parameters: userId, authToken' });
    }
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return respond(400, { error: 'contacts must be a non-empty array' });
    }
    if (contacts.length > MAX_CONTACTS) {
      return respond(400, { error: `Maximum ${MAX_CONTACTS} contacts per bulk personalization (received ${contacts.length})` });
    }
    if (typeof sharedBody !== 'string' || !sharedBody.trim()) {
      return respond(400, { error: 'sharedBody is required' });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    try {
      await verifyAuthToken(authToken, userId);
    } catch (authErr) {
      return respond(401, { error: authErr.message });
    }

    const reconBlock = buildReconBlock(recon);
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // One Claude call per contact, all in parallel. generateForContact never
    // throws — a single contact's failure must not fail the batch.
    const results = await Promise.all(
      contacts.map((contact) => generateForContact(anthropic, contact, sharedBody, reconBlock, userContext))
    );

    const successCount = results.filter((r) => r.success).length;

    await logApiUsage(userId, 'barryBulkPersonalize', 'success', {
      responseTime: Date.now() - startTime,
      metadata: {
        contactCount: contacts.length,
        successCount,
        failCount: contacts.length - successCount,
        reconUsed: !!reconBlock,
      },
    });

    return respond(200, { results });
  } catch (error) {
    console.error('[barryBulkPersonalize] Error:', error.message);
    try {
      if (userId) {
        await logApiUsage(userId, 'barryBulkPersonalize', 'error', {
          responseTime: Date.now() - startTime,
          errorCode: error.message,
          metadata: {},
        });
      }
    } catch { /* logging must not mask the real error */ }
    return respond(500, { error: error.message });
  }
};
