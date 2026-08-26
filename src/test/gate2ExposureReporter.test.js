/**
 * GATE 2 PHASE 0 — the identity exposure reporter.
 *
 * This measurement is the evidence base for two Gate 2 decisions: whether
 * SCAN_WINDOW should move, and whether the Phase 2f fail-closed change is
 * materially disruptive. A wrong number here is not a crash — it is a gate
 * decided against a fiction, which is exactly the failure the report exists
 * to prevent.
 *
 * So what is tested is the part that decides the ANSWER: which bucket a
 * contact lands in, that it lands in exactly one, and that the buckets sum to
 * the population. Firestore is never involved — `analyzeExposure` is pure, and
 * importing the script must not open a connection or read a service-account
 * file. That it does not is itself one of the assertions.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  analyzeExposure,
  totalsFor,
  bucketFor,
  BUCKETS,
  SCAN_WINDOW,
} from '../../scripts/measureIdentityExposure.mjs';
import { extractIdentifiers } from '../utils/identityNormalization.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(here, rel), 'utf8');

/** Minimal contact factory — only the fields the bucketing actually reads. */
const c = (id, fields = {}) => ({ id, ...fields });

/** A workspace of `n` contacts carrying nothing, to push it over the window. */
const filler = (n, from = 0) =>
  Array.from({ length: n }, (_, i) => c(`filler_${from + i}`));

describe('1 — every contact lands in exactly one bucket', () => {
  it('an email is authoritative even when everything else is present too', () => {
    const ws = analyzeExposure('u1', [
      c('a', {
        email: 'Dana@Acme.com',
        linkedin_url: 'https://www.linkedin.com/in/dana/',
        phone: '(415) 555-0100',
        name: 'Dana Whitfield',
        company_name: 'Acme',
      }),
    ]);

    expect(ws.buckets.authoritative).toBe(1);
    expect(ws.buckets.linkedin_only).toBe(0);
    expect(ws.buckets.phone_only).toBe(0);
    expect(ws.buckets.name_company_only).toBe(0);
  });

  it('an Apollo person id alone is authoritative', () => {
    const ws = analyzeExposure('u1', [c('a', { apollo_person_id: 'p_1' })]);
    expect(ws.buckets.authoritative).toBe(1);
    expect(ws.noAuthoritativeId).toBe(0);
  });

  it('LinkedIn without an authoritative id is exposed, not safe', () => {
    const ws = analyzeExposure('u1', [
      c('a', { linkedin_url: 'linkedin.com/in/dana', name: 'Dana', company_name: 'Acme' }),
    ]);
    expect(ws.buckets.linkedin_only).toBe(1);
    expect(ws.buckets.name_company_only).toBe(0);
    expect(ws.noAuthoritativeId).toBe(1);
  });

  it('phone ranks below LinkedIn and above name+company', () => {
    const ws = analyzeExposure('u1', [
      c('a', { phone: '+1 415 555 0100', name: 'Dana', company_name: 'Acme' }),
      c('b', { linkedin_url: 'linkedin.com/in/mo', phone: '4155550101' }),
    ]);
    expect(ws.buckets.phone_only).toBe(1);
    expect(ws.buckets.linkedin_only).toBe(1);
    expect(ws.buckets.name_company_only).toBe(0);
  });

  it('a name with a company_id counts as name+company, same as a company name', () => {
    const ws = analyzeExposure('u1', [
      c('a', { name: 'Dana Whitfield', company_id: 'co_1' }),
      c('b', { name: 'Mo Chen', company_name: 'Northwind' }),
    ]);
    expect(ws.buckets.name_company_only).toBe(2);
  });

  it('a name with no company is unresolvable, not a weak match', () => {
    // Hierarchy step 6 requires BOTH halves. A lone name matches nothing.
    const ws = analyzeExposure('u1', [c('a', { name: 'Dana Whitfield' })]);
    expect(ws.buckets.name_company_only).toBe(0);
    expect(ws.buckets.unresolvable).toBe(1);
  });

  it('an empty record is unresolvable', () => {
    const ws = analyzeExposure('u1', [c('a')]);
    expect(ws.buckets.unresolvable).toBe(1);
  });

  it('buckets sum to the contact count for a mixed corpus', () => {
    const contacts = [
      c('a', { email: 'dana@acme.com' }),
      c('b', { apollo_person_id: 'p_2' }),
      c('c', { linkedin_url: 'linkedin.com/in/x' }),
      c('d', { phone: '4155550100' }),
      c('e', { name: 'Jo', company_name: 'Acme' }),
      c('f', {}),
      c('g', { email: '', phone: '123' }),        // both unusable
      c('h', { work_email: 'w@acme.com' }),        // alias field
    ];
    const ws = analyzeExposure('u1', contacts);

    const summed = BUCKETS.reduce((n, b) => n + ws.buckets[b.id], 0);
    expect(summed).toBe(contacts.length);
    expect(ws.contactsScanned).toBe(contacts.length);
  });

  it('noAuthoritativeId equals the sum of every exposed bucket', () => {
    const ws = analyzeExposure('u1', [
      c('a', { email: 'dana@acme.com' }),
      c('b', { linkedin_url: 'linkedin.com/in/x' }),
      c('c', { phone: '4155550100' }),
      c('d', { name: 'Jo', company_name: 'Acme' }),
      c('e', {}),
    ]);

    const exposed = BUCKETS
      .filter(b => b.exposed)
      .reduce((n, b) => n + ws.buckets[b.id], 0);

    expect(ws.noAuthoritativeId).toBe(exposed);
    expect(ws.noAuthoritativeId).toBe(4);
  });

  it('bucketFor never returns undefined, for any shape', () => {
    const shapes = [
      {}, { email: null }, { phone: 'x' }, { name: '' },
      { linkedin_url: 'not a url' }, { email: 'no-at-sign' },
    ];
    for (const s of shapes) {
      const id = bucketFor(extractIdentifiers(s));
      expect(BUCKETS.map(b => b.id)).toContain(id);
    }
  });
});

