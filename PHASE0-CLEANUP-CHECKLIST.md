# Phase 0 — Pre-Build Cleanup Checklist

_All items verified against the live codebase on 2026-02-22. No code changes have been made — this is a research-and-diagnosis document only._

---

## 1. Delete `src/utils/reconCompiler.js`

**Assignment:** Backend
**Complexity:** 1–2 hours (delete + global grep to confirm no hidden imports)

`src/utils/reconCompiler.js` exports two functions — `compileReconContext` and `buildReconPromptContext` — but a full-codebase search confirms that **zero production files import either of them**. The actual live compiler that all four Barry Netlify functions consume is `netlify/functions/utils/reconCompiler.js`, which exports `compileReconForPrompt`. The `src/` file is a discarded prototype that was superseded without being deleted.

The danger of leaving it in place is architectural: any developer building v2 who searches for "how RECON data reaches Barry" will find the `src/` file first (it lives in the client source tree alongside every other utility), study it, and either refactor against the wrong interface or — worse — import it from a Netlify function, triggering a runtime crash because `src/firebase/config.js` uses the browser-only Firebase client SDK (`import { db } from '../firebase/config'`), which does not exist in the Netlify Node.js execution environment. The file is not just dead; it is a trap.

---

## 2. Delete `src/utils/icpScoring.js` and Consolidate into a Single Server-Side Source of Truth with a `normalizeCompany()` Input Layer

**Assignment:** Backend (primary), Frontend (cleanup)
**Complexity:** 4–6 hours

There are currently **three divergent ICP scoring implementations** that produce different numeric scores for the same company–ICP pair:

**Implementation A — `src/utils/icpScoring.js` (client-side):**
Weighted scoring with fixed weights `{ industry: 50, location: 25, employeeSize: 15, revenue: 10 }`. Industry and location are binary (0 or 100). Employee size and revenue support an "adjacent range" partial credit of 50 points. Reads `icpProfile.companySizes` and `icpProfile.revenueRanges` as arrays of human-readable range strings (e.g., `"51-100"`, `"$1M-$2M"`). `ICPSettings.jsx` imports this and **overwrites every company's `fit_score` in Firestore** every time the user saves their ICP settings (`recalculateAllScores`, line 131).

**Implementation B — `netlify/functions/search-companies.js::calculateFitScore` (server-side):**
Point-based with completely different weights `{ industry: 30, size: 25, revenue: 20, location: 25 }`. Industry is binary. Size uses `isWithinSizeRange()`, which compares a raw integer employee count against the ICP's range strings — a different algorithm than Implementation A. Revenue gives full points if the company merely has a `revenue_range` field present, regardless of whether it matches the ICP's preferred ranges. Location extracts a state string via `extractStateFromLocation()`. This is the score initially written to Firestore when companies are discovered.

**Implementation C — `src/pages/Scout/ICPSettings.jsx` re-scorer:**
Calls Implementation A's `calculateICPScore` on every company in the user's Firestore collection at save time, permanently overwriting the Implementation B score that `search-companies.js` wrote at discovery time.

The result: `DailyLeads.jsx` and `ScoutDashboardPage.jsx` sort by `fit_score` from Firestore — but that value flips between Implementation B and C depending on whether the user has ever saved their ICP settings. Two users with identical ICPs see companies ranked differently.

The fix is: delete `src/utils/icpScoring.js`, move a single canonical `calculateFitScore()` into `netlify/functions/utils/icpScoring.js`, and call it from both `search-companies.js` and a new `recalculate-icp-scores` Netlify function that `ICPSettings.jsx` hits instead of scoring in the browser. Add a `normalizeCompany(rawCompany)` layer at the top of that utility that resolves all field name variants (`estimated_num_employees` vs `company_size` vs `employee_count`, `company.location` vs `company.state`, `organization_name` vs `company_name`) into a canonical shape before any scoring logic runs. This eliminates the field-aliasing bugs that cause silent mismatches between Apollo's raw field names and the stored field names.

**Additional bug found during research:** `search-companies.js` line 737 hardcodes `industry: companyProfile.industries?.[0] || 'Accounting'` as the industry value stored on every discovered company. If a user's ICP has no industries selected, every company is saved with `industry: 'Accounting'`, which then passes the industry match check. This should be fixed as part of this consolidation.

---

## 3. Fix the Array Serialization Bug in `compileReconForPrompt` — Multi-Select Values Are Silently Dropped

**Assignment:** Backend
**Complexity:** 2–3 hours (fix + write a regression test against the Section 2 shape)

`netlify/functions/utils/reconCompiler.js` processes sections 2 through 10 with this pattern (repeated verbatim on lines 49, 59, 69, 79, 89, 99, 109, 119, and 129):

```js
Object.entries(s2).forEach(([key, val]) => {
  if (val && typeof val === 'string') parts.push(`- ${formatKey(key)}: ${val}`);
});
```

The `typeof val === 'string'` guard is incorrect. RECON sections contain both scalar string fields and array-valued fields. Section 2's `coreFeatures` (a `multi-text` field saved as an array of up to 5 strings), `useCases` (a `multi-select` saved as an array of strings like `["Lead nurturing", "Sales enablement"]`), and `integrations` (a `multi-text` array) all have `typeof val === 'object'`, not `'string'`. The `if` condition evaluates to `false` and they are **silently discarded**. Barry never sees any of them.

