# P0B — Model Inventory and Two-Model Policy Proposal

**Idynify · Team A · Defect A13**
**Date: 2026-08-07**
**Status: APPROVED. Step 1 executed 2026-08-08, plus the RECON migration in §7. Steps 2 and 3 outstanding — see §6.**

> **Amended 2026-08-08 after provider verification.** Three claims did not
> survive verification and are corrected in place below:
> the two 2024 strings are **retired, not merely legacy** (§1, §6.1); the
> recommendation to pin dated identifiers is **withdrawn** (§4.2, §5); and the
> retirement date this document gave for `claude-sonnet-4-20250514` was
> **fabricated and is retracted** (§1, §7). The original text of each is
> preserved in the amendment notes so the reasoning trail stays intact.

---

## Summary

**39 modules call the Anthropic API across 45 call sites, using 6 distinct model identifiers spanning 4 model generations.** There is no policy governing which endpoint gets which model. The distribution reflects when each endpoint was written, not what it does.

Three consequences:

1. **Cost per call is unpredictable.** `barryHunterCardRead` produces one sentence and `generate-section-1` produces a full RECON section, yet the ten `generate-section-*` files all run a model generation older than the one used for a one-line card read.
2. **There is no upgrade path.** Changing a model means finding and editing 39 files. Two of them are legacy strings nobody has revisited since 2024 — and verification has since shown both were **retired by the provider and returning 404 in production**. That is the cost of having no upgrade path, realised: two endpoints failed silently and the codebase gave nobody a place to notice.
3. **Identifier form is inconsistent.** Five identifiers carry an explicit date suffix; `claude-sonnet-4-6` does not.

   > **Amended.** The original text continued: *"Whether that is a deliberate floating alias or an oversight has never been decided."* Verification shows it is neither. The provider stopped publishing dated snapshot IDs with the 4.6 generation — `claude-sonnet-4-6` has no dated form, and the undated ID is the complete canonical identifier rather than an alias for one. The inconsistency is generational, not an oversight, and it resolves itself as older models retire. See §4.2.

---

## 1. Inventory

Every model identifier in the codebase, by endpoint. `calls` counts distinct `messages.create` / `createMessageWithRetry` call sites in the file.

