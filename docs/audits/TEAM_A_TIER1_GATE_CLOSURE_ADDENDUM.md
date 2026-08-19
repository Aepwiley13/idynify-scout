# Team A — Tier 1 Gate Closure Addendum

**Companion to:** `TEAM_A_PHASE1B_TIER1_PRE_IMPLEMENTATION_TRACE.md` (accepted)
**Branch:** `claude/team-a-nz6kaz` — no application code changed, no schema touched, no Tier 4 work.
**Contract read:** Barry Intelligence Contract v0.4, `docs/barry-os/barry-intelligence-contract-v0.4/README.md`
at commit **`e591807`** on `origin/claude/team-b-tzoklo`, dated 2026-08-19 03:11 UTC, 577 lines.

> **Caveat on "final".** That commit is v0.4 *as returned for approval*. It is unmerged, and it
> predates the bounded correction pass now underway. Items 4 and 7 below are therefore conditional:
> if the correction pass changes Part I §1 (Missing ICP Identity), Part I §2 (Match attribution),
> Part V (migration categories) or Part VI item 16, this addendum needs a delta re-check. No other
> section bears on Tier 1.

---

## 1. Q1 disposition — onboarding writers with no ICP identity

**Disposition: RETURNED AS A DECISION GATE. Engineering cannot close this.**

v0.4 settles it directly. **Part VI, item 16** lists *"Whether the ICP Settings bootstrap path from
`companyProfile/current` to `icpProfiles` is an authorized ICP creation mechanism"* as **explicitly
not decided by the contract**. The question Q1 asks is the question v0.4 declines to answer.

I was asked to distinguish *existing bootstrap behaviour that can be reconciled safely* from *a new
product decision*. The distinction resolves against reconciliation, and one narrow verification
(the only new repository work in this addendum) shows why:

**The existing authorized bootstrap (B2, `dashboardUtils.js:265–357`) cannot supply identity to
`BarryOnboarding`, `BarryICPPanel`, or `CompanyQuestionnaire` — because it already runs before them,
and it runs empty.**

- `initializeDashboard` (`dashboardUtils.js:467–500`) creates a new user's dashboard from
  `src/schemas/dashboardSchema.json`, whose `dashboard` object contains **neither `migratedV2` nor
  `migratedMultiICP`** (verified: keys are `version, userId, createdAt, lastUpdatedAt,
  currentModule, currentSection, navigation, layout, modules, globalControls, progressTracking,
  userState`).
- So the first `getDashboardState` call for **every new account** falls through the hot path at
  `:229` and executes the multi-ICP migration at `:266`.
- `icpProfiles` is empty for a new account, so B2 takes the `icpSnap.empty` branch at `:279`:
  it reads `companyProfile/current`, which for a brand-new user does not exist, and writes
  `icpProfiles/default` from `{}` — stamped `isActive:true, status:'active'`.
- **Then** onboarding runs and writes the real targeting criteria to the bridge only
  (`BarryOnboarding.jsx:335`), never to `icpProfiles/default`.

Net effect on every new account today: the **authoritative** ICP is an empty document, the
**projection** carries all the real targeting intelligence, and the two are divergent from the first
minute. Under v0.4 Part I §1 that projection is *stale* by definition, and under Part V this is
exactly the Category 1 reconciliation Tier 1 exists to fix.

But the fix requires answering "who is allowed to create an ICP?", and there are only three answers:

| Option | What it means | Category |
|---|---|---|
| **(i)** B2 stays the creation boundary; onboarding writes **through** to the ICP B2 already created | Smallest change. Onboarding stops being an ICP author and becomes a projection generator over an existing identity. | 1 — but it makes B2's empty-ICP creation load-bearing product behaviour |
| **(ii)** Onboarding becomes an explicit ICP-creation event | The behaviour the packet told me not to invent. | Product decision |
| **(iii)** A third explicit creation boundary owns it | New mechanism. | Product decision, likely Category 3 |

