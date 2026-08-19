# Team A — Tier 1 Verification Gate Report

**Verified against:** `a727b54` (plus one added test file, `src/test/icpFirstSearchTargeting.test.js`).
**Recommendation: TIER 1 NEEDS CORRECTION** — two defects found, both bounded. Sections 1, 2, 4, 5, 6 and 7 PASS. Section 3 PASSES its stated invariant but exposes a rendering gap. No corrections applied in this pass.

| § | Subject | Result |
|---|---|---|
| 1 | ICP resolution invariant | **PASS** |
| 2 | ICP creation boundary | **PASS** |
| 3 | `NEEDS_TARGETING` state | **PASS with a reported gap** (V-2) |
| 4 | D7 first-search proof | **PASS** |
| 5 | Server boundary proof | **PASS** |
| 6 | Zero-ICP regression proof | **PASS** |
| 7 | Scope | **PASS** |
| — | Separate finding, outside the seven sections | **V-1, a regression this tier introduced** |

---

## 1. ICP resolution invariant — PASS

Evidence: `src/test/resolveActiveIcp.test.js` (13) and `src/test/icpIdentityInvariants.test.js` (33), all passing.

| Claim | Evidence |
|---|---|
| `no-profiles` is a valid zero-ICP state | Empty collection → `{unresolved, reason:'no-profiles', icpId:null, candidates:[]}`; resolves rather than throwing; the resolver never classifies severity — the calling operation decides |
| `none-active` is distinct | Profiles present, none carrying **both** `isActive:true` and `status:'active'` → `reason:'none-active'` with candidates returned. A half-flagged profile (`isActive:true, status:'pending'`) is asserted **not** active |
| `read-failed` is distinct | Throwing read → `reason:'read-failed'`, with an explicit assertion that it is never reported as `no-profiles` |
| No resolver maps any state to `DEFAULT_ICP_ID` | Both resolver modules assert no `DEFAULT_ICP_ID` and no `'default'` literal, with comments stripped first so a comment describing the old behaviour cannot satisfy the test. Runtime: every unresolved shape returns `icpId:null` and never serialises `"icpId":"default"` |
| Candidates never enter an ICP-dependent search without explicit selection | Audited every value passed as `icpId` to `search-companies`: `DailyLeads` ×3, `MissionControlDashboardV2`, `BarryICPPanel`, `CompanyQuestionnaire` all pass `resolution.icpId`, which exists only in the RESOLVED branch. `BarryOnboarding` passes the just-confirmed `icpId`. `daily-leads-refresh` passes `resolution.icpId` after a resolved check. **No call site passes `candidates[0]`, `icps[0]` or a continuity value.** In `DailyLeads`, `setActiveICPId(null)` is set explicitly in the `none-active` and `no-profiles` branches, so `activeICPId` can never hold a candidate |

Continuity rendering (`candidates[0]` in the `none-active` branch of DailyLeads / Mission Control V2 / ICP Settings) is display-only: it is not persisted, not written back, and not passed to any search.

## 2. ICP creation boundary — PASS

Every reachable write to `users/{uid}/icpProfiles/{id}`, enumerated (client and server, single- and multi-line forms):

| # | Site | Can it create? | Classification |
|---|---|---|---|
| 1 | `ICPSettings.jsx:139` `handleCreateICP` | **Yes** | **Permitted** — the existing explicit create action |
| 2 | `BarryOnboarding.jsx:370` (inside `handleConfirm`) | **Yes** | **Permitted** — the authorized targeting-confirmation event |
| 3 | `dashboardUtils.js:322` `batch.set(icpProfiles/default)` | **Yes** | **Permitted** — legacy migration promotion, reachable only when `hasPromotableCriteria` is true. Cannot run for a new account |
| 4 | `updateIcpFromChat.js:71` `setDoc(icpProfiles/{icpId})` | Only in a race | **Update-in-practice.** `icpId` comes from a RESOLVED resolution, so the document existed moments earlier. `setDoc` would re-create it only if the ICP were deleted between resolve and write. Not a violation; recorded |
| 5 | `DailyLeads.jsx:1101` `setDoc(..., {merge:true})` | Same race only | Same as #4 |
| 6 | `BarryICPPanel.jsx` `setDoc(..., {merge:true})` | Same race only | Same as #4 |
| 7 | `ICPSettings.jsx:229` `handleSaveChanges` | Same race only | Same as #4 — writes `selectedICPId`, which came from a loaded list |
| 8 | `ICPSettings.jsx:189` rename | **No** | `updateDoc` fails on a missing document |
| 9 | `Section9MessagingFlow.jsx:79` | **No** | `updateDoc` |
| 10 | `dashboardUtils.js:354` | **No** | `batch.update` |
| 11 | `adminUpdateUserICP.js:154` `icpRef.set(…, {merge:true})` | **No** | Guarded by an explicit `existingDoc.exists` check that 404s first |

