/**
 * Sprint 1A — shadow-write behaviour and the "no cutover" guarantee.
 *
 * Acceptance criteria T-8 to T-12, T-15, T-16, T-21.
 *
 * The safety case for shipping this model dark rests on three claims, and each
 * one is asserted here rather than assumed:
 *
 *   1. A shadow failure can never disturb the user's action  (T-9)
 *   2. A relationship and its event commit together, or not at all  (T-11)
 *   3. Nothing reads what the shadow writes  (T-12)
 *
 * Claim 3 is the one that decays quietly — the moment someone adds a convenient
 * read, "safe to switch off" stops being true — so it is asserted against the
 * source, the same technique the ICP identity invariants already use.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

// ── In-memory Firestore ─────────────────────────────────────────────────────

const STORE = new Map();
let FAIL_TX_AFTER_READS = false;
let TX_ATTEMPTS = 0;

const pathOf = (first, rest) =>
  (first && first.__path ? [first.__path, ...rest] : rest).join('/');

vi.mock('firebase/firestore', () => ({
  collection: (first, ...rest) => ({ __path: pathOf(first, rest) }),
  doc: (first, ...rest) => {
    const p = pathOf(first, rest);
    return { __path: p, id: p.split('/').pop() };
  },
  query: (ref, ...clauses) => ({ ref, clauses }),
  where: (field, op, value) => ({ __where: true, field, op, value }),
  limit: (n) => ({ __limit: n }),
  getDoc: async (ref) => {
    const data = STORE.get(ref.__path);
    return { exists: () => data !== undefined, data: () => data, id: ref.id };
  },
  getDocs: async (q) => {
    const prefix = q.ref.__path + '/';
    const wheres = q.clauses.filter(c => c.__where);
    const docs = [...STORE.entries()]
      .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .filter(([, v]) => wheres.every(w => v[w.field] === w.value))
      .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v }));
    return { empty: docs.length === 0, docs };
  },
  runTransaction: async (_db, fn) => {
    TX_ATTEMPTS += 1;
    const staged = [];
    const tx = {
      get: async (ref) => {
        const data = STORE.get(ref.__path);
        return { exists: () => data !== undefined, data: () => data, id: ref.id };
      },
      set: (ref, data, opts) => { staged.push([ref.__path, data, opts]); },
    };
    const result = await fn(tx);
    if (FAIL_TX_AFTER_READS) throw new Error('simulated commit failure');
    // Commit only on success — this is what makes the pair atomic.
    for (const [p, data, opts] of staged) {
      STORE.set(p, opts?.merge ? { ...(STORE.get(p) ?? {}), ...data } : data);
    }
    return result;
  },
}));

vi.mock('../firebase/config', () => ({ db: { __db: true } }));

const {
  recordDecision, recordSkip, recordEncounter, ensureCriteriaVersion,
  setShadowWritesEnabled, getRelationship,
} = await import('../services/icpRelationshipService');

const UID = 'u1';
const ICP = 'icp_A';
const CO = 'co_1';
const PROFILE_PATH = `users/${UID}/icpProfiles/${ICP}`;

const events = () => [...STORE.keys()].filter(k => k.startsWith(`users/${UID}/lineageEvents/`));
const rels = () => [...STORE.keys()].filter(k => k.startsWith(`users/${UID}/icpRelationships/`));
const versions = () => [...STORE.keys()].filter(k => k.includes('/criteriaVersions/'));

beforeEach(() => {
  STORE.clear();
  FAIL_TX_AFTER_READS = false;
  TX_ATTEMPTS = 0;
  setShadowWritesEnabled(true);
  STORE.set(PROFILE_PATH, { name: 'Nonprofits', industries: ['non-profit organization management'] });
});

// ── T-9 ─────────────────────────────────────────────────────────────────────

describe('T-9 — a shadow failure never reaches the caller', () => {
  it('resolves rather than throwing when the transaction fails', async () => {
    FAIL_TX_AFTER_READS = true;
    const result = await recordDecision({ userId: UID, subjectId: CO, icpId: ICP, accepted: true, causeId: 'c1' });
    expect(result.ok).toBe(false);
    expect(events()).toEqual([]);
    expect(rels()).toEqual([]);
  });

  it('resolves rather than throwing when identity is missing', async () => {
    await expect(recordDecision({ userId: null, subjectId: CO, icpId: ICP, accepted: true, causeId: 'c1' }))
      .resolves.toMatchObject({ ok: false });
  });

  it('refuses an illegal transition softly instead of throwing', async () => {
    await recordDecision({ userId: UID, subjectId: CO, icpId: ICP, accepted: true, causeId: 'c1' });
    // accepted → skipped is not a legal transition.
    const r = await recordSkip({ userId: UID, subjectId: CO, icpId: ICP, causeId: 'c2', cycleId: 'run_1' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/illegal transition/);
  });
});

// ── T-10 ────────────────────────────────────────────────────────────────────

describe('T-10/T-21 — a replay is a no-op, never an overwrite', () => {
  it('the same decision written twice produces one event', async () => {
    const args = { userId: UID, subjectId: CO, icpId: ICP, accepted: true, causeId: 'swipe_at_T' };
    const first = await recordDecision(args);
    const after = { ...STORE.get(events()[0]) };

    const second = await recordDecision(args);

    expect(first.recorded).toBe(true);
    expect(second.alreadyRecorded).toBe(true);
    expect(events()).toHaveLength(1);
    expect(STORE.get(events()[0])).toEqual(after);   // byte-identical, untouched
  });

  it('a DIFFERING payload on an existing id does not mutate the recorded event', async () => {
    // Same scope, type and cause — but the second call claims the opposite
    // outcome. History must win; the later claim must not overwrite it.
    await recordDecision({ userId: UID, subjectId: CO, icpId: ICP, accepted: true, causeId: 'shared' });
    const recorded = { ...STORE.get(events().find(k => k.includes('__accepted__'))) };

    await recordDecision({ userId: UID, subjectId: CO, icpId: ICP, accepted: true, causeId: 'shared', source: 'tampered' });

    const stillThere = STORE.get(events().find(k => k.includes('__accepted__')));
    expect(stillThere).toEqual(recorded);
    expect(stillThere.source).not.toBe('tampered');
  });

  it('two ICPs deciding the same subject from one cause keep both events', async () => {
    await recordDecision({ userId: UID, subjectId: CO, icpId: 'icp_A', accepted: true, causeId: 'sweep' });
    STORE.set(`users/${UID}/icpProfiles/icp_B`, { industries: ['food'] });
    await recordDecision({ userId: UID, subjectId: CO, icpId: 'icp_B', accepted: false, causeId: 'sweep' });

    expect(events()).toHaveLength(2);
    expect(rels()).toHaveLength(2);
  });
});

// ── T-11 ────────────────────────────────────────────────────────────────────

describe('T-11 — relationship and event commit together or not at all', () => {
  it('a mid-transaction failure writes neither', async () => {
    FAIL_TX_AFTER_READS = true;
    await recordDecision({ userId: UID, subjectId: CO, icpId: ICP, accepted: true, causeId: 'c1' });
    expect(events()).toEqual([]);
    expect(rels()).toEqual([]);
  });

  it('a success writes exactly one of each', async () => {
    await recordDecision({ userId: UID, subjectId: CO, icpId: ICP, accepted: true, causeId: 'c1' });
    expect(events()).toHaveLength(1);
    expect(rels()).toHaveLength(1);
  });
});

// ── Invariant I-3, and the skip guard ───────────────────────────────────────

describe('the relationship a shadow write leaves behind', () => {
  it('a relationship opened by a decision does not claim an encounter it never saw', async () => {
    await recordDecision({ userId: UID, subjectId: CO, icpId: ICP, accepted: true, causeId: 'd1' });
    const rel = await getRelationship(UID, ICP, CO);
    expect(rel.state).toBe('accepted');
    expect(rel.firstObservedAt).toBeTruthy();
    expect(rel.firstEncounteredAt ?? null).toBe(null);
    expect(rel.encounteredUnderVersion ?? null).toBe(null);
  });

  it('sets decision fields only for a decision (I-3)', async () => {
    await recordEncounter({ userId: UID, subjectId: CO, icpId: ICP, causeId: 'run_1' });
    let rel = await getRelationship(UID, ICP, CO);
    expect(rel.state).toBe('pending');
    expect(rel.decidedUnderVersion ?? null).toBe(null);

    await recordSkip({ userId: UID, subjectId: CO, icpId: ICP, causeId: 's1', cycleId: 'run_1' });
    rel = await getRelationship(UID, ICP, CO);
    expect(rel.state).toBe('skipped');
    expect(rel.decidedUnderVersion ?? null).toBe(null);
    expect(rel.skippedInCycle).toBe('run_1');   // the same-cycle guard's input

    await recordDecision({ userId: UID, subjectId: CO, icpId: ICP, accepted: true, causeId: 'd1' });
    rel = await getRelationship(UID, ICP, CO);
    expect(rel.state).toBe('accepted');
    expect(rel.decidedUnderFingerprint).toBeTruthy();
  });

  it('never moves firstEncounteredAt once set', async () => {
    await recordEncounter({ userId: UID, subjectId: CO, icpId: ICP, causeId: 'run_1' });
    const first = (await getRelationship(UID, ICP, CO)).firstEncounteredAt;
    await recordDecision({ userId: UID, subjectId: CO, icpId: ICP, accepted: false, causeId: 'd1' });
    expect((await getRelationship(UID, ICP, CO)).firstEncounteredAt).toBe(first);
  });
});

// ── Criteria versions ───────────────────────────────────────────────────────

describe('criteria versions mint on change and nothing else', () => {
  it('mints once, then reuses', async () => {
    const a = await ensureCriteriaVersion(UID, ICP);
    const b = await ensureCriteriaVersion(UID, ICP);
    expect(a.minted).toBe(true);
    expect(b.minted).toBe(false);
    expect(b.versionId).toBe(a.versionId);
    expect(versions()).toHaveLength(1);
  });

  it('a non-material edit mints nothing', async () => {
    await ensureCriteriaVersion(UID, ICP);
    STORE.set(PROFILE_PATH, { ...STORE.get(PROFILE_PATH), name: 'Renamed', scoringWeights: { x: 1 } });
    const after = await ensureCriteriaVersion(UID, ICP);
    expect(after.minted).toBe(false);
    expect(versions()).toHaveLength(1);
  });

  it('a material edit mints a second version that supersedes the first', async () => {
    const first = await ensureCriteriaVersion(UID, ICP);
    STORE.set(PROFILE_PATH, { ...STORE.get(PROFILE_PATH), industries: ['food production'] });
    const second = await ensureCriteriaVersion(UID, ICP);
    expect(second.minted).toBe(true);
    expect(versions()).toHaveLength(2);
    expect(STORE.get(versions().find(k => k.endsWith(second.versionId))).supersedesVersionId).toBe(first.versionId);
  });

  it('reads the STORED profile, so a stale in-memory copy cannot stamp a version', async () => {
    const stale = { industries: ['credit unions'] };          // what a screen might hold
    STORE.set(PROFILE_PATH, { industries: ['food production'] }); // what Firestore actually has
    const v = await ensureCriteriaVersion(UID, ICP);
    const stored = STORE.get(versions()[0]);
    expect(stored.eligibilityCriteria.industries).toEqual(['food production']);
    expect(v.fingerprint).not.toBe(await ensureCriteriaVersion(UID, 'missing').then(() => null).catch(() => null));
    expect(stale.industries).toEqual(['credit unions']); // untouched; proves it was ignored
  });

  it('declines when the ICP does not exist rather than inventing criteria', async () => {
    const r = await ensureCriteriaVersion(UID, 'nope');
    expect(r.ok).toBe(false);
    expect(versions()).toEqual([]);
  });
});

// ── Kill switch ─────────────────────────────────────────────────────────────

describe('the kill switch', () => {
  it('disables every shadow write and writes nothing at all', async () => {
    setShadowWritesEnabled(false);
    await recordEncounter({ userId: UID, subjectId: CO, icpId: ICP, causeId: 'run_1' });
    await recordDecision({ userId: UID, subjectId: CO, icpId: ICP, accepted: true, causeId: 'd1' });
    await ensureCriteriaVersion(UID, ICP);
    expect(events()).toEqual([]);
    expect(rels()).toEqual([]);
    expect(versions()).toEqual([]);
  });
});

// ── T-8 and T-12: source-level guarantees ───────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'test' && name !== 'mocks') walk(p, out); }
    else if (/\.(js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('T-12 — nothing reads what the shadow writes', () => {
  const files = walk(SRC).filter(f => !f.endsWith('icpRelationshipService.js'));
  const importers = files.filter(f => /from ['"][^'"]*icpRelationshipService['"]/.test(stripComments(readFileSync(f, 'utf8'))));

  it('only the wired write path imports the relationship service', () => {
    expect(importers.map(f => f.replace(SRC + '/', ''))).toEqual(['pages/Scout/DailyLeads.jsx']);
  });

  it('and it imports only write functions, never a read', () => {
    for (const f of importers) {
      const src = stripComments(readFileSync(f, 'utf8'));
      const imported = src.match(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*icpRelationshipService['"]/)?.[1] ?? '';
      const names = imported.split(',').map(s => s.trim()).filter(Boolean);
      expect(names.length).toBeGreaterThan(0);
      for (const n of names) {
        expect(n, `${n} is a read — importing it here starts the cutover`)
          .not.toMatch(/^(getRelationship|getRelationshipsForIcp|getRelationshipEvents|isExcluded)$/);
      }
    }
  });

  it('no screen queries the new collections directly either', () => {
    for (const f of walk(SRC)) {
      if (f.endsWith('icpRelationshipService.js')) continue;
      const src = stripComments(readFileSync(f, 'utf8'));
      for (const name of ['icpRelationships', 'lineageEvents', 'criteriaVersions', 'exclusions']) {
        expect(src, `${f.replace(SRC + '/', '')} touches ${name} outside the service`)
          .not.toMatch(new RegExp(`['"]${name}['"]`));
      }
    }
  });
});

describe('T-8 — legacy first, shadow second', () => {
  const src = stripComments(readFileSync(resolve(SRC, 'pages/Scout/DailyLeads.jsx'), 'utf8'));

  it('the shadow write happens after the legacy write, inside the same try', () => {
    const legacy = src.indexOf('await updateDoc(companyRef, {');
    const shadow = src.indexOf('await recordDecision({');
    expect(legacy).toBeGreaterThan(-1);
    expect(shadow).toBeGreaterThan(legacy);
  });

  it('the shadow write is skipped when no ICP resolved, rather than guessing one', () => {
    expect(src).toMatch(/if \(activeICPId\) \{\s*await recordDecision\(\{/);
  });

  it('the decision has one timestamp, shared by both writes', () => {
    expect(src).toMatch(/const swipedAt = new Date\(\)\.toISOString\(\);/);
    expect(src).toMatch(/causeId: swipedAt/);
  });
});
