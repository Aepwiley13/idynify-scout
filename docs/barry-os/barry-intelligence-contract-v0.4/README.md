# Barry Intelligence Contract v0.4

**Idynify · Intelligence Contract · Team B**
**Date: 2026-08-19**
**Repository: aepwiley13/idynify-scout**
**Governing Documents: Barry OS Documents 1–5 (frozen)**
**Convergence Authority: Convergence Decision Packet v1.0 (D1–D10)**

---

## Contract Purpose

This contract governs what intelligence concepts mean within the Idynify platform, how they relate to each other, and what invariants they must satisfy. It is a semantic document — it defines the intelligence model that Barry operates within.

This contract does not authorize implementation. It does not propose storage schemas, Firestore collections, or field structures. It does not design services. It establishes the semantic framework that implementation must satisfy.

## Revision History

| Version | Date | Scope |
|---|---|---|
| v0.3.1 | 2026-08-14 | Baseline intelligence contract derived from Barry OS Documents 1–4 |
| v0.4 | 2026-08-19 | Incorporates semantic implications of Convergence Decisions D1–D10 |
| v0.4-amend | 2026-08-19 | Owner amendment: ICP is capability-required, not platform-required; ICP availability states; ICP creation semantics; item 16 resolved |

## What v0.4 Changes from v0.3.1

v0.4 is not a rewrite. It is one deliberate revision incorporating the semantic implications of convergence decisions D1 through D10. The structure and foundation of v0.3.1 stand. v0.4 adds, clarifies, and corrects — it does not rebuild.

**Added:**
- ICP as a named intelligence object with explicit identity semantics (D1, D2, D3)
- Match revised as Company × ICP derived intelligence (D4)
- Coverage as a named intelligence concept (D5)
- User Judgment as a formally distinct intelligence type (D5)
- Eligibility as formally distinct from Match (D6)
- First-search targeting sufficiency principle (D7)
- RECON section scope classification as normative reference (D8)
- Composition invariant as normative contract principle (D9)
- Migration boundary as contract governance (D10)
- Five governing principles stated as permanent product principles
- "Explicitly Not Decided by This Contract" section

**Amended (v0.4-amend):**
- ICP cardinality: capability-required, not platform-required (owner decision)
- ICP availability states: `no-profiles`, `none-active`, `read-failed` formally distinguished
- ICP creation semantics: explicit creation/confirmation event required
- Composition Invariant: scope requirements are operation-determined, not platform-global
- ICP Context Hard Rule: applicability clarified for zero-ICP Workspaces
- Part VI item 16 resolved; item 19 added
- Appendix B Orientation brief ICP requirement corrected

---

## Governance

This contract sits alongside the Barry OS architecture documents. It governs semantic decisions — what intelligence concepts mean, how they relate, what invariants they must satisfy. The architecture documents (1–5) govern system design and build order.

```
Barry OS Architecture Documents (1–5, frozen)
        ↓ structural authority
Barry Intelligence Contract (this document)
        ↓ semantic authority
Implementation
```

The contract does not override the architecture. The architecture does not override the contract. When a semantic question arises during implementation ("what does this intelligence concept mean?"), this contract governs. When a structural question arises ("where is this stored? how is it built?"), the architecture documents govern.

---

# Part I: Intelligence Types

Every intelligence concept in the Idynify platform belongs to exactly one of the types defined below. An intelligence artifact that does not fit cleanly into one type is either a composition of multiple types (which must be decomposed at the boundary) or an undefined concept that must be classified before it is consumed.

---

## 1. ICP (Ideal Customer Profile)

**Type:** Named Intelligence Object
**Scope:** Workspace-owned
**Authority:** Canonical — user-authored, platform-stored
**Identity:** Intrinsic and stable

An ICP is the user's explicit definition of what kind of company they want to do business with. It is the targeting definition against which companies are evaluated.

An ICP object is Workspace-owned. The targeting intelligence contained within that ICP is ICP-specific and must remain attributable to that ICP's stable identity. This distinction is critical: Workspace ownership means the ICP belongs to the workspace's collection of profiles; ICP-specific means the targeting criteria, scoring weights, and industry/location/size definitions within that profile are particular to that ICP and must not be treated as globally applicable to the Workspace. A workspace with multiple ICPs has multiple distinct targeting definitions — not one shared definition with multiple labels.

### ICP Cardinality

ICP is capability-required, not platform-required. A Workspace may validly contain zero or more ICPs. ICP becomes required when the requested operation semantically depends upon an explicit targeting definition.

Operations that require an ICP include, at minimum: ICP-targeted Scout discovery, Company × ICP Match, ICP coaching, and other targeting decisions whose meaning depends upon a specific ICP.

Operations that do not require an ICP include: existing-network engagement, customer engagement, referral workflows, inbox intelligence, meeting preparation, relationship management, and other operations whose result does not depend upon ICP targeting.

