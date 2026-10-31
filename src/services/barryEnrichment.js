/**
 * Writes one Barry Enrich run onto a contact.
 *
 * barryEnrich returns a proposed enrichment patch computed from the contact
 * snapshot that started the request. That proposal is evidence, not authority:
 * the contact may have changed while Apollo/Google were running. The final
 * persistence boundary therefore re-runs the shared protection policy against
 * the latest Firestore document inside a transaction.
 *
 * Company linking stays outside the contact transaction because the shared
 * company resolver performs its own queries/writes. It is attempted only when
 * the atomic contact write itself filled company_name, and company_id is then
 * attached in a second transaction only if the contact still has that same
 * company and still has no company link.
 */
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase/config';
import { ensureCompanyForContact, NAME_SOURCE } from './companyIdentityService';
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

/**
 * @param {string} uid
 * @param {object} contact   used for the id only; values are deliberately not trusted
 * @param {object} result    barryEnrich's response: { enrichedData, company }
 * @param {object} [options]
 * @param {Function} [options.ensureCompany]  shared company resolver; injectable for tests
 * @returns {Promise<object>} the fields written
 */
export async function writeBarryEnrichment(uid, contact, result, { ensureCompany = ensureCompanyForContact } = {}) {
  const ref = doc(db, 'users', uid, 'contacts', contact.id);

  const committed = await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error('Contact no longer exists');

    const latest = { id: snap.id, ...snap.data() };
    const { patch, filled } = latestBarryPatch(latest, result);
    transaction.update(ref, patch);

    const company = result?.company;
    const companyCandidate = filled.includes('company_name')
      && text(company?.name)
      && text(patch.company_name)
      && !ownCompany(latest)
      && !text(latest.company_id)
      ? {
          name: text(patch.company_name),
          apollo_organization_id: text(company.apollo_organization_id),
          domain: text(company.domain),
        }
      : null;

    return { patch, companyCandidate };
  });

  if (!committed.companyCandidate) return committed.patch;

  // Resolve/create only after the atomic rebase proved the latest contact had
  // no company. A later user edit still wins: attachment is conditional below.
  const linked = await ensureCompany(uid, committed.companyCandidate, {
    source: SOURCE,
    nameSource: NAME_SOURCE.APOLLO,
  });
  if (!linked?.companyId) return committed.patch;

  const companyPatch = await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) return {};

    const latest = { id: snap.id, ...snap.data() };
    if (text(latest.company_id)) return {};
    if (!sameText(ownCompany(latest), committed.companyCandidate.name)) return {};

    const patch = { company_id: linked.companyId };
    transaction.update(ref, patch);
    return patch;
  });

  return { ...committed.patch, ...companyPatch };
}
