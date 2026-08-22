/**
 * Gate 1 — One Barry / Conversation Continuity
 *
 * Validates the canonical continuity contract: one stable conversation
 * survives renderer changes (First Experience → Shell Barry → Sidecar →
 * Shell Barry), the First Experience is the beginning of the ongoing Barry
 * relationship (not orphaned), and transient surface context does not
 * permanently pollute the canonical conversation.
 *
 * Source-scan tests verify structural invariants without running the app.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('1 — First Experience seeds the canonical conversation', () => {
  const onboarding = read('../pages/Onboarding/BarryOnboarding.jsx');

  it('writes to missionControl during handleConfirm', () => {
    expect(onboarding).toContain("'barryConversations', 'missionControl'");
  });

  it('bridges messages with role mapping (barry → assistant)', () => {
    expect(onboarding).toMatch(/role: msg\.role === 'barry' \? 'assistant' : /);
  });

  it('writes the bridge after the icp doc is marked completed', () => {
    const completedIdx = onboarding.indexOf("status: 'completed'");
    const bridgeIdx = onboarding.indexOf("bridgedFrom: 'barry_onboarding'");
    expect(completedIdx).toBeGreaterThan(-1);
    expect(bridgeIdx).toBeGreaterThan(completedIdx);
  });

  it('caps bridged messages at the same limit as BarryChatPanel (30)', () => {
    expect(onboarding).toMatch(/bridgeMessages\.slice\(-30\)/);
  });

  it('still marks the icp conversation completed (Gate 0 invariant)', () => {
    expect(onboarding).toMatch(/barryConversations', 'icp'[\s\S]{0,300}status: 'completed'/);
  });
});

describe('2 — Sidecar reads the canonical conversation', () => {
  const panel = read('../components/scout/BarryICPPanel.jsx');

  it('reads missionControl first in the fallback chain', () => {
    const missionControlIdx = panel.indexOf("'barryConversations', 'missionControl'");
    const icpChatIdx = panel.indexOf("'barryConversations', 'icpChat'");
    const icpIdx = panel.indexOf("'barryConversations', 'icp'");
    expect(missionControlIdx).toBeGreaterThan(-1);
    expect(icpChatIdx).toBeGreaterThan(missionControlIdx);
    expect(icpIdx).toBeGreaterThan(icpChatIdx);
  });

  it('falls back to icpChat then icp for pre-Gate-1 conversations', () => {
    const body = code(panel);
    expect(body).toContain("'barryConversations', 'icpChat'");
    expect(body).toContain("'barryConversations', 'icp'");
  });

  it('persists sidecar exchanges to the canonical conversation', () => {
    expect(panel).toMatch(/barryConversations', 'missionControl'[\s\S]{0,500}merge: true/);
  });

  it('maps barry role to assistant in the canonical save', () => {
    expect(panel).toMatch(/role: m\.role === 'barry' \? 'assistant' : m\.role/);
  });
});

describe('3 — Shell Barry re-syncs when opened', () => {
  const chatPanel = read('../components/dashboard/BarryChatPanel.jsx');

  it('imports useShell from ShellContext', () => {
    expect(chatPanel).toMatch(/import.*useShell.*from.*ShellContext/);
  });

  it('destructures barryOpen from the shell', () => {
    expect(chatPanel).toMatch(/const \{ barryOpen \} = useShell\(\)/);
  });

  it('re-reads from Firestore when barryOpen transitions to true', () => {
    expect(chatPanel).toContain('syncFromCanonical');
    expect(chatPanel).toMatch(/barryOpen && !prevBarryOpenRef\.current/);
  });

  it('the re-sync is non-fatal (try/catch)', () => {
    expect(chatPanel).toMatch(/syncFromCanonical[\s\S]{0,500}catch.*\(err\)/);
  });
});

describe('4 — no duplicate conversations created', () => {
  const rawPanel = read('../components/scout/BarryICPPanel.jsx');
  const chatPanel = code(read('../components/dashboard/BarryChatPanel.jsx'));

  it('sidecar canonical save targets missionControl, not icpChat', () => {
    const idx = rawPanel.indexOf('Gate 1: persist to the canonical');
    expect(idx).toBeGreaterThan(-1);
    const canonBlock = rawPanel.slice(idx, idx + 600);
    expect(canonBlock).toContain("'missionControl'");
    expect(canonBlock).not.toContain("'icpChat'");
  });

  it('BarryChatPanel still reads and writes missionControl', () => {
    expect(chatPanel).toContain("'barryConversations', 'missionControl'");
  });
});

describe('5 — transient surface context does not pollute the canonical conversation', () => {
  const panel = read('../components/scout/BarryICPPanel.jsx');
  const chatPanel = read('../components/dashboard/BarryChatPanel.jsx');

  it('icpMode is sent as a request parameter, not stored in missionControl', () => {
    // icpMode appears in the fetch body (ephemeral request param)
    expect(panel).toContain('icpMode: true');
    expect(panel).toContain('.netlify/functions/barryMissionChat');
  });

  it('the canonical save does not include icpProfile or icpMode', () => {
    const idx = panel.indexOf('Gate 1: persist to the canonical');
    expect(idx).toBeGreaterThan(-1);
    const canonBlock = panel.slice(idx, idx + 600);
    expect(canonBlock).toContain("messages: canonMessages");
    expect(canonBlock).not.toMatch(/icpProfile|icpMode|nudge/);
  });

  it('the shell navigation context is ephemeral (not persisted by BarryChatPanel)', () => {
    // BarryChatPanel receives navigationContext as a prop and sends it with
    // API calls, but saveConversation only writes messages/history/mode.
    expect(chatPanel).toMatch(/saveConversation\(userId, messages, conversationHistoryRef\.current, modeRef\.current\)/);
  });
});

describe('6 — "start over" does not destroy the canonical conversation', () => {
  const panel = read('../components/scout/BarryICPPanel.jsx');

  it('deletes the legacy icpChat doc (harmless cleanup)', () => {
    expect(panel).toMatch(/deleteDoc.*barryConversations', 'icpChat'/);
  });

  it('does not delete the canonical missionControl doc', () => {
    expect(panel).not.toMatch(/deleteDoc.*barryConversations', 'missionControl'/);
  });

  it('resets ICP params without clearing conversation history', () => {
    // After Gate 1, "start over" sends the reclarification with existing
    // conversationHistory, not an empty array.
    expect(panel).toMatch(/sendToBarry\('__ICP_RECLARIFICATION__', conversationHistory,/);
  });
});

describe('7 — Gate 0 invariants still hold', () => {
  const onboarding = read('../pages/Onboarding/BarryOnboarding.jsx');

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

describe('8 — proposal module still writes nothing before confirmation', () => {
  const proposal = read('../utils/targetingProposal.js');
  const component = read('../components/onboarding/TargetingProposal.jsx');

  it('the proposal module makes no writes and no searches', () => {
    for (const src of [proposal, component]) {
      expect(src).not.toMatch(/setDoc|updateDoc|addDoc|search-companies|icpProfiles|setActiveIcpProfile/);
    }
  });
});
