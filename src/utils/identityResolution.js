/**
 * identityResolution — the ONE canonical contact identity decision engine.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  PLATFORM PRINCIPLE                                                      ║
 * ║                                                                          ║
 * ║      DISCOVERY ENRICHES. IT NEVER REPLACES.                              ║
 * ║                                                                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─── WHY THIS FILE EXISTS SEPARATELY FROM contactIdentityService.js ─────────
 *
 * The hierarchy below used to live in src/services/contactIdentityService.js,
 * which imports the Firestore WEB SDK. Every Barry write verb is a Netlify
 * function on the ADMIN SDK, so the decision engine was unreachable from the
 * one place Gate 2 needs it. The choices were: write an admin-side twin of the
 * resolver, or make the existing one runtime-independent.
 *
 * A twin is the wrong answer, and this codebase has said so twice already.
 * src/utils/identityNormalization.js was extracted so the browser resolver and
 * the Node duplicate-detection script could not disagree about what "the same
 * email" means. src/constants/timelineEvents.js was extracted so the browser
 * and server timeline writers could not disagree about what a valid event is.
 * Both carry headers explaining that a second copy drifts, silently, and that
 * the drift is invisible in review. This is the third instance of the same
 * pattern and it is the load-bearing piece of Gate 2: two resolvers means two
 * answers to "have I already got this person?", and the one that is wrong
 * creates the duplicate.
 *
 * So: no firebase import, of any kind, in this file. Data access arrives as an
 * adapter. If a future edit needs `firebase/firestore` or `firebase-admin`
 * here, that edit belongs in an adapter instead.
 *
 * ─── THE ADAPTER ───────────────────────────────────────────────────────────
 *
 *   {
 *     userId,                          the workspace being resolved against
 *     getById(contactId)   → doc|null  hierarchy step 1
 *     findByField(f, v)    → doc[]     one equality query, capped; MUST rethrow
 *     loadScanWindow()     → doc[]     bounded, cached; MUST return [] on error
 *   }
 *
 * findByField returns an ARRAY, not a first hit. Gate 2 Phase 2f: when one
 * authoritative identifier maps to two records that is a data-integrity
 * violation, not a match, and the resolver must refuse rather than silently
 * take docs[0] — which is what it used to do, invisibly, forever.
 *
 * The fail-closed / fail-open asymmetry is part of the contract, not an
 * implementation detail of either adapter:
 *
 *   findByField RETHROWS.      A Firestore error must never read as "no
 *                              duplicate". Creating a duplicate because the
 *                              database was unreachable is worse than
 *                              surfacing the error to whoever pressed Save.
 *
 *   loadScanWindow DEGRADES.   The exact queries have already run and
 *                              succeeded, so the workspace IS reachable.
 *                              Blocking a save on a failed fallback would
 *                              trade a rare missed match for a common
 *                              refusal.
 *
 * ─── WHY THE SCAN CACHE LIVES IN THE ADAPTER ───────────────────────────────
 *
 * It used to be created per resolution. A batch of 20 new candidates therefore
 * loaded the window 20 times — 4,000 document reads to answer 20 questions.
 * Owning the cache in the adapter lets a batch caller construct ONE adapter and
 * pay for the window once, which is what makes RESOLVE_SAVE affordable. A
 * single-candidate caller is unaffected: the window is still loaded lazily and
 * still only when every exact query has missed.
 *
 * ─── THE LOCKED HIERARCHY ──────────────────────────────────────────────────
 *
 *   1. Existing Firestore contact ID   — decisive, no query needed
 *   2. Normalized email exact match    — the primary dedup signal
 *   3. Apollo person ID exact match
 *   4. LinkedIn URL exact match
 *   5. Phone exact match
 *   6. Name + company match            — FLAGGED FOR REVIEW, never auto-merged
 *
 * Steps 1–5 are exact-identifier matches: two records sharing one of them are
 * the same person, or the data is wrong in a way a fuzzy matcher would not fix.
 * Step 6 is not. "John Smith at Acme" matches a second John Smith at Acme, and
 * auto-merging them silently destroys one person's history. So step 6 returns a
 * flag and a candidate list, and refuses to choose.
 */

