# Barry OS Signal Specification

**Idynify · Document 3 of 5 · Team B**
**Date: 2026-08-08**
**Repository: aepwiley13/idynify-scout**
**Source of Truth: docs/audits/BARRY_OS_AUDIT_RECONCILIATION.md (reconciliation — wins over everything)**
**Canonical Audit: docs/audits/BARRY_OS_FOUNDATION_AUDIT.md**
**Architecture: docs/barry-os/architecture/BARRY_OS_REFERENCE_ARCHITECTURE.md (Document 1 — frozen)**
**Domain Model: docs/barry-os/architecture/BARRY_OS_DOMAIN_LIFECYCLE_MODEL.md (Document 2 — pending approval)**

---

## Governance

This document operationalizes the Signal, Observation, and Awareness objects defined in Document 2. It does not redefine them.

```
Constitutional Brief        ← historical intent
        ↓
Canonical Audit             ← repository evidence
        ↓
Reconciliation Addendum     ← final discovery truth
        ↓
Reference Architecture      ← Document 1 — system design (frozen)
        ↓
Domain & Lifecycle Model    ← Document 2 — object definitions (pending approval)
        ↓
Signal Specification        ← THIS DOCUMENT — event contracts
        ↓
Capability Contracts        ← Document 4
        ↓
Implementation Plan         ← Document 5
```

**What this document defines:**
- The signal envelope format and validation rules
- Every signal type with its payload schema, producer, and consumers
- The Observation pipeline contract
- The Awareness checkpoint and replay mechanism (deferred from Document 2)
- Signal bus architecture and processing guarantees

**What this document does NOT define:**
- Object schemas — Document 2 owns those
- Skill or Workflow implementations — Document 4
- Build order — Document 5
- Object lifecycles — Document 2

---

## Evidence Levels

```
CONFIRMED   Verified in the canonical audit at a specific file or line.
PROPOSED    New architecture not present in the codebase today.
DEFERRED    Decision deferred to a later document or implementation phase.
```

| Component | Evidence Level |
|---|---|
| Signal envelope format | PROPOSED (Document 1, Section 4.2 — no normalized format exists today) |
| Signal types from audit signal map | CONFIRMED (audit Step 4 — 24 events mapped) |
| Signal types from Document 2 lifecycle transitions | PROPOSED (derived from Document 2 state machines) |
| Observation pipeline | PROPOSED (Document 2 — processing step, persistence marked PROPOSED) |
| Awareness checkpoint mechanism | PROPOSED (deferred from Document 2, Correction 5) |
| Signal bus collection path | PROPOSED (Document 2: `users/{uid}/signals/{signalId}`) |
| Observation persistence path | PROPOSED (Document 2: `users/{uid}/observations/{observationId}`) |

---

# Part I: Signal Bus Architecture

---

## Current State

No normalized signal format exists (audit Step 4, Document 1 Section 4.2). Barry is blind to real-time events. All signal awareness is either poll-based (Gmail replies checked periodically via `gmail-poll-replies`) or computed at query time. There is no event bus, no webhook-driven signal processing, no real-time awareness update.

The closest existing pattern is `process-barry-inbox-queue.js`, which reads from `barry_processing_queue` (a top-level Firestore collection), processes entries sequentially, and writes analysis and draft replies to contact subcollections. This is queue-based processing that chains analysis and action — the pattern the Signal Bus generalizes.

## Signal Bus Design

The Signal Bus is a Firestore-backed, append-only event log. Signals are written by producers (platform modules, integrations, the Action Executor) and consumed by the Observation pipeline.

```
┌──────────────────────────────────────────────────────────┐
│                     SIGNAL PRODUCERS                      │
│                                                          │
│  Gmail Integration    Calendar Integration    Apollo     │
│  Platform Events      User Actions           Action Exec │
└──────────────┬───────────────┬───────────────┬───────────┘
               │               │               │
               ▼               ▼               ▼
┌──────────────────────────────────────────────────────────┐
│                     SIGNAL BUS                            │
│                                                          │
│  users/{uid}/signals/{signalId}                          │
│  Append-only. Immutable after creation.                  │
│  Ordered by occurred_at. Partitioned by workspace.       │
│                                                          │
│  Lifecycle: received → observed → processed              │
│             received → invalid (validation failure)      │
│             received → expired (TTL elapsed)             │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                  OBSERVATION PIPELINE                      │
│                                                          │
│  Deterministic processing. No AI.                        │
│  Signal → structured observations → Awareness updates    │
│                                                          │
│  [PROPOSED] Persisted at:                                │
│  users/{uid}/observations/{observationId}                │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                   AWARENESS LAYER                         │
│                                                          │
│  4 projections, continuously updated:                    │
│    Relationship Awareness (per-contact)                  │
│    Business Awareness (workspace-wide)                   │
│    Mission Awareness (workspace-wide)                    │
│    User Awareness (workspace-wide)                       │
│                                                          │
│  Checkpointed. Rebuildable from checkpoint + delta.      │
└──────────────────────────────────────────────────────────┘
```

## Processing Guarantees

| Guarantee | Specification |
|---|---|
| **Ordering** | Signals processed in `occurred_at` order within a workspace. Ties broken by `received_at`. |
| **At-least-once delivery** | The observation pipeline must be idempotent — processing the same signal twice produces the same observations. |
| **Workspace isolation** | Signals never cross workspace boundaries. Every signal is scoped to one `workspace_id`. |
| **Immutability** | Once created, a signal document is never mutated. Only `lifecycle_state`, `observed_at`, and `processed_at` are updated (write-forward transitions only). |
| **Backpressure** | If the observation pipeline falls behind, signals queue in `received` state. No signal is dropped — the pipeline catches up. |

## Signal Validation

Every signal must pass schema validation before entering `received` state. Validation failures produce `invalid` state with a reason.

**Required fields (envelope):**
- `signal_type` — must match a registered type from the signal catalog
- `workspace_id` — must be a valid workspace
- `entity_type` — must be one of: `contact`, `company`, `mission`, `campaign`, `cadence`, `message`, `meeting`, `user`
- `entity_id` — must be a non-empty string
- `source` — must be one of: `gmail`, `calendar`, `apollo`, `platform`, `user_action`, `barry_action`
- `payload` — must conform to the schema for the declared `signal_type`
- `occurred_at` — must be a valid timestamp, not in the future (with 5-minute clock skew tolerance)

**Validation rules:**
1. Unknown `signal_type` → `invalid` with reason `unknown_signal_type`
2. Missing required envelope field → `invalid` with reason `missing_field:{field_name}`
3. Payload does not match type schema → `invalid` with reason `payload_schema_violation`
4. `occurred_at` in the future → `invalid` with reason `future_timestamp`
5. Duplicate `idempotency_key` (if provided) → silently deduplicated (not `invalid`)

---

# Part II: Signal Envelope

---

## Canonical Signal Envelope

