/**
 * What the reader actually sees when a company's name is a guess.
 *
 * companyDisplayName.test.js pins the provenance RULE. This pins the RENDER,
 * which is the part of this change that can regress silently: getDisplayName
 * could stay perfectly correct while the component drops the hint, renders it
 * in the same weight as the name, or ships it with no explanation of what the
 * second string is. All three would restore the exact confusion the change
 * exists to remove — a guessed name reading as a confirmed one.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(),
  limit: vi.fn(), query: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), where: vi.fn(),
}));
vi.mock('../theme/ThemeContext', () => ({
  useT: () => ({ text: '#111', textFaint: '#999', textMuted: '#666' }),
}));

const { default: CompanyName } = await import('../components/scout/CompanyName.jsx');

const GUESSED = { name: 'Rd Advantage', domain: 'rd-advantage.com', name_source: 'email_domain' };

describe('CompanyName — what the reader sees', () => {
  it('leads with the domain and shows the guess parenthesised', () => {
    render(<CompanyName company={GUESSED} />);
    expect(screen.getByText('rd-advantage.com')).toBeTruthy();
    expect(screen.getByText('(Rd Advantage)')).toBeTruthy();
  });

  it('renders the guess lighter than the name, not at equal weight', () => {
    // The whole point: the two strings must not read as equally authoritative.
    render(<CompanyName company={GUESSED} style={{ fontWeight: 600 }} />);
    const hint = screen.getByText('(Rd Advantage)');
    expect(hint.style.fontWeight).toBe('400');
    expect(hint.style.color).toBe('rgb(153, 153, 153)'); // textFaint, not text
  });

  it('explains what the second string is, rather than leaving it unlabelled', () => {
    render(<CompanyName company={GUESSED} />);
    expect(screen.getByText('(Rd Advantage)').getAttribute('title'))
      .toContain('Name not confirmed');
  });

  it('renders an Apollo-confirmed name alone, with nothing appended', () => {
    render(<CompanyName company={{ name: 'Deloitte', domain: 'deloitte.com', name_source: 'apollo' }} />);
    expect(screen.getByText('Deloitte')).toBeTruthy();
    expect(screen.queryByText(/\(/)).toBeNull();
  });

  it('renders a pre-existing company with no name_source completely unchanged', () => {
    // All 3,198 companies in production are in this state today. If this test
    // fails, the change has visibly altered every row in Saved Companies.
    const { container } = render(<CompanyName company={{ name: 'Cotopaxi', domain: 'cotopaxi.com' }} />);
    expect(container.textContent).toBe('Cotopaxi');
  });

  it("honours the caller's own empty-state wording", () => {
    const { container } = render(<CompanyName company={{}} fallback="Unnamed Company" />);
    expect(container.textContent).toBe('Unnamed Company');
  });
});
