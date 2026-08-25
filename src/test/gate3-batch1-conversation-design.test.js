/**
 * Gate 3 Batch 1 — Conversation Design System
 *
 * Structural invariants verified by source scan:
 *
 * B1-1  ConversationCard maps kind to accent color via KIND_META.
 * B1-2  ChoiceChips supports string and object options, fires onSelect.
 * B1-3  BarryChatPanel preserves kind from canonical turns (C-F1).
 * B1-4  BarryICPPanel preserves kind from canonical turns (C-F1).
 * B1-5  BarryWorkspace reads persisted barryMode from missionControl (C-F2).
 * B1-6  BarryWorkspace renders structured kinds via ConversationCard.
 * B1-7  Unused eslint-disable directives removed from BarryChatPanel (C-F3).
 * B1-8  ChoiceChips supports selected state and free-text input.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const card = read('../components/conversation/ConversationCard.jsx');
const cardCss = read('../components/conversation/ConversationCard.css');
const chips = read('../components/conversation/ChoiceChips.jsx');
const chatPanel = read('../components/dashboard/BarryChatPanel.jsx');
const icpPanel = read('../components/scout/BarryICPPanel.jsx');
const workspace = read('../pages/Barry/BarryWorkspace.jsx');

const chatCode = code(chatPanel);
const icpCode = code(icpPanel);
const workspaceCode = code(workspace);

// ═══════════════════════════════════════════════════════════════════════════
// B1-1 — ConversationCard renders kind-discriminated structured cards
// ═══════════════════════════════════════════════════════════════════════════

describe('B1-1 — ConversationCard kind-to-accent mapping', () => {
  it('defines KIND_META with all five canonical kinds', () => {
    expect(card).toMatch(/angles/);
    expect(card).toMatch(/choice/);
    expect(card).toMatch(/proposal/);
    expect(card).toMatch(/website/);
    expect(card).toMatch(/result/);
  });

  it('uses CSS custom property for accent color', () => {
    expect(card).toMatch(/--card-accent/);
    expect(cardCss).toMatch(/var\(--card-accent/);
  });

  it('renders accent border via CSS left border', () => {
    expect(cardCss).toMatch(/border-left:\s*3px\s+solid/);
  });

  it('accepts kind, label, children, and className props', () => {
    expect(card).toMatch(/kind/);
    expect(card).toMatch(/label/);
    expect(card).toMatch(/children/);
    expect(card).toMatch(/className/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B1-2 — ChoiceChips interactive selection component
// ═══════════════════════════════════════════════════════════════════════════

describe('B1-2 — ChoiceChips supports string and object options', () => {
  it('handles both string and object option formats', () => {
    expect(chips).toMatch(/typeof opt === 'string'/);
  });

  it('fires onSelect callback', () => {
    expect(chips).toMatch(/onSelect\?\./);
  });

  it('renders as buttons with chip class', () => {
    expect(chips).toMatch(/choice-chip/);
    expect(chips).toMatch(/type="button"/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B1-3 — BarryChatPanel preserves kind from canonical turns (C-F1)
// ═══════════════════════════════════════════════════════════════════════════

describe('B1-3 — BarryChatPanel canonical kind preservation', () => {
  it('loadConversation maps kind from canonical turns', () => {
    expect(chatCode).toMatch(/kind:\s*t\.kind/);
  });

  it('sets has_message_angles from kind discriminator', () => {
    expect(chatCode).toMatch(/has_message_angles:\s*t\.kind\s*===\s*'angles'/);
  });

  it('renders angles badge for kind: angles turns without live angle data', () => {
    expect(chatCode).toMatch(/msg\.kind\s*===\s*'angles'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B1-4 — BarryICPPanel preserves kind from canonical turns (C-F1)
// ═══════════════════════════════════════════════════════════════════════════

describe('B1-4 — BarryICPPanel canonical kind preservation', () => {
  it('maps kind from canonical turns in displayMsgs', () => {
    expect(icpCode).toMatch(/kind:\s*t\.kind/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B1-5 — BarryWorkspace reads persisted barryMode (C-F2)
// ═══════════════════════════════════════════════════════════════════════════

describe('B1-5 — Workspace reads persisted barryMode from missionControl', () => {
  it('fetches missionControl doc in init', () => {
    expect(workspaceCode).toMatch(/barryConversations.*missionControl/);
  });

  it('reads mode from missionControl snapshot', () => {
    expect(workspaceCode).toMatch(/mcSnap/);
    expect(workspaceCode).toMatch(/\.data\(\)\.mode/);
  });

  it('sets barryMode from persisted value', () => {
    expect(workspaceCode).toMatch(/setBarryMode\(persistedMode\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B1-6 — BarryWorkspace renders structured kinds via ConversationCard
// ═══════════════════════════════════════════════════════════════════════════

describe('B1-6 — Workspace structured kind rendering', () => {
  it('imports ConversationCard', () => {
    expect(workspace).toMatch(/import ConversationCard/);
  });

  it('uses ConversationCard with kind prop for structured turns', () => {
    expect(workspaceCode).toMatch(/ConversationCard\s+kind=/);
  });

  it('renders plain ReactMarkdown for non-structured turns', () => {
    expect(workspaceCode).toMatch(/ReactMarkdown/);
  });

  it('discriminates on turn.kind for card rendering', () => {
    expect(workspaceCode).toMatch(/turn\.kind/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B1-7 — Unused eslint-disable directives removed (C-F3)
// ═══════════════════════════════════════════════════════════════════════════

describe('B1-7 — BarryChatPanel eslint-disable cleanup (C-F3)', () => {
  const eslintDisableLines = chatPanel.split('\n').filter(
    line => line.includes('eslint-disable-line react-hooks/exhaustive-deps')
  );

  it('has at most one eslint-disable directive (the one on kpiContextReady dep)', () => {
    expect(eslintDisableLines.length).toBeLessThanOrEqual(1);
  });

  it('remaining directive is on the kpiContextReady effect if any', () => {
    if (eslintDisableLines.length === 1) {
      expect(eslintDisableLines[0]).toMatch(/kpiContextReady/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B1-8 — ChoiceChips supports selected state and free-text input
// ═══════════════════════════════════════════════════════════════════════════

describe('B1-8 — ChoiceChips selected state and free-text', () => {
  it('accepts selected prop for pre-selected state', () => {
    expect(chips).toMatch(/selected/);
    expect(chips).toMatch(/isSelected/);
  });

  it('supports allowFreeText prop with text input', () => {
    expect(chips).toMatch(/allowFreeText/);
    expect(chips).toMatch(/choice-chips-free/);
  });

  it('uses aria-pressed for accessibility', () => {
    expect(chips).toMatch(/aria-pressed/);
  });

  it('submits free text on Enter key', () => {
    expect(chips).toMatch(/e\.key\s*===\s*'Enter'/);
  });
});
