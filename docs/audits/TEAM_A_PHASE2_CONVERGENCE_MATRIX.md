# Team A — Phase 2 Convergence Matrix

**Convergence of Team A Phase 2 Discovery against Team B's Barry First Experience Semantic Design v1.0 (`40e8e62`).**
No implementation. No screens. No schema. No tenancy. Phase 1B not reopened.
Repository state: `claude/team-a-nz6kaz` @ `354e687`.

---

## 0. The headline finding

**Three of Team B's five journeys deliver first value as "a set of real companies" produced from *proto-targeting intelligence* that is explicitly "not yet an ICP object." That search cannot execute today, and it is Phase 1B that stops it.**

`search-companies` returns `400 ICP_REQUIRED` when `icpId` is absent (Tier 1, item 11), and every discovered company is persisted with `icpId` — there is no unattributed write path left. This was deliberate: it is the fix for the fabrication defect that started this whole phase.

So Journeys 1, 2 and 4 need an answer to a question neither document has asked: **what identity is a proto-targeting search attributed to?** This is not a contradiction in v0.4 — it is an unresolved interface between v0.4's *proto-targeting* concept and Phase 1B's *attribution invariant*. It is §12's first item and, in my view, the decision that gates Phase 2.

---

## 1. Journey convergence matrices

Classification: **EXISTS** · **REUSABLE BUT RESEQUENCE** · **PARTIAL** · **NEW CAPABILITY** · **ARCHITECTURAL BLOCKER**

### Journey 1 — The Minimalist (name only → Exploration → Prospecting)

| Step | Capability required | Repository reality | Class |
|---|---|---|---|
| User arrives | Auth + payment | `Signup` → Stripe → `CheckoutSuccess` | EXISTS |
| WHO acquisition | Capture name | **No name field anywhere.** `OnboardingFlow:335` reads `data.firstName \|\| data.displayName \|\| data.name`; none is ever written. The greeting `Hi{firstName}` is permanently empty | **PARTIAL** — read path exists, producer does not |
| Intent understanding | Free-text intent → category | `BarryOnboarding` extracts *targeting* from free text; no intent classifier | **PARTIAL** — extraction pattern reusable, intent taxonomy is new |
| Intelligence available | Email + domain | Email on `users/{uid}`; **domain→company inference not implemented** | PARTIAL |
| Barry action — Exploration | Orientation brief | `barryOrientationBrief` — live, and after Tier 4 carries User + ICP scope and handles zero-ICP honestly | **EXISTS** |
| Barry action — Prospecting | Search from "tech companies" | `buildApolloQuery` accepts `industries[]`; **but `search-companies` refuses without `icpId`** | **ARCHITECTURAL BLOCKER** (§0) |
| First useful outcome | A set of real companies | Not reachable without an ICP identity | **BLOCKER** |

**Exploration first value is fully reachable today.** Prospecting first value is not.

### Journey 2 — The Website Provider (name + site → Prospecting)

| Step | Capability required | Repository reality | Class |
|---|---|---|---|
| WHO acquisition | name + website | Website capture EXISTS (`OnboardingFlow` step 2); name PARTIAL as above | REUSABLE BUT RESEQUENCE |
| Website inference | company, industry, **size**, **location**, positioning | `analyze-website` extracts exactly 8 fields: `companyName`, `description`, `whatTheySell`, `whoTheyServeTo`, `targetIndustry`, `targetCompanySize`, `valueProposition`, `icpSummary` — plus a `confidence` score, with an explicit "do not invent facts" instruction. **No location. No user's-company employee count. No competitive landscape.** | **EXISTS**, but see the over-claim below |
| Confirmation | "SecureLane is a cloud security platform in Austin — right?" | Barry cannot say "Austin" or "~50 employees". Those are not extracted | **PARTIAL** — confirmation pattern exists (`ICPConfirmationCard`), content does not |
| Targeting from website | industry + size + location → Apollo | `targetIndustry`/`targetCompanySize` are **free text** ("Mid-market"); `buildApolloQuery` needs `industries[]` and Apollo bucket labels (`"11-20"`) and US state names. **No mapping layer exists** | **NEW CAPABILITY** (translation), then BLOCKER (§0) |
| Store | website intelligence → targeting | Writes RECON §1 + `modules[recon].websiteAnalysis`. **Never reaches `icpProfiles`, never reaches `buildApolloQuery`** | REUSABLE BUT RESEQUENCE |
| First useful outcome | targeted companies | Blocked twice: no format translation, no ICP identity | **BLOCKER** |

