# Team A — Phase 2 Implementation Plan: Barry First Experience

**Plan only. No application code.** Returned for owner review.
Baseline: `claude/team-a-nz6kaz` @ `3158418`. Locked inputs: P-1, P-3, P-4, P-5, P-6, P-7, P-8, P-9, and the Prospecting quality floor. P-2 remains outside implementation authorization — **this plan assumes the First Experience runs post-authentication and post-payment**, and nothing in it depends on that staying true.

**Built to absorb Team B's v1.1-b cleanup without redesign:** every semantic input this plan consumes is referenced by *role* (targeting-confirmation event, First Value floor, intent categories) rather than by quoted text, and §6's branch table is data, not structure. A factual correction to v1.1 changes table rows, not the plan's shape.

---

## 1. Canonical entry

**`/onboarding` becomes the single authoritative route** after authentication completes. It is chosen over `/onboarding/barry` deliberately: it is the neutral path, it is already what `SmartRedirect` uses, and the First Experience is no longer "the Barry ICP flow".

| Existing entry | Today | Becomes |
|---|---|---|
| `SmartRedirect` (`App.jsx:324`) | → `/onboarding` (OnboardingFlow) | → `/onboarding` (First Experience). **No change to the redirect itself** |
| `CheckoutSuccessPage:13, :98` | → `/onboarding/barry` | → `/onboarding` |
| `/onboarding/flow` | OnboardingFlow | → redirect `/onboarding` |
| `/onboarding/barry` | BarryOnboarding | → redirect `/onboarding` |
| `/onboarding/recon` | ReconOnboardingWizard | → redirect `/onboarding` |
| `/onboarding/company-profile` | CompanyQuestionnaire | → redirect `/onboarding` (retires the last Tier-3 orphan) |
| `MissionControlDashboardV2:591, :634` "Review ICP with Barry" | → `/onboarding/barry` | → `/onboarding` |
| `DailyLeads:2129` | → `/onboarding/barry` | → `/onboarding` |

**Consequence that must be designed for, not worked around.** Three of those entry points are *existing-user* affordances ("Review ICP with Barry"), not first-run. Redirecting them into the First Experience is only correct if the route is **re-entrant and state-aware** — which is exactly v1.0's FE-8 ("First Experience is not a separate mode"). The route therefore resumes rather than restarts, and for a user who already has an ICP it opens on refinement rather than introduction. This is a requirement of the design, not a side effect.

---

## 2. Conversational spine — what survives from `BarryOnboarding`

Assessed part by part. The component does not survive whole.

### Survives