This is the universal format for every signal in Barry OS. The envelope is defined in Document 2 (Signal object, fields section). This document specifies the payload schemas per signal type.

```
Signal {
  signal_id: string                  // auto-generated unique ID
  signal_type: string                // namespaced: 'contact.reply_received'
  workspace_id: string               // userId (workspace boundary)

  // Entity reference
  entity_type: string                // contact | company | mission | campaign | cadence | message | meeting | user
  entity_id: string

  // Source
  source: string                     // gmail | calendar | apollo | platform | user_action | barry_action
  source_detail: string | null       // specific function or integration endpoint

  // Payload
  payload: object                    // event-specific data (schema per signal_type — defined below)

  // Lifecycle
  lifecycle_state: string            // received | observed | processed | invalid | expired

  // Idempotency
  idempotency_key: string | null     // optional — prevents duplicate signal creation

  // Timestamps
  occurred_at: timestamp             // when the event actually happened
  received_at: timestamp             // when the signal bus received it
  observed_at: timestamp | null      // when Observation pipeline processed it
  processed_at: timestamp | null     // when all awareness updates completed
  expires_at: timestamp              // received_at + 90 days
}
```

**Namespace convention:** Signal types use dot-separated namespacing: `{entity_type}.{event_name}`. The entity type in the signal type MUST match the `entity_type` field.

---

# Part III: Signal Catalog

---

Every signal type is defined with: its namespace, what it means, who produces it, what payload it carries, which awareness projections it updates, and its priority.

## Priority Definitions

| Priority | Meaning | Processing SLA |
|---|---|---|
| **Critical** | Requires immediate awareness update. Delays affect user-facing recommendations. | < 60 seconds from `received` to `processed` |
| **High** | Important for timely awareness. Affects next-session recommendations. | < 5 minutes |
| **Medium** | Updates awareness but not time-sensitive. | < 30 minutes |
| **Low** | Informational. Updates awareness on next scheduled refresh. | < 24 hours |

---

## Contact Signals

### `contact.reply_received`

**Priority:** Critical

**Purpose:** A contact replied to an outbound message. This is the highest-value signal in the system — it means the relationship is active and Barry must respond.

**Producer:** Gmail integration (`gmail-poll-replies` today, webhook in target state)

**Source:** `gmail`

**Payload:**

```
{
  message_id: string               // platform Message record ID (created on receipt)
  thread_id: string | null         // email thread ID
  channel: string                  // email | linkedin | text
  reply_to_message_id: string | null  // the outbound message this replies to
  snippet: string                  // first 200 chars of reply body (for preview)
  received_at: timestamp           // when the reply was received
}
```

**Awareness updates:**
- Relationship Awareness: `engagement_status` → `active`, `days_since_last_reply` → 0, `consecutive_no_replies` → 0, `total_replies_received` += 1, `reply_rate` recalculated, recalculate `warmth_level` and `momentum_direction`
- Business Awareness: `responses_pending_count` += 1

**Observation output:**
```
[
  { key: 'contact.reengaged', value: true, confidence: 1.0 },
  { key: 'reply.channel', value: payload.channel, confidence: 1.0 },
  { key: 'reply.response_latency_hours', value: <computed from sent_at to received_at>, confidence: 1.0 }
]
```

**Current state:** Poll-based via `gmail-poll-replies`. Not real-time. The reply is discovered when the polling function runs, not when it arrives.

---

### `contact.email_sent`

**Priority:** High

**Purpose:** An outbound email was sent to a contact — either user-authored or Barry-prepared (via Executed Action → Message creation).

**Producer:** Gmail integration (`gmail-send`, `barry-approve-send`)

**Source:** `gmail`

**Payload:**

```
{
  message_id: string               // platform Message record ID
  channel: string                  // email
  subject: string
  executed_action_id: string | null  // if sent via Barry's action chain
  campaign_id: string | null
  cadence_id: string | null
}
```

**Awareness updates:**
- Relationship Awareness: `total_messages_sent` += 1, `days_since_last_contact` → 0, recalculate `engagement_status`
- Business Awareness: `messages_sent_this_week` += 1

**Current state:** CONFIRMED — recorded at send time (audit Step 4).

---

### `contact.email_opened`

**Priority:** Medium

**Purpose:** An outbound email was opened by the recipient (tracked via open pixel).

**Producer:** `track-open` function

**Source:** `platform`

**Payload:**

```
{
  message_id: string
  opened_at: timestamp
  open_count: number               // how many times opened (first open is most significant)
}
```

**Awareness updates:**
- Relationship Awareness: update `channel_effectiveness.email.open_rate`, signal is positive engagement indicator for `momentum_direction`

**Current state:** CONFIRMED — `track-open` function exists (audit Step 4).

---

### `contact.email_bounced`

**Priority:** High

**Purpose:** An outbound email bounced — delivery failed.

**Producer:** Gmail integration (bounce notification)

**Source:** `gmail`

**Payload:**

```
{
  message_id: string
  bounce_type: string              // hard | soft
  bounce_reason: string | null     // invalid_address | mailbox_full | temporary_failure
}
```

**Awareness updates:**
- Relationship Awareness: `consecutive_no_replies` += 1 (if hard bounce), `risk_score` increase, flag `channel_effectiveness.email` degradation
- Business Awareness: pipeline health signal

**Current state:** PROPOSED — no emission point exists in the repository. Signal design and payload schema are correct. Evidence references are schema comments and CSS animations only.

---

### `contact.added`

**Priority:** Medium

**Purpose:** A new contact record was created in the workspace.

**Producer:** Platform (manual add, import, Apollo enrichment, Scout discovery)

**Source:** `platform`

**Payload:**

```
{
  source: string                   // apollo | linkedin | manual | import | scout
  company_id: string | null
  has_email: boolean
  has_phone: boolean
  has_linkedin: boolean
}
```

**Awareness updates:**
- Business Awareness: `total_active_relationships` += 1, `pipeline_velocity.new_contacts_this_week` += 1
- Relationship Awareness: initialize new projection in `initialized` state

**Current state:** CONFIRMED — contact creation events (audit Step 4).

---

### `contact.enriched`

**Priority:** Medium

**Purpose:** A contact's data was enriched via an external source (Apollo, LinkedIn).

**Producer:** Enrichment pipeline (`enrichContact`)

**Source:** `apollo`

**Payload:**

```
{
  enrichment_source: string        // apollo | linkedin
  fields_enriched: string[]        // which fields were updated: ['title', 'company_name', 'email']
  enrichment_status: string        // complete | partial | failed
}
```

**Awareness updates:**
- Relationship Awareness: update if enrichment reveals relevant engagement data
- Business Awareness: enrichment status counts

**Current state:** CONFIRMED — enrichment_steps, enrichment_summary fields (audit Step 4).

---

### `contact.archived`

**Priority:** Low

**Purpose:** A contact was archived by the user.

**Producer:** Platform (user action)

**Source:** `user_action`

