/**
 * Mission Control Barry's targeting handoff — client wiring.
 *
 * Structural invariants verified by source scan, consistent with this
 * codebase's existing convention for BarryChatPanel (see gate1/gate2/gate3
 * test files) — full render coverage of this large component's send flow is
 * a separate, heavier undertaking; the underlying pieces this wiring calls
 * (confirmAndActivateIcp, the server-side gate) are covered behaviorally
 * elsewhere (onboardingConfirmProjectsBridge.test.jsx,
 * barryMissionChatProspectingGate.test.js).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../components/dashboard/BarryChatPanel.jsx'), 'utf8');

describe('BarryChatPanel — targeting extraction handoff', () => {
  it('imports the shared confirm/persist/search function rather than a second implementation', () => {
    expect(src).toMatch(/import \{ confirmAndActivateIcp,[^}]*\} from '\.\.\/\.\.\/utils\/confirmAndActivateIcp'/);
  });

  it('carries pendingICP forward on the request rather than re-asking', () => {
    // The normal-message send call, not the ICP add/replace or action-fallback
    // fetches to the same endpoint earlier in the file.
    const normalPathAt = src.indexOf('// ── Normal message path ──');
    const sendAt = src.indexOf("fetch('/.netlify/functions/barryMissionChat'", normalPathAt);
    const body = src.slice(sendAt, sendAt + 900);
    expect(body).toMatch(/pendingICP:\s*pendingTargetingExtraction\.icp/);
    expect(body).toMatch(/icpExtractionStep:\s*pendingTargetingExtraction\.step/);
  });

  it('recognizes the extraction response shape before any other intent branch', () => {
    const handoffAt = src.indexOf('if (data.pendingICP)');
    const icpChangeAt = src.indexOf("data.intent === 'ICP_CHANGE'");
    expect(handoffAt).toBeGreaterThan(-1);
    expect(icpChangeAt).toBeGreaterThan(-1);
    expect(handoffAt).toBeLessThan(icpChangeAt);
  });

  it('renders a confirm bubble only when readyToConfirm, otherwise continues as plain conversation', () => {
    const handoffAt = src.indexOf('if (data.pendingICP)');
    const block = src.slice(handoffAt, handoffAt + 700);
    expect(block).toMatch(/data\.readyToConfirm/);
    expect(block).toMatch(/role: 'targeting_confirm'/);
  });

  it('confirmation is a button click that calls confirmAndActivateIcp with the mission_control source, never inferred from typed text', () => {
    const fnAt = src.indexOf('async function confirmTargetingExtraction(icp)');
    expect(fnAt).toBeGreaterThan(-1);
    const fnBody = src.slice(fnAt, src.indexOf('\n  }', fnAt));
    expect(fnBody).toMatch(/confirmAndActivateIcp\(user, icp, 'mission_control'\)/);

    const renderAt = src.indexOf("msg.role === 'targeting_confirm'");
    const nextBlockAt = src.indexOf("msg.role === 'pipeline_result'", renderAt);
    const renderBlock = src.slice(renderAt, nextBlockAt);
    expect(renderBlock).toMatch(/confirmTargetingExtraction\(msg\.icp\)/);
  });

  it('the confirmation bubble is built from structured effectiveTargeting, not free-form model prose, and shows the capability boundary', () => {
    const renderAt = src.indexOf("msg.role === 'targeting_confirm'");
    const nextBlockAt = src.indexOf("msg.role === 'pipeline_result'", renderAt);
    const renderBlock = src.slice(renderAt, nextBlockAt);

    // Sourced from the same effectiveTargeting() confirmAndActivateIcp persists.
    expect(renderBlock).toMatch(/effectiveTargeting\(msg\.icp/);
    // Company vs. people are two visually distinct sections, not one blended list.
    expect(renderBlock).toMatch(/Company discovery/);
    expect(renderBlock).toMatch(/People targeting/);
    // A fixed, always-true capability-boundary statement — never derived from
    // parsing what the user originally typed (no county/revenue support exists).
    expect(renderBlock).toMatch(/doesn't currently narrow by county or revenue/);
  });

  it('a normal response clears stale extraction state rather than leaving it pinned forever', () => {
    const handoffAt = src.indexOf('if (data.pendingICP)');
    const clearAt = src.indexOf('if (pendingTargetingExtraction) setPendingTargetingExtraction(null)');
    expect(clearAt).toBeGreaterThan(handoffAt);
  });
});
