/* global process */
/**
 * The hardcoded-project-id guard (scripts/checkNoHardcodedProjectId.mjs), run as CI runs it.
 *
 * What is held here: the repository passes; the My Card emulator suite may name
 * its synthetic "demo-my-card" project and nothing else; and that exception
 * cannot be borrowed by another file, another value, another shape of line or a
 * line that also carries a real project id. The script is run for real, over a
 * scratch tree (PROJECT_ID_GUARD_ROOT), so what is tested is what CI runs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// Tests run from the repository root (vitest's own working directory).
const SCRIPT = resolve(process.cwd(), 'scripts/checkNoHardcodedProjectId.mjs');
const MY_CARD = 'scripts/rules-check/my-card.mjs';

// This file is itself scanned by the guard, so the lines it feeds the guard are built from pieces:
// no project id, assignment or fallback appears here in the shape the guard looks for.
const KEY = ['project', 'Id'].join('');
const ENV = ['process.env.FIREBASE', 'PROJECT_ID'].join('_');
const real = (name) => ['idynify', name].join('-');
const assign = (value, quote = "'") => `${KEY}: ${quote}${value}${quote}`;
const initWith = (...assignments) => `const env = await init({ ${assignments.join(', ')} });\n`;
const DEMO = ['demo', 'my', 'card'].join('-');
let scratch;

beforeAll(() => { scratch = mkdtempSync(join(tmpdir(), 'projid-guard-')); });
afterAll(() => { rmSync(scratch, { recursive: true, force: true }); });

/** Runs the guard over a tree holding just these files. */
function guard(files) {
  const root = mkdtempSync(join(scratch, 'tree-'));
  for (const dir of ['src', 'netlify/functions', 'scripts']) mkdirSync(join(root, dir), { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const run = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, PROJECT_ID_GUARD_ROOT: `${root}/` }, encoding: 'utf8' });
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

describe('the repository', () => {
  it('passes the guard, as CI runs it', () => {
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    // The exception is in use (not left behind after the file stopped needing it).
    expect(`${run.stdout}${run.stderr}`).not.toMatch(/scripts\/rules-check\/my-card\.mjs/);
  });
});

describe('the My Card emulator project', () => {
  it('may be named in the My Card rules suite, and only there', () => {
    expect(guard({ [MY_CARD]: initWith(assign(DEMO)) }).code).toBe(0);
    expect(guard({ [MY_CARD]: initWith(assign(DEMO, '"')) }).code).toBe(0);
  });

  it('is refused in any other file, in rules-check or anywhere else', () => {
    for (const path of ['scripts/rules-check/other.mjs', 'scripts/rules-check/cases2.mjs', 'scripts/rules-check/my-card.test.mjs', 'scripts/my-card.mjs', 'src/lib/firebase.js', 'netlify/functions/x.js']) {
      const result = guard({ [path]: initWith(assign(DEMO)) });
      expect(result.code, path).toBe(1);
      expect(result.out, path).toContain(path);
    }
  });

  it('is the only value excused in that file: another demo id and a real project id still fail', () => {
    for (const literal of [`${DEMO}-2`, 'demo-other', DEMO.slice(0, -1), real('staging'), real('scout-dev'), 'some-real-project']) {
      const result = guard({ [MY_CARD]: initWith(assign(literal)) });
      expect(result.code, literal).toBe(1);
    }
  });

  it('is not excused when the same line also carries a real project id, or a second literal', () => {
    expect(guard({ [MY_CARD]: initWith(assign(DEMO), `other: '${real('staging')}'`) }).code).toBe(1);
    expect(guard({ [MY_CARD]: initWith(assign(DEMO), assign('real-project-id')) }).code).toBe(1);
  });

  it('does not excuse the other shapes the guard exists to stop, even with this value', () => {
    expect(guard({ [MY_CARD]: `const id = ${ENV} || '${DEMO}';\n` }).code).toBe(1);
    expect(guard({ [MY_CARD]: `const id = ${ENV} || '${real('scout-dev')}';\n` }).code).toBe(1);
    expect(guard({ [MY_CARD]: `const id = '${real('staging')}';\n` }).code).toBe(1);
  });

  it('excuses the demo project on its own line while a real id elsewhere in the same file still fails', () => {
    const result = guard({ [MY_CARD]: `${initWith(assign(DEMO))}const live = { ${assign(real('staging'))} };\n` });
    expect(result.code).toBe(1);
    expect(result.out).toContain(`${MY_CARD}:2`);
    expect(result.out).not.toContain(`${MY_CARD}:1 `);
  });

  it('keeps every other protection: the same detectors still catch real ids anywhere else', () => {
    expect(guard({ 'src/a.js': `const c = { ${assign(real('scout-dev'))} };\n` }).code).toBe(1);
    expect(guard({ 'netlify/functions/a.js': `const id = ${ENV} || '${real('mission-control')}';\n` }).code).toBe(1);
    expect(guard({ 'scripts/a.mjs': `const name = '${real('staging')}';\n` }).code).toBe(1);
    expect(guard({ 'src/a.js': `const fine = ${ENV};\n` }).code).toBe(0);
  });

  it('says that the exception is unused, rather than failing, if the file stops needing it', () => {
    const result = guard({ [MY_CARD]: 'export {};\n' });
    expect(result.code).toBe(0);
    expect(result.out).toContain('exact-literal exceptions that matched nothing');
  });
});
