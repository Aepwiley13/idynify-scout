/**
 * #734 Phase 0, question 4: scripts/measureFunctionDurations.mjs.
 *
 * It must be read-only and private: these tests run it end to end against an
 * in-memory Firestore that throws on any write method, read the log lines the
 * functions actually print, scan its source for write calls, and prove no log
 * message, user id or stored value other than a duration reaches the output.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  readLogEntry, parseJsonLines, stats, summarizeLogs, generationTimesFromDashboard, generationTimesFromUser,
  summarizeGenerations, parseArgs, main, FUNCTIONS,
} from '../../scripts/measureFunctionDurations.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = readFileSync(resolve(repo, 'scripts/measureFunctionDurations.mjs'), 'utf8');

const WRITE_METHODS = new Set(['set', 'update', 'delete', 'add', 'create', 'batch', 'commit', 'runTransaction', 'bulkWriter', 'recursiveDelete']);

function fakeFirestore(collections) {
  const writes = [];
  const selects = {};
  const guard = (target, label) => new Proxy(target, {
    get(object, prop) {
      if (typeof prop === 'string' && WRITE_METHODS.has(prop)) {
        return () => { writes.push(`${label}.${prop}`); throw new Error(`write attempted: ${label}.${prop}`); };
      }
      return object[prop];
    },
  });
  const db = guard({
    collection: name => guard({
      select: (...fields) => {
        selects[name] = fields;
        return guard({
          get: async () => ({ docs: (collections[name] ?? []).map((data, i) => guard({ id: `${name}-${i}`, data: () => data }, `${name}/${i}`)) }),
        }, name);
      },
    }, name),
  }, 'db');
  return { db, writes, selects };
}

const line = (name, message, timestamp = '2026-10-20T10:00:00.000Z') => JSON.stringify({ source: 'functions', name, timestamp, level: 'info', message });

/** What the functions print today (see the console.log calls they make). */
const LOG = [
  line('gmail-sync-worker', 'gmail.sync.ok { usersConsidered: 3, usersSynced: 3, usersDeferred: 0, messagesProcessed: 12, usersFailed: 0, durationMs: 4200 }'),
  line('gmail-sync-worker', 'Duration: 4310.55 ms\tMemory Usage: 120 MB\tInit Duration: 410.20 ms'),
  line('gmail-sync-worker', 'gmail.sync.ok { usersConsidered: 3, usersSynced: 3, usersDeferred: 0, messagesProcessed: 0, usersFailed: 0, durationMs: 1800 }'),
  line('gmail-sync-worker', 'Duration: 1900.00 ms\tBilled Duration: 2000 ms\tMemory Usage: 118 MB'),
  line('gmail-sync-worker', 'Task timed out after 30.03 seconds', '2026-10-21T10:00:00.000Z'),
  line('process-barry-inbox-queue', 'barryinbox.scheduled.ok {"entriesSucceeded":2,"entriesFailed":0,"entriesSkipped":0,"durationMs":61000}'),
  line('process-barry-inbox-queue', '✅ process-barry-inbox-queue complete: 2 succeeded, 0 failed, 0 skipped in 61000ms'),
  line('generate-section-3', '⏱️  Generation time: 41.27s'),
  line('generate-section-3', 'Calling Claude for user kristin@brightpath.example (uid u_secret_123)'),
  'not json at all: kristin@brightpath.example',
].join('\n');

