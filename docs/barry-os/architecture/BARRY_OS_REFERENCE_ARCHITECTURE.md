# Barry OS Reference Architecture

**Idynify · Document 1 of 5 · Team B**
**Date: 2026-08-07**
**Repository: aepwiley13/idynify-scout**
**Source of Truth: docs/audits/BARRY_OS_FOUNDATION_AUDIT.md (canonical audit — pinned to commit 09e90f9)**
**Pending: docs/audits/BARRY_OS_AUDIT_RECONCILIATION.md (Team A addendum)**

---

## Governance

This document sits at the top of the implementation hierarchy. Documents 2–5 derive from it.

```
Constitutional Brief        ← historical intent
        ↓
Canonical Audit             ← repository evidence
        ↓
Reconciliation Addendum     ← final discovery truth
        ↓
Reference Architecture      ← THIS DOCUMENT — system design
        ↓
Domain + State Model        ← object definitions and lifecycle
        ↓
Signal Specification        ← event contracts
        ↓
Capability Contracts        ← Skills, Workflows, Actions
        ↓
Implementation Plan         ← build order
```

Items marked `[PENDING RECONCILIATION]` await confirmation from Team A's reconciliation addendum. They are flagged clearly and designed to be updatable without restructuring this document.

## Evidence Levels

Every major architectural claim in this document carries one of three evidence levels:

```
CONFIRMED   Verified in the canonical audit at a specific file or line.
            This finding exists in the repository today.

PENDING     Awaiting confirmation from Team A's reconciliation addendum.
            The architecture is designed around this finding but it has
            not yet been verified at the call-site level.

PROPOSED    A new architectural recommendation not present in the codebase today.
            Justified explicitly. Requires approval before implementation begins.
```

| Component | Evidence Level |
|---|---|
| 15 Skills Registry | CONFIRMED (audit Step 10) |
| 7 Workflows Registry — 2 promoted | CONFIRMED (audit Step 2 — `process-barry-inbox-queue`, `barryHunterProcessEngage`) |
| 7 Workflows Registry — 5 new | PROPOSED |
| Think Layer extending `barryStrategyRecommender.js` | PENDING |
| Six memory types (first five) | CONFIRMED (audit Step 3) |
| Artifact Memory (sixth type) | PROPOSED |
| `barrySessionKey` unified conversation store | PENDING |
| Surface registration model | PROPOSED |
| Morning Brief Data Contract | PROPOSED |
| Context Resolution Contract | PROPOSED (extends CONFIRMED `barryContextAssembler` pattern) |
| Four Awareness Projections schemas | PROPOSED (projections absent today — CONFIRMED by audit Step 3) |
| Signal Bus envelope format | PROPOSED (no normalized format exists today — CONFIRMED by audit Step 4) |
| Action Queue Contract | PROPOSED (NBS is closest equivalent — CONFIRMED by audit Step 10) |
| Capability Registry Contract | PROPOSED (extends CONFIRMED `barryActions.js` generative/side-effect pattern) |
| Data Ownership Matrix | PROPOSED (codifies CONFIRMED `barry_intel` violation from audit Step 9) |
| Observation processing step | PROPOSED |

---

## 1. The Central Architectural Principle

> Idynify is the operating environment. Barry is the orchestration and intelligence layer that understands the environment, thinks about what matters, chains capabilities together, and helps the user act.

Barry is not a chatbot. Barry is not a collection of AI features. Barry is the runtime for Aaron's business relationships. Scout, Hunter, Sniper, Basecamp, Recon, and Reinforcements are applications running on Barry OS.

Today Barry exists as approximately 37 Netlify AI functions, 9 client-side services, 8 distinct context implementations, 7 conversation stores, and 19 component-level surfaces — wired together by convention rather than contract (canonical audit, Steps 1–3). Improving Barry in one place does not improve Barry everywhere. Barry OS replaces this with one intelligence runtime that every Idynify module runs on.

### Barry OS Principles

Every engineer working on Barry must internalize these before touching the codebase.

1. Barry is an orchestration engine, not a collection of AI features. He chains skills and capabilities together to accomplish larger goals — not just respond to individual prompts.
2. Barry is never called directly from business logic. Business logic publishes signals. Barry observes them. This is the single most important architectural law.
3. Modules publish signals. Barry observes and reasons. Scout, Hunter, Sniper, Basecamp, Recon, and Reinforcements are applications running on Barry OS. Barry is the runtime, not a feature inside each module.
4. Barry derives intelligence from canonical data and never owns it. Contacts, companies, messages, campaigns, and missions belong to the platform. Barry reads them. Barry does not store them.
5. AI is used for reasoning, judgment, and language — not for deterministic business logic. Do not ask Claude who replied yesterday. Compute that. Save AI for strategy, tone, relationship advice, planning, and judgment calls.
6. Every new integration contributes signals and capabilities. It does not create a new Barry implementation.
7. Improving Barry in one place improves Barry everywhere. One intelligence system. Multiple surfaces.
8. Mission Control is organized around user work, not module boundaries. The question is what Aaron needs to decide today — not which module produced the information.
9. Barry prepares work proactively while respecting user autonomy. Barry should have the answer ready before Aaron asks. Aaron decides how much Barry executes on his own.
10. Signals, awareness state, recommendations, prepared actions, and executed actions are distinct concepts. Barry OS must never conflate them.
11. Barry's reasoning must be explainable, auditable, and improvable. If Barry cannot explain why he recommended something, that recommendation should not ship.
12. Barry thinks before he acts. Between awareness and recommendation, Barry synthesizes information, compares competing priorities, weighs tradeoffs, and chooses strategy. That reasoning layer is where Idynify's differentiation lives.

---

## 2. The Five Layers

Everything Barry touches belongs to one of these five layers. The canonical audit found that 7 of 13 surfaces conflate layers — awareness, recommendations, and prepared actions are produced in the same pipeline pass (audit Step 1, Surface Summary table). The architecture defines these as distinct object types with distinct storage, distinct lifecycles, and distinct ownership.

### Layer 1 — Signal

Something happened.

A Signal is a normalized event produced by a module, integration, or the platform itself. Signals are immutable facts about what occurred. They are the input to Barry's reasoning — never its output.

**Examples:**
- `contact.reply_received` — a contact replied to an email
- `meeting.today` — a calendar event is happening today
- `mission.step_completed` — a Hunter mission step was finished

**Current state:** No normalized signal format exists. Each data source writes to its own Firestore collection with its own schema. Barry is blind to real-time events — all awareness is poll-based or computed at query time (audit Step 4). Gmail replies are detected by periodic polling via `gmail-poll-replies`, not by webhook. Calendar events are fetched on demand via `calendar-list-events`. There is no event bus.

### Layer 2 — Fact / Awareness State

Something is currently true.

Awareness is Barry's persistent derived understanding of the world. It is computed from signals and canonical data. It is not generated per-request — it is maintained continuously, even when Aaron is not using the application.

**Examples:**
- `contact.awaiting_response = true` — derived from `contact.email_sent` + no subsequent `contact.reply_received`
- `business.responses_pending_count = 3` — aggregated from awareness across all contacts
- `mission.at_risk = true` — derived from `mission.deadline_approaching` + `mission.step_stalled`

**Current state:** Only Relationship Awareness exists in partial form via three fragmented fields on each contact document: `engage_state` (status, current_goal, preferred_channel), `engagement_summary` (aggregate stats), and `barry_memory` (relationship history). Business Awareness, Mission Awareness, and User Awareness do not exist as persistent objects (audit Step 3, Awareness Projection Analysis).

### Layer 3 — Recommendation

Barry believes something should happen.

A Recommendation is Barry's judgment about the best next action, derived from awareness and reasoning. It always carries a confidence score and an explainable reasoning trace. It is not an action — it is an opinion.

**Examples:**
- `reply_today` — Barry recommends replying to a contact who responded
- `prepare_meeting_brief` — Barry recommends generating a brief before today's meeting
- `follow_up_overdue` — Barry recommends re-engaging a stalled contact

**Current state:** Recommendations are generated ad hoc by `recommendationEngine.js` (client-side, 4 categories, capped at 5 items) and inline within `barryMissionChat.js` (server-side, embedded in chat responses). Neither system persists recommendations, tracks whether they were acted on, or carries confidence scores (audit Step 3, Step 6).

### Layer 4 — Prepared Action

Barry has prepared work but has not executed it.

A Prepared Action is concrete, actionable output that Barry has staged for Aaron's review. It sits in the Action Queue until Aaron approves, modifies, or dismisses it. It has a deadline and an expiration.

**Examples:**
- `reply_draft_ready` — Barry has drafted a reply email awaiting send approval
- `meeting_brief_generated` — Barry has produced a pre-meeting dossier
- `campaign_sequence_staged` — Barry has built a multi-step outreach sequence

**Current state:** Prepared Actions are not a distinct concept. Message drafts live in `barry_sessions` per-contact, campaign sequences live in mission documents, and meeting briefs are generated on demand and not persisted. There is no central queue of prepared work (audit Step 10, Action Queue Contract).

### Layer 5 — Executed Action

Barry or the user performed the action.

An Executed Action is a completed operation with an auditable record. It carries an idempotency key, a capability reference, and an outcome.

**Examples:**
- `email.sent` — a drafted reply was approved and sent via Gmail
- `contact.stage_moved` — a contact was moved from Hunter to Sniper
- `meeting.brief_delivered` — a meeting brief was presented to Aaron

