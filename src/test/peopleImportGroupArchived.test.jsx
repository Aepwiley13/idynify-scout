/**
 * People (AllLeads) opened from a CSV import: `?tag=<import tag>`.
 *
 * An import can match contacts that are archived, or whose company is
 * archived. People hides those everywhere — so "N contacts imported" used to
 * reconcile with fewer people after "View People". Inside that import's own tag
 * view they are listed (and labelled), and only there. Nothing is reactivated.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const TAG = 'CSV Import - Beyond Words - 2026-10-02';
const contactsData = vi.hoisted(() => ({ list: [] }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, ...path) => path.join('/')),
  getDocs: vi.fn(async (path) => ({
    docs: String(path).endsWith('/contacts')
      ? contactsData.list.map((d) => ({ id: d.id, data: () => d }))
      : [],
  })),
  doc: vi.fn(() => ({})),
  updateDoc: vi.fn(async () => {}),
  arrayUnion: vi.fn((...v) => v),
  addDoc: vi.fn(async () => ({ id: 'x' })),
  serverTimestamp: vi.fn(() => ({})),
}));
vi.mock('../firebase/config', () => ({
  db: {},
  auth: { currentUser: { uid: 'u1' }, onAuthStateChanged: (cb) => { cb({ uid: 'u1' }); return () => {}; } },
}));
vi.mock('../context/ImpersonationContext', () => ({
  useActiveUserId: () => 'u1',
  useImpersonation: () => ({ isImpersonating: false, isReadOnly: false }),
  getEffectiveUser: () => ({ uid: 'u1' }),
}));
vi.mock('../theme/ThemeContext', () => ({
  useT: () => new Proxy({}, { get: () => '#888' }),
}));
vi.mock('../hooks/useSubscription', () => ({ useSubscription: () => ({ isProTier: true, loading: false }) }));
vi.mock('./ContactProfile', () => ({ default: () => null }));
vi.mock('../pages/Scout/ContactProfile', () => ({ default: () => null }));
vi.mock('../components/scout/LinkedInLinkSearch', () => ({ default: () => null }));
vi.mock('../components/firstTouch/FirstTouchModal', () => ({ default: () => null }));
vi.mock('../components/scout/BulkComposeModal', () => ({ default: () => null }));
vi.mock('../services/peopleService', () => ({ archivePerson: vi.fn() }));
vi.mock('../services/sniperWriteGuard', () => ({ createSniperRecord: vi.fn() }));
vi.mock('../utils/loadIntoHunter', () => ({ loadIntoHunter: vi.fn() }));

import AllLeads from '../pages/Scout/AllLeads';

const person = (id, name, extra = {}) => ({
  id, name, email: `${id}@x.com`, is_archived: false, tags: [TAG], addedAt: '2026-10-02T00:00:00Z', ...extra,
});

beforeEach(() => {
  contactsData.list = [
    person('n1', 'Ana Imported'),
    person('n2', 'Ben Imported'),
    person('a1', 'Arch Archived', { is_archived: true }),
    person('a2', 'Coco CompanyArchived', { company_archived: true }),
    person('o1', 'Otto Outsider', { tags: [] }),
    person('o2', 'Olga ArchivedOutsider', { tags: [], is_archived: true }),
  ];
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

function renderPeopleAt(url) {
  window.history.replaceState(null, '', url);
  return render(<MemoryRouter><AllLeads mode="people" /></MemoryRouter>);
}

describe('People opened for an import group', { timeout: 20000 }, () => {
  it('lists every member of the import — archived ones included and labelled — and nobody else', async () => {
    renderPeopleAt(`/command-center?tab=people&tag=${encodeURIComponent(TAG)}`);
    await screen.findByText('Ana Imported');
    for (const name of ['Ana Imported', 'Ben Imported', 'Arch Archived', 'Coco CompanyArchived']) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText('Otto Outsider')).not.toBeInTheDocument();
    expect(screen.queryByText('Olga ArchivedOutsider')).not.toBeInTheDocument();
    expect(screen.getByTestId('import-archived-banner')).toHaveTextContent('Includes 2 archived contacts from this import');
  });

  it('does not change who People shows without the import tag', async () => {
    renderPeopleAt('/command-center?tab=people');
    await screen.findByText('Ana Imported');
    expect(screen.getAllByText('Otto Outsider').length).toBeGreaterThan(0);
    expect(screen.queryByText('Arch Archived')).not.toBeInTheDocument();
    expect(screen.queryByText('Coco CompanyArchived')).not.toBeInTheDocument();
    expect(screen.queryByText('Olga ArchivedOutsider')).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-archived-banner')).not.toBeInTheDocument();
  });
});

describe('isHiddenFromPeople', () => {
  it('matches the two signals People filters on', async () => {
    const { isHiddenFromPeople } = await import('../utils/csvContactImport');
    expect(isHiddenFromPeople({ is_archived: true })).toBe(true);
    expect(isHiddenFromPeople({ status: 'people_mode_archived' })).toBe(true);
    expect(isHiddenFromPeople({ company_archived: true })).toBe(true);
    expect(isHiddenFromPeople({ is_archived: false })).toBe(false);
    expect(isHiddenFromPeople({ status: 'people_mode_skipped' })).toBe(false);
  });
});
