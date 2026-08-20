# Team A — Phase 1B, Tier 1 Pre-Implementation Trace

**Status:** **ACCEPTED — IMPLEMENTATION ON HOLD.** No implementation changes have been made.
Rulings recorded in §9. Tier 1 implementation is gated on Team B's final Barry Intelligence Contract.
**Branch:** `claude/team-a-nz6kaz`
**Baseline commit:** `f3d78a5` (identical to `origin/main` at time of writing)
**Date:** 2026-08-18

---

## 0. Gate status and one blocking exception

| Required confirmation | Status |
|---|---|
| 1. Convergence Decision Packet v1.0 received and understood | Confirmed |
| 2. Barry Intelligence Contract v0.3.1 read in full before this trace | **NOT SATISFIED — see below** |
| 3. Trace returned before any implementation change | Confirmed — no source file has been modified |
| 4. Phase 1B Authorization List clear | Confirmed |
| 5. Phase 1B scope boundaries clear | Confirmed |
| 6. Tier dependency order understood | Confirmed (T1 → T2 ∥ T3; T4 only after T1 + v0.4 approval) |
| 7. No current branch contains unauthorized architecture work | Confirmed — `claude/team-a-nz6kaz` is at parity with `origin/main`, zero diff |
| 8. Ready to begin | Confirmed, subject to the blocker below |

### Blocker: v0.3.1 is not in the repository

`docs/barry-os/barry-intelligence-contract-v0.3.1` does not exist. Verified:

- `find . -iname "*intelligence*contract*"` — no results
- `grep -ril "intelligence contract" --include=*.md --include=*.html .` — no results
- `git log --all --name-only` across every branch and every commit ever made — the only contract-named artifacts are
  `docs/adr/ADR-004-navigation-contract.md`, `docs/barry-os/architecture/BARRY_OS_CAPABILITY_CONTRACTS.md`,
  `docs/shell-migration/PHASE7_BARRY_CONTEXT_CONTRACT.md`, `netlify/functions/utils/scoutContactContract.js`
- `docs/barry-os/` contains only `BARRY_OS_DECISION_LOG.md` and `architecture/` (Docs 1–5)

This trace was therefore built from **repository evidence only**, plus the semantic definitions
restated inside the Convergence Decision Packet itself. Every proposal in §4–§7 below is marked
with the specific point where a v0.3.1 semantic could overturn it. **The contract must be supplied
(committed to the repo, or pasted) before Tier 1 implementation begins**, per the packet's own
pre-work requirement.

### Baseline build and test state (before any change)

```
npm ci --force   → EXIT 0   (plain `npm ci` fails on an android/arm-only optional dep; --force is the workaround)
npm run build    → EXIT 0   ✓ built in 19.23s
npx vitest run   → EXIT 1   55 files: 53 passed / 2 failed;  1148 tests: 1143 passed / 5 failed
```

Pre-existing failures, unrelated to ICP identity, recorded so Tier 1 is not blamed for them:

- `src/test/HunterContactCard.test.jsx` — "shows last interaction label from date-fns" (1 test)
- `src/test/ReconSectionEditor.test.jsx` — 4 tests, all failing inside `window.matchMedia` at
  `src/pages/Recon/ReconSectionEditor.jsx:119` (jsdom environment gap, not product logic)

Tier 1's acceptance bar is: build stays at EXIT 0, and the failure set stays exactly these 5 tests.

---

## 1. Evidence inventory — how "active ICP" is resolved today

Nine distinct resolution mechanisms are live. Four distinct fallback tiebreaks exist between them.

