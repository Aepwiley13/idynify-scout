/**
 * An ICP's persona belongs to that ICP — no surface may borrow another's.
 *
 * THE BUG THIS CLOSES
 * ───────────────────
 * Two Daily Discoveries surfaces read their target titles from the
 * `companyProfile/current` bridge document:
 *
 *   handleSwipe     → titles for the post-accept auto contact search
 *   loadPeopleMode  → titles for the People tab search
 *
 * The bridge is a projection of whichever ICP was last made active GLOBALLY.
 * The tab strip, meanwhile, lets a user swipe under any ICP they like. So a
 * swipe under ICP B searched Apollo for ICP A's titles and stamped ICP A's
 * titles onto the company as `selected_titles` — with no error, and no way to
 * tell afterwards which persona had actually been used.
 *
 * `resolveActiveIcp`'s own contract already stated the rule that was being
 * broken: the bridge "is a projection; it is not an identity source."
 *
 * Both surfaces now resolve through `resolveSearchIcp`, the same helper that
 * already decides which ICP a search launched from this screen belongs to.
 *
 * ─── WHY THIS IS ASSERTED AGAINST THE SOURCE ──────────────────────────────
 * The precedent is dailyDiscoveriesIcpTargeting.test and
 * icpIdentityInvariants.test: rendering this surface mounts the entire Scout
 * queue and opens Firestore connections, and what matters here is a property
 * of the code — no call site reads persona criteria from the bridge — not the
 * behaviour of one rendered instance. A new call site added without the
 * resolver is exactly the regression this catches.
 *
 * The resolver's own behaviour (that it never hands back a non-selected ICP,
 * and never substitutes a default or a candidate) is covered behaviourally in
 * resolveActiveIcp.test.js. Together those two facts are what make "ICP A
 * cannot pull ICP B's persona criteria" true.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');

/** Source with comments removed — a comment may name the thing the code must not do. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** The body of a function, by brace matching from its declaration. */
function bodyOf(src, marker) {
  const at = src.indexOf(marker);
  if (at === -1) return null;
  const open = src.indexOf('{', at);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}

const DAILY_LEADS = '../pages/Scout/DailyLeads.jsx';
const src = code(read(DAILY_LEADS));

describe('the persona a search uses comes from the ICP, not the bridge', () => {
  it('Daily Discoveries never READS companyProfile/current', () => {
    // Writes are fine — the bridge is still projected for the surfaces that
    // consume it. Reading it as a source of targeting criteria is the bug.
    //
    // Checked by requiring every mention of the bridge path to sit inside a
    // setDoc(). That catches the two-step form the original bug actually used
    //     const ref = doc(db, …, 'companyProfile', 'current');
    //     const snap = await getDoc(ref);
    // which a `getDoc(doc(…))` pattern match would walk straight past.
    const mentions = [...src.matchAll(/'companyProfile',\s*'current'/g)];
    const nonWrites = mentions
      .map(m => ({ at: m.index, before: src.slice(Math.max(0, m.index - 80), m.index) }))
      .filter(m => !/setDoc\(/.test(m.before))
      .map(m => src.slice(Math.max(0, m.at - 80), m.at + 40).trim());

    expect(nonWrites, 'the bridge is being read, not just projected').toEqual([]);
  });

  it.each([
    ['the post-accept auto contact search', 'const handleSwipe = async (', 'icpTitles'],
    ['the People tab search', 'const loadPeopleMode = async (', 'titles'],
  ])('%s resolves its titles through resolveSearchIcp', (_label, marker, variable) => {
    const body = bodyOf(src, marker);
    expect(body, `${marker} not found — did it get renamed?`).toBeTruthy();

    // The titles variable is assigned from a resolved ICP profile…
    const assignment = new RegExp(
      `const ${variable}\\s*=\\s*\\w+\\.profile\\?\\.targetTitles\\s*\\?{0,2}\\|{0,2}\\s*\\[\\]`,
    );
    expect(body, `${variable} is not derived from a resolved ICP profile`).toMatch(assignment);

    // …and that profile came from resolveSearchIcp, not from anywhere else.
    expect(body, `${marker} does not call resolveSearchIcp`).toMatch(/await resolveSearchIcp\(/);
    expect(body, `${marker} still touches the bridge`).not.toMatch(/'companyProfile'/);
  });

  it('fails closed — no ICP resolved means no titles, never a fallback persona', () => {
    for (const marker of ['const handleSwipe = async (', 'const loadPeopleMode = async (']) {
      const body = bodyOf(src, marker);
      // Nothing may substitute a default, a candidate, or the first profile.
      expect(body, `${marker} substitutes a stand-in ICP`).not.toMatch(/candidates\s*\[\s*0\s*\]/);
      expect(body, `${marker} substitutes a stand-in ICP`).not.toMatch(/icpList\s*\[\s*0\s*\]/);
      expect(body, `${marker} references a default ICP id`).not.toMatch(/DEFAULT_ICP_ID/);
    }
  });

  it('every searchPeople call sends titles that came from a resolved ICP', () => {
    const calls = [...src.matchAll(/'\/\.netlify\/functions\/searchPeople'/g)];
    expect(calls.length, 'expected the two known searchPeople call sites').toBeGreaterThan(0);

    for (const call of calls) {
      // The `titles:` argument in the request body must be one of the two
      // resolver-derived variables, not an inline read of anything else.
      const window = src.slice(call.index, call.index + 500);
      // `titles: icpTitles` at one call site, ES6 shorthand `titles,` at the other.
      const named = window.match(/titles:\s*([A-Za-z_$][\w$]*)/);
      const shorthand = /[{,]\s*titles\s*[,}]/.test(window) ? 'titles' : null;
      const sent = named?.[1] ?? shorthand;
      expect(sent, 'searchPeople called without a titles argument').toBeTruthy();
      expect(
        ['icpTitles', 'titles', 'targetTitles'],
        `searchPeople sends "${sent}", which is not a resolver-derived titles variable`,
      ).toContain(sent);
    }
  });

  it('the resolver contract still forbids the bridge as an identity source', () => {
    // If this line is ever softened, the rule above loses its foundation.
    expect(read('../utils/resolveActiveIcp.js'))
      .toMatch(/Never reads companyProfile\/current/);
  });
});
