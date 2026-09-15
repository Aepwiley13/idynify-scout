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
import { createAdminAdapter } from './contactResolver.js';
import {
  resolveContactCore,
  RESOLUTION,
  IdentityConflictError,
} from '../../../src/utils/identityResolution.js';
import { recordInboundEvent } from './relationshipEventWriter.js';
import { getConversationState } from '../../../src/utils/relationshipRead.js';
import { upsertRelationshipContext } from './relationshipContext.js';

/**
 * Resolve the sender through the canonical identity engine (ADR-002).
 *
 * Returns the legacy match shape so `communication_records` keeps its existing
 * columns and every downstream reader is unaffected — the engine changes how
 * the answer is reached, not what the record looks like.
 *
 * ─── ON CATCHING IdentityConflictError ──────────────────────────────────────
 *
 * The engine throws when one authoritative identifier maps to two contacts. It
 * is caught here and mapped to REVIEW, and that is NOT a weakening of the
 * fail-closed contract. Fail-closed means the engine refuses to guess which
 * person it is — and it still does; nothing is matched, nothing is merged, the
 * message halts in `unmatched_messages` awaiting Sign-Off D. What is avoided is
 * only the *crash*: a data condition with a defined outcome should not take
 * down the ingestion batch and hold the Gmail cursor behind it.
 *
 * Firestore errors from `findByField` are deliberately NOT caught. Those must
 * still propagate, because "the database was unreachable" must never read as
 * "no duplicate". They remain able to wedge the cursor, which is exactly the
 * pre-live blocker Gate 3 owns.
 */
async function resolveIdentity(db, message) {
  const candidate = {
    email: message.fromEmail,
    name: message.fromName || null,
  };

  try {
    const resolution = await resolveContactCore(
      createAdminAdapter(db, message.idynifyUserId),
      candidate,
      { source: 'gmail_ingest' }
    );

    if (resolution.outcome === RESOLUTION.MATCHED) {
      return {
        contactId: resolution.contactId,
        companyId: resolution.existing?.company_id || resolution.existing?.companyId || null,
        matchMethod: resolution.signal,
        matchConfidence: MATCH_CONFIDENCE.HIGH,
        matchedAutomatically: true,
        requiresReview: false,
        candidateContactIds: [],
        identity: { signal: resolution.signal, outcome: resolution.outcome },
      };
    }

    // REVIEW (weak name+company) and NEW (nothing matched) both stop short of
    // relationship truth. LOW vs NONE preserves the existing halt semantics.
    return {
      contactId: null,
      companyId: null,
      matchMethod: resolution.signal || 'unmatched',
      matchConfidence: resolution.outcome === RESOLUTION.REVIEW
        ? MATCH_CONFIDENCE.LOW
        : MATCH_CONFIDENCE.NONE,
      matchedAutomatically: false,
      requiresReview: true,
      reviewReason: resolution.outcome === RESOLUTION.REVIEW
        ? 'Weak name/company match — identity not established'
        : 'No matching contact found',
      candidateContactIds: (resolution.candidates || []).map(c => c.id),
      identity: { signal: resolution.signal, outcome: resolution.outcome },
    };
  } catch (err) {
    if (err instanceof IdentityConflictError) {
      return {
        contactId: null,
        companyId: null,
        matchMethod: 'identity_conflict',
        matchConfidence: MATCH_CONFIDENCE.NONE,
        matchedAutomatically: false,
        requiresReview: true,
        reviewReason: err.message,
        candidateContactIds: err.contactIds || [],
        identity: { signal: err.signal, outcome: 'conflict' },
      };
    }
    throw err;
  }
}

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
        // Echoing back what the duplicate record already stored; read via the
        // canonical accessor so the boundary holds even on this path.
        conversationState: getConversationState(existingData),
        processingMs: Date.now() - startMs,
      });
    }

    // ── Step 2: Contact identity, via the ONE canonical engine ──────────────
    // ADR-002 (Sign-Off A, D1/D2). This used to call matchContact(), a second
    // resolver that queried `primaryEmail` — a field zero production contacts
    // carry. It matched 0 of 978 ingested messages. The engine below is the
    // same one the thirteen client write paths and two Barry verbs already use.
    const contactMatch = await resolveIdentity(db, message);

    // Only an EXACT signal produces relationship truth (ADR-006). REVIEW and
    // NEW both halt here and land in unmatched_messages.
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
    let relationshipEvent = null;

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

      // ── Step 5: Record the canonical relationship event ─────────────────
      // ADR-006. This no longer writes contact fields directly — the writer
      // owns the event, the materialization, and the legacy mirrors, and is
      // gated by GMAIL_IDENTITY_MODE which fails safe to dry_run.
      //
      // Automated mail is ingested and timelined but creates no relationship
      // event: a bounce or an out-of-office is not the person answering, and
      // letting it advance last_inbound_at would make a vacation responder look
      // like a reply.
      if (message.category !== 'automated') {
        const recorded = await recordInboundEvent({
          db,
          message: { ...message, communicationRecordId: messageRecordId },
          contactId,
          identity: contactMatch.identity,
          source: message.ingestionSource || 'gmail_sync',
          threadHasPriorOutbound: message.isFirstMessageInThread !== true,
        });

        relationshipEvent = recorded;
        conversationState = recorded.state?.state ?? null;
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
    // Gated on a canonical event having actually been CREATED. Under dry_run
    // nothing is created, so nothing is queued — which is what keeps the
    // validation window free of AI processing and Anthropic spend. A replay
    // is likewise not a new arrival and must not re-queue.
    const shouldQueue = relationshipEvent?.created === true;

    const existingQueueSnap = shouldQueue
      ? await db
          .collection('barry_processing_queue')
          .where('messageRecordId', '==', messageRecordId)
          .limit(1)
          .get()
      : { empty: false };

    if (shouldQueue && existingQueueSnap.empty) {
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