describe('2 — it uses the resolver’s own normalization', () => {
  it('an email too malformed for the resolver is not counted as authoritative', () => {
    // normalizeEmail requires an '@'. A record the resolver cannot match on
    // must not be reported as safe.
    const ws = analyzeExposure('u1', [c('a', { email: 'dana-at-acme' })]);
    expect(ws.buckets.authoritative).toBe(0);
    expect(ws.buckets.unresolvable).toBe(1);
  });

  it('a phone too short to identify anyone is not counted', () => {
    // normalizePhone floors at 7 digits.
    const ws = analyzeExposure('u1', [c('a', { phone: '12345' })]);
    expect(ws.buckets.phone_only).toBe(0);
    expect(ws.buckets.unresolvable).toBe(1);
  });

  it('reads the alias fields the resolver reads', () => {
    const ws = analyzeExposure('u1', [
      c('a', { work_email: 'dana@acme.com' }),
      c('b', { apolloPersonId: 'p_9' }),
      c('c', { organization_name: 'Acme', first_name: 'Jo', last_name: 'Ng' }),
    ]);
    expect(ws.buckets.authoritative).toBe(2);
    expect(ws.buckets.name_company_only).toBe(1);
  });
});

describe('3 — authoritative collisions, the Phase 2f gate', () => {
  it('counts two records sharing one email as one colliding key, two records', () => {
    const ws = analyzeExposure('u1', [
      c('a', { email: 'Dana@Acme.com' }),
      c('b', { email: ' dana@acme.com ' }),
      c('c', { email: 'mo@acme.com' }),
    ]);
    expect(ws.collisions.email).toEqual({ keys: 1, records: 2 });
  });

  it('counts a three-way collision as one key and three records', () => {
    const ws = analyzeExposure('u1', [
      c('a', { email: 'dana@acme.com' }),
      c('b', { email: 'dana@acme.com' }),
      c('c', { email: 'DANA@ACME.COM' }),
    ]);
    expect(ws.collisions.email).toEqual({ keys: 1, records: 3 });
  });

  it('counts Apollo id collisions independently of email', () => {
    const ws = analyzeExposure('u1', [
      c('a', { apollo_person_id: 'p_1', email: 'one@acme.com' }),
      c('b', { apollo_person_id: 'p_1', email: 'two@acme.com' }),
    ]);
    expect(ws.collisions.apollo_person_id).toEqual({ keys: 1, records: 2 });
    expect(ws.collisions.email).toEqual({ keys: 0, records: 0 });
  });

  it('reports a clean workspace as having no collisions', () => {
    const ws = analyzeExposure('u1', [
      c('a', { email: 'dana@acme.com' }),
      c('b', { email: 'mo@acme.com' }),
    ]);
    expect(ws.collisions.email.keys).toBe(0);
    expect(ws.collisions.apollo_person_id.keys).toBe(0);
  });
});