From Barry's perspective, a user who completes Section 2 and carefully selects their use cases, enumerates their core features, and lists their required integrations has provided exactly the same context as a user who left those fields blank. The RECON section still counts as "completed" in the progress calculation, so the user has no indication anything went wrong. Barry's coaching and sequence generation proceeds with no knowledge of the user's product features or primary use cases — which are arguably the two most important fields in Section 2 for generating relevant outreach.

The fix is straightforward: replace `typeof val === 'string'` with a branch that handles arrays — `Array.isArray(val) ? val.filter(Boolean).join(', ') : val` — and apply the guard to the result. Every section from 2 to 10 needs this fix because the same pattern is copy-pasted across all of them. Section 1 is unaffected because it uses explicit named field access (`if (s1.companyName)`) rather than `Object.entries`.

---

## 4. Add Null/Undefined Guards and Fallback Strings for All Critical RECON Fields (BUG-03)

**Assignment:** Backend
**Complexity:** 3–4 hours

This is the compounding effect of Item 3 combined with a broader data hygiene gap: when RECON section data reaches `compileReconForPrompt`, there is no hardened contract between what the user submitted, what Firestore stored, and what the compiler expects to find. The `typeof val === 'string'` filter incidentally masks null and undefined values (since `null && ...` is falsy), but fixing Item 3 (to handle arrays) will expose a new class of failure: fields saved as `null`, `undefined`, or empty string `""` will need their own guard or they will emit lines like `- Core Features: ` into Barry's system prompt.

Beyond the compiler, the Barry functions themselves have partial guard coverage. `barryGenerateContext.js` wraps the contact summary fields in `|| 'Not specified'` fallbacks (lines 83–92), but the structured context block on lines 99–104 (`relationship_type`, `warmth_level`, `strategic_value`, `engagement_intent`) uses `|| null` — meaning if the contact is missing these fields, the conditional block at line 129 evaluates correctly, but any place downstream that renders `null` directly into a prompt fragment would emit the literal string `"null"`. `barryGenerateSequenceStep.js` uses `|| 'unknown'` fallbacks for those same fields, which is the correct pattern.

The remediation is a `sanitizeReconSection(sectionData)` helper that: (1) coerces arrays to comma-joined strings or `null`, (2) trims all string values and converts empty strings to `null`, (3) removes keys whose value is `null` after coercion. This helper runs on `sectionData` before `Object.entries` is called, creating a clean string-only map that the existing iteration pattern can handle safely. A second pass is needed on the Barry function contact blocks to audit all `|| null` patterns and replace them with `|| 'unknown'` or `|| 'not specified'` so the prompt never contains a literal JavaScript null.

---

## 5. Instrument Every Barry Call to Log Input Token Count, Output Token Count, and Whether RECON Context Was Present

**Assignment:** Backend
**Complexity:** 2–3 hours

The four Barry Netlify functions that make Claude API calls — `barryGenerateContext.js`, `barryMissionChat.js`, `barryGenerateMissionSequence.js`, and `barryGenerateSequenceStep.js` — all call `logApiUsage()` after each Claude response, but **none of them log the token counts from `claudeResponse.usage`**. The Anthropic SDK returns `{ input_tokens, output_tokens }` on every response object. The RECON section generators (`generate-section-1.js` through `generate-section-10.js`) correctly capture this: `message.usage.input_tokens + message.usage.output_tokens`. The Barry functions do not.

`logApiUsage` accepts a `metadata` object that is stored as a JSON string in Firestore's `apiLogs` collection. The fix requires passing `inputTokens: claudeResponse.usage.input_tokens`, `outputTokens: claudeResponse.usage.output_tokens`, and `reconPresent: !!reconContext` into the `metadata` field of every `logApiUsage` call in all four Barry functions. No schema changes are required — `metadata` is already a freeform JSON blob. This is additive-only; nothing breaks if the fields are missing for historical records.

Why this matters for the coaching layer decision: without 2 weeks of baseline token data segmented by `reconPresent: true/false`, there is no empirical basis for answering: (a) how much does RECON context add to Barry's per-call cost, (b) is RECON context actually changing Barry's output in measurable ways, and (c) what is the p95 token spend for a high-touch mission sequence. Designing a coaching layer on top of Barry without this data means guessing at cost and personalization ROI. Ship the instrumentation now; analyze in 2 weeks.

---

## Summary Table

| # | File(s) to Change | Assignment | Hours |
|---|---|---|---|
| 1 | Delete `src/utils/reconCompiler.js` | Backend | 1–2 |
| 2 | Delete `src/utils/icpScoring.js`; create `netlify/functions/utils/icpScoring.js` with `normalizeCompany()` | Backend + Frontend | 4–6 |
| 3 | Fix `typeof val === 'string'` in `netlify/functions/utils/reconCompiler.js` (9 occurrences) | Backend | 2–3 |
| 4 | Add `sanitizeReconSection()` + audit `|| null` patterns in Barry functions | Backend | 3–4 |
| 5 | Add `inputTokens`, `outputTokens`, `reconPresent` to `logApiUsage` calls in 4 Barry functions | Backend | 2–3 |

**Total estimated range: 12–18 hours of focused backend work.**
Items 3 and 4 are coupled — fix them together in a single PR so the null audit and the array-serialization fix go out as one tested unit. Items 1 and 5 are independent and can be done in any order. Item 2 is the highest-risk change (it touches score persistence in Firestore) and should be done last, after the RECON pipeline is clean.
