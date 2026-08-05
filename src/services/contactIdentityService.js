/**
 * contactIdentityService — prevention, not cleanup.
 *
 * WHAT THIS IS
 * ────────────
 * Ten separate code paths can create a contact. Each one built its own
 * duplicate check, and they disagreed: some queried email exactly as typed,
 * some lowercased it, some checked only the Apollo document id, and three
 * checked nothing at all. So the same person could enter the workspace four
 * times — once from a company page, once from a LinkedIn import, once from a
 * Gmail thread and once from a business card — and the workspace had no way to
 * know they were one person.
 *
 * This service is the single answer to "have I already got this person?", run
 * BEFORE any write. It is not historical dedup and it does not merge existing
 * duplicates; those are a separate sprint. It stops the eleventh duplicate
 * from being created.
 *
 * THE LOCKED HIERARCHY
 * ────────────────────
 *   1. Existing Firestore contact ID   — decisive, no query needed
 *   2. Normalized email exact match    — the primary dedup signal
 *   3. Apollo person ID exact match
 *   4. LinkedIn URL exact match
 *   5. Phone exact match
 *   6. Name + company match            — FLAGGED FOR REVIEW, never auto-merged
 *
 * Steps 1–5 are exact-identifier matches: two records sharing one of them are
 * the same person or the data is wrong in a way a fuzzy matcher would not fix.
 * Step 6 is not. "John Smith at Acme" matches a second John Smith at Acme, and
 * auto-merging them silently destroys one person's history. So step 6 returns a
 * flag and a candidate list, and the caller creates the record anyway.
 *
 * EMAIL IS A SIGNAL, NOT AN IDENTITY
 * ──────────────────────────────────
 * The canonical identifier is and remains the Firestore document ID. Email is
 * the strongest dedup signal available, which is a different claim: people
 * change employers and take a new address with them, and people share an
 * inbox. A contact without an email is still a contact — creation is never
 * blocked for a missing email. It is created with whatever provider IDs exist
 * and, when only a weak signal matched, a review flag.
 *
 * EVERY DECISION IS LOGGED
 * ────────────────────────
 * Silent dedup is worse than no dedup: a user who saves a contact and sees
 * nothing appear has no way to tell "already had them" from "the save failed".
 * Every resolution logs its outcome, the signal that produced it, and the
 * identifiers considered.
 */

import { collection, doc, getDoc, getDocs, query, where, limit } from 'firebase/firestore';
import { db } from '../firebase/config';

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

// ── Normalization ───────────────────────────────────────────────────────────

/**
 * Normalize an email for matching: lowercase, trim.
 *
 * Deliberately NOT doing more than the brief specifies. Gmail dot-stripping and
 * plus-tag removal are tempting and wrong here: `a.b@gmail.com` and
 * `ab@gmail.com` are the same Gmail inbox but different addresses at most other
 * providers, and `user+acme@` is a real routing distinction people rely on.
 * Over-normalizing merges two people; under-normalizing creates a duplicate the
 * user can see and fix. The second failure is the recoverable one.
 *
 * @returns {string|null} normalized address, or null if there isn't one
 */
export function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) return null;
  return trimmed;
}

/**
 * Normalize a LinkedIn URL for matching.
 *
 * The same profile arrives as `https://www.linkedin.com/in/jane-doe/`,
 * `http://linkedin.com/in/jane-doe`, and `linkedin.com/in/jane-doe?trk=…`.
 * Scheme, `www.`, trailing slash, query string and case are all noise.
 */
export function normalizeLinkedInUrl(url) {
  if (typeof url !== 'string') return null;
  let value = url.trim().toLowerCase();
  if (!value) return null;
  value = value.split('?')[0].split('#')[0];
  value = value.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  return value || null;
}

/**
 * Normalize a phone number to its digits, keeping a leading +.
 *
 * `(415) 555-0100`, `415-555-0100` and `+1 415 555 0100` are the same number
 * written three ways. Note the last one normalizes to `+14155550100` and the
 * first two to `4155550100` — this does NOT infer a country code, because
 * guessing +1 for a workspace selling into Europe would merge unrelated people.
 */
export function normalizePhone(phone) {
  if (typeof phone !== 'string' && typeof phone !== 'number') return null;
  const raw = String(phone).trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 7) return null; // too short to identify anyone
  return raw.startsWith('+') ? `+${digits}` : digits;
}