| # | Mechanism | Location | Query | Fallback when nothing is active | Tiebreak class |
|---|---|---|---|---|---|
| M1 | `getActiveIcpId(userId)` | `src/utils/getActiveIcpId.js:10` | `isActive==true && status=='active'`, limit 1 | returns string `'default'` (`DEFAULT_ICP_ID`) — also on any thrown error | **A — silent string default** |
| M2 | `getActiveMessagingProfile(userId)` | `src/utils/barryContextStack.js:63` | same | reads `companyProfile/current` and returns it **labelled `id: 'default'`** | **B — bridge doc relabelled as an ICP** |
| M3 | `loadTodayLeads` | `src/pages/Scout/DailyLeads.jsx:1379`, re-derived again at `:1398` | `icps.find(isActive && status==='active')` | `|| icps[0]` after `sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''))` | **C — first-by-createdAt-string** |
| M4 | `loadCompanies` | `src/pages/Scout/MissionControlDashboardV2.jsx:756` | same | `|| icps[0]`, same sort | C |
| M5 | `loadICPProfiles` | `src/pages/Scout/ICPSettings.jsx:91` | same | `|| icps[0]`, same sort; **and creates a profile if the collection is empty** (§7) | C |
| M6 | `updateIcpFromChat` | `src/utils/updateIcpFromChat.js:52` | same | `doc(icpProfiles,'default')` — a `setDoc` to a possibly non-existent doc, i.e. **creates** it | A (+ implicit create) |
| M7 | Multi-ICP migration | `src/utils/dashboardUtils.js:265–320` | reads all profiles, `find(p=>p.isActive===true)` | if none: promotes **oldest by `createdAt` Timestamp**; if collection empty: creates `icpProfiles/default` from the bridge | **D — oldest-by-Timestamp promotion** |
| M8 | `barryFirstTouch` | `netlify/functions/barryFirstTouch.js:90` | server-side `isActive==true && status=='active'`, limit 1 | none — `icpMessaging = null`, Barry silently loses ICP messaging | none (fails closed, but silently) |
| M9 | **Implicit** — "the bridge *is* the active ICP" | 13 read sites (§3 table) | n/a | n/a — the bridge is read as if it were durable ICP state | n/a |

### Why this is not merely untidy — three confirmed live consequences

1. **M1 → dead ICP context in Hunter.** `getActiveIcpId` returns `'default'` when nothing is active.
   Its four callers (`SequencePanel.jsx:108`, `QuickMissionAssignModal.jsx:126`,
   `HunterContactDrawer.jsx:765`, `MissionCard.jsx:222`) pass that id to
   `barryGenerateSequenceStep`/`barryHunterGenerateStep`/`barryHunterProcessEngage`, which do
   `icpProfiles.doc(icpId).get()` and then `icpDoc.exists ? …messaging : null`
   (`netlify/functions/barryGenerateSequenceStep.js:130–132`). A user whose real profile is
   `icp_1734…` gets `icpProfiles/default` → not found → **Barry generates outreach with no ICP
   messaging and no error surfaced anywhere.**
2. **M5 creates profiles that M1 can never find.** `ICPSettings.loadICPProfiles`
   (`src/pages/Scout/ICPSettings.jsx:66–88`) bootstraps `icp_${Date.now()}` from the bridge and
   writes **no `isActive` and no `status` field**. M3/M4/M5 still show it (their `|| icps[0]`
   fallback), so the platform looks correct — while M1/M2/M6/M8 all fall through to `'default'`.
   The two halves of the platform disagree about which ICP is active, permanently, with no error.
3. **M2 returns a bridge document wearing an ICP's identity.** `id: DEFAULT_ICP_ID` is attached to
   a document that has no ICP identity at all. Any consumer downstream of `barryContextStack`
   receives a fabricated attribution. This is the exact pattern the packet forbids: *"Missing ICP
   identity must never be silently interpreted as intentional use of a default ICP."*

---

## 2. Item 1 — One canonical active-ICP resolution contract

### 2.1 Proposed contract

New file: **`src/utils/resolveActiveIcp.js`** (client) and **`netlify/functions/utils/resolveActiveIcp.js`** (server).
This is the *only* new module Tier 1 creates; it is required by the tier item itself, so it is
inside the "no new abstractions beyond what the canonical contract requires" boundary.

