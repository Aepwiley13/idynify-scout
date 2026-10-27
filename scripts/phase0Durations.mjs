/**
 * Phase 0 (#734): how long the scheduled and long-running functions really run.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  READ-ONLY. It reads Firestore and listens to Netlify's live function    ║
 * ║  logs. It writes nothing to Firestore or Netlify and invokes nothing.    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Netlify keeps no function-log history that its API or CLI can read back:
 * `netlify logs:function` only streams what happens while it is connected. So
 * the evidence comes from two places:
 *
 *   recon   Firestore. Each successful RECON generation stores its own
 *           `metadata.generationTime` (seconds), on users/{uid}.section{N}Output
 *           or on dashboards/{uid} → modules[recon].sections[N].data. Only the
 *           latest success per user and section is kept, and a run that timed
 *           out stores nothing.
 *
 *           FIREBASE_SERVICE_ACCOUNT_PATH=<read-only key> node scripts/phase0Durations.mjs recon
 *
 *   logs    Netlify's live function logs for every target at once, for a fixed
 *           window. Durations come from the functions' own `durationMs` /
 *           "Generation time" lines and from any platform "Duration: … ms"
 *           line; "timed out" lines are counted as timeouts. Raw lines go to
 *           .netlify/phase0-logs/ (gitignored); only numbers are printed.
 *           Needs `netlify login` and `netlify link` first. Start it a few
 *           minutes before 09:00 UTC on a weekday so the two daily jobs run
 *           inside the window.
 *
 *           node scripts/phase0Durations.mjs logs [--minutes=75]
 *
 * PRIVACY: the summary holds function names, counts and durations only.
 */

import { readFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import process from 'node:process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const NETLIFY_CLI = fileURLToPath(new URL('../node_modules/netlify-cli/bin/run.js', import.meta.url));

export const SCHEDULED = [
  'daily-leads-refresh', 'process-barry-queue', 'process-scheduled-engagements',
  'process-barry-inbox-queue', 'gmail-sync-worker',
];
export const SECTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const LONG_RUNNING = ['generate-icp-brief', 'generate-all-reports', ...SECTIONS.map(n => `generate-section-${n}`)];

// ─── Pure ────────────────────────────────────────────────────────────────────

const ANSI = /\u001b\[[0-9;]*m/g;

/** What one log line says about a run: its duration, a timeout, a partial failure. */
export function readLogLine(line) {
  const s = String(line).replace(ANSI, '');
  const found = {};
  let m;
  if ((m = s.match(/durationMs['"]?\s*[:=]\s*(\d+(?:\.\d+)?)/))) found.appMs = Number(m[1]);
  else if ((m = s.match(/Generation time:\s*(\d+(?:\.\d+)?)s/))) found.appMs = Number(m[1]) * 1000;
  if ((m = s.match(/(?<!Init |Billed )Duration:\s*(\d+(?:\.\d+)?)\s*ms/i))) found.platformMs = Number(m[1]);
  if (/timed out/i.test(s)) found.timedOut = true;
  if (/partial_failure/.test(s)) found.partial = true;
  if (/Could not find function|No functions found/.test(s)) found.notFound = true;
  return found;
}

/** n, median, p90 and max, in seconds. */
export function stats(ms) {
  if (!ms.length) return null;
  const sorted = [...ms].sort((a, b) => a - b);
  const at = q => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  const s = v => Math.round(v / 100) / 10;
  return { n: sorted.length, median: s(at(0.5)), p90: s(at(0.9)), max: s(sorted[sorted.length - 1]) };
}

/** How many runs fall under each limit that could apply (10 s, 26 s, 30 s, 60 s, 15 min). */
export function buckets(ms) {
  const edges = [10, 26, 30, 60, 900];
  const counts = Object.fromEntries([...edges.map(e => [`<=${e}s`, 0]), ['>900s', 0]]);
  for (const v of ms) {
    const edge = edges.find(e => v / 1000 <= e);
    counts[edge ? `<=${edge}s` : '>900s'] += 1;
  }
  return counts;
}

/** Generation times (ms) per RECON function from users and dashboards documents, each run counted once. */
export function reconDurations(userDocs, dashboardDocs, { since = null } = {}) {
  const seen = new Set();
  const byFn = Object.fromEntries(SECTIONS.map(n => [`generate-section-${n}`, { all: [], recent: [] }]));
  const add = (uid, n, seconds, completedAt) => {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return;
    const key = `${uid}|${n}|${seconds}`;
    if (seen.has(key)) return;
    seen.add(key);
    const entry = byFn[`generate-section-${n}`];
    if (!entry) return;
    entry.all.push(seconds * 1000);
    if (since && completedAt && new Date(completedAt) >= since) entry.recent.push(seconds * 1000);
  };
  for (const { id, data } of dashboardDocs) {
    const recon = (data.modules ?? []).find(m => m?.id === 'recon');
    for (const section of recon?.sections ?? []) {
      add(id, Number(section?.sectionId), section?.data?.metadata?.generationTime, section?.completedAt);
    }
  }
  for (const { id, data } of userDocs) {
    for (const n of SECTIONS) add(id, n, data[`section${n}Output`]?.metadata?.generationTime, null);
  }
  return byFn;
}

const row = (name, s, extra = '') =>
  `${name.padEnd(32)}${s ? `n=${String(s.n).padEnd(5)} median=${String(s.median).padEnd(7)}p90=${String(s.p90).padEnd(7)}max=${s.max}s` : 'no runs seen'}${extra}`;

// ─── recon: Firestore ────────────────────────────────────────────────────────

async function recon() {
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!keyPath) throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH is required: a key for a service account with read-only Firestore access (roles/datastore.viewer)');
  const key = JSON.parse(readFileSync(keyPath, 'utf8'));
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const db = getFirestore(initializeApp({ credential: cert(key), projectId: key.project_id }, `phase0-durations-${Date.now()}`));

  const fields = SECTIONS.map(n => `section${n}Output.metadata.generationTime`);
  const [users, dashboards] = await Promise.all([
    db.collection('users').select(...fields).get(),
    db.collection('dashboards').select('modules').get(),
  ]);
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const byFn = reconDurations(
    users.docs.map(d => ({ id: d.id, data: d.data() })),
    dashboards.docs.map(d => ({ id: d.id, data: d.data() })),
    { since },
  );

  console.log(`RECON generation times stored in Firestore (successful runs only; latest per user and section)\n`);
  const all = [];
  for (const [fn, { all: ms, recent }] of Object.entries(byFn)) {
    all.push(...ms);
    console.log(row(fn, stats(ms), recent.length ? `   (${recent.length} with a completedAt in the last 90 days)` : ''));
  }
  console.log(`\nAll sections: ${JSON.stringify(stats(all))}`);
  console.log(`By limit:     ${JSON.stringify(buckets(all))}`);
  console.log(`\ngenerate-icp-brief and generate-all-reports store no timing in Firestore (and have no caller in src/); use the logs mode for them.`);
}

// ─── logs: Netlify live function logs ────────────────────────────────────────

async function logs(minutes) {
  mkdirSync('.netlify/phase0-logs', { recursive: true });
  const rawPath = `.netlify/phase0-logs/${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  const raw = createWriteStream(rawPath);
  const seen = Object.fromEntries([...SCHEDULED, ...LONG_RUNNING].map(fn => [fn, { appMs: [], platformMs: [], timeouts: 0, partial: 0, lines: 0, notFound: false }]));

  const children = Object.keys(seen).map(fn => {
    // The repo's own netlify-cli, run directly so that kill() reaches the process holding the socket.
    const child = spawn(process.execPath, [NETLIFY_CLI, 'logs:function', fn], { stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on('line', line => {
        raw.write(`${new Date().toISOString()}\t${fn}\t${line.replace(ANSI, '')}\n`);
        const f = readLogLine(line);
        const s = seen[fn];
        s.lines += 1;
        if (f.appMs != null) s.appMs.push(f.appMs);
        if (f.platformMs != null) s.platformMs.push(f.platformMs);
        if (f.timedOut) s.timeouts += 1;
        if (f.partial) s.partial += 1;
        if (f.notFound) s.notFound = true;
      });
    }
    return child;
  });

  const until = new Date(Date.now() + minutes * 60_000);
  console.log(`Listening to ${children.length} functions until ${until.toISOString()} (Ctrl-C to stop early). Raw lines: ${rawPath}`);

  await new Promise(resolve => {
    const timer = setTimeout(resolve, minutes * 60_000);
    process.once('SIGINT', () => { clearTimeout(timer); resolve(); });
  });
  for (const child of children) child.kill();
  raw.end();

  console.log(`\nWindow: ${minutes} min. Durations in seconds. app = the function's own durationMs / "Generation time"; platform = Netlify's "Duration" line, when present.\n`);
  for (const [fn, s] of Object.entries(seen)) {
    if (s.notFound) { console.log(`${fn.padEnd(32)}not found on the linked site`); continue; }
    const notes = [
      s.platformMs.length && `platform: ${JSON.stringify(stats(s.platformMs))}`,
      s.timeouts && `TIMED OUT x${s.timeouts}`,
      s.partial && `partial_failure x${s.partial}`,
    ].filter(Boolean).join('  ');
    console.log(row(fn, stats(s.appMs), notes ? `   ${notes}` : ''));
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [mode, ...args] = process.argv.slice(2);
  const minutes = Number(args.find(a => a.startsWith('--minutes='))?.split('=')[1] ?? 75);
  const run = mode === 'recon' ? recon() : mode === 'logs' ? logs(minutes) : Promise.reject(new Error('Usage: node scripts/phase0Durations.mjs recon | logs [--minutes=75]'));
  run.then(() => process.exit(0), err => { console.error(err.message); process.exit(1); });
}
