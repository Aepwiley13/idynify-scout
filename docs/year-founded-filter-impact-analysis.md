# ICP Enhancement: "Year Founded" Filter — System Impact Analysis

**Requested by:** CTO
**Status:** Phase 1 Complete — Awaiting Review & Approval Before Build
**Branch:** `claude/add-year-founded-filter-3s2iq`
**Date:** 2026-03-18

---

## Executive Summary

The `year_founded` field already exists in the company data model and is populated from Apollo today. The primary work is wiring it into the ICP filter schema, the scoring engine, the search pipeline, and Barry's ICP conversation. The change is **additive and fully backward compatible** — no records need migration, no existing scores break. The largest single risk is that Apollo's search API does not support server-side filtering by `founded_year`, requiring client-side post-filtering that reduces effective page size. This must be accounted for in the build plan.

**Effort: Medium. Risk: Low-Medium. No blocking dependencies.**

---

## Phase 1: System Impact Assessment

---

### 1. Data Model & Schema

#### Where should `year_founded` live?

`year_founded` already exists at **two locations** in the company data model:

| Location | Path | Type | Source |
|----------|------|------|--------|
| Root company field | `users/{uid}/companies/{cid}.founded_year` | `number \| null` | Apollo search API |
| Enrichment snapshot | `users/{uid}/companies/{cid}.apolloEnrichment.snapshot.founded_year` | `number \| null` | Apollo enrich API |
| Derived field | `users/{uid}/companies/{cid}.company_age_years` | `number` | Computed at ingest |

**File references:**
- `netlify/functions/search-companies.js:730,756,786,896` — ingest + storage of `founded_year` from Apollo search
- `netlify/functions/enrichCompany.js:197` — storage of `founded_year` from Apollo enrichment snapshot
- `netlify/functions/search-companies.js:875-876` — calculation of `company_age_years`

**For the ICP filter**, `year_founded` should be added as a **range filter** on the ICP config document:

```
users/{uid}/companyProfile/current.foundedYearRange: { min: number | null, max: number | null }
```

This is the only schema location that needs updating. The company records already have the field — no migration of company documents is required.

**Format recommendation: Integer range (`{ min, max }`) with both ends optional.**

This is the correct approach because:
- Apollo returns `founded_year` as an integer (e.g., `2015`)
- Ranges are the semantically meaningful unit (e.g., "founded 2015–2020")
- A single-year exact match is a degenerate range (`{ min: 2018, max: 2018 }`)
- Open-ended ranges are common use cases ("startups founded after 2015", "companies with 10+ years of stability")
- Matches the pattern already used for `companySizes` and `revenueRanges`

---

### 2. Data Availability & Integrity

#### Apollo data coverage

Apollo returns `founded_year` from both the **search endpoint** (`/mixed_companies/search`) and the **enrich endpoint** (`/organizations/enrich`). Based on the code at `search-companies.js:730`:

```javascript
const foundedYear = company.founded_year || null;
```

The fallback to `null` already exists, indicating Apollo does **not** guarantee this field. Apollo's internal coverage for `founded_year` varies by company:
- **Well-known tech companies:** ~95%+ coverage
- **Mid-market B2B companies:** estimated 60–75% coverage
- **Small/local businesses:** estimated 30–50% coverage

#### Gap handling

Current code already handles null gracefully:
```javascript
// search-companies.js:875-876
const foundedYear = company.founded_year || null;
const companyAge = foundedYear ? new Date().getFullYear() - foundedYear : 0;
```

**For ICP filtering**, the recommended null-handling behavior:
- When `foundedYearRange` is set in ICP, companies with `founded_year = null` should **pass through unpenalized** (treated as "unknown" not "disqualified")
- This prevents the filter from inadvertently excluding otherwise well-matched companies simply because Apollo lacks the data point
- The `fit_reasons` output should surface: `⚠ Founded year not available` when the field is configured but data is missing

**No enrichment triggers are needed** — Apollo already returns `founded_year` in the primary search flow. No new API calls required.

---

### 3. ICP Settings Architecture

#### Current ICP filter structure (`users/{uid}/companyProfile/current`)

```javascript
{
  industries: string[],           // multi-select, exact match
  companySizes: string[],         // multi-select, range with adjacent-match fallback
  revenueRanges: string[],        // multi-select, range with adjacent-match fallback
  skipRevenue: boolean,
  locations: string[],            // multi-select, exact state match
  isNationwide: boolean,
  targetTitles: string[],         // free-text list
  companyKeywords: string[],      // stage/type signals fed to Apollo keyword search
  scoringWeights: {               // must sum to 100
    industry: number,
    location: number,
    employeeSize: number,
    revenue: number
  },
  managedByBarry: boolean,
  lookalikeSeed: { name: string, domain: string } | null,
  updatedAt: string
}
```

