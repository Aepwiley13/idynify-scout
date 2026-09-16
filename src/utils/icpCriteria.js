/**
 * icpCriteria — what counts as a material change to an ICP, and nothing else.
 *
 * WHY THIS EXISTS
 * ───────────────
 * `icpId` on a company used to be a live pointer into a document that kept
 * changing. Editing an ICP therefore rewrote history: production carries a
 * company discovered on 9 July whose ICP document was created on 13 July and
 * has since been renamed and re-scoped, so the system now reports — with a live
 * reference and no error — that a healthcare firm was discovered by a
 * credit-unions profile.
 *
 * The fix is an immutable snapshot per meaningful change. "Meaningful" is the
 * whole question, and it is answered here, once:
 *
 *     A change is material when it could alter whether a company or person
 *     QUALIFIES for the ICP.
 *
 * Renames, descriptions, display order and messaging copy are never material.
 * Scoring weights are not material either: they reorder what already qualified,
 * they do not change who qualifies.
 *
 * ─── ONE LIST, NOT TWO ─────────────────────────────────────────────────────
 * MATERIAL_CRITERIA is the single source for BOTH the fingerprint and any
 * "is this material?" check. A second, independently maintained list is exactly
 * how the two drift apart and a real change stops minting a version — so there
 * is no second list, and a test asserts it.
 */

/**
 * The eligibility-bearing fields, by the question each one answers.
 *
 * Every entry is here because it changes WHO IS RETRIEVED OR ADMITTED, not how
 * they are ranked once admitted:
 *
 *   industries, companyKeywords, lookalikeSeed
 *       feed the Apollo organization keyword/industry query — they decide which
 *       companies are fetched at all.
 *   locations, isNationwide
 *       geography.
 *   companySizes, revenueRanges, skipRevenue, foundedAgeRange
 *       size and age filters; search-companies applies the age range directly.
 *   targetTitles, seniority, personaTitles
 *       who counts as the right person — persona eligibility.
 *
 * Deliberately absent: name, notes, messaging, messagingProgress,
 * scoringWeights, status, isActive, createdAt, updatedAt, managedByBarry,
 * barryConfidenceScore, source, searchStrategy.
 */
export const MATERIAL_CRITERIA = Object.freeze([
  'industries',
  'companyKeywords',
  'lookalikeSeed',
  'locations',
  'isNationwide',
  'companySizes',
  'revenueRanges',
  'skipRevenue',
  'foundedAgeRange',
  'targetTitles',
  'personaTitles',
  'seniority',
]);

/** True when the field participates in eligibility. The only materiality check. */
export function isMaterialField(field) {
  return MATERIAL_CRITERIA.includes(field);
}

// ── Canonical form ──────────────────────────────────────────────────────────

/**
 * Normalize one value so that differences that cannot change eligibility do not
 * register as changes.
 *
 * Arrays are lowercased, trimmed, de-duplicated and SORTED: reordering target
 * titles is a display change, and the approved rule says display order is never
 * material. Empty and absent collapse to the same thing, because an ICP with
 * `locations: []` and one with no `locations` key admit exactly the same set.
 */
function canonicalValue(value) {
  if (value === null || value === undefined) return null;

  if (Array.isArray(value)) {
    const items = value
      .map(v => (v === null || v === undefined ? '' : String(v).trim().toLowerCase()))
      .filter(v => v !== '');
    const unique = [...new Set(items)].sort();
    return unique.length ? unique : null;
  }

  if (typeof value === 'object') {
    // foundedAgeRange and friends: small records like { min, max }.
    const out = {};
    for (const k of Object.keys(value).sort()) {
      const v = canonicalValue(value[k]);
      if (v !== null) out[k] = v;
    }
    return Object.keys(out).length ? out : null;
  }

  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const s = String(value).trim().toLowerCase();
  return s === '' ? null : s;
}

/**
 * The material slice of a profile, in canonical form.
 *
 * Keys are emitted in MATERIAL_CRITERIA order, so the serialization is stable
 * regardless of how the profile document happens to be keyed.
 */
export function materialCriteria(profile = {}) {
  const out = {};
  for (const field of MATERIAL_CRITERIA) {
    const v = canonicalValue(profile?.[field]);
    if (v !== null) out[field] = v;
  }
  return out;
}

/** The canonical string a fingerprint is taken over. Exported for debugging. */
export function criteriaSignature(profile = {}) {
  return JSON.stringify(materialCriteria(profile));
}

// ── Fingerprint ─────────────────────────────────────────────────────────────

/**
 * A 128-bit non-cryptographic digest (cyrb128).
 *
 * This is an EQUALITY KEY, not a security primitive — it never guards access,
 * it only answers "are these the same criteria?". Width matters anyway: a
 * collision would leave a rejection closed that should have reopened, which is
 * a silent wrong answer rather than a loud failure. 128 bits makes that
 * implausible across a workspace's version history.
 */
function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const parts = [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
  return parts.map(p => p.toString(16).padStart(8, '0')).join('');
}

/** The material-criteria fingerprint of a profile. */
export function criteriaFingerprint(profile = {}) {
  return cyrb128(criteriaSignature(profile));
}

/**
 * Did a save change eligibility?
 *
 * This is the mint rule: same fingerprint → no new version; different → append
 * one. A change-then-revert BEFORE saving produces one save with an unchanged
 * fingerprint and mints nothing. A save followed by a later reverting save
 * legitimately mints two versions, because the ICP genuinely existed in two
 * different eligibility states in between.
 */
export function isMaterialChange(previousProfileOrFingerprint, nextProfile) {
  const previous = typeof previousProfileOrFingerprint === 'string'
    ? previousProfileOrFingerprint
    : criteriaFingerprint(previousProfileOrFingerprint ?? {});
  return previous !== criteriaFingerprint(nextProfile ?? {});
}

/**
 * Is a rejection eligible to surface again?
 *
 * ─── FINGERPRINT, NOT VERSION ID ───────────────────────────────────────────
 * Comparing version ids reopens a rejection whenever the version chain moved,
 * even if it moved away and back. If criteria go A → B → A there are three
 * versions and v3's id differs from v1's, but the qualifying criteria are
 * identical — and a company judged under criteria X is not newly judgeable
 * under the same criteria X. So the comparison is on the fingerprint; the
 * version id is kept alongside it purely so the audit trail stays legible.
 */
export function isReEligible({ decidedUnderFingerprint, currentFingerprint }) {
  if (!decidedUnderFingerprint || !currentFingerprint) return false;
  return decidedUnderFingerprint !== currentFingerprint;
}

/** Version document id: readable, ordered, and unique per mint. */
export function criteriaVersionId(fingerprint, createdAtMs = Date.now()) {
  return `${String(fingerprint).slice(0, 12)}_${createdAtMs}`;
}

export default {
  MATERIAL_CRITERIA,
  isMaterialField,
  materialCriteria,
  criteriaSignature,
  criteriaFingerprint,
  isMaterialChange,
  isReEligible,
  criteriaVersionId,
};
