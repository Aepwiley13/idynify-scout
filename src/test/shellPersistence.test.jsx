/**
 * Shell persistence + the Barry navigation context contract.
 *
 * This is the Definition of Done expressed as a test: "a user can move from
 * Mission Control into Scout, inspect a person, engage them, and return —
 * without the application ever feeling like it changed into a different
 * product."
 *
 * The measurable version of "never changed into a different product" is that
 * the shell is MOUNTED EXACTLY ONCE for the whole journey. Before the
 * migration it mounted six times — once per transition — because MainLayout
 * was applied per route rather than above the routes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { MemoryRouter, Routes, Route, Outlet, useNavigate } from 'react-router-dom';
import { ShellProvider, useShell, useShellEntity } from '../context/ShellContext';

// ── Probes ──────────────────────────────────────────────────────────────────

let shellMountCount = 0;
let latestContext = null;
let navigateTo = null;

/**
 * Stands in for MainLayout. Counts its own mounts and republishes the
 * contract, so a test can assert on both without rendering Firebase.
 */
function ShellProbe() {
  const { navigationContext } = useShell();
  const mounted = useRef(false);

  if (!mounted.current) {
    mounted.current = true;
    shellMountCount += 1;
  }

  latestContext = navigationContext;

  return (
    <div>
      <div data-testid="shell-chrome">sidebar + top bar + barry</div>
      <Outlet />
    </div>
  );
}

function NavProbe() {
  const navigate = useNavigate();
  navigateTo = navigate;
  return null;
}

function MissionControlProbe() {
  return <div data-testid="page">mission-control</div>;
}

function ScoutProbe() {
  return (
    <div>
      <div data-testid="page">scout</div>
      <Outlet />
    </div>
  );
}

function ContactPanelProbe() {
  useShellEntity({ type: 'contact', id: 'c-1', stage: 'scout', label: 'Sarah Chen' });
  return <div data-testid="panel">contact-panel</div>;
}

function EngagingContactPanelProbe() {
  const { openQuickEngage } = useShell();
  useShellEntity({ type: 'contact', id: 'c-1', stage: 'scout', label: 'Sarah Chen' });

  useEffect(() => {
    openQuickEngage({ id: 'c-1', firstName: 'Sarah', lastName: 'Chen' });
  }, [openQuickEngage]);

  return <div data-testid="panel">contact-panel</div>;
}

function renderShell(initialPath = '/mission-control-v2', ContactPanel = ContactPanelProbe) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ShellProvider user={{ id: 'u-1' }} userData={{}}>
        <NavProbe />
        <Routes>
          <Route element={<ShellProbe />}>
            <Route path="/mission-control-v2" element={<MissionControlProbe />} />
            <Route path="/scout" element={<ScoutProbe />}>
              <Route path="contact/:contactId" element={<ContactPanel />} />
            </Route>
          </Route>
        </Routes>
      </ShellProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  shellMountCount = 0;
  latestContext = null;
  navigateTo = null;
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('shell persistence across the Phase 8 journey', () => {
  it('mounts the shell exactly once for the whole journey', async () => {
    renderShell();
    expect(shellMountCount).toBe(1);

    // Mission Control → Scout
    await act(async () => { navigateTo('/scout?tab=all-leads'); });
    expect(screen.getByTestId('page')).toHaveTextContent('scout');

    // Scout → Contact Profile
    await act(async () => { navigateTo('/scout/contact/c-1'); });
    expect(screen.getByTestId('panel')).toBeInTheDocument();

    // Contact Profile → back to Scout
    await act(async () => { navigateTo('/scout?tab=all-leads'); });

    // Scout → Mission Control
    await act(async () => { navigateTo('/mission-control-v2'); });
    expect(screen.getByTestId('page')).toHaveTextContent('mission-control');

    // Four transitions, still one shell. Pre-migration this would be 5.
    expect(shellMountCount).toBe(1);
    expect(screen.getByTestId('shell-chrome')).toBeInTheDocument();
  });

  it('keeps Scout mounted while a contact panel is open', async () => {
    renderShell('/scout?tab=all-leads');

    expect(screen.getByTestId('page')).toHaveTextContent('scout');

    await act(async () => { navigateTo('/scout/contact/c-1'); });

    // The list is still there underneath — this is what makes closing the
    // panel a genuine return rather than a re-navigation that rebuilds it.
    expect(screen.getByTestId('page')).toHaveTextContent('scout');
    expect(screen.getByTestId('panel')).toBeInTheDocument();
  });
});

