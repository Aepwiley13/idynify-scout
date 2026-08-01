/**
 * Relationship Context Service — Sprint 2 Team B
 *
 * Upserts the relationship_context document on each inbound message processing.
 * This is the curated context package that Sprint 3 (Barry Intelligence) reads
 * before generating analysis and draft replies.
 *
 * Team B writes the structure. Team Alpha fills the content.
 */

import { FieldValue } from 'firebase-admin/firestore';

const CONTEXT_VERSION = '1.0.0';

/**
 * Upsert the relationship_context document for a contact.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {Object} params
 * @param {string} params.contactId
 * @param {string} params.idynifyUserId
 * @param {string} params.messageRecordId
 * @param {string} params.bodyText
 * @param {string} params.receivedAt
 * @param {import('../../../src/types/conversationState.js').ConversationState} params.conversationState
 * @returns {Promise<string>} The relationship context document ID
 */
export async function upsertRelationshipContext(db, {
  contactId,
  idynifyUserId,
  messageRecordId,
  bodyText,
  receivedAt,
  conversationState,
}) {
  const contextRef = db
    .collection('users').doc(idynifyUserId)
    .collection('contacts').doc(contactId)
    .collection('relationship_context').doc(idynifyUserId);

  const preview = (bodyText || '').slice(0, 200);

  const contextData = {
    contactId,
    idynifyUserId,
    latestInboundSummary: preview,
    latestInboundAt: receivedAt,
    latestInboundRecordId: messageRecordId,
    conversationState,
    sourceMessageIds: FieldValue.arrayUnion(messageRecordId),
    lastUpdatedAt: FieldValue.serverTimestamp(),
    contextVersion: CONTEXT_VERSION,
  };

  const existing = await contextRef.get();

  if (existing.exists) {
    await contextRef.update(contextData);
  } else {
    // First time — initialize all Sprint 3 arrays as empty
    await contextRef.set({
      ...contextData,
      openQuestions: [],
      openCommitments: [],
      objections: [],
      positiveSignals: [],
      informationShared: [],
      recommendedAction: null,
      recommendedActionReason: null,
      suggestedFollowUpDate: null,
      recommendedAt: null,
      fieldSuggestions: [],
      lastAnalyzedAt: null,
      sourceMessageIds: [messageRecordId],
      lastUpdatedAt: FieldValue.serverTimestamp(),
    });
  }

  return contextRef.id;
}