**Option (i) is the only one that is arguably reconciliation rather than a new product decision, and
even it promotes a migration artifact into the permanent ICP-creation path for all new users.** I am
not treating that as engineering judgment. Returned for an owner decision, as instructed.

*Nothing implemented. W5/W7/W8 remain confirmed reconciliation debt.*

---

## 2. Q2 — minimum Category 1 correction for `updateIcpFromChat`

v0.4 Part I §1 ("Missing ICP Identity") states the invariant my trace proposed, in the contract's own
words: attempt explicit resolution; on failure produce *"an explicitly unresolved state — not a
silent fallback to `DEFAULT_ICP_ID`"*; consumers *"must handle it explicitly — surface an error,
request user selection, or document the gap — never silently proceed as if a default ICP was
intentionally chosen."* No contradiction. The minimum correction, traced and **not implemented**:

**One file — `src/utils/updateIcpFromChat.js`. Four changes, roughly 35 lines, no new abstraction
beyond the shared resolver:**

1. **Delete the pre-emptive bridge write at `:47`.** It writes the projection before the function has
   established which ICP it is projecting — the ordering v0.4 Part I §1 forbids.
2. **Replace the `icpSnap.empty ? doc(icpProfiles,'default') : …` fallback at `:62–63`** with the
   canonical resolver. This is the change that removes bootstrap path B3: `setDoc` to a
   possibly-non-existent `icpProfiles/default` is an undeclared create, and it stops.
3. **RESOLVED path:** write `icpProfiles/{icpId}` first (authoritative), then project to the bridge
   carrying `icpId` — one write each, in that order.
4. **UNRESOLVED path:** write nothing, return `{ status:'unresolved', reason }` to `BarryChatPanel`.

**The three states stay distinct end-to-end** and are carried on `reason`, never collapsed:
`'no-profiles'` · `'none-active'` · `'read-failed'`. Per v0.4, `'read-failed'` in particular must not
degrade to `'no-profiles'` — failure is not emptiness, and neither is a default.

Final user-facing treatment is not designed here, per the standing ruling. The requirement met is
narrow: **the system never creates or mutates an ICP whose identity it cannot establish.**

---

## 3. Q3 — tier placement and the end-to-end invariant

**Invariant to hold:**

```
caller intent → explicit ICP identity → search-companies → persisted company attribution
```
**No missing identity may become fabricated attribution at any hop.** Background callers hold the
same authority as interactive ones — no more.

**Placement: the whole boundary is Tier 1. It is not splittable, and it is currently blocked by Q1.**

The two halves are `search-companies.js:993,1024` (`icpId: icpId || DEFAULT_ICP_ID`, persisted onto
every company row) and the five call sites that omit `icpId` entirely:

| Caller | Can it resolve identity today? |
|---|---|
| `MissionControlDashboardV2.jsx:366` | **Yes** — `icpProfiles` is already loaded in the same component |
| `BarryICPPanel.jsx:207` | **No — Q1-gated** |
| `BarryOnboarding.jsx:376` | **No — Q1-gated** |
| `CompanyQuestionnaire.jsx:213` | **No — Q1-gated** |
| `daily-leads-refresh.js:216` (scheduled, weekday) | **No resolver exists server-side**; it reads the bridge over the REST API for every user |

**Why it cannot be sequenced any smaller.** Harden the server first and the three onboarding callers
break — their searches lose identity and, under the ruling, must then fail rather than fabricate.
Fix the callers first and the server keeps minting `default` for every path not yet converted, which
is precisely the half-landed state the Q3 ruling rejects. So resolver → callers → server fallback
removal must land as **one atomic change set**. And three of the five callers cannot be converted
until Q1 names the ICP-creation boundary.

**Therefore: Q3 is Tier 1, sequenced immediately after the Q1 decision, in a single change set.
It cannot close before Q1 closes.** This is the tightest sequence that never leaves a window in
which missing identity is persisted as `default`.

`daily-leads-refresh` needs one product call of its own (item 6): when a user's identity is
unresolved, the job must either skip that user or fail their refresh. Both degrade a live scheduled
feature; neither may fabricate. Out of scope for engineering to pick.

