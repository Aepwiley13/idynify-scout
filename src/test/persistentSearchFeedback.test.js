/**
 * #006.3 — the last search outcome stays visible instead of vanishing after
 * 4–6 seconds, and only shows facts the page actually has.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describeLastSearch, RUN } from '../utils/discoveryStatus';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(here, '..', p), 'utf8');
const T = () => '3:41 PM';

describe("describeLastSearch: this page's own search (with the time it finished)", () => {
  it('added → success with the real count and time', () => {
    expect(describeLastSearch({ lastRun: { kind: RUN.ADDED, added: 12, at: 1 }, formatTime: T }))
      .toEqual({ tone: 'success', action: null, text: 'Last search: Barry added 12 new companies · 3:41 PM' });
    expect(describeLastSearch({ lastRun: { kind: RUN.ADDED, added: 1, at: 1 }, formatTime: T }).text).toMatch(/1 new company ·/);
  });
  it('no new companies → info, with "search again"', () => {
    const l = describeLastSearch({ lastRun: { kind: RUN.NONE, at: 1 }, formatTime: T });
    expect([l.tone, l.action]).toEqual(['info', 'retry']);
  });
  it('failed → error, with retry', () => {
    const l = describeLastSearch({ lastRun: { kind: RUN.FAILED, at: 1 }, formatTime: T });
    expect([l.tone, l.action]).toEqual(['error', 'retry']);
    expect(l.text).toMatch(/didn't finish · 3:41 PM/);
  });
  it('timed out → "taking longer", with check (not retry: the server may still finish)', () => {
    expect(describeLastSearch({ lastRun: { kind: RUN.TIMEOUT, at: 1 }, formatTime: T }).action).toBe('check');
  });
  it('running → nothing (the page shows its running message)', () => {
    expect(describeLastSearch({ lastRun: { kind: RUN.RUNNING } })).toBeNull();
  });
});

describe('describeLastSearch: after a reload, only what is stored', () => {
  it('stored ERROR → error with retry, and no time (barryState has no timestamp)', () => {
    const l = describeLastSearch({ barryState: 'ERROR' });
    expect(l.tone).toBe('error');
    expect(l.text).not.toMatch(/·/);
  });
  it('stored READY with a count → that count, no time', () => {
    expect(describeLastSearch({ barryState: 'READY', companiesFoundCount: 7 }).text).toBe("Barry's last search found 7 companies");
  });
  it('nothing reliable → nothing shown', () => {
    expect(describeLastSearch({})).toBeNull();
    expect(describeLastSearch({ barryState: 'READY' })).toBeNull();
    expect(describeLastSearch({ barryState: 'READY', companiesFoundCount: 0 })).toBeNull();
    expect(describeLastSearch({ barryState: 'SEARCHING' })).toBeNull();
  });
});

describe('no more vanishing messages', () => {
  const dl = read('pages/Scout/DailyLeads.jsx');
  const icp = read('pages/Scout/ICPSettings.jsx');

  it('Daily Discoveries no longer clears search outcomes on a timer', () => {
    expect(dl).not.toMatch(/setTimeout\(\(\) => setRefreshMessage\(''\)/);
    expect(dl).not.toMatch(/setTimeout\(\(\) => \{ setRefreshMessage\(''\)/);
    expect(dl).toMatch(/describeLastSearch\(\{ lastRun, \.\.\.discoveryState \}\)/);
  });
  it('its retry and check are the existing actions', () => {
    expect(dl).toMatch(/last\.action === 'retry' \? handleManualRefresh : last\.action === 'check' \? checkDiscovery/);
  });
  it('ICP Settings keeps the refresh result (with its time) until the next refresh', () => {
    expect(icp).not.toMatch(/setTimeout\(\(\) => setRefreshResult\(null\)/);
    expect(icp).toMatch(/currentQueueSize: data\.currentQueueSize \|\| 0, at: Date\.now\(\)/);
    expect(icp).toMatch(/className="header-refresh-error" role="alert"/);
  });
});
