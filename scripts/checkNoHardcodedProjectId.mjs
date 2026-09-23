/**
 * Fail the build if a Firebase project id is hardcoded in source.
 *
 * WHY THIS EXISTS. Twenty-two call sites once read
 *
 *     process.env.FIREBASE_PROJECT_ID || 'idynify-scout-dev'
 *
 * so an environment with nothing configured did not fail — it connected to the
 * project serving real customers, from a branch deploy, a preview or a fork,
 * and looked exactly like a correct deploy while doing it. PR #644 removed
 * them and added this guard.
 *
 * WHY IT WAS REWRITTEN. The first version banned one string, the literal
 * `idynify-scout-dev`. On 2026-09-22 it printed
 *
 *     ✓ no hardcoded "idynify-scout-dev" in src, netlify/functions
 *
 * while netlify/functions/admin-get-users.js carried
 *
 *     process.env.FIREBASE_PROJECT_ID || 'idynify-mission-control'
 *
 * A guard that reports success next to a live instance of the bug it exists to
 * prevent is worse than no guard, because it is trusted. The defect was never
 * one project's name — it is the SHAPE: a literal standing in for
 * configuration. So this matches the shape.
 *
 * THREE DETECTORS, deliberately narrow to stay quiet on ordinary code:
 *
 *   env-fallback   a Firebase/project env var read with a string fallback
 *   literal-config a projectId assigned a string literal
 *   org-project    any 'idynify-…' literal, whatever it is named next
 *
 * Comment-only lines are skipped, so a docblock may quote the broken pattern
 * in order to explain it — which is how the next reader learns what was wrong.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCANNED = ['src', 'netlify/functions', 'scripts'];

const DETECTORS = [
  {
    name: 'env-fallback',
    // process.env.FIREBASE_PROJECT_ID || 'anything'
    re: /(?:process\.env|import\.meta\.env)\s*\.\s*[A-Z_]*(?:FIREBASE|PROJECT)[A-Z_]*\s*\|\|\s*['"`][^'"`]+['"`]/,
    why: 'an env var with a literal fallback — the fallback is the trapdoor',
  },
  {
    name: 'literal-config',
    // projectId: 'anything'  /  projectId = "anything"
    re: /\bprojectId\s*[:=]\s*['"`][a-z0-9][a-z0-9-]{4,29}['"`]/,
    why: 'a projectId assigned a literal instead of configuration',
  },
  {
    name: 'org-project',
    // any of this org's project names, present or future
    re: /['"`]idynify-[a-z0-9-]+['"`]/,
    why: "an 'idynify-…' project literal in source",
  },
];

/**
 * Documented exceptions. Each is a place a project id appears as a TEST
 * FIXTURE or as the subject of an assertion — never as a value the app would
 * connect with. This list only shrinks; adding to it is a review conversation.
 */
const ALLOWED = new Map([
  ['src/test/telemetryAttribution.test.js',
   'Fixture. Asserts a project id containing "dev" must NOT colour the environment label — the literal is the thing under test.'],
  ['src/test/authErrorMapping.test.js',
   'Fixture. Asserts two configs sharing a projectId but differing by API key stay distinguishable.'],
  ['scripts/rules-check/cases.mjs',
   'Emulator fixture. Firebase reserves the "demo-" prefix for projects that cannot reach a real backend, so this literal is safe by construction.'],
]);

/** A line that is only a comment cannot configure anything. */
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const violations = [];
const allowedHit = new Set();

for (const base of SCANNED) {
  for (const file of walk(join(ROOT, base))) {
    const rel = relative(ROOT, file);
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (isComment(line)) return;
      const hit = DETECTORS.find((d) => d.re.test(line));
      if (!hit) return;
      if (ALLOWED.has(rel)) { allowedHit.add(rel); return; }
      violations.push({ rel, line: i + 1, text: line.trim(), detector: hit.name, why: hit.why });
    });
  }
}

const stale = [...ALLOWED.keys()].filter((f) => !allowedHit.has(f));

if (violations.length === 0) {
  console.log(`✓ no hardcoded Firebase project id in ${SCANNED.join(', ')}`);
  console.log(`  detectors: ${DETECTORS.map((d) => d.name).join(', ')}`);
  if (stale.length) {
    console.log('\n  Note — allowlist entries that matched nothing (safe to delete):');
    for (const f of stale) console.log(`    ${f}`);
  }
  process.exit(0);
}

console.error(`\n✗ Hardcoded Firebase project id found in ${violations.length} place(s).\n`);
for (const v of violations) {
  console.error(`  ${v.rel}:${v.line}  [${v.detector}]`);
  console.error(`    ${v.text}`);
  console.error(`    ↳ ${v.why}\n`);
}
console.error(
  'The project id must come from the environment, with no fallback:\n' +
  '  · Netlify functions — import { requireProjectId } from "./utils/firebaseEnv.js"\n' +
  '  · Client code       — import.meta.env.VITE_FIREBASE_PROJECT_ID\n\n' +
  'A literal here means a misconfigured deploy reaches real customer data\n' +
  'instead of failing. If this occurrence is a test fixture rather than\n' +
  'configuration, add it to ALLOWED in this file with a reason.\n'
);
process.exit(1);