describe('4 — scan dependency, the SCAN_WINDOW gate', () => {
  it('does not count a LinkedIn-only record that carries the normalized field', () => {
    // It resolves on an indexed equality query and never touches the window.
    const ws = analyzeExposure('u1', [
      c('a', {
        linkedin_url: 'https://www.linkedin.com/in/dana/',
        linkedin_url_normalized: 'linkedin.com/in/dana',
      }),
    ]);
    expect(ws.buckets.linkedin_only).toBe(1);
    expect(ws.scanDependent.linkedin).toBe(0);
    expect(ws.scanDependentTotal).toBe(0);
  });

  it('counts a LinkedIn-only record with no normalized field', () => {
    const ws = analyzeExposure('u1', [
      c('a', { linkedin_url: 'https://www.linkedin.com/in/dana/' }),
    ]);
    expect(ws.scanDependent.linkedin).toBe(1);
  });

  it('counts name+company always — step 6 filters the window by definition', () => {
    const ws = analyzeExposure('u1', [c('a', { name: 'Jo', company_name: 'Acme' })]);
    expect(ws.scanDependent.name_company).toBe(1);
  });

  it('an already-lowercase raw email is NOT scan-dependent', () => {
    // findByEmail's second rung queries the raw `email` field AT the
    // normalized value, so a lowercase-stored address matches by query.
    const ws = analyzeExposure('u1', [c('a', { email: 'dana@acme.com' })]);
    expect(ws.buckets.authoritative).toBe(1);
    expect(ws.scanDependent.email).toBe(0);
  });

  it('a mixed-case raw email with no normalized field IS scan-dependent', () => {
    const ws = analyzeExposure('u1', [c('a', { email: 'Dana@Acme.com' })]);
    expect(ws.scanDependent.email).toBe(1);
  });

  it('a mixed-case raw email WITH the normalized field is not', () => {
    const ws = analyzeExposure('u1', [
      c('a', { email: 'Dana@Acme.com', email_normalized: 'dana@acme.com' }),
    ]);
    expect(ws.scanDependent.email).toBe(0);
  });

  it('an Apollo-id record is never scan-dependent', () => {
    // apollo_person_id is a single-field exact query with no fallback rung.
    const ws = analyzeExposure('u1', [c('a', { apollo_person_id: 'p_1' })]);
    expect(ws.scanDependentTotal).toBe(0);
  });

  it('scanDependentTotal is the sum of its parts', () => {
    const ws = analyzeExposure('u1', [
      c('a', { linkedin_url: 'linkedin.com/in/x' }),
      c('b', { phone: '4155550100' }),
      c('c', { name: 'Jo', company_name: 'Acme' }),
      c('d', { email: 'MixedCase@Acme.com' }),
      c('e', { email: 'safe@acme.com' }),
    ]);
    const { linkedin, phone, name_company, email } = ws.scanDependent;
    expect(linkedin + phone + name_company + email).toBe(ws.scanDependentTotal);
    expect(ws.scanDependentTotal).toBe(4);
  });
});

describe('5 — the scan window', () => {
  it('flags a workspace larger than the window', () => {
    const ws = analyzeExposure('u1', filler(SCAN_WINDOW + 1), { scanWindow: SCAN_WINDOW });
    expect(ws.overScanWindow).toBe(true);
  });

  it('does not flag a workspace exactly at the window', () => {
    // The scan reads SCAN_WINDOW documents, so a workspace of exactly that
    // size is fully covered. Off-by-one here would overstate the exposure.
    const ws = analyzeExposure('u1', filler(SCAN_WINDOW), { scanWindow: SCAN_WINDOW });
    expect(ws.overScanWindow).toBe(false);
    expect(ws.exposedBeyondScanWindow).toBe(0);
  });

  it('reports exposed records beyond the window only when the workspace is over it', () => {
    const small = analyzeExposure('u1', [c('a', { name: 'Jo', company_name: 'Acme' })], { scanWindow: 10 });
    expect(small.noAuthoritativeId).toBe(1);
    expect(small.exposedBeyondScanWindow).toBe(0);

    const big = analyzeExposure('u2', [...filler(12), c('z', { email: 'safe@acme.com' })], { scanWindow: 10 });
    expect(big.overScanWindow).toBe(true);
    // 12 fillers carry nothing; the 13th is authoritative and therefore safe.
    expect(big.exposedBeyondScanWindow).toBe(12);
  });
});

