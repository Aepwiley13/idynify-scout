# TEAM A → TEAM C — PHASE 2 HANDOFF

**Written at:** `claude/team-a-p2-b9-cleanup` @ `a5bdaf5`
**Purpose:** everything needed to pick this up without reconstructing the conversation.

Read this document and `TEAM_A_PHASE2_DEBT_REGISTER.md`, then reproduce the
baseline in §3. Do not write code before you have reproduced it.

---

## 1. Current program state

### Phase 1B — COMPLETE / VERIFIED

| Tier | Subject | Status |
|---|---|---|
| Tier 1 | ICP Identity | **Verified** — one canonical resolver; three unresolved reasons never collapsed; ICP creation only from an explicit confirmation event |
| Tier 2 | Match Correctness | **Verified** — cross-ICP contamination removed; Match null rather than zero when unattributed; Coverage computable and separate |
| Tier 3 | Targeting Reconciliation | **Verified** — RECON §3 traced; D7 first-search sufficiency gate; `getIndustryIds` and revenue dispositions recorded |
| Tier 4 | Barry Context Composition | **Verified** — every reachable decision surface classified against the Composition Invariant |

### Phase 2

| Gate | Batches | Status |
|---|---|---|
| Gate A | B1 WHO · B2 canonical route · B10 resume | **VERIFIED** |
| Gate B | B3a intent classification · B4 First Value routing | **VERIFIED** |
| Gate C | B5 proposal · B6 T-1 normalization · B7 website accelerator | **VERIFIED** |
| Gate D1 | B8 Engagement / Preparation First Value | **COMPLETE** — accepted by the owner as the current implementation baseline |
| Gate D2 | B9 legacy cleanup | **COMPLETE** — `GATE D2 PASS` recommended; final disposition with the owner |
| B11 | First Experience analytics | **NOT STARTED** — and not authorized |

---

## 2. Branch / commit inventory

Every branch is **code + docs** unless noted. All are pushed. **None is merged** —
the merge/PR order below is the required order.

| # | Branch | Head | Base | Purpose | Depends on |
|---|---|---|---|---|---|
| — | `claude/team-a-nz6kaz` | `f79e71a` | default | **Phase 1B merged** (Tiers 1–4) + all Phase 2 planning docs | — |
| 1 | `claude/team-a-p2-b1-who` | `0518c44` | `f79e71a` | B1 — conversational WHO acquisition | — |
| 2 | `claude/team-a-p2-b2-canonical-route` | `306967d` | `0518c44` | B2 — one canonical `/onboarding` route; legacy paths redirect | B1 |
| 3 | `claude/team-a-p2-b10-resume` | `5b885a7` | `306967d` | B10 — resumability + returning states; **includes Gate A closure evidence** | B2 |
| 4 | `claude/team-a-p2-b3a-intent` | `6cb5f4b` | `5b885a7` | B3a — intent classification in `barryMissionChat` | B10 |
| 5 | `claude/team-a-p2-b4-routing` | `716900f` | `6cb5f4b` | B4 — intent → First Value routing + **Gate B report** | B3a |
| 6 | `claude/team-a-p2-b5-proposal` | `0a55774` | `716900f` | B5 — targeting proposal + confirmation | B4 |
| 7 | `claude/team-a-p2-b6-normalize` | `4e52fe0` | `0a55774` | B6 — T-1 normalization + canonical vocabulary | *stacked on B5, does not depend on it* |
| 8 | `claude/team-a-p2-b7-accelerator` | `b2f1559` | `4e52fe0` | B7 — website accelerator + **Gate C report** | B6 (real) |
| 9 | `claude/team-a-p2-b8-relationship` | `d712da9` | `b2f1559` | B8 — Engagement / Preparation First Value + **D1 report** | B4 (real) |
| 10 | `claude/team-a-p2-b9-cleanup` | `a5bdaf5` | `d712da9` | B9 — legacy retirement + DATA-1 + **D2 report** + debt register | B7, B8 |

**Merge order is the table order, top to bottom.** The chain is linear: each
branch's base is the previous branch's head, so merging in order produces no
conflicts. Two stacking relationships are convenience rather than dependency and
are called out above — B6 does not depend on B5, and B8 depends on B4 rather than
on B7 — but **do not reorder them**; the linear history is what makes the stack
merge cleanly.

