/**
 * Scout+ → Upload CSV → success → View People / Add to Cadence.
 *
 * CSVUpload itself is stubbed here (its pipeline has its own suites); this
 * covers the wiring: the card opens it, the import result reaches the success
 * screen, "View People" lands on the tag-filtered People view, and "Add to
 * Cadence" hands the imported people — with no re-selection — to the existing
 * compose flow, pre-filled from the chosen cadence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const composeProps = vi.hoisted(() => ({ current: null }));
const mockGetDocs = vi.hoisted(() => vi.fn());

vi.mock('../theme/ThemeContext', () => ({
  useT: () => ({ appBg: '#fff', navBg: '#fff', cardBg: '#fff', surface: '#fafafa', statBg: '#eee', border: '#ddd', text: '#111', textMuted: '#555', textFaint: '#888' }),
}));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => ({ uid: 'u1' }) }));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(() => ({})), getDocs: mockGetDocs }));
vi.mock('../firebase/config', () => ({ db: {} }));

vi.mock('../components/scout/ManualContactForm', () => ({ default: () => <div>manual</div> }));
vi.mock('../components/scout/BusinessCardCapture', () => ({ default: () => <div>card</div> }));
vi.mock('../components/scout/LinkedInLinkSearch', () => ({ default: () => <div>linkedin</div> }));
vi.mock('../pages/Scout/CompanySearch', () => ({ default: () => <div>company search</div> }));

const IMPORTED = [
  { id: 'n1', name: 'Ana New', email: 'ana@x.com', _uploadType: 'leads' },
  { id: 'n2', name: 'Ben New', email: 'ben@x.com', _uploadType: 'leads' },
  { id: 'e1', name: 'Existing Erin', email: 'erin@x.com', _uploadType: 'leads', _archived: true },
  { id: 'n3', name: 'No Email Ned', email: null, _uploadType: 'leads' },
  {
    id: 'c1', name: 'Conflict Cal', email: 'cal.old@x.com', _uploadType: 'leads',
    _emailConflict: { signal: 'linkedin_url', signalLabel: 'LinkedIn URL', csvEmail: 'cal.new@x.com', storedEmail: 'cal.old@x.com' },
  },
];
const RESULT = {
  batchId: 'csv_1',
  tag: 'CSV Import - Beyond Words - 2026-10-02',
  created: IMPORTED.filter(c => !['e1', 'c1'].includes(c.id)),
  updated: IMPORTED.filter(c => ['e1', 'c1'].includes(c.id)),
  failed: [],
};

vi.mock('../components/scout/CSVUpload', () => ({
  default: ({ onContactsAdded }) => (
    <div>
      <div>CSV upload flow</div>
      <button onClick={() => onContactsAdded(IMPORTED, RESULT)}>finish import</button>
    </div>
  ),
}));

vi.mock('../components/scout/BulkComposeModal', () => ({
  default: (props) => { composeProps.current = props; return <div data-testid="compose">compose</div>; },
}));

import ScoutPlus from '../pages/Scout/ScoutPlus';

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}{loc.search}</div>;
}

function renderScoutPlus() {
  return render(
    <MemoryRouter initialEntries={['/scout?tab=scout-plus']}>
      <Routes>
        <Route path="/scout" element={<ScoutPlus />} />
        <Route path="/command-center" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function importThroughScoutPlus() {
  renderScoutPlus();
  fireEvent.click(screen.getByRole('button', { name: /Upload CSV/ }));
  expect(screen.getByText('CSV upload flow')).toBeInTheDocument();
  fireEvent.click(screen.getByText('finish import'));
  await screen.findByText('5 contacts imported successfully');
}

beforeEach(() => {
  composeProps.current = null;
  mockGetDocs.mockReset();
  mockGetDocs.mockResolvedValue({
    docs: [
      { id: 'cad1', data: () => ({
        name: 'Beyond Words Invitation', subject: 'rendered', body: 'Hi Ana,\n\nrendered',
        templateSubject: 'Join us, {{first_name}}', templateBody: 'Beyond Words is on Friday.',
        path: 'write_your_own', personalizedWithBarry: true, createdAt: { toMillis: () => 2, toDate: () => new Date() },
      }) },
      { id: 'cad2', data: () => ({ name: 'People Pitch Invite', subject: 'Pitch', body: 'Hi Bo,\n\nPitch body', createdAt: { toMillis: () => 1, toDate: () => new Date() } }) },
    ],
  });
});

describe('Scout+ CSV import → People → Cadence', () => {
  it('the Upload CSV card is live and opens the CSV upload flow', () => {
    renderScoutPlus();
    const card = screen.getByRole('button', { name: /Upload CSV/ });
    expect(card).not.toHaveTextContent(/coming soon/i);
    fireEvent.click(card);
    expect(screen.getByText('CSV upload flow')).toBeInTheDocument();
  });

  it('shows the import group and the two next steps', async () => {
    await importThroughScoutPlus();
    expect(screen.getByTestId('import-summary')).toHaveTextContent('3 new · 2 already in IDYNIFY');
    expect(screen.getByTestId('import-summary')).toHaveTextContent(RESULT.tag);
    expect(screen.getByTestId('import-email-conflicts')).toHaveTextContent("1 email conflict — kept their IDYNIFY email and won't be added to a cadence");
    expect(screen.getByTestId('import-archived')).toHaveTextContent("1 is archived — shown in this import's People view, still archived");
    expect(screen.getByRole('button', { name: /View People/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add to Cadence/ })).toBeInTheDocument();
  });

  it('View People opens People filtered to the import tag', async () => {
    await importThroughScoutPlus();
    fireEvent.click(screen.getByRole('button', { name: /View People/ }));
    const where = screen.getByTestId('where').textContent;
    expect(where.startsWith('/command-center?')).toBe(true);
    const params = new URLSearchParams(where.split('?')[1]);
    expect(params.get('tab')).toBe('people');
    expect(params.get('tag')).toBe(RESULT.tag);
  });

  it('Add to Cadence passes the imported people to compose, pre-filled from the chosen cadence', async () => {
    await importThroughScoutPlus();
    fireEvent.click(screen.getByRole('button', { name: /Add to Cadence/ }));

    const options = await screen.findAllByTestId('cadence-option');
    expect(options.map(o => o.textContent)).toEqual([
      expect.stringContaining('Beyond Words Invitation'),
      expect.stringContaining('People Pitch Invite'),
    ]);
    expect(screen.getByText(/1 imported contact has no email/)).toBeInTheDocument();
    expect(screen.getByTestId('picker-email-conflicts')).toHaveTextContent(
      'Conflict Cal: CSV cal.new@x.com · IDYNIFY cal.old@x.com (matched by LinkedIn URL)',
    );

    fireEvent.click(options[0]);
    expect(screen.getByTestId('compose')).toBeInTheDocument();
    const p = composeProps.current;
    // Existing (even archived) contact included; no-email and email-conflict contacts held back.
    expect(p.contacts.map(c => c.id)).toEqual(['n1', 'n2', 'e1']);
    expect(p.initialCadenceName).toBe('Beyond Words Invitation');
    expect(p.initialSubject).toBe('Join us, {{first_name}}');
    expect(p.initialBody).toBe('Beyond Words is on Friday.');
    expect(p.initialPersonalize).toBe(true);
  });

  it('Create new cadence opens a blank compose with the imported people', async () => {
    await importThroughScoutPlus();
    fireEvent.click(screen.getByRole('button', { name: /Add to Cadence/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Create new cadence/ }));
    expect(composeProps.current.contacts).toHaveLength(3);
    expect(composeProps.current.initialCadenceName).toBe('');
    expect(composeProps.current.initialBody).toBe('');
  });
});
