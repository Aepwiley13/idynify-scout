/**
 * Company detail pop-out: layout.
 *
 * The modal's class names are shared with pages whose stylesheets ship in the
 * same global bundle (CompanyDetail.css, ContactProfile.css). Those page rules
 * made the modal's content wider than the panel and clipped its right edge, and
 * collapsed the snapshot to one column on laptops. The modal's own layout now
 * lives in rules scoped to `.company-detail-overlay .cdm`.
 *
 * jsdom does no layout, so this checks two things it can: the rendered
 * structure (every section and action present, behaviour unchanged) and the
 * scoped stylesheet's contract (panel width, grids that wrap rather than
 * overflow, nothing leaking out to other pages).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

const people = [
  ['Jennifer Montgomery-Alexander', 'Chief Executive Officer and President, Global Operations', 'Executive'],
  ['Robert Chen', 'Senior Vice President of Revenue Operations & Strategy', 'Sales'],
  ['Maria Gonzalez', 'Chief Marketing Officer', 'Marketing'],
  ['David Okonkwo', 'VP, Engineering', 'Engineering'],
].map(([name, title, department], i) => ({ id: `p${i}`, name, title, department, linkedin_url: `https://linkedin.com/in/p${i}` }));

const techStack = ['Salesforce', 'Amazon Web Services (AWS) CloudFront CDN', 'HubSpot Marketing Automation Platform', 'Slack', 'Zendesk']
  .map(name => ({ name, category: 'Other' }));

const enrichment = {
  snapshot: {
    name: 'MarketStar', industry: 'Outsourcing/Offshoring', employee_count_range: '5,001-10,000', revenue_range: '$100M-$250M',
    founded_year: 1988, location: { full: '2475 Washington Blvd, Ogden, Utah 84401, United States' }, phone: '+1 800-877-8259',
    description: 'MarketStar designs, builds and runs sales and marketing programs for technology brands.',
    website_url: 'http://www.marketstar.com',
  },
  decisionMakers: people,
  techStack,
  dataQuality: { organization_status: 'active', linkedin_url: 'http://www.linkedin.com/company/marketstar' },
  _raw: { enrichedAt: Date.now(), mode: 'full' },
};

// A fresh full enrichment: the modal shows it and makes no API call.
const companyDoc = {
  id: 'org-1', name: 'MarketStar', industry: 'Outsourcing/Offshoring', website_url: 'http://www.marketstar.com',
  linkedin_url: 'http://www.linkedin.com/company/marketstar', contact_count: 3,
  apolloEnrichment: enrichment, apolloEnrichedAt: Date.now(),
};

vi.mock('firebase/firestore', () => new Proxy({
  doc: () => ({}),
  getDoc: async () => ({ exists: () => true, data: () => companyDoc }),
}, {
  get: (target, prop) => (prop in target ? target[prop] : (prop === 'then' || typeof prop === 'symbol' ? undefined : vi.fn())),
}));
vi.mock('../services/peopleService', () => ({ searchPeople: vi.fn(async () => []), updatePerson: vi.fn() }));
vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => ({ uid: 'user-1', getIdToken: async () => 'token' }) }));
vi.mock('../components/scout/CompanyLogo', () => ({ default: ({ className }) => <div className={className} /> }));

globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };

const { default: CompanyDetailModal } = await import('../components/scout/CompanyDetailModal.jsx');

async function renderModal(props = {}) {
  const view = render(
    <MemoryRouter>
      <CompanyDetailModal company={companyDoc} onClose={() => {}} onFindMoreContacts={() => {}} {...props} />
    </MemoryRouter>,
  );
  await screen.findByText('Key Decision Makers');
  return view;
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

describe('company detail modal structure', () => {
  it('renders the panel inside the overlay, with the scoped layout class', async () => {
    const { container } = await renderModal();
    const panel = container.querySelector('.company-detail-overlay > .company-detail-container');
    expect(panel).not.toBeNull();
    expect(panel.classList.contains('cdm')).toBe(true);
    expect(panel.querySelector('.company-detail-content')).not.toBeNull();
  });

  it('keeps the header to logo, name, industry, refresh and close', async () => {
    const { container } = await renderModal();
    const header = container.querySelector('.company-detail-header');
    expect(within(header).getByText('MarketStar')).toBeTruthy();
    expect(within(header).getByText('Outsourcing/Offshoring')).toBeTruthy();
    expect(header.querySelector('.company-detail-logo-wrapper')).not.toBeNull();
    expect(header.querySelectorAll('.header-actions button')).toHaveLength(2);
    expect(header.querySelector('.refresh-button')).not.toBeNull();
    expect(header.querySelector('.close-button')).not.toBeNull();
  });

  it('shows all six snapshot facts in one grid', async () => {
    const { container } = await renderModal();
    const items = container.querySelectorAll('.snapshot-grid > .snapshot-item');
    expect([...items].map(i => i.querySelector('.snapshot-label').textContent))
      .toEqual(['Industry', 'Employees', 'Revenue', 'Founded', 'Address', 'Phone']);
    expect(container.querySelector('.snapshot-grid').textContent).toContain('2475 Washington Blvd, Ogden, Utah 84401, United States');
  });

  it('keeps the overview, both links, the contact search, tech stack, data confidence and the CTA', async () => {
    const { container } = await renderModal();
    expect(container.querySelector('.company-overview-text').textContent).toContain('MarketStar designs');
    expect(within(container.querySelector('.links-container')).getByText('Visit Website')).toBeTruthy();
    expect(within(container.querySelector('.links-container')).getByText('View on LinkedIn')).toBeTruthy();
    expect(container.querySelector('.people-search-input')).not.toBeNull();
    expect(container.querySelectorAll('.tech-stack-grid > .tech-card')).toHaveLength(techStack.length);
    expect([...container.querySelectorAll('.data-quality-label')].map(l => l.textContent))
      .toEqual(['Last Updated:', 'Status:', 'Source:']);
    expect(screen.getByRole('button', { name: 'View Contacts →' })).toBeTruthy();
  });

  it('renders every decision maker as a card in one grid, with name, title, tag, LinkedIn and selection', async () => {
    const { container } = await renderModal();
    const cards = container.querySelectorAll('.decision-makers-grid > .decision-maker-card');
    expect(cards).toHaveLength(people.length);
    cards.forEach((card, i) => {
      expect(card.querySelector('.decision-maker-name').textContent).toBe(people[i].name);
      expect(card.querySelector('.decision-maker-title').textContent).toBe(people[i].title);
      expect(card.querySelector('.decision-maker-dept').textContent).toBe(people[i].department);
      expect(card.querySelector('.decision-maker-linkedin')).not.toBeNull();
      expect(card.querySelector('.decision-maker-select-indicator .checkbox')).not.toBeNull();
    });
    const actions = container.querySelector('.decision-makers-actions');
    expect(within(actions).getByText('Select contacts to add')).toBeTruthy();
    expect(within(actions).getByText('Find More Contacts')).toBeTruthy();
  });
});

describe('behaviour is unchanged', () => {
  it('selecting a decision maker still marks the card and updates the save button', async () => {
    const { container } = await renderModal();
    const card = container.querySelectorAll('.decision-maker-card')[1];
    fireEvent.click(card);
    expect(card.classList.contains('selected')).toBe(true);
    expect(screen.getByText('Save 1 to People')).toBeTruthy();
  });

  it('the CTA still hands the company id to onFindMoreContacts', async () => {
    const onFindMoreContacts = vi.fn();
    await renderModal({ onFindMoreContacts });
    fireEvent.click(screen.getByRole('button', { name: 'View Contacts →' }));
    expect(onFindMoreContacts).toHaveBeenCalledWith('org-1');
  });

  it('a fresh full enrichment is shown without an API call', async () => {
    await renderModal();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// ── The scoped stylesheet ────────────────────────────────────────────────────

const SCOPE = '.company-detail-overlay .cdm';
const cssText = fs.readFileSync(path.resolve(__dirname, '../components/scout/CompanyDetailModal.css'), 'utf8');

/** Every rule in the scoped layer: selector, declarations and enclosing media query. */
function scopedRules() {
  const rules = [];
  postcss.parse(cssText).walkRules(rule => {
    if (!rule.selector.includes('.cdm')) return;
    const decls = {};
    rule.walkDecls(d => { decls[d.prop] = d.value; });
    const media = rule.parent?.type === 'atrule' ? rule.parent.params : null;
    rule.selectors.forEach(selector => rules.push({ selector, decls, media }));
  });
  return rules;
}

