# Team A — Tier 1 Owner Decision Delta (O-1: ICP is capability-required)

**Delta only.** Companions: `TEAM_A_PHASE1B_TIER1_PRE_IMPLEMENTATION_TRACE.md`,
`TEAM_A_TIER1_GATE_CLOSURE_ADDENDUM.md`. Nothing below is implemented.
**Contract basis:** corrected v0.4 at `fa8f7d8` on `origin/claude/team-b-tzoklo`
("Apply seven bounded corrections", 2026-08-19 04:11) — read in full as a diff against `e591807`.
None of the seven corrections touches the resolution, projection or migration-category language
Tier 1 depends on.

**Two narrow verifications were required by the ruling and are the only new repository work here.**
Both are load-bearing below: `ICPSettings.jsx:436` and `BarryOnboarding.jsx:300`.

---

## 1. Which 5A/5B changes remain unchanged

| # | Change | Status |
|---|---|---|
| 1 | Canonical resolver | **Unchanged in shape.** `reason` semantics gain a classification (item 4) but the contract is the same |
| 3 | Hunter callers handle unresolved | **Unchanged.** They already tolerate absent ICP messaging — this is the ruling's "not required for relationship operations" case |
| 4 | Q2 `updateIcpFromChat` correction | **Unchanged.** Already "resolve or refuse", never create |
| 5 | `icpId` on the four writers that already hold an identity | **Unchanged.** All four operate only where an ICP demonstrably exists |
| 6 | `adminUpdateUserICP` active-vs-oldest gate | **Unchanged** |
| 9 | Five search callers propagate resolved identity | **Unchanged in intent, simplified in method** — see item 7 |
| 10 | `search-companies` stops defaulting to `DEFAULT_ICP_ID` | **Unchanged** |

## 2. Which proposed changes must change

| # | Was | Now |
|---|---|---|
| 2 | `|| icps[0]` continuity fallback applied to "nothing resolved" generally | **Split.** Continuity applies **only** to `none-active` (candidates exist). `no-profiles` is a valid product state and gets a real zero-ICP path, not a fallback |
| 7 | Guard B1 (ICP Settings load-time bootstrap) | **Guard B1 *and* B2**, and B1's guard must be paired with exposing the existing explicit create control (item 3) |
| 8 | Continuity sites bound to "document the gap" | **Reframed by O-4.** No global "complete your ICP setup". Only the surface attempting an ICP-dependent operation explains the requirement |
| 5B framing | Onboarding writers needed an ICP identity to write through | **Inverted.** They no longer need identity to *search* — they need to **not search**. Their *writes* are the deferred part (item 6) |
| Addendum item 1, options (i)–(iii) | Presented as the O-1 choice set | **Superseded.** The ruling is none of the three: no mechanism becomes the implicit creator; zero-ICP is valid |

**New work the ruling adds:** B2 guard (previously proposed as an untouched transition path), and the
zero-ICP path at each ICP-dependent caller (item 8).

## 3. How B2's implicit empty `default` creation is guarded

`dashboardUtils.js:266–358`, the `icpSnap.empty` branch at `:279–292`. Two sub-cases, and they must
be treated differently:

**(a) Nothing to promote — brand-new account.** `icpProfiles` empty **and** `companyProfile/current`
absent or carrying no targeting criteria. Today B2 writes `icpProfiles/default` from `{}`, stamped
`isActive:true, status:'active'` — an ICP fabricated from nothing.
**Guard:** create nothing. Skip the `batch.set` at `:284` and the bridge overwrite at `:343`; still
stamp `migratedMultiICP` so the migration does not re-run. Result: a valid zero-ICP workspace.
Pure Category 1 — deletion of a fabrication, no replacement mechanism.

**(b) Something to promote — legacy account** with real criteria in the bridge and no `icpProfiles`.
Promotion here is not fabrication; it is the recovery of intelligence the user actually authored.
But under the ruling it is still creation triggered by "a migration ran" / "`companyProfile/current`
existed", and the authorized alternative — explicit user confirmation — is deferred.
**Guard: do not change this sub-case in Tier 1.** Removing it would strip live users of the ICP
backing their working Scout discovery, in service of a confirmation experience that does not exist
yet. It stays as an explicitly documented transition path with a named end state, and is listed in
item 6 as deferred.

This split is what keeps the guard Category 1. Guarding (a) removes an invention; guarding (b) would
require inventing the replacement.

