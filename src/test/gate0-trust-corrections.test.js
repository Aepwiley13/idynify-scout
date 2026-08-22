/**
 * Gate 0 — Trust Corrections
 *
 * P0-A: Targeting ambiguity must be resolved before proposal, persistence,
 *        or discovery. When `isAmbiguous` is true on the backend response,
 *        the frontend must NOT advance to the 'confirming' step — even if
 *        the merged targeting passes the one-constraint quality floor.
 *
 * P0-B: "Business Understood" must derive from actual intelligence, not
 *        from a hardcoded `done: true`. An active ICP with >= 2 retrieval
 *        constraints qualifies; anything less does not.
 */

import { describe, it, expect } from 'vitest';
import {
  retrievalConstraints,
  hasRetrievalConstraint,
} from '../utils/targetingProposal.js';


// ─── P0-A: Ambiguity gate logic ──────────────────────────────────────────────
// The frontend gate in BarryOnboarding.jsx uses this pattern:
//   const isAmbiguous = Boolean(barryResponse.isAmbiguous);
//   if (!isAmbiguous && (newStep === 'confirming' || readyToConfirm || hasConstraint)) → confirming
//   else → clarifying
//
// We test the decision function directly rather than rendering the component,
// because the gate is a pure boolean expression.

function shouldPropose({ barryResponse, merged, newStep }) {
  const isAmbiguous = Boolean(barryResponse.isAmbiguous);
  const hasConstraint = hasRetrievalConstraint(merged);
  return !isAmbiguous && (newStep === 'confirming' || barryResponse.readyToConfirm || hasConstraint);
}

describe('P0-A — ambiguity must block proposal', () => {

  it('"SaaS sales people in Utah" with isAmbiguous:true does NOT reach proposal', () => {
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
    // The merged result HAS a retrieval constraint (industries + locations),
    // but ambiguity blocks proposal.
    expect(hasRetrievalConstraint(merged)).toBe(true);
    expect(shouldPropose({ barryResponse, merged, newStep: 'clarifying' })).toBe(false);
  });

  it('"Roofing companies in Utah with 10-50 employees" proceeds to proposal', () => {
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
    expect(hasRetrievalConstraint(merged)).toBe(true);
    expect(shouldPropose({ barryResponse, merged, newStep: 'clarifying' })).toBe(true);
  });

  it('ambiguity blocks even when newStep is "confirming"', () => {
    const barryResponse = {
      isAmbiguous: true,
      readyToConfirm: false,
      understood: { industries: ['Computer Software'] },
    };
    const merged = { ...barryResponse.understood };
    expect(shouldPropose({ barryResponse, merged, newStep: 'confirming' })).toBe(false);
  });

  it('ambiguity blocks even when readyToConfirm is true', () => {
    const barryResponse = {
      isAmbiguous: true,
      readyToConfirm: true,
      understood: { industries: ['Computer Software'], locations: ['Utah'] },
    };
    const merged = { ...barryResponse.understood };
    expect(shouldPropose({ barryResponse, merged, newStep: 'clarifying' })).toBe(false);
  });

  it('non-ambiguous input with constraints proceeds normally', () => {
    const barryResponse = {
      isAmbiguous: false,
      readyToConfirm: false,
      understood: { industries: ['Financial Services'] },
    };
    const merged = { ...barryResponse.understood };
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

  it('answering the clarification (non-ambiguous followup) proceeds to proposal', () => {
    // After the user clarifies, the followup response should not be ambiguous.
    const barryResponse = {
      isAmbiguous: false,
      readyToConfirm: false,
      understood: {
        industries: ['Computer Software'],
        companyKeywords: ['saas'],
        locations: ['Utah'],
      },
    };
    const merged = { ...barryResponse.understood };
    expect(shouldPropose({ barryResponse, merged, newStep: 'clarifying' })).toBe(true);
  });
});


// ─── P0-B: Business Understood derivation ────────────────────────────────────
// The derivation in MissionControlDashboardV2.jsx:
//   const icpConstraints = retrievalConstraints(activeIcpProfile);
//   const businessUnderstood = icpConstraints.length >= 2;
//   const icpCreated = activeIcpProfile != null && icpConstraints.length >= 1;

function deriveBusinessUnderstood(activeIcpProfile) {
  const icpConstraints = retrievalConstraints(activeIcpProfile);
  return icpConstraints.length >= 2;
}

function deriveIcpCreated(activeIcpProfile) {
  const icpConstraints = retrievalConstraints(activeIcpProfile);
  return activeIcpProfile != null && icpConstraints.length >= 1;
}

describe('P0-B — Business Understood is derived, never hardcoded', () => {

  it('null profile → Business Understood is false', () => {
    expect(deriveBusinessUnderstood(null)).toBe(false);
  });

  it('null profile → ICP Created is false', () => {
    expect(deriveIcpCreated(null)).toBe(false);
  });

  it('profile with 0 constraints → Business Understood is false', () => {
    expect(deriveBusinessUnderstood({ targetTitles: ['CEO'] })).toBe(false);
  });

  it('profile with 1 constraint → Business Understood is false, ICP Created is true', () => {
    const profile = { industries: ['Construction'] };
    expect(deriveBusinessUnderstood(profile)).toBe(false);
    expect(deriveIcpCreated(profile)).toBe(true);
  });

  it('profile with 2 constraints → Business Understood is true', () => {
    const profile = { industries: ['Construction'], locations: ['Utah'] };
    expect(deriveBusinessUnderstood(profile)).toBe(true);
    expect(deriveIcpCreated(profile)).toBe(true);
  });

  it('profile with many constraints → Business Understood is true', () => {
    const profile = {
      industries: ['Construction'],
      companyKeywords: ['roofing'],
      companySizes: ['11-20'],
      locations: ['Utah'],
      foundedAgeRange: { minAge: null, maxAge: 10 },
    };
    expect(deriveBusinessUnderstood(profile)).toBe(true);
    expect(retrievalConstraints(profile).length).toBe(5);
  });

  it('failed website analysis + weak context → no Business Understood', () => {
    // User only provided a vague title, no company-level constraints
    const profile = { targetTitles: ['VP Sales'], lookalikeSeed: { name: 'Acme' } };
    expect(deriveBusinessUnderstood(profile)).toBe(false);
  });

  it('sufficient supported intelligence → Business Understood can truthfully complete', () => {
    const profile = {
      industries: ['Computer Software'],
      companyKeywords: ['saas'],
      companySizes: ['51-200'],
      locations: ['California'],
    };
    expect(deriveBusinessUnderstood(profile)).toBe(true);
  });
});
