/**
 * WHO acquisition — the one question Barry may ask, and the many ways it must
 * not become a gate.
 *
 * The rule that shapes every test here: a user who never gives a name reaches
 * every First Value branch exactly as one who does. `shouldAsk` is a cue for a
 * single conversational turn, not a precondition.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const setDocMock = vi.fn();

vi.mock('../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (...args) => ({ path: args.slice(1).join('/') }),
  setDoc: (...args) => setDocMock(...args),
}));

const {
  resolveWho,
  rememberName,
  WHO_PROMPT,
  WHO_FROM_AUTH,
  WHO_FROM_STORED,
  WHO_UNKNOWN,
} = await import('../utils/resolveWho');

beforeEach(() => {
  setDocMock.mockReset();
  setDocMock.mockResolvedValue(undefined);
});

describe('resolution order', () => {
  it('prefers the authenticated display identity when it is a real name', () => {
    const who = resolveWho({ displayName: 'Priya' }, { firstName: 'Stale' });

    expect(who).toEqual({ name: 'Priya', source: WHO_FROM_AUTH, shouldAsk: false });
  });

  it('falls back to a stored name — including one Barry acquired earlier', () => {
    const who = resolveWho({ displayName: null }, { firstName: 'Marcus' });

    expect(who.name).toBe('Marcus');
    expect(who.source).toBe(WHO_FROM_STORED);
    expect(who.shouldAsk).toBe(false);
  });

  it.each(['firstName', 'displayName', 'name'])('reads the stored %s field', (field) => {
    expect(resolveWho(null, { [field]: 'Dana' }).name).toBe('Dana');
  });

  it('resolves to unknown when nothing is available', () => {
    expect(resolveWho(null, null)).toEqual({ name: null, source: WHO_UNKNOWN, shouldAsk: true });
  });

  it('matches the current signup reality — email/password accounts have no displayName', () => {
    // Nothing calls updateProfile and there is no social sign-in, so every
    // account the current flow creates arrives here with displayName null.
    const who = resolveWho({ displayName: null, email: 'jordan@example.com' }, {});

    expect(who.shouldAsk).toBe(true);
    expect(who.name).toBeNull();
  });
});

describe('what does not count as a name', () => {
  it.each([
    ['an email in the display slot', 'dana@example.com'],
    ['whitespace only', '   '],
    ['an empty string', ''],
  ])('%s is not a name', (_label, value) => {
    expect(resolveWho({ displayName: value }, {}).name).toBeNull();
  });

  it('falls through to the stored name when the auth value is an email', () => {
    const who = resolveWho({ displayName: 'dana@example.com' }, { firstName: 'Dana' });

    expect(who.name).toBe('Dana');
    expect(who.source).toBe(WHO_FROM_STORED);
  });

  it('trims surrounding whitespace rather than storing it', () => {
    expect(resolveWho(null, { firstName: '  Alex  ' }).name).toBe('Alex');
  });

  it('tolerates a non-string value without throwing', () => {
    expect(() => resolveWho({ displayName: 42 }, { firstName: {} })).not.toThrow();
    expect(resolveWho({ displayName: 42 }, { firstName: {} }).name).toBeNull();
  });
});

describe('asking is a cue, never a gate', () => {
  it('asks at most one question, and it is a question a person can ignore', () => {
    expect(WHO_PROMPT).toBe('What should I call you?');
  });

  it('returns a usable result in every case — no throw, no undefined', () => {
    for (const args of [[null, null], [{}, {}], [undefined, undefined], [{ displayName: '' }, { name: '' }]]) {
      const who = resolveWho(...args);
      expect(who).toHaveProperty('name');
      expect(who).toHaveProperty('shouldAsk');
      expect(typeof who.shouldAsk).toBe('boolean');
    }
  });

  it('never reports a blocked or incomplete state — the shape has no such field', () => {
    const who = resolveWho(null, null);

    expect(who).not.toHaveProperty('complete');
    expect(who).not.toHaveProperty('required');
    expect(who).not.toHaveProperty('blocked');
  });
});

describe('the name survives the session; only the ask-state does not', () => {
  it('round-trips: a name given in one session is known in the next', async () => {
    // Session 1 — nothing known, Barry asks, the user answers.
    const first = resolveWho({ displayName: null }, null);
    expect(first.shouldAsk).toBe(true);

    await rememberName('u1', 'Jordan');
    const [, payload] = setDocMock.mock.calls[0];

    // Session 2 — fresh browser, empty sessionStorage. The user document is
    // what Barry reads, and it is enough.
    const second = resolveWho({ displayName: null }, payload);
    expect(second.name).toBe('Jordan');
    expect(second.shouldAsk).toBe(false);
  });

  it('the stored field is one the app already read before this phase', () => {
    // OnboardingFlow read `data.firstName || data.displayName || data.name`
    // against a producer that never existed. This writes the first of those.
    expect(resolveWho(null, { firstName: 'Jordan' }).name).toBe('Jordan');
  });

  it('if the write fails, the question may return — which is honest', async () => {
    setDocMock.mockRejectedValue(new Error('offline'));
    expect(await rememberName('u1', 'Jordan')).toBe(false);

    // Nothing was stored, so a later session genuinely does not know the name.
    expect(resolveWho({ displayName: null }, null).shouldAsk).toBe(true);
  });
});

describe('remembering a name', () => {
  it('stores it as User-scoped intelligence on the user document', async () => {
    const stored = await rememberName('u1', 'Jordan');

    expect(stored).toBe(true);
    expect(setDocMock).toHaveBeenCalledTimes(1);
    const [ref, payload, options] = setDocMock.mock.calls[0];
    expect(ref.path).toBe('users/u1');
    expect(payload).toEqual({ firstName: 'Jordan' });
    expect(options).toEqual({ merge: true });
  });

  it('writes nothing anywhere else — not RECON, not an ICP', async () => {
    await rememberName('u1', 'Jordan');

    const paths = setDocMock.mock.calls.map(c => c[0].path).join(' ');
    expect(paths).not.toMatch(/icpProfiles|companyProfile|dashboards|modules/);
  });

  it.each([
    ['an empty answer', ''],
    ['whitespace', '   '],
    ['an email', 'jordan@example.com'],
    ['a missing value', null],
  ])('does not store %s', async (_label, value) => {
    expect(await rememberName('u1', value)).toBe(false);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('does not store without a user', async () => {
    expect(await rememberName(null, 'Jordan')).toBe(false);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('a failed write never interrupts the conversation', async () => {
    setDocMock.mockRejectedValue(new Error('permission-denied'));

    await expect(rememberName('u1', 'Jordan')).resolves.toBe(false);
  });
});
