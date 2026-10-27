/**
 * Taking Enrich's title suggestion (#733): the title is written with
 * `enrichment_provenance.title: 'user_accepted'`, by path so every other
 * provenance entry stays, and nothing but a title suggestion can be taken.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateDoc = vi.fn(async () => {});
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...path) => ({ path: path.join('/') }),
  updateDoc: (...args) => updateDoc(...args),
}));
vi.mock('../firebase/config', () => ({ db: {} }));

const { acceptTitleSuggestion, USER_ACCEPTED } = await import('../services/contactSuggestions');

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
