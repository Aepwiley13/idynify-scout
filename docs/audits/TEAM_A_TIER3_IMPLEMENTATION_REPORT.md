# Team A — Tier 3: Targeting Reconciliation

**Branch:** `claude/team-a-tier3-targeting`, off verified Tier 1 (`aadd0d4`) — **not** off Tier 2
**Recommendation: TIER 3 VERIFIED**
Build EXIT 0 · **1263 passing** (from 1239) · same 5 known failures · lint identical to baseline.

*Does Scout actually search using the targeting intelligence associated with that ICP? Mostly yes — and the two places where it only appeared to are now fixed.*

---

## 0. Collision guard — clean

No Tier 2 file was touched. Tier 2 owns `icpScoring.js`, `ICPSettings.jsx`, `SavedCompanies.jsx`, `CompanyDetail.jsx`, `OnboardingFlow.jsx`, `MissionControlDashboardV2.jsx`, `MobileCompanyCard.jsx`, `barryMissionChat.js`. Tier 3 changed **three** files, none of them on that list. `calculateICPScore` and `icpScoring.js` are untouched.

**`passesAllFilters` (dead, in `icpScoring.js`) is classified below but deliberately not removed** — deleting it would enter a Tier 2 file for no functional gain.

Findings in Tier 2 files are read-only and reported here, not acted on.

---

## 1. RECON §3 field-level trace

**First, a naming correction.** The packet's field names do not exist in the repository. The live §3 ids in `Section3TargetMarketFirmographics.jsx` are:

| Packet name | Actual id | Line |
|---|---|---|
| `targetIndustries` | `targetIndustries` ✓ | `:71` |
| `targetCompanySize` | **`companySize`** | `:10` |
| `targetGeography` | **`geography`** | `:55` |
| `targetRevenue` | **`revenueRange`** | `:25` |
| `avoidIndustries` | `avoidIndustries` ✓ | `:92` |

(§3 also collects `growthStage`, `companyType`, `budgetRange`, `decisionSpeed`, `marketSize` — none of which the packet lists, and none of which reach search either.)

**Storage:** all of them land in `dashboards/{uid}.modules[recon].sections[sectionId:3].data`, plus a duplicate at `dashboards/{uid}.section3Answers` (`Section3…jsx:212`).

**Consumers:** `netlify/functions/utils/reconCompiler.js:59-66` renders §3 into a `TARGET MARKET:` block of Barry's prompt text. That is the only live consumer. (`src/utils/reconCompiler.js` has a parallel `extractTargetMarketContext` with **no importers** — dead.)

### Classification

| Field | Reaches | Classification | Evidence |
|---|---|---|---|
| `targetIndustries` | Barry prompt text only | **Contextual only** | Compiled by `reconCompiler.js:62`; `buildApolloQuery` never reads it. The ICP's own `industries` field is what reaches search |
| `companySize` | Barry prompt text only | **Contextual only** | Free text ("SMB", "mid-market"); the ICP's `companySizes` uses Apollo's bucket labels and is the field that constrains |
| `geography` | Barry prompt text only | **Contextual only** | Options are regions ("APAC", "Global"); the ICP's `locations` uses US state names, which is what `formatStatesForApollo` needs |
| `revenueRange` | Barry prompt text only | **Contextual only**, and its ICP counterpart is **dormant** — see §4 |
| `avoidIndustries` | Barry prompt text only | **Dormant / unconsumed** — see §5 | Collected in two disconnected places, enforced nowhere |

**No field was forced into Apollo.** RECON §3 is an acquisition method; the authoritative ICP is the source of truth for targeting, and these fields are shaped for conversation, not for query construction. Wiring them directly would make RECON a competing source of truth — exactly what the governing path forbids.

**Asserted by test:** `buildApolloQuery` contains none of the RECON field names, and `search-companies.js` never reads the `dashboards` document at all.

---

## 2. Supported retrieval path

Verified by executing the real `buildApolloQuery` against fixtures, not by reading it.