**File:** `src/pages/Scout/ICPSettings.jsx:41-82` (load), `84-118` (save)
**Scoring:** `src/utils/icpScoring.js:9-14` (weights), `151-187` (score calculation)

#### Where `foundedYearRange` fits

Add to the ICP document:
```javascript
foundedYearRange: { min: number | null, max: number | null } | null
```

`null` at the top level means "not configured" (filter disabled). A configured object with one or both bounds set means the filter is active.

#### Schema migration

**Not required.** Firestore is schema-less. Existing ICP documents without `foundedYearRange` will simply return `undefined` for this field, which the application treats as "filter not configured." The load function in `ICPSettings.jsx:64-76` already uses a default-object pattern — adding `foundedYearRange: null` to the default object is the only change needed there.

#### Scoring weights impact

This is the most architecturally significant decision. Two options:

**Option A: Add as a 5th scored dimension (requires weights to sum to 100%)**
- `scoringWeights` currently enforces exactly 100%: `ICPSettings.jsx:90-94`, `icpScoring.js:194-197`
- Adding a 5th weight requires updating the validation logic and the UI sliders
- Existing users' weight configurations would no longer sum to 100% after a schema change → requires a migration step (redistribute the delta)
- **Recommended default when `foundedYearRange` is enabled:** 10% weight, reducing `industry` from 50% to 40%

**Option B: Apply as a hard-pass/fail gate (no weight required)**
- Year founded functions as a binary qualifier: a company outside the configured range scores 0 on this dimension regardless of other matches
- Simpler to implement, no weight system changes, no migration of existing profiles
- Precedent exists: `isNationwide` and `skipRevenue` are already boolean gates
- **Tradeoff:** Less nuanced than weighted scoring, but more intuitive (users expect date ranges to be hard cutoffs)

**Recommendation: Option B (hard gate).** Year founded is an absolute qualifier — a user targeting "startups founded after 2018" doesn't want a 1995 company partially scoring. This also avoids any migration complexity and preserves the existing 100% weight invariant.

---

### 4. Barry AI Behavior

#### How Barry consumes ICP filters today

Barry reads the ICP profile at multiple points:

1. **`barryICPConversation.js`** — Conversational ICP configuration. Barry extracts 6 required fields from natural language: `industries`, `companySizes`, `locations`, `companyKeywords`, `lookalikeSeed`, `targetTitles`. Currently has no concept of `foundedYearRange`.

2. **`barryGenerateContext.js`** — Loads ICP profile from Firebase and assembles context for message generation. The ICP is passed to Claude as context.

3. **`barryGenerateMissionSequence.js`** — Uses ICP industry and `targetTitles` to calibrate sequence strategy.

4. **`barryMissionChat.js`** — References ICP when suggesting next steps.

#### Required changes for Barry to recognize `year_founded` as a valid constraint

**`barryICPConversation.js` (highest-impact change):**

The prompt at lines 520–600 lists 6 REQUIRED FIELDS. `foundedYearRange` needs to be added as an **optional** 7th field. It should NOT be required (blocking) — year founded is a signal, not a gating criterion for ICP completeness.

The prompt needs:
- Recognition of natural language signals: "startups", "early stage", "founded after X", "companies over Y years old", "established companies", "Series A/B", "post-IPO companies", etc.
- Mapping logic: "startups" → `{ min: 2018, max: null }`, "established" → `{ min: null, max: 2010 }`, "founded in the last 5 years" → `{ min: 2021, max: null }`
- The `understood` JSON schema in the prompt response needs a `foundedYearRange` field

**`barryGenerateContext.js`:**

When assembling the context string passed to Claude, `foundedYearRange` should be included if set:
```
Target companies: Founded between 2015 and 2022
```

This informs Barry's tone calibration (early-stage companies vs. mature enterprises have different buying dynamics, decision-making authority, and budget cycles).

**`barryContextAssembler.js`:**

When building the person/company context for outreach generation, `company_age_years` is already available on the company record. Barry should be able to reference company age as a contextual signal when generating messaging (e.g., noting the company is a "fast-growing 4-year-old startup" vs. a "25-year established firm").

**No other Barry functions require changes.** `barryEnrich.js`, `barryValidateContact.js`, and `barryOutreachMessage.js` do not consume ICP filters directly.

---

### 5. Search & Filtering Logic

#### Apollo API limitation (critical finding)