**Payload:**

```
{
  archived_reason: string | null   // user-provided reason
  had_active_relationship: boolean // was relationship in 'active' state
}
```

**Awareness updates:**
- Relationship Awareness: freeze projection (no further updates)
- Business Awareness: `total_active_relationships` -= 1, update pipeline counts

**Current state:** CONFIRMED — contact archival exists.

---

### `contact.restored`

**Priority:** Medium

**Purpose:** An archived contact was restored to active state.

**Producer:** Platform (user action)

**Source:** `user_action`

**Payload:**

```
{
  previous_archived_at: timestamp
  days_archived: number
}
```

**Awareness updates:**
- Relationship Awareness: unfreeze projection, mark `stale` for recomputation
- Business Awareness: `total_active_relationships` += 1

**Current state:** PROPOSED — no explicit restore flow exists today.

---

### `contact.merged`

**Priority:** Medium

**Purpose:** Two contact records were merged (duplicate resolution).

**Producer:** Platform (user action)

**Source:** `platform`

**Payload:**

```
{
  surviving_contact_id: string     // the contact that remains
  merged_contact_id: string        // the contact that was absorbed
  fields_from_merged: string[]     // which fields were kept from the merged record
}
```

**Awareness updates:**
- Relationship Awareness: merge awareness data from both contacts into surviving contact's projection, mark `stale` for recomputation
- Business Awareness: `total_active_relationships` -= 1

**Current state:** PROPOSED — no merge flow exists today.

---

## Company Signals

### `company.discovered`

**Priority:** Medium

**Purpose:** A new company was found via Scout search, import, or manual add.

**Producer:** Scout module (`search-companies`)

**Source:** `platform`

**Payload:**

```
{
  discovery_source: string         // scout | apollo | manual | import
  industry: string | null
  employee_count: number | null
  has_icp_score: boolean
}
```

**Awareness updates:**
- Business Awareness: pipeline discovery counts

**Current state:** CONFIRMED — companies collection, status field (audit Step 4).

---

### `company.icp_evaluated`

**Priority:** Medium

**Purpose:** A company was evaluated against ICP criteria. Replaces the former `company.accepted` / `company.rejected` signal types — evaluation is a fact, acceptance is a decision stored as a field.

**Producer:** ScoreICPFitSkill

**Source:** `platform`

**Payload:**

```
{
  icp_score: number                // 1-10
  icp_decision: string             // accepted | rejected | pending
  evaluation_criteria: string[]    // which ICP criteria were checked
}
```

**Awareness updates:**
- Business Awareness: ICP evaluation pipeline metrics

**Current state:** CONFIRMED — barryFeedback score + status (audit Step 4). Renamed from `company.accepted`/`company.rejected` to align with Document 2 Correction 2 (ICP evaluation is a field, not a lifecycle state).

---

### `company.enriched`

**Priority:** Medium

**Purpose:** Company data was enriched via external source.

**Producer:** Enrichment pipeline

**Source:** `apollo`

**Payload:**

```
{
  enrichment_source: string
  fields_enriched: string[]
  enrichment_status: string
}
```

**Awareness updates:**
- Business Awareness: enrichment coverage metrics

**Current state:** CONFIRMED — company enrichment exists.

---

## Message Signals

### `message.delivered`

**Priority:** Medium

**Purpose:** An outbound message was confirmed delivered.

**Producer:** Gmail integration (delivery receipt)

**Source:** `gmail`

**Payload:**

```
{
  message_id: string
  channel: string
  delivered_at: timestamp
}
```

**Awareness updates:**
- Relationship Awareness: delivery confirmation updates `channel_effectiveness`

---

### `message.bounced`

**Priority:** High

**Purpose:** An outbound message bounced. Produces same awareness updates as `contact.email_bounced` but scoped to the Message object.

**Producer:** Gmail integration

**Source:** `gmail`

**Payload:**

```
{
  message_id: string
  bounce_type: string              // hard | soft
  bounce_reason: string | null
}
```

**Awareness updates:**
- Same as `contact.email_bounced`

**Current state:** PROPOSED — no emission point exists in the repository. Signal design and payload schema are correct.

---

## Meeting Signals

### `meeting.today`

**Priority:** Critical

**Purpose:** A calendar event involving a known contact is happening today. Triggers meeting preparation workflows.

**Producer:** Calendar integration (`calendar-list-events`)

**Source:** `calendar`

**Payload:**

```
{
  calendar_event_id: string
  title: string
  start_time: timestamp
  end_time: timestamp
  attendee_contact_ids: string[]   // matched contact IDs
  attendee_emails: string[]        // all attendee emails (some may not match contacts)
  location: string | null
  meeting_type: string | null      // inferred: initial | followup | recurring
}
```

**Awareness updates:**
- Relationship Awareness: upcoming interaction signal for each matched contact
- Business Awareness: `meetings_today_count` += 1
- Mission Awareness: if meeting contacts are part of a mission, update mission activity

**Current state:** CONFIRMED — pull-based via `calendar-list-events` (audit Step 4). Not real-time.

---

### `meeting.created`

**Priority:** Medium

**Purpose:** A new calendar event was created involving a known contact.

**Producer:** Calendar integration

**Source:** `calendar`

**Payload:**

```
{
  calendar_event_id: string
  title: string
  scheduled_at: timestamp
  attendee_contact_ids: string[]
  days_until: number
}
```

**Awareness updates:**
- Relationship Awareness: positive engagement indicator, update `momentum_direction`

**Current state:** Partially known — only visible via calendar poll (audit Step 4).

---

### `meeting.completed`

**Priority:** High

**Purpose:** A scheduled meeting time has passed. Triggers post-meeting workflows (follow-up, brief update).

**Producer:** Calendar integration (time-based trigger)

**Source:** `calendar`

**Payload:**

```
{
  calendar_event_id: string
  attendee_contact_ids: string[]
  duration_minutes: number
  meeting_type: string | null
}
```

**Awareness updates:**
- Relationship Awareness: `total_interactions` += 1, `days_since_last_contact` → 0, positive `momentum_direction` signal

---

## Mission Signals

### `mission.created`

**Priority:** Medium

**Purpose:** A new mission was created by the user.

**Producer:** Platform (Hunter module)

**Source:** `platform`

**Payload:**

```
{
  mission_name: string
  goal: string | null
  target_contact_count: number
  campaign_count: number
}
```

**Awareness updates:**
- Mission Awareness: `active_missions_count` += 1
- Business Awareness: mission pipeline update

**Current state:** CONFIRMED — mission document exists (audit Step 4).

---

### `mission.step_completed`

**Priority:** High

**Purpose:** A step in a mission campaign was completed (email sent, call made, meeting held).

**Producer:** Platform (campaign execution)

**Source:** `platform`

**Payload:**

```
{
  mission_id: string
  campaign_id: string
  cadence_id: string | null
  step_number: number
  step_type: string                // email | linkedin | call | meeting
  contact_id: string
  outcome: string | null           // sent | completed | skipped
}
```

