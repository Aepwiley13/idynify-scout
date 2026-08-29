/**
 * process-barry-inbox-queue — Sprint 3 Team B Orchestrator
 *
 * Processes pending entries in barry_processing_queue. For each entry:
 *   1. Set status → "processing"
 *   2. Run barryInboxAnalyzer → ConversationAnalysis
 *   3. Write analysis to contacts/{contactId}/barry_analysis/{messageRecordId}
 *   4. Update relationship_context with extracted Sprint 3 signals
 *   5. Run barryDraftComposer → DraftReply
 *   6. Write draft to contacts/{contactId}/barry_drafts/{messageRecordId}
 *   7. Update timeline event intelligenceStatus → "complete"
 *   8. Update conversationState → "user_action_required"
 *   9. Set queue entry status → "complete"
 *
 * On failure: status → "failed", errorMessage written, continue to next entry.
 * Idempotent: re-running on the same entry produces the same result.
 *
 * SCHEDULING (P0A / defect A4)
 * ───────────────────────────
 * This is a scheduled function. Before P0A it had no trigger of any kind — no
 * cron, and no caller anywhere in the repository — so every entry
 * `messageProcessor` enqueued sat pending forever and no inbound reply was ever
 * analysed or drafted. It now runs on QUEUE_SCHEDULE, following the same
 * `schedule()` convention as gmail-sync-worker and process-barry-queue.
 *
 * The cadence is deliberately faster than the 10-minute Gmail sync so the queue
 * drains rather than grows. QUEUE_LIMIT is still 10 entries per run, which caps
 * throughput at 120 messages/hour; raising it is a P1 concern, not a P0A one.
 *
 * Invocation is otherwise unchanged: a scheduled run arrives with no
 * httpMethod, and a manual POST still works for local testing.
 */

import { schedule } from '@netlify/functions';
import { db } from './firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { analyzeInboundMessage } from './utils/barryInboxAnalyzer.js';
import { composeDraftReply } from './utils/barryDraftComposer.js';
import { CONVERSATION_STATES } from '../../src/types/conversationState.js';
import { getConversationState } from '../../src/utils/relationshipRead.js';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const QUEUE_LIMIT = 10;

/** Every 5 minutes — twice the rate of the 10-minute Gmail sync that feeds it. */
export const QUEUE_SCHEDULE = '*/5 * * * *';

