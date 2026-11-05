/**
 * The staging rollout tool (scripts/staging/stickersStaging.mjs) refuses any
 * target it cannot prove is non-production, plans writes to the two rollout
 * collections only, and writes nothing without --apply.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { parseArgs, checkStagingTarget, planWrites, StagingRefusal } from '../../scripts/staging/stickersStaging.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(here, '../../scripts/staging/stickersStaging.mjs');
const STAGING = 'acme-staging';

describe('checkStagingTarget', () => {
  const ok = { projectId: STAGING, credentialsProjectId: STAGING, allowlist: STAGING };

  it('accepts an allowlisted staging project that the service account belongs to', () => {
    expect(checkStagingTarget(ok)).toEqual({ target: 'staging' });
  });

  it('accepts a demo- project on the emulator', () => {
    expect(checkStagingTarget({ projectId: 'demo-qa', emulatorHost: '127.0.0.1:8080' })).toEqual({ target: 'emulator' });
  });

  it.each([
    ['no project', { ...ok, projectId: null }, /--project is required/],
    ['the production project, by name', { ...ok, productionProjectId: STAGING }, /production project/],
    ['a project not in the allowlist', { ...ok, allowlist: 'other-staging' }, /not listed/],
    ['an allowlisted id that does not look like staging', { projectId: 'acme-prod', credentialsProjectId: 'acme-prod', allowlist: 'acme-prod' }, /does not look like a staging/],
    ['no service account', { ...ok, credentialsProjectId: null }, /service-account key for the staging project is required/],
    ['a service account from another project', { ...ok, credentialsProjectId: 'acme-prod' }, /different project/],
    ['a real project id against the emulator', { projectId: STAGING, emulatorHost: '127.0.0.1:8080' }, /"demo-" project/],
    ['the production project on the emulator', { projectId: 'demo-qa', emulatorHost: '127.0.0.1:8080', productionProjectId: 'demo-qa' }, /production project/],
  ])('refuses %s', (_label, input, reason) => {
    expect(() => checkStagingTarget(input)).toThrow(StagingRefusal);
    expect(() => checkStagingTarget(input)).toThrow(reason);
  });
});

describe('parseArgs and planWrites', () => {
  it('plans the mode and the beta list, and nothing else', () => {
    const args = parseArgs(['--project=demo-qa', '--mode=beta', '--enroll=u1', '--unenroll=u2']);
    expect(args.apply).toBe(false);
    expect(planWrites(args)).toEqual([
      ['feature_flags/stickers', { mode: 'beta' }],
      ['sticker_enrollment/u1', { stage: 'beta' }],
      ['sticker_enrollment/u2', null],
    ]);
  });

  it.each([
    [['--project=demo-qa', '--mode=enabled']],
    [['--project=demo-qa', '--enroll=a/b']],
    [['--project=demo-qa', '--enroll=u1', '--unenroll=u1']],
    [['--project=demo-qa']],
    [['--project=demo-qa', '--mode=on', '--force']],
  ])('refuses %j', (argv) => {
    expect(() => parseArgs(argv)).toThrow(StagingRefusal);
  });
});

describe('the tool itself', () => {
  const run = (args, extraEnv = {}) => {
    try {
      return { status: 0, out: execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, ...extraEnv } }) };
    } catch (err) {
      return { status: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };

  it('a dry run prints the plan and writes nothing', () => {
    const { status, out } = run(['--project=demo-qa', '--mode=beta', '--enroll=u1'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' });
    expect(status).toBe(0);
    expect(out).toContain('set    feature_flags/stickers {"mode":"beta"}');
    expect(out).toContain('Dry run: nothing was written.');
  });

  it('refuses a real project with no allowlist, before touching anything', () => {
    const { status, out } = run([`--project=${STAGING}`, '--mode=on', '--apply']);
    expect(status).toBe(1);
    expect(out).toContain('Refused:');
  });

  it('writes only the two rollout collections, and only with --apply', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    expect([...source.matchAll(/db\.doc\(([^)]*)\)/g)].map((m) => m[1])).toEqual(['path', 'path']);
    expect(source).toMatch(/if \(!args\.apply\) \{/);
    expect(source).not.toMatch(/collection\(/);
  });
});
