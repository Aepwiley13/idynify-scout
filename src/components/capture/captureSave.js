/**
 * Match and save the people reviewed from one capture.
 *
 * Nothing new decides identity here. Each step is an existing shared path,
 * the same ones Add Manually uses:
 *
 *   person    contactWriteGuard.prepareContactWrite (the locked hierarchy in
 *             utils/identityResolution.js: email, Apollo id, LinkedIn, phone,
 *             then name + company flagged for review, never merged)
 *   company   companyIdentityService.resolveCompany to show the match, and
 *             ensureCompanyForContact to link, promote or create it
 *   document  schemas/userAddedContact.buildUserAddedContact, with the phones
 *             written through contactPhones.buildPhoneWrite
 *
 * PHONES AND IDENTITY
 * ───────────────────
 * The candidate carries the reviewed, typed `phones[]`, so only a mobile,
 * direct or home number can match a person (ADR-002). Two coworkers who share
 * a card's main line stay two people. No company phone is written.
 *
 * RETRIES NEVER DUPLICATE
 * ──────────────────────
 * A person this capture creates gets a document id derived from the capture,
 * `<operationId>_p<n>`, and is created in a transaction only if that document
 * does not exist. A retry, a double tap or a reload of the same scan finds it
 * and returns it. An update to an existing person is additive (fills only
 * what is empty, adds only numbers the record does not have), so repeating it
 * writes nothing new. A company found again on retry is linked, not re-created.
 *
 * A capture is a source, not a person: one capture can produce zero, one or
 * several contacts, which is why the id carries the person's position.
 *
 * SOCIAL PROFILES ARE NEVER IDENTITY
 * ──────────────────────────────────
 * The card's Instagram and Facebook handles are saved to `social_profiles`
 * (src/utils/socialProfiles.js) and play no part in matching: the candidate
 * the resolver sees has none, so two people sharing a business's account stay
 * two people. On an existing contact they are added beside what it has, never
 * in place of it.
 *
 * SAVE LOOKS AGAIN
 * ────────────────
 * The workspace can change between showing a match and saving. Save resolves
 * again, and if the person now resolves differently from what was shown, it
 * writes nothing and returns the new match for the user to confirm.
 */