| Endpoint | Current model string | Calls | max_tokens | Status |
|---|---|---|---|---|
| `generate-section-1.js` | `claude-sonnet-4-20250514` | 1 | 4096 | Deprecated · **migrated to `MODEL_DEEP` 2026-08-08** (§7) |
| `generate-section-2.js` | `claude-sonnet-4-20250514` | 1 | 4096 | Deprecated · **migrated to `MODEL_DEEP` 2026-08-08** (§7) |
| `generate-section-3.js` | `claude-sonnet-4-20250514` | 1 | 4096 | Deprecated · **migrated to `MODEL_DEEP` 2026-08-08** (§7) |
| `generate-section-4.js` | `claude-sonnet-4-20250514` | 1 | 4096 | Deprecated · **migrated to `MODEL_DEEP` 2026-08-08** (§7) |
| `generate-section-5.js` | `claude-sonnet-4-20250514` | 1 | 4096 | Deprecated · **migrated to `MODEL_DEEP` 2026-08-08** (§7) |
| `generate-section-6.js` | `claude-sonnet-4-20250514` | 1 | 4096 | Deprecated · **migrated to `MODEL_DEEP` 2026-08-08** (§7) |
| `generate-section-7.js` | `claude-sonnet-4-20250514` | 1 | 4096 | Deprecated · **migrated to `MODEL_DEEP` 2026-08-08** (§7) |
| `generate-section-8.js` | `claude-sonnet-4-20250514` | 1 | 4096 | Deprecated · **migrated to `MODEL_DEEP` 2026-08-08** (§7) |
| `generate-section-9.js` | `claude-sonnet-4-20250514` | 1 | 4096 | Deprecated · **migrated to `MODEL_DEEP` 2026-08-08** (§7) |
| `generate-section-10.js` | `claude-sonnet-4-20250514` | 1 | 4096 | Deprecated · **migrated to `MODEL_DEEP` 2026-08-08** (§7) |
| `generate-icp-brief.js` | `claude-sonnet-4-20250514` | 1 | 4096 | Deprecated · **migrated to `MODEL_DEEP` 2026-08-08** (§7) |
| `generate-all-reports.js` | `claude-sonnet-4-20250514` | 1 | 6144 | Deprecated · **migrated to `MODEL_DEEP` 2026-08-08** (§7) |
| `generate-text-messages.js` | `claude-3-5-sonnet-20241022` | 1 | 300 | **RETIRED 2025-10-28 — 404 in production** |
| `barryGenerateTemplate.js` | `claude-3-5-haiku-20241022` | 1 | 1500 | **RETIRED 2026-02-19 — 404 in production** |
| `barryGenerateContext.js` | `claude-sonnet-4-5-20250929` | 1 | 1500 | Current-ish |
| `barryGenerateMissionSequence.js` | `claude-sonnet-4-5-20250929` | 1 | 1800 | Current-ish |
| `barryGenerateSequenceStep.js` | `claude-sonnet-4-5-20250929` | 1 | 1000 | Current-ish |
| `barryValidateContact.js` | `claude-sonnet-4-5-20250929` | 1 | 500 | Current-ish · **AI-for-deterministic** |
| `barryICPConversation.js` | `claude-sonnet-4-5-20250929` | 4 | 500, 1500 | Current-ish |
| `generate-campaign-messages.js` | `claude-sonnet-4-5-20250929` | 1 | 1024 | Current-ish |
| `generate-followup.js` | `claude-sonnet-4-5-20250929` | 1 | 1000 | Current-ish |
| `generate-engagement-message.js` | `claude-sonnet-4-5-20250929` | 1 | 4096 | Current-ish · highest-volume generator |
| `analyze-website.js` | `claude-sonnet-4-6` | 1 | 1024 | Undated identifier |
| `barry-coach-section.js` | `claude-sonnet-4-6` | 1 | 800 | Undated identifier |
| `barryCSMRead.js` | `claude-sonnet-4-6` | 1 | 150 | Undated identifier · one-sentence output |
| `barryDossierBriefing.js` | `claude-sonnet-4-6` | 1 | 200 | Undated identifier · regenerated per view |
| `barryOutreachMessage.js` | `claude-sonnet-4-6` | 1 | 300 | Undated identifier |
| `utils/barryInboxAnalyzer.js` | `claude-sonnet-4-6` | 1 | 1500 | Undated identifier · automatic per inbound reply |
| `utils/barryDraftComposer.js` | `claude-sonnet-4-6` | 1 | 2000 | Undated identifier · automatic per inbound reply |
| `barryActions.js` | `claude-haiku-4-5-20251001` | 1 | 400 | Current fast · **AI-for-deterministic** |
| `barryBulkPersonalize.js` | `claude-haiku-4-5-20251001` | 1 | 300 | Current fast · ×N contacts per batch |
| `barryFirstTouch.js` | `claude-haiku-4-5-20251001` | 1 | 800 | Current fast |
| `barryHunterCardRead.js` | `claude-haiku-4-5-20251001` | 1 | 60 | Current fast · per card render |
| `barryHunterGenerateStep.js` | `claude-haiku-4-5-20251001` | 1 | 2500 | Current fast |
| `barryHunterProcessEngage.js` | `claude-haiku-4-5-20251001` | 1 | 2500 | Current fast |
| `barryMissionChat.js` | `claude-haiku-4-5-20251001` | 3 | 600, 800, 2000 | Current fast · largest prompt in the product |
| `barryOrientationBrief.js` | `claude-haiku-4-5-20251001` | 1 | 300 | Current fast |
| `barryReconInterview.js` | `claude-haiku-4-5-20251001` | 1 | 300 | Current fast |
| `barryReconSection0.js` | `claude-haiku-4-5-20251001` | 1 | 500 | Current fast |

