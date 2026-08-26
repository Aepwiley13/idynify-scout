/**
 * barryLink — LINK. Gate 2's placement primitive.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  SCOUT IS A LENS OVER CANONICAL CONTACTS, NOT A PLACE THAT OWNS THEM.    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * "Put these 20 into Scout" is NOT a save. It is `stage` on twenty records that
 * already exist:
 *
 *     RESOLVE_SAVE → canonical contactIds → LINK(ids, 'scout')
 *
 * ─── WHY THIS IS A SEPARATE VERB FROM RESOLVE_SAVE ─────────────────────────
 * Because RESOLVE_SAVE alone cannot execute the sentence. Those twenty people
 * are usually ALREADY canonical — Scout's own People Mode and post-swipe
 * auto-discovery created them — so resolution matches all twenty, produces
 * twenty empty patches, writes nothing, and the user's request quietly does
 * nothing. Identity and placement are different questions.
 *
 * ─── WHAT IT MUST NEVER DO ─────────────────────────────────────────────────
 * Create a second representation of a human. `users/{uid}/sniper_contacts` is
 * the cautionary case already in this repo: adding someone to Sniper COPIES
 * them into a parallel collection carrying a name, title, company and email and
 * nothing else — no timeline, no barry_memory, no engagement history — so a
 * relationship the product spent months accumulating arrives as a stranger, and
 * the two records then diverge with nothing reconciling them. A prior sprint
 * froze it behind a mandatory canonical_contact_id and deferred the migration.
 *
 * LINK writes ONE field on ONE existing document, and a test asserts that
 * sniper_contacts is untouched even when the target stage is 'sniper'.
 *
 * ─── IDEMPOTENCY IS STRUCTURAL ─────────────────────────────────────────────
 * A contact already at the target stage is reported `changed: false` with NO
 * write and NO timeline event. Repeating the operation therefore changes
 * nothing — not because a guard suppressed it, but because there was nothing to
 * do. The verb is also its own inverse: a bad LINK is undone by LINK-ing back.
 */

import { db } from './firebase-admin.js';
import { verifyAuthToken } from './utils/verifyAuthToken.js';
import { logApiUsage } from './utils/logApiUsage.js';
import { writeTimelineEvent } from './utils/timelineWrite.js';
import { STAGE, STAGES } from '../../src/constants/statusModel.js';
import { ACTORS } from '../../src/constants/timelineEvents.js';

/**
 * Stage → contact_status coercion, mirroring barryPipelineAction.moveStage so
 * the two verbs cannot disagree about what arriving in a stage means.
 * Moving back to Scout forces no status change: re-activation is not a demotion.
 */
const STAGE_STATUS_MAP = {
  [STAGE.HUNTER]: 'Engaged',
  [STAGE.SNIPER]: 'In Conversation',
  [STAGE.BASECAMP]: 'Active Customer',
  [STAGE.FALLBACK]: 'Dormant',
  [STAGE.SCOUT]: null,
};

/** Bounded for the same reason RESOLVE_SAVE is: one request, one operation. */
const MAX_CONTACTS = 200;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const startTime = Date.now();
  let userId;

  try {
    const body = JSON.parse(event.body || '{}');
    userId = body.userId;
    const { authToken, operationId, contactIds, targetStage } = body;
    const actor = body.actor === 'barry' ? ACTORS.BARRY : ACTORS.USER;

    if (!userId || !authToken) return json(400, { error: 'Missing userId or authToken' });
    if (!operationId || typeof operationId !== 'string') {
      return json(400, { error: 'Missing operationId' });
    }
    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return json(400, { error: 'contactIds must be a non-empty array' });
    }
    if (contactIds.length > MAX_CONTACTS) {
      return json(400, { error: `Too many contacts (max ${MAX_CONTACTS})` });
    }
    if (!STAGES.includes(targetStage)) {
      return json(400, { error: `targetStage must be one of ${STAGES.join(' | ')}` });
    }
    if (contactIds.some(id => typeof id !== 'string' || !id)) {
      return json(400, { error: 'every contactId must be a non-empty string' });
    }

    await verifyAuthToken(authToken, userId);

    const contacts = db.collection('users').doc(userId).collection('contacts');
    const results = [];
    const now = new Date().toISOString();

    // Deduped: naming the same contact twice in one request is one move, not
    // two, and would otherwise emit two timeline events for one change.
    for (const contactId of [...new Set(contactIds)]) {
      const snap = await contacts.doc(contactId).get();
      if (!snap.exists) {
        // LINK never creates. An id that is not here is reported, not resolved
        // and not written — identity is RESOLVE_SAVE's job, and doing it here
        // would be the second entity model this gate exists to avoid.
        results.push({ contactId, from: null, to: targetStage, changed: false, reason: 'not_found' });
        continue;
      }

      const contact = snap.data();
      const from = contact.stage || STAGE.SCOUT;

      if (from === targetStage) {
        results.push({ contactId, from, to: targetStage, changed: false });
        continue;
      }

      const patch = {
        stage: targetStage,
        stage_source: 'barry_link',
        stage_updated_at: now,
        identity_operation_id: operationId,
        identity_actor: actor,
      };
      const coerced = STAGE_STATUS_MAP[targetStage];
      if (coerced) patch.contact_status = coerced;

      await contacts.doc(contactId).update(patch);

      // Validated against the one 52-type allowlist both runtimes share.
      await writeTimelineEvent(db, {
        userId,
        contactId,
        type: 'stage_moved',
        actor,
        preview: `Moved from ${from} to ${targetStage}`,
        metadata: { from, to: targetStage, source: 'barry_link', operationId },
      });

      results.push({ contactId, from, to: targetStage, changed: true });
    }

    const summary = {
      total: results.length,
      moved: results.filter(r => r.changed).length,
      alreadyThere: results.filter(r => !r.changed && !r.reason).length,
      notFound: results.filter(r => r.reason === 'not_found').length,
    };

    await logApiUsage(userId, 'barryLink', 'success', {
      responseTime: Date.now() - startTime,
      metadata: { operationId, actor, targetStage, ...summary },
    });

    return json(200, { success: true, operationId, targetStage, results, summary });

  } catch (err) {
    console.error('[barryLink] error:', err.message);
    try {
      if (userId) {
        await logApiUsage(userId, 'barryLink', 'error', {
          responseTime: Date.now() - startTime,
          metadata: { message: err.message },
        });
      }
    } catch { /* logging must not mask the original failure */ }
    return json(500, { error: err.message || 'link_failed' });
  }
};

export default { handler };