A Workspace with zero ICPs is a valid product state. Barry can operate without an ICP. Relationship-oriented Barry capabilities — engagement, follow-up, inbox analysis, meeting preparation — function normally in a zero-ICP Workspace. ICP absence becomes blocking only when the requested operation requires an explicit targeting definition.

### ICP Creation Semantics

An ICP must originate from an explicit creation or confirmation event. An ICP must not be created merely because dashboard initialization occurred, a migration executed, a bridge/projection existed, onboarding collected information, an operation expected an ICP, or resolution failed.

Barry may propose a targeting definition from attributable intelligence. When the user explicitly confirms that proposed targeting definition, that confirmation qualifies as an authorized ICP creation event. The confirmed definition becomes the authoritative `icpProfiles/{icpId}` representation. This is a semantic authorization — the design and implementation of any such flow are not decided by this contract.

### Identity Semantics

ICP identity is intrinsic and stable. It does not change when the ICP is:
- Copied
- Projected to a derived view
- Activated or deactivated
- Used as the basis for a search
- Referenced by a Match score

Every ICP carries a stable identifier (`icpId`) that is assigned at creation and never changes for the lifetime of that ICP.

### Active ICP

Active ICP is a separate relationship — which ICP is selected for a given context — not a property of ICP identity itself. A Workspace with one or more ICPs may have at most one active ICP at a time. A Workspace with zero ICPs has no active ICP; this is a valid `no-profiles` state (see ICP Availability States below), not an error.

When an active ICP exists, it determines:
- Which targeting definition is used for discovery searches
- Which ICP profile new Match scores are computed against
- Which ICP context reaches Barry decision surfaces

### Authoritative vs. Projected Representation

The authoritative ICP representation lives in the canonical ICP store (`icpProfiles`). All other representations of an ICP are projections — derived views created for specific consumers.

- A projection is not authoritative merely because a consumer reads it
- A projection must carry the identity (`icpId`) of the ICP it represents
- A projection that has diverged from its authoritative source is stale and must be treated as such
- The bridge cache at `companyProfile/current` is a projection, not an authoritative representation

### ICP Availability States

ICP resolution produces one of three semantically distinct non-ICP outcomes. These must remain distinct at every hop. No resolution path may translate any of them into `DEFAULT_ICP_ID`.

| State | Meaning | Valid? | Blocking? |
|---|---|---|---|
| `no-profiles` | Zero ICP documents exist in the Workspace. The user has not created an ICP. | Valid Workspace state | Only for ICP-dependent operations (Discovery, Match, ICP coaching) |
| `none-active` | One or more ICPs exist, but none is currently active. | Valid but requires resolution — the user must select an ICP before ICP-dependent operations proceed. | For ICP-dependent operations; non-ICP operations proceed. |
| `read-failed` | Resolution mechanism encountered an error. ICP state is unknown. | Error state | Consumer must handle explicitly — not a valid basis for any decision. |

**`no-profiles` is not a platform error.** A Workspace with zero ICPs is a valid configuration representing a user who has not yet defined a targeting profile. Barry relationship-oriented capabilities continue to function. `no-profiles` becomes blocking only when the requested operation semantically requires an explicit targeting definition.

**`none-active` is distinct from `no-profiles`.** ICPs exist but the user has not selected one. For ICP-dependent operations, this is a selection-required outcome — the system must not silently choose a candidate.

**`read-failed` is an error.** Resolution attempted but could not determine ICP state. Consumers must handle explicitly — surface an error, retry, or document the gap. Never silently proceed as if a default ICP was intentionally chosen.

Missing ICP identity must never be silently interpreted as intentional use of a default ICP regardless of which state produced the absence.

### Repository Evidence

| Claim | Evidence | Status |
|---|---|---|
| ICP storage path | `users/{uid}/icpProfiles/{icpId}` | CONFIRMED — `setActiveIcpProfile.js`, `getActiveIcpId.js`, `ICPSettings.jsx` |
| Bridge cache path | `users/{uid}/companyProfile/current` | CONFIRMED — `setActiveIcpProfile.js:25`, `daily-leads-refresh.js:149` |
| Active resolution | `getActiveIcpId.js` queries `isActive==true, status=='active'` | CONFIRMED |
| Silent default fallback | Falls back to `DEFAULT_ICP_ID = 'default'` on query failure or empty result | CONFIRMED — `getActiveIcpId.js:18` |
| Multiple resolution mechanisms | At least four distinct active-ICP selection paths exist | CONFIRMED — `getActiveIcpId.js`, `setActiveIcpProfile.js`, `ICPSettings.jsx:handleSetActive`, `DailyLeads.jsx` local filter, `barryContextStack.js:getActiveMessagingProfile`, `daily-leads-refresh.js` bridge-only read |

---

## 2. Match

**Type:** Derived Intelligence
**Scope:** Company × ICP
**Authority:** Derived — computed, not user-authored
**Subject:** The relationship between a specific Company and a specific ICP

Match is Barry's computed evaluation of how well a company fits a specific ICP's targeting definition. Match is derived intelligence — it is computed from observable company attributes against an ICP's criteria, not authored by a user.

### Semantic Definition