```js
// Resolution states — the only two outcomes. There is no third, implicit one.
export const ICP_RESOLVED   = 'resolved';
export const ICP_UNRESOLVED = 'unresolved';

/**
 * The single function every caller uses to answer "which ICP is active?".
 *
 * @returns {Promise<IcpResolution>}
 *   RESOLVED   → { status:'resolved',   icpId:string, profile:object, source:'active-flag' }
 *   UNRESOLVED → { status:'unresolved', icpId:null,   profile:null,
 *                  reason:'no-profiles'|'none-active'|'read-failed'|'no-user',
 *                  candidates:[{id,name,createdAt}]   // never empty for 'none-active'
 *                }
 *
 * Invariants:
 *  - It NEVER returns DEFAULT_ICP_ID, or any other id, as a stand-in for an absent selection.
 *  - It NEVER reads companyProfile/current. The bridge is a projection; it is not an identity source.
 *  - A thrown/failed read resolves to UNRESOLVED reason:'read-failed' — failure is not emptiness,
 *    and emptiness is not a default (consistent with the existing P0A/defect-A6 rule already
 *    documented in src/utils/barryContextStack.js).
 */
export async function resolveActiveIcp(userId) { … }
```

`candidates` is the mechanism that keeps legitimate operational behaviour alive (§2.3) **without**
letting any surface convert "none active" into "this one is active".

### 2.2 Per-caller before → after

| Caller | Before | After | Risk |
|---|---|---|---|
| `src/utils/getActiveIcpId.js:10` | returns `'default'` on empty/error | **Kept as a named transition path**, reimplemented over `resolveActiveIcp`: returns `icpId` when RESOLVED, `null` when UNRESOLVED. Deprecation note + documented end state: deleted when its 4 callers move to the resolution object. | **Highest.** Return type changes `string → string\|null`. All 4 call sites must handle null before this lands (below). |
| `src/components/hunter/SequencePanel.jsx:106–150` | `icpId: activeIcpId` (always a string) | resolve first; when UNRESOLVED omit `icpId` from the request body and pass an explicit `icpAttribution:'unresolved'` | Server already tolerates a missing profile (`icpDoc.exists ? … : null`) — behaviour is *identical to today* minus the false attribution |
| `src/components/hunter/QuickMissionAssignModal.jsx:124–161` | same | same | same |
| `src/components/hunter/HunterContactDrawer.jsx:763–801` | same | same | same |
| `src/components/hunter/MissionCard.jsx:220–234` | same | same | same |
| `src/utils/barryContextStack.js:59–80` | falls back to bridge doc, relabels it `id:'default'` | resolve; when RESOLVED return the `icpProfiles` doc. When UNRESOLVED **still return the bridge content if it exists**, but as `{ id:null, icpAttribution:'unverified-projection', …data }` — Barry keeps the criteria, loses the false identity | Prompt-visible only; consumers reading `.id` must tolerate null (audited: none dereference it today) |
| `src/pages/Scout/DailyLeads.jsx:1379,1398` | `|| icps[0]` | resolve once; RESOLVED → use it. UNRESOLVED with candidates → use `candidates[0]` **and** set `icpAttribution:'unresolved-fallback'` on the view state (§2.3), no silent promotion, no write-back | Medium — this is the main queue surface; the `!c.icpId \|\| c.icpId === activeId` company filter must keep behaving identically |
| `src/pages/Scout/MissionControlDashboardV2.jsx:756` | `|| icps[0]` | same | same |
| `src/pages/Scout/ICPSettings.jsx:91` | `|| icps[0]` | same, plus bootstrap guard (§5) | Medium |
| `src/utils/updateIcpFromChat.js:52–64` | falls back to `icpProfiles/default` and creates it | resolve; UNRESOLVED → **do not write**, return a recoverable error to the caller (`BarryChatPanel`) instead of inventing an ICP | Behaviour change on an edge path — see Open Question Q2 |
| `netlify/functions/barryFirstTouch.js:90` | inline server query, no fallback | server `resolveActiveIcp`; UNRESOLVED logs an explicit attribution warning instead of silently nulling messaging | Low |
| `src/utils/dashboardUtils.js:265–320` | migration's own promotion logic | **Left as-is and explicitly classified as a transition path.** It is a one-shot migration stamped by `migratedMultiICP`; rewriting it mid-flight risks re-running or double-stamping on live users. Documented end state: removed once the migration is confirmed complete for all users (Category 2 verification). | Deliberately untouched |

