/**
 * ADR-006 boundary — enforced on its own, not behind the repo's lint debt.
 *
 * The rule lives in eslint.config.js, but `npx eslint .` currently reports a
 * large pre-existing backlog (undeclared `process` across netlify/, unused
 * vars, and more). A boundary violation buried in that output is a violation
 * nobody sees, and "run lint" is not a gate anyone can hold Gate 3 to while the
 * baseline is red.
 *
 * So this runs ESLint programmatically with ONLY the ADR-006 rule enabled and
 * asserts zero findings. It fails loudly and specifically the moment a new
 * consumer reads a compatibility mirror, and it stays silent about every other
 * lint problem in the repository — which is deliberately not Gate 3's to fix.
 *
 * The allowlist below is the migration checklist. It only ever shrinks. When it
 * is empty the mirrors themselves can be deleted, and this test is how you know
 * that day has arrived.
 */

import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

/** The mirrors. Reading any of these outside the allowlist is the defect. */
const FORBIDDEN = [
  'conversationState', 'lastInboundAt', 'lastInboundSubject',
  'replyCount', 'last_reply_at', 'last_replied_at', 'replies_received',
];

/**
 * Modules permitted to read a mirror during the migration.
 *
 * Two categories only: the modules that OWN the mirrors, and consumers not yet
 * migrated. Nothing else may be added without a review conversation — that is
 * the whole point of the list being finite and checked in.
 */
const ALLOWLIST = [
  // Owns the mirrors, or owns the transition fallback.
  'netlify/functions/utils/relationshipEventWriter.js',
  'src/utils/relationshipRead.js',
  // Tests assert on the mirrors by name, which is what they are for.
  'src/test/',
  // Not yet migrated — each is a tracked follow-up.
  'src/components/hunter/HunterContactDrawer.jsx',
  'src/components/hunter/BarryReplyCard.jsx',
  'src/pages/Scout/AllLeads.jsx',
  'src/components/firstTouch/FirstTouchModal.jsx',
  'src/hooks/usePendingReplies.js',
  'netlify/functions/barryOrientationBrief.js',
  'netlify/functions/gmail-poll-replies.js',
  'netlify/functions/utils/barryInboxAnalyzer.js',
  'netlify/functions/utils/barryStrategyRecommender.js',
  'netlify/functions/utils/barryContextAssembler.js',
  'netlify/functions/utils/relationshipContext.js',
  'netlify/functions/barryCSMRead.js',
  'netlify/functions/inferRelationshipWarmth.js',
  'src/utils/contactEngageStatus.js',
  'src/services/healthScore.js',
  'src/services/barryMemoryService.js',
  'src/components/contacts/KeyMetricsGrid.jsx',
  'src/components/csm/CSMCard.jsx',
  'src/components/csm/CSMDashboard.jsx',
  'src/components/onboarding/RelationshipFirstValue.jsx',
  'src/utils/relationshipSnapshot.js',
];

const isAllowed = (rel) => ALLOWLIST.some(entry => rel === entry || rel.startsWith(entry));

/** ESLint configured with the boundary rule and nothing else. */
function boundaryOnlyLinter() {
  return new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    overrideConfig: {
      languageOptions: { ecmaVersion: 'latest', sourceType: 'module',
        parserOptions: { ecmaFeatures: { jsx: true } } },
      rules: {
        'no-restricted-syntax': ['error', {
          selector: `MemberExpression[property.name=/^(${FORBIDDEN.join('|')})$/]`,
          message: 'ADR-006: compatibility mirror read outside the allowlist.',
        }],
      },
    },
  });
}

async function findViolations() {
  const results = await boundaryOnlyLinter().lintFiles(['src/**/*.{js,jsx}', 'netlify/**/*.js']);
  return results
    .map(r => ({
      file: relative(repoRoot, r.filePath),
      // ONLY genuine rule hits. `messages` also carries fatal parse errors —
      // a handful of files trip the bare parser used here — and counting those
      // as boundary violations reported four files that contain none of the
      // forbidden names at all. A boundary check that cries wolf gets muted,
      // which would cost more than the rule is worth.
      count: r.messages.filter(m => m.ruleId === 'no-restricted-syntax').length,
    }))
    .filter(r => r.count > 0 && !isAllowed(r.file));
}

describe('ADR-006 compatibility boundary', () => {
  it('has no mirror reads outside the allowlist', async () => {
    const violations = await findViolations();
    expect(violations, `ADR-006 violations:\n${JSON.stringify(violations, null, 2)}`)
      .toEqual([]);
  }, 60_000);

  it('actually detects a violation when one exists', async () => {
    // A boundary test that cannot fail is decoration. This proves the selector
    // still matches by linting a synthetic source that reads two mirrors.
    const results = await boundaryOnlyLinter().lintText(
      'export const bad = (c) => c.engagement_summary.replies_received || c.last_reply_at;',
      { filePath: resolve(repoRoot, 'src/__adr006_probe.js') }
    );
    expect(results[0].messages.length).toBe(2);
    expect(results[0].messages[0].message).toContain('ADR-006');
  }, 60_000);

  it('keeps the allowlist finite and reviewable', () => {
    // It may shrink; it must never quietly become a wildcard.
    expect(ALLOWLIST.length).toBeLessThanOrEqual(25);
    expect(ALLOWLIST.some(e => e.includes('*'))).toBe(false);
  });
});
