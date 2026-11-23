/**
 * #005.7 — Barry's inline panels are labelled landmarks.
 *
 * Screen-reader users can move between landmarks; before, these panels were
 * unlabelled divs. Each is now role="region" with a name matching what it
 * shows. The contact profile's Barry panels (Contact Hub) are out of scope.
 * The two slide-in drawers (Recon coaching, ICP conversation) are labelled
 * regions here; treating them as modal dialogs also needs focus handling and
 * is recorded as a follow-up.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const read = (p) => readFileSync(resolve(here, '..', p), 'utf8');

describe.each([
  ['components/hunter/BarryInsightsCard.jsx', /role="region" aria-label="Barry's Playbook"/],
  ['components/hunter/BarryReplyCard.jsx', /role="region" aria-label="Barry's drafted reply"/],
  ['components/hunter/BarryRecommendationCard.jsx', /role="region"\s+aria-label=\{`Barry's recommendation: \$\{style\.label\}`\}/],
  ['components/hunter/BarryWarningCard.jsx', /role="region"\s+aria-label="Barry's warning"/],
  ['components/mission-control/BarryMorningBrief.jsx', /role="region" aria-label="Barry's morning brief"/],
  ['components/recon/BarryReconCoach.jsx', /role="region" aria-label="Barry's Recon coaching"/],
  ['components/scout/BarryICPPanel.jsx', /role="region" aria-label="Barry's ICP conversation"/],
])('%s', (file, pattern) => {
  it('is a labelled region', () => {
    expect(read(file)).toMatch(pattern);
  });
});