**Reach note, unmeasurable from the repository:** (b) fires only for accounts that predate the
multi-ICP migration and have not loaded a dashboard since. (a) fires for every new account —
verified via `dashboardSchema.json`, which stamps neither migration flag.

## 4. How the three states stay distinct end-to-end

The resolver is the only producer of the distinction; every hop carries it, nothing maps it to a
boolean:

| State | Meaning | Resolver | ICP-dependent caller | ICP-independent caller |
|---|---|---|---|---|
| `no-profiles` | No ICP has been created. **Valid product state, not an error** | `{status:'unresolved', reason:'no-profiles', candidates:[]}` | Explicit *ICP-required* outcome for that operation only | Proceeds normally |
| `none-active` | ICPs exist, none selected | `{…reason:'none-active', candidates:[…]}` | Explicit *selection-required* outcome. Candidates may render for continuity; **never** enter search | Proceeds normally |
| `read-failed` | Resolution itself failed | `{…reason:'read-failed', candidates:[]}` | Explicit *error* — recoverable, retryable | Proceeds; logs the failure |

Three properties hold the distinction end to end:

1. **The resolver never classifies severity.** It reports a state. Whether that state blocks is the
   *operation's* decision — the mechanical form of "ICP is capability-required, not platform-required".
2. **`reason` is never widened.** No `if (!icpId)` anywhere: absent identity must be destructured
   from a reason, so `read-failed` cannot silently read as `no-profiles`.
3. **`daily-leads-refresh` records the reason per skipped user** (O-3), so a scheduled skip caused by
   an infrastructure failure is never filed as "this user has no ICP".

Enforced by unit tests asserting all three reasons survive each hop, and that no code path converts
any of them into `DEFAULT_ICP_ID`.

## 5. Onboarding writers reconcilable **without** creating an ICP

| Writer | Reconcilable in Tier 1 | How |
|---|---|---|
| `BarryICPPanel` (W5) | **Yes** | It edits an ICP the user is already looking at. Resolved → write through to `icpProfiles/{icpId}`, then project to the bridge carrying `icpId`. Unresolved → no write, no search, explicit outcome. Never creates |
| `DailyLeads` ICP-chat modal (W6) | **Yes** | `icpId` is already in scope; propagate it and stop the unattributed bridge write |
| `updateIcpFromChat` (W4) | **Yes** | Q2 correction, unchanged |
| `setActiveIcpProfile`, `ICPSettings.handleSaveChanges`, `dashboardUtils:343`, `adminUpdateUserICP` | **Yes** | All four already operate on an existing, identified ICP |
| `ICPSettings` **B1 bootstrap** | **Yes, with one paired change** | Remove the load-time creation. **But** `ICPSettings.jsx:436` returns "No ICP Profile Found — please complete the questionnaire first" whenever `profile` is null, and the existing explicit create control (`handleCreateICP`, wired to the `+` button at `:503`) renders **below that guard** — so it is unreachable in exactly the zero-ICP state. Removing B1 without touching `:436` strands zero-ICP users with no reachable explicit creation event and points them at `CompanyQuestionnaire`, which is reconciliation debt. The paired change is to render the *existing* control in the empty state. This exposes an existing action; it does not design an ICP builder |

## 6. Onboarding writes that must be deferred

| Deferred item | Why |
|---|---|
| **`BarryOnboarding` bridge write (W7) when no ICP exists** | The bridge is a projection of an ICP. With zero ICPs there is nothing to project, and the ruling forbids reinterpreting all onboarding input as ICP-specific intelligence — some of it is Workspace or User scope. Where un-attributed collected targeting intelligence *lives* is a new semantic/storage decision (v0.4 Part VI items 3 and 13). **Tier 1 leaves the write exactly as-is, documented as unattributed debt, and does not add a fabricated `icpId`.** Only the search that follows it is corrected |
| **`CompanyQuestionnaire` (W8)** | Same reasoning; lower reach (routed, but its only in-app entry point is itself unrouted) |
| **Whether `BarryOnboarding.handleConfirm` already *is* an explicit confirmation event** | `BarryOnboarding.jsx:300` is `handleConfirm()` — a user action confirming the targeting definition Barry extracted, with a confirmation screen. That is close to the ruling's "user may then confirm or refine that proposed targeting definition… may become an ICP creation event". Whether this specific existing action qualifies is a **semantic call for the owner**, not engineering judgment — the ruling also lists "onboarding collected information" as insufficient. **Defaulting to deferred.** If ruled a qualifying confirmation event, W7 moves to item 5 and the new-user first-search gap in item 10 disappears |
| **B2 sub-case (b) and B1's legacy promotion** | Both recover real user-authored criteria; both are creation-by-migration. Replacement requires the deferred confirmation experience |