Explicitly **not** authorized and not proposed: Company × ICP Match persistence, backfilling or
re-attributing existing company rows, deciding historical ownership. Those stay Category 2 debt
(v0.4 Part VI items 3 and 5).

---

## 4. Contradiction check against v0.4

**Result: no contradiction between v0.4 and the accepted Tier 1 proposal.** v0.4 restates the
resolution invariant, names `companyProfile/current` a projection rather than an authority, and
requires every projection to carry `icpId` — the three pillars the trace was built on. Reporting
only genuine findings, per instruction:

**One genuine contradiction — and it is not with my trace. It is between the Convergence Packet and
v0.4.**

- Convergence Packet, Tier 1 Item 4: *"The bootstrap path must not remain implicit after Tier 1"* —
  and requires it be classified **authorized or debt** within Tier 1.
- v0.4, Part VI item 16: that exact classification is **explicitly not decided by the contract**.

Tier 1 is charged with closing a question its semantic authority has deferred. **Proposed minimum
resolution, for approval:** Tier 1 satisfies the *guard* half of Item 4 (the path can no longer fire
as a silent side effect) and leaves the *classification* half open pending the Q1 decision. That
honours both documents without either team inventing the answer. **Owner call — see item 6.**

**Two precision points, not contradictions:**

- **Continuity fallback.** v0.4 requires the consumer to *handle* an unresolved state — "surface an
  error, request user selection, or document the gap." A `candidates[0]` render whose
  `unresolved-fallback` tag no one reads would satisfy the earlier continuity ruling but fail v0.4.
  Tier 1 will therefore bind each continuity site to at least the "document the gap" branch. Also
  reconfirmed: candidates must never reach the search path — v0.4 Part IV allows "ICP-targeted" only
  for constraints derived from *the intended* ICP.
- **Mechanism count.** v0.4's evidence table says "at least four distinct active-ICP selection
  paths"; the accepted trace inventories nine with four fallback tiebreaks. Superset, not conflict —
  noted so the two documents don't read as inconsistent.

**Governance debt recorded, not acted on** (as instructed — frozen Documents 1–5 are not modified):
`BARRY_OS_DOMAIN_LIFECYCLE_MODEL.md:321` defines `icp_score: number | null // 1-10 (from
barryFeedback.score)`, and `:336` maps `barryFeedback → icp_score`. The frozen model sources a
Match-named field from User Judgment on the User Judgment scale. v0.4 §4 and D5 govern the live
semantic distinction; the frozen definition is **DOCUMENTATION/GOVERNANCE DEBT** and is not
authorization to collapse the two. v0.4 already flags this at its own §4 evidence table.

---

## 5. Exact proposed Tier 1 implementation scope

Nothing below is implemented. This is the bounded work order for approval.

**5A — Unblocked by Q1 (ready on GO):**

| # | Change | Files |
|---|---|---|
| 1 | Canonical resolver: RESOLVED / explicitly UNRESOLVED with distinct `reason`; never returns `DEFAULT_ICP_ID`; never reads the bridge | `src/utils/resolveActiveIcp.js` + `netlify/functions/utils/resolveActiveIcp.js` (new) + `src/test/resolveActiveIcp.test.js` |
| 2 | Reroute the resolution mechanisms onto it; `getActiveIcpId` becomes a documented transition path returning `null` when unresolved | `getActiveIcpId.js`, `barryContextStack.js:59–80`, `DailyLeads.jsx:1379,1398`, `MissionControlDashboardV2.jsx:756`, `ICPSettings.jsx:91`, `barryFirstTouch.js:90` |
| 3 | Hunter callers handle `null` — omit `icpId`, pass explicit unresolved attribution | `SequencePanel.jsx:106`, `QuickMissionAssignModal.jsx:124`, `HunterContactDrawer.jsx:763`, `MissionCard.jsx:220` |
| 4 | Q2 correction (§2 above) | `updateIcpFromChat.js` |
| 5 | `icpId` on the four bridge writers that already have an identity | `setActiveIcpProfile.js:35`, `dashboardUtils.js:343`, `ICPSettings.jsx:229`, `adminUpdateUserICP.js:170` |
| 6 | `adminUpdateUserICP` gate fix: sync the bridge when the edited ICP is **active**, not when it is **oldest** | `adminUpdateUserICP.js:155–172` |
| 7 | Guard B1 so it cannot fire as a page-load side effect; classification deferred per item 4 | `ICPSettings.jsx:66–88` |
| 8 | Continuity sites bound to an explicit "document the gap" handling | the three `|| icps[0]` surfaces |

