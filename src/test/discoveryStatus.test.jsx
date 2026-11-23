/**
 * #006.1 — Daily Discoveries tells searching, found, no new matches, all
 * reviewed, failed, still-working and unknown apart, from existing data only.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describeDiscovery, RUN, STATUS } from '../utils/discoveryStatus';
import DiscoveryStatusPanel from '../components/scout/DiscoveryStatusPanel';

const here = dirname(fileURLToPath(import.meta.url));
const d = (o) => describeDiscovery({ queueLength: 0, ...o });

describe('describeDiscovery: stored status (users/{uid}.barryState)', () => {
  it('SEARCHING → searching, with "check" (never a new search)', () => {
    const s = d({ barryState: 'SEARCHING' });
    expect(s.kind).toBe(STATUS.SEARCHING);
    expect(s.action).toBe('check');
  });
  it('ERROR → failed with retry — not an empty queue', () => {
    const s = d({ barryState: 'ERROR' });
    expect(s.kind).toBe(STATUS.FAILED);
    expect(s.action).toBe('retry');
    expect(s.title).not.toMatch(/empty|no companies/i);
  });
  it('READY with 0 found → no new matches (with a way to adjust targeting)', () => {
    const s = d({ barryState: 'READY', companiesFoundCount: 0 });
    expect(s.kind).toBe(STATUS.NO_NEW_MATCHES);
    expect(s.secondary).toBe('icp');
  });
  it('READY with companies found but none left → all reviewed (not "failed", not "no matches")', () => {
    expect(d({ barryState: 'READY', companiesFoundCount: 12 }).kind).toBe(STATUS.ALL_REVIEWED);
  });
  it('READY without a count, or no status at all → unknown, not a guess', () => {
    expect(d({ barryState: 'READY' }).kind).toBe(STATUS.UNKNOWN);
    expect(d({}).kind).toBe(STATUS.UNKNOWN);
    expect(d({ barryState: 'NEEDS_TARGETING' }).kind).toBe(STATUS.UNKNOWN);
  });
  it('companies waiting → nothing to explain', () => {
    expect(d({ barryState: 'READY', companiesFoundCount: 3, queueLength: 3 }).kind).toBe(STATUS.HAS_COMPANIES);
  });
});

describe("describeDiscovery: this page's own search outranks the stored status", () => {
  it('running → searching, even if the stored status says ERROR', () => {
    expect(d({ barryState: 'ERROR', lastRun: { kind: RUN.RUNNING } }).kind).toBe(STATUS.SEARCHING);
  });
  it('request failed → failed, even if the stored status is READY', () => {
    expect(d({ barryState: 'READY', companiesFoundCount: 4, lastRun: { kind: RUN.FAILED } }).kind).toBe(STATUS.FAILED);
  });
  it('request timed out → still working with "check", not failed and not retry', () => {
    const s = d({ lastRun: { kind: RUN.TIMEOUT } });
    expect(s.kind).toBe(STATUS.STILL_WORKING);
    expect(s.action).toBe('check');
  });
  it('success with new companies → found (loading them)', () => {
    expect(d({ lastRun: { kind: RUN.ADDED, added: 5 } }).kind).toBe(STATUS.FOUND);
  });
  it('success with nothing new → no new matches', () => {
    expect(d({ barryState: 'READY', companiesFoundCount: 9, lastRun: { kind: RUN.NONE } }).kind).toBe(STATUS.NO_NEW_MATCHES);
  });
});

describe('DiscoveryStatusPanel', () => {
  const T = { textMuted: '#555', text: '#111', border: '#ddd' };
  const panel = (status, props = {}) => render(<DiscoveryStatusPanel status={status} T={T} onRetry={vi.fn()} onCheck={vi.fn()} onEditIcp={vi.fn()} {...props} />);

  it('failed: announced as an alert, and "Try again" runs the existing search', () => {
    const onRetry = vi.fn();
    panel(d({ barryState: 'ERROR' }), { onRetry });
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('searching: a status, with "Check for results" (re-read) and no retry', () => {
    const onRetry = vi.fn(); const onCheck = vi.fn();
    panel(d({ barryState: 'SEARCHING' }), { onRetry, onCheck });
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Try again|Search again|Find/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Check for results/ }));
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('no new matches: "Search again" and "Adjust targeting"', () => {
    const onRetry = vi.fn(); const onEditIcp = vi.fn();
    panel(d({ barryState: 'READY', companiesFoundCount: 0 }), { onRetry, onEditIcp });
    fireEvent.click(screen.getByRole('button', { name: /Search again/ }));
    fireEvent.click(screen.getByRole('button', { name: /Adjust targeting/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onEditIcp).toHaveBeenCalledTimes(1);
  });

  it('while a search is in flight the button is disabled, so it cannot start a second one', () => {
    const onRetry = vi.fn();
    panel(d({ barryState: 'ERROR' }), { onRetry, busy: true });
    const btn = screen.getByRole('button', { name: /Try again/ });
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onRetry).not.toHaveBeenCalled();
  });
});

describe('Daily Discoveries wiring (source contract: the page mounts Firestore, auth and the full queue)', () => {
  const src = readFileSync(resolve(here, '../pages/Scout/DailyLeads.jsx'), 'utf8');

  it('reads companiesFoundCount with barryState from the same user doc', () => {
    expect(src).toMatch(/setDiscoveryState\(\{\s*barryState: barryState \?\? null,\s*companiesFoundCount:/);
  });
  it('records every outcome of its own search', () => {
    for (const k of ['RUNNING', 'ADDED', 'FULL', 'NONE', 'FAILED', 'TIMEOUT']) expect(src).toContain(`RUN.${k}`);
  });
  it('retry is the existing search, which refuses to start while one is running', () => {
    expect(src).toMatch(/onRetry=\{handleManualRefresh\}/);
    expect(src).toMatch(/const handleManualRefresh = async \(\) => \{\s*const user = getEffectiveUser\(\);\s*if \(!user \|\| isRefreshing\) return;/);
  });
  it('"check" re-reads status and queue and never calls the search function', () => {
    const body = src.slice(src.indexOf('const checkDiscovery = async'), src.indexOf('const checkDiscoveryRef'));
    expect(body).toMatch(/loadTodayLeads\(\)/);
    expect(body).not.toMatch(/search-companies|handleManualRefresh/);
  });
  it('looks again on tab focus only while a search is pending — no timers', () => {
    expect(src).toMatch(/const awaitingSearch = barrySearching \|\| lastRun\?\.kind === RUN\.TIMEOUT;/);
    expect(src).toMatch(/addEventListener\('visibilitychange'/);
  });
});