describe('reading a log line', () => {
  it('reads the platform line, the function\'s own summary, the generators\' line and a timeout', () => {
    expect(readLogEntry({ message: 'Duration: 4310.55 ms\tMemory Usage: 120 MB\tInit Duration: 410.20 ms' })).toEqual({ kind: 'platform', seconds: 4.31055 });
    expect(readLogEntry({ message: 'Init Duration: 410.20 ms' })).toBeNull();
    expect(readLogEntry({ message: 'Billed Duration: 2000 ms' })).toBeNull();
    expect(readLogEntry({ message: 'x { durationMs: 4200 }' })).toEqual({ kind: 'own', seconds: 4.2 });
    expect(readLogEntry({ message: '{"durationMs":61000}' })).toEqual({ kind: 'own', seconds: 61 });
    expect(readLogEntry({ message: '⏱️  Generation time: 41.27s' })).toEqual({ kind: 'own', seconds: 41.27 });
    expect(readLogEntry({ message: 'Task timed out after 30.03 seconds' })).toEqual({ kind: 'timeout', seconds: 30.03 });
  });

  it('does not count the text summaries that repeat a structured one', () => {
    expect(readLogEntry({ message: 'complete: 2 succeeded, 0 failed, 0 skipped in 61000ms' })).toBeNull();
    expect(readLogEntry({ message: '✅ process-barry-queue complete: 1 processed, 0 failed in 12.3s' })).toBeNull();
    expect(readLogEntry({ message: 42 })).toBeNull();
    expect(readLogEntry(null)).toBeNull();
  });

  it('only the five scheduled functions log durationMs, once per run, so nothing else is counted as a run', () => {
    const functions = resolve(repo, 'netlify/functions');
    const scheduled = ['daily-leads-refresh', 'gmail-sync-worker', 'process-barry-inbox-queue', 'process-barry-queue', 'process-scheduled-engagements'];
    const logging = readdirSync(functions, { recursive: true })
      .filter(file => /\.(?:m?js|cjs)$/.test(file))
      .filter(file => /durationMs/.test(readFileSync(resolve(functions, file), 'utf8')))
      .sort();
    expect(logging).toEqual(scheduled.map(name => `${name}.js`));
    for (const name of scheduled) {
      const source = readFileSync(resolve(functions, `${name}.js`), 'utf8');
      expect(source.match(/console\.log\([^;]*durationMs/gs) ?? [], name).toHaveLength(1);
    }
  });
});

describe('summaries', () => {
  it('nearest-rank percentiles, the maximum and the runs over each limit', () => {
    expect(stats([])).toEqual({ runs: 0 });
    const s = stats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
    expect(s).toMatchObject({ runs: 10, p50: 5, p90: 9, p95: 100, max: 100 });
    expect(s.over).toEqual({ 10: 1, 26: 1, 30: 1, 60: 1, 300: 0, 900: 0 });
  });

  it('groups the log by function, with the window and the limit a timeout shows', () => {
    const { entries, unreadable } = parseJsonLines(LOG);
    expect(unreadable).toBe(1);
    const report = summarizeLogs(entries);
    expect(report).toMatchObject({ lines: 9, from: '2026-10-20T10:00:00.000Z', to: '2026-10-21T10:00:00.000Z' });
    expect(Object.keys(report.functions)).toEqual(['generate-section-3', 'gmail-sync-worker', 'process-barry-inbox-queue']);
    expect(report.functions['gmail-sync-worker']).toMatchObject({
      platform: { runs: 2, max: 4.3 }, own: { runs: 2, p50: 1.8, max: 4.2 }, timedOut: { runs: 1, after: [30] },
    });
    expect(report.functions['process-barry-inbox-queue'].own).toMatchObject({ runs: 1, max: 61, over: { 60: 1 } });
    expect(report.functions['generate-section-3'].own).toMatchObject({ runs: 1, max: 41.3, over: { 26: 1, 30: 1, 60: 0 } });
  });

  it('reads generation times from dashboards and from the older users fields', () => {
    const dashboard = { modules: [
      { id: 'barry', sections: [{ sectionId: 1, data: { metadata: { generationTime: 999 } } }] },
      { id: 'recon', sections: [
        { sectionId: 1, data: { metadata: { generationTime: 22.5 }, companyName: 'Bright Path' } },
        { sectionId: 2, data: { metadata: {} } },
        { sectionId: 3, data: { metadata: { generationTime: '41' } } },
        { sectionId: 11, data: { metadata: { generationTime: 5 } } },
        { sectionId: 4 },
      ] },
    ] };
    expect(generationTimesFromDashboard(dashboard)).toEqual([{ section: 1, seconds: 22.5 }]);
    expect(generationTimesFromDashboard({})).toEqual([]);
    expect(generationTimesFromUser({ section2Output: { metadata: { generationTime: 33 } }, section3Output: { metadata: { generationTime: -1 } } }))
      .toEqual([{ section: 2, seconds: 33 }]);
    const summary = summarizeGenerations({ dashboards: [dashboard], users: [{ section1Output: { metadata: { generationTime: 70 } } }] });
    expect(summary.sections[1]).toMatchObject({ runs: 2, max: 70, fromDashboards: 1, fromUsers: 1, over: { 26: 1, 60: 1 } });
    expect(summary.sections[5]).toEqual({ runs: 0, fromDashboards: 0, fromUsers: 0 });
    expect(summary.all.runs).toBe(2);
  });
});

describe('end to end', () => {
  const PRIVATE = ['kristin', 'brightpath', 'Bright Path', 'u_secret_123', 'uid-7', 'not json', 'Calling Claude'];

  it('logs and Firestore together: counts and seconds only, nothing written', async () => {
    const fake = fakeFirestore({
      dashboards: [{ modules: [{ id: 'recon', sections: [{ sectionId: 2, data: { metadata: { generationTime: 48.2 }, targetMarket: 'Bright Path schools' } }] }] }],
      users: [{ section1Output: { metadata: { generationTime: 19.9 } } }],
    });
    let out = '';
    let err = '';
    const code = await main(['--logs', 'logs.jsonl', '--firestore'], {
      db: fake.db, readFile: () => LOG, write: s => { out += s; }, warn: s => { err += s; },
    });
    expect(code).toBe(0);
    expect(err).toBe('');
    expect(fake.writes).toEqual([]);
    expect(fake.selects).toEqual({
      dashboards: ['modules'],
      users: Array.from({ length: 10 }, (_, i) => `section${i + 1}Output.metadata.generationTime`),
    });
    expect(out).toMatch(/gmail-sync-worker · timed out\s+1\s+after 30 s/);
    expect(out).toMatch(/generate-section-2\s+1\s+48\.2/);
    expect(out).toMatch(/generate-section-1\s+1\s+19\.9/);
    expect(PRIVATE.filter(value => out.includes(value))).toEqual([]);

    let json = '';
    await main(['--logs=logs.jsonl', '--json'], { readFile: () => LOG, write: s => { json += s; } });
    const report = JSON.parse(json);
    expect(report.readOnly).toBe(true);
    expect(report.logs.unreadable).toBe(1);
    expect(PRIVATE.filter(value => json.includes(value))).toEqual([]);
  });

  it('--netlify fetches every listed function\'s logs through the CLI, ten at a time, and keeps them in memory', async () => {
    const calls = [];
    const netlify = async args => {
      calls.push(args);
      const names = args.filter((_, i) => args[i - 1] === '--function');
      return names.includes('gmail-sync-worker') ? LOG : 'No logs found for the given time range.\n';
    };
    let out = '';
    expect(await main(['--netlify', '7d'], { netlify, write: s => { out += s; }, readFile: () => { throw new Error('no file reads'); } })).toBe(0);
    expect(calls.map(args => args.slice(0, 6))).toEqual(Array(3).fill(['logs', '--source', 'functions', '--since', '7d', '--json']));
    const asked = calls.flatMap(args => args.filter((_, i) => args[i - 1] === '--function'));
    expect(asked).toEqual([...FUNCTIONS]);
    expect(calls.every(args => args.filter(a => a === '--function').length <= 10)).toBe(true);
    expect(out).toMatch(/last 7d of 21 functions/);
    expect(out).toMatch(/gmail-sync-worker · timed out\s+1\s+after 30 s/);
    expect(out).not.toMatch(/kristin|u_secret_123|Calling Claude/);
  });

  it('measures functions that exist', () => {
    for (const name of FUNCTIONS) expect(existsSync(resolve(repo, `netlify/functions/${name}.js`)), name).toBe(true);
  });

  it('refuses bad arguments, a missing key and an unreadable file without echoing them', async () => {
    expect(() => parseArgs([])).toThrow(/--netlify <since>, --logs <file>, --firestore/);
    expect(() => parseArgs(['--logs'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--netlify', 'forever'])).toThrow(/24h or 7d/);
    expect(parseArgs(['--netlify=24h']).netlify).toBe('24h');
    expect(() => parseArgs(['--apply'])).toThrow(/unknown argument/);
    let err = '';
    expect(await main(['--firestore'], { env: {}, warn: s => { err += s; } })).toBe(1);
    expect(err).toMatch(/FIREBASE_SERVICE_ACCOUNT_PATH is required/);
    err = '';
    expect(await main(['--logs', 'x.jsonl'], { readFile: () => { throw new Error('ENOENT kristin'); }, warn: s => { err += s; } })).toBe(1);
    expect(err).toMatch(/could not read the log file x\.jsonl/);
    expect(err).not.toMatch(/kristin/);
  });
});

// ─── Read-only at the source ─────────────────────────────────────────────────

function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}
const BEGIN = '// ═══ FIRESTORE READS — BEGIN';
const END = '// ═══ FIRESTORE READS — END';

describe('read-only at the source', () => {
  it('calls no write method, has no write flag, and touches the database only in its one section', () => {
    expect(SCRIPT.split(BEGIN)).toHaveLength(2);
    expect(SCRIPT.split(END)).toHaveLength(2);
    const all = code(SCRIPT);
    // set() and add() are also Map and Set methods, so they are banned only where the database is.
    expect(all).not.toMatch(/\.(?:update|delete|create|batch|commit|runTransaction|bulkWriter|recursiveDelete)\s*\(|\bFieldValue\b/);
    expect(all).not.toMatch(/--(?:apply|live|write|fix|commit|execute)\b/);
    const begin = SCRIPT.indexOf(BEGIN);
    const end = SCRIPT.indexOf(END);
    const access = /\.(?:collection|collectionGroup|doc|listDocuments|getAll)\s*\(|\bgetFirestore\b|\binitializeApp\b/;
    expect(code(SCRIPT.slice(begin, end))).toMatch(access);
    expect(code(SCRIPT.slice(begin, end))).not.toMatch(/\.(?:set|add)\s*\(/);
    expect(code(SCRIPT.slice(0, begin) + SCRIPT.slice(end))).not.toMatch(access);
  });

  it('has no hard-coded project and only one credential path', () => {
    expect(SCRIPT).not.toMatch(/projectId:\s*['"`]/);
    expect(SCRIPT).not.toMatch(/idynify-/);
    expect(SCRIPT).not.toMatch(/GOOGLE_APPLICATION_CREDENTIALS|applicationDefault/);
    expect(code(SCRIPT)).toMatch(/env\.FIREBASE_SERVICE_ACCOUNT_PATH/);
  });
});
