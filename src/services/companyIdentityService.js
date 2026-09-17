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

import { collection, doc, getDocs, limit, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { normalizeLoose } from '../utils/identityNormalization';
import { createCompanyRecord, COMPANY_STATUS } from '../schemas/companySchema';
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
 * How many company documents the case-insensitive fallback will read.
 *
 * Mirrors the contact resolver's bounded-scan posture. Discovery writes 50–100
 * companies per search, so this covers a typical workspace outright while
 * staying a fixed, predictable cost.
 */
export const COMPANY_SCAN_WINDOW = 200;

/**
 * Find an existing company by name.
 *
 * The fallback for companies with no Apollo id at all — business cards, manual
 * adds, CSV rows.
 *
 * ─── EXACT FIRST, THEN CASE-INSENSITIVE (Gate 2 Phase 2e) ──────────────────
 *
 * Firestore equality is case-sensitive, so `where('name','==','Acme Corp')`
 * never matched a record stored as `acme corp` — and the two arrive from
 * different sources constantly: Apollo title-cases, a business card is whatever
 * was printed, a CSV is whatever was typed. Every one of those pairs produced
 * two company documents, each with its own status and its own half of the
 * contacts.
 *
 * The second rung compares `normalizeLoose` forms — the SAME normalizer the
 * contact resolver uses for its name+company step, so the two cannot disagree
 * about what "the same name" means.
 *
 * Still deliberately NOT fuzzy. "Acme" and "Acme Corp" remain different
 * companies: normalizeLoose only collapses case and whitespace. Matching on a
 * prefix would fold subsidiaries into parents, which is unrecoverable.
 *
 * Returns the single match, or refuses when the loose form maps to two
 * DIFFERENT companies — the company-side equivalent of the contact resolver's
 * authoritative-collision rule. A name is not authoritative enough to merge on
 * when it is ambiguous.
 */
export async function findCompanyByName(userId, name) {
  if (!userId || !name) return null;
  const trimmed = String(name).trim();
  if (!trimmed) return null;

  const companies = collection(db, 'users', userId, 'companies');

  try {
    const exact = await getDocs(query(companies, where('name', '==', trimmed), limit(1)));
    if (!exact.empty) {
      return { id: exact.docs[0].id, ...exact.docs[0].data(), _matchedField: 'name' };
    }

    const loose = normalizeLoose(trimmed);
    if (!loose) return null;

    // Deliberately unordered, for the same reason the contact scan is — an
    // ordering on `name` would exclude every company document missing the
    // field, and doing that silently is how a dedup check stops deduping.
    const window = await getDocs(query(companies, limit(COMPANY_SCAN_WINDOW)));
    const hits = window.docs.filter(d => normalizeLoose(d.data()?.name) === loose);

    if (hits.length === 0) return null;
    if (hits.length > 1) {
      console.warn('[company-identity] name maps to several companies — refusing to choose', {
        name: trimmed, companyIds: hits.map(d => d.id),
      });
      return null;
    }
    return { id: hits[0].id, ...hits[0].data(), _matchedField: 'name_normalized' };
  } catch (err) {
    console.error('[company-identity] name lookup failed', { code: err?.code, message: err?.message });
    throw err;
  }
}

/**
 * Mailbox providers. A contact at one of these has a personal address, not a
 * company one, so the domain says nothing about where they work.
 */
export const FREE_EMAIL_DOMAINS = Object.freeze(new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com',
  'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'protonmail.com', 'proton.me', 'gmx.com', 'mail.com', 'zoho.com',
  'yandex.com', 'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net',
]));

/**
 * Reduce anything domain-shaped to a bare host.
 *
 * Callers hand this whatever they have — `acme.com`, `www.acme.com`,
 * `https://www.acme.com/about`, a trailing-dot FQDN — and stored company
 * documents are just as varied, because `domain`, `primary_domain` and
 * `website_url` were each populated by a different source. One normalizer for
 * both sides, so a comparison cannot be defeated by a protocol prefix.
 */
