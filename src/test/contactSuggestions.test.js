/**
 * Taking Enrich's title suggestion (#733): the title is written with
 * `enrichment_provenance.title: 'user_accepted'`, by path so every other
 * provenance entry stays, and nothing but a title suggestion can be taken.
 * An email found on the company website is taken the same way, and only
 * while the contact still has none.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateDoc = vi.fn(async () => {});
let stored = null;
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...path) => ({ path: path.join('/') }),
  getDoc: async () => ({ exists: () => stored !== null, data: () => stored }),
  updateDoc: (...args) => updateDoc(...args),
}));
vi.mock('../firebase/config', () => ({ db: {} }));

const { acceptTitleSuggestion, acceptEmailSuggestion, USER_ACCEPTED } = await import('../services/contactSuggestions');

const TITLE = { field: 'title', current: 'VP Sales', suggested: '  Chief Revenue Officer ', actionable: true };

beforeEach(() => updateDoc.mockClear());

describe('acceptTitleSuggestion', () => {
  it('writes the title and user_accepted provenance by path, nothing else', async () => {
    const written = await acceptTitleSuggestion('u1', 'c1', TITLE);
    expect(updateDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = updateDoc.mock.calls[0];
    expect(ref.path).toBe('users/u1/contacts/c1');
    expect(data).toEqual({ title: 'Chief Revenue Officer', 'enrichment_provenance.title': 'user_accepted' });
    expect(written).toEqual(data);
    expect(USER_ACCEPTED).toBe('user_accepted');
  });

  it.each([
    ['a company difference', { field: 'company', current: 'Northwind', suggested: 'Contoso', actionable: false }],
    ['a non-actionable title', { ...TITLE, actionable: false }],
    ['an empty title', { ...TITLE, suggested: '  ' }],
    ['nothing', undefined],
  ])('refuses %s and writes nothing', async (_name, suggestion) => {
    await expect(acceptTitleSuggestion('u1', 'c1', suggestion)).rejects.toThrow('only a title suggestion can be accepted');
    expect(updateDoc).not.toHaveBeenCalled();
  });
});

describe('acceptEmailSuggestion', () => {
  const EMAIL = { field: 'email', current: null, suggested: ' info@northwind.com ', actionable: true, source: 'website' };

  it('writes the email and user_accepted provenance by path, while the contact has none', async () => {
    stored = { name: 'Jimmy', email: '' };
    const written = await acceptEmailSuggestion('u1', 'c1', EMAIL);
    expect(updateDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = updateDoc.mock.calls[0];
    expect(ref.path).toBe('users/u1/contacts/c1');
    expect(data).toEqual({ email: 'info@northwind.com', 'enrichment_provenance.email': 'user_accepted' });
    expect(written).toEqual(data);
  });

  it.each([
    ['an email the contact got meanwhile', { email: 'jimmy@northwind.com' }],
    ['a work email', { work_email: 'jimmy@northwind.com' }],
    ['a missing contact', null],
  ])('refuses over %s and writes nothing', async (_name, current) => {
    stored = current;
    await expect(acceptEmailSuggestion('u1', 'c1', EMAIL)).rejects.toThrow();
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('refuses anything but an actionable email suggestion', async () => {
    stored = { email: '' };
    await expect(acceptEmailSuggestion('u1', 'c1', { field: 'title', suggested: 'CEO', actionable: true })).rejects.toThrow('only an email suggestion can be accepted');
    await expect(acceptEmailSuggestion('u1', 'c1', { ...EMAIL, actionable: false })).rejects.toThrow('only an email suggestion can be accepted');
    expect(updateDoc).not.toHaveBeenCalled();
  });
});
