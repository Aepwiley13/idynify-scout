/**
 * The billing launcher's port guard (scripts/staging/stagingPorts.mjs) and its browser check
 * (scripts/staging/stagingBrowser.mjs). The failure they prevent: another server already on the
 * framework port when netlify dev starts, so :8888 proxies to it, the readiness check passes, and
 * every page answers 500 "Could not proxy request." once that server stops.
 */
import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answersOn, portInUse, portHolders, sortHolders, claimPorts, BILLING_VITE_PORT } from '../../scripts/staging/stagingPorts.mjs';
import { launchChromium, browserCheck } from '../../scripts/staging/stagingBrowser.mjs';

const checkout = () => {
  const root = mkdtempSync(join(tmpdir(), 'checkout-'));
  mkdirSync(join(root, 'sub'));
  return root;
};

describe('ports', () => {
  it('Vite gets a port of its own in billing runs, not the 5173 every other npm run dev uses', () => {
    expect(BILLING_VITE_PORT).not.toBe(5173);
    expect(BILLING_VITE_PORT).not.toBe(8888);
  });

  it('answersOn / portInUse: a listening port is in use, a closed one is not', async () => {
    const server = http.createServer((_, res) => res.end('ok'));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    expect(await answersOn(port, '127.0.0.1')).toBe(true);
    expect(await portInUse(port)).toBe(true);
    await new Promise((r) => server.close(r));
    expect(await portInUse(port)).toBe(false);
  });

  it('portInUse checks IPv6 too (macOS binds localhost to ::1)', async () => {
    const asked = [];
    const inUse = await portInUse(5199, { answers: async (port, host) => { asked.push(host); return host === '::1'; } });
    expect(inUse).toBe(true);
    expect(asked).toEqual(['127.0.0.1', '::1']);
  });

  it('portHolders reads lsof and ps, and is null when lsof is missing', () => {
    const exec = (file, args) => {
      if (file === 'lsof' && args[0] === '-nP') return 'p411\nf23\np411\np512\n';
      if (file === 'ps') return args[3] === '411' ? 'node /c/node_modules/.bin/vite --port 5199 --strictPort\n' : 'python3 -m http.server\n';
      if (file === 'lsof' && args[0] === '-a') return args[2] === '411' ? 'p411\nfcwd\nn/c\n' : 'p512\nfcwd\nn/elsewhere\n';
      throw new Error('unexpected');
    };
    expect(portHolders(5199, { exec })).toEqual([
      { pid: 411, command: 'node /c/node_modules/.bin/vite --port 5199 --strictPort', cwd: '/c' },
      { pid: 512, command: 'python3 -m http.server', cwd: '/elsewhere' },
    ]);
    const missing = () => { const e = new Error('spawn lsof ENOENT'); e.code = 'ENOENT'; throw e; };
    expect(portHolders(5199, { exec: missing })).toBeNull();
    const none = (file) => { if (file === 'lsof') { const e = new Error('exit 1'); e.status = 1; e.stdout = ''; throw e; } return ''; };
    expect(portHolders(5199, { exec: none })).toEqual([]);
  });

  it("sortHolders: only this checkout's own vite / netlify / launcher processes are leftovers to stop", () => {
    const root = checkout();
    const { stop, foreign } = sortHolders([
      { pid: 1, command: 'node /x/node_modules/.bin/vite --port 5199 --strictPort', cwd: root },
      { pid: 2, command: 'node /x/node_modules/.bin/netlify dev --offline', cwd: join(root, 'sub') },
      { pid: 3, command: 'node scripts/staging/stagingDev.mjs --env=/e', cwd: root },
      { pid: 4, command: 'node /other/node_modules/.bin/vite', cwd: '/home/me/contact-hub' }, // another checkout
      { pid: 5, command: 'python3 -m http.server 8888', cwd: root }, // not ours, even here
      { pid: 6, command: 'node /x/node_modules/.bin/vite', cwd: null }, // cannot tell
      { pid: 7, command: 'node /x/node_modules/.bin/vite', cwd: `${root}-other` }, // a sibling, not inside
    ], root);
    expect(stop.map((h) => h.pid)).toEqual([1, 2, 3]);
    expect(foreign.map((h) => h.pid)).toEqual([4, 5, 6, 7]);
  });
});