export function normalizeDomain(value) {
  const host = String(value ?? '')
    .trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]
    .replace(/\.$/, '');
  return host.includes('.') ? host : null;
}

/** The domain part of an email, normalized — null for a mailbox provider. */
export function workDomainFromEmail(email) {
  const at = String(email ?? '').trim().toLowerCase();
  if (!at.includes('@')) return null;
  const domain = normalizeDomain(at.slice(at.lastIndexOf('@') + 1));
  if (!domain) return null;
  return FREE_EMAIL_DOMAINS.has(domain) ? null : domain;
}

/**
 * A provisional company name from a work-email domain.
 *
 * Deliberately a guess, and labelled as one by the caller: `rd-advantage.com`
 * becomes "Rd Advantage" where the organization actually writes itself "R&D
 * Advantage". A derived name is still strictly better than no company at all —
 * the contact gets a home, the document carries the `domain` that produced it,
 * and Apollo enrichment can correct the name later against that domain. What it
 * must NOT do is masquerade as authoritative, which is why companies created
 * this way carry `name_source: 'email_domain'`.
 */
export function companyNameFromDomain(domain) {
  const label = String(domain ?? '').split('.')[0];
  if (!label) return null;
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || null;
}

/**
 * Find an existing company by its domain.
 *
 * The third rung, below Apollo id and name. It exists because the LinkedIn
 * import routinely returns a person with a work email and no organization at
 * all — Apollo knows `patrick@blackdesertresort.com` without knowing Black
 * Desert Resort — and for those the domain is the only company signal present.
 *
 * Reads the three fields companies have stored a domain under, and compares
 * host-only forms so `https://www.acme.com/about` matches `acme.com`.
 */