Apollo's company search API (`/mixed_companies/search`) does **not** expose a `founded_year` filter parameter. Reviewing `search-companies.js:485-533`, the query object supports:

- `q_organization_keyword_tags` (keywords)
- `organization_num_employees_ranges` (size)
- `organization_locations` (geography)
- `industry_tag_ids` (industry)

`founded_year` is **not** a supported filter on the Apollo search endpoint. It is returned in results but cannot be used as a pre-filter.

**Implication:** Year-founded filtering must be done **client-side (server-side post-processing)** after Apollo returns results. This is already the approach used for `fit_score` calculation.

**Impact on page size:** If `foundedYearRange` is restrictive (e.g., only companies founded 2018–2023), a 50-result Apollo page might yield only 10–20 post-filtered results. The search function must request more results per page and/or implement pagination logic to compensate.

**Affected functions:**
- `netlify/functions/search-companies.js` — add post-filter step after Apollo results are received, before `calculateFitScore()` is called. Specifically at line ~870 before the `simplifyAndScoreCompany()` call
- `netlify/functions/search-companies-manual.js` — same post-filter step needed for the manual search flow (TotalMarket)

#### Scout/Hunter flow impact

- **Daily Leads (DailyLeads.jsx):** Uses `search-companies` → transparent, no UI changes
- **Total Market (TotalMarket.jsx):** Uses `search-companies-manual` → needs `foundedYearRange` passed in query params
- **Hunter deck:** Contacts are sourced from already-saved companies, no direct filtering impact
- **Fit score display:** `fit_reasons` array (currently displayed in SavedCompanies, CompanyDetail, DailyLeads) should include year-founded match reason

#### Firestore indexes

No new Firestore indexes are required. Year-founded filtering occurs **before** data is written to Firestore (during the search ingest flow), not via Firestore queries. The existing company documents already store `founded_year` and `company_age_years` — if in-database filtering is ever needed, a composite index on `(founded_year, status)` would be required, but that is not part of this scope.

---

### 6. UI / UX Considerations

#### Placement on ICP Settings page

The `ICPSettings.jsx` page is structured as stacked `setting-section` cards. `foundedYearRange` should be placed **between Company Sizes and Locations** — it is a company characteristic filter, cohesive with size and revenue.

#### Input type

A **dual-handle year range** is the right UX:
- Min year input (e.g., "2015") and Max year input (e.g., "2023")
- Both optional — either bound can be left empty for open-ended filtering
- Reasonable range: 1900–current year
- Helper labels: "Older than X years" / "Newer than Y years" derived from the inputs
- A `skipFoundedYear` boolean toggle (analogous to `skipRevenue`) to explicitly disable the filter

**Example presets** (optional, high UX value):
- "Early Stage / Startup" → `{ min: currentYear - 7, max: null }` (founded within last 7 years)
- "Growth Stage" → `{ min: currentYear - 15, max: currentYear - 5 }` (5–15 years old)
- "Established" → `{ min: null, max: currentYear - 15 }` (15+ years old)

#### Visual alignment with existing filters

The existing filter sections use a `setting-section` card pattern with `section-header`, `section-description`, and a control element. The year-range control should follow this pattern using two `<input type="number">` fields styled as a range pair — consistent with the existing `weight-input` pattern in the scoring weights section.

The `summary-cards` row at the top of the page (line 385–417) currently shows Industries, Company Sizes, and Locations. A fourth card for "Founded" (showing "2015–2023" or "Any") should be added.

**Scoring weights UI:** If implementing as Option B (hard gate), no changes to the weights sliders are needed. If Option A (weighted dimension), a 5th slider is required and the total validation must be updated.

---

### 7. API & Backend Impact

#### Endpoints impacted

| Endpoint | File | Change Type |
|----------|------|-------------|
| `search-companies` (POST) | `netlify/functions/search-companies.js` | Add post-filter for `foundedYearRange` |
| `search-companies-manual` (POST) | `netlify/functions/search-companies-manual.js` | Same post-filter |
| ICP Save | `src/pages/Scout/ICPSettings.jsx` → Firestore `setDoc` | Add `foundedYearRange` to profile object |
| ICP Load | `src/pages/Scout/ICPSettings.jsx` → Firestore `getDoc` | Add default `foundedYearRange: null` |
| Barry ICP Conversation | `netlify/functions/barryICPConversation.js` | Prompt + schema update |
| Score recalculation | `src/pages/Scout/ICPSettings.jsx:120-150` | Add `foundedYearRange` to `calculateICPScore` call |
| `calculateICPScore` | `src/utils/icpScoring.js` | Add `foundedYearRange` dimension |