| ICP field | Apollo parameter | Status |
|---|---|---|
| `industries` | `q_organization_keyword_tags` | **WIRED** |
| `companyKeywords` | `q_organization_keyword_tags` | **WIRED** |
| `companySizes` | `organization_num_employees_ranges` | **WIRED** |
| `locations` | `organization_locations` | **WIRED** |
| `isNationwide` | `organization_locations: ["United States"]` | **WIRED** |
| `foundedAgeRange` | post-fetch `passesAgeFilter` | **WIRED** (Eligibility, §5) |
| `revenueRanges` | `revenue_range` | **DORMANT** — §4 |
| `lookalikeSeed` | — | **DORMANT** — reaches the function, logged, never becomes a parameter |
| `targetTitles` | — | **REMOVED, correctly** — this is `mixed_companies/search`; titles belong to people search. Already documented in-code |
| `avoidIndustries` | — | **DORMANT** — not an ICP field at all |

Tier 1 already routed every search caller through the authoritative ICP (`resolution.profile` from `icpProfiles`, never the bridge) with an explicit `icpId`. **Item 2 therefore required no new wiring** — every currently supported ICP field already reaches the query. What it did require was correcting two places where a search only *appeared* to be ICP-targeted.

### Correction 1 — the D7 gate counted a field that constrains nothing

`BarryOnboarding`'s `hasRetrievalConstraint` (added in Tier 1) counted `lookalikeSeed?.name` as a retrieval constraint. `buildApolloQuery` receives the seed and logs it, but the code explicitly declines to add the name to the keyword tags:

```js
// Don't add the actual company name, but log that we have a seed
```

So a confirmed ICP whose only targeting was a lookalike seed passed the gate and ran a **completely unfiltered global search while claiming to be ICP-targeted** — precisely what D7 forbids.

`lookalikeSeed` is removed from the gate; `isNationwide` is added, because it does produce a constraint. Proven by test: `buildApolloQuery({lookalikeSeed:{name:'Acme'}})` is byte-identical to `buildApolloQuery({})`.

> **Flagged: this amends Tier 1-verified behaviour.** The Tier 1 D7 test asserted "lookalike seed present → search runs"; it now asserts the opposite, with the reason recorded. Tier 1's own verification was correct about the gate's *existence* — this corrects its *contents*, which is Tier 3's remit. Easily reverted if you would rather it stay.

### Correction 2 — the questionnaire could attribute a search to the wrong ICP

`CompanyQuestionnaire` (Tier 1 W8, deferred debt) resolved the active ICP, then searched with `companyProfile: formData` and `icpId: resolution.icpId`. Identity from ICP A; criteria from a form ICP A does not hold. Companies were written tagged for A, discovered against something A never asked for — foreign results dropped into a real ICP's queue.

Neither available fix works: sending A's criteria ignores everything the user just typed, and sending the form's criteria mis-attributes them. So **the search is removed** and the deferred question — what this questionnaire creates — is left where Tier 1 put it. The answers are still saved. The unreachable request-building code was deleted rather than left behind a `return`.

Reachability note: `/onboarding/company-profile` is routed, but its only in-app entry point (`ScoutDashboardPage`) is itself unrouted — direct-URL only.

---

## 3. `getIndustryIds` disposition — **DEFERRED, do not restore**

**Evidence levels, kept separate as required.**

**Repository evidence (conclusive).** `getIndustryIds` exists twice — `search-companies.js:200` and `src/constants/apolloIndustries.js:168` — and **neither has a caller**. It was not abandoned in a refactor. It was **deliberately removed**, in commit `1ef9128` (2025-12-29), whose message records the reasoning:

> **CRITICAL FIX: Switch from industry tag IDs to keyword search**
> ROOT CAUSE IDENTIFIED:
> - Apollo API was ignoring `organization_industry_tag_ids` parameter
> - Industry tag IDs "5567cd4773696439b10b0000" didn't filter results
> - Apollo returned random companies (Maroc emploi, tech companies)
> - Apollo response doesn't include industry field at all