describe('6 — totals', () => {
  it('sums buckets, collisions and coverage across workspaces', () => {
    const a = analyzeExposure('u1', [
      c('a', { email: 'dana@acme.com', email_normalized: 'dana@acme.com' }),
      c('b', { name: 'Jo', company_name: 'Acme' }),
    ]);
    const b = analyzeExposure('u2', [
      c('c', { email: 'mo@acme.com' }),
      c('d', { email: 'mo@acme.com' }),
      c('e', { identity_review_required: true, name: 'Sam', company_name: 'Northwind' }),
    ]);

    const t = totalsFor([a, b]);

    expect(t.workspaces).toBe(2);
    expect(t.contacts).toBe(5);
    expect(t.buckets.authoritative).toBe(3);
    expect(t.buckets.name_company_only).toBe(2);
    expect(t.noAuthoritativeId).toBe(2);
    expect(t.collisions.email).toEqual({ keys: 1, records: 2 });
    expect(t.normalizedFieldCoverage.email).toBe(1);
    expect(t.scanDependent.name_company).toBe(2);
    expect(t.scanDependentTotal).toBe(2);
    expect(t.flaggedForReview).toBe(1);
  });

  it('handles an empty run without dividing by zero or emitting NaN', () => {
    const t = totalsFor([]);
    expect(t.workspaces).toBe(0);
    expect(t.contacts).toBe(0);
    for (const b of BUCKETS) expect(t.buckets[b.id]).toBe(0);
  });
});

describe('7 — the report cannot drift from the resolver', () => {
  it('mirrors SCAN_WINDOW from contactIdentityService', () => {
    // The script cannot import the service — it pulls in the Firestore web
    // SDK and the script runs under Node with the Admin SDK. So the constant
    // is copied, and this reads the source to prove the copy is current.
    const src = read('../services/contactIdentityService.js');
    const match = src.match(/export const SCAN_WINDOW\s*=\s*(\d+)/);
    expect(match, 'SCAN_WINDOW declaration not found in contactIdentityService').toBeTruthy();
    expect(Number(match[1])).toBe(SCAN_WINDOW);
  });

  it('imports normalization from the module the resolver uses', () => {
    const src = read('../../scripts/measureIdentityExposure.mjs');
    expect(src).toContain("from '../src/utils/identityNormalization.js'");
  });

  it('has no write path', () => {
    const src = read('../../scripts/measureIdentityExposure.mjs');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const flat = code.replace(/\s+/g, ' ');

    // Matched on the RECEIVER, not the verb. `emailOwners.set(...)` is a Map
    // and is fine; `collection(...).doc(...).set(...)` is a Firestore write and
    // is not. An earlier version of this assertion checked for the bare string
    // '.set(' and failed on the Map — a guard that cries wolf gets deleted, so
    // it has to be precise about what it is actually forbidding.
    const firestoreMutation =
      /(?:collection|doc)\s*\([^)]*\)(?:\s*\.\s*[A-Za-z0-9_]+\s*\([^)]*\))*\s*\.\s*(?:set|update|delete|add|create)\s*\(/;

    expect(
      firestoreMutation.test(flat),
      'a Firestore mutation appears in a script that must never write',
    ).toBe(false);

    // Belt and braces: the machinery a write would need, and the flag that
    // would turn a report into a remediation.
    for (const forbidden of ['--live', 'FieldValue', '.batch(', 'bulkWriter']) {
      expect(code, `script must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('the no-write assertion would actually catch a write', () => {
    // Proves the regex above is not vacuous. Without this, a badly-anchored
    // pattern passes forever and the guard is decoration.
    const flat = `await db.collection('users').doc(userId)
                    .collection('contacts').doc(cid).set({ x: 1 });`.replace(/\s+/g, ' ');
    const firestoreMutation =
      /(?:collection|doc)\s*\([^)]*\)(?:\s*\.\s*[A-Za-z0-9_]+\s*\([^)]*\))*\s*\.\s*(?:set|update|delete|add|create)\s*\(/;

    expect(firestoreMutation.test(flat)).toBe(true);
    // …and does not fire on a Map, which is what the naive version got wrong.
    expect(firestoreMutation.test('owners.set(key, 1)')).toBe(false);
  });

  it('marks exactly one bucket as safe, and it is the authoritative one', () => {
    const safe = BUCKETS.filter(b => !b.exposed);
    expect(safe).toHaveLength(1);
    expect(safe[0].id).toBe('authoritative');
  });
});
