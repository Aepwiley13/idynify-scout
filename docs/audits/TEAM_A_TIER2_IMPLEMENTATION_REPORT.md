# Team A — Tier 2: Match Correctness

**Branch:** `claude/team-a-tier2-match`, off verified Tier 1 (`aadd0d4`)
**Recommendation: TIER 2 VERIFIED**
Build EXIT 0 · **1264 passing** (from 1208) · same 5 known failures · lint identical to baseline.

*Can Barry truthfully say how well this company matches this ICP, and how complete is the evidence? He can now — and where he cannot, he says so instead of guessing.*

---

## 0. Cross-tier collision check — no collision

Run before touching either tier, per the `calculateICPScore` gate.

**Neither tier needs `calculateICPScore` modified.** Tier 2 reuses it exactly as-is (the packet requires the existing scorer and forbids a new rescoring abstraction); Tier 3 does not score at all. `calculateICPScore` is **unchanged** in this tier — verified by test.

Two dead-code findings removed the collision that looked most likely:

- **`search-companies.js:calculateFitScore` is unreachable.** Its only caller would be `enrichCompanyData` (`:1105`), which **has no callers**. v0.4 §2 lists the client/server "scoring divergence" as a Known Defect; by the Reachability Standard it is not live, and `search-companies` never writes `fit_score`. Tier 2 therefore has no reason to enter Tier 3's main file. **Reported to Team B as a v0.4 evidence correction.**
- **`getIndustryIds` is dead in both copies** (`search-companies.js:200`, `src/constants/apolloIndustries.js:168` — only `APOLLO_INDUSTRIES` is imported anywhere). That is Tier 3 evidence, recorded here only because the check surfaced it.

**Ownership map, zero file overlap:**

| Tier 2 owns | Tier 3 owns |
|---|---|
| `icpScoring.js`, `ICPSettings.jsx`, `SavedCompanies.jsx`, `CompanyDetail.jsx`, `OnboardingFlow.jsx`, `MissionControlDashboardV2.jsx`, `MobileCompanyCard.jsx`, `barryMissionChat.js` | `search-companies.js`, `apolloIndustries.js`, RECON §3 read paths |

If Tier 3 finds it must touch `icpScoring.js` (e.g. to remove the dead `passesAllFilters`), that is a collision and stops for report.

---

## 1. Pre-implementation trace — `recalculateAllScores`

The one change with non-local blast radius.

**Reachable callers: exactly one.** `ICPSettings.handleSaveChanges:239`, gated on `profile.scoringWeights`. No other caller anywhere in `src/` or `netlify/`.

**What it did.** Iterated *every* company in `users/{uid}/companies` — not the ones belonging to the ICP being saved — and overwrote `fit_score`, `fit_reasons` and `fit_reason` using the just-saved profile. It never touched `icpId`. So after saving ICP B, a company discovered under ICP A carried `icpId: A` with a score computed against B. Cross-ICP contamination, persisted, invisible.

**Blast radius of removal.** Every surface reading persisted `fit_score`: Saved Companies, Company Detail, Onboarding step 5, Mission Control V2 (list, filters, KPI, badges, mobile card). All are addressed in §3. `DailyLeads` already derived on demand and is unaffected. `MissionControl.jsx` reads persisted scores heavily but is **unrouted** — imported nowhere in `App.jsx`, never rendered — so it is dead and deliberately untouched.

**Smallest Category 1 correction: retire the persistence, do not patch it.** Making it safe would require knowing which ICP each stored score belongs to — a Company × ICP persistence schema, Category 2 and explicitly unauthorized. Deriving on demand is what every corrected surface now does, so the stored value has no remaining reader. The function is deleted, with a comment in its place recording why and what debt it leaves.

---

## 2. Files changed