/** Normalize a name/company for the weak comparison in step 6. */
function normalizeLoose(value) {
  if (typeof value !== 'string') return null;
  const out = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return out || null;
}

// ── Candidate shaping ───────────────────────────────────────────────────────

/**
 * Pull the identifiers out of whatever shape a write path happens to hold.
 *
 * Apollo payloads, Gmail headers, OCR output and hand-typed forms all name
 * these fields differently — `organization_name` vs `company_name` vs
 * `company`, `phone_numbers[0].sanitized_number` vs `phone`. Every caller
 * normalizing that itself is how the ten write paths diverged in the first
 * place, so it happens once, here.
 */
export function extractIdentifiers(candidate = {}) {
  const email = normalizeEmail(
    candidate.email
    ?? candidate.work_email
    ?? candidate.email_address
    ?? null
  );

  const phoneSource =
    candidate.phone
    ?? candidate.phone_mobile
    ?? candidate.mobile_phone
    ?? candidate.phone_numbers?.[0]?.sanitized_number
    ?? candidate.phone_numbers?.[0]
    ?? null;

  return {
    contactId: candidate.contactId ?? candidate.contact_id ?? null,
    email,
    apolloPersonId: candidate.apollo_person_id ?? candidate.apolloPersonId ?? null,
    linkedinUrl: normalizeLinkedInUrl(candidate.linkedin_url ?? candidate.linkedinUrl ?? null),
    phone: normalizePhone(phoneSource),
    name: normalizeLoose(
      candidate.name
      ?? [candidate.first_name ?? candidate.firstName, candidate.last_name ?? candidate.lastName]
        .filter(Boolean).join(' ')
    ),
    company: normalizeLoose(
      candidate.company_name
      ?? candidate.companyName
      ?? candidate.company
      ?? candidate.organization_name
      ?? candidate.organization?.name
      ?? null
    ),
    companyId: candidate.company_id ?? candidate.companyId ?? null,
  };
}

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

// ── Firestore lookups ───────────────────────────────────────────────────────

const contactsRef = (userId) => collection(db, 'users', userId, 'contacts');

/**
 * One equality query, returning the first hit as {id, ...data}.
 *
 * Single-field equality queries need no composite index, which is why the
 * hierarchy is five separate cheap queries rather than one clever compound
 * one. Failures are caught and logged, never swallowed: a permission error
 * here would otherwise present as "no duplicate found" and quietly create one.
 */
async function findBy(userId, field, value) {
  if (!value) return null;
  try {
    const snap = await getDocs(query(contactsRef(userId), where(field, '==', value), limit(5)));
    if (snap.empty) return null;
    const hit = snap.docs[0];
    return { id: hit.id, ...hit.data() };
  } catch (err) {
    console.error('[contact-identity] lookup failed', { field, value, code: err?.code, message: err?.message });
    // Rethrow: a caller must not treat a failed lookup as "no duplicate".
    // Creating a duplicate because Firestore was unreachable is worse than
    // surfacing the error to the user who pressed Save.
    throw err;
  }
}

/** How many documents the normalizing fallback scan will read. See below. */
export const SCAN_WINDOW = 200;

/**
 * The normalizing fallback scan.
 *
 * FIRESTORE EQUALITY IS CASE-SENSITIVE, and that is the whole reason this
 * exists. A contact stored as `email: 'Gentry.Moyes@Acme.com'` — which is what
 * a Gmail header or a hand-typed form produces — is not matched by
 * `where('email','==','gentry.moyes@acme.com')`. Neither is a LinkedIn URL
 * stored with a scheme, a `www.` and a trailing slash matched by a query for
 * its normalized form. Every equality query in the world would report "no
 * duplicate" and the duplicate would be created.
 *
 * Records written from this sprint forward carry `email_normalized`,
 * `linkedin_url_normalized` and `phone_normalized`, and those ARE matchable by
 * query. The scan is what covers everything written before — and it is what
 * fills those fields in, because a resolution that matches by scan merges the
 * normalized forms onto the record it found.
 *
 * Bounded at SCAN_WINDOW documents and run at most ONCE per resolution: the
 * exact queries run first, and this only loads if they all miss. Step 6 reuses
 * the same window rather than reading again.
 */
