# Team A — Phase 1B Tier 1 Implementation Report

**Branch:** `claude/team-a-nz6kaz` · **Baseline:** `f3d78a5`
**Scope:** the 13 authorized items. Nothing else.
**Result:** build EXIT 0 · 1189 tests passing (was 1143) · the same 5 pre-existing failures · lint unchanged at the baseline count.

---

## 1. Files changed

**Added (4)**

| File | Purpose |
|---|---|
| `src/utils/resolveActiveIcp.js` | Canonical resolution contract, client |
| `netlify/functions/utils/resolveActiveIcp.js` | Canonical resolution contract, server |
| `src/test/resolveActiveIcp.test.js` | 13 contract tests |
| `src/test/icpIdentityInvariants.test.js` | 33 invariant tests |

**Modified (24)** — `+668 / −248`

`src/utils/`: `getActiveIcpId.js` · `updateIcpFromChat.js` · `barryContextStack.js` · `dashboardUtils.js` · `setActiveIcpProfile.js`
`src/pages/`: `Scout/DailyLeads.jsx` · `Scout/MissionControlDashboardV2.jsx` · `Scout/ICPSettings.jsx` · `Scout/ICPSettings.css` · `Onboarding/BarryOnboarding.jsx`
`src/components/`: `scout/BarryICPPanel.jsx` · `scout/CompanyQuestionnaire.jsx` · `dashboard/BarryChatPanel.jsx` · `hunter/SequencePanel.jsx` · `hunter/QuickMissionAssignModal.jsx` · `hunter/HunterContactDrawer.jsx` · `hunter/MissionCard.jsx`
`netlify/functions/`: `search-companies.js` · `daily-leads-refresh.js` · `adminUpdateUserICP.js` · `barryFirstTouch.js` · `barryGenerateSequenceStep.js` · `barryHunterGenerateStep.js` · `barryHunterProcessEngage.js`

---

## 2. Before/after reachability per change

Every row is Producer → Store/derived object → Consumer → Decision.

### Item 1 — Canonical resolver

| | Path |
|---|---|
| **Before** | Nine mechanisms → four tiebreaks → `'default'` \| `icps[0]` \| bridge-as-ICP → callers → decisions taken against a fabricated or disputed identity |
| **After** | `icpProfiles` → `resolveActiveIcp` → `{resolved \| unresolved+reason}` → caller → the **operation** decides whether the state blocks it |

### Item 2 — Rerouting

| Mechanism | Before | After |
|---|---|---|
| `getActiveIcpId.js:18` | `snap.empty ? DEFAULT_ICP_ID : id`; `catch → DEFAULT_ICP_ID` | resolver → `icpId` or **`null`**; marked transition path with a named end state |
| `barryContextStack.js:75` | bridge doc returned as `{ id: DEFAULT_ICP_ID, …}` — fabricated identity into every Barry prompt | resolved → real profile; unresolved → bridge criteria kept, returned `{ id: null, icpAttribution:'unverified-projection', icpUnresolvedReason }` |
| `DailyLeads.jsx:1379,1398` | `find(active) \|\| icps[0]`, re-derived twice | one resolver call; `icpId` only when resolved; candidate render only for `none-active` |
| `MissionControlDashboardV2.jsx:756` | `find(active) \|\| icps[0]` | same |
| `ICPSettings.jsx:91` | `find(active) \|\| icps[0]` | same, plus a visible notice for `none-active` / `read-failed` |
| `barryFirstTouch.js:90` | inline server query, `icpSnap.empty → null` silently | server resolver; logs which of the three states, then continues |

### Item 4 — `updateIcpFromChat`

| | Path |
|---|---|
| **Before** | chat delta → **bridge write first** (`:47`) → then `icpProfiles` lookup → empty ⇒ `setDoc(icpProfiles/default)` — an undeclared create — → bridge again |
| **After** | chat delta → resolver → **resolved:** `icpProfiles/{icpId}` (authoritative) → bridge projection carrying `icpId` → panel updates. **Unresolved:** no write at all → `{status:'unresolved', reason}` → `BarryChatPanel` gives a different answer per reason |

