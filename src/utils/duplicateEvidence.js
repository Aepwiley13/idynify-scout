/** Shared keys for read-only duplicate reporting. A matching key is evidence for review. */
export const DUPLICATE_KEYS = Object.freeze({
  email: (ids) => ids.email,
  apollo_person_id: (ids) => ids.apolloPersonId,
  linkedin_url: (ids) => ids.linkedinUrl,
  phone: (ids) => ids.phone,
  name_company: (ids) => ids.name && (ids.companyId || ids.company)
    ? JSON.stringify([ids.name, ids.companyId ?? ids.company])
    : null,
});