## 7. Can the five identity-omitting search callers be corrected atomically?

**Yes. The ruling unblocks 5B.** They no longer need an ICP identity to be *manufactured* — they need
to not perform an ICP-targeted search without one. The atomic change set is now assemblable:

| Caller | Correction |
|---|---|
| `MissionControlDashboardV2.jsx:366` | Resolve; pass `icpId`; unresolved → no search |
| `BarryICPPanel.jsx:207` | Resolve; pass `icpId`; unresolved → no search |
| `BarryOnboarding.jsx:376` | Resolve; unresolved → no search (**write untouched**, per item 6) |
| `CompanyQuestionnaire.jsx:213` | Same |
| `daily-leads-refresh.js:216` | Server-side resolve per user; unresolved → skip that user, record the reason, continue the job (O-3) |
| `search-companies.js:993,1024` | Missing `icpId` → explicit ICP-required outcome via existing result/error conventions. Never `DEFAULT_ICP_ID` |

**One product consequence must be acknowledged before this lands.** Three of these five are the
onboarding paths. With B2(a) guarded, a new account has zero ICPs at the moment onboarding finishes —
so onboarding's first search correctly does not run, and **the new-user first-search disappears with
no replacement**, because the replacement (explicit ICP confirmation) is deferred. `BarryOnboarding`
also sets `barryState:'SEARCHING'` and `companiesFoundCount:0` on the user document, which Mission
Control reads — that state must resolve to an honest zero-ICP outcome rather than a search that never
completes. Tier 1 can make it honest; Tier 1 cannot make it *good*. See item 10.

## 8. What each ICP-dependent caller does when the Workspace legitimately has zero ICPs

| Caller | Zero-ICP behaviour |
|---|---|
| `DailyLeads` queue | Renders the zero-ICP state for the queue only. No fabricated ICP, no `icps[0]`, no scoring against a profile that does not exist. Account is not "broken" |
| `MissionControlDashboardV2` | Company list renders unscored/unfiltered rather than scored against a fabricated ICP. Match is suppressed, not faked — the Match half is Tier 2's, so Tier 1 only stops the fabrication |
| `ICPSettings` | The one surface whose purpose *is* ICP: shows the empty state with the existing explicit create control reachable (item 5) |
| Manual refresh / adaptive search / `handleFindCompanies` | Do not fire. Explicit ICP-required outcome on that action |
| `daily-leads-refresh` | Skips that user, records the reason, continues (O-3) |
| `search-companies` | Rejects an ICP-targeted search with no identity, via existing conventions |
| Hunter step/sequence generation | **Unaffected** — proceeds without ICP messaging, as today |
| `barryMissionChat`, `barryFirstTouch`, inbox analysis, meeting prep | **Unaffected** — see item 9 |

## 9. Relationship-oriented Barry capabilities without an ICP — confirmed

Confirmed from the existing code, not asserted. Every relationship-oriented surface already tolerates
absent ICP data on its own merits, which is why zero-ICP is survivable today:

- `barryFirstTouch.js:90,104` — `icpSnap.empty ? null : …messaging`; the prompt is built from contact,
  RECON §1/§2/§5 and service profile. No ICP, no failure.
- `barryGenerateSequenceStep.js:130–132`, `barryHunterGenerateStep.js:141`,
  `barryHunterProcessEngage.js:283` — `icpDoc.exists ? (…messaging) : null`, wrapped in a non-fatal
  try/catch.
- `barryMissionChat` — ICP profile is one of several scopes from `barryContextStack`; contacts,
  missions, RECON and user style are independent.
- `barryInboxAnalyzer` — receives no ICP context at all today (corrected v0.4 classifies it
  NON-COMPLIANT on other scopes, not ICP).

**Confirmed: engaging an existing network, managing relationships, referrals, meeting prep, follow-up
and inbox intelligence all remain functional with zero ICPs.** Tier 1 adds no ICP requirement to any
of them. The only behaviour Tier 1 withdraws is the *fabricated* ICP attribution these paths never
depended on.