> **Over-claim to correct in v1.0:** Journey 2 asserts Barry infers "company size ~50 employees" and "location Austin, TX" from the website. It does not. Also, `targetCompanySize` describes the **target customer's** size, not the user's company size — v1.0's WHO table lists "Company size — inferable" as a WHO property, conflating the two. **Repository evidence contradicts the journey as written.**

### Journey 3 — The Networker (Engagement + Referral, zero ICP)

| Step | Capability required | Repository reality | Class |
|---|---|---|---|
| Intent → compound | Engagement + Referral | No classifier | PARTIAL |
| "Name three clients" → contacts | Create contacts from names | `prepareContactWrite` / `applyContactMerge` exist with identity resolution; used by `PipelineSection`, `CompanySearch` | **REUSABLE BUT RESEQUENCE** |
| Relationship snapshot | contact + history + context | `assembleBarryContext`, `barryHunterCardRead`, `barryOutcomeAttribution` | **EXISTS** |
| **"Recent news about their company"** | a news source | **No news capability of any kind in the repository** | **NEW CAPABILITY** |
| Conversation starters / follow-up suggestion | generated from relationship context | `generate-engagement-message`, `barryGenerateSequenceStep` | **EXISTS** |
| **Referral: "second-degree connection pattern"** | relationship graph | **No graph, no connection inference.** Contacts are flat records | **NEW CAPABILITY** |
| Zero-ICP operation | no ICP required | Guaranteed by Tier 1/2/4 and asserted by test | **EXISTS** |
| First useful outcome | a snapshot for one named contact | **Reachable** if scoped to snapshot + follow-up suggestion, **not** if it includes news or referral-path detection | **PARTIAL** |

### Journey 4 — The Aspiring Prospector (no targeting → proto-targeting from past clients)

| Step | Capability required | Repository reality | Class |
|---|---|---|---|
| "Who were your best clients?" | conversational elicitation | `BarryOnboarding` conversation loop | REUSABLE BUT RESEQUENCE |
| Infer proto-targeting from examples | examples → criteria | `BarryOnboarding` extracts targeting from free text — the closest existing capability | **PARTIAL** (extracts from description, not from client examples) |
| **"Near Dana's inferred location"** | user location | **Never captured or inferred anywhere** | **NEW CAPABILITY** |
| Confirm targeting | confirmation event | `BarryOnboarding.handleConfirm` — the **authorized** ICP creation event | **EXISTS** |
| Search on proto-targeting *before* confirmation | unattributed search | Prohibited (§0) | **ARCHITECTURAL BLOCKER** |
| Search after confirmation | ICP-targeted search | Full path exists and is D7-gated | **EXISTS** |
| First useful outcome | a first batch of companies | **Reachable only if the confirmation event precedes the search** | REUSABLE BUT RESEQUENCE |

**Journey 4 is the one prospecting journey that converges cleanly** — because it already routes through a confirmation before value. Its only true gap is location.

### Journey 5 — The Multi-Company Operator

