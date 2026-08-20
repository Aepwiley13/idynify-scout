# Team A — Phase 2 Final Plan Delta

**Delta to `TEAM_A_PHASE2_IMPLEMENTATION_PLAN.md`. No application code.**
**Recommendation: PHASE 2 NEEDS ONE BOUNDED DECISION** — the B8 Apollo cost gate (§7). Everything else is ready.

Two investigations changed the plan materially:

- **B3's collision surface is a single caller** — the smallest possible.
- **T-1 is largely already built.** `barryICPConversation` already normalizes to exactly the enumerations T-1 was specified to produce, and already drops what it cannot match. This shrinks the plan's one boundary crossing.

---

## 1. Revised B1 — conversational WHO acquisition

**No signup field. Signup friction is unchanged.**

**Resolution order, with repository evidence at each step:**

| Order | Source | Reliability |
|---|---|---|
| 1 | Authenticated display identity (`auth.currentUser.displayName`) | **Effectively never available today.** Signup is email/password only — no `updateProfile` call, no Google/OAuth sign-in anywhere in `src`. `displayName` is null for every account created by the current flow. Kept as step 1 because it becomes real the moment social sign-in exists; **it must not be relied on** |
| 2 | Conversational acquisition — Barry asks once: *"What should I call you?"* | The live path in practice |
| 3 | Proceed unnamed | Always permitted |

**Rules:** asked at most once, inside the conversation, never as its own screen. No required field, no completion state, no blocker. If the user ignores it, Barry continues and may re-acquire naturally later.

**Consumer already exists:** the `data.firstName || data.displayName || data.name` read at `OnboardingFlow:335` moves to the First Experience. If a name is acquired conversationally it is written as User-scoped intelligence on the user document — not into RECON, not into an ICP.

**Removed from the plan:** the signup form change, and its test.

---

## 2. B3 collision trace — `barryICPConversation`

### Reachable callers — exactly one

`src/pages/Onboarding/BarryOnboarding.jsx:195`. No other caller in `src/` or `netlify/`. **The blast radius of any additive change is one component, which this phase is rewriting anyway.**

### Current contracts

**Request:** `{ userId, authToken, action, userInput, currentStep, conversationHistory, existingICP, pendingICP, icpId }`.
**Actions:** one branch — `process_initial_input | process_followup` (`:431`).
**Response:** `{ success: true, ...result }` (`:481`) — an **open spread**, so an added key cannot break the existing shape.
**Inner shape:** `barryResponse.understood` carrying `industries`, `companySizes`, `locations`, `companyKeywords`, plus conversational fields.

### Coupling to ICP extraction — real, and the deciding factor

The prompt is ICP-specific throughout: it embeds `INDUSTRY_NAMES` (147 canonical Apollo names, `:157`), example companies, and targeting instructions, and it post-validates `understood.*` against the three enumerations. **A non-Prospecting user calling this endpoint would run an ICP-extraction prompt over "I want to reconnect with old clients"** — spending a Sonnet call to produce a targeting object nobody wants, and inviting proto-targeting semantics into journeys that must never touch them.

### Smallest safe placement — and the ruling

**Adding intent classification to `barryICPConversation` is additive at the response level but wrong at the semantic level. B3 as originally written should not proceed.**

It satisfies the technical test — one caller, open response spread, no change to ICP behaviour — but fails the intent of the gate: it would couple all intents to ICP extraction. Reporting the collision as instructed.

**Smallest safe placement, no new service:** classify intent from the **first user turn, before any endpoint is chosen**, and use the result to route. Prospecting turns then call `barryICPConversation` exactly as they do today, with its prompt and behaviour untouched. Non-Prospecting turns never reach it.

Two implementations of that placement, both avoiding a new service:

- **B3a — reuse `barryMissionChat`.** It already performs general conversational classification with mode routing, is already reachable from three callers, and carries no ICP-extraction prompt. Adding a First-Experience mode is additive to an existing multi-mode endpoint.
- **B3b — a thin classifier branch inside the First Experience's own server entry**, if B3a's mode surface proves too heavy.

**Recommendation: B3a.** No new service, no change to `barryICPConversation`, and Prospecting keeps the Phase-1B-verified path byte-for-byte.

**Unblocked meanwhile:** B2 and all unrelated work, per instruction.

---

## 3. T-1 — materially reduced by evidence

**`barryICPConversation` already implements T-1's contract for the conversational path** (`:650–672`):

```
industries    → filtered against APOLLO_INDUSTRIES names, canonical casing restored
companySizes  → filtered against the 11 COMPANY_SIZE_OPTIONS
locations     → filtered against US_STATES (+ "nationwide")
```