**Non-call-site references** (no change needed, listed for completeness):
`src/services/barryCSM.js:18` — a stale comment proposing a CSM function that was subsequently built as `barryCSMRead.js`.
`src/test/barryBulkPersonalize.test.js` — test fixture asserting the model passed through.

### Distribution

| Model identifier | Modules | Generation | Notes |
|---|---|---|---|
| `claude-sonnet-4-20250514` | 12 → **0** | Oldest in active use | Entire RECON generation surface · deprecated; migrated off 2026-08-08 (§7) |
| `claude-haiku-4-5-20251001` | 10 | Current fast | |
| `claude-sonnet-4-5-20250929` | 8 | Current deep | |
| `claude-sonnet-4-6` | 7 | Newest | No date suffix — **none exists**; this is the canonical ID |
| `claude-3-5-sonnet-20241022` | 1 | Legacy | **Retired — 404** |
| `claude-3-5-haiku-20241022` | 1 | Legacy | **Retired — 404** |

---

## 2. What the inventory reveals

**The RECON surface is the largest single block and it is on the oldest generation.** Twelve modules — every `generate-section-*`, the ICP brief, and the batch report generator — share `claude-sonnet-4-20250514`. They are also the twelve files the reconciliation marks for consolidation into one `GenerateReconSectionSkill` at P4. Updating twelve near-identical files individually is work that the P4 consolidation deletes anyway.

**Model choice does not track task complexity.** Compare:

| Endpoint | Output | Model tier |
|---|---|---|
| `barryHunterCardRead` | 60 tokens, one sentence | fast ✓ appropriate |
| `barryCSMRead` | 150 tokens, one assessment | **deep** ✗ over-specified |
| `barryDossierBriefing` | 200 tokens, one briefing | **deep** ✗ over-specified |
| `barryHunterGenerateStep` | 2500 tokens, four message angles | **fast** ✗ under-specified |
| `barryMissionChat` | up to 2000 tokens over the largest prompt in the product | **fast** ✗ under-specified |

Three one-liner endpoints run the deep tier; the two heaviest reasoning endpoints run the fast tier. Neither is a decision anyone made — it is the order the files were written in.

**Two endpoints should not be calling a model at all.** `barryValidateContact` (deep tier, 500 tokens) validates contact field shapes, and `barryActions` (fast tier, 400 tokens) parses a message into one of six enumerated action types. Both are flagged in the reconciliation as genuine AI-for-deterministic antipatterns. They are listed here for completeness; removing them is P4 work, not a model-policy change.

---

## 3. The two-model policy

Two constants, declared once, referenced everywhere. No endpoint hard-codes a model string.

```js
// netlify/functions/utils/models.js  — created 2026-08-08 (Step 1)
export const MODEL_FAST = process.env.BARRY_MODEL_FAST || 'claude-haiku-4-5';
export const MODEL_DEEP = process.env.BARRY_MODEL_DEEP || 'claude-sonnet-4-6';
```

Env-overridable so a model can be rolled forward or back without a deploy, and so dev and prod can diverge during evaluation.

### Tier assignment

**FAST** — high frequency, low complexity, latency-sensitive, short output. The user is waiting.

| Endpoint | Why fast |
|---|---|
| `barryMissionChat` (×3) | Chat turn; latency dominates perceived quality |
| `barryOrientationBrief` | 2-3 sentences over pre-computed facts |
| `barryHunterCardRead` | One sentence, rendered per card |
| `barryCSMRead` | One health assessment — **moves down from deep** |
| `barryDossierBriefing` | One briefing — **moves down from deep** |
| `barryOutreachMessage` | Single short message — **moves down from deep** |
| `barryBulkPersonalize` | One opening line × N contacts; volume endpoint |
| `barryFirstTouch` | Single first-touch message |
| `barryReconInterview` | Live coaching turn |
| `barryReconSection0` | Live coaching turn |
| `barryGenerateTemplate` | Template text — **moves up from 3-5-haiku** |
| `generate-text-messages` | SMS variants — **moves up from 3-5-sonnet** |
| `barryActions` | Until it becomes a typed tool schema in P4 |

