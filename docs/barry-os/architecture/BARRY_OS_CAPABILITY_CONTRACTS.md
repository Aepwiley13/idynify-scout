# Barry OS Skills, Workflows, API & Capability Contracts

**Idynify · Document 4 of 5 · Team B**
**Date: 2026-08-10**
**Repository: aepwiley13/idynify-scout**
**Source of Truth: docs/audits/BARRY_OS_FOUNDATION_AUDIT.md (canonical audit — pinned to commit 09e90f9)**
**Discovery Authority: docs/audits/BARRY_OS_AUDIT_RECONCILIATION.md**
**Infrastructure Baseline: FIRESTORE_DATA_ARCHITECTURE.md**

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
Implementation Plan         ← Document 5 — build order
```

The architecture freeze rule is in force. Documents 1, 2, and 3 are frozen. This document may reference them, derive from them, and operationalize them. It may not redefine objects, lifecycle states, signal contracts, or ownership boundaries established in those documents.

**What this document defines:**
- Architectural resolutions for open questions from Documents 1–3
- The 15 Skills registry — atomic Barry capabilities
- The 7 Workflows registry — named compositions of Skills
- The Capability Registry contract — how modules declare what Barry can do through them
- The Action Executor contract — how Barry executes with idempotency
- The Think Layer interface — how Barry selects strategy
- Context Resolution contract — how Barry assembles context per operation
- Model policy — which tier (FAST/DEEP) each Skill uses and why
- Circuit breaker and failure patterns
- Autonomy spectrum — what Barry may execute vs what requires approval

**What this document does NOT define:**
- Object schemas — Document 2 owns those
- Signal contracts — Document 3 owns those
- Build order — Document 5 owns that
- Execution architecture (sync vs async, background vs foreground) — Document 5 owns those decisions
- New Firestore paths — these must route through `FIRESTORE_DATA_ARCHITECTURE.md` before being included here

## Evidence Levels

```
CONFIRMED   Verified in the canonical audit or reconciliation at a specific file or line.
            This finding exists in the repository today.

PROPOSED    A new architectural recommendation not present in the codebase today.
            Justified explicitly. Requires approval before implementation begins.

PENDING     Awaiting confirmation. Use sparingly.
```

---

# Part I: Architectural Resolutions

Before defining contracts, this document resolves open architectural questions inherited from Documents 1–3. Each resolution is numbered, justified, and binding on all subsequent sections.

---

## Resolution R4-001: Canonical Ownership of Bounce Events

**Status:** RESOLVED

**Problem:** Document 3 (Signal Specification, frozen) defines two signals for the same real-world event — an outbound email bouncing:

| Signal | Entity | Awareness Updates | Evidence |
|---|---|---|---|
| `contact.email_bounced` | Contact | Relationship Awareness: `consecutive_no_replies` += 1, `risk_score` increase, `channel_effectiveness.email` degradation. Business Awareness: pipeline health. | PROPOSED |
| `message.bounced` | Message | "Same as `contact.email_bounced`" | PROPOSED |

Both signals are PROPOSED (no emission point exists in the repository). Both produce identical awareness updates. Two canonical signals for one real-world event violates the Single Source of Truth principle (Document 1, Section 1).

**Current codebase evidence:** CONFIRMED — verified by Team A against `origin/main`.

`resendWebhook.js` is **not** a candidate producer for `contact.email_bounced`. It processes every bounce Resend delivers — the handler applies no system-mail filter — but it only ever sees system mail, because only system mail is sent through Resend (`send-welcome-email.js:29`, `daily-leads-refresh.js:293`, `adminRetryEmailSend.js:140`; `emailLog.js:14-23`). Relationship email is sent through Gmail and never touches Resend.

This constraint is **structural, not filtered**. If relationship outreach were ever routed through Resend, this webhook would begin receiving those bounces with no code change — and would still not update contact state.

Document 3's `contact.email_bounced` entry is **accurate as written**: its `Producer` field already reads "None implemented," and its `Source: gmail` names the send channel, not a producer. **No Document 3 correction is required.**

Additional verified evidence:

- `handleEmailBounced()` (lines 138–158) updates `emailLogs` with bounce status and, for hard bounces, adds the recipient to `emailSuppressionList`
- **The gap:** No contact document update, no timeline event, no signal emission, no Awareness projection update, no user notification. A bounced contact stays in whatever `conversationState` it was in (e.g., `awaiting_reply`) with no transition.
- `peopleSchema.js` (line 246) defines `'bounced'` as a valid `OUTCOME_TYPE`; `healthScore.js` (line 120) scores `'bounced'` at 10 (lowest); `engagement_summary.last_outcome` can be `'bounced'` — but nothing writes this value when a bounce occurs.

**Analysis:**

The underlying fact is: *an outbound email failed to deliver*. This fact has two perspectives:

1. **Contact perspective** — "this person's email address bounced." Affects the Contact's reachability, the Relationship's risk profile, and channel effectiveness scoring. This is the perspective that drives action — Barry needs to know whether to keep emailing this person.

2. **Message perspective** — "this specific message was not delivered." Affects the Message object's lifecycle state (`delivered` → `bounced`). This is a record-keeping perspective — the canonical audit trail of what happened to a specific communication.

**Resolution:**

`contact.email_bounced` is the **canonical signal**. It represents the underlying fact: a delivery failure occurred for a contact's email address.

`message.bounced` is **retired as a separate signal type**. The Message object's lifecycle transition to `bounced` is a **downstream effect** of the `contact.email_bounced` signal, not a separate event. The Observation pipeline handles this:

```
Real-world event: email delivery fails (bounce notification received)
        ↓
Bounce producer emits event (producer absent — see Gap B-001)
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

4. **The producer reports bounces per-recipient, not per-message.** The signal's natural shape matches the Contact entity.

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

**Problem:** The canonical audit (Step 5) identified 38 AI endpoints across 20 duplicate implementation groups. Document 1 proposed 15 Skills to consolidate these. The reconciliation (§1) confirmed the final Skill inventory.

**The 15 Skills — confirmed from reconciliation:**