| File | Change |
|---|---|
| `src/utils/icpScoring.js` | **+`computeCoverage`** export. `calculateICPScore` untouched |
| `src/pages/Scout/ICPSettings.jsx` | `recalculateAllScores` removed; its call site removed; scorer imports dropped |
| `src/pages/Scout/SavedCompanies.jsx` | Match derived against the resolved ICP; unattributed state; sort and card display |
| `src/pages/Scout/CompanyDetail.jsx` | Match derived against the resolved ICP; unattributed preview text |
| `src/pages/Onboarding/OnboardingFlow.jsx` | fresh-data branch removed; Match always derived; `FitBadge` unattributed state |
| `src/pages/Scout/MissionControlDashboardV2.jsx` | no stored fallback; score-band filters, high-fit KPI, `FitBadge`, dossier and first-run card |
| `src/components/mission-control/MobileCompanyCard.jsx` | unattributed state instead of `0 · Low Fit` |
| `netlify/functions/barryMissionChat.js` | swipe block relabelled User Judgment, explicitly not Match |
| `src/test/matchCoverageAttribution.test.js` | **added** — 25 tests |

---

## 3. Before/after Match reachability

| Surface | Before | After |
|---|---|---|
| **ICP Settings save** | ICP write → `recalculateAllScores` → **every** company's `fit_score` overwritten with the saved ICP → all readers | ICP write → **no company write at all** |
| **Saved Companies** | `companies/*.fit_score` → sort (`:145`) and card (`:493`) → user reads it as current | `resolveActiveIcp` → `calculateICPScore(company, resolvedIcp)` → sort/card. Unresolved → `fit_score: null`, a "No active ICP — Match can't be scored right now" row, and saved order preserved |
| **Company Detail** | `company.fit_score` → `Math.round(… \|\| 0)` → "N% fit" in the preview banner | `resolveActiveIcp` → derived per view. Unresolved → *"no active ICP to score fit against"* |
| **Onboarding step 5** | `hasFreshData` (record < 24h old) → **trust `c.fit_score`**; else derive from the bridge profile | freshness branch deleted; always derived against the resolved ICP; unresolved → null and a "no ICP" badge |
| **Mission Control V2** | derived when a profile existed, else `c.fit_score \|\| c.icpScore \|\| 0` | derived when resolved, else `null`. Bands exclude unattributed rows, high-fit KPI ignores them, badges render `—` |

**Record freshness said nothing about ICP attribution.** A company discovered an hour ago under ICP A is "fresh" and its stored score is still A's — so the onboarding branch could show A's Match as B's precisely when the data looked most trustworthy. That branch is gone.

---

## 4. Proof Company × ICP attribution cannot cross identities

`src/test/matchCoverageAttribution.test.js`, 25 passing:

- **The same company scores differently against two ICPs** — Match's subject is the pair, demonstrated rather than asserted. A company with no ICP has no Match.
- **`recalculateAllScores` no longer exists**, and `handleSaveChanges` (comments stripped, so the memorial note cannot satisfy the test) touches no `'companies'` collection and no `fit_score`.
- **No surface writes `fit_score` to Firestore** — asserted across all five candidate files against both `updateDoc` and `setDoc`. In-memory derivation inside a `.map` is fine; a write is what carried the contamination.
- **The server discovery writer never stamps a Match either** — `saveCompaniesToFirestore` contains no `fit_score`.
- **Every consumer resolves an ICP first**, and none retains the `c.fit_score || c.icpScore` fallback.
- **Unattributed is null, never zero**, at each of the four surfaces; sorting uses `?? -1` so nulls sort last rather than ranking as 0; band filters exclude them; badges render an explicit marker.

The structural guarantee: there is no longer any stored Match for a surface to mis-attribute. Every score shown is computed, at display time, against an ICP whose identity the canonical resolver just returned.

---

## 5. Coverage derivation contract

```js
computeCoverage(company, icpProfile) → {
  relevant: string[],   // dimensions this ICP configures — the ones that bear on the Match
  observed: string[],   // of those, the ones the company had data for
  unknown:  string[],   // of those, the ones that defaulted to UNKNOWN instead of being evaluated
  complete: boolean,    // relevant.length > 0 && unknown.length === 0
}
```

Derived entirely from the existing `evaluateDimensions` output — no additional data collection, no second evaluation pass, no new scoring. A dimension the ICP does not configure appears in **none** of the three lists: it is not missing evidence, it is not part of this Match.

