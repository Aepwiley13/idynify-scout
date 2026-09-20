/**
 * A guessed company name must not present itself as a confirmed one.
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * `ensureCompanyForContact` can create a company whose name it guessed from a
 * work-email domain — `rd-advantage.com` becomes "Rd Advantage" where the
 * organization writes itself "R&D Advantage", `blackdesertresort.com` becomes
 * "Blackdesertresort". Those companies carry `name_source: 'email_domain'`.
 *
 * `applyCompanyEnrichment` corrects such a name, but only once someone OPENS
 * that company's detail page. Before that the guess is already visible in
 * Saved Companies, rendered in exactly the weight and colour as a name Apollo
 * confirmed. This pins the rule that makes the two look different.
 *
 * The provenance rule is deliberately narrow, and the last two cases are the
 * ones worth breaking a build over: an ABSENT `name_source` is authoritative
 * (every company written before the field existed lacks it, and muting all
 * 3,198 of them would be far worse than leaving a handful of guesses unmarked),
 * and a name the USER typed is never second-guessed.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(),
  limit: vi.fn(), query: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), where: vi.fn(),
}));

const { getDisplayName } = await import('../utils/companyDisplay.js');

describe('getDisplayName — name provenance', () => {
  it('leads with the domain and trails the guess when the name was derived', () => {
    const result = getDisplayName({
      name: 'Rd Advantage', domain: 'rd-advantage.com', name_source: 'email_domain',
    });
    expect(result).toEqual({ label: 'rd-advantage.com', hint: 'Rd Advantage', derived: true });
  });

  it('marks the concatenation cases, which are the common ones', () => {
    // 14 of the 20 real cases in production look like this, not like the
    // hyphenated example everybody quotes.
    const result = getDisplayName({
      name: 'Blackdesertresort', domain: 'blackdesertresort.com', name_source: 'email_domain',
    });
    expect(result.label).toBe('blackdesertresort.com');
    expect(result.hint).toBe('Blackdesertresort');
  });

  it('finds the domain under any of the fields a company stores it in', () => {
    const result = getDisplayName({
      name: 'Stonegalleria', website_url: 'https://www.stonegalleria.net/about', name_source: 'email_domain',
    });
    expect(result.label).toBe('stonegalleria.net');
  });

  it('keeps the guess as the label when the company has no domain at all', () => {
    // Still flagged derived, so the caller can mark it — there is just nothing
    // more truthful to lead with.
    const result = getDisplayName({ name: 'Esslyo', name_source: 'email_domain' });
    expect(result).toEqual({ label: 'Esslyo', hint: null, derived: true });
  });

  it('shows no redundant hint when the guess already equals the domain', () => {
    const result = getDisplayName({ name: 'acme.com', domain: 'acme.com', name_source: 'email_domain' });
    expect(result.hint).toBeNull();
  });

  it('leaves an Apollo-confirmed name exactly as it is', () => {
    const result = getDisplayName({ name: 'R&D Advantage', domain: 'rd-advantage.com', name_source: 'apollo' });
    expect(result).toEqual({ label: 'R&D Advantage', hint: null, derived: false });
  });

  it('treats an unset name_source as authoritative, not as a guess', () => {
    // All 3,198 companies in production predate the field. None may be muted.
    const result = getDisplayName({ name: 'Deloitte', domain: 'deloitte.com' });
    expect(result).toEqual({ label: 'Deloitte', hint: null, derived: false });
  });

  it('never second-guesses a name the user typed', () => {
    const result = getDisplayName({ name: 'Acme (Northeast)', domain: 'acme.com', name_source: 'user' });
    expect(result).toEqual({ label: 'Acme (Northeast)', hint: null, derived: false });
  });

  it("uses the caller's own empty-state wording", () => {
    expect(getDisplayName({}).label).toBe('Unknown');
    expect(getDisplayName({}, 'Unnamed Company').label).toBe('Unnamed Company');
    expect(getDisplayName(null, 'Unnamed Company').label).toBe('Unnamed Company');
  });
});
