/**
 * identityEditRules — the pure rules for editing a contact's name, title and organization from the header.
 *
 * What the editor starts with, which fields may be edited, whether a value is a change, and exactly which stored
 * field a save writes. No React, no Firebase, no service: the same answer for the same input.
 *
 * WHAT IS WRITTEN. Only the field that was edited, under the name the contact document already uses:
 *   name          → name
 *   title         → title
 *   organization  → company_name
 * Never first_name, last_name, company, company_id, source or any import field. A contact that came from a CSV has
 * first_name and last_name and no name: it is SHOWN with them (the shared display-name helper), and editing it writes
 * `name`, which the display then prefers. The imported parts stay as they were imported.
 *
 * WHAT IS REFUSED. A blank name (a person is never saved without one). The organization of a contact linked to a
 * company (company_id): that name belongs to the company record, and writing company_name on its own would leave the
 * two disagreeing. A value that is not text, and a field that is not one of the three.
 */
import { nameParts, contactDisplayName } from '../../../utils/contactDisplayName';

export const IDENTITY_FIELDS = Object.freeze(['name', 'title', 'organization']);

/** The stored field each identity field is written to. */
export const STORE_FIELD = Object.freeze({ name: 'name', title: 'title', organization: 'company_name' });

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** Is this contact linked to a company record? */
export function isLinkedCompany(contact) {
  const id = contact?.company_id;
  return (typeof id === 'string' && id.trim() !== '') || typeof id === 'number';
}

/** May this field be edited on this contact, by rule (not by permission)? */
export function isEditable(contact, field) {
  if (!contact || typeof contact !== 'object' || !IDENTITY_FIELDS.includes(field)) return false;
  if (field === 'organization') return !isLinkedCompany(contact);
  return true;
}

/**
 * What the editor starts with: the value the header shows, or '' when it shows nothing for it (never "Unknown
 * contact" and never an email address standing in for a name).
 */
export function startValue(contact, field) {
  if (!contact || typeof contact !== 'object') return '';
  if (field === 'name') {
    const { name, first, last } = nameParts(contact);
    if (!name && !first && !last) return '';
    return contactDisplayName(contact, { email: false });
  }
  if (field === 'title') return text(contact.title);
  if (field === 'organization') return text(contact.company_name) || text(contact.company);
  return '';
}

/**
 * Decide an edit.
 *
 * @returns {{ ok: false, reason: 'no_contact'|'unknown_field'|'not_editable'|'not_text'|'blank_name'|'unchanged' }
 *         | { ok: true, field: string, storeField: string, value: string, previous: * }}
 *   `previous` is the stored value as it was (possibly undefined), kept so a failed save can put it back.
 */
export function planEdit(contact, field, raw) {
  if (!contact || typeof contact.id !== 'string' || contact.id === '') return { ok: false, reason: 'no_contact' };
  if (!IDENTITY_FIELDS.includes(field)) return { ok: false, reason: 'unknown_field' };
  if (!isEditable(contact, field)) return { ok: false, reason: 'not_editable' };
  if (typeof raw !== 'string') return { ok: false, reason: 'not_text' };
  const value = raw.trim();
  if (field === 'name' && value === '') return { ok: false, reason: 'blank_name' };
  if (value === startValue(contact, field)) return { ok: false, reason: 'unchanged' };
  const storeField = STORE_FIELD[field];
  return { ok: true, field, storeField, value, previous: contact[storeField] };
}
