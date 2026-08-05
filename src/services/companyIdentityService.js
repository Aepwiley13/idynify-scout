/**
 * companyIdentityService — one Apollo organization, one company document.
 *
 * THE BUG THIS CLOSES
 * ───────────────────
 * Apollo's organization id was written under two different field names:
 *
 *   search-companies.js   apollo_organization_id     dedups on apollo_organization_id
 *   CompanySearch.jsx     apollo_organization_id     dedups on apollo_organization_id
 *   LinkedInLinkSearch    apollo_id                  dedups on apollo_id
 *   FindContact.jsx       apollo_id                  dedups on apollo_id
 *   ContactSearch.jsx     apollo_id                  dedups on apollo_id
 *
 * Each path's dedup query was correct about its own field and blind to the
 * other. So a company discovered through Scout and then re-encountered through
 * a LinkedIn import produced two documents for one organization, each with its
 * own contact_count, its own status and its own half of the contacts. Nothing
 * errored. The company simply appeared twice in Saved Companies.
 *
 * `apollo_organization_id` is the standard from here. `apollo_id` is still
 * WRITTEN as a compatibility alias — CSVUpload, SharedCompaniesView, DailyLeads
 * and the netlify functions all read one or the other, and removing the old
 * field would break the readers that have not moved. It is a mirror, not a
 * second source of truth: both are written from the same value, and lookups
 * check both so a historical document written under either name is found.
 */

import { collection, getDocs, query, where, limit } from 'firebase/firestore';
import { db } from '../firebase/config';

/** The standard field. Everything else is a compatibility alias. */
export const APOLLO_ORG_FIELD = 'apollo_organization_id';

/** Fields that have held an Apollo organization id, newest convention first. */
export const APOLLO_ORG_FIELD_ALIASES = Object.freeze(['apollo_organization_id', 'apollo_id']);

/**
 * Read an Apollo organization id off any company-ish payload.
 *
 * Apollo returns it as `organization_id` on a person, `id` on an organization,
 * and the app has stored it as both `apollo_organization_id` and `apollo_id`.
 * One reader for all five shapes.
 */
export function readApolloOrgId(source = {}) {
  return (
    source.apollo_organization_id
    ?? source.apollo_id
    ?? source.organization_id
    ?? source.organization?.id
    ?? null
  );
}

/**
 * The Apollo id fields a company document should carry.
 *
 * Both names, same value — see the header for why the alias stays. Returns an
 * empty object for a company with no Apollo id (a manual add, a business card),
 * so spreading it is always safe.
 */
export function apolloIdFields(apolloOrgId) {
  if (!apolloOrgId) return {};
  return {
    apollo_organization_id: apolloOrgId,
    // Compatibility alias. Remove only once every reader below has moved:
    //   src/components/shared/SharedCompaniesView.jsx
    //   src/pages/Scout/DailyLeads.jsx  (company pool filter)
    //   netlify/functions/*             (enrichment lookups)
    apollo_id: apolloOrgId,
  };
}

/**
 * Find an existing company for an Apollo organization id.
 *
 * Queries BOTH field names, in parallel. A workspace that predates this sprint
 * has companies written under either one, and checking only the standard field
 * would report "no duplicate" for every company saved through the three
 * LinkedIn/search paths.
 *
 * @returns {Promise<{id: string}&object|null>}
 */
export async function findCompanyByApolloId(userId, apolloOrgId) {
  if (!userId || !apolloOrgId) return null;

  const companies = collection(db, 'users', userId, 'companies');

  const lookups = APOLLO_ORG_FIELD_ALIASES.map(async (field) => {
    try {
      const snap = await getDocs(query(companies, where(field, '==', apolloOrgId), limit(1)));
      if (snap.empty) return null;
      return { id: snap.docs[0].id, ...snap.docs[0].data(), _matchedField: field };
    } catch (err) {
      console.error('[company-identity] lookup failed', { field, code: err?.code, message: err?.message });
      throw err;
    }
  });

  const results = await Promise.all(lookups);
  return results.find(Boolean) ?? null;
}

/**
 * Find an existing company by exact name.
 *
 * The fallback for companies with no Apollo id at all — business cards, manual
 * adds, CSV rows. Weaker than an id match and deliberately exact: "Acme" and
 * "Acme Corp" are not provably the same organization, and merging them on a
 * prefix would fold subsidiaries into parents.
 */
export async function findCompanyByName(userId, name) {
  if (!userId || !name) return null;
  const trimmed = String(name).trim();
  if (!trimmed) return null;

  try {
    const snap = await getDocs(query(
      collection(db, 'users', userId, 'companies'),
      where('name', '==', trimmed),
      limit(1),
    ));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data(), _matchedField: 'name' };
  } catch (err) {
    console.error('[company-identity] name lookup failed', { code: err?.code, message: err?.message });
    throw err;
  }
}

/**
 * The dedup check every company creation path runs before writing.
 *
 * @returns {Promise<{ companyId: string|null, existing: object|null, signal: string|null }>}
 */
export async function resolveCompany(userId, candidate = {}, { source = 'unknown' } = {}) {
  const apolloOrgId = readApolloOrgId(candidate);
  const name = candidate.name ?? candidate.company_name ?? candidate.organization_name ?? null;

  if (apolloOrgId) {
    const hit = await findCompanyByApolloId(userId, apolloOrgId);
    if (hit) {
      console.info('[company-identity] matched existing company on apollo id', {
        source, companyId: hit.id, field: hit._matchedField, apolloOrgId,
      });
      return { companyId: hit.id, existing: hit, signal: 'apollo_organization_id' };
    }
  }

  if (name) {
    const hit = await findCompanyByName(userId, name);
    if (hit) {
      console.info('[company-identity] matched existing company on name', { source, companyId: hit.id, name });
      return { companyId: hit.id, existing: hit, signal: 'name' };
    }
  }

  console.info('[company-identity] no match — new company', { source, apolloOrgId, name });
  return { companyId: null, existing: null, signal: null };
}

export default {
  APOLLO_ORG_FIELD,
  readApolloOrgId,
  apolloIdFields,
  findCompanyByApolloId,
  findCompanyByName,
  resolveCompany,
};