function rule(selector, media = null) {
  const found = scopedRules().find(r => r.selector === selector && r.media === media);
  if (!found) throw new Error(`no rule for "${selector}"${media ? ` in ${media}` : ''}`);
  return found.decls;
}

describe('scoped layout stylesheet', () => {
  it('every .cdm rule is scoped to the modal, so pages that share class names are untouched', () => {
    const rules = scopedRules();
    expect(rules.length).toBeGreaterThan(20);
    rules.forEach(r => expect(r.selector.startsWith(SCOPE)).toBe(true));
  });

  it('no other component uses the cdm class', () => {
    const offenders = [];
    const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      if (!/\.(jsx?|tsx?)$/.test(entry.name) || entry.name === 'CompanyDetailModal.jsx' || full.includes(`${path.sep}test${path.sep}`)) return;
      if (/className=[^>]*\bcdm\b/.test(fs.readFileSync(full, 'utf8'))) offenders.push(full);
    });
    walk(path.resolve(__dirname, '..'));
    expect(offenders).toEqual([]);
  });

  it('the panel is 900–1100px wide on desktop and never wider than the viewport', () => {
    const width = rule(SCOPE).width;
    const px = Number(width.match(/min\((\d+)px/)?.[1]);
    expect(px).toBeGreaterThanOrEqual(900);
    expect(px).toBeLessThanOrEqual(1100);
    expect(width).toMatch(/100vw/);
    expect(rule(SCOPE)['max-width']).toBe('none');
  });

  it('the content is one vertical scroll area that stretches to the panel, never wider', () => {
    const content = rule(`${SCOPE} .company-detail-content`);
    expect(content.margin).toBe('0');
    expect(content['max-width']).toBe('none');
    expect(content['min-width']).toBe('0');
    expect(content['overflow-y']).toBe('auto');
    expect(content['overflow-x']).toBe('hidden');
    expect(rule(`${SCOPE} .company-detail-content *`)['min-width']).toBe('0');
  });

  it('the snapshot is 3 columns on desktop, 2 on narrower windows, 1 on phones', () => {
    expect(rule(`${SCOPE} .snapshot-grid`)['grid-template-columns']).toBe('repeat(3, minmax(0, 1fr))');
    expect(rule(`${SCOPE} .snapshot-grid`, '(max-width: 860px)')['grid-template-columns']).toBe('repeat(2, minmax(0, 1fr))');
    expect(rule(`${SCOPE} .snapshot-grid`, '(max-width: 480px)')['grid-template-columns']).toBe('minmax(0, 1fr)');
  });

  it('decision makers and tech stack wrap into as many columns as fit', () => {
    const dm = rule(`${SCOPE} .decision-makers-grid`)['grid-template-columns'];
    const tech = rule(`${SCOPE} .tech-stack-grid`)['grid-template-columns'];
    for (const value of [dm, tech]) {
      expect(value).toMatch(/^repeat\(auto-fill, minmax\(\d+px, 1fr\)\)$/);
      // Narrow enough that a 360px phone still fits one column.
      expect(Number(value.match(/minmax\((\d+)px/)[1])).toBeLessThanOrEqual(260);
    }
    expect(rule(`${SCOPE} .decision-makers-actions`)['flex-wrap']).toBe('wrap');
  });

  it('the overview keeps a readable line length', () => {
    expect(rule(`${SCOPE} .company-overview-text`)['max-width']).toMatch(/^\d+ch$/);
  });

  it('the header stays one row at every width', () => {
    expect(rule(`${SCOPE} .company-detail-header`)['flex-direction']).toBe('row');
    expect(rule(`${SCOPE} .header-actions`)['flex-direction']).toBe('row');
    expect(rule(`${SCOPE} .header-actions`).width).toBe('auto');
    expect(rule(`${SCOPE} .close-button`).position).toBe('static');
  });

  it('the links are compact inline buttons and the CTA spans its card', () => {
    expect(rule(`${SCOPE} .links-container`)['flex-direction']).toBe('row');
    expect(rule(`${SCOPE} .link-button`).width).toBe('auto');
    expect(rule(`${SCOPE} .find-contacts-btn`).width).toBe('100%');
  });
});
