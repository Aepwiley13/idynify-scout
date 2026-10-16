/**
 * models.js — the only place a Claude model identifier is written down.
 *
 * Defect A13. Before this file existed, 39 modules each hard-coded their own
 * model string across 6 identifiers and 4 model generations. Two of those
 * strings had been retired by the provider and were returning 404 in
 * production; nobody noticed, because there was nowhere to look.
 *
 * ── The two-model policy ────────────────────────────────────────────────────
 *
 * Barry runs on two tiers and no more:
 *
 *   MODEL_FAST — high frequency, short output, the user is waiting on it.
 *   MODEL_DEEP — reasoning, long structured output, or a result we persist.
 *
 * Both are env-overridable so a model can be rolled forward or back without a
 * deploy, and so a staging environment can evaluate a candidate model against
 * production traffic shapes without a commit.
 *
 * ── Identifier form: aliases, not date suffixes ─────────────────────────────
 *
 * The P0B proposal recommended pinning dated identifiers. Verification against
 * the provider retired that recommendation: Anthropic stopped publishing dated
 * snapshot IDs with the 4.6 generation. `claude-sonnet-4-6` has no dated form —
 * the undated ID is the complete, canonical identifier, not an alias for one.
 * A date suffix cannot be applied to the deep tier, so the policy uses the
 * provider's published identifier for each tier.
 *
 * Change control comes from this file, not from the string: both constants live
 * in one committed module, so a model change is a reviewable one-line diff.
 *
 * ── LEGACY_* constants ──────────────────────────────────────────────────────
 *
 * Step 1 of the rollout is a relocation, not a re-tiering. Every endpoint that
 * was on a non-tier model still calls exactly the model it called before —
 * the string just lives here now instead of in 39 files. The LEGACY_ prefix
 * marks the ones that disappear at Step 3, when endpoints move onto their
 * assigned tier. When no import of a LEGACY_ constant remains, delete it.
 *
 * Not routed through this module, deliberately:
 *   - The `"model"` field inside the RECON prompt templates
 *     (generate-section-*, generate-icp-brief, generate-all-reports). That is
 *     prompt text asking Claude to echo a value into `metadata.model`, not a
 *     routing decision. Editing it would change the prompt. It is also inert:
 *     each handler overwrites `output.metadata` wholesale after parsing, so
 *     the persisted `metadata.model` is the constant this module supplied,
 *     never the string the template asked for.
 */

// ─── Policy tiers ────────────────────────────────────────────────────────────

/** High frequency, short output, latency-sensitive. */
export const MODEL_FAST = process.env.BARRY_MODEL_FAST || 'claude-haiku-4-5';

/** Reasoning, long structured output, or anything persisted and reused. */
export const MODEL_DEEP = process.env.BARRY_MODEL_DEEP || 'claude-sonnet-4-6';

// ─── Relationship Capture ────────────────────────────────────────────────────

/**
 * Reading a business-card photo (vision + structured output), outside Barry's
 * two tiers. The claude-vision extractor takes CAPTURE_EXTRACT_MODEL from the
 * environment it is built with over this default, so a deploy or a pilot run
 * can switch models without a commit. The 50-card pilot decides which model
 * moves forward (docs/capture/claude-vision.md).
 */
export const MODEL_CAPTURE_DEFAULT = 'claude-opus-5-5';

