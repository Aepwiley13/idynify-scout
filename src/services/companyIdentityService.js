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

import { collection, doc, getDoc, getDocs, limit, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { normalizeLoose } from '../utils/identityNormalization';
import { createCompanyRecord, COMPANY_STATUS } from '../schemas/companySchema';
import { auth, db } from '../firebase/config';

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
 * Where a company's `name` came from, strongest first.
 *
 * Enrichment is allowed to correct a name it GUESSED and nothing else. A name
 * reported by Apollo or typed by the user is authoritative and must survive an
 * enrichment pass, or a user who renamed a company watches it revert.
 *
 * `email_domain` is the only overwritable value: those names are produced by
 * `companyNameFromDomain`, which turns `rd-advantage.com` into "Rd Advantage"
 * where the organization writes itself "R&D Advantage".
 */
export const NAME_SOURCE = Object.freeze({
  APOLLO: 'apollo',
  USER: 'user',
  EMAIL_DOMAIN: 'email_domain',
});

/** The only name provenance an enrichment pass may overwrite. */
export const OVERWRITABLE_NAME_SOURCES = Object.freeze(['email_domain']);

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
export async function ensureCompanyForContact(userId, candidate = {}, { source = 'unknown', extraFields = {}, nameSource = NAME_SOURCE.APOLLO } = {}) {
  if (!userId) return { companyId: null, signal: null, created: false, promoted: false };

  const apolloOrgId = readApolloOrgId(candidate);
  const givenName = candidate.name ?? candidate.company_name ?? candidate.organization_name ?? null;
  const domain = normalizeDomain(candidate.domain) ?? workDomainFromEmail(candidate.email);
  // The company's own LinkedIn page, not the contact's profile. Apollo returns
  // it on the organization object; this path used to drop it on the floor, so
  // every company saved through a LinkedIn import lost the one URL a human
  // would most want to click. Free to keep — it is already in the payload.
  const linkedinUrl = candidate.linkedin_url ?? candidate.organization?.linkedin_url ?? null;

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
  // ── Capture every enrichment signal that is free right now ───────────────
  //
  // No network call on THIS write. Adding a contact is an interactive flow and
  // must not wait on Apollo. What this does is persist the signals already
  // sitting in the payload, so enrichment has something to work with at all:
  // `enrichCompany` needs a domain OR an Apollo org id, and a company created
  // with neither can never be enriched, which is exactly the state bare-name
  // companies used to be born in.
  //
  // A company whose NAME had to be guessed then gets one un-awaited enrichment
  // fired after the write — see `correctDerivedCompanyName` below for why that
  // narrow case earns a call the general case does not.
  await setDoc(doc(db, 'users', userId, 'companies', companyId), createCompanyRecord({
    ...apolloIdFields(apolloOrgId),
    ...extraFields,
    name: derivedName,
    domain: domain ?? normalizeDomain(extraFields.domain) ?? null,
    linkedin_url: linkedinUrl ?? extraFields.linkedin_url ?? null,
    saved_at: new Date().toISOString(),
    source,
    status: COMPANY_STATUS.ACCEPTED,
    contact_count: 0,
    // Provenance of `name`, so a later enrichment knows whether it may correct
    // it. A name derived from a domain is a guess and says so.
    name_source: givenName ? nameSource : NAME_SOURCE.EMAIL_DOMAIN,
    // Not yet enriched. The company-detail surfaces read this pair to decide
    // whether to call enrichCompany on open.
    apolloEnriched: false,
  }));
  console.info('[company-identity] created company for contact', {
    source, companyId, name: derivedName, derivedFromDomain: !givenName,
    signals: { domain: Boolean(domain), apolloOrgId: Boolean(apolloOrgId), linkedin: Boolean(linkedinUrl) },
  });

  // The name is a guess. Correct it now rather than waiting for someone to
  // open the company — deliberately NOT awaited, so the contact save returns
  // at the same speed it always did.
  if (!givenName) {
    correctDerivedCompanyName(userId, companyId, { source }).catch((err) => {
      console.warn('[company-identity] name correction failed — guess stands', {
        source, companyId, message: err?.message,
      });
    });
  }

  return { companyId, signal: 'created', created: true, promoted: false };
}

/**
 * Correct a company name that was GUESSED from an email domain.
 *
 * WHY THIS EXISTS
 * ───────────────
 * `companyNameFromDomain` turns `rd-advantage.com` into "Rd Advantage" where
 * the organization writes itself "R&D Advantage", and `blackdesertresort.com`
 * into "Blackdesertresort". Enrichment fixes those names — but enrichment only
 * ran when somebody OPENED the company's detail page. Until then the guess was
 * already being read: in Saved Companies, in exports, and anywhere Barry
 * assembles company context. A wrong name could sit in all three indefinitely
 * because nobody happened to click into it.
 *
 * WHY A CALL HERE, WHEN CREATION OTHERWISE MAKES NONE
 * ──────────────────────────────────────────────────
 * Because this case is tiny and the general case is not. Replaying this
 * function's own precedence over production found 20 contacts fleet-wide that
 * would ever produce a guessed name — about 2.5 a month across 90 workspaces,
 * against 1,458 contacts and 3,198 companies. Enriching every company on
 * creation would be indefensible; enriching only the ones whose name is
 * admittedly a guess costs roughly a dozen Apollo calls a month.
 *
 * The alternative considered and rejected was a scheduled worker. It cannot
 * honor the rule below: `applyCompanyEnrichment` runs on the browser SDK as
 * the signed-in user, while Netlify functions run firebase-admin, so a worker
 * would need its own port of `resolveCompany` — a second dedup implementation,
 * free to drift from this one. Here the sanctioned path is simply in reach.
 *
 * NOT AWAITED BY THE CALLER, BY DESIGN
 * ────────────────────────────────────
 * Adding a contact stays as fast as it was. If this fails — offline, Apollo
 * down, the domain unknown to Apollo — the guessed name stands, which is
 * exactly the state the caller would have been in anyway, and the Saved
 * Companies treatment still marks it as unconfirmed. Failure is logged, never
 * thrown at the contact-save path.
 *
 * Everything touching identity goes through `applyCompanyEnrichment`: it
 * writes the Apollo id under BOTH field names, refuses to overwrite a name
 * that is not a guess, and checks first whether the newly discovered id or
 * domain means this company already exists as another document.
 *
 * @returns {Promise<{action:string, companyId:string, into?:string, fields?:string[]}>}
 */
export async function correctDerivedCompanyName(userId, companyId, { source = 'create' } = {}) {
  if (!userId || !companyId) return { action: 'noop', companyId };

  const ref = doc(db, 'users', userId, 'companies', companyId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { action: 'noop', companyId };
  const company = snap.data() ?? {};

  // Only a guess may be corrected. A name from Apollo or typed by the user is
  // authoritative, and a company written before `name_source` existed carries
  // none at all — neither is this function's business.
  if (company.name_source !== NAME_SOURCE.EMAIL_DOMAIN) return { action: 'noop', companyId };

  const { domain, organizationId } = enrichmentSignals(company);
  if (!domain && !organizationId) return { action: 'noop', companyId };

  // The token belongs to whoever is signed in. When an admin is impersonating,
  // that is the admin while `userId` is the impersonated user — a mismatch
  // `verifyAuthToken` explicitly allows, so impersonated adds work too.
  const authToken = await auth.currentUser?.getIdToken();
  if (!authToken) return { action: 'noop', companyId };

  const response = await fetch('/.netlify/functions/enrichCompany', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, authToken, domain, organizationId }),
  });
  if (!response.ok) throw new Error(`enrichCompany failed: ${response.status}`);

  const result = await response.json();
  if (!result.success) throw new Error(result.error || 'enrichCompany failed');

  const snapshot = result.data?.snapshot ?? {};

  // The cached blob and its timestamp are view state — they name no identity,
  // so they are safe to write directly. Writing them here also means opening
  // the company later reads the cache instead of spending a second enrichment.
  await updateDoc(ref, { apolloEnrichment: result.data, apolloEnrichedAt: Date.now(), apolloEnriched: true });

  const outcome = await applyCompanyEnrichment(userId, companyId, {
    apollo_organization_id: result.data?._raw?.apolloOrgId ?? null,
    domain: snapshot.domain ?? result.data?._raw?.domain ?? null,
    name: snapshot.name ?? null,
    website_url: snapshot.website_url ?? null,
    linkedin_url: snapshot.linkedin_url ?? null,
    industry: snapshot.industry ?? null,
    employee_count: snapshot.estimated_num_employees ?? null,
    location: snapshot.location?.full ?? null,
  }, { source: `${source}.nameCorrection` });

  console.info('[company-identity] derived name correction', {
    source, companyId, action: outcome.action, guessed: company.name, corrected: snapshot.name ?? null,
  });
  return outcome;
}

