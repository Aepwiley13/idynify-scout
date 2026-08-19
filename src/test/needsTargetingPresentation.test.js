/**
 * V-2 — the first-run view must render something honest for NEEDS_TARGETING.
 *
 * Tier 1 added the state so a confirmed ICP carrying no retrieval constraint
 * would stop pretending to search. But FirstRunView keyed its heading and every
 * panel to isSearching/isReady/isError, so the new state produced one correct
 * checklist line and an otherwise empty page.
 *
 * The state is not an error: the ICP exists, nothing failed, and the next step
 * is targeting detail — not a retry. These tests hold that distinction in the
 * presentation as well as the state machine.
 *
 * Asserted against the source: FirstRunView is module-internal and rendering it
 * means mounting Mission Control with its Firestore subscriptions.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../pages/Scout/MissionControlDashboardV2.jsx'), 'utf8');

const firstRunView = (() => {
  const at = source.indexOf('function FirstRunView(');
  const end = source.indexOf('\nfunction ', at + 10);
  return source.slice(at, end === -1 ? source.length : end);
})();

/** The JSX block guarded by `{needsTargeting && (` … `)}`. */
const panel = (() => {
  const at = firstRunView.indexOf('{needsTargeting && (');
  if (at === -1) return '';
  return firstRunView.slice(at, at + 2200);
})();

describe('V-2 — the state is still distinct', () => {
  it('is derived from its own value, not from the absence of others', () => {
    expect(firstRunView).toMatch(/const needsTargeting = barryState === 'NEEDS_TARGETING'/);
  });

  it.each([
    ['ERROR', /const isError = barryState === 'ERROR'/],
    ['READY', /const isReady = barryState === 'READY'/],
    ['SEARCHING', /const isSearching = barryState === 'SEARCHING' \|\| barryState === null/],
  ])('%s keeps its own predicate and cannot absorb NEEDS_TARGETING', (_name, pattern) => {
    expect(firstRunView).toMatch(pattern);
  });

  it('never appears in the same predicate as ERROR, READY or SEARCHING', () => {
    expect(firstRunView).not.toMatch(/'NEEDS_TARGETING'\s*\|\|/);
    expect(firstRunView).not.toMatch(/\|\|\s*barryState === 'NEEDS_TARGETING'/);
  });

  it('carries none of the three resolution reasons — those never reach barryState', () => {
    expect(source).not.toMatch(/barryState[\s\S]{0,80}'no-profiles'/);
    expect(source).not.toMatch(/barryState[\s\S]{0,80}'none-active'/);
    expect(source).not.toMatch(/barryState[\s\S]{0,80}'read-failed'/);
  });
});

describe('V-2 — the status line', () => {
  it('has its own heading arm', () => {
    expect(firstRunView).toMatch(/\{needsTargeting && '[^']+'\}/);
  });

  it('the heading says the ICP exists and does not say anything failed', () => {
    const heading = firstRunView.match(/\{needsTargeting && '([^']+)'\}/)[1];

    expect(heading).toMatch(/ICP/);
    expect(heading).not.toMatch(/problem|failed|error/i);
  });

  it('the progress checklist line is not flagged as an error', () => {
    // `error: isError` — the checklist's error flag must stay bound to isError.
    expect(firstRunView).toMatch(/needsTargeting \? '[^']+'[\s\S]{0,120}error: isError/);
  });
});

describe('V-2 — the rendered body', () => {
  it('renders a panel of its own', () => {
    expect(panel).not.toBe('');
  });

  it('states that the ICP is saved and that a searchable detail is missing', () => {
    expect(panel).toMatch(/ICP is saved/i);
    expect(panel).toMatch(/industry/i);
    expect(panel).toMatch(/location/i);
    expect(panel).toMatch(/company size/i);
  });

  it('explains why job titles do not count', () => {
    expect(panel).toMatch(/titles/i);
  });

  it('is not styled or worded as a failure', () => {
    expect(panel).not.toMatch(/AlertCircle/);
    expect(panel).not.toMatch(/STATUS\.red|#ef4444/);
    expect(panel).not.toMatch(/Try Again/);
    expect(panel).not.toMatch(/ran into a problem/);
  });

  it('routes to the existing targeting path, not a new wizard', () => {
    expect(panel).toMatch(/activeTab: 'icp-settings'/);
  });

  it('does not call the search retry handler', () => {
    expect(panel).not.toMatch(/handleRetry/);
  });
});

describe('V-2 — nothing else changed', () => {
  it('the producer still writes the state on the one condition', () => {
    const onboarding = readFileSync(resolve(here, '../pages/Onboarding/BarryOnboarding.jsx'), 'utf8');
    expect(onboarding).toMatch(/barryState: hasRetrievalConstraint \? 'SEARCHING' : 'NEEDS_TARGETING'/);
  });

  it('no new Barry state was introduced', () => {
    const states = [...source.matchAll(/barryState === '([A-Z_]+)'/g)].map(m => m[1]);
    expect(new Set(states)).toEqual(new Set(['SEARCHING', 'READY', 'ERROR', 'NEEDS_TARGETING']));
  });
});