// ─── Model lifecycle ─────────────────────────────────────────────────────────
//
// Verified 2026-10-16 against Anthropic's published deprecation history:
//   https://platform.claude.com/docs/en/about-claude/model-deprecations
//
// Idynify calls the Anthropic Claude API directly (@anthropic-ai/sdk +
// ANTHROPIC_API_KEY). There is no Bedrock or Vertex client in this repository,
// so that page is the governing lifecycle — partner platforms publish their own
// schedules and their dates do not apply here.
//
//   claude-sonnet-5-5          Active — retirement not sooner than 2027-09-28
//   claude-sonnet-4-6          Active — retirement not sooner than 2027-02-17
//   claude-haiku-4-5-20251001  Active — retirement not sooner than 2026-10-15
//   claude-sonnet-4-5-20250929 Deprecated 2026-09-30 — RETIRES 2026-11-30 ⚠
//                              Recommended replacement: claude-sonnet-5-5
//
// The Sonnet 4.5 retirement overrides the routing freeze for the endpoints on
// it (#699); see MODEL_BARRY_SONNET below. The Haiku 4.5 floor date has passed
// with the model still Active; Anthropic gives at least 60 days' notice before
// a retirement, so it is a watch item, not a deadline.
//
// Removed because the provider retired them. Every one of these was still being
// called in production after its retirement date:
//
//   claude-sonnet-4-20250514    retired 2026-06-15  → 12 RECON generators
//   claude-3-5-haiku-20241022   retired 2026-02-19  → barryGenerateTemplate
//   claude-3-5-sonnet-20241022  retired 2025-10-28  → generate-text-messages
//
// Three of the six identifiers this codebase shipped had been retired. That is
// what having no central routing and no lifecycle check actually cost.
//
// RULE: a status claim in this block carries the URL it came from and the date
// it was fetched. This file twice asserted a lifecycle status from recollection
// while describing it as verified — once claiming a retirement date that turned
// out to be right, then "correcting" it to a deprecated-only status that was
// wrong, which briefly made a retired model look safe. An uncited status is a
// recollection, whatever the sentence around it says. Full account:
// docs/audits/P0B_MODEL_INVENTORY.md §8.

// ─── The Sonnet model behind the Barry endpoints (#699) ──────────────────────
//
// Nine endpoints (eleven calls) run on one Sonnet model: sequence, ICP,
// context, contact-validation and campaign/follow-up/engagement generation.
// It was pinned to claude-sonnet-4-5-20250929, which retires 2026-11-30. The
// choice now lives here, with the migration path written down beside it:
//
//   SONNET_4_5           current production model, and the default
//   SONNET_5_5           primary candidate, the provider's named replacement
//   SONNET_4_6           fallback if the candidate does not pass validation;
//                        retirement not sooner than 2027-02-17, so it buys
//                        about three months and a second migration
//
// BARRY_MODEL_SONNET overrides the default, so switching, or rolling back, is
// a Netlify environment-variable change plus a redeploy of the same commit:
// Netlify applies a changed variable on the next deploy, with no code change.
//
// The default stays SONNET_4_5 until the side-by-side validation passes and
// it is changed here deliberately. Do not point the override at SONNET_5_5
// before then: these calls send no thinking or effort settings yet, and Sonnet
// 5.5 thinks by default (#699, migration risks 1 and 2).

/** Current production model. Deprecated; retires 2026-11-30. */
export const SONNET_4_5 = 'claude-sonnet-4-5-20250929';

/** Primary migration candidate. Active; retirement not sooner than 2027-09-28. */
export const SONNET_5_5 = 'claude-sonnet-5-5';

/** Fallback if the candidate fails validation. Active; not sooner than 2027-02-17. */
export const SONNET_4_6 = 'claude-sonnet-4-6';

/**
 * The model the Barry Sonnet endpoints call: BARRY_MODEL_SONNET when set to a
 * non-empty value, otherwise SONNET_4_5. Exported for testing.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {string}
 */
export function resolveBarrySonnetModel(env = process.env) {
  const override = typeof env.BARRY_MODEL_SONNET === 'string' ? env.BARRY_MODEL_SONNET.trim() : '';
  return override || SONNET_4_5;
}

export const MODEL_BARRY_SONNET = resolveBarrySonnetModel();

// ─── Dated snapshots still pinned by pre-policy endpoints ────────────────────
//
// Active per the verification above. It collapses onto MODEL_FAST at Step 3,
// after the baseline. Do not remove it while an import remains — 10 endpoints
// resolve their model through it.

/**
 * Active; retirement not sooner than 2026-10-15 (verified 2026-10-16).
 * The dated snapshot of the same model MODEL_FAST names. Kept as a distinct
 * literal so Step 1 changed nothing on the ten endpoints that pin it.
 */
export const LEGACY_HAIKU_4_5 = 'claude-haiku-4-5-20251001';
