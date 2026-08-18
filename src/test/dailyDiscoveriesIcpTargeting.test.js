/**
 * Every Daily Discoveries search must name the ICP it is searching for — #565.
 *
 * search-companies tags every company it writes with `icpId || DEFAULT_ICP_ID`
 * (search-companies.js), and the queue filters with
 * `!c.icpId || c.icpId === activeId` (DailyLeads.jsx). A request that omits
 * icpId therefore writes companies into the default bucket, where any user
 * whose active ICP is not the default can never see them — Apollo credits and
 * Firestore writes spent on results that are invisible.
 *
 * Two call paths did exactly that: triggerAdaptiveSearch after a batch of
 * saves, and the ICP reclarification modal. Both ran with an active ICP in
 * scope and neither passed it.
 *
 * This is asserted against the source rather than by rendering DailyLeads,
 * which mounts the entire Scout queue. The precedent is moduleMigration.test —
 * a second copy of a value drifting from the first is exactly the failure this
 * guards, and reading the source catches a new call site added without icpId.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../pages/Scout/DailyLeads.jsx'), 'utf8');

/** Each fetch to search-companies, with the request body that accompanies it. */
function searchCompaniesCalls(src) {
  const calls = [];
  const marker = "'/.netlify/functions/search-companies'";
  let from = 0;
  for (;;) {
    const at = src.indexOf(marker, from);
    if (at === -1) break;
    // The body follows within the same fetch call; take a generous window and
    // stop at the closing of the options object.
    const window = src.slice(at, at + 700);
    const bodyAt = window.indexOf('JSON.stringify(');
    calls.push({
      index: at,
      line: src.slice(0, at).split('\n').length,
      body: bodyAt === -1 ? '' : window.slice(bodyAt, bodyAt + 400),
    });
    from = at + marker.length;
  }
  return calls;
}

describe('Daily Discoveries — search requests are ICP-scoped', () => {
  const calls = searchCompaniesCalls(source);

  it('finds the search-companies call sites in DailyLeads', () => {
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('every call passes icpId, so results land in the ICP the user is viewing', () => {
    const missing = calls
      .filter(c => !/\bicpId\b/.test(c.body))
      .map(c => `DailyLeads.jsx:${c.line}`);

    expect(missing, `search-companies called without icpId at ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('the post-batch adaptive search sends both icpId and the industry signal', () => {
    const adaptive = calls.find(c => c.body.includes('adaptiveSignals'));

    expect(adaptive, 'no adaptive search call found').toBeDefined();
    expect(adaptive.body).toMatch(/\bicpId\b/);
    expect(adaptive.body).toMatch(/savedIndustries/);
  });

  it('no longer collects person titles for an organisation search', () => {
    expect(source).not.toContain('savedTitles');
  });

  it('the reclarification modal receives the active ICP as a prop', () => {
    expect(source).toMatch(/function IcpReclarificationModal\(\{[^}]*\bicpId\b/);
    expect(source).toMatch(/<IcpReclarificationModal[\s\S]{0,200}icpId=\{activeICPId\}/);
  });
});