import { extractIdentifiers, normalizeLoose } from './identityNormalization.js';

/**
 * One authoritative identifier, two existing records.
 *
 * Thrown rather than returned, deliberately. Every existing caller wraps its
 * save in a try/catch and surfaces the failure to the user, so throwing makes
 * all thirteen client write paths fail closed with no change to any of them.
 * Returning a new outcome would have fallen through their
 * `if (action === 'merge') … else create` shape and produced a THIRD duplicate,
 * which is the opposite of the intent.
 *
 * RESOLVE_SAVE catches this per candidate and maps it to the contract's
 * `refused` outcome. See docs/GATE2_CANDIDATE_CONTRACT.md.
 */
export class IdentityConflictError extends Error {
  constructor(signal, value, contactIds) {
    super(
      `Two or more existing contacts share the same ${signal}. ` +
      `IDYNIFY will not guess which one you meant.`
    );
    this.name = 'IdentityConflictError';
    this.signal = signal;
    this.value = value;
    this.contactIds = contactIds;
  }
}

/** How a match was made. Ordered — index is the hierarchy rank. */
export const MATCH_SIGNALS = Object.freeze([
  'firestore_id',
  'email',
  'apollo_person_id',
  'linkedin_url',
  'phone',
  'name_company',
]);

/** Signals strong enough to merge onto an existing record without asking. */
export const EXACT_SIGNALS = Object.freeze([
  'firestore_id',
  'email',
  'apollo_person_id',
  'linkedin_url',
  'phone',
]);

/** Resolution outcomes. */
export const RESOLUTION = Object.freeze({
  MATCHED: 'matched',           // an existing contact — do not create
  REVIEW: 'review',             // a weak match — create, but flag it
  NEW: 'new',                   // nothing matched — create
});

/**
 * How many documents the normalizing fallback scan will read.
 *
 * ─── SCAN ORDERING — why it is by document id and NOT by is_archived/name ───
 *
 * Gate 2 Phase 2b planned to order the window `is_archived ASC, name ASC`,
 * reusing the composite index that already exists in firestore.indexes.json.
 * The reasoning was sound — the window was implicitly ordered by document id,
 * so its contents were arbitrary and included archived records.
 *
 * Production evidence killed it. Firestore EXCLUDES a document from any query
 * that filters or orders on a field the document does not carry, and
 * `is_archived` was absent from every Scout write path until PR #510:
 *
 *     is_archived present   228 / 1,365 contacts   (16.7%)
 *     name present        1,228 / 1,365 contacts   (90.0%)
 *     largest workspace      47 /   621 contacts   (7.6%)
 *
 * So `where('is_archived','==',false) + orderBy('name')` would have shrunk the
 * window from 200 documents to at most 47 in the 621-contact workspace — the
 * one that most depends on the fallback — losing ~93% of it. And the records
 * dropped would be the legacy ones, which are precisely the population that
 * has no normalized identifiers and therefore needs the scan.
 *
 * An ordering intended to make the window better would have made it nearly
 * useless, silently, with no error and no failing test.
 *
 * The safe half — making the implicit document-id order EXPLICIT with
 * `orderBy(documentId())` — was built and then also dropped. Firestore already
 * orders by `__name__` by default, so it changed no behaviour, while adding a
 * real failure surface: `loadScanWindow` fails open by design, so any
 * environment where that call does not resolve silently disables the ENTIRE
 * fallback scan and every affected resolution quietly returns "new". A
 * cosmetic gain is not worth a new way to lose the fallback without an error.
 *
 * So the window stays unordered, which is to say ordered by document id — the
 * same contents as before, in both runtimes, with no new way to break.
 *
 * SCAN_WINDOW stays at 200. Raising it was rejected on the same evidence: of
 * the 111 records reachable only by scanning, 103 are LinkedIn-only records
 * with no normalized field. The Phase 2d raw-value rung removes them from scan
 * dependence entirely, which is a better answer than reading more documents.
 */
