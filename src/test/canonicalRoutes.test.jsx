/**
 * The Standard, as a test.
 *
 * "A user opens Mission Control. They see Gentry Moyes needs attention. They
 * click his name. They land on Gentry Moyes — not Scout, not a queue. The
 * breadcrumb says Mission Control. One action is obvious. They press Back.
 * They are on Mission Control."
 *
 * Each of those clauses is an assertion below. What is NOT asserted here is
 * anything about Firestore: ContactProfile's data loading is mocked away,
 * because the subject is the ROUTE, the ARRIVAL and the BREADCRUMB — the three
 * things that were broken — and rendering nine hundred lines of contact panel
 * to check a breadcrumb would test the panel instead.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet, useNavigate, useLocation } from 'react-router-dom';

// ── Mocks: everything that talks to Firebase or renders the real panel ──────

vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: null } }));

vi.mock('firebase/firestore', () => ({
  doc: (_db, ...path) => ({ __doc: path.join('/') }),
  getDoc: async () => ({
    exists: () => true,
    id: 'c1',
    data: () => ({ name: 'Gentry Moyes', stage: 'hunter' }),
  }),
  collection: () => ({}),
  getDocs: async () => ({ empty: true, docs: [] }),
  query: () => ({}),
  where: () => ({}),
  limit: () => ({}),
  orderBy: () => ({}),
  updateDoc: async () => {},
}));

// A mock stands in for the WHOLE module surface its consumers use, not just
// the part the test happens to think about. `getActiveUserId` is here because
// analytics reads it to suppress writes during impersonation — omitting it
// made openContact() throw, which is how this file went red in CI while every
// assertion in it still passed.
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'u1', getIdToken: async () => 'tok' }),
  getActiveUserId: () => 'u1',
  useActiveUserId: () => 'u1',
  useImpersonation: () => ({ isReadOnly: false }),
  ImpersonationProvider: ({ children }) => children,
}));

vi.mock('../services/barryMemoryService', () => ({
  loadContactMemory: vi.fn(async () => ({ who_they_are: 'a known relationship' })),
}));

/**
 * ContactProfile stands in for the real one. It renders the banner exactly the
 * way the real component does — via the `banner` render prop — and a Back
 * button wired to `returnTo`, because those two contracts are what ContactPage
 * depends on and what a change to ContactProfile could silently break.
 */
vi.mock('../pages/Scout/ContactProfile', () => ({
  default: ({ contactId, returnTo, returnLabel, banner }) => {
    const nav = mockNavigate;
    return (
      <div data-testid="contact-profile">
        {typeof banner === 'function' ? banner({ triggerEngage: mockTriggerEngage }) : banner}
        <div data-testid="contact-id">{contactId}</div>
        <button onClick={() => nav(returnTo ?? '/scout')}>{returnLabel}</button>
      </div>
    );
  },
}));

// Asserts that nothing in the canonical route's tree pulls Scout in.
let scoutMountCount = 0;
vi.mock('../pages/Scout/ScoutMain', () => ({
  default: () => {
    scoutMountCount += 1;
    return <div data-testid="scout-main">scout shell<Outlet /></div>;
  },
}));

import ContactPage from '../pages/Scout/ContactPage';
import { ShellProvider, useShell } from '../context/ShellContext';
import { openContact, ENTRY_POINTS, DISPLAY_MODES } from '../utils/navigation';
import { resolveDestination } from '../constants/navigationModel';

let mockNavigate = () => {};
const mockTriggerEngage = vi.fn();

// ── Harness ─────────────────────────────────────────────────────────────────

let latestContext = null;
let latestArrival = null;
let currentPath = null;

function ShellProbe() {
  const { navigationContext, arrival } = useShell();
  latestContext = navigationContext;
  latestArrival = arrival;
  const breadcrumbModule = resolveDestination(arrival?.originModuleId);

  return (
    <div>
      <div data-testid="breadcrumb">{breadcrumbModule?.label ?? '(route)'}</div>
      <Outlet />
    </div>
  );
}

function PathProbe() {
  const location = useLocation();
  currentPath = location.pathname;
  return <div data-testid="path">{location.pathname}</div>;
}

function MissionControlProbe() {
  const navigate = useNavigate();
  mockNavigate = navigate;
  return (
    <div data-testid="mission-control">
      <button
        onClick={() => openContact({
          navigate,
          contactId: 'c1',
          entryPoint: ENTRY_POINTS.MISSION_CONTROL,
          reason: 'next_step_overdue',
          recommendedAction: 'complete_step',
          priorityId: 'p1',
          returnTo: '/mission-control-v2',
          displayMode: DISPLAY_MODES.PAGE,
        })}
      >
        Complete the next step with Gentry Moyes
      </button>
    </div>
  );
}

function renderApp(initialPath = '/mission-control-v2') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ShellProvider user={{ id: 'u1' }} userData={{}}>
        <PathProbe />
        <Routes>
          <Route element={<ShellProbe />}>
            <Route path="/mission-control-v2" element={<MissionControlProbe />} />
            <Route path="/contact/:contactId" element={<ContactPage />} />
            <Route path="/scout" element={<div data-testid="scout">scout list</div>} />
          </Route>
        </Routes>
      </ShellProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  scoutMountCount = 0;
  latestContext = null;
  latestArrival = null;
  currentPath = null;
  mockTriggerEngage.mockClear();
});