**Awareness updates:**
- Mission Awareness: update mission progress, `steps_completed_this_week` += 1
- Relationship Awareness: engagement signal for the contact

**Current state:** CONFIRMED — mission step outcomes (audit Step 4).

---

### `mission.deadline_approaching`

**Priority:** High

**Purpose:** A mission's target end date is within the warning window (default: 7 days).

**Producer:** Scheduled computation (daily check)

**Source:** `platform`

**Payload:**

```
{
  mission_id: string
  mission_name: string
  target_end_date: timestamp
  days_remaining: number
  completion_percentage: number
}
```

**Awareness updates:**
- Mission Awareness: add to `missions_at_risk` if off-track

**Current state:** Not currently detected (audit Step 4). PROPOSED.

---

### `mission.completed`

**Priority:** High

**Purpose:** A mission reached its success criteria or was marked complete.

**Producer:** Platform (user action or success criteria met)

**Source:** `platform`

**Payload:**

```
{
  mission_id: string
  completion_type: string          // success_criteria_met | user_completed | user_abandoned
  final_metrics: {
    contacts_engaged: number
    responses_received: number
    meetings_held: number
  }
}
```

**Awareness updates:**
- Mission Awareness: `active_missions_count` -= 1, remove from active tracking
- Business Awareness: mission completion metrics

---

## Campaign Signals

### `campaign.launched`

**Priority:** Medium

**Purpose:** A campaign within a mission was activated.

**Producer:** Platform

**Source:** `platform`

**Payload:**

```
{
  campaign_id: string
  mission_id: string
  enrolled_contact_count: number
  total_steps: number
}
```

**Awareness updates:**
- Mission Awareness: campaign activity update

---

### `campaign.step_completed`

**Priority:** Medium

**Purpose:** A cadence step within a campaign was completed for a specific contact.

**Producer:** Platform (campaign execution engine)

**Source:** `platform`

**Payload:**

```
{
  campaign_id: string
  mission_id: string
  cadence_id: string
  contact_id: string
  step_number: number
  action_type: string              // email | linkedin | call | meeting
}
```

**Awareness updates:**
- Mission Awareness: campaign progress update

**Current state:** CONFIRMED — campaign step outcomes (audit Step 4).

---

### `campaign.completed`

**Priority:** Medium

**Purpose:** All cadences for all enrolled contacts in a campaign are complete.

**Producer:** Platform

**Source:** `platform`

**Payload:**

```
{
  campaign_id: string
  mission_id: string
  contacts_completed: number
  total_steps_executed: number
}
```

**Awareness updates:**
- Mission Awareness: campaign completion, parent mission progress update

---

## User Action Signals

### `nbs.confirmed`

**Priority:** High

**Purpose:** The user confirmed (approved) a Next Best Step recommendation.

**Producer:** UI (user action)

**Source:** `user_action`

**Payload:**

```
{
  recommendation_id: string        // the Recommendation that was approved
  recommendation_type: string      // follow_up | reply | prepare_brief | outreach | etc.
  contact_id: string | null
  time_to_decide_seconds: number   // how long the user took to approve
}
```

**Awareness updates:**
- User Awareness: `recommendation_acceptance_rate` recalculated, update `approval_patterns`, `avg_approval_time_minutes`
- Relationship Awareness: engagement intent signal for the contact

**Current state:** CONFIRMED — NBS field update (audit Step 4).

---

### `nbs.dismissed`

**Priority:** High

**Purpose:** The user dismissed a Next Best Step recommendation.

**Producer:** UI (user action)

**Source:** `user_action`

**Payload:**

```
{
  recommendation_id: string
  recommendation_type: string
  contact_id: string | null
  dismiss_reason: string | null    // user-provided reason (optional)
}
```

**Awareness updates:**
- User Awareness: `recommendation_acceptance_rate` recalculated, update `approval_patterns.dismiss_types`
- Learned Intelligence: track dismissal patterns to improve future recommendations

**Current state:** CONFIRMED — NBS field update (audit Step 4).

---

### `nbs.overdue`

**Priority:** High

**Purpose:** A confirmed Next Best Step has not been acted on within its expected timeframe.

**Producer:** Scheduled computation (daily check)

**Source:** `platform`

**Payload:**

```
{
  recommendation_id: string
  contact_id: string
  days_overdue: number
  original_due_at: timestamp
}
```

**Awareness updates:**
- Business Awareness: `nbs_overdue_count` += 1
- Relationship Awareness: negative signal for `momentum_direction`

**Current state:** Not currently detected (audit Step 4). PROPOSED.

---

### `session.started`

**Priority:** Low

**Purpose:** The user started a Barry conversation session.

**Producer:** Barry chat handler

**Source:** `user_action`

**Payload:**

```
{
  barry_session_key: string        // {entityType}:{entityId}:{sessionType}
  source_module: string            // metadata: scout | hunter | sniper | etc.
  entity_type: string | null
  entity_id: string | null
}
```

**Awareness updates:**
- User Awareness: `sessions_per_day` recalculated, `peak_activity_hours` updated

---

### `session.closed`

**Priority:** Low

**Purpose:** A Barry conversation session was closed (explicitly or via inactivity timeout).

**Producer:** Barry chat handler

**Source:** `platform`

**Payload:**

```
{
  barry_session_key: string
  duration_minutes: number
  message_count: number
  close_reason: string             // user_explicit | inactivity_timeout
  candidate_facts_count: number    // how many candidate facts the promotion pipeline identified
}
```

**Awareness updates:**
- User Awareness: `avg_session_duration_minutes` recalculated

---

## Barry Action Signals

These signals close the loop. They are produced by Executed Actions (Document 2, Executed Action object).

### `action.completed`

**Priority:** High

**Purpose:** An Executed Action completed successfully. This is the signal that closes the Barry OS loop.

**Producer:** Action Executor

**Source:** `barry_action`

**Payload:**

```
{
  executed_action_id: string
  prepared_action_id: string
  recommendation_id: string
  action_type: string              // send_email | send_linkedin | create_meeting | generate_brief | etc.
  capability_id: string
  entity_type: string
  entity_id: string
  result: {
    success: boolean
    output_type: string            // message_id | event_id | artifact_id | etc.
    output_id: string | null
  }
}
```

**Awareness updates:**
- Relationship Awareness: action-specific updates (email sent → same as `contact.email_sent`)
- Mission Awareness: if action is mission-related, update progress
- User Awareness: action completion patterns

**Loop closure:** This signal is consumed by the Observation pipeline → produces Observations → updates Awareness → feeds Think Layer → produces next Recommendation. This is the closed loop defined in Document 2.

---

### `action.failed`

**Priority:** High

**Purpose:** An Executed Action failed. May trigger a retry signal.

**Producer:** Action Executor

**Source:** `barry_action`

**Payload:**