Match answers the question: "How well does this company fit this ICP?"

Match's subject is Company × ICP — not Company alone. A company does not have a Match score in isolation. It has a Match score relative to a specific ICP. The same company may score differently against different ICPs. A Match score without ICP attribution is incomplete intelligence.

### Match Properties

- Match is computed from observable company attributes (industry, location, employee count, revenue) evaluated against an ICP's targeting criteria
- Match must carry the identity of the ICP it was computed against
- A Match score without ICP attribution must not be presented to users as current or authoritative
- Match reflects only what was observable — its value is bounded by Coverage (see §3)
- Match does not imply Eligibility (see §5) — a low Match score does not mean a company is ineligible
- Match does not incorporate User Judgment (see §4) — it is purely algorithmic

### Current Implementation

| Component | Path | Scale | Notes |
|---|---|---|---|
| Client-side scoring | `icpScoring.js:calculateICPScore` | 0–100 | Weighted average over 4 dimensions (industry 50%, location 25%, employee size 15%, revenue 10%), normalized over active dimensions. This is the only live Match scorer. |
| Server-side scoring | `search-companies.js:calculateFitScore` | 0–100 | Unreachable dead code. Called only from `enrichCompanyData` (line 1088), which is marked `DEPRECATED - OLD COMPLEX ENRICHMENT (NOT USED ANYMORE)` and has zero callers. Does not produce `fit_score` in production. |
| Persisted field | `users/{uid}/companies/{cid}.fit_score` | 0–100 | Written at discovery and by `recalculateAllScores` |
| Display label | "Match Score" | — | Normalized in positioning handoff |

### Known Defects

**Cross-ICP contamination:** `recalculateAllScores` (in `ICPSettings.jsx:254`) iterates all companies in the user's collection and overwrites persisted `fit_score` using the currently-selected ICP without verifying that the resulting score is attributable to the intended Company × ICP evaluation. A company discovered under ICP A has its `fit_score` rewritten to reflect ICP B when ICP B's settings are saved. The `icpId` field on the company document is not updated by this operation.

**Dead server-side scorer:** `search-companies.js:calculateFitScore` uses different weights and logic from the live client-side `calculateICPScore`, but is unreachable dead code (inside deprecated `enrichCompanyData`, zero callers). By the Reachability Standard (Principle 3), there is no live client/server scoring divergence — only one scorer (`calculateICPScore`) is reachable. The dead server scorer is not a current defect but is noted as a maintenance concern: if the deprecated path is ever re-enabled without reconciliation, divergence would become live.

---

## 3. Coverage

**Type:** Named Intelligence Concept
**Scope:** Property of a Match judgment
**Authority:** Derived — computed alongside Match

Coverage is a property of a Match judgment describing the completeness of the evidence used to produce it. Coverage answers: of the dimensions relevant to this Match, how many were actually observable?

### Semantic Definition

Coverage is evidentiary completeness — not engagement breadth. It answers the question: "How much did we actually know when we computed this Match?"

Coverage is expressed as a structured result:
- **Dimensions relevant to this Match** — which ICP criteria were configured (active)
- **Dimensions that were observable** — which of those criteria had company data available to evaluate against
- **Dimensions that defaulted to UNKNOWN** — which criteria had no company data, forcing a neutral 50 score rather than a genuine evaluation

### Coverage Properties

- Coverage is not a dimension of Match quality — it is a separate concept about the evidence supporting Match
- A Match judgment is incomplete without its Coverage
- Coverage is not a percentage — it is a structured result that preserves which specific dimensions were and were not observable
- Surfaces presenting Match must not imply full evidential support when Coverage is low
- Coverage is not engagement breadth or relationship depth — it is strictly about what was known at scoring time

### Relationship to Match

Coverage does not modify Match. Match is the fit estimate; Coverage is the evidentiary-completeness context for that estimate. A Match of 85 with 4/4 dimensions observed means something fundamentally different from a Match of 85 with 1/4 dimensions observed. The second score is dominated by UNKNOWN defaults, not by evidence.

### Semantic Distinctions

- **Match:** Estimated Company × ICP fit from available evidence.
- **Coverage:** Completeness of the relevant evidence available to support that Match judgment.
- **Confidence:** Strength or reliability of the evidence supporting a judgment. (Not synonymous with Coverage — high coverage with weak data sources is high coverage but low confidence.)
- **User Judgment:** Explicit human evaluation. Formally distinct from all of the above.

Match and Coverage must not be combined into a single metric. Coverage is a structured result about evidentiary completeness, not a scalar modifier of Match.

### Current Implementation State

`evaluateDimensions` in `icpScoring.js:299` already computes per-dimension results including an `unknown: true` flag when company data is missing. This information is sufficient to derive Coverage. However, `calculateICPScore` discards the per-dimension structure and returns only the aggregate number. Coverage is currently computable on demand from `evaluateDimensions` output — it does not require additional data collection.

---

## 4. User Judgment

**Type:** Named Intelligence Type
**Scope:** User-scoped or Relationship-scoped depending on context
**Authority:** Canonical — user-authored

