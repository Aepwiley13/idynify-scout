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
 * NOTE ON SCOUT: the Phase 0 assessment sketched a Scout-only rollback flag.
 * It is not implemented, and deliberately so — Scout's icon rail was removed
 * rather than kept behind a branch, because retaining a second Scout chrome
 * is exactly the duplication this sprint exists to end. With `enabled: false`
 * Scout still renders inside MainLayout, just remounting per route as it did
 * before. Reverting Scout to its own rail is a git revert, not a flag.
 *
 * Env override lets ops flip the flag without a code deploy:
 *   VITE_SHELL_MIGRATION=off
 */

const envFlag = import.meta.env?.VITE_SHELL_MIGRATION;
const disabledByEnv = envFlag === 'off' || envFlag === 'false' || envFlag === '0';

export const SHELL_MIGRATION = {
  /** Master switch for the Sprint 1 vertical slice. */
  enabled: !disabledByEnv,

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
