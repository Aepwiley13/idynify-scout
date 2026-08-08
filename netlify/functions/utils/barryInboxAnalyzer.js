/**
 * Barry Inbox Analyzer — Sprint 3 Team B
 *
 * Reads a barry_processing_queue entry and produces a structured
 * ConversationAnalysis object. Fetches communication_record,
 * relationship_context, and recent timeline events, then calls
 * the Anthropic API with a curated context package.
 *
 * Downstream: process-barry-inbox-queue writes the result to
 * contacts/{contactId}/barry_analysis/{messageRecordId}.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createMessageWithRetry } from './anthropicRetry.js';
import { MODEL_DEEP } from './models.js';

const MODEL = MODEL_DEEP;
const MAX_TOKENS = 1500;

/**
 * @typedef {Object} ConversationAnalysis
 * @property {string} summary
 * @property {"information"|"scheduling"|"objection"|"positive"|"acknowledgment"|"unknown"} intent
 * @property {"positive"|"neutral"|"negative"|"mixed"} sentiment
 * @property {string[]} questionsAsked
 * @property {string[]} requestsMade
 * @property {string[]} commitmentsMade
 * @property {string[]} objections
 * @property {string[]} positiveSignals
 * @property {"high"|"medium"|"low"} urgency
 * @property {boolean} responseRequired
 * @property {"reply_now"|"schedule_meeting"|"send_resource"|"follow_up_later"|"no_action"} recommendedAction
 * @property {string} recommendedActionReason
 * @property {string|null} suggestedFollowUpDate
 * @property {"high"|"medium"|"low"} confidence
 * @property {string} sourceMessageId
 */

/**
 * Analyze an inbound message and return a structured ConversationAnalysis.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {Object} queueEntry
 * @param {string} queueEntry.messageRecordId
 * @param {string} queueEntry.contactId
 * @param {string} queueEntry.idynifyUserId
 * @returns {Promise<ConversationAnalysis>}
 */