async function loadScanWindow(userId, cache) {
  if (cache.records) return cache.records;
  if (cache.failed) return [];

  try {
    const snap = await getDocs(query(contactsRef(userId), limit(SCAN_WINDOW)));
    cache.records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return cache.records;
  } catch (err) {
    console.error('[contact-identity] fallback scan failed', { code: err?.code, message: err?.message });
    // Not fatal, and deliberately different from the query failures above: the
    // exact queries have already run and succeeded, so the workspace IS
    // reachable. Degrade to "no fallback match" rather than blocking a save.
    cache.failed = true;
    return [];
  }
}

/** First record in the scan window whose normalized `key` equals `value`. */
async function findByNormalized(userId, cache, key, value) {
  if (!value) return null;
  const records = await loadScanWindow(userId, cache);
  return records.find(r => extractIdentifiers(r)[key] === value) ?? null;
}

/**
 * Email lookup across the shapes email has been stored in.
 *
 * Two cheap equality queries first (`email_normalized`, then `email` at its
 * normalized value, which covers the many sources that already lowercase), and
 * the normalizing scan only if both miss.
 */
async function findByEmail(userId, cache, normalized) {
  if (!normalized) return null;

  const [byNormalizedField, byExactEmail] = await Promise.all([
    findBy(userId, 'email_normalized', normalized),
    findBy(userId, 'email', normalized),
  ]);

  return byNormalizedField
    ?? byExactEmail
    ?? await findByNormalized(userId, cache, 'email', normalized);
}

/** LinkedIn lookup: normalized field first, then the normalizing scan. */
async function findByLinkedIn(userId, cache, normalized) {
  if (!normalized) return null;
  return await findBy(userId, 'linkedin_url_normalized', normalized)
    ?? await findByNormalized(userId, cache, 'linkedinUrl', normalized);
}

/** Phone lookup: normalized field first, then the normalizing scan. */
async function findByPhone(userId, cache, normalized) {
  if (!normalized) return null;
  return await findBy(userId, 'phone_normalized', normalized)
    ?? await findByNormalized(userId, cache, 'phone', normalized);
}

/**
 * Step 6: name + company. Returns ALL candidates, never picks one.
 *
 * Filters the same scan window the fallbacks used, because
 * `where('name','==',…)` is case-sensitive and the same person is stored as
 * "Jane Doe", "jane doe" and "Jane  Doe" depending on the source. A workspace
 * larger than the window is one where the exact signals above have already
 * done the work.
 */
async function findWeakCandidates(userId, cache, ids) {
  if (!ids.name || !(ids.company || ids.companyId)) return [];

  const records = await loadScanWindow(userId, cache);
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
 * @param {string} userId     Workspace owner (uid).
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
 * that the service refuses to choose.
 */
export async function resolveContact(userId, candidate, { source = 'unknown' } = {}) {
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

  if (!userId) {
    // No workspace to resolve against. Treated as 'new' so the caller's own
    // auth failure surfaces at the write, not as a confusing dedup error.
    logResolution({ ...result, source, note: 'no userId' });
    return result;
  }

  // 1 — existing Firestore contact ID. Decisive: it IS the canonical identity.
  if (identifiers.contactId) {
    const snap = await getDoc(doc(db, 'users', userId, 'contacts', identifiers.contactId));
    if (snap.exists()) {
      Object.assign(result, {
        outcome: RESOLUTION.MATCHED,
        contactId: snap.id,
        existing: { id: snap.id, ...snap.data() },
        signal: 'firestore_id',
      });
      logResolution({ ...result, source });
      return result;
    }
  }

  // One scan window per resolution, shared by every fallback below and by
  // step 6. Loaded lazily — a candidate that matches on an exact query never
  // pays for it.
  const scanCache = { records: null, failed: false };

  // 2–5 — exact identifier matches, in locked order.
  const exactChecks = [
    { signal: 'email', run: () => findByEmail(userId, scanCache, identifiers.email) },
    { signal: 'apollo_person_id', run: () => findBy(userId, 'apollo_person_id', identifiers.apolloPersonId) },
    { signal: 'linkedin_url', run: () => findByLinkedIn(userId, scanCache, identifiers.linkedinUrl) },
    { signal: 'phone', run: () => findByPhone(userId, scanCache, identifiers.phone) },
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
  const weak = await findWeakCandidates(userId, scanCache, identifiers);
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
 * @returns {object} patch — safe to updateDoc() directly.
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
 * record, resolveContact falls back to case-sensitive matching on `email`.
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

export default {
  resolveContact,
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