**DEEP** — reasoning, judgement, long structured output, or anything whose result is persisted and reused.

| Endpoint | Why deep |
|---|---|
| `barryInboxAnalyzer` | 15-field structured analysis of an inbound reply; drives everything downstream |
| `barryDraftComposer` | Composes a reply a customer will actually receive |
| `generate-engagement-message` | Four distinct angles with reasoning; highest-value generator |
| `barryHunterGenerateStep` | Four angles — **moves up from fast** |
| `barryHunterProcessEngage` | Four angles inside the engage workflow — **moves up from fast** |
| `barryGenerateSequenceStep` | Sequence step with strategy context |
| `barryGenerateMissionSequence` | Full multi-step sequence |
| `barryGenerateContext` | Persisted context object |
| `generate-followup` | Customer-facing message |
| `generate-campaign-messages` | Customer-facing message set |
| `generate-section-1..10` | Full RECON sections — **move up from sonnet-4-20250514** |
| `generate-icp-brief` | Full ICP brief — **moves up** |
| `generate-all-reports` | Batch report generation — **moves up** |
| `barry-coach-section` | Post-save coaching with inference |
| `analyze-website` | Long unstructured input → structured profile |
| `barryICPConversation` (×4) | Onboarding reasoning |
| `barryValidateContact` | Until it becomes deterministic in P4 |

**Net movement: 4 endpoints down to fast, 15 up to deep, 2 legacy strings retired.** The RECON block accounts for 12 of the 15 upward moves.

### Sequencing note

The twelve RECON endpoints are consolidated into a single Skill at P4. **Recommendation: do not rewrite twelve files now.** Point them at `MODEL_DEEP` as part of the P4 consolidation, when there is one file to change instead of twelve. The two legacy strings (`generate-text-messages`, `barryGenerateTemplate`) and the six tier corrections are worth doing in P0B because they are isolated single-line changes with immediate cost and quality effects.

---

## 4. Verification results

The original §4 required that model support status be verified at execution time rather than asserted here. That verification ran on 2026-08-08, against the provider's current model catalogue. Results:

### 4.1 Every identifier in the inventory, checked

| Identifier | Status | Consequence |
|---|---|---|
| `claude-3-5-sonnet-20241022` | **Retired 2025-10-28** | `generate-text-messages` has been returning 404 since that date |
| `claude-3-5-haiku-20241022` | **Retired 2026-02-19** | `barryGenerateTemplate` has been returning 404 since that date |
| `claude-sonnet-4-20250514` | **Deprecated, retirement date not announced** | The twelve RECON generators still work. Deprecated is not retired |
| `claude-sonnet-4-5-20250929` | Active | Dated snapshot, still supported |
| `claude-haiku-4-5-20251001` | Active | Dated snapshot of Haiku 4.5 |
| `claude-sonnet-4-6` | Active | Canonical identifier — see §4.2 |

The two retirements are the material finding. The audit classified those strings as *old*; they are in fact *dead*, and had been for months. Nothing in the product surfaced it, because a 404 from the model API is indistinguishable from any other generation failure in the current error handling.

### 4.2 The `claude-sonnet-4-6` question — resolved

**The recommendation to pin dated identifiers is withdrawn, because it is not executable.**

The provider stopped publishing dated snapshot IDs with the 4.6 generation. `claude-sonnet-4-6` has no dated form; the undated string is the complete canonical identifier, not a floating alias that resolves to some dated snapshot underneath. The dated identifiers still in the codebase (`claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001`, `claude-sonnet-4-20250514`) belong to earlier generations that did publish them.

So the choice the original §4.2 posed — pin versus float — does not exist for the deep tier. The policy instead uses **the provider's published identifier for whichever model each tier names**, whatever form that takes.

