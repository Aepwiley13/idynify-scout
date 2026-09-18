/**
 * Every scheduled function must be registered under a NAMED `handler` export.
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * `export default schedule(CRON, fn)` type-checks, bundles, deploys, and
 * reports a healthy function. It simply never fires: Netlify registers a
 * scheduled function by its named `handler` export, so a default export
 * registers nothing and the cron silently does not exist. Nothing errors,
 * nothing appears in the logs, and the function looks live in the dashboard.
 *
 * Three functions shipped that way and had never run once when this was found:
 *
 *   daily-leads-refresh.js            broken 2026-01-03 → 2026-09-17  (~185 weekday runs)
 *   process-barry-queue.js            broken 2026-02-25 → 2026-09-17  (~145 weekday runs)
 *   process-scheduled-engagements.js  broken 2026-03-14 → 2026-09-17  (~18,000 runs, every 15 min)
 *
 * It was convention drift rather than three independent mistakes. The correct
 * form was established in August 2026 (gmail-sync-worker, then
 * process-barry-inbox-queue) and the three older files were never retrofitted
 * — one of them carried a comment citing a broken file as the example to
 * follow. A reviewer cannot catch this by reading a diff, and no runtime check
 * can either, because the failure IS the absence of runtime. So it is asserted
 * over the source of every scheduled function in the repo, including ones
 * written after this.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const FUNCTIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../netlify/functions');

/**
 * Source with comments stripped — same helper shape as icpIdentityInvariants.
 *
 * Needed because the fixed files now CARRY the broken line in a comment warning
 * against it. Asserting over raw source would flag the warning as the bug.
 */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Every function file that registers itself on a cron. */
const scheduledFiles = readdirSync(FUNCTIONS_DIR)
  .filter(f => f.endsWith('.js'))
  .map(name => ({ name, src: readFileSync(join(FUNCTIONS_DIR, name), 'utf8') }))
  .filter(({ src }) => /\bschedule\s*\(/.test(src) && /@netlify\/functions/.test(src));

describe('scheduled function registration', () => {
  it('finds the scheduled functions to check', () => {
    // Guards the guard: a glob that silently matches nothing would pass every
    // assertion below forever.
    expect(scheduledFiles.length).toBeGreaterThanOrEqual(5);
  });

  it.each(scheduledFiles.map(f => f.name))(
    '%s registers its cron under a named `handler` export',
    (name) => {
      const { src } = scheduledFiles.find(f => f.name === name);
      expect(code(src)).toMatch(/export\s+const\s+handler\s*=\s*schedule\s*\(/);
    },
  );

  it.each(scheduledFiles.map(f => f.name))(
    '%s never registers a cron on a default export',
    (name) => {
      const { src } = scheduledFiles.find(f => f.name === name);
      // The exact line that deploys clean and never runs.
      expect(code(src)).not.toMatch(/export\s+default\s+schedule\s*\(/);
    },
  );

  it('covers the three functions that were dead, by name', () => {
    // Explicit so that a change to the discovery glob above cannot quietly
    // stop checking the files this was written for.
    for (const name of [
      'daily-leads-refresh.js',
      'process-barry-queue.js',
      'process-scheduled-engagements.js',
    ]) {
      const entry = scheduledFiles.find(f => f.name === name);
      expect(entry, `${name} is no longer being checked`).toBeTruthy();
      expect(code(entry.src)).toMatch(/export\s+const\s+handler\s*=\s*schedule\s*\(/);
    }
  });
});
