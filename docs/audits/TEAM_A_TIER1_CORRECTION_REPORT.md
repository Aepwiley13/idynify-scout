# Team A — Tier 1 Correction Pass (V-1, V-2)

**Base:** `1a8fb26` (verification pass) · **Recommendation: TIER 1 VERIFIED**

Both corrections applied and covered. Build EXIT 0 · **1239 passing** (from 1208) · the same 5 known failures · lint identical to baseline.

---

## Files changed

| File | Change |
|---|---|
| `src/pages/Scout/DailyLeads.jsx` | V-1 — `resolveSearchIcp` resolution order; `handleManualRefresh` and `triggerAdaptiveSearch` rerouted through it |
| `src/pages/Scout/MissionControlDashboardV2.jsx` | V-2 — heading arm and body panel for `NEEDS_TARGETING` |
| `src/test/icpTabSelectionSearch.test.js` | **added** — 14 tests |
| `src/test/needsTargetingPresentation.test.js` | **added** — 17 tests |

Nothing else. No resolver, no creation path, no predicate, no state, no server function.

---

## V-1 — explicit multi-ICP tab selection

### Before

`handleManualRefresh` and `triggerAdaptiveSearch` both called `resolveActiveIcp` and sent `resolution.icpId`. The resolver answers *which ICP is active* — not *which ICP the user is looking at*. With A active and the user on B's tab, a search fired from B was tagged `icpId: A`; the queue filter `!c.icpId || c.icpId === activeId` then hid those companies from B, the tab that requested them.

### After

One resolution order, in `resolveSearchIcp` (`DailyLeads.jsx:1502`), used by both paths:

1. **the ICP the user explicitly selected** — `activeICPId` when it matches a real profile in `icpList` → `source:'explicit-tab'`;
2. otherwise the **canonical resolver** → `source:'active-flag'`;
3. otherwise **nothing** — `{icpId:null, reason}`, and the caller declines to search.

No step 4. No `candidates[0]`, no `icps[0]`, no `DEFAULT_ICP_ID`.

The identity from that order is what reaches `search-companies`: `icpId: searchIcp.icpId` at `:1526` (manual refresh) and `:1873` (adaptive). Both guard on `!searchIcp.icpId` and return before fetching.

A stale tab id that matches nothing in `icpList` does **not** become an identity — it falls to step 2, because step 1 requires the id to resolve to a loaded profile.

**Selecting a tab does not activate anything.** `handleICPSwitch` sets local state and re-filters the queue; it performs no Firestore write and does not call `setActiveIcpProfile`. Which ICP is *active* still changes only in ICP Settings.

### Coverage — `src/test/icpTabSelectionSearch.test.js`, 14 passing

The resolution order is **lifted out of the source and executed**, so the tests exercise the real code path rather than a restatement of it:

| Scenario | Asserted |
|---|---|
| Active = A, user selects B | `icpId: 'icp_B'`, `source:'explicit-tab'` |
| — same | the profile sent is B's (`industries: ['Legal']`), not A's |
| Manual refresh from B | body carries `icpId: searchIcp.icpId`; no `resolution.icpId` remains |
| Adaptive search from B | same |
| B's results stay visible in B | the tab filter matches on the same id the search was tagged with |
| Tab switch ⇒ no global mutation | `handleICPSwitch` contains no `setDoc`/`updateDoc`/`writeBatch`/`setActiveIcpProfile` |
| No tab selected | falls to the resolver, not to a candidate |
| Stale tab id | falls to the resolver |
| No tab + each of `no-profiles` / `none-active` / `read-failed` | `icpId` null and the exact reason survives |
| Candidates exist but none active | still `icpId: null` — never `candidates[0]` |
| Both paths | decline to search when no identity results |
| The order itself | contains no `candidates[0]`, `icps[0]` or `DEFAULT_ICP_ID` |

### `HunterDashboard` / `MissionDetail`

**Left as-is, documented.** Aligning them to `icpAttribution:'unresolved'` is not consistency-only: both build a single flat request body and neither currently imports the attribution convention, so the change would alter two request shapes and their server-side reads for no behavioural gain. They send `icpId: null`, which the hardened servers treat exactly as an omitted id — the guarded read is skipped and generation proceeds. No fabrication, no crash. Recorded for a later pass rather than expanded into this one.

---

## V-2 — `NEEDS_TARGETING` presentation

### Before

