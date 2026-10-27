/**
 * How long the scheduled and long-running Netlify functions really take
 * (#734, Phase 0, question 4).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  READ-ONLY. Measures; never changes anything. It writes nothing,         ║
 * ║  anywhere, and prints only function names, counts and seconds.           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * SOURCES (either or both)
 *
 *   --logs <file>  Netlify function logs saved as JSON Lines by the Netlify CLI:
 *
 *       netlify logs --source functions --since 7d --json \
 *         --function gmail-sync-worker --function process-barry-inbox-queue \
 *         --function process-scheduled-engagements --function process-barry-queue \
 *         --function daily-leads-refresh > function-logs.jsonl
 *
 *     A duration is read from three kinds of line:
 *       · the platform's line for each invocation: "Duration: 1234.5 ms"
 *       · the function's own summary: `durationMs: 1234` (the five scheduled
 *         jobs) or "Generation time: 12.34s" (the RECON and ICP generators)
 *       · "Task timed out after 30.03 seconds": a run the platform stopped.
 *         Its number is the limit actually enforced on that function.
 *     May be given more than once.
 *
 *   --firestore    The generation time each RECON section saved with its
 *     result, for all time: dashboards/{uid} → module "recon" → sections[].
 *     data.metadata.generationTime, and the older users/{uid}.section{N}Output.
 *     metadata.generationTime. A run that timed out saved nothing, so these are
 *     the runs that finished. Needs FIREBASE_SERVICE_ACCOUNT_PATH: a key for a
 *     service account with read-only Firestore access (roles/datastore.viewer).
 *     The project comes from the key; nothing is hard-coded.
 *
 * USAGE
 *   node scripts/measureFunctionDurations.mjs --logs function-logs.jsonl
 *   FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/read-only-key.json \
 *     node scripts/measureFunctionDurations.mjs --firestore [--logs <file>] [--json]
 *
 * PRIVACY: a log message, a user id and any stored value other than a duration
 * never reach the output.
 *
 * EXIT CODES: 0 completed; 1 did not complete (bad arguments, an unreadable
 * file, credentials, or a Firestore error).
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/** Seconds. A run longer than each is counted: the limits #734 has to choose between. */
export const THRESHOLDS = Object.freeze([10, 26, 30, 60, 300, 900]);
export const RECON_SECTIONS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

const USAGE = `
Usage:
  node scripts/measureFunctionDurations.mjs --logs <function-logs.jsonl> [--logs <more.jsonl>] [--json]
  FIREBASE_SERVICE_ACCOUNT_PATH=<read-only-key.json> node scripts/measureFunctionDurations.mjs --firestore [--json]
`;

class UsageError extends Error {}

// ─── Reading one log line ────────────────────────────────────────────────────

const TIMED_OUT = /Task timed out after\s*([\d.]+)\s*seconds/i;
const PLATFORM = /(?<!Init |Billed )Duration:\s*([\d.]+)\s*ms/;
const OWN_MS = /durationMs["']?\s*:\s*(\d+(?:\.\d+)?)/;
const OWN_GENERATION = /Generation time:\s*([\d.]+)\s*s\b/;

/**
 * The duration a log entry reports, or null.
 * @returns {{ kind: 'timeout' | 'platform' | 'own', seconds: number } | null}
 */
export function readLogEntry(entry) {
  const message = typeof entry?.message === 'string' ? entry.message : '';
  const read = (pattern, kind, scale) => {
    const match = pattern.exec(message);
    const seconds = match ? Number(match[1]) * scale : NaN;
    return Number.isFinite(seconds) ? { kind, seconds } : null;
  };
  return read(TIMED_OUT, 'timeout', 1)
    ?? read(PLATFORM, 'platform', 1 / 1000)
    ?? read(OWN_MS, 'own', 1 / 1000)
    ?? read(OWN_GENERATION, 'own', 1);
}

/** JSON Lines → entries. A line that is not JSON is counted, never echoed. */
export function parseJsonLines(text) {
  const entries = [];
  let unreadable = 0;
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      unreadable += 1;
    }
  }
  return { entries, unreadable };
}

// ─── Summaries ───────────────────────────────────────────────────────────────

const round = seconds => Math.round(seconds * 10) / 10;

/** Nearest-rank percentiles, the maximum, and how many runs passed each threshold. */
export function stats(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return { runs: 0 };
  const at = q => round(sorted[Math.ceil(q * sorted.length) - 1]);
  return {
    runs: sorted.length,
    p50: at(0.5),
    p90: at(0.9),
    p95: at(0.95),
    max: round(sorted[sorted.length - 1]),
    over: Object.fromEntries(THRESHOLDS.map(t => [t, sorted.filter(v => v > t).length])),
  };
}