### 2.3 Legitimate operational dependencies on today's silent default — must not be broken

Surfaced as the item requires, before changing behaviour:

1. **`ICPSettings` must always render something.** If it rendered "unresolved" and nothing else, a
   user with profiles but none flagged active would have no way to *activate* one — the page is the
   only remedy for the condition. → Keep rendering `candidates[0]`, labelled as not-yet-active,
   with the existing "Set Active" control as the resolution path.
2. **`DailyLeads` / `MissionControlDashboardV2` must keep showing a queue.** M5's bootstrap
   (`isActive` absent) means an unknown number of real, live users currently sit in the
   "profiles exist, none active" state and are working normally *because* of `|| icps[0]`.
   Hard-failing them to an empty state would be a regression caused by a correctness fix.
   → Same treatment: render `candidates[0]`, mark the attribution as unresolved, never write it back.
3. **Hunter surfaces must keep generating steps.** They already degrade to null ICP messaging when
   `icpProfiles/default` is missing; the change only stops them *claiming* the default ICP.
4. **`barryContextStack` must keep feeding Barry the user's criteria** during the pre-migration
   window. → Bridge content retained, identity claim dropped.

**Nothing above requires an ICP to be invented. In every case the platform stays functional and the
absence becomes visible instead of being papered over.**

### 2.4 Blast radius

- 11 files changed for Item 1 (10 call sites + 1 new module ×2 runtimes).
- No Firestore write-shape change from Item 1 alone.
- New unit tests: `src/test/resolveActiveIcp.test.js` — RESOLVED, none-active-with-candidates,
  no-profiles, read-failed, and an explicit assertion that `DEFAULT_ICP_ID` is never returned.
- `src/test/dailyDiscoveriesIcpTargeting.test.js` asserts source text of DailyLeads
  (`icpId={activeICPId}`) — it must keep passing; the variable name is therefore preserved.

---

## 3. Item 2 — `icpId` on new bridge writes

### 3.1 Every writer to `users/{uid}/companyProfile/current`

| # | Writer | Line | Reads `icpProfiles` first? | icpId available? | Planned after state |
|---|---|---|---|---|---|
| W1 | `setActiveIcpProfile` | `src/utils/setActiveIcpProfile.js:35` | Yes | Yes — `targetIcpId` | add `icpId: targetIcpId`, `icpIdSource:'active-selection'` |
| W2 | Multi-ICP migration | `src/utils/dashboardUtils.js:343` | Yes | Yes — `activeProfileId` | add `icpId: activeProfileId` |
| W3 | `ICPSettings.handleSaveChanges` | `src/pages/Scout/ICPSettings.jsx:229` | Yes | Yes — `selectedICPId` | add `icpId: selectedICPId` |
| W4 | `updateIcpFromChat` | `src/utils/updateIcpFromChat.js:47` **and** `:79` | Partly — `:47` writes the bridge *before* consulting `icpProfiles` | Only after resolution | collapse to one write, after resolution, carrying `icpId`; drop the pre-emptive `:47` write |
| W5 | `BarryICPPanel.handleFindCompanies` | `src/components/scout/BarryICPPanel.jsx:200` | No | No | Q1 below |
| W6 | `DailyLeads` ICP-chat modal `handleFindCompanies` | `src/pages/Scout/DailyLeads.jsx:1087` | No | `icpId` prop is in scope here | pass it through explicitly |
| W7 | `BarryOnboarding` | `src/pages/Onboarding/BarryOnboarding.jsx:335` | No | No — no profile exists yet | Q1 below |
| W8 | `CompanyQuestionnaire` | `src/components/scout/CompanyQuestionnaire.jsx:176` | No | No | Q1 below |
| W9 | `adminUpdateUserICP` | `netlify/functions/adminUpdateUserICP.js:170` | Yes | Yes — `icpId` param | add `icpId`; **also fix the gate** — it currently syncs the bridge when the edited profile is the *oldest* (`allProfiles[0].id === icpId`), not when it is the *active* one. Editing an inactive-but-oldest ICP silently overwrites the active ICP's projection. |