| # | Skill ID | Deterministic | Current Implementations Absorbed |
|---|---|---|---|
| 1 | `WriteEmailSkill` | no | `barryHunterProcessEngage`, `barryOutreachMessage`, `barryFirstTouch`, `generate-engagement-message`, `generate-campaign-messages`, `barryBulkPersonalize`, `generate-followup` |
| 2 | `ResearchCompanySkill` | no | `barryEnrich` (company), `enrichCompany`, `analyze-website`, `barryEnrich` (contact), `enrichContact` |
| 3 | `ScoreICPFitSkill` | no | `barryICPConversation` (scoring mode), ICP scoring components |
| 4 | `SummarizeRelationshipSkill` | no | `assembleBarryContext`, `BarryContext.jsx`, `barryGenerateContext` |
| 5 | `AnalyzeReplySkill` | no | `barryInboxAnalyzer`, `process-barry-inbox-queue` (analysis step) |
| 6 | `GenerateNextStepSkill` | no | `nextBestStepService.deriveNextBestStep`, `barryHunterGenerateStep`, `barryGenerateSequenceStep` |
| 7 | `PrepareMeetingBriefSkill` | no | `barryDossierBriefing` |
| 8 | `ComposeLinkedInSkill` | no | (none — PROPOSED) |
| 9 | `GenerateSubjectLineSkill` | no | (inline in message generators — extracted as standalone) |
| 10 | `EvaluateResponseSkill` | yes | `barryOutcomeAttribution` (deterministic — rule-based attribution, no AI calls) |
| 11 | `IdentifyObjectionsSkill` | no | (none — PROPOSED; extracted from AnalyzeReply scope) |
| 12 | `SuggestToneSkill` | no | (none — PROPOSED; tone currently hardcoded or user-specified) |
| 13 | `RefineICPSkill` | no | `barry-coach-section`, `barryReconInterview` |
| 14 | `DigestInboxSkill` | no | `process-barry-inbox-queue` (digest/summary step), `barryOrientationBrief` (inbox portion) |
| 15 | `CategorizeFeedbackSkill` | no | (none — PROPOSED; user feedback currently unstructured) |

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
| `barryEnrich` (contact path) | `ResearchCompanySkill` | Refactor — extract contact enrichment path |
| `enrichCompany` | `ResearchCompanySkill` | Delete — replaced by Skill |
| `enrichContact` | `ResearchCompanySkill` | Delete — replaced by Skill |
| `analyze-website` | `ResearchCompanySkill` | Refactor — becomes internal implementation detail |
| `barryICPConversation` (scoring) | `ScoreICPFitSkill` | Refactor — extract scoring mode |
| `assembleBarryContext` | `SummarizeRelationshipSkill` | Refactor — output consumed by Skill |
| `barryGenerateContext` | `SummarizeRelationshipSkill` | Refactor — becomes server-side context path |
| `barryDossierBriefing` | `PrepareMeetingBriefSkill` | Refactor — becomes Skill wrapper |
| `nextBestStepService.deriveNextBestStep` | `GenerateNextStepSkill` | Refactor — becomes Skill |
| `barryHunterGenerateStep` | `GenerateNextStepSkill` | Delete — duplicate of sequence step |
| `barryGenerateSequenceStep` | `GenerateNextStepSkill` | Delete — merged into Skill |
| `process-barry-inbox-queue` (analysis) | `AnalyzeReplySkill` | Refactor — extract analysis step |
| `process-barry-inbox-queue` (digest) | `DigestInboxSkill` | Refactor — extract digest/summary step |
| `barryInboxAnalyzer` | `AnalyzeReplySkill` | Refactor — becomes Skill core |
| `barry-coach-section` | `RefineICPSkill` | Refactor — becomes Skill |
| `barryReconInterview` | `RefineICPSkill` | Delete — less capable duplicate |
| `barryOrientationBrief` | `DigestInboxSkill` | Refactor — inbox portion extracted |
| `barryOutcomeAttribution` | `EvaluateResponseSkill` | Refactor — attribution logic feeds evaluation |
| `barryValidateContact` | N/A | Delete — replace with deterministic validation (R4-004) |
| `barry-approve-send` | N/A | Refactor — becomes Action Executor handler (no AI) |

---

## Resolution R4-003: Workflow Composition Rules

**Status:** RESOLUTION — binding

**Problem:** Document 1 defines 7 Workflows. Document 2 defines the Workflow object with lifecycle states and field schemas. Neither document specifies the rules governing how Workflows compose Skills, handle failures across steps, or manage intermediate state.

**Resolution:**

1. **Workflows orchestrate Skills. Skills never orchestrate Workflows.** The composition hierarchy is strict and one-directional:

```
Workflow
    ↓ invokes
  Skill
    ↓ invokes
  (external service or Firestore operation)
```

A Skill may not invoke a Workflow. A Workflow may not invoke another Workflow. This prevents capability spaghetti and keeps Barry composable and auditable. If a complex goal appears to require Workflow-within-Workflow composition, the correct solution is to define a new Workflow that sequences the required Skills directly — not to nest Workflows.

2. **A Workflow is a sequence, not a graph.** Steps execute in order. There are no branches, no parallel steps, no conditional forks. If a step's `condition` evaluates to false, the step is skipped and the next step receives the prior step's output. This keeps the execution model debuggable.

3. **Each step invokes exactly one Skill.** A step may not invoke a Capability directly — only Skills invoke Capabilities, and they do so on behalf of the Workflow step.

4. **Failure strategies are per-step, not per-Workflow.** Each step declares `on_failure: 'skip' | 'abort' | 'retry'`. `abort` stops the Workflow and marks it failed. `skip` records the failure and continues to the next step. `retry` re-invokes the Skill once (exactly once — no retry loops).

5. **Intermediate state is persisted between steps.** Each step's output is written to the Workflow execution record before the next step begins. If the Workflow fails mid-execution, the partial result is available for inspection and manual completion.

6. **A Workflow produces one Prepared Action per terminal step that generates user-facing content.** Not every step produces a Prepared Action — intermediate computation steps (e.g., `ResearchCompanySkill` in `PrepareMeetingWorkflow`) produce data consumed by the next step. Only steps whose output is user-facing content produce Prepared Actions.

7. **Context is resolved once, before the Workflow begins.** The Workflow's `context_requirements` field is the union of all its steps' context requirements. The Context Resolver assembles this once. Steps do not re-resolve context mid-Workflow.

---

## Resolution R4-004: AI-for-Deterministic Elimination

**Status:** RESOLUTION — binding

**Problem:** The reconciliation confirmed implementations that call AI for decisions that should be computed deterministically.

**Resolution:**

| Current Implementation | Current Behavior | Replacement | Rationale |
|---|---|---|---|
| `barryValidateContact` | AI-powered contact validation (Sonnet) | Deterministic field validation rules | Email format, required fields, duplicate detection are pattern-matching — not reasoning. Classified `Deterministic: yes` — no LLM permitted. |
| `barryActions` (intent parsing) | AI-classified action type parsing | Typed tool schemas with deterministic routing | Action routing among 5 enumerated types plus `none` (`gmail_send`, `gmail_draft`, `gmail_read`, `calendar_book`, `calendar_check`, `none` — `barryActions.js:93`) is a lookup, not reasoning. |

These eliminations enforce Law 20 of the Barry OS Constitution: AI is used for reasoning, judgment, and language. Deterministic business logic is computed, not generated.