/**
 * The identity signals `enrichCompany` needs, read off a company document.
 *
 * `enrichCompany` rejects a request carrying neither a domain nor an
 * organization id, so calling it without one is a guaranteed-failing round
 * trip — and until bare-name companies existed, every company had at least one,
 * which is why nothing checked. A company created from a typed name with no
 * work-email domain has neither, and would otherwise produce a failed fetch on
 * every open of its detail page.
 *
 * Reads the organization id from BOTH field names. Two of the three company
 * surfaces looked only at `apollo_id`, so a document carrying only
 * `apollo_organization_id` — the standard — was silently unenrichable there.
 */
export function enrichmentSignals(company = {}) {
  return {
    domain: normalizeDomain(company.domain)
      ?? normalizeDomain(company.primary_domain)
      ?? normalizeDomain(company.website_url)
      ?? null,
    organizationId: readApolloOrgId(company),
  };
}

/** Whether `enrichCompany` can do anything with this company at all. */
export function canEnrich(company = {}) {
  const { domain, organizationId } = enrichmentSignals(company);
  return Boolean(domain || organizationId);
}

/**
 * Write enrichment results back onto a company — the ONLY sanctioned path.
 *
 * WHY ENRICHMENT MAY NOT JUST `updateDoc`
 * ───────────────────────────────────────
 * Enrichment is the one moment a company's identity signals CHANGE. A company
 * born from a typed name has no Apollo id and maybe no domain; enrichment can
 * hand it both. That makes it the one moment a record can collide with a
 * document that was already in the workspace under the identity nobody knew
 * yet. Writing the discovered fields straight onto the row would quietly
 * manufacture the duplicates this module exists to prevent.
 *
 * Two failure modes this guards, both of which have already happened in this
 * codebase in one form or another:
 *
 *   1. THE ALIAS SPLIT. Apollo's organization id has been written under two
 *      field names. Enrichment that writes only `apollo_organization_id` leaves
 *      `apollo_id` unset, and every reader still on the old name stops seeing
 *      the company — the exact split `apolloIdFields` was introduced to close.
 *      So the id always goes through `apolloIdFields`, never written by hand.
 *
 *   2. THE NAME REVERT. A name from Apollo or from the user is authoritative.
 *      Only a name this module GUESSED from a domain may be corrected. Without
 *      that rule an enrichment pass renames a company the user deliberately
 *      renamed, and does it again on every refresh.
 *
 * Returns `{ action: 'merged', into }` when the discovered signals reveal the
 * company already exists as another document. The caller should repoint at
 * `into` — this function does not move contacts, because re-parenting records
 * is a migration decision and not a side effect of opening a detail page.
 *
 * @returns {Promise<{action:'updated'|'merged'|'noop', companyId:string, into?:string, fields:string[]}>}
 */
