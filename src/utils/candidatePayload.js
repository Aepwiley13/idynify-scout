/**
 * CANDIDATE PAYLOAD — the Team C → Team A handshake object.
 *
 * A search result is a PROPOSAL, not an entity. This module is the only place
 * the UI is allowed to turn a displayed result into something it hands to the
 * resolver, and its single job is to pass identity through UNTOUCHED.
 *
 * ─── THE RULE THAT MATTERS ──────────────────────────────────────────────────
 * Identifiers are passed RAW. We do NOT lowercase email, strip or canonicalise
 * LinkedIn URLs, reformat phone numbers, or reshape Apollo ids.
 *
 * This is not fussiness. Team A's resolver owns normalisation, and identity
 * resolution is only correct if every caller feeds it the same unmodified
 * input. A UI that "helpfully" lowercases an email produces a different match
 * result than one that does not, and the disagreement is invisible until two
 * records exist for one human. `Jane@Acme.com` must arrive as `Jane@Acme.com`.
 *
 * ─── WHAT THIS DELIBERATELY DOES NOT DO ─────────────────────────────────────
 *   · does not mint contactId or companyId
 *   · does not send contactId (a candidate has no canonical identity yet)
 *   · does not persist anything
 *   · does not decide whether the person already exists — that is the resolver's
 *     job, and duplicating it in the UI is how the two drift apart
 */

/** Fields copied verbatim. Order mirrors the published contract. */
const IDENTITY_FIELDS = [
  'email',
  'apollo_person_id',
  'apollo_organization_id',
  'linkedin_url',
  'phone',
];

const DESCRIPTIVE_FIELDS = [
  'name',
  'company_name',
  'company_id',
  'title',
];

/**
 * Mint a UI correlation reference.
 *
 * clientRef exists so React has a stable key, so selection state has something
 * to track, and so a server response can be matched back to the row the user
 * is looking at. It is NOT identity.
 *
 * The `ui_` prefix is deliberate: if one of these ever turns up in a Firestore
 * document id or a contactId field, it is immediately obvious where it came
 * from and that something is wrong.
 */
export function mintClientRef(index = 0) {
  const rand = Math.random().toString(36).slice(2, 10);
  return `ui_${Date.now().toString(36)}_${index}_${rand}`;
}

/** Undefined and empty string both mean "we do not have this". null is the contract's absent value. */
function absentOrRaw(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return value;   // NO transformation. Not trimmed, not cased, not reshaped.
}

/**
 * Build one CandidatePayload from a displayed search result.
 *
 * @param {Object} result   raw provider result as rendered
 * @param {Object} opts
 * @param {'person'|'company'} opts.kind
 * @param {string} opts.source     e.g. 'first_experience.person_search'
 * @param {string} opts.clientRef  the ref already shown in the UI
 * @returns {Object} CandidatePayload
 */
export function buildCandidatePayload(result, { kind, source, clientRef }) {
  if (kind !== 'person' && kind !== 'company') {
    throw new Error(`buildCandidatePayload: kind must be 'person' or 'company', got ${kind}`);
  }
  if (!clientRef) throw new Error('buildCandidatePayload: clientRef is required for UI correlation');

  const payload = { kind };
  for (const f of [...IDENTITY_FIELDS, ...DESCRIPTIVE_FIELDS]) {
    payload[f] = absentOrRaw(result?.[f]);
  }
  payload.source = source || 'unknown';
  payload.clientRef = clientRef;
  return payload;
}

/** Build the payload set for a selection. Order follows what the user saw. */
export function buildCandidatePayloads(results, selectedRefs, { kind, source }) {
  const wanted = selectedRefs instanceof Set ? selectedRefs : new Set(selectedRefs || []);
  return (results || [])
    .filter(r => wanted.has(r.clientRef))
    .map(r => buildCandidatePayload(r, { kind, source, clientRef: r.clientRef }));
}

/**
 * Guard used by tests and by the eventual send path.
 * Returns a list of contract violations; empty means clean.
 */
export function findPayloadViolations(payload) {
  const bad = [];
  if (payload.kind !== 'person' && payload.kind !== 'company') bad.push('kind must be person|company');
  if (!payload.clientRef) bad.push('clientRef missing');
  if (typeof payload.clientRef === 'string' && !payload.clientRef.startsWith('ui_')) {
    bad.push('clientRef must carry the ui_ prefix — it is UI correlation, never identity');
  }
  // A candidate has no canonical identity. If these appear, something upstream
  // has already decided the answer the resolver is supposed to give.
  for (const forbidden of ['contactId', 'contact_id', 'canonicalId', 'personId']) {
    if (payload[forbidden] !== undefined) bad.push(`${forbidden} must never be sent on a candidate`);
  }
  return bad;
}

export const CANDIDATE_FIELDS = ['kind', ...IDENTITY_FIELDS, ...DESCRIPTIVE_FIELDS, 'source', 'clientRef'];