The diff replaced `query.organization_industry_tag_ids = getIndustryIds(...)` with `query.q_organization_keyword_tags = industries.map(lowercase)`.

**Apollo API support: UNVERIFIED.** I have not confirmed against current Apollo documentation whether `mixed_companies/search` accepts `organization_industry_tag_ids` today. I am not asserting it either way from memory.

**Empirical retrieval difference: UNVERIFIED.** No search was executed. The December 2025 observation ("random companies") was empirical *then*, on the same endpoint this integration still calls (`apolloConstants.js:33`), but it is 8 months old and I did not reproduce it.

**Disposition.** Restoring it would be Category 1 *in shape* — one parameter, existing endpoint, existing query model. It is deferred anyway, for three independent reasons:

1. The only empirical evidence available says the parameter **was ignored** on this exact endpoint. Reviving it would restore a filter that observably did not filter.
2. Switching free-text → structured industry IDs is a **materially different retrieval behaviour**, and v0.4 Part VI #17 explicitly defers *"whether `getIndustryIds` restoration changes Apollo retrieval behavior in ways that require user-facing explanation or recalibration of existing Match scores."* Restoring it unilaterally would answer a question the contract reserves.
3. Verifying it needs a live Apollo call against the paid API, which is outside this tier.

**Not revived merely because it exists.** To proceed later, the required evidence is one controlled A/B against `mixed_companies/search` — same profile, keyword tags vs industry tag IDs — plus current Apollo documentation for the parameter.

---

## 4. Revenue disposition — **DORMANT, documented as a targeting gap**

**Repository evidence (conclusive).** Commit `b6f397d` (2025-12-29 07:53) — *"Temporarily disable revenue filter to debug Invalid parameters error"*:

> Apollo API keeps returning 'Invalid parameters' error. Disabling `revenue_range` filter to isolate which parameter is causing the issue.
> Testing with: `organization_industry_tag_ids` ✓ · `organization_num_employees_ranges` ✓ · `organization_locations` ✓ · `revenue_range` ✗ (disabled)

It was a **bisection step in a debugging session that was never reverted** — the same day, ten hours later, `1ef9128` removed the industry tag IDs. The "temporary" disable has stood for eight months.

**Disposition: do not restore.** The only evidence available says Apollo rejected the request *with* `revenue_range` present, in the exact `{min, max}` shape the commented code builds. Re-enabling it on that evidence risks `Invalid parameters` on **every** Scout search. It is not demonstrably supported within the Tier 3 boundary, so per the tier instruction it is documented as a gap.

**Consequence to record:** ICP Settings offers eleven revenue ranges and stores them; they constrain nothing. Users can configure revenue targeting that has never affected a search. v0.4 Part VI #15 defers this. **Asserted by test:** a profile with `revenueRanges` produces a query byte-identical to an empty profile's.

---

## 5. Eligibility classification (D6 — Eligibility ≠ Match)

| Rule | Status | Evidence |
|---|---|---|
| `passesAgeFilter` | **LIVE, server-side** | `search-companies.js:14` (definition), `:388` (enforcement, post-fetch in the Apollo loop). Producer → Store → Consumer → Decision: ICP `foundedAgeRange` → filter → excluded companies never reach the client |
| `passesAllFilters` | **DEAD** | `icpScoring.js:431`, exported, **zero importers**. Contains the same founded-age logic. Not removed — it lives in a Tier 2 file |
| `avoidIndustries` | **DORMANT, and not authorized as new behaviour** | Collected twice — RECON §3 free text (`:92`) and `OnboardingFlow`'s smart questions, which writes it to `dashboards/{uid}.excludedIndustries` as a **top-level field** (`:406, :426`), a third location. It is not an ICP field, reaches no query, and is enforced nowhere |

**`avoidIndustries` classification: DEFER, not "enforce now".** Enforcing it needs three decisions this tier cannot make: whether it is Eligibility (a gate) or Match (a ranking penalty); where it lives authoritatively, given three disconnected homes today, none of them the ICP; and how exclusions become attributable per D6. It is a declared intent with no enforcement point, and the packet is explicit that it is not automatically authorized. **No new Eligibility rule was implemented.**

