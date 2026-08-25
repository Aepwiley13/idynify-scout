/**
 * Gate 3 B3-C1 — One Barry / One Composer Correction
 *
 * Structural invariants verified by source scan:
 *
 * C1-1  BarryOnboarding accepts embedded mode via forwardRef + useImperativeHandle.
 * C1-2  Workspace composer routes to BarryOnboarding.submit during prospecting.
 * C1-3  BarryOnboarding suppresses competing presentation in embedded mode.
 * C1-4  BarryOnboarding emits messages/processing/step via callbacks in embedded mode.
 * C1-5  BarryOnboarding skips appendTurn when embedded (workspace handles persistence).
 * C1-6  No new conversation store or onboarding state machine introduced.
 * C1-7  Workspace isBusy includes prospecting processing state.
 * C1-8  Workspace composerDisabled respects prospecting step.
 * C1-9  TargetingProposal, save confirmation, and accelerator render in embedded mode.
 * C1-10 handleKeyDown no longer references non-existent 'handoff' phase.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const barryOnboarding = read('../pages/Onboarding/BarryOnboarding.jsx');
const workspace = read('../pages/Barry/BarryWorkspace.jsx');

const barryCode = code(barryOnboarding);
const workspaceCode = code(workspace);

// ═══════════════════════════════════════════════════════════════════════════
// C1-1 — BarryOnboarding embedded mode interface
// ═══════════════════════════════════════════════════════════════════════════

describe('C1-1 — Embedded mode interface', () => {
  it('imports forwardRef and useImperativeHandle', () => {
    expect(barryOnboarding).toMatch(/forwardRef/);
    expect(barryOnboarding).toMatch(/useImperativeHandle/);
  });

  it('wraps component with forwardRef', () => {
    expect(barryCode).toMatch(/forwardRef\(function BarryOnboarding/);
  });

  it('accepts embedded prop', () => {
    expect(barryCode).toMatch(/embedded\s*=\s*false/);
  });

  it('accepts onBarryMessage callback prop', () => {
    expect(barryCode).toMatch(/onBarryMessage\s*=\s*null/);
  });

  it('accepts onProcessing callback prop', () => {
    expect(barryCode).toMatch(/onProcessing\s*=\s*null/);
  });

  it('accepts onStepChange callback prop', () => {
    expect(barryCode).toMatch(/onStepChange\s*=\s*null/);
  });

  it('exposes submit via useImperativeHandle', () => {
    expect(barryCode).toMatch(/useImperativeHandle\(ref/);
    expect(barryCode).toMatch(/submit:\s*\(text\)\s*=>\s*handleSubmit\(null,\s*text\)/);
  });

  it('handleSubmit accepts optional external text parameter', () => {
    expect(barryCode).toMatch(/async function handleSubmit\(e,\s*externalText\s*=\s*null\)/);
  });

  it('uses externalText when provided, userInput otherwise', () => {
    expect(barryCode).toMatch(/\(externalText \|\| userInput\)\.trim\(\)/);
  });

  it('exports as default (not inline export)', () => {
    expect(barryOnboarding).toMatch(/export default BarryOnboarding/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C1-2 — Workspace composer routes to BarryOnboarding.submit
// ═══════════════════════════════════════════════════════════════════════════

describe('C1-2 — Composer routing to BarryOnboarding', () => {
  it('workspace creates onboardingRef', () => {
    expect(workspaceCode).toMatch(/onboardingRef\s*=\s*useRef\(null\)/);
  });

  it('handleFirstExperienceSubmit detects prospecting state', () => {
    expect(workspaceCode).toMatch(/feCtrl\.decision\?\.kind === 'in-place'/);
  });

  it('routes composer input through onboardingRef.submit during prospecting', () => {
    expect(workspaceCode).toMatch(/onboardingRef\.current\.submit\(text\)/);
  });

  it('adds user turn via feCtrl.addTurn before submitting to onboarding', () => {
    const submitBlock = workspaceCode.slice(workspaceCode.indexOf('handleFirstExperienceSubmit'));
    const addTurnIdx = submitBlock.indexOf('feCtrl.addTurn');
    const submitIdx = submitBlock.indexOf('onboardingRef.current.submit');
    expect(addTurnIdx).toBeGreaterThan(-1);
    expect(submitIdx).toBeGreaterThan(-1);
    expect(addTurnIdx).toBeLessThan(submitIdx);
  });

  it('passes ref to BarryOnboarding component', () => {
    expect(workspaceCode).toMatch(/ref=\{onboardingRef\}/);
  });

  it('passes embedded prop to BarryOnboarding', () => {
    expect(workspaceCode).toMatch(/<BarryOnboarding[\s\S]*?embedded/);
  });

  it('passes onBarryMessage callback that adds turns', () => {
    expect(workspaceCode).toMatch(/onBarryMessage=\{.*feCtrl\.addTurn/);
  });

  it('passes onProcessing callback', () => {
    expect(workspaceCode).toMatch(/onProcessing=\{setProspectingBusy\}/);
  });

  it('passes onStepChange callback', () => {
    expect(workspaceCode).toMatch(/onStepChange=\{setProspectingStep\}/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C1-3 — Competing presentation suppressed
// ═══════════════════════════════════════════════════════════════════════════

describe('C1-3 — Competing presentation suppressed in embedded mode', () => {
  it('header is hidden when embedded', () => {
    expect(barryCode).toMatch(/!embedded && <div className="barry-onboarding-header"/);
  });

  it('initial Barry message is hidden when embedded', () => {
    expect(barryCode).toMatch(/!embedded && conversationHistory\.length === 0/);
  });

  it('conversation history is hidden when embedded', () => {
    expect(barryCode).toMatch(/!embedded && conversationHistory\.map/);
  });

  it('processing indicator is hidden when embedded', () => {
    expect(barryCode).toMatch(/!embedded && isProcessing && step !== 'saving'/);
  });

  it('input form is hidden when embedded', () => {
    expect(barryCode).toMatch(/!embedded && \(step === 'asking' \|\| step === 'clarifying'\)/);
  });

  it('returns null during loading when embedded', () => {
    expect(barryCode).toMatch(/loading && embedded\) return null/);
  });

  it('does not focus input when embedded', () => {
    expect(barryCode).toMatch(/!embedded && \(step === 'asking' \|\| step === 'clarifying'\) && inputRef/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C1-4 — Emit callbacks in embedded mode
// ═══════════════════════════════════════════════════════════════════════════

describe('C1-4 — Emit callbacks', () => {
  it('defines emitMessage helper', () => {
    expect(barryCode).toMatch(/function emitMessage\(msg\)/);
  });

  it('defines emitStep helper', () => {
    expect(barryCode).toMatch(/function emitStep\(s\)/);
  });

  it('defines emitProcessing helper', () => {
    expect(barryCode).toMatch(/function emitProcessing\(busy\)/);
  });

  it('emits step changes via useEffect', () => {
    expect(barryCode).toMatch(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?onStepChange\(step\)/);
  });

  it('emits processing changes via useEffect', () => {
    expect(barryCode).toMatch(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?onProcessing\(isProcessing\)/);
  });

  it('emits initial barryMessage once after loading', () => {
    expect(barryCode).toMatch(/didEmitInitialRef/);
    expect(barryCode).toMatch(/emitMessage\(barryMessage\)/);
  });

  it('emits Barry response in handleSubmit', () => {
    const submitBlock = barryCode.slice(
      barryCode.indexOf('async function handleSubmit'),
      barryCode.indexOf('async function analyzeSite') || barryCode.indexOf('async function saveConversationState'),
    );
    const emitCalls = (submitBlock.match(/emitMessage\(/g) || []).length;
    expect(emitCalls).toBeGreaterThanOrEqual(2);
  });

  it('emits message in handleRefine', () => {
    const refineBlock = barryCode.slice(barryCode.indexOf('function handleRefine'));
    expect(refineBlock).toMatch(/emitMessage\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C1-5 — appendTurn skipped when embedded
// ═══════════════════════════════════════════════════════════════════════════

describe('C1-5 — appendTurn skipped when embedded', () => {
  it('guards user message appendTurn with !embedded', () => {
    expect(barryCode).toMatch(/if \(!embedded\) \{[\s\S]*?appendTurn\(db, user\.uid, \{ role: 'user'/);
  });

  it('guards Barry response appendTurn with !embedded', () => {
    expect(barryCode).toMatch(/if \(!embedded\) \{[\s\S]*?appendTurn\(db, user\.uid, \{ role: 'assistant', content: barryMsg/);
  });

  it('guards error appendTurn with !embedded', () => {
    expect(barryCode).toMatch(/if \(!embedded\) \{[\s\S]*?appendTurn\(db, errUser\.uid/);
  });

  it('guards handleConfirm appendTurn with !embedded', () => {
    expect(barryCode).toMatch(/if \(!embedded\) \{[\s\S]*?appendTurn\(db, user\.uid, \{ role: 'assistant', content: finalMessage/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C1-6 — No new architecture
// ═══════════════════════════════════════════════════════════════════════════

describe('C1-6 — No new conversation store or state machine', () => {
  it('workspace does not import barryICPConversation', () => {
    expect(workspace).not.toMatch(/import.*barryICPConversation/);
  });

  it('workspace does not call barryICPConversation', () => {
    expect(workspaceCode).not.toMatch(/barryICPConversation/);
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
});

// ═══════════════════════════════════════════════════════════════════════════
// C1-7 — isBusy includes prospecting
// ═══════════════════════════════════════════════════════════════════════════

describe('C1-7 — isBusy includes prospecting', () => {
  it('workspace tracks prospectingBusy state', () => {
    expect(workspaceCode).toMatch(/prospectingBusy.*useState\(false\)/);
  });

  it('isBusy includes prospectingBusy', () => {
    expect(workspaceCode).toMatch(/isBusy\s*=\s*feCtrl\.classifying \|\| prospectingBusy/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C1-8 — Composer disabled respects prospecting step
// ═══════════════════════════════════════════════════════════════════════════

describe('C1-8 — Composer disabled respects prospecting step', () => {
  it('workspace tracks prospectingStep state', () => {
    expect(workspaceCode).toMatch(/prospectingStep.*useState\(null\)/);
  });

  it('prospectingReady checks for asking/clarifying steps', () => {
    expect(workspaceCode).toMatch(/prospectingReady/);
    expect(workspaceCode).toMatch(/\['asking', 'clarifying'\]\.includes\(prospectingStep\)/);
  });

  it('composerDisabled considers prospecting readiness', () => {
    expect(workspaceCode).toMatch(/isProspecting && !prospectingReady/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C1-9 — Structured objects preserved in embedded mode
// ═══════════════════════════════════════════════════════════════════════════

describe('C1-9 — Structured objects preserved', () => {
  it('TargetingProposal renders regardless of embedded mode', () => {
    expect(barryCode).toMatch(/<TargetingProposal/);
    const tpLine = barryCode.split('\n').find(l => l.includes('TargetingProposal'));
    expect(tpLine).toBeDefined();
    expect(tpLine).not.toMatch(/!embedded/);
  });

  it('save confirmation screen renders regardless of embedded mode', () => {
    expect(barryCode).toMatch(/save-confirmation-screen/);
    const saveLine = barryCode.split('\n').find(l => l.includes('save-confirmation-screen'));
    expect(saveLine).toBeDefined();
    expect(saveLine).not.toMatch(/!embedded/);
  });

  it('website accelerator renders regardless of embedded mode', () => {
    expect(barryCode).toMatch(/barry-accelerator/);
    const acceleratorLine = barryCode.split('\n').find(l => l.includes('barry-accelerator') && l.includes('form'));
    expect(acceleratorLine).toBeDefined();
    expect(acceleratorLine).not.toMatch(/!embedded/);
  });

  it('error messages render regardless of embedded mode', () => {
    expect(barryCode).toMatch(/error-message/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C1-10 — handleKeyDown fixed
// ═══════════════════════════════════════════════════════════════════════════

describe('C1-10 — handleKeyDown fixed', () => {
  it('does not reference non-existent handoff phase', () => {
    expect(workspaceCode).not.toMatch(/feCtrl\.phase !== 'handoff'/);
    expect(workspaceCode).not.toMatch(/phase === 'handoff'/);
  });

  it('routes to handleFirstExperienceSubmit during first experience', () => {
    const keyBlock = workspaceCode.slice(
      workspaceCode.indexOf('function handleKeyDown'),
      workspaceCode.indexOf('function handleFirstExperienceSubmit'),
    );
    expect(keyBlock).toMatch(/isFirstExperience/);
    expect(keyBlock).toMatch(/handleFirstExperienceSubmit/);
  });
});
