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

  it('renders a searching state when barrySearching is true', () => {
    expect(source).toMatch(/barrySearching\s*\?/);
    expect(source).toMatch(/BARRY IS SEARCHING/);
  });

  it('QUEUE EMPTY only renders when barrySearching is false (else branch)', () => {
    const barryTernary = source.indexOf('barrySearching ?');
    const queueEmptyBlock = source.indexOf('QUEUE EMPTY');
    expect(barryTernary).toBeGreaterThan(-1);
    expect(queueEmptyBlock).toBeGreaterThan(-1);
    const between = source.slice(barryTernary, queueEmptyBlock);
    expect(between).toMatch(/:\s*\(/);
  });

  it('searching state appears before the QUEUE EMPTY fallback in the conditional chain', () => {
    const searchingIdx = source.indexOf('BARRY IS SEARCHING');
    const queueEmptyIdx = source.indexOf('QUEUE EMPTY');
    expect(searchingIdx).toBeGreaterThan(-1);
    expect(queueEmptyIdx).toBeGreaterThan(-1);
    expect(searchingIdx).toBeLessThan(queueEmptyIdx);
  });

  it('does not show Find More Targets button during searching state', () => {
    const searchingStart = source.indexOf('BARRY IS SEARCHING');
    const queueEmptyStart = source.indexOf('QUEUE EMPTY');
    const searchingBlock = source.slice(searchingStart, queueEmptyStart);
    expect(searchingBlock).not.toMatch(/Find More Targets/);
  });

  it('shows a loading indicator during searching state', () => {
    const searchingStart = source.indexOf('BARRY IS SEARCHING');
    const queueEmptyStart = source.indexOf('QUEUE EMPTY');
    const searchingBlock = source.slice(searchingStart, queueEmptyStart);
    expect(searchingBlock).toMatch(/Loader/);
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
