/**
 * Sprint 2 — person lineage, engagement ICP context, and derived attribution.
 *
 * Three claims carry this sprint, and each is asserted rather than assumed:
 *
 *   1. Only the two write paths that genuinely carry ICP context create a
 *      direct association. The others create NONE — an absent association is
 *      the honest record that nobody evaluated this person.
 *   2. Attribution is DERIVED and never stored. Nothing writes into ADR-006's
 *      territory, and the unattributable cases are reported, not guessed.
 *   3. An inherited association is always labelled. List membership must never
 *      imply that direct evaluation happened.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ATTRIBUTION, ASSOCIATION,
  attributeReply, personIcpAssociations, isInheritedOnly, summarizeAttribution,
} from '../utils/icpAttribution';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(here, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const daily = strip(read('../pages/Scout/DailyLeads.jsx'));
const bulk = strip(read('../components/scout/BulkSendExecutor.jsx'));
const service = strip(read('../services/icpRelationshipService.js'));

// ─── attribution ────────────────────────────────────────────────────────────

describe('a reply is attributed through its originating engagement', () => {
  const enrollment = (over = {}) => ({
    cadenceId: 'cad_1', contactId: 'co_1__p_1', gmailThreadId: 't1',
    icpId: 'icp_A', icpCriteriaVersionId: 'v1', sentAt: '2026-09-01', ...over,
  });
  const reply = (over = {}) => ({ gmailThreadId: 't1', contactId: 'co_1__p_1', ...over });

  it('attributes a single thread match to that engagement ICP', () => {
    const r = attributeReply(reply(), [enrollment()]);
    expect(r.status).toBe(ATTRIBUTION.ATTRIBUTED);
    expect(r.icpId).toBe('icp_A');
    expect(r.icpCriteriaVersionId).toBe('v1');
  });

  it('attributes to the ICP the send was made under, NOT the ICP now active', () => {
    // Decision 4. The enrollment is frozen at initiation; nothing about the
    // person's current associations may change what this reply is attributed to.
    const r = attributeReply(reply(), [enrollment({ icpId: 'icp_OLD', icpCriteriaVersionId: 'v_old' })]);
    expect(r.icpId).toBe('icp_OLD');
    expect(r.icpCriteriaVersionId).toBe('v_old');
  });

  it.each([
    ['the reply carries no thread id', { gmailThreadId: null }, [], 'reply-has-no-thread-id'],
    ['no enrollment carries the thread', {}, [{ gmailThreadId: 'other', icpId: 'icp_A' }], 'no-enrollment-carries-this-thread'],
    ['the enrollment has no ICP stamped', {}, [{ gmailThreadId: 't1', icpId: null }], 'enrollment-carries-no-icp'],
  ])('reports Unattributed when %s', (_label, replyOver, rows, reason) => {
    const r = attributeReply(reply(replyOver), rows);
    expect(r.status).toBe(ATTRIBUTION.UNATTRIBUTED);
    expect(r.reason).toBe(reason);
    expect(r.icpId).toBe(null);
  });

  it('reports AMBIGUOUS — never a tie-break — when a thread spans two ICPs', () => {
    // Measured: 1 of 39 production threads already does this, and follow-ups
    // across cadences make it normal rather than exotic. Picking the earliest
    // or latest send would be the fabrication decision 6 ruled out elsewhere.
    const r = attributeReply(reply(), [
      enrollment({ cadenceId: 'cad_1', icpId: 'icp_A', sentAt: '2026-09-01' }),
      enrollment({ cadenceId: 'cad_2', icpId: 'icp_B', sentAt: '2026-09-09' }),
    ]);
    expect(r.status).toBe(ATTRIBUTION.AMBIGUOUS);
    expect(r.icpId).toBe(null);
    // everything a review surface needs, and nothing resolved for it
    expect(r.candidates.map(c => c.icpId).sort()).toEqual(['icp_A', 'icp_B']);
    expect(r.candidates.every(c => c.cadenceId && c.sentAt)).toBe(true);
  });

  it('two enrollments under the SAME ICP are not ambiguous', () => {
    const r = attributeReply(reply(), [
      enrollment({ cadenceId: 'cad_1' }),
      enrollment({ cadenceId: 'cad_2' }),
    ]);
    expect(r.status).toBe(ATTRIBUTION.ATTRIBUTED);
    expect(r.icpId).toBe('icp_A');
  });

  it('does not attribute a thread belonging to a different person', () => {
    const r = attributeReply(reply({ contactId: 'someone_else' }), [enrollment()]);
    expect(r.status).toBe(ATTRIBUTION.UNATTRIBUTED);
  });

  it('reports the unattributable share rather than hiding it', () => {
    // A reply rate that drops its unattributable denominator flatters itself.
    const s = summarizeAttribution([
      { status: ATTRIBUTION.ATTRIBUTED, icpId: 'icp_A' },
      { status: ATTRIBUTION.ATTRIBUTED, icpId: 'icp_A' },
      { status: ATTRIBUTION.AMBIGUOUS },
      { status: ATTRIBUTION.UNATTRIBUTED },
    ]);
    expect(s.byIcp).toEqual({ icp_A: 2 });
    expect(s.attributed).toBe(2);
    expect(s.unattributableShare).toBe(50);
  });
});

// ─── direct vs inherited ────────────────────────────────────────────────────

describe('a person carries direct and inherited associations, always labelled', () => {
  const direct = { icpId: 'icp_A', state: 'accepted' };
  const viaCompany = { icpId: 'icp_B', state: 'accepted', subjectId: 'co_1' };

  it('returns both by default — an inherited-only person is still in the list', () => {
    const a = personIcpAssociations([direct], [viaCompany], { companyId: 'co_1' });
    expect(a.map(x => x.icpId).sort()).toEqual(['icp_A', 'icp_B']);
  });

  it('labels every association, so membership never implies evaluation', () => {
    const a = personIcpAssociations([direct], [viaCompany], { companyId: 'co_1' });
    expect(a.find(x => x.icpId === 'icp_A').association).toBe(ASSOCIATION.DIRECT);
    expect(a.find(x => x.icpId === 'icp_B').association).toBe(ASSOCIATION.INHERITED);
    // the label travels with the association — a caller cannot render one
    // without having been handed the other
    expect(a.every(x => x.association)).toBe(true);
  });

  it('names the company an inherited association came through', () => {
    const a = personIcpAssociations([], [viaCompany], { companyId: 'co_1' });
    expect(a[0].via).toBe('co_1');
  });

  it('direct beats inherited for the same ICP — we actually evaluated them', () => {
    const a = personIcpAssociations(
      [{ icpId: 'icp_A', state: 'accepted' }],
      [{ icpId: 'icp_A', state: 'rejected' }],
      { companyId: 'co_1' },
    );
    expect(a).toHaveLength(1);
    expect(a[0].association).toBe(ASSOCIATION.DIRECT);
    expect(a[0].state).toBe('accepted');
  });

  it('isInheritedOnly answers the question a UI must ask before it renders', () => {
    const a = personIcpAssociations([direct], [viaCompany], { companyId: 'co_1' });
    expect(isInheritedOnly(a, 'icp_B')).toBe(true);
    expect(isInheritedOnly(a, 'icp_A')).toBe(false);
    expect(isInheritedOnly(a, 'icp_MISSING')).toBe(false);
  });

  it('a person with no company association has no inherited entries', () => {
    expect(personIcpAssociations([direct], [])).toEqual([
      { icpId: 'icp_A', association: ASSOCIATION.DIRECT, state: 'accepted', via: null },
    ]);
  });
});

// ─── wiring ─────────────────────────────────────────────────────────────────

describe('only the two ICP-carrying write paths create a direct association', () => {
  it('auto-discovery records an encounter under the swiping ICP', () => {
    expect(daily).toMatch(/await recordPersonEncounter\(\{[\s\S]{0,200}source: 'icp_auto_discovery'/);
  });

  it('the People tab records accept, reject and skip', () => {
    expect(daily).toMatch(/recordPersonDecision\(\{[\s\S]{0,160}accepted: true/);
    expect(daily).toMatch(/recordPersonDecision\(\{[\s\S]{0,160}accepted: false/);
    expect(daily).toMatch(/recordPersonSkip\(\{/);
  });

  it('every person shadow write is gated on an ICP actually resolving', () => {
    // No ICP in scope means no association — not a guessed one.
    for (const fn of ['recordPersonEncounter', 'recordPersonDecision', 'recordPersonSkip']) {
      const at = daily.indexOf(`await ${fn}(`);
      expect(at, `${fn} not wired`).toBeGreaterThan(-1);
      const before = daily.slice(Math.max(0, at - 120), at);
      expect(before, `${fn} is not gated on activeICPId`).toMatch(/if \(activeICPId\) \{/);
    }
  });

  it('the paths WITHOUT ICP context create no association at all', () => {
    // LinkedIn Link, Find Contacts, manual and CSV have no ICP in scope. If one
    // ever gains a person shadow write, this test should be the thing that asks
    // where its ICP came from.
    for (const f of [
      '../components/scout/LinkedInLinkSearch.jsx',
      '../components/scout/FindContact.jsx',
      '../pages/Scout/ContactSearch.jsx',
      '../components/scout/BusinessCardCapture.jsx',
    ]) {
      expect(strip(read(f)), `${f} records a person association without an ICP`)
        .not.toMatch(/recordPerson/);
    }
  });

  it('the legacy write happens first, the shadow after', () => {
    const legacy = daily.indexOf("status: 'people_mode_archived'");
    const shadow = daily.indexOf('accepted: false, causeId: personDecidedAt');
    expect(legacy).toBeGreaterThan(-1);
    expect(shadow).toBeGreaterThan(legacy);
  });

  it('one timestamp per decision, shared by both writes and used as the cause', () => {
    expect(daily).toMatch(/const personDecidedAt = new Date\(\)\.toISOString\(\);/);
    expect(daily).toMatch(/causeId: personDecidedAt/);
  });
});

describe('engagement carries the ICP it was sent under', () => {
  it('the enrollment row is stamped from a once-resolved context', () => {
    expect(bulk).toMatch(/icpContextRef\.current = \{[\s\S]{0,200}icpCriteriaVersionId/);
    expect(bulk).toMatch(/\.\.\.\(icpContextRef\.current \?\? \{\}\)/);
  });

  it('resolution happens before the first enrollment row is built', () => {
    const resolveAt = bulk.indexOf('await resolveActiveIcp(uid)');
    const buildAt = bulk.indexOf('contacts: items.map(buildContactEntry)');
    expect(resolveAt).toBeGreaterThan(-1);
    expect(resolveAt).toBeLessThan(buildAt);
  });

  it('stamps nothing when no ICP resolves — absence is Unattributed', () => {
    expect(bulk).toMatch(/if \(isResolved\(resolution\)\) \{/);
    expect(bulk).not.toMatch(/icpId: resolution\.candidates/);
    expect(bulk).not.toMatch(/icpList\[0\]|candidates\[0\]/);
  });

  it('the criteria version is captured, so a later ICP edit cannot rewrite the send', () => {
    expect(bulk).toMatch(/ensureCriteriaVersion\(uid, resolution\.icpId\)/);
  });
});

describe('Sprint 2 stays inside its boundaries', () => {
  it('writes no reply events and no relationship.* state — ADR-006 has one writer', () => {
    for (const src of [daily, bulk, service]) {
      expect(src).not.toMatch(/relationship_events/);
      expect(src).not.toMatch(/buildInboundEvent|relationshipEventWriter/);
    }
  });

  it('attribution is never stored — the derivation module writes nothing', () => {
    const attribution = strip(read('../utils/icpAttribution.js'));
    for (const w of ['setDoc', 'updateDoc', 'addDoc', 'runTransaction', 'firebase/firestore']) {
      expect(attribution, `icpAttribution must not ${w}`).not.toContain(w);
    }
  });

  it('nothing reads the person model yet — the cutover is Sprint 3', () => {
    const attributionImporters = [];
    for (const f of ['../pages/Scout/DailyLeads.jsx', '../pages/Scout/AllLeads.jsx',
      '../pages/Scout/SavedCompanies.jsx', '../components/scout/BulkSendExecutor.jsx']) {
      if (/from ['"][^'"]*icpAttribution['"]/.test(strip(read(f)))) attributionImporters.push(f);
    }
    expect(attributionImporters, 'a screen is already reading derived attribution').toEqual([]);
  });

  it('missions and manual sends are untouched — out of scope by decision', () => {
    expect(daily).not.toMatch(/recordPerson[A-Za-z]*\([^)]*mission/i);
    expect(service).not.toMatch(/mission/i);
  });
});