**Boundaries held, each asserted by test:** not a percentage (no `percentage` or `score` key); not persisted anywhere; `calculateICPScore` does not consult it; no blended metric; no thresholds and no Coverage UI — no presentation was actively misleading, so none was built.

The demonstrative test: two companies produce different Coverage against the same ICP while Match is untouched — a Match of 85 with four dimensions observed and one with three unknown are different claims, and Coverage is what tells them apart.

---

## 6. User Judgment

| | User Judgment | Match |
|---|---|---|
| Field | `barryFeedback.score` | `fit_score` (now derived, not stored) |
| Scale | 1–10 | 0–100 |
| Source | the user | computed |

**No stored field was renamed** — that would require migration.

**Audit result: no active display collision exists.** `barryFeedback.score` is written on swipe (`DailyLeads:1618`, `:2021`) and is **never rendered anywhere in the UI**. Its only consumer is `barryMissionChat`'s swipe-intelligence block. And no computed Match reaches any Barry prompt — `fit_score` appears in none of `barryMissionChat.js`, `barryContextAssembler.js`, `barryStrategyRecommender.js` (asserted by test), so the two have never co-occurred in a prompt.

The one change made is prompt-layer labelling: the block is now headed **"SCOUT SWIPE INTELLIGENCE — USER JUDGMENT, NOT COMPUTED MATCH"** and states that these are the user's own 1–10 ratings, a different intelligence type from the 0–100 Match, never to be compared or averaged together. Cheap insurance for the day something does put both in one prompt.

Frozen Document 2's `icp_score` / `barryFeedback.score` contradiction remains governance debt. **Not modified.**

---

## 7. Residual persisted-Match debt (Category 2, deferred)

| # | Debt | State |
|---|---|---|
| D2-1 | Stored `fit_score` / `fit_reasons` / `fit_reason` on `users/{uid}/companies/*` | Values written by the old `recalculateAllScores` remain in Firestore with no reliable ICP attribution. **Nothing reads them as authoritative any more.** A migration must decide whether to clear or re-attribute them; that needs the Company × ICP model, which is Not Decided (v0.4 Part VI #5) |
| D2-2 | Company × ICP persisted Match schema | Not built. Required before Match can be persisted at all |
| D2-3 | Coverage persistence and display | Not built (v0.4 Part VI #6, #7) |
| D2-4 | `barryFeedback.score` field name | A Match-adjacent name for User Judgment. Renaming is migration |
| D2-5 | Frozen Doc 2 `icp_score` | Governance debt, unchanged |
| D2-6 | Dead scoring code | `search-companies.js:calculateFitScore` + `enrichCompanyData` (unreachable), `MissionControl.jsx` (unrouted), `icpScoring.js:passesAllFilters` (no importers). **Not deleted** — removal is Tier 3's call for the ones in its files, and none of it runs |

**Category 3 / 4: none performed.** No new service, no new storage model, no new intelligence type.

---

## 8. Tests and baseline

| | Tier 1 verified (`aadd0d4`) | Tier 2 |
|---|---|---|
| `npm run build` | EXIT 0 | **EXIT 0** |
| Tests | 1239 passed / 5 failed (1244) | **1264 passed / 5 failed (1269)** |
| `eslint src netlify` | 1224 problems (1142 errors, 82 warnings) | **1224 problems (1142 errors, 82 warnings)** |

+25 tests. Same 5 known failures (`HunterContactCard` date-fns ×1; `ReconSectionEditor` `matchMedia` ×4). No new lint errors or warnings.

## 9. Scope

No Company × ICP persistence · no schema migration · no backfill · no Coverage persistence, blending, thresholds or UI · no stored field renamed · frozen documents untouched · no Tier 3 file touched · no Tier 4 work.

## Recommendation

**TIER 2 VERIFIED.** Match is derived Company × ICP intelligence at every live surface, cross-ICP persistence is retired rather than patched, Coverage is computable on demand and structurally separate from Match, and User Judgment cannot be read as Match in the one place both could meet. Holding for review.