The change-control concern behind the "pin dated" recommendation is still valid and is still met: both constants live in one committed file, so changing Barry's model is a one-line reviewable diff. What is lost is protection against the provider silently re-pointing an identifier — that risk is now carried by the tier-change baseline in §6.2 rather than by the string.

### 4.3 Still outstanding

1. **Re-baseline cost before changing tiers.** The telemetry fixed in P0B (`f27c280`) records `provider`, `model`, and real token counts, so this is measurable for the first time. Capture a week of `apiLogs` first, so the Step 3 comparison is against data rather than the estimates in the canonical audit.
2. **Watch the two moves most likely to regress.** `barryHunterGenerateStep` and `barryHunterProcessEngage` move from fast to deep at 2500 max_tokens; latency will rise on the Hunter engage path. `barryCSMRead` and `barryDossierBriefing` move down to fast; check the one-sentence output quality holds.

---

## 5. Decisions

Approved 2026-08-08. Adoption was approved in three steps rather than one — see §6.

| # | Decision | Outcome |
|---|---|---|
| 1 | Adopt a two-constant model policy with env override? | **Approved.** `netlify/functions/utils/models.js` created; all 39 modules route through it |
| 2 | Pin dated identifiers or use floating aliases? | **Neither — question withdrawn.** No dated form exists for the deep tier (§4.2). Policy uses the provider's canonical identifier per tier |
| 3 | Which fast model and which deep model? | `MODEL_FAST = claude-haiku-4-5`, `MODEL_DEEP = claude-sonnet-4-6` — both verified active |
| 4 | Apply the 6 isolated tier corrections + 2 legacy retirements? | **Split.** The 2 retirements shipped in Step 1 (reliability — those endpoints were 404ing). The 6 tier corrections are held for Step 3, after a baseline exists |
| 5 | Defer the 12 RECON endpoints to the P4 consolidation? | **Approved.** Deferred regardless of Step 3 |

---

## 6. Execution record

### 6.1 Step 1 — centralisation (done, 2026-08-08)

`netlify/functions/utils/models.js` declares `MODEL_FAST` and `MODEL_DEEP` plus three `LEGACY_*` constants holding the pre-policy identifiers. **39 modules, 78 model references** now resolve through it. No model literal is passed to the Anthropic SDK — or recorded in telemetry — from anywhere but that one file.

**This step changed what one endpoint calls in exactly two places**, both forced by §4.1:

| Endpoint | Was | Now | Why |
|---|---|---|---|
| `generate-text-messages` | `claude-3-5-sonnet-20241022` | `MODEL_FAST` | Retired string, 404. Endpoint is FAST tier in §3 |
| `barryGenerateTemplate` | `claude-3-5-haiku-20241022` | `MODEL_FAST` | Retired string, 404. Endpoint is FAST tier in §3 |

Every other endpoint calls the identical model string it called before. The seven modules already on `claude-sonnet-4-6` now import `MODEL_DEEP`, which resolves to the same string; the other thirty import a `LEGACY_*` constant carrying their exact prior value.

**Deliberately not routed through `models.js`:** the `"model"` field inside the RECON prompt templates (`generate-section-*`, `generate-icp-brief`, `generate-all-reports`). That is prompt text asking Claude to echo a value into `metadata.model` — not a routing decision. Editing it would change the prompt, which Step 1 excludes. It goes away with the P4 consolidation.

**Interop note:** two of the routed modules (`generate-text-messages`, `generate-followup`) are CommonJS and reach `models.js` via `require()`. Verified by bundling both with the project's esbuild bundler and executing the result — the constant resolves, and the env override is honoured at runtime.

### 6.2 Step 2 — baseline (outstanding)

Collect a minimum of one week of `apiLogs` before any tier changes. Not skippable: without it, Step 3 has nothing to be compared against, and the P0B telemetry fix exists precisely so this measurement can be taken.