It **drops** what it cannot match rather than inventing — exactly T-1's first invariant, already shipped, already proposal-only.

**So T-1's remaining job is one thing only:** getting `analyze-website`'s free text (`targetIndustry`, `targetCompanySize`) into that same normalizer.

**Recommended approach — route, don't duplicate.** Feed the website's free-text output into the existing extraction turn as conversational input, so it passes through the validation that already exists. No parallel translator, no second copy of three enumerations that could drift from ICP Settings.

**If routing proves impractical**, the fallback is a bounded utility whose enumerations are **imported**, never re-declared.

### T-1 test contract (expanded as required)

| Case | Expected |
|---|---|
| Exact match ("Accounting") | maps, canonical casing |
| Case/spacing variant ("accounting ") | maps to canonical form |
| Defensible synonym ("accounting services") | maps **or** omits — **never** to a different industry |
| **Multiple possible matches** ("financial") | **omits and clarifies.** Never picks one silently |
| Unsupported input ("vibes-based consulting") | omitted, no throw |
| Empty value ("" / null / undefined) | omitted, no throw |
| **Mixed language** ("servicios contables") | omits unless it maps defensibly; never a wrong-language guess |
| "mid-market" | maps to a defensible bucket set **or** omits |
| "50-200 employees" | maps to overlapping buckets |
| Free text with no size signal | omitted |
| **Property test** — any input | every output value ∈ the existing enumerations |
| **Property test** — any input | no empty-string entries |
| **Boundary proof** | T-1 never writes `icpProfiles`, never writes the bridge, never calls `search-companies` — asserted against the module's imports and call graph |
| **Boundary proof** | T-1 output reaches only the confirmation card |

---

## 4. ICP proactivity (locked ruling, folded in)

When intent is Prospecting **and** a defensible proposal carrying ≥1 supported retrieval constraint can be formed, Barry **presents the proposal unprompted**. The user never asks Barry to create an ICP.

With no supported constraint: **one** useful question, then try again. Not a form.

**Each confirmation shows the work.** The card states what Barry found, where it came from (website / conversation), and what it could not determine — so confirming is reviewing Barry's reasoning, not filling a disguised form. `ICPConfirmationCard` is the surface; the content requirement is new and belongs in B5.

P-9 unchanged: proto-targeting → proposal → explicit confirmation → ICP identity → search.

---

## 5. Final batch order

| # | Batch | Depends on | Change from prior plan |
|---|---|---|---|
| **B1** | Conversational WHO acquisition | — | **Revised** — no signup field |
| **B2** | Canonical route + redirects | — | Unchanged |
| **B3a** | Intent classification via `barryMissionChat` mode | B2 | **Revised** — `barryICPConversation` untouched |
| **B4** | Intent → First Value routing (fully-supported intents) | B3a | Unchanged |
| **B5** | Prospecting confirmation-before-search + **proactive proposal** + show-the-work card | B4 | Expanded |
| **B6** | T-1 via the existing normalizer | B5 | **Reduced** |
| **B7** | Website accelerator wired to the proposal | B6 | Unchanged |
| **B8** | Engagement + Preparation branches | B4 | **Gated — §7** |
| **B9** | Retire `OnboardingFlow` orchestration + four questions | B2, B4 | Unchanged |
| **B10** | Resumability + returning states | B2 | Unchanged |
| **B11** | Analytics implementation | B4 | **New — now viable, §8** |

## 6. Branch / PR sequencing

One branch per batch off the merged Phase 1B baseline, `claude/team-a-p2-b{n}-{slug}`, one PR each.

```
B1 ─┐
B2 ─┼─► B3a ─► B4 ─┬─► B5 ─► B6 ─► B7
    │              ├─► B8   (gated on §7)
B10─┘              ├─► B9   (after B4 proves the replacement)
                   └─► B11  (after B4)
```

Parallel: B1, B2, B10. Sequential: B3a → B4 → B5 → B6 → B7.
**Collision discipline carries forward:** if two batches need the same file, stop and report rather than resolving in a merge.

---

## 7. B8 Apollo cost decision gate — **the one bounded decision**

