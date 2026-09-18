/**
 * alertOps — the signal has to leave the process.
 *
 * daily-leads-refresh already returned 207, already logged
 * discovery.scheduled.partial_failure, already named every failing user. It
 * did all of that for 17 consecutive broken runs and nobody found out, because
 * nothing carried the signal past the function boundary.
 *
 * So the tests here are about the boundary, not the formatting:
 *
 *   - it sends when a job reports failure, to the configured address
 *   - it NEVER throws, whatever Resend or Firestore does — an alerting
 *     failure must not turn a partial failure into a total one
 *   - unset config is silence, not a crash
 *   - a job that fails every 5 minutes does not send 288 emails a day
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { alertOps, __testing } from '../../netlify/functions/utils/alertOps.js';

const OK = { ok: true, status: 200 };

function fakeDb({ lastAlertAtMs = null, readThrows = false } = {}) {
  const set = vi.fn(async () => {});
  return {
    set,
    collection: () => ({
      doc: () => ({
        get: async () => {
          if (readThrows) throw new Error('firestore unavailable');
          return {
            exists: lastAlertAtMs !== null,
            data: () => ({ lastAlertAtMs }),
          };
        },
        set,
      }),
    }),
  };
}

let errSpy;
beforeEach(() => {
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.RESEND_API_KEY = 'test_key';
  process.env.OPS_ALERT_EMAIL = 'ops@example.com';
  global.fetch = vi.fn(async () => OK);
});
afterEach(() => {
  errSpy.mockRestore();
  delete process.env.RESEND_API_KEY;
  delete process.env.OPS_ALERT_EMAIL;
  vi.unstubAllGlobals();
});

const base = {
  job: 'daily-leads-refresh',
  severity: 'partial_failure',
  summary: '17 of 17 users failed their daily refresh.',
  detail: { usersFailed: 17, firstError: 'projectId is not defined' },
};

describe('alertOps sends', () => {
  it('posts to Resend with the job, severity and detail', async () => {
    const res = await alertOps(base);

    expect(res.sent).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe(__testing.RESEND_ENDPOINT);
    expect(init.headers.Authorization).toBe('Bearer test_key');

    const body = JSON.parse(init.body);
    expect(body.to).toBe('ops@example.com');
    expect(body.subject).toBe('[PARTIAL FAILURE] daily-leads-refresh');
    expect(body.html).toContain('17 of 17 users failed');
    expect(body.html).toContain('projectId is not defined');
  });

  it('labels a total failure differently from a partial one', async () => {
    await alertOps({ ...base, severity: 'failed' });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.subject).toBe('[FAILED] daily-leads-refresh');
  });

  it('escapes detail values rather than injecting them into the HTML', async () => {
    await alertOps({ ...base, detail: { error: '<script>alert(1)</script>' } });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.html).not.toContain('<script>');
    expect(body.html).toContain('&lt;script&gt;');
  });
});

describe('alertOps never breaks its caller', () => {
  it('returns rather than throws when fetch rejects', async () => {
    global.fetch = vi.fn(async () => { throw new Error('network down'); });
    await expect(alertOps(base)).resolves.toEqual({ sent: false, reason: 'threw' });
  });

  it('returns rather than throws when Resend responds non-ok', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 422 }));
    await expect(alertOps(base)).resolves.toEqual({ sent: false, reason: 'resend_422' });
  });

  it('is silent, not fatal, when no API key is configured', async () => {
    delete process.env.RESEND_API_KEY;
    await expect(alertOps(base)).resolves.toEqual({ sent: false, reason: 'no_resend_key' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('is silent, not fatal, when no recipient is configured', async () => {
    delete process.env.OPS_ALERT_EMAIL;
    await expect(alertOps(base)).resolves.toEqual({ sent: false, reason: 'no_ops_alert_email' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('alertOps cooldown', () => {
  it('suppresses a repeat inside the window', async () => {
    const db = fakeDb({ lastAlertAtMs: Date.now() - 60_000 });
    const res = await alertOps({ ...base, db });

    expect(res).toEqual({ sent: false, reason: 'cooldown' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends again once the window has passed', async () => {
    const db = fakeDb({ lastAlertAtMs: Date.now() - (__testing.COOLDOWN_MS + 1000) });
    const res = await alertOps({ ...base, db });

    expect(res.sent).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('sends when the job has never alerted before', async () => {
    const res = await alertOps({ ...base, db: fakeDb() });
    expect(res.sent).toBe(true);
  });

  // A five-minute cron failing all day must not become 288 emails. One alert,
  // then quiet until the window expires.
  it('turns a run of failures into one email, not one per run', async () => {
    let lastAlertAtMs = null;
    const db = {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: lastAlertAtMs !== null, data: () => ({ lastAlertAtMs }) }),
          set: async (d) => { lastAlertAtMs = d.lastAlertAtMs; },
        }),
      }),
    };

    for (let i = 0; i < 12; i++) {
      await alertOps({ ...base, job: 'process-barry-inbox-queue', db });
    }
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('fails open — a broken cooldown read still lets the alert through', async () => {
    // A duplicate email is a nuisance; a suppressed one is the original bug.
    const res = await alertOps({ ...base, db: fakeDb({ readThrows: true }) });
    expect(res.sent).toBe(true);
  });
});
