/**
 * Gate 3 B4 — Visual Recomposition
 *
 * Structural invariants verified by source scan:
 *
 * V1  Embedded container flattened — no visible application shell.
 * V2  Confirmation section aligned to thread (standalone padding removed).
 * V3  Save confirmation restyled for conversational context.
 * V4  Accelerator aligned to thread.
 * V5  TargetingProposal preserved — still renders in confirming step.
 * V6  Save confirmation structure preserved — still renders in saving step.
 * V7  Website accelerator structure preserved.
 * V8  No new architecture — no new stores, state machines, or duplicated authority.
 * V9  Intelligence behavior untouched — Gate 0 ambiguity, retrieval constraints, ICP authority.
 * V10 RelationshipFirstValue already conversational — renders directly in thread.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const workspaceCss = read('../pages/Barry/BarryWorkspace.css');
const barryOnboarding = read('../pages/Onboarding/BarryOnboarding.jsx');
const barryCode = code(barryOnboarding);
const workspace = read('../pages/Barry/BarryWorkspace.jsx');
const workspaceCode = code(workspace);

// ═══════════════════════════════════════════════════════════════════════════
// V1 — Embedded container flattened
// ═══════════════════════════════════════════════════════════════════════════

describe('V1 — Embedded container flattened', () => {
  it('background is transparent in embedded context', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-card \.barry-onboarding[\s\S]*?background:\s*transparent/);
  });

  it('border is removed in embedded context', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-card \.barry-onboarding[\s\S]*?border:\s*none/);
  });

  it('overflow is visible in embedded context', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-card \.barry-onboarding[\s\S]*?overflow:\s*visible/);
  });

  it('conversation area padding removed in embedded context', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-card \.barry-conversation[\s\S]*?padding:\s*0/);
  });

  it('conversation area overflow visible in embedded context', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-card \.barry-conversation[\s\S]*?overflow:\s*visible/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// V2 — Confirmation section aligned to thread
// ═══════════════════════════════════════════════════════════════════════════

describe('V2 — Confirmation section aligned to thread', () => {
  it('standalone avatar padding removed', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-card \.confirmation-section[\s\S]*?padding-left:\s*0/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// V3 — Save confirmation restyled for conversation
// ═══════════════════════════════════════════════════════════════════════════

describe('V3 — Save confirmation restyled for conversation', () => {
  it('save confirmation card scoped to embedded context', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-card \.save-confirmation-card/);
  });

  it('save confirmation header uses surface background instead of gradient', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-card \.save-confirmation-header[\s\S]*?background:\s*var\(--surface-alt/);
  });

  it('save confirmation title uses text color instead of white', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-card \.save-confirmation-title[\s\S]*?color:\s*var\(--text/);
  });

  it('save confirmation subtitle uses muted color instead of white', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-card \.save-confirmation-subtitle[\s\S]*?color:\s*var\(--text-muted/);
  });

  it('check icon uses green tint instead of white translucent', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-card \.save-check-icon[\s\S]*?color:\s*#22c55e/);
  });

  it('save screen standalone padding removed', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-card \.save-confirmation-screen[\s\S]*?padding-left:\s*0/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// V4 — Accelerator aligned to thread
// ═══════════════════════════════════════════════════════════════════════════

describe('V4 — Accelerator aligned to thread', () => {
  it('standalone padding removed', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-card \.barry-accelerator[\s\S]*?padding:\s*0/);
  });

  it('standalone max-width removed', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-card \.barry-accelerator[\s\S]*?max-width:\s*none/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// V5 — TargetingProposal preserved
// ═══════════════════════════════════════════════════════════════════════════

describe('V5 — TargetingProposal preserved', () => {
  it('TargetingProposal still renders in confirming step', () => {
    expect(barryCode).toMatch(/step === 'confirming' && extractedICP/);
    expect(barryCode).toMatch(/<TargetingProposal/);
  });

  it('TargetingProposal receives proposal from buildProposal', () => {
    expect(barryCode).toMatch(/proposal=\{buildProposal\(/);
  });

  it('TargetingProposal receives onConfirm callback', () => {
    expect(barryCode).toMatch(/onConfirm=\{handleConfirm\}/);
  });

  it('TargetingProposal receives onRefine callback', () => {
    expect(barryCode).toMatch(/onRefine=\{handleRefine\}/);
  });

  it('renders regardless of embedded mode', () => {
    const tpLine = barryCode.split('\n').find(l => l.includes('TargetingProposal'));
    expect(tpLine).toBeDefined();
    expect(tpLine).not.toMatch(/!embedded/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// V6 — Save confirmation structure preserved
// ═══════════════════════════════════════════════════════════════════════════

describe('V6 — Save confirmation structure preserved', () => {
  it('save confirmation renders in saving step', () => {
    expect(barryCode).toMatch(/step === 'saving' && savedICP/);
  });

  it('save confirmation card structure intact', () => {
    expect(barryCode).toMatch(/save-confirmation-card/);
    expect(barryCode).toMatch(/save-confirmation-header/);
    expect(barryCode).toMatch(/save-confirmation-summary/);
    expect(barryCode).toMatch(/save-searching-indicator/);
  });

  it('renders regardless of embedded mode', () => {
    const saveLine = barryCode.split('\n').find(l => l.includes('save-confirmation-screen'));
    expect(saveLine).toBeDefined();
    expect(saveLine).not.toMatch(/!embedded/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// V7 — Website accelerator structure preserved
// ═══════════════════════════════════════════════════════════════════════════

describe('V7 — Website accelerator preserved', () => {
  it('accelerator renders in asking step with no conversation', () => {
    expect(barryCode).toMatch(/step === 'asking' && conversationHistory\.length === 0/);
  });

  it('accelerator form structure intact', () => {
    expect(barryCode).toMatch(/barry-accelerator/);
    expect(barryCode).toMatch(/barry-accelerator-input/);
    expect(barryCode).toMatch(/barry-accelerator-btn/);
  });

  it('analyzeSite function preserved', () => {
    expect(barryCode).toMatch(/async function analyzeSite/);
  });

  it('renders regardless of embedded mode', () => {
    const acceleratorLine = barryCode.split('\n').find(l => l.includes('barry-accelerator') && l.includes('form'));
    expect(acceleratorLine).toBeDefined();
    expect(acceleratorLine).not.toMatch(/!embedded/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// V8 — No new architecture
// ═══════════════════════════════════════════════════════════════════════════

describe('V8 — No new architecture', () => {
  it('workspace does not import barryICPConversation', () => {
    expect(workspace).not.toMatch(/import.*barryICPConversation/);
  });

  it('workspace does not create a second ICP authority', () => {
    expect(workspaceCode).not.toMatch(/setDoc.*companyProfile/);
    expect(workspaceCode).not.toMatch(/setDoc.*icpProfiles/);
  });

  it('workspace does not duplicate classification logic', () => {
    expect(workspaceCode).not.toMatch(/normalizeClassification/);
    expect(workspaceCode).not.toMatch(/unclearClassification/);
  });

  it('controller still does not call appendTurn', () => {
    const ctrl = read('../hooks/useFirstExperienceController.js');
    const ctrlCode = code(ctrl);
    expect(ctrlCode).not.toMatch(/appendTurn\(/);
  });

  it('no new conversation store introduced', () => {
    expect(workspaceCode).not.toMatch(/barryICPConversation/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// V9 — Intelligence behavior untouched
// ═══════════════════════════════════════════════════════════════════════════

describe('V9 — Intelligence behavior untouched', () => {
  it('Gate 0 ambiguity gating preserved', () => {
    expect(barryCode).toMatch(/isAmbiguous/);
    expect(barryCode).toMatch(/hasRetrievalConstraint/);
  });

  it('ICP authority sequence preserved', () => {
    expect(barryCode).toMatch(/resolveActiveIcp\(user\.uid\)/);
    expect(barryCode).toMatch(/'icpProfiles', icpId/);
    expect(barryCode).toMatch(/setActiveIcpProfile\(user\.uid, icpId\)/);
    expect(barryCode).toMatch(/icpIdSource: 'barry_onboarding_confirmed'/);
  });

  it('handleConfirm still runs search when constraints exist', () => {
    expect(barryCode).toMatch(/canSearch/);
    expect(barryCode).toMatch(/search-companies/);
  });

  it('website analysis still merges into targeting', () => {
    expect(barryCode).toMatch(/async function analyzeSite/);
    expect(barryCode).toMatch(/readWebsite/);
  });

  it('conversation state persistence preserved', () => {
    expect(barryCode).toMatch(/async function saveConversationState/);
    expect(barryCode).toMatch(/barryConversations.*icp/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// V10 — RelationshipFirstValue already conversational
// ═══════════════════════════════════════════════════════════════════════════

describe('V10 — RelationshipFirstValue already conversational', () => {
  it('renders directly in workspace thread via _feCard', () => {
    expect(workspaceCode).toMatch(/_feCard === 'relationship'/);
    expect(workspaceCode).toMatch(/<RelationshipFirstValue/);
  });

  it('not wrapped in BarryOnboarding', () => {
    expect(barryCode).not.toMatch(/RelationshipFirstValue/);
  });

  it('uses CSS-var-based styling', () => {
    const rfvCss = read('../components/onboarding/RelationshipFirstValue.css');
    expect(rfvCss).toMatch(/var\(--border/);
    expect(rfvCss).toMatch(/var\(--surface/);
    expect(rfvCss).toMatch(/var\(--text/);
  });

  it('rfv margin reset in workspace context', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-card \.rfv[\s\S]*?margin:\s*0/);
  });
});
