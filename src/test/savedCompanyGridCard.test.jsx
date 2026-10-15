/**
 * The Saved Companies grid card answers, at a glance: who, industry and where,
 * how big, contact state, ICP fit (only when an ICP is active), Barry's short
 * reason, and the one next action. Every value is verified company data or an
 * honest unknown — never "null", a stray 0, or the ICP's own criteria.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('firebase/firestore', () => new Proxy({}, {
  get: (target, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : vi.fn()),
}));
vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('../components/scout/CompanyLogo', () => ({ default: () => <div data-testid="logo" /> }));
vi.mock('../components/scout/CompanyDetailModal', () => ({ default: () => null }));

const {
  CompanyCardV5, fitPillFor, contactsSummaryFor, nextActionFor, cardSubtitleFor, VERIFYING_LABEL,
} = await import('../pages/Scout/SavedCompanies.jsx');
const { VERIFICATION_NEEDED_MESSAGE } = await import('../utils/companyDisplay.js');

const T = new Proxy({ isDark: false }, { get: (t, k) => (k in t ? t[k] : '#888') });

// A saved company with verified data and a measured fit under an active ICP.
const company = (extra = {}) => ({
  id: 'acme',
  name: 'Acme Software',
  status: 'accepted',
  industry: 'Computer Software',
  employee_count: 1250,
  hq_location: 'Lehi, Utah, United States',
  founded_year: 2012,
  website_url: 'https://acme.example',
  linkedin_url: 'https://linkedin.com/company/acme',
  barry_intel: 'Acme Software is a Computer Software company, about 1,250 employees, headquartered in Lehi, Utah, United States.',
  contact_count: 3,
  suggested_contact_count: 2,
  fit_score: 82,
  match_attributed: true,
  ...extra,
});

const renderCard = (c, props = {}) => render(
  <CompanyCardV5 company={c} T={T} onClick={vi.fn()} onFindContacts={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} {...props} />,
);

describe('the card answers the at-a-glance questions', () => {
  it('shows name, "Industry · Location", employees, contacts, fit, Barry and the next action', () => {
    const { container } = renderCard(company());

    expect(container.textContent).toContain('Acme Software');
    expect(screen.getByTestId('card-subtitle').textContent).toBe('Computer Software · Lehi, Utah, United States');
    expect(container.textContent).toContain('EMPLOYEES');
    expect(container.textContent).toContain('1,250');
    expect(container.textContent).toContain('CONTACTS');
    expect(container.textContent).toContain('3 · 2 suggested');
    expect(screen.getByTestId('card-fit-pill').textContent).toBe('82 · Strong fit');
    expect(screen.getByTestId('card-barry').textContent).toMatch(/^Acme Software is a Computer Software company/);
    expect(screen.getByTestId('card-next-action').textContent).toBe('View 3 contacts →');
  });

  it('no longer shows Founded or a duplicate Industry cell', () => {
    const { container } = renderCard(company());
    expect(container.textContent).not.toContain('FOUNDED');
    expect(container.textContent).not.toContain('2012');
    expect(container.textContent).not.toContain('INDUSTRY');
    expect(container.textContent.match(/Computer Software ·/g)).toHaveLength(1);
  });

  it('clamps Barry to two lines and keeps the full text on hover', () => {
    renderCard(company());
    const barry = screen.getByTestId('card-barry');
    expect(barry.style.webkitLineClamp || barry.style.WebkitLineClamp).toBe('2');
    expect(barry.getAttribute('title')).toBe(company().barry_intel);
  });

  it('keeps Visit, LinkedIn and Archive, and the primary action opens contacts without opening the card', () => {
    const onFindContacts = vi.fn();
    const onClick = vi.fn();
    const onArchive = vi.fn();
    renderCard(company(), { onFindContacts, onClick, onArchive });

    expect(screen.getByLabelText('Visit website')).toBeTruthy();
    expect(screen.getByLabelText('LinkedIn')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Archive company'));
    expect(onArchive).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('card-next-action'));
    expect(onFindContacts).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('an archived card offers Restore instead of Archive', () => {
    renderCard(company(), { isArchived: true });
    expect(screen.getByLabelText('Restore company')).toBeTruthy();
    expect(screen.queryByLabelText('Archive company')).toBeNull();
  });
});

describe('fit pill states', () => {
  it.each([
    [{ fit_score: 82 }, '82 · Strong fit'],
    [{ fit_score: 60 }, '60 · Good fit'],
    [{ fit_score: 20 }, '20 · Low fit'],
    [{ fit_score: 0 }, '0 · Low fit'],
    [{ fit_score: null }, '— · Not enough data'],
    [{ fit_score: null, company_enrichment_status: 'pending', company_enrichment_requested_at: Date.now() }, 'Verifying…'],
  ])('%o → %s', (extra, label) => {
    expect(fitPillFor(company(extra)).label).toBe(label);
    renderCard(company(extra));
    expect(screen.getByTestId('card-fit-pill').textContent).toBe(label);
  });

  it('no active ICP → no fit pill at all', () => {
    const c = company({ fit_score: null, match_attributed: false });
    expect(fitPillFor(c)).toBeNull();
    renderCard(c);
    expect(screen.queryByTestId('card-fit-pill')).toBeNull();
  });

  it('never renders "null", "N/A" or a bare 0 as a fit', () => {
    const { container } = renderCard(company({ fit_score: null }));
    const pill = screen.getByTestId('card-fit-pill').textContent;
    expect(pill).not.toMatch(/null|N\/A|^0$|\/100/);
    expect(container.textContent).not.toMatch(/\bnull\b/);
  });
});

describe('contact state and the next action', () => {
  it.each([
    [{ contact_count: 3, suggested_contact_count: 0 }, '3', 'View 3 contacts →'],
    [{ contact_count: 1, suggested_contact_count: 0 }, '1', 'View 1 contact →'],
    [{ contact_count: 3, suggested_contact_count: 2 }, '3 · 2 suggested', 'View 3 contacts →'],
    [{ contact_count: 0, suggested_contact_count: 2 }, '2 suggested', 'Review 2 suggested →'],
    [{ contact_count: 0, suggested_contact_count: 0 }, 'None yet', 'Find contacts →'],
  ])('%o → %s / %s', (extra, summary, action) => {
    expect(contactsSummaryFor(company(extra))).toBe(summary);
    expect(nextActionFor(company(extra))).toBe(action);
    renderCard(company(extra));
    expect(screen.getByTestId('card-next-action').textContent).toBe(action);
  });
});

describe('unknowns are honest', () => {
  it('a company with no verified data says so without placeholders', () => {
    const sparse = company({
      industry: 'null', employee_count: undefined, hq_location: undefined, fit_score: null,
      barry_intel: `Sparse Co. ${VERIFICATION_NEEDED_MESSAGE}`, contact_count: 0, suggested_contact_count: 0,
    });
    const { container } = renderCard(sparse);

    expect(screen.getByTestId('card-subtitle').textContent).toBe('Industry and location unknown');
    expect(container.textContent).toContain('N/A');
    expect(container.textContent).toContain('None yet');
    expect(screen.getByTestId('card-fit-pill').textContent).toBe('— · Not enough data');
    expect(screen.getByTestId('card-barry').textContent).toContain(VERIFICATION_NEEDED_MESSAGE);
    expect(container.textContent).not.toMatch(/\bnull\b/);
  });

  it('shows whichever half of the subtitle is known', () => {
    expect(cardSubtitleFor(company({ hq_location: undefined }))).toBe('Computer Software');
    expect(cardSubtitleFor(company({ industry: 'Unknown' }))).toBe('Lehi, Utah, United States');
  });

  it('while enrichment runs: Verifying in the subtitle and pill, … for employees', () => {
    const pending = company({
      industry: undefined, employee_count: undefined, hq_location: undefined, fit_score: null,
      company_enrichment_status: 'pending', company_enrichment_requested_at: Date.now(),
    });
    const { container } = renderCard(pending);

    expect(screen.getByTestId('card-subtitle').textContent).toBe(VERIFYING_LABEL);
    expect(screen.getByTestId('card-fit-pill').textContent).toBe('Verifying…');
    expect(container.textContent).toContain('…');
    expect(container.textContent).not.toContain('N/A');
  });

  it('strips a legacy ICP-derived claim from Barry, and falls back to the description', () => {
    renderCard(company({ barry_intel: 'Old Co is a this sector company. Matches your ICP criteria: 11-20 employees.' }));
    expect(screen.getByTestId('card-barry').textContent).not.toContain('Matches your ICP criteria');

    const { container } = renderCard(company({ id: 'd', barry_intel: undefined, description: 'Payroll software for restaurants.' }));
    expect(container.textContent).toContain('Payroll software for restaurants.');
  });

  it('hides the Barry row when there is nothing to say', () => {
    renderCard(company({ barry_intel: undefined, description: undefined }));
    expect(screen.queryByTestId('card-barry')).toBeNull();
  });
});
