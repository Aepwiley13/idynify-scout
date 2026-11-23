/**
 * DailyLeads must never render QUEUE EMPTY while a search is in flight.
 *
 * barryState === 'SEARCHING' on the user doc means search-companies is still
 * running. DailyLeads must read that state and render a searching indicator
 * instead of the completed-empty-queue state.
 *
 * Asserted against source because DailyLeads mounts the entire Scout queue
 * with Firestore, auth, and navigation context — same precedent as
 * dailyDiscoveriesIcpTargeting.test.js.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../pages/Scout/DailyLeads.jsx'), 'utf8');

describe('DailyLeads — barrySearching state', () => {
  it('declares barrySearching state', () => {
    expect(source).toMatch(/\bbarrySearching\b/);
    expect(source).toMatch(/\bsetBarrySearching\b/);
    expect(source).toMatch(/useState\(false\)/);
  });

  it('reads barryState from the user doc', () => {
    expect(source).toMatch(/barryState/);
    expect(source).toMatch(/['"]SEARCHING['"]/);
  });

  // #006.1: the searching / empty / failed copy moved into DiscoveryStatusPanel,
  // driven by describeDiscovery(). The guarantees below are the same ones this
  // file always held; the state rules themselves are covered in discoveryStatus.test.jsx.
  it('renders the status panel with SEARCHING whenever barrySearching is true', () => {
    expect(source).toMatch(/<DiscoveryStatusPanel/);
    expect(source).toMatch(/barryState: barrySearching \? 'SEARCHING' : discoveryState\.barryState/);
  });

  it('a searching status can never read as an empty queue, and offers no new search', async () => {
    const { describeDiscovery, STATUS } = await import('../utils/discoveryStatus');
    const s = describeDiscovery({ barryState: 'SEARCHING', queueLength: 0 });
    expect(s.kind).toBe(STATUS.SEARCHING);
    expect(s.action).not.toBe('retry');
    expect(s.title).not.toMatch(/empty|no companies/i);
  });

  it('shows a loading indicator during the searching state', () => {
    const panel = readFileSync(resolve(here, '../components/scout/DiscoveryStatusPanel.jsx'), 'utf8');
    expect(panel).toMatch(/status\.kind === STATUS\.SEARCHING/);
    expect(panel).toMatch(/<Loader/);
  });
});

describe('DailyLeads — barryState lifecycle coverage', () => {
  it('checks barryState in loadTodayLeads before loading companies', () => {
    const loadFnStart = source.indexOf('const loadTodayLeads');
    const reconConfStart = source.indexOf('Load RECON confidence', loadFnStart);
    const barryStateRead = source.indexOf('barryState', loadFnStart);

    expect(barryStateRead).toBeGreaterThan(loadFnStart);
    expect(barryStateRead).toBeLessThan(reconConfStart);
  });

  it('reads from the users/{uid} doc, not the bridge', () => {
    const loadFnStart = source.indexOf('const loadTodayLeads');
    const loadFnWindow = source.slice(loadFnStart, loadFnStart + 600);
    expect(loadFnWindow).toMatch(/getDoc\(doc\(db,\s*'users',\s*user\.uid\)\)/);
  });
});