export const SCAN_WINDOW = 200;

// ── Logging ─────────────────────────────────────────────────────────────────

/**
 * The in-memory resolution log.
 *
 * Console output is for the person debugging live; this array is for the
 * verification script and the tests, which need to assert that a decision was
 * MADE rather than that a string was printed. Capped so a bulk import cannot
 * grow it without bound.
 */
const RESOLUTION_LOG = [];
const RESOLUTION_LOG_LIMIT = 200;

export function getResolutionLog() {
  return RESOLUTION_LOG.slice();
}

export function clearResolutionLog() {
  RESOLUTION_LOG.length = 0;
}

function logResolution(entry) {
  RESOLUTION_LOG.push(entry);
  if (RESOLUTION_LOG.length > RESOLUTION_LOG_LIMIT) RESOLUTION_LOG.shift();

  const { outcome, signal, source, contactId, identifiers } = entry;
  const prefix = '[contact-identity]';

  if (outcome === RESOLUTION.MATCHED) {
    console.info(`${prefix} matched existing contact on ${signal}`, { source, contactId, identifiers });
  } else if (outcome === RESOLUTION.REVIEW) {
    console.warn(`${prefix} weak match — creating anyway, flagged for review`, { source, candidates: entry.candidates, identifiers });
  } else {
    console.info(`${prefix} no match — new contact`, { source, identifiers });
  }
}

// ── Lookups, all through the adapter ────────────────────────────────────────

/**
 * Collapse a set of matches into one answer, or refuse.
 *
 * 0 → null (keep looking)   1 → the record   2+ → IdentityConflictError
 *
 * Applied to BOTH the indexed queries and the scan fallbacks: a signal that
 * maps to two records is ambiguous wherever the two records were found.
 */
function single(signal, value, docs) {
  if (!docs || docs.length === 0) return null;
  const unique = [];
  for (const d of docs) if (!unique.some(u => u.id === d.id)) unique.push(d);
  if (unique.length === 1) return unique[0];
  throw new IdentityConflictError(signal, value, unique.map(d => d.id));
}

/** Records in the scan window whose normalized `key` equals `value`. */
async function scanFor(adapter, key, value) {
  if (!value) return [];
  const records = await adapter.loadScanWindow();
  return records.filter(r => extractIdentifiers(r)[key] === value);
}

/**
 * Email lookup across the shapes email has been stored in.
 *
 * Two cheap equality queries first (`email_normalized`, then `email` at its
 * normalized value, which covers the many sources that already lowercase), and
 * the normalizing scan only if both miss.
 */
async function findByEmail(adapter, normalized) {
  if (!normalized) return null;

  const [byNormalizedField, byExactEmail] = await Promise.all([
    adapter.findByField('email_normalized', normalized),
    adapter.findByField('email', normalized),
  ]);

  return single('email', normalized, byNormalizedField)
    ?? single('email', normalized, byExactEmail)
    ?? single('email', normalized, await scanFor(adapter, 'email', normalized));
}

/**
 * LinkedIn lookup: normalized field, then the RAW candidate value, then scan.
 *
 * Gate 2 Phase 2d. The middle rung is deliberately queried at the candidate's
 * ORIGINAL string rather than at its normalized form, and that asymmetry with
 * findByEmail is the whole point.
 *
 * Email normalization is lowercase-and-trim, so a stored address is very often
 * already equal to its normalized form and an equality query at the normalized
 * value hits. LinkedIn normalization strips scheme, `www.`, trailing slash,
 * query and fragment — `https://www.linkedin.com/in/jane/` becomes
 * `linkedin.com/in/jane`, and the two are almost never equal. Querying the raw
 * field at the normalized value would therefore match almost nothing.
 *
 * Querying it at the RAW incoming value does match, because the common
 * duplicate pair is two records from the SAME source (Apollo→Apollo,
 * import→import) that stored byte-identical URLs.
 *
 * Production evidence for prioritising this: of 111 records reachable only
 * through the fallback scan, 103 are LinkedIn-only records with no
 * `linkedin_url_normalized`. This rung is the one that removes them from scan
 * dependence — which is why SCAN_WINDOW stays at 200 rather than growing.
 */
