/**
 * contactWriteGuard — the one function every contact creation path calls.
 *
 * Ten write paths, ten hand-rolled duplicate checks, ten opinions about what
 * "already have them" means. This collapses that into a single call that runs
 * the locked identity hierarchy and returns a decision:
 *
 *   { action: 'merge',  contactId, patch }   an existing contact — update it
 *   { action: 'create', contactId, fields }  new — write with these extras
 *
 * The caller keeps ownership of its own document shape. This does NOT build the
 * contact record: the write paths write genuinely different field sets (Apollo
 * payloads, OCR output, Gmail headers) and normalising those is a data-model
 * change this sprint is not. What it adds is the identity envelope — normalized
 * identifiers, the three status dimensions, and a review flag when the only
 * match was weak.
 *
 * WHY 'merge' RATHER THAN 'skip'
 * ──────────────────────────────
 * The old checks all said "already in your pipeline" and stopped. That threw
 * away everything the new source knew: a LinkedIn import of someone already in
 * the workspace from a Gmail thread carries a LinkedIn URL and an Apollo id the
 * record does not have. Discarding it means the next import creates the
 * duplicate instead, because the record still has nothing to match on.
 * Merging identifiers onto the canonical record makes each near-miss make the
 * NEXT match more certain.
 */

import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  resolveContact,
  mergeIdentifiers,
  identityFields,
  reviewFields,
  RESOLUTION,
} from './contactIdentityService';
import { createStatusFields, RECORD_STATUS, RELATIONSHIP_STATUS, STAGE } from '../constants/statusModel';

/**
 * Resolve identity and return what the caller should do.
 *
 * @param {string} userId
 * @param {object} candidate            The incoming contact payload.
 * @param {object} [options]
 * @param {string} [options.source]     Write path name — appears in the log.
 * @param {string} [options.recordStatus]
 * @param {string} [options.relationshipStatus]
 * @param {string} [options.stage]
 *
 * @returns {Promise<{
 *   action: 'merge'|'create',
 *   contactId: string|null,
 *   existing: object|null,
 *   patch: object,
 *   fields: object,
 *   resolution: object,
 * }>}
 *
 * `fields` is what a creating caller spreads into its document:
 * email_normalized / linkedin_url_normalized / phone_normalized, the three
 * status dimensions, is_archived, and review flags when applicable.
 */
export async function prepareContactWrite(userId, candidate, {
  source = 'unknown',
  recordStatus = RECORD_STATUS.ACTIVE,
  relationshipStatus = RELATIONSHIP_STATUS.NEW,
  stage = STAGE.SCOUT,
} = {}) {
  const resolution = await resolveContact(userId, candidate, { source });

  if (resolution.outcome === RESOLUTION.MATCHED && resolution.contactId) {
    return {
      action: 'merge',
      contactId: resolution.contactId,
      existing: resolution.existing,
      patch: mergeIdentifiers(resolution.existing, candidate),
      fields: {},
      resolution,
    };
  }

  return {
    action: 'create',
    contactId: null,
    existing: null,
    patch: {},
    fields: {
      ...identityFields(candidate),
      ...createStatusFields({ recordStatus, relationshipStatus, stage }),
      ...reviewFields(resolution),
      identity_source: source,
    },
    resolution,
  };
}

/**
 * Apply a merge decision.
 *
 * Separate from prepareContactWrite so a caller can decide NOT to merge —
 * a bulk importer may prefer to count skips rather than issue N writes. Skips
 * the write entirely when the patch is empty, which is the common case for a
 * re-import of an already-complete record.
 *
 * @returns {Promise<boolean>} whether anything was written.
 */
export async function applyContactMerge(userId, decision) {
  if (decision?.action !== 'merge' || !decision.contactId) return false;
  if (Object.keys(decision.patch).length === 0) {
    console.info('[contact-identity] merge produced no new fields — nothing written', {
      contactId: decision.contactId,
    });
    return false;
  }

  await updateDoc(doc(db, 'users', userId, 'contacts', decision.contactId), decision.patch);
  console.info('[contact-identity] merged new identifiers onto existing contact', {
    contactId: decision.contactId,
    fields: Object.keys(decision.patch),
  });
  return true;
}

/**
 * Resolve, and merge in one call, for paths that only need "did this already
 * exist?" and do not build a document when it did.
 *
 * @returns {Promise<{ existed: boolean, contactId: string|null, decision: object }>}
 */
export async function resolveOrPrepare(userId, candidate, options) {
  const decision = await prepareContactWrite(userId, candidate, options);
  if (decision.action === 'merge') {
    await applyContactMerge(userId, decision);
    return { existed: true, contactId: decision.contactId, decision };
  }
  return { existed: false, contactId: null, decision };
}

/**
 * Does a document already exist at this deterministic id?
 *
 * Several Apollo paths build ids as `{companyId}_{apolloPersonId}` and rely on
 * setDoc's overwrite semantics as their only dedup. That still works and is
 * still cheap, so it stays as a fast path in front of the full hierarchy —
 * it is hierarchy step 1 with the id already known.
 */
export async function documentExists(userId, contactId) {
  if (!userId || !contactId) return false;
  const snap = await getDoc(doc(db, 'users', userId, 'contacts', contactId));
  return snap.exists();
}

export default { prepareContactWrite, applyContactMerge, resolveOrPrepare, documentExists };