| Step | Capability required | Repository reality | Class |
|---|---|---|---|
| Recognize multi-company | conversational | — | PARTIAL |
| "I can work with you across all three" | multiple Workspaces per User | **No Workspace object exists.** Everything is `users/{uid}/…`; `ShellContext.jsx:327` documents this as known drift: *"Idynify has no tenant/organization model today"* | **ARCHITECTURAL BLOCKER** |
| Establish first context | active Workspace | No concept of an active Workspace | **ARCHITECTURAL BLOCKER** |
| Remember the other two | per-Workspace intelligence | Would land in the same `users/{uid}` store — the **leak** v1.0's own anti-patterns forbid | **ARCHITECTURAL BLOCKER** |
| Context switching | switch active Workspace | Does not exist | **ARCHITECTURAL BLOCKER** |
| First useful outcome | value in context one | Reachable — **as a single-context user** | EXISTS, with the truthful caveat below |

---

## 2. Answers to the twelve questions

**1 — Minimum WHO establishable without a profile wizard.**
`email` (auth) and, from it, an email **domain**. Everything else in v1.0's "Required now" row is absent: no name, no company, no website, no role, no location. The honest floor today is *email + domain*. Name is one field at signup — where a user already expects to type — and needs no wizard.

**2 — What Barry can reliably infer from a website today.**
Exactly eight fields, with a self-reported `confidence` score and a no-hallucination instruction: `companyName`, `description`, `whatTheySell`, `whoTheyServeTo`, `targetIndustry`, `targetCompanySize`, `valueProposition`, `icpSummary`. Four map to RECON §1; four land in `modules[recon].websiteAnalysis`. **Not inferred: location, the user's own company size, competitive landscape, role, team.**

**3 — Intent categories mapping to reachable capability today.**

| Intent | Reachable? | Via |
|---|---|---|
| Exploration | **Yes** | `barryOrientationBrief` |
| Communication | **Yes** (with Gmail) | `barryInboxAnalyzer`, `gmail-sync-worker` |
| Outreach | **Yes** | `generate-engagement-message`, `barryOutreachMessage` |
| Pipeline | **Yes** | `barryPipelineAction`, `barryHunterCardRead` |
| Engagement | **Partial** | contact + context exist; "recent news" does not |
| Preparation | **Partial** | calendar exists; no meeting-brief surface traced |
| Referral | **No** | no relationship graph |
| Prospecting | **Blocked** pre-ICP; **Yes** post-confirmation | §0 |
| Compound | **No** | no classifier or intent memory |

**4 — Smallest real, non-simulated first value per intent, with today's capabilities.**

| Intent | Smallest real first value available now |
|---|---|
| Exploration | The orientation brief — real platform state, honest about a zero-ICP workspace |
| Communication | One analyzed email with a suggested reply |
| Outreach | One drafted message to one named person |
| Pipeline | A status snapshot for one named contact |
| Engagement | A follow-up suggestion for one contact, from stored engagement history — **without** news |
| Preparation | Contact + company context for one named person |
| Prospecting | **Nothing, pre-confirmation.** Post-confirmation: a real, D7-constrained company list |
| Referral | Nothing real today |

