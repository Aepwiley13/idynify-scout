/**
 * Company profile page (Saved Companies → Find Contacts) and the Snapshot,
 * Overview and Links sections it now shares with the company detail modal.
 *
 * The page's company card used to render 2px tall: it had overflow: hidden
 * inside a scroller that was itself a flex column, so once the page outgrew
 * the viewport flex shrank it to its borders and the page appeared to start
 * at Tech Stack. The page now opens on the company (Snapshot, Overview,
 * Links), then the people, then Tech Stack and Data Confidence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const here = path.dirname(fileURLToPath(import.meta.url));

const enrichment = {
  snapshot: {
    name: 'Blueroof Real Estate', industry: 'real estate', estimated_num_employees: 5, founded_year: 2012,
    location: { full: 'South Jordan, Utah' }, phone: '+1 801-545-7272',
    description: 'Blueroof Real Estate helps you buy or sell your home with confidence.',
    website_url: 'http://blueroof.example', linkedin_url: 'http://linkedin.example/blueroof', keywords: ['residential'],
  },
  decisionMakers: [{ id: 'p1', name: 'Claudia Macias', title: 'Commercial Regional Operations Manager', linkedin_url: 'x' }],
  techStack: [{ name: 'Brivity', category: 'CRM' }],
  dataQuality: { organization_status: 'active' },
  _raw: { enrichedAt: Date.now(), mode: 'full' },
};

let companyDoc;
let contactDocs;

vi.mock('firebase/firestore', () => new Proxy({
  doc: (_db, ...p) => ({ path: p.join('/') }),
  getDoc: async ref => (ref.path.includes('companyProfile')
    ? { exists: () => false }
    : { id: 'org-1', exists: () => true, data: () => companyDoc }),
  getDocs: async () => ({ docs: contactDocs.map(c => ({ id: c.id, data: () => c })) }),
  query: (...a) => a, where: (...a) => a, collection: (...a) => a, updateDoc: async () => {},
}, {
  get: (target, prop) => (prop in target ? target[prop] : (prop === 'then' || typeof prop === 'symbol' ? undefined : vi.fn())),
}));
vi.mock('../services/peopleService', () => ({ searchPeople: vi.fn(async () => []), updatePerson: vi.fn() }));
vi.mock('../services/companyArchiveService', () => ({ archiveCompanyWithCascade: vi.fn(), restoreCompanyWithCascade: vi.fn() }));
vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: { uid: 'user-1', getIdToken: async () => 'token' } } }));
vi.mock('../context/ImpersonationContext', () => ({ useActiveUserId: () => null, useImpersonation: () => ({ isImpersonating: false }) }));
vi.mock('../components/scout/CompanyLogo', () => ({ default: () => <div /> }));
vi.mock('../pages/Scout/ContactProfile', () => ({ default: () => null }));

const { default: CompanyProfileView } = await import('../pages/Scout/CompanyProfileView.jsx');
const { CompanySnapshot, CompanyOverview, CompanyLinks } = await import('../components/scout/CompanyInfoSections.jsx');
const { snapshotFacts } = await import('../components/scout/companyInfoFacts.js');

beforeEach(() => {
  companyDoc = {
    name: 'Blueroof Real Estate', industry: 'real estate', website_url: 'http://blueroof.example',
    linkedin_url: 'http://linkedin.example/blueroof', selected_titles: [],
    apolloEnrichment: enrichment, apolloEnrichedAt: Date.now(),
  };
  contactDocs = [];
  globalThis.fetch = vi.fn();
});

afterEach(cleanup);

async function renderPage() {
  const view = render(<MemoryRouter><CompanyProfileView companyId="org-1" onBack={() => {}} /></MemoryRouter>);
  await screen.findByText('Key Decision Makers');
  return view;
}

/** Section headings in the order they appear on the page. */
function sectionOrder() {
  const column = screen.getByTestId('company-profile-sections');
  return [...column.children].map(section => {
    // Shared sections use .ci-title; the page's own Section headings are the bold line.
    const title = section.querySelector('.ci-title') || section.querySelector('[style*="font-weight: 700"]');
    return title.textContent.replace(/\s*\(\d+\)$/, '');
  });
}

