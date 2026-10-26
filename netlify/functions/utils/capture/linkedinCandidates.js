/**
 * Which LinkedIn profiles are likely this person, and why.
 *
 * Pure: it ranks profiles the endpoint already found (Apollo's person match and
 * Google's index) against what the contact says. Nothing is decided here: a
 * person confirms the one that is them. The ranking only orders the choices
 * and explains each one.
 *
 *   strong     the name, and the company or its domain
 *   good       the name, and the title or the location
 *   possible   the name alone: offered only when the contact has nothing
 *              else to go on (no company, website, title or location). When it
 *              does, a profile that matches the name and none of those is
 *              someone else with the same name, and is not offered.
 *
 * A profile whose name does not carry every part of the contact's name is not
 * offered at all.
 */
import { normalizeLinkedInUrl } from '../../../../src/utils/identityNormalization.js';

export const STRENGTHS = Object.freeze(['strong', 'good', 'possible']);
export const MAX_CANDIDATES = 3;

/** Words that say nothing about which company it is. */
const GENERIC = new Set([
  'inc', 'llc', 'ltd', 'co', 'corp', 'corporation', 'company', 'the', 'and', 'group', 'of', 'at', 'for', 'a', 'an', 'in',
]);

const fold = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const words = value => fold(value).split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 2);
const distinctive = value => words(value).filter(w => !GENERIC.has(w));
const containsAll = (needles, haystack) => needles.length > 0 && needles.every(w => haystack.has(w));

/** "www.example-robotics.com" → "example-robotics"; the part of a domain a profile might mention. */
function domainStem(domain) {
  const host = fold(domain).replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  const labels = host.split('.').filter(Boolean);
  return labels.length >= 2 ? labels[labels.length - 2] : null;
}

/**
 * The evidence one profile carries for one person.
 * @returns {{ name: boolean, company: boolean, domain: boolean, title: boolean, location: boolean }}
 */
export function evidence(person, profile) {
  const nameWords = new Set(words(profile.name || profile.text));
  const all = new Set(words([profile.name, profile.headline, profile.company, profile.location, profile.text].filter(Boolean).join(' ')));
  const stem = domainStem(person.domain);
  const stemWords = stem ? words(stem) : [];
  return {
    name: containsAll(words(person.name), nameWords),
    company: containsAll(distinctive(person.company), all),
    domain: Boolean(stem) && (
      fold(profile.companyDomain) === fold(person.domain).replace(/^www\./, '')
      || domainStem(profile.companyDomain) === stem
      || containsAll(stemWords, all)
      || all.has(stem)
    ),
    title: containsAll(distinctive(person.title), all),
    location: containsAll(distinctive(person.location), all),
  };
}

/** strong / good / possible, or null when the name does not match. */
export function strengthOf(found) {
  if (!found.name) return null;
  if (found.company || found.domain) return 'strong';
  if (found.title || found.location) return 'good';
  return 'possible';
}

const REASON_ORDER = ['name', 'company', 'domain', 'title', 'location'];
const reasonsOf = found => REASON_ORDER.filter(key => found[key]);

/**
 * The one form of a profile's address: https://www.linkedin.com/in/<id>, or
 * null for anything that is not a person's profile (a company page, a post).
 */
export function canonicalProfileUrl(url) {
  const key = normalizeLinkedInUrl(url)?.replace(/^[a-z]{2,3}\.(?=linkedin\.com\/)/, '');
  return key && /^linkedin\.com\/in\/[^/]+$/.test(key) ? `https://www.${key}` : null;
}

/** One profile per LinkedIn URL; Apollo's details (a verified person record) win over a search snippet's. */
function mergeByProfile(found) {
  const byUrl = new Map();
  for (const raw of found) {
    const key = canonicalProfileUrl(raw.linkedinUrl);
    if (!key) continue;
    const profile = { ...raw, linkedinUrl: key };
    const prior = byUrl.get(key);
    if (!prior) {
      byUrl.set(key, { ...profile, sources: [profile.source] });
      continue;
    }
    const [first, second] = profile.source === 'apollo' ? [profile, prior] : [prior, profile];
    byUrl.set(key, {
      ...second,
      ...Object.fromEntries(Object.entries(first).filter(([, v]) => v !== null && v !== undefined && v !== '')),
      text: [prior.text, profile.text].filter(Boolean).join(' '),
      sources: [...new Set([...prior.sources, profile.source])],
    });
  }
  return [...byUrl.values()];
}

/**
 * The few profiles to offer, best first.
 *
 * @param {object} person   what the contact says: { name, company, title, domain, location }
 * @param {Array}  found    [{ source: 'apollo'|'search', linkedinUrl, name, headline, company,
 *                            companyDomain, location, photoUrl, text }]
 * @returns {Array<{ linkedinUrl, name, headline, company, location, photoUrl,
 *                   sources: string[], strength: string, reasons: string[] }>}
 */
export function rankLinkedInCandidates(person, found, { limit = MAX_CANDIDATES } = {}) {
  const ranked = mergeByProfile(found)
    .map((profile) => {
      const found_ = evidence(person, profile);
      return { profile, strength: strengthOf(found_), reasons: reasonsOf(found_) };
    })
    .filter(c => c.strength !== null);

  const nameAloneOnly = !distinctive(person.company).length && !domainStem(person.domain)
    && !distinctive(person.title).length && !distinctive(person.location).length;
  return ranked
    .filter(c => c.strength !== 'possible' || nameAloneOnly)
    .sort((a, b) => STRENGTHS.indexOf(a.strength) - STRENGTHS.indexOf(b.strength)
      || b.reasons.length - a.reasons.length
      || b.profile.sources.length - a.profile.sources.length
      || Number(b.profile.sources.includes('apollo')) - Number(a.profile.sources.includes('apollo')))
    .slice(0, limit)
    .map(({ profile, strength, reasons }) => ({
      linkedinUrl: profile.linkedinUrl,
      name: profile.name ?? null,
      headline: profile.headline ?? null,
      company: profile.company ?? null,
      location: profile.location ?? null,
      photoUrl: profile.photoUrl ?? null,
      sources: profile.sources,
      strength,
      reasons,
    }));
}