```
{
  executed_action_id: string
  prepared_action_id: string
  recommendation_id: string
  action_type: string
  capability_id: string
  error: {
    type: string                   // timeout | auth_failure | delivery_failure | rate_limit
    message: string
    retryable: boolean
  }
  retry_count: number
}
```

**Awareness updates:**
- Capability health tracking (not an Awareness projection — operational)

---

### `action.verified`

**Priority:** Medium

**Purpose:** A completed Executed Action was verified — the outcome was confirmed (delivery receipt received, calendar event confirmed, etc.).

**Producer:** Action Executor (delayed verification)

**Source:** `barry_action`

**Payload:**

```
{
  executed_action_id: string
  verification_type: string        // delivery_receipt | event_confirmed | artifact_generated
  verification_detail: object | null
  time_to_verify_seconds: number
}
```

**Awareness updates:**
- Learned Intelligence: verified outcomes feed strategy effectiveness tracking

---

## Enrichment Signals

### `enrichment.completed`

**Priority:** Medium

**Purpose:** An enrichment operation completed for a contact or company.

**Producer:** Apollo integration, enrichment pipeline

**Source:** `apollo`

**Payload:**

```
{
  enrichment_target_type: string   // contact | company
  enrichment_target_id: string
  enrichment_source: string        // apollo | linkedin
  fields_enriched: string[]
  enrichment_quality: string       // complete | partial | failed
}
```

**Awareness updates:**
- Business Awareness: enrichment pipeline metrics

---

## System Signals

### `warmth.changed`

**Priority:** Medium

**Purpose:** A contact's warmth level changed (computed by Relationship Awareness, not a canonical field). This signal is produced BY Awareness, not consumed by it — it notifies downstream systems that a warmth transition occurred.

**Producer:** Awareness Layer (Relationship Awareness projection)

**Source:** `platform`

**Payload:**

```
{
  contact_id: string
  previous_warmth: string          // cold | cool | warm | hot
  new_warmth: string
  change_direction: string         // warming | cooling
  contributing_signals: string[]   // signal_ids that contributed to the change
}
```

**Awareness updates:** None — this signal IS the awareness update notification. Consumed by Think Layer and surfaces.

**Current state:** CONFIRMED — warmth_level field + source tracking (audit Step 4).

---

### `system.daily_refresh`

**Priority:** Low

**Purpose:** Daily scheduled signal that triggers staleness checks and scheduled awareness recomputations.

**Producer:** Scheduled function (cron)

**Source:** `platform`

**Payload:**

```
{
  refresh_date: string             // YYYY-MM-DD
  workspace_id: string
}
```

**Awareness updates:**
- All projections: check staleness thresholds, trigger recomputation for stale projections
- Business Awareness: forced refresh (staleness threshold: 24 hours)
- Mission Awareness: forced refresh

---

## Signal Catalog Summary

| Signal Type | Priority | Source | Entity | Current State |
|---|---|---|---|---|
| `contact.reply_received` | Critical | gmail | contact | Poll-based |
| `contact.email_sent` | High | gmail | contact | CONFIRMED |
| `contact.email_opened` | Medium | platform | contact | CONFIRMED |
| `contact.email_bounced` | High | gmail | contact | PROPOSED |
| `contact.added` | Medium | platform | contact | CONFIRMED |
| `contact.enriched` | Medium | apollo | contact | CONFIRMED |
| `contact.archived` | Low | user_action | contact | CONFIRMED |
| `contact.restored` | Medium | user_action | contact | PROPOSED |
| `contact.merged` | Medium | platform | contact | PROPOSED |
| `company.discovered` | Medium | platform | company | CONFIRMED |
| `company.icp_evaluated` | Medium | platform | company | CONFIRMED (renamed) |
| `company.enriched` | Medium | apollo | company | CONFIRMED |
| `message.delivered` | Medium | gmail | message | PROPOSED |
| `message.bounced` | High | gmail | message | PROPOSED |
| `meeting.today` | Critical | calendar | meeting | CONFIRMED (pull-based) |
| `meeting.created` | Medium | calendar | meeting | Partial |
| `meeting.completed` | High | calendar | meeting | PROPOSED |
| `mission.created` | Medium | platform | mission | CONFIRMED |
| `mission.step_completed` | High | platform | mission | CONFIRMED |
| `mission.deadline_approaching` | High | platform | mission | PROPOSED |
| `mission.completed` | High | platform | mission | PROPOSED |
| `campaign.launched` | Medium | platform | campaign | PROPOSED |
| `campaign.step_completed` | Medium | platform | campaign | CONFIRMED |
| `campaign.completed` | Medium | platform | campaign | PROPOSED |
| `nbs.confirmed` | High | user_action | user | CONFIRMED |
| `nbs.dismissed` | High | user_action | user | CONFIRMED |
| `nbs.overdue` | High | platform | user | PROPOSED |
| `session.started` | Low | user_action | user | CONFIRMED |
| `session.closed` | Low | platform | user | CONFIRMED |
| `action.completed` | High | barry_action | * | PROPOSED |
| `action.failed` | High | barry_action | * | PROPOSED |
| `action.verified` | Medium | barry_action | * | PROPOSED |
| `enrichment.completed` | Medium | apollo | * | CONFIRMED |
| `warmth.changed` | Medium | platform | contact | CONFIRMED |
| `system.daily_refresh` | Low | platform | user | PROPOSED |

---

# Part IV: Observation Pipeline

---

## Pipeline Contract

The Observation pipeline is the deterministic processing step between Signal and Awareness (Document 1, Section 4.4; Document 2, Observation object). It interprets raw signals into structured, normalized observations that Awareness projections can aggregate.

```
Signal (raw fact)
   ↓ deterministic processing (no AI)
Observation (structured interpretation)
   ↓ projection update
Awareness (aggregate state)
```

**Critical rule:** The Observation pipeline is deterministic. Given the same Signal, it MUST produce the same Observations. No AI calls, no probabilistic reasoning, no external data fetches. The pipeline reads the Signal payload and the current Awareness state, then computes structured facts.

## Observation Persistence

```
[PROPOSED — persisted Observation trace; architecture approved in Document 3, implementation absent today]

Observation records are persisted at users/{uid}/observations/{observationId}
for auditability and replay support. Observation remains a processing step,
not an architectural object layer.

Justification:
  (a) Awareness checkpoint replay requires knowing which observations
      have been applied since the last checkpoint
  (b) The reasoning trace requires knowing what observations fed each
      awareness update
  (c) Debugging awareness state requires inspecting the observation
      history

Document 5 schedules the implementation.
```

## Pipeline Processing Rules

1. **One Signal produces one or more Observations.** A `contact.reply_received` signal produces observations for reengagement, response latency, channel effectiveness, and sentiment.

2. **Observations are typed.** Each observation has an `observation_type` that determines which Awareness projections it updates:
   - `relationship_event` → Relationship Awareness
   - `business_event` → Business Awareness
   - `mission_event` → Mission Awareness
   - `user_behavior` → User Awareness