describe('company profile page', () => {
  it('opens on the company, then the people, then Tech Stack and Data Confidence', async () => {
    await renderPage();
    expect(sectionOrder()).toEqual([
      'Company Snapshot', 'Company Overview', 'Links',
      'Key Decision Makers', 'Find Contacts by Title', 'Add Your Contacts',
      'Tech Stack', 'Data Confidence',
    ]);
  });

  it('keeps saved and suggested contacts with the people', async () => {
    contactDocs = [
      { id: 'c1', name: 'Saved Person', title: 'Broker', status: 'active' },
      { id: 'c2', name: 'Suggested Person', title: 'Agent', status: 'suggested' },
    ];
    await renderPage();
    await screen.findByText('Saved Person');
    expect(sectionOrder()).toEqual([
      'Company Snapshot', 'Company Overview', 'Links',
      'Saved Contacts', 'Key Decision Makers', 'Find Contacts by Title', 'Suggested Contacts', 'Add Your Contacts',
      'Tech Stack', 'Data Confidence',
    ]);
  });

  it('uses the Snapshot, Overview and Links components shared with the company detail modal', async () => {
    await renderPage();
    const snapshot = screen.getByTestId('company-snapshot');
    expect([...snapshot.querySelectorAll('.ci-snapshot-label')].map(l => l.textContent))
      .toEqual(['Industry', 'Employees', 'Revenue', 'Founded', 'Address', 'Phone']);
    expect(snapshot.textContent).toContain('South Jordan, Utah');
    expect(snapshot.textContent).toContain('+1 801-545-7272');
    expect(screen.getByTestId('company-overview').textContent).toContain('buy or sell your home');
    expect(screen.getByTestId('company-links').textContent).toContain('Visit Website');
  });

  it('keeps Industries & Keywords under the overview', async () => {
    await renderPage();
    const overview = screen.getByTestId('company-overview');
    expect(overview.textContent).toContain('Industries & Keywords');
    expect(overview.textContent).toContain('residential');
  });

  it('opens links in a new tab, as before', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await renderPage();
    fireEvent.click(screen.getByText('View on LinkedIn'));
    expect(open).toHaveBeenCalledWith('http://linkedin.example/blueroof', '_blank');
    open.mockRestore();
  });

  it('scrolls in a plain container whose inner column cannot shrink a section', async () => {
    await renderPage();
    const scroller = screen.getByTestId('company-profile-scroll');
    const column = screen.getByTestId('company-profile-sections');
    expect(scroller.style.overflowY).toBe('auto');
    // A flex-column scroller shrank the overflow-hidden company card to 2px.
    expect(scroller.style.display).not.toBe('flex');
    expect(column.parentElement).toBe(scroller);
    expect(column.style.display).toBe('flex');
    expect(column.style.flexDirection).toBe('column');
    // Clear separation from the company header.
    expect(scroller.style.padding).toBe('24px 20px 32px');
  });

  it('makes no enrichment call when the company already carries enrichment', async () => {
    await renderPage();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('shared company sections', () => {
  it('snapshot facts fall back from enrichment to the stored company, then "Not available"', () => {
    const facts = Object.fromEntries(snapshotFacts(
      { industry: 'Computer Software', employee_count: 1200, revenue: 2500000, founded_year: 1999, location: 'Provo, Utah' },
      {},
    ).map(([label, value]) => [label, value]));
    expect(facts).toEqual({
      Industry: 'Computer Software', Employees: '1,200', Revenue: '$2.5M', Founded: 1999, Address: 'Provo, Utah', Phone: 'Not available',
    });
    const enriched = Object.fromEntries(snapshotFacts({}, {
      employee_count_range: '5,001-10,000', revenue_range: '$100M-$250M', founded_year: 1988,
      location: { full: 'Ogden, Utah' }, phone: '+1 800-877-8259',
    }).map(([label, value]) => [label, value]));
    expect(enriched).toMatchObject({ Employees: '5,001-10,000', Revenue: '$100M-$250M', Founded: 1988, Address: 'Ogden, Utah', Phone: '+1 800-877-8259' });
  });

  it('the overview renders nothing without a description or placeholder, and the placeholder otherwise', () => {
    const { container, rerender } = render(<CompanyOverview description={undefined} />);
    expect(container.innerHTML).toBe('');
    rerender(<CompanyOverview placeholder="No overview available." />);
    expect(container.querySelector('.ci-overview-placeholder').textContent).toBe('No overview available.');
  });

  it('links render only the URLs that are known, and nothing without any', () => {
    const onOpen = vi.fn();
    const { container, rerender } = render(<CompanyLinks onOpen={onOpen} />);
    expect(container.innerHTML).toBe('');
    rerender(<CompanyLinks websiteUrl="http://a.example" onOpen={onOpen} />);
    expect(container.textContent).toContain('Visit Website');
    expect(container.textContent).not.toContain('View on LinkedIn');
    fireEvent.click(screen.getByText('Visit Website'));
    expect(onOpen).toHaveBeenCalledWith('http://a.example');
  });

  it('the snapshot renders one item per fact', () => {
    const { container } = render(<CompanySnapshot company={{ industry: 'Banking' }} snapshot={{}} />);
    expect(container.querySelectorAll('.ci-snapshot-grid > .ci-snapshot-item')).toHaveLength(6);
  });
});

describe('CompanyInfoSections.css', () => {
  const css = fs.readFileSync(path.resolve(here, '../components/scout/CompanyInfoSections.css'), 'utf8');
  const rules = [];
  postcss.parse(css).walkRules(r => {
    const decls = {};
    r.walkDecls(d => { decls[d.prop] = d.value; });
    r.selectors.forEach(selector => rules.push({ selector, decls, at: r.parent?.type === 'atrule' ? `${r.parent.name} ${r.parent.params}` : null }));
  });

  it('styles only its own ci- classes, so no page stylesheet can reach them or be reached', () => {
    expect(rules.length).toBeGreaterThan(15);
    rules.forEach(r => {
      const classes = r.selector.match(/\.[\w-]+/g) || [];
      const own = classes.filter(c => !['.theme-dark'].includes(c));
      expect(own.length, r.selector).toBeGreaterThan(0);
      own.forEach(c => expect(c, r.selector).toMatch(/^\.ci-/));
    });
  });

  it('lays the snapshot out from the section\'s own width, so it fits the modal and the page', () => {
    expect(rules.find(r => r.selector === '.ci-section').decls['container-type']).toBe('inline-size');
    expect(rules.some(r => r.at === 'container (max-width: 706px)' && r.selector === '.ci-snapshot-grid')).toBe(true);
    expect(rules.some(r => r.at === 'container (max-width: 400px)' && r.selector === '.ci-snapshot-grid')).toBe(true);
  });

  it('has a dark-theme version under body.theme-dark', () => {
    const dark = rules.filter(r => r.selector.startsWith('body.theme-dark '));
    expect(dark.map(r => r.selector)).toEqual(expect.arrayContaining([
      'body.theme-dark .ci-section', 'body.theme-dark .ci-snapshot', 'body.theme-dark .ci-link--website', 'body.theme-dark .ci-link--linkedin',
    ]));
  });
});