export async function applyCompanyEnrichment(userId, companyId, discovered = {}, { source = 'enrichment' } = {}) {
  if (!userId || !companyId) return { action: 'noop', companyId, fields: [] };

  const ref = doc(db, 'users', userId, 'companies', companyId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { action: 'noop', companyId, fields: [] };
  const existing = snap.data() ?? {};

  const apolloOrgId = readApolloOrgId(discovered);
  const domain = normalizeDomain(discovered.domain)
    ?? normalizeDomain(discovered.primary_domain)
    ?? normalizeDomain(discovered.website_url);

  // ── Collision check, BEFORE writing ──
  //
  // Only meaningful when enrichment actually discovered a NEW identity signal;
  // re-resolving on signals the record already carries would just find itself.
  const learnedApollo = apolloOrgId && !readApolloOrgId(existing);
  const learnedDomain = domain && !normalizeDomain(existing.domain);

  if (learnedApollo || learnedDomain) {
    const match = await resolveCompany(
      userId,
      { apollo_organization_id: learnedApollo ? apolloOrgId : null, domain: learnedDomain ? domain : null },
      { source: `${source}.collisionCheck` },
    );
    if (match.companyId && match.companyId !== companyId) {
      console.warn('[company-identity] enrichment revealed an existing duplicate — not writing', {
        source, companyId, existingCompanyId: match.companyId, signal: match.signal,
      });
      return { action: 'merged', companyId, into: match.companyId, fields: [] };
    }
  }

  // ── Build the patch ──
  const patch = {};

  if (apolloOrgId) {
    // BOTH field names, always. Never hand-write one.
    Object.assign(patch, apolloIdFields(apolloOrgId));
  }

  if (domain && !normalizeDomain(existing.domain)) patch.domain = domain;

  // Fill holes only; never restate what the record already has.
  for (const field of ['website_url', 'linkedin_url', 'industry', 'employee_count', 'location', 'logo_url']) {
    const value = discovered[field];
    if (value === null || value === undefined || value === '') continue;
    const current = existing[field];
    if (current !== null && current !== undefined && current !== '') continue;
    patch[field] = value;
  }

  // The name, under the provenance rule.
  const incomingName = discovered.name ?? null;
  if (incomingName && incomingName !== existing.name) {
    if (OVERWRITABLE_NAME_SOURCES.includes(existing.name_source)) {
      patch.name = incomingName;
      patch.name_source = NAME_SOURCE.APOLLO;
      patch.name_was = existing.name;
    } else {
      console.info('[company-identity] keeping authoritative company name', {
        source, companyId, kept: existing.name, offered: incomingName,
        nameSource: existing.name_source ?? '(unset)',
      });
    }
  }

  if (Object.keys(patch).length === 0) return { action: 'noop', companyId, fields: [] };

  await updateDoc(ref, patch);
  console.info('[company-identity] enrichment written back', { source, companyId, fields: Object.keys(patch) });
  return { action: 'updated', companyId, fields: Object.keys(patch) };
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
  enrichmentSignals,
  canEnrich,
  applyCompanyEnrichment,
  correctDerivedCompanyName,
  NAME_SOURCE,
};