describe('claimPorts', () => {
  const root = checkout();
  const sleep = async () => {};

  it('free ports: nothing stopped, ok', async () => {
    const result = await claimPorts([8888, 5199], root, { inUse: async () => false, holders: () => [], sleep });
    expect(result).toEqual({ ok: true, stopped: [], problems: [] });
  });

  it("stops this checkout's leftover Vite and goes on once the port is free", async () => {
    const busy = new Set([5199]);
    const killed = [];
    const result = await claimPorts([8888, 5199], root, {
      inUse: async (p) => busy.has(p),
      holders: () => [{ pid: 77, command: 'node node_modules/.bin/vite --port 5199 --strictPort', cwd: root }],
      kill: (pid, signal) => { killed.push([pid, signal]); busy.delete(5199); },
      sleep,
    });
    expect(killed).toEqual([[77, 'SIGTERM']]);
    expect(result.ok).toBe(true);
    expect(result.stopped[0]).toContain('pid 77');
  });

  it("refuses, naming it, when another program holds a port, and stops nothing of it (e.g. another checkout's dev server)", async () => {
    const killed = [];
    const result = await claimPorts([8888], root, {
      inUse: async () => true,
      holders: () => [{ pid: 90, command: 'node /home/me/contact-hub/node_modules/.bin/netlify dev', cwd: '/home/me/contact-hub' }],
      kill: (pid) => killed.push(pid),
      sleep,
    });
    expect(killed).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toBe('port 8888 is in use by node /home/me/contact-hub/node_modules/.bin/netlify dev (pid 90, in /home/me/contact-hub), which this launcher did not start and will not stop.');
  });

  it('refuses when the holder cannot be named, or a leftover will not stop', async () => {
    expect((await claimPorts([8888], root, { inUse: async () => true, holders: () => null, sleep })).problems[0]).toContain('install lsof');
    const stuck = await claimPorts([5199], root, {
      inUse: async () => true,
      holders: () => [{ pid: 5, command: 'node node_modules/.bin/vite', cwd: root }],
      kill: () => {},
      sleep,
    });
    expect(stuck.ok).toBe(false);
    expect(stuck.problems).toEqual(["port 5199 is still in use after stopping this checkout's leftovers."]);
  });
});

describe('the browser check', () => {
  // A stand-in for Playwright's browser: enough of its API for browserCheck.
  const fakeBrowser = ({ status = 200, responses = [], failures = [], renders = true } = {}) => {
    const closed = { value: false };
    const browser = {
      closed,
      async newContext(options) {
        browser.contextOptions = options;
        const handlers = {};
        return {
          async newPage() {
            return {
              on: (event, fn) => { handlers[event] = fn; },
              async goto() {
                for (const [url, s] of responses) handlers.response?.({ url: () => url, status: () => s });
                for (const [url, errorText] of failures) handlers.requestfailed?.({ url: () => url, failure: () => ({ errorText }) });
                return { status: () => status };
              },
              locator: () => ({ first: () => ({ waitFor: async () => { if (!renders) throw new Error('Timeout 90000ms exceeded.\nmore'); } }) }),
            };
          },
        };
      },
      async close() { closed.value = true; },
    };
    return browser;
  };

  it('passes when the signup form renders with no 5xx or failed request, in a profile with no service worker', async () => {
    const browser = fakeBrowser({ responses: [['http://localhost:8888/signup', 200], ['https://identitytoolkit.googleapis.com/x', 500]], failures: [['http://localhost:8888/x', 'net::ERR_ABORTED']] });
    const result = await browserCheck({ launch: async () => browser });
    expect(result).toMatchObject({ ok: true, problems: [] });
    expect(browser.contextOptions).toEqual({ serviceWorkers: 'block' });
    expect(browser.closed.value).toBe(true);
  });

  it('fails on "Could not proxy request." (500), a failed request, or a page that never renders', async () => {
    const proxied = await browserCheck({ launch: async () => fakeBrowser({ status: 500, responses: [['http://localhost:8888/signup', 500]] }) });
    expect(proxied.ok).toBe(false);
    expect(proxied.problems).toEqual(['500 for /signup', '/signup answered 500']);
    const failed = await browserCheck({ launch: async () => fakeBrowser({ failures: [['http://localhost:8888/src/main.jsx', 'net::ERR_CONNECTION_RESET']] }) });
    expect(failed.problems).toEqual(['/src/main.jsx failed (net::ERR_CONNECTION_RESET)']);
    const blank = await browserCheck({ launch: async () => fakeBrowser({ renders: false }) });
    expect(blank.problems).toEqual(['/signup did not render: Timeout 90000ms exceeded.']);
  });

  it('is not a pass when no browser can start', async () => {
    const result = await browserCheck({ launch: async () => { throw new Error('No browser for the checks'); } });
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toBe('browser check could not run: No browser for the checks');
  });

  it("launchChromium: Playwright's Chromium, else the installed Google Chrome, else a clear message", async () => {
    const tried = [];
    const pw = (outcomes) => async () => ({
      chromium: { launch: async (o) => { tried.push(o); const next = outcomes.shift(); if (next instanceof Error) throw next; return next; } },
    });
    expect(await launchChromium({ importPlaywright: pw(['bundled']) })).toBe('bundled');
    tried.length = 0;
    expect(await launchChromium({ importPlaywright: pw([new Error("browserType.launch: Executable doesn't exist at /x"), 'chrome']) })).toBe('chrome');
    expect(tried).toEqual([{ headless: true }, { headless: true, channel: 'chrome' }]);
    await expect(launchChromium({ importPlaywright: pw([new Error("Executable doesn't exist"), new Error('Chromium distribution chrome is not found')]) })).rejects.toThrow('npx playwright install chromium');
    await expect(launchChromium({ importPlaywright: async () => { throw new Error('Cannot find package'); } })).rejects.toThrow('npm ci');
  });
});