3. **Observations carry confidence.** Deterministic observations (reply received, email sent) have confidence 1.0. Computed observations (response latency, warmth inference) carry the confidence of their computation.

4. **Observations target specific projections.** The `awareness_targets` field lists which projections this observation updates. The Awareness Layer reads this field to know which projections to recompute.

5. **Observations are idempotent.** Processing the same signal twice produces the same observations. The pipeline checks whether an observation for this `signal_id` already exists before writing.

## Pipeline Stages

```
STAGE 1: VALIDATION
   Signal passes envelope validation
   Signal type is registered in catalog
   ↓

STAGE 2: ENRICHMENT
   Pipeline reads current Awareness state for the entity
   Pipeline reads current canonical data for the entity (Contact, Company, etc.)
   No external calls — only Firestore reads
   ↓

STAGE 3: OBSERVATION GENERATION
   Apply signal-type-specific observation rules (deterministic)
   Produce structured observation facts
   ↓

STAGE 4: OBSERVATION PERSISTENCE
   Write observation document to users/{uid}/observations/{observationId}
   Set lifecycle_state: 'created'
   ↓

STAGE 5: AWARENESS UPDATE
   Apply observations to target Awareness projections
   Update projection fields
   Set observation lifecycle_state: 'applied'
   Set signal lifecycle_state: 'observed'
   ↓

STAGE 6: COMPLETION
   Mark signal as 'processed' (all downstream updates complete)
   Check if any Awareness projection transitioned to 'stale' → trigger recomputation
   ↓

STAGE 7: DOWNSTREAM NOTIFICATION
   If warmth level changed → produce warmth.changed signal
   If staleness cleared → no additional signal
   Observation pipeline never produces Recommendations — that is the Think Layer's job
```

## Observation-to-Awareness Mapping

| Signal Type | Observation Type | Awareness Target(s) |
|---|---|---|
| `contact.reply_received` | `relationship_event` | Relationship, Business |
| `contact.email_sent` | `relationship_event` | Relationship, Business |
| `contact.email_opened` | `relationship_event` | Relationship |
| `contact.email_bounced` | `relationship_event` | Relationship, Business |
| `contact.added` | `business_event` | Business, Relationship (init) |
| `contact.enriched` | `business_event` | Business |
| `contact.archived` | `relationship_event` | Relationship (freeze), Business |
| `company.discovered` | `business_event` | Business |
| `company.icp_evaluated` | `business_event` | Business |
| `meeting.today` | `relationship_event` | Relationship, Business, Mission |
| `meeting.completed` | `relationship_event` | Relationship, Business |
| `mission.step_completed` | `mission_event` | Mission, Relationship |
| `mission.deadline_approaching` | `mission_event` | Mission |
| `mission.completed` | `mission_event` | Mission, Business |
| `campaign.step_completed` | `mission_event` | Mission |
| `nbs.confirmed` | `user_behavior` | User, Relationship |
| `nbs.dismissed` | `user_behavior` | User |
| `nbs.overdue` | `relationship_event` | Business, Relationship |
| `session.started` | `user_behavior` | User |
| `session.closed` | `user_behavior` | User |
| `action.completed` | `relationship_event` | Relationship, Mission, User |
| `action.failed` | (operational) | (capability health — not Awareness) |
| `action.verified` | `relationship_event` | Learned Intelligence |
| `warmth.changed` | (notification) | (none — produced by Awareness) |
| `system.daily_refresh` | (system) | All (staleness check) |

---

# Part V: Awareness Checkpoint and Replay

---

## The Problem (Document 2, Correction 5)

Document 2 states:
- Signals are retained for a 90-day rolling window
- Awareness projections must be rebuildable

These are compatible only if Awareness is NOT rebuilt from raw signal replay alone. A Relationship Awareness projection may represent years of relationship history. Signals older than 90 days are archived — replaying surviving signals cannot reproduce the full awareness state.

## The Solution: Checkpoint + Delta Replay

Awareness projections are rebuilt from **the latest validated checkpoint plus retained Signals and Observations since that checkpoint.**

```
                    CHECKPOINT                    NOW
                       │                           │
  ─────────────────────┼───────────────────────────┼──►
                       │                           │
  Signals expired ◄────│  Signals retained  ────►  │
  (archived to cold)   │  (90-day window)          │
                       │                           │
  Checkpoint captures  │  Delta replay applies     │
  full projection      │  observations since       │
  state at this point  │  checkpoint               │
```

## Checkpoint Specification

### What is a checkpoint?

A checkpoint is a validated snapshot of an Awareness projection's complete state at a specific point in time. It captures every computed field, the `last_observation_id` that was applied, and a validation hash.

### Checkpoint schema

```
AwarenessCheckpoint {
  checkpoint_id: string
  workspace_id: string
  projection_type: string          // relationship | business | mission | user
  entity_id: string | null         // contactId for relationship, null for workspace-wide

  // State snapshot
  projection_snapshot: object      // full copy of all projection fields at checkpoint time

  // Replay cursor
  last_observation_id: string      // the most recent observation applied before checkpoint
  last_observation_at: timestamp   // when that observation was created
  last_signal_id: string           // the signal that produced the last observation

  // Validation
  validation_hash: string          // SHA-256 of projection_snapshot (for integrity check)
  validated_at: timestamp          // when this checkpoint was validated

  // Metadata
  checkpoint_reason: string        // scheduled | manual | pre_archive | corruption_recovery
  created_at: timestamp
  expires_at: timestamp | null     // null = retained indefinitely
}
```

### Storage

`users/{uid}/barry_awareness/{projection_type}/checkpoints/{checkpointId}`

For relationship projections: `users/{uid}/contacts/{contactId}/barry_awareness/relationship/checkpoints/{checkpointId}`

### Checkpoint schedule

| Projection | Checkpoint Frequency | Retention |
|---|---|---|
| Relationship Awareness | Every 30 days OR on warmth level change | Latest 3 checkpoints retained |
| Business Awareness | Every 7 days (weekly) | Latest 4 checkpoints retained |
| Mission Awareness | Every 7 days AND on mission completion | Latest 4 checkpoints retained |
| User Awareness | Every 30 days | Latest 3 checkpoints retained |

### Checkpoint triggers

| Trigger | When |
|---|---|
| **Scheduled** | Checkpoint frequency elapsed since last checkpoint |
| **Warmth transition** | Relationship Awareness `warmth_level` changes (significant state change worth preserving) |
| **Mission lifecycle** | Mission reaches `completed` or `abandoned` (capture final mission state) |
| **Pre-archive** | Before signal archive runs (ensure checkpoint exists before signals expire) |
| **Manual** | Operator-triggered for debugging or recovery |

### Pre-archive checkpoint rule

