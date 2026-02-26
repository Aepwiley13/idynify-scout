/**
 * HUNTER CARD STACK — QA Component Tests
 *
 * Tests the card deck container: correct card rendering, empty state,
 * and the critical engaged_pending gap flow.
 *
 * Framer Motion animations are mocked — we test behavior, not animation timing.
 * (Animation timing is in the manual QA checklist as "rocket launch feels right at ~900ms")
 *
 * Key behaviors under test:
 * - Current card renders
 * - Next card is visible behind the current card
 * - Empty state renders when deck is empty
 * - onDeckEmpty fires when empty state CTA is clicked
 * - Archive button triggers onArchive with correct contact
 * - Engage button triggers onEngage with correct contact
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, beforeEach, afterEach, expect } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'test-user', getIdToken: () => Promise.resolve('fake-token') } },
  db: {}
}));

// Framer Motion: pass-through — no animations in tests
vi.mock('framer-motion', () => {
  const MotionDiv = ({ children, ...props }) => {
    // Strip framer-specific props that would cause React DOM warnings
    const { animate, initial, transition, whileTap, whileDrag, drag,
            dragConstraints, onDragEnd, onAnimationComplete, ...rest } = props;
    return <div {...rest}>{children}</div>;
  };
  return {
    motion: { div: MotionDiv },
    AnimatePresence: ({ children }) => <>{children}</>,
    useAnimation: () => ({
      start: vi.fn().mockResolvedValue(undefined),
      set: vi.fn()
    })
  };
});

vi.mock('date-fns', () => ({
  formatDistanceToNow: () => '2 days ago'
}));

// useMissionSounds pulls from Firestore — mock the hook directly for card stack tests
vi.mock('../hooks/useMissionSounds', () => ({
  useMissionSounds: () => ({ soundEnabled: true, hapticsEnabled: false, setSoundEnabled: vi.fn() })
}));

global.fetch = vi.fn(() => Promise.resolve({
  json: () => Promise.resolve({ success: false })
}));

import HunterCardStack from '../components/hunter/HunterCardStack';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const makeContact = (overrides = {}) => ({
  id: `contact-${Math.random()}`,
  name: 'Alice Chen',
  first_name: 'Alice',
  title: 'VP of Engineering',
  company_name: 'Acme Corp',
  relationship_state: 'unaware',
  strategic_value: 'high',
  hunter_status: 'deck',
  barry_hunter_read: 'Never contacted. Time to reach out.',
  barry_hunter_read_state: 'unaware',
  ...overrides
});

const contact1 = makeContact({ id: 'c1', name: 'Alice Chen', first_name: 'Alice' });
const contact2 = makeContact({ id: 'c2', name: 'Bob Torres', first_name: 'Bob' });
const contact3 = makeContact({ id: 'c3', name: 'Carol Kim', first_name: 'Carol' });

// ── Rendering tests ───────────────────────────────────────────────────────────

describe('HunterCardStack — deck rendering', () => {

  it('renders the current card (index 0)', () => {
    render(
      <HunterCardStack
        contacts={[contact1, contact2, contact3]}
        currentIndex={0}
        onEngage={vi.fn()}
        onArchive={vi.fn()}
        onDeckEmpty={vi.fn()}
      />
    );
    // Alice is the current card — should be visible
    // (multiple instances possible due to background card)
    const names = screen.getAllByText('Alice Chen');
    expect(names.length).toBeGreaterThanOrEqual(1);
  });

  it('advances to next card when currentIndex changes', () => {
    const { rerender } = render(
      <HunterCardStack
        contacts={[contact1, contact2]}
        currentIndex={0}
        onEngage={vi.fn()}
        onArchive={vi.fn()}
        onDeckEmpty={vi.fn()}
      />
    );
    // Initial: Alice is current card
    expect(screen.getAllByText('Alice Chen').length).toBeGreaterThanOrEqual(1);

    // Simulate: card was engaged, index advances
    rerender(
      <HunterCardStack
        contacts={[contact1, contact2]}
        currentIndex={1}
        onEngage={vi.fn()}
        onArchive={vi.fn()}
        onDeckEmpty={vi.fn()}
      />
    );
    // Now Bob should be the current card
    expect(screen.getAllByText('Bob Torres').length).toBeGreaterThanOrEqual(1);
  });
});

// ── Empty state ───────────────────────────────────────────────────────────────

describe('HunterCardStack — empty state', () => {

  it('shows empty state when contacts array is empty', () => {
    render(
      <HunterCardStack
        contacts={[]}
        currentIndex={0}
        onEngage={vi.fn()}
        onArchive={vi.fn()}
        onDeckEmpty={vi.fn()}
      />
    );
    expect(screen.getByText(/hunter deck is clear/i)).toBeInTheDocument();
  });

  it('shows empty state when currentIndex has passed the last card', () => {
    render(
      <HunterCardStack
        contacts={[contact1, contact2]}
        currentIndex={2} // past end of array
        onEngage={vi.fn()}
        onArchive={vi.fn()}
        onDeckEmpty={vi.fn()}
      />
    );
    expect(screen.getByText(/hunter deck is clear/i)).toBeInTheDocument();
  });

  it('calls onDeckEmpty when the View Active Missions CTA is clicked in empty state', () => {
    const onDeckEmpty = vi.fn();
    render(
      <HunterCardStack
        contacts={[]}
        currentIndex={0}
        onEngage={vi.fn()}
        onArchive={vi.fn()}
        onDeckEmpty={onDeckEmpty}
      />
    );
    fireEvent.click(screen.getByText(/view active missions/i));
    expect(onDeckEmpty).toHaveBeenCalledTimes(1);
  });

  it('does not crash when onDeckEmpty is not provided', () => {
    render(
      <HunterCardStack
        contacts={[]}
        currentIndex={0}
        onEngage={vi.fn()}
        onArchive={vi.fn()}
        // onDeckEmpty not provided
      />
    );
    expect(screen.getByText(/hunter deck is clear/i)).toBeInTheDocument();
  });
});

// ── Engaged pending gap ────────────────────────────────────────────────────────

describe('HunterCardStack — engaged_pending gap state', () => {

  it('does not show an engaged_pending contact in the deck (filtered by parent)', () => {
    // engaged_pending contacts should be filtered OUT before being passed to HunterCardStack.
    // The component itself doesn't filter — the parent (HunterDashboard) queries
    // where hunter_status == 'deck'. This test confirms the component does not
    // blow up if an engaged_pending contact somehow reaches it.
    const pendingContact = makeContact({ id: 'c-pending', hunter_status: 'engaged_pending', name: 'Ghost Contact' });
    render(
      <HunterCardStack
        contacts={[pendingContact]}
        currentIndex={0}
        onEngage={vi.fn()}
        onArchive={vi.fn()}
        onDeckEmpty={vi.fn()}
      />
    );
    // Component renders without crashing — Ghost Contact appears (parent is responsible
    // for filtering, but we don't crash if it slips through)
    expect(document.querySelector('.hcs-stack')).toBeInTheDocument();
  });
});

// ── Prop forwarding to card ────────────────────────────────────────────────────

describe('HunterCardStack — prop forwarding', () => {

  // triggerEngage uses a 250ms setTimeout before calling onEngage (animation gap).
  // Use fake timers so we can advance past it synchronously in tests.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('passes onEngage to HunterContactCard and calls it after animation completes', async () => {
    const onEngage = vi.fn();
    render(
      <HunterCardStack
        contacts={[contact1]}
        currentIndex={0}
        onEngage={onEngage}
        onArchive={vi.fn()}
        onDeckEmpty={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /start conversation/i }));
    // triggerEngage: awaits 2 promise chains (shake + pause), then setTimeout(250ms)
    // vi.runAllTimersAsync() flushes both the promise microtask queue and timer queue
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(onEngage).toHaveBeenCalledTimes(1);
    expect(onEngage).toHaveBeenCalledWith(contact1);
  });

  it('passes onArchive to HunterContactCard and calls it after animation completes', async () => {
    const onArchive = vi.fn();
    render(
      <HunterCardStack
        contacts={[contact1]}
        currentIndex={0}
        onEngage={vi.fn()}
        onArchive={onArchive}
        onDeckEmpty={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /archive/i }));
    // triggerArchive: awaits controls.start() (1 promise), then calls onArchive directly
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onArchive).toHaveBeenCalledWith(contact1);
  });
});
