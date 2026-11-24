export const MAX_CONTACT_AFFILIATIONS = 20;
export const AFFILIATION_LIMITS = Object.freeze({
  organization: 160,
  title: 160,
  type: 48,
  provenance: 12,
  source: 64,
});

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) || null : null;
const stableHash = (value) => {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
};
const canonical = (value) => JSON.stringify(value);

export function legacyContactAffiliation(contact) {
  const organizationName = text(contact?.company_name ?? contact?.company ?? contact?.organization_name, AFFILIATION_LIMITS.organization);
  const companyId = text(contact?.company_id ?? contact?.companyId, 1500);
  const title = text(contact?.title ?? contact?.job_title, AFFILIATION_LIMITS.title);
  if (!organizationName && !companyId && !title) return null;
  const sources = [...new Set([contact?.source, contact?.identity_source, contact?.addedFrom,
    ...(Array.isArray(contact?.identity_sources) ? contact.identity_sources : [])]
    .filter((source) => typeof source === 'string' && source.trim()))]
    .map((source) => ({ source: source.trim(), contact_id: contact?.id ?? null }));
  const identity = canonical([contact?.id ?? '', companyId, organizationName?.toLowerCase() ?? '', title?.toLowerCase() ?? '']);
  return {
    id: `legacy_${stableHash(identity)}`,
    organization_name: organizationName,
    company_id: companyId,
    title,
    type: null,
    status: 'current',
    primary: true,
    provenance: sources,
  };
}

export function affiliationsForContact(contact) {
  if (Array.isArray(contact?.contact_affiliations) && contact.contact_affiliations.length) return contact.contact_affiliations;
  const legacy = legacyContactAffiliation(contact);
  return legacy ? [legacy] : [];
}

export function validateContactAffiliations(value) {
  if (!Array.isArray(value) || value.length > MAX_CONTACT_AFFILIATIONS) return { ok: false, reason: 'count' };
  const ids = new Set();
  let primaryCount = 0;
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, reason: 'shape' };
    const allowed = ['id', 'organization_name', 'company_id', 'title', 'type', 'status', 'primary', 'provenance'];
    if (Object.keys(item).some((key) => !allowed.includes(key)) || !ID.test(item.id ?? '') || ids.has(item.id)) {
      return { ok: false, reason: 'shape' };
    }
    ids.add(item.id);
    if (!(item.organization_name === null || (typeof item.organization_name === 'string' && item.organization_name.trim().length <= AFFILIATION_LIMITS.organization))
      || !(item.company_id === null || (typeof item.company_id === 'string' && item.company_id.length <= 1500 && !item.company_id.includes('/')))
      || !(item.title === null || (typeof item.title === 'string' && item.title.trim().length <= AFFILIATION_LIMITS.title))
      || !(item.type === null || (typeof item.type === 'string' && item.type.trim().length <= AFFILIATION_LIMITS.type))
      || !['current', 'former'].includes(item.status) || typeof item.primary !== 'boolean'
      || !(item.organization_name?.trim() || item.company_id || item.title?.trim())) return { ok: false, reason: 'shape' };
    if (item.primary) primaryCount++;
    if (!Array.isArray(item.provenance) || item.provenance.length > AFFILIATION_LIMITS.provenance) return { ok: false, reason: 'provenance' };
    for (const source of item.provenance) {
      if (!source || typeof source !== 'object' || Array.isArray(source)
        || Object.keys(source).some((key) => !['source', 'contact_id'].includes(key))
        || typeof source.source !== 'string' || !source.source.trim() || source.source.length > AFFILIATION_LIMITS.source
        || !(source.contact_id === null || (typeof source.contact_id === 'string' && source.contact_id.length <= 1500 && !source.contact_id.includes('/')))) {
        return { ok: false, reason: 'provenance' };
      }
    }
  }
  if (value.length && primaryCount !== 1) return { ok: false, reason: 'primary' };
  return { ok: true, reason: null };
}

export function projectPrimaryAffiliation(affiliations) {
  const primary = affiliations.find((item) => item.primary) ?? null;
  return {
    title: primary?.title ?? null,
    company_name: primary?.organization_name ?? null,
    company_id: primary?.company_id ?? null,
  };
}

const mergeSources = (first = [], second = []) => [...new Map([...first, ...second].map((source) => [canonical(source), source])).values()];

/** Converts scalar-only legacy rows and additively combines equivalent affiliations. */
export function combineContactAffiliations(survivor, source) {
  const rows = [
    ...affiliationsForContact(survivor),
    ...affiliationsForContact(source),
  ];
  const combined = new Map();
  for (const row of rows) {
    const organization = row.company_id ? `id:${row.company_id}` : `name:${(row.organization_name ?? '').trim().toLowerCase()}`;
    const key = canonical([organization, (row.title ?? '').trim().toLowerCase(), (row.type ?? '').trim().toLowerCase(), row.status]);
    const prior = combined.get(key);
    if (!prior) combined.set(key, { ...row, primary: false, provenance: [...(row.provenance ?? [])] });
    else prior.provenance = mergeSources(prior.provenance, row.provenance);
  }
  const affiliations = [...combined.values()];
  const primaryId = (survivor?.contact_affiliations ?? []).find((row) => row.primary)?.id
    ?? legacyContactAffiliation(survivor)?.id
    ?? (source?.contact_affiliations ?? []).find((row) => row.primary)?.id
    ?? legacyContactAffiliation(source)?.id;
  let primary = affiliations.find((row) => row.id === primaryId);
  if (!primary) primary = affiliations[0];
  if (primary) primary.primary = true;
  return affiliations;
}

/** Owner-scoped client adapter for the trusted, feature-gated affiliation writer. */
export async function saveContactAffiliations(uid, contactId, expectedVersion, affiliations) {
  const [{ auth }, { db }, { doc, getDoc }, { getEffectiveUser }] = await Promise.all([
    import('../firebase/config'), import('../firebase/config'), import('firebase/firestore'), import('../context/ImpersonationContext'),
  ]);
  const user = auth.currentUser;
  const canContinue = () => user?.uid === uid && auth.currentUser === user
    && getEffectiveUser()?.uid === uid && !getEffectiveUser()?._isImpersonated;
  if (!canContinue()) throw new Error('read_only');
  const token = await user.getIdToken();
  if (!canContinue()) throw new Error('read_only');
  const response = await fetch('/.netlify/functions/contact-hub-affiliations', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, contactId, expectedVersion, affiliations }),
  });
  const result = await response.json();
  if (!canContinue()) throw new Error('read_only');
  if (!response.ok) throw new Error(result.error || 'unavailable');
  const saved = await getDoc(doc(db, 'users', uid, 'contacts', contactId));
  if (!canContinue()) throw new Error('read_only');
  return { affiliations: result.affiliations, contactVersion: saved.updateTime ? `${saved.updateTime.seconds}:${saved.updateTime.nanoseconds}` : expectedVersion };
}

