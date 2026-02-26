/**
 * HUNTER CONTACT CARD — QA Component Tests
 *
 * Tests the card front renders correctly and buttons fire the right callbacks.
 * This is the primary UI surface for Hunter Sprint 1 — every item
 * in the "Deck loads" and "Archive/Engage" sections of the QA checklist
 * is validated here.
 *
 * Key behaviors under test:
 * - Card renders name, title, company without crashing
 * - Relationship badge renders with correct state label (not "undefined")
 * - Archive button calls onArchive with the correct contact object
 * - Engage button calls onEngage with the correct contact object
 * - CTA label changes based on relationship_state
 * - Active mission overrides CTA label to "Advance Mission"
 * - Background (isBackground) mode renders without action buttons
 * - RECON confidence dot renders in all states (high/mid/low/none)
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, beforeEach, expect } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'test-user', getIdToken: () => Promise.resolve('fake-token') } },
  db: {}
}));

// Framer Motion: pass-through (no animation in tests)
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }) => <div {...props}>{children}</div>
  },
  AnimatePresence: ({ children }) => <>{children}</>
}));

// date-fns: deterministic output
vi.mock('date-fns', () => ({
  formatDistanceToNow: () => '3 days ago'
}));

// Suppress fetch calls in Barry read useEffect
global.fetch = vi.fn(() => Promise.resolve({
  json: () => Promise.resolve({ success: false })
}));

import HunterContactCard from '../components/hunter/HunterContactCard';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const baseContact = {
  id: 'contact-1',
  name: 'Alice Chen',
  first_name: 'Alice',
  last_name: 'Chen',
  title: 'VP of Engineering',
  company_name: 'Acme Corp',
  relationship_state: 'unaware',
  strategic_value: 'high',
  hunter_status: 'deck',
  barry_hunter_read: 'Never been contacted. Open the conversation.',
  barry_hunter_read_state: 'unaware'
};

// ── Rendering tests ───────────────────────────────────────────────────────────

describe('HunterContactCard — rendering', () => {

  it('renders the contact name', () => {
    render(
      <HunterContactCard
        contact={baseContact}
        onEngage={vi.fn()}
        onArchive={vi.fn()}
      />
    );
    expect(screen.getByText('Alice Chen')).toBeInTheDocument();
  });

  it('renders title and company in subtitle', () => {
    render(
      <HunterContactCard
        contact={baseContact}
        onEngage={vi.fn()}
        onArchive={vi.fn()}
      />
    );
    expect(screen.getByText('VP of Engineering · Acme Corp')).toBeInTheDocument();
  });

  it('renders a relationship badge with the correct state label (not undefined)', () => {
    render(
      <HunterContactCard
        contact={{ ...baseContact, relationship_state: 'warm' }}
        onEngage={vi.fn()}
        onArchive={vi.fn()}
      />
    );
    expect(screen.getByText('Warm')).toBeInTheDocument();
  });

  it('renders the contact initials when no company logo URL is provided', () => {
    render(
      <HunterContactCard
        contact={{ ...baseContact, company_logo_url: null }}
        onEngage={vi.fn()}
        onArchive={vi.fn()}
      />
    );
    // 'AC' from Alice Chen
    expect(screen.getByText('AC')).toBeInTheDocument();
  });

  it('renders the strategic value in the intel row', () => {
    render(
      <HunterContactCard
        contact={{ ...baseContact, strategic_value: 'high' }}
        onEngage={vi.fn()}
        onArchive={vi.fn()}
      />
    );
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('shows last interaction label from date-fns', () => {
    render(
      <HunterContactCard
        contact={{ ...baseContact, last_interaction_at: new Date().toISOString() }}
        onEngage={vi.fn()}
        onArchive={vi.fn()}
      />
    );
    expect(screen.getByText('3 days ago')).toBeInTheDocument();
  });

  it('shows Never when no last interaction date exists', () => {
    render(
      <HunterContactCard
        contact={{ ...baseContact, last_interaction_at: null }}
        onEngage={vi.fn()}
        onArchive={vi.fn()}
      />
    );
    expect(screen.getByText('Never')).toBeInTheDocument();
  });

  it('renders Barry cached one-liner when available and state matches', () => {
    render(
      <HunterContactCard
        contact={baseContact} // has barry_hunter_read + barry_hunter_read_state matching relationship_state
        onEngage={vi.fn()}
        onArchive={vi.fn()}
      />
    );
    expect(screen.getByText(/"Never been contacted. Open the conversation."/).textContent).toBeTruthy();
  });

  it('renders RECON confidence dot for all levels without crashing', () => {
    // high
    const { rerender } = render(
      <HunterContactCard contact={baseContact} reconCompletion={0.9} onEngage={vi.fn()} onArchive={vi.fn()} />
    );
    // mid
    rerender(<HunterContactCard contact={baseContact} reconCompletion={0.5} onEngage={vi.fn()} onArchive={vi.fn()} />);
    // low
    rerender(<HunterContactCard contact={baseContact} reconCompletion={0.1} onEngage={vi.fn()} onArchive={vi.fn()} />);
    // none
    rerender(<HunterContactCard contact={baseContact} reconCompletion={null} onEngage={vi.fn()} onArchive={vi.fn()} />);
  });
});

// ── CTA label engine ──────────────────────────────────────────────────────────

describe('HunterContactCard — CTA labels', () => {

  const testCTA = (state, expectedLabel, hasActiveMission = false) => {
    it(`${state} → "${expectedLabel}"${hasActiveMission ? ' (has active mission)' : ''}`, () => {
      render(
        <HunterContactCard
          contact={{ ...baseContact, relationship_state: state }}
          hasActiveMission={hasActiveMission}
          onEngage={vi.fn()}
          onArchive={vi.fn()}
        />
      );
      expect(screen.getByText(new RegExp(expectedLabel))).toBeInTheDocument();
    });
  };

  testCTA('unaware', 'Start Conversation');
  testCTA('aware', 'Build Rapport');
  testCTA('dormant', 'Reconnect');
  testCTA('strained', 'Rebuild Trust');
  testCTA('trusted', 'Request Introduction');
  testCTA('unaware', 'Advance Mission', true);   // active mission overrides
  testCTA('trusted', 'Advance Mission', true);   // active mission overrides
});

// ── Interaction tests ─────────────────────────────────────────────────────────

describe('HunterContactCard — interactions', () => {

  it('calls onArchive with the contact when Archive button is clicked', () => {
    const onArchive = vi.fn();
    render(
      <HunterContactCard
        contact={baseContact}
        onEngage={vi.fn()}
        onArchive={onArchive}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /archive/i }));
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onArchive).toHaveBeenCalledWith(baseContact);
  });

  it('calls onEngage with the contact when Engage button is clicked', () => {
    const onEngage = vi.fn();
    render(
      <HunterContactCard
        contact={baseContact}
        onEngage={onEngage}
        onArchive={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /start conversation/i }));
    expect(onEngage).toHaveBeenCalledTimes(1);
    expect(onEngage).toHaveBeenCalledWith(baseContact);
  });
});

// ── Background mode ───────────────────────────────────────────────────────────

describe('HunterContactCard — background mode (next card in stack)', () => {

  it('renders name in background mode', () => {
    render(
      <HunterContactCard
        contact={baseContact}
        onEngage={vi.fn()}
        onArchive={vi.fn()}
        isBackground
      />
    );
    expect(screen.getByText('Alice Chen')).toBeInTheDocument();
  });

  it('does not render Archive or Engage buttons in background mode', () => {
    render(
      <HunterContactCard
        contact={baseContact}
        onEngage={vi.fn()}
        onArchive={vi.fn()}
        isBackground
      />
    );
    expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /engage|start conversation|reconnect/i })).not.toBeInTheDocument();
  });
});

// ── Graceful handling of incomplete data ──────────────────────────────────────

describe('HunterContactCard — incomplete contact data', () => {

  it('renders without crashing when contact has no name (uses first_name + last_name)', () => {
    render(
      <HunterContactCard
        contact={{ id: '1', first_name: 'Bob', last_name: 'Smith', relationship_state: 'unaware' }}
        onEngage={vi.fn()}
        onArchive={vi.fn()}
      />
    );
    expect(screen.getByText('Bob Smith')).toBeInTheDocument();
  });

  it('renders without crashing when title and company are missing', () => {
    render(
      <HunterContactCard
        contact={{ id: '1', name: 'Bob Smith', relationship_state: 'unaware' }}
        onEngage={vi.fn()}
        onArchive={vi.fn()}
      />
    );
    // Should render without throwing — subtitle row may be empty but component loads
    expect(screen.getByText('Bob Smith')).toBeInTheDocument();
  });

  it('renders without crashing when relationship_state is null', () => {
    // This would happen if bootstrap hasn't run yet for a contact
    render(
      <HunterContactCard
        contact={{ ...baseContact, relationship_state: null }}
        onEngage={vi.fn()}
        onArchive={vi.fn()}
      />
    );
    expect(screen.getByText('Alice Chen')).toBeInTheDocument();
  });
});
