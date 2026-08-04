/**
 * The dry run must not write.
 *
 * This is the safety property the whole rollout rests on: Aaron runs
 * --dry-run, reads the counts, and only then runs it live against every
 * user's contacts. If --dry-run wrote anything, the review step would be
 * happening after the fact.
 *
 * Asserting it by reading the code is not enough — the guard is four
 * conditions in three places (skip the batch.update, skip the commit, skip
 * the trailing commit) and any one of them could rot. So: run the real script
 * against a fake Firestore and assert that nothing was ever written, and that
 * the summary reports both values separately.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { join } from 'path';

const SCRIPT = join('scripts', 'backfillContactIsArchived.mjs');

// Contacts spanning every branch of the rule.
const CONTACTS = [
  { id: 'c1', name: 'Gentry Moyes' },                                              // → false
  { id: 'c2', name: 'Angela Phillips', archived_at: null },                        // → false
  { id: 'c3', name: 'Skipped Sam', status: 'people_mode_skipped' },                // → false
  { id: 'c4', name: 'Rejected Rita', status: 'people_mode_archived',
    archived_at: '2026-01-04T00:00:00.000Z' },                                     // → true
  { id: 'c5', name: 'Archived Al', archived_at: '2026-01-04T00:00:00.000Z' },      // → true
  { id: 'c6', name: 'Already Set', is_archived: false },                           // skipped
];

const updates = [];
const commits = [];

function fakeSnapshot(docs) {
  return {
    empty: docs.length === 0,
    docs: docs.map(d => ({ id: d.id, data: () => d, ref: { id: d.id } })),
  };
}

vi.mock('firebase-admin/app', () => ({
  // Non-empty so the script skips initialisation entirely.
  getApps: () => [{ name: 'stub' }],
  initializeApp: vi.fn(),
  cert: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: (name) => {
      if (name !== 'users') throw new Error(`unexpected root collection: ${name}`);
      return {
        get: async () => fakeSnapshot([{ id: 'user-1' }]),
        doc: () => ({
          collection: (sub) => {
            if (sub !== 'contacts') throw new Error(`unexpected subcollection: ${sub}`);
            return { get: async () => fakeSnapshot(CONTACTS) };
          },
        }),
      };
    },
    batch: () => ({
      update: (ref, data) => updates.push({ ref, data }),
      commit: async () => { commits.push(true); },
    }),
  }),
}));

let output = '';

beforeAll(async () => {
  // globalThis.process, because the eslint config declares browser globals
  // only and this is one of the few tests that genuinely needs the Node one.
  vi.spyOn(globalThis.process, 'exit').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation((...parts) => { output += parts.join(' ') + '\n'; });

  // The script only runs when invoked directly, so pose as the CLI.
  globalThis.process.argv = ['node', SCRIPT, '--dry-run'];

  await import('../../scripts/backfillContactIsArchived.mjs');
  await vi.waitFor(() => expect(output).toContain('Summary'), { timeout: 4000 });
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('backfill --dry-run', () => {
  it('writes nothing at all', () => {
    expect(updates).toEqual([]);
    expect(commits).toEqual([]);
  });

  it('says plainly that it is not writing', () => {
    expect(output).toContain('NO WRITES WILL BE MADE');
    expect(output).toContain('Nothing was written.');
  });

  it('counts the documents it would update, split by the value each gets', () => {
    // c4 and c5 carry archival evidence; c1, c2 and c3 do not; c6 already has
    // the field and is left alone.
    expect(output).toMatch(/would set is_archived: true\s+2/);
    expect(output).toMatch(/would set is_archived: false\s+3/);
    expect(output).toMatch(/already had the field:\s+1/);
    expect(output).toMatch(/total documents to update:\s+5/);
    expect(output).toMatch(/contacts scanned:\s+6/);
  });

  it('names the contacts it would archive, so an implausible number is visible', () => {
    expect(output).toContain('Rejected Rita');
    expect(output).toContain('Archived Al');
    expect(output).toContain('These will disappear from search.');
    // The ones staying searchable must not be in that list.
    expect(output).not.toMatch(/Contacts being archived[\s\S]*Gentry Moyes/);
  });
});
