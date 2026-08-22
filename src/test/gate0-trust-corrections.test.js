/**
 * Gate 0 — Trust Corrections
 *
 * P0-A: Targeting ambiguity must be resolved before proposal, persistence,
 *        or discovery. When `isAmbiguous` is true on the backend response,
 *        the frontend must NOT advance to the 'confirming' step — even if
 *        the merged targeting passes the one-constraint quality floor.
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


// ─── P0-B: "Business Understood" removed, ICP Created truthfully derived ────
//
// The MissionControlDashboardV2 FirstRunView progressItems no longer contain a
// "Business Understood" milestone at all. No defensible derivation exists today
// that separates "some business context" from "genuine understanding," so the
// truthful Gate 0 behavior is: do not make the claim.
//
// "ICP Created" remains, derived from:
//   activeIcpProfile != null && retrievalConstraints(activeIcpProfile).length >= 1
//
// We verify the derivation logic and the absence of any "understood" concept.

const __dirname = dirname(fileURLToPath(import.meta.url));
const mcDashSource = readFileSync(
  resolve(__dirname, '../pages/Scout/MissionControlDashboardV2.jsx'), 'utf8'
);

function deriveIcpCreated(activeIcpProfile) {
  return activeIcpProfile != null && retrievalConstraints(activeIcpProfile).length >= 1;
}

describe('P0-B — "Business Understood" is not presented as a completed milestone', () => {

  it('the source does not contain a "Business Understood" progress item with done:true', () => {
    // The original defect was: { label: 'Business Understood', done: true }
    // Verify that exact pattern is gone.
    expect(mcDashSource).not.toMatch(/['"]Business Understood['"].*done:\s*true/);
  });

  it('the source does not contain any "Business Understood" milestone at all', () => {
    // The milestone was removed entirely, not replaced with a derived version.
    // Check the progressItems array region — no label references "Business Understood".
    const progressRegion = mcDashSource.match(/const progressItems\s*=\s*\[[\s\S]*?\];/);
    expect(progressRegion).not.toBeNull();
    expect(progressRegion[0]).not.toContain('Business Understood');
  });

  it('no substitute "understood" or "complete" boolean was introduced', () => {
    // Verify no variable named businessUnderstood, businessComplete, or
    // understood exists in the progressItems derivation region.
    const fromIcpCreated = mcDashSource.indexOf('const icpCreated');
    const toProgressItems = mcDashSource.indexOf('const progressItems', fromIcpCreated);
    const region = mcDashSource.slice(fromIcpCreated, toProgressItems + 200);
    expect(region).not.toMatch(/businessUnderstood/i);
    expect(region).not.toMatch(/businessComplete/i);
    // icpCreated is expected — it is the ICP existence check, not an understanding claim.
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
