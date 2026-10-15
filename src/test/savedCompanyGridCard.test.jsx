/**
 * The Saved Companies grid card is the fast-scan layer: name, industry,
 * employees, founded, location, corporate phone when one is stored, contacts,
 * and one next action. It shows no ICP fit pill, so the company name gets the
 * full header width; the fit score stays in the swipe view and the detail
 * view. Deeper intelligence — overview, decision makers, Barry — lives in the
 * company detail view.
 * Every value is stored company or enrichment data or an honest unknown; the
 * card never fetches anything and never shows a placeholder as a fact.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('firebase/firestore', () => new Proxy({}, {
  get: (target, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : vi.fn()),
}));
vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('../components/scout/CompanyLogo', () => ({ default: () => <div data-testid="logo" /> }));
vi.mock('../components/scout/CompanyDetailModal', () => ({ default: () => null }));

const {
  CompanyCardV5, contactsSummaryFor, nextActionFor, industryLineFor,
  cardLocationFor, cardPhoneFor, telHrefFor, VERIFYING_LABEL,
} = await import('../pages/Scout/SavedCompanies.jsx');
const { VERIFICATION_NEEDED_MESSAGE } = await import('../utils/companyDisplay.js');

const T = new Proxy({ isDark: false }, { get: (t, k) => (k in t ? t[k] : '#888') });

// A saved, enriched company with a measured fit under an active ICP.
const company = (extra = {}) => ({
  id: 'marketstar',
  name: 'MarketStar',
  status: 'accepted',
  industry: 'Outsourcing/Offshoring',
  employee_count: 5300,
  founded_year: 1988,
  hq_location: 'Ogden, Utah, United States',
  phone: '+1 801-000-0000',
  website_url: 'https://marketstar.example',
  linkedin_url: 'https://linkedin.com/company/marketstar',
  apolloEnrichment: {
    snapshot: {
      phone: '+1 800-877-8259',
      location: { city: 'Ogden', state: 'Utah', country: 'United States', full: 'Ogden, Utah, United States' },
    },
  },
  barry_intel: 'MarketStar is an Outsourcing/Offshoring company, about 5,300 employees, headquartered in Ogden, Utah.',
  contact_count: 0,
  suggested_contact_count: 0,
  fit_score: 100,
  match_attributed: true,
  ...extra,
});

const renderCard = (c, props = {}) => render(
  <CompanyCardV5 company={c} T={T} onClick={vi.fn()} onFindContacts={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} {...props} />,
);

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  global.fetch = fetchSpy;
});

describe('the card is the fast-scan layer', () => {
  it('shows name, industry, employees, founded, location, phone, contacts and the next action', () => {
    const { container } = renderCard(company());

    expect(container.textContent).toContain('MarketStar');
    expect(screen.getByTestId('card-industry').textContent).toBe('Outsourcing/Offshoring');
    expect(screen.getByTestId('card-employees').textContent).toBe('5,300');
    expect(screen.getByTestId('card-founded').textContent).toBe('1988');
    expect(screen.getByTestId('card-location').textContent).toBe('Ogden, Utah');
    expect(screen.getByTestId('card-phone').textContent).toBe('+1 800-877-8259');
    expect(screen.getByTestId('card-contacts').textContent).toBe('None yet');
    expect(screen.getByTestId('card-next-action').textContent).toBe('Find contacts →');
  });

  it('Founded is back, formatted as a year', () => {
    renderCard(company({ founded_year: 2012 }));
    expect(screen.getByTestId('card-founded').textContent).toBe('2012');
  });

  it('Barry is not on the grid card at all', () => {
    const { container } = renderCard(company({ barry_intel: `Something. ${VERIFICATION_NEEDED_MESSAGE}`, description: 'A description.' }));
    expect(screen.queryByTestId('card-barry')).toBeNull();
    expect(container.textContent).not.toContain('BARRY');
    expect(container.textContent).not.toContain(VERIFICATION_NEEDED_MESSAGE);
    expect(container.textContent).not.toContain('A description.');
  });

  it('makes no API or enrichment call to render', () => {
    renderCard(company({ apolloEnrichment: undefined, phone: '' }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps Visit, LinkedIn and Archive; the primary action does not also open the card', () => {
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

describe('corporate phone', () => {
  it('reads apolloEnrichment.snapshot.phone first', () => {
    expect(cardPhoneFor(company())).toBe('+1 800-877-8259');
  });

  it('falls back to the phone discovery stored', () => {
    const c = company({ apolloEnrichment: undefined });
    expect(cardPhoneFor(c)).toBe('+1 801-000-0000');
    renderCard(c);
    expect(screen.getByTestId('card-phone').textContent).toBe('+1 801-000-0000');
  });

  it('is hidden when missing — no cell, no label, no placeholder', () => {
    const c = company({ apolloEnrichment: { snapshot: { phone: null } }, phone: '' });
    expect(cardPhoneFor(c)).toBeNull();
    const { container } = renderCard(c);
    expect(screen.queryByTestId('card-phone')).toBeNull();
    expect(container.textContent).not.toContain('PHONE');
  });

  it('treats placeholder phone values as missing', () => {
    expect(cardPhoneFor(company({ apolloEnrichment: { snapshot: { phone: 'null' } }, phone: 'N/A' }))).toBeNull();
  });

  it('is a tel: link', () => {
    renderCard(company());
    const link = screen.getByTestId('card-phone');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('tel:+18008778259');
    expect(telHrefFor('(801) 555-0100')).toBe('tel:8015550100');
  });

  it('a phone click does not bubble up and open the detail modal', () => {
    const onClick = vi.fn();
    renderCard(company(), { onClick });
    fireEvent.click(screen.getByTestId('card-phone'));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('short location', () => {
  it('uses "City, State" from the enrichment snapshot', () => {
    expect(cardLocationFor(company())).toBe('Ogden, Utah');
  });

  it('uses the company city and state when the snapshot has none', () => {
    expect(cardLocationFor(company({ apolloEnrichment: undefined, city: 'Lehi', state: 'Utah' }))).toBe('Lehi, Utah');
  });

  it('otherwise uses the stored HQ string without a trailing United States', () => {
    expect(cardLocationFor(company({ apolloEnrichment: undefined }))).toBe('Ogden, Utah');
    expect(cardLocationFor(company({ apolloEnrichment: undefined, hq_location: 'London, England, United Kingdom' })))
      .toBe('London, England, United Kingdom');
  });

  it('is N/A when nothing is stored, and … while verifying', () => {
    const none = company({ apolloEnrichment: undefined, hq_location: undefined });
    expect(cardLocationFor(none)).toBeNull();
    renderCard(none);
    expect(screen.getByTestId('card-location').textContent).toBe('N/A');
  });
});

describe('no fit pill on the grid card', () => {
  const FIT_TEXT = /Strong fit|Good fit|Low fit|Not enough data|Verifying…|\/100/;

  it.each([
    ['a strong fit', { fit_score: 100 }],
    ['a good fit', { fit_score: 60 }],
    ['a low fit', { fit_score: 20 }],
    ['a zero score', { fit_score: 0 }],
    ['no score yet', { fit_score: null }],
    ['enrichment pending', { fit_score: null, company_enrichment_status: 'pending', company_enrichment_requested_at: Date.now() }],
    ['no active ICP', { fit_score: null, match_attributed: false }],
  ])('%s: no pill and no fit label', (_, extra) => {
    const { container } = renderCard(company(extra));
    expect(screen.queryByTestId('card-fit-pill')).toBeNull();
    expect(container.textContent).not.toMatch(FIT_TEXT);
    expect(container.textContent).not.toMatch(/\bnull\b/);
  });

  it('the company name has the header to itself: only the logo sits beside it', () => {
    renderCard(company({ fit_score: 100 }));
    const nameBlock = screen.getByText('MarketStar').closest('div');
    expect(nameBlock.style.flex).toMatch(/^1/);
    expect(nameBlock.parentElement.children).toHaveLength(2);
  });

  it('an archived card adds only its Archived badge to the header', () => {
    renderCard(company({ fit_score: 100 }), { isArchived: true });
    const header = screen.getByText('MarketStar').closest('div').parentElement;
    expect(header.children).toHaveLength(3);
    expect(header.lastElementChild.textContent).toBe('Archived');
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
    expect(screen.getByTestId('card-contacts').textContent).toBe(summary);
    expect(screen.getByTestId('card-next-action').textContent).toBe(action);
  });
});

describe('unknowns are honest', () => {
  it('a company with no verified data shows N/A facts and no fake values', () => {
    const sparse = company({
      industry: 'null', employee_count: undefined, founded_year: 0, hq_location: undefined,
      apolloEnrichment: undefined, phone: '', fit_score: null,
    });
    const { container } = renderCard(sparse);

    expect(industryLineFor(sparse)).toBe('Industry unknown');
    expect(screen.getByTestId('card-industry').textContent).toBe('Industry unknown');
    expect(screen.getByTestId('card-employees').textContent).toBe('N/A');
    expect(screen.getByTestId('card-founded').textContent).toBe('N/A');
    expect(screen.getByTestId('card-location').textContent).toBe('N/A');
    expect(screen.queryByTestId('card-phone')).toBeNull();
    expect(container.textContent).not.toMatch(/\bnull\b/);
  });

  it('while enrichment runs: Verifying, and … for the facts about to arrive', () => {
    const pending = company({
      industry: undefined, employee_count: undefined, founded_year: undefined, hq_location: undefined,
      apolloEnrichment: undefined, phone: '', fit_score: null,
      company_enrichment_status: 'pending', company_enrichment_requested_at: Date.now(),
    });
    const { container } = renderCard(pending);

    expect(screen.getByTestId('card-industry').textContent).toBe(VERIFYING_LABEL);
    expect(screen.getByTestId('card-employees').textContent).toBe('…');
    expect(screen.getByTestId('card-founded').textContent).toBe('…');
    expect(screen.getByTestId('card-location').textContent).toBe('…');
    expect(container.textContent).not.toContain('N/A');
  });
});