**Every branch contains code except `claude/team-a-nz6kaz`'s Phase 2 planning
commits**, which are documentation only. Reports are committed on the branch
whose work they describe.

---

## 3. Verified baseline — reproduce this first

Measured on `claude/team-a-p2-b9-cleanup` @ `a5bdaf5`.

```
npm ci --force        # plain `npm ci` fails: an android/arm-only optional dependency
npm run build         # exit 0
npx vitest run        # 1729 passing, 5 failing, 74 files
npx eslint .          # 1219 problems (1139 errors, 80 warnings)
```

### The 5 known failures — pre-existing, carried since Tier 1

| Count | File | Cause |
|---|---|---|
| 4 | `src/test/ReconSectionEditor.test.jsx` | `window.matchMedia is not a function` under jsdom |
| 1 | `src/test/HunterContactCard.test.jsx` | a date-fns "last interaction" label |

Neither is caused by any Phase 2 batch. **If you see any other failure, stop —
your environment differs from the one this was verified in.**

### Comparison to the prior verified baseline

| | Gate A | Gate B | Gate C | D1 | **D2 (current)** |
|---|---|---|---|---|---|
| Build | 0 | 0 | 0 | 0 | **0** |
| Passing | 1389 | 1512 | 1641 | 1706 | **1729** |
| Failing | 5 | 5 | 5 | 5 | **5 (same)** |
| Lint errors | 1142 | 1142 | 1142 | 1142 | **1139** |

Every batch through D1 held the lint baseline exactly flat; B9 is the first to
improve it, by deleting files that carried errors.

> **Correction on the record:** Gate A was originally reported as 1220 problems /
> 1138 errors. Re-measured directly on `5b885a7`, the true figure is 1224 / 1142
> — the original was taken before the Gate A closure commit landed. The table
> above uses the corrected number.

---

## 4. Governing documents

### Semantic authorities (Team B)

| Document | Commit |
|---|---|
| Barry Intelligence Contract v0.4-amend | `87bbdaf` |
| Barry First Experience Semantic Design v1.1-d | `9d45f72` |
| Phase 2 Convergence Matrix (Team B) | `3158418` |

### Team A reports — all under `docs/audits/`

**Phase 1B**
- `TEAM_A_PHASE1B_TIER1_PRE_IMPLEMENTATION_TRACE.md`
- `TEAM_A_TIER1_GATE_CLOSURE_ADDENDUM.md` · `TEAM_A_TIER1_OWNER_DECISION_DELTA.md`
- `TEAM_A_TIER1_IMPLEMENTATION_REPORT.md` · `TEAM_A_TIER1_VERIFICATION_REPORT.md` · `TEAM_A_TIER1_CORRECTION_REPORT.md`
- `TEAM_A_TIER2_IMPLEMENTATION_REPORT.md` · `TEAM_A_TIER3_IMPLEMENTATION_REPORT.md` · `TEAM_A_TIERS_2_3_MERGE_REPORT.md`
- `TEAM_A_TIER4_COMPOSITION_REPORT.md`

**Phase 2**
- `TEAM_A_PHASE2_DISCOVERY_BARRY_FIRST_EXPERIENCE.md`
- `TEAM_A_PHASE2_CONVERGENCE_MATRIX.md` — Team A's repository-reality answer
- `TEAM_A_PHASE2_IMPLEMENTATION_PLAN.md` · `TEAM_A_PHASE2_FINAL_PLAN_DELTA.md`
- `TEAM_A_PHASE2_GATE_B_REPORT.md` · `TEAM_A_PHASE2_GATE_C_REPORT.md`
- `TEAM_A_PHASE2_D1_REPORT.md` · `TEAM_A_PHASE2_D2_REPORT.md`
- `TEAM_A_PHASE2_DEBT_REGISTER.md`
- `TEAM_A_PHASE2_HANDOFF.md` — this document

**Two gaps, stated plainly.** There is no standalone Gate A report file and no
standalone Phase 1B closure file — both were returned to the owner in
conversation. Gate A's evidence lives in the `claude/team-a-p2-b10-resume`
commits; Phase 1B's closure evidence lives in the four Tier reports above.

---