Bootstrap path **B3 is gone**: there is no longer any code path that creates an ICP because a lookup failed.

### Item 5 — `icpId` on identity-holding bridge writes

| Writer | After |
|---|---|
| `setActiveIcpProfile.js:35` | `icpId: targetIcpId`, `icpIdSource:'active-selection'` |
| `dashboardUtils.js:343` | `icpId: activeProfileId`, `icpIdSource:'multi-icp-migration'` |
| `ICPSettings.jsx:229` | `icpId: selectedICPId`, `icpIdSource:'icp-settings-save'` |
| `adminUpdateUserICP.js:170` | `icpId`, `icpIdSource:'admin-update'` |
| `BarryICPPanel` / `IcpReclarificationModal` | now write `icpProfiles` **first**, then project with `icpId` — their refinements previously lived only in the bridge and were silently reverted by the next activation |

### Item 6 — `adminUpdateUserICP`

**Before:** `allProfiles[0].id === icpId` — the *oldest* profile gated the bridge sync, so editing an inactive ICP overwrote the active ICP's projection.
**After:** `isResolved(r) && r.icpId === icpId` — only the *active* ICP's edit projects; unresolved logs the reason and skips.

### Item 7 — B2 migration guard

| Sub-case | Before | After |
|---|---|---|
| Nothing to promote (**every new account** — `dashboardSchema.json` stamps neither migration flag, so this ran for all of them) | `icpProfiles/default` written from `{}`, stamped `isActive:true` — an ICP invented before the user said anything | **Creates nothing.** Stamps `migratedMultiICP` and returns. Workspace sits at zero ICPs, which is valid |
| Real criteria in the bridge, no `icpProfiles` (legacy) | promotion | **Unchanged**, documented in-code as legacy transition debt with its end state |

Gate: `hasPromotableCriteria` — industries, sizes, locations, titles, keywords or a lookalike seed.

### Item 8 — B1 guard + reachable create action

**Before:** opening ICP Settings with an empty collection silently wrote `icp_${Date.now()}` with **no `isActive` and no `status`** — a profile the canonical query could never find. The `handleCreateICP` control existed but rendered *below* the `if (!profile)` early return, so it was unreachable in exactly that state.
**After:** no write on load. The empty state renders the existing `handleCreateICP` action. Path: user click → `icpProfiles/{icp_…}` → `Section9MessagingFlow` → `setActiveIcpProfile` → resolver sees it.

### Item 9 — Onboarding as the authorized confirmation event

```
user reviews Barry's proposal → handleConfirm()
  → resolver
      read-failed → throw (a transient failure must not mint a duplicate ICP)
      resolved    → write through to the existing icpProfiles/{icpId}
      otherwise   → create icpProfiles/icp_{ts} (isActive, active) → setActiveIcpProfile
  → bridge projection { …criteria, icpId, icpIdSource:'barry_onboarding_confirmed' }
  → search-companies { icpId }  → companies stamped with that icpId → queue shows them
```
Only the targeting fields already assembled at `handleConfirm` become ICP criteria. Nothing else collected during onboarding is reinterpreted.

**D7 limitation, reported not invented.** `targetTitles` do not constrain a company search and revenue ranges are not sent to Apollo, so a confirmed definition carrying only those would be an unfiltered global query wearing an ICP label. `hasRetrievalConstraint` (industries · keywords · sizes · locations · lookalike seed · founded-age) gates the search. When it is false the ICP is still created — the user did confirm it — but no search runs and `barryState` is `NEEDS_TARGETING`, which Mission Control renders as *"Add an industry, location or company size to start finding companies"* rather than the previous fall-through to "Search failed". **No fields were invented to fill the gap.**

### Items 10–11 — The search boundary

