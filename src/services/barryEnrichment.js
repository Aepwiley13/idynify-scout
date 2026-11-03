/**
 * Finishes one Barry Enrich run on a contact.
 *
 * The server already wrote the run (barryEnrich, `save: true`): in one
 * Firestore transaction on the contact as stored at that moment, by the shared
 * rules in src/utils/contactProtection.js — the contact's own values win,
 * enrichment fills only what is empty, and nothing in it is a LinkedIn URL
 * (#738). This adds the one thing the server cannot do: when the run filled a
 * company where the contact had none, the company is linked through the
 * shared company resolver (ensureCompanyForContact), which reuses an existing
 * company before it creates one, so the contact gets a `company_id` and not
 * only a name. The link is set in a transaction too, and only while the
 * contact still has no company_id.
 *
 * Nothing here logs.
 */
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase/config';
import { ensureCompanyForContact, NAME_SOURCE } from './companyIdentityService';
import { text } from '../utils/contactProtection';

const SOURCE = 'barry_enrich';

/**
 * @param {string} uid
 * @param {object} contact   the contact the run was for, as the profile holds it
 * @param {object} result    barryEnrich's response: { enrichedData, company }
 * @param {object} [options]
 * @param {Function} [options.ensureCompany]  the shared company resolver; injectable for tests
 * @returns {Promise<object>} what the run wrote onto the contact, for the profile to show
 */
export async function writeBarryEnrichment(uid, contact, result, { ensureCompany = ensureCompanyForContact } = {}) {
  const written = { ...(result?.enrichedData ?? {}) };
  delete written.linkedin_url;
  delete written.linkedin_url_normalized;

  // `company` is set only when the server filled an empty company.
  const company = result?.company;
  if (text(company?.name) && text(written.company_name) && !text(contact.company_id)) {
    const linked = await ensureCompany(uid, {
      name: text(company.name),
      apollo_organization_id: text(company.apollo_organization_id),
      domain: text(company.domain),
    }, { source: SOURCE, nameSource: NAME_SOURCE.APOLLO });
    if (linked?.companyId) {
      const ref = doc(db, 'users', uid, 'contacts', contact.id);
      const set = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists() || text(snap.data().company_id)) return false;
        tx.update(ref, { company_id: linked.companyId });
        return true;
      });
      if (set) written.company_id = linked.companyId;
    }
  }

  return written;
}
