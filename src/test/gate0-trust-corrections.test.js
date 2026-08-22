/**
 * Gate 0 — Trust Corrections
 *
 * P0-A: Targeting ambiguity must be resolved before proposal, persistence,
 *        or discovery. When `isAmbiguous` is true on the backend response,
 *        the frontend must NOT advance to the 'confirming' step — even if
 *        the merged targeting passes the one-constraint quality floor.
 *
 *        C0-1: The persisted step must be the gated step, not the backend's.
 *        C0-2: Ambiguity must survive reload.
 *        C0-3: Followup progression must respect ambiguity/needsMoreInfo.
 *        C0-4: "at companies" keyword presence must not auto-resolve ambiguity.
 *
 * P0-B: "Business Understood" removed — no defensible derivation exists.
 *        "ICP Created" remains, truthfully derived from an active ICP with
 *        at least one supported retrieval constraint.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  retrievalConstraints,
  hasRetrievalConstraint,
} from '../utils/targetingProposal.js';


const __dirname = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(__dirname, rel), 'utf8');
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ─── Frontend gate: mirrors the decision logic in BarryOnboarding.jsx ───────
// The gate determines what step Barry actually allows the user to enter.
// This is the step that gets persisted (C0-1) and shown to the user.

function shouldPropose({ barryResponse, merged, newStep }) {
  const isAmbiguous = Boolean(barryResponse.isAmbiguous);
  const hasConstraint = hasRetrievalConstraint(merged);
  return !isAmbiguous && (newStep === 'confirming' || barryResponse.readyToConfirm || hasConstraint);
}

function gatedStep({ barryResponse, merged, newStep }) {
  return shouldPropose({ barryResponse, merged, newStep }) ? 'confirming' : 'clarifying';
}

// ─── Backend followup progression: mirrors processFollowup step logic ───────
// C0-3: ambiguity + readyToConfirm must NOT yield 'confirming'.

function followupStep(barryResponse) {
  let nextStep = 'clarifying';
  if (barryResponse.needsLookalike && !barryResponse.understood?.lookalikeSeed) {
    nextStep = 'awaiting_example';
  } else if (barryResponse.readyToConfirm && !barryResponse.isAmbiguous && !barryResponse.needsMoreInfo) {
    nextStep = 'confirming';
  }
  return nextStep;
}

// ─── Backend initial-input progression: mirrors processInitialInput step logic
function initialStep(barryResponse) {
  let nextStep = 'clarifying';
  if (barryResponse.needsLookalike) {
    nextStep = 'awaiting_example';
  } else if (!barryResponse.needsClarification && !barryResponse.isAmbiguous) {
    nextStep = 'confirming';
  }
  return nextStep;
}


// ─── Case A: "SaaS sales people in Utah" ────────────────────────────────────
// → clarification → reload → still clarification → no confirmation action
// → no authoritative ICP write → no D7 → no discovery.

describe('Case A — "SaaS sales people in Utah" end-to-end ambiguity', () => {
  const barryResponse = {
    isAmbiguous: true,
    needsClarification: true,
    readyToConfirm: false,
    understood: {
      industries: ['Computer Software'],
      locations: ['Utah'],
    },
  };
  const merged = { ...barryResponse.understood };

  it('has retrieval constraints but ambiguity blocks proposal', () => {
    expect(hasRetrievalConstraint(merged)).toBe(true);
    expect(shouldPropose({ barryResponse, merged, newStep: 'clarifying' })).toBe(false);
  });

  it('gated step is clarifying, not the backend newStep', () => {
    expect(gatedStep({ barryResponse, merged, newStep: 'confirming' })).toBe('clarifying');
  });

  it('persisted step (C0-1) is the gated step, not the backend step', () => {
    const persisted = gatedStep({ barryResponse, merged, newStep: 'confirming' });
    expect(persisted).toBe('clarifying');
  });

  it('reload restores clarifying (C0-2): unresolved ambiguity survives', () => {
    const persisted = gatedStep({ barryResponse, merged, newStep: 'confirming' });
    const isAmbiguous = Boolean(barryResponse.isAmbiguous);
    // Simulate resume: setStep(data.currentStep || 'asking')
    const resumedStep = persisted || 'asking';
    expect(resumedStep).toBe('clarifying');
    expect(isAmbiguous).toBe(true);
  });

  it('backend initial step also blocks when ambiguous', () => {
    expect(initialStep(barryResponse)).toBe('clarifying');
  });
});


// ─── Case B: "sales people at SaaS companies in Utah" ──────────────────────
// Must not silently become company targeting merely because "companies" appears.

describe('Case B — "sales people at SaaS companies" must not auto-resolve', () => {
  const onboardingSrc = read('../pages/Onboarding/BarryOnboarding.jsx');
  const serverSrc = read('../../netlify/functions/barryICPConversation.js');

  it('the prompt does not teach that "at [type] companies" is unambiguous', () => {
    // C0-4: the old rule "Find me CEOs at fintech companies — clearly companies"
    // taught keyword-presence resolution. That example is removed.
    expect(serverSrc).not.toMatch(/Find me CEOs at fintech companies/);
  });

  it('the prompt teaches that keyword "companies" in workplace position is still ambiguous', () => {
    expect(serverSrc).toContain('sales people at SaaS companies in Utah');
    expect(serverSrc).toContain('AMBIGUOUS');
  });

  it('the prompt teaches the object-of-action test, not keyword presence', () => {
    expect(serverSrc).toContain('OBJECT of the user\'s intended action');
  });

  it('the heuristic is consistent between initial and followup prompts', () => {
    const initialRule = serverSrc.match(/TARGETING AMBIGUITY[\s\S]*?(?=CONFIDENCE SCORING)/g);
    expect(initialRule).not.toBeNull();
    expect(initialRule.length).toBe(2);
    for (const rule of initialRule) {
      expect(rule).toContain('OBJECT of the user\'s intended action');
    }
  });
});


// ─── Case C: Ambiguous followup + populated targeting + readyToConfirm ──────
// → still clarification.

describe('Case C — ambiguous followup with readyToConfirm must not confirm', () => {

  it('followup: ambiguity + readyToConfirm = clarifying (C0-3)', () => {
    const barryResponse = {
      isAmbiguous: true,
      needsMoreInfo: true,
      readyToConfirm: true,
      understood: { industries: ['Computer Software'], locations: ['Utah'] },
    };
    expect(followupStep(barryResponse)).toBe('clarifying');
  });

  it('followup: ambiguity + needsMoreInfo + readyToConfirm = clarifying (C0-3)', () => {
    const barryResponse = {
      isAmbiguous: true,
      needsMoreInfo: true,
      readyToConfirm: true,
      understood: {
        industries: ['Computer Software'],
        companyKeywords: ['saas'],
        locations: ['Utah'],
        companySizes: ['11-50'],
      },
    };
    expect(followupStep(barryResponse)).toBe('clarifying');
  });

  it('frontend gate also blocks when readyToConfirm is true but ambiguous', () => {
    const barryResponse = {
      isAmbiguous: true,
      readyToConfirm: true,
      understood: { industries: ['Computer Software'], locations: ['Utah'] },
    };
    const merged = { ...barryResponse.understood };
    expect(shouldPropose({ barryResponse, merged, newStep: 'clarifying' })).toBe(false);
  });

  it('ambiguity blocks even when backend says confirming', () => {
    const barryResponse = {
      isAmbiguous: true,
      readyToConfirm: false,
      understood: { industries: ['Computer Software'] },
    };
    const merged = { ...barryResponse.understood };
    expect(shouldPropose({ barryResponse, merged, newStep: 'confirming' })).toBe(false);
    expect(gatedStep({ barryResponse, merged, newStep: 'confirming' })).toBe('clarifying');
  });
});


// ─── Case D: User clarifies → ambiguity clears → proposal proceeds ─────────

describe('Case D — clarification clears ambiguity, proposal proceeds', () => {
  const barryResponse = {
    isAmbiguous: false,
    needsMoreInfo: false,
    readyToConfirm: false,
    understood: {
      industries: ['Computer Software'],
      companyKeywords: ['saas'],
      locations: ['Utah'],
    },
  };
  const merged = { ...barryResponse.understood };

  it('non-ambiguous followup with constraints proceeds to proposal', () => {
    expect(hasRetrievalConstraint(merged)).toBe(true);
    expect(shouldPropose({ barryResponse, merged, newStep: 'clarifying' })).toBe(true);
  });

  it('gated step is confirming', () => {
    expect(gatedStep({ barryResponse, merged, newStep: 'clarifying' })).toBe('confirming');
  });

  it('followup step respects clear ambiguity with readyToConfirm', () => {
    const cleared = { ...barryResponse, readyToConfirm: true };
    expect(followupStep(cleared)).toBe('confirming');
  });

  it('persisted step after clarification is confirming', () => {
    const persisted = gatedStep({ barryResponse, merged, newStep: 'clarifying' });
    expect(persisted).toBe('confirming');
  });
});


// ─── Case E: "Roofing companies in Utah with 10-50 employees" ───────────────
// → no unnecessary clarification → proposal proceeds normally.

describe('Case E — unambiguous input proceeds without clarification', () => {
  const barryResponse = {
    isAmbiguous: false,
    needsClarification: false,
    readyToConfirm: false,
    understood: {
      industries: ['Construction'],
      companyKeywords: ['roofing'],
      companySizes: ['11-50'],
      locations: ['Utah'],
    },
  };
  const merged = { ...barryResponse.understood };

  it('proceeds to proposal', () => {
    expect(hasRetrievalConstraint(merged)).toBe(true);
    expect(shouldPropose({ barryResponse, merged, newStep: 'clarifying' })).toBe(true);
  });

  it('gated step is confirming', () => {
    expect(gatedStep({ barryResponse, merged, newStep: 'clarifying' })).toBe('confirming');
  });

  it('backend initial step is confirming', () => {
    expect(initialStep(barryResponse)).toBe('confirming');
  });
});


// ─── Case F: One clear supported constraint = sufficient ────────────────────

describe('Case F — one constraint remains sufficient for proposal/search', () => {

  it('industries alone is enough', () => {
    const barryResponse = {
      isAmbiguous: false,
      readyToConfirm: false,
      understood: { industries: ['Financial Services'] },
    };
    const merged = { ...barryResponse.understood };
    expect(hasRetrievalConstraint(merged)).toBe(true);
    expect(shouldPropose({ barryResponse, merged, newStep: 'clarifying' })).toBe(true);
  });

  it('no constraints and no ambiguity does NOT propose', () => {
    const barryResponse = {
      isAmbiguous: false,
      readyToConfirm: false,
      understood: { targetTitles: ['CEO'] },
    };
    const merged = { ...barryResponse.understood };
    expect(hasRetrievalConstraint(merged)).toBe(false);
    expect(shouldPropose({ barryResponse, merged, newStep: 'clarifying' })).toBe(false);
  });
});


// ─── C0-1/C0-2: Persistence and resume source verification ─────────────────

describe('C0-1 — persisted step is the gated step', () => {
  const onboardingSrc = read('../pages/Onboarding/BarryOnboarding.jsx');
  const onboardingCode = code(onboardingSrc);

  it('saveConversationState receives gatedStep, not newStep', () => {
    expect(onboardingCode).toContain('saveConversationState(user.uid, updatedHistory, barryResponse.understood, gatedStep,');
  });

  it('saveConversationState persists isAmbiguous', () => {
    expect(onboardingSrc).toMatch(/isAmbiguous:\s*Boolean\(isAmbiguous\)/);
  });

  it('the gatedStep variable is what gets passed to setStep', () => {
    expect(onboardingCode).toContain('setStep(gatedStep)');
  });
});

describe('C0-2 — ambiguity survives reload', () => {
  const onboardingSrc = read('../pages/Onboarding/BarryOnboarding.jsx');

  it('resume reads the persisted currentStep (which is already gated)', () => {
    expect(onboardingSrc).toContain("setStep(data.currentStep || 'asking')");
  });

  it('resume checks isAmbiguous for appropriate messaging', () => {
    expect(onboardingSrc).toContain('data.isAmbiguous');
    expect(onboardingSrc).toContain('clarification');
  });
});


// ─── C0-3: Backend followup respects ambiguity ──────────────────────────────

describe('C0-3 — backend followup step respects ambiguity', () => {
  const serverSrc = read('../../netlify/functions/barryICPConversation.js');
  const serverCode = code(serverSrc);

  it('processFollowup checks isAmbiguous before returning confirming', () => {
    // The step logic should require !isAmbiguous && !needsMoreInfo
    expect(serverCode).toMatch(/readyToConfirm && !barryResponse\.isAmbiguous && !barryResponse\.needsMoreInfo/);
  });

  it('processInitialInput checks isAmbiguous before returning confirming', () => {
    expect(serverCode).toMatch(/!barryResponse\.needsClarification && !barryResponse\.isAmbiguous/);
  });
});


// ─── P0-B: "Business Understood" removed, ICP Created truthfully derived ────

const mcDashSource = readFileSync(
  resolve(__dirname, '../pages/Scout/MissionControlDashboardV2.jsx'), 'utf8'
);

function deriveIcpCreated(activeIcpProfile) {
  return activeIcpProfile != null && retrievalConstraints(activeIcpProfile).length >= 1;
}

describe('P0-B — "Business Understood" is not presented as a completed milestone', () => {

  it('the source does not contain a "Business Understood" progress item with done:true', () => {
    expect(mcDashSource).not.toMatch(/['"]Business Understood['"].*done:\s*true/);
  });

  it('the source does not contain any "Business Understood" milestone at all', () => {
    const progressRegion = mcDashSource.match(/const progressItems\s*=\s*\[[\s\S]*?\];/);
    expect(progressRegion).not.toBeNull();
    expect(progressRegion[0]).not.toContain('Business Understood');
  });

  it('no substitute "understood" or "complete" boolean was introduced', () => {
    const fromIcpCreated = mcDashSource.indexOf('const icpCreated');
    const toProgressItems = mcDashSource.indexOf('const progressItems', fromIcpCreated);
    const region = mcDashSource.slice(fromIcpCreated, toProgressItems + 200);
    expect(region).not.toMatch(/businessUnderstood/i);
    expect(region).not.toMatch(/businessComplete/i);
    expect(region).toContain('icpCreated');
  });
});

describe('P0-B — ICP Created remains derived from actual authoritative ICP state', () => {

  it('null profile → ICP Created is false', () => {
    expect(deriveIcpCreated(null)).toBe(false);
  });

  it('undefined profile → ICP Created is false', () => {
    expect(deriveIcpCreated(undefined)).toBe(false);
  });

  it('profile with 0 retrieval constraints → ICP Created is false', () => {
    expect(deriveIcpCreated({ targetTitles: ['CEO'] })).toBe(false);
  });

  it('profile with 1 constraint → ICP Created is true', () => {
    expect(deriveIcpCreated({ industries: ['Construction'] })).toBe(true);
  });

  it('profile with many constraints → ICP Created is true', () => {
    const profile = {
      industries: ['Construction'],
      companyKeywords: ['roofing'],
      companySizes: ['11-20'],
      locations: ['Utah'],
    };
    expect(deriveIcpCreated(profile)).toBe(true);
  });

  it('failed website analysis + only non-retrieval fields → ICP Created is false', () => {
    const profile = { targetTitles: ['VP Sales'], lookalikeSeed: { name: 'Acme' } };
    expect(deriveIcpCreated(profile)).toBe(false);
  });
});
