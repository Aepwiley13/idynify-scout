/**
 * Tier 4 — the Composition Invariant, per surface.
 *
 * The invariant is operation-determined, not platform-global (v0.4-amend,
 * Principle 4): a scope required for one operation type is not automatically
 * required for all of them. Appendix B is the authority for which scopes each
 * surface type needs.
 *
 * These tests hold the four Category 1 gaps closed in this tier, and — just as
 * importantly — hold the zero-ICP semantics that Tier 1 established: a
 * relationship-oriented surface is not PARTIAL merely because no ICP exists.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fn = name => readFileSync(resolve(here, `../../netlify/functions/${name}.js`), 'utf8');

const GENERATION_SURFACES = [
  'barryGenerateSequenceStep',
  'barryHunterGenerateStep',
  'barryHunterProcessEngage',
];

describe('User scope reaches the message-generation surfaces', () => {
  it.each(GENERATION_SURFACES)('%s reads communicationStyle', (name) => {
    const src = fn(name);

    expect(src).toMatch(/function userStyleBlock\(dashboardData\)/);
    expect(src).toMatch(/dashboardData\?\.communicationStyle/);
  });

  it.each(GENERATION_SURFACES)('%s reads it from the document it already fetched', (name) => {
    const src = fn(name);

    // The point of this gap being Category 1: no new read was introduced.
    expect(src).toMatch(/userStyleBlock\(dashboardDoc\.data\(\)\)/);
    const dashboardFetches = src.match(/collection\('dashboards'\)\.doc\(userId\)\.get\(\)/g) || [];
    expect(dashboardFetches.length).toBe(1);
  });

  it.each(GENERATION_SURFACES)('%s puts the style into the prompt', (name) => {
    expect(fn(name)).toMatch(/\$\{userStyle\}/);
  });

  it('an absent style contributes nothing rather than a placeholder', () => {
    const src = fn('barryGenerateSequenceStep');
    const at = src.indexOf('function userStyleBlock');
    const body = src.slice(at, src.indexOf('\n}', at));

    expect(body).toMatch(/if \(!style\) return '';/);
  });

  it('barryHunterProcessEngage threads it as a parameter, not across scopes', () => {
    const src = fn('barryHunterProcessEngage');

    expect(src).toMatch(/async function generateStep1Draft\([^)]*userStyle = ''\)/);
    expect(src).toMatch(/daysSinceLastContact, userStyle\s*\n?\s*\);/);
  });
});

describe('The orientation brief receives User and ICP scope', () => {
  const src = fn('barryOrientationBrief');

  it('reads the user communication style already on its dashboard document', () => {
    expect(src).toMatch(/dashboardData\?\.communicationStyle/);
    expect(src).toMatch(/user's chosen communication style/);
  });

  it('resolves the ICP through the canonical contract', () => {
    expect(src).toMatch(/resolveActiveIcp\(db, userId\)/);
    expect(src).toMatch(/import \{ resolveActiveIcp, isResolved \}/);
  });

  it('puts the ICP line into the prompt state block', () => {
    expect(src).toMatch(/- \$\{icpLine\}/);
  });

  it('distinguishes all three unresolved states rather than collapsing them', () => {
    expect(src).toMatch(/'none-active'/);
    expect(src).toMatch(/'read-failed'/);
    expect(src).toMatch(/has not defined a target profile/);
  });

  it('treats a zero-ICP workspace as valid, not as a fault', () => {
    expect(src).toMatch(/do not treat that as a fault or an error/);
  });

  it('never fabricates an ICP identity for the brief', () => {
    expect(src).not.toMatch(/DEFAULT_ICP_ID/);
    expect(src).not.toMatch(/icpId \|\| 'default'/);
  });
});

describe('Zero-ICP semantics survive Tier 4', () => {
  it.each([...GENERATION_SURFACES, 'barryFirstTouch'])(
    '%s still generates without an ICP',
    (name) => {
      const src = fn(name);
      // No surface may hard-fail on a missing ICP: relationship-oriented
      // operations are not ICP-dependent (v0.4-amend, ICP Cardinality).
      expect(src).not.toMatch(/throw new Error\([^)]*[Ii][Cc][Pp]/);
    }
  );

  it('the ICP read in each generation surface stays guarded on an id', () => {
    for (const name of GENERATION_SURFACES) {
      expect(fn(name), `${name} reads the ICP unguarded`)
        .toMatch(/icpId \? db\.collection\('users'\)/);
    }
  });
});

describe('No global context dump was introduced', () => {
  it('no unified assembler exists', () => {
    const src = GENERATION_SURFACES.map(fn).join('\n') + fn('barryOrientationBrief');

    expect(src).not.toMatch(/assembleUnifiedContext|buildFullContext|getAllContext/);
  });

  it('the shared RECON compiler was not modified for one surface', () => {
    const compiler = readFileSync(
      resolve(here, '../../netlify/functions/utils/reconCompiler.js'), 'utf8'
    );

    // compileReconForPrompt serves surfaces with different scope requirements;
    // adding User scope there would have changed all of them at once.
    expect(compiler).not.toMatch(/communicationStyle/);
  });

  it('each surface assembles its own scopes', () => {
    // userStyleBlock is duplicated per function rather than centralised — the
    // deliberate choice, so no shared utility gains a caller with different
    // requirements.
    for (const name of GENERATION_SURFACES) {
      expect(fn(name)).toMatch(/function userStyleBlock/);
    }
  });
});