**Current state:** Execution is scattered across `barryActions.js` (Gmail/Calendar actions with confirmation flow), `barry-approve-send.js` (email send), `barryPipelineAction.js` (stage moves, outcome logging), and direct calls from engagement panels. No idempotency keys exist on outbound actions. No centralized execution log (audit Step 7, Idempotency section).

### Layer Separation Rule

These five layers are not stages in a pipeline. They are distinct object types with distinct storage, distinct lifecycles, and distinct ownership:

| Layer | Storage | Lifecycle | Owner |
|---|---|---|---|
| Signal | `signals/{signalId}` | Immutable. Append-only log. | Producing module or integration |
| Awareness | `barry_awareness/{projectionType}` | Mutable. Recomputed on signal arrival. | Barry OS (derived, never user-written) |
| Recommendation | Action Queue (type: recommendation) | Ephemeral. Expires if not acted on. | Think Layer |
| Prepared Action | Action Queue (type: prepared_action) | Staged. Expires at `expires_at`. | Skill or Workflow that produced it |
| Executed Action | Action Queue (type: executed) + audit log | Immutable once completed. | Action Executor |

A surface may display objects from multiple layers — Mission Control shows awareness, recommendations, and prepared actions simultaneously. But no single function call may produce objects across multiple layers in one pass. The current violation where `barryMissionChat` generates awareness assessments, recommendations, and draft actions in a single AI response must be decomposed.

---

## 3. The Barry Thinking Model

Barry's full reasoning flow:

```
Signal
  ↓
Observe / Interpret          ← deterministic, owned by Awareness pipeline
  ↓
Awareness                    ← persistent, continuously updated
  ↓
Context Resolution           ← per-request packaging
  ↓
Think                        ← synthesis, prioritization, strategy selection
  ↓
Recommendation
  ↓
Prepared Action
  ↓
Executed Action
```

Each step maps to a concrete system component:

| Step | Component | Exists Today? |
|---|---|---|
| Signal | Signal Bus | No — no event bus, no normalized format |
| Observe / Interpret | Observation pipeline (deterministic) | No — signals are not normalized into observations |
| Awareness | Awareness Layer | Partial — `engage_state` + `engagement_summary` per contact |
| Context Resolution | Context Resolver | Partial — 3 competing implementations |
| Think | Think Layer | See `[PENDING RECONCILIATION]` below |
| Recommendation | Think Layer output → Action Queue | No — recommendations are inline in chat responses |
| Prepared Action | Skills + Workflows | No — all capabilities are monolithic functions |
| Executed Action | Action Executor + Capability Registry | Partial — `barryActions.js` handles Gmail/Calendar with confirmation |

### Think Layer — Current State

```
[PENDING RECONCILIATION — Think layer scope]

The canonical audit identifies barryStrategyRecommender.js
(netlify/functions/utils/barryStrategyRecommender.js) as a rule-based
pre-generation intelligence module that scores four engagement strategies
(direct, warm, value, humor) and recommends which approach will most likely
succeed. It produces { recommendation, promptGuidance, strategyScores }
and reaches exactly 4 endpoints:

  1. generate-engagement-message.js (line 251)
  2. barryHunterProcessEngage.js (line 310)
  3. barryHunterGenerateStep.js (line 147)
  4. barryGenerateSequenceStep.js (line 110)

Whether this constitutes a partial Think layer (strategy selection for
message generation) or merely a pre-generation helper is a reconciliation
item. This architecture treats it as the seed of the Think layer and
designs the full Think layer to extend rather than replace it.

Key finding: strategyScores — the four scored strategies with reasons —
are produced but never persisted. The scores flow into promptGuidance
(a string injected into the Claude prompt) and are discarded. The
architecture requires these to be persisted as part of the reasoning
trace.
```

### Think Layer — Target Architecture

The Think layer sits between Awareness and Recommendation. It is the reasoning engine where Idynify's differentiation lives.