### 6.3 Step 3 — tier corrections (not approved)

The 6 tier corrections and the retirement of the two remaining `LEGACY_*` constants execute as a separate controlled change, after the baseline is reported.

The 12 RECON endpoints are **no longer deferred** — they moved to `MODEL_DEEP` on 2026-08-08 ahead of the baseline (§7). The P4 consolidation of those twelve files into one Skill is unaffected; only the model they call changed.

---

## 7. Retraction — the `claude-sonnet-4-20250514` retirement date

**This document asserted that `claude-sonnet-4-20250514` retires 2026-06-15. That date is retracted. It was never published by the provider.**

The claim appeared in §1 and in the `LEGACY_SONNET_4` comment in `models.js`, in both cases stated as fact with no source. §4 of this document opened by insisting that *"model support status is a configuration concern to verify at execution time, not a claim made in this document"* — and then a specific date was put in the status column anyway. The rule was right; it was not followed.

### Verified status, 2026-08-08

| | |
|---|---|
| Provider status | **Deprecated** |
| Retirement date | **Not announced** |
| Listed as retired? | **No** — it does not appear in the provider's retired-model list |
| Practical meaning | The model still serves. Calls against it succeed |

For contrast, both strings this document *does* call retired are on that list explicitly: `claude-3-5-sonnet-20241022` (2025-10-28) and `claude-3-5-haiku-20241022` (2026-02-19). The distinction is not stylistic. A retired model returns 404; a deprecated one returns a completion.

### Consequence, and what was decided

The twelve RECON endpoints on `LEGACY_SONNET_4` were **not broken**. They are not the same category of defect as the two 3.5 strings, and the exception that justified fixing those in Step 1 — *"retired and unsupported models are exempt, preserving a broken baseline has no value"* — did not reach them, because nothing about them was broken.

**They were migrated to `MODEL_DEEP` anyway, on Aaron's instruction, on 2026-08-08.** The record should be precise about which argument carried it, because the one given in the instruction did not survive verification:

| Argument | Holds? |
|---|---|
| The endpoints are broken in production right now | **No.** The model was serving |
| Same category of break as the two 3.5 strings | **No.** Those 404; this one returned completions |
| Covered by the retired-and-unsupported exception | **No.** The exception names retired models; this one is deprecated |
| Deprecated models should be left early, not at the last minute | **Yes.** This is what actually justifies the change |
| RECON output quality improves on the newer model | **Yes.** Sonnet 4.6 over Sonnet 4 |

So this was a **tier change taken deliberately ahead of the baseline**, not a reliability repair. The cost is real and should be named: ten of the twelve are live customer-facing RECON generators, and their output moved immediately before the baseline window opened. The baseline therefore measures a RECON surface that has just changed, and any RECON cost or quality comparison against pre-2026-08-08 behaviour is not like-for-like.

`LEGACY_SONNET_4` has been removed from `models.js`; nothing imports it.

### Endpoint liveness, verified 2026-08-08

Ten of the twelve are reachable from the UI. Two are not:

| Endpoint | Caller |
|---|---|
| `generate-section-1` … `generate-section-10` | one RECON section component each |
| `generate-icp-brief` | **none** |
| `generate-all-reports` | **none** |

`generate-icp-brief` and `generate-all-reports` have no `fetch` call anywhere in `src/` or `netlify/`. The `/icp-brief` route in `App.jsx` is a UI view that reads an already-generated brief; it does not invoke the function. Both are candidates for the A5 dead-endpoint ledger, to be confirmed against production invocation logs before deletion rather than on static analysis alone.

### Standing trigger

Deprecated is a clock with no number on it yet. If the provider announces a retirement date for `claude-sonnet-4-20250514`, the twelve migrate to `MODEL_DEEP` immediately as a reliability repair, regardless of where the baseline or the P4 consolidation stands. That trigger is recorded in the `LEGACY_SONNET_4` comment in `models.js` so it is visible at the point of use.