export function summarizeLogs(entries) {
  const byFunction = new Map();
  let first = null;
  let last = null;
  for (const entry of entries) {
    const time = Date.parse(entry?.timestamp);
    if (Number.isFinite(time)) {
      if (first === null || time < first) first = time;
      if (last === null || time > last) last = time;
    }
    const reading = readLogEntry(entry);
    if (!reading) continue;
    const name = typeof entry.name === 'string' && /^[\w.-]{1,100}$/.test(entry.name) ? entry.name : '(unnamed)';
    if (!byFunction.has(name)) byFunction.set(name, { platform: [], own: [], timeout: [] });
    byFunction.get(name)[reading.kind].push(reading.seconds);
  }
  const functions = Object.fromEntries([...byFunction.keys()].sort().map(name => {
    const found = byFunction.get(name);
    return [name, {
      platform: stats(found.platform),
      own: stats(found.own),
      timedOut: { runs: found.timeout.length, after: [...new Set(found.timeout.map(round))].sort((a, b) => a - b) },
    }];
  }));
  return {
    lines: entries.length,
    from: first === null ? null : new Date(first).toISOString(),
    to: last === null ? null : new Date(last).toISOString(),
    functions,
  };
}

const seconds = value => {
  const n = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Generation times on a dashboards/{uid} document: [{ section, seconds }]. */
export function generationTimesFromDashboard(data) {
  const modules = Array.isArray(data?.modules) ? data.modules : [];
  return modules
    .filter(module => module?.id === 'recon' && Array.isArray(module.sections))
    .flatMap(module => module.sections)
    .map(section => ({ section: Number(section?.sectionId), seconds: seconds(section?.data?.metadata?.generationTime) }))
    .filter(row => RECON_SECTIONS.includes(row.section) && row.seconds !== null);
}

/** Generation times on a users/{uid} document (the older section{N}Output fields). */
export function generationTimesFromUser(data) {
  return RECON_SECTIONS
    .map(section => ({ section, seconds: seconds(data?.[`section${section}Output`]?.metadata?.generationTime) }))
    .filter(row => row.seconds !== null);
}

export function summarizeGenerations({ dashboards = [], users = [] }) {
  const rows = [
    ...dashboards.flatMap(data => generationTimesFromDashboard(data).map(row => ({ ...row, source: 'dashboards' }))),
    ...users.flatMap(data => generationTimesFromUser(data).map(row => ({ ...row, source: 'users' }))),
  ];
  const sections = Object.fromEntries(RECON_SECTIONS.map(section => {
    const mine = rows.filter(row => row.section === section);
    return [section, {
      ...stats(mine.map(row => row.seconds)),
      fromDashboards: mine.filter(row => row.source === 'dashboards').length,
      fromUsers: mine.filter(row => row.source === 'users').length,
    }];
  }));
  return { documents: { dashboards: dashboards.length, users: users.length }, all: stats(rows.map(row => row.seconds)), sections };
}

// ─── Output ──────────────────────────────────────────────────────────────────

const COLUMNS = ['runs', 'p50', 'p90', 'p95', 'max', ...THRESHOLDS.map(t => `>${t}s`)];

function row(label, s) {
  const cells = s.runs
    ? [s.runs, s.p50, s.p90, s.p95, s.max, ...THRESHOLDS.map(t => s.over[t])]
    : [0, '', '', '', '', ...THRESHOLDS.map(() => '')];
  return `  ${label.padEnd(44)}${cells.map(c => String(c).padStart(7)).join('')}`.trimEnd();
}

export function formatText(report) {
  const out = ['Function durations, in seconds (#734 Phase 0, question 4). Read-only; counts and seconds only.', ''];
  const header = `  ${''.padEnd(44)}${COLUMNS.map(c => c.padStart(7)).join('')}`;
  if (report.logs) {
    const { logs } = report;
    out.push(`Function logs: ${logs.lines} lines${logs.unreadable ? ` (${logs.unreadable} not JSON, skipped)` : ''}, ${logs.from ?? '?'} to ${logs.to ?? '?'}`);
    out.push(header);
    const names = Object.keys(logs.functions);
    if (names.length === 0) out.push('  (no duration lines found)');
    for (const name of names) {
      const f = logs.functions[name];
      out.push(row(`${name} · platform`, f.platform));
      out.push(row(`${name} · own summary`, f.own));
      out.push(`  ${`${name} · timed out`.padEnd(44)}${String(f.timedOut.runs).padStart(7)}${f.timedOut.runs ? `   after ${f.timedOut.after.join(' s, ')} s` : ''}`);
    }
    out.push('');
  }
  if (report.firestore) {
    const { firestore } = report;
    out.push(`RECON generation time saved with each result (all time): ${firestore.documents.dashboards} dashboards, ${firestore.documents.users} users read`);
    out.push(header);
    for (const section of RECON_SECTIONS) {
      const s = firestore.sections[section];
      out.push(`${row(`generate-section-${section}`, s)}${s.runs ? `   (${s.fromDashboards} dashboards, ${s.fromUsers} users)` : ''}`);
    }
    out.push(row('all sections', firestore.all));
    out.push('');
  }
  return `${out.join('\n')}\n`;
}

// ─── Arguments ───────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const options = { logs: [], firestore: false, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--firestore') options.firestore = true;
    else if (arg === '--logs') {
      const file = argv[i + 1];
      if (!file || file.startsWith('--')) throw new UsageError('--logs needs a file');
      options.logs.push(file);
      i += 1;
    } else if (arg.startsWith('--logs=')) options.logs.push(arg.slice('--logs='.length));
    else throw new UsageError(`unknown argument ${arg}`);
  }
  if (!options.help && options.logs.length === 0 && !options.firestore) {
    throw new UsageError('give --logs <file>, --firestore, or both');
  }
  return options;
}