**5B — Q1-gated, one atomic change set, does not start until Q1 is decided:**

| # | Change | Files |
|---|---|---|
| 9 | The five identity-omitting search callers propagate resolved identity | `MissionControlDashboardV2.jsx:366`, `BarryICPPanel.jsx:207`, `BarryOnboarding.jsx:376`, `CompanyQuestionnaire.jsx:213`, `daily-leads-refresh.js:216` |
| 10 | `search-companies` loses the ability to convert missing `icpId` into `DEFAULT_ICP_ID`; missing identity produces an explicit unresolved outcome | `search-companies.js:993,1024` |

**Acceptance:** build EXIT 0; test failures unchanged at the 5 pre-existing ones recorded in the
trace (`HunterContactCard` date-fns ×1, `ReconSectionEditor` `matchMedia` ×4); reachability evidence
per change; no Firestore document reshaped; no backfill; no new abstraction beyond the resolver.

**Out of scope, unchanged:** schema migration, Company × ICP persistence, Coverage, onboarding
redesign, new ICP UX, Match architecture, RECON targeting, Barry composition, Tiers 2–4.

---

## 6. Requires an owner or product decision — not engineering judgment

| # | Decision | Blocks |
|---|---|---|
| **O-1** | **Who may create an ICP** (v0.4 Part VI #16): option (i), (ii) or (iii) from item 1. Note this decides whether B2's empty-ICP creation becomes permanent product behaviour for every new account. | Q1 · all of scope 5B · Q3 closure |
| **O-2** | **Tier 1 Item 4 vs v0.4 Part VI #16** — approve "guard now, classify after O-1", or hold Item 4 entirely. | Item 4 of the Tier 1 charter |
| **O-3** | **`daily-leads-refresh` on unresolved identity** — skip the user, or fail their refresh. Both degrade a live scheduled feature. | Scope 5B item 9 |
| **O-4** | **Is the unresolved state user-visible** on DailyLeads / Mission Control, or logged-only? v0.4 permits either; it is a UX call. | Scope 5A item 8 |
| **O-5** | **Governance debt** — who owns correcting `icp_score` in frozen Document 2, and when. Not Tier 1. | Nothing in Tier 1 |

---

## 7. GO / NO-GO

**NO-GO for Tier 1 as a whole. The blocker is O-1, not the contract.**

v0.4 introduces no contradiction that stops Tier 1. The stop is structural and follows from the
standing Q3 ruling: scope 5B must land atomically, three of its five callers are Q1-gated, and Q1 is
a product decision that v0.4 explicitly declines to make.

**A partial GO on scope 5A alone is available but I do not recommend it.** 5A is genuinely
independent and would remove the silent-default machinery, B3's undeclared create, and the
`adminUpdateUserICP` active/oldest defect. But it would leave `search-companies` minting `default`
attribution onto every company row written through an unconverted path — the exact half-landed state
the Q3 ruling rejects. Shipping 5A first buys correctness in the resolver while the fabrication
continues at the writer.

**Recommendation: decide O-1, then GO on 5A and 5B together as one Tier 1 change set.** If O-1 needs
more time and motion is wanted meanwhile, 5A items 1–8 can be authorized as an explicitly labelled
partial landing — with the fabrication window acknowledged and accepted in writing.

**Status after this addendum: HOLD.** No application code, no schema, no Tier 4, no further
repository investigation.
