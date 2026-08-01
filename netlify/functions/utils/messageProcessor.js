/**
 * processNormalizedMessage() — Sprint 2 Team B Master Pipeline
 *
 * Single entry point for all inbound message processing.
 * Team A calls this. The /barry/test-message endpoint calls it with mocked data.
 *
 * Pipeline steps (sequential — each must complete before the next):
 *   1. Duplicate check
 *   2. Contact matching waterfall
 *   3. Persist communication record
 *   4. Write timeline event (only if HIGH or MEDIUM confidence match)
 *   5. Update conversation state
 *   6. Update relationship context
 *   7. Emit processing-complete signal to barry_processing_queue
 */

import { FieldValue } from 'firebase-admin/firestore';
import { createProcessingResult } from '../../../src/types/processingResult.js';
import { validateNormalizedMessage } from '../../../src/types/normalizedMessage.js';
import { MATCH_CONFIDENCE } from '../../../src/types/contactMatchResult.js';
import { resolveInboundTransition } from '../../../src/types/conversationState.js';
import { matchContact } from './contactMatcher.js';
import { upsertRelationshipContext } from './relationshipContext.js';

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {import('../../../src/types/normalizedMessage.js').NormalizedMessage} message
 * @returns {Promise<import('../../../src/types/processingResult.js').ProcessingResult>}
 */