## 5. The current First Experience, in plain language

```
WHO  →  INTENT  →  FIRST VALUE  →  LEARN OVER TIME
```

A user arrives at **`/onboarding`** — the one canonical route. Every legacy
onboarding URL redirects there.

**WHO.** Barry asks what to call you, once, and continues either way. It is
never a gate. A name already known is used and the question never appears.

**INTENT.** One open question — *"What are you hoping to get done?"* — free text.
Behind it, nine internal categories the user never sees and which are never
rendered as choices. Low confidence makes Barry read the intent back rather than
act on it; genuinely unclear asks one question. **Nothing unreadable ever becomes
Prospecting** — a wrong question costs one turn, a wrong ICP costs a workspace.

**FIRST VALUE**, by intent:

| Intent | What happens |
|---|---|
| Exploration | Mission Control — an orientation brief from real platform state |
| Communication | the replies view, or "connect Gmail first" |
| Outreach / Referral | the engagement feed, naming the person |
| Pipeline | due follow-ups and what has gone quiet |
| **Engagement / Preparation** | **answered in place** — see below |
| **Prospecting** | **the targeting conversation** — see below |

### Prospecting

```
Barry learns → forms a hypothesis → shows his work → USER CONFIRMS
                                                          ↓
                        authoritative ICP → D7 gate → attributed Scout search
```

Optionally the user gives a website and Barry does the reading. Free text goes
through **T-1**, which emits only exact canonical values or curated canonical
aliases — never a fuzzy guess. Barry proposes as soon as he has **one** supported
retrieval constraint, and says the net is wide rather than asking for more.

The proposal is prose, not a form: what he thinks you want, who he'll look for,
what he picked up along the way, where he's unsure, and what he'll do if you say
go. **Confirmation is the only event that creates an ICP.**

### Engagement / Relationship

```
Barry identifies the named person → existing intelligence FIRST
    → snapshot / suggestion / draft
    → optional bounded enrichment, ONLY when something is actually blocked
```

Where things stand, what was tried, what landed, what you'd already decided to
do next — all read from the record, **zero external calls**. Enrichment is
offered once, for one person, only when a draft has nowhere to go and an
identifier exists. Never because enrichment happens to be available.

### Five properties that must stay true

1. **Zero ICP is a valid workspace state** outside ICP-dependent operations.
   Seven of nine intents never touch one.
2. **Intent is transient.** No field, no collection, no cross-session history.
   It lives in component state and dies with the session.
3. **One canonical `/onboarding` route.** Legacy paths redirect; they are
   compatibility addresses, not a second flow.
4. **Arrival intent is transient.** "Review ICP with Barry" travels in React
   Router location state — gone on reload — and never becomes stored mode.
5. **Old completion flags are compatibility and routing only.**
   `onboardingComplete`, `onboarding.completed`, `onboardingSource`,
   `hasSeenMCWelcome`, `barryState` decide who sees what. They are not a model
   of user progress and must not become one.

---

## 6. Debt register

`TEAM_A_PHASE2_DEBT_REGISTER.md` is **current through B9**. Summary:

| Item | Status |
|---|---|
| **ECON-1** — external retrieval / entitlement boundary | **Open.** Owner-authorized follow-up |
| **DATA-1** — ICP company-size vocabulary | **New writes reconciled in B9.** Legacy stored values open as Category 2 |
| **DATA-2** — source vocabulary | **Open.** Preserve current behaviour |
| **CLEANUP-2** — unreachable `enrich-company.js` | **Open.** Do not revive |
| **CLEANUP-3** — `/icp` Module 1–5 cluster dead at runtime | **Open.** Found in B9 |
| **CLEANUP-4** — four orphaned onboarding components | **Open.** Found in B9 |

### ECON-1 evidence — preserve this

- **Company discovery invokes Apollo** — `COMPANIES_SEARCH`, 1–3 pages
  (1–5 with an age filter).
- **Save/accept can trigger people retrieval and enrichment** — a swipe right
  fires `PEOPLE_SEARCH` plus **up to 3 `PEOPLE_MATCH`** calls, retrieving email,
  title, LinkedIn and phone. The costly event is a gesture, not a button.
- **CompanyDetail can automatically enrich on view** — up to 5 Apollo calls when
  a user merely opens a company.