**Backfill is explicitly not performed** (Category 2). Debt recorded in §6.

### 3.2 Proposed consumer handling for a bridge doc with no `icpId` — needs confirmation

The rule I propose, applied uniformly at all 13 read sites:

> A bridge document without `icpId` is an **unattributed projection**. It may be used for its
> *criteria content* (industries, sizes, locations, titles) but must never be used as evidence of
> *which* ICP is in effect. Consumers therefore: (a) call `resolveActiveIcp` for identity, always;
> (b) prefer the authoritative `icpProfiles` document for content when RESOLVED; (c) fall back to
> the unattributed bridge content only when UNRESOLVED, tagging the derived context
> `icpAttribution: 'unverified-projection'`; (d) never write `icpId: DEFAULT_ICP_ID` onto it to
> "fix" it — that is fabrication, and is exactly the backfill decision reserved for Category 2.

This is consistent with Item 1's contract: it is the same "explicit unresolved state" surfaced at
the consumer boundary rather than a second, competing convention.

---

## 4. Item 3 — Preliminary bridge-writer classification

Final classification with per-writer evidence lands in the Tier 1 report; this is the trace-stage
read so the blast radius is visible before any change.

| Writer | Proposed class | Reasoning |
|---|---|---|
| W1 `setActiveIcpProfile` | **Authorized projection generator** | Reads `icpProfiles`, writes the bridge as a derived view of an explicitly chosen ICP. Only needs `icpId`. |
| W2 `dashboardUtils` migration | **Authorized projection generator** (one-shot) | Derives from `icpProfiles` after establishing the active profile. |
| W3 `ICPSettings.handleSaveChanges` | **Authorized projection generator** | Writes `icpProfiles` first, mirrors to the bridge only when that profile is active. |
| W4 `updateIcpFromChat` | **Reconciliation debt → repairable to authorized in Tier 1** | Its first write (`:47`) treats the bridge as durable state; its second (`:79`) is a correct projection. Remediation = delete the first, resolve identity before the second. |
| W5 `BarryICPPanel` | **Reconciliation debt** | Live from both `ICPSettings.jsx:1126` and `DailyLeads.jsx:2674`. Merges Barry's extracted params straight into the bridge; `icpProfiles` never learns about the change, so the next `setActiveIcpProfile` silently reverts the user's refinement. Remediation = write through `icpProfiles/{resolved}` then project. |
| W6 `DailyLeads` ICP-chat modal | **Reconciliation debt** | Same pattern as W5, but `icpId` is already in scope, so the write-through is a small change. |
| W7 `BarryOnboarding` | **Reconciliation debt — the load-bearing one** | Route `/onboarding/barry` is live. This is where an ICP genuinely comes into existence, and it creates it *only* in the bridge. Every downstream identity problem starts here. |
| W8 `CompanyQuestionnaire` | **Reconciliation debt, low reach** | Route `/onboarding/company-profile` is live and routed (`src/App.jsx:729–736`), but its only in-app entry point, `ScoutDashboardPage.jsx:33–40`, is itself **not routed anywhere** (imported at `App.jsx:34`, never rendered). Effectively reachable by direct URL only. |
| W9 `adminUpdateUserICP` | **Reconciliation debt** | Wrong gate (oldest, not active) + no `icpId`. |

Two further writes that are *not* bridge writes but do assert ICP identity, flagged for the record:

