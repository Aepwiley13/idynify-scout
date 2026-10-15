/**
 * The Relationship Capture rollout switches (architecture section 24).
 *
 * The mode fails safe: only the exact values off / internal / beta / on count,
 * and anything else is off. Access follows the mode, and the resolver reads
 * only what the mode needs.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  CAPTURE_MODES, ENROLLMENT_COLLECTION, ENROLLED_STAGE,
  captureMode, switchOn, decideCaptureAccess, isEnrolled, resolveCaptureConfig,
} from '../../netlify/functions/utils/captureFlags.js';

describe('captureMode fails safe to off', () => {
  it.each(['off', 'internal', 'beta', 'on'])('accepts %s exactly', (value) => {
    expect(captureMode({ CAPTURE_MODE: value })).toBe(value);
  });

  it.each([
    ['unset', undefined], ['empty', ''], ['upper case', 'ON'], ['mixed case', 'Beta'],
    ['leading space', ' on'], ['trailing space', 'on '], ['newline', 'on\n'],
    ['true', 'true'], ['1', '1'], ['enabled', 'enabled'], ['live', 'live'], ['prod', 'production'],
  ])('%s means off', (_, value) => {
    expect(captureMode(value === undefined ? {} : { CAPTURE_MODE: value })).toBe(CAPTURE_MODES.OFF);
  });

  it('reads process.env by default', () => {
    vi.stubEnv('CAPTURE_MODE', 'beta');
    try {
      expect(captureMode()).toBe('beta');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('switchOn', () => {
  it('is on only for the exact value "on"', () => {
    expect(switchOn('on')).toBe(true);
    for (const value of [undefined, '', 'off', 'ON', 'On', ' on', 'true', '1', 'yes']) {
      expect(switchOn(value), String(value)).toBe(false);
    }
  });
});

describe('decideCaptureAccess', () => {
  const cases = [
    // mode,      isAdmin, enrolled, expected
    ['off',       false,   false,    false],
    ['off',       true,    true,     false],
    ['internal',  false,   false,    false],
    ['internal',  false,   true,     false],
    ['internal',  true,    false,    true],
    ['beta',      false,   false,    false],
    ['beta',      false,   true,     true],
    ['beta',      true,    false,    true],
    ['on',        false,   false,    true],
    ['bogus',     true,    true,     false],
  ];
  it.each(cases)('mode %s, admin %s, enrolled %s → %s', (mode, isAdmin, enrolled, expected) => {
    expect(decideCaptureAccess({ mode, isAdmin, enrolled })).toBe(expected);
  });

  it('treats truthy non-booleans as false', () => {
    expect(decideCaptureAccess({ mode: 'internal', isAdmin: 'yes' })).toBe(false);
    expect(decideCaptureAccess({ mode: 'beta', enrolled: 1 })).toBe(false);
  });
});

function enrollmentDb(entries = {}) {
  return {
    collection: (name) => ({
      doc: (id) => ({
        get: async () => {
          const data = name === ENROLLMENT_COLLECTION ? entries[id] : undefined;
          return { exists: data !== undefined, data: () => data };
        },
      }),
    }),
  };
}

describe('isEnrolled', () => {
  it('is true only for a capture_enrollment document with stage beta', async () => {
    const db = enrollmentDb({ in: { stage: ENROLLED_STAGE }, other: { stage: 'internal' }, blank: {} });
    expect(await isEnrolled(db, 'in')).toBe(true);
    expect(await isEnrolled(db, 'other')).toBe(false);
    expect(await isEnrolled(db, 'blank')).toBe(false);
    expect(await isEnrolled(db, 'missing')).toBe(false);
  });
});

describe('resolveCaptureConfig', () => {
  const deps = (admin = false, enrolledUser = false) => ({
    isAdmin: vi.fn(async () => admin),
    enrolled: vi.fn(async () => enrolledUser),
  });

  it('off: disabled, and nothing is read', async () => {
    const d = deps(true, true);
    expect(await resolveCaptureConfig('u1', { env: { CAPTURE_WITNESS: 'on', CAPTURE_REPORTS: 'on' }, ...d }))
      .toEqual({ enabled: false, stage: null, witnessEnabled: false, reportEnabled: false });
    expect(d.isAdmin).not.toHaveBeenCalled();
    expect(d.enrolled).not.toHaveBeenCalled();
  });

  it('on: enabled for everyone, and nothing is read', async () => {
    const d = deps();
    expect(await resolveCaptureConfig('u1', { env: { CAPTURE_MODE: 'on' }, ...d }))
      .toEqual({ enabled: true, stage: 'on', witnessEnabled: false, reportEnabled: false });
    expect(d.isAdmin).not.toHaveBeenCalled();
    expect(d.enrolled).not.toHaveBeenCalled();
  });

  it('internal: admins only, enrollment never read', async () => {
    const admin = deps(true, false);
    expect((await resolveCaptureConfig('u1', { env: { CAPTURE_MODE: 'internal' }, ...admin })).enabled).toBe(true);
    const enrolledOnly = deps(false, true);
    expect((await resolveCaptureConfig('u1', { env: { CAPTURE_MODE: 'internal' }, ...enrolledOnly })).enabled).toBe(false);
    expect(enrolledOnly.enrolled).not.toHaveBeenCalled();
    expect(admin.isAdmin).toHaveBeenCalledWith('u1');
  });

  it('beta: admins, or enrolled users; enrollment read only for non-admins', async () => {
    const admin = deps(true, false);
    expect((await resolveCaptureConfig('u1', { env: { CAPTURE_MODE: 'beta' }, ...admin })).enabled).toBe(true);
    expect(admin.enrolled).not.toHaveBeenCalled();

    const enrolledUser = deps(false, true);
    expect(await resolveCaptureConfig('u2', { env: { CAPTURE_MODE: 'beta' }, ...enrolledUser }))
      .toEqual({ enabled: true, stage: 'beta', witnessEnabled: false, reportEnabled: false });
    expect(enrolledUser.enrolled).toHaveBeenCalledWith('u2');

    const neither = deps(false, false);
    expect((await resolveCaptureConfig('u3', { env: { CAPTURE_MODE: 'beta' }, ...neither })).enabled).toBe(false);
  });

  it('witness and report switches follow their env only when capture is enabled', async () => {
    const env = { CAPTURE_MODE: 'internal', CAPTURE_WITNESS: 'on', CAPTURE_REPORTS: 'on' };
    expect(await resolveCaptureConfig('u1', { env, ...deps(true) }))
      .toEqual({ enabled: true, stage: 'internal', witnessEnabled: true, reportEnabled: true });
    expect(await resolveCaptureConfig('u1', { env, ...deps(false) }))
      .toEqual({ enabled: false, stage: null, witnessEnabled: false, reportEnabled: false });
    expect(await resolveCaptureConfig('u1', { env: { ...env, CAPTURE_WITNESS: 'ON', CAPTURE_REPORTS: 'true' }, ...deps(true) }))
      .toMatchObject({ witnessEnabled: false, reportEnabled: false });
  });

  it('propagates a failed admin check instead of guessing', async () => {
    const failing = { isAdmin: async () => { throw new Error('firestore down'); }, enrolled: async () => true };
    await expect(resolveCaptureConfig('u1', { env: { CAPTURE_MODE: 'beta' }, ...failing })).rejects.toThrow('firestore down');
  });
});