describe('Barry navigation context contract', () => {
  it('publishes every field the contract requires', () => {
    renderShell();

    expect(latestContext).toMatchObject({
      user_id: 'u-1',
      current_module: 'mission-control',
      current_route: '/mission-control-v2',
      current_entity_type: null,
      current_entity_id: null,
      current_pipeline_stage: null,
      current_action: null,
    });

    for (const key of [
      'user_id', 'organization_id', 'current_module', 'current_route',
      'current_entity_type', 'current_entity_id', 'current_pipeline_stage',
      'current_action', 'source_route', 'navigation_history',
    ]) {
      expect(latestContext).toHaveProperty(key);
    }
  });

  it('tracks the module as the user moves', async () => {
    renderShell();
    expect(latestContext.current_module).toBe('mission-control');

    await act(async () => { navigateTo('/scout?tab=all-leads'); });
    expect(latestContext.current_module).toBe('scout');
    expect(latestContext.current_route).toBe('/scout?tab=all-leads');
  });

  it('reports source_route correctly on the SAME render as the navigation', async () => {
    // The bug this guards: building history in an effect leaves the contract
    // holding the previous route for one render, so Barry is told the wrong
    // origin for the first message after a navigation.
    renderShell();

    await act(async () => { navigateTo('/scout?tab=all-leads'); });
    expect(latestContext.source_route).toBe('/mission-control-v2');

    await act(async () => { navigateTo('/scout/contact/c-1'); });
    expect(latestContext.source_route).toBe('/scout?tab=all-leads');
  });

  it('accumulates navigation history', async () => {
    renderShell();
    await act(async () => { navigateTo('/scout?tab=all-leads'); });
    await act(async () => { navigateTo('/scout/contact/c-1'); });

    expect(latestContext.navigation_history).toEqual([
      '/mission-control-v2',
      '/scout?tab=all-leads',
      '/scout/contact/c-1',
    ]);
  });

  it('picks up the open entity so Barry knows who is on screen', async () => {
    renderShell();
    await act(async () => { navigateTo('/scout/contact/c-1'); });

    expect(latestContext).toMatchObject({
      current_module: 'scout',
      current_entity_type: 'contact',
      current_entity_id: 'c-1',
      current_pipeline_stage: 'scout',
      entity_label: 'Sarah Chen',
    });
  });

  it('clears the entity when the user leaves the screen', async () => {
    renderShell();
    await act(async () => { navigateTo('/scout/contact/c-1'); });
    expect(latestContext.current_entity_id).toBe('c-1');

    await act(async () => { navigateTo('/mission-control-v2'); });

    // A stale contact id following the user into another module is what has
    // Barry answer confidently about the wrong person.
    expect(latestContext.current_entity_id).toBeNull();
    expect(latestContext.current_entity_type).toBeNull();
  });

  it('reports Quick Engage as the current action', async () => {
    renderShell('/mission-control-v2', EngagingContactPanelProbe);

    await act(async () => { navigateTo('/scout/contact/c-1'); });

    expect(latestContext.current_action).toBe('quick_engage');
    expect(latestContext.current_entity_id).toBe('c-1');
  });
});

describe('shell announcements', () => {
  function AnnouncerProbe() {
    const { announce, announcements } = useShell();
    return (
      <div>
        <button onClick={() => announce({ message: 'Sarah Chen moved to Hunter.' })}>
          move
        </button>
        <ul data-testid="announcements">
          {announcements.map(a => <li key={a.id}>{a.message}</li>)}
        </ul>
      </div>
    );
  }

  it('records an explicit stage transition and nothing else', async () => {
    render(
      <MemoryRouter initialEntries={['/scout']}>
        <ShellProvider user={{ id: 'u-1' }} userData={{}}>
          <NavProbe />
          <AnnouncerProbe />
        </ShellProvider>
      </MemoryRouter>
    );

    // Navigation alone must not narrate — "does not narrate every click".
    await act(async () => { navigateTo('/mission-control-v2'); });
    expect(screen.getByTestId('announcements')).toBeEmptyDOMElement();

    await act(async () => { screen.getByText('move').click(); });
    expect(screen.getByTestId('announcements')).toHaveTextContent('Sarah Chen moved to Hunter.');
  });
});
