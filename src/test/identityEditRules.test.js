/**
 * H2-1 — identityEditRules: the pure rules for editing a contact's name, title and organization from the header.
 * What the editor starts with, what may be saved, whether anything changed, and exactly which field is written.
 */
import { describe, it, expect } from 'vitest';
import {
  IDENTITY_FIELDS, STORE_FIELD, isLinkedCompany, isEditable, startValue, planEdit,
} from '../components/contacts/personHeader/identityEditRules';

const CSV = { id: 'c1', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', source: 'csv_import' };
const FULL = { id: 'c2', name: 'Ana Lopez', title: 'Director', company_name: 'Acme', first_name: 'Ana', last_name: 'Lopez' };

describe('the fields', () => {
  it('are name, title and organization, and organization is stored as company_name', () => {
    expect(IDENTITY_FIELDS).toEqual(['name', 'title', 'organization']);
    expect(STORE_FIELD).toEqual({ name: 'name', title: 'title', organization: 'company_name' });
  });
});

describe('what the editor starts with', () => {
  it('is the name the person sees: a CSV contact with only first and last name starts with them', () => {
    expect(startValue(CSV, 'name')).toBe('Jane Doe');
  });

  it('is empty, never "Unknown contact" or an email address, when the contact has no name at all', () => {
    expect(startValue({ id: 'x', email: 'sam@example.com' }, 'name')).toBe('');
    expect(startValue({ id: 'x' }, 'name')).toBe('');
    expect(startValue({ id: 'x', name: 'sam@example.com' }, 'name')).toBe('');
  });

  it('is the stored name for an ordinary contact', () => {
    expect(startValue(FULL, 'name')).toBe('Ana Lopez');
  });

  it('is the title and the organization as the header shows them (company_name, else company)', () => {
    expect(startValue(FULL, 'title')).toBe('Director');
    expect(startValue(FULL, 'organization')).toBe('Acme');
    expect(startValue({ id: 'x', company: 'Old Co' }, 'organization')).toBe('Old Co');
    expect(startValue({ id: 'x', company_name: 'New Co', company: 'Old Co' }, 'organization')).toBe('New Co');
  });

  it('is empty for a missing or non-text value, and for an unknown field', () => {
    expect(startValue({ id: 'x' }, 'title')).toBe('');
    expect(startValue({ id: 'x', title: 42 }, 'title')).toBe('');
    expect(startValue({ id: 'x', title: { a: 1 } }, 'title')).toBe('');
    expect(startValue(FULL, 'email')).toBe('');
    expect(startValue(null, 'name')).toBe('');
  });
});

describe('which fields can be edited', () => {
  it('name and title always can; organization can unless the contact is linked to a company', () => {
    expect(isEditable(FULL, 'name')).toBe(true);
    expect(isEditable(FULL, 'title')).toBe(true);
    expect(isEditable(FULL, 'organization')).toBe(true);
    const linked = { ...FULL, company_id: 'co1' };
    expect(isLinkedCompany(linked)).toBe(true);
    expect(isEditable(linked, 'organization')).toBe(false);
    expect(isEditable(linked, 'name')).toBe(true);
  });

  it('treats an empty company_id as not linked', () => {
    expect(isLinkedCompany({ company_id: '' })).toBe(false);
    expect(isLinkedCompany({ company_id: null })).toBe(false);
    expect(isLinkedCompany({})).toBe(false);
  });

  it('is false for any other field and for no contact', () => {
    expect(isEditable(FULL, 'email')).toBe(false);
    expect(isEditable(FULL, 'first_name')).toBe(false);
    expect(isEditable(null, 'name')).toBe(false);
  });
});

describe('planEdit', () => {
  it('writes the NAME field only, for a CSV contact, and never first_name or last_name', () => {
    const plan = planEdit(CSV, 'name', 'Jane Q. Doe');
    expect(plan).toEqual({ ok: true, field: 'name', storeField: 'name', value: 'Jane Q. Doe', previous: undefined });
    expect(Object.keys(plan)).not.toContain('first_name');
  });

  it('trims the value', () => {
    expect(planEdit(FULL, 'title', '  Head of Sales \n').value).toBe('Head of Sales');
    expect(planEdit(FULL, 'name', '  Ana M. Lopez ').value).toBe('Ana M. Lopez');
  });

  it('records the stored value as it was, to restore on failure', () => {
    expect(planEdit(FULL, 'title', 'VP')).toMatchObject({ ok: true, previous: 'Director' });
    expect(planEdit({ id: 'x' }, 'title', 'VP')).toMatchObject({ ok: true, previous: undefined });
  });

  it('refuses a blank or whitespace-only name, including for a contact that has none', () => {
    expect(planEdit(FULL, 'name', '')).toEqual({ ok: false, reason: 'blank_name' });
    expect(planEdit(FULL, 'name', '   \t ')).toEqual({ ok: false, reason: 'blank_name' });
    expect(planEdit({ id: 'x' }, 'name', ' ')).toEqual({ ok: false, reason: 'blank_name' });
  });

  it('allows clearing a title or an organization', () => {
    expect(planEdit(FULL, 'title', '')).toMatchObject({ ok: true, value: '', previous: 'Director' });
    expect(planEdit(FULL, 'organization', '  ')).toMatchObject({ ok: true, storeField: 'company_name', value: '' });
  });

  it('is a no-op when the trimmed value is what the header already shows', () => {
    expect(planEdit(FULL, 'title', ' Director ')).toEqual({ ok: false, reason: 'unchanged' });
    expect(planEdit(CSV, 'name', 'Jane Doe')).toEqual({ ok: false, reason: 'unchanged' });
    expect(planEdit({ id: 'x' }, 'title', '')).toEqual({ ok: false, reason: 'unchanged' });
    expect(planEdit({ id: 'x', company: 'Old Co' }, 'organization', 'Old Co')).toEqual({ ok: false, reason: 'unchanged' });
  });

  it('writes the organization to company_name, even when the contact only had company', () => {
    expect(planEdit({ id: 'x', company: 'Old Co' }, 'organization', 'New Co')).toMatchObject({ ok: true, storeField: 'company_name', value: 'New Co', previous: undefined });
  });

  it('refuses the organization of a contact linked to a company', () => {
    expect(planEdit({ ...FULL, company_id: 'co1' }, 'organization', 'Other')).toEqual({ ok: false, reason: 'not_editable' });
  });

  it('refuses an unknown field and a value that is not text', () => {
    expect(planEdit(FULL, 'email', 'a@b.co')).toEqual({ ok: false, reason: 'unknown_field' });
    expect(planEdit(FULL, 'title', 42)).toEqual({ ok: false, reason: 'not_text' });
    expect(planEdit(FULL, 'title', null)).toEqual({ ok: false, reason: 'not_text' });
    expect(planEdit(FULL, 'title', { a: 1 })).toEqual({ ok: false, reason: 'not_text' });
  });

  it('refuses a contact with no id', () => {
    expect(planEdit({ name: 'No id' }, 'title', 'X')).toEqual({ ok: false, reason: 'no_contact' });
    expect(planEdit(null, 'title', 'X')).toEqual({ ok: false, reason: 'no_contact' });
  });
});
