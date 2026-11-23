/**
 * #005.4 — one way to start a conversation with Barry: "Ask Barry".
 *
 * "Talk to Barry" and "Chat with Barry" opened the same conversation as "Ask
 * Barry" elsewhere; the live surfaces now all say "Ask Barry". The meaning of
 * Barry's outputs is unchanged: headings keep the existing "Barry's <Noun>"
 * pattern (Recommendation, Read, Intel, Playbook, Proposed Orchestration) and
 * "Barry suggests". Admin views, onboarding, the contact profile and the
 * legacy /old-dashboard surfaces are out of scope.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const read = (p) => readFileSync(resolve(here, '..', p), 'utf8');

describe('starting a conversation is always "Ask Barry"', () => {
  it.each([
    ['pages/Scout/DailyLeads.jsx', 3],
    ['pages/Scout/ICPSettings.jsx', 1],
    ['components/recon/BarryReconGuide.jsx', 2],
  ])('%s', (file, n) => {
    const s = read(file);
    expect(s).not.toMatch(/Talk to Barry|Chat with Barry/);
    expect(s.match(/Ask Barry/g)?.length ?? 0).toBeGreaterThanOrEqual(n);
  });
});

describe("Barry's output headings keep their meaning", () => {
  it.each([
    ['components/hunter/BarryInsightsCard.jsx', "Barry's Playbook"],
    ['pages/Scout/CadencesList.jsx', "Barry's Read"],
    ['pages/Scout/CompanySearch.jsx', "Barry's Intel"],
    ['pages/Hunter/CreateMission.jsx', "Barry's Proposed Orchestration"],
    ['components/hunter/MissionCard.jsx', 'Barry suggests'],
  ])('%s still reads %s', (file, label) => {
    expect(read(file)).toContain(label);
  });
});
