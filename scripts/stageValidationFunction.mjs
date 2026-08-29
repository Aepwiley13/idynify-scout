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

/**
 * The staging convention, and the single source of truth for it.
 *
 * ─── WHY A NAME PATTERN RATHER THAN "ANY .js" ───────────────────────────────
 *
 * The exclusion has two halves that must agree: this script decides what gets
 * copied INTO netlify/functions/, and .gitignore decides what may never be
 * committed there. The independent audit found they did not agree — staging
 * accepted any `*.js`, while .gitignore only covered `validation-*.js`. A file
 * called `helper.js` in netlify/validation/ would therefore have been staged
 * into the deployed functions directory AND been git-visible, which is exactly
 * the leak the exclusion exists to prevent.
 *
 * Narrowing staging to `validation-*.js` makes the two halves the same rule.
 * The ignore pattern below is derived from this constant rather than restated,
 * so the two cannot drift; a test asserts .gitignore still carries it, since a
 * text file cannot import a constant.
 */
export const STAGED_FILE_PREFIX = 'validation-';
export const STAGED_FILE_PATTERN = /^validation-[A-Za-z0-9._-]*\.js$/;
export const GITIGNORE_PATTERN = `netlify/functions/${STAGED_FILE_PREFIX}*.js`;

/** True when a file in the validation directory is eligible for staging. */
export function isStageable(filename) {
  return STAGED_FILE_PATTERN.test(filename);
}

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
  const rejected = [];

  for (const file of readdirSync(SOURCE_DIR)) {
    if (!file.endsWith('.js')) continue;

    // A .js file that does not match the convention is REFUSED, not silently
    // skipped: it would be a file someone intended to deploy, landing outside
    // the ignore pattern that keeps staged copies out of git. Failing the build
    // is the correct outcome — a rename fixes it, and the alternative is a
    // deployed function nobody meant to ship.
    if (!isStageable(file)) {
      rejected.push(file);
      continue;
    }

    copyFileSync(join(SOURCE_DIR, file), join(TARGET_DIR, file));
    staged.push(file);
    log(`[stage-validation] staged ${file}`);
  }

  if (rejected.length > 0) {
    throw new Error(
      `[stage-validation] these files must be named "${STAGED_FILE_PREFIX}*.js" or the ` +
      `.gitignore rule "${GITIGNORE_PATTERN}" will not cover them once staged: ` +
      rejected.join(', ')
    );
  }

  return { staged, rejected, skipped: false };
}

// Only run when executed directly, so importing it in a test stages nothing.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  stage();
}