- `netlify/functions/search-companies.js:993,1024` stamps every discovered company with
  `icpId: icpId || DEFAULT_ICP_ID`. When the caller omits `icpId` (W5's fetch at
  `BarryICPPanel.jsx:207`, `BarryOnboarding.jsx:376`, `MissionControlDashboardV2.jsx:366`,
  `CompanyQuestionnaire.jsx:213`, and the scheduled `daily-leads-refresh.js:216`), companies are
  **written with a fabricated ICP attribution**. Note this is not a display bug — it is persisted.
  The queue filter `!c.icpId || c.icpId === activeId` then hides those companies from every user
  whose real ICP is not `'default'`. Fixing the *tagging* is Tier 1-adjacent; fixing the
  *already-written* rows is Category 2. **Flagged for scope ruling — see Q3.**
- `netlify/functions/daily-leads-refresh.js:149–216` — the scheduled weekday job reads every user's
  bridge over the Firestore REST API and calls `search-companies` **with no `icpId` at all**.

---

## 5. Item 4 — The bootstrap paths (plural)

There is not one bridge→`icpProfiles` promotion path. There are three.

| Path | Location | Trigger | Sets `isActive`/`status`? | Id shape | Assessment |
|---|---|---|---|---|---|
| B1 | `src/pages/Scout/ICPSettings.jsx:66–88` | **Silent, on page load**, whenever `icpProfiles` is empty | **No — neither field is written** | `icp_${Date.now()}` (non-deterministic) | **Reconciliation debt.** Creates an ICP as a side effect of *looking at a settings page*, and creates it in a state no canonical query can find (§1, consequence 2). |
| B2 | `src/utils/dashboardUtils.js:281–292` | Once per user, gated by `migratedMultiICP` | Yes — `isActive:true, status:'active'` | `'default'` (stable) | **Authorized** ICP creation — an explicit, idempotent, stamped migration. |
| B3 | `src/utils/updateIcpFromChat.js:62–63,78` | Silent, whenever Barry chat writes an ICP delta and nothing is active | No | `'default'` | **Reconciliation debt.** `setDoc` to a possibly non-existent doc is an undeclared create. |

### Proposed Tier 1 resolution

- **B2 → declared authorized**, documented in-code as the single authorized bootstrap, unchanged in
  behaviour.
- **B1 → guarded, not deleted.** It cannot simply be removed: a user with an empty `icpProfiles`
  collection and a populated bridge would otherwise land on an ICP Settings page with nothing to
  edit. Change: it stops firing as a page-load side effect and becomes an explicit user action
  ("Create your first ICP from your saved profile"), and whatever it creates carries
  `isActive:true, status:'active'` and a stable `icpId` field equal to its document id — so it can
  never again create an ICP that the canonical resolver cannot see.
- **B3 → stopped.** No create. UNRESOLVED returns a recoverable error to `BarryChatPanel` (Q2).

After Tier 1, no path creates an ICP without an explicit user action and an explicit active-state stamp.

---

## 6. Category 2 debt identified (documented, not performed)

| # | Debt | What exists | What it lacks | What a future migration must do | Population estimate |
|---|---|---|---|---|---|
| D-1 | Bridge documents without `icpId` | one `companyProfile/current` per user who ever completed any onboarding path | ICP attribution | decide the storage representation of ICP identity on the bridge, then attribute each doc to a real `icpProfiles` id — or delete the bridge outright | **≤ 1 × (users with onboarding complete)**. Exact count is not derivable from the repository; it needs a Firestore aggregation, which Phase 1B is not authorized to run. |
| D-2 | `icpProfiles` docs created by B1 with no `isActive`/`status` | real profiles, invisible to M1/M2/M6/M8 | active-state fields | stamp exactly one active profile per user | one per user who opened ICP Settings before ever activating a profile — repository evidence proves the path, not the count |
| D-3 | Companies stamped `icpId:'default'` by `search-companies` with no real ICP behind it | `users/{uid}/companies/*` rows | true Company × ICP attribution | re-attribute or clear; depends on the Company × ICP model, which is explicitly Not Decided | unbounded — every company written via a call site that omitted `icpId` |
| D-4 | Stored `fit_score` without reliable ICP attribution | `companies.fit_score`, `fit_reasons`, `fit_reason` | ICP attribution | Tier 2 Item 5 territory; recorded here because Tier 1's inventory surfaced it | — |
| D-5 | Full deprecation of `companyProfile/current` | 13 read sites, 9 write sites | — | the bridge's end state is Not Decided by the contract; Tier 1 only stops the bleeding | — |
| D-6 | Bridge-only edit history | W5/W6/W7/W8 wrote ICP refinements that `icpProfiles` never saw | — | decide whether bridge-only edits are recoverable intelligence or discardable | — |

