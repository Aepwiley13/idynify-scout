/**
 * Typography guard — a ratchet, not a gate.
 *
 * The codebase carries ~4,200 type declarations and 52 distinct rendered sizes.
 * A rule that failed on all of them would be turned off within a day, so this
 * does not try. It records what exists in scripts/typography-baseline.json and
 * fails only when a file's violation count GOES UP, or a file that was clean
 * stops being clean.
 *
 * Legacy stays exactly as legacy. New work has to use the tokens.
 *
 * Deliberately dependency-free: node's fs and a few regexes. No stylelint, no
 * PostCSS, nothing added to package.json.
 *
 *   node scripts/checkTypography.mjs           # check (CI, and the vitest guard)
 *   node scripts/checkTypography.mjs --update  # re-record after deliberate work
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'scripts', 'typography-baseline.json');

/** Files nobody on this team owns — another team's surface, or generated. */
const EXCLUDED = [
  /\/ContactHub\//,          // Contact Hub team's files — do not touch
  /\s[23]\.css$/,            // " 2.css" / " 3.css" duplicate artefacts
];

const MIN_PX = 11;                              // the agreed floor
const WEIGHTS = new Set([400, 500, 600, 700, 800]); // 800 = brand exception

export const RULES = {
  'font-family-not-inter':
    'font-family that is neither Inter-first, `inherit`, a monospace stack, nor the Orbitron brand accent',
  'font-size-px':
    'font-size in px — use a var(--text-*) token',
  'font-size-below-floor':
    `font-size below the ${MIN_PX}px floor`,
  'font-weight-off-scale':
    'font-weight outside 400/500/600/700 (+800 brand exception)',
  'line-height-one':
    'line-height: 1 — clips descenders; use var(--leading-tight)',
};

function cssFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) cssFiles(p, acc);
    else if (e.name.endsWith('.css')) acc.push(p);
  }
  return acc;
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** @returns {Record<string, string[]>} rule id -> human-readable offences */
export function scanFile(abs) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  const out = {};
  const add = (rule, detail) => (out[rule] ||= []).push(detail);
  const src = stripComments(fs.readFileSync(abs, 'utf8'));

  for (const m of src.matchAll(/font-family:\s*([^;}]+)/g)) {
    const v = m[1].trim();
    const ok =
      /^inherit$/i.test(v) ||
      /inter/i.test(v) ||
      /monospace|ui-monospace|courier|menlo|monaco|consolas/i.test(v) ||
      /orbitron/i.test(v) ||
      /^var\(/.test(v);
    if (!ok) add('font-family-not-inter', v.slice(0, 60));
  }

  for (const m of src.matchAll(/font-size:\s*([0-9.]+)(px|rem)/g)) {
    const n = parseFloat(m[1]);
    const px = m[2] === 'rem' ? n * 16 : n;
    if (m[2] === 'px') add('font-size-px', `${m[1]}px`);
    if (px < MIN_PX) add('font-size-below-floor', `${+px.toFixed(4)}px`);
  }

  for (const m of src.matchAll(/font-weight:\s*([0-9]+)/g)) {
    const w = Number(m[1]);
    if (!WEIGHTS.has(w)) add('font-weight-off-scale', String(w));
  }

  for (const m of src.matchAll(/line-height:\s*(1)\s*[;}]/g)) {
    add('line-height-one', m[1]);
  }

  return { rel, out };
}

export function scanAll() {
  const counts = {};
  const details = {};
  for (const abs of cssFiles(path.join(ROOT, 'src'))) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (EXCLUDED.some((re) => re.test('/' + rel))) continue;
    const { out } = scanFile(abs);
    const total = Object.values(out).reduce((a, b) => a + b.length, 0);
    if (total) {
      counts[rel] = total;
      details[rel] = out;
    }
  }
  return { counts, details };
}

