/**
 * The non-ok branch, driven through a real cron handler.
 *
 * alertOps.test.js covers the helper in isolation. This covers the wiring: the
 * guard that decides whether to call it at all. Those are different failures —
 * a helper that works perfectly behind an `if` that never fires is exactly the
 * shape of the original bug, where 207 and a named log line were both emitted
 * correctly and reached nobody.
 *
 * process-barry-queue stands in for all five. Every one of them computes the
 * same `allOk = results.failed === 0`, guards the same `if (!allOk)`, and
 * returns the same 200/207 pair, so the branch under test is shared; only the
 * counters and the job name differ.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const alertOps = vi.fn(async () => ({ sent: true }));
vi.mock('../../netlify/functions/utils/alertOps.js', () => ({
  alertOps: (...args) => alertOps(...args),
}));

vi.mock('@netlify/functions', () => ({ schedule: (_cron, handler) => handler }));
vi.mock('../../netlify/functions/utils/engagementPromotion.js', () => ({
  engagementPromotionPatch: () => ({}),
}));

/** Users whose ids appear in `failing` throw when their queue is read. */
let users = [];
let failing = new Set();

function fakeDb() {
  return {
    collection: (name) => {
      if (name !== 'users') return { doc: () => ({ collection: () => emptyQuery() }) };
      return {
        get: async () => ({ docs: users.map((id) => ({ id })) }),
        doc: (userId) => ({
          collection: () => {
            if (failing.has(userId)) {
              return {
                where: () => ({ get: async () => { throw new Error(`queue read failed for ${userId}`); } }),
              };
            }
            return emptyQuery();
          },
        }),
      };
    },
  };
}
function emptyQuery() {
  return { where: () => ({ get: async () => ({ docs: [] }) }) };
}

vi.mock('firebase-admin', () => ({
  default: {
    apps: [{}],
    credential: { cert: () => ({}) },
    initializeApp: vi.fn(),
    firestore: () => fakeDb(),
  },
}));

process.env.FIREBASE_PRIVATE_KEY = 'x';
const { default: handler } = await import('../../netlify/functions/process-barry-queue.js');

let logSpy, errSpy;
beforeEach(() => {
  alertOps.mockClear();
  users = [];
  failing = new Set();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { logSpy.mockRestore(); errSpy.mockRestore(); });

describe('cron → alertOps wiring', () => {
  it('does NOT alert when every user succeeds', async () => {
    users = ['u1', 'u2', 'u3'];

    const res = await handler({}, {});

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
    expect(alertOps).not.toHaveBeenCalled();
  });

  it('does NOT alert on an empty run — an honest zero is still a success', async () => {
    users = [];

    const res = await handler({}, {});

    expect(res.statusCode).toBe(200);
    expect(alertOps).not.toHaveBeenCalled();
  });

  it('alerts on partial failure, with the job, counts and first error', async () => {
    users = ['u1', 'u2', 'u3'];
    failing = new Set(['u2']);

    const res = await handler({}, {});

    expect(res.statusCode).toBe(207);
    expect(JSON.parse(res.body).success).toBe(false);
    expect(alertOps).toHaveBeenCalledTimes(1);

    const call = alertOps.mock.calls[0][0];
    expect(call.job).toBe('process-barry-queue');
    expect(call.severity).toBe('partial_failure');
    expect(call.detail.failed).toBe(1);
    // The message, not just the count — so the email can name a cause.
    expect(call.detail.firstError).toContain('queue read failed for u2');
    // The db handle is passed so the cooldown has somewhere to live.
    expect(call.db).toBeTruthy();
  });

  it('logs the named partial-failure line alongside the alert', async () => {
    users = ['u1'];
    failing = new Set(['u1']);

    await handler({}, {});

    expect(logSpy.mock.calls.some(([m]) => m === 'barryqueue.scheduled.partial_failure')).toBe(true);
  });

  it('logs the named ok line on a clean run', async () => {
    users = ['u1'];

    await handler({}, {});

    expect(logSpy.mock.calls.some(([m]) => m === 'barryqueue.scheduled.ok')).toBe(true);
  });
});
