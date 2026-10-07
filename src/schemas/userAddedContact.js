/**
 * userAddedContact — the contact document for a person the USER brought in.
 *
 * Add Manually and the CSV import are the same act: the user is handing
 * IDYNIFY a person it did not discover. They used to build that document by
 * hand, separately, and drifted — the CSV path wrote no `company_id`, no
 * `company_name`, no `person_type` and no `addedFrom`, so a CSV contact showed
 * no company in People, could not be filtered as a CSV import, and fell out of
 * the Leads lens. One builder means the two paths cannot disagree about what a
 * user-added contact is; each passes only what is genuinely its own in
 * `extra` (Manual's address and website, the CSV's import provenance).
 *
 * This builds the document. It does NOT decide identity: callers run
 * `prepareContactWrite` first and pass its `fields` as `identityFields`, which
 * carry the normalized identifiers, the status triple and `is_archived`.
 */

import { CONTACT_STATUSES } from '../utils/contactStateMachine';

const orNull = (v) => {
  if (v === undefined || v === null) return null;
  const s = typeof v === 'string' ? v.trim() : v;
  return s === '' ? null : s;
};

/**
 * @param {object} args
 * @param {object} args.identityFields   `prepareContactWrite(...).fields`
 * @param {object} args.person           { name, email, phone, company, title, linkedin_url }
 * @param {string|null} args.companyId   from `ensureCompanyForContact`
 * @param {string} args.source           e.g. 'manual' | 'referral' | 'csv_import'
 * @param {string} args.addedFrom        one of peopleSchema ADDED_FROM_SOURCES
 * @param {string|null} [args.addedFromSource]
 * @param {object} [args.extra]          path-specific fields, spread last
 * @param {string} [args.now]            ISO timestamp (injectable for tests)
 */
export function buildUserAddedContact({
  identityFields = {},
  person = {},
  companyId = null,
  source,
  addedFrom,
  addedFromSource = null,
  extra = {},
  now = new Date().toISOString(),
}) {
  const company = orNull(person.company);
  return {
    ...identityFields,
    name: orNull(person.name) ?? '',
    email: orNull(person.email),
    phone: orNull(person.phone),
    company,
    company_id: companyId ?? null,
    company_name: company,
    title: orNull(person.title),
    linkedin_url: orNull(person.linkedin_url),

    // Relationship classification
    person_type: 'lead',
    stage_source: 'auto',

    // Source tracking
    source,
    enrichment_status: 'user_added',
    addedFrom,
    addedFromSource,

    // Scout metadata
    lead_status: 'saved',
    contact_status: CONTACT_STATUSES.NEW,
    contact_status_updated_at: now,
    export_ready: true,
    addedAt: now,
    is_archived: false,   // required by every contact reader — never omit

    // Placeholder for future enrichment
    apollo_data: null,
    enriched: false,

    ...extra,
  };
}

export default { buildUserAddedContact };
