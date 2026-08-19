# Team A — Tier 2 + Tier 3 Merged Baseline

**Recommendation: TIERS 2+3 MERGED / READY FOR TIER 4**
Build EXIT 0 · **1288 passing** · the same 5 known failures · lint identical to baseline · **zero conflicts**.

---

## 1. Merge commits

| Commit | Merge |
|---|---|
| `f185110` | Merge Tier 2 — Match Correctness (verified) |
| `db8e3d0` | Merge Tier 3 — Targeting Reconciliation (verified) onto the Tier 2 result |

Merged into `claude/team-a-nz6kaz` at verified Tier 1 (`aadd0d4`), in the authorized order, each with `--no-ff` so both tiers keep a distinct, revertible merge commit.

## 2. Conflict inventory

**NONE.**

Neither merge produced a conflict of any kind — no content conflicts, no add/add, no rename/delete. Both applied cleanly with the `ort` strategy. **No conflict resolution was performed, so no semantic choice was made during merging.**

That was the designed outcome, not luck: the tiers were kept to disjoint file sets from the start, and the one shared risk — `calculateICPScore` — was ruled out by the collision check before either tier began.

The only files either tier touched in common with the other: **none.** Tier 2's eight source files and Tier 3's two source files do not intersect. Both tiers edited files under `src/test/`, but different ones.

## 3. Files changed relative to verified Tier 1

16 files, +1065 / −188.

**Tier 2 (8 source + 1 test):** `icpScoring.js` · `ICPSettings.jsx` · `SavedCompanies.jsx` · `CompanyDetail.jsx` · `OnboardingFlow.jsx` · `MissionControlDashboardV2.jsx` · `MobileCompanyCard.jsx` · `barryMissionChat.js` · `matchCoverageAttribution.test.js` (new)

**Tier 3 (2 source + 3 test):** `BarryOnboarding.jsx` · `CompanyQuestionnaire.jsx` · `reconTargetingReachability.test.js` (new) · `icpFirstSearchTargeting.test.js` · `icpIdentityInvariants.test.js`

**Docs:** the two tier reports.

## 4. Combined invariant verification

All eleven, checked against the **merged** tree — not inherited from the pre-merge runs.

| # | Invariant | Result | Evidence |
|---|---|---|---|
| 1 | Match always derived against the resolved ICP on the corrected surfaces | **PASS** | All four surfaces resolve first; none retains a `c.fit_score \|\| c.icpScore` fallback; no surface writes `fit_score` to Firestore |
| 2 | Coverage separate from Match, not persisted, not blended | **PASS** | `calculateICPScore` does not reference Coverage; no `percentage`/`score` key; no consumer persists it |
| 3 | User Judgment independent from Match | **PASS** | `fit_score` reaches none of the three prompt assemblers; the swipe block is labelled User Judgment |
| 4 | `recalculateAllScores` retired | **PASS** | Zero occurrences of `recalculateAllScores(` in `ICPSettings.jsx` |
| 5 | `calculateICPScore` unchanged | **PASS** | `git diff aadd0d4 -- src/utils/icpScoring.js` contains **0 deleted lines** — the file is purely additive (`computeCoverage` only). The merge did not prove otherwise |
| 6 | `lookalikeSeed` does not satisfy the first-search gate | **PASS** | Absent from `hasRetrievalConstraint` on the merged tree; `buildApolloQuery({lookalikeSeed})` equals the empty-profile query |
| 7 | `isNationwide` does satisfy the gate | **PASS** | Present in the gate; produces `organization_locations: ["United States"]` |
| 8 | `CompanyQuestionnaire` cannot initiate the removed search | **PASS** | Zero occurrences of `search-companies` in the file |
| 9 | RECON §3 does not feed `buildApolloQuery` | **PASS** | Zero occurrences of `targetIndustries`, `avoidIndustries` or `dashboards` in `search-companies.js` |
| 10 | No new `DEFAULT_ICP_ID` fallback or fabricated attribution | **PASS** | No `\|\| DEFAULT_ICP_ID` and no `icpId \|\| 'default'` anywhere in `src/` or `netlify/` outside tests. Residual uses remain exactly the authorized legacy-migration path plus comments |
| 11 | No Category 2/3/4 work entered through merge resolution | **PASS** | There was no resolution to enter through — zero conflicts, zero manual edits during merge |

**Targeted suite run on the merged tree:** the nine ICP/Match/targeting suites — `matchCoverageAttribution`, `reconTargetingReachability`, `icpFirstSearchTargeting`, `icpIdentityInvariants`, `resolveActiveIcp`, `icpTabSelectionSearch`, `needsTargetingPresentation`, `dailyDiscoveriesIcpTargeting`, `icpScoring` — **177 tests, all passing.**

The cross-tier check that mattered most: Tier 2's assertions read `OnboardingFlow`, `SavedCompanies`, `CompanyDetail`, `MissionControlDashboardV2`, `ICPSettings`, `DailyLeads`, `search-companies` and `barryMissionChat`; Tier 3's read `BarryOnboarding`, `CompanyQuestionnaire`, `search-companies` and `reconCompiler`. Both sets pass against the merged files, so neither tier's guarantees were weakened by the other's edits.

## 5. Build, tests, lint

| | Verified Tier 1 | Tier 2 alone | Tier 3 alone | **Merged** |
|---|---|---|---|---|
| Build | EXIT 0 | EXIT 0 | EXIT 0 | **EXIT 0** |
| Passing | 1239 | 1264 | 1263 | **1288** |
| Failing | 5 | 5 | 5 | **5** |
| Total | 1244 | 1269 | 1268 | **1293** |
| Lint | 1224 (1142 err, 82 warn) | 1224 (1142/82) | 1224 (1142/82) | **1224 (1142 err, 82 warn)** |

**1288 = 1264 + 1263 − 1239.** Exactly additive: every test each tier added survives the merge, and none was lost or duplicated.

**The five failures are the same five known ones, and the only ones:**

- `HunterContactCard.test.jsx` — "shows last interaction label from date-fns" (1)
- `ReconSectionEditor.test.jsx` — 4 tests failing inside `window.matchMedia` at `ReconSectionEditor.jsx:119` (jsdom environment gap)

Both predate Tier 1 and are unrelated to ICP identity, Match or targeting. Lint is byte-identical to the original `f3d78a5` baseline: **no new errors or warnings across all three tiers.**

## 6. Confirmation

- **Conflict resolution introduced no new behaviour** — there was no conflict to resolve. Nothing was hand-edited during either merge; both merge commits contain only the tiers' own changes.
- **No Category 2/3/4 work entered.** No schema migration, no backfill, no Company × ICP persistence, no Coverage persistence, no new intelligence infrastructure, no RECON wiring, no revived dead targeting code.
- **No Tier 4 work.** Composition invariant, unified assembler and Barry surface classification are untouched.

## Recommendation

**TIERS 2+3 MERGED / READY FOR TIER 4.**

The merged baseline holds every Tier 1, Tier 2 and Tier 3 invariant simultaneously, verified on the merged tree rather than inherited. Awaiting explicit authorization before any Tier 4 work begins.