| Caller | Before | After |
|---|---|---|
| `MissionControlDashboardV2.jsx:366` | bridge read, no `icpId` | resolver; unresolved → no search + explanation on the CTA |
| `BarryICPPanel.jsx:207` | no `icpId` | resolver; unresolved → no search + in-panel notice |
| `BarryOnboarding.jsx:376` | no `icpId` | the confirmed `icpId` |
| `CompanyQuestionnaire.jsx:213` | no `icpId` | resolver; unresolved → no search |
| `daily-leads-refresh.js:216` | bridge read for all users, no `icpId` | per-user resolve; resolved only |
| `DailyLeads` ×3 | 2 carried `icpId`, 1 read the bridge | all three resolve first |
| **`search-companies.js`** | `icpId \|\| DEFAULT_ICP_ID` stamped onto **every** company row | `!icpId` → `400 ICP_REQUIRED`; the writer has no fallback left, and the import is gone |

**Also found and fixed during implementation:** `barryGenerateSequenceStep.js:57`, `barryHunterGenerateStep.js:93` and `barryHunterProcessEngage.js:244` each ran `const icpId = body.icpId || DEFAULT_ICP_ID` at the top of the handler — *before* any guard. Omitting `icpId` client-side would have been silently re-fabricated there. All three now keep an absent identity absent.

### Item 12 — Scheduled refresh

**Before:** read every user's bridge over REST → `refreshUserQueue` with no `icpId` → every company written under a fabricated `'default'`.
**After:** `resolveActiveIcpViaRest` per user (REST mirror of the contract, same three reasons, 404 ⇒ `no-profiles` and any other bad status ⇒ `read-failed`) → unresolved: `results.skipped++`, `skippedReasons[reason]++`, log, `continue` → resolved: authoritative profile + `icpId` through to the search. The job never fails because a user has no ICP.

### Item 13 — Zero-ICP is not an error

| Surface | Behaviour with zero ICPs |
|---|---|
| DailyLeads | Queue renders a targeting explanation with a route to ICP Settings — no fabricated ICP, no scoring against a profile that does not exist |
| Mission Control V2 | Company list renders; not scored against an invented ICP |
| ICP Settings | Empty state with the reachable create action |
| Hunter step/sequence/engage, First Touch, Mission chat, inbox, meeting prep | **Untouched** — see §6 |

---

## 3. Tests for the three states

`src/test/resolveActiveIcp.test.js` — 13 passing:

- **`no-profiles`** — reported when the collection is empty; `icpId` null; `candidates` empty; resolves cleanly rather than throwing (it is a valid state).
- **`none-active`** — reported when profiles exist but none carries both `isActive` and `status:'active'`; candidates returned **without** one being chosen; ordered oldest-first, with ISO strings and Firestore Timestamps ordered by the same rule.
- **`read-failed`** — reported when the read throws, with an explicit assertion that it is **never** reported as `no-profiles`.
- Plus: a half-flagged profile is not active; `no-user` short-circuits before touching Firestore; each reason yields a distinct explanation.

`src/test/icpIdentityInvariants.test.js` — 33 passing, covering §4–§8 below.

---

## 4. Proof: no code converts unresolved identity to `DEFAULT_ICP_ID`

- Both resolvers contain no `DEFAULT_ICP_ID` and no `'default'` literal (asserted with comments stripped, so a comment naming the old behaviour cannot satisfy the test).
- `search-companies.js` has no `icpId || DEFAULT_ICP_ID` and no longer imports it.
- All six rerouted callers use the resolver and reference no default id.
- The three surfaces that silently promoted `icps[0]` no longer contain that pattern.
- The three Hunter server functions assert `not.toMatch(/DEFAULT_ICP_ID/)`.
- Runtime: every unresolved shape returns `icpId: null` and never serialises `"icpId":"default"`.

**One deliberate remaining use, disclosed:** `dashboardUtils.js:276,322,324` still writes `icpProfiles/default` in the **legacy promotion sub-case only** — the transition path you approved. It never runs for a new account. `reconSectionMap.js` keeps the constant for it.

## 5. Proof: onboarding creates an ICP only after explicit confirmation

Asserted by index, not by eye: every `'icpProfiles'` occurrence in `BarryOnboarding.jsx` appears **after** the start of `handleConfirm`, so no other code path in that file can create one. Plus: the authoritative write precedes the projection; the projection carries `icpId, icpIdSource:'barry_onboarding_confirmed'`; `read-failed` throws instead of creating a duplicate; the search call carries `icpId`; and the search is gated on `hasRetrievalConstraint`.

