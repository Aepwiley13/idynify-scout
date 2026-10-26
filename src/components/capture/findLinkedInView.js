/**
 * Find LinkedIn's pure helpers: what to search with, and how a match is
 * explained. No Firestore, no network.
 */
import { normalizeDomain, workDomainFromEmail } from '../../services/companyIdentityService';

const STRENGTH_TEXT = Object.freeze({ strong: 'Strong match', good: 'Good match', possible: 'Possible match' });
const REASON_TEXT = Object.freeze({ name: 'name', company: 'company', domain: 'company website', title: 'title', location: 'location' });

/** "Strong match: name + company" */
export function matchExplanation(candidate) {
  const reasons = (candidate.reasons ?? []).map(r => REASON_TEXT[r] ?? r);
  return `${STRENGTH_TEXT[candidate.strength] ?? 'Match'}${reasons.length ? `: ${reasons.join(' + ')}` : ''}`;
}

/** What to search with: the saved contact's own details, never a guess. */
export function searchPersonFrom(contact = {}) {
  const text = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    name: text(contact.name),
    company: text(contact.company_name) ?? text(contact.company),
    title: text(contact.title),
    domain: normalizeDomain(contact.website) ?? workDomainFromEmail(contact.email) ?? null,
    email: text(contact.email),
    location: text(contact.location) ?? text([contact.city, contact.state].filter(Boolean).join(', ')),
  };
}
