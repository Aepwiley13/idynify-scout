/**
 * Saved Companies while a just-accepted company is being verified, and after.
 *
 * While company-only enrichment runs, the page shows "Verifying company
 * details…", "…" for values about to arrive, — for the score, and Barry's
 * verification-needed text: nothing invented, no 0/100, no "No active ICP".
 * When enrichment lands, the watched document updates the same card in place
 * with real industry, employees, HQ, a measured score and factual Barry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, renderHook, act } from '@testing-library/react';

const LISTENERS = new Map();
const UNSUBSCRIBED = [];
vi.mock('firebase/firestore', () => new Proxy({
  doc: (_db, ...path) => ({ __path: path.join('/'), id: path[path.length - 1] }),
  onSnapshot: (ref, onNext) => {
    LISTENERS.set(ref.id, onNext);
    return () => { LISTENERS.delete(ref.id); UNSUBSCRIBED.push(ref.id); };
  },
}, {
  get: (target, prop) => (prop in target ? target[prop] : (prop === 'then' || typeof prop === 'symbol' ? undefined : vi.fn())),
}));
vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('../components/scout/CompanyLogo', () => ({ default: () => <div data-testid="logo" /> }));
vi.mock('../components/scout/CompanyDetailModal', () => ({ default: () => null }));

const { CompanyCardV5, SwipeDeck, VERIFYING_LABEL } = await import('../pages/Scout/SavedCompanies.jsx');
const { usePendingEnrichmentUpdates } = await import('../hooks/usePendingEnrichmentUpdates.js');
const { VERIFICATION_NEEDED_MESSAGE } = await import('../utils/companyDisplay.js');
const { calculateICPScore, DEFAULT_WEIGHTS } = await import('../utils/icpScoring.js');

const T = new Proxy({ isDark: false }, { get: (t, k) => (k in t ? t[k] : '#888') });
const ICP = { industries: ['Computer Software'], locations: ['Utah'], companySizes: ['21-50'] };

// Accepted a moment ago: discovery data only, enrichment in flight.
const pendingCompany = () => ({
  id: 'org-acme',
  name: 'Acme',
  status: 'accepted',
  industry: 'null',
  founded_year: 0,
  revenue: '',
  website_url: 'http://www.acme.example',
  barry_intel: `Acme. ${VERIFICATION_NEEDED_MESSAGE}`,
  company_enrichment_status: 'pending',
  company_enrichment_requested_at: Date.now(),
  contact_count: 0,
  fit_score: null,
  match_attributed: true,
});

// The same document once enrichment has landed.
const enrichedCompany = () => {
  const c = {
    ...pendingCompany(),
    industry: 'Computer Software',
    employee_count: 42,
    state: 'Utah',
    hq_location: 'Lehi, Utah, United States',
    location: 'Lehi, Utah, United States',
    founded_year: 2012,
    revenue: '12.5M',
    barry_intel: 'Acme is a Computer Software company, about 42 employees, headquartered in Lehi, Utah, United States.',
    company_enrichment_status: 'done',
  };
  return { ...c, fit_score: calculateICPScore(c, ICP, DEFAULT_WEIGHTS) };
};

const noop = () => {};

beforeEach(() => {
  LISTENERS.clear();
  UNSUBSCRIBED.length = 0;
});

describe('the saved-company card while enrichment is pending', () => {
  it('says it is verifying and shows no fake or placeholder values', () => {
    const { container } = render(<CompanyCardV5 company={pendingCompany()} T={T} onClick={noop} onArchive={noop} onRestore={noop} />);

    expect(container.textContent).toContain(VERIFYING_LABEL);
    expect(container.textContent).not.toMatch(/\bnull\b/);
    expect(container.textContent).not.toContain('N/A');
    expect(container.textContent).not.toMatch(/\b0\b/);
    expect(container.textContent).toContain('…');
  });

  it('shows the real values once enrichment lands', () => {
    const { container } = render(<CompanyCardV5 company={enrichedCompany()} T={T} onClick={noop} onArchive={noop} onRestore={noop} />);

    expect(container.textContent).not.toContain(VERIFYING_LABEL);
    expect(container.textContent).toContain('Computer Software');
    expect(container.textContent).toContain('42');
    expect(container.textContent).toContain('Lehi, Utah, United States');
    // Founded lives in the detail view and Barry, not on the grid card.
    expect(container.textContent).not.toContain('2012');
  });

  it('after a failed or abandoned enrichment, shows the normal unknown state, not "Verifying"', () => {
    const failed = { ...pendingCompany(), company_enrichment_status: 'failed' };
    const { container } = render(<CompanyCardV5 company={failed} T={T} onClick={noop} onArchive={noop} onRestore={noop} />);

    expect(container.textContent).not.toContain(VERIFYING_LABEL);
    expect(container.textContent).toContain('N/A');
    expect(container.textContent).not.toMatch(/\bnull\b/);
  });
});

describe('the swipe deck while pending, and after enrichment lands', () => {
  it('pending: — for the score, verification Barry, no 0/100 and no "No active ICP"', () => {
    const { container } = render(<SwipeDeck companies={[pendingCompany()]} totalActive={1} T={T} onFindContact={noop} />);

    expect(screen.getByTestId('saved-fit-score').textContent).toBe('—');
    expect(container.textContent).not.toContain('/100');
    expect(container.textContent).not.toContain('No active ICP');
    expect(container.textContent).toContain(VERIFYING_LABEL);
    expect(container.textContent).toContain(VERIFICATION_NEEDED_MESSAGE);
    expect(container.textContent).not.toMatch(/matches your/i);
  });

  it('updates the card in place when the enriched document arrives — score and factual Barry', () => {
    const { container, rerender } = render(<SwipeDeck companies={[pendingCompany()]} totalActive={1} T={T} onFindContact={noop} />);

    rerender(<SwipeDeck companies={[enrichedCompany()]} totalActive={1} T={T} onFindContact={noop} />);

    expect(screen.getByTestId('saved-fit-score').textContent).toBe('100');
    expect(container.textContent).toContain('/100');
    expect(container.textContent).toContain('COMPUTER SOFTWARE');
    expect(container.textContent).toContain('Lehi, Utah, United States');
    expect(container.textContent).toContain('Acme is a Computer Software company, about 42 employees');
    expect(container.textContent).not.toContain(VERIFICATION_NEEDED_MESSAGE);
    expect(container.textContent).not.toContain(VERIFYING_LABEL);
  });

  it('an ICP with an unmeasurable company is "Not enough data", not "No active ICP"', () => {
    const settled = { ...pendingCompany(), company_enrichment_status: 'failed' };
    const { container } = render(<SwipeDeck companies={[settled]} totalActive={1} T={T} onFindContact={noop} />);

    expect(screen.getByTestId('saved-fit-score').textContent).toBe('—');
    expect(container.textContent).toContain('Not enough data');
    expect(container.textContent).not.toContain('No active ICP');
  });
});

describe('usePendingEnrichmentUpdates', () => {
  it('watches only pending companies, delivers their update, and stops once enriched', () => {
    const onUpdate = vi.fn();
    const settled = { ...enrichedCompany(), id: 'org-done' };
    const { rerender } = renderHook(
      ({ companies }) => usePendingEnrichmentUpdates({ userId: 'user-1', companies, onUpdate }),
      { initialProps: { companies: [pendingCompany(), settled] } },
    );

    expect([...LISTENERS.keys()]).toEqual(['org-acme']);

    const landed = enrichedCompany();
    act(() => LISTENERS.get('org-acme')({ exists: () => true, data: () => landed }));
    expect(onUpdate).toHaveBeenCalledWith('org-acme', landed);

    rerender({ companies: [landed, settled] });
    expect(LISTENERS.size).toBe(0);
    expect(UNSUBSCRIBED).toContain('org-acme');
  });

  it('watches nothing when no company is pending', () => {
    renderHook(() => usePendingEnrichmentUpdates({ userId: 'user-1', companies: [enrichedCompany()], onUpdate: vi.fn() }));
    expect(LISTENERS.size).toBe(0);
  });
});
