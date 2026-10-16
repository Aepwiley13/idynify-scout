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
