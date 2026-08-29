/**
 * stageValidationFunction — copy the validation-only entrypoint into the
 * deployed functions directory, on the validation site and nowhere else.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THE EXCLUSION IS STRUCTURAL, NOT A MISSING SECRET.                      ║
 * ║                                                                          ║
 * ║  The audit's finding was that an unset token makes the endpoint INERT    ║
 * ║  on production but not ABSENT from it. Inert depends on configuration    ║
 * ║  staying correct forever. Absent does not.                               ║
 * ║                                                                          ║
 * ║  netlify/validation/ is outside the functions directory, so nothing      ║
 * ║  there is deployed by default. This script is the only thing that puts   ║
 * ║  it in, and it does nothing unless VALIDATION_SITE === 'true'.           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─── WHY AN ENV FLAG RATHER THAN A NETLIFY CONTEXT ──────────────────────────
 *
 * Deploy contexts key off branch names, and the same branch can build on both
 * sites — so `[context.branch-deploy]` would also match a branch deploy of the
 * PRODUCTION site, which is precisely the case that must never stage this.
 * `VALIDATION_SITE` is set in one site's environment and nowhere else, so the
 * two sites cannot be confused by a branch name.
 *
 * ─── FAIL-SAFE DIRECTION ────────────────────────────────────────────────────
 *
 * Unset, empty, 'TRUE', '1' and any other value are all treated as "not the
 * validation site". Only the exact string 'true' stages the function, so the
 * failure mode of a typo is a validation site missing its endpoint — a loud,
 * harmless failure — rather than production quietly gaining one.
 *
 * Verification after deploy is the deployed-function list itself:
 *   netlify api searchSiteFunctions  →  production must not list
 *                                       "validation-process-one-message"
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = resolve(here, '../netlify/validation');
const TARGET_DIR = resolve(here, '../netlify/functions');

export const VALIDATION_SITE_FLAG = 'VALIDATION_SITE';

export function shouldStage(env = process.env) {
  return env[VALIDATION_SITE_FLAG] === 'true';
}

export function stage({ env = process.env, log = console.log } = {}) {
  if (!shouldStage(env)) {
    log('[stage-validation] not the validation site — validation functions NOT staged');
    return { staged: [], skipped: true };
  }

  if (!existsSync(SOURCE_DIR)) {
    log('[stage-validation] no validation directory present');
    return { staged: [], skipped: false };
  }

  mkdirSync(TARGET_DIR, { recursive: true });
  const staged = [];
  for (const file of readdirSync(SOURCE_DIR)) {
    if (!file.endsWith('.js')) continue;
    copyFileSync(join(SOURCE_DIR, file), join(TARGET_DIR, file));
    staged.push(file);
    log(`[stage-validation] staged ${file}`);
  }
  return { staged, skipped: false };
}

// Only run when executed directly, so importing it in a test stages nothing.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  stage();
}
