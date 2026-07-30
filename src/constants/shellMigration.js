/**
 * shellMigration — Sprint 1 global desktop shell rollout flags.
 *
 * These exist so the vertical slice can be rolled back without a revert.
 * See docs/shell-migration/PHASE0_MIGRATION_SAFETY.md § "What is the rollback
 * mechanism?" for the four rollback layers this supports.
 *
 * Layer 3 (whole slice):  SHELL_MIGRATION.enabled = false
 *   → every in-scope route falls back to the pre-migration
 *     <ProtectedRoute withLayout> wrapping. The old code path is retained
 *     for the duration of this sprint and removed only after the remaining
 *     modules migrate.
 *
 * Layer 2 (Scout only):   SHELL_MIGRATION.scoutInShell = false
 *   → ScoutMain renders its original self-contained icon-rail shell.
 *
 * Env override lets ops flip the flag without a code deploy:
 *   VITE_SHELL_MIGRATION=off
 */

const envFlag = import.meta.env?.VITE_SHELL_MIGRATION;
const disabledByEnv = envFlag === 'off' || envFlag === 'false' || envFlag === '0';

export const SHELL_MIGRATION = {
  /** Master switch for the Sprint 1 vertical slice. */
  enabled: !disabledByEnv,

  /** Scout renders as content inside the shell rather than its own shell. */
  scoutInShell: !disabledByEnv,

  /**
   * Contact Profile opens as a contextual panel over the Scout list.
   * When false, /scout/contact/:id renders as a full content route only.
   * The full content route always remains available for direct links.
   */
  contactPanel: !disabledByEnv,
};

/**
 * Routes migrated into the shared shell during Sprint 1.
 * Everything not listed keeps its existing behavior untouched — Hunter,
 * Sniper, Basecamp, Reinforcements, Fallback and Recon are explicitly
 * out of scope and retain their self-contained shells.
 */
export const IN_SCOPE_ROUTES = [
  '/mission-control-v2',
  '/scout',
  '/scout/contact/:contactId',
  '/scout/company/:companyId',
  '/scout/company/:companyId/leads',
  '/scout/total-market',
  '/scout/cadences',
  '/scout/cadence/:cadenceId',
  '/scout/game',
];

export default SHELL_MIGRATION;
