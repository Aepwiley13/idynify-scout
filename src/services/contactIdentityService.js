/**
 * contactIdentityService — the BROWSER adapter over the canonical identity
 * decision engine.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THE DECISION ENGINE MOVED. THIS FILE IS NOW ITS WEB-SDK ADAPTER.        ║
 * ║                                                                          ║
 * ║      src/utils/identityResolution.js                                     ║
 * ║                                                                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * WHY (Gate 2 Phase 1)
 * ────────────────────
 * The hierarchy, the merge rules and the fail-closed behaviour used to live
 * here, alongside `import { ... } from 'firebase/firestore'`. That import is
 * what made them unreachable from a Netlify function, which runs on
 * firebase-admin — so Barry could not ask "have I already got this person?"
 * without a second implementation of the answer.
 *
 * Two resolvers means two answers, and the one that is wrong creates the
 * duplicate. So the engine is now runtime-independent and this file supplies
 * the browser's data access. `netlify/functions/utils/contactResolver.js`
 * supplies the server's. Both call the same code to decide.
 *
 * WHAT DID NOT CHANGE
 * ───────────────────
 * Every export below keeps its name, signature and behaviour. The thirteen
 * guarded write paths and `contactWriteGuard` were not touched — if any of them
 * had needed editing, the extraction would have been wrong.
 *
 * The platform principle the engine encodes is unchanged and is documented at
 * the top of identityResolution.js:
 *
 *      DISCOVERY ENRICHES. IT NEVER REPLACES.
 *
 * WHAT IS STILL TRUE ABOUT THIS FILE
 * ──────────────────────────────────
 * It is still the single answer to "have I already got this person?" for every
 * client write path, run BEFORE any write. It is not historical dedup and it
 * does not merge existing duplicates; those remain a separate sprint. It stops
 * the next duplicate from being created.
 */

import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  resolveContactCore,
  SCAN_WINDOW,
  mergeIdentifiers,
  identityFields,
  reviewFields,
  getResolutionLog,
  clearResolutionLog,
  RESOLUTION,
} from '../utils/identityResolution';
import {
  extractIdentifiers,
  normalizeEmail,
  normalizeLinkedInUrl,
  normalizePhone,
} from '../utils/identityNormalization';

// ── Re-exports: the public API of this module is unchanged ──────────────────

export { MATCH_SIGNALS, EXACT_SIGNALS } from '../utils/identityResolution';
export {
  RESOLUTION,
  SCAN_WINDOW,
  mergeIdentifiers,
  identityFields,
  reviewFields,
  getResolutionLog,
  clearResolutionLog,
};

export { extractIdentifiers, normalizeEmail, normalizeLinkedInUrl, normalizePhone };

// ── The web-SDK adapter ─────────────────────────────────────────────────────

const contactsRef = (userId) => collection(db, 'users', userId, 'contacts');

/**
 * Build the data-access adapter the engine resolves through.
 *
 * The scan cache lives on the adapter, not on a single resolution, so a batch
 * caller can construct ONE adapter and pay for the window once. Twenty new
 * candidates used to load it twenty times — 4,000 document reads to answer
 * twenty questions. A single-candidate caller is unaffected: the window is
 * still lazy and still only loads when every exact query has missed.
 *
 * @param {string} userId
 * @returns {{userId: string, getById: Function, findByField: Function, loadScanWindow: Function}}
 */
export function createWebAdapter(userId) {
  const cache = { records: null, failed: false };

  return {
    userId,

    async getById(contactId) {
      if (!contactId) return null;
      const snap = await getDoc(doc(db, 'users', userId, 'contacts', contactId));
      return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    },

    /**
     * One equality query, returning EVERY hit up to the cap.
     *
     * Single-field equality queries need no composite index, which is why the
     * hierarchy is several cheap queries rather than one clever compound one.
     *
     * Returns an array rather than a first hit: the engine refuses when an
     * authoritative identifier maps to more than one record, and it cannot do
     * that if the adapter has already thrown the second one away.
     *
     * RETHROWS on failure, deliberately. A permission or network error here
     * would otherwise present as "no duplicate found" and quietly create one.
     */
    async findByField(field, value) {
      if (!value) return [];
      try {
        const snap = await getDocs(query(contactsRef(userId), where(field, '==', value), limit(5)));
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (err) {
        console.error('[contact-identity] lookup failed', { field, value, code: err?.code, message: err?.message });
        throw err;
      }
    },

    /**
     * The normalizing fallback scan.
     *
     * FIRESTORE EQUALITY IS CASE-SENSITIVE, and that is the whole reason this
     * exists. A contact stored as `email: 'Gentry.Moyes@Acme.com'` — which is
     * what a Gmail header or a hand-typed form produces — is not matched by
     * `where('email','==','gentry.moyes@acme.com')`. Neither is a LinkedIn URL
     * stored with a scheme, a `www.` and a trailing slash matched by a query
     * for its normalized form.
     *
     * Records written from the canonical-identity sprint forward carry
     * `email_normalized`, `linkedin_url_normalized` and `phone_normalized`, and
     * those ARE matchable by query. The scan covers everything written before —
     * and it is what fills those fields in, because a resolution that matches
     * by scan merges the normalized forms onto the record it found.
     *
     * DEGRADES to [] on failure, deliberately, and differently from
     * findByField above: the exact queries have already run and succeeded, so
     * the workspace IS reachable. Blocking a save on a failed fallback trades a
     * rare missed match for a common refusal.
     */
    async loadScanWindow() {
      if (cache.records) return cache.records;
      if (cache.failed) return [];

      try {
        // Deliberately unordered — see SCAN ORDERING in identityResolution.js.
        const snap = await getDocs(query(contactsRef(userId), limit(SCAN_WINDOW)));
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

// ── The resolver, unchanged from every caller's point of view ───────────────

/**
 * Resolve a candidate contact against the workspace.
 *
 * @param {string} userId     Workspace owner (uid).
 * @param {object} candidate  Any contact-ish payload. See extractIdentifiers.
 * @param {object} [options]
 * @param {string} [options.source]   Write path name, for the log.
 * @param {object} [options.adapter]  A pre-built adapter, so a batch caller can
 *                                    share one scan window across candidates.
 *                                    Omit it and one is built per call, which
 *                                    is what every existing caller does.
 *
 * @returns {Promise<{
 *   outcome: 'matched'|'review'|'new',
 *   contactId: string|null,
 *   existing: object|null,
 *   signal: string|null,
 *   requiresReview: boolean,
 *   candidates: object[],
 *   identifiers: object,
 * }>}
 */
export async function resolveContact(userId, candidate, { source = 'unknown', adapter = null } = {}) {
  // A falsy userId still has to reach the engine: it owns the "no workspace"
  // outcome and its log line, and duplicating that decision here would be the
  // first crack in having one engine.
  const access = adapter ?? (userId ? createWebAdapter(userId) : { userId });
  return resolveContactCore(access, candidate, { source });
}

export { resolveContactCore };

export default {
  resolveContact,
  createWebAdapter,
  normalizeEmail,
  normalizeLinkedInUrl,
  normalizePhone,
  mergeIdentifiers,
  identityFields,
  reviewFields,
  extractIdentifiers,
  getResolutionLog,
  clearResolutionLog,
  RESOLUTION,
};