**Confirmed: no Category 3 or Category 4 work is proposed anywhere in this trace.** No schema
migration, no unified assembler, no Company × ICP persistence, no Coverage persistence, no Mission
object, no RECON redesign, no new Apollo integration, no new Eligibility rules, no §9 wiring.

---

## 7. Open questions — answers needed before implementation starts

**Q1 — Bridge writers that have no ICP to name (W5 `BarryICPPanel`, W7 `BarryOnboarding`, W8 `CompanyQuestionnaire`).**
The rule "every new bridge write carries `icpId`" and the rule "no writer may invent an ICP" collide
here, because these three run precisely when no `icpProfiles` document exists. Three options:

- **(a) Recommended — write through.** Resolve first; when UNRESOLVED, create the `icpProfiles`
  document via the single authorized bootstrap (§5) and then write the bridge as its projection.
  Turns all three into authorized projection generators. Cost: it makes onboarding an ICP-creating
  path *explicitly*, which it already is *implicitly*. Risk: closest to touching architecture — I
  want this ruled in-scope before doing it.
- **(b) Explicit unattributed marker.** Write `icpId: null` + `icpAttribution:'unattributed'`.
  Honest, zero risk, but leaves the platform still producing identity-less bridge docs and
  technically fails "must carry the `icpId`".
- **(c) Stop the write.** Correct and smallest, but breaks onboarding — the bridge is the only thing
  the post-onboarding search reads. Not viable.

**Q2 — `updateIcpFromChat` when UNRESOLVED.** Confirm that returning a recoverable error to
`BarryChatPanel` (user sees "I couldn't tell which ICP to update — pick one in ICP Settings") is
preferred over today's silent create-and-write. My read of the packet says yes; it is a
user-visible behaviour change, so I want it explicit.

**Q3 — Scope ruling on `icpId` at the *company* write.** `search-companies.js:993` fabricating
`icpId:'default'`, and the five callers that omit `icpId` entirely, are the mechanism by which
unattributed Match gets persisted. Correcting the *call sites* is squarely Tier 1 wiring;
correcting the *fallback in the writer* arguably anticipates Tier 2 Item 5. Confirm: fix call sites
in Tier 1 and leave the writer's fallback to Tier 2, or handle both in Tier 2?

**Q4 — v0.3.1.** Supply the contract, or confirm in writing that Tier 1 may proceed against the
semantics restated in the Convergence Decision Packet, with any conflict resolved retroactively in
the Tier 1 report.

---

## 8. What happens on approval

1. Q1–Q4 answered; v0.3.1 read; this trace amended if the contract contradicts any proposal above.
2. Implementation in this order: canonical resolver (+ tests) → callers → bridge `icpId` →
   bootstrap guard → writer classification finalised with evidence.
3. Build green, failure set unchanged from the 5 pre-existing failures, Tier 1 report returned with
   before/after and full Producer → Store → Consumer → Decision reachability evidence per change.

---

## 9. Review outcome — rulings recorded 2026-08-18

Trace **ACCEPTED** as repository evidence. **Implementation: HOLD.** Nothing in §2–§5 is
implemented until Team B's final contract is supplied and a single narrow contract-vs-trace check
is performed. This section is the record of what was authorized; §2–§5 remain provisional
proposals, not an authorized work order, except where stated below.