User Judgment is explicit human evaluation of a company, contact, or recommendation. It is the user's opinion, expressed through direct interaction — not computed by any algorithm.

### Semantic Definition

User Judgment answers the question: "What does the user think about this?"

User Judgment includes:
- Swipe decisions (accept/reject) on discovered companies
- Numeric ratings assigned during evaluation (1–10 scale)
- Written notes explaining why a company was accepted or rejected
- Feedback on Barry's recommendations or outputs

### Formal Distinction from Match

User Judgment and Match are formally distinct intelligence types. They must never be conflated:

| Property | User Judgment | Match |
|---|---|---|
| Source | Human evaluation | Algorithmic computation |
| Scale | 1–10 (`barryFeedback.score`) | 0–100 (`fit_score`) |
| Subject | User's opinion about a company | Company's fit against an ICP |
| Authority | Canonical (user-authored) | Derived (computed) |
| Field | `barryFeedback.score` | `fit_score` |

### Invariants

- User Judgment must not be used to compute, adjust, or override Match
- Match must not be used to compute, adjust, or override User Judgment
- They must not share a field name
- They must not be compared on the same scale
- They must not be presented to the user as equivalent or interchangeable
- Any surface or prompt that receives both must clearly label which is User Judgment and which is computed Match

### Repository Evidence

| Claim | Evidence | Status |
|---|---|---|
| User Judgment field | `barryFeedback.score` (1–10) on company documents | CONFIRMED — `DailyLeads.jsx:1564` |
| Match field | `fit_score` (0–100) on company documents | CONFIRMED — `icpScoring.js`, `search-companies.js` |
| Both on same document | Company documents carry both `barryFeedback` and `fit_score` | CONFIRMED |
| Conflation risk | `barryMissionChat.js:187–196` consumes `barryFeedback.score` in swipe intelligence summary; Barry OS Domain Lifecycle Model (Document 2, line 321) labels `icp_score` as "1-10 (from barryFeedback.score)" | CONFIRMED — the Domain Lifecycle Model's `icp_score` field conflates User Judgment with Match by sourcing from `barryFeedback.score` |

---

## 5. Eligibility

**Type:** Named Intelligence Concept
**Scope:** Company × Rules
**Authority:** Derived — rule-based, deterministic

Eligibility is a gate — it determines whether a company may enter consideration at all. Eligibility is categorically distinct from Match.

### Semantic Definition

Eligibility answers the question: "Is this company allowed to be considered?"

Match answers: "How well does this eligible company fit a specific ICP?"

### Formal Distinction from Match

- Low Match does not imply ineligibility — a company that scores 20 on Match is still eligible unless an explicit Eligibility rule excludes it
- Eligibility rules must be explicit, intentional, and declared — not derived from Match scores or inferred from user behavior
- Eligibility exclusions must be attributable — the reason a company was excluded must be traceable after the fact

### Eligibility Rules

An Eligibility rule is a binary gate with three properties:
1. **Declared** — the rule exists in the codebase as an explicit, named filter
2. **Enforced** — the rule is actually applied at a reachable enforcement point
3. **Attributable** — when a company is excluded, the excluding rule is recorded

### Current Implementation State

| Rule | Status | Evidence |
|---|---|---|
| `passesAgeFilter` (founded year range) | CONFIRMED live — server-side | `search-companies.js:15` (definition), `search-companies.js:388` (enforcement — post-fetch filter in Apollo search loop). Producer → Store → Consumer → Decision path: ICP `foundedAgeRange` → `passesAgeFilter` filter → excluded companies never reach client. |
| `passesAllFilters` (client-side) | Exported but unreachable | `icpScoring.js:431` — exported, contains the same founded-age logic, but has zero importers in `src/`. Dead code by the Reachability Standard. |
| `avoidIndustries` | Declared but unenforced | RECON §3 collects this data; no enforcement point wires it to search or post-fetch filtering |

---

## 6. RECON Intelligence

**Type:** Collected Intelligence (acquisition method)
**Scope:** Variable by section (see classification table)
**Authority:** Canonical — user-authored through questionnaire

RECON is a questionnaire — an acquisition method for gathering user intelligence. RECON is not the intelligence model itself. The intelligence gathered through RECON belongs to the intelligence types defined above (ICP targeting criteria, workspace business context, user preferences).

### Section Scope Classification

RECON sections span four semantic homes. Each section's intelligence must be stored, consumed, and attributed according to its true scope:

| Section | Name | True Scope |
|---|---|---|
| §1 | Business Identity | Workspace |
| §2 | Value Proposition | Workspace |
| §3 | ICP/Targeting | ICP-specific |
| §4 | Messaging | User + Workspace |
| §5 | Competitive Intelligence | Workspace |
| §6 | Objection Handling | Workspace |
| §7 | Success Metrics | Mission-adjacent |
| §8 | Sales Motion | Workspace |
| §9 | Buying Signals | HOLD — do not touch |
| §10 | Customer Intelligence | Workspace + ICP |

