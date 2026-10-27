/**
 * Writes one Barry Enrich run onto a contact.
 *
 * The server already decided what may be written (barryEnrich, through
 * src/utils/contactProtection.js): the contact's own values win, enrichment
 * fills only what is empty, and nothing in it is a LinkedIn URL. This adds the
 * one thing the server cannot do: when the run filled a company where the
 * contact had none, the company is linked through the shared company resolver
 * (ensureCompanyForContact), which reuses an existing company before it
 * creates one, so the contact gets a `company_id` and not only a name.
 *
 * One update to the contact. Nothing here logs.
 */
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { ensureCompanyForContact, NAME_SOURCE } from './companyIdentityService';
import { ownCompany, text } from '../utils/contactProtection';

const SOURCE = 'barry_enrich';

/**
 * @param {string} uid
 * @param {object} contact   the contact the run was for, as the profile holds it
 * @param {object} result    barryEnrich's response: { enrichedData, company }
 * @param {object} [options]
 * @param {Function} [options.ensureCompany]  the shared company resolver; injectable for tests
 * @returns {Promise<object>} the fields written
 */
export async function writeBarryEnrichment(uid, contact, result, { ensureCompany = ensureCompanyForContact } = {}) {
  const patch = { ...(result?.enrichedData ?? {}) };
  delete patch.linkedin_url;
  delete patch.linkedin_url_normalized;

  const company = result?.company;
  if (text(company?.name) && text(patch.company_name) && !ownCompany(contact) && !text(contact.company_id)) {
    const linked = await ensureCompany(uid, {
      name: text(company.name),
      apollo_organization_id: text(company.apollo_organization_id),
      domain: text(company.domain),
    }, { source: SOURCE, nameSource: NAME_SOURCE.APOLLO });
    if (linked?.companyId) patch.company_id = linked.companyId;
  }

  await updateDoc(doc(db, 'users', uid, 'contacts', contact.id), patch);
  return patch;
}
