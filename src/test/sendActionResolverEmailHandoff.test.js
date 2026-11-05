/**
 * executeSendAction's own contract (sendActionResolver.js's docblock):
 * "Sent" = external confirmation received. "Opened" = app handoff occurred.
 * No false-positive success states allowed.
 *
 * The state machine that follows a send honored that distinction for every
 * channel except email: opening a mail client (mailto, Outlook, or the
 * Gmail-web fallback) moved the contact into Awaiting Reply and started its
 * 3-day follow-up clock, exactly as a real Gmail send would. Nothing confirms
 * the user ever finished composing in their own mail client.
 *
 * Fixed: email's native handoff (SEND_RESULT.OPENED) no longer drives the
 * state machine. A real Gmail send (SEND_RESULT.SENT) is unaffected, and so
 * is every other channel — text, call and LinkedIn have no "real" path at
 * all, so Opened has always been their only terminal state, and still is.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── In-memory Firestore (paths → documents) ─────────────────────────────────
const store = vi.hoisted(() => ({ docs: new Map() }));

vi.mock('firebase/firestore', async (importOriginal) => {
  const real = await importOriginal();
  const doc = (_db, ...segments) => ({ path: segments.join('/') });
  const getDoc = async (ref) => {
    const data = store.docs.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  };
  const unwrap = (raw, base) => {
    if (raw && raw.__arrayUnion) return [...(base ?? []), raw.item];
    if (raw && raw.__increment) return (base ?? 0) + raw.amount;
    return raw;
  };
  const updateDoc = async (ref, data) => {
    const current = store.docs.get(ref.path) ?? {};
    const next = { ...current };
    for (const [key, value] of Object.entries(data)) {
      if (key.includes('.')) {
        const [head, ...rest] = key.split('.');
        const subKey = rest.join('.');
        const headObj = { ...(next[head] ?? current[head] ?? {}) };
        headObj[subKey] = unwrap(value, headObj[subKey]);
        next[head] = headObj;
      } else {
        next[key] = unwrap(value, current[key]);
      }
    }
    store.docs.set(ref.path, next);
  };
  const arrayUnion = (item) => ({ __arrayUnion: true, item });
  const increment = (amount) => ({ __increment: true, amount });
  return { ...real, doc, getDoc, updateDoc, arrayUnion, increment };
});

vi.mock('../firebase/config', () => ({
  db: {},
  auth: { currentUser: { uid: 'u1', getIdToken: async () => 'tok' } },
}));

const updateContactStatus = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../utils/contactStateMachine', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, updateContactStatus };
});

const { executeSendAction, SEND_RESULT, CHANNELS } = await import('../utils/sendActionResolver.js');

const UID = 'u1';
const path = id => `users/${UID}/contacts/${id}`;
const put = (id, data) => store.docs.set(path(id), { id, ...data });
const get = id => store.docs.get(path(id));

const CONTACT = { id: 'c1', email: 'dana@acme.com', firstName: 'Dana', lastName: 'W', phone: '+14155550100', linkedin_url: 'https://www.linkedin.com/in/dana' };
const CONTENT = 'Hi Dana, this is a real message body.';

let originalLocation, originalOpen;
beforeEach(() => {
  store.docs.clear();
  updateContactStatus.mockClear();
  put('c1', { ...CONTACT });
  originalLocation = window.location;
  originalOpen = window.open;
  delete window.location;
  window.location = { href: '' };
  window.open = vi.fn();
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  window.location = originalLocation;
  window.open = originalOpen;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('executeSendAction, email: a mail-client handoff is never treated as a confirmed send', () => {
  it('Gmail not connected (mailto): no Awaiting Reply, no follow-up clock, no sent record', async () => {
    const result = await executeSendAction({
      channel: CHANNELS.EMAIL, userId: UID, contact: CONTACT,
      subject: 'Hi', body: CONTENT,
    });

    expect(result.result).toBe(SEND_RESULT.OPENED);
    expect(updateContactStatus).not.toHaveBeenCalled();
    const saved = get('c1');
    expect(saved.next_step_due).toBeUndefined();
    expect(saved.engagement_summary).toBeUndefined();
    // The activity log still records what actually happened — just not as a send.
    expect(saved.activity_log[0].type).toBe('email_opened');
    expect(saved.activity_log[0].method).toBe('native');
  });

  it('a real Gmail send still moves the contact to Awaiting Reply and sets the follow-up clock', async () => {
    put('c1', { ...CONTACT });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, gmailMessageId: 'm1', gmailThreadId: 't1', sentAt: '2026-11-04T00:00:00.000Z' }),
    })));
    // Gmail must read as connected for resolveSendMethod to choose the real path.
    put('c1', { ...CONTACT });
    store.docs.set(`users/${UID}/integrations/gmail`, { status: 'connected', email: 'me@idynify.com' });

    const result = await executeSendAction({
      channel: CHANNELS.EMAIL, userId: UID, contact: CONTACT,
      subject: 'Hi', body: CONTENT,
    });

    expect(result.result).toBe(SEND_RESULT.SENT);
    expect(updateContactStatus).toHaveBeenCalledTimes(1);
    expect(updateContactStatus).toHaveBeenCalledWith(expect.objectContaining({ contactId: 'c1' }));
    const saved = get('c1');
    expect(saved.next_step_due).toBeDefined();
    expect(saved.engagement_summary.total_messages_sent).toBe(1);
  });

  it('a failed Gmail send does not move the contact to Awaiting Reply either', async () => {
    store.docs.set(`users/${UID}/integrations/gmail`, { status: 'connected', email: 'me@idynify.com' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'quota' }) })));

    const result = await executeSendAction({
      channel: CHANNELS.EMAIL, userId: UID, contact: CONTACT,
      subject: 'Hi', body: CONTENT,
    });

    expect(result.result).toBe(SEND_RESULT.FAILED);
    expect(updateContactStatus).not.toHaveBeenCalled();
  });
});

describe('executeSendAction, other channels: Opened is unaffected — it is their only terminal state', () => {
  it('text (SMS handoff) still moves the contact to Awaiting Reply', async () => {
    const result = await executeSendAction({ channel: CHANNELS.TEXT, userId: UID, contact: CONTACT, body: CONTENT });
    expect(result.result).toBe(SEND_RESULT.OPENED);
    expect(updateContactStatus).toHaveBeenCalledTimes(1);
    expect(get('c1').next_step_due).toBeDefined();
  });

  it('call (dialer handoff) still moves the contact to Awaiting Reply', async () => {
    const result = await executeSendAction({ channel: CHANNELS.CALL, userId: UID, contact: CONTACT });
    expect(result.result).toBe(SEND_RESULT.OPENED);
    expect(updateContactStatus).toHaveBeenCalledTimes(1);
  });

  it('LinkedIn (native handoff) still moves the contact to Awaiting Reply', async () => {
    const result = await executeSendAction({ channel: CHANNELS.LINKEDIN, userId: UID, contact: CONTACT, body: CONTENT });
    expect(result.result).toBe(SEND_RESULT.OPENED);
    expect(updateContactStatus).toHaveBeenCalledTimes(1);
  });
});
