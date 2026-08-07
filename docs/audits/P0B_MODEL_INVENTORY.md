# P0B — Model Inventory and Two-Model Policy Proposal

**Idynify · Team A · Defect A13**
**Date: 2026-08-07**
**Status: PROPOSAL — no model strings have been changed. Awaiting Aaron's approval.**

---

## Summary

**39 modules call the Anthropic API across 45 call sites, using 6 distinct model identifiers spanning 4 model generations.** There is no policy governing which endpoint gets which model. The distribution reflects when each endpoint was written, not what it does.

Three consequences:

1. **Cost per call is unpredictable.** `barryHunterCardRead` produces one sentence and `generate-section-1` produces a full RECON section, yet the ten `generate-section-*` files all run a model generation older than the one used for a one-line card read.
2. **There is no upgrade path.** Changing a model means finding and editing 39 files. Two of them are legacy strings nobody has revisited since 2024.
3. **Identifier form is inconsistent.** Five identifiers carry an explicit date suffix; `claude-sonnet-4-6` does not. Whether that is a deliberate floating alias or an oversight has never been decided.

---

## 1. Inventory

Every model identifier in the codebase, by endpoint. `calls` counts distinct `messages.create` / `createMessageWithRetry` call sites in the file.

| Endpoint | Current model string | Calls | max_tokens | Status |
|---|---|---|---|---|
| `generate-section-1.js` | `claude-sonnet-4-20250514` | 1 | 4096 | **Legacy generation** |
| `generate-section-2.js` | `claude-sonnet-4-20250514` | 1 | 4096 | **Legacy generation** |
| `generate-section-3.js` | `claude-sonnet-4-20250514` | 1 | 4096 | **Legacy generation** |
| `generate-section-4.js` | `claude-sonnet-4-20250514` | 1 | 4096 | **Legacy generation** |
| `generate-section-5.js` | `claude-sonnet-4-20250514` | 1 | 4096 | **Legacy generation** |
| `generate-section-6.js` | `claude-sonnet-4-20250514` | 1 | 4096 | **Legacy generation** |
| `generate-section-7.js` | `claude-sonnet-4-20250514` | 1 | 4096 | **Legacy generation** |
| `generate-section-8.js` | `claude-sonnet-4-20250514` | 1 | 4096 | **Legacy generation** |
| `generate-section-9.js` | `claude-sonnet-4-20250514` | 1 | 4096 | **Legacy generation** |
| `generate-section-10.js` | `claude-sonnet-4-20250514` | 1 | 4096 | **Legacy generation** |
| `generate-icp-brief.js` | `claude-sonnet-4-20250514` | 1 | 4096 | **Legacy generation** |
| `generate-all-reports.js` | `claude-sonnet-4-20250514` | 1 | 6144 | **Legacy generation** |
| `generate-text-messages.js` | `claude-3-5-sonnet-20241022` | 1 | 300 | **Oldest string in the codebase** |
| `barryGenerateTemplate.js` | `claude-3-5-haiku-20241022` | 1 | 1500 | **Oldest string in the codebase** |
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
| `claude-sonnet-4-20250514` | 12 | Oldest in active use | Entire RECON generation surface |
| `claude-haiku-4-5-20251001` | 10 | Current fast | |
| `claude-sonnet-4-5-20250929` | 8 | Current deep | |
| `claude-sonnet-4-6` | 7 | Newest | **The only identifier with no date suffix** |
| `claude-3-5-sonnet-20241022` | 1 | Legacy | |
| `claude-3-5-haiku-20241022` | 1 | Legacy | |

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

## 3. Proposed two-model policy

Two constants, declared once, referenced everywhere. No endpoint hard-codes a model string.

```js
// netlify/functions/utils/models.js  — proposed, not yet created
export const MODEL_FAST = process.env.BARRY_MODEL_FAST || '<fast model>';
export const MODEL_DEEP = process.env.BARRY_MODEL_DEEP || '<deep model>';
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

## 4. What must be verified before any change

**Model support status is a configuration concern to verify at execution time, not a claim made in this document.** No deprecation dates are asserted here, deliberately.

Before switching anything:

1. **Confirm current availability and exact identifier form** for the intended fast and deep models against the provider. Do not carry any identifier forward on the assumption it still resolves.
2. **Resolve the `claude-sonnet-4-6` question.** It is the only identifier in the codebase without a date suffix. Decide deliberately whether the policy pins dated identifiers — reproducible, requires explicit upgrades — or floating aliases — auto-upgrading, but a model change can alter output with no commit. Then apply that decision to both constants. Recommendation: **pin dated identifiers**, because Barry's output is customer-facing and a silent model change would be indistinguishable from a prompt regression.
3. **Re-baseline cost after the switch.** The telemetry fixed in P0B (`f27c280`) now records `provider`, `model`, and real token counts, so this is measurable for the first time. Capture a week of `apiLogs` before changing models, so the comparison is against data rather than the estimates in the canonical audit.
4. **Watch the two moves most likely to regress.** `barryHunterGenerateStep` and `barryHunterProcessEngage` move from fast to deep at 2500 max_tokens; latency will rise on the Hunter engage path. `barryCSMRead` and `barryDossierBriefing` move down to fast; check the one-sentence output quality holds.

---

## 5. Requested decision

| # | Decision | Recommendation |
|---|---|---|
| 1 | Adopt a two-constant model policy with env override? | Yes |
| 2 | Pin dated identifiers or use floating aliases? | **Pin dated** — customer-facing output should not change without a commit |
| 3 | Which fast model and which deep model? | Verify availability first (§4.1), then pin |
| 4 | Apply the 6 isolated tier corrections + 2 legacy retirements in P0B? | Yes — single-line, immediate effect |
| 5 | Defer the 12 RECON endpoints to the P4 consolidation? | Yes — avoids rewriting twelve files that P4 deletes |

**No model strings have been changed. Nothing in this proposal is implemented.**