export async function findCompanyByDomain(userId, domain) {
  if (!userId) return null;
  const target = normalizeDomain(domain);
  if (!target) return null;

  try {
    // Unordered for the same reason the name scan is: ordering on a domain
    // field would exclude every company document that lacks it.
    const window = await getDocs(query(collection(db, 'users', userId, 'companies'), limit(COMPANY_SCAN_WINDOW)));
    const hits = window.docs.filter((d) => {
      const data = d.data() ?? {};
      return [data.domain, data.primary_domain, data.website_url, data.website]
        .some(v => v && normalizeDomain(v) === target);
    });

    if (hits.length === 0) return null;
    if (hits.length > 1) {
      console.warn('[company-identity] domain maps to several companies — refusing to choose', {
        domain: target, companyIds: hits.map(d => d.id),
      });
      return null;
    }
    return { id: hits[0].id, ...hits[0].data(), _matchedField: 'domain' };
  } catch (err) {
    console.error('[company-identity] domain lookup failed', { code: err?.code, message: err?.message });
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
  const domain = normalizeDomain(candidate.domain) ?? workDomainFromEmail(candidate.email);

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

  // Third rung. Only reached when there is no Apollo id and no name match, so
  // it can never override a stronger signal — it only rescues the contacts
  // those two do not see at all.
  if (domain) {
    const hit = await findCompanyByDomain(userId, domain);
    if (hit) {
      console.info('[company-identity] matched existing company on domain', { source, companyId: hit.id, domain });
      return { companyId: hit.id, existing: hit, signal: 'domain' };
    }
  }

  console.info('[company-identity] no match — new company', { source, apolloOrgId, name, domain });
  return { companyId: null, existing: null, signal: null };
}

/**
 * Resolve a contact's company, creating or promoting it so the contact has a
 * home in Saved Companies.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Scout has two headline people counters and they measure different things:
 * Saved Companies "Total Contacts" sums per-company counts over ACCEPTED
 * companies, and People "Total Leads" counts contacts that are neither
 * archived nor engaged. A contact with no `company_id` is invisible to the
 * first (there is no company to count it under) and, once engaged, excluded
 * from the second by design. It is reachable in Hunter mode, but it has no
 * home in the Scout surfaces and neither KPI reconciles to the workspace total.
 *
 * Every write path that creates a contact from an outside source therefore
 * owes it a company. This is the one implementation of that, so the paths
 * cannot drift apart the way their Apollo-id dedup checks did.
 *
 * Three outcomes, in order:
 *   matched   → an existing company; `company_id` is that document
 *   promoted  → the match was still 'pending' (an un-swiped discovery card).
 *               Engaging someone at a company IS accepting it, which this
 *               module already assumed when it created new companies as
 *               'accepted'; it simply never promoted one that already existed.
 *               Only 'pending' promotes — 'rejected' and 'archived' are
 *               decisions the user made and are left standing.
 *   created   → no match and enough signal to name one
 *
 * Returns `companyId: null` only when there is genuinely no company signal at
 * all (no Apollo org, no name, no work-email domain). That contact is
 * legitimately company-less and Hunter mode is its home.
 *
 * @returns {Promise<{companyId: string|null, signal: string|null, created: boolean, promoted: boolean}>}
 */
export async function ensureCompanyForContact(userId, candidate = {}, { source = 'unknown', extraFields = {} } = {}) {
  if (!userId) return { companyId: null, signal: null, created: false, promoted: false };

  const apolloOrgId = readApolloOrgId(candidate);
  const givenName = candidate.name ?? candidate.company_name ?? candidate.organization_name ?? null;
  const domain = normalizeDomain(candidate.domain) ?? workDomainFromEmail(candidate.email);

  const match = await resolveCompany(userId, { ...candidate, domain }, { source });

  if (match.companyId) {
    if (match.existing?.status === COMPANY_STATUS.PENDING) {
      // `saved_at` too: SavedCompanies orders on saved_at || created_at ||
      // swipedAt, and a discovery card has only `found_at`. Promoting without
      // it would put the company at the bottom of the list regardless of when
      // it was actually saved.
      await updateDoc(doc(db, 'users', userId, 'companies', match.companyId), {
        status: COMPANY_STATUS.ACCEPTED,
        saved_at: match.existing.saved_at ?? new Date().toISOString(),
        accepted_via: source,
      });
      console.info('[company-identity] promoted pending company to accepted', {
        source, companyId: match.companyId, signal: match.signal,
      });
      return { companyId: match.companyId, signal: match.signal, created: false, promoted: true };
    }
    return { companyId: match.companyId, signal: match.signal, created: false, promoted: false };
  }

  const derivedName = givenName || companyNameFromDomain(domain);
  if (!derivedName) {
    console.info('[company-identity] no company signal on contact — leaving unlinked', { source });
    return { companyId: null, signal: null, created: false, promoted: false };
  }

  const companyId = apolloOrgId || `company_${Date.now()}`;
  await setDoc(doc(db, 'users', userId, 'companies', companyId), createCompanyRecord({
    ...apolloIdFields(apolloOrgId),
    ...extraFields,
    name: derivedName,
    domain: domain ?? extraFields.domain ?? null,
    saved_at: new Date().toISOString(),
    source,
    status: COMPANY_STATUS.ACCEPTED,
    contact_count: 0,
    // Flags a name that was guessed from a domain rather than reported by a
    // source. Enrichment may overwrite it; a name from Apollo or the user may not.
    ...(givenName ? {} : { name_source: 'email_domain' }),
  }));
  console.info('[company-identity] created company for contact', {
    source, companyId, name: derivedName, derivedFromDomain: !givenName,
  });
  return { companyId, signal: 'created', created: true, promoted: false };
}

export default {
  APOLLO_ORG_FIELD,
  COMPANY_SCAN_WINDOW,
  FREE_EMAIL_DOMAINS,
  readApolloOrgId,
  apolloIdFields,
  normalizeDomain,
  workDomainFromEmail,
  companyNameFromDomain,
  findCompanyByApolloId,
  findCompanyByName,
  findCompanyByDomain,
  resolveCompany,
  ensureCompanyForContact,
};
