/**
 * There is no separate "returning onboarding" flow.
 *
 * One route serves the first conversation and every one after it. That is what
 * makes redirecting the existing-user affordances ("Review ICP with Barry")
 * into it correct rather than destructive — a user who already has an ICP must
 * land in refinement, not be introduced to Barry again.
 *
 * Mode is derived from state that already exists, never stored. A stored mode
 * would be one more completion flag, and this phase is removing those.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  resolveFirstExperienceMode,
  shouldIntroduce,
  MODE_BEGIN,
  MODE_RESUME,
  MODE_REFINE,
} from '../utils/firstExperienceMode';

const here = dirname(fileURLToPath(import.meta.url));
const shell = readFileSync(resolve(here, '../pages/Onboarding/FirstExperience.jsx'), 'utf8');

const RESOLVED = { status: 'resolved', icpId: 'icp_a', profile: { name: 'A' } };
const NO_PROFILES = { status: 'unresolved', reason: 'no-profiles', candidates: [] };
const NONE_ACTIVE = { status: 'unresolved', reason: 'none-active', candidates: [{ id: 'icp_b' }] };
const READ_FAILED = { status: 'unresolved', reason: 'read-failed', candidates: [] };

describe('what this visit is', () => {
  it('nothing yet → begin', () => {
    expect(resolveFirstExperienceMode(null, NO_PROFILES).mode).toBe(MODE_BEGIN);
  });

  it('an unfinished conversation → resume', () => {
    const conv = { messages: [{ role: 'user', content: 'hi' }], status: 'in_progress' };

    expect(resolveFirstExperienceMode(conv, NO_PROFILES).mode).toBe(MODE_RESUME);
  });

  it('an existing ICP and no open conversation → refine', () => {
    const conv = { messages: [{ role: 'user' }], status: 'completed' };

    expect(resolveFirstExperienceMode(conv, RESOLVED).mode).toBe(MODE_REFINE);
  });

  it('an unfinished conversation wins over an existing ICP', () => {
    // Finishing what was started beats jumping to refinement of an ICP the
    // user may have been in the middle of changing.
    const conv = { messages: [{ role: 'user' }], status: 'in_progress' };

    expect(resolveFirstExperienceMode(conv, RESOLVED).mode).toBe(MODE_RESUME);
  });

  it('an empty conversation document is not a resume', () => {
    expect(resolveFirstExperienceMode({ messages: [], status: 'in_progress' }, NO_PROFILES).mode)
      .toBe(MODE_BEGIN);
  });
});

describe('zero-ICP and unresolved states are not failures here', () => {
  it.each([
    ['no-profiles', NO_PROFILES, MODE_BEGIN],
    ['none-active', NONE_ACTIVE, MODE_BEGIN],
    ['read-failed', READ_FAILED, MODE_BEGIN],
  ])('%s begins rather than erroring', (_label, resolution, expected) => {
    expect(resolveFirstExperienceMode(null, resolution).mode).toBe(expected);
  });

  it('only a resolved ICP counts as having one', () => {
    expect(resolveFirstExperienceMode(null, NONE_ACTIVE).hasIcp).toBe(false);
    expect(resolveFirstExperienceMode(null, RESOLVED).hasIcp).toBe(true);
  });

  it('tolerates malformed input without throwing', () => {
    for (const args of [[undefined, undefined], [{}, {}], [{ messages: 'nope' }, null]]) {
      expect(() => resolveFirstExperienceMode(...args)).not.toThrow();
      expect(resolveFirstExperienceMode(...args).mode).toBe(MODE_BEGIN);
    }
  });
});

describe('Barry introduces itself only on a genuine first conversation', () => {
  it('introduces when beginning', () => {
    expect(shouldIntroduce(MODE_BEGIN)).toBe(true);
  });

  it.each([MODE_RESUME, MODE_REFINE])('does not introduce when %s', (mode) => {
    expect(shouldIntroduce(mode)).toBe(false);
  });
});

describe('the shell uses it, and stores nothing', () => {
  it('reads the conversation document and the canonical ICP resolution', () => {
    expect(shell).toMatch(/'barryConversations', 'icp'/);
    expect(shell).toMatch(/resolveActiveIcp\(user\.uid\)/);
  });

  it('derives the mode rather than persisting it', () => {
    expect(shell).toMatch(/resolveFirstExperienceMode\(conversation, icpResolution\)/);
    expect(shell).not.toMatch(/setDoc[\s\S]{0,120}mode/);
  });

  it('does not ask a returning user for their name', () => {
    expect(shell).toMatch(/shouldAsk && !alreadyAsked && shouldIntroduce\(mode\)/);
  });

  it('a failed conversation read does not stop the experience', () => {
    expect(shell).toMatch(/conversation read failed/);
  });

  it('there is no second flow — one component handles every returning state', () => {
    // Comments stripped: the header explains the two flows this route replaced,
    // and naming them in prose must not read as importing them.
    const code = shell.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toMatch(/ReturningOnboarding|OnboardingFlow|ReconOnboardingWizard/);
  });
});