### Key Implications

- **§3 is ICP-specific intelligence.** Targeting criteria (target industries, company sizes, locations, revenue ranges, avoid industries) belong to a specific ICP, not to the workspace globally. §3 data must carry ICP identity per the ICP semantics defined in §1 of this contract.
- **§9 is on hold.** No consumer may be wired to §9 data until a decision is made about its purpose and scope.
- **RECON is an acquisition method, not a storage model.** The fact that intelligence was gathered through RECON question 3 does not mean it must be stored in a RECON-shaped path. ICP targeting criteria gathered through §3 belong in the ICP profile, not in a RECON section document.

### Current Storage

RECON sections are currently stored at `dashboards/{uid}.modules[recon].sections[].sectionId` as user-scoped data. Section 9 messaging has a parallel per-ICP path at `icpProfiles/{id}/messaging`. This storage model does not align with the true scope classification above — §3 is stored as user-scoped when it is semantically ICP-specific.

---

# Part II: Governing Principles

These five principles are permanent product principles. They govern all intelligence decisions within the Idynify platform.

---

## Principle 1: Barry's Question Rule

> Discover what you can. Infer what you reasonably can. Confirm what matters. Ask only what you cannot know and need now. Learn everything else over time.

Barry does not ask the user for information that is available through observation, inference, or existing data. Barry asks only when the answer cannot be obtained any other way and is needed for the current operation.

## Principle 2: Barry's Intelligence Rule

> Never collect intelligence without knowing who it belongs to, where it came from, how trustworthy it is, how long it should remain true, and what decisions it should improve.

Every piece of intelligence in the platform must have:
- **Ownership** — which entity or scope it belongs to
- **Provenance** — where it came from
- **Confidence** — how trustworthy it is
- **Freshness** — how long it should remain true
- **Purpose** — what decisions it should improve

Intelligence collected without these properties is unattributed and must be treated as provisional.

## Principle 3: The Reachability Standard

> A capability is not considered implemented, working, or currently available to Barry unless it traces a reachable Producer → Store/derived object → Consumer → Decision path.

Code that exists is not the same as capability that works. A function that computes a value is not a capability until that value reaches a consumer that uses it in a decision. The reachability standard is the permanent evidence standard for all intelligence claims.

## Principle 4: The Composition Invariant

> Every Barry decision surface must receive intelligence from all scopes relevant to its operation. Truncation within a scope for token budget reasons is acceptable when explicit and documented. Omission of an entire required scope is not acceptable.

Scope requirements are determined by the operation, not by the platform. An intelligence scope that is required for one operation type is not automatically required for all operation types. See Part III for the full composition invariant specification.

## Principle 5: The Attribution Invariant

> Every Match score must carry the identity of the ICP it was computed against. Every Eligibility exclusion must be attributable. Every projection must carry the identity of the ICP it represents.

Attribution is not optional metadata — it is a structural requirement of the intelligence model. Intelligence without attribution is incomplete and must not be presented as authoritative.

---

# Part III: The Composition Invariant

This section defines the composition invariant with developer precision. It is the governing standard for classifying any Barry decision surface.

---

## Definition

Every Barry decision surface must receive, at minimum, the intelligence scopes relevant to its decision type. The required scopes are:

### Workspace Scope

Business context that is constant across the workspace: what the user's company does, what they sell, how they position themselves, competitive landscape. Sourced from RECON sections §1, §2, §4–§8.

**For any surface involved in discovery, Match, or recommendation:** Workspace scope must include the active ICP context — the targeting definition, configured criteria, and ICP-specific messaging. Workspace without ICP is PARTIAL for those operations. This is a hard rule derived from the fact that Match is Company × ICP (§2 of this contract) and discovery is ICP-targeted (§8 below). A surface that assembles RECON business context but omits the active ICP when making a Match-related or discovery recommendation is PARTIAL, not COMPLIANT.

### User Scope

The user's personal context and communication preferences: preferred tone, preferred channel, communication style, and any user-level memory that informs how Barry communicates on the user's behalf.

### Relationship Scope

What Barry knows about the specific contact or company in context, when one exists: engagement history, conversation state, relationship memory (`barry_memory`), warmth level, strategic value, open questions, open commitments, prior objections, and recent timeline events.

Relationship scope is required when a contact or company is the subject of the operation. It is not required for operations that do not have a specific entity in context (e.g., a workspace-level orientation brief with no open record).

### Mission Scope

The current objective, when one is active: mission goal, step progress, strategy, and outcome history. Mission scope is required when a mission is active for the entity in context. It is not required when no mission exists.

---

## Unit of Composition Analysis

The Composition Invariant applies to decision surfaces: reachable operations that ultimately produce a recommendation, action, generated output, or Barry decision. Helper functions used within a decision surface are components of that surface and are not independently classified unless they themselves constitute a user- or Barry-facing decision boundary.

A decision surface is reachable when it traces a path from user action or system trigger through to a visible output (a displayed recommendation, a generated message, a Barry response). A helper function that receives pre-assembled data and returns a result to its caller is a component of the caller's decision surface.