#### Versioning concerns

None. The ICP document is saved via `setDoc` (full overwrite) — no versioning layer. The `version` field in the schema is informational only. Adding `foundedYearRange: null` as a default means existing ICP documents remain valid — they simply don't have the field, which is treated as "not configured."

#### Backward compatibility

**Fully backward compatible.** The pattern used for `skipRevenue` is the template:
- If `foundedYearRange` is absent or null → filter is not applied → behavior identical to today
- Existing company scores are unaffected until the user saves ICP settings with a new range
- `recalculateAllScores()` at `ICPSettings.jsx:120-150` will re-score all companies on save, incorporating the new filter if set

---

### 8. Performance & Scalability

#### Query performance

Firestore is not used for year-founded filtering — this is post-processed in the Netlify function. No impact on Firestore read performance.

The post-filter runs after Apollo returns results (in-memory JavaScript array filter). With typical Apollo pages of 25–50 companies, this is negligible overhead (<1ms).

**The real performance concern is result density.** If `foundedYearRange` is set narrowly (e.g., 2–3 year window), Apollo may return mostly out-of-range results and the effective result count drops sharply. The search function should:
1. Increase the Apollo `per_page` request from 50 to `Math.min(100, requestedCount * 3)` when `foundedYearRange` is configured
2. Log the filter efficiency ratio (filtered / total) to monitor in production

#### Caching

No caching layer currently exists in the search pipeline — results are fetched from Apollo on demand and written to Firestore. No new caching is needed for this feature.

#### Scaling concern (future)

If the user base grows and searches are run against large Firestore company collections, a Firestore composite index on `(founded_year, status)` would enable efficient in-database filtering. This is not required now but should be noted for future architecture review.

---

## Phase 2: Validation Plan

### Data accuracy validation

1. **Sample audit:** Pull 50 randomly-selected company records from Firestore that have `founded_year` populated. Cross-reference 10 manually against LinkedIn / Crunchbase. Expected discrepancy: <5 years for well-known companies, potentially higher for small/local businesses.

2. **Coverage measurement:** Query Firestore for `count(companies where founded_year != null)` / `count(companies)` to establish a baseline coverage percentage per user. This informs how aggressively the filter can be applied.

3. **Apollo endpoint test:** Confirm that the search endpoint (`/mixed_companies/search`) returns `founded_year` in results at the current integration point. Verify with a controlled test: search for "Computer Software, California, 51-200 employees" and log the % of results that include `founded_year`.

### Barry behavior testing

1. **Natural language mapping test cases:**
   - "I want startups" → expect `foundedYearRange: { min: currentYear - 7, max: null }`
   - "Only established companies" → expect `foundedYearRange: { min: null, max: currentYear - 10 }`
   - "Founded after 2015" → expect `foundedYearRange: { min: 2015, max: null }`
   - "Series B companies" → expect `companyKeywords: ["series b"]` (this is a funding stage signal, not year-founded — Barry must distinguish them)
   - "Tech companies around 5 years old" → expect `foundedYearRange: { min: currentYear - 7, max: currentYear - 3 }`

2. **ICP context injection test:** Verify that when `foundedYearRange` is set, it appears in Barry's assembled context and influences messaging tone appropriately (early-stage vs. enterprise framing).

### Edge cases

| Scenario | Expected behavior |
|----------|------------------|
| `founded_year = null` for a company when filter is active | Company passes through; `fit_reasons` shows `⚠ Founded year unknown` |
| `foundedYearRange = { min: 2020, max: 2019 }` (inverted range) | Validation error on save: "Max year must be ≥ min year" |
| User sets `foundedYearRange` then sets `skipFoundedYear: true` | Filter disabled; range values preserved but not applied |
| Apollo returns `founded_year: 0` | Treat as null (invalid) — already handled by `company.founded_year \|\| null` pattern |
| User has `foundedYearRange` set but all Apollo results are null | All companies pass; log warning; surface in UI: "Founded year data unavailable for most results" |
| `foundedYearRange` is very narrow (e.g., 1 year) | Reduce effective result count; search function requests more Apollo results per page |
| Barry interprets "old companies" as founded-year filter AND `companyKeywords` | Barry should use only one mechanism; `foundedYearRange` takes priority over keyword-based stage signals |

---

## Phase 3: Build Plan

> **This section is presented for review only. No implementation until approved.**

### Proposed implementation approach

Seven discrete changes, in sequence:

