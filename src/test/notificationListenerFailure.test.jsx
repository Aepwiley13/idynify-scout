/**
 * The notification bell must never take the application down.
 *
 * It lives in the shell's top bar, outside every module error boundary. When
 * the Firestore client had failed internally, the bell's next listener call
 * threw from an effect and React unmounted the whole app: a blank screen.
 *
 * Three failures are covered: the listener throwing when it is started, the
 * listener reporting an error later, and a snapshot that cannot be read. In
 * each the bell stays, says notifications are unavailable (which is not the
 * same as having none), and nothing is thrown.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const firestore = vi.hoisted(() => ({ onSnapshot: vi.fn(), getDocs: vi.fn() }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  doc: vi.fn(),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  writeBatch: vi.fn(),
  serverTimestamp: vi.fn(),
  Timestamp: { now: vi.fn(), fromDate: vi.fn() },
  getDocs: firestore.getDocs,
  onSnapshot: firestore.onSnapshot,
}));
vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));

import NotificationCenter from '../components/notifications/NotificationCenter';
import { subscribeToNotifications } from '../services/notificationService';
import { THEMES } from '../theme/tokens';

const UNAVAILABLE = 'Notifications are temporarily unavailable';
const snapshotOf = (rows) => ({ docs: rows.map((row) => ({ id: row.id, data: () => row })) });
const renderBell = () => render(
  <MemoryRouter>
    <header>
      <span>top bar</span>
      <NotificationCenter userId="u1" T={THEMES.workspace} />
    </header>
  </MemoryRouter>,
);

let errors;
beforeEach(() => {
  firestore.onSnapshot.mockReset();
  firestore.getDocs.mockReset().mockResolvedValue(snapshotOf([]));
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errors.mockRestore());

describe('the listener throws as it is started', () => {
  beforeEach(() => {
    firestore.onSnapshot.mockImplementation(() => {
      throw new Error('FIRESTORE (12.6.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815)');
    });
  });

  it('the service does not throw; it reports unavailable and returns a working unsubscribe', () => {
    const onList = vi.fn();
    const onUnavailable = vi.fn();
    let unsubscribe;
    expect(() => { unsubscribe = subscribeToNotifications('u1', onList, onUnavailable); }).not.toThrow();
    expect(onList).toHaveBeenCalledWith([]);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(() => unsubscribe()).not.toThrow();
  });

  it('the top bar and the bell still render, with the unavailable marker', () => {
    renderBell();
    expect(screen.getByText('top bar')).toBeInTheDocument();
    expect(screen.getByTitle(UNAVAILABLE)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(UNAVAILABLE);
    expect(screen.getByTestId('notifications-unavailable-dot')).toBeInTheDocument();
  });

  it('the failure is logged, not hidden', () => {
    renderBell();
    expect(errors.mock.calls.some((call) => String(call[0]).includes('[NotificationService]'))).toBe(true);
  });

  it('the open drawer says unavailable, not "No notifications yet"', async () => {
    renderBell();
    await userEvent.click(screen.getByTitle(UNAVAILABLE));
    expect(screen.getByText('Temporarily unavailable')).toBeInTheDocument();
    expect(screen.getByText(/rest of Idynify is working/i)).toBeInTheDocument();
    expect(screen.queryByText('No notifications yet')).not.toBeInTheDocument();
  });

  it('a failing unsubscribe does not throw when the bell goes away', () => {
    firestore.onSnapshot.mockImplementation(() => () => { throw new Error('unsubscribe failed'); });
    const view = renderBell();
    expect(() => view.unmount()).not.toThrow();
    expect(errors.mock.calls.some((call) => String(call[0]).includes('Could not stop notifications'))).toBe(true);
  });
});

describe('the listener reports an error later', () => {
  it('shows the list first, then switches to unavailable without throwing', () => {
    let fail;
    firestore.onSnapshot.mockImplementation((_query, onNext, onError) => {
      fail = onError;
      onNext(snapshotOf([{ id: 'n1', type: 'follow_up_due' }]));
      return () => {};
    });
    renderBell();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('');

    act(() => fail(Object.assign(new Error('Missing or insufficient permissions'), { code: 'permission-denied' })));

    expect(screen.getByText('top bar')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(UNAVAILABLE);
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('recovers when the listener delivers again', () => {
    let next; let fail;
    firestore.onSnapshot.mockImplementation((_query, onNext, onError) => { next = onNext; fail = onError; return () => {}; });
    renderBell();
    act(() => fail(new Error('unavailable')));
    expect(screen.getByRole('status')).toHaveTextContent(UNAVAILABLE);
    act(() => next(snapshotOf([{ id: 'n1', type: 'follow_up_due' }, { id: 'n2', type: 'referral_received' }])));
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});

describe('a snapshot that cannot be read', () => {
  it('is logged and reported as unavailable instead of thrown into the listener', () => {
    let next;
    firestore.onSnapshot.mockImplementation((_query, onNext) => { next = onNext; return () => {}; });
    renderBell();
    const broken = { docs: [{ id: 'n1', data: () => { throw new Error('bad document'); } }] };
    expect(() => act(() => next(broken))).not.toThrow();
    expect(screen.getByRole('status')).toHaveTextContent(UNAVAILABLE);
    expect(errors.mock.calls.some((call) => String(call[0]).includes('Could not read a notifications update'))).toBe(true);
  });
});

describe('normal notifications are unchanged', () => {
  it('shows the unread count, the category, and no unavailable marker', async () => {
    firestore.onSnapshot.mockImplementation((_query, onNext) => {
      onNext(snapshotOf([
        { id: 'n1', type: 'follow_up_due' },
        { id: 'n2', type: 'referral_received' },
        { id: 'n3', type: 'referral_converted' },
      ]));
      return () => {};
    });
    renderBell();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByTitle('Notifications')).toBeInTheDocument();
    expect(screen.queryByTestId('notifications-unavailable-dot')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTitle('Notifications'));
    expect(screen.getByText('3 unread')).toBeInTheDocument();
  });

  it('an empty list is "No notifications yet", not unavailable', async () => {
    firestore.onSnapshot.mockImplementation((_query, onNext) => { onNext(snapshotOf([])); return () => {}; });
    renderBell();
    expect(screen.getByRole('status')).toHaveTextContent('');
    await userEvent.click(screen.getByTitle('Notifications'));
    expect(screen.getByText('No notifications yet')).toBeInTheDocument();
    expect(screen.queryByText('Temporarily unavailable')).not.toBeInTheDocument();
  });

  it('stops listening when the bell goes away', () => {
    const unsubscribe = vi.fn();
    firestore.onSnapshot.mockImplementation(() => unsubscribe);
    renderBell().unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('gives the caller the category for each notification', () => {
    firestore.onSnapshot.mockImplementation((_query, onNext) => {
      onNext(snapshotOf([{ id: 'n1', type: 'referral_received' }, { id: 'n2', type: 'follow_up_due' }]));
      return () => {};
    });
    const onList = vi.fn();
    subscribeToNotifications('u1', onList);
    expect(onList.mock.calls[0][0].map((n) => n.category)).toEqual(['relationship', 'task']);
  });
});