## 10. Revised Tier 1 scope and recommendation

**Scope A — ready, no further decision needed**

1. Canonical resolver (client + server) with the three distinct reasons; never returns `DEFAULT_ICP_ID`; never reads the bridge
2. Reroute the nine resolution mechanisms; `getActiveIcpId` → documented transition path
3. Hunter callers handle unresolved
4. `updateIcpFromChat` Q2 correction (removes bootstrap B3)
5. `icpId` on the four identity-holding bridge writers
6. `adminUpdateUserICP` active-vs-oldest gate fix
7. **B2 guard, sub-case (a) only** — stop creating an ICP from nothing
8. Continuity restricted to `none-active`; zero-ICP paths at the surfaces in item 8; no global "setup incomplete" messaging

**Scope B — the search boundary, atomic, one change set**

9. Five callers propagate resolved identity or decline to search
10. `search-companies` stops converting missing `icpId` into `DEFAULT_ICP_ID`

**Deferred (item 6):** W7/W8 writes; B2(b); B1 legacy promotion; the `handleConfirm` semantic call.
**Unchanged acceptance:** build EXIT 0; failures unchanged at the 5 pre-existing; no schema, no
backfill, no new abstraction beyond the resolver; no ICP-builder, no onboarding redesign, no new
creation mechanism.

### GO / NO-GO

**GO on Scope A. GO on Scope B conditional on two acknowledgements.**

O-1 removed the blocker. Scope A is now unambiguously Category 1 — it deletes fabrication and adds no
mechanism. Scope B is technically ready and atomically assemblable, but two consequences are the
owner's to accept, not mine:

- **B-1 — the new-user first-search gap.** Correct behaviour under the ruling; a visible product
  regression until the deferred confirmation experience exists. Ruling on `handleConfirm` (item 6)
  would close it instead.
- **B-2 — the ICP Settings empty-state create control** (item 5). Without it, guarding B1 leaves
  zero-ICP users with no reachable explicit creation event at all.

If either is unacceptable, **Scope A alone is still a clean GO** — it does not depend on Scope B, and
it stops B2's fabrication at the source, which is the largest single source of identity-less ICP data
in the platform.

---

## Contradictions with corrected v0.4 — reported, not reinterpreted

**C-1 — Direct contradiction. Appendix B, "Orientation brief" row: ICP hard rule = `Required`,
unconditionally.** Every other row is conditional or exempt ("Required for discovery-related",
"Required for discovery/Match recs", "—" for reply analysis and meeting prep). Orientation brief is
not stated as ICP-dependent, yet is unconditionally required. Under the ruling, a valid zero-ICP
workspace's orientation brief would be permanently PARTIAL — an account marked non-compliant for
being in a state the owner has declared valid. The ruling's own framing ("consistent with the v0.4
composition matrix, which requires ICP for Discovery/Search and Match but does not universally
require it") does not hold for this row. **Requested correction: make the row conditional, on the
same basis as Recommendation and Message generation.**

**C-2 — Vocabulary gap with contradictory effect. Part I §1, "Missing ICP Identity."** The section
recognises exactly two outcomes: resolution succeeds, or resolution *fails* and yields an unresolved
state. It has no concept of "no ICP exists and that is correct." Read literally, a zero-ICP workspace
is permanently in a failure state — the contract collapses the distinction the ruling makes central.
**Requested correction: state that zero ICPs is a valid workspace state, and separate
"ICP-not-required operation" and "no ICP exists (valid)" from "resolution failed".**

**C-3 — Superseded, should not remain open. Part VI item 16** still lists the bootstrap
classification as not decided. O-1/O-2 have now decided the B1/B2 half externally: implicit creation
is reconciliation debt and is not the permanent mechanism. **Requested correction: record item 16 as
resolved by owner decision for the implicit-creation half, and narrow what remains open to the
explicit-confirmation creation event.**

None of the seven bounded corrections in `fa8f7d8` introduces a new conflict with Tier 1. The
`passesAgeFilter` server-side relocation and the `passesAllFilters` dead-code finding are Tier 3
inputs and are noted only so Tier 3 does not re-derive them.

**Status: HOLD.** No implementation, no schema migration, no new storage model, no onboarding
redesign, no ICP-builder, no new creation mechanism, no `DEFAULT_ICP_ID` fabrication.