/** TYPE in tokens.js must not drift from the :root custom properties. */
export function checkMirror() {
  const css = fs.readFileSync(path.join(ROOT, 'src', 'index.css'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'src', 'theme', 'tokens.js'), 'utf8');
  const drift = [];

  // Parse TYPE.size into an exact map. Substring matching is not safe here:
  // a loose /xs:/ also matches inside '2xs'. That bug shipped once, in this
  // function, and the guard's own test caught it.
  const block = js.match(/size:\s*\{([\s\S]*?)\n  \},/);
  const sizes = {};
  if (block) {
    for (const m of block[1].matchAll(/(?:'([^']+)'|([A-Za-z_][\w]*))\s*:\s*(\d+)/g)) {
      sizes[m[1] ?? m[2]] = Number(m[3]);
    }
  } else {
    drift.push('could not find TYPE.size in theme/tokens.js');
  }

  for (const m of css.matchAll(/--text-([a-z0-9]+):\s*([0-9.]+)rem/g)) {
    const px = Math.round(parseFloat(m[2]) * 16);
    const key = m[1];
    if (!(key in sizes)) drift.push(`--text-${key} (${px}px) has no TYPE.size counterpart`);
    else if (sizes[key] !== px)
      drift.push(`--text-${key} is ${px}px but TYPE.size.${key} is ${sizes[key]}`);
  }
  for (const key of Object.keys(sizes)) {
    if (!new RegExp(`--text-${key}:`).test(css))
      drift.push(`TYPE.size.${key} has no --text-${key} counterpart`);
  }
  return drift;
}

export function compare() {
  const { counts, details } = scanAll();
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const regressions = [];
  for (const [file, n] of Object.entries(counts)) {
    const was = base.files[file] ?? 0;
    if (n > was) regressions.push({ file, was, now: n, details: details[file] });
  }
  const improved = Object.entries(base.files)
    .filter(([f, n]) => (counts[f] ?? 0) < n)
    .map(([f, n]) => ({ file: f, was: n, now: counts[f] ?? 0 }));
  return { counts, regressions, improved, base };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const update = process.argv.includes('--update');
  const { counts, regressions, improved } = compare();
  const drift = checkMirror();

  if (update) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    fs.writeFileSync(
      BASELINE,
      JSON.stringify(
        {
          note: 'Generated by scripts/checkTypography.mjs --update. Counts may go DOWN freely; the guard fails only when they go up.',
          recorded: new Date().toISOString().slice(0, 10),
          totalViolations: total,
          files: counts,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`baseline updated: ${total} violations across ${Object.keys(counts).length} files`);
    process.exit(0);
  }

  let bad = false;
  if (drift.length) {
    bad = true;
    console.error('\nTYPE in tokens.js has drifted from the :root tokens:');
    drift.forEach((d) => console.error(`  - ${d}`));
  }
  if (regressions.length) {
    bad = true;
    console.error('\nNew typography violations (legacy is fine; these are new):');
    for (const r of regressions) {
      console.error(`\n  ${r.file}  ${r.was} -> ${r.now}`);
      for (const [rule, hits] of Object.entries(r.details)) {
        console.error(`     ${rule}: ${hits.slice(0, 4).join(', ')}${hits.length > 4 ? ` +${hits.length - 4}` : ''}`);
        console.error(`       ${RULES[rule]}`);
      }
    }
    console.error('\nUse the var(--text-*) / var(--weight-*) / var(--leading-*) tokens in src/index.css.');
    console.error('If the change is deliberate, re-record with: node scripts/checkTypography.mjs --update\n');
  }
  if (improved.length) {
    console.log(`\n${improved.length} file(s) improved — re-record the baseline to lock the gain in:`);
    improved.slice(0, 10).forEach((i) => console.log(`  ${i.file}  ${i.was} -> ${i.now}`));
  }
  if (!bad) console.log('typography guard: no new violations');
  process.exit(bad ? 1 : 0);
}
