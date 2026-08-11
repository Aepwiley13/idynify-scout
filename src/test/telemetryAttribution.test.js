/**
 * TELEMETRY ATTRIBUTION (A2) — Unit and Contract Tests
 *
 * A2 was "Anthropic spend logged as Apollo credits". It was closed when the
 * success paths started recording provider/model, but every AI error path was
 * missed: those calls omitted `provider`, so logApiUsage defaulted them to
 * 'apollo' and each Claude failure incremented the Apollo credit counter.
 *
 * These tests pin the three properties A2 re-closes against:
 *   1. Anthropic success paths record provider='anthropic' and a resolved model
 *   2. Anthropic error paths record provider='anthropic' and a resolved model
 *   3. Anthropic calls never increment Apollo credit counters
 *
 * The contract test is deliberately static. 15 of the 16 endpoints that
 * resolve a model through models.js have no runtime test of their own, and the
 * production build does not bundle netlify/ — so a regression in any of them
 * is invisible to both. Scanning the source is the only guard that covers all
 * of them at once.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from this file, not the working directory — vitest may be invoked
// from anywhere, and process is not defined under the browser eslint config.
const FN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'netlify', 'functions');

const mockAdd = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'log-1' }));
const mockSet = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  db: {
    collection: vi.fn(() => ({
      add: mockAdd,
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({ doc: vi.fn(() => ({ set: mockSet })) })),
        set: mockSet,
      })),
    })),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => '__ts__',
    increment: (n) => ({ __increment: n }),
  },
}));

import { logApiUsage } from '../../netlify/functions/utils/logApiUsage.js';

/** The apiLogs row written by the most recent logApiUsage call. */
const lastLogEntry = () => mockAdd.mock.calls.at(-1)[0];
/** The per-user rolling summary update from the most recent call. */
const lastSummary = () => mockSet.mock.calls.at(-1)[0];

beforeEach(() => {
  mockAdd.mockClear();
  mockSet.mockClear();
});

describe('A2 — Anthropic failures must not be booked as Apollo credits', () => {
  it('records creditsUsed 0 for an Anthropic success', async () => {
    await logApiUsage('user-1', 'barryCSMRead', 'success', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    const entry = lastLogEntry();
    expect(entry.provider).toBe('anthropic');
    expect(entry.model).toBe('claude-sonnet-4-6');
    expect(entry.creditsUsed).toBe(0);
    expect(entry.endpoint).toBe('ANTHROPIC_BARRYCSMREAD');
  });

  it('records creditsUsed 0 for an Anthropic failure', async () => {
    await logApiUsage('user-1', 'barryCSMRead', 'error', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      errorCode: 'overloaded_error',
    });

    const entry = lastLogEntry();
    expect(entry.provider).toBe('anthropic');
    expect(entry.model).toBe('claude-sonnet-4-6');
    expect(entry.status).toBe('error');
    expect(entry.creditsUsed).toBe(0);
  });

  it('never adds totalCredits to the summary for an Anthropic failure', async () => {
    await logApiUsage('user-1', 'barryCSMRead', 'error', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      errorCode: 'overloaded_error',
    });

    const summary = lastSummary();
    expect(summary).not.toHaveProperty('totalCredits');
    expect(summary).toHaveProperty('calls_anthropic');
    expect(summary).not.toHaveProperty('calls_apollo');
  });

  it('still books a real Apollo call as one credit — the fix must not zero Apollo', async () => {
    await logApiUsage('user-1', 'searchPeople', 'success', { provider: 'apollo' });

    expect(lastLogEntry().creditsUsed).toBe(1);
    expect(lastSummary().totalCredits).toEqual({ __increment: 1 });
  });

  it('reproduces the A2 defect when provider is omitted', async () => {
    // This is the pre-fix shape: an AI failure logged with no provider.
    // It documents *why* every AI call site must pass provider explicitly —
    // the default is apollo, and apollo bears credits.
    await logApiUsage('user-1', 'barryCSMRead', 'error', { errorCode: 'boom' });

    expect(lastLogEntry().provider).toBe('apollo');
    expect(lastLogEntry().creditsUsed).toBe(1);
  });
});