**Distinction verified by test:** `passesAgeFilter` returns only `true`/`false`, mentions no score/weight/match, never reads `fit_score`, and passes companies with an unknown `founded_year` rather than silently excluding them — a gate that fails open on missing evidence, which is correct for Eligibility.

---

## 6. Onboarding

**Verification only. Not redesigned, no questions added, no discovery experience built.**

| Path | Reaches the authoritative ICP? | Reaches search correctly? |
|---|---|---|
| `BarryOnboarding.handleConfirm` | **Yes** — creates/updates `icpProfiles/{icpId}`, projects to the bridge with `icpId` (Tier 1) | Yes, with explicit `icpId` — now gated on a *true* constraint set (§2) |
| `OnboardingFlow` smart questions | **No** — writes four answers to top-level `dashboards/{uid}` fields | Does not search. Contextual only |
| `CompanyQuestionnaire` | **No** — writes the bridge only (Tier 1 deferred debt) | No longer searches (§2) |

The collected intelligence that **does** reach search does so through the authoritative ICP. The intelligence that does not reach it is now honestly dormant rather than feeding a mis-attributed query.

---

## 7. Files changed

| File | Change |
|---|---|
| `src/pages/Onboarding/BarryOnboarding.jsx` | D7 gate: `lookalikeSeed` removed, `isNationwide` added |
| `src/components/scout/CompanyQuestionnaire.jsx` | mis-attributed search removed; dead request code deleted |
| `src/test/icpFirstSearchTargeting.test.js` | Tier 1 D7 cases updated for the corrected gate |
| `src/test/icpIdentityInvariants.test.js` | Tier 1 caller list updated — the questionnaire now declines by not searching |
| `src/test/reconTargetingReachability.test.js` | **added** — 23 tests |

No pre-implementation trace was required: both changes are local to one function each, with no callers beyond the file.

---

## 8. Debt

**Category 2 (schema/storage):** RECON §3 stored user-scoped when §3 is ICP-specific (D8) · `section3Answers` duplicates the modules array · `avoidIndustries` in three disconnected homes · `excludedIndustries` as a top-level dashboard field.

**Category 3 (new infrastructure):** structured industry targeting, if `getIndustryIds` is ever restored and needs a mapping/verification layer · revenue targeting, if Apollo needs a different request shape · an Eligibility enforcement point with attributable exclusions (D6).

**Category 4 (new capability):** `avoidIndustries` as a working exclusion · `lookalikeSeed` as a real retrieval constraint (it is collected, stored, displayed in Barry's messaging, and constrains nothing).

**Dead code, catalogued not removed:** `getIndustryIds` ×2 · `src/utils/reconCompiler.js` (no importers) · `icpScoring.js:passesAllFilters` (Tier 2 file) · `search-companies.js:calculateFitScore` + `enrichCompanyData` (accepted as dead in Tier 2; untouched per instruction) · `MissionControl.jsx` (unrouted).

**Nothing in any category was implemented.**

---

## 9. Tests and baseline

| | Tier 1 verified (`aadd0d4`) | Tier 3 |
|---|---|---|
| `npm run build` | EXIT 0 | **EXIT 0** |
| Tests | 1239 passed / 5 failed (1244) | **1263 passed / 5 failed (1268)** |
| `eslint src netlify` | 1224 problems (1142 errors, 82 warnings) | **1224 problems (1142 errors, 82 warnings)** |

+24 tests. Same 5 known failures. No new lint errors or warnings.

## Recommendation

**TIER 3 VERIFIED.** Every supported ICP field reaches Apollo through the authoritative path with explicit `icpId`; RECON §3 is classified honestly as contextual rather than forced into the query; `getIndustryIds` and revenue are deferred on documented repository evidence rather than revived because they exist; Eligibility stays a gate; and the two paths that let a search *claim* ICP targeting it did not have are closed.

**One item needs your ruling:** the D7 gate correction amends Tier 1-verified behaviour (§2, Correction 1). Holding for review — not merging.