export async function analyzeInboundMessage(db, { messageRecordId, contactId, idynifyUserId }) {
  // ── Fetch communication record ───────────────────────────────────────────
  const commSnap = await db.collection('communication_records').doc(messageRecordId).get();
  if (!commSnap.exists) {
    throw new Error(`Communication record ${messageRecordId} not found`);
  }
  const commRecord = commSnap.data();

  // ── Fetch contact document ───────────────────────────────────────────────
  const contactSnap = await db
    .collection('users').doc(idynifyUserId)
    .collection('contacts').doc(contactId)
    .get();
  const contact = contactSnap.exists ? contactSnap.data() : {};

  // ── Fetch relationship context ───────────────────────────────────────────
  const contextSnap = await db
    .collection('users').doc(idynifyUserId)
    .collection('contacts').doc(contactId)
    .collection('relationship_context').doc(idynifyUserId)
    .get();
  const relationshipContext = contextSnap.exists ? contextSnap.data() : {};

  // ── Fetch last 5 timeline events for conversation history ────────────────
  const timelineSnap = await db
    .collection('users').doc(idynifyUserId)
    .collection('contacts').doc(contactId)
    .collection('timeline')
    .orderBy('createdAt', 'desc')
    .limit(5)
    .get();
  const recentTimeline = timelineSnap.docs.map(d => d.data());

  // ── Build the Anthropic prompt ───────────────────────────────────────────
  const prompt = buildAnalysisPrompt(commRecord, contact, relationshipContext, recentTimeline);

  const claudeApiKey = process.env.ANTHROPIC_API_KEY;
  if (!claudeApiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const anthropic = new Anthropic({ apiKey: claudeApiKey });

  const response = await createMessageWithRetry(anthropic, {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawText = response.content[0].text;
  const analysis = parseAnalysisResponse(rawText, commRecord.gmailMessageId);

  return analysis;
}

function buildAnalysisPrompt(commRecord, contact, relationshipContext, recentTimeline) {
  const contactName = contact.name || commRecord.fromName || commRecord.fromEmail;
  const contactTitle = contact.title || 'unknown';
  const contactCompany = contact.company_name || contact.current_company_name || 'unknown';
  const conversationState = relationshipContext.conversationState || contact.conversationState || 'unknown';

  const timelineBlock = recentTimeline.map(evt => {
    const dir = evt.direction === 'inbound' ? 'THEM' : 'US';
    const date = evt.receivedAt || evt.timestamp || '';
    return `[${dir}] ${date} — ${evt.subject || ''}: ${evt.preview || ''}`;
  }).join('\n') || 'No prior timeline events.';

  const priorContext = [];
  if (relationshipContext.openQuestions?.length) {
    priorContext.push(`Open questions from earlier: ${relationshipContext.openQuestions.join('; ')}`);
  }
  if (relationshipContext.openCommitments?.length) {
    priorContext.push(`Open commitments: ${relationshipContext.openCommitments.join('; ')}`);
  }
  if (relationshipContext.objections?.length) {
    priorContext.push(`Prior objections: ${relationshipContext.objections.join('; ')}`);
  }

  return `You are an expert sales intelligence analyst. Analyze the following inbound email and return a structured JSON analysis.

CONTACT:
Name: ${contactName}
Title: ${contactTitle}
Company: ${contactCompany}
Current conversation state: ${conversationState}

RECENT CONVERSATION HISTORY (most recent first):
${timelineBlock}

${priorContext.length ? 'PRIOR CONTEXT:\n' + priorContext.join('\n') : ''}

INBOUND EMAIL TO ANALYZE:
From: ${commRecord.fromName || commRecord.fromEmail} <${commRecord.fromEmail}>
Subject: ${commRecord.subject}
Date: ${commRecord.receivedAt}

Body:
${commRecord.bodyText}

${commRecord.quotedReplyText ? `Quoted reply context:\n${commRecord.quotedReplyText}` : ''}

Respond with ONLY a valid JSON object (no markdown fences, no explanation) with these exact fields:

{
  "summary": "1-2 sentence plain English summary of what the contact said",
  "intent": "information | scheduling | objection | positive | acknowledgment | unknown",
  "sentiment": "positive | neutral | negative | mixed",
  "questionsAsked": ["verbatim or close-paraphrase questions from the email"],
  "requestsMade": ["specific asks or requests"],
  "commitmentsMade": ["things they committed to doing"],
  "objections": ["stated concerns, hesitations, or pushback"],
  "positiveSignals": ["interest, enthusiasm, or buying intent signals"],
  "urgency": "high | medium | low",
  "responseRequired": true or false,
  "recommendedAction": "reply_now | schedule_meeting | send_resource | follow_up_later | no_action",
  "recommendedActionReason": "one sentence explaining why this action",
  "suggestedFollowUpDate": "ISO 8601 date or null",
  "confidence": "high | medium | low"
}

Rules:
- Extract questions VERBATIM or as close paraphrases, not summaries.
- Empty arrays are fine if no items found — never null.
- suggestedFollowUpDate: set a concrete date if follow_up_later, otherwise null.
- A brief "thanks" or "got it" with no questions = acknowledgment intent, no_action, responseRequired false.
- If they ask to schedule a meeting = scheduling intent, schedule_meeting action.
- If they raise price/value concerns = objection intent.`;
}

function parseAnalysisResponse(rawText, gmailMessageId) {
  let parsed;
  try {
    const jsonStart = rawText.indexOf('{');
    const jsonEnd = rawText.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON found');
    parsed = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1));
  } catch (err) {
    throw new Error(`Failed to parse analysis response: ${err.message}. Raw: ${rawText.slice(0, 200)}`);
  }

  const VALID_INTENTS = ['information', 'scheduling', 'objection', 'positive', 'acknowledgment', 'unknown'];
  const VALID_SENTIMENTS = ['positive', 'neutral', 'negative', 'mixed'];
  const VALID_URGENCIES = ['high', 'medium', 'low'];
  const VALID_ACTIONS = ['reply_now', 'schedule_meeting', 'send_resource', 'follow_up_later', 'no_action'];
  const VALID_CONFIDENCE = ['high', 'medium', 'low'];

  return {
    summary: String(parsed.summary || ''),
    intent: VALID_INTENTS.includes(parsed.intent) ? parsed.intent : 'unknown',
    sentiment: VALID_SENTIMENTS.includes(parsed.sentiment) ? parsed.sentiment : 'neutral',
    questionsAsked: Array.isArray(parsed.questionsAsked) ? parsed.questionsAsked.map(String) : [],
    requestsMade: Array.isArray(parsed.requestsMade) ? parsed.requestsMade.map(String) : [],
    commitmentsMade: Array.isArray(parsed.commitmentsMade) ? parsed.commitmentsMade.map(String) : [],
    objections: Array.isArray(parsed.objections) ? parsed.objections.map(String) : [],
    positiveSignals: Array.isArray(parsed.positiveSignals) ? parsed.positiveSignals.map(String) : [],
    urgency: VALID_URGENCIES.includes(parsed.urgency) ? parsed.urgency : 'medium',
    responseRequired: parsed.responseRequired === true,
    recommendedAction: VALID_ACTIONS.includes(parsed.recommendedAction) ? parsed.recommendedAction : 'reply_now',
    recommendedActionReason: String(parsed.recommendedActionReason || ''),
    suggestedFollowUpDate: parsed.suggestedFollowUpDate || null,
    confidence: VALID_CONFIDENCE.includes(parsed.confidence) ? parsed.confidence : 'medium',
    sourceMessageId: gmailMessageId,
  };
}