**Before the daily signal archive job deletes signals older than 90 days, it MUST verify that every Awareness projection has a checkpoint newer than the oldest retained signal.** If any projection lacks a recent enough checkpoint, the archive job creates one before proceeding. This guarantees that no projection becomes unreplayable.

```
Signal archive job:
  1. Identify signals older than 90 days
  2. For each affected entity:
     a. Check: does a checkpoint exist with last_observation_at > (now - 90 days)?
     b. If NO → create checkpoint NOW, then archive
     c. If YES → archive
  3. Archive signals to cold storage
  4. Archive observations to cold storage (same 90-day window)
```

## Replay Specification

### When replay happens

1. **Corruption recovery** — an Awareness projection's data is corrupted or inconsistent
2. **Schema migration** — a projection's field schema changes and values must be recomputed
3. **Audit verification** — verify that a projection's current state is consistent with its observation history

### Replay procedure

```
REPLAY PROCEDURE:

1. Load the latest validated checkpoint for this projection
2. Verify checkpoint integrity (recompute validation_hash, compare)
3. Query all observations since checkpoint:
   WHERE workspace_id = {uid}
   AND entity_id = {entityId}       (for relationship projections)
   AND observation_type IN {projection's types}
   AND created_at > checkpoint.last_observation_at
   ORDER BY created_at ASC
4. Apply each observation to the checkpoint state IN ORDER
5. Result is the current projection state
6. Compare with existing projection state
7. If different → update projection, log discrepancy
8. Create new checkpoint at current state
```

### Replay guarantees

- **Deterministic:** Same checkpoint + same observations = same result. Always.
- **Ordered:** Observations applied in `created_at` order. Ties broken by `observation_id`.
- **Bounded:** Replay only needs observations since the last checkpoint — not the full history.
- **Auditable:** Replay logs every step: checkpoint loaded, observations applied, discrepancies found.

### Cold storage and replay

Signals and observations older than 90 days are archived to cold storage (implementation: DEFERRED to Document 5). Cold storage entries are:
- Readable for audit purposes
- Not required for replay (checkpoints cover the gap)
- Queryable for Learned Intelligence aggregation (cross-entity patterns)

---

# Part VI: Retention Policy

---

## Retention Summary

| Object | Retention Window | Archive Behavior | Checkpoint Required |
|---|---|---|---|
| Signal | 90-day rolling window | Archived to cold storage | Pre-archive checkpoint for affected projections |
| Observation | 90-day rolling window (same as Signal) | Archived to cold storage | Same pre-archive rule |
| Awareness Projection | Indefinite (current state only) | Frozen when parent entity archived | Latest 3-4 checkpoints retained |
| Awareness Checkpoint | Per schedule (latest 3-4 retained) | Older checkpoints deleted | N/A |

## Signal Archive Process

```
DAILY ARCHIVE JOB (runs once per day, off-peak):

1. Query signals WHERE expires_at < NOW()
2. Group by workspace_id and entity_id
3. For each group:
   a. Run pre-archive checkpoint rule (see above)
   b. Copy signal documents to cold storage collection
   c. Delete from active signal collection
4. Query observations WHERE expires_at < NOW()
5. Copy to cold storage, delete from active collection
6. Log archive summary: signals_archived, observations_archived, checkpoints_created
```

## Cold Storage Path

```
cold_storage/signals/{workspace_id}/{year}/{month}/{signalId}
cold_storage/observations/{workspace_id}/{year}/{month}/{observationId}
```

Cold storage is append-only, read-only (no updates), and partitioned by month for efficient querying by Learned Intelligence.

---

# Part VII: Signal Producer Contract

---

## What Producers Must Do

Any module or integration that wants Barry to know about an event writes a Signal document. The producer is responsible for the envelope — Barry never parses raw integration data.

### Producer responsibilities

1. **Create a valid signal envelope** with all required fields
2. **Set `signal_type`** to a registered type from the catalog
3. **Set `entity_type` and `entity_id`** to the correct entity
4. **Set `source`** to identify the producing system
5. **Set `occurred_at`** to when the event actually happened (not when the producer runs)
6. **Set `payload`** conforming to the schema for the declared signal type
7. **Provide `idempotency_key`** for events that may be detected multiple times (poll-based sources)

### Producer rules

1. **One event = one signal.** Don't batch multiple events into one signal.
2. **Use `occurred_at` not `received_at`.** If a Gmail reply arrived at 2am but the poll runs at 3am, `occurred_at` is 2am.
3. **Idempotency for poll-based sources.** Gmail polling may detect the same reply multiple times. Use `idempotency_key` = `{source}:{external_id}` (e.g., `gmail:{messageId}`) to prevent duplicates.
4. **Don't interpret.** The producer writes facts. Interpretation is the Observation pipeline's job. A Gmail producer writes "reply received with this snippet" — it does not compute sentiment or warmth.
5. **Workspace scoping.** Every signal includes `workspace_id`. Producers must never write signals across workspace boundaries.

### Current producers and their migration

| Current System | Current Behavior | Target Signal(s) | Status |
|---|---|---|---|
| `gmail-poll-replies` | Polls Gmail, writes to `barry_processing_queue` | `contact.reply_received` | CONFIRMED |
| `gmail-send` / `barry-approve-send` | Sends email, records in contact timeline | `contact.email_sent` | CONFIRMED |
| `track-open` | Records email open event | `contact.email_opened` | CONFIRMED |
| `search-companies` | Creates company record | `company.discovered` | CONFIRMED |
| `score-icp-fit` | Evaluates company ICP | `company.icp_evaluated` | PROPOSED — file does not exist in repository |
| `calendar-list-events` | Polls calendar for today's events | `meeting.today` | CONFIRMED |
| NBS UI actions | Updates `next_best_step` field | `nbs.confirmed`, `nbs.dismissed` | CONFIRMED |
| Mission step completion | Updates mission step status | `mission.step_completed` | CONFIRMED |
| Contact creation | Creates contact document | `contact.added` | CONFIRMED |
| Enrichment pipeline | Enriches contact/company data | `contact.enriched`, `company.enriched` | CONFIRMED |
| Barry chat handler | Starts/closes conversations | `session.started`, `session.closed` | CONFIRMED |
| Action Executor | Executes approved actions | `action.completed`, `action.failed`, `action.verified` | CONFIRMED |

---

# Part VIII: Signal Consumer Contract

---

## Who Consumes Signals

The primary consumer is the Observation pipeline. Other systems may read signals for audit and debugging but do not process them.

| Consumer | What It Reads | Why |
|---|---|---|
| **Observation pipeline** | All signals in `received` state | Primary consumer — processes signals into observations |
| **Audit surfaces** | All signals (any state) | Debugging, compliance, reasoning trace |
| **Learned Intelligence** | Cold storage signals | Cross-entity pattern aggregation |
| **Context Resolver** | Recent signals (current window) | Includes recent signal summary in Think Layer context |

## Consumer rules