## 6. Proof: zero-ICP relationship workflows still operate

- The three Hunter server functions read the ICP doc **only** when an id was supplied (`icpId ? …get() : null`, `icpDoc?.exists`). This mattered: `.doc(undefined)` throws, and that read sits inside the same `try` as `compileReconForPrompt` — an unguarded omission would have cost these surfaces their **RECON** context too, not just their ICP messaging.
- The four Hunter clients send `...(activeIcpId ? { icpId } : { icpAttribution: 'unresolved' })`.
- `getActiveIcpId` returns null, never a fabricated id.
- `barryFirstTouch` proceeds with `icpMessaging = null` and throws nothing ICP-related.
- `barryContextStack` keeps the bridge criteria and drops only the false identity.

Engaging an existing network, referrals, inbox intelligence, meeting prep and follow-up are unaffected by this tier.

## 7. Proof: the first search after confirmed onboarding carries the new identity

`handleConfirm` creates `icpProfiles/{icpId}` → activates it → projects it → calls `search-companies` with that `icpId` → `saveCompaniesToFirestore` stamps `icpId` (no fallback) → the queue filter `!c.icpId || c.icpId === activeId` matches the ICP the resolver now returns. Asserted at both ends: the search body carries `icpId`, and the writer has no default left to substitute.

## 8. Proof: the scheduled refresh skips without failing

Asserted: it resolves through `resolveActiveIcpViaRest(projectId, user.userId)`; `resolution.status !== 'resolved'` → `continue` (the loop proceeds to the next user); `skippedReasons[resolution.reason]` is recorded; 404 maps to `no-profiles` while other failures map to `read-failed`; and the resolved `icpId` is passed through to `refreshUserQueue`. The job's own `results` payload now reports `skipped` and `skippedReasons` alongside `refreshed` and `failed`.

---

## 9. Confirmation of what did **not** happen

- **No schema migration.** No stored field renamed, no document restructured, no storage path moved.
- **No backfill.** No existing bridge document, ICP profile or company row was rewritten. Existing `icpId:'default'` company rows and identity-less bridge documents remain exactly as they were — Category 2 debt.
- **No new intelligence infrastructure.** The only new modules are the two resolvers required by the tier item itself. No unified assembler, no Company × ICP persistence, no Coverage, no Mission object.
- **No onboarding redesign, no Scout ICP-builder, no new ICP creation mechanism.** `handleConfirm` and `handleCreateICP` are the existing interactions; one was authorized, the other was made reachable.
- **No Tier 2/3/4 work.** Match display, Coverage, RECON targeting and composition are untouched.
- **§9 Buying Signals not touched.**

**One deferred item worth naming for Tier 2:** with zero ICPs, `MissionControlDashboardV2` falls back to persisted `fit_score` for display. That is unattributed Match display — Tier 2 Item 6 — and was deliberately left alone. Tier 1 only stopped the fabrication of ICP *identity*.

---

## 10. Build and test results vs baseline

| | Baseline (`f3d78a5`) | After Tier 1 |
|---|---|---|
| `npm run build` | EXIT 0 | **EXIT 0** |
| Test files | 53 passed / 2 failed (55) | 55 passed / 2 failed (57) |
| Tests | 1143 passed / 5 failed (1148) | **1189 passed / 5 failed (1194)** |
| `eslint src netlify` | 1224 problems (1142 errors) | **1224 problems (1142 errors)** |

The 5 failures are the same pre-existing ones, unrelated to ICP identity: `HunterContactCard` (date-fns label) and four `ReconSectionEditor` tests failing inside `window.matchMedia` at `ReconSectionEditor.jsx:119` (jsdom environment gap).

+46 tests, no new lint errors. (Lint is not green at baseline — 1142 pre-existing errors, mostly `process is not defined` in netlify functions linted with browser globals. Tier 1 added none and removed none.)

*Note: `npm ci` requires `--force` in this environment — an android/arm-only optional dependency fails the platform check.*