async function findByLinkedIn(adapter, normalized, raw) {
  if (!normalized) return null;

  const byNormalizedField = await adapter.findByField('linkedin_url_normalized', normalized);
  const hit = single('linkedin_url', normalized, byNormalizedField);
  if (hit) return hit;

  if (typeof raw === 'string' && raw.trim() && raw.trim() !== normalized) {
    const byRaw = await adapter.findByField('linkedin_url', raw.trim());
    const rawHit = single('linkedin_url', normalized, byRaw);
    if (rawHit) return rawHit;
  }

  return single('linkedin_url', normalized, await scanFor(adapter, 'linkedinUrl', normalized));
}

/**
 * Phone lookup: normalized field, then the raw field, then scan.
 *
 * Gate 2 Phase 2c. Unlike LinkedIn, the raw rung here queries at the NORMALIZED
 * value: normalizePhone reduces to digits, and Apollo supplies
 * `phone_numbers[0].sanitized_number`, which is already digits — so a stored
 * value frequently equals its normalized form.
 *
 * Kept deliberately low-priority: production carries exactly one phone-only
 * record and zero `phone_normalized` fields. It costs one indexed query on a
 * path that had already missed twice, and it is here for correctness parity
 * with the other identifiers rather than because the population justifies it.
 */
async function findByPhone(adapter, normalized) {
  if (!normalized) return null;

  const byNormalizedField = await adapter.findByField('phone_normalized', normalized);
  const hit = single('phone', normalized, byNormalizedField);
  if (hit) return hit;

  const byRaw = await adapter.findByField('phone', normalized);
  const rawHit = single('phone', normalized, byRaw);
  if (rawHit) return rawHit;

  return single('phone', normalized, await scanFor(adapter, 'phone', normalized));
}

/**
 * Step 6: name + company. Returns ALL candidates, never picks one.
 *
 * Filters the same scan window the fallbacks used, because an equality query on
 * `name` is case-sensitive and the same person is stored as "Jane Doe",
 * "jane doe" and "Jane  Doe" depending on the source. A workspace larger than
 * the window is one where the exact signals above have already done the work.
 */
async function findWeakCandidates(adapter, ids) {
  if (!ids.name || !(ids.company || ids.companyId)) return [];

  const records = await adapter.loadScanWindow();
  return records.filter(c => {
    const other = extractIdentifiers(c);
    if (other.name !== ids.name) return false;
    if (ids.companyId && other.companyId) return other.companyId === ids.companyId;
    return Boolean(other.company) && other.company === ids.company;
  });
}

// ── The resolver ────────────────────────────────────────────────────────────

/**
 * Resolve a candidate contact against the workspace.
 *
 * @param {object} adapter    See "THE ADAPTER" above.
 * @param {object} candidate  Any contact-ish payload. See extractIdentifiers.
 * @param {object} [options]
 * @param {string} [options.source]  Write path name, for the log.
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
 *
 * `contactId` is non-null ONLY for outcome 'matched'. A 'review' outcome
 * returns null with candidates attached, because the whole point of step 6 is
 * that the engine refuses to choose.
 */