function readLogFiles(files, readFile) {
  let entries = [];
  let unreadable = 0;
  for (const file of files) {
    let text;
    try {
      text = readFile(file);
    } catch {
      throw new UsageError(`could not read the log file ${file}`);
    }
    const parsed = parseJsonLines(text);
    entries = entries.concat(parsed.entries);
    unreadable += parsed.unreadable;
  }
  return { ...summarizeLogs(entries), unreadable };
}

// ═══ FIRESTORE READS — BEGIN ═════════════════════════════════════════════════
// The only section that touches the database. Read methods only: collection,
// select, get. A test fails the build if a write method, or database access
// outside this section, appears.

/** Open Firestore with the read-only service-account key. No other credential is tried. */
export async function connectReadOnly(env = process.env) {
  const keyPath = typeof env.FIREBASE_SERVICE_ACCOUNT_PATH === 'string' ? env.FIREBASE_SERVICE_ACCOUNT_PATH.trim() : '';
  if (!keyPath) {
    throw new UsageError('FIREBASE_SERVICE_ACCOUNT_PATH is required: a key for a service account with read-only Firestore access (roles/datastore.viewer)');
  }
  let key;
  try {
    key = JSON.parse(readFileSync(keyPath, 'utf8'));
  } catch {
    // Never echo the parse error: it can quote the key file.
    throw new UsageError('FIREBASE_SERVICE_ACCOUNT_PATH could not be read as a service-account key');
  }
  if (typeof key?.project_id !== 'string' || !key.project_id) throw new UsageError('the service-account key has no project_id');
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const app = initializeApp({ credential: cert(key), projectId: key.project_id }, `function-durations-${Date.now()}`);
  return getFirestore(app);
}

/** Every dashboard's modules and every user's ten generation-time fields; nothing else is read. */
export async function collectGenerations(db) {
  const userFields = RECON_SECTIONS.map(section => `section${section}Output.metadata.generationTime`);
  const [dashboards, users] = await Promise.all([
    db.collection('dashboards').select('modules').get(),
    db.collection('users').select(...userFields).get(),
  ]);
  return {
    dashboards: dashboards.docs.map(snapshot => snapshot.data()),
    users: users.docs.map(snapshot => snapshot.data()),
  };
}
// ═══ FIRESTORE READS — END ═══════════════════════════════════════════════════

/**
 * Run the measurement. Returns the exit code. `db` and `readFile` are injected
 * by tests; otherwise the read-only key and the file system are used.
 */
export async function main(argv = process.argv.slice(2), {
  db = null, env = process.env, readFile = file => readFileSync(file, 'utf8'),
  write = s => process.stdout.write(s), warn = s => process.stderr.write(s),
} = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    warn(`function durations: ${error.message}\n${USAGE}`);
    return 1;
  }
  if (options.help) {
    write(USAGE);
    return 0;
  }
  try {
    const report = { readOnly: true };
    if (options.logs.length) report.logs = readLogFiles(options.logs, readFile);
    if (options.firestore) report.firestore = summarizeGenerations(await collectGenerations(db ?? await connectReadOnly(env)));
    write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatText(report));
    return 0;
  } catch (error) {
    const reason = error instanceof UsageError ? error.message : `${error?.code ?? error?.name ?? 'Error'}: ${error?.message ?? ''}`;
    warn(`function durations did not complete: ${reason}\n`);
    return 1;
  }
}

// Run only when invoked directly. Importing this module (the tests do) must
// not open a Firestore connection or read a key file.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().then(code => process.exit(code), () => process.exit(1));
}