The state was correct everywhere and rendered almost nowhere. `FirstRunView` keyed its heading (`:442–444`) and all five panels to `isSearching` / `isReady` / `isError`, none of which is true for `NEEDS_TARGETING`. The user got one correct checklist line and an otherwise empty first-run body.

### After

Two additions, both presentation only:

**Heading arm** (`:445`) — *"Barry has your ICP — it needs one more detail to search"*. Names the ICP as existing; says nothing about failure.

**Body panel** (`:602`) — deliberately composed as the calm sibling of the ERROR panel, not a variant of it:

- `Target` icon in the accent colour — **no** `AlertCircle`, **no** red;
- *"Your ICP is saved. Scout needs at least one thing it can search on — an industry, a location, or a company size — before it can go and find companies."*;
- a second line explaining that job titles help pick people once companies are found but cannot narrow the search itself — the actual reason this state exists;
- **Add Targeting Detail** → the existing ICP Settings path (`activeTab: 'icp-settings'`), and **Review ICP with Barry** → the existing `/onboarding/barry` route. No `handleRetry`, because nothing failed.

The four facts required are each carried: the ICP is identified; the search did not fail; the ICP lacks a usable retrieval constraint; the next action is the existing targeting path.

### Untouched, as required

Producer (`BarryOnboarding.jsx:424`), the persisted value, the state machine, the canonical resolver, every ICP creation path, `hasRetrievalConstraint`, and all search behaviour. No new Barry state: the full set of `barryState` comparisons in Mission Control is asserted to be exactly `{SEARCHING, READY, ERROR, NEEDS_TARGETING}`.

### Coverage — `src/test/needsTargetingPresentation.test.js`, 17 passing

Distinctness: `needsTargeting` derives from its own value; `isError`/`isReady`/`isSearching` keep their own predicates; `NEEDS_TARGETING` never appears in a shared `||`; and the three resolution reasons are asserted never to reach `barryState` at all — so `NEEDS_TARGETING` cannot stand in for `no-profiles`, `none-active` or `read-failed`.

Status line: has its own arm; the heading mentions the ICP and contains no *problem/failed/error*; the checklist's `error` flag stays bound to `isError`.

Body: the panel exists; states the ICP is saved; names industry, location and company size; explains the titles case; contains no `AlertCircle`, no red token, no *"Try Again"*, no `handleRetry`; routes to `activeTab: 'icp-settings'`.

---

## Residual `DEFAULT_ICP_ID` inventory

Unchanged by this pass — no new reachable fallback was introduced.

| Location | Classification |
|---|---|
| `src/utils/reconSectionMap.js:30` · `netlify/functions/utils/reconSectionMap.js:6` | **Non-identity constant use** — the definitions |
| `src/utils/dashboardUtils.js:7,276,322,324` | **Authorized legacy migration** — gated by `hasPromotableCriteria`, unreachable for a new account |
| `barryContextStack.js:65` · `resolveActiveIcp.js:29` · `getActiveIcpId.js:15` · `daily-leads-refresh.js:138` · `search-companies.js:241` · `barryGenerateSequenceStep.js:57` | **Comments only** |

**Violations: none. Dead code: none.** The new resolution order is asserted to contain no default fallback; both corrected search paths pass an identity that came from step 1 or step 2 or refuse to run.

---

## Build, tests, lint

| | Verification pass | Now |
|---|---|---|
| `npm run build` | EXIT 0 | **EXIT 0** |
| Tests | 1208 passed / 5 failed (1213) | **1239 passed / 5 failed (1244)** |
| Test files | 56 passed / 2 failed | 58 passed / 2 failed |
| `eslint src netlify` | 1224 problems (1142 errors, 82 warnings) | **1224 problems (1142 errors, 82 warnings)** |

+31 tests. The 5 failures are the same known ones — `HunterContactCard` (date-fns) ×1 and `ReconSectionEditor` (`matchMedia` in jsdom) ×4. No new lint errors or warnings. Against the original `f3d78a5` baseline: **+96 tests**, identical lint.

## Scope

No Tier 2/3/4 work. The resolver, every ICP creation path, `hasRetrievalConstraint`, Match, Coverage and RECON targeting are untouched. No new Barry state. §9 untouched.

## Recommendation

**TIER 1 VERIFIED.** V-1 restores explicit tab selection to both search paths under a resolution order with no implicit step, and V-2 gives the state a presentation that matches its meaning. Both are covered by tests that execute or inspect the real code rather than restate it. Holding for review; Tier 2 not started.