**5 — What survives from `BarryOnboarding`.**
The free-text → targeting extraction; the **confirmation event** `handleConfirm` (v0.4-amend Part VI #16 authorizes it by name); `ICPConfirmationCard`; the conversational clarify/confirm loop; `barryConversations/icp` persistence for resumability; the D7 constraint gate. **Retire:** "Who are you hunting?" as the universal opening — it presumes Prospecting.

**6 — What survives from `OnboardingFlow`.**
`analyze-website` invocation (the capability, not the step); `useOnboardingState` step/resume machine; the skip-everything affordances; `BarryTyping`/`BarrySays` conversational presentation. **Retire:** the six-step linear sequence, the four smart questions (no consumer), the Gmail step's position before any value, and step 5's "build list" — which after Tier 2 only re-derives Match over companies that may not exist.

**7 — Orchestration to retire outright.**
The **two-flow topology itself**. `SmartRedirect → /onboarding` vs `CheckoutSuccess → /onboarding/barry` must collapse to one entry. Also retire: `/onboarding/company-profile` (`CompanyQuestionnaire` — search removed in Tier 3, write is deferred debt); "onboarding complete" as a boolean that two different flows can set with different outcomes; and any framing where completion, rather than value, is the goal.

**8 — Prospecting user with insufficient targeting intelligence.**
**Confirmed: Barry can refine and confirm targeting without fabricating an ICP-targeted search.** The machinery is already built and tested — `hasRetrievalConstraint` gates the first search on ≥1 field that demonstrably narrows an Apollo query (industry, keywords, size, location, nationwide, founded-age); a confirmed definition carrying none produces `barryState: 'NEEDS_TARGETING'`, no search, and a Mission Control panel that says an ICP exists and one more detail is needed. `search-companies` refuses an identity-less request outright. **What Barry cannot do today is search *before* the confirmation**, which is precisely what §0 raises.

**9 — Zero-ICP journeys.**
**Confirmed.** Engagement, Referral, Communication, Preparation, Pipeline, Outreach and Exploration require no ICP, and Phase 1B enforces it: no surface hard-fails on a missing ICP, every server-side ICP read is guarded on an id, `getActiveIcpId` returns `null` rather than a fabricated id, and the four Hunter clients send `icpAttribution:'unresolved'` instead of inventing one. Asserted by test in `barryCompositionInvariant.test.js` and `icpIdentityInvariants.test.js`. *(Capability gaps in Referral and Engagement are separate from ICP — see Q3.)*

**10 — Accelerator classification.**

| Accelerator | Class | Evidence |
|---|---|---|
| **Company website** | **EXISTS** | `analyze-website` — 8 fields, confidence, friendly failure, never overwrites user input |
| **Gmail** | **EXISTS** | OAuth, `gmail-sync-worker`, `barryInboxAnalyzer`, send/reply |
| **Calendar** | **EXISTS** | Google Calendar integration, consumed by `barryContextStack` |
| **Free-form biography** | **PARTIAL** | Free-text → *targeting* extraction exists; free-text → *WHO* does not |
| **LinkedIn** | **PARTIAL, and not what it sounds like** | `linkedinSearch.js` is a **Google Custom Search lookup for a contact's profile URL**, used by `barryEnrich`. It is not profile ingestion, and it targets prospects, not the user. Treating it as a WHO accelerator would be a new capability |
| **Facebook / social** | **NEW CAPABILITY** | Nothing |
| **Résumé / document upload** | **NEW CAPABILITY** | No storage bucket, no upload route, no parser |

**Can the future First Experience accommodate the missing ones without redesign?** Yes — if accelerators are modelled as *optional inputs to an inference step* rather than steps in a sequence. v1.0's FE-6 and INT-1 already state this. The requirement that follows: the WHO step must accept "zero or more accelerators" from the first version, so adding résumé ingestion later is a new input to an existing step rather than a new step.

**11 — v1.0 assumptions requiring infrastructure the repository lacks.**

| # | Assumption | Missing infrastructure |
|---|---|---|
| A-1 | Proto-targeting searches run before ICP confirmation | An attribution model for identity-less discovery (§0) — **blocking for 3 journeys** |
| A-2 | User is associated with multiple Workspaces | Any Workspace object at all |
| A-3 | Website yields location and company size | Extraction fields that do not exist |
| A-4 | "Companies near the user's location" | User location is never captured or inferred |
| A-5 | "Recent news about their company" | No news source |
| A-6 | Referral = second-degree connection detection | No relationship graph |
| A-7 | Intent classification and compound-intent memory | No intent taxonomy, classifier, or store |
| A-8 | Corrections supersede inferences, with provenance | No provenance/confidence model on stored intelligence (the Intelligence Rule is stated, not implemented) |
| A-9 | Résumé/LinkedIn/Facebook ingestion | Not built; LinkedIn util is unrelated |
| A-10 | Name is available to greet the user | Never captured |
| A-11 | Email domain → probable company | Not implemented |

**12 — Phase 1B / v0.4 contract interpretations the design requires.**

| # | Interpretation needed | Why |
|---|---|---|
| **I-1** | **Is a proto-targeting search an "ICP-targeted search"?** If yes, it requires an ICP and v1.0's pre-confirmation searches are prohibited. If no, what identity are the resulting companies persisted under? Every company row carries `icpId` and there is no unattributed path | **The gating interpretation.** Touches D7, the Attribution Invariant, and Tier 1's `ICP_REQUIRED` refusal |
| **I-2** | Does accumulating proto-targeting intelligence create a **store** that must satisfy the Intelligence Rule (ownership, provenance, confidence, freshness, purpose)? | v1.0 says proto-targeting is "attributed per the Intelligence Rule" but names no home. If it lands in `icpProfiles` it *is* an ICP; if elsewhere, that is new schema |
| **I-3** | Is **INTENT** an intelligence type under v0.4, and in which scope? | v1.0 makes intent the router; v0.4 has no Intent type. Same question as my P-5 |
| **I-4** | Does "Company is Workspace intelligence" oblige a Workspace object, or is `users/{uid}` an acceptable degenerate single-Workspace case for Phase 2? | Determines whether Journey 5 is deferred or blocking |
| **I-5** | Does Barry proposing a targeting definition from *conversation* (Journey 4) qualify under the same authorization as `handleConfirm`, or only the onboarding interaction named in Part VI #16? | Part VI #16 authorizes the named interaction; #19 leaves the general design undecided |

**No genuine contract contradiction found.** These are interfaces v0.4 leaves open, not conflicts. Phase 1B is not reopened.

---

## 3. Multi-company boundary — the truthful answer

**Phase 2 must acknowledge the limitation and continue in one selected company context.** Stated plainly, as requested.

What Phase 2 **can** safely do for someone who says *"I work with more than one company"*:

1. **Not treat it as an error.** It is normal, and the user should not be corrected.
2. **Ask which one to start with** — v1.0's step 3, which is sound and needs no tenancy.
3. **Deliver full first value in that context.**
4. **Record the other company names as user-stated intelligence** — text Barry was told, not configured Workspaces.
5. **Say what is true:** Barry works in one company context at a time today, and switching is not yet supported.

What Phase 2 **must not** do: imply the other companies are set up; promise "Ready to work on TerraGrid?" when no context switch exists; or create per-company data under `users/{uid}` that would leak between contexts — the exact anti-pattern v1.0 §Multi-Company Anti-Patterns forbids, which the current schema would produce by construction.

**Naming the risk precisely:** v1.0's Journey 5 promises context switching. Building the conversation without the substrate produces a *worse* outcome than declining — the user is told Barry holds three companies, then discovers all three share one contact list, one RECON, one set of integrations.

---

## 4. Owner decision packet (P-1 … P-8, revised on combined evidence)

I make no rulings.

### P-1 — Which flow is the canonical First Experience?
**Evidence:** Two flows; `CheckoutSuccess → BarryOnboarding` (creates ICP, searches) and `SmartRedirect → OnboardingFlow` (creates nothing, searches nothing); both set onboarding-complete. Team B accepts neither should survive unchanged.
**Recommended ruling:** One entry point. Keep `BarryOnboarding`'s conversational loop, extraction and **authorized confirmation event** as the spine; fold in `analyze-website` as an optional accelerator; retire `OnboardingFlow`'s six-step sequence and `/onboarding/company-profile`.
**If approved:** one flow to build against; the ICP creation event stays where v0.4-amend authorized it.
**If deferred:** Phase 2 builds a *third* flow, and the split-outcome defect persists.

### P-2 — Does Barry provide meaningful value before payment?
**Evidence:** `ProtectedRoute` and `SmartRedirect` both gate on `hasCompletedPayment`; no Barry surface is reachable before checkout.
**Recommended ruling:** **None — explicitly reserved as an owner/business decision**, per instruction.
**If approved (pre-payment value):** the First Experience must run for an unpaid user; every Barry surface it touches needs a cost/abuse posture.
**If deferred:** "give Barry almost nothing and it starts helping" begins after checkout. Legitimate, but the objective's framing should say so.

### P-3 — Is name captured at signup?
**Evidence:** Signup writes email, tier, credits, payment state. `OnboardingFlow:335` reads three name fields, none of which is ever written. Team B classifies name "Required now — cannot be inferred." Owner has said this is not authorization for a mandatory form.
**Recommended ruling:** Capture a single optional name field at signup, and let Barry ask conversationally if it is blank. Satisfies "required" without a wizard, and fixes an already-broken greeting.
**If approved:** WHO's one un-inferable fact is acquired where users expect to give it.
**If deferred:** Barry either greets no one or opens by asking a question the signup form should have taken.

### P-4 — Multi-organization: solve, defer, or out of scope?
**Evidence:** No Workspace object; `ShellContext.jsx:327` documents the drift; Team B's model assumes multiple Workspaces per User.
**Recommended ruling:** **Defer the architecture; permit the acknowledgement.** Phase 2 recognises the pattern, asks which to start with, records the others as stated intelligence, and states the single-context limit honestly. No tenancy work.
**If approved:** Journey 5 users get a truthful experience now; tenancy stays a scoped future project.
**If deferred entirely (no acknowledgement):** these users are silently mis-served, which is what happens today.

### P-5 — Is intent durable intelligence?
**Evidence:** v0.4 has no Intent type. v1.0 makes intent the router and requires compound-intent memory ("Barry remembers the others"). No intent store exists.
**Recommended ruling:** Team B rules on whether Intent is a named intelligence type and its scope (**I-3**) before Phase 2 implementation. Routing-only needs no store; memory does.
**If approved as a type:** intent gets ownership, provenance and freshness like every other intelligence.
**If deferred:** intent is per-session routing only, and compound-intent memory must be dropped from the journeys.

### P-6 — Is document/résumé ingestion in Phase 2 scope?
**Evidence:** No storage, upload route or parser. v1.0 treats it as an optional accelerator with defined semantics.
**Recommended ruling:** **Out of Phase 2 build scope, in Phase 2 design scope.** The WHO step should accept zero-or-more accelerators so it can be added later without redesign.
**If approved:** no new infrastructure now; no rework later.
**If deferred without the design accommodation:** adding it later means reopening the First Experience.

### P-7 — What is "first useful outcome" per intent?
**Evidence:** v1.0 §First Value by Intent Type gives eight definitions; my Q4 gives what is achievable today. **They differ for Prospecting, Engagement and Referral.**
**Recommended ruling:** Adopt v1.0's definitions as the target and my Q4 column as the **Phase 2 acceptance bar**, marking the difference as roadmap rather than shipping short.
**If approved:** an unambiguous, testable success criterion per journey.
**If deferred:** Phase 2 ships against aspirational outcomes and fails its own tests.

### P-8 — What happens to the four consumer-less onboarding questions?
**Evidence:** `excludedIndustries`, `idealCustomerTypes`, `perfectCustomer`, `valueProposition` written as top-level `dashboards/{uid}` fields; no reader. Owner has accepted they should not automatically carry forward.
**Recommended ruling:** Drop all four from the First Experience. `valueProposition` is already captured better by `analyze-website`; `excludedIndustries` is the third disconnected home of `avoidIndustries` (Tier 3 debt). Leave the stored data alone — cleanup is Category 2.
**If approved:** four questions removed, nothing lost.
**If deferred:** the First Experience inherits questions that violate the Intelligence Rule at the moment they are asked.

### P-9 *(new — arising from convergence)* — Proto-targeting search attribution
**Evidence:** §0 and **I-1**. Three journeys depend on it; `search-companies` refuses without `icpId`; every company row carries one.
**Recommended ruling:** Route to Team B as a v0.4 interface question **before** Phase 2 implementation. Three shapes exist: (a) confirmation always precedes search — Journey 4's shape, no new semantics, journeys 1 and 2 re-sequenced; (b) a named provisional-targeting object with its own identity and lifecycle — new semantics and schema; (c) searches remain ICP-gated and pre-ICP first value is non-Prospecting.
**If approved (any shape):** the three journeys become buildable.
**If deferred:** Phase 2 either cannot deliver Prospecting first value, or delivers it by weakening the attribution invariant Phase 1B exists to protect.

---

## 5. Confirmation

No code. No screens. No schema. No tenancy. No LinkedIn or social work. No résumé parser. No ICP builder. No Phase 1B ruling reopened, and no genuine contract contradiction found — the five items in §2 Q12 are open interfaces, returned for Team B and owner resolution.

**Returned for convergence.** Outcome recorded in §6.

---

## 6. Convergence outcome — owner rulings recorded

Matrix accepted. The headline finding is now authoritative for convergence:

> **Phase 1B intentionally prevents unattributed company discovery.** A proto-targeting conversation cannot directly produce persisted company results without an explicit ICP identity. This is not a defect in Phase 1B — it is the boundary Phase 2 designs around.

All four journey corrections in §1 are accepted as stated.

### Approved

| Decision | Ruling |
|---|---|
| **P-1** | One canonical First Experience. `BarryOnboarding`'s conversational loop, clarification/confirmation pattern and explicit targeting-confirmation boundary are reusable **spine components**; `analyze-website` becomes an optional accelerator; `OnboardingFlow`'s six-step orchestration does not survive. **Explicitly not authorization to rename `BarryOnboarding` and ship it unchanged.** |
| **P-3** | Lightweight name acquisition. A single **optional** field at signup is acceptable; Barry may ask conversationally if absent. No profile wizard, and **no name-based gate before First Value**. |
| **P-4** | Multi-company architecture deferred. Phase 2 may recognise several organisations, ask which to start with, and acknowledge the rest as user-stated information. **Product truth: one company context at a time.** No tenant or schema work. |
| **P-6** | Résumé/document, user-LinkedIn and Facebook/social ingestion are **outside Phase 2 build scope**. They remain valid future accelerators, and the First Experience must not need redesign to admit them. |
| **P-7** | Team B's First Value definitions are the long-term semantic target; the repository-backed Q4 outcomes are the **Phase 2 acceptance floor**. Capabilities that do not exist are **not to be simulated** to satisfy an aspirational journey. |
| **P-8** | The four consumer-less smart questions are removed from the canonical First Experience. Historical stored data is left untouched. |

### Pending — Phase 2 scope is not authorized until these return

| # | Item | State |
|---|---|---|
| **P-2** | Barry before payment | **Owner/business decision. No team ruling.** |
| **P-5** | Intent durability | Team B to return a contract interpretation, not product authority. **Owner leaning:** intent begins as lightweight routing context and becomes Mission intelligence only if it persists into an ongoing objective. **Do not implement persistent intent storage** until that interpretation is confirmed and locked. |
| **P-9** | Proto-targeting attribution | **Owner direction: confirmation-before-search is preferred.** Proto-targeting may exist conversationally before an ICP exists, but an ICP-targeted search must not run until the user explicitly confirms the targeting definition and an attributable ICP identity exists. Team B is validating semantic compatibility with v0.4 / v1.1. **Do not design provisional targeting IDs, anonymous discovery, or unattributed company persistence.** |

Also awaiting Team B: the **Journey 2 corrections** (§1).

### State

**HOLD.** No implementation. Phase 2 scope will be authorized after Team B returns P-5, P-9 and the Journey 2 corrections.