import { doc, getDoc, runTransaction, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { prepareContactWrite } from '../../services/contactWriteGuard';
import { resolveContact, mergeIdentifiers, RESOLUTION } from '../../services/contactIdentityService';
import { resolveCompany, ensureCompanyForContact, normalizeDomain, workDomainFromEmail, NAME_SOURCE } from '../../services/companyIdentityService';
import { buildUserAddedContact } from '../../schemas/userAddedContact';
import { buildPhoneWrite, readContactPhones } from '../../utils/contactPhones';
import { IdentityConflictError } from '../../utils/identityResolution';
import { makeSocialProfile, mergeSocialProfiles, SOCIAL_SOURCES, SOCIAL_STATUS } from '../../utils/socialProfiles';
import { socialProblems } from './captureDraft.js';

/** `source` / `addedFrom` on what a capture saves. Distinct from the legacy scanner's "Scanned Business Card". */
export const CAPTURE_SOURCE = 'business_card';
/** The write path's name in the identity log. */
const WRITE_PATH = 'ScanBusinessCard';

const trimmed = v => (typeof v === 'string' ? v.trim() : '');
const orNull = v => trimmed(v) || null;

/** The contact id this capture gives the person at `index` (0-based). */
export function captureContactId(operationId, index) {
  return `${operationId}_p${index + 1}`;
}

const contactRef = (uid, id) => doc(db, 'users', uid, 'contacts', id);

/**
 * The reviewed person as a resolver candidate. No id of any kind: the resolver
 * decides identity. `phones[]` makes only a person-level number count.
 */
export function candidateFromDraft(draft) {
  const company = orNull(draft.company);
  return {
    name: orNull(draft.name),
    email: orNull(draft.email),
    linkedin_url: orNull(draft.linkedinUrl),
    title: orNull(draft.title),
    company,
    company_name: company,
    ...buildPhoneWrite(draft.phones ?? []),
    source: CAPTURE_SOURCE,
  };
}

/**
 * The reviewed social rows as stored entries. A row left as the card printed
 * it is observed; one the user chose, typed or edited is user_confirmed.
 */
export function socialProfilesFromDraft(draft, { addedAt = new Date().toISOString() } = {}) {
  return (draft.socials ?? []).map(row => makeSocialProfile({
    text: row.text,
    platform: row.platform,
    observed: row.fromCard ? row.observed : row.text,
    source: row.fromCard ? SOCIAL_SOURCES.BUSINESS_CARD : SOCIAL_SOURCES.USER,
    status: row.confirmed ? SOCIAL_STATUS.USER_CONFIRMED : SOCIAL_STATUS.OBSERVED,
    addedAt,
  })).filter(Boolean);
}

/** The company signal on a draft, for resolveCompany and ensureCompanyForContact. */
function companyCandidate(draft) {
  return { name: orNull(draft.company), domain: orNull(draft.website), email: orNull(draft.email) };
}

// ─── Matching (read-only) ───────────────────────────────────────────────────

/** A resolution (or a refusal) as what the review screen shows. */
function personMatch(resolution) {
  if (resolution.outcome === RESOLUTION.MATCHED) {
    return {
      status: 'existing',
      contactId: resolution.contactId,
      name: resolution.existing?.name ?? null,
      company: resolution.existing?.company_name ?? resolution.existing?.company ?? null,
      matchedOn: resolution.signal,
    };
  }
  if (resolution.outcome === RESOLUTION.REVIEW) {
    return {
      status: 'review',
      matchedOn: resolution.signal,
      candidates: resolution.candidates.map(c => ({ contactId: c.id, name: c.name ?? null, company: c.company_name ?? null })),
    };
  }
  return { status: 'new' };
}

function conflictMatch(error) {
  return { status: 'conflict', matchedOn: error.signal, count: error.contactIds?.length ?? 2 };
}

/**
 * Who this person is in the workspace: new, an existing contact, a possible
 * match to decide (name + company), or a conflict (two existing contacts share
 * one identifier). Read-only.
 */
export async function matchPerson(uid, draft) {
  try {
    return personMatch(await resolveContact(uid, candidateFromDraft(draft), { source: WRITE_PATH }));
  } catch (error) {
    if (error instanceof IdentityConflictError) return conflictMatch(error);
    throw error;
  }
}

/**
 * Which company this person belongs to: an existing one, a possible match
 * (same website or email domain, different printed name), a new one from the
 * printed name, or none. Read-only. A company is never named from a domain
 * here: with no printed name and no match there is no company.
 */
export async function matchCompany(uid, draft) {
  const { name, domain, email } = companyCandidate(draft);
  if (!name && !normalizeDomain(domain) && !workDomainFromEmail(email)) return { status: 'none' };
  const match = await resolveCompany(uid, { name, domain, email }, { source: WRITE_PATH });
  if (match.companyId) {
    const existingName = match.existing?.name ?? null;
    // A domain match is reached only when the printed name matched nothing.
    if (match.signal === 'domain' && name) return { status: 'possible', companyId: match.companyId, name: existingName };
    return { status: 'existing', companyId: match.companyId, name: existingName ?? name };
  }
  return name ? { status: 'new', name } : { status: 'none' };
}

/** Everything the review screen shows before saving one person. */
export async function previewCapturePerson(uid, { operationId, index, draft }) {
  const own = await getDoc(contactRef(uid, captureContactId(operationId, index)));
  if (own.exists()) {
    return { person: { status: 'saved', contactId: own.id, name: own.data()?.name ?? null }, company: { status: 'none' } };
  }
  const [person, company] = await Promise.all([matchPerson(uid, draft), matchCompany(uid, draft)]);
  return { person, company };
}

/** Is a fresh person match the one the user saw? */
function sameMatch(shown, fresh) {
  if (!shown || shown.status !== fresh.status) return false;
  if (fresh.status === 'existing') return shown.contactId === fresh.contactId;
  if (fresh.status === 'review') {
    const ids = list => list.map(c => c.contactId).sort().join(',');
    return ids(shown.candidates) === ids(fresh.candidates);
  }
  return true;
}

// ─── Saving ─────────────────────────────────────────────────────────────────

/** Link, promote or create the company, as the user chose. Returns its id or null. */
async function linkCompany(uid, draft, companyChoice) {
  if (companyChoice === 'none') return null;
  const candidate = companyCandidate(draft);
  // No printed name: link only to a company that already exists (by website
  // or work email). ensureCompanyForContact would otherwise invent a name
  // from the domain, which a card did not print.
  if (!candidate.name) {
    const match = await resolveCompany(uid, candidate, { source: WRITE_PATH });
    if (!match.companyId) return null;
  }
  const { companyId } = await ensureCompanyForContact(uid, candidate, {
    source: CAPTURE_SOURCE,
    nameSource: NAME_SOURCE.USER,
    extraFields: { website_url: candidate.domain },
  });
  return companyId ?? null;
}

/**
 * Numbers on the card that the existing record does not have, by their
 * matching form. Each keeps an id no entry on the record already uses: the
 * profile edits a number by its id.
 */
function newNumbers(existingList, cardList) {
  const key = p => p.normalized ?? trimmed(p.value);
  const have = new Set(existingList.map(key));
  const ids = new Set(existingList.map(p => p.id));
  return cardList.filter(p => key(p) && !have.has(key(p))).map((p) => {
    let id = p.id;
    for (let n = 2; ids.has(id); n += 1) id = `${p.id}-${n}`;
    ids.add(id);
    return { ...p, id };
  });
}

/**
 * The update for an existing contact: identifiers it is missing
 * (mergeIdentifiers), its company if it has none, the card's title and
 * website where it has none, any number it does not already have, and any
 * social profile it does not already have. Never overwrites what the record
 * holds.
 */
function mergePatch(existing, candidate, draft) {
  const patch = mergeIdentifiers(existing, candidate);
  const title = orNull(draft.title);
  if (title && !trimmed(existing.title)) patch.title = title;
  const website = orNull(draft.website);
  if (website && !trimmed(existing.website)) patch.website = website;

  const current = readContactPhones(existing);
  const added = newNumbers(current, buildPhoneWrite(draft.phones ?? []).phones);
  if (added.length > 0) Object.assign(patch, buildPhoneWrite([...current, ...added]));
  Object.assign(patch, mergeSocialProfiles(existing, socialProfilesFromDraft(draft)).patch);

  if (Object.keys(patch).length > 0 && !patch.identity_merged_at) patch.identity_merged_at = new Date().toISOString();
  return patch;
}

/** Create the person once: a transaction that writes only if the capture's document is not there yet. */
async function createOnce(uid, id, data) {
  return runTransaction(db, async (tx) => {
    const ref = contactRef(uid, id);
    const snap = await tx.get(ref);
    if (snap.exists()) return false;
    tx.set(ref, data);
    return true;
  });
}

/**
 * Save one reviewed person.
 *
 * @param {string} uid
 * @param {object} args
 * @param {string} args.operationId   the capture's cap_ id
 * @param {number} args.index         the person's position in the capture (0-based)
 * @param {object} args.draft         the reviewed person (captureDraft.js)
 * @param {object} args.shown         the person match the user saw (previewCapturePerson().person)
 * @param {object} [args.choices]     { person: 'new' | <contactId>, company: 'link' | 'none' }
 *                                    ('none': no company record and no company text)
 *
 * @returns {Promise<
 *   { status: 'saved', contactId, companyId, outcome: 'created' | 'updated' | 'already_saved' }
 *   | { status: 'changed', person }       the match moved: nothing written, show this one
 *   | { status: 'refused', person }       two existing contacts share an identifier
 *   | { status: 'needs_choice', person }  a possible match the user has not answered
 *   | { status: 'invalid', reason }       no_workspace, name_required, or social_needs_platform
 * >}
 */
export async function saveCapturePerson(uid, { operationId, index, draft, shown, choices = {} }) {
  if (!uid || !operationId) return { status: 'invalid', reason: 'no_workspace' };
  if (!orNull(draft.name)) return { status: 'invalid', reason: 'name_required' };
  if (socialProblems(draft).length > 0) return { status: 'invalid', reason: 'social_needs_platform' };

  const id = captureContactId(operationId, index);
  const own = await getDoc(contactRef(uid, id));
  if (own.exists()) return { status: 'saved', contactId: id, companyId: own.data()?.company_id ?? null, outcome: 'already_saved' };

  const candidate = candidateFromDraft(draft);
  let decision;
  try {
    decision = await prepareContactWrite(uid, candidate, { source: WRITE_PATH });
  } catch (error) {
    if (error instanceof IdentityConflictError) return { status: 'refused', person: conflictMatch(error) };
    throw error;
  }

  const fresh = personMatch(decision.resolution);
  if (!sameMatch(shown, fresh)) return { status: 'changed', person: fresh };

  // Which record: the exact match, the possible match the user said is the
  // same person (only one the resolver just offered), or a new one.
  let targetId = null;
  if (fresh.status === 'existing') targetId = fresh.contactId;
  if (fresh.status === 'review') {
    const answer = choices.person;
    if (!answer) return { status: 'needs_choice', person: fresh };
    if (answer !== 'new') {
      if (!fresh.candidates.some(c => c.contactId === answer)) return { status: 'changed', person: fresh };
      targetId = answer;
    }
  }

  const companyChoice = choices.company === 'none' ? 'none' : 'link';
  // No company means no company: neither a company record nor the card's
  // company text on the person.
  const written = companyChoice === 'none' ? { ...draft, company: '' } : draft;
  const companyFree = companyChoice === 'none' ? { ...candidate, company: null, company_name: null } : candidate;

  if (targetId) {
    const existing = targetId === decision.contactId ? decision.existing : (await getDoc(contactRef(uid, targetId))).data();
    if (!existing) return { status: 'changed', person: fresh };
    // An existing person keeps the company they have; a card only fills one in.
    const companyId = existing.company_id || await linkCompany(uid, draft, companyChoice);
    const patch = mergePatch(existing, { ...companyFree, ...(companyId ? { company_id: companyId } : {}) }, written);
    if (Object.keys(patch).length > 0) await updateDoc(contactRef(uid, targetId), patch);
    return { status: 'saved', contactId: targetId, companyId: companyId ?? null, outcome: 'updated' };
  }

  const companyId = await linkCompany(uid, draft, companyChoice);

  // A new person. The user already answered "different person" to a possible
  // match, so the record is not flagged for a review that has been done.
  const identityFields = { ...decision.fields };
  if (fresh.status === 'review') {
    for (const key of Object.keys(identityFields)) if (key.startsWith('identity_review_')) delete identityFields[key];
  }
  const data = buildUserAddedContact({
    identityFields,
    person: { name: draft.name, email: draft.email, company: written.company, title: draft.title, linkedin_url: draft.linkedinUrl },
    companyId,
    source: CAPTURE_SOURCE,
    addedFrom: CAPTURE_SOURCE,
    extra: {
      ...buildPhoneWrite(draft.phones ?? []),
      ...mergeSocialProfiles({}, socialProfilesFromDraft(draft)).patch,
      website: orNull(draft.website),
      identity_sources: [CAPTURE_SOURCE],
      capture_operation_id: operationId,
    },
  });
  const created = await createOnce(uid, id, data);
  return { status: 'saved', contactId: id, companyId, outcome: created ? 'created' : 'already_saved' };
}
