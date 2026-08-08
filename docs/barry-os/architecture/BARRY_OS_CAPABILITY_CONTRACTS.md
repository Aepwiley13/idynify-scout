# Barry OS Skills, Workflows, API & Capability Contracts

**Idynify · Document 4 of 5 · Team B**
**Date: 2026-08-08**
**Repository: aepwiley13/idynify-scout**
**Source of Truth: docs/audits/BARRY_OS_FOUNDATION_AUDIT.md (canonical audit — pinned to commit 09e90f9)**
**Discovery Authority: docs/audits/BARRY_OS_AUDIT_RECONCILIATION.md**

---

## Governance

This document operationalizes the architecture defined in Documents 1, 2, and 3. It turns object definitions, lifecycle models, and signal contracts into executable capability contracts. It does not redefine them.

```
Constitutional Brief        ← historical intent
        ↓
Canonical Audit             ← repository evidence
        ↓
Reconciliation Addendum     ← final discovery truth
        ↓
Reference Architecture      ← Document 1 — FROZEN 2026-08-07
        ↓
Domain & Lifecycle Model    ← Document 2 — FROZEN 2026-08-08
        ↓
Signal Specification        ← Document 3 — FROZEN 2026-08-08
        ↓
Capability Contracts        ← THIS DOCUMENT — Skills, Workflows, API, Actions
        ↓
Implementation Plan         ← build order
```

The architecture freeze rule is in force. Documents 1, 2, and 3 are frozen. This document may reference them, derive from them, and operationalize them. It may not redefine objects, lifecycle states, signal contracts, or ownership boundaries established in those documents.

## Evidence Levels

```
CONFIRMED   Verified in the canonical audit at a specific file or line.
            This finding exists in the repository today.

PROPOSED    A new architectural recommendation not present in the codebase today.
            Justified explicitly. Requires approval before implementation begins.
```

---

# Part I: Architectural Resolutions

Before defining contracts, this document resolves open architectural questions inherited from Documents 1–3. Each resolution is numbered, justified, and binding on all subsequent sections.

---

## Resolution R4-001: Canonical Ownership of Bounce Events

**Status:** RESOLUTION REQUIRED

**Problem:** Document 3 (Signal Specification, frozen) defines two signals for the same real-world event — an outbound email bouncing:

| Signal | Entity | Awareness Updates | Evidence |
|---|---|---|---|
| `contact.email_bounced` | Contact | Relationship Awareness: `consecutive_no_replies` += 1, `risk_score` increase, `channel_effectiveness.email` degradation. Business Awareness: pipeline health. | PROPOSED |
| `message.bounced` | Message | "Same as `contact.email_bounced`" | PROPOSED |

Both signals are PROPOSED (no emission point exists in the repository). Both produce identical awareness updates. Two canonical signals for one real-world event violates the Single Source of Truth principle (Document 1, Section 1).

**Analysis:**

The underlying fact is: *an outbound email failed to deliver*. This fact has two perspectives:

1. **Contact perspective** — "this person's email address bounced." Affects the Contact's reachability, the Relationship's risk profile, and channel effectiveness scoring. This is the perspective that drives action — Barry needs to know whether to keep emailing this person.

2. **Message perspective** — "this specific message was not delivered." Affects the Message object's lifecycle state (`delivered` → `bounced`). This is a record-keeping perspective — the canonical audit trail of what happened to a specific communication.

**Resolution:**

`contact.email_bounced` is the **canonical signal**. It represents the underlying fact: a delivery failure occurred for a contact's email address.

`message.bounced` is **retired as a separate signal type**. The Message object's lifecycle transition to `bounced` is a **downstream effect** of the `contact.email_bounced` signal, not a separate event. The Observation pipeline handles this:

```
Real-world event: Gmail reports delivery failure
        ↓
Signal emitted: contact.email_bounced
        ↓
Observation pipeline (Stage 3: Observation Generation):
   Observation 1: relationship_event → Relationship Awareness update
   Observation 2: business_event → Business Awareness update
   Observation 3: message_lifecycle → Message.lifecycle_state = bounced
        ↓
One signal, one fact, multiple projections
```

**Why `contact.email_bounced` wins over `message.bounced`:**

1. **The fact belongs to the Contact, not the Message.** An email bounces because of the *recipient's address or domain*, not because of the message content. The same contact's next email will also bounce if the address is invalid. The Contact is the entity with durable state that changes.

2. **The Message is a record, not an actor.** Messages are Canonical/Durable records of communications. They record what happened. They don't originate events — they receive lifecycle updates from the Observation pipeline. A Message transitioning to `bounced` is an effect, not a cause.

3. **Awareness updates target Relationship and Business projections.** Both projections are keyed by Contact/Company, not by Message. The signal's natural home is the entity whose awareness projections it feeds.

4. **The producer is the Gmail integration.** Gmail reports bounces per-recipient, not per-message. The signal shape matches the producer's output.

**Impact on Document 3 (frozen):**

Document 3's signal catalog retains `contact.email_bounced` unchanged. `message.bounced` remains listed in the catalog as a defined signal type — Document 3 is frozen and its catalog cannot be modified. However, this resolution establishes that:

- `message.bounced` will NOT be implemented as a separate signal emitter
- The Message lifecycle transition to `bounced` is handled by the Observation pipeline's processing of `contact.email_bounced`
- Document 5 will not schedule implementation of a `message.bounced` producer
- If a future need arises for a message-scoped bounce signal, it must be a **derived translation** of `contact.email_bounced`, not an independent emission

**Observation pipeline mapping (updated):**

| Signal | Observation | Target | Effect |
|---|---|---|---|
| `contact.email_bounced` | `relationship_event` | Relationship Awareness | `consecutive_no_replies` += 1 (hard bounce), `risk_score` increase, `channel_effectiveness.email` degradation |
| `contact.email_bounced` | `business_event` | Business Awareness | Pipeline health signal |
| `contact.email_bounced` | `message_lifecycle` | Message object | `lifecycle_state` → `bounced`, `bounce_type`, `bounce_reason` recorded |

---

## Resolution R4-002: Skill Consolidation Map

**Status:** RESOLUTION — binding

**Problem:** The canonical audit (Step 5) identified 20 duplicate implementation groups across 38 AI endpoints. Document 1 proposed 15 Skills to consolidate these. This resolution confirms the final Skill inventory and maps every current implementation to its target Skill.

**The 15 Skills — confirmed from Document 1, Section 4.7:**

| # | Skill ID | Type | Consolidates From | Count |
|---|---|---|---|---|
| 1 | `WriteEmailSkill` | generative | `barryHunterProcessEngage`, `barryOutreachMessage`, `barryFirstTouch`, `generate-engagement-message`, `generate-campaign-messages`, `barryBulkPersonalize` | 6 → 1 |
| 2 | `ResearchCompanySkill` | generative | `barryEnrich` (company), `enrichCompany`, `analyze-website` | 3 → 1 |
| 3 | `ResearchContactSkill` | generative | `barryEnrich` (contact), `enrichContact`, `findContact` | 3 → 1 |
| 4 | `ScoreICPFitSkill` | generative | `barryICPConversation` (scoring mode), ICP scoring components | 2 → 1 |
| 5 | `SummarizeRelationshipSkill` | generative | `assembleBarryContext` (context output), `BarryContext.jsx` | 2 → 1 |
| 6 | `GenerateMeetingBriefSkill` | generative | `barryDossierBriefing` | 1 → 1 |
| 7 | `InferRelationshipStateSkill` | generative | `inferRelationshipWarmth`, inline warmth inference in `barryHunterProcessEngage`, `barry_warmth_suggestion` field | 3 → 1 |
| 8 | `GenerateNextStepSkill` | generative | `nextBestStepService.deriveNextBestStep` | 1 → 1 |
| 9 | `DraftFollowUpSkill` | generative | `generate-followup`, `barryFirstTouch` | 2 → 1 (absorbed into WriteEmailSkill) |
| 10 | `AnalyzeReplySkill` | generative | `process-barry-inbox-queue`, `barryInboxAnalyzer` | 2 → 1 |
| 11 | `CoachICPSkill` | generative | `barry-coach-section`, `barryReconInterview` | 2 → 1 |
| 12 | `GenerateOrientationSkill` | generative | `barryOrientationBrief` | 1 → 1 |
| 13 | `ComputeHealthScoreSkill` | deterministic | `healthScore.js` | 1 → 1 |
| 14 | `DetectChurnSignalsSkill` | deterministic | `barryCSM.detectChurnSignals` | 1 → 1 |
| 15 | `DetectExpansionSignalsSkill` | deterministic | `barryCSM.detectExpansionSignals` | 1 → 1 |

