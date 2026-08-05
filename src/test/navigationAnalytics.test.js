/**
 * Analytics on the navigation helpers.
 *
 * The question this data answers is "which modules actually drive contact
 * engagement", and it is only answerable because openContact/openCompany are
 * the single way to open a record. So the assertions are about coverage and
 * fidelity: every path emits, the event matches the navigation exactly, and it
 * never gets in the way of the navigation itself.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const addDocMock = vi.fn(async () => ({ id: 'evt1' }));
let currentUid = 'u1';
let activeUid = 'u1';

vi.mock('../firebase/config', () => ({
  db: {},
  get auth() { return { currentUser: currentUid ? { uid: currentUid } : null }; },
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db, ...path) => ({ __path: path.join('/') }),
  addDoc: (...args) => addDocMock(...args),
  serverTimestamp: () => '__ts__',
}));

const getActiveUserIdMock = vi.fn(() => activeUid);

vi.mock('../context/ImpersonationContext', () => ({
  getActiveUserId: (...args) => getActiveUserIdMock(...args),
}));

import { logEvent, EVENTS, getRecentEvents, clearRecentEvents } from '../services/analytics';
import { openContact, openCompany, ENTRY_POINTS, DISPLAY_MODES } from '../utils/navigation';

beforeEach(() => {
  addDocMock.mockClear();
  addDocMock.mockResolvedValue({ id: 'evt1' });
  currentUid = 'u1';
  activeUid = 'u1';
  clearRecentEvents();
  getActiveUserIdMock.mockReset();
  getActiveUserIdMock.mockImplementation(() => activeUid);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('openContact emits open_contact', () => {
  it('carries the entry point, display mode, reason and returnTo', () => {
    const navigate = vi.fn();

    openContact({
      navigate,
      contactId: 'c1',
      entryPoint: ENTRY_POINTS.MISSION_CONTROL,
      reason: 'next_step_overdue',
      recommendedAction: 'complete_step',
      returnTo: '/mission-control-v2',
      displayMode: DISPLAY_MODES.PAGE,
    });

    const [event] = getRecentEvents();
    expect(event.name).toBe(EVENTS.OPEN_CONTACT);
    expect(event.params).toEqual({
      contactId: 'c1',
      entryPoint: 'mission_control',
      displayMode: 'page',
      reason: 'next_step_overdue',
      returnTo: '/mission-control-v2',
    });
  });

  it('records the defaults the builder filled in, not just what the caller passed', () => {
    // Read off the INTENT rather than the arguments, so the event and the
    // navigation can never disagree. `displayMode` was never passed here.
    const navigate = vi.fn();
    openContact({ navigate, contactId: 'c1', entryPoint: ENTRY_POINTS.SCOUT });

    const [event] = getRecentEvents();
    expect(event.params.displayMode).toBe('page');
    expect(event.params.entryPoint).toBe('scout');
  });

  it('distinguishes panel opens from page opens', () => {
    const navigate = vi.fn();
    openContact({ navigate, contactId: 'c1', displayMode: DISPLAY_MODES.PANEL });

    expect(getRecentEvents()[0].params.displayMode).toBe('panel');
  });

  it('fires AFTER the navigation, never before it', () => {
    // Analytics must not sit between a click and the screen it opens.
    const order = [];
    const navigate = vi.fn(() => order.push('navigate'));
    vi.spyOn(console, 'info').mockImplementation((msg) => {
      if (typeof msg === 'string' && msg.includes('open_contact')) order.push('analytics');
    });

    openContact({ navigate, contactId: 'c1' });

    expect(order).toEqual(['navigate', 'analytics']);
  });

  it('does not emit when the navigation was refused', () => {
    expect(() => openContact({ navigate: vi.fn() })).toThrow(/contactId is required/);
    expect(getRecentEvents()).toHaveLength(0);
  });
});

describe('openCompany emits open_company', () => {
  it('carries companyId, entry point, display mode and returnTo', () => {
    const navigate = vi.fn();
    openCompany({
      navigate,
      companyId: 'co1',
      entryPoint: ENTRY_POINTS.COMMAND_BAR,
      reason: 'search_result',
      returnTo: '/hunter',
    });

    const [event] = getRecentEvents();
    expect(event.name).toBe(EVENTS.OPEN_COMPANY);
    expect(event.params).toEqual({
      companyId: 'co1',
      entryPoint: 'command_bar',
      displayMode: 'page',
      reason: 'search_result',
      returnTo: '/hunter',
    });
  });
});

describe('logEvent — the three rules', () => {
  it('writes to the workspace event log, not to the contact record', () => {
    logEvent(EVENTS.OPEN_CONTACT, { contactId: 'c1', entryPoint: 'scout' });

    expect(addDocMock).toHaveBeenCalledTimes(1);
    const [ref, payload] = addDocMock.mock.calls[0];
    expect(ref.__path).toBe('users/u1/analytics_events');
    expect(payload).toMatchObject({ event: 'open_contact', contactId: 'c1', entryPoint: 'scout' });
  });

  it('never writes while impersonating', () => {
    // An admin's clicks are not the customer's behaviour. A workspace whose
    // event log is half admin traffic answers "which module drives engagement"
    // with a number nobody can trust.
    currentUid = 'admin';
    activeUid = 'customer';

    logEvent(EVENTS.OPEN_CONTACT, { contactId: 'c1' });

    expect(addDocMock).not.toHaveBeenCalled();
    // Still recorded locally — the console trace stays useful while debugging
    // an impersonated session.
    expect(getRecentEvents()).toHaveLength(1);
  });

  it('never writes when signed out', () => {
    currentUid = null;
    logEvent(EVENTS.OPEN_CONTACT, { contactId: 'c1' });
    expect(addDocMock).not.toHaveBeenCalled();
  });

  it('never throws when the write fails', async () => {
    addDocMock.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));

    expect(() => logEvent(EVENTS.OPEN_CONTACT, { contactId: 'c1' })).not.toThrow();
    // Flush the rejected promise — an unhandled rejection here would be the
    // same defect in a different costume.
    await new Promise(r => setTimeout(r, 0));
    expect(console.warn).toHaveBeenCalled();
  });

  it('returns nothing, so no caller can await it', () => {
    expect(logEvent(EVENTS.OPEN_CONTACT, { contactId: 'c1' })).toBeUndefined();
  });

  it('never throws when resolving WHO is acting fails', () => {
    // The regression this exists for: the write was wrapped but the identity
    // lookup was not, so a failure there propagated through openContact() and
    // into the click that triggered it. CI found it via a test whose module
    // mock omitted getActiveUserId; the same shape would occur in production
    // from an auth object mid-refresh.
    getActiveUserIdMock.mockImplementationOnce(() => {
      throw new Error('No "getActiveUserId" export is defined on the mock');
    });

    expect(() => logEvent(EVENTS.OPEN_CONTACT, { contactId: 'c1' })).not.toThrow();
    expect(addDocMock).not.toHaveBeenCalled();
    // Still traceable: the event reached the in-memory log before the failure.
    expect(getRecentEvents()).toHaveLength(1);
  });
});

describe('analytics never takes a navigation down with it', () => {
  it('openContact still navigates when analytics throws', () => {
    getActiveUserIdMock.mockImplementationOnce(() => { throw new Error('boom'); });
    const navigate = vi.fn();

    expect(() => openContact({ navigate, contactId: 'c1' })).not.toThrow();

    // The whole point. Instrumentation is not allowed to break the product.
    expect(navigate).toHaveBeenCalledWith('/contact/c1', expect.any(Object));
  });

  it('openCompany still navigates when analytics throws', () => {
    getActiveUserIdMock.mockImplementationOnce(() => { throw new Error('boom'); });
    const navigate = vi.fn();

    expect(() => openCompany({ navigate, companyId: 'co1' })).not.toThrow();
    expect(navigate).toHaveBeenCalledWith('/company/co1', expect.any(Object));
  });

  it('omits empty params rather than writing nulls', () => {
    logEvent(EVENTS.OPEN_CONTACT, { contactId: 'c1', reason: null, returnTo: '' });

    const [, payload] = addDocMock.mock.calls[0];
    expect(payload).not.toHaveProperty('reason');
    expect(payload).not.toHaveProperty('returnTo');
  });
});