describe('environment is BARRY_ENV, and nothing else', () => {
  // vi.stubEnv rather than touching process.env directly: it restores cleanly
  // and keeps this file free of `process`, which the browser eslint config
  // does not define.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const envOf = async () => {
    await logApiUsage('user-1', 'barryCSMRead', 'success', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    });
    return lastLogEntry().environment;
  };

  it('records production when BARRY_ENV=production', async () => {
    vi.stubEnv('BARRY_ENV', 'production');
    await expect(envOf()).resolves.toBe('production');
  });

  it('records deploy-preview when BARRY_ENV=deploy-preview', async () => {
    vi.stubEnv('BARRY_ENV', 'deploy-preview');
    await expect(envOf()).resolves.toBe('deploy-preview');
  });

  it('records unknown when BARRY_ENV is unset — it does not guess', async () => {
    vi.stubEnv('BARRY_ENV', undefined);
    await expect(envOf()).resolves.toBe('unknown');
  });

  it('ignores the Firebase project entirely (established during P0B environment configuration (2026-08-08))', async () => {
    // The physical database and the logical environment are independent.
    // A project ID containing "dev" must not colour the label, and its absence
    // must not either — this is the specific defect being retired.
    vi.stubEnv('BARRY_ENV', undefined);
    vi.stubEnv('FIREBASE_PROJECT_ID', 'idynify-scout-dev');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'idynify-scout-dev');
    await expect(envOf()).resolves.toBe('unknown');

    vi.stubEnv('BARRY_ENV', 'production');
    vi.stubEnv('FIREBASE_PROJECT_ID', 'idynify-scout-dev');
    await expect(envOf()).resolves.toBe('production');
  });

  it('passes the value through verbatim — no normalising, no mapping', async () => {
    vi.stubEnv('BARRY_ENV', 'branch-deploy');
    await expect(envOf()).resolves.toBe('branch-deploy');
  });
});

// ── Contract test across every AI call site ────────────────────────────────

/** Extract each logApiUsage(...) call from a source file, brackets balanced. */
function extractCalls(source) {
  const out = [];
  const re = /logApiUsage\s*\(/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    let depth = 0;
    for (let i = m.index; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          out.push(source.slice(m.index, i + 1));
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Files whose model is resolved through models.js — the AI surface.
 * Anything importing a tier or legacy constant calls Anthropic.
 */
function aiFunctionFiles() {
  return readdirSync(FN_DIR)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ name: f, source: readFileSync(join(FN_DIR, f), 'utf8') }))
    .filter(({ source }) => /from '\.\/utils\/models\.js'/.test(source));
}

/**
 * The two analyze-website guards that fire before the Anthropic client is
 * constructed. They are not AI failures — a site fetch failure and a
 * body-too-short bail — so tagging them 'anthropic' would inflate the AI error
 * rate with website-fetch failures. Excluded deliberately, not overlooked.
 */
// Matched on the errorCode value itself. The fetch guard builds its code from
// a template literal, so anchoring on `errorCode: '` would miss it.
const PRE_CLAUDE_GUARDS = [/errorCode:\s*`fetch_\$\{fetchResult\.reason\}`/, /errorCode:\s*'js_rendered'/];

const isPreClaudeGuard = (call) => PRE_CLAUDE_GUARDS.some((re) => re.test(call));

describe('A2 — every AI call site tags provider and model', () => {
  const files = aiFunctionFiles();

  it('finds the AI surface', () => {
    expect(files.length).toBeGreaterThanOrEqual(16);
  });

  it.each(files.map((f) => f.name))('%s tags every Anthropic call', (name) => {
    const { source } = files.find((f) => f.name === name);
    const untagged = extractCalls(source)
      .filter((call) => !isPreClaudeGuard(call))
      .filter((call) => !/provider:\s*'anthropic'/.test(call) || !/model:/.test(call));

    // A file may legitimately log non-Anthropic operations, so only calls that
    // already declare the anthropic provider — or that omit provider entirely
    // inside an AI file — are in scope.
    const inScope = untagged.filter((call) => /provider:\s*'anthropic'/.test(call) || !/provider:/.test(call));

    expect(inScope, `untagged logApiUsage call(s) in ${name}:\n${inScope.join('\n---\n')}`).toEqual([]);
  });

  it('leaves exactly the two pre-Claude guards untagged, and no others', () => {
    const guards = files.flatMap(({ name, source }) =>
      extractCalls(source).filter(isPreClaudeGuard).map(() => name),
    );
    expect(guards).toEqual(['analyze-website.js', 'analyze-website.js']);
  });
});
