/**
 * contactResolver — the SERVER adapter over the canonical identity decision
 * engine.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS FILE CONTAINS NO IDENTITY LOGIC.                                   ║
 * ║                                                                          ║
 * ║  It translates three queries into firebase-admin. Every decision about    ║
 * ║  whether two records are the same person is made in:                     ║
 * ║                                                                          ║
 * ║      src/utils/identityResolution.js                                     ║
 * ║                                                                          ║
 * ║  If you find yourself adding a match rule here, it belongs there.        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * WHY (Gate 2 Phase 1)
 * ────────────────────
 * Barry's write verbs are Netlify functions on the Admin SDK. The resolver the
 * thirteen client write paths use lives behind the Firestore WEB SDK. Without
 * this adapter the only way for Barry to ask "have I already got this person?"
 * was a second implementation of the answer — and two resolvers means two
 * answers, with the wrong one creating the duplicate.
 *
 * The cross-runtime import below (`../../../src/utils/...`) is the pattern this
 * codebase already ships: `netlify/functions/utils/timelineWrite.js` imports
 * `src/constants/timelineEvents.js` exactly this way, for exactly this reason.
 *
 * THE ASYMMETRY IS PART OF THE CONTRACT
 * ─────────────────────────────────────
 *   findByField    RETHROWS.   A Firestore error must never read as "no
 *                              duplicate". Creating a duplicate because the
 *                              database was unreachable is worse than failing
 *                              the request.
 *
 *   loadScanWindow DEGRADES.   The exact queries have already run and
 *                              succeeded, so the workspace IS reachable.
 *                              Blocking on a failed fallback would trade a rare
 *                              missed match for a common refusal.
 *
 * Both behaviours match the web adapter exactly. A parity test asserts they do.
 */

import {
  resolveContactCore,
  SCAN_WINDOW,
} from '../../../src/utils/identityResolution.js';

/**
 * Build the data-access adapter the engine resolves through.
 *
 * ONE ADAPTER PER OPERATION, NOT PER CANDIDATE.
 *
 * The scan cache lives here. A batch that resolves twenty candidates should
 * construct this once and pass it to every call: the window is then loaded at
 * most once for the whole operation instead of twenty times, which is the
 * difference between 200 document reads and 4,000. That is what makes
 * RESOLVE_SAVE affordable at batch size, and it is why the cache is on the
 * adapter rather than inside a single resolution.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string} userId
 * @returns {{userId: string, getById: Function, findByField: Function, loadScanWindow: Function}}
 */
export function createAdminAdapter(db, userId) {
  const contacts = () => db.collection('users').doc(userId).collection('contacts');
  const cache = { records: null, failed: false };

  return {
    userId,

    async getById(contactId) {
      if (!contactId) return null;
      const snap = await contacts().doc(contactId).get();
      return snap.exists ? { id: snap.id, ...snap.data() } : null;
    },

    /** Returns EVERY hit up to the cap — the engine needs the second one to
     *  detect an authoritative collision and refuse. */
    async findByField(field, value) {
      if (!value) return [];
      try {
        const snap = await contacts().where(field, '==', value).limit(5).get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (err) {
        console.error('[contact-identity] lookup failed', { field, value, code: err?.code, message: err?.message });
        throw err;
      }
    },

    async loadScanWindow() {
      if (cache.records) return cache.records;
      if (cache.failed) return [];

      try {
        // Deliberately unordered, matching the web adapter exactly — see
        // SCAN ORDERING in identityResolution.js.
        const snap = await contacts().limit(SCAN_WINDOW).get();
        cache.records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return cache.records;
      } catch (err) {
        console.error('[contact-identity] fallback scan failed', { code: err?.code, message: err?.message });
        cache.failed = true;
        return [];
      }
    },
  };
}

/**
 * Resolve one candidate, server-side.
 *
 * Signature mirrors the browser's `resolveContact(userId, candidate, opts)` so
 * the two read identically at the call site.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string} userId
 * @param {object} candidate
 * @param {{source?: string, adapter?: object}} [options]
 *   `adapter` lets a batch share one scan window. Omit for a single resolution.
 */
export async function resolveContact(db, userId, candidate, { source = 'unknown', adapter = null } = {}) {
  const access = adapter ?? (userId ? createAdminAdapter(db, userId) : { userId });
  return resolveContactCore(access, candidate, { source });
}

export default { createAdminAdapter, resolveContact };
