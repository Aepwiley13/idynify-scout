/**
 * QUEUE PANEL DISMISSAL — Scout → Daily Discoveries "In Queue → View".
 *
 * The desktop queue panel is a fixed right-hand sidebar with no backdrop, so
 * until now the only way out was its × button. These tests pin the dismissal
 * contract:
 *
 *   - outside interaction closes it, inside interaction does not;
 *   - the View trigger is part of the panel's boundary, so one click on it
 *     closes the panel exactly once instead of close-then-reopen;
 *   - a drag that starts inside and is released outside (text selection)
 *     leaves the panel open — which is why the decision is made on pointerup
 *     against the pointerdown origin, not on click;
 *   - Escape closes and hands focus back to the trigger;
 *   - every listener is removed when the panel unmounts.
 *
 * Mobile renders a bottom sheet with its own backdrop and is deliberately
 * untouched: the effect no-ops there.
 */

import { render, fireEvent } from '@testing-library/react';
import { useRef } from 'react';
import { vi, describe, it, beforeEach, afterEach, expect } from 'vitest';

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'test-user', getIdToken: () => Promise.resolve('t') } },
  db: {},
}));
vi.mock('firebase/firestore', () => new Proxy({}, {
  get: (target, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : vi.fn()),
}));
vi.mock('../components/scout/CompanyLogo', () => ({ default: () => <div data-testid="logo" /> }));
vi.mock('../components/scout/ContactTitleSetup', () => ({ default: () => null }));
vi.mock('../components/scout/BarryICPPanel', () => ({
  default: () => null,
  BarryAvatar: () => null,
}));

import { QueueListPanel } from '../pages/Scout/DailyLeads.jsx';

const COMPANIES = [
  { id: 'c1', name: 'Acme Robotics', industry: 'Industrial Automation', fit_score: 88 },
  { id: 'c2', name: 'Borealis Foods', industry: 'Food & Beverage', fit_score: 71 },
];

// Mirrors the page: a View trigger outside the panel, marked as part of the
// panel's interaction boundary, plus unrelated page chrome to click on.
function Harness({ mobile = false, onClose }) {
  const triggerRef = useRef(null);
  return (
    <div>
      <button ref={triggerRef} data-queue-trigger onClick={onClose}>View</button>
      <div data-testid="outside">Daily Discoveries card</div>
      <QueueListPanel
        companies={COMPANIES}
        currentIndex={0}
        rejectedIds={[]}
        onJumpTo={() => {}}
        onClose={onClose}
        mobile={mobile}
        returnFocusRef={triggerRef}
      />
    </div>
  );
}

// fireEvent.pointerDown/Up need PointerEvent; jsdom has none, so send the
// events by name with a MouseEvent-shaped init (the handlers only read target).
const pointer = (node, type) => fireEvent(node, new MouseEvent(type, { bubbles: true, cancelable: true }));
const clickOn = (node) => { pointer(node, 'pointerdown'); pointer(node, 'pointerup'); fireEvent.click(node); };

describe('QueueListPanel dismissal (desktop)', () => {
  let onClose;
  beforeEach(() => { onClose = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('stays open when the interaction is inside the panel', () => {
    const { getByText } = render(<Harness onClose={onClose} />);
    clickOn(getByText('Queue'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes when the interaction is outside the panel', () => {
    const { getByTestId } = render(<Harness onClose={onClose} />);
    clickOn(getByTestId('outside'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes exactly once when the View trigger is clicked while open', () => {
    // The trigger owns the toggle. If the document listener fired too, this
    // would be close-then-reopen — two calls for one click.
    const { getByText } = render(<Harness onClose={onClose} />);
    clickOn(getByText('View'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open for a drag that begins inside and is released outside', () => {
    const { getByText, getByTestId } = render(<Harness onClose={onClose} />);
    pointer(getByText('Queue'), 'pointerdown');
    pointer(getByTestId('outside'), 'pointerup');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape and returns focus to the View trigger', () => {
    const { getByText } = render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(getByText('View'));
  });

  it('ignores keys other than Escape', () => {
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'l' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes every listener on unmount, over repeated open/close cycles', () => {
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');
    for (let i = 0; i < 10; i++) render(<Harness onClose={onClose} />).unmount();
    const count = (spy, type) => spy.mock.calls.filter(([t]) => t === type).length;
    for (const type of ['pointerdown', 'pointerup', 'keydown']) {
      expect(count(added, type)).toBe(10);
      expect(count(removed, type)).toBe(count(added, type));
    }
    // And nothing survives the last unmount.
    clickOn(document.body);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('QueueListPanel dismissal (mobile)', () => {
  it('binds no document listeners — the bottom sheet keeps its backdrop', () => {
    const onClose = vi.fn();
    const added = vi.spyOn(document, 'addEventListener');
    const { getByTestId } = render(<Harness mobile onClose={onClose} />);
    const bound = added.mock.calls.filter(([t]) => ['pointerdown', 'pointerup', 'keydown'].includes(t));
    expect(bound).toHaveLength(0);
    clickOn(getByTestId('outside'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