### Question outcomes

| Q | Subject | Outcome |
|---|---|---|
| Q1 | Writers with no ICP to name (W5/W7/W8) | **SEMANTICALLY GATED ON FINAL CONTRACT.** Write-through is the intended end state, but the new authorized bootstrap is **not** to be implemented from W5/W7/W8. W5/W7/W8 stand as confirmed reconciliation debt. Whether onboarding is an authorized ICP-creation event, or another explicit creation boundary owns it, is a contract decision. Also ruled out: `icpId: null` as a permanent solution; continuing to invent `default`; stopping onboarding. |
| Q2 | `updateIcpFromChat` when unresolved | **RESOLVED — fail explicitly.** No manufacturing of `icpProfiles/default` on failed resolution. On authorization, UNRESOLVED returns a recoverable state to the calling surface. Final user-facing treatment is not a Tier 1 design deliverable. The three states — **no profiles**, **profiles exist but none active**, **identity/read failure** — must stay distinct and must not collapse into `default`. |
| Q3 | `search-companies` fallback and omitted `icpId` | **RESOLVED — Tier 1 owns both sides.** On authorization: (1) reachable callers propagate explicit resolved ICP identity; (2) `search-companies` loses the ability to convert a missing `icpId` into `DEFAULT_ICP_ID`. Missing identity at the company-write boundary produces an explicit unresolved/error outcome, never a fabricated `default`. The scheduled `daily-leads-refresh` is covered by the same rule — a background process has no greater authority to infer ICP identity than an interactive caller. Explicitly **not** authorized: Company × ICP Match persistence, backfilling existing companies, deciding historical ownership. Existing mis-attributed records stay Category 2 debt. |
| Q4 | Barry Intelligence Contract | **WAITING ON TEAM B.** Do not proceed against reconstructed semantics. No further git-history searching for the document. |

### Additional rulings

- **Canonical resolver** — direction accepted; the invariant (RESOLVED or explicitly UNRESOLVED, never a manufactured identity) is accepted. Implementation waits for the contract.
- **`candidates[0]` fallback** — accepted **only** as a continuity mechanism. It must never be promoted, persisted, searched against, or represented as the active ICP merely because it was first in a list.
- **Bridge content while unresolved** — criteria may temporarily remain usable as unattributed compatibility context to prevent regressions. The bridge must never be relabelled `default`, and never used as proof of ICP identity.
- **B1 (`ICPSettings` load-time bootstrap)** — confirmed reconciliation debt. The proposed replacement user action is **not** authorized; it touches product behaviour and ICP-creation semantics. Held until the contract resolves Q1.
- **B2 (`dashboardUtils` migration bootstrap)** — preserved as a documented transition path. Its authority is **not** to be extended to new onboarding flows without explicit authorization.
- **B3 (`updateIcpFromChat` silent creation)** — confirmed defect. Silent creation stops once implementation is authorized.
- **`adminUpdateUserICP` active-vs-oldest gate** — accepted as a Tier 1 correctness issue (an inactive ICP can overwrite the active projection). Included in the implementation plan when the gate opens.

### Scope boundary reaffirmed

The trace surfaced more than Tier 1 needs to solve; that does not expand the phase. Tier 1 remains
**identity correctness and projection correctness** — not an ICP architecture redesign.

Not authorized in Tier 1: backfilling bridge documents; re-attributing existing companies;
Company × ICP persistence; Firestore schema migration; onboarding redesign; new ICP management UX;
Coverage persistence; Match architecture change; RECON targeting work; Barry context composition
work; any start on Tiers 2, 3 or 4.

The §6 Category 2 inventory is accepted **as debt, not as an implementation backlog for this tier.**

### State at hold

Branch `claude/team-a-nz6kaz` preserved at the accepted baseline: no source file modified,
build EXIT 0, test failure set unchanged at the 5 pre-existing failures recorded in §0.