export async function resolveContactCore(adapter, candidate, { source = 'unknown' } = {}) {
  const identifiers = extractIdentifiers(candidate);

  const result = {
    outcome: RESOLUTION.NEW,
    contactId: null,
    existing: null,
    signal: null,
    requiresReview: false,
    candidates: [],
    identifiers,
  };

  if (!adapter?.userId) {
    // No workspace to resolve against. Treated as 'new' so the caller's own
    // auth failure surfaces at the write, not as a confusing dedup error.
    logResolution({ ...result, source, note: 'no userId' });
    return result;
  }

  // 1 — existing Firestore contact ID. Decisive: it IS the canonical identity.
  if (identifiers.contactId) {
    const hit = await adapter.getById(identifiers.contactId);
    if (hit) {
      Object.assign(result, {
        outcome: RESOLUTION.MATCHED,
        contactId: hit.id,
        existing: hit,
        signal: 'firestore_id',
      });
      logResolution({ ...result, source });
      return result;
    }
  }

  // 2–5 — exact identifier matches, in locked order.
  // The RAW strings, straight off the candidate. Phase 2d queries LinkedIn at
  // the original bytes, which is why the published CandidatePayload contract
  // requires callers to pass identifiers un-normalized.
  const rawLinkedIn = candidate?.linkedin_url ?? candidate?.linkedinUrl ?? null;

  const exactChecks = [
    { signal: 'email', run: () => findByEmail(adapter, identifiers.email) },
    {
      signal: 'apollo_person_id',
      run: async () => single(
        'apollo_person_id',
        identifiers.apolloPersonId,
        await adapter.findByField('apollo_person_id', identifiers.apolloPersonId),
      ),
    },
    { signal: 'linkedin_url', run: () => findByLinkedIn(adapter, identifiers.linkedinUrl, rawLinkedIn) },
    { signal: 'phone', run: () => findByPhone(adapter, identifiers.phone) },
  ];

  for (const check of exactChecks) {
    const hit = await check.run();
    if (hit) {
      Object.assign(result, {
        outcome: RESOLUTION.MATCHED,
        contactId: hit.id,
        existing: hit,
        signal: check.signal,
      });
      logResolution({ ...result, source });
      return result;
    }
  }

  // 6 — name + company. Flagged, never merged.
  const weak = await findWeakCandidates(adapter, identifiers);
  if (weak.length > 0) {
    Object.assign(result, {
      outcome: RESOLUTION.REVIEW,
      signal: 'name_company',
      requiresReview: true,
      candidates: weak.map(c => ({ id: c.id, name: c.name ?? null, company_name: c.company_name ?? null })),
    });
    logResolution({ ...result, source });
    return result;
  }

  logResolution({ ...result, source });
  return result;
}

// ── Merging ─────────────────────────────────────────────────────────────────

/**
 * Fields the canonical record owns. A later source never overwrites these.
 *
 * The rule is: identifiers accrete, canonical facts do not. If a Gmail import
 * says the name is "j.doe" and the record says "Jane Doe", the record wins —
 * the user curated it, or a richer source wrote it, and a weaker source
 * arriving later must not undo that. New IDENTIFIERS are pure gain and are
 * always attached.
 */
const CANONICAL_FIELDS = Object.freeze([
  'name', 'first_name', 'last_name', 'firstName', 'lastName',
  'title', 'company_id', 'company_name', 'stage', 'stage_source',
  'record_status', 'relationship_status', 'person_type', 'brigade',
  'is_archived', 'barry_memory', 'engage_state', 'engagement_summary',
  'next_best_step', 'referral_data', 'sticky_notes', 'addedAt', 'addedFrom',
]);

/** Identifier fields that may be filled in when the record is missing them. */
const IDENTIFIER_FIELDS = Object.freeze([
  'email', 'email_normalized', 'work_email',
  'apollo_person_id', 'linkedin_url', 'linkedin_url_normalized',
  'phone', 'phone_normalized', 'phone_mobile',
  'twitter_url', 'facebook_url', 'photo_url', 'location', 'department', 'seniority',
]);