| Part | Location | Why |
|---|---|---|
| **Server conversation + extraction** | `barryICPConversation` | Multi-turn clarification with structured JSON output. The hardest part to rebuild, and it already exists |
| **Conversation persistence** | `barryConversations/icp` (`:134, :284, :391`) | Resumability substrate. **Keep the document id** — renaming it is schema churn with a migration cost and no benefit |
| **Confirmation card** | `ICPConfirmationCard` | The confirm-don't-interrogate surface |
| **The targeting-confirmation event** | `handleConfirm` (`:300`) | **The authorized ICP creation event** (v0.4-amend Part VI #16). Its full sequence — resolve → write `icpProfiles/{icpId}` → activate → project bridge with `icpId` → D7 gate → search with explicit `icpId` — is Phase 1B-verified and must be preserved intact |
| **Returning greeting** | `buildReturnGreeting` | Re-entry without re-onboarding |
| **Presentation** | `BarryTyping`, `BarrySays`, `BarryAvatar` | Conversational feel, no logic |
| **`read-failed` guard** | `handleConfirm` | A transient read must not mint a duplicate ICP. Verified in Tier 1 |

### Does not survive

| Part | Why |
|---|---|
| **The fixed opening "Who are you hunting?"** | Presumes Prospecting. Journeys 1, 3 and 5 cannot answer it |
| **The three-state stepper** (`asking` → `confirming` → `saving`) as the only shape | It is the Prospecting branch's shape, not the flow's |
| **The assumption that the conversation is about an ICP** | Six of eight intents never touch one |
| **Auto-navigation to Mission Control after 2.5s** | First Value is delivered *in* the conversation, not after leaving it |

**Net:** the extraction endpoint, the persistence, the confirmation card and the creation event are the spine. The routing above them is new.

---

## 3. Existing capability reuse

| Capability | Location | Reuse | Change needed |
|---|---|---|---|
| `analyze-website` | netlify fn | **As-is** as an optional accelerator | None to the function. Translation is separate (§8) |
| Targeting extraction | `barryICPConversation` | **As-is** | None |
| Confirmation / ICP creation | `BarryOnboarding.handleConfirm` | **Lift intact** | Relocate, do not rewrite |
| Resumability | `barryConversations/icp` + `useOnboardingState` | **As-is** | None |
| Barry conversation infra | `BarryTyping`, `BarrySays`, `ICPConfirmationCard` | **As-is** | None |
| Canonical ICP resolution | `resolveActiveIcp` (Tier 1) | **As-is** | None |
| D7 gate | `hasRetrievalConstraint` (Tier 1/3) | **As-is** | None |
| `NEEDS_TARGETING` presentation | `FirstRunView` (Tier 4) | **As-is** | None |
| Orientation brief | `barryOrientationBrief` | **As-is** — Exploration First Value | None |
| Contact creation with identity resolution | `prepareContactWrite` / `applyContactMerge` | **As-is** | None |
| Contact enrichment | `barryEnrich` (Apollo + `linkedinSearch`) | **As-is** | Cost note in §9 |
| Message generation | `generate-engagement-message`, `barryOutreachMessage` | **As-is** | None |
| Inbox analysis | `barryInboxAnalyzer` | **As-is** | None |

**From `OnboardingFlow`, only two things survive:** the `analyze-website` *invocation pattern* (not the step), and `useOnboardingState`'s step/resume machine. The six-step orchestration, the four smart questions (P-8), the Gmail step's position, and step 5's "build list" are retired.

---

## 4. WHO — minimum implementation

**Producer:** one **optional** name field on the signup form, written to `users/{uid}.firstName`.
**Consumer:** already exists — `OnboardingFlow:335` reads `data.firstName || data.displayName || data.name`; that read moves to the First Experience.

**Rules:**
- Optional at signup. Blank is a valid submission.
- If absent, Barry asks once, conversationally, in the first turn — and **proceeds regardless of the answer**.
- **Never a gate.** No screen, step, or First Value path is blocked on having a name. No completion meter, no "finish your profile".
- Company and website are **not** collected at signup. They arrive conversationally or via the accelerator.

**Scope note:** name is User-scoped intelligence on the user document. It is not Workspace intelligence and must not be written into RECON or an ICP.

---

## 5. INTENT — routing without new infrastructure

**Locked (P-5): intent is transient routing context. No cross-session storage.**

- **Where it is computed:** inside the existing `barryICPConversation` turn, extended to return an intent classification alongside its existing structured output. One endpoint, one round trip.
- **Where it lives:** component state for the session. The user's *words* persist in `barryConversations/icp.messages`, as they already do — that is a transcript, not an intent field.
- **What must not happen:** no `intent` field on any document, no intent collection, no taxonomy document, no per-user intent history. If a later ruling makes intent Mission intelligence, it will be written then, under that ruling.
- **User-facing shape:** an open question — *"What are you hoping to get done?"* — with free text. **No nine-button menu.** Internal classification is invisible.
- **Ambiguity handling:** Barry confirms in words rather than re-asking — *"Sounds like you want to reconnect with people you already know rather than find new companies — is that right?"*
- **Compound intent:** served one at a time, most actionable first, with the second held **in the conversation** for the remainder of the session only.

---

## 6. First Value branches

`intent → minimum intelligence → existing capability → first useful outcome`

### Fully supported today

| Intent | Minimum intelligence | Capability | First useful outcome |
|---|---|---|---|
| **Exploration** | nothing beyond WHO | `barryOrientationBrief` | An honest orientation from real platform state, correct at zero ICP |
| **Communication** | one email (Gmail connected) | `barryInboxAnalyzer`, `gmail-sync-worker` | One analyzed email with a suggested reply |
| **Outreach** | one named recipient + purpose | `prepareContactWrite` → `generate-engagement-message` | A drafted message to that person |
| **Pipeline** | one named contact with any history | `barryHunterCardRead`, `barryPipelineAction` | A status snapshot and a next step |
| **Prospecting** *(post-confirmation)* | ≥1 supported retrieval constraint | `handleConfirm` → `search-companies` | A real, attributed company list |

### Supported, with reduced first value

| Intent | Reduced how | Capability | Outcome delivered |
|---|---|---|---|
| **Engagement** | **no news producer exists** | contact record + `assembleBarryContext` + message generation | A reconnect suggestion and draft from stored context and elapsed time — **not** "here's what's new at their company" |
| **Preparation** | no meeting-brief surface traced; calendar exists | calendar + contact/company context | Context on the person and company for a named meeting — assembled, not a purpose-built briefing |

### Future capability — not in Phase 2

| Intent | Missing producer |
|---|---|
| **Referral** | No relationship graph. Second-degree path detection has no producer. **Excluded from Phase 2 First Value**, per instruction |
| Engagement "recent news" | No news source |

**Acceptance floor (P-7):** the two tables above. Where v1.0 describes a richer outcome, the difference is roadmap. **Nothing is simulated to close the gap** — if Barry cannot know it, Barry does not say it.

---

## 7. Prospecting — confirmation-before-search

**Locked sequence (P-9):**

```
discover → infer → clarify → propose targeting → USER CONFIRMS → ICP created/updated → Scout searches
                                                       ▲
                              nothing crosses this line without an attributable ICP identity
```

**Step by step, against existing code:**

1. **Discover** — website accelerator if offered (§8); otherwise nothing.
2. **Infer** — `barryICPConversation` extracts candidate targeting from the transcript.
3. **Clarify** — existing multi-turn loop. Barry asks only what it cannot infer.
4. **Propose** — `ICPConfirmationCard` renders the proposed definition.
5. **Confirm** — user acts. **This is the authorized creation event.**
6. **Create** — `handleConfirm`: resolve → write `icpProfiles/{icpId}` → activate → project the bridge carrying `icpId`.
7. **Search** — `search-companies` with explicit `icpId`, D7-gated.

**Quality floor, as locked:** **one** supported retrieval constraint is sufficient to attempt First Value. `hasRetrievalConstraint` already implements exactly this — industries, companyKeywords, companySizes, locations, isNationwide, or foundedAgeRange. **No count, percentage or completeness rule is added.**

**Broad-result honesty:** with one constraint the search runs and Barry says the result is broad. This is FV-4, and the copy hook already exists in Tier 4's `NEEDS_TARGETING` panel treatment.

**Zero supported constraints:** Barry asks **one** useful question — *"What kind of companies are you trying to reach? Even a rough direction helps."* Not a form, not a wizard, not a field list. If the user confirmed a definition that carries no supported constraint, existing behaviour already applies: ICP created, no search, `barryState: 'NEEDS_TARGETING'`, and Mission Control explains it is not a failure.

**Prohibited, restated:** no provisional targeting object, no temporary ICP identity, no anonymous discovery, no unattributed company persistence.

---

## 8. Website accelerator — wiring on facts only

**What `analyze-website` actually produces** (8 fields + a self-reported `confidence`, with an explicit no-invention instruction):
`companyName`, `description`, `whatTheySell`, `whoTheyServeTo` → RECON §1 · `targetIndustry`, `targetCompanySize`, `valueProposition`, `icpSummary` → `modules[recon].websiteAnalysis`.

**It does not produce:** the user's location, the user's own company size, competitive landscape, role, or team. Nothing in this plan claims otherwise.

**The gap, stated plainly.** `targetIndustry` and `targetCompanySize` are **free text** ("Mid-market", "healthcare and adjacent services"). Scout accepts **enumerations**: `industries[]` must match the 147 canonical `APOLLO_INDUSTRIES` names; `companySizes[]` must match the 11 buckets `"1-10" … "10,001+"`; `locations[]` must be US state names. **No translation layer exists.**

### T-1 — Targeting Translation (new bounded logic, identified as required)

The only new logic this plan introduces. Deliberately small and deliberately timid.

**Contract:**
- **Input:** `{ targetIndustry: string, targetCompanySize: string }` from `analyze-website`.
- **Output:** `{ industries: string[], companySizes: string[] }` — values drawn **only** from the two existing enumerations.
- **Invariant 1 — never invent.** No confident match ⇒ the field is **omitted**, not guessed. An omitted field means Barry asks; a wrong field means Barry searches for the wrong thing and calls it targeted.
- **Invariant 2 — proposal only.** Output feeds the **confirmation card**. It never writes an ICP and never reaches `buildApolloQuery` directly. The user confirms; `handleConfirm` writes. P-9 holds unchanged.
- **Invariant 3 — no new vocabulary.** The enumerations are the ones ICP Settings already uses. T-1 introduces no lists of its own.

**Test contract:**
| Case | Expected |
|---|---|
| exact industry name ("Accounting") | maps to that name |
| close variant ("accounting services") | maps, or omits — **never** maps to a different industry |
| unmatched ("vibes-based consulting") | **omitted**, no throw |
| "mid-market" | maps to a defensible bucket set, or omits |
| "50-200 employees" | maps to overlapping buckets |
| free text with no size signal | omitted |
| any input | output values ⊆ the existing enumerations — property-tested |
| any input | never returns an empty-string entry |

**Placement:** a pure client-side utility beside the confirmation step. Not in `icpScoring.js` (Tier 2 file), not in `search-companies.js` (Tier 3 file), not in `analyze-website` (which must keep producing exactly what it produces).

---

## 9. Networker / zero-contact path

**Question asked: is naming one person sufficient to produce useful value with existing capabilities? Yes — with one honest caveat.**

```
user names a person (+ company if known)
   → prepareContactWrite  (identity resolution, dedupe)
   → contact exists
   → barryEnrich          (Apollo + linkedinSearch → title, company, LinkedIn URL)
   → assembleBarryContext (whatever relationship context now exists)
   → generate-engagement-message
   → a real drafted reconnect message
```

Every step exists. **First Value is a drafted message informed by real enrichment**, not an insight about the relationship — because with zero prior history there is no relationship intelligence yet.

**Caveats to state in the plan, not paper over:**
- `barryEnrich` spends Apollo credits. First Value for this path has a per-user cost; the owner should know that before it ships.
- Enrichment can return nothing. Then First Value is a draft from the name and stated purpose alone — thinner, still real, and Barry says so.
- **No news. No second-degree referral.** Excluded, per §6.

**The stronger path when available:** Gmail connect turns Engagement First Value from "a draft" into "twelve people you haven't spoken to in six months" — real, specific, requiring no ICP. It is **offered at the moment it would pay off**, never as a step (INT-5).

---

## 10. Returning / resumable experience

**No separate returning flow is built.** One route, state-aware.

| Returning state | Source | Behaviour |
|---|---|---|
| Conversation in progress | `barryConversations/icp.messages` + `.status` | Resume mid-conversation |
| ICP already exists | `resolveActiveIcp` | Open on refinement, using `buildReturnGreeting` |
| Step progress | `useOnboardingState.markStep` / `currentStep` | Resume at the furthest point |
| Nothing yet | — | Begin |

This is what makes §1's redirect of the three existing-user affordances correct rather than destructive.

---

## 11. Completion semantics

**Replace "onboarding complete" as a goal with First Value delivered as the milestone.** But the flags stay, and here is the blast radius that says why.

| Flag | Written by | Read by | Disposition |
|---|---|---|---|
| `onboardingComplete` | `BarryOnboarding:428`, `ReconOnboardingWizard:132` | `App.jsx:321` (SmartRedirect), `ReconOnboardingWizard:78`, `useOnboardingState:157` | **KEEP.** SmartRedirect uses it to stop sending returning users into onboarding. Removing it loops every existing user back |
| `onboarding.completed` | `markStep('completed')` | `useOnboardingState:76`, `App.jsx:321` | **KEEP.** Same gate, second form |
| `onboardingSource` | `BarryOnboarding:427` | `MissionControlDashboardV2` `isFirstRun` | **KEEP.** Half the first-run gate |
| `hasSeenMCWelcome` | `BarryOnboarding:430`, MC "seen" handler | `MissionControlDashboardV2` `isFirstRun` | **KEEP.** Other half |
| `barryState` | `handleConfirm`, `search-companies`, MC retry | `FirstRunView` (Tier 4) | **KEEP.** Carries `NEEDS_TARGETING` |

**Ruling for the plan:** all five are **compatibility fields**, written by the new experience with the same meanings. Not one is removed in Phase 2 — the blast radius is Mission Control's entire first-run view plus the redirect that keeps returning users out of onboarding. Retiring them needs its own evidence pass, and belongs after the new experience has shipped and settled.

**New semantics layered on top, not replacing:** First Value delivered is the moment that matters. It is an **analytics** concept (§12), not a new persisted gate — adding a `firstValueDelivered` field would recreate the completion-flag problem in new clothes.

---

## 12. Analytics — definitions only, no implementation

Eight events. Each names the observable condition that fires it, so it cannot drift into "we think this happened".

| Event | Fires when |
|---|---|
| `first_experience_started` | canonical route mounts for an authenticated user |
| `who_established` | a name is known — from signup or the first turn |
| `intent_understood` | classification returns a category with confirmation, or the user confirms Barry's restatement |
| `first_value_attempted` | Barry begins the capability call for the routed intent |
| `first_value_delivered` | that call returns a real result rendered to the user |
| `targeting_proposed` | the confirmation card renders a proposed definition |
| `targeting_confirmed` | the user confirms — **the authorized ICP creation event** |
| `first_discovery_executed` | `search-companies` returns success for that `icpId` |

**Properties worth carrying** (declared here, implemented later): intent category, accelerators used, whether a name was supplied at signup, `hasRetrievalConstraint` at confirmation, ICP resolution state, and time from start to `first_value_delivered` — the number this whole phase exists to move.

**Not implemented in Phase 2 unless separately authorized.** No new telemetry infrastructure is proposed; `logApiUsage` already exists if these land on an existing pipe.

---

## 13. Implementation batches

Smallest ordered batches. Each is independently revertible. Each ships behind its own PR against `main`, branched from the merged Phase 1B baseline.

| # | Batch | Depends on | Rollback boundary | Tests | Crosses a boundary? |
|---|---|---|---|---|---|
| **B1** | Optional name at signup (§4) | — | One field + one write. Revert = delete the field | signup submits with and without a name; blank is valid; no path gates on it | **No** |
| **B2** | Canonical route + redirects (§1) | — | Route table only. Revert = restore routes | every legacy entry lands on the canonical route; existing-user affordances resume rather than restart | **No** |
| **B3** | Intent classification in the existing endpoint (§5) | B2 | Additive response field. Revert = ignore it | each category classifies; ambiguity confirms rather than re-asks; **no intent field is persisted anywhere** | **No** |
| **B4** | Intent → First Value routing, fully-supported intents only (§6) | B3 | Routing layer. Revert = single default branch | one test per supported intent: minimum intelligence in → real outcome out | **No** |
| **B5** | Prospecting confirmation-before-search (§7) | B4 | Reuses `handleConfirm` intact | the locked sequence in order; one constraint suffices; zero constraints asks one question; no unattributed persistence | **No** — reuses verified Phase 1B paths |
| **B6** | **T-1 targeting translation** (§8) | B5 | Pure utility. Revert = accelerator proposes nothing, Barry asks | the §8 test contract, including the property test | **New bounded logic** — flagged |
| **B7** | Website accelerator wired to the proposal (§8) | B6 | Optional path. Revert = accelerator not offered | offered not required; failure degrades to conversation; output reaches only the confirmation card | **No** |
| **B8** | Reduced-value intents: Engagement, Preparation (§6, §9) | B4 | Two branches | honest outcomes only; **no news, no second-degree** asserted by test | **No** |
| **B9** | Retire `OnboardingFlow`'s six-step orchestration + the four questions (P-8) | B2, B4 | Deletion. Revert = restore | no route reaches it; **stored historical data untouched** | **No** |
| **B10** | Resumability + returning states (§10) | B2 | Reuses existing state | each returning state resumes correctly; no second flow exists | **No** |

**Not in any batch, and not to be added without separate authorization:** analytics implementation (§12), multi-company context switching (P-4), résumé/LinkedIn/social ingestion (P-6), referral and news producers (§6), removal of any compatibility flag (§11), pre-payment access (P-2).

**Boundary crossings: exactly one — B6.** It is new logic, it is bounded, its invariants and test contract are stated, and it touches no Tier 2 or Tier 3 file.

**Branch/PR strategy:** one branch per batch off the merged baseline, named `claude/team-a-p2-b{n}-{slug}`; one PR each; B1–B2 and B3–B5 may run in parallel, B6–B7 are sequential, B9 lands only after B4 proves the replacement works. The Phase 1B collision discipline carries forward: if two batches need the same file, stop and report rather than resolving it in a merge.

---

## 14. Confirmation

No application code. No screens. No schema. No tenancy. No LinkedIn, social or résumé processing. No new ICP builder. No persistent intent storage. No provisional targeting object, temporary ICP identity, anonymous discovery, or unattributed company persistence. No Phase 1B ruling reopened.

**Returned for owner review. Holding.**