**Note on DraftFollowUpSkill (#9):** This Skill is absorbed into `WriteEmailSkill` as a parameter variant (`message_intent: 'follow_up'`). It does not exist as a separate registry entry. The 15-Skill count from Document 1 remains canonical; the effective registry contains 14 distinct entries.

**Disposition of current implementations after consolidation:**

| Current Implementation | Target Skill | Disposition |
|---|---|---|
| `barryHunterProcessEngage` | `WriteEmailSkill` | Refactor — extract message generation into Skill call |
| `barryOutreachMessage` | `WriteEmailSkill` | Delete — replaced by Skill |
| `barryFirstTouch` | `WriteEmailSkill` | Delete — absorbed as `message_intent: 'first_touch'` |
| `generate-engagement-message` | `WriteEmailSkill` | Delete — legacy |
| `generate-campaign-messages` | `WriteEmailSkill` | Delete — replaced by batch Skill invocation |
| `barryBulkPersonalize` | `WriteEmailSkill` | Delete — replaced by batch Skill invocation |
| `generate-followup` | `WriteEmailSkill` | Delete — absorbed as `message_intent: 'follow_up'` |
| `barryEnrich` (company path) | `ResearchCompanySkill` | Refactor — extract company enrichment |
| `barryEnrich` (contact path) | `ResearchContactSkill` | Refactor — extract contact enrichment |
| `enrichCompany` | `ResearchCompanySkill` | Delete — replaced by Skill |
| `enrichContact` | `ResearchContactSkill` | Delete — replaced by Skill |
| `analyze-website` | `ResearchCompanySkill` | Refactor — becomes internal implementation detail |
| `barryICPConversation` (scoring) | `ScoreICPFitSkill` | Refactor — extract scoring mode |
| `assembleBarryContext` | `SummarizeRelationshipSkill` | Refactor — output consumed by Skill |
| `barryDossierBriefing` | `GenerateMeetingBriefSkill` | Refactor — becomes Skill wrapper |
| `inferRelationshipWarmth` | `InferRelationshipStateSkill` | Refactor — becomes Skill |
| `nextBestStepService.deriveNextBestStep` | `GenerateNextStepSkill` | Refactor — becomes Skill |
| `process-barry-inbox-queue` (analysis) | `AnalyzeReplySkill` | Refactor — extract analysis step |
| `barry-coach-section` | `CoachICPSkill` | Refactor — becomes Skill |
| `barryReconInterview` | `CoachICPSkill` | Delete — less capable duplicate |
| `barryOrientationBrief` | `GenerateOrientationSkill` | Refactor — becomes Skill |
| `healthScore.js` | `ComputeHealthScoreSkill` | Refactor — becomes Skill |
| `barryCSM.detectChurnSignals` | `DetectChurnSignalsSkill` | Refactor — becomes Skill |
| `barryCSM.detectExpansionSignals` | `DetectExpansionSignalsSkill` | Refactor — becomes Skill |
| `barryValidateContact` | N/A | Delete — replace with deterministic validation (no AI) |
| `barryOutcomeAttribution` | N/A | Delete — replace with deterministic data join (no AI) |
| `barry-approve-send` | N/A | Refactor — becomes Action Executor side-effect handler (no AI) |

---

## Resolution R4-003: Workflow Composition Rules

**Status:** RESOLUTION — binding

**Problem:** Document 1 defines 7 Workflows. Document 2 defines the Workflow object with lifecycle states and field schemas. Neither document specifies the rules governing how Workflows compose Skills, handle failures across steps, or manage intermediate state.

**Resolution:**

1. **A Workflow is a sequence, not a graph.** Steps execute in order. There are no branches, no parallel steps, no conditional forks. If a step's `condition` evaluates to false, the step is skipped and the next step receives the prior step's output. This keeps the execution model debuggable.

2. **Each step invokes exactly one Skill.** A step may not invoke another Workflow (no nesting). A step may not invoke a Capability directly — only Skills invoke Capabilities, and they do so on behalf of the Workflow step.

3. **Failure strategies are per-step, not per-Workflow.** Each step declares `on_failure: 'skip' | 'abort' | 'retry'`. `abort` stops the Workflow and marks it failed. `skip` records the failure and continues to the next step. `retry` re-invokes the Skill once (exactly once — no retry loops).

4. **Intermediate state is persisted between steps.** Each step's output is written to the Workflow execution record before the next step begins. If the Workflow fails mid-execution, the partial result is available for inspection and manual completion.

5. **A Workflow produces one Prepared Action per terminal step that generates user-facing content.** Not every step produces a Prepared Action — intermediate computation steps (e.g., `ResearchCompanySkill` in `PrepareMeetingWorkflow`) produce data consumed by the next step. Only steps whose output is user-facing content (a draft email, a brief, a scored recommendation) produce Prepared Actions.

6. **Context is resolved once, before the Workflow begins.** The Workflow's `context_requirements` field is the union of all its steps' context requirements. The Context Resolver assembles this once. Steps do not re-resolve context mid-Workflow.

---

## Resolution R4-004: AI-for-Deterministic Elimination

**Status:** RESOLUTION — binding

**Problem:** The canonical audit (Step 6) identified four implementations where AI is used for deterministic logic. These waste tokens, introduce nondeterminism, and complicate debugging.

**Resolution:**

| Current Implementation | Current Behavior | Replacement | Rationale |
|---|---|---|---|
| `barryValidateContact` | AI-powered contact validation (Sonnet) | Deterministic field validation rules | Email format, required fields, duplicate detection are pattern-matching — not reasoning |
| `barryOutcomeAttribution` | AI-assisted outcome-to-advice linking | Deterministic data join on `recommendation_id` → `executed_action_id` chain | Attribution is a join across the Recommendation → Prepared Action → Executed Action chain (Document 2). The chain is explicit. |
| `barry-approve-send` (AI path) | AI intent classification for send approval | Structural permission check via Capability Registry | The Capability Registry (Document 1, Section 4.8) structurally enforces `requires_approval`. The model cannot override this. |
| `barryMissionChat` (mode detection) | AI-classified mode switching | Deterministic heuristics (already present) | Mode detection already uses simple heuristics. The AI call is redundant. |

These four eliminations remove ~4 AI call sites, saving an estimated 5,000–10,000 tokens per active user per day.

---

# Part II: Skill Contracts

Each Skill is a standalone contract. The contract defines what goes in, what comes out, what context is required, and what Capabilities (if any) are invoked. Skills are registered at deploy time, not created at runtime (Document 2, Skill §7).

Every Skill contract follows this structure:
- **Input schema** — what the caller provides
- **Output schema** — what the Skill returns
- **Context requirements** — which Awareness projections and Memory types are needed
- **Capabilities invoked** — which external integrations are called (if any)
- **Model policy** — which Claude model tier and token budget
- **Idempotency** — whether the Skill is safe to retry
- **Current implementations** — what existing code this replaces

---

## Skill 1: WriteEmailSkill

**Skill ID:** `WriteEmailSkill`
**Type:** generative
**Idempotency:** safe (no side effects — produces a draft, not a sent message)

**Purpose:** Generate one or more email drafts for a contact, given a message intent and context. This is Barry's most-used capability — it absorbs 6 current implementations (audit Step 5).

**Input schema:**

```
WriteEmailInput {
  contact_id: string
  company_id: string | null
  relationship_id: string
  
  message_intent: string          // first_touch | follow_up | engagement | campaign | reply | custom
  message_count: number           // 1 for single, 4 for multi-angle (Hunter flow)
  
  // Optional overrides
  subject_hint: string | null     // user-provided subject guidance
  tone: string | null             // formal | conversational | direct
  length: string | null           // brief | standard | detailed
  
  // Campaign context (when message_intent = 'campaign')
  campaign_id: string | null
  step_number: number | null
  sequence_context: object | null // prior steps in the campaign for continuity
  
  // Reply context (when message_intent = 'reply')
  reply_to_message_id: string | null
  reply_analysis: object | null   // output from AnalyzeReplySkill
}
```

**Output schema:**

```
WriteEmailOutput {
  drafts: [{
    draft_id: string              // generated unique ID
    subject: string
    body: string
    angle: string | null          // for multi-angle: direct | value_add | referral | social_proof
    tone: string
    estimated_word_count: number
  }]
  strategy_used: string           // from Think Layer's StrategyRecommendation
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Context requirements:**
- Relationship Awareness (engagement history, channel effectiveness, risk score)
- Business Awareness (ICP status, pipeline position)
- Relationship Memory (past interactions, user preferences for this contact)
- User Memory (writing style, tone preferences)
- Contact canonical fields (name, title, company, email)
- Company canonical fields (name, industry, size)

**Capabilities invoked:** None (generative — produces drafts only)

**Model policy:**
- Default: `claude-haiku-4-5` (single draft, standard complexity)
- Escalation: `claude-sonnet-4-5` (multi-angle, campaign sequences, or when strategy complexity score > 0.7)
- Max tokens: 800 (single) / 2500 (multi-angle)

**Current implementations consolidated:**

| Implementation | How it maps |
|---|---|
| `barryHunterProcessEngage` | `message_intent: 'engagement'`, `message_count: 4` |
| `barryOutreachMessage` | `message_intent: 'first_touch'`, `message_count: 1` |
| `barryFirstTouch` | `message_intent: 'first_touch'`, `message_count: 1` |
| `generate-engagement-message` | `message_intent: 'engagement'`, `message_count: 1` |
| `generate-campaign-messages` | `message_intent: 'campaign'`, batch invocation |
| `barryBulkPersonalize` | `message_intent: 'campaign'`, batch invocation |
| `generate-followup` | `message_intent: 'follow_up'`, `message_count: 1` |

---

## Skill 2: ResearchCompanySkill

**Skill ID:** `ResearchCompanySkill`
**Type:** generative
**Idempotency:** safe

**Purpose:** Research and synthesize company information from multiple sources — Apollo data, website analysis, and existing platform data — into a structured intelligence profile.

**Input schema:**

```
ResearchCompanyInput {
  company_id: string
  company_name: string
  domain: string | null
  
  research_depth: string          // quick | standard | deep
  // quick: Apollo data + existing platform data only
  // standard: + website analysis
  // deep: + competitive context, news, industry analysis
  
  focus_areas: string[] | null    // icp_fit | market_position | tech_stack | growth_signals
}
```

**Output schema:**

```
ResearchCompanyOutput {
  company_profile: {
    summary: string
    industry: string
    employee_count: string | null
    revenue_range: string | null
    tech_stack: string[] | null
    growth_signals: string[] | null
    key_findings: string[]
  }
  enrichment_sources: string[]    // which sources contributed
  confidence: number              // 0.0-1.0 based on data completeness
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Context requirements:**
- Company canonical fields
- Business Awareness (existing company intelligence)

**Capabilities invoked:**
- `apollo.search_companies` (side_effect — external API call)
- `platform.analyze_website` (side_effect — external fetch)

**Model policy:**
- Default: `claude-sonnet-4-5` (synthesis requires reasoning)
- Max tokens: 1500

**Current implementations consolidated:** `barryEnrich` (company path), `enrichCompany`, `analyze-website`

---

## Skill 3: ResearchContactSkill

**Skill ID:** `ResearchContactSkill`
**Type:** generative
**Idempotency:** safe

**Purpose:** Research and enrich contact information, synthesizing data from Apollo, existing platform records, and relationship context.

**Input schema:**

```
ResearchContactInput {
  contact_id: string
  contact_name: string
  email: string | null
  company_id: string | null
  
  research_depth: string          // quick | standard | deep
  focus_areas: string[] | null    // role_context | decision_authority | engagement_history
}
```

**Output schema:**

```
ResearchContactOutput {
  contact_profile: {
    title: string | null
    seniority: string | null
    department: string | null
    linkedin_url: string | null
    key_findings: string[]
  }
  enrichment_sources: string[]
  confidence: number
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Context requirements:**
- Contact canonical fields
- Company canonical fields (if company_id provided)
- Relationship Awareness (existing relationship context)

**Capabilities invoked:**
- `apollo.search_people` (side_effect)
- `apollo.enrich_contact` (side_effect)

**Model policy:**
- Default: `claude-sonnet-4-5`
- Max tokens: 1000

**Current implementations consolidated:** `barryEnrich` (contact path), `enrichContact`, `findContact`

---

## Skill 4: ScoreICPFitSkill

**Skill ID:** `ScoreICPFitSkill`
**Type:** generative
**Idempotency:** safe

**Purpose:** Evaluate how well a company matches the user's Ideal Customer Profile. Consumes ICP profile definition and company data to produce a structured score with reasoning.

**Input schema:**

```
ScoreICPFitInput {
  company_id: string
  icp_profile_id: string
  
  // Company data (from ResearchCompanySkill output or existing data)
  company_data: {
    industry: string | null
    employee_count: string | null
    revenue_range: string | null
    tech_stack: string[] | null
    location: string | null
  }
  
  // ICP criteria
  icp_criteria: {
    target_industries: string[]
    target_size_range: string
    target_revenue_range: string | null
    required_tech: string[] | null
    geographic_focus: string[] | null
    custom_criteria: object | null
  }
}
```

**Output schema:**

```
ScoreICPFitOutput {
  icp_score: number               // 0-100
  icp_decision: string            // accepted | rejected | needs_review
  scoring_breakdown: [{
    criterion: string
    score: number
    weight: number
    reasoning: string
  }]
  recommendation: string          // brief recommendation text
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Context requirements:**
- ICP Profile (user's active ICP definition)
- Company canonical fields
- Business Awareness (market context)

**Capabilities invoked:** None (pure evaluation)

**Model policy:**
- Default: `claude-sonnet-4-5` (scoring requires structured reasoning)
- Max tokens: 1500

**Current implementations consolidated:** `barryICPConversation` (scoring mode), ICP scoring components

**Note on `score-icp-fit`:** Document 3's producer migration table lists `score-icp-fit` as PROPOSED — the file does not exist in the repository. This Skill is the implementation target for that entry. The `company.icp_evaluated` signal is emitted when ScoreICPFitSkill completes and writes `icp_evaluation_status`, `icp_decision`, `icp_score`, and `icp_evaluated_at` to the Company record (Document 2, Company §13 fields).

---

## Skill 5: SummarizeRelationshipSkill

**Skill ID:** `SummarizeRelationshipSkill`
**Type:** generative
**Idempotency:** safe

**Purpose:** Produce a structured summary of a relationship's current state, engagement history, and strategic context. Consumed by other Skills (WriteEmailSkill, GenerateMeetingBriefSkill) and by Barry Surfaces for display.

**Input schema:**

```
SummarizeRelationshipInput {
  contact_id: string
  relationship_id: string
  
  summary_depth: string           // brief | standard | comprehensive
  focus: string | null            // engagement | risk | opportunity | all
}
```

**Output schema:**

```
SummarizeRelationshipOutput {
  summary: string                 // narrative summary
  key_metrics: {
    engagement_level: string      // from Relationship Awareness
    risk_score: number
    days_since_last_contact: number
    total_interactions: number
    channel_effectiveness: object
  }
  strategic_context: string       // what matters about this relationship now
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Context requirements:**
- Relationship Awareness (full projection)
- Relationship Memory
- Contact canonical fields
- Company canonical fields

**Capabilities invoked:** None

**Model policy:**
- Default: `claude-haiku-4-5` (summarization, not reasoning)
- Max tokens: 500 (brief) / 1000 (standard) / 1500 (comprehensive)

**Current implementations consolidated:** `assembleBarryContext` (context output), `BarryContext.jsx`

---

## Skill 6: GenerateMeetingBriefSkill

**Skill ID:** `GenerateMeetingBriefSkill`
**Type:** generative
**Idempotency:** safe

**Purpose:** Generate a pre-meeting briefing document for a scheduled meeting with a known contact. Synthesizes relationship history, company intelligence, and strategic recommendations into an actionable brief.

**Input schema:**

```
GenerateMeetingBriefInput {
  contact_id: string
  relationship_id: string
  meeting_id: string | null       // calendar event ID
  
  meeting_type: string            // first_meeting | follow_up | quarterly_review | custom
  meeting_date: timestamp
  attendees: string[] | null      // other attendees beyond the primary contact
  agenda: string | null           // user-provided agenda
}
```

**Output schema:**

```
GenerateMeetingBriefOutput {
  brief: {
    executive_summary: string
    relationship_context: string
    company_intelligence: string
    talking_points: string[]
    questions_to_ask: string[]
    risks_and_opportunities: string[]
    preparation_checklist: string[]
  }
  data_freshness: {
    contact_last_updated: timestamp
    company_last_enriched: timestamp | null
    relationship_awareness_age: string
  }
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Context requirements:**
- Relationship Awareness (full projection)
- Business Awareness (company intelligence, pipeline)
- Relationship Memory
- Contact + Company canonical fields
- Meeting calendar data

**Capabilities invoked:** None (generative only — the brief is a Prepared Action)

**Model policy:**
- Default: `claude-sonnet-4-5` (synthesis of multiple data sources requires reasoning)
- Max tokens: 2000

**Current implementations consolidated:** `barryDossierBriefing`

---

## Skill 7: InferRelationshipStateSkill

**Skill ID:** `InferRelationshipStateSkill`
**Type:** generative
**Idempotency:** safe

**Purpose:** Infer the current engagement state and warmth level of a relationship from signal history, communication patterns, and awareness projections. Replaces three inconsistent warmth inference paths (audit Step 5).

**Input schema:**

```
InferRelationshipStateInput {
  contact_id: string
  relationship_id: string
  
  signal_window_days: number      // how far back to look (default: 90)
}
```

**Output schema:**

```
InferRelationshipStateOutput {
  warmth_level: string            // hot | warm | cooling | cold | dormant
  engagement_status: string       // active | responsive | unresponsive | silent
  momentum_direction: string     // improving | stable | declining
  confidence: number              // 0.0-1.0
  contributing_factors: [{
    factor: string
    weight: number
    evidence: string
  }]
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Context requirements:**
- Relationship Awareness (engagement history, signal counts, channel effectiveness)
- Relationship Memory (historical context)

**Capabilities invoked:** None

**Model policy:**
- Default: `claude-haiku-4-5` (pattern recognition, not complex reasoning)
- Max tokens: 500

**Current implementations consolidated:** `inferRelationshipWarmth`, inline warmth inference in `barryHunterProcessEngage`, `barry_warmth_suggestion` field

---

## Skill 8: GenerateNextStepSkill

**Skill ID:** `GenerateNextStepSkill`
**Type:** generative
**Idempotency:** safe

**Purpose:** Determine and generate the next best action for a relationship, replacing the current NBS (Next Best Step) system. Produces a prioritized recommendation with reasoning.

**Input schema:**

```
GenerateNextStepInput {
  contact_id: string
  relationship_id: string
  mission_id: string | null       // if within an active mission
  
  constraints: {
    available_channels: string[]  // email | linkedin | phone | meeting
    urgency: string | null        // immediate | this_week | flexible
  } | null
}
```

**Output schema:**

```
GenerateNextStepOutput {
  recommended_action: {
    action_type: string           // send_email | schedule_meeting | follow_up | research | wait
    skill_id: string              // which Skill executes this
    priority: number              // 0-3
    reasoning: string
    due_by: timestamp | null
  }
  alternatives: [{
    action_type: string
    skill_id: string
    reasoning: string
  }] | null                       // up to 2 alternatives
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Context requirements:**
- Relationship Awareness (full projection)
- Mission Awareness (if mission_id provided)
- Relationship Memory
- Think Layer strategy recommendation (consumed, not re-derived)

**Capabilities invoked:** None

**Model policy:**
- Default: `claude-haiku-4-5`
- Max tokens: 600

**Current implementations consolidated:** `nextBestStepService.deriveNextBestStep`

---

## Skill 9: AnalyzeReplySkill

**Skill ID:** `AnalyzeReplySkill`
**Type:** generative
**Idempotency:** safe

**Purpose:** Analyze an inbound reply from a contact — extract intent, sentiment, action items, and relationship signals. This is the first step in the ProcessReplyWorkflow.

**Input schema:**

```
AnalyzeReplyInput {
  contact_id: string
  relationship_id: string
  message_id: string
  
  reply_body: string
  reply_subject: string
  thread_context: string | null   // prior messages in thread for context
}
```

**Output schema:**

```
AnalyzeReplyOutput {
  intent: string                  // interested | not_interested | question | scheduling | referral | out_of_office | bounce
  sentiment: string               // positive | neutral | negative
  urgency: string                 // high | medium | low
  action_items: string[]          // extracted action items
  key_phrases: string[]           // notable phrases for memory
  relationship_signal: string     // strengthening | stable | weakening
  suggested_response_type: string // reply | follow_up | escalate | none
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Context requirements:**
- Relationship Awareness (conversation history)
- Relationship Memory (past interaction patterns)
- Contact canonical fields

**Capabilities invoked:** None

**Model policy:**
- Default: `claude-haiku-4-5`
- Max tokens: 600

**Current implementations consolidated:** `process-barry-inbox-queue` (analysis step), `barryInboxAnalyzer`

---

## Skill 10: CoachICPSkill

**Skill ID:** `CoachICPSkill`
**Type:** generative
**Idempotency:** safe

**Purpose:** Provide real-time coaching for RECON section completion — helping the user refine their ICP definition, competitive positioning, and target market description.

**Input schema:**

```
CoachICPInput {
  section_id: string              // which RECON section
  current_content: string         // user's current section content
  icp_profile_id: string
  
  coaching_mode: string           // review | improve | question
}
```

**Output schema:**

```
CoachICPOutput {
  feedback: string                // coaching feedback
  suggestions: string[] | null    // specific improvement suggestions
  questions: string[] | null      // clarifying questions
  score: number | null            // 0-100 section quality score
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Context requirements:**
- ICP Profile
- Business Awareness (market context)

**Capabilities invoked:** None

**Model policy:**
- Default: `claude-sonnet-4-5` (coaching requires nuanced reasoning)
- Max tokens: 800

**Current implementations consolidated:** `barry-coach-section`, `barryReconInterview`

---

## Skill 11: GenerateOrientationSkill

**Skill ID:** `GenerateOrientationSkill`
**Type:** generative
**Idempotency:** safe

**Purpose:** Generate the Morning Brief — a synthesized orientation of what matters today across all relationships, missions, and signals.

**Input schema:**

```
GenerateOrientationInput {
  workspace_id: string
  date: string                    // YYYY-MM-DD
  
  focus_areas: string[] | null    // meetings | follow_ups | at_risk | new_signals
}
```

**Output schema:**

```
GenerateOrientationOutput {
  brief: {
    headline: string              // one-sentence summary of the day
    meetings_today: [{
      contact_name: string
      time: string
      prep_status: string         // prepared | needs_prep
    }]
    urgent_items: [{
      entity_type: string
      entity_id: string
      description: string
      action_type: string
    }]
    at_risk_relationships: [{
      contact_name: string
      risk_reason: string
      suggested_action: string
    }]
    pipeline_summary: string
  }
  signal_count: number            // signals processed since last brief
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Context requirements:**
- All four Awareness projections (Relationship, Business, Mission, User)
- Calendar data (today's events)
- Recent signals (since last brief)

**Capabilities invoked:** None

**Model policy:**
- Default: `claude-haiku-4-5` (synthesis from structured data)
- Escalation: `claude-sonnet-4-5` (when signal_count > 50 or complex cross-entity synthesis needed)
- Max tokens: 300 (matching current `barryOrientationBrief` budget)

**Current implementations consolidated:** `barryOrientationBrief`

---

## Skill 12: GenerateStepSkill

**Skill ID:** `GenerateStepSkill`
**Type:** generative
**Idempotency:** safe

**Purpose:** Generate the next step in a mission sequence — a single action step with content, timing, and success criteria. Replaces three overlapping step generation implementations.

Note: This Skill is not in the original 15-Skill list from Document 1. It replaces what was previously split between `barryHunterGenerateStep` and `barryGenerateSequenceStep`, which the audit recommended consolidating (Step 5). Document 1's `GenerateNextStepSkill` (#8) produces strategy recommendations; this Skill produces mission sequence content.

**Input schema:**

```
GenerateStepInput {
  mission_id: string
  step_number: number
  
  mission_context: {
    mission_type: string          // outreach | engagement | campaign
    goal: string
    prior_steps: [{
      step_number: number
      action_type: string
      outcome: string | null
    }]
  }
  
  contact_id: string
  relationship_id: string
}
```

**Output schema:**

```
GenerateStepOutput {
  step: {
    action_type: string           // send_email | schedule_meeting | research | follow_up
    description: string
    content: object | null        // if action_type = send_email, includes draft content
    timing: {
      delay_days: number          // days after prior step
      best_day: string | null     // monday | tuesday | ...
      best_time: string | null    // morning | afternoon
    }
    success_criteria: string
  }
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Context requirements:**
- Mission Awareness
- Relationship Awareness
- Relationship Memory

**Capabilities invoked:** None

**Model policy:**
- Default: `claude-haiku-4-5` (step generation from structured mission context)
- Escalation: `claude-sonnet-4-5` (deep sequences, step_number > 5)
- Max tokens: 1000

**Current implementations consolidated:** `barryHunterGenerateStep`, `barryGenerateSequenceStep`, `barryGenerateMissionSequence` (decomposed — sequence generation becomes a Workflow calling this Skill per step)

---

## Skill 13: ComputeHealthScoreSkill

**Skill ID:** `ComputeHealthScoreSkill`
**Type:** deterministic
**Idempotency:** safe

**Purpose:** Compute a deterministic health score for a relationship based on signal history, engagement metrics, and risk factors. No AI — pure computation.

**Input schema:**

```
ComputeHealthScoreInput {
  contact_id: string
  relationship_id: string
}
```

**Output schema:**

```
ComputeHealthScoreOutput {
  health_score: number            // 0-100
  health_grade: string            // A | B | C | D | F
  factors: [{
    name: string
    score: number
    weight: number
  }]
  trend: string                   // improving | stable | declining
}
```

**Context requirements:**
- Relationship Awareness (engagement metrics, signal counts)

**Capabilities invoked:** None

**Model policy:** N/A (deterministic — no AI call)

**Current implementations consolidated:** `healthScore.js`

---

## Skill 14: DetectChurnSignalsSkill

**Skill ID:** `DetectChurnSignalsSkill`
**Type:** deterministic
**Idempotency:** safe

**Purpose:** Detect churn risk signals for a relationship — declining engagement, missed milestones, negative sentiment trends. No AI — rule-based detection.

**Input schema:**

```
DetectChurnSignalsInput {
  contact_id: string
  relationship_id: string
  lookback_days: number           // default: 30
}
```

**Output schema:**

```
DetectChurnSignalsOutput {
  churn_risk: string              // none | low | medium | high | critical
  signals: [{
    signal_type: string
    description: string
    severity: string
    detected_at: timestamp
  }]
  recommended_action: string | null
}
```

**Context requirements:**
- Relationship Awareness (engagement trends, signal history)

**Capabilities invoked:** None

**Model policy:** N/A (deterministic)

**Current implementations consolidated:** `barryCSM.detectChurnSignals`

---

## Skill 15: DetectExpansionSignalsSkill

**Skill ID:** `DetectExpansionSignalsSkill`
**Type:** deterministic
**Idempotency:** safe

**Purpose:** Detect expansion opportunity signals — increasing engagement, positive outcomes, referral indicators. No AI — rule-based detection.

**Input schema:**

```
DetectExpansionSignalsInput {
  contact_id: string
  relationship_id: string
  lookback_days: number           // default: 30
}
```

**Output schema:**

```
DetectExpansionSignalsOutput {
  expansion_potential: string     // none | low | medium | high
  signals: [{
    signal_type: string
    description: string
    strength: string
    detected_at: timestamp
  }]
  recommended_action: string | null
}
```

**Context requirements:**
- Relationship Awareness (engagement trends, positive outcomes)

**Capabilities invoked:** None

**Model policy:** N/A (deterministic)

**Current implementations consolidated:** `barryCSM.detectExpansionSignals`

---

# Part III: Workflow Contracts

Workflows compose Skills into named sequences (Document 2, Workflow definition). Each Workflow contract specifies the step order, input/output mappings between steps, failure strategies, and which steps produce Prepared Actions.

---

## Workflow 1: ProcessReplyWorkflow

**Workflow ID:** `ProcessReplyWorkflow`
**Status:** Promote — already works as a chain

**Purpose:** Process an inbound email reply end-to-end: analyze the reply, update relationship context, generate the next recommended action, and optionally draft a response.

**Current equivalent:** `process-barry-inbox-queue.js` (9-step chain)

**Steps:**

| Step | Skill | Input Source | Condition | On Failure | Produces PA |
|---|---|---|---|---|---|
| 1 | `AnalyzeReplySkill` | Workflow input (reply body, contact) | — | abort | No |
| 2 | `SummarizeRelationshipSkill` | Step 1 output + Awareness | — | skip | No |
| 3 | `GenerateNextStepSkill` | Step 1 + Step 2 output | — | skip | No |
| 4 | `WriteEmailSkill` | Step 1 + Step 3 output | `step_1.suggested_response_type != 'none'` | skip | **Yes** |

**Input schema:**

```
ProcessReplyInput {
  contact_id: string
  relationship_id: string
  message_id: string
  reply_body: string
  reply_subject: string
  thread_context: string | null
}
```

**Output schema:**

```
ProcessReplyOutput {
  analysis: AnalyzeReplyOutput
  relationship_summary: SummarizeRelationshipOutput | null
  next_step: GenerateNextStepOutput | null
  draft_reply: WriteEmailOutput | null       // only if suggested_response_type != 'none'
  prepared_action_id: string | null          // ID of the Prepared Action (draft reply)
}
```

**Context requirements (union):** Relationship Awareness, Relationship Memory, Contact fields, Company fields, User Memory

**Signals consumed:** `contact.reply_received`
**Signals produced on completion:** `action.completed` (via Executed Action, if reply is approved and sent)

---

## Workflow 2: EngageContactWorkflow

**Workflow ID:** `EngageContactWorkflow`
**Status:** Promote — already works as a chain

**Purpose:** Full engagement flow for a contact — assess relationship state, generate multi-angle outreach messages.

**Current equivalent:** `barryHunterProcessEngage.js` (9-step chain)

**Steps:**

| Step | Skill | Input Source | Condition | On Failure | Produces PA |
|---|---|---|---|---|---|
| 1 | `InferRelationshipStateSkill` | Workflow input (contact) | — | abort | No |
| 2 | `WriteEmailSkill` | Step 1 output, `message_count: 4` | — | abort | **Yes** |

**Input schema:**

```
EngageContactInput {
  contact_id: string
  relationship_id: string
  mission_id: string | null
  message_intent: string          // default: 'engagement'
}
```

**Output schema:**

```
EngageContactOutput {
  relationship_state: InferRelationshipStateOutput
  drafts: WriteEmailOutput
  prepared_action_id: string
}
```

**Context requirements (union):** Relationship Awareness, Relationship Memory, Business Awareness, Contact fields, Company fields, User Memory

---

## Workflow 3: PrepareMeetingWorkflow

**Workflow ID:** `PrepareMeetingWorkflow`
**Status:** New — decompose monolith

**Purpose:** Prepare for an upcoming meeting — research the company, summarize the relationship, and generate a meeting brief.

**Current equivalent:** `barryDossierBriefing` (monolithic)

**Steps:**

| Step | Skill | Input Source | Condition | On Failure | Produces PA |
|---|---|---|---|---|---|
| 1 | `ResearchCompanySkill` | Workflow input, `research_depth: 'standard'` | `company_data_age > 7 days` | skip | No |
| 2 | `SummarizeRelationshipSkill` | Workflow input, `summary_depth: 'comprehensive'` | — | skip | No |
| 3 | `GenerateMeetingBriefSkill` | Step 1 + Step 2 output | — | abort | **Yes** |

**Input schema:**

```
PrepareMeetingInput {
  contact_id: string
  relationship_id: string
  company_id: string
  meeting_id: string | null
  meeting_date: timestamp
  meeting_type: string
}
```

**Output schema:**

```
PrepareMeetingOutput {
  company_research: ResearchCompanyOutput | null
  relationship_summary: SummarizeRelationshipOutput | null
  brief: GenerateMeetingBriefOutput
  prepared_action_id: string
}
```

**Context requirements (union):** All four Awareness projections, Relationship Memory, all canonical fields, Calendar data

**Signals consumed:** `meeting.today` (triggers the Workflow automatically for unprepared meetings)

---

## Workflow 4: LaunchCampaignWorkflow

**Workflow ID:** `LaunchCampaignWorkflow`
**Status:** New — automate user-driven chain

**Purpose:** Launch a multi-step campaign — qualify targets, research companies, generate personalized outreach sequences.

**Current equivalent:** `barryICPConversation` + `barryGenerateMissionSequence` (loosely chained via user)

**Steps:**

| Step | Skill | Input Source | Condition | On Failure | Produces PA |
|---|---|---|---|---|---|
| 1 | `ScoreICPFitSkill` | Workflow input (company + ICP) | — | abort | No |
| 2 | `ResearchCompanySkill` | Step 1 output, `research_depth: 'standard'` | `step_1.icp_decision != 'rejected'` | skip | No |
| 3 | `ResearchContactSkill` | Workflow input (contact) | — | skip | No |
| 4 | `WriteEmailSkill` | Step 2 + Step 3 output, `message_intent: 'campaign'` | — | abort | **Yes** |

**Input schema:**

```
LaunchCampaignInput {
  campaign_id: string
  contacts: [{
    contact_id: string
    company_id: string
    relationship_id: string
  }]
  icp_profile_id: string
  sequence_length: number         // number of steps in campaign
}
```

**Output schema:**

```
LaunchCampaignOutput {
  results: [{
    contact_id: string
    icp_score: ScoreICPFitOutput
    company_research: ResearchCompanyOutput | null
    contact_research: ResearchContactOutput | null
    draft: WriteEmailOutput | null
    prepared_action_id: string | null
    skipped_reason: string | null
  }]
}
```

**Context requirements (union):** Business Awareness, ICP Profile, Contact + Company fields

---

## Workflow 5: QualifyProspectWorkflow

**Workflow ID:** `QualifyProspectWorkflow`
**Status:** New

**Purpose:** Qualify a prospect — research the company, score ICP fit, and summarize the opportunity.

**Current equivalent:** `barryEnrich` + ICP scoring (separate calls)

**Steps:**

| Step | Skill | Input Source | Condition | On Failure | Produces PA |
|---|---|---|---|---|---|
| 1 | `ResearchCompanySkill` | Workflow input, `research_depth: 'standard'` | — | abort | No |
| 2 | `ScoreICPFitSkill` | Step 1 output | — | abort | No |
| 3 | `SummarizeRelationshipSkill` | Step 1 + Step 2 output, `focus: 'opportunity'` | — | skip | **Yes** |

---

## Workflow 6: MorningBriefWorkflow

**Workflow ID:** `MorningBriefWorkflow`
**Status:** New — decompose monolith

**Purpose:** Generate the daily Morning Brief — compute health scores, detect signals, and synthesize the orientation.

**Current equivalent:** `barryOrientationBrief` (monolithic with inline computations)

**Steps:**

| Step | Skill | Input Source | Condition | On Failure | Produces PA |
|---|---|---|---|---|---|
| 1 | `ComputeHealthScoreSkill` | All active relationships | — | skip | No |
| 2 | `DetectChurnSignalsSkill` | Active relationships | — | skip | No |
| 3 | `DetectExpansionSignalsSkill` | Active relationships | — | skip | No |
| 4 | `GenerateOrientationSkill` | Step 1 + 2 + 3 output | — | abort | **Yes** |

**Signals consumed:** Time-based trigger (Morning Brief schedule)

---

## Workflow 7: ReconnectDormantWorkflow

**Workflow ID:** `ReconnectDormantWorkflow`
**Status:** New — no equivalent today

**Purpose:** Re-engage a dormant relationship — assess current state, determine if reconnection is appropriate, and draft an outreach message.

**Steps:**

| Step | Skill | Input Source | Condition | On Failure | Produces PA |
|---|---|---|---|---|---|
| 1 | `SummarizeRelationshipSkill` | Workflow input, `focus: 'engagement'` | — | abort | No |
| 2 | `InferRelationshipStateSkill` | Workflow input | — | abort | No |
| 3 | `WriteEmailSkill` | Step 1 + Step 2, `message_intent: 'follow_up'` | `step_2.warmth_level != 'cold'` | skip | **Yes** |

---

# Part IV: Capability Registry

Capabilities are the declared actions Barry can take through external integrations (Document 2, Capability definition). The registry structurally enforces the generative/side-effect distinction — the model cannot override the capability type (Document 1, Section 4.8).

---

## Capability Classification

| Capability ID | Integration | Type | Approval Required | Idempotency Key | Autonomy Ceiling |
|---|---|---|---|---|---|
| `gmail.send_email` | Gmail | side_effect | Yes (Phase 1) | Required | Approval |
| `gmail.read_thread` | Gmail | generative | No | Not required | Autonomous |
| `gmail.draft_email` | Gmail | generative | No | Not required | Autonomous |
| `calendar.create_event` | Calendar | side_effect | Yes (Phase 1) | Required | Approval |
| `calendar.check_availability` | Calendar | generative | No | Not required | Autonomous |
| `calendar.list_events` | Calendar | generative | No | Not required | Autonomous |
| `apollo.search_companies` | Apollo | side_effect | No | Not required | Autonomous |
| `apollo.search_people` | Apollo | side_effect | No | Not required | Autonomous |
| `apollo.enrich_contact` | Apollo | side_effect | No | Not required | Autonomous |
| `platform.move_stage` | Platform | side_effect | Yes (Phase 1) | Required | Approval |
| `platform.update_status` | Platform | side_effect | Yes (Phase 1) | Required | Approval |
| `platform.nbs_action` | Platform | side_effect | No | Required | Recommend |
| `platform.analyze_website` | Platform | side_effect | No | Not required | Autonomous |

**Autonomy Ceiling levels (Document 1):**
- **Observe** — Barry sees but takes no action
- **Recommend** — Barry suggests, user decides
- **Prepare** — Barry drafts, user reviews
- **Approval** — Barry prepares and presents, user approves to execute
- **Autonomous** — Barry executes without user intervention

Phase 1 constraint: All `side_effect` capabilities with `requires_approval: true` are capped at the Approval ceiling. Autonomous execution of side-effect capabilities is deferred to a future phase pending user trust calibration.

---

## Capability Contract Details

### `gmail.send_email`

**Purpose:** Send an email through the user's connected Gmail account.

**Parameters:**

```
GmailSendParameters {
  to: string                      // recipient email
  subject: string
  body: string                    // HTML or plain text
  reply_to_message_id: string | null  // for threading
  cc: string[] | null
  bcc: string[] | null
}
```

**Output:**

```
GmailSendOutput {
  message_id: string              // Gmail message ID
  thread_id: string
  sent_at: timestamp
}
```

**Idempotency:** `idempotency_key` prevents double-send. The Action Executor checks for an existing Executed Action with the same key before invoking. This is the A1 guarantee — currently implemented in `barry_drafts.sending` transactional claim (Document 2, Prepared Action §13 migration note).

**Signals produced:** `contact.email_sent` (on success)

**Current implementation:** `barry-approve-send.js`, `gmail-send` integration

---

### `gmail.read_thread`

**Purpose:** Read an email thread from the user's Gmail for context assembly.

**Parameters:**

```
GmailReadParameters {
  thread_id: string | null
  message_id: string | null       // either thread_id or message_id
  max_messages: number            // default: 10
}
```

**Output:**

```
GmailReadOutput {
  messages: [{
    message_id: string
    from: string
    to: string
    subject: string
    body: string
    date: timestamp
  }]
}
```

**Idempotency:** safe (read-only)

**Current implementation:** Gmail API integration in `gmail-poll-replies`

---

### `calendar.create_event`

**Purpose:** Create a calendar event through the user's connected Google Calendar.

**Parameters:**

```
CalendarCreateParameters {
  title: string
  start: timestamp
  end: timestamp
  attendees: string[]             // email addresses
  description: string | null
  location: string | null
}
```

**Output:**

```
CalendarCreateOutput {
  event_id: string
  html_link: string
  created_at: timestamp
}
```

**Idempotency:** `idempotency_key` prevents duplicate event creation.

**Signals produced:** `meeting.created`

**Current implementation:** `calendar-*` Netlify functions

---

### `apollo.search_companies`

**Purpose:** Search Apollo's database for company information.

**Parameters:**

```
ApolloSearchCompaniesParameters {
  query: string                   // company name or domain
  filters: {
    industry: string | null
    employee_range: string | null
    location: string | null
  } | null
  limit: number                   // default: 10
}
```

**Output:**

```
ApolloSearchCompaniesOutput {
  companies: [{
    apollo_id: string
    name: string
    domain: string
    industry: string
    employee_count: number | null
    description: string | null
  }]
  credits_used: number
}
```

**Current implementation:** `search-companies` Netlify function

---

### `apollo.enrich_contact`

**Purpose:** Enrich a contact's profile with Apollo data.

**Parameters:**

```
ApolloEnrichParameters {
  email: string | null
  name: string | null
  company_domain: string | null
}
```

**Output:**

```
ApolloEnrichOutput {
  title: string | null
  seniority: string | null
  department: string | null
  linkedin_url: string | null
  phone: string | null
  enrichment_source: string
}
```

**Signals produced:** `contact.enriched` or `company.enriched`

**Current implementation:** `enrichContact`, `enrichCompany`, `barryEnrich`

---

# Part V: Action Executor Contract

The Action Executor is the only system component that invokes Capabilities (Document 1, Section 4.8). It reads from the Prepared Action queue, checks authorization, invokes the registered Capability, records the Executed Action, and produces the closing Signal.

---

## Execution Pipeline

```
Prepared Action (approved)
        ↓
Action Executor receives authorization
        ↓
1. IDEMPOTENCY CHECK
   Check for existing Executed Action with same idempotency_key
   If found → return existing result (replay, not re-execute)
        ↓
2. CAPABILITY VALIDATION
   Look up capability_id in Capability Registry
   If capability is suspended → fail with CAPABILITY_UNAVAILABLE
   If capability requires approval and PA is not approved → fail with UNAUTHORIZED
        ↓
3. EXECUTION
   Create Executed Action record (lifecycle_state: 'requested' → 'executing')
   Invoke Capability with parameters from Prepared Action
        ↓
4. RESULT RECORDING
   On success: Executed Action → 'completed'
   On failure: Executed Action → 'failed' (with error details)
        ↓
5. SIGNAL EMISSION
   On success: produce the appropriate Signal (e.g., contact.email_sent)
   On failure: produce action.failed Signal
        ↓
6. VERIFICATION (async)
   When external confirmation arrives (delivery receipt, calendar confirmation):
   Executed Action → 'verified'
   Produce action.verified Signal
```

## Idempotency Contract (A1 Guarantee)

The A1 guarantee — a message is sent exactly once — is structural, not transactional.

**Current implementation (from Document 2, Prepared Action §13):**

```
barry_drafts.awaiting_user  →  prepared_actions (ready_for_review)
barry_drafts.sending        →  executed_action (executing) — claim moves here
barry_drafts.sent           →  executed_action (completed) + message (queued → sent)
barry_drafts.alreadySent    →  executed_action idempotency_key replay
```

**Barry OS implementation:**

1. Every side-effect Capability invocation receives a unique `idempotency_key` derived from: `{prepared_action_id}_{capability_id}_{timestamp}`
2. Before invoking, the Action Executor queries: "Does an Executed Action exist with this `idempotency_key`?"
3. If yes → return the existing Executed Action (no re-invocation)
4. If no → create the Executed Action, set state to `executing`, invoke the Capability
5. The `executing` state is the transactional claim. Only one Executed Action per `idempotency_key` can enter `executing`.

This preserves the current `barry_drafts.sending` guarantee while moving it to its architectural home.

---

# Part VI: Context Resolution Contract

Context Resolution (Document 1, Section 4.5) assembles the data a Skill or Workflow needs before invocation. Context is resolved once per invocation — Skills and Workflows do not own context and do not re-resolve it mid-execution (Document 1, Law 25).

---

## Context Scope Types

```
ContextScope {
  scope_type: string              // relationship | business | mission | user | calendar
  entity_ids: string[]            // which entities to resolve
  
  // What to include
  awareness: boolean              // Awareness projection for this entity
  memory: boolean                 // Memory for this entity
  canonical: boolean              // Canonical record fields
  signals: {                      // Recent signals for this entity
    since: timestamp | null
    types: string[] | null
  } | null
}
```

## Resolution Pipeline

```
Skill/Workflow context_requirements declaration
        ↓
Context Resolver reads requirements
        ↓
1. CANONICAL DATA
   Fetch entity records from Firestore
   (Contact, Company, Relationship, Mission, Campaign)
        ↓
2. AWARENESS PROJECTIONS
   Fetch current Awareness state for requested projections
   (Relationship Awareness, Business Awareness, Mission Awareness, User Awareness)
        ↓
3. MEMORY
   Fetch relevant memory by type
   (Relationship Memory, User Memory, Workspace Memory)
        ↓
4. RECENT SIGNALS (if requested)
   Fetch signals since specified timestamp
        ↓
5. ASSEMBLY
   Combine into structured ContextPackage
   Apply token budget estimation (will this fit in the model's context window?)
   If over budget → summarize using SummarizeRelationshipSkill
        ↓
ResolvedContext delivered to Skill/Workflow
```

**Current implementations being consolidated:**
- `barryContextStack.js` (client-side, 500 contacts) → **Delete** — context assembly must be server-side only
- `barryGenerateContext` (server-side, focused) → **Refactor** — becomes the Context Resolver
- `assembleBarryContext()` in `barryMemoryService` (per-contact) → **Refactor** — becomes the per-entity resolution step

---

# Part VII: Think Layer → Skill/Workflow Selection Contract

The Think Layer (Document 1, Section 4.6) produces recommendations. Each recommendation specifies which Skill or Workflow should execute. This section defines the selection contract — how the Think Layer maps a situation to a capability.

---

## Selection Rules

The Think Layer does not pick Skills by AI classification. It uses structured rules:

| Situation | Signal Trigger | Skill/Workflow Selected | Priority |
|---|---|---|---|
| Inbound reply received | `contact.reply_received` | `ProcessReplyWorkflow` | Critical (0) |
| Meeting today, no brief | `meeting.today` | `PrepareMeetingWorkflow` | Critical (0) |
| Contact engagement requested | User action | `EngageContactWorkflow` | High (1) |
| Campaign launch | User action | `LaunchCampaignWorkflow` | High (1) |
| Prospect qualification | User action | `QualifyProspectWorkflow` | Medium (2) |
| Morning brief due | Time trigger | `MorningBriefWorkflow` | Medium (2) |
| Dormant contact detected | `DetectChurnSignalsSkill` output | `ReconnectDormantWorkflow` | Low (3) |
| NBS generation needed | Relationship Awareness stale | `GenerateNextStepSkill` | Medium (2) |
| Warmth change detected | Awareness threshold crossed | `InferRelationshipStateSkill` | Medium (2) |
| ICP coaching requested | User action | `CoachICPSkill` | Low (3) |

**Cross-entity prioritization** (the fourth Think function — absent today):

When multiple recommendations compete for the same time slot, the Think Layer applies priority synthesis:
1. Critical (0) always wins
2. Within the same priority level, sort by: urgency (due_by), relationship health score (worse = higher priority), revenue potential
3. The synthesized priority list is the Think Layer's primary output — the queue of what Barry should do next

---

# Part VIII: Integration Health and Circuit Breakers

Capabilities depend on external integrations (Gmail, Calendar, Apollo). Integration health is tracked and failures trigger circuit breakers (Document 2, Capability lifecycle: `active → suspended`).

---

## Health Check Contract

```
IntegrationHealth {
  integration_id: string          // gmail | calendar | apollo | platform
  status: string                  // healthy | degraded | down
  last_check: timestamp
  last_success: timestamp
  consecutive_failures: number
  error_rate_1h: number           // percentage
  latency_p50_ms: number
  latency_p99_ms: number
}
```

## Circuit Breaker Rules

| Condition | Action | Recovery |
|---|---|---|
| 3 consecutive failures | `suspended` — stop invoking | Health check every 60s; 2 consecutive successes → `active` |
| Error rate > 50% in 1h | `suspended` | Same as above |
| Latency p99 > 30s | `degraded` — continue with warning | Latency drops below 10s → `healthy` |
| Auth token expired | `suspended` — requires user re-auth | User re-authenticates → `active` |

**Fallback behavior when suspended:**

Skills that require a suspended Capability fail gracefully:
- If the Capability is the Skill's sole purpose (e.g., `gmail.send_email` for the send step): the Prepared Action remains in `ready_for_review` with a status note
- If the Capability is one input among several (e.g., `apollo.search_companies` in `ResearchCompanySkill`): the Skill continues with available data and flags reduced confidence

---

# Part IX: Model Policy

All AI model selection is governed by a centralized policy. Skills declare which model they need; the policy enforces it. No Skill or Workflow may hardcode a model ID — they reference a policy tier (Document 1, BO-006 decision).

---

## Model Tiers

| Tier | Model ID | Use Case | Token Budget |
|---|---|---|---|
| **Fast** | `claude-haiku-4-5` | Single-task generation, summarization, pattern recognition | ≤ 2500 output tokens |
| **Reasoning** | `claude-sonnet-4-5` | Multi-source synthesis, scoring, coaching, complex strategy | ≤ 2000 output tokens |

**Selection criteria:**

- Default to Fast tier for all Skills unless the task requires multi-source synthesis or structured reasoning
- Escalate to Reasoning tier when: complexity score > 0.7, input sources > 3, or the Skill's contract specifies it
- Never use a model outside these two tiers without explicit governance approval

**Cost guardrails:**

```
Per-user daily budget:
  Fast tier: 300,000 tokens (input + output)
  Reasoning tier: 100,000 tokens (input + output)
  
Per-invocation limits:
  Input: max 5,000 tokens per Skill call
  Output: per Skill contract (see individual Skill specs)
  
Overage handling:
  Soft limit (80%): warn user, no throttling
  Hard limit (100%): queue non-critical Skills, allow only Critical (0) priority
```

---

## Document Status

| Field | Value |
|---|---|
| **Discovery source** | `docs/audits/BARRY_OS_FOUNDATION_AUDIT.md` (commit `09e90f9`) |
| **Discovery authority** | `docs/audits/BARRY_OS_AUDIT_RECONCILIATION.md` |
| **Architecture source** | `docs/barry-os/architecture/BARRY_OS_REFERENCE_ARCHITECTURE.md` (Document 1 — FROZEN 2026-08-07) |
| **Domain model** | `docs/barry-os/architecture/BARRY_OS_DOMAIN_LIFECYCLE_MODEL.md` (Document 2 — FROZEN 2026-08-08) |
| **Signal specification** | `docs/barry-os/architecture/BARRY_OS_SIGNAL_SPECIFICATION.md` (Document 3 — FROZEN 2026-08-08) |
| **Architecture status** | Draft — pending formal brief and approval |
| **Supersedes** | None |
| **Superseded by** | None (this is the canonical capability specification) |
| **Frozen** | No — draft |

## Freeze Declaration

Document 4 will be frozen upon approval by Aaron after formal brief review.

This document may only be modified if a factual error is discovered during
implementation that directly contradicts a capability contract stated here.

It may not be modified to:
- Add new Skills or Workflows without Aaron's approval
- Redefine objects, lifecycle states, or signal contracts from Documents 1–3
- Change the Capability Registry in ways that violate Document 1's structural enforcement model

If implementation uncovers a genuine conflict with a capability contract, flag it to Aaron
before making any change. The bar for reopening a frozen document is high.

All future implementation references in Document 5 derive from this document. They do not redefine capability contracts.

---

*No code was written or changed during this document. This is an architecture specification only.*