**No unauthorized creation path exists.** Nothing was modified during this pass.

**`handleConfirm` creates only after explicit confirmation** — asserted by index, not by reading: every `'icpProfiles'` occurrence in `BarryOnboarding.jsx` lies **after** the start of `handleConfirm`, so no other path in that file can create one. Onboarding *completion* cannot create an ICP: `onboardingComplete`, `onboardingSource` and `barryState` are written in the same handler, downstream of the creation, and no other file writes `icpProfiles` in response to any onboarding flag. `OnboardingFlow.jsx` (the other onboarding route) writes no `icpProfiles` at all.

A `read-failed` resolution inside `handleConfirm` throws rather than creating, so a transient read failure cannot mint a duplicate ICP.

## 3. `NEEDS_TARGETING` — PASS on the invariant, with gap V-2

**Producer → state → consumers**

`BarryOnboarding.handleConfirm:424` writes `users/{uid}.barryState = 'NEEDS_TARGETING'` (persisted) when `hasRetrievalConstraint === false`. It is the only producer; the other producers write `SEARCHING` (`handleConfirm`, `MissionControlDashboardV2:361`) and `READY`/`ERROR` (`search-companies:504,562,645`).

**Every reachable consumer of `barryState`**

| Consumer | What it does with `NEEDS_TARGETING` |
|---|---|
| `useOnboardingState.js:153` | Stores it verbatim (`data.barryState ?? null`) via `onSnapshot`; no interpretation, no mapping |
| `OnboardingFlow.jsx:292` | Calls the hook but **never reads `barryState`** — only `markStep`, `isComplete`, `flags`, `currentStep`. Unaffected |
| `MissionControlDashboardV2:703 → 916` | Passes it to `FirstRunView`, gated on `isFirstRun` (`obComplete && onboardingSource==='barry_onboarding' && hasSeenMCWelcome===false`) — all three set by `handleConfirm`, so the state does reach the view |
| `FirstRunView:327–332` | `isSearching=false` (it is neither `'SEARCHING'` nor `null`), `isReady=false`, `isError=false`, `needsTargeting=true` |
| `FirstRunView:394–400` progress checklist | Renders *"Add an industry, location or company size to start finding companies"*, with `done:false`, `active:false`, **`error:false`** |

**Confirmed: no surface interprets it as `ERROR`, `READY` or `SEARCHING`.** Note `isSearching` deliberately includes `barryState === null` (not-yet-loaded); `NEEDS_TARGETING` is a real string and never collapses into it.

**Confirmed on meaning:** the state is written on exactly one condition — a valid ICP was created *and* `hasRetrievalConstraint` is false. It is never written for `no-profiles`, `none-active` or `read-failed`. Those three never reach `barryState` at all: they are carried on the resolution object, and in `handleConfirm` a `read-failed` throws before any state write while the other two lead to ICP creation. The state machine distinguishes the meanings cleanly.

**Gap V-2 — the state is distinguished but under-rendered.** `FirstRunView` has five other branches keyed to the old three booleans: the status line at `:442–444` and the panels at `:483`, `:505`, `:525`, `:543`, `:563`. None has a `needsTargeting` arm, so a user in this state gets a correct checklist line and an otherwise empty first-run body. This is a rendering gap, not a state-machine ambiguity, and it is one I introduced by adding the state. **Reported, not fixed** — per this pass's instruction not to redesign the state machine. Minimal correction: one status-line arm at `:444` and one small panel beside `:563`, routing to ICP Settings. No new state, no new producer.

## 4. D7 first-search proof — PASS