// ── The Standard ────────────────────────────────────────────────────────────

describe('Mission Control → contact → back', () => {
  it('lands on the contact, at the canonical route, without mounting Scout', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /Gentry Moyes/ }));

    expect(currentPath).toBe('/contact/c1');
    expect(await screen.findByTestId('contact-profile')).toBeInTheDocument();
    expect(screen.getByTestId('contact-id')).toHaveTextContent('c1');
    // The bug in one number: this was 1 before the canonical route existed.
    expect(scoutMountCount).toBe(0);
    expect(screen.queryByTestId('scout-main')).not.toBeInTheDocument();
  });

  it('shows Mission Control in the breadcrumb, not Scout', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /Gentry Moyes/ }));

    expect(await screen.findByTestId('breadcrumb')).toHaveTextContent('Mission Control');
  });

  it('renders the arrival banner with the reason and the recommended action', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /Gentry Moyes/ }));

    const banner = await screen.findByRole('status', { name: /why this contact was opened/i });
    expect(banner).toHaveTextContent(/next step with this contact is overdue/i);
    expect(banner).toHaveTextContent(/Recommended:/);
    expect(banner).toHaveTextContent(/Complete the next step/);
    expect(banner).toHaveTextContent(/Surfaced by Mission Control/);
  });

  it('offers the recommended action as the obvious thing to do', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /Gentry Moyes/ }));
    await user.click(await screen.findByRole('button', { name: 'Complete the next step' }));

    expect(mockTriggerEngage).toHaveBeenCalledTimes(1);
  });

  it('gives Barry the session intent and the origin', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /Gentry Moyes/ }));

    await vi.waitFor(() => expect(latestContext?.entry_point).toBe('mission_control'));
    expect(latestContext.arrival_reason).toBe('next_step_overdue');
    expect(latestContext.recommended_action).toBe('complete_step');
    expect(latestContext.return_to).toBe('/mission-control-v2');
    expect(latestContext.source_module).toBe('mission-control');
    expect(latestContext.current_entity_type).toBe('contact');
    expect(latestContext.current_entity_id).toBe('c1');
  });

  it('keys Barry’s session to the contact AND the module it was opened from', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /Gentry Moyes/ }));

    await vi.waitFor(() => expect(latestArrival?.sessionKey).toBeTruthy());
    expect(latestArrival.sessionKey).toEqual({
      entityType: 'contact',
      entityId: 'c1',
      sessionType: 'follow_up',
      sourceModule: 'mission_control',
    });
  });

  it('loads Barry’s persistent memory from the contact record on arrival', async () => {
    const { loadContactMemory } = await import('../services/barryMemoryService');
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /Gentry Moyes/ }));

    await vi.waitFor(() => expect(loadContactMemory).toHaveBeenCalledWith('u1', 'c1'));
    await vi.waitFor(() => expect(latestContext?.barry_memory_loaded).toBe(true));
  });

  it('the page’s Back button returns to Mission Control, not to Scout', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /Gentry Moyes/ }));

    // Two ways back exist by design — the page header and the arrival banner —
    // and both must lead to the same place. This is the header's.
    const profile = await screen.findByTestId('contact-profile');
    const [pageBack] = within(profile).getAllByRole('button', { name: 'Back to Mission Control' });
    await user.click(pageBack);

    expect(currentPath).toBe('/mission-control-v2');
    expect(screen.getByTestId('mission-control')).toBeInTheDocument();
  });

  it('the banner’s own Back button also returns to the origin', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /Gentry Moyes/ }));

    const banner = await screen.findByRole('status', { name: /why this contact was opened/i });
    await user.click(within(banner).getByRole('button', { name: 'Back to Mission Control' }));

    expect(currentPath).toBe('/mission-control-v2');
  });
});

describe('arriving cold — a bookmark, a refresh, a pasted link', () => {
  it('renders the contact with no arrival banner', async () => {
    renderApp('/contact/c1');

    expect(await screen.findByTestId('contact-profile')).toBeInTheDocument();
    // No reason to explain: the user is not arriving from anywhere.
    expect(screen.queryByRole('status', { name: /why this contact was opened/i }))
      .not.toBeInTheDocument();
  });

  it('falls back to the route for the breadcrumb rather than inventing an origin', async () => {
    renderApp('/contact/c1');

    await screen.findByTestId('contact-profile');
    expect(screen.getByTestId('breadcrumb')).toHaveTextContent('(route)');
    expect(latestArrival?.originModuleId ?? null).toBeNull();
  });

  it('offers a generic way out rather than a Back button that lies', async () => {
    renderApp('/contact/c1');

    await screen.findByTestId('contact-profile');
    expect(screen.getByRole('button', { name: 'Back to People' })).toBeInTheDocument();
  });
});

describe('arrival lifecycle', () => {
  it('does not follow the user off the record', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /Gentry Moyes/ }));
    await vi.waitFor(() => expect(latestContext?.entry_point).toBe('mission_control'));

    await act(async () => { mockNavigate('/scout'); });

    // A stale reason on an unrelated screen is how Barry ends up explaining an
    // overdue follow-up to someone looking at a list.
    expect(latestContext.entry_point).toBeNull();
    expect(latestContext.arrival_reason).toBeNull();
  });
});