---

## Gap B-001 — Relationship Bounce Blind Spot

**Status:** Implementation gap — approved architecture, missing implementation

```
Gap B-001 — Relationship Bounce Blind Spot

Contact outreach is sent through Gmail. No repository path ingests
delivery failure or bounce events for Gmail relationship email.
contact.email_bounced therefore has no current producer.
Barry cannot incorporate relationship delivery failure into Awareness.

Existing infrastructure:
  resendWebhook.js → receives Resend email.bounced (system email only)
  → writes emailLogs and emailSuppressionList
  → does not update Contact state
  → does not publish a Barry OS signal

Future implementation:
  A relationship-email delivery adapter (Gmail or future supported
  delivery channel) must publish contact.email_bounced.
  Scheduled for P1 Signal Bus implementation.
```

This gap does not require changing any frozen document. The signal is correctly defined in Document 3. Document 5 schedules the implementation.

---

# Part II: Skill Contracts

Each Skill is a standalone contract. Skills are registered at deploy time, not created at runtime (Document 2, Skill §7).

**Required fields for every Skill:**

```
Skill name
Purpose: one sentence
Model tier: FAST | DEEP — with justification
Deterministic: yes | no
Idempotent: yes | no
Side effects: none | [list]
Existing endpoints absorbed: [list with disposition]
Migration risk: LOW | MEDIUM | HIGH
```

**Architectural invariant:** Every Skill with `Deterministic: yes` must NOT invoke an LLM. This enforces Law 20 of the Barry OS Constitution — AI is used for reasoning, judgment, and language. Deterministic business logic is computed, not generated.

---

## Skill 1: WriteEmailSkill

**Purpose:** Generate one or more email drafts for a contact, given a message intent and context.
**Model tier:** FAST (single draft, standard) / DEEP (multi-angle, campaign sequences, complexity > 0.7)
**Deterministic:** no
**Idempotent:** yes (no side effects — produces a draft, not a sent message)
**Side effects:** none
**Migration risk:** MEDIUM

**Inputs:**

```
WriteEmailInput {
  contact_id: string
  company_id: string | null
  relationship_id: string
  message_intent: string          // first_touch | follow_up | engagement | campaign | reply | custom
  message_count: number           // 1 for single, 4 for multi-angle (Hunter flow)
  subject_hint: string | null
  tone: string | null             // formal | conversational | direct
  length: string | null           // brief | standard | detailed
  campaign_id: string | null
  step_number: number | null
  reply_to_message_id: string | null
  reply_analysis: object | null   // output from AnalyzeReplySkill
}
```

**Outputs:**

