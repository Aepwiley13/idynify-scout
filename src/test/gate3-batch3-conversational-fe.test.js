/**
 * Gate 3 Batch 3 — Conversational First Experience
 *
 * Structural invariants verified by source scan:
 *
 * B3-1  Handoff seam eliminated — no rendering branch replaces workspace.
 * B3-2  Controller delivers decisions as conversation turns with _feCard.
 * B3-3  Workspace renders structured cards inline in thread.
 * B3-4  Prospecting (BarryOnboarding) renders inside workspace thread.
 * B3-5  Relationship (RelationshipFirstValue) renders inside workspace thread.
 * B3-6  Navigate/blocked/action render as in-thread buttons.
 * B3-7  Workspace header, thread, composer survive delivery phase.
 * B3-8  BarryOnboarding stepper hidden when rendered in workspace.
 * B3-9  Controller phase machine uses 'delivering' not 'handoff'.
 * B3-10 Canonical persistence continues through delivering phase.
 * B3-11 No new conversation store or persistence architecture introduced.
 * B3-12 Gate 0 ambiguity boundary preserved.
 * B3-13 Targeting proposal path preserved (BarryOnboarding unchanged).
 * B3-14 Website accelerator path preserved (BarryOnboarding unchanged).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const controller = read('../hooks/useFirstExperienceController.js');
const workspace = read('../pages/Barry/BarryWorkspace.jsx');
const workspaceCss = read('../pages/Barry/BarryWorkspace.css');
const barryOnboarding = read('../pages/Onboarding/BarryOnboarding.jsx');
const firstExp = read('../pages/Onboarding/FirstExperience.jsx');

const controllerCode = code(controller);
const workspaceCode = code(workspace);
const barryOnboardingCode = code(barryOnboarding);

// ═══════════════════════════════════════════════════════════════════════════
// B3-1 — Handoff seam eliminated
// ═══════════════════════════════════════════════════════════════════════════

describe('B3-1 — Handoff seam eliminated', () => {
  it('workspace does not import FirstExperience', () => {
    expect(workspace).not.toMatch(/import FirstExperience/);
  });

  it('workspace does not render <FirstExperience', () => {
    expect(workspaceCode).not.toMatch(/<FirstExperience/);
  });

  it('workspace does not check feCtrl.phase === handoff for separate rendering', () => {
    expect(workspaceCode).not.toMatch(/feCtrl\.phase === 'handoff'/);
  });

  it('workspace does not render presetDecision/presetWho props', () => {
    expect(workspaceCode).not.toMatch(/presetDecision=\{/);
    expect(workspaceCode).not.toMatch(/presetWho=\{/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B3-2 — Controller delivers decisions as conversation turns
// ═══════════════════════════════════════════════════════════════════════════

describe('B3-2 — Controller delivery turns', () => {
  it('has a deliverDecision function', () => {
    expect(controllerCode).toMatch(/function deliverDecision/);
  });

  it('adds turns with _feCard metadata for prospecting', () => {
    expect(controllerCode).toMatch(/_feCard:\s*'prospecting'/);
  });

  it('adds turns with _feCard metadata for relationship', () => {
    expect(controllerCode).toMatch(/_feCard:\s*'relationship'/);
  });

  it('adds turns with _feCard metadata for navigate', () => {
    expect(controllerCode).toMatch(/_feCard:\s*'navigate'/);
  });

  it('adds turns with _feCard metadata for blocked', () => {
    expect(controllerCode).toMatch(/_feCard:\s*'blocked'/);
  });

  it('uses routed.headline as turn content', () => {
    expect(controllerCode).toMatch(/content:\s*routed\.headline/);
  });

  it('transitions to delivering phase', () => {
    expect(controllerCode).toMatch(/setPhase\('delivering'\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B3-3 — Workspace renders structured cards inline
// ═══════════════════════════════════════════════════════════════════════════

describe('B3-3 — Inline structured cards', () => {
  it('checks turn._feCard to render cards', () => {
    expect(workspaceCode).toMatch(/turn\._feCard/);
  });

  it('renders cards only on the last turn', () => {
    expect(workspaceCode).toMatch(/i === feTurns\.length - 1/);
  });

  it('wraps cards in barry-workspace-fe-card class', () => {
    expect(workspaceCode).toMatch(/barry-workspace-fe-card/);
  });

  it('wraps action buttons in barry-workspace-fe-actions class', () => {
    expect(workspaceCode).toMatch(/barry-workspace-fe-actions/);
  });

  it('CSS defines fe-card styles', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-card/);
  });

  it('CSS defines fe-actions styles', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-actions/);
  });

  it('CSS defines fe-btn styles', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-btn/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B3-4 — Prospecting renders inside workspace thread
// ═══════════════════════════════════════════════════════════════════════════

describe('B3-4 — Prospecting in-thread', () => {
  it('workspace imports BarryOnboarding directly', () => {
    expect(workspace).toMatch(/import BarryOnboarding from/);
  });

  it('renders BarryOnboarding when _feCard is prospecting', () => {
    expect(workspaceCode).toMatch(/_feCard === 'prospecting'/);
    expect(workspaceCode).toMatch(/<BarryOnboarding/);
  });

  it('passes knownName to BarryOnboarding', () => {
    expect(workspaceCode).toMatch(/knownName=\{feCtrl\.who\?\.name/);
  });

  it('passes goal from pending restatement', () => {
    expect(workspaceCode).toMatch(/goal=\{feCtrl\.pending\?\.restatement/);
  });

  it('enables composer during prospecting delivery', () => {
    expect(workspaceCode).toMatch(/isProspecting/);
    expect(workspaceCode).toMatch(/isDelivering && !isProspecting/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B3-5 — Relationship renders inside workspace thread
// ═══════════════════════════════════════════════════════════════════════════

describe('B3-5 — Relationship in-thread', () => {
  it('workspace imports RelationshipFirstValue directly', () => {
    expect(workspace).toMatch(/import RelationshipFirstValue from/);
  });

  it('renders RelationshipFirstValue when _feCard is relationship', () => {
    expect(workspaceCode).toMatch(/_feCard === 'relationship'/);
    expect(workspaceCode).toMatch(/<RelationshipFirstValue/);
  });

  it('passes decision and knownName to RelationshipFirstValue', () => {
    expect(workspaceCode).toMatch(/decision=\{feCtrl\.decision\}/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B3-6 — Navigate/blocked/action render as in-thread buttons
// ═══════════════════════════════════════════════════════════════════════════

describe('B3-6 — Action buttons in-thread', () => {
  it('renders navigate button for navigate card', () => {
    expect(workspaceCode).toMatch(/_feCard === 'navigate'/);
    expect(workspaceCode).toMatch(/Take me there/);
  });

  it('renders blocked card with setup and option buttons', () => {
    expect(workspaceCode).toMatch(/_feCard === 'blocked'/);
    expect(workspaceCode).toMatch(/Set that up/);
  });

  it('renders held intent as secondary button', () => {
    expect(workspaceCode).toMatch(/feCtrl\.held/);
    expect(workspaceCode).toMatch(/intentLabel\(feCtrl\.held\)/);
  });

  it('uses navigate for destination paths', () => {
    expect(workspaceCode).toMatch(/navigate\(feCtrl\.decision\.destination\.path\)/);
  });

  it('imports intentLabel from firstValueRouting', () => {
    expect(workspace).toMatch(/import.*intentLabel.*from.*firstValueRouting/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B3-7 — Workspace shell survives delivery phase
// ═══════════════════════════════════════════════════════════════════════════

describe('B3-7 — Continuous workspace shell', () => {
  it('single FE rendering branch handles all phases including delivering', () => {
    expect(workspaceCode).toMatch(/isFirstExperience && feCtrl\.phase !== 'loading'/);
  });

  it('delivering phase renders inside same header/thread/composer', () => {
    expect(workspaceCode).toMatch(/isDelivering/);
    const feBlock = workspaceCode.slice(workspaceCode.indexOf("feCtrl.phase !== 'loading'"));
    expect(feBlock).toMatch(/barry-workspace-header/);
    expect(feBlock).toMatch(/barry-workspace-thread/);
    expect(feBlock).toMatch(/barry-workspace-composer/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B3-8 — BarryOnboarding stepper hidden in workspace
// ═══════════════════════════════════════════════════════════════════════════

describe('B3-8 — BarryOnboarding stepper hidden', () => {
  it('CSS hides barry-onboarding-header inside fe-card', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-card .barry-onboarding-header/);
    expect(workspaceCss).toMatch(/display:\s*none/);
  });

  it('CSS removes shadow and sets card-like border', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-card .barry-onboarding/);
    expect(workspaceCss).toMatch(/box-shadow:\s*none/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B3-9 — Controller uses 'delivering' not 'handoff'
// ═══════════════════════════════════════════════════════════════════════════

describe('B3-9 — delivering replaces handoff', () => {
  it('controller does not set handoff phase', () => {
    expect(controllerCode).not.toMatch(/setPhase\('handoff'\)/);
  });

  it('controller sets delivering phase', () => {
    expect(controllerCode).toMatch(/setPhase\('delivering'\)/);
  });

  it('controller imports route types for delivery', () => {
    expect(controller).toMatch(/ROUTE_IN_PLACE/);
    expect(controller).toMatch(/ROUTE_NAVIGATE/);
    expect(controller).toMatch(/ROUTE_BLOCKED/);
    expect(controller).toMatch(/ROUTE_RELATIONSHIP/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B3-10 — Canonical persistence through delivering
// ═══════════════════════════════════════════════════════════════════════════

describe('B3-10 — Canonical persistence through delivery', () => {
  it('FE turn persistence useEffect still exists', () => {
    expect(workspaceCode).toMatch(/useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?feCtrl\.turns/);
  });

  it('delivery turns have content and will be persisted', () => {
    expect(controllerCode).toMatch(/content:\s*routed\.headline/);
    expect(controllerCode).toMatch(/content:\s*msg/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B3-11 — No new conversation store
// ═══════════════════════════════════════════════════════════════════════════

describe('B3-11 — No new persistence architecture', () => {
  it('controller does not import appendTurn', () => {
    expect(controller).not.toMatch(/import.*appendTurn/);
  });

  it('controller does not import setDoc or addDoc', () => {
    expect(controller).not.toMatch(/import.*\bsetDoc\b/);
    expect(controller).not.toMatch(/import.*\baddDoc\b/);
  });

  it('workspace uses existing appendTurn from barryCanonical', () => {
    expect(workspace).toMatch(/import.*appendTurn.*from.*barryCanonical/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B3-12 — Gate 0 ambiguity boundary preserved
// ═══════════════════════════════════════════════════════════════════════════

describe('B3-12 — Gate 0 ambiguity preserved', () => {
  it('BarryOnboarding still checks isAmbiguous gating', () => {
    expect(barryOnboardingCode).toMatch(/isAmbiguous/);
    expect(barryOnboardingCode).toMatch(/gatedStep/);
  });

  it('BarryOnboarding still prevents confirming when ambiguous', () => {
    expect(barryOnboardingCode).toMatch(/!isAmbiguous.*confirming/);
  });

  it('controller ROUTE_CLARIFY still returns to intent phase', () => {
    expect(controllerCode).toMatch(/ROUTE_CLARIFY/);
    expect(controllerCode).toMatch(/setPhase\('intent'\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B3-13 — Targeting proposal path preserved
// ═══════════════════════════════════════════════════════════════════════════

describe('B3-13 — Targeting proposal unchanged', () => {
  it('BarryOnboarding still imports TargetingProposal', () => {
    expect(barryOnboarding).toMatch(/import TargetingProposal/);
  });

  it('BarryOnboarding still renders TargetingProposal in confirming step', () => {
    expect(barryOnboardingCode).toMatch(/step === 'confirming'/);
    expect(barryOnboardingCode).toMatch(/<TargetingProposal/);
  });

  it('BarryOnboarding still calls handleConfirm for ICP creation', () => {
    expect(barryOnboardingCode).toMatch(/handleConfirm/);
    expect(barryOnboardingCode).toMatch(/onboardingComplete/);
  });

  it('BarryOnboarding still imports buildProposal', () => {
    expect(barryOnboarding).toMatch(/import.*buildProposal.*from.*targetingProposal/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B3-14 — Website accelerator path preserved
// ═══════════════════════════════════════════════════════════════════════════

describe('B3-14 — Website accelerator unchanged', () => {
  it('BarryOnboarding still imports readWebsite and acceleratorQuestion', () => {
    expect(barryOnboarding).toMatch(/import.*readWebsite.*from.*websiteAccelerator/);
    expect(barryOnboarding).toMatch(/import.*acceleratorQuestion.*from.*websiteAccelerator/);
  });

  it('BarryOnboarding still renders website accelerator form', () => {
    expect(barryOnboardingCode).toMatch(/barry-accelerator/);
    expect(barryOnboardingCode).toMatch(/analyzeSite/);
  });

  it('BarryOnboarding still calls analyze-website function', () => {
    expect(barryOnboardingCode).toMatch(/analyze-website/);
  });
});