#### Step 1: `src/utils/icpScoring.js`
Add `calculateFoundedYearMatch(companyFoundedYear, icpFoundedYearRange)` function.
**Logic:** Returns `100` if `founded_year` is within range (or range not set). Returns `0` if outside range. Returns `100` (pass-through) if `founded_year` is null (unknown company).
Update `calculateICPScore()` to call this function.
Update `getScoreBreakdown()` to include `foundedYear` dimension.
**Since this is a hard gate (Option B):** The weighted score calculation is unchanged — `foundedYearMatch` acts as a multiplier: `score * (foundedYearMatch === 0 ? 0 : 1)` when range is configured.

#### Step 2: `netlify/functions/search-companies.js`
Add post-filter step after Apollo results are retrieved (around line 870).
Add `foundedYearRange` to the `calculateFitScore()` call.
Add `foundedYearRange` to `generateFitReasons()` to surface match/mismatch/unknown in the `fit_reasons` array.
Increase `per_page` when `foundedYearRange` is configured.

#### Step 3: `netlify/functions/search-companies-manual.js`
Mirror Step 2 changes for the manual search flow.

#### Step 4: `src/pages/Scout/ICPSettings.jsx`
Add `foundedYearRange: null` to the default profile object.
Add `skipFoundedYear: false` to the default profile object.
Add state handlers: `handleFoundedYearChange(bound, value)` and `handleSkipFoundedYearToggle()`.
Add the new filter section UI (dual number inputs + optional presets + skip toggle).
Add a "Founded" summary card to the header row.
No changes to weight validation (Option B: hard gate).

#### Step 5: `netlify/functions/barryICPConversation.js`
Update the REQUIRED FIELDS section of the prompt: add `foundedYearRange` as an **optional** 7th field (not blocking).
Add natural language mapping rules for year/stage signals.
Update the `understood` JSON schema to include `foundedYearRange: { min, max } | null`.
Update `extractCompanyKeywords()` to avoid double-mapping stage signals to both `companyKeywords` and `foundedYearRange`.

#### Step 6: `netlify/functions/barryGenerateContext.js`
Add `foundedYearRange` to the assembled context string when set.

#### Step 7: Tests
Add unit tests for `calculateFoundedYearMatch()` covering: null company year, in-range, out-of-range, open min, open max, inverted range validation.
Add unit tests for Barry ICP conversation natural language mapping.

### Dependencies and sequencing

```
Step 1 (scoring) → Step 2 (search) → Step 3 (manual search)
                                    → Step 4 (UI)
Step 1           → Step 5 (Barry) → Step 6 (context)
Step 2-6         → Step 7 (tests)
```

Steps 1–4 can be built and tested independently of Steps 5–6 (Barry). They can be parallelized across two engineers.

### Rollout plan

**Feature flag recommended.**

Add `featureFlags.yearFoundedFilter: boolean` to user or global config. Default: `false`.

**Staged rollout:**
1. Internal only (team accounts): validate data coverage and Apollo result density
2. Beta users (opt-in): collect feedback on UX and Barry behavior
3. Full rollout: remove feature flag, publish to all users

The feature flag ensures that Barry prompt updates and UI changes are invisible to users until the full system is validated end-to-end.

### Estimated effort

| Step | Component | Effort |
|------|-----------|--------|
| 1 | `icpScoring.js` | 2h |
| 2 | `search-companies.js` | 3h |
| 3 | `search-companies-manual.js` | 1h |
| 4 | `ICPSettings.jsx` + CSS | 4h |
| 5 | `barryICPConversation.js` | 4h |
| 6 | `barryGenerateContext.js` | 1h |
| 7 | Tests | 3h |
| QA + staging validation | — | 4h |
| **Total** | | **~22h** |

---

## Key Decisions Requiring CTO Sign-Off

Before build begins, the following three decisions must be confirmed:

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| 1 | **Scoring approach** | A: 5th weighted dimension (requires weight migration) / B: Hard pass/fail gate | **B — hard gate** |
| 2 | **Null company behavior** | Pass through (don't penalize) / Exclude (treat as mismatch) | **Pass through** |
| 3 | **Barry field required?** | Required field (blocks ICP completion) / Optional field | **Optional** |

---

## Files Changed in Build (Reference)

```
src/utils/icpScoring.js                          — scoring logic
src/pages/Scout/ICPSettings.jsx                  — UI + save/load
src/pages/Scout/ICPSettings.css                  — styling
netlify/functions/search-companies.js            — search post-filter
netlify/functions/search-companies-manual.js     — manual search post-filter
netlify/functions/barryICPConversation.js        — Barry prompt update
netlify/functions/barryGenerateContext.js        — context assembly
```

No new files required. No database migrations required. No existing data at risk.
