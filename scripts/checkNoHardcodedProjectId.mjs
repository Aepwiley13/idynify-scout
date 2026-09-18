/**
 * Fail the build if the Firebase project id is hardcoded again.
 *
 * Twenty-two call sites read the project as
 * `process.env.FIREBASE_PROJECT_ID || 'idynify-scout-dev'`, and six client
 * values were literals in src/firebase/config.js. The effect was that a deploy
 * with no environment configured did not fail — it silently connected to the
 * one project that serves real customers, from previews and branch deploys as
 * readily as from production.
 *
 * Removing them once is not the same as keeping them gone. The pattern is easy
 * to reintroduce (it makes a local run "just work"), reads as harmless in
 * review, and fails silently in exactly the direction that matters. So the
 * removal is enforced rather than remembered.
 *
 * Run: node scripts/checkNoHardcodedProjectId.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCANNED = ['src', 'netlify/functions'];
const LITERAL = 'idynify-scout-dev';

/**
 * Documented exceptions. Each is a place the string appears as DOCUMENTATION
 * or as a TEST FIXTURE rather than as configuration — never as a value the app
 * would actually connect with.
 *
 * This list only shrinks. Adding to it means a new place is allowed to name
 * the production project in source, which is a review conversation, not a
 * convenience.
 */
const ALLOWED = new Map([
  ['src/firebase/config.js',
   'Comment explaining that the project is named "-dev" but IS production. The config itself reads import.meta.env.'],
  ['src/test/telemetryAttribution.test.js',
   'Fixture. The test asserts a project id containing "dev" must NOT colour the environment label — the literal is the thing under test.'],
  ['netlify/functions/utils/firebaseEnv.js',
   'Docblock quoting the removed fallback pattern, so the next reader knows what was wrong with it.'],
  ['netlify/functions/utils/logApiUsage.js',
   'Comment explaining the same naming accident for the telemetry label.'],
]);

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
    const lines = readFileSync(file, 'utf8').split('\n');

    lines.forEach((line, i) => {
      if (!line.includes(LITERAL)) return;
      if (ALLOWED.has(rel)) { allowedHit.add(rel); return; }
      violations.push({ rel, line: i + 1, text: line.trim() });
    });
  }
}

// An allowlist entry that no longer matches anything is stale. Say so — the
// list is supposed to shrink, and an entry nobody removed is an entry nobody
// checked.
const stale = [...ALLOWED.keys()].filter((f) => !allowedHit.has(f));

if (violations.length === 0) {
  console.log(`✓ no hardcoded "${LITERAL}" in ${SCANNED.join(', ')}`);
  if (stale.length) {
    console.log('\n  Note — allowlist entries that matched nothing (safe to delete):');
    for (const f of stale) console.log(`    ${f}`);
  }
  process.exit(0);
}

console.error(`\n✗ Hardcoded Firebase project id found in ${violations.length} place(s).\n`);
for (const v of violations) {
  console.error(`  ${v.rel}:${v.line}`);
  console.error(`    ${v.text}\n`);
}
console.error(
  'The project id must come from the environment, with no fallback:\n' +
  '  · Netlify functions — import { requireProjectId } from "./utils/firebaseEnv.js"\n' +
  '  · Client code       — import.meta.env.VITE_FIREBASE_PROJECT_ID\n\n' +
  'A literal here means a misconfigured deploy reaches real customer data\n' +
  'instead of failing. If this occurrence is documentation rather than\n' +
  'configuration, add it to ALLOWED in this script with a reason.\n'
);
process.exit(1);