export async function processNormalizedMessage(db, message) {
  const startMs = Date.now();

  // ── Validate input ─────────────────────────────────────────────────────────
  const validation = validateNormalizedMessage(message);
  if (!validation.valid) {
    return createProcessingResult({
      error: `Validation failed: ${validation.errors.join('; ')}`,
      processingMs: Date.now() - startMs,
    });
  }

  try {
    // ── Step 1: Duplicate check ────────────────────────────────────────────
    const existingSnap = await db
      .collection('communication_records')
      .where('gmailMessageId', '==', message.gmailMessageId)
      .where('idynifyUserId', '==', message.idynifyUserId)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      const existingDoc = existingSnap.docs[0];
      const existingData = existingDoc.data();
      return createProcessingResult({
        success: true,
        messageRecordId: existingDoc.id,
        timelineEventId: existingData.timelineEventId || null,
        contactMatchResult: {
          contactId: existingData.contactId,
          matchMethod: existingData.matchMethod,
          matchConfidence: existingData.matchConfidence,
          matchedAutomatically: existingData.matchedAutomatically,
          requiresReview: existingData.requiresReview,
        },
        conversationState: existingData.conversationState || null,
        processingMs: Date.now() - startMs,
      });
    }

    // ── Step 2: Contact matching waterfall ──────────────────────────────────
    const contactMatch = await matchContact(db, message);

    // If match requires review and confidence is LOW or NONE, queue and halt
    const shouldHalt =
      contactMatch.requiresReview &&
      (contactMatch.matchConfidence === MATCH_CONFIDENCE.LOW ||
       contactMatch.matchConfidence === MATCH_CONFIDENCE.NONE);

    // ── Step 3: Persist communication record ───────────────────────────────
    const commRecord = {
      idynifyUserId: message.idynifyUserId,
      gmailAccountId: message.gmailAccountId,
      gmailMessageId: message.gmailMessageId,
      gmailThreadId: message.gmailThreadId,
      contactId: contactMatch.contactId,
      companyId: contactMatch.companyId,
      matchMethod: contactMatch.matchMethod,
      matchConfidence: contactMatch.matchConfidence,
      matchedAutomatically: contactMatch.matchedAutomatically,
      direction: message.direction,
      category: message.category,
      fromEmail: message.fromEmail.toLowerCase().trim(),
      fromName: message.fromName,
      toEmails: message.toEmails,
      ccEmails: message.ccEmails,
      subject: message.subject,
      receivedAt: message.receivedAt,
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml,
      quotedReplyText: message.quotedReplyText,
      signature: message.signature,
      attachments: message.attachments || [],
      processingStatus: shouldHalt ? 'received' : 'matched',
      requiresReview: contactMatch.requiresReview,
      intelligenceStatus: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ingestionVersion: message.ingestionVersion,
    };

    const commRef = await db.collection('communication_records').add(commRecord);
    const messageRecordId = commRef.id;

    // If unmatched or low confidence — add to unmatched queue and return
    if (shouldHalt) {
      await writeUnmatchedEntry(db, message, messageRecordId, contactMatch);

      return createProcessingResult({
        success: true,
        messageRecordId,
        contactMatchResult: contactMatch,
        requiresReview: true,
        reviewReason: contactMatch.reviewReason,
        processingMs: Date.now() - startMs,
      });
    }

    const contactId = contactMatch.contactId;
    let timelineEventId = null;
    let conversationState = null;
    let relationshipContextId = null;

    // ── Step 4: Write timeline event (HIGH or MEDIUM confidence only) ──────
    if (
      contactId &&
      (contactMatch.matchConfidence === MATCH_CONFIDENCE.HIGH ||
       contactMatch.matchConfidence === MATCH_CONFIDENCE.MEDIUM)
    ) {
      // Dedup check — prevent duplicate timeline events
      const existingTimelineSnap = await db
        .collection('users').doc(message.idynifyUserId)
        .collection('contacts').doc(contactId)
        .collection('timeline')
        .where('messageRecordId', '==', messageRecordId)
        .limit(1)
        .get();

      if (existingTimelineSnap.empty) {
        const preview = (message.bodyText || '').slice(0, 200);
        const timelineEvent = {
          eventType: 'message_received',
          contactId,
          messageRecordId,
          gmailThreadId: message.gmailThreadId,
          direction: 'inbound',
          subject: message.subject,
          preview,
          fromEmail: message.fromEmail.toLowerCase().trim(),
          receivedAt: message.receivedAt,
          intelligenceStatus: 'pending',
          actionRequired: message.category !== 'automated',
          createdAt: FieldValue.serverTimestamp(),
        };

        const timelineRef = await db
          .collection('users').doc(message.idynifyUserId)
          .collection('contacts').doc(contactId)
          .collection('timeline')
          .add(timelineEvent);

        timelineEventId = timelineRef.id;
      } else {
        timelineEventId = existingTimelineSnap.docs[0].id;
      }

      // ── Step 5: Update conversation state ──────────────────────────────
      const contactDoc = await db
        .collection('users').doc(message.idynifyUserId)
        .collection('contacts').doc(contactId)
        .get();

      const currentState = contactDoc.exists
        ? contactDoc.data().conversationState || null
        : null;

      const transition = resolveInboundTransition(currentState, message);
      conversationState = transition.newState;

      // Only update state if it's not an automated message that should be no-op
      if (message.category !== 'automated' || !currentState) {
        const contactUpdate = {
          conversationState,
          lastInboundAt: message.receivedAt,
          lastInboundSubject: message.subject,
          replyCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        };

        await db
          .collection('users').doc(message.idynifyUserId)
          .collection('contacts').doc(contactId)
          .update(contactUpdate);
      }

      // ── Step 6: Update relationship context ────────────────────────────
      relationshipContextId = await upsertRelationshipContext(db, {
        contactId,
        idynifyUserId: message.idynifyUserId,
        messageRecordId,
        bodyText: message.bodyText,
        receivedAt: message.receivedAt,
        conversationState,
      });

      // Update communication record with timeline ref and state
      await commRef.update({
        timelineEventId,
        conversationState,
        processingStatus: 'matched',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // ── Step 7: Emit processing-complete signal ────────────────────────────
    // Check for existing queue entry to prevent duplicates
    const existingQueueSnap = await db
      .collection('barry_processing_queue')
      .where('messageRecordId', '==', messageRecordId)
      .limit(1)
      .get();

    if (existingQueueSnap.empty) {
      await db.collection('barry_processing_queue').add({
        messageRecordId,
        contactId: contactId || null,
        idynifyUserId: message.idynifyUserId,
        readyForIntelligence: true,
        queuedAt: FieldValue.serverTimestamp(),
        status: 'pending',
        sprintVersion: 'sprint2',
      });
    }

    return createProcessingResult({
      success: true,
      messageRecordId,
      timelineEventId,
      contactMatchResult: contactMatch,
      conversationState,
      relationshipContextId,
      requiresReview: contactMatch.requiresReview,
      reviewReason: contactMatch.requiresReview ? contactMatch.reviewReason : null,
      processingMs: Date.now() - startMs,
    });

  } catch (error) {
    console.error('[processNormalizedMessage] Pipeline error:', error);
    return createProcessingResult({
      error: error.message,
      processingMs: Date.now() - startMs,
    });
  }
}

async function writeUnmatchedEntry(db, message, messageRecordId, contactMatch) {
  // Dedup check
  const existingSnap = await db
    .collection('unmatched_messages')
    .where('messageRecordId', '==', messageRecordId)
    .where('idynifyUserId', '==', message.idynifyUserId)
    .limit(1)
    .get();

  if (!existingSnap.empty) return;

  await db.collection('unmatched_messages').add({
    idynifyUserId: message.idynifyUserId,
    messageRecordId,
    fromEmail: message.fromEmail.toLowerCase().trim(),
    fromName: message.fromName,
    subject: message.subject,
    receivedAt: message.receivedAt,
    candidateContactIds: contactMatch.candidateContactIds || [],
    reviewStatus: 'pending',
    assignedContactId: null,
    createdAt: FieldValue.serverTimestamp(),
  });
}
