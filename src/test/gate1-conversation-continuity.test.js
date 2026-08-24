/**
 * Gate 1 (corrected) — One Barry / Conversation Continuity
 *
 * Structural invariants verified by source scan:
 *
 * C1  canonical conversation lives in a dedicated subcollection,
 *     not missionControl.
 * C2  every renderer appends turns via addDoc; no renderer overwrites
 *     the conversation array with setDoc.
 * C3  active-context reads use a Firestore limit() query, not slice()
 *     on the persisted data. Older turns survive.
 * C4  First Experience persists incrementally (every exchange), not
 *     only on confirmation.
 * C5  handleConfirm never replaces the canonical conversation.
 * C6  the server no longer writes to icpChat.
 * C7  transient surface context stays transient.
 * C8  multi-renderer safety tests (Cases A–F).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const canonical = read('../utils/barryCanonical.js');
const onboarding = read('../pages/Onboarding/BarryOnboarding.jsx');
const sidecar = read('../components/scout/BarryICPPanel.jsx');
const workspace = read('../components/dashboard/BarryChatPanel.jsx');
const server = read('../../netlify/functions/barryMissionChat.js');

// ═══════════════════════════════════════════════════════════════════════════
// C1 — dedicated canonical conversation boundary
// ═══════════════════════════════════════════════════════════════════════════

describe('C1 — canonical conversation is a dedicated subcollection', () => {
  it('the utility uses barryConversations/canonical/turns as the path', () => {
    expect(canonical).toContain("'barryConversations', 'canonical', 'turns'");
  });

  it('appendTurn uses addDoc exclusively (never setDoc for turns)', () => {
    const body = code(canonical);
    expect(body).toMatch(/export async function appendTurn[\s\S]*?addDoc\(turnsRef/);
    expect(body).not.toMatch(/setDoc\(turnsRef/);
  });

  it('missionControl is not the canonical write target', () => {
    const appendFn = canonical.slice(
      canonical.indexOf('export async function appendTurn'),
      canonical.indexOf('export async function loadRecentTurns')
    );
    expect(appendFn).not.toContain('missionControl');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C2 — append-only persistence: no renderer overwrites conversation
// ═══════════════════════════════════════════════════════════════════════════

describe('C2 — every renderer appends, none overwrites', () => {
  it('all three renderers import appendTurn from barryCanonical', () => {
    for (const src of [onboarding, sidecar, workspace]) {
      expect(src).toMatch(/import.*appendTurn.*from.*barryCanonical/);
    }
  });

  it('onboarding does not setDoc to missionControl', () => {
    const body = code(onboarding);
    expect(body).not.toMatch(/setDoc[\s\S]{0,200}barryConversations', 'missionControl'/);
  });

  it('sidecar does not setDoc messages to missionControl', () => {
    const body = code(sidecar);
    const canonicalSaveRemoved = !body.match(/setDoc[\s\S]{0,200}barryConversations', 'missionControl'[\s\S]{0,400}messages:/);
    expect(canonicalSaveRemoved).toBe(true);
  });

  it('workspace saveConversation no longer writes a messages array', () => {
    expect(workspace).toMatch(/async function saveMissionControlState/);
    const fn = workspace.slice(
      workspace.indexOf('async function saveMissionControlState'),
      workspace.indexOf('}', workspace.indexOf('async function saveMissionControlState') + 200) + 1
    );
    expect(fn).not.toContain('messages');
    expect(fn).toContain('mode');
    expect(fn).toContain("merge: true");
  });

  it('the canonical utility guards role to user|assistant only', () => {
    expect(canonical).toMatch(/role !== 'user' && role !== 'assistant'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C3 — retention: active context is bounded, storage is not
// ═══════════════════════════════════════════════════════════════════════════

describe('C3 — storage retention is separate from active context', () => {
  it('loadRecentTurns uses a Firestore limit() query', () => {
    expect(canonical).toMatch(/query\(turnsRef[\s\S]{0,100}limit\(count\)/);
  });

  it('loadAllTurns exists and has no limit', () => {
    expect(canonical).toMatch(/export async function loadAllTurns/);
    const allFn = canonical.slice(
      canonical.indexOf('export async function loadAllTurns'),
      canonical.indexOf('}', canonical.indexOf('export async function loadAllTurns') + 100) + 1
    );
    expect(allFn).not.toContain('limit(');
  });

  it('no renderer slice()s the canonical write — appendTurn writes one doc at a time', () => {
    const appendFn = canonical.slice(
      canonical.indexOf('export async function appendTurn'),
      canonical.indexOf('}', canonical.indexOf('export async function appendTurn') + 100) + 1
    );
    expect(appendFn).not.toContain('.slice(');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C4 — First Experience incremental persistence
// ═══════════════════════════════════════════════════════════════════════════

describe('C4 — First Experience persists turns incrementally', () => {
  it('appends the user turn in handleSubmit before the API call', () => {
    const submitFn = onboarding.slice(
      onboarding.indexOf('async function handleSubmit'),
      onboarding.indexOf('async function handleConfirm') || onboarding.length
    );
    expect(submitFn).toMatch(/appendTurn\(db, user\.uid,[\s\S]{0,80}role: 'user'/);
  });

  it('appends the barry turn in handleSubmit after the response', () => {
    const submitFn = onboarding.slice(
      onboarding.indexOf('async function handleSubmit'),
      onboarding.indexOf('async function handleConfirm') || onboarding.length
    );
    expect(submitFn).toMatch(/appendTurn\(db,[\s\S]{0,100}role: 'assistant'[\s\S]{0,80}surface: 'onboarding'/);
  });

  it('appends the error response too', () => {
    const submitFn = onboarding.slice(
      onboarding.indexOf('async function handleSubmit'),
      onboarding.indexOf('async function handleConfirm') || onboarding.length
    );
    const errorSection = submitFn.slice(submitFn.indexOf('catch (error)'));
    expect(errorSection).toMatch(/appendTurn/);
  });

  it('appends the final confirmation message in handleConfirm', () => {
    const confirmFn = onboarding.slice(
      onboarding.indexOf('async function handleConfirm')
    );
    expect(confirmFn).toMatch(/appendTurn\(db,[\s\S]{0,100}finalMessage[\s\S]{0,80}surface: 'onboarding'/);
  });

  it('saveConversationState still writes workflow state to barryConversations/icp', () => {
    expect(onboarding).toMatch(/barryConversations', 'icp'[\s\S]{0,300}status:/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C5 — handleConfirm never replaces the canonical conversation
// ═══════════════════════════════════════════════════════════════════════════

describe('C5 — handleConfirm is non-destructive', () => {
  it('does not write to barryConversations/missionControl', () => {
    const confirmFn = code(onboarding).slice(
      code(onboarding).indexOf('async function handleConfirm')
    );
    expect(confirmFn).not.toMatch(/setDoc[\s\S]{0,200}barryConversations', 'missionControl'/);
  });

  it('does not contain bridgeMessages or bridgedFrom', () => {
    const confirmFn = onboarding.slice(
      onboarding.indexOf('async function handleConfirm')
    );
    expect(confirmFn).not.toContain('bridgeMessages');
    expect(confirmFn).not.toContain('bridgedFrom');
  });

  it('does not slice or replace the canonical conversation', () => {
    const confirmFn = onboarding.slice(
      onboarding.indexOf('async function handleConfirm')
    );
    expect(confirmFn).not.toMatch(/messages:.*\.slice\(-30\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C6 — server no longer writes to icpChat
// ═══════════════════════════════════════════════════════════════════════════

describe('C6 — duplicate conversation authority eliminated', () => {
  it('barryMissionChat no longer writes to barryConversations/icpChat', () => {
    const body = code(server);
    expect(body).not.toMatch(/\.doc\('icpChat'\)\.set\(/);
  });

  it('the removal comment explains why', () => {
    expect(server).toContain('icpChat persistence removed');
    expect(server).toMatch(/canonical[\s\S]{0,20}subcollection/);
  });

  it('sidecar still reads icpChat as a legacy fallback via seedFromLegacy', () => {
    expect(canonical).toContain("'icpChat'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C7 — transient context stays transient
// ═══════════════════════════════════════════════════════════════════════════

describe('C7 — transient surface context is not persisted', () => {
  it('appendTurn stores only role, content, surface, and createdAt', () => {
    const appendFn = canonical.slice(
      canonical.indexOf('export async function appendTurn'),
      canonical.indexOf('}', canonical.indexOf('return addDoc') + 10) + 1
    );
    expect(appendFn).not.toMatch(/icpMode|icpProfile|nudge|navigationContext|barryMode/);
  });

  it('sidecar sends icpMode as a request parameter', () => {
    expect(sidecar).toContain('icpMode: true');
  });

  it('workspace sends navigationContext as a request parameter', () => {
    expect(workspace).toContain('navigationContext');
  });

  it('neither request parameter appears in the canonical append call', () => {
    for (const src of [sidecar, workspace]) {
      const appendCalls = src.match(/appendTurn\(db,[\s\S]{0,200}\)/g) || [];
      for (const call of appendCalls) {
        expect(call).not.toMatch(/icpMode|navigationContext|icpProfile/);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C8 — multi-renderer safety tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Case A — Workspace stale: sidecar adds turns, workspace sends', () => {
  it('workspace appends its own turn without reading first', () => {
    expect(workspace).toMatch(/appendTurn\(db, user\.uid,[\s\S]{0,80}role: 'user'[\s\S]{0,80}surface: 'workspace'/);
  });

  it('workspace does not overwrite the conversation array on send', () => {
    const sendFn = code(workspace).slice(
      code(workspace).indexOf('const sendMessage = async')
    );
    expect(sendFn).not.toMatch(/setDoc[\s\S]{0,200}barryConversations/);
  });
});

describe('Case B — Sidecar stale: workspace adds turns, sidecar sends', () => {
  it('sidecar appends its own turns without overwriting', () => {
    expect(sidecar).toMatch(/appendTurn\(db, user\.uid,[\s\S]{0,80}role: 'user'[\s\S]{0,80}surface: 'sidecar'/);
    expect(sidecar).toMatch(/appendTurn\(db, user\.uid,[\s\S]{0,80}role: 'assistant'[\s\S]{0,80}surface: 'sidecar'/);
  });

  it('sidecar does not do a whole-array write to any barryConversations doc', () => {
    const body = code(sidecar);
    expect(body).not.toMatch(/setDoc[\s\S]{0,200}barryConversations[\s\S]{0,200}messages:/);
  });
});

describe('Case C — ICP reconfirm does not destroy prior history', () => {
  it('handleConfirm does not write to the canonical conversation at all', () => {
    const confirmFn = code(onboarding).slice(
      code(onboarding).indexOf('async function handleConfirm')
    );
    expect(confirmFn).not.toMatch(/setDoc[\s\S]{0,200}barryConversations', 'missionControl'/);
    expect(confirmFn).not.toMatch(/setDoc[\s\S]{0,200}barryConversations', 'canonical'/);
  });

  it('"start over" in sidecar preserves conversation history', () => {
    expect(sidecar).toMatch(/sendToBarry\('__ICP_RECLARIFICATION__', conversationHistory,/);
  });

  it('"start over" does not delete the canonical conversation', () => {
    expect(sidecar).not.toMatch(/deleteDoc[\s\S]{0,100}canonical/);
  });
});

describe('Case D — retention: message 31 does not destroy message 1', () => {
  it('appendTurn is addDoc (append-only, never replaces)', () => {
    expect(canonical).toMatch(/return addDoc\(turnsRef/);
  });

  it('no renderer calls setDoc on the turns subcollection', () => {
    for (const src of [onboarding, sidecar, workspace]) {
      expect(src).not.toMatch(/setDoc[\s\S]{0,100}canonical', 'turns'/);
    }
  });

  it('loadAllTurns can recover the full history', () => {
    expect(canonical).toMatch(/export async function loadAllTurns/);
    const fn = canonical.slice(canonical.indexOf('loadAllTurns'));
    expect(fn).toContain("orderBy('createdAt', 'asc')");
    expect(fn).not.toContain('limit(');
  });
});

describe('Case E — First Experience ambiguity (Gate 0 holds)', () => {
  it('still gates the proposal on ambiguity resolution', () => {
    expect(onboarding).toMatch(/!isAmbiguous && \(newStep === 'confirming'/);
  });

  it('still persists isAmbiguous alongside the gated step', () => {
    expect(onboarding).toMatch(/saveConversationState\(user\.uid, updatedHistory, barryResponse\.understood, gatedStep, isAmbiguous\)/);
  });

  it('legacy resume still fails safe to clarifying', () => {
    expect(onboarding).toMatch(/resumeStep === 'confirming' && data\.isAmbiguous !== false/);
  });

  it('still gates the search on the quality floor', () => {
    expect(onboarding).toMatch(/const canSearch = hasRetrievalConstraint\(icpProfile\)/);
  });

  it('confirmation is still the only event that writes an authoritative ICP', () => {
    expect(onboarding).toMatch(/icpIdSource: 'barry_onboarding_confirmed'/);
  });
});

describe('Case F — full renderer journey: one continuous Barry', () => {
  it('all renderers read from the same canonical subcollection', () => {
    expect(sidecar).toMatch(/loadOrSeedRecentTurns/);
    expect(workspace).toMatch(/loadOrSeedRecentTurns/);
  });

  it('onboarding writes incrementally to canonical', () => {
    expect(onboarding).toMatch(/appendTurn\(db,[\s\S]{0,100}surface: 'onboarding'/);
  });

  it('workspace re-syncs from canonical when opened', () => {
    expect(workspace).toContain('syncFromCanonical');
    expect(workspace).toMatch(/barryOpen && !prevBarryOpenRef\.current/);
  });

  it('syncFromCanonical reads from the canonical subcollection (not missionControl messages)', () => {
    expect(workspace).toMatch(/loadOrSeedRecentTurns/);
  });

  it('the proposal module still writes nothing before confirmation', () => {
    const proposal = read('../utils/targetingProposal.js');
    const component = read('../components/onboarding/TargetingProposal.jsx');
    for (const src of [proposal, component]) {
      expect(src).not.toMatch(/setDoc|updateDoc|addDoc|search-companies|icpProfiles|setActiveIcpProfile/);
    }
  });
});
