/**
 * Recent Outreach Activity — the reply is a door, not a notice.
 *
 * Mission Control's activity feed announced the single highest-value event in
 * the product — "Sarah Chen replied" — as plain text. The contact's id was in
 * the cadence document the whole time; extractEvents simply dropped it, so the
 * only route from the announcement to the person was to leave the dashboard
 * and search for them by name.
 *
 * What is asserted here is the CONTRACT, not the pixels: that the id survives
 * extraction, that a row carrying one opens the canonical contact route with
 * Mission Control's intent, and that a row without one stays inert rather than
 * pretending to be clickable. usePriorityNavigation is the real hook — the
 * point of this change is that this panel shares Today's Priorities' single
 * navigation path, and mocking it away would test a path nobody uses.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

import RecentOutreachActivity from '../components/mission-control/RecentOutreachActivity';
import { NAVIGATION_INTENT_KEY } from '../utils/navigation';

// ── Mocks: only what talks to Firebase ──────────────────────────────────────

let CADENCE_DOCS = [];

vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));

// A mock stands in for the WHOLE module surface its consumers use, not just
// the part this file thinks about. addDoc/serverTimestamp are here because
// openContact() fires an analytics write on every navigation; omitting them
// does not fail a test, it just prints "event dropped" to stderr and quietly
// stops exercising the write path these assertions depend on.
vi.mock('firebase/firestore', () => ({
  collection: (_db, ...path) => ({ __path: path.join('/') }),
  getDocs: async () => ({
    docs: CADENCE_DOCS.map((d, i) => ({ id: `cad${i}`, data: () => d })),
  }),
  addDoc: async () => ({ id: 'evt1' }),
  serverTimestamp: () => ({ __ts: true }),
}));

// analytics reads the acting user to suppress writes during impersonation.
// openContact() calls it on every navigation, so an incomplete mock here turns
// a working click into a thrown error — see the note in canonicalRoutes.test.
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'u1' }),
  getActiveUserId: () => 'u1',
  useActiveUserId: () => 'u1',
  useImpersonation: () => ({ isReadOnly: false }),
  ImpersonationProvider: ({ children }) => children,
}));

// Minimal theme stand-in. The component reads tokens off `T` and nothing else.
const T = {
  text: '#fff', textMuted: '#aaa', textFaint: '#777',
  border: '#333', cardBg: '#111', surface: '#222', surface2: '#252525',
  rowHov: '#2a2a2a',
};

/** Reports where the router ended up, and what intent it carried. */
function Landing() {
  const location = useLocation();
  const intent = location.state?.[NAVIGATION_INTENT_KEY];
  return (
    <div>
      <span data-testid="pathname">{location.pathname}</span>
      <span data-testid="entry-point">{intent?.entryPoint || ''}</span>
      <span data-testid="reason">{intent?.reason || ''}</span>
      <span data-testid="return-to">{intent?.returnTo || ''}</span>
    </div>
  );
}

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={['/mission-control-v2']}>
      <Routes>
        <Route path="/mission-control-v2" element={<RecentOutreachActivity userId="u1" T={T} />} />
        <Route path="/contact/:contactId" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  );
}

const REPLIED_AT = new Date('2026-09-16T09:00:00Z');

beforeEach(() => {
  CADENCE_DOCS = [];
});

describe('Recent Outreach Activity', () => {
  it('opens the contact who replied, on the canonical route', async () => {
    CADENCE_DOCS = [{
      name: 'Q3 Founders',
      contacts: [
        { contactId: 'sarah-1', name: 'Sarah Chen', replied: true, repliedAt: REPLIED_AT },
      ],
    }];

    renderPanel();

    const row = await screen.findByRole('button', { name: /Sarah Chen replied/ });
    await userEvent.click(row);

    // The canonical contact page — not Scout's panel route, which would mount
    // a list the user never asked for underneath their contact.
    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent('/contact/sarah-1');
    });
  });

  it('carries Mission Control intent, so the breadcrumb and Back are right', async () => {
    CADENCE_DOCS = [{
      name: 'Q3 Founders',
      contacts: [
        { contactId: 'sarah-1', name: 'Sarah Chen', replied: true, repliedAt: REPLIED_AT },
      ],
    }];

    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /Sarah Chen replied/ }));

    await waitFor(() => expect(screen.getByTestId('entry-point')).toHaveTextContent('mission_control'));
    // The event type IS the reason the row exists; it rides along so the
    // arrival banner and Barry know this came from a reply.
    expect(screen.getByTestId('reason')).toHaveTextContent('replied');
    // Pinned to the dashboard, not to wherever the user happened to be.
    expect(screen.getByTestId('return-to')).toHaveTextContent('/mission-control-v2');
  });

  it('opens sent and opened events too — every row names a person', async () => {
    CADENCE_DOCS = [{
      name: 'Q3 Founders',
      contacts: [
        { contactId: 'dana-2', name: 'Dana Ruiz', status: 'sent', sentAt: REPLIED_AT },
      ],
    }];

    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /Sent to Dana Ruiz/ }));

    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent('/contact/dana-2');
    });
  });

  it('leaves a row inert when the cadence stored no contact id', async () => {
    // Cadences written before contactId was persisted. The row must still
    // render — the activity is real — but must not look clickable.
    CADENCE_DOCS = [{
      name: 'Legacy Blast',
      contacts: [
        { name: 'Old Record', replied: true, repliedAt: REPLIED_AT },
      ],
    }];

    renderPanel();

    expect(await screen.findByText('Old Record replied')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Old Record replied/ })).toBeNull();
  });

  it('still renders the empty state when there is no activity', async () => {
    renderPanel();
    expect(await screen.findByText(/No outreach activity yet/)).toBeInTheDocument();
  });
});