New: `src/test/icpFirstSearchTargeting.test.js`, 19 tests passing. It lifts the `hasRetrievalConstraint` predicate out of `BarryOnboarding.jsx` and evaluates it, so the gate cannot drift from the fields Apollo actually constrains on.

`confirmed targeting → created ICP identity → retrieval-constraint test → explicit icpId → search-companies`

| Case | Constraint test | Search |
|---|---|---|
| Industry present | true | **runs**, with the created `icpId` |
| Location present | true | **runs** |
| Company size present | true | **runs** |
| (also verified: company keywords · lookalike seed · founded-age range) | true | **runs** |
| Only unsupported/non-retrieval fields (`targetTitles` + `revenueRanges`) | **false** | **does not run** — `barryState:'NEEDS_TARGETING'` |
| Zero ICP | n/a | **cannot occur on this path** — asserted by index: the ICP write precedes the search block inside `handleConfirm`, so no search leaves this path without an identity |

Empty arrays are asserted not to count as constraints.

The gate is cross-checked against `buildApolloQuery`: `industries`, `companyKeywords`, `companySizes`, `locations` and `lookalikeSeed` each reach the query; revenue ranges are asserted still commented out; and `targetTitles` is asserted absent from `buildApolloQuery` entirely — it constrains a people search, not a company search.

**Confirmed: unsupported-only targeting does not execute an unfiltered Apollo company search.**

## 5. Server boundary proof — PASS

Every server function that applied `body.icpId || DEFAULT_ICP_ID` is accounted for. There were **four**, not one:

| Function | Before | After |
|---|---|---|
| `search-companies.js:993,1024` | `icpId \|\| DEFAULT_ICP_ID` stamped on every company row | `!icpId` → `400 ICP_REQUIRED`; no fallback remains; import removed |
| `barryGenerateSequenceStep.js:57` | `rawIcpId \|\| DEFAULT_ICP_ID` at handler top | `\|\| null`; import removed |
| `barryHunterGenerateStep.js:93` | `body.icpId \|\| DEFAULT_ICP_ID` | `\|\| null`; import removed |
| `barryHunterProcessEngage.js:244` | `body.icpId \|\| DEFAULT_ICP_ID` | `\|\| null`; import removed |

The last three ran *before* any guard, so client-side omission alone would have been silently re-fabricated there.

### Residual `DEFAULT_ICP_ID` inventory (complete, production code)

| Location | Classification |
|---|---|
| `src/utils/reconSectionMap.js:30` — the constant | **Non-identity constant use** — the definition itself |
| `netlify/functions/utils/reconSectionMap.js:6` — the constant | **Non-identity constant use** — server copy of the definition |
| `src/utils/dashboardUtils.js:7` import | **Authorized legacy migration** |
| `src/utils/dashboardUtils.js:276` `activeProfileId = DEFAULT_ICP_ID` initializer | **Authorized legacy migration** — reachable only inside the promotion branch |
| `src/utils/dashboardUtils.js:322,324` `batch.set(icpProfiles/default)` | **Authorized legacy migration** — gated by `hasPromotableCriteria`; unreachable for a new account |
| `barryContextStack.js:65` · `resolveActiveIcp.js:29` · `getActiveIcpId.js:15` · `daily-leads-refresh.js:138` · `search-companies.js:241` · `barryGenerateSequenceStep.js:57` | **Comments only** — each describes the removed behaviour. No code reference |

**Violations: none. Dead code: none. No unexplained reachable identity fallback remains.** The server copy of the constant (`netlify/functions/utils/reconSectionMap.js:6`) now has no importer in `netlify/functions/` — it is an exported constant with zero server consumers, left in place because deleting it is not verification work.

## 6. Zero-ICP regression proof — PASS