1. **Invocation point.** Exactly one: `barryEnrich` → `APOLLO_ENDPOINTS.PEOPLE_MATCH` (`:151`), reached only when `contact.apollo_person_id` is absent or enrichment is requested for a named contact.
2. **Scope.** One call for one user-named person. **No broad network enrichment** — B8 never iterates contacts, and nothing in the Engagement path fans out.
3. **Existing intelligence first.** Contact record → Gmail/engagement history → `assembleBarryContext`. Enrichment is attempted **only** when the requested First Value materially benefits and stored intelligence is insufficient.
4. **Cost from repository evidence — cannot be established.** `creditCosts` (`utils/creditTracking.js:25`) covers `addCompany`, `getContactName`, `revealEmail`, `revealPhone`, `enrichCompanyFull` — **contact enrichment via `PEOPLE_MATCH` is not among them, and `barryEnrich` performs no `deductCredits` call at all.** No Apollo pricing, quota or rate-limit config exists in `.env.example` or `apolloConstants.js`.
5. **Flagged, not guessed.** The in-product cost is **zero credits**; the real cost is against the Apollo plan, at a price the repository does not contain. **I am not estimating it.**
6. **Decision required.** The B8 path is **designed** cost-acceptably — one call, one named person, only when stored intelligence is insufficient. Whether one Apollo `PEOPLE_MATCH` per new user is acceptable **in plan terms is an owner call**, because only you can see the contract. Two shapes: **(a)** enable as designed; **(b)** ship B8 with enrichment off, delivering First Value from stored intelligence alone, and enable enrichment once the cost is confirmed.

**Gmail is not proposed as a mandatory alternative** — it remains an optional accelerator, per instruction.

---

## 8. Analytics — now implementable, no new infrastructure

`src/services/analytics.js` exists: `logEvent(name, params)` writing to `users/{uid}/analytics_events`, fire-and-forget, never throws, test-disabled by default, with a companion `signupAnalytics.js`. `EVENTS` currently freezes two names (`open_contact`, `open_company`).

**The eight events can be carried by adding names to `EVENTS` and calling the existing `logEvent`.** No SDK, no new telemetry infrastructure, no new collection. **Analytics implementation therefore enters the plan as B11** rather than staying deferred. The event contract from the plan's §12 is unchanged and stands as acceptance instrumentation regardless.

---

## 9. Legacy completion treatment (accepted, restated)

`onboardingComplete`, `onboarding.completed`, `onboardingSource`, `hasSeenMCWelcome`, `barryState` are **compatibility and routing state only**. They do not mean "fully onboarded". All five are kept and written with the same meanings; none is removed in Phase 2. **No profile-completeness UX. No replacement `firstValueComplete` persistence flag.** First Value delivered is an analytics fact (§8), never a stored gate.

---

## 10. Acceptance criteria per supported First Value branch

Each is the Phase 2 floor (P-7). Real outcomes only.

| Branch | Passes when |
|---|---|
| **Exploration** | Orientation brief renders from real platform state; correct and non-apologetic at zero ICP; no fabricated counts |
| **Communication** | With Gmail connected, one real email is analyzed and a reply suggested, in-conversation |
| **Outreach** | One named recipient + purpose yields a real draft; contact created through `prepareContactWrite` with identity resolution |
| **Pipeline** | One named contact with history yields a status snapshot and a next step |
| **Prospecting** | Proposal presented proactively; confirmation creates `icpProfiles/{icpId}`, activates it, projects with `icpId`; search runs with explicit `icpId`; one constraint suffices; zero constraints ⇒ one question, `NEEDS_TARGETING`, no search; **no unattributed persistence** |
| **Engagement** | One named person yields a snapshot, follow-up suggestion, starter, or draft. **Asserted:** no news claim, no second-degree claim. Enrichment at most once, only for that person (§7) |
| **Preparation** | A named meeting/person yields assembled contact + company context. **Asserted:** no claim beyond what the sources hold |

**Cross-cutting:** every branch works at zero ICP except Prospecting; nothing is simulated; build EXIT 0, the five known failures remain the only failures, lint at baseline.

---

## 11. Future / deferred capability list

**Deferred with named blockers:** referral second-degree paths (no relationship graph) · company news (no source) · résumé, user-LinkedIn, Facebook/social ingestion (P-6) · multi-company context switching (P-4 — one truthful context) · pre-payment Barry (P-2) · persistent intent / Mission promotion (P-5) · purpose-built meeting-brief surface · user location capture.

**Explicitly not future work — prohibited:** provisional targeting objects · temporary ICP identities · anonymous discovery · unattributed company persistence · profile-completeness UX · a `firstValueComplete` flag · a nine-button intent menu · reopening any Phase 1B ruling.

---

## Recommendation

**PHASE 2 NEEDS ONE BOUNDED DECISION.**

The decision is **§7 — B8 Apollo enrichment**: enable as designed, or ship B8 with enrichment off and enable it once the plan cost is confirmed. It gates one batch. Every other batch is ready, and B1–B7 and B9–B11 can begin the moment implementation is authorized.

Two things improved on investigation rather than needing a ruling: B3 found the safest possible placement without a new service, and T-1 shrank to routing into a normalizer that already exists and already refuses to invent.

**Returned for owner review. Holding.**