## Classification Levels

Every live Barry decision surface must be classified as exactly one of:

### COMPLIANT

The surface receives all required scopes for its decision type, with reachability evidence showing the full path from data source to prompt or decision input.

**Worked example:** `barryMissionChat` — assembles RECON business context (10 sections via `compileReconForPrompt`), active ICP profile (via `contextStack.icpProfile` from `getActiveMessagingProfile`), user communication style (via `contextStack.user_style`), up to 500 contacts with engagement metadata, active missions with goal and step progress, swipe feedback with user-written notes, calendar context, and navigation context. All four scopes are present and traceable.

### PARTIAL

The surface receives some required scopes but is missing at least one. The missing scope must be identified explicitly.

**Worked example — Mission Control surface (not barryMissionChat):** Displays recommendations, KPIs, and pipeline state. Receives Workspace scope and User scope. Missing: Relationship scope — when a specific contact's recommendation is displayed, the surface does not fetch that contact's relationship memory, engagement history, or conversation state. The recommendation is displayed without the context that produced it. Classification: PARTIAL — missing Relationship scope for entity-specific recommendations.

**Worked example — Hunter Barry surfaces (`barryHunterProcessEngage`, `barryHunterGenerateStep`):** These decision surfaces assemble contact data, engagement history, and mission context. They receive Relationship scope and Mission scope. However, RECON business context is loaded but ICP context is assembled only for prompt enrichment, not for the strategy recommendation that precedes message generation. The `recommendStrategy` helper function (a component of these surfaces, not an independently classified surface — see Unit of Composition Analysis above) receives no Workspace scope — no RECON data, no ICP profile. Because the decision surface's strategy selection path lacks required scope, the surface as a whole is PARTIAL. Classification: PARTIAL — Workspace and ICP scope missing from strategy selection component.

### NON-COMPLIANT

The surface is missing one or more required scopes with no documented reason.

**Identification criterion:** A surface is NON-COMPLIANT when the missing scope is relevant to its decision type and no documented rationale exists for the omission. NON-COMPLIANT is not a judgment about code quality — it is a factual assessment that a required intelligence input is absent.

**Worked example — `barryInboxAnalyzer`:** Analyzes incoming emails and produces reply assessments. Missing required scopes: no RECON business context (Workspace), no active ICP context, no user communication preferences (User), and no Mission context where applicable. Has the narrowest context window of any major Barry surface. Classification: NON-COMPLIANT — missing Workspace, User, and Mission scopes for a surface that produces reply analysis and recommendations.

---

## The ICP Context Hard Rule

A surface that assembles Workspace context without including the active ICP profile is PARTIAL, not COMPLIANT, for any discovery or Match-related decision. This is a hard rule.

**Rationale:** Match is defined as Company × ICP (Part I, §2). A discovery recommendation or Match assessment that does not know which ICP it is operating against cannot produce correctly attributed intelligence. Omitting ICP context from a discovery or Match surface is not a token budget decision — it is a missing input that changes the semantic correctness of the output.

**Applicability:** This hard rule applies when an ICP exists and the operation is ICP-dependent. A zero-ICP Workspace operating on non-ICP-dependent surfaces (relationship engagement, inbox analysis, meeting preparation, follow-up) is not in violation of this rule — the rule's precondition (an ICP-dependent operation) is not met. Absence of ICP in a zero-ICP Workspace does not make relationship-oriented surfaces PARTIAL or NON-COMPLIANT when ICP context is not semantically required by those surfaces.

---

## Token Budget Principle

Truncation within a scope for token budget reasons is acceptable when the truncation is explicit and documented. Examples:
- Including the 100 highest-priority contacts instead of all 500 — acceptable, because Relationship scope is present at reduced fidelity
- Summarizing RECON §2 to 200 tokens instead of the full 800 — acceptable, because Workspace scope is present at reduced fidelity
- Omitting the active ICP profile entirely because the token budget is tight, when an ICP exists and the operation requires ICP context — not acceptable, because an entire required scope is missing

The distinction: a scope that is present but summarized is truncation. A scope that is entirely absent is omission. Truncation is a budget decision. Omission is a correctness defect. Note: when no ICP exists (`no-profiles`) and the operation does not require ICP context, ICP absence is a valid state, not an omission.

---

## Reference Implementation Surfaces

The following surfaces demonstrate correct multi-scope composition and serve as the reference pattern for Tier 4 remediation:

**`barryMissionChat`** — the primary reference implementation. Assembles all four scopes: RECON (10 sections + capability block), active ICP profile, user communication style, contacts with engagement metadata, missions with goal/step progress, swipe feedback, calendar context, and navigation context.

Where a surface needs to be brought to COMPLIANT, the implementation pattern from `barryMissionChat` should be followed — specifically, how it combines `compileReconForPrompt` for Workspace scope, `contextStack.icpProfile` for ICP context, `contextStack.user_style` for User scope, `contextStack.contacts` and `contextStack.missions` for Relationship and Mission scope.

