/**
 * Discovery's shadow write — the server adapter.
 *
 * Same bar as the rest of Sprint 1A: additive, fail-soft, create-only, atomic,
 * nothing reads it, kill switch works.
 *
 * The server adapter differs from the browser one in how it gets those
 * properties, and the difference is the interesting part. REST has
 * create-if-absent, so instead of a transaction it uses `:commit` with a
 * `currentDocument: { exists: false }` precondition on each write — atomic and
 * create-only in one call. These tests assert the REST shape directly, because
 * a precondition silently dropped from the request body would turn every replay
 * into an overwrite of history, with nothing else to notice.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  recordDiscoveryEncounter, ensureCriteriaVersion,
  toFirestoreValue, toFirestoreFields, shadowWritesEnabled,
} from '../../netlify/functions/utils/icpRelationshipWriter.js';

const PROJECT = 'demo-proj';
const UID = 'u1';
const ICP = 'icp_A';
const CO = 'co_1';
const TOKEN = 't0k3n';
const base = `projects/${PROJECT}/databases/(default)/documents`;

let DOCS;          // path → fields (already Firestore-encoded on read)
let COMMITS;       // every :commit body seen
let PATCHES;       // every PATCH url seen
let FAIL_COMMIT;   // 'precondition' | 'network' | null

const enc = (obj) => toFirestoreFields(obj);

function mockFetch(url, init = {}) {
  const u = String(url);

  if (u.endsWith(':commit')) {
    const body = JSON.parse(init.body);
    COMMITS.push(body);
    if (FAIL_COMMIT === 'precondition') {
      // The EXACT payload a real Firestore emulator returns for a failed
      // `currentDocument: {exists:false}` — measured, not invented, so this
      // test cannot drift from what production actually sends.
      return Promise.resolve({
        ok: false,
        status: 409,
        text: async () => JSON.stringify({
          error: {
            code: 409,
            message: 'entity already exists: EntityRef[partitionRef=dev~p, path=/users/U/lineageEvents/e1]',
            status: 'ALREADY_EXISTS',
          },
        }),
      });
    }
    if (FAIL_COMMIT === 'network') {
      return Promise.resolve({ ok: false, status: 500, text: async () => 'boom' });
    }
    for (const w of body.writes) {
      DOCS[w.update.name.replace(base + '/', '')] = w.update.fields;
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  }

  if (init.method === 'PATCH') {
    PATCHES.push(u);
    return Promise.resolve({ ok: true, json: async () => ({}) });
  }

  const path = u.split('/documents/')[1]?.split('?')[0];
  const fields = DOCS[path];
  if (!fields) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  return Promise.resolve({ ok: true, json: async () => ({ fields }) });
}

beforeEach(() => {
  DOCS = { [`users/${UID}/icpProfiles/${ICP}`]: enc({ name: 'Nonprofits', industries: ['non-profit organization management'] }) };
  COMMITS = []; PATCHES = []; FAIL_COMMIT = null;
  delete process.env.ICP_SHADOW_WRITES;
  vi.stubGlobal('fetch', vi.fn(mockFetch));
});
afterEach(() => vi.unstubAllGlobals());

const args = () => ({ projectId: PROJECT, userId: UID, authToken: TOKEN, icpId: ICP, subjectId: CO, cycleId: 'search_1700' });
const eventWrites = () => COMMITS.flatMap(c => c.writes).filter(w => w.update.name.includes('/lineageEvents/'));
const relWrites = () => COMMITS.flatMap(c => c.writes).filter(w => w.update.name.includes('/icpRelationships/'));

// ── value encoding ──────────────────────────────────────────────────────────

describe('REST value encoding', () => {
  it.each([
    [null, { nullValue: null }],
    [undefined, { nullValue: null }],
    [true, { booleanValue: true }],
    [7, { integerValue: '7' }],
    ['x', { stringValue: 'x' }],
  ])('encodes %s', (input, expected) => {
    expect(toFirestoreValue(input)).toEqual(expected);
  });

  it('encodes arrays and maps recursively', () => {
    expect(toFirestoreValue(['a'])).toEqual({ arrayValue: { values: [{ stringValue: 'a' }] } });
    expect(toFirestoreValue({ k: 1 })).toEqual({ mapValue: { fields: { k: { integerValue: '1' } } } });
  });

  it('never emits undefined, which Firestore rejects outright', () => {
    const fields = toFirestoreFields({ a: undefined, b: null });
    expect(JSON.stringify(fields)).not.toContain('undefined');
  });
});

// ── the encounter write ─────────────────────────────────────────────────────

describe('a fresh discovery hit', () => {
  it('writes the event and the relationship in ONE commit', async () => {
    const r = await recordDiscoveryEncounter(args());
    expect(r.ok).toBe(true);
    expect(r.committed).toBe(true);

    // One atomic call carrying both — not two calls that could half-land.
    const withBoth = COMMITS.filter(c =>
      c.writes.some(w => w.update.name.includes('/lineageEvents/'))
      && c.writes.some(w => w.update.name.includes('/icpRelationships/')));
    expect(withBoth).toHaveLength(1);
  });

  it('marks BOTH writes create-only', () => {
    // Without the precondition a replay overwrites history instead of being
    // refused. This is the whole create-only guarantee, expressed in the body.
    return recordDiscoveryEncounter(args()).then(() => {
      for (const w of [...eventWrites(), ...relWrites()]) {
        expect(w.currentDocument, `${w.update.name} is not create-only`).toEqual({ exists: false });
      }
    });
  });

  it('opens the relationship as pending, with the encounter recorded', async () => {
    await recordDiscoveryEncounter(args());
    const rel = relWrites()[0].update.fields;
    expect(rel.state).toEqual({ stringValue: 'pending' });
    expect(rel.associationKind).toEqual({ stringValue: 'direct' });
    // Discovery DID witness this arrival, so unlike a decision-opened
    // relationship it may claim firstEncounteredAt.
    expect(rel.firstEncounteredAt.stringValue).toBeTruthy();
    expect(rel.encounteredUnderVersion.stringValue).toBeTruthy();
  });

  it('names the discovery run as the cause, so a retried run converges', async () => {
    await recordDiscoveryEncounter(args());
    const name = eventWrites()[0].update.name;
    expect(name).toContain('icp_A__company__co_1__encountered__search_1700');
  });

  it('records the transition explicitly', async () => {
    await recordDiscoveryEncounter(args());
    const ev = eventWrites()[0].update.fields;
    expect(ev.eventType).toEqual({ stringValue: 'encountered' });
    expect(ev.fromState).toEqual({ nullValue: null });
    expect(ev.toState).toEqual({ stringValue: 'pending' });
    expect(ev.actor).toEqual({ stringValue: 'system' });
  });
});

describe('when the ICP has already met this company', () => {
  // Superseded by Option C: a re-encounter now ACCUMULATES provenance rather
  // than recording nothing. Decision 6, arriving on the one path that had only
  // ever overwritten.
  beforeEach(() => {
    DOCS[`users/${UID}/icpRelationships/icp_A__company__co_1`] = enc({ state: 'rejected', icpId: ICP });
  });

  it('records a provenance_added event instead of nothing', async () => {
    const r = await recordDiscoveryEncounter(args());
    expect(r.reEncounter).toBe(true);
    const ev = eventWrites();
    expect(ev).toHaveLength(1);
    expect(ev[0].update.fields.eventType).toEqual({ stringValue: 'provenance_added' });
    expect(ev[0].update.fields.source).toEqual({ stringValue: 'apollo_api' });
  });

  it('leaves the relationship untouched — resurfacing is an admission decision', async () => {
    await recordDiscoveryEncounter(args());
    expect(relWrites()).toHaveLength(0);
  });

  it('is state-neutral: the event records the same state on both sides', async () => {
    await recordDiscoveryEncounter(args());
    const f = eventWrites()[0].update.fields;
    expect(f.fromState).toEqual({ stringValue: 'rejected' });
    expect(f.toState).toEqual({ stringValue: 'rejected' });
  });

  it('is create-only, so a retried run does not duplicate the provenance', async () => {
    await recordDiscoveryEncounter(args());
    expect(eventWrites()[0].currentDocument).toEqual({ exists: false });
  });

  // The deleted test only ever exercised a `rejected` relationship. A
  // re-encounter can land on any state, and none of them may be disturbed.
  it.each([['pending'], ['accepted'], ['rejected'], ['skipped']])(
    'from %s: records provenance and disturbs nothing', async (state) => {
      DOCS[`users/${UID}/icpRelationships/icp_A__company__co_1`] = enc({ state, icpId: ICP });
      await recordDiscoveryEncounter(args());

      expect(relWrites(), 'the relationship must not be written').toHaveLength(0);
      expect(eventWrites(), 'exactly one event, never a burst').toHaveLength(1);

      const f = eventWrites()[0].update.fields;
      expect(f.eventType).toEqual({ stringValue: 'provenance_added' });
      expect(f.fromState).toEqual({ stringValue: state });
      expect(f.toState).toEqual({ stringValue: state });
    });
});

// ── failure behaviour ───────────────────────────────────────────────────────

describe('failure never reaches discovery', () => {
  it('a genuine retry is a silent no-op, not an error', async () => {
    // §9 requires shadow writes to log and retry, never block, never surface.
    // A retried discovery run re-derives the same causeId and therefore the
    // same event id, so the create precondition fails — and that MUST read as
    // "already recorded", not as a failure the caller has to reason about.
    FAIL_COMMIT = 'precondition';
    const r = await recordDiscoveryEncounter(args());
    expect(r.ok).toBe(true);
    expect(r.alreadyRecorded).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it.each([
    ['409 with ALREADY_EXISTS', 409, { error: { code: 409, status: 'ALREADY_EXISTS', message: 'entity already exists' } }],
    ['400 with FAILED_PRECONDITION', 400, { error: { code: 400, status: 'FAILED_PRECONDITION', message: 'precondition failed' } }],
  ])('%s is treated as already-recorded', async (_label, status, body) => {
    vi.stubGlobal('fetch', vi.fn((url, init) => {
      if (String(url).endsWith(':commit')) {
        return Promise.resolve({ ok: false, status, text: async () => JSON.stringify(body) });
      }
      return mockFetch(url, init);
    }));
    const r = await recordDiscoveryEncounter(args());
    expect(r.ok).toBe(true);
    expect(r.alreadyRecorded).toBe(true);
  });

  it('a real failure resolves soft rather than throwing', async () => {
    FAIL_COMMIT = 'network';
    const r = await recordDiscoveryEncounter(args());
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('a thrown fetch resolves soft too', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('socket hang up'); }));
    await expect(recordDiscoveryEncounter(args())).resolves.toMatchObject({ ok: false });
  });

  it('missing identity is refused without a write', async () => {
    const r = await recordDiscoveryEncounter({ ...args(), icpId: null });
    expect(r.ok).toBe(false);
    expect(COMMITS).toHaveLength(0);
  });
});

// ── criteria versions ───────────────────────────────────────────────────────

describe('criteria versions, server side', () => {
  it('mints once and reuses, and the pointer patch is field-scoped', async () => {
    const first = await ensureCriteriaVersion({ projectId: PROJECT, userId: UID, authToken: TOKEN, icpId: ICP });
    expect(first.minted).toBe(true);

    // The pointer is a MERGE onto an existing document, so it must carry an
    // updateMask — a bare PATCH is the whole-document overwrite that destroyed
    // provenance on the rediscovery path.
    expect(PATCHES[0]).toContain('updateMask.fieldPaths=currentCriteriaVersionId');
    expect(PATCHES[0]).toContain('updateMask.fieldPaths=currentCriteriaFingerprint');

    DOCS[`users/${UID}/icpProfiles/${ICP}`] = enc({
      name: 'Nonprofits', industries: ['non-profit organization management'],
      currentCriteriaVersionId: first.versionId, currentCriteriaFingerprint: first.fingerprint,
    });
    const second = await ensureCriteriaVersion({ projectId: PROJECT, userId: UID, authToken: TOKEN, icpId: ICP });
    expect(second.minted).toBe(false);
    expect(second.versionId).toBe(first.versionId);
  });

  it('the version document itself is create-only', async () => {
    await ensureCriteriaVersion({ projectId: PROJECT, userId: UID, authToken: TOKEN, icpId: ICP });
    const v = COMMITS.flatMap(c => c.writes).find(w => w.update.name.includes('/criteriaVersions/'));
    expect(v.currentDocument).toEqual({ exists: false });
  });

  it('declines when the ICP does not exist rather than inventing criteria', async () => {
    const r = await ensureCriteriaVersion({ projectId: PROJECT, userId: UID, authToken: TOKEN, icpId: 'nope' });
    expect(r.ok).toBe(false);
    expect(COMMITS).toHaveLength(0);
  });
});

// ── kill switch ─────────────────────────────────────────────────────────────

describe('the kill switch', () => {
  it('writes nothing when disabled', async () => {
    process.env.ICP_SHADOW_WRITES = 'false';
    expect(shadowWritesEnabled()).toBe(false);
    const r = await recordDiscoveryEncounter(args());
    expect(r.skipped).toBe(true);
    expect(COMMITS).toHaveLength(0);
  });
});

// ── wiring, asserted against the source ─────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../../netlify/functions/search-companies.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('discovery wiring', () => {
  it('the shadow write happens after the legacy write', () => {
    const legacy = src.indexOf('const saveResponse = await fetch(docUrl');
    const shadow = src.indexOf('await recordDiscoveryEncounter({');
    expect(legacy).toBeGreaterThan(-1);
    expect(shadow).toBeGreaterThan(legacy);
  });

  it('a failed legacy write skips the shadow entirely (I-11)', () => {
    // Shadow must never describe an arrival that did not happen.
    expect(src).toMatch(/if \(!saveResponse\.ok\) \{[\s\S]{0,300}continue;\s*\}/);
  });

  it('the criteria version is resolved once per batch, not per company', () => {
    const ensureAt = src.indexOf('await ensureCriteriaVersion({');
    const loopAt = src.indexOf('for (const company of simplifiedCompanies)');
    expect(ensureAt).toBeGreaterThan(-1);
    expect(ensureAt).toBeLessThan(loopAt);
  });

  it('the run has one cycle id, and it is the event cause', () => {
    expect(src).toMatch(/const cycleId = `search_\$\{startTime\}`/);
    expect(src).toMatch(/cycleId,/);
  });

  it('discovery reads nothing from the shadow model', () => {
    for (const read of ['getRelationship', 'getRelationshipsForIcp', 'getRelationshipEvents', 'admitCandidate']) {
      expect(src, `${read} is a read — importing it here starts the cutover`).not.toContain(read);
    }
  });
});