**Inputs:**
- Awareness projections (Relationship, Business, Mission, User)
- Recent signals (what just happened)
- User context (which surface, what they asked, navigation state)
- Memory (all six types — see Section 5)
- Current action queue state (what's already prepared/pending)

**Processing:**
1. **Synthesize** — combine signals across multiple relationships and missions into a unified picture of what matters right now
2. **Compare priorities** — rank competing demands: respond to high-value reply vs. follow up on overdue NBS vs. prepare for today's meeting
3. **Weigh tradeoffs** — consider timing (morning vs afternoon), relationship value (critical vs low), urgency (time-sensitive vs can wait), user preferences (learned from User Awareness)
4. **Choose strategy** — select the approach (which Skill, which Workflow, what tone, what angle) based on synthesis, extending the existing strategy recommendation pattern from `barryStrategyRecommender.js`

**Outputs:**
- Prioritized recommendation list with confidence scores (0.0–1.0)
- Strategy selection per recommendation (which Skill or Workflow to invoke)
- Reasoning trace — the explainable chain from signals → awareness → synthesis → recommendation
- `strategyScores` — persisted, not discarded

**Structural requirement:** The Think layer is a distinct service call, not embedded in chat response generation. It runs before the response generator, informing what the response should contain. `barryMissionChat` must not contain reasoning logic — it must consume Think layer output.

**Relationship to existing code:**

The existing `barryStrategyRecommender.js` is a rule-based function (no AI calls) that selects engagement strategy for message generation. The Think layer extends this pattern in two directions:

1. **Broader scope** — strategy selection for all Barry operations, not just message generation. Which relationship to prioritize, which workflow to trigger, what to surface in the morning brief.
2. **AI-assisted reasoning** — for complex multi-relationship synthesis where rule-based scoring is insufficient. Simple prioritization (overdue NBS vs not) remains deterministic. Cross-relationship strategy (which of 5 pending replies is most important to Aaron's pipeline) uses AI reasoning with a structured prompt.

The existing `barryGuardrail.js` (rule-based relationship/intent mismatch detector) also feeds into Think layer inputs — it currently checks whether a user's engagement intent mismatches the contact's relationship signals. This check should run as a pre-Think validation, not as a pre-generation check buried in individual endpoints.

---

## 4. The Reference Architecture — Layer by Layer

### Subsystem Classification

Barry OS subsystems belong to one of four categories. Every engineer must know which category a subsystem belongs to before touching it — runtime and persistence responsibilities must never blur.

```
Runtime Layer
  Signal Bus
  Context Resolver
  Think Layer
  Workflow Engine (Orchestrator)

Storage Layer
  Awareness Projections
  Memory (all six types)
  Artifact Store
  Action Queue

Interface Layer
  Capability Registry
  Skills Registry

Presentation Layer
  Barry Surfaces (Mission Control, Drawer, Morning Brief, Contact surfaces)
```

A change to a **Storage Layer** subsystem requires a schema migration decision.
A change to a **Runtime Layer** subsystem requires a cost and latency review.
A change to an **Interface Layer** subsystem requires a capability contract update.
A change to a **Presentation Layer** subsystem must not introduce new data fetching.

### 4.1 Barry Surfaces (UI Layer)

**What it does:** Renders Barry's intelligence to the user. Every surface consumes the same context resolution service, the same capability registry, and the same conversation store. No surface creates its own context implementation.

**What exists today (audit Step 1):**

19 Barry component files across 7 directories, organized into 13 audited surfaces:

| Surface | Component(s) | Module | Layer Conflation | Direct-Call Violation |
|---|---|---|---|---|
| Global Barry Drawer | `BarryTrigger.jsx` + `BarryChat.jsx` | Global | Rec + Prepared | Mild (`moveContactToSniper()`) |
| MC Barry Chat Panel | `BarryChatPanel.jsx` | Mission Control | All five | Partial (embedded recs) |
| Morning Brief | `BarryMorningBrief.jsx` | Mission Control | Aware + Rec + Signal | None |
| Barry Insight Panel | `BarryInsightPanel.jsx` | Contact | Aware + Rec | None |
| Barry Context | `BarryContext.jsx` | Contact | Awareness only | None |
| Barry Briefing | `BarryBriefing.jsx` | Contact | Prepared + Aware | Mild |
| Engagement Panels (5) | `*EngagementPanel.jsx` | Per-module | Rec + Prepared + Exec | **Yes** |
| Recon Coach | `BarryReconCoach.jsx` | Recon | Rec + Prepared | **Yes** |
| Hunter Barry Cards (6) | `BarryInsightsCard.jsx`, etc. | Hunter | Aware + Rec + Prepared | **Yes** |
| Scout ICP Panel | `BarryICPPanel.jsx` | Scout | Recommendation | **Yes** |
| Admin Conversations | `BarryConversationsView.jsx` | Admin | N/A | None |
| Onboarding Barry | `BarryOnboarding.jsx` + `BarryTyping.jsx` | Onboarding | Recommendation | None |
| Session History | `BarrySessionHistoryPanel.jsx` | Contact | Awareness | None |

7 conversation stores exist today (audit Step 3): `drawer_{module}` (9 possible keys), `missionControl`, `reconCoach_{sectionId}`, `icpChat`, `icp`, plus separate `barry_sessions` at both user-level and contact-level. These do not cross-reference each other.

**What needs to be built:**

A **surface registration model** where each surface declares:
- What awareness projections it needs (Business? Relationship? Mission?)
- What entity scope it operates in (contact, company, mission, global)
- What capabilities it may invoke (write email, move stage, generate brief)
- Its `barrySessionKey` (the canonical session identifier — already defined in `src/utils/navigation.js` lines 351-362 with shape `{ entityType, entityId, sessionType, sourceModule }`)

One conversation store keyed by `barrySessionKey`. The existing function already produces the correct composite key — it distinguishes the same contact viewed from Mission Control vs. Hunter. All 7 current stores collapse to documents under `users/{userId}/barryConversations/{barrySessionKey}`.

**What it replaces:**
- 8 distinct context implementations → 1 context resolver
- 7 conversation stores → 1 store keyed by `barrySessionKey`
- Per-surface context assembly (e.g., `buildContextStack()` loading 500 contacts client-side) → server-side context resolution scoped to what each surface declared it needs

### 4.2 Signal / Event Layer

**What it does:** Normalizes platform events into a standard envelope that Barry can observe. Modules and integrations produce signals. Barry consumes them. Signals are immutable, append-only, and the foundation of all awareness computation.

**What exists today (audit Step 4):**

No normalized event format exists. 24 platform events were mapped across Known/Partially Known/Blind categories. Barry is blind to real-time events. Signal awareness is either poll-based (Gmail replies checked periodically) or computed at query time.

The only existing signal-like processing is `process-barry-inbox-queue.js`, which reads from `barry_processing_queue` (a top-level Firestore collection), processes entries sequentially, and writes analysis and draft replies to contact subcollections. This is the closest thing to a signal bus — a queue-based processor that chains analysis and action.

**What needs to be built:**

**Signal envelope format:**

```
Signal {
  signal_id: string           // auto-generated unique ID
  signal_type: string         // namespaced: 'contact.reply_received'
  workspace_id: string        // userId (workspace boundary)
  entity_type: string         // 'contact' | 'company' | 'mission' | 'campaign' | 'meeting' | 'message'
  entity_id: string           // ID of the affected entity
  source: string              // 'gmail' | 'calendar' | 'apollo' | 'platform' | 'user_action'
  payload: object             // event-specific data (schema per signal_type)
  occurred_at: timestamp      // when the event happened in the real world
  processed_at: timestamp     // when Barry processed it (null if pending)
}
```

**Signal producer contract:** Any module or integration that wants Barry to know about an event writes a Signal document. The producer is responsible for the envelope — Barry never parses raw integration data.

**Signal bus collection:** `users/{userId}/signals/{signalId}` — append-only. Signals are never mutated after creation. `processed_at` is the only field that updates (from null to timestamp when awareness computation consumes it).

**Top 20 platform signals (from audit Step 10):**

| Priority | Signal Type | Source | Current State |
|---|---|---|---|
| Critical | `contact.reply_received` | gmail | Poll-based via `gmail-poll-replies` |
| Critical | `meeting.today` | calendar | Pull-based via `calendar-list-events` |
| High | `contact.email_sent` | gmail | Recorded at send time |
| High | `contact.email_bounced` | gmail | Engagement summary field |
| High | `contact.status_changed` | platform | Contact field update |
| High | `mission.step_completed` | platform | Mission step outcomes |
| High | `mission.deadline_approaching` | platform | Not currently detected |
| High | `nbs.confirmed` | user_action | NBS field update |
| High | `nbs.overdue` | platform | Not currently detected |
| High | `nbs.dismissed` | user_action | NBS field update |
| Medium | `contact.warmth_changed` | platform/barry | Warmth field update |
| Medium | `contact.added` | platform | Contact creation |
| Medium | `contact.enriched` | apollo | Enrichment fields |
| Medium | `contact.email_opened` | track-open | Track open function |
| Medium | `meeting.created` | calendar | Only visible via calendar poll |
| Medium | `mission.created` | platform | Mission document exists |
| Medium | `company.discovered` | scout | Companies collection |
| Medium | `company.accepted` | scout | BarryFeedback score + status |
| Low | `company.rejected` | scout | Status field |
| Low | `contact.brigade_changed` | platform | Brigade history array |

**What it replaces:**
- Ad hoc Firestore field updates that Barry can only discover at query time
- Poll-based awareness (Gmail replies) with signal-driven awareness
- Direct-call patterns where modules call Barry functions instead of publishing events

**Accountability**
```
Owner:        Platform modules and integrations (producers); Barry OS (consumer)
Readers:      Observation pipeline → Awareness Layer, Think Layer (via context), audit log
Writers:      Module event producers (Gmail, Calendar, Apollo, platform business logic)
Invalidated:  N/A — signals are immutable, append-only
Rebuilt by:   N/A — signals are the source of truth; nothing rebuilds them
```

### 4.3 Canonical Domain Data

**What it does:** Stores the platform's source of truth — contacts, companies, messages, campaigns, missions. Barry reads this layer. Barry never writes to it.

**What exists today:**

| Collection | Path | Owner |
|---|---|---|
| Contacts | `users/{userId}/contacts/{contactId}` | Platform (module business logic) |
| Companies | `users/{userId}/companies/{companyId}` | Platform (Scout module) |
| Missions | `users/{userId}/missions/{missionId}` | Platform (Hunter module) |
| ICP Profiles | `users/{userId}/icpProfiles/{profileId}` | Platform (Recon module) |
| Service Profiles | `users/{userId}/serviceProfiles/{profileId}` | Platform (user-managed) |
| Dashboards | `dashboards/{userId}` | Platform (RECON system) |

**Current violation:** `search-companies.js` (line 991) writes `barry_intel` — a rule-based factual summary — onto canonical company documents at `users/{userId}/companies/{companyId}`. This is Barry writing derived intelligence onto a canonical domain object. While the summary itself is deterministic (no AI), it violates the ownership boundary.

**Architectural rule:** Barry derives awareness from canonical data. Barry's derived outputs live in Barry-owned collections (`barry_awareness`, `barry_artifacts`, Action Queue). Canonical collections contain only platform-owned fields. The `barry_intel` field on company documents must migrate to Barry's awareness layer.

**Contact document field ownership:** The contact document at `users/{userId}/contacts/{contactId}` currently contains both canonical fields (`name`, `email`, `company_name`, `title`) and Barry-derived fields (`barry_memory`, `engage_state`, `engagement_summary`, `next_best_step`). The architecture separates these:

- **Canonical fields** remain on the contact document — owned by module business logic
- **Barry-derived fields** migrate to `users/{userId}/barry_awareness/relationships/{contactId}` — owned by Barry OS

This separation is a migration concern (Document 5). During transition, both locations may coexist with the awareness layer as the authoritative source.

### 4.4 Awareness Layer

**What it does:** Maintains Barry's persistent derived understanding of what is currently true. Four projections, each updated continuously — even when the user is not actively interacting with Barry.

**Critical requirement:** Awareness must update from signals and canonical data independently of user sessions. Barry must know a reply arrived at 2am whether or not Aaron opened Mission Control at 2am. Awareness is not runtime-dependent on a user requesting context.

**What exists today (audit Step 3, Awareness Projection Analysis):**

| Projection | Status | Evidence |
|---|---|---|
| Relationship Awareness | **Partial** | `engage_state` (per-contact engagement state), `engagement_summary` (aggregate stats), `barry_memory` (relationship history) — three fragmented fields, no unified projection |
| Business Awareness | **Does not exist** | `barryOrientationBrief` computes pipeline stats at query time. `recommendationEngine` derives recommendations ad hoc. No persistent state. |
| Mission Awareness | **Does not exist** | Mission progress stored on mission documents. Not aggregated. Barry learns about missions only through context stack. |
| User Awareness | **Minimal** | User Barry Memory at `users/{userId}/barry_memory` tracks tone and channel preferences only. No approval patterns, timing preferences, or communication style. |

### The Observation Step

Between a Signal arriving and an Awareness projection updating, there is a named processing step: Observation.

A Signal is a raw fact:
```
contact.reply_received at 10:32am
```

An Observation is a normalized interpretation of that signal:
```
contact.reengaged = true
reply.sentiment = positive
contact.response_latency = 19_hours
```

Observations are derived deterministically from signals — no AI call required for most of them. The Think layer is not involved. Observations are the inputs that Awareness projections aggregate over time.

Awareness is what combines observations:
```
relationship.momentum = improving
awaiting_response = true
```

Only after Awareness is updated does the Think layer reason:
```
"High-value relationship, positive reply, meeting tomorrow. Prioritize above
 the three cold follow-ups."
```

Observations should be persisted when provenance, signal replay, debugging, or auditability requires it. They are not required to be persisted by default.

The five object layers (Signal, Fact/Awareness, Recommendation, Prepared Action, Executed Action) are unchanged. Observation is a processing step, not a persisted business object.

**What needs to be built — the four projections:**

**Relationship Awareness** — per-contact understanding of current state

```
RelationshipAwareness {
  entity_id: contactId
  engage_status: 'never_engaged' | 'in_progress' | 'awaiting_reply' | 'paused'
  sentiment: 'positive' | 'neutral' | 'negative' | 'unknown'
  warmth_level: number (1-5)
  next_expected_action: string
  open_commitments: string[]
  days_since_last_contact: number
  reply_rate: number (0.0-1.0)
  health_score: number (0-100)
  risk_score: number (0.0-1.0)
  momentum_direction: 'improving' | 'stable' | 'declining'
  confidence: number (0.0-1.0)
  computedAt: timestamp
  sourceSignalIds: string[]
}
```

- **Storage:** `users/{userId}/barry_awareness/relationships/{contactId}`
- **Staleness:** Stale after 24 hours or any signal matching this contact
- **Update trigger:** `contact.*` signals, `mission.step_completed` where `missionContactId == contactId`
- **Current source:** Formalizes and unifies `engage_state` + `engagement_summary` + health score computation from `healthScore.js`

**Business Awareness** — workspace-level understanding of portfolio state

```
BusinessAwareness {
  total_active_relationships: number
  relationships_at_risk_count: number
  pipeline_by_stage: { [stage]: count }
  responses_pending_count: number
  meetings_today_count: number
  nbs_overdue_count: number
  revenue_pipeline_estimate: number
  new_this_week: number
  stage_changes_this_week: number
  computedAt: timestamp
  sourceSignalIds: string[]
  confidence: number
}
```

- **Storage:** `users/{userId}/barry_awareness/business`
- **Staleness:** Stale after 15 minutes or any signal
- **Update trigger:** Any contact or mission signal, daily recomputation
- **Current source:** Does not exist — computed ad hoc by `barryOrientationBrief` at request time

**Mission Awareness** — aggregate understanding of mission health

```
MissionAwareness {
  active_missions_count: number
  missions_on_track: MissionSummary[]
  missions_at_risk: MissionSummary[]
  missions_stalled: MissionSummary[]
  overall_mission_health_score: number (0-100)
  computedAt: timestamp
  sourceSignalIds: string[]
  confidence: number
}
```

- **Storage:** `users/{userId}/barry_awareness/missions`
- **Staleness:** Stale after 6 hours or any mission signal
- **Update trigger:** `mission.step_completed`, `mission.deadline_approaching`, `mission.created`
- **Current source:** Does not exist — mission progress stored on individual mission documents, never aggregated

**User Awareness** — learned understanding of Aaron's preferences and patterns

```
UserAwareness {
  preferred_tone: string
  preferred_channels: string[]
  tone_effectiveness: { [tone]: reply_rate }
  channel_effectiveness: { [channel]: reply_rate }
  approval_patterns: { avg_time_to_approve, auto_approve_rate }
  peak_activity_hours: number[]
  preferred_communication_style: string
  recommendation_acceptance_rate: number (0.0-1.0)
  dismissal_patterns: { [recommendation_type]: dismiss_rate }
  computedAt: timestamp
  sourceSignalIds: string[]
  confidence: number
}
```

- **Storage:** `users/{userId}/barry_awareness/user`
- **Staleness:** Stale after 7 days
- **Update trigger:** Nightly batch from user action signals
- **Current source:** User Barry Memory at `users/{userId}/barry_memory` — tracks only `preferred_tone`, `preferred_channel`, `tone_usage`, `channel_usage`, `channel_reply_rates`

**Rules for all projections:**
- Every projection carries `computedAt`, `sourceSignalIds[]`, and `confidence`
- A consumer reading a stale projection is told it is stale — not handed a stale number that looks fresh
- Projections are derived and rebuildable — deleting the awareness tree and replaying signals must reproduce it
- Barry writes projections. Barry never writes canonical domain data.

**Accountability — Relationship Awareness**
```
Owner:        Barry OS (derived — never user-written)
Readers:      Context Resolver, Mission Control, Morning Brief, Hunter surfaces, Think Layer
Writers:      Observation pipeline (on contact.reply_received, contact.email_sent, contact.status_changed, etc.)
Invalidated:  Any signal whose entity_id matches this contact's id; after 24 hours
Rebuilt by:   Replay of all signals for this contact through the observation pipeline
```

**Accountability — Business Awareness**
```
Owner:        Barry OS (derived — never user-written)
Readers:      Context Resolver, Mission Control, Morning Brief, Think Layer
Writers:      Observation pipeline (any contact or mission signal triggers recomputation)
Invalidated:  Any signal; after 15 minutes
Rebuilt by:   Aggregation query across all Relationship Awareness projections + mission state
```

**Accountability — Mission Awareness**
```
Owner:        Barry OS (derived — never user-written)
Readers:      Context Resolver, Mission Control, Morning Brief, Hunter surfaces, Think Layer
Writers:      Observation pipeline (on mission.step_completed, mission.deadline_approaching, mission.created)
Invalidated:  Any mission signal; after 6 hours
Rebuilt by:   Aggregation query across all active mission documents + step outcomes
```

**Accountability — User Awareness**
```
Owner:        Barry OS (derived — never user-written)
Readers:      Context Resolver, Think Layer (for strategy selection, tone recommendation)
Writers:      Nightly batch job from user action signals (approvals, edits, dismissals, send windows)
Invalidated:  After 7 days; on explicit user preference change
Rebuilt by:   Statistical aggregation across all user action signals within rolling window
```

### 4.5 Context Resolution Layer

**What it does:** Determines what subset of canonical data, awareness, memory, temporal information, session state, and artifacts Barry needs for a specific reasoning operation. This is the contract every Barry operation uses to receive its input.

**What exists today (audit Step 3):**

8 distinct context implementations, three of which are primary assembly paths:

1. **`barryContextStore.js`** (client-side, global) — lightweight pub/sub singleton. Each module page calls `setBarryContext()` on mount. Context is merged, not replaced — **cross-module contamination risk** when navigating between modules.
2. **`barryContextStack.js`** (client-side, Mission Control) — loads up to 500 contacts, active missions, RECON data, ICP profile, service profiles, calendar events. Cached 5 min in sessionStorage. **Sends entire payload to every AI call.** This is the largest cost problem in the codebase.
3. **`barryContextAssembler.js`** (server-side, per-contact) — loads contact document, per-user memory, recent sessions, strategy stats, and recent attributions via Admin SDK. Builds a priority-tiered prompt string capped at ~1200 characters. Used by 4 generation endpoints. **30-second in-memory TTL cache.**

**The problem:** Client-side context assembly (`barryContextStack`) ships 500 contacts per turn to every Mission Control chat message. Context is assembled differently per surface with no shared contract. The same data is loaded, transformed, and formatted independently by each implementation.

**What needs to be built:**

One `resolveContext()` service — server-side only. The client sends entity context (which contact, which surface, which module) and the server resolves the full context package.

**Context Resolution Contract:**

```
BarryContext {
  // Layer 1: Global
  workspace: {
    id: string             // userId (workspace boundary)
    user: UserRecord
    subscription_tier: string
  }

  // Layer 2: Awareness Projections
  awareness: {
    relationship: RelationshipAwareness | null    // if entity-scoped to a contact
    business: BusinessAwareness                   // always included
    mission: MissionAwareness                     // always included
    user: UserAwareness                           // always included
  }

  // Layer 3: Entity
  entity: {
    type: 'contact' | 'company' | 'mission' | null
    data: EntityRecord | null                     // canonical fields only
    memory: RelationshipMemory | MissionMemory | null
  }

  // Layer 4: Session
  session: {
    barrySessionKey: BarrySessionKey              // from navigation.js
    surface: string                               // 'mission_control' | 'drawer_hunter' | 'contact_profile'
    module: string                                // 'hunter' | 'scout' | etc.
    conversation_history: Message[]               // from unified conversation store
    navigation_context: object                    // what the user just navigated from
  }

  // Layer 5: Temporal
  temporal: {
    time_of_day: string
    day_of_week: string
    meetings_today: Meeting[]
    signals_since_last_session: Signal[]
  }

  assembled_at: timestamp
}
```

**Scoping rules:** The context resolver examines the surface declaration and loads only what that surface needs:

- Mission Control: Business Awareness + Mission Awareness + User Awareness + temporal (meetings, pending replies) — no per-contact data unless the user scopes to one
- Contact profile: Relationship Awareness for that contact + entity data + entity memory — no 500-contact load
- Global drawer: Awareness for the entity in the current route + module-specific context

**What it replaces:**
- `barryContextStack.js` (client-side 500-contact loader) — replaced entirely
- `barryContextStore.js` (client-side pub/sub) — refactored to publish entity context only; context resolution moves server-side
- `barryContextAssembler.js` (server-side per-contact) — absorbed into the unified context resolver, with its priority-tiered prompt building preserved

**Accountability**
```
Owner:        Barry OS (runtime service)
Readers:      Think Layer, Skills, Workflows, Barry chat surfaces
Writers:      N/A — Context Resolver reads from Awareness, Memory, canonical data, and session state; it does not write
Invalidated:  Per-request — context is assembled fresh for each operation (no caching at this layer)
Rebuilt by:   Re-invocation with the same surface declaration and entity scope
```

### The Awareness → Context Relationship

```
Canonical Data + Signals
        ↓
   Observe / Derive          ← named deterministic processing step
        ↓
      Awareness              ← updated continuously, independent of user sessions
        ↓
   Context Resolver          ← packages awareness for a specific operation at request time
        ↓
      Think
```

Awareness is a persistent, continuously-updated layer. Observation is the deterministic processing step that interprets signals into normalized observations before Awareness aggregates them (see Section 4.4). Context Resolution is a per-request packaging step that assembles the right subset of awareness (plus entity data, session state, and temporal information) for a specific Think invocation.

### 4.6 Think Layer

**What it does:** Synthesizes information, compares competing priorities across relationships and missions, weighs tradeoffs, chooses strategy, and produces an explainable reasoning trace. This is where Idynify's differentiation lives.

```
[PENDING RECONCILIATION — Think layer scope]

The canonical audit found that barryStrategyRecommender.js (a rule-based
strategy selector reaching exactly 4 endpoints) is the closest existing
component to a Think layer. It selects engagement strategy (direct, warm,
value, humor) and recommended channel for message generation.

barryGuardrail.js (a rule-based relationship/intent mismatch detector
reaching 2 endpoints) is a pre-Think validation that checks whether the
user's engagement tone mismatches the contact's actual signals.

The reconciliation addendum will confirm whether any additional Think-layer
logic exists in the codebase beyond these two utilities. This architecture
designs the Think layer to extend them rather than replace them, regardless
of the reconciliation finding.
```

**Target architecture:**

The Think layer is a distinct service — not embedded in `barryMissionChat` or any other chat handler. It runs before response generation and produces structured output that the response generator consumes.

**Think layer pipeline:**

```
  ┌─────────────────────────────────────────────────┐
  │                  THINK LAYER                    │
  │                                                 │
  │  ┌─────────────┐    ┌──────────────────────┐    │
  │  │  Guardrail   │───▶│  Strategy Selector   │    │
  │  │  Validation  │    │  (extends existing   │    │
  │  │  (barryGuar- │    │   barryStrategy-     │    │
  │  │   drail.js)  │    │   Recommender.js)    │    │
  │  └─────────────┘    └──────────┬───────────┘    │
  │                                │                │
  │  ┌─────────────┐    ┌─────────▼────────────┐    │
  │  │  Priority    │───▶│  Reasoning Engine    │    │
  │  │  Synthesis   │    │  (AI-assisted for    │    │
  │  │  (rule-based │    │   complex multi-     │    │
  │  │   ranking)   │    │   entity synthesis)  │    │
  │  └─────────────┘    └──────────┬───────────┘    │
  │                                │                │
  │                     ┌──────────▼────────────┐   │
  │                     │  Reasoning Trace      │   │
  │                     │  (persisted, explain- │   │
  │                     │   able, auditable)    │   │
  │                     └───────────────────────┘   │
  └─────────────────────────────────────────────────┘
```

**Deterministic vs AI-assisted reasoning:**
- **Deterministic** (rule-based, no AI call): simple prioritization (overdue NBS > non-overdue), strategy selection for single-contact engagement (extends `barryStrategyRecommender.js`), guardrail validation (extends `barryGuardrail.js`)
- **AI-assisted** (structured Claude prompt): cross-relationship prioritization (which of 5 pending replies matters most to Aaron's pipeline), multi-mission strategy (how to balance competing campaign timelines), morning brief synthesis (what to highlight from 50+ signals)

**Output structure:**

```
ThinkResult {
  recommendations: [{
    priority: number                    // 0 = critical, 3 = low
    entity_type: string
    entity_id: string
    action_type: string                 // 'reply' | 'follow_up' | 'prepare_brief' | etc.
    skill_id: string                    // which Skill should execute this
    workflow_id: string | null          // which Workflow, if multi-step
    strategy: StrategyRecommendation    // from extended barryStrategyRecommender
    confidence: number (0.0-1.0)
    reasoning: string                   // human-readable explanation
  }]
  strategyScores: StrategyScores        // the four scored strategies — PERSISTED
  guardrail_warnings: GuardrailWarning[]
  trace: ReasoningTrace                 // full chain for auditability
  computedAt: timestamp
}
```

**Accountability**
```
Owner:        Barry OS (runtime service)
Readers:      Action Queue (receives prioritized recommendations), Skills/Workflows (receive strategy selection), reasoning trace log
Writers:      Think Layer itself — consumes Context Resolver output, produces ThinkResult
Invalidated:  Per-invocation — each Think call is fresh; reasoning traces are persisted for audit
Rebuilt by:   Re-invocation with the same context input; traces are append-only and never rebuilt
```

### 4.7 Skills & Workflows Layer

**What it does:** Defines atomic capabilities (Skills) and named combinations of Skills (Workflows). Today neither exists as a named registry — the audit found 37 Netlify functions and 9 client services, of which 12 functions (32%) are duplicates (audit Step 5).

**What exists today:**

38 AI endpoints that collapse to approximately 15 Skills. The canonical audit identified 8 duplication patterns across message generation (6 implementations), step generation (3 implementations), recon coaching (2 implementations), and context assembly (2 implementations).

Two existing function chains qualify as proto-Workflows:
1. **`process-barry-inbox-queue.js`** — chains 9 sequential steps: queue processing → reply analysis (`barryInboxAnalyzer`) → write analysis → update relationship context → draft composition (`barryDraftComposer`) → write draft → update timeline → advance conversation state → mark complete. This is a true Workflow.
2. **`barryHunterProcessEngage.js`** — chains 9 operations: load contact → guardrail check → load RECON/ICP → load Barry memory → get strategy recommendation → check mission history → determine goal → build mission structure → generate 4-angle draft. This is a proto-Workflow.

**Skill interface:**

```
Skill {
  skill_id: string                    // 'write_email' | 'research_company' | etc.
  name: string                        // 'WriteEmailSkill'
  type: 'generative' | 'side_effect'
  model: string                       // Claude model ID
  max_tokens: number
  input_schema: JSONSchema            // validated input contract
  output_schema: JSONSchema           // validated output contract
  requires_context: ContextScope[]    // what context layers it needs
  idempotency: 'safe' | 'requires_key'
}
```

**Skills Registry (15 Skills from audit Step 10):**

| Skill | Type | Current Implementation(s) | Consolidates |
|---|---|---|---|
| WriteEmailSkill | generative | `barryHunterProcessEngage`, `barryOutreachMessage`, `barryFirstTouch`, `generate-engagement-message`, `generate-campaign-messages`, `barryBulkPersonalize` | 6 → 1 |
| ResearchCompanySkill | generative | `barryEnrich` (company), `enrichCompany`, `analyze-website` | 3 → 1 |
| ResearchContactSkill | generative | `barryEnrich` (contact), `enrichContact`, `findContact` | 3 → 1 |
| ScoreICPFitSkill | generative | `barryICPConversation` (scoring mode), ICP scoring components | 2 → 1 |
| SummarizeRelationshipSkill | generative | `assembleBarryContext` (context output), `BarryContext.jsx` | 2 → 1 |
| GenerateMeetingBriefSkill | generative | `barryDossierBriefing` | 1 → 1 |
| InferRelationshipStateSkill | generative | `inferRelationshipWarmth`, inline warmth inference | 3 → 1 |
| GenerateNextStepSkill | generative | `nextBestStepService.deriveNextBestStep` | 1 → 1 |
| DraftFollowUpSkill | generative | `generate-followup`, `barryFirstTouch` | 2 → 1 (absorbed into WriteEmailSkill) |
| AnalyzeReplySkill | generative | `process-barry-inbox-queue`, `barryInboxAnalyzer` | 2 → 1 |
| CoachICPSkill | generative | `barry-coach-section`, `barryReconInterview` | 2 → 1 |
| GenerateOrientationSkill | generative | `barryOrientationBrief` | 1 → 1 |
| ComputeHealthScoreSkill | deterministic | `healthScore.js` | 1 → 1 |
| DetectChurnSignalsSkill | deterministic | `barryCSM.detectChurnSignals` | 1 → 1 |
| DetectExpansionSignalsSkill | deterministic | `barryCSM.detectExpansionSignals` | 1 → 1 |

**Workflow interface:**

```
Workflow {
  workflow_id: string                  // 'prepare_meeting' | 'launch_campaign' | etc.
  name: string                        // 'PrepareMeetingWorkflow'
  steps: [{
    skill_id: string
    input_mapping: object              // how to map prior step output to this step's input
    condition: string | null           // optional gate — skip step if condition fails
    error_strategy: 'abort' | 'skip' | 'fallback'
  }]
  intermediate_state: boolean         // whether to persist state between steps
}
```

**Workflows Registry (7 Workflows — 2 promoted from existing, 5 new):**

| Workflow | Skills Chained | Current Equivalent | Status |
|---|---|---|---|
| **ProcessReplyWorkflow** | AnalyzeReplySkill → SummarizeRelationshipSkill → GenerateNextStepSkill → WriteEmailSkill (draft) | `process-barry-inbox-queue.js` (9-step chain) | **Promote** — already works as a chain |
| **EngageContactWorkflow** | InferRelationshipStateSkill → WriteEmailSkill (4-angle) | `barryHunterProcessEngage.js` (9-step chain) | **Promote** — already works as a chain |
| **PrepareMeetingWorkflow** | ResearchCompanySkill → SummarizeRelationshipSkill → GenerateMeetingBriefSkill | `barryDossierBriefing` (monolithic) | New — decompose monolith |
| **LaunchCampaignWorkflow** | ScoreICPFitSkill → ResearchCompanySkill → ResearchContactSkill → WriteEmailSkill | `barryICPConversation` + `barryGenerateMissionSequence` (loosely chained via user) | New — automate user-driven chain |
| **QualifyProspectWorkflow** | ResearchCompanySkill → ScoreICPFitSkill → SummarizeRelationshipSkill | `barryEnrich` + ICP scoring (separate calls) | New |
| **MorningBriefWorkflow** | ComputeHealthScoreSkill → DetectChurnSignalsSkill → GenerateOrientationSkill | `barryOrientationBrief` (monolithic with inline computations) | New — decompose monolith |
| **ReconnectDormantWorkflow** | SummarizeRelationshipSkill → InferRelationshipStateSkill → WriteEmailSkill | No equivalent — done manually today | New |

### 4.8 Capability Registry & Action Executor

**What it does:** Declares what Barry can do through each module and integration. Distinguishes generative capabilities (safe to retry, no side effects) from side-effect capabilities (require idempotency key, require audit trail, ceiling at Approval in Phase 1).

**What exists today:**

`barryActions.js` makes this distinction — but by AI intent parsing, not structural enforcement. The Claude model classifies user intent into `action_type` (one of: `gmail_send`, `gmail_draft`, `gmail_read`, `calendar_book`, `calendar_check`, `none`) and sets `confirmation_required` based on action type. Side-effect actions (`gmail_send`, `calendar_book`) require user confirmation; generative actions (`gmail_draft`, `gmail_read`, `calendar_check`) execute immediately.

The problem: the model decides which actions are safe. If the model misclassifies, a side-effect action could execute without confirmation. The registry enforces this structurally — the model cannot override the capability type.

**Capability Registry Contract:**

```
Capability {
  capability_id: string                // 'gmail.send_email'
  capability_name: string              // 'Send Email via Gmail'
  integration: string                  // 'gmail' | 'calendar' | 'apollo' | 'platform'
  type: 'generative' | 'side_effect'   // structural — not AI-classified
  requires_approval: boolean           // true for all side_effects in Phase 1
  idempotency_key_required: boolean    // true for side_effects
  parameters: ParameterSchema
  output: OutputSchema
  autonomy_ceiling: AutonomyLevel      // max autonomy this capability may reach
}
```

**Generative capabilities** (produce output, no external side effects — safe to retry):
- Generate email draft
- Generate meeting brief
- Research company
- Score ICP fit
- Analyze reply sentiment
- Compute health score
- Generate orientation brief

**Side-effect capabilities** (mutate external state — require idempotency key and approval):
- Send email via Gmail (`gmail.send_email`)
- Create calendar event (`calendar.create_event`)
- Search Apollo for companies (`apollo.search_companies`)
- Search Apollo for people (`apollo.search_people`)
- Move contact between stages (`platform.move_stage`)
- Update contact status (`platform.update_status`)
- Confirm/dismiss NBS (`platform.nbs_action`)

**Action Executor:** Reads from the Action Queue, invokes the registered capability, records the result. Never called directly by a surface or a Skill — only by the orchestration layer after approval is confirmed.

### 4.9 Action Queue

**What it does:** Prioritized list of Recommendations, Prepared Actions, and their status. Barry prepares work and surfaces it. Aaron decides how much authority Barry has to execute.

**What exists today:** No central action queue. The closest equivalent is the NBS (Next Best Step) system (`nextBestStepService.js`), which maintains one pending action per contact with status tracking (`pending`, `confirmed`, `completed`, `dismissed`). But NBS handles only one step at a time and only tracks contact-level next actions — not cross-entity prioritization.

**Action Queue Contract:**

```
ActionItem {
  action_id: string
  workspace_id: string
  type: 'recommendation' | 'prepared_action' | 'scheduled_action'
  priority: number                     // 0 = critical, 1 = high, 2 = medium, 3 = low
  entity_type: string
  entity_id: string

  action_type: string                  // 'send_email' | 'follow_up' | 'review_reply' | 'prepare_brief'
  skill_id: string                     // which Skill prepared this
  workflow_id: string | null           // which Workflow this belongs to

  prepared_content: object | null      // draft email, briefing, scored list
  reasoning: string                    // why Barry recommends this — from Think layer trace
  confidence: number (0.0-1.0)

  status: 'queued' | 'presented' | 'approved' | 'executing' | 'completed' | 'dismissed'
  presented_at: timestamp | null
  decided_at: timestamp | null
  completed_at: timestamp | null

  due_at: timestamp
  created_at: timestamp
  expires_at: timestamp | null
}
```

**Storage:** `users/{userId}/barry_action_queue/{actionId}`

The Action Queue replaces:
- Ad hoc recommendation display in `barryMissionChat` chat responses
- Inline draft generation scattered across engagement panels
- NBS one-at-a-time pending actions (NBS becomes one type of action item in the queue)
- The implicit "prepared action" state where drafts exist in `barry_sessions` without a queue entry

**Accountability**
```
Owner:        Barry OS (storage service)
Readers:      Mission Control, Morning Brief, Barry Surfaces (for prepared action display), Action Executor
Writers:      Think Layer (queues recommendations), Skills/Workflows (queue prepared actions), Action Executor (updates status to executing/completed)
Invalidated:  Items expire at expires_at; dismissed items are terminal; completed items are immutable
Rebuilt by:   Re-derivation from Think Layer — but completed/dismissed history is append-only and never rebuilt
```

### 4.10 Memory Layer

See Section 5 (The Six Memory Types) for the full specification.

**Accountability**
```
Owner:        Barry OS (storage service)
Readers:      Context Resolver (packages memory for Think invocations), Barry Surfaces (display)
Writers:      Promotion pipeline (session → durable via defined gates), signal processors (relationship memory), nightly batch (learned intelligence), Skills (artifact memory)
Invalidated:  Per type — User Memory: permanent until superseded; Relationship Memory: until superseded; Session Memory: session-scoped; see Section 5 for full retention rules
Rebuilt by:   User and Relationship Memory are source-of-truth and not rebuilt; Learned Intelligence can be re-aggregated from signal history; Artifacts can be regenerated by their source Skill
```

### 4.11 Barry Surfaces (Rendering Layer)

Every Barry surface satisfies the same contract:

1. **Context:** Requests context from the Context Resolution Service — never assembles its own
2. **Capabilities:** Invokes actions through the Capability Registry — never calls Netlify functions directly
3. **Conversations:** Stores conversation history in the unified store keyed by `barrySessionKey` — never creates its own conversation collection
4. **Display:** Renders awareness, recommendations, prepared actions, and artifacts from their respective stores — never computes them inline

The 13 current surfaces collapse directionally to ~12 surfaces (audit Step 10, Migration Direction). The primary consolidation is the 5 engagement panels (`HunterEngagementPanel`, `ScoutEngagementPanel`, etc.) into a single capability-driven `EngagementPanel` that reads its available actions from the Capability Registry per module.

---

## 5. The Six Memory Types

| Type | What it stores | Scope | Retention | Who writes it |
|---|---|---|---|---|
| User Memory | Stable facts about Aaron — business, ICP, preferences, goals | Workspace | Permanent | Explicit statements + nightly batch |
| Relationship Memory | Durable knowledge about a Contact or Company — objections, interests, commitments, sentiment | Contact / Company | Until superseded | Signal-driven + explicit |
| Mission Memory | Goals, strategies, decisions, progress for a Mission or Campaign | Mission | Mission lifetime + 90 days | Signal-driven |
| Learned Intelligence | Patterns from approvals, edits, outcomes, rejected recommendations | Workspace | Rolling window | Outcome attribution |
| Session / Conversation Memory | Current Barry conversation, navigation context, temporary intent | Session | Session only — never auto-promoted | Session runtime |
| Artifact Memory | Reusable Barry outputs — meeting briefs, dossiers, prospecting lists, account plans | Entity / Mission | Until superseded or invalidated | Barry on generation |

### Memory Storage Map

| Type | Current Location | Target Location |
|---|---|---|
| User Memory | `users/{uid}/barry_memory` (tone/channel only) + `icpProfiles` + `companyProfile` + `dashboards.communicationStyle` | `users/{uid}/barry_memory/user_profile` — consolidated |
| Relationship Memory | `contacts/{cid}.barry_memory` + `contacts/{cid}.engage_state` + `contacts/{cid}.engagement_summary` | `users/{uid}/barry_awareness/relationships/{cid}` (awareness) + `users/{uid}/barry_memory/relationships/{cid}` (durable memory) |
| Mission Memory | `missions/{mid}` fields (barry_reasoning, step outcomes) | `users/{uid}/barry_memory/missions/{mid}` |
| Learned Intelligence | `users/{uid}/barry_memory` (tone_usage, channel_usage) + `barry_attributions` | `users/{uid}/barry_memory/learned` — expanded with approval patterns, edit tracking, outcome attribution |
| Session Memory | `barryConversations/{key}` (7 distinct keys) + `barry_sessions` (2 levels) | `users/{uid}/barryConversations/{barrySessionKey}` — unified |
| Artifact Memory | Does not exist | `users/{uid}/barry_artifacts/{artifactId}` |

### Critical Rule: Session-to-Durable Memory Gate

**Current violation:** `closeBarrySession()` in `barryMemoryService.js` directly writes session data into `barry_memory` (relationship memory) and `updateUserBarryMemory()` (user memory). Every session end writes to memory regardless of session quality. Session summaries append to `relationship_summary` without summarization — risk of unbounded growth (audit Step 3).

**Architectural rule:** Session memory must never automatically become durable relationship or user memory. The promotion gate:

| Promotion path | Gate | Example |
|---|---|---|
| Session → Relationship Memory | Engagement outcome recorded (reply received, meeting booked, deal won) | A session where Barry drafted a message and the contact replied → the outcome is promoted. The conversation itself is not. |
| Session → User Memory | User explicitly confirms a fact, OR pattern observed across 3+ sessions | Aaron says "I always prefer email over LinkedIn" → promoted. Barry infers it from one session → not promoted. |
| Session → Learned Intelligence | Statistical aggregation only — never single-session writes | After 10 sessions where Aaron chose the "warm" tone, tone_effectiveness updates. After 1 session, nothing writes. |
| Session → Artifact Memory | Barry generates a reusable output and the user accepts it | A meeting brief that Aaron reviewed → persisted as artifact. A draft Aaron dismissed → not persisted. |

### Artifact vs. Prepared Action Boundary

- A **Prepared Action** is work Barry has staged for Aaron's approval before execution. It is in the Action Queue. It has a deadline and an outcome.
- An **Artifact** is a reusable output Barry produced that can be recalled, versioned, and referenced without regeneration. It is not awaiting approval. It persists beyond the session that produced it.

A meeting brief is an Artifact. A drafted reply email is a Prepared Action. A campaign playbook is an Artifact. A queued batch of personalized emails is a set of Prepared Actions.

### Barry Artifacts

| Artifact | Description | Skills Used |
|---|---|---|
| Meeting Brief | Pre-meeting dossier with contact context, relationship history, company intel, talking points | ResearchCompanySkill + SummarizeRelationshipSkill + GenerateMeetingBriefSkill |
| Account Plan | Strategic plan for a high-value company relationship | ResearchCompanySkill + SummarizeRelationshipSkill + GenerateNextStepSkill |
| Prospecting List | Scored and ranked list of target companies/contacts | ScoreICPFitSkill + ResearchCompanySkill + ResearchContactSkill |
| Weekly Review | Summary of week's activity, outcomes, and next week priorities | ComputeHealthScoreSkill + GenerateOrientationSkill |
| Follow-Up Pack | Batch of prepared follow-up messages for overdue contacts | SummarizeRelationshipSkill + WriteEmailSkill (batch) |
| Campaign Playbook | Multi-step outreach strategy for a mission | ScoreICPFitSkill + WriteEmailSkill + GenerateNextStepSkill |
| Morning Brief | Daily orientation with priorities, pending items, and prepared work | ComputeHealthScoreSkill + DetectChurnSignalsSkill + GenerateOrientationSkill |

---

## 6. The Four Awareness Projections

Fully specified in Section 4.4. Summary of staleness and update rules:

| Projection | Storage | Staleness | Update Trigger |
|---|---|---|---|
| Relationship Awareness | `barry_awareness/relationships/{contactId}` | 24 hours or any subject-matching signal | `contact.*` signals |
| Business Awareness | `barry_awareness/business` | 15 minutes or any signal | Any contact or mission signal, daily recomputation |
| Mission Awareness | `barry_awareness/missions` | 6 hours or any mission signal | `mission.*` signals |
| User Awareness | `barry_awareness/user` | 7 days | Nightly batch from user action signals |

---

## 7. The Autonomy Spectrum

For each capability class, five levels define how much authority Barry has:

```
Observe → Recommend → Prepare → Approval → Autonomous
```

| Level | What Barry does | User involvement |
|---|---|---|
| **Observe** | Barry sees a signal but takes no action | None |
| **Recommend** | Barry surfaces a suggestion in the UI | User must initiate the action |
| **Prepare** | Barry stages work (draft email, brief, scored list) | User reviews and may modify |
| **Approval** | Barry presents prepared work with a single "Approve" action | User confirms or dismisses |
| **Autonomous** | Barry executes on a schedule or trigger without user intervention | User sets policy; Barry acts within it |

### Phase 1 Autonomy Settings

For Phase 1: all side-effect capabilities ceiling at **Approval**. Generative capabilities may operate at **Prepare** or below. The autonomy engine that enables **Autonomous** is Phase 11.

| Capability Class | Phase 1 Ceiling | Rationale |
|---|---|---|
| Email Drafting | **Prepare** | Barry drafts; user sends |
| Email Sending | **Approval** | User must confirm every send |
| Contact Enrichment | **Prepare** | Barry enriches; user reviews |
| ICP Scoring | **Prepare** | Barry scores; user acts on scores |
| Meeting Prep | **Prepare** | Barry generates brief; user reviews |
| Campaign Launch | **Approval** | User confirms before any outreach |
| Reply Handling | **Prepare** | Barry drafts reply; user sends |
| Stage Transitions | **Approval** | User confirms stage move |
| Calendar Events | **Approval** | User confirms booking |

**Enforcement:** Autonomy levels are registered in the Capability Registry as `autonomy_ceiling` fields — not enforced by prompt instructions. The current pattern in `barryActions.js` where the Claude model classifies `confirmation_required` is replaced by structural enforcement: if `capability.type === 'side_effect'`, approval is required regardless of what the model outputs.

---

## 8. What Barry OS Will NOT Do

### Barry Data Ownership Matrix

| Object | Owner | Barry may read | Barry may write |
|---|---|---|---|
| Contact | Platform | Yes | No |
| Company | Platform | Yes | No |
| Campaign | Platform | Yes | No |
| Mission | Platform | Yes | No |
| Message | Platform | Yes | No |
| Signal | Platform | Yes | No (publishers only) |
| Awareness | Barry | Yes | Yes |
| Memory | Barry | Yes | Yes (via promotion pipeline) |
| Artifact | Barry | Yes | Yes |
| Recommendation | Barry | Yes | Yes |
| Prepared Action | Barry | Yes | Yes |
| Executed Action | Barry | Yes | Yes (write-once) |
| Conversation | Barry | Yes | Yes |

This is the authoritative ownership model. Any sprint that writes Barry-derived data onto a Platform-owned object violates the architecture. The current violation — `search-companies.js` writing `barry_intel` onto canonical company documents — is the reference example of what this rule prevents.

### Hard Boundaries

These are hard boundaries. Any sprint that violates them should be rejected at review.

Barry OS will not:

- **Own, duplicate, or shadow CRM records.** Contacts, companies, messages, campaigns, and missions belong to canonical collections. Barry derives awareness from them.
- **Store Contacts or Companies independently of canonical collections.** Barry reads canonical data; Barry writes to Barry-owned collections (awareness, memory, action queue, artifacts).
- **Bypass user permissions or workspace boundaries.** All Barry operations are scoped to `userId`. Firestore rules enforce `request.auth.uid == userId`. No cross-user reasoning.
- **Mutate external systems without Capability Registry authorization.** Every side-effect action must flow through the Action Executor with a registered capability and an idempotency key.
- **Invent relationship state not derivable from canonical data.** Barry's awareness projections are rebuildable — deleting the awareness tree and replaying signals must reproduce it.
- **Replace module-specific business logic.** Scout's company discovery, Hunter's mission steps, Sniper's close zone — these are module responsibilities. Barry orchestrates them; Barry does not implement them.
- **Call AI for decisions that should be computed deterministically.** Contact validation (`barryValidateContact`), outcome attribution (`barryOutcomeAttribution`), send approval (`barry-approve-send`), and mode detection in `barryMissionChat` are deterministic operations. They must not use AI (audit Step 6, "AI used for deterministic logic").
- **Create a new Barry implementation for each new integration.** Adding LinkedIn messaging should require registering a capability and publishing signals — not touching 8+ files (audit Step 9).
- **Produce a Recommendation it cannot explain.** Every recommendation carries a reasoning trace from signals → awareness → synthesis → recommendation. If the trace cannot be produced, the recommendation does not ship.
- **Allow Mission Control to query modules directly.** Mission Control is a consumer of Barry's Awareness projections, not an aggregator of module data. The data flow is Mission Control → Awareness → Signals → Modules. Mission Control must never know where data originates. This keeps the UI thin and Barry authoritative.

---

## 9. Migration Direction (High Level)

This is not a migration plan — that is Document 5. This is the directional statement derived from audit findings.

| Current State | Evidence | Barry OS Target |
|---|---|---|
| ~19 Barry component files, 13 audited surfaces | Audit Step 1 | ~12 surfaces with unified contract |
| 8 context implementations, 3 primary assembly paths | Audit Step 3 | 1 context resolver (server-side) |
| 7 conversation stores (drawer_{module} × 9, missionControl, reconCoach_{sectionId}, icpChat, icp, user-level sessions, contact-level sessions) | Audit Step 3 | 1 store keyed by `barrySessionKey` |
| 37 AI Netlify functions, 12 with duplication (32%) | Audit Step 2, Step 5 | 15 named Skills |
| 6 message generation implementations | Audit Step 5 | WriteEmailSkill (1 Skill, multiple modes) |
| 3 morning brief paths (orientation brief, inline chat brief, recommendationEngine) | Audit Step 2 | 1 MorningBriefWorkflow over awareness projections |
| 0 persisted awareness projections (all computed per-request) | Audit Step 3 | 4 persisted awareness projections |
| Think layer reaching 4 of 37 endpoints | barryStrategyRecommender.js call sites | Think layer routing through all 15 Skills |
| 0 named Workflows | Audit Step 1 | 7 Workflows (2 promoted, 5 new) |
| Cost unmeasurable — `logApiUsage` tracks Apollo credits only, not Anthropic tokens | Audit Step 6 | Full telemetry: provider, model, tokens, latency, trace |
| Client-side context assembly shipping 500 contacts per turn | `barryContextStack.js` (audit Step 3) | Server-side entity-scoped context resolution |
| 4 AI-for-deterministic antipatterns | Audit Step 6 | 0 — all deterministic logic computed, not generated |

### Orchestration Example: End to End

"Find me 30 Utah credit unions and prepare outreach" — how this flows through Barry OS:

```
User Request
    │
    ▼
Context Resolver
    │ Resolves: User Awareness (ICP, preferences),
    │   Business Awareness (pipeline state)
    │
    ▼
Think Layer
    │ Determines: LaunchCampaignWorkflow
    │   with parameters: industry=credit_unions, location=Utah, count=30
    │ Produces: reasoning trace, strategy scores
    │
    ▼
Orchestrator (LaunchCampaignWorkflow)
    │
    ├── Step 1: ScoreICPFitSkill
    │     Input: industry=credit_unions, location=Utah
    │     Output: ICP scoring criteria for credit unions
    │
    ├── Step 2: ResearchCompanySkill (via apollo.search_companies)
    │     Input: search_companies(industry=credit_unions, state=Utah, limit=30)
    │     Output: 30 company records
    │
    ├── Step 3: ResearchContactSkill (via apollo.search_people) × 30
    │     Input: search_people(company_id, titles=ICP_target_titles)
    │     Output: Contact records per company
    │
    ├── Step 4: ScoreICPFitSkill × 30
    │     Input: company + contacts against ICP criteria
    │     Output: Scored and ranked matches
    │
    ├── Step 5: WriteEmailSkill × top 30
    │     Input: contact context + ICP messaging + campaign template
    │     Output: Draft outreach messages
    │
    └── Step 6: Queue to Action Queue
          30 prepared outreach messages
          Status: Prepared (awaiting approval)
          → Surfaces in Morning Brief
```

**Current architecture cannot do this.** Today this requires: user manually searches in Scout, manually accepts companies one by one, manually creates a mission per contact, Barry generates steps one at a time, user approves each step individually (audit Step 10).

---

## 10. The Barry OS Constitution

These are the architectural laws every future Barry sprint must follow. No sprint that violates these laws should be approved.

1. There is one Barry. UI surfaces vary. Intelligence does not.
2. Barry is never called directly from business logic. Business logic publishes signals. Barry observes them.
3. Modules publish signals. Barry consumes them. Modules are applications running on Barry OS.
4. Integrations publish normalized events and register capabilities. They do not create new Barry implementations.
5. Barry never owns canonical CRM data. Contacts, companies, messages, and campaigns remain canonical domain objects. Barry derives awareness from them.
6. Barry maintains derived awareness, recommendations, memory, skills, and workflows.
7. Every Barry surface uses the same context service.
8. Every Barry action uses the same capability registry.
9. No feature creates its own Barry context implementation.
10. Mission Control aggregates across three horizons organized around user work. It does not replace modules.
11. Barry recommendations must be explainable.
12. Barry must understand what changed since the user's last session.
13. Barry prepares work proactively but respects autonomy settings.
14. New integrations become Barry-readable without rewriting Barry.
15. Improving Barry's intelligence improves Barry everywhere.
16. Barry's cost must be measurable and improvable.
17. Signals, awareness state, recommendations, prepared actions, and executed actions are distinct concepts. Barry OS must never conflate them.
18. Session memory must not automatically become durable relationship or user memory.
19. Generative capabilities and side-effect capabilities are different classes. Barry must treat them differently.
20. AI is used for reasoning, judgment, and language. Deterministic business logic is computed, not generated.
21. Barry orchestrates Skills and Workflows to accomplish larger goals, not just respond to individual prompts.
22. Between awareness and recommendation, Barry thinks — synthesizing information, comparing priorities, and choosing strategy. This Think layer is where Idynify's differentiation lives.
23. Skills are atomic. Workflows are compositions of Skills. Neither is a Barry context implementation.
24. Barry OS will not own CRM records, bypass permissions, mutate external systems without policy, invent relationship state, or replace module-specific business logic.
25. Skills are atomic. Workflows compose Skills. Neither is a Barry context implementation. A Skill is the smallest independently executable Barry capability. A Workflow is a named, ordered composition of Skills that accomplishes a larger goal. No Skill contains workflow logic. No Workflow duplicates Skill logic. Neither a Skill nor a Workflow owns context — context is resolved before either is invoked.

---

## Morning Brief Data Contract

Data required to produce a complete morning briefing without additional AI calls (precomputed from awareness projections):

```
MorningBriefData {
  // Horizon 1 — Act Now
  responses_pending: [{
    contact_id, contact_name, company,
    reply_preview, received_at,
    draft_ready: boolean
  }]
  meetings_today: [{
    event_id, title, contact_id, contact_name,
    start_time, brief_ready: boolean
  }]
  nbs_overdue: [{
    nbs_id, contact_id, contact_name,
    action, due_at, days_overdue
  }]

  // Horizon 2 — In Motion
  active_missions_summary: {
    total, on_track, at_risk, stalled
  }
  pipeline_movement: {
    new_this_week, stage_changes, responses_received
  }
  follow_ups_due_this_week: [{
    contact_id, contact_name, action, due_at
  }]

  // Horizon 3 — Strategic
  relationships_at_risk: [{
    contact_id, contact_name, risk_reason, days_since_contact
  }]
  icp_match_quality: { avg_score, trend_direction }
  goal_progress: [{
    mission_name, progress_pct, days_remaining
  }]

  // Barry Prepared
  prepared_actions: [{
    action_id, type, contact_name, description, prepared_at
  }]
  drafted_replies: [{
    contact_id, contact_name, draft_preview
  }]

  // Meta
  total_contacts: number
  total_active_relationships: number
  computed_at: timestamp
}
```

---

## Enterprise Foundation Roadmap

Based on audit Step 7 findings — current state, gaps, and priority:

| Foundation | Current State | Gap | Priority | Dependency |
|---|---|---|---|---|
| **Observability** | `logApiUsage` tracks Apollo credits only. No token tracking, no latency monitoring, no tracing. | Full telemetry: provider, model, tokens, latency, reasoning trace per call | **Critical — build first** | None |
| **Idempotency** | None for outbound actions. `gmail-send` has no dedup. Netlify retries can double-send. | Idempotency keys on all side-effect capabilities. Dedup on notification generation. | **High** | None |
| **Auditability** | Partial — attribution exists (`barryOutcomeAttribution`), session logs exist. No prompt logging. | Persist prompts, context snapshots, reasoning traces. Explainable recommendations. | **High** | Observability |
| **Permissions** | None per-capability. Barry has user's full access. | Autonomy spectrum per capability class. Policy engine. | **High** | Signal Bus |
| **Reliability** | Basic try/catch. `emptyStack()` fallback. No circuit breaker. | Circuit breaker for external services. Degraded-mode Barry. Cached reasoning fallback. | Medium | Observability |
| **Confidence** | RECON confidence score exists. AI recommendations carry no confidence. | Confidence scores on all AI outputs. Staleness indicators on awareness. | Medium | Think Layer |
| **Evaluation** | No framework. Attribution data exists but not aggregated. No A/B testing. | Recommendation acceptance rate. Message effectiveness. NBS completion rate. Baseline metrics. | Medium | Observability + Auditability |
| **Identity/Tenancy** | Firebase Auth, single-user workspaces. User IS the tenant. | Only needed for multi-user workspaces (team accounts). | Low (MVP) | None |

**Recommended build order:** Observability → Idempotency → Auditability → Permissions/Autonomy → Reliability → Confidence → Evaluation → Identity/Tenancy (only if multi-user)

---

## The North Star

When Barry OS is complete, Aaron opens Idynify in the morning. Barry says:

> "Good morning Aaron. While you were away — 10 people responded. I've drafted replies for all of them based on where each person is in their mission. 28 companies matched your credit union ICP — I pulled the right titles at each one, ready for your approval. 12 Reinforcements are due for a touch — warm emails are queued. You have one meeting today at 2pm with Zions Bank. Here's the brief. Want to start with the responses or the meeting prep?"

Aaron says: "Responses."

Barry walks him through each one. Aaron confirms, adjusts, or skips. Barry executes.

**How the architecture delivers this:**

| Part of the experience | Component | Section |
|---|---|---|
| "While you were away — 10 people responded" | Signal Bus (`contact.reply_received` × 10) → Business Awareness (`responses_pending_count: 10`) | 4.2, 4.4 |
| "I've drafted replies for all of them" | ProcessReplyWorkflow (AnalyzeReplySkill → WriteEmailSkill × 10) → Action Queue (10 Prepared Actions) | 4.7, 4.9 |
| "based on where each person is in their mission" | Context Resolution (per-contact Relationship Awareness + Mission Memory) → Think Layer (strategy per contact) | 4.5, 4.6 |
| "28 companies matched your credit union ICP" | LaunchCampaignWorkflow (ScoreICPFitSkill → ResearchCompanySkill × 28) → Action Queue | 4.7, 4.9 |
| "I pulled the right titles at each one, ready for your approval" | ResearchContactSkill × 28 → Prepared Actions at **Approval** ceiling | 4.7, 7 |
| "12 Reinforcements are due for a touch — warm emails are queued" | Signal Bus (`nbs.overdue` × 12) → WriteEmailSkill × 12 → Action Queue | 4.2, 4.7 |
| "You have one meeting today at 2pm with Zions Bank. Here's the brief" | Signal Bus (`meeting.today`) → PrepareMeetingWorkflow → Artifact (Meeting Brief) | 4.2, 4.7, 5 |
| "Want to start with the responses or the meeting prep?" | Think Layer (priority synthesis: responses first vs. meeting first) → Morning Brief display | 4.6, Morning Brief Contract |
| "Aaron confirms, adjusts, or skips. Barry executes." | Action Queue status transitions → Action Executor → Capability Registry | 4.8, 4.9 |

Every component traces back to this experience. Every section in this architecture document exists to make some part of it possible.

---

*No code was written or changed during this audit. This document is an architecture specification only.*
