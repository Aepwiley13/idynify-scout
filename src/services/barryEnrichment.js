/**
 * Writes one Barry Enrich run onto a contact.
 *
 * barryEnrich returns a proposed enrichment patch computed from the contact
 * snapshot that started the request. That proposal is evidence, not authority:
 * the contact may have changed while Apollo/Google were running. The final
 * persistence boundary therefore re-runs the shared protection policy against
 * the latest Firestore document inside a transaction.
 *
 * Company resolution is deliberately read-only before that transaction. If the
 * enrichment still owns the empty company slot when the transaction rereads the
 * contact, reusing/creating the company and attaching company_id happen in that
 * SAME transaction. A retry caused by a concurrent user edit therefore cannot
 * leave a newly-created enrichment company behind.
 */
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  apolloIdFields,
  NAME_SOURCE,
  normalizeDomain,
  readApolloOrgId,
  resolveCompany,
} from './companyIdentityService';
import { createCompanyRecord, COMPANY_STATUS } from '../schemas/companySchema';
import {
  enrichmentPatch,
  isBlank,
  ownCompany,
  sameText,
  text,
} from '../utils/contactProtection';

const SOURCE = 'barry_enrich';
const RUN_METADATA_FIELDS = Object.freeze([
  'export_ready',
  'last_enriched_at',
  'data_sources',
  'enrichment_steps',
  '_raw_apollo_data',
]);

/**
 * Rebase barryEnrich's proposed patch onto the latest canonical contact.
 *
 * `result.enrichedData` contains only facts the server considered safe for the
 * OLD snapshot. Feeding those facts back through enrichmentPatch means a field
 * the user populated meanwhile is no longer writable. `phone_numbers` is the
 * provider history emitted by mergeFoundPhones, so phone merging is likewise
 * recalculated against the latest typed phones and removal history.
 */
export function latestBarryPatch(contact, result) {
  const proposed = result?.enrichedData ?? {};
  const provenance = proposed.enrichment_provenance ?? {};
  const phoneNumbers = Array.isArray(proposed.phone_numbers) ? proposed.phone_numbers : [];

  const { patch, filled } = enrichmentPatch(contact, proposed, {
    provenance,
    phoneNumbers,
  });

  // Run bookkeeping is allowed to describe the latest enrichment run, but it
  // must not smuggle old canonical facts back around contactProtection.
  for (const field of RUN_METADATA_FIELDS) {
    if (proposed[field] !== undefined) patch[field] = proposed[field];
  }

  // Never replace a relationship status the user/workflow changed while the
  // enrichment request was in flight. Barry only supplies the default when the
  // canonical record still has none.
  if (isBlank(contact.lead_status) && text(proposed.lead_status)) {
    patch.lead_status = text(proposed.lead_status);
  }

  if (proposed.enrichment_summary && typeof proposed.enrichment_summary === 'object') {
    patch.enrichment_summary = {
      ...proposed.enrichment_summary,
      // This must describe what the FINAL atomic rebase filled, not what the
      // stale request snapshot thought it would fill.
      fields_filled: filled,
    };
  }

  return { patch, filled };
}

function proposedCompany(result) {
  const company = result?.company;
  const name = text(result?.enrichedData?.company_name) || text(company?.name);
  if (!name || !company) return null;
  return {
    name,
    apollo_organization_id: text(company.apollo_organization_id),
    domain: text(company.domain),
  };
}

function newCompanyRecord(candidate) {
  const apolloOrgId = readApolloOrgId(candidate);
  return createCompanyRecord({
    ...apolloIdFields(apolloOrgId),
    name: candidate.name,
    domain: normalizeDomain(candidate.domain) ?? null,
    linkedin_url: null,
    saved_at: new Date().toISOString(),
    source: SOURCE,
    status: COMPANY_STATUS.ACCEPTED,
    contact_count: 0,
    name_source: NAME_SOURCE.APOLLO,
    apolloEnriched: false,
  });
}

/**
 * @param {string} uid
 * @param {object} contact   used for the id only; values are deliberately not trusted
 * @param {object} result    barryEnrich's response: { enrichedData, company }
 * @param {object} [options]
 * @param {Function} [options.resolveCompanyFn] read-only company resolver; injectable for tests
 * @returns {Promise<object>} the fields written
 */
export async function writeBarryEnrichment(
  uid,
  contact,
  result,
  { resolveCompanyFn = resolveCompany } = {},
) {
  const ref = doc(db, 'users', uid, 'contacts', contact.id);
  const candidate = proposedCompany(result);

  // This phase may do several Firestore queries, but MUST NOT write. If the user
  // changes company while it runs, the transaction below rereads the contact and
  // simply declines the enrichment company. No company has been created yet.
  const resolution = candidate
    ? await resolveCompanyFn(uid, candidate, { source: SOURCE })
    : null;

  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error('Contact no longer exists');

    const latest = { id: snap.id, ...snap.data() };
    const { patch, filled } = latestBarryPatch(latest, result);

    const mayLinkCompany = Boolean(
      candidate
      && filled.includes('company_name')
      && sameText(patch.company_name, candidate.name)
      && !ownCompany(latest)
      && !text(latest.company_id)
    );

    if (mayLinkCompany) {
      let companyId = resolution?.companyId ?? null;

      if (companyId) {
        // Re-read the resolved company inside the same transaction. Promotion,
        // if still applicable, is atomic with attaching it to the contact.
        const companyRef = doc(db, 'users', uid, 'companies', companyId);
        const companySnap = await transaction.get(companyRef);
        if (companySnap.exists()) {
          const companyData = companySnap.data() ?? {};
          if (companyData.status === COMPANY_STATUS.PENDING) {
            transaction.update(companyRef, {
              status: COMPANY_STATUS.ACCEPTED,
              saved_at: companyData.saved_at ?? new Date().toISOString(),
              accepted_via: SOURCE,
            });
          }
        } else {
          // Resolution became stale because the company disappeared. Treat it
          // as unresolved and fall through to deterministic creation below.
          companyId = null;
        }
      }

      if (!companyId) {
        const apolloOrgId = readApolloOrgId(candidate);
        companyId = apolloOrgId || `company_${Date.now()}`;
        const companyRef = doc(db, 'users', uid, 'companies', companyId);
        const companySnap = await transaction.get(companyRef);

        if (companySnap.exists()) {
          const existing = companySnap.data() ?? {};
          const sameApollo = Boolean(apolloOrgId && readApolloOrgId(existing) === apolloOrgId);
          const sameName = sameText(existing.name, candidate.name);
          if (!sameApollo && !sameName) {
            // Unexpected occupant: keep the safe company_name fill but do not
            // attach or overwrite the existing canonical company document.
            companyId = null;
          }
        } else {
          transaction.set(companyRef, newCompanyRecord(candidate));
        }
      }

      if (companyId) patch.company_id = companyId;
    }

    // This is the sole contact persistence boundary. Firestore retries the
    // callback if the contact changed after transaction.get(ref), so every
    // retry recalculates protection from the newest canonical state.
    transaction.update(ref, patch);
    return patch;
  });
}