1. **Only the Observation pipeline advances signal lifecycle state.** No other consumer modifies `lifecycle_state`.
2. **Consumers read signals — they never delete them.** Deletion is only performed by the archive job.
3. **The Observation pipeline processes signals in order.** Consumers that read signals for context do not need ordering guarantees.
4. **Workspace boundary is enforced.** Consumers only read signals within their workspace.

---

# Part IX: The Closed Loop — Signal Flow

---

This section traces the complete closed loop from Document 2, showing how signals flow through the system.

```
┌──────────────────────────────────────────────────────────────────┐
│                        THE CLOSED LOOP                            │
│                                                                  │
│  EXECUTED ACTION                                                 │
│       │                                                          │
│       │ produces                                                 │
│       ▼                                                          │
│  SIGNAL (action.completed)                                       │
│       │                                                          │
│       │ consumed by                                              │
│       ▼                                                          │
│  OBSERVATION PIPELINE                                            │
│       │ Stage 1: Validate signal                                 │
│       │ Stage 2: Read current awareness + entity data            │
│       │ Stage 3: Generate observations (deterministic)           │
│       │ Stage 4: Persist observations                            │
│       │ Stage 5: Update awareness projections                    │
│       │                                                          │
│       ▼                                                          │
│  AWARENESS (4 projections updated)                               │
│       │                                                          │
│       │ read by                                                  │
│       ▼                                                          │
│  CONTEXT RESOLVER                                                │
│       │ packages awareness + memory + entity data                │
│       │ for a specific operation                                 │
│       │                                                          │
│       ▼                                                          │
│  THINK LAYER                                                     │
│       │ synthesizes, compares, chooses strategy                  │
│       │ produces explainable reasoning trace                     │
│       │                                                          │
│       ▼                                                          │
│  RECOMMENDATION (proposed → presented → approved)                │
│       │                                                          │
│       │ creates (on approval)                                    │
│       ▼                                                          │
│  PREPARED ACTION (drafted → ready_for_review → approved)         │
│       │                                                          │
│       │ authorizes (on approval)                                 │
│       ▼                                                          │
│  EXECUTED ACTION  ↺                                              │
│       │                                                          │
│       │ produces → SIGNAL (action.completed)                     │
│       │                                                          │
│       └──────────────────────────────────────────────────────────┘
```

### Entry points into the loop

The loop is self-sustaining once running. But signals enter from outside Barry OS too:

```
EXTERNAL SIGNALS (enter the loop):
  Gmail polling        → contact.reply_received
  Calendar polling     → meeting.today
  Apollo enrichment    → contact.enriched, company.enriched
  User actions in UI   → nbs.confirmed, nbs.dismissed, contact.added
  Platform events      → mission.step_completed, contact.archived
  Scheduled jobs       → system.daily_refresh, nbs.overdue, mission.deadline_approaching

INTERNAL SIGNALS (sustain the loop):
  Action Executor      → action.completed, action.failed, action.verified
  Awareness Layer      → warmth.changed
  Session handler      → session.started, session.closed
```

### Signal volume estimate

| Signal Category | Estimated Daily Volume (per workspace) | Notes |
|---|---|---|
| Contact signals | 10-50 | Depends on active outreach volume |
| Meeting signals | 1-5 | Calendar events per day |
| Mission signals | 5-20 | Active campaigns and step completion |
| User action signals | 5-15 | NBS confirmations, session starts |
| Barry action signals | 5-30 | Depends on approval volume |
| System signals | 1-3 | Daily refresh + scheduled checks |
| **Total** | **27-123** | Small-volume, high-value signals |

At these volumes, Firestore document writes are well within limits. No sharding or partitioning needed at launch.

---

# Part X: Error Handling and Recovery

---

## Signal Processing Errors

| Error | Handling | Recovery |
|---|---|---|
| **Invalid signal** | Signal marked `invalid` with reason. Not retried. | Producer fixes and republishes. |
| **Observation pipeline failure** | Signal stays in `received` state. Pipeline retries on next run. | Pipeline is idempotent — safe to retry. |
| **Awareness update failure** | Observation stays in `created` state. Retry on next pipeline run. | Pipeline checks for unapplied observations and retries. |
| **Checkpoint creation failure** | Archive job pauses for this entity. Retries next run. | Pre-archive rule prevents data loss. |
| **Replay discrepancy** | Logged as warning. Current projection updated to replayed state. New checkpoint created. | Discrepancy logged for investigation. |

## Dead Letter Queue

Signals that fail validation 3 times (across retries) are moved to a dead letter collection:

```
users/{uid}/signals_dead_letter/{signalId}
```

Dead letter signals are retained for 30 days for debugging. They do not count toward the 90-day retention window.

## Pipeline Health Monitoring

| Metric | Threshold | Alert |
|---|---|---|
| Signals in `received` state > 1 hour old | > 0 for Critical priority | Pipeline stalled |
| Signals in `received` state > 6 hours old | > 0 for any priority | Pipeline severely behind |
| Invalid signal rate | > 5% of received signals | Producer bug |
| Observation pipeline latency (received → processed) | > SLA for priority level | Performance degradation |
| Checkpoint staleness | > 2x checkpoint frequency | Checkpoint job failing |

---

## Document Status

| Field | Value |
|---|---|
| **Discovery source** | `docs/audits/BARRY_OS_FOUNDATION_AUDIT.md` (commit `09e90f9`) |
| **Discovery authority** | `docs/audits/BARRY_OS_AUDIT_RECONCILIATION.md` |
| **Architecture source** | `docs/barry-os/architecture/BARRY_OS_REFERENCE_ARCHITECTURE.md` (Document 1 — frozen) |
| **Domain model** | `docs/barry-os/architecture/BARRY_OS_DOMAIN_LIFECYCLE_MODEL.md` (Document 2 — FROZEN 2026-08-08) |
| **Architecture status** | APPROVED / FROZEN — 2026-08-08. Team A evidence review complete. Four corrections applied: (1) `contact.email_bounced` CONFIRMED→PROPOSED, (2) `message.bounced` CONFIRMED→PROPOSED, (3) `score-icp-fit` producer marked PROPOSED, (4) Observation persistence label corrected — architecture approved, implementation absent. |
| **Approved by** | Aaron Wiley — 2026-08-08 |
| **Supersedes** | None |
| **Superseded by** | None (this is the canonical signal specification) |
| **Frozen** | Yes — 2026-08-08 |

## Freeze Declaration

Document 3 is APPROVED and FROZEN as of 2026-08-08.

No further changes except factual corrections that directly invalidate an approved
statement. Any such correction requires Aaron's explicit approval before modification.

It may not be modified to:
- Add new signal types without Aaron's approval
- Redefine the Observation pipeline semantics established here
- Change the checkpoint mechanism in ways that contradict Document 2's retention rules
- Incorporate new ideas discovered during Documents 4–5

All future signal references in Documents 4 and 5 derive from this document. They do not redefine signal contracts.

---

*No code was written or changed during this document. This is an architecture specification only.*
