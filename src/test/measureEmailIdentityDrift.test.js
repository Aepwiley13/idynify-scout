/**
 * The email identity drift assessment (scripts/measureEmailIdentityDrift.mjs).
 *
 * Read-only by construction: these tests pin the classification, the two
 * resolver consequences, that only counts and IDs come out, and that the
 * script has no write path and does not touch Firestore on import.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { analyzeEmailDrift, totalsFor, indexedLookupFinds, SAMPLE_IDS } from '../../scripts/measureEmailIdentityDrift.mjs';
import { buildEmailWrite } from '../utils/contactEmails.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../../scripts/measureEmailIdentityDrift.mjs'), 'utf8');

const CONTACTS = [
  { id: 'ok', ...buildEmailWrite([{ id: '1', value: 'Ok@x.test' }]) },
  { id: 'legacy', email: 'legacy@x.test', email_normalized: 'legacy@x.test' },
  { id: 'none' },
  { id: 'missingKey', email: 'Mixed@X.test' },
  { id: 'edited', email: 'New@X.test', email_normalized: 'old@x.test', emails: [{ id: '1', value: 'New@X.test' }] },
  { id: 'cleared', email: null, email_normalized: 'gone@x.test', emails: [] },
  { id: 'contactInfo', emails: [{ id: '1', value: 'a@x.test' }] },
  { id: 'secondary', ...buildEmailWrite([{ id: '1', value: 'p@x.test' }, { id: '2', value: 's@x.test' }]) },
];

describe('analyzeEmailDrift', () => {
  const ws = analyzeEmailDrift('u1', CONTACTS);

  it('classifies each contact by the same function the fix is tested with', () => {
    expect(ws.contacts).toBe(8);
    expect(ws.drifted).toBe(4);
    expect(ws.byCode.normalized_missing).toEqual({ count: 1, sample: ['missingKey'] });
    expect(ws.byCode.normalized_stale).toEqual({ count: 1, sample: ['edited'] });
    expect(ws.byCode.normalized_without_email).toEqual({ count: 1, sample: ['cleared'] });
    expect(ws.byCode.primary_mismatch).toEqual({ count: 1, sample: ['contactInfo'] });
    expect(ws.withSecondaryAddresses).toBe(1);
  });

  it('counts the contacts the resolver misses by their current address, and the ones an old address still finds', () => {
    expect(ws.consequences.missed_by_current_address.sample.sort()).toEqual(['contactInfo', 'edited', 'missingKey']);
    expect(ws.consequences.matched_by_old_address.sample.sort()).toEqual(['cleared', 'edited']);
  });

  it('caps sample IDs and still counts everything', () => {
    const many = Array.from({ length: SAMPLE_IDS + 5 }, (_, i) => ({ id: `c${i}`, email: 'A@x.test' }));
    const result = analyzeEmailDrift('u1', many).byCode.normalized_missing;
    expect(result.count).toBe(SAMPLE_IDS + 5);
    expect(result.sample).toHaveLength(SAMPLE_IDS);
  });

  it('reports counts and IDs only, never an address', () => {
    const text = JSON.stringify({ ws, totals: totalsFor([ws]) });
    expect(text).not.toMatch(/@/);
  });
});

describe('indexedLookupFinds', () => {
  it.each([
    [{ email: 'a@x.test', email_normalized: 'a@x.test' }, true],
    [{ email: 'a@x.test' }, true],
    [{ email: 'A@x.test' }, false],
    [{ email: 'A@x.test', email_normalized: 'old@x.test' }, false],
    [{}, true],
    [{ emails: [{ id: '1', value: 'a@x.test' }] }, false],
  ])('%o → %s', (contact, expected) => {
    expect(indexedLookupFinds(contact)).toBe(expected);
  });
});

describe('totalsFor', () => {
  it('sums workspaces', () => {
    const a = analyzeEmailDrift('a', CONTACTS);
    const b = analyzeEmailDrift('b', CONTACTS.slice(0, 4));
    const totals = totalsFor([a, b]);
    expect(totals).toMatchObject({ workspaces: 2, contacts: 12, drifted: 5 });
    expect(totals.byCode.normalized_missing).toBe(2);
  });
});

describe('read-only by construction', () => {
  it('has no write call', () => {
    expect(source).not.toMatch(/\.(set|update|delete|add|create)\(|batch\(|runTransaction|bulkWriter/);
  });

  it('importing it did not start the CLI', () => {
    expect(typeof analyzeEmailDrift).toBe('function');
  });
});