| Capability | Evidence |
|---|---|
| Hunter sequence / message generation | `barryGenerateSequenceStep`, `barryHunterGenerateStep`, `barryHunterProcessEngage` read the ICP doc only when an id was supplied (`icpId ? …get() : null`, `icpDoc?.exists`), asserted by test. This is load-bearing: `.doc(undefined)` throws, and that read shares a `try` with `compileReconForPrompt` — an unguarded omission would have cost these surfaces their **RECON** context as well |
| Relationship engagement / referrals / follow-up | The four Hunter clients send `...(activeIcpId ? {icpId} : {icpAttribution:'unresolved'})`, asserted by test; `getActiveIcpId` returns `null`, never a fabricated id |
| Meeting preparation | `barryFirstTouch` proceeds with `icpMessaging = null`, logging which of the three states occurred; asserted to throw nothing ICP-related |
| Inbox analysis | `barryInboxAnalyzer` receives no ICP context at all today and was not touched by this tier |
| Barry Mission Chat / relationship workflows | `barryContextStack` keeps the bridge criteria and drops only the false identity (`id:null`, `icpAttribution:'unverified-projection'`), asserted by test. Contacts, missions, RECON and user style are independent of ICP |

`barryMissionChat` and `barryInboxAnalyzer` were not modified by this tier.

## 7. Scope confirmation — PASS

No schema migration · no Firestore backfill · no Company × ICP Match persistence · no Coverage implementation · no RECON targeting implementation · no onboarding redesign · no Scout ICP-builder · no Tier 2/3/4 work. §9 untouched. The only files changed since `a727b54` are the one added test file in this pass.

---

## Remaining Tier 1 correctness blockers

### V-1 — Multi-ICP tab selection no longer reaches the search (regression introduced by this tier)

`DailyLeads` renders an ICP tab strip when a user has more than one non-pending ICP (`:2225`), and `handleICPSwitch` (`:1545`) re-filters and re-scores the queue for the tab clicked.

- **Before (`f3d78a5:1491,1804`):** `handleManualRefresh` and `triggerAdaptiveSearch` sent `icpId: activeICPId` — the ICP the user had selected.
- **After (`:1513,1828`):** both send `resolution.icpId` — the *active* ICP, regardless of the tab on screen.

A user viewing ICP B's queue who clicks "Find More Targets" now searches for ICP A and writes companies tagged `icpId: A`. Because the queue filters on `!c.icpId || c.icpId === activeId`, those results never appear in the tab they were requested from — the same class of invisible-results defect that issue #565 fixed.

This does not fabricate identity and does not violate the candidate rule: a clicked tab is an **explicit user selection**, not a silent fallback. It is a correctness regression in tab behaviour.

**Minimal correction** (not applied): in both functions prefer the explicitly selected ICP — `icpList.find(i => i.id === activeICPId)` when `activeICPId` is set — and fall back to the resolver otherwise. Both branches yield a real, identified ICP; neither introduces a candidate.

### V-2 — `NEEDS_TARGETING` renders an almost-empty first-run body

Described in §3. Correct on every invariant, incomplete on presentation.

### Noted, not a blocker

`HunterDashboard.jsx:200` and `MissionDetail.jsx:~295` also call `getActiveIcpId` and send `icpId: activeIcpId` unconditionally — two callers my original inventory missed (the enumerating grep was truncated at 60 lines). They now send `icpId: null`, which the hardened servers treat identically to an omitted id: the guarded read is skipped and generation proceeds. **No fabrication and no crash**, so not a violation — but they express the unresolved state as an explicit null rather than the `icpAttribution:'unresolved'` marker the other four use. Worth aligning whenever V-1 is corrected.

---

## Final baseline

| | Baseline `f3d78a5` | Now |
|---|---|---|
| `npm run build` | EXIT 0 | **EXIT 0** |
| Tests | 1143 passed / 5 failed (1148) | **1208 passed / 5 failed (1213)** |
| Test files | 53 passed / 2 failed | 56 passed / 2 failed |
| `eslint src netlify` | 1224 problems (1142 errors, 82 warnings) | **1224 problems (1142 errors, 82 warnings)** |

Same 5 pre-existing failures (`HunterContactCard` date-fns ×1; `ReconSectionEditor` `matchMedia` ×4). +65 tests over baseline, no new lint errors or warnings.

## Recommendation

**TIER 1 NEEDS CORRECTION.** The identity model verifies clean on all seven sections: the three states hold, no reachable fallback fabricates an id, the creation boundary is exactly the three permitted paths, D7 holds for all five cases, and zero-ICP relationship work is intact. Two bounded defects stand between here and TIER 1 VERIFIED — V-1, a real regression this tier introduced, and V-2, an incomplete rendering of the state it added. Both fixes are small and localised; neither touches the state machine, the resolver, or any creation path. Awaiting authorization to apply them.
