/**
 * The Barry Sonnet model is chosen in one place and overridable (#699, step 2).
 *
 * claude-sonnet-4-5-20250929 retires 2026-11-30. Until the side-by-side
 * validation passes, production must stay on it by default, while
 * BARRY_MODEL_SONNET lets a deploy switch to the candidate or roll back
 * with no code change.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveBarrySonnetModel,
  barrySonnetOptions,
  BARRY_SONNET_5_5_SETTINGS,
  SONNET_4_5,
  SONNET_5_5,
  SONNET_4_6,
} from '../../netlify/functions/utils/models.js';

const here = dirname(fileURLToPath(import.meta.url));
const functionsDir = resolve(here, '../../netlify/functions');

describe('resolveBarrySonnetModel', () => {
  it('defaults to the current production model, Sonnet 4.5', () => {
    expect(SONNET_4_5).toBe('claude-sonnet-4-5-20250929');
    expect(resolveBarrySonnetModel({})).toBe(SONNET_4_5);
  });

  it('names the migration path explicitly: Sonnet 5.5 primary, Sonnet 4.6 fallback', () => {
    expect(SONNET_5_5).toBe('claude-sonnet-5-5');
    expect(SONNET_4_6).toBe('claude-sonnet-4-6');
  });

  it('takes BARRY_MODEL_SONNET when set', () => {
    expect(resolveBarrySonnetModel({ BARRY_MODEL_SONNET: SONNET_5_5 })).toBe(SONNET_5_5);
    expect(resolveBarrySonnetModel({ BARRY_MODEL_SONNET: SONNET_4_6 })).toBe(SONNET_4_6);
  });

  it('ignores surrounding whitespace pasted into the Netlify UI', () => {
    expect(resolveBarrySonnetModel({ BARRY_MODEL_SONNET: '  claude-sonnet-5-5\n' })).toBe(SONNET_5_5);
  });

  it('falls back to the default when the variable is empty or blank', () => {
    for (const value of ['', '   ', undefined]) {
      expect(resolveBarrySonnetModel({ BARRY_MODEL_SONNET: value })).toBe(SONNET_4_5);
    }
  });
});

describe('barrySonnetOptions: Sonnet 5.5 settings per call site', () => {
  const SITES = Object.keys(BARRY_SONNET_5_5_SETTINGS);

  it('covers the eleven Barry Sonnet calls', () => {
    expect(SITES).toHaveLength(11);
  });

  it('on Sonnet 5.5: low effort for icp-example-company and engagement-message, thinking off for the rest', () => {
    for (const site of SITES) {
      const expected = ['icp-example-company', 'engagement-message'].includes(site)
        ? { output_config: { effort: 'low' } }
        : { thinking: { type: 'between_tools' } };
      expect(barrySonnetOptions(site, SONNET_5_5), site).toEqual(expected);
    }
  });

  it('on any other model: nothing, so the request is what it was before', () => {
    for (const model of [SONNET_4_5, SONNET_4_6, 'claude-sonnet-5-5-preview', '']) {
      for (const site of SITES) expect(barrySonnetOptions(site, model)).toEqual({});
    }
  });

  it('follows MODEL_BARRY_SONNET by default, which is Sonnet 4.5', () => {
    expect(barrySonnetOptions('context')).toEqual({});
  });

  it('returns a fresh object each call, so a request cannot change the settings', () => {
    const a = barrySonnetOptions('context', SONNET_5_5);
    a.thinking.type = 'adaptive';
    expect(barrySonnetOptions('context', SONNET_5_5)).toEqual({ thinking: { type: 'between_tools' } });
  });

  it('throws on an unknown call site rather than silently sending nothing', () => {
    expect(() => barrySonnetOptions('mission-sequnce', SONNET_5_5)).toThrow(/Unknown Barry Sonnet call site/);
  });
});

describe('MODEL_BARRY_SONNET is read from the environment at load', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('is Sonnet 4.5 with no override', async () => {
    vi.stubEnv('BARRY_MODEL_SONNET', '');
    vi.resetModules();
    const { MODEL_BARRY_SONNET } = await import('../../netlify/functions/utils/models.js');
    expect(MODEL_BARRY_SONNET).toBe('claude-sonnet-4-5-20250929');
  });

  it('follows the override, which is how a rollback works', async () => {
    vi.stubEnv('BARRY_MODEL_SONNET', 'claude-sonnet-4-6');
    vi.resetModules();
    const { MODEL_BARRY_SONNET } = await import('../../netlify/functions/utils/models.js');
    expect(MODEL_BARRY_SONNET).toBe('claude-sonnet-4-6');
  });
});

describe('every Barry Sonnet endpoint takes its model from MODEL_BARRY_SONNET', () => {
  const ENDPOINTS = [
    'barryGenerateMissionSequence.js',
    'barryICPConversation.js',
    'barryGenerateContext.js',
    'barryGenerateSequenceStep.js',
    'barryValidateContact.js',
    'generate-campaign-messages.js',
    'generate-followup.js',
    'generate-engagement-message.js',
    'barryMissionChat.js', // telemetry label for the ICP calls it makes through barryICPConversation
  ];

  it.each(ENDPOINTS)('%s imports MODEL_BARRY_SONNET', (file) => {
    const src = readFileSync(resolve(functionsDir, file), 'utf8');
    expect(src).toMatch(/MODEL_BARRY_SONNET[^\n]*['"]\.\/utils\/models\.js['"]/);
  });

  it('no deployed function writes a Sonnet 4.5 identifier outside models.js', () => {
    const offenders = readdirSync(functionsDir, { recursive: true })
      .filter((f) => /\.(c|m)?js$/.test(f) && f !== 'utils/models.js')
      .filter((f) => {
        // Comment lines may name the model to explain history; code may not
        const code = readFileSync(resolve(functionsDir, f), 'utf8')
          .split('\n')
          .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
        return code.some((line) => /claude-sonnet-4-5|LEGACY_SONNET_4_5/.test(line));
      });
    expect(offenders).toEqual([]);
  });
});
