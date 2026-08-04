/**
 * companySchema — the canonical shape guarantee for company documents.
 *
 * Why this exists, given companies are currently written correctly:
 *
 * Contacts had no equivalent guarantee. `createPersonRecord` existed, but its
 * only wrapper had no callers, so every Scout write path built its document by
 * hand — and each one independently forgot `is_archived`. Firestore does not
 * complain about a missing field; it just stops matching the document. The
 * result was contacts that were visible everywhere except the one place that
 * filtered on the field, and it took a staging review to notice.
 *
 * Companies avoided that by luck rather than structure: all six creation sites
 * happen to write `status`, because each was copied from the last. There is no
 * factory, so the seventh write path — whenever someone adds it — has nothing
 * to copy from except another hand-built literal, and the same failure is one
 * omission away.
 *
 * So: route company creation through here. The factory guarantees `status`
 * exists and rejects values outside the vocabulary that read paths actually
 * query for. It deliberately does NOT normalise the rest of the document —
 * the six sites write genuinely different field sets (apollo_id vs
 * apollo_organization_id, saved_at vs found_at, ISO strings vs Date objects),
 * and reconciling those is a data-model change this is not.
 *
 * Status vocabulary, from the read paths that consume it:
 *   pending   → written by netlify/functions/search-companies.js on discovery
 *   accepted  → the user kept it; what SavedCompanies and Mission Control show
 *   rejected  → the user dismissed it (admin counts read this)
 *   archived  → soft-deleted via companyArchiveService
 *
 * Note what is NOT here: 'active'. Nothing reads it. A company written with
 * status 'active' would disappear from Saved Companies as surely as a contact
 * without is_archived disappeared from search — which is why this throws
 * rather than passing an unknown value through.
 */

export const COMPANY_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  ARCHIVED: 'archived',
};

export const COMPANY_STATUSES = Object.values(COMPANY_STATUS);

/**
 * Build a company document with its required fields guaranteed.
 *
 * Every field the caller passes is preserved as-is. Only `status` is defaulted
 * (to 'accepted' — a company reaching a creation site is one the user kept)
 * and validated.
 *
 * @param   {Object} fields  The caller's company document.
 * @returns {Object} The same document, with `status` guaranteed valid.
 * @throws  {Error}  If `name` is missing, or `status` is outside the vocabulary.
 */
export function createCompanyRecord(fields = {}) {
  const status = fields.status ?? COMPANY_STATUS.ACCEPTED;

  if (!COMPANY_STATUSES.includes(status)) {
    throw new Error(
      `createCompanyRecord: unknown status "${status}". ` +
      `Read paths query for ${COMPANY_STATUSES.join(' | ')} — anything else is invisible to them.`
    );
  }

  if (!fields.name) {
    throw new Error('createCompanyRecord: name is required — company lists and search both key off it.');
  }

  return { ...fields, status };
}

export default createCompanyRecord;