export const processInboxQueue = async (event = {}) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  // A scheduled invocation carries no httpMethod. Only reject a request that
  // explicitly arrives as something other than POST.
  if (event.httpMethod && event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const startMs = Date.now();
  const results = { processed: 0, succeeded: 0, failed: 0, skipped: 0, entries: [] };

  try {
    // ── Query pending queue entries ──────────────────────────────────────
    const queueSnap = await db
      .collection('barry_processing_queue')
      .where('status', '==', 'pending')
      .where('sprintVersion', '==', 'sprint2')
      .limit(QUEUE_LIMIT)
      .get();

    if (queueSnap.empty) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ message: 'No pending entries', results, processingMs: Date.now() - startMs }),
      };
    }

    console.log(`[process-barry-inbox-queue] Processing ${queueSnap.size} entries`);

    // ── Process each entry sequentially ──────────────────────────────────
    for (const queueDoc of queueSnap.docs) {
      const entry = queueDoc.data();
      const queueRef = queueDoc.ref;
      const { messageRecordId, contactId, idynifyUserId } = entry;
      results.processed++;

      // Skip entries without a contactId (unmatched messages)
      if (!contactId) {
        results.skipped++;
        results.entries.push({ messageRecordId, status: 'skipped', reason: 'No contactId' });
        await queueRef.update({ status: 'skipped', updatedAt: FieldValue.serverTimestamp() });
        continue;
      }

      try {
        // ── Idempotency: check if already processed ───────────────────
        const existingAnalysisSnap = await db
          .collection('users').doc(idynifyUserId)
          .collection('contacts').doc(contactId)
          .collection('barry_analysis').doc(messageRecordId)
          .get();

        if (existingAnalysisSnap.exists) {
          results.skipped++;
          results.entries.push({ messageRecordId, contactId, status: 'skipped', reason: 'Already processed' });
          await queueRef.update({ status: 'complete', updatedAt: FieldValue.serverTimestamp() });
          continue;
        }

        // ── Step 1: Mark as processing ────────────────────────────────
        await queueRef.update({ status: 'processing', updatedAt: FieldValue.serverTimestamp() });

        // ── Step 2: Run analyzer ──────────────────────────────────────
        const analysis = await analyzeInboundMessage(db, { messageRecordId, contactId, idynifyUserId });

        // ── Step 3: Write barry_analysis document ─────────────────────
        await db
          .collection('users').doc(idynifyUserId)
          .collection('contacts').doc(contactId)
          .collection('barry_analysis').doc(messageRecordId)
          .set({
            contactId,
            messageRecordId,
            gmailMessageId: analysis.sourceMessageId,
            idynifyUserId,
            ...analysis,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });

        // ── Step 4: Update relationship_context with Sprint 3 signals ─
        const contextRef = db
          .collection('users').doc(idynifyUserId)
          .collection('contacts').doc(contactId)
          .collection('relationship_context').doc(idynifyUserId);

        await contextRef.set({
          openQuestions: analysis.questionsAsked,
          openCommitments: analysis.commitmentsMade,
          objections: analysis.objections,
          positiveSignals: analysis.positiveSignals,
          informationShared: analysis.requestsMade,
          recommendedAction: analysis.recommendedAction,
          recommendedActionReason: analysis.recommendedActionReason,
          suggestedFollowUpDate: analysis.suggestedFollowUpDate,
          recommendedAt: FieldValue.serverTimestamp(),
          lastAnalyzedAt: FieldValue.serverTimestamp(),
          lastUpdatedAt: FieldValue.serverTimestamp(),
          contextVersion: '2.0.0',
        }, { merge: true });

        // ── Step 5: Run draft composer ────────────────────────────────
        const draft = await composeDraftReply(db, { analysis, messageRecordId, contactId, idynifyUserId });

        // ── Step 6: Write barry_drafts document ───────────────────────
        await db
          .collection('users').doc(idynifyUserId)
          .collection('contacts').doc(contactId)
          .collection('barry_drafts').doc(messageRecordId)
          .set({
            contactId,
            messageRecordId,
            idynifyUserId,
            ...draft,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });

        // ── Step 7: Update timeline event ─────────────────────────────
        const timelineSnap = await db
          .collection('users').doc(idynifyUserId)
          .collection('contacts').doc(contactId)
          .collection('timeline')
          .where('messageRecordId', '==', messageRecordId)
          .limit(1)
          .get();

        if (!timelineSnap.empty) {
          await timelineSnap.docs[0].ref.update({
            intelligenceStatus: 'complete',
            actionRequired: true,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        // ── Step 8: Advance conversationState ─────────────────────────
        const contactRef = db
          .collection('users').doc(idynifyUserId)
          .collection('contacts').doc(contactId);

        const contactSnap = await contactRef.get();
        if (contactSnap.exists) {
          // Read through the canonical accessor rather than off the document.
          // The value is still the legacy workflow vocabulary — this contract
          // does not own it — but routing the read through one module is what
          // lets it be retired in one edit later, and is what the ADR-006
          // boundary enforces.
          const currentState = getConversationState(contactSnap.data());
          if (currentState === CONVERSATION_STATES.RESPONSE_RECEIVED) {
            await contactRef.update({
              conversationState: CONVERSATION_STATES.USER_ACTION_REQUIRED,
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
        }

        // ── Step 9: Mark queue entry complete ─────────────────────────
        await queueRef.update({
          status: 'complete',
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        // Update communication record intelligence status
        await db.collection('communication_records').doc(messageRecordId).update({
          intelligenceStatus: 'complete',
          updatedAt: FieldValue.serverTimestamp(),
        });

        results.succeeded++;
        results.entries.push({
          messageRecordId,
          contactId,
          status: 'complete',
          intent: analysis.intent,
          recommendedAction: analysis.recommendedAction,
        });

        console.log(`[process-barry-inbox-queue] ✅ ${messageRecordId} → ${analysis.intent} / ${analysis.recommendedAction}`);

      } catch (entryError) {
        console.error(`[process-barry-inbox-queue] ❌ ${messageRecordId}:`, entryError.message);

        results.failed++;
        results.entries.push({
          messageRecordId,
          contactId,
          status: 'failed',
          error: entryError.message,
        });

        await queueRef.update({
          status: 'failed',
          errorMessage: entryError.message,
          failedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }).catch(() => {});
      }
    }

    const processingMs = Date.now() - startMs;
    console.log(
      `[process-barry-inbox-queue] Done: ${results.succeeded} succeeded, ` +
      `${results.failed} failed, ${results.skipped} skipped in ${processingMs}ms`
    );

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, results, processingMs }),
    };

  } catch (error) {
    console.error('[process-barry-inbox-queue] Fatal error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: error.message, results, processingMs: Date.now() - startMs }),
    };
  }
};

export const handler = schedule(QUEUE_SCHEDULE, processInboxQueue);
