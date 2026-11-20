/**
 * What Scout could add to a contact, read only from the contact record already on screen.
 *
 * Used by the Contact Hub person page (components/billing/ScoutOpportunity.jsx) to show a Free
 * account what Scout offers. It calls nothing: no enrichment, no search, no model. Whether
 * Scout actually finds anything is only known once a paid account runs it.
 */
import { readContactPhones } from './contactPhones';
import { contactDisplayName } from './contactDisplayName';

const filled = (value) => (typeof value === 'string' ? value.trim() !== '' : Boolean(value));

/** The details Scout looks for, in the order they are named. */
export const SCOUT_DETAILS = Object.freeze([
  { id: 'email', label: 'email', has: (c) => filled(c.email) || filled(c.work_email) || filled(c.personal_email) },
  { id: 'phone', label: 'phone number', has: (c) => readContactPhones(c).length > 0 },
  { id: 'linkedin', label: 'LinkedIn profile', has: (c) => filled(c.linkedin_url) },
  { id: 'title', label: 'job title', has: (c) => filled(c.title) },
  { id: 'company', label: 'company', has: (c) => filled(c.company_name) || filled(c.company) },
]);

/** "email", "email and phone number", "email, phone number and job title". Pure. */
export function listInWords(labels) {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * { name, missing: [{ id, label }], company } for a contact, or null for no contact. Pure.
 * `missing` is empty when the record already has every detail Scout looks for; Scout can then
 * still find more people like them.
 */
export function scoutOpportunityFor(contact) {
  if (!contact || !contact.id) return null;
  const missing = SCOUT_DETAILS.filter((d) => !d.has(contact)).map(({ id, label }) => ({ id, label }));
  const company = filled(contact.company_name) ? contact.company_name : filled(contact.company) ? contact.company : null;
  return { name: contactDisplayName(contact, { email: false }) || 'this person', missing, company };
}

/** The contact's page in Scout (App.jsx /contact/:contactId): where a customer returns after upgrading. */
export const scoutContactPath = (contactId) => `/contact/${encodeURIComponent(contactId)}`;
