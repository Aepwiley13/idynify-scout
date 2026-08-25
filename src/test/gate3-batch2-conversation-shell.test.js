/**
 * Gate 3 Batch 2 — Conversation Shell Integration
 *
 * Structural invariants verified by source scan:
 *
 * B2-1  useFirstExperienceController phase machine.
 * B2-2  Controller WHO flow and skip behavior.
 * B2-3  Controller resume/returning behavior (MODE_RESUME/MODE_REFINE).
 * B2-4  Controller does not create a new conversation authority.
 * B2-5  BarryWorkspace integrates controller for First Experience.
 * B2-6  BarryWorkspace removes visible onboarding stepper.
 * B2-7  FirstExperience thin rollback wrapper (preset props).
 * B2-8  rememberName behavior preserved in controller.
 * B2-9  Skip button CSS exists.
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
const firstExp = read('../pages/Onboarding/FirstExperience.jsx');
const workspaceCss = read('../pages/Barry/BarryWorkspace.css');

const controllerCode = code(controller);
const workspaceCode = code(workspace);
const firstExpCode = code(firstExp);

// ═══════════════════════════════════════════════════════════════════════════
// B2-1 — useFirstExperienceController phase machine
// ═══════════════════════════════════════════════════════════════════════════

describe('B2-1 — Controller phase machine', () => {
  it('initializes with loading phase', () => {
    expect(controllerCode).toMatch(/useState\('loading'\)/);
  });

  it('transitions through greeting → who → intent → classifying → handoff', () => {
    expect(controllerCode).toMatch(/setPhase\('who'\)/);
    expect(controllerCode).toMatch(/setPhase\('intent'\)/);
    expect(controllerCode).toMatch(/setPhase\('classifying'\)/);
    expect(controllerCode).toMatch(/setPhase\('handoff'\)/);
  });

  it('supports confirm phase for low-confidence classifications', () => {
    expect(controllerCode).toMatch(/setPhase\('confirm'\)/);
  });

  it('returns phase, turns, who, decision, classifying, pending, held', () => {
    expect(controllerCode).toMatch(/return\s*\{/);
    expect(controllerCode).toMatch(/phase,/);
    expect(controllerCode).toMatch(/turns,/);
    expect(controllerCode).toMatch(/who,/);
    expect(controllerCode).toMatch(/decision,/);
    expect(controllerCode).toMatch(/classifying,/);
    expect(controllerCode).toMatch(/pending,/);
    expect(controllerCode).toMatch(/held,/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B2-2 — Controller WHO flow and skip behavior
// ═══════════════════════════════════════════════════════════════════════════

describe('B2-2 — Controller WHO flow and skip', () => {
  it('resolves WHO via resolveWho', () => {
    expect(controllerCode).toMatch(/resolveWho\(user,\s*userData\)/);
  });

  it('checks shouldAsk and sessionStorage ASKED_KEY before asking name', () => {
    expect(controllerCode).toMatch(/resolved\.shouldAsk/);
    expect(controllerCode).toMatch(/sessionStorage\.getItem\(ASKED_KEY\)/);
  });

  it('generates greeting turn with name when known', () => {
    expect(controllerCode).toMatch(/Hey \$\{resolved\.name\}/);
  });

  it('generates greeting turn without name when unknown', () => {
    expect(controllerCode).toMatch(/Hey there!/);
  });

  it('provides skipName callback', () => {
    expect(controllerCode).toMatch(/skipName/);
    expect(controllerCode).toMatch(/const skipName = useCallback/);
  });

  it('skipName sets ASKED_KEY in sessionStorage', () => {
    const skipBlock = controllerCode.slice(controllerCode.indexOf('const skipName'));
    expect(skipBlock).toMatch(/sessionStorage\.setItem\(ASKED_KEY/);
  });

  it('skipName advances to intent phase', () => {
    const skipBlock = controllerCode.slice(controllerCode.indexOf('const skipName'));
    expect(skipBlock).toMatch(/setPhase\('intent'\)/);
  });

  it('marks WHO turn with _fePhase and _feSkippable metadata', () => {
    expect(controllerCode).toMatch(/_fePhase:\s*'who'/);
    expect(controllerCode).toMatch(/_feSkippable:\s*true/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B2-3 — Controller resume/returning behavior
// ═══════════════════════════════════════════════════════════════════════════

describe('B2-3 — Resume and returning behavior', () => {
  it('imports resolveFirstExperienceMode and MODE_BEGIN', () => {
    expect(controller).toMatch(/resolveFirstExperienceMode/);
    expect(controller).toMatch(/MODE_BEGIN/);
    expect(controller).toMatch(/from '\.\.\/utils\/firstExperienceMode'/);
  });

  it('skips to handoff when mode is not MODE_BEGIN', () => {
    expect(controllerCode).toMatch(/mode !== MODE_BEGIN/);
    expect(controllerCode).toMatch(/setPhase\('handoff'\)/);
  });

  it('sets INTENT_PROSPECTING decision for resume/refine', () => {
    expect(controllerCode).toMatch(/routeIntent\(\{\s*intent:\s*INTENT_PROSPECTING,\s*confidence:\s*1\s*\}/);
  });

  it('accepts arrival parameter', () => {
    expect(controllerCode).toMatch(/useFirstExperienceController\(arrival\s*=\s*null\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B2-4 — Controller does not create a new conversation authority
// ═══════════════════════════════════════════════════════════════════════════

describe('B2-4 — No new conversation authority', () => {
  it('does not import appendTurn', () => {
    expect(controller).not.toMatch(/import.*appendTurn/);
  });

  it('does not call appendTurn', () => {
    expect(controllerCode).not.toMatch(/appendTurn\(/);
  });

  it('does not import setDoc or addDoc', () => {
    expect(controller).not.toMatch(/import.*\bsetDoc\b/);
    expect(controller).not.toMatch(/import.*\baddDoc\b/);
  });

  it('does not write to barryConversations canonical subcollection', () => {
    expect(controllerCode).not.toMatch(/barryConversations.*canonical/);
    expect(controllerCode).not.toMatch(/canonical.*turns/);
  });

  it('only reads from Firestore, never writes conversation data', () => {
    expect(controllerCode).not.toMatch(/setDoc\(/);
    expect(controllerCode).not.toMatch(/addDoc\(/);
    expect(controllerCode).not.toMatch(/updateDoc\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B2-5 — BarryWorkspace integrates controller for First Experience
// ═══════════════════════════════════════════════════════════════════════════

describe('B2-5 — Workspace controller integration', () => {
  it('imports useFirstExperienceController', () => {
    expect(workspace).toMatch(/import useFirstExperienceController/);
  });

  it('calls useFirstExperienceController with arrival', () => {
    expect(workspaceCode).toMatch(/useFirstExperienceController\(arrival\)/);
  });

  it('renders FirstExperience with preset props on handoff', () => {
    expect(workspaceCode).toMatch(/presetDecision=\{feCtrl\.decision\}/);
    expect(workspaceCode).toMatch(/presetWho=\{feCtrl\.who\}/);
    expect(workspaceCode).toMatch(/presetPending=\{feCtrl\.pending\}/);
    expect(workspaceCode).toMatch(/presetHeld=\{feCtrl\.held\}/);
  });

  it('renders conversation thread from controller turns', () => {
    expect(workspaceCode).toMatch(/feTurns\.map/);
  });

  it('routes composer input to controller during FE phases', () => {
    expect(workspaceCode).toMatch(/feCtrl\.handleUserInput/);
  });

  it('renders skip button during WHO phase', () => {
    expect(workspaceCode).toMatch(/feCtrl\.skipName/);
    expect(workspaceCode).toMatch(/isWhoPhase/);
  });

  it('renders typing indicator during classification', () => {
    expect(workspaceCode).toMatch(/feCtrl\.classifying/);
    expect(workspaceCode).toMatch(/barry-typing-dot/);
  });

  it('uses same header and composer for FE and post-onboarding', () => {
    const headerCount = (workspaceCode.match(/barry-workspace-header/g) || []).length;
    const composerCount = (workspaceCode.match(/barry-workspace-composer/g) || []).length;
    expect(headerCount).toBeGreaterThanOrEqual(2);
    expect(composerCount).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B2-6 — BarryWorkspace removes visible onboarding stepper
// ═══════════════════════════════════════════════════════════════════════════

describe('B2-6 — Stepper removed', () => {
  it('does not render progress stepper markup', () => {
    expect(workspaceCode).not.toMatch(/barry-workspace-progress/);
    expect(workspaceCode).not.toMatch(/barry-progress-step/);
    expect(workspaceCode).not.toMatch(/barry-progress-dot/);
    expect(workspaceCode).not.toMatch(/barry-progress-label/);
  });

  it('does not import or use SOFT_PROGRESS_STATES', () => {
    expect(workspaceCode).not.toMatch(/SOFT_PROGRESS_STATES/);
    expect(workspaceCode).not.toMatch(/deriveSoftProgress/);
    expect(workspaceCode).not.toMatch(/softProgress/);
  });

  it('CSS does not contain progress stepper styles', () => {
    expect(workspaceCss).not.toMatch(/\.barry-workspace-progress\b/);
    expect(workspaceCss).not.toMatch(/\.barry-progress-step\b/);
    expect(workspaceCss).not.toMatch(/\.barry-progress-dot\b/);
    expect(workspaceCss).not.toMatch(/\.barry-progress-label\b/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B2-7 — FirstExperience thin rollback wrapper
// ═══════════════════════════════════════════════════════════════════════════

describe('B2-7 — FirstExperience preset props', () => {
  it('accepts presetDecision, presetWho, presetPending, presetHeld props', () => {
    expect(firstExpCode).toMatch(/presetDecision/);
    expect(firstExpCode).toMatch(/presetWho/);
    expect(firstExpCode).toMatch(/presetPending/);
    expect(firstExpCode).toMatch(/presetHeld/);
  });

  it('detects preset mode via hasPresets', () => {
    expect(firstExpCode).toMatch(/hasPresets/);
    expect(firstExpCode).toMatch(/Boolean\(presetDecision\)/);
  });

  it('skips loading when presets provided', () => {
    expect(firstExpCode).toMatch(/useState\(!hasPresets\)/);
  });

  it('initializes state from presets when provided', () => {
    expect(firstExpCode).toMatch(/hasPresets \? presetWho : null/);
    expect(firstExpCode).toMatch(/hasPresets \? presetDecision : null/);
    expect(firstExpCode).toMatch(/hasPresets \? presetPending : null/);
    expect(firstExpCode).toMatch(/hasPresets \? presetHeld : null/);
  });

  it('skips the init useEffect when presets provided', () => {
    expect(firstExpCode).toMatch(/if \(hasPresets\) return/);
  });

  it('preserves original behavior when no presets', () => {
    expect(firstExpCode).toMatch(/resolveFirstExperienceMode/);
    expect(firstExpCode).toMatch(/resolveWho/);
    expect(firstExpCode).toMatch(/readReadiness/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B2-8 — rememberName behavior preserved
// ═══════════════════════════════════════════════════════════════════════════

describe('B2-8 — rememberName preservation', () => {
  it('controller imports rememberName from resolveWho', () => {
    expect(controller).toMatch(/import.*rememberName.*from.*resolveWho/);
  });

  it('controller calls rememberName when user provides name', () => {
    expect(controllerCode).toMatch(/rememberName\(user\.uid,\s*trimmed\)/);
  });

  it('controller updates who state optimistically', () => {
    expect(controllerCode).toMatch(/setWho\(/);
    expect(controllerCode).toMatch(/name:\s*trimmed/);
  });

  it('controller sets sessionStorage ASKED_KEY on name submission', () => {
    const handleBlock = controllerCode.slice(controllerCode.indexOf('handleUserInput'));
    expect(handleBlock).toMatch(/sessionStorage\.setItem\(ASKED_KEY/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B2-9 — Skip button CSS
// ═══════════════════════════════════════════════════════════════════════════

describe('B2-9 — Skip button CSS', () => {
  it('defines .barry-workspace-fe-skip', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-fe-skip/);
  });

  it('defines .barry-workspace-skip-btn', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-skip-btn/);
  });

  it('skip button has no visible background', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-skip-btn[\s\S]*?background:\s*none/);
  });

  it('skip button has underline decoration', () => {
    expect(workspaceCss).toMatch(/\.barry-workspace-skip-btn[\s\S]*?text-decoration:\s*underline/);
  });
});