/**
 * Build the patch that attaches a new source's identifiers to an existing
 * contact — additive only.
 *
 * Returns a patch object rather than writing, so the caller decides whether to
 * updateDoc, merge into a setDoc, or discard. An empty object means the new
 * source told us nothing we did not already have, and the caller can skip the
 * write entirely.
 *
 * @param {object} existingContact  The canonical record as it is in Firestore.
 * @param {object} newSource        The incoming payload.
 * @returns {object} patch — safe to update directly.
 */
export function mergeIdentifiers(existingContact = {}, newSource = {}) {
  const patch = {};
  const incoming = extractIdentifiers(newSource);

  const put = (field, value) => {
    if (value === null || value === undefined || value === '') return;
    if (CANONICAL_FIELDS.includes(field)) return;      // never overwrite
    const current = existingContact[field];
    if (current !== null && current !== undefined && current !== '') return; // never clobber
    patch[field] = value;
  };

  // Normalized forms, written for every record this touches — this is how the
  // historical backlog of un-normalized identifiers gets filled in over time
  // without a migration: each save normalizes the record it saves.
  if (incoming.email) {
    put('email', incoming.email);
    if (existingContact.email_normalized !== incoming.email) patch.email_normalized = incoming.email;
  }
  if (incoming.linkedinUrl) {
    put('linkedin_url', newSource.linkedin_url ?? incoming.linkedinUrl);
    if (existingContact.linkedin_url_normalized !== incoming.linkedinUrl) {
      patch.linkedin_url_normalized = incoming.linkedinUrl;
    }
  }
  if (incoming.phone) {
    put('phone', newSource.phone ?? incoming.phone);
    if (existingContact.phone_normalized !== incoming.phone) patch.phone_normalized = incoming.phone;
  }

  put('apollo_person_id', incoming.apolloPersonId);

  // Everything else that is an identifier or an enrichment detail, filled in
  // only where the record has a hole.
  for (const field of IDENTIFIER_FIELDS) {
    if (field in patch) continue;
    put(field, newSource[field]);
  }

  // Provenance: which sources have contributed to this record. Append-only, and
  // the one place a merge is allowed to grow an array.
  const source = newSource.source ?? newSource.addedFrom ?? null;
  if (source) {
    const seen = Array.isArray(existingContact.identity_sources) ? existingContact.identity_sources : [];
    if (!seen.includes(source)) patch.identity_sources = [...seen, source];
  }

  if (Object.keys(patch).length > 0) {
    patch.identity_merged_at = new Date().toISOString();
  }

  return patch;
}

/**
 * The normalized identifier fields every contact write should carry.
 *
 * Write paths call this and spread the result into their document. It is what
 * makes the NEXT resolution fast and exact: without `email_normalized` on the
 * record, resolution falls back to case-sensitive matching on `email`.
 */
export function identityFields(candidate = {}) {
  const ids = extractIdentifiers(candidate);
  const out = {};
  if (ids.email) out.email_normalized = ids.email;
  if (ids.linkedinUrl) out.linkedin_url_normalized = ids.linkedinUrl;
  if (ids.phone) out.phone_normalized = ids.phone;
  return out;
}

/**
 * Fields recording that a contact was created despite a weak match.
 *
 * The review flag lives on the record because it describes the RECORD's
 * quality, not the navigation that produced it — unlike navigation intent,
 * which is ephemeral and never persisted.
 */
export function reviewFields(resolution) {
  if (!resolution?.requiresReview) return {};
  return {
    identity_review_required: true,
    identity_review_reason: resolution.signal ?? 'name_company',
    identity_review_candidates: resolution.candidates.map(c => c.id),
    identity_review_flagged_at: new Date().toISOString(),
  };
}

export { normalizeLoose };

export default {
  resolveContactCore,
  IdentityConflictError,
  mergeIdentifiers,
  identityFields,
  reviewFields,
  getResolutionLog,
  clearResolutionLog,
  RESOLUTION,
  MATCH_SIGNALS,
  EXACT_SIGNALS,
  SCAN_WINDOW,
};
