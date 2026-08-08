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

// ─── Pre-policy models, still in effect until Step 3 ─────────────────────────
//
// Support status below was re-verified against the provider's model catalogue
// on 2026-08-08. Record the date whenever you touch these — an unsourced
// status claim in this block is what produced the error corrected in §1 of
// docs/audits/P0B_MODEL_INVENTORY.md.

// LEGACY_SONNET_4 = 'claude-sonnet-4-20250514' was removed on 2026-08-08.
// The twelve RECON generators that imported it — generate-section-1..10,
// generate-icp-brief, generate-all-reports — now call MODEL_DEEP.
//
// Recording the basis accurately, because an earlier revision of this file did
// not: that string was verified on 2026-08-08 as **deprecated, retirement date
// not announced**. It was still serving. It is not on the provider's retired
// list, unlike the two 2024 strings replaced in 97e5653, which are. So the
// migration was a decision to leave a deprecated model early, not a repair of
// a broken one. An earlier comment here claimed a 2026-06-15 retirement date;
// that date was never published and is retracted. See §7 of
// docs/audits/P0B_MODEL_INVENTORY.md.
//
// The constant is gone rather than kept-and-marked because nothing imports it.

/** Dated snapshot, active (verified 2026-08-08). Sequence and ICP generation. */
export const LEGACY_SONNET_4_5 = 'claude-sonnet-4-5-20250929';

/**
 * Dated snapshot of the same model MODEL_FAST names, active (verified
 * 2026-08-08). Kept as a distinct literal so Step 1 changes nothing on the ten
 * endpoints that pin it; they collapse onto MODEL_FAST at Step 3.
 */
export const LEGACY_HAIKU_4_5 = 'claude-haiku-4-5-20251001';