- **Contact enrichment can invoke sequential Apollo fallbacks** — up to 3 Apollo
  requests plus one Google/LinkedIn lookup for one person.
- **Live internal credit deduction is currently absent.** `deductCredits` has
  zero callers anywhere; the only code that deducts credits is unreachable
  (CLEANUP-2). No Apollo pricing exists anywhere in the repository, so no
  external cost above is quantifiable from repository evidence.

---

## 7. Product / economic principles to preserve

```
SOURCE  ≠  INTELLIGENCE  ≠  ENTITLEMENT
```

- **SOURCE** — where a record came from: manual, networking, CSV, referral,
  CRM, Gmail, Scout discovery.
- **INTELLIGENCE** — what Barry knows and recommends: Match, relationship
  context, next action, messaging context, signals.
- **ENTITLEMENT** — whether IDYNIFY may invoke a particular externally costly
  capability.

**Barry's ability to reason about a record must not depend on whether IDYNIFY
sourced it.** A manually created, imported, or Gmail-derived contact must remain
able to participate fully in the intelligence model without being converted into
a Scout-sourced record. This holds in code today and is asserted by test: the
relationship path reads no `source` field, and `icpScoring` contains no
provenance reference at all.

**External retrieval is the future entitlement seam** — it is already where
provenance genuinely matters (`searchPeople` needs an Apollo organization id,
`barryEnrich` needs a person id or LinkedIn URL), and it sits cleanly outside
the reasoning path.

**This is not authorization to implement entitlement architecture.**

---

## 8. Work explicitly NOT authorized

Without new owner authorization, do not begin:

- B11 First Experience analytics
- a credit system · Apollo billing changes · external cost policy
- save/swipe enrichment changes · CompanyDetail enrichment changes
- freemium / pricing / plan enforcement · entitlement architecture
- multi-tenant or workspace architecture
- LinkedIn or social ingestion · résumé ingestion · new import architecture
- a Company × ICP persistence schema
- a unified Barry context assembler
- Phase 3
- Category 2 migration or backfill · Category 3 infrastructure · Category 4 capability work

---

## 9. Decisions Team C must not make independently

Owner / governance items:

1. The **ECON-1** service-level and credit boundary.
2. Whether **save/accept** should remain a people-enrichment trigger.
3. Whether **CompanyDetail** should keep enriching automatically on view.
4. **External Apollo cost policy.**
5. **Legacy DATA-1 stored-value migration** — whether to convert at all, and how.
6. **DATA-2 canonical provenance vocabulary.**
7. **Future freemium entitlements.**
8. **Any decision to meter Barry reasoning itself.**

Bring evidence and a recommendation. Do not resolve any of these in the course
of unrelated work.

---

## 10. Process discipline you inherit

1. **Evidence before implementation.** Trace it in the repository first; a
   pre-implementation trace for anything non-local.
2. **One bounded batch per branch and PR.**
3. **Independently revertible changes.**
4. **Stop before resolving an unexpected semantic or file collision.** Report it;
   do not resolve it in a merge.
5. **No Category 2/3/4 work without explicit authorization.**
6. **Preserve the build/test/lint baseline at every gate**, and compare
   explicitly.
7. **Never weaken a verified invariant to make a new feature easier.** If an
   assertion is in the way, the assertion is usually right.
8. **Reachability determines whether a capability is real.** An endpoint with no
   caller is not a feature.
9. **Unsupported capability is stated honestly, never simulated.** If Barry
   cannot know it, Barry does not say it.
10. **Report deviations before expanding scope.**

One addition earned the hard way: **when you delete something, remove the
assertions whose subject no longer exists — and say so.** Repointing an assertion
at a different file quietly changes what it proves.

---

## 11. Recommended first action

**Team C should not code immediately.**

Read `TEAM_A_PHASE2_HANDOFF.md` and `TEAM_A_PHASE2_DEBT_REGISTER.md`, then
reproduce the post-B9 baseline in §3:

```
npm ci --force
npm run build         # expect exit 0
npx vitest run        # expect 1729 passing, 5 failing — and the SAME 5
npx eslint .          # expect 1219 problems (1139 errors, 80 warnings)
```

Only after reproducing that baseline should you accept a new owner-authorized
batch.