---

## Composition Invariant Test

The composition invariant language above was tested against three concrete surfaces before finalization:

| Surface | Expected Classification | Result | Evidence |
|---|---|---|---|
| `barryMissionChat` | COMPLIANT | COMPLIANT | All four scopes present — RECON (10 sections), ICP profile, user style, 500 contacts with engagement data, 20 missions with goals |
| Mission Control display surface | PARTIAL — missing Relationship scope | PARTIAL | Displays contact-level recommendations without fetching per-contact relationship memory or engagement history for the displayed entities |
| Hunter Barry decision surfaces (`barryHunterProcessEngage`, `barryHunterGenerateStep`) | PARTIAL — missing Workspace and ICP scope in strategy selection | PARTIAL | Strategy selection component (`recommendStrategy`, evaluated as part of the decision surface per Unit of Composition Analysis) receives contact relationship data and user-level strategy stats but zero Workspace scope (no RECON) and zero ICP context; ICP data reaches the Claude prompt but not the strategy selection path |

All three classifications are unambiguous under the language above.

---

# Part IV: First-Search Targeting Sufficiency

This section establishes the targeting sufficiency principle for discovery searches.

---

## Definition

A search may be described as ICP-targeted only when at least one retrieval constraint derived from the intended ICP demonstrably narrows the result set beyond an unfiltered global query.

### What This Means

- Executing a syntactically valid search against an empty or non-contributing ICP profile is not ICP-targeted discovery — it is an unfiltered search with ICP branding
- Onboarding may not collect targeting intelligence that does not reach the search path and then claim the resulting search is personalized
- The connection between collected targeting intelligence and search constraints must be traceable end-to-end: RECON §3 field → stored value → `buildApolloQuery` parameter → Apollo retrieval effect

### Minimum Targeting Standard

The minimum is not permanently fixed at any specific field. It is: at least one retrieval constraint from the intended ICP that demonstrably narrows the result set. This could be an industry filter, a location constraint, a company size range, or any other RECON §3 field that produces a measurable restriction on the query.

### Barry's Question Rule Application

Barry's Question Rule (Principle 1) governs how targeting intelligence is obtained. If RECON §3 data is insufficient for a targeted search, Barry must:
1. Attempt to infer targeting constraints from available intelligence (industry from website analysis, location from existing contacts, etc.)
2. Ask the user only for what cannot be inferred and is needed now
3. Never execute a search and claim it is ICP-targeted when no ICP constraint actually reached the query

---

# Part V: Migration Boundary

This section establishes migration categories as contract governance.

---

## The Four Migration Categories

| Category | Name | Description | Phase 1B Authorization |
|---|---|---|---|
| 1 | Reconciliation and Wiring | Connecting existing producers to existing consumers; fixing incorrect connections; ensuring existing intelligence reaches its intended destination | Authorized |
| 2 | Schema Migration | Changing stored field names, restructuring Firestore documents, backfilling existing data, migrating storage paths | Not authorized |
| 3 | New Intelligence Infrastructure | Building new services, new storage models, new pipelines (unified context assembler, Company × ICP persistence, Coverage persistence) | Not authorized |
| 4 | New Intelligence Capabilities | Adding new intelligence types, new scoring models, new decision frameworks not present in the codebase today | Not authorized |

## Contract–Implementation Relationship

This contract governs semantic decisions. It does not authorize implementation. The relationship is:

- A semantic decision in this contract does not automatically authorize the corresponding implementation
- Implementation authorization comes from the Convergence Decision Packet and phase-specific work authorization
- The contract may define what a concept means (e.g., "Match must carry ICP identity") without authorizing the storage migration required to enforce it
- Category 2–4 work that is semantically required by this contract but not yet authorized is documented as debt, not performed

---

# Part VI: Explicitly Not Decided by This Contract

The following decisions are explicitly deferred. This contract establishes that they must be decided, but does not decide them:

