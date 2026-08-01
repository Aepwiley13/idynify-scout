/**
 * Barry Draft Composer — Sprint 3 Team B
 *
 * Takes a ConversationAnalysis and produces a DraftReply object.
 * Pulls the last outbound message from communication_records to
 * calibrate tone — never invents a tone.
 *
 * Barry never sends automatically. draftStatus is always "pending_review".
 */

import Anthropic from '@anthropic-ai/sdk';
import { createMessageWithRetry } from './anthropicRetry.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2000;

/**
 * @typedef {Object} DraftReply
 * @property {string} recipientEmail
 * @property {string} gmailThreadId
 * @property {string|null} subject
 * @property {string} bodyText
 * @property {string} intendedOutcome
 * @property {"high"|"medium"|"low"} confidence
 * @property {"pending_review"} draftStatus
 * @property {"awaiting_user"} approvalStatus
 */

/**
 * Compose a draft reply based on the conversation analysis.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {Object} params
 * @param {import('./barryInboxAnalyzer.js').ConversationAnalysis} params.analysis
 * @param {string} params.messageRecordId
 * @param {string} params.contactId
 * @param {string} params.idynifyUserId
 * @returns {Promise<DraftReply>}
 */
export async function composeDraftReply(db, { analysis, messageRecordId, contactId, idynifyUserId }) {
  // ── Fetch the communication record for this message ──────────────────────
  const commSnap = await db.collection('communication_records').doc(messageRecordId).get();
  if (!commSnap.exists) throw new Error(`Communication record ${messageRecordId} not found`);
  const commRecord = commSnap.data();

  // ── Fetch contact for name ───────────────────────────────────────────────
  const contactSnap = await db
    .collection('users').doc(idynifyUserId)
    .collection('contacts').doc(contactId)
    .get();
  const contact = contactSnap.exists ? contactSnap.data() : {};

  // ── Fetch last outbound message for tone calibration ─────────────────────
  const outboundSnap = await db
    .collection('communication_records')
    .where('idynifyUserId', '==', idynifyUserId)
    .where('contactId', '==', contactId)
    .where('direction', '==', 'outbound')
    .orderBy('receivedAt', 'desc')
    .limit(1)
    .get();

  let toneReference = '';
  if (!outboundSnap.empty) {
    const lastOutbound = outboundSnap.docs[0].data();
    toneReference = lastOutbound.bodyText || '';
  }

  // ── Fetch user profile for signature/name ────────────────────────────────
  const userSnap = await db.collection('users').doc(idynifyUserId).get();
  const userProfile = userSnap.exists ? userSnap.data() : {};
  const userName = userProfile.displayName || userProfile.name || userProfile.email || '';

  // ── Build the prompt ─────────────────────────────────────────────────────
  const prompt = buildDraftPrompt(analysis, commRecord, contact, toneReference, userName);

  const claudeApiKey = process.env.ANTHROPIC_API_KEY;
  if (!claudeApiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const anthropic = new Anthropic({ apiKey: claudeApiKey });

  const response = await createMessageWithRetry(anthropic, {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawText = response.content[0].text;
  const draft = parseDraftResponse(rawText, commRecord);

  return draft;
}

function buildDraftPrompt(analysis, commRecord, contact, toneReference, userName) {
  const contactName = contact.name || commRecord.fromName || commRecord.fromEmail.split('@')[0];
  const firstName = contactName.split(' ')[0];

  const toneBlock = toneReference
    ? `TONE REFERENCE (match this writing style — this is from the user's last outbound to this contact):\n"""\n${toneReference.slice(0, 1000)}\n"""`
    : 'No prior outbound message found. Use a professional but approachable tone.';

  return `You are writing a reply email on behalf of a sales professional. Compose a reply to the inbound email analyzed below.

CONTACT:
Name: ${contactName} (use "${firstName}" in the greeting)
Email: ${commRecord.fromEmail}

THEIR MESSAGE:
Subject: ${commRecord.subject}
Body: ${commRecord.bodyText}

ANALYSIS OF THEIR MESSAGE:
Summary: ${analysis.summary}
Intent: ${analysis.intent}
Sentiment: ${analysis.sentiment}
Questions asked: ${analysis.questionsAsked.length ? analysis.questionsAsked.join('; ') : 'None'}
Requests made: ${analysis.requestsMade.length ? analysis.requestsMade.join('; ') : 'None'}
Objections: ${analysis.objections.length ? analysis.objections.join('; ') : 'None'}
Positive signals: ${analysis.positiveSignals.length ? analysis.positiveSignals.join('; ') : 'None'}
Recommended action: ${analysis.recommendedAction} — ${analysis.recommendedActionReason}

${toneBlock}

SENDER NAME: ${userName || 'the user'}

RULES:
- Address each question they asked directly. Do not ignore questions.
- If they raised objections, acknowledge and address them without being defensive.
- If they want to schedule, propose 2-3 specific time windows.
- Match the tone and formality of the TONE REFERENCE above.
- Keep it concise — respect their time.
- Do not use fake data, placeholder links, or made-up statistics.
- Sign off with just the sender's first name.
- Do NOT include a subject line — this is a thread reply.

Respond with ONLY a valid JSON object (no markdown fences):

{
  "bodyText": "the full reply email as plain text",
  "intendedOutcome": "one sentence describing what this reply is designed to accomplish"
}`;
}

function parseDraftResponse(rawText, commRecord) {
  let parsed;
  try {
    const jsonStart = rawText.indexOf('{');
    const jsonEnd = rawText.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON found');
    parsed = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1));
  } catch (err) {
    throw new Error(`Failed to parse draft response: ${err.message}. Raw: ${rawText.slice(0, 200)}`);
  }

  return {
    recipientEmail: commRecord.fromEmail,
    gmailThreadId: commRecord.gmailThreadId,
    subject: null,
    bodyText: String(parsed.bodyText || ''),
    intendedOutcome: String(parsed.intendedOutcome || ''),
    confidence: 'medium',
    draftStatus: 'pending_review',
    approvalStatus: 'awaiting_user',
  };
}