```
WriteEmailOutput {
  drafts: [{
    draft_id: string
    subject: string
    body: string
    angle: string | null          // for multi-angle: direct | value_add | referral | social_proof
    tone: string
    estimated_word_count: number
  }]
  strategy_used: string
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Existing endpoints absorbed:**

| Implementation | Disposition | How it maps |
|---|---|---|
| `barryHunterProcessEngage` | Refactor | `message_intent: 'engagement'`, `message_count: 4` |
| `barryOutreachMessage` | Delete | `message_intent: 'first_touch'`, `message_count: 1` |
| `barryFirstTouch` | Delete | `message_intent: 'first_touch'`, `message_count: 1` |
| `generate-engagement-message` | Delete | `message_intent: 'engagement'`, `message_count: 1` |
| `generate-campaign-messages` | Delete | `message_intent: 'campaign'`, batch invocation |
| `barryBulkPersonalize` | Delete | `message_intent: 'campaign'`, batch invocation |
| `generate-followup` | Delete | `message_intent: 'follow_up'`, `message_count: 1` |

---

## Skill 2: ResearchCompanySkill

**Purpose:** Research and synthesize company (and optionally contact) information from multiple sources into a structured intelligence profile.
**Model tier:** DEEP (multi-source synthesis requires reasoning)
**Deterministic:** no
**Idempotent:** yes
**Side effects:** `apollo.search_companies`, `apollo.enrich_contact`, `platform.analyze_website` (external API calls)
**Migration risk:** MEDIUM

**Inputs:**

```
ResearchCompanyInput {
  company_id: string
  company_name: string
  domain: string | null
  contact_id: string | null       // when contact enrichment is also needed
  research_depth: string          // quick | standard | deep
  focus_areas: string[] | null    // icp_fit | market_position | tech_stack | growth_signals | contact_profile
}
```

**Outputs:**

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
  contact_profile: {              // populated when contact_id provided
    title: string | null
    seniority: string | null
    department: string | null
    linkedin_url: string | null
  } | null
  enrichment_sources: string[]
  confidence: number
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Existing endpoints absorbed:** `barryEnrich` (company + contact paths), `enrichCompany`, `enrichContact`, `analyze-website`

---

## Skill 3: ScoreICPFitSkill

**Purpose:** Evaluate how well a company matches the user's Ideal Customer Profile.
**Model tier:** DEEP (scoring requires structured reasoning)
**Deterministic:** no
**Idempotent:** yes
**Side effects:** none
**Migration risk:** LOW

**Inputs:**

```
ScoreICPFitInput {
  company_id: string
  icp_profile_id: string
  company_data: {
    industry: string | null
    employee_count: string | null
    revenue_range: string | null
    tech_stack: string[] | null
    location: string | null
  }
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

**Outputs:**

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
  recommendation: string
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Existing endpoints absorbed:** `barryICPConversation` (scoring mode), ICP scoring components

**Note on `score-icp-fit`:** Document 3's producer migration table lists `score-icp-fit` as PROPOSED — the file does not exist. This Skill is the implementation target for the `company.icp_evaluated` signal.

---

## Skill 4: SummarizeRelationshipSkill

**Purpose:** Produce a structured summary of a relationship's current state, engagement history, and strategic context.
**Model tier:** FAST (summarization from structured data)
**Deterministic:** no
**Idempotent:** yes
**Side effects:** none
**Migration risk:** LOW

**Inputs:**

```
SummarizeRelationshipInput {
  contact_id: string
  relationship_id: string
  summary_depth: string           // brief | standard | comprehensive
  focus: string | null            // engagement | risk | opportunity | all
}
```

**Outputs:**

```
SummarizeRelationshipOutput {
  summary: string
  key_metrics: {
    engagement_level: string
    risk_score: number
    days_since_last_contact: number
    total_interactions: number
    channel_effectiveness: object
  }
  strategic_context: string
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Existing endpoints absorbed:** `assembleBarryContext`, `BarryContext.jsx`, `barryGenerateContext`

---

## Skill 5: AnalyzeReplySkill

**Purpose:** Analyze an inbound reply from a contact — extract intent, sentiment, action items, and relationship signals.
**Model tier:** FAST (single-task pattern recognition)
**Deterministic:** no
**Idempotent:** yes
**Side effects:** none
**Migration risk:** LOW

**Inputs:**

```
AnalyzeReplyInput {
  contact_id: string
  relationship_id: string
  message_id: string
  reply_body: string
  reply_subject: string
  thread_context: string | null
}
```

**Outputs:**

```
AnalyzeReplyOutput {
  intent: string                  // interested | not_interested | question | scheduling | referral | out_of_office | bounce
  sentiment: string               // positive | neutral | negative
  urgency: string                 // high | medium | low
  action_items: string[]
  key_phrases: string[]
  relationship_signal: string     // strengthening | stable | weakening
  suggested_response_type: string // reply | follow_up | escalate | none
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Existing endpoints absorbed:** `barryInboxAnalyzer`, `process-barry-inbox-queue` (analysis step)

---

## Skill 6: GenerateNextStepSkill

**Purpose:** Determine the next best action for a relationship and generate step content for mission sequences.
**Model tier:** FAST (strategy from structured context)
**Deterministic:** no
**Idempotent:** yes
**Side effects:** none
**Migration risk:** LOW

**Inputs:**

```
GenerateNextStepInput {
  contact_id: string
  relationship_id: string
  mission_id: string | null
  step_number: number | null      // for mission sequences
  constraints: {
    available_channels: string[]
    urgency: string | null
  } | null
}
```

**Outputs:**

```
GenerateNextStepOutput {
  recommended_action: {
    action_type: string           // send_email | schedule_meeting | follow_up | research | wait
    skill_id: string
    priority: number              // 0-3
    reasoning: string
    due_by: timestamp | null
  }
  alternatives: [{
    action_type: string
    skill_id: string
    reasoning: string
  }] | null
  step_content: object | null     // when generating a mission sequence step
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Existing endpoints absorbed:** `nextBestStepService.deriveNextBestStep`, `barryHunterGenerateStep`, `barryGenerateSequenceStep`

---

## Skill 7: PrepareMeetingBriefSkill

**Purpose:** Generate a pre-meeting briefing document synthesizing relationship history, company intelligence, and strategic recommendations.
**Model tier:** DEEP (multi-source synthesis)
**Deterministic:** no
**Idempotent:** yes
**Side effects:** none
**Migration risk:** LOW

**Inputs:**

```
PrepareMeetingBriefInput {
  contact_id: string
  relationship_id: string
  company_id: string
  meeting_id: string | null
  meeting_type: string            // first_meeting | follow_up | quarterly_review | custom
  meeting_date: timestamp
  attendees: string[] | null
  agenda: string | null
}
```

**Outputs:**

```
PrepareMeetingBriefOutput {
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

**Existing endpoints absorbed:** `barryDossierBriefing`

---

## Skill 8: ComposeLinkedInSkill

**Purpose:** Generate a LinkedIn message or connection request message for a contact.
**Model tier:** FAST (single-task generation)
**Deterministic:** no
**Idempotent:** yes
**Side effects:** none
**Migration risk:** LOW
**Evidence:** PROPOSED — no LinkedIn message generation exists in the repository. Note: `linkedinSearch.js` is a **utility module** (`netlify/functions/utils/linkedinSearch.js`), not a routed endpoint. It exports named helpers and no `handler`, and files under `utils/` are not routed by `netlify.toml`'s `[functions] directory` setting — so no endpoint exists **by design**. Profile lookup is fully functional as a library, consumed by `barryEnrich.js:31` and `retryLinkedInPhoto.js:23`. LinkedIn *composition* (this Skill) is genuinely absent; LinkedIn *lookup* is not.

**Inputs:**

```
ComposeLinkedInInput {
  contact_id: string
  relationship_id: string
  message_type: string            // connection_request | inmail | follow_up
  context: string | null          // why reaching out
  tone: string | null
}
```

**Outputs:**

```
ComposeLinkedInOutput {
  message: string
  character_count: number         // LinkedIn has character limits
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Existing endpoints absorbed:** none

---

## Skill 9: GenerateSubjectLineSkill

**Purpose:** Generate email subject lines optimized for open rate, given message content and relationship context.
**Model tier:** FAST (short-form generation)
**Deterministic:** no
**Idempotent:** yes
**Side effects:** none
**Migration risk:** LOW
**Evidence:** Subject line generation currently happens inline within each message generator. This Skill extracts it as a standalone capability for reuse and A/B testing.

**Inputs:**

```
GenerateSubjectLineInput {
  message_body: string
  contact_name: string
  relationship_context: string | null
  message_intent: string
  variant_count: number           // 1-3 options
}
```

**Outputs:**

```
GenerateSubjectLineOutput {
  subject_lines: [{
    text: string
    style: string                 // direct | question | personalized | urgent
  }]
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Existing endpoints absorbed:** inline subject generation from `barryOutreachMessage`, `barryFirstTouch`, `generate-engagement-message`

---

## Skill 10: EvaluateResponseSkill

**Purpose:** Evaluate whether a contact's response to outreach achieved the intended goal of the original message using rule-based outcome attribution.
**Model tier:** N/A (deterministic — no LLM invocation)
**Deterministic:** yes
**Idempotent:** yes
**Side effects:** none
**Migration risk:** LOW
**Evidence:** CONFIRMED — `barryOutcomeAttribution.js` performs rule-based outcome attribution with no AI calls. The canonical audit explicitly classifies this implementation as deterministic. Per Law 20 of the Barry OS Constitution, outcome attribution is computed, not generated.

**Inputs:**

```
EvaluateResponseInput {
  original_message_id: string
  original_intent: string
  response_body: string
  response_analysis: AnalyzeReplyOutput | null
}
```

**Outputs:**

```
EvaluateResponseOutput {
  goal_achieved: string           // yes | partial | no
  effectiveness_score: number     // 0-100
  scoring_breakdown: [{
    criterion: string
    matched: boolean
    weight: number
  }]
}
```

**Existing endpoints absorbed:** `barryOutcomeAttribution` (full absorption — implementation is already deterministic, no refactor needed)

---

## Skill 11: IdentifyObjectionsSkill

**Purpose:** Identify and categorize objections in a contact's reply for strategic response planning.
**Model tier:** FAST (extraction from text)
**Deterministic:** no
**Idempotent:** yes
**Side effects:** none
**Migration risk:** LOW
**Evidence:** PROPOSED — objection identification is currently implicit within `barryInboxAnalyzer`. This Skill extracts it as a standalone capability.

**Inputs:**

```
IdentifyObjectionsInput {
  reply_body: string
  reply_analysis: AnalyzeReplyOutput | null
  relationship_context: string | null
}
```

**Outputs:**

```
IdentifyObjectionsOutput {
  objections: [{
    type: string                  // pricing | timing | authority | need | competition | trust
    text: string                  // the objection as stated
    severity: string              // blocking | concern | minor
    suggested_response_strategy: string
  }]
  overall_resistance_level: string // none | low | medium | high
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Existing endpoints absorbed:** none (extracted from AnalyzeReply scope)

---

## Skill 12: SuggestToneSkill

**Purpose:** Suggest the appropriate communication tone for a message based on relationship state, context, and user preferences.
**Model tier:** FAST (inference from structured data)
**Deterministic:** no
**Idempotent:** yes
**Side effects:** none
**Migration risk:** LOW
**Evidence:** Partial — `barryGuardrail.js` enforces tone constraints through rule-based validation (CONFIRMED). Tone selection itself is currently hardcoded per message generator or user-specified. This Skill proposes adaptive tone suggestion informed by relationship state — contextual inference that requires judgment beyond what rule-based validation provides.

**Inputs:**

```
SuggestToneInput {
  contact_id: string
  relationship_id: string
  message_intent: string
  relationship_warmth: string | null
  prior_tone_feedback: string[] | null  // from User Memory
}
```

**Outputs:**

```
SuggestToneOutput {
  recommended_tone: string        // formal | conversational | direct | empathetic | enthusiastic
  reasoning: string
  confidence: number
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Existing endpoints absorbed:** none

---

## Skill 13: RefineICPSkill

**Purpose:** Provide coaching and refinement for the user's ICP definition — RECON section completion, competitive positioning, and target market description.
**Model tier:** DEEP (coaching requires nuanced reasoning)
**Deterministic:** no
**Idempotent:** yes
**Side effects:** none
**Migration risk:** HIGH

**Inputs:**

```
RefineICPInput {
  section_id: string              // which RECON section
  current_content: string
  icp_profile_id: string
  coaching_mode: string           // review | improve | question
}
```

**Outputs:**

```
RefineICPOutput {
  feedback: string
  suggestions: string[] | null
  questions: string[] | null
  score: number | null            // 0-100 section quality score
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Existing endpoints absorbed:**

| Implementation | Disposition |
|---|---|
| `barry-coach-section` | Refactor — becomes Skill (Sonnet, 800 tokens, more capable) |
| `barryReconInterview` | Delete — less capable duplicate (Haiku, 300 tokens) |

**Migration risk note:** This Skill maps to `generate-section-1` through `generate-section-10`, `generate-icp-brief`, and `generate-all-reports` — the RECON section generators. These are currently synchronous Netlify Functions with 900-second timeout configurations. Under the modern Netlify runtime, synchronous functions are limited to 60 seconds. **HIGH MIGRATION RISK** — execution model to be determined in Document 5.

---

## Skill 14: DigestInboxSkill

**Purpose:** Digest and summarize inbox items, providing a structured overview of pending communications and required actions.
**Model tier:** FAST (summarization from structured data) / DEEP (when signal_count > 50)
**Deterministic:** no
**Idempotent:** yes
**Side effects:** none
**Migration risk:** LOW

**Inputs:**

```
DigestInboxInput {
  workspace_id: string
  since: timestamp                // digest items since this time
  focus_areas: string[] | null    // meetings | follow_ups | at_risk | new_signals
}
```

**Outputs:**

```
DigestInboxOutput {
  headline: string
  meetings_today: [{
    contact_name: string
    time: string
    prep_status: string
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
  signal_count: number
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Existing endpoints absorbed:** `barryOrientationBrief` (digest/summary portion), `process-barry-inbox-queue` (summary step)

---

## Skill 15: CategorizeFeedbackSkill

**Purpose:** Categorize and structure user feedback on Barry's outputs for the Learned Intelligence pipeline.
**Model tier:** FAST (classification)
**Deterministic:** no
**Idempotent:** yes
**Side effects:** none
**Migration risk:** LOW
**Evidence:** PROPOSED — user feedback is currently unstructured. `barry_memory` stores `user_action` entries but does not categorize them. This Skill enables structured learning from user corrections.

**Inputs:**

```
CategorizeFeedbackInput {
  feedback_type: string           // edit | dismiss | approve | reject
  original_output: string         // what Barry produced
  user_modification: string | null // what the user changed it to
  skill_id: string                // which Skill produced the original
  context: string | null
}
```

**Outputs:**

```
CategorizeFeedbackOutput {
  category: string                // tone | content | accuracy | relevance | style | length
  severity: string                // preference | correction | error
  learning_signal: string         // what Barry should learn from this
  model_used: string
  tokens_used: { input: number, output: number }
}
```

**Existing endpoints absorbed:** none

---

# Part III: Workflow Contracts

Workflows compose Skills into named sequences (Document 2, Workflow definition). Each Workflow contract specifies the step order, input/output mappings between steps, failure strategies, and which steps produce Prepared Actions.

**Architectural invariant:** Workflows orchestrate Skills. Skills never orchestrate Workflows. A Workflow may not invoke another Workflow. (R4-003, Rule 1)

---

## Workflow 1: ProcessReplyWorkflow

**Purpose:** Process an inbound email reply end-to-end: analyze, evaluate, identify objections, and optionally draft a response.
**Trigger:** `contact.reply_received` signal
**Existing implementation:** `process-barry-inbox-queue.js` (9-step chain)
**Migration risk:** MEDIUM

**Steps:**

| Step | Skill | Condition | On Failure | Produces PA |
|---|---|---|---|---|
| 1 | `AnalyzeReplySkill` | — | abort | No |
| 2 | `EvaluateResponseSkill` | — | skip | No |
| 3 | `IdentifyObjectionsSkill` | `step_1.intent == 'not_interested'` | skip | No |
| 4 | `SuggestToneSkill` | `step_1.suggested_response_type != 'none'` | skip | No |
| 5 | `WriteEmailSkill` | `step_1.suggested_response_type != 'none'` | skip | **Yes** |

**Context resolution:** Relationship Awareness, Relationship Memory, Contact fields, Company fields, User Memory

---

## Workflow 2: EngageContactWorkflow

**Purpose:** Full engagement flow — assess relationship, suggest tone, generate multi-angle outreach.
**Trigger:** User action
**Existing implementation:** `barryHunterProcessEngage.js`
**Migration risk:** MEDIUM

**Steps:**

| Step | Skill | Condition | On Failure | Produces PA |
|---|---|---|---|---|
| 1 | `SummarizeRelationshipSkill` | — | abort | No |
| 2 | `SuggestToneSkill` | — | skip | No |
| 3 | `GenerateSubjectLineSkill` | — | skip | No |
| 4 | `WriteEmailSkill` | — | abort | **Yes** |

**Context resolution:** Relationship Awareness, Relationship Memory, Business Awareness, Contact + Company fields, User Memory

---

## Workflow 3: PrepareMeetingWorkflow

**Purpose:** Prepare for an upcoming meeting — research, summarize, and generate a brief.
**Trigger:** `meeting.today` signal (auto) or user action
**Existing implementation:** `barryDossierBriefing` (monolithic)
**Migration risk:** LOW

**Steps:**

| Step | Skill | Condition | On Failure | Produces PA |
|---|---|---|---|---|
| 1 | `ResearchCompanySkill` | `company_data_age > 7 days` | skip | No |
| 2 | `SummarizeRelationshipSkill` | — | skip | No |
| 3 | `PrepareMeetingBriefSkill` | — | abort | **Yes** |

**Context resolution:** All four Awareness projections, Relationship Memory, all canonical fields, Calendar data

---

## Workflow 4: LaunchCampaignWorkflow

**Purpose:** Launch a multi-step campaign — qualify, research, and generate personalized outreach.
**Trigger:** User action
**Existing implementation:** `barryICPConversation` + `barryGenerateMissionSequence` (loosely chained)
**Migration risk:** MEDIUM

**Steps:**

| Step | Skill | Condition | On Failure | Produces PA |
|---|---|---|---|---|
| 1 | `ScoreICPFitSkill` | — | abort | No |
| 2 | `ResearchCompanySkill` | `step_1.icp_decision != 'rejected'` | skip | No |
| 3 | `GenerateSubjectLineSkill` | — | skip | No |
| 4 | `WriteEmailSkill` | — | abort | **Yes** |

**Context resolution:** Business Awareness, ICP Profile, Contact + Company fields

---

## Workflow 5: QualifyProspectWorkflow

**Purpose:** Qualify a prospect — research company, score ICP fit, summarize opportunity.
**Trigger:** User action
**Existing implementation:** `barryEnrich` + ICP scoring (separate calls)
**Migration risk:** LOW

**Steps:**

| Step | Skill | Condition | On Failure | Produces PA |
|---|---|---|---|---|
| 1 | `ResearchCompanySkill` | — | abort | No |
| 2 | `ScoreICPFitSkill` | — | abort | No |
| 3 | `SummarizeRelationshipSkill` | — | skip | **Yes** |

---

## Workflow 6: MorningBriefWorkflow

**Purpose:** Generate the daily Morning Brief — digest inbox, summarize pipeline, and present orientation.
**Trigger:** Time-based (Morning Brief schedule)
**Existing implementation:** `barryOrientationBrief` (monolithic with inline computations)
**Migration risk:** LOW

**Steps:**

| Step | Skill | Condition | On Failure | Produces PA |
|---|---|---|---|---|
| 1 | `DigestInboxSkill` | — | abort | **Yes** |

**Context resolution:** All four Awareness projections, Calendar data, Recent signals

---

## Workflow 7: ReconnectDormantWorkflow

**Purpose:** Re-engage a dormant relationship — summarize, suggest approach, and draft outreach.
**Trigger:** Churn signal or user action
**Existing implementation:** none
**Migration risk:** LOW

**Steps:**

| Step | Skill | Condition | On Failure | Produces PA |
|---|---|---|---|---|
| 1 | `SummarizeRelationshipSkill` | — | abort | No |
| 2 | `SuggestToneSkill` | — | skip | No |
| 3 | `WriteEmailSkill` | — | skip | **Yes** |

---

# Part IV: Capability Registry

Capabilities are the declared actions Barry can take through external integrations (Document 2, Capability definition). The registry structurally enforces the generative/side-effect distinction — the model cannot override the capability type (Document 1, Section 4.8).

**Phase 1 ceiling:** All side-effect capabilities ceiling at Approval. This is enforced by the Capability Registry as a structural field — not a prompt instruction.

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

**Autonomy Spectrum (Document 1):**

```
Observe → Recommend → Prepare → Approval → Autonomous
```

Phase 1 enforcement:
- Side-effect capabilities with `requires_approval: true`: ceiling at Approval
- Generative capabilities: operate at Prepare or below
- Enforcement is a Capability Registry field — not a prompt instruction

---

## Capability Contract Details

### `gmail.send_email`

**Parameters:**

```
GmailSendParameters {
  to: string
  subject: string
  body: string
  reply_to_message_id: string | null
  cc: string[] | null
  bcc: string[] | null
}
```

**Idempotency:** `idempotency_key` prevents double-send. The Action Executor checks for an existing Executed Action with the same key before invoking. This is the A1 guarantee — currently implemented in `barry_drafts.sending` transactional claim (Document 2, Prepared Action §13 migration note).

**Signals produced:** `contact.email_sent`

**Current implementation:** `barry-approve-send.js`, `gmail-send`

---

### `gmail.read_thread`

**Parameters:**

```
GmailReadParameters {
  thread_id: string | null
  message_id: string | null
  max_messages: number
}
```

**Idempotency:** safe (read-only)

---

### `calendar.create_event`

**Parameters:**

```
CalendarCreateParameters {
  title: string
  start: timestamp
  end: timestamp
  attendees: string[]
  description: string | null
}
```

**Idempotency:** `idempotency_key` prevents duplicate event creation.

**Signals produced:** `meeting.created`

---

### `apollo.search_companies`

**Parameters:**

```
ApolloSearchParameters {
  query: string
  filters: { industry: string | null, employee_range: string | null } | null
  limit: number
}
```

**Current implementation:** `search-companies` Netlify function

---

### `apollo.enrich_contact`

**Parameters:**

```
ApolloEnrichParameters {
  email: string | null
  name: string | null
  company_domain: string | null
}
```

**Signals produced:** `contact.enriched` or `company.enriched`

**Current implementation:** `enrichContact`, `enrichCompany`, `barryEnrich`

---

# Part V: Action Executor Contract

The Action Executor is the only system component that invokes Capabilities (Document 1, Section 4.8). It reads from the Prepared Action queue, checks authorization, invokes the registered Capability, records the Executed Action, and produces the closing Signal.

**Infrastructure dependency:** Side-effect capabilities depend on Netlify Functions infrastructure. The Phase 2 Netlify runtime migration (Lambda compatibility mode deprecated, July 1 2027 deadline) is a prerequisite for the Action Executor to operate reliably at Barry OS scale. Document 4 defines the contract; Document 5 sequences the migration.

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

**Residual risk A14:** If Gmail succeeds but the terminal Firestore write fails, the email is sent but the Executed Action is not recorded. This risk is accepted until P6 (advanced reliability). The current `barry_drafts` implementation carries the same risk — this migration does not introduce new failure modes.

## Migration Identity Requirement

During the `barry_drafts` → Prepared Action coexistence window (Document 5, P6), two execution paths exist simultaneously. The existing `idempotency_key` (`{prepared_action_id}_{capability_id}_{timestamp}`) is a carried token — it is assigned at Prepared Action creation time, includes a timestamp component, and is not present on `barry_drafts` documents. It cannot be re-derived from observable state. It therefore cannot serve as the cross-system identity that bridges legacy and target execution paths during migration.

The P6 migration window requires a **stable per-action migration identity** with the following properties:

1. **Present before execution** — the identity must exist on the legacy document (`barry_drafts`) before any execution attempt, not only on the target-state object (`prepared_actions`)
2. **Immutable** — the identity must not change across contact merge, re-parenting, retry, regeneration, rollback, or backfill
3. **Distinct from `idempotency_key`** — the existing `idempotency_key` is a carried token that includes a timestamp and is not reproducible from observable state; the migration identity is a separate concept that identifies the logical action independent of when or how it enters the execution pipeline
4. **Not derived from mutable or scope-limited fields:**
   - Not from `contactId` — mutable under contact merge and re-parenting
   - Not from `messageRecordId` — scoped to the reply flow; not present on all external side-effect paths
   - Not from `draftId` or other collection-specific document identifiers — not bridgeable across collections

Document 4 defines this requirement. Document 5's P6 Definition of Ready specifies the implementation that satisfies it.

### Authority Relationship

The migration identity is a **logical-action identifier**, not an execution authority or claim object:

- The migration identity establishes that legacy and target representations correspond to the same logical action during the `barry_drafts` → Prepared Action coexistence window
- The migration identity is not itself an execution authority — it does not authorize, veto, expire, or recover execution claims
- During coexistence, migration synchronization must use this stable identity to ensure legacy and target execution attempts converge on one send-once decision
- The Executed Action keyed by `idempotency_key` remains the target-state execution claim authority defined by this Part
- Any temporary synchronization mechanism required during coexistence must retire when no executable legacy `barry_drafts` path remains capable of producing an external side effect
- The migration identity requirement does not modify the permanent `idempotency_key` contract or the Prepared Action → Executed Action authority chain

If satisfying this requirement necessitates introducing another object that can independently authorize, veto, expire, or recover execution claims — a second execution authority alongside the Executed Action — this Part requires redesign. That determination is a governance decision.

### Stable Identity Requirement for External Side-Effect Migration

Every external side-effect path entering the Action Executor must carry a stable logical-action identity before migrating behind the Action Executor. A path without a proven stable identity may not migrate behind the Action Executor.

The specific path inventory and per-path identity verification status are defined in Document 5's P6 Definition of Ready. This Part establishes the contract obligation; Document 5 establishes its satisfaction.

---

# Part VI: Context Resolution Contract

Context Resolution (Document 1, Section 4.5) assembles the data a Skill or Workflow needs before invocation. Context is resolved once per invocation — Skills and Workflows do not own context and do not re-resolve it mid-execution (Document 1, Law 25).

---

## Context Scope Types

```
ContextScope {
  scope_type: string              // relationship | business | mission | user | calendar
  entity_ids: string[]
  awareness: boolean
  memory: boolean
  canonical: boolean
  signals: {
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
        ↓
2. AWARENESS PROJECTIONS
   Fetch current Awareness state for requested projections
        ↓
3. MEMORY
   Fetch relevant memory by type
        ↓
4. RECENT SIGNALS (if requested)
   Fetch signals since specified timestamp
        ↓
5. ASSEMBLY
   Combine into structured ContextPackage
   Apply token budget estimation
   If over budget → summarize using SummarizeRelationshipSkill
        ↓
ResolvedContext delivered to Skill/Workflow
```

**Current implementations being consolidated:**
- `barryContextStack.js` (client-side, 500 contacts) → **Delete** — context assembly must be server-side only
- `barryGenerateContext` (server-side, focused) → **Refactor** — becomes the Context Resolver
- `assembleBarryContext()` in `barryMemoryService` (per-contact) → **Refactor** — becomes the per-entity resolution step

---

# Part VII: Think Layer Interface

The Think Layer (Document 1, Section 4.6) produces recommendations. Each recommendation specifies which Skill or Workflow should execute.

**Architectural invariant: The Think Layer never performs external side effects.** The Think Layer synthesizes, compares, weighs tradeoffs, and chooses strategy. It produces a Recommendation. It does not send email, write to Firestore canonical objects, call external APIs, or mutate any state outside of Barry's own reasoning output. Side effects belong exclusively to the Action Executor after Approval authorization. Any future implementation that places a side effect inside the Think Layer violates this constraint and must be rejected at review.

**Current state:** `barryStrategyRecommender.js` is the confirmed partial Think layer. It satisfies 3 of 4 Think functions:
- ✓ Contact-level strategy selection
- ✓ Recency-weighted outcome attribution
- ✓ Explainable reasoning with `reasons[]`
- ✗ Cross-entity priority comparison — absent

P5 is permanently named Think Layer Promotion & Expansion.

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
| Dormant contact detected | Churn signal | `ReconnectDormantWorkflow` | Low (3) |
| NBS generation needed | Awareness stale | `GenerateNextStepSkill` | Medium (2) |
| ICP coaching requested | User action | `RefineICPSkill` | Low (3) |

**Cross-entity prioritization** (the fourth Think function — absent today):

When multiple recommendations compete for the same time slot, the Think Layer applies priority synthesis:
1. Critical (0) always wins
2. Within the same priority level, sort by: urgency (`due_by`), relationship health score (worse = higher priority), revenue potential
3. The synthesized priority list is the Think Layer's primary output — the queue of what Barry should do next
4. `strategyScores` are persisted (not discarded as today) for the reasoning trace per Document 1 (Reference Architecture, Section 4.6: "`strategyScores` — persisted, not discarded")

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
  error_rate_1h: number
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

- If the Capability is the Skill's sole purpose (e.g., `gmail.send_email`): the Prepared Action remains in `ready_for_review` with a status note
- If the Capability is one input among several (e.g., `apollo.search_companies` in `ResearchCompanySkill`): the Skill continues with available data and flags reduced confidence

---

# Part IX: Model Policy

All AI model selection is governed by a centralized policy. Skills declare which model they need; the policy enforces it. No Skill or Workflow may hardcode a model ID — they reference a policy tier (Document 1, BO-006 decision).

---

## Model Tiers

| Tier | Model Constant | Model ID | Use Case | Token Budget |
|---|---|---|---|---|
| **FAST** | `MODEL_FAST` | `claude-haiku-4-5` | High frequency, short output, latency-sensitive, user waiting | ≤ 2500 output tokens |
| **DEEP** | `MODEL_DEEP` | `claude-sonnet-4-6` | Reasoning, long structured output, result is persisted/reused | ≤ 2000 output tokens |

**Tier justification per Skill:**

| Skill | Tier | Justification |
|---|---|---|
| WriteEmailSkill | FAST (single) / DEEP (multi-angle) | Single drafts are generation; multi-angle requires strategy |
| ResearchCompanySkill | DEEP | Multi-source synthesis |
| ScoreICPFitSkill | DEEP | Structured scoring with reasoning |
| SummarizeRelationshipSkill | FAST | Summarization from structured data |
| AnalyzeReplySkill | FAST | Single-task pattern recognition |
| GenerateNextStepSkill | FAST | Strategy from structured context |
| PrepareMeetingBriefSkill | DEEP | Multi-source synthesis, result is persisted |
| ComposeLinkedInSkill | FAST | Short-form generation |
| GenerateSubjectLineSkill | FAST | Short-form generation |
| EvaluateResponseSkill | N/A (Deterministic) | Rule-based attribution — no LLM per Law 20 |
| IdentifyObjectionsSkill | FAST | Extraction from text |
| SuggestToneSkill | FAST | Inference from structured data |
| RefineICPSkill | DEEP | Coaching requires nuanced reasoning |
| DigestInboxSkill | FAST / DEEP (>50 signals) | Summarization, escalate at volume |
| CategorizeFeedbackSkill | FAST | Classification |

**Selection criteria:**

- Default to FAST for all Skills unless the task requires multi-source synthesis or structured reasoning
- Escalate to DEEP when: complexity score > 0.7, input sources > 3, or the Skill's contract specifies it
- Never use a model outside these two tiers without explicit governance approval
- Every Skill currently on a `LEGACY_*` constant must target `MODEL_DEEP` or `MODEL_FAST` — not the legacy identifier

**Current model migration status:**

| Tier | Model Constant | Model ID | Module Count | Status |
|---|---|---|---|---|
| FAST | `MODEL_FAST` | `claude-haiku-4-5` | 1 | Current — on policy tier |
| DEEP | `MODEL_DEEP` | `claude-sonnet-4-6` | 17 | Current — on policy tier |
| Legacy | `LEGACY_HAIKU_4_5` | `claude-haiku-4-5-20251001` | 10 | Migration needed — pinned to old model ID |
| Legacy | `LEGACY_SONNET_4_5` | `claude-sonnet-4-5-20250929` | 8 | **AT RISK** — pending provider lifecycle verification |

8 modules reference `LEGACY_SONNET_4_5` (`claude-sonnet-4-5-20250929`). The model ID encodes a date suffix that `models.js` (lines 70–74) flags as a potential retirement floor. The exact retirement timeline is unverified — Team A must confirm the provider lifecycle status before any migration is scheduled. Until verified, no retirement date is asserted. These 8 modules must migrate to `MODEL_DEEP` regardless of retirement timing. The tier correction is a prerequisite for Document 5's build sequence.

**Cost guardrails:**

```
Per-user daily budget:
  FAST tier: 300,000 tokens (input + output)
  DEEP tier: 100,000 tokens (input + output)

Per-invocation limits:
  Input: max 5,000 tokens per Skill call
  Output: per Skill contract (see individual Skill specs)

Overage handling:
  Soft limit (80%): warn user, no throttling
  Hard limit (100%): queue non-critical Skills, allow only Critical (0) priority
```

---

# Part X: Infrastructure Dependencies

## Netlify Runtime Migration (Phase 2)

Lambda compatibility mode is deprecated with a July 1, 2027 deadline. The modern Netlify Functions runtime removes the 4KB environment variable limit. Migration is required infrastructure work.

The Action Executor contract (Part V) and all Capability invocations depend on Netlify Functions infrastructure. The Phase 2 runtime migration is a prerequisite for reliable operation at Barry OS scale. Document 4 defines the contracts; Document 5 sequences the migration.

## RECON Generators — HIGH MIGRATION RISK

`generate-section-1` through `generate-section-10`, `generate-icp-brief`, and `generate-all-reports` are currently synchronous Functions with 900-second timeout configurations. Under the modern Netlify runtime, synchronous functions are limited to 60 seconds.

These map to `RefineICPSkill` (Skill 13). If RECON section generation requires more than 60 seconds, the execution model must change. This is a behavioral change to the RECON user experience. Execution model to be determined in Document 5.

## New Firestore Paths

Document 4 implies new Firestore paths for Skills, Workflows, the Capability Registry, and the Action Queue. Before any new path is included, it must route through `FIRESTORE_DATA_ARCHITECTURE.md`.

Every new path must declare: exact path, owner (Platform or Barry), authority classification, persistence classification, writers and readers, retention rule, and security rule requirement. This follows the documentation framework established by `FIRESTORE_DATA_ARCHITECTURE.md`.

---

## Document Status

| Field | Value |
|---|---|
| **Discovery source** | `docs/audits/BARRY_OS_FOUNDATION_AUDIT.md` (commit `09e90f9`) |
| **Discovery authority** | `docs/audits/BARRY_OS_AUDIT_RECONCILIATION.md` |
| **Architecture source** | `docs/barry-os/architecture/BARRY_OS_REFERENCE_ARCHITECTURE.md` (Document 1 — FROZEN 2026-08-07) |
| **Domain model** | `docs/barry-os/architecture/BARRY_OS_DOMAIN_LIFECYCLE_MODEL.md` (Document 2 — FROZEN 2026-08-08) |
| **Signal specification** | `docs/barry-os/architecture/BARRY_OS_SIGNAL_SPECIFICATION.md` (Document 3 — FROZEN 2026-08-08) |
| **Infrastructure baseline** | `FIRESTORE_DATA_ARCHITECTURE.md` |
| **Architecture status** | Draft — formal brief received 2026-08-10, revision in progress |
| **Supersedes** | None |
| **Superseded by** | None (this is the canonical capability specification) |
| **Frozen** | No — pending Team A review and Aaron approval |

## Freeze Declaration

Document 4 will be frozen upon approval by Aaron after Team A evidence review.

This document may only be modified if a factual error is discovered during
implementation that directly contradicts a capability contract stated here.

It may not be modified to:
- Add new Skills or Workflows without Aaron's approval
- Redefine objects, lifecycle states, or signal contracts from Documents 1–3
- Change the Capability Registry in ways that violate Document 1's structural enforcement model
- Determine execution architecture (sync/async/background) — Document 5 owns those decisions

If implementation uncovers a genuine conflict with a capability contract, flag it to Aaron
before making any change. The bar for reopening a frozen document is high.

All future implementation references in Document 5 derive from this document. They do not redefine capability contracts.

---

*No code was written or changed during this document. This is an architecture specification only.*