1. **Storage representation of ICP identity** — whether `icpId` is a field, a document key, or another mechanism
2. **Physical structure of `icpProfiles` documents** — the internal schema and field layout
3. **Migration strategy for legacy identity-less data and bridge-only edit history** — how existing `companyProfile/current` documents without `icpId` are handled
4. **Full deprecation timeline for `companyProfile/current`** — when the bridge cache is retired
5. **Company × ICP persisted Match schema** — how Match scores are stored with ICP attribution in a multi-ICP world
6. **Coverage persistence and display design** — whether and how Coverage is stored, and how it is presented to users
7. **Coverage thresholds for surfacing or suppressing low-coverage Match** — what Coverage level triggers a "low confidence" indicator
8. **Unified context assembly service design and implementation** — the Phase 3 service that provides standard context resolution for all Barry surfaces
9. **Mission as a first-class Firestore object and its schema** — the storage model for missions
10. **Relationship warmth producer implementation** — how relationship warmth is computed and updated
11. **Progressive RECON** — contextual question appearance rather than one-time questionnaire; how RECON evolves from a one-shot questionnaire to an ongoing intelligence collection surface
12. **Whether §9 Buying Signals eventually feeds intent detection and what that consumer looks like** — §9 is on hold pending this decision
13. **Workspace migration of user-scoped RECON data** — moving RECON sections from user-scoped storage to their true semantic scope
14. **Onboarding screen design and question sequence** — the UX for first-time user intelligence collection
15. **Whether RECON revenue ranges require Apollo API capability currently commented out and whether re-enabling is appropriate** — revenue targeting is configured in RECON §3 but the corresponding Apollo query parameter may be commented out
16. ~~Whether the ICP Settings bootstrap path from `companyProfile/current` to `icpProfiles` is an authorized ICP creation mechanism~~ — **RESOLVED.** Owner ruling: dashboard/migration-driven creation of an empty `icpProfiles/default` before the user has supplied targeting intelligence is reconciliation debt, not an authorized permanent ICP creation mechanism. An ICP must originate from an explicit creation or confirmation event per Part I §1 ICP Creation Semantics. Additionally: an existing Barry onboarding interaction in which Barry proposes a targeting definition and the user explicitly confirms that definition (e.g., `BarryOnboarding.handleConfirm()`) may serve as an authorized ICP creation/confirmation event. This is a semantic authorization — the design and implementation of that flow are not decided by this contract.
17. **Whether `getIndustryIds` restoration changes Apollo retrieval behavior in ways that require user-facing explanation or recalibration of existing Match scores** — structured vs. free-text industry targeting may produce materially different result sets
18. **Resolution of the conflict between the D5 separation of User Judgment and Match and the Barry OS Domain Lifecycle Model's existing `icp_score` / `barryFeedback.score` definition** — Repository evidence confirms the frozen document (Document 2, `BARRY_OS_DOMAIN_LIFECYCLE_MODEL.md`, line 321: `icp_score: number | null // 1-10 (from barryFeedback.score)`) collapses concepts now defined separately by this contract: `icp_score` is sourced from `barryFeedback.score` (User Judgment, 1–10) but named as ICP scoring (Match). Resolving the frozen architecture document is documentation/governance debt and is not authorized as Phase 1B implementation by v0.4.
19. **Barry-assisted ICP discovery design** — Barry may eventually propose targeting definitions from attributable Workspace, customer, relationship, RECON, website, engagement, and outcome intelligence for user confirmation. This is consistent with Barry's Question Rule (Principle 1). The data sources Barry may consider, confidence rules for proposed targeting criteria, the confirmation UX, and the lifecycle of a proposed-but-unconfirmed targeting definition are all undecided. This is a product direction, not authorized implementation.

---

# Appendix A: Intelligence Type Quick Reference

| Intelligence Type | Scale | Subject | Authority | Scope | Key Field(s) |
|---|---|---|---|---|---|
| ICP | N/A | Targeting definition | Canonical | Workspace | `icpProfiles/{icpId}` |
| Match | 0–100 | Company × ICP | Derived | Company × ICP | `fit_score` |
| Coverage | Structured (dims relevant / observable / unknown) | Property of a Match judgment | Derived | Company × ICP | Computable from `evaluateDimensions` |
| User Judgment | 1–10 | User's opinion | Canonical | User or Relationship | `barryFeedback.score` |
| Eligibility | Binary (pass/fail) | Company × Rules | Derived | Company × Rules | `passesAgeFilter` (live, server-side: `search-companies.js:15,388`) |
| RECON | N/A | Collected intelligence | Canonical | Variable by section | `dashboards/{uid}.modules[recon]` |

---

# Appendix B: Composition Invariant Scope Requirements by Surface Type

| Surface Type | Workspace | User | Relationship | Mission | ICP (hard rule) |
|---|---|---|---|---|---|
| Discovery / search | Required | — | — | — | Required |
| Match display | Required | — | Required (entity context) | — | Required |
| Message generation | Required | Required | Required | If active | Required for discovery-related |
| Reply analysis | Required | Required | Required | If active | — |
| Recommendation | Required | — | Required (entity context) | If active | Required for discovery/Match recs |
| Orientation brief | Required | Required | Optional (no entity) | If active | If ICP exists |
| ICP coaching | Required | — | — | — | Required |
| Meeting preparation | Required | Required | Required | If active | — |

"Required" means the scope must be present for COMPLIANT classification. "—" means the scope is not required for this surface type but may be included. "If active" means required only when a mission exists for the entity in context. "If ICP exists" means required when the Workspace has an active ICP; absence in a zero-ICP Workspace (`no-profiles`) does not make the surface PARTIAL. "Optional" means the scope enhances the surface but its absence does not make it PARTIAL.

---

*This contract was produced by Team B. No code was written or changed during its production. This is a semantic governance document only.*

*Contract status: Returned for approval. Approval of v0.4 satisfies the semantic-contract prerequisite for Team A. It does not itself authorize Tier 4 or later implementation. Team A retains a Tier 1 pre-implementation gate whose four questions must be reconciled against final v0.4 before implementation authorization is issued.*
