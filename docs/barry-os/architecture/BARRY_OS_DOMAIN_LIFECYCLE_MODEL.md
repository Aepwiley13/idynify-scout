# Barry OS Canonical Domain & Lifecycle Model

**Idynify · Document 2 of 5 · Team B**
**Date: 2026-08-08**
**Repository: aepwiley13/idynify-scout**
**Source of Truth: docs/audits/BARRY_OS_AUDIT_RECONCILIATION.md (reconciliation — wins over everything)**
**Canonical Audit: docs/audits/BARRY_OS_FOUNDATION_AUDIT.md**
**Architecture: docs/barry-os/architecture/BARRY_OS_REFERENCE_ARCHITECTURE.md (Document 1 — frozen)**

---

## Governance

This document defines every canonical Barry OS object. Documents 3, 4, and 5 derive from it.

```
Constitutional Brief        ← historical intent
        ↓
Canonical Audit             ← repository evidence
        ↓
Reconciliation Addendum     ← final discovery truth
        ↓
Reference Architecture      ← Document 1 — system design (frozen)
        ↓
Domain & Lifecycle Model    ← THIS DOCUMENT — object definitions
        ↓
Signal Specification        ← event contracts
        ↓
Capability Contracts        ← Skills, Workflows, Actions
        ↓
Implementation Plan         ← build order
```

This document's specific job is to prevent the next `contact_status` / `lead_status` / `relationship_state` / `conversationState` proliferation. The future state model is defined here first. Existing fields map onto it — this document does not inherit them.

---

## Two-Axis Classification System

Every object in Barry OS is classified on two independent axes.

### Axis 1 — Authority

| Authority | Definition |
|---|---|
| **Canonical** | The authoritative business record. Platform-owned. Barry reads, never writes. |
| **Derived** | Computed knowledge built from Canonical objects and Signals. Barry-owned. Rebuildable from the latest validated projection checkpoint plus retained Signals and Observations since that checkpoint (Document 3 defines checkpoint, replay, and retention mechanics). |
| **Operational** | System execution and history objects used to coordinate or audit Barry's actions. |

### Axis 2 — Persistence

| Persistence | Definition |
|---|---|
| **Durable** | Retained indefinitely or until explicitly superseded. Requires a migration path. |
| **Bounded** | Retained for a defined window, then discarded or archived. |
| **Ephemeral** | Transient. Reaches a terminal state and is done. |

### Object Classification Reference

| Object | Authority | Persistence |
|---|---|---|
| Contact | Canonical | Durable |
| Company | Canonical | Durable |
| Relationship | Canonical | Durable |
| Mission | Canonical | Durable |
| Campaign | Canonical | Durable |
| Cadence | Canonical | Durable |
| Message | Canonical | Durable |
| Signal | Operational | Bounded |
| Observation | Operational | Bounded |
| Awareness (4 projections) | Derived | Durable (rebuildable projection) |
| Recommendation | Derived | Ephemeral |
| Prepared Action | Operational | Ephemeral |
| Executed Action | Operational | Durable (audit) |
| Conversation | Operational | Bounded |
| Artifact | Derived | Durable (versioned) |
| Memory | Derived | Durable / Bounded by type |
| Skill | Operational | Durable |
| Workflow | Operational | Durable |
| Capability | Operational | Durable |

---

## Complete Ownership Matrix

| Object | Authority | Owner | Barry may read | Barry may write |
|---|---|---|---|---|
| Contact | Canonical | Platform | Yes | No |
| Company | Canonical | Platform | Yes | No |
| Relationship | Canonical | Platform | Yes | No |
| Mission | Canonical | Platform | Yes | No |
| Campaign | Canonical | Platform | Yes | No |
| Cadence | Canonical | Platform | Yes | No |
| Message | Canonical | Platform | Yes | No |
| Signal | Operational | Platform | Yes | No (publishers only) |
| Observation | Operational | Barry | Yes | Yes (processing step output) |
| Awareness | Derived | Barry | Yes | Yes |
| Relationship Awareness | Derived | Barry | Yes | Yes |
| Relationship Memory | Derived | Barry | Yes | Yes (via promotion pipeline only) |
| Recommendation | Derived | Barry | Yes | Yes |
| Prepared Action | Operational | Barry | Yes | Yes |
| Executed Action | Operational | Barry | Yes | Yes (write-once) |
| Conversation | Operational | Barry | Yes | Yes |
| Artifact | Derived | Barry | Yes | Yes |
| Memory (all types) | Derived | Barry | Yes | Yes (via promotion pipeline only) |
| Skill | Operational | Barry | Yes | Yes (registry only) |
| Workflow | Operational | Barry | Yes | Yes (registry only) |
| Capability | Operational | Barry | Yes | Yes (registry only) |

---

## Required Structure

Every object definition follows this structure:

```
1. Purpose          — one sentence
2. Authority        — Canonical | Derived | Operational
3. Persistence      — Durable | Bounded | Ephemeral
4. Owner            — Platform or Barry
5. Storage          — exact Firestore path
6. Who may read     — which systems and surfaces
7. Who may write    — which systems
8. Lifecycle states — named states with a state machine diagram
9. Transitions      — what events cause each state change
10. Illegal transitions — what must never happen
11. Relationships   — what other objects this connects to
12. Retention rule  — how long it lives and what expires it
13. Fields          — the actual schema
```

---

# Part I: Platform-Owned Objects (Canonical)

---

## Contact

**1. Purpose:** A canonical person record representing an individual in the user's business network.

**2. Authority:** Canonical

**3. Persistence:** Durable

**4. Owner:** Platform

**5. Storage:** `users/{uid}/contacts/{contactId}`

**6. Who may read:** All Barry surfaces, all module UIs, Context Resolver, Awareness Layer, Think Layer, Skills

**7. Who may write:** Platform (user actions, integrations, enrichment pipelines). Barry may NOT write to this document — Barry's knowledge about a contact lives in Relationship Awareness and Relationship Memory, not on the Contact record.

**8. Lifecycle states:**

```
active
   ├── archived (terminal — user explicitly archives)
   └── merged   (terminal — duplicate resolved)
```

Contact lifecycle tracks record-state facts only — not engagement or qualification. Concepts previously modeled as lifecycle states migrate as follows:

- `qualified` → ICP evaluation result stored as fields on the Contact record (`icp_qualified`, `icp_score`), set by ScoreICPFitSkill
- `engaged` / `active` (as engagement) / `dormant` → `RelationshipAwareness.engagement_status` (Derived, Barry-owned)
- `rejected` → ICP evaluation decision: `icp_qualified: false` on the Contact record

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| active | archived | User explicitly archives |
| active | merged | Duplicate resolution merges this record into another |

**10. Illegal transitions:**

- `archived → active` — archived contacts must be explicitly restored through a user action that creates a `contact.restored` signal, producing a new `active` record
- `merged → active` — a merged contact cannot be unmerged; the surviving record is the canonical one

**11. Relationships:**

- Belongs to one Company (optional)
- Has one Relationship (Canonical)
- Has one Relationship Awareness (Derived, Barry-owned)
- Has one Relationship Memory (Derived, Barry-owned)
- Participates in zero or more Missions (via Campaign membership)
- Subject of zero or more Signals
- Subject of zero or more Messages

**12. Retention rule:** Indefinite. Archived contacts are retained but excluded from active queries and awareness computations.

**13. Fields:**

```
Contact {
  contact_id: string
  workspace_id: string                   // userId
  
  // Identity
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  linkedin_url: string | null
  title: string | null
  
  // Affiliation
  company_id: string | null
  company_name: string | null
  
  // Platform lifecycle (record-state facts only)
  lifecycle_state: string                // active | archived | merged
  lifecycle_changed_at: timestamp
  merged_into: string | null             // contactId of surviving record (set when merged)
  
  // ICP evaluation (fact about scoring, not engagement state)
  icp_qualified: boolean | null          // set by ScoreICPFitSkill
  icp_score: number | null              // 1-10
  icp_evaluated_at: timestamp | null
  
  // Enrichment
  enrichment_status: string | null       // pending | complete | failed | not_requested
  enrichment_provenance: object | null   // source, enriched_at, fields_enriched[]
  
  // Platform metadata
  source: string                         // apollo | linkedin | manual | import
  created_at: timestamp
  updated_at: timestamp
  archived_at: timestamp | null
  
  // Existing fields mapping:
  //   contact_status    → lifecycle_state (simplified to record-state only)
  //   lead_status       → RETIRED — engagement state migrated to RelationshipAwareness.engagement_status
  //   qualified         → icp_qualified + icp_score (fact about evaluation, not lifecycle state)
  //   engaged/active/dormant → RETIRED — migrated to RelationshipAwareness.engagement_status
  //   rejected          → icp_qualified: false (evaluation result, not lifecycle state)
  //   brigade_history[] → RETIRED (brigade is a UI concept, not a lifecycle state)
  //   barry_memory      → migrated to Relationship Memory (separate object)
  //   engage_state      → migrated to Relationship Awareness (separate object)
  //   engagement_summary → migrated to Relationship Awareness (separate object)
  //   next_best_step    → migrated to Recommendation (separate object)
  //   warmth_level      → migrated to Relationship Awareness (separate object)
}
```

---

## Company

**1. Purpose:** A canonical organization record representing a business entity the user may target or partner with.

**2. Authority:** Canonical

**3. Persistence:** Durable

**4. Owner:** Platform

**5. Storage:** `users/{uid}/companies/{companyId}`

**6. Who may read:** All Barry surfaces, Scout module, Context Resolver, Awareness Layer, Skills (ScoreICPFitSkill, ResearchCompanySkill)

**7. Who may write:** Platform (user actions, Scout discovery, Apollo enrichment). Barry may NOT write to this document. The existing `barry_intel` field on company documents (written by `search-companies.js` at line 991) is a confirmed violation (audit Step 9, reconciliation §9) and must be migrated to a Barry-owned CompanyIntelArtifact stored at `users/{uid}/barry_artifacts/{artifactId}` with `artifact_type: 'company_intel'`.

**8. Lifecycle states:**

```
active
   ├── archived (terminal — user explicitly archives)
   └── merged   (terminal — duplicate resolved)
```

Company lifecycle tracks record-state facts only. Three concepts previously mixed into one lifecycle are separated:

- **Record existence** (`active → archived / merged`) — the lifecycle above
- **ICP evaluation** — stored as fields on the Company record (`icp_evaluation_status`, `icp_decision`, `icp_score`, `icp_evaluated_at`)
- **Engagement state** (`targeted`, `engaged`, `active`, `dormant`) — belongs to Business Awareness and Relationship Awareness projections, not to the canonical Company record

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| active | archived | User explicitly archives |
| active | merged | Duplicate resolution merges this record into another |

**10. Illegal transitions:**

- `archived → active` — must be explicitly restored through a user action
- `merged → active` — a merged company cannot be unmerged; the surviving record is canonical

**11. Relationships:**

- Has zero or more Contacts
- Subject of zero or more Signals
- Participates in zero or more Missions (via its Contacts)
- Has zero or one Business Awareness contribution (aggregated)

**12. Retention rule:** Indefinite. Rejected companies retained for duplicate-detection. Archived companies excluded from active queries.

**13. Fields:**

```
Company {
  company_id: string
  workspace_id: string
  
  // Identity
  name: string
  domain: string | null
  industry: string | null
  location: string | null
  employee_count: number | null
  
  // Platform lifecycle (record-state facts only)
  lifecycle_state: string            // active | archived | merged
  lifecycle_changed_at: timestamp
  merged_into: string | null         // companyId of surviving record (set when merged)
  
  // ICP evaluation (facts about scoring, not engagement state)
  icp_evaluation_status: string      // not_evaluated | evaluated
  icp_decision: string | null        // pending | accepted | rejected
  icp_score: number | null           // 1-10 (from barryFeedback.score)
  icp_evaluated_at: timestamp | null
  
  // Enrichment
  enrichment_status: string | null
  enrichment_provenance: object | null
  
  // Platform metadata
  source: string                     // apollo | scout | manual | import
  created_at: timestamp
  updated_at: timestamp
  archived_at: timestamp | null
  
  // Existing fields mapping:
  //   status          → lifecycle_state (simplified to record-state only)
  //   barryFeedback   → icp_score + icp_evaluated_at + icp_decision
  //   barry_intel     → VIOLATION — migrate to Barry-owned CompanyIntelArtifact
  //                     (stored at users/{uid}/barry_artifacts/{artifactId} with artifact_type: 'company_intel')
  //   swipe_*         → icp_decision (acceptance/rejection is an evaluation result, not a lifecycle state)
  //   targeted/engaged/active/dormant → RETIRED — engagement state migrated to Business Awareness
  //                                     and Relationship Awareness projections
}
```

---

## Relationship

**1. Purpose:** The authoritative record of the business connection between the user and a Contact or Company — when it started, what category it is, and how it was established.

**2. Authority:** Canonical

**3. Persistence:** Durable

**4. Owner:** Platform

**5. Storage:** `users/{uid}/contacts/{contactId}/relationship`

**6. Who may read:** Barry (all layers), all module UIs, Context Resolver

**7. Who may write:** Platform only. Created when a meaningful interaction is first established with a Contact. Updated by explicit user actions (categorization, notes). Barry never writes here — Barry's understanding lives in Relationship Awareness (Derived) and Relationship Memory (Derived).

**8. Lifecycle states:**

```
initiated
   ↓ (first meaningful interaction — email sent, meeting booked, or reply received)
active
   ↓ (explicit user action or contact archived)
ended (terminal)
```

Relationship lifecycle tracks factual connection state only — not engagement quality or risk. Concepts previously modeled as lifecycle states migrate as follows:

- `developing` / `established` → Awareness interpretations of interaction count and quality, not canonical facts. Live in `RelationshipAwareness.engagement_status` and `RelationshipAwareness.health_score`.
- `at_risk` → Barry's derived interpretation of signal patterns. Lives in `RelationshipAwareness.risk_score` + `momentum_direction`.
- Staleness computation → `RelationshipAwareness.projection_state`
- Health score → `RelationshipAwareness.health_score`

The transition from `active` to `ended` is triggered by explicit user action only — not by signal patterns or staleness thresholds. Barry may *recommend* ending a relationship, but the canonical record only changes when the user acts.

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| initiated | active | First meaningful interaction (email sent, meeting booked, reply received) |
| active | ended | User explicitly ends relationship OR contact archived |

**10. Illegal transitions:**

- `ended → initiated` — an ended relationship cannot restart; a new relationship must be created
- `ended → active` — same; create a new Relationship record
- `active → initiated` — lifecycle does not regress

**11. Relationships:**

- Belongs to exactly one Contact
- Has exactly one Relationship Awareness (Barry-owned, Derived)
- Has exactly one Relationship Memory (Barry-owned, Derived)
- Produces Signals on state transitions

**12. Retention rule:** Indefinite. Ended relationships retained for historical reference.

**13. Fields:**

```
Relationship {
  relationship_id: string
  workspace_id: string
  contact_id: string
  company_id: string | null
  
  // Lifecycle (factual connection state only — not engagement quality or risk)
  lifecycle_state: string            // initiated | active | ended
  lifecycle_changed_at: timestamp
  
  // Facts (Platform-owned)
  category: string                   // prospect | client | partner | referral | vendor | personal
  channel_established: string        // email | linkedin | referral | cold_outreach | inbound | meeting
  established_at: timestamp | null   // when relationship reached 'established'
  
  // History
  initiated_at: timestamp
  ended_at: timestamp | null
  ended_reason: string | null        // user_action | contact_archived
  
  // Existing fields mapping:
  //   This is a NEW canonical object. Today, relationship facts are scattered across:
  //     engage_state.status         → lifecycle_state (simplified: initiated | active | ended)
  //     engage_state.current_goal   → NOT a relationship fact — migrates to Recommendation
  //     barry_memory.who_they_are   → migrates to Relationship Memory (Barry-owned)
  //     warmth_level                → migrates to Relationship Awareness (Barry-derived)
  //     developing/established      → RETIRED — migrated to RelationshipAwareness (engagement quality)
  //     at_risk                     → RETIRED — migrated to RelationshipAwareness.risk_score
  //     staleness threshold         → RETIRED — migrated to RelationshipAwareness.projection_state
}
```

**This object is distinct from Relationship Awareness and Relationship Memory.** Relationship stores facts the platform owns. Relationship Awareness stores Barry's derived understanding. Relationship Memory stores Barry's learned knowledge. Conflating them recreates the `engage_state` / `engagement_summary` / `relationship_context` / `barry_memory` fragmentation that exists today.

---

## Mission

**1. Purpose:** A named goal with a defined strategy, audience, and success criteria that organizes Barry's work toward a business outcome.

**2. Authority:** Canonical

**3. Persistence:** Durable

**4. Owner:** Platform

**5. Storage:** `users/{uid}/missions/{missionId}`

**6. Who may read:** Barry (all layers), Mission Control, Hunter module, Context Resolver, Think Layer

**7. Who may write:** Platform (user creates, updates, archives). Barry may NOT write to mission documents directly — Barry's understanding of mission state lives in Mission Awareness and Mission Memory.

**8. Lifecycle states:**

```
created
   ↓ (user defines strategy and audience)
active
   ├── paused (user-initiated hold)
   │      └── resumed → active
   ├── completed (terminal — success criteria met)
   └── abandoned (terminal — user cancels before completion)
```

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| created | active | User launches mission OR first campaign starts |
| active | paused | User explicitly pauses |
| paused | active | User resumes |
| active | completed | Success criteria met (all campaigns completed, goal achieved) |
| active | abandoned | User explicitly cancels |
| paused | abandoned | User explicitly cancels |

**10. Illegal transitions:**

- `completed → active` — a completed mission cannot reopen; start a new mission
- `abandoned → active` — an abandoned mission cannot be resumed; start a new mission
- `created → completed` — cannot complete without being active

**11. Relationships:**

- Contains zero or more Campaigns
- Targets zero or more Contacts (via Campaign membership)
- Has one Mission Awareness (Derived, Barry-owned)
- Has one Mission Memory (Derived, Barry-owned)
- Produces Signals on state transitions (`mission.created`, `mission.step_completed`, `mission.deadline_approaching`)

**12. Retention rule:** Indefinite. Completed and abandoned missions retained for historical analysis and Learned Intelligence.

**13. Fields:**

```
Mission {
  mission_id: string
  workspace_id: string
  
  // Definition
  name: string
  goal: string
  strategy: string | null
  success_criteria: string | null
  
  // Lifecycle
  lifecycle_state: string            // created | active | paused | completed | abandoned
  lifecycle_changed_at: timestamp
  
  // Scheduling
  start_date: timestamp | null
  target_end_date: timestamp | null
  completed_at: timestamp | null
  
  // Scope
  target_audience: object | null     // ICP criteria, filters
  contact_count: number              // contacts enrolled
  
  // Platform metadata
  created_at: timestamp
  updated_at: timestamp
}
```

---

## Campaign

**1. Purpose:** A structured outreach sequence within a Mission that defines the messaging strategy, audience segment, and step progression for reaching a set of contacts.

**2. Authority:** Canonical

**3. Persistence:** Durable

**4. Owner:** Platform

**5. Storage:** `users/{uid}/missions/{missionId}/campaigns/{campaignId}`

**6. Who may read:** Barry (Context Resolver, Think Layer, Skills), Hunter module, Mission Control

**7. Who may write:** Platform (user creates, updates). Barry may read campaign structure to inform strategy selection but does not modify campaigns.

**8. Lifecycle states:**

```
drafted
   ↓ (user approves campaign plan)
active
   ├── paused (user-initiated or mission paused)
   │      └── resumed → active
   ├── completed (terminal — all steps executed for all enrolled contacts)
   └── cancelled (terminal — user cancels mid-execution)
```

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| drafted | active | User launches campaign |
| active | paused | User pauses OR parent mission paused |
| paused | active | User resumes AND parent mission is active |
| active | completed | All cadences completed for all enrolled contacts |
| active | cancelled | User explicitly cancels |
| paused | cancelled | User explicitly cancels |

**10. Illegal transitions:**

- `completed → active` — a completed campaign cannot reopen
- `cancelled → active` — a cancelled campaign cannot resume; create a new campaign
- `drafted → completed` — must be activated first

**11. Relationships:**

- Belongs to exactly one Mission
- Contains one or more Cadences
- Enrolls zero or more Contacts
- Produces Signals on step completion (`campaign.step_completed`)

**12. Retention rule:** Indefinite. Retained with parent Mission.

**13. Fields:**

```
Campaign {
  campaign_id: string
  mission_id: string
  workspace_id: string
  
  // Definition
  name: string
  messaging_strategy: string | null
  template_id: string | null
  
  // Lifecycle
  lifecycle_state: string            // drafted | active | paused | completed | cancelled
  lifecycle_changed_at: timestamp
  
  // Scope
  enrolled_contacts: string[]        // contactId references
  
  // Progress
  steps_total: number
  steps_completed: number
  
  // Platform metadata
  created_at: timestamp
  updated_at: timestamp
}
```

---

## Cadence

**1. Purpose:** A timed touchpoint schedule within a Campaign that defines when and how individual contacts are contacted.

**2. Authority:** Canonical

**3. Persistence:** Durable

**4. Owner:** Platform

**5. Storage:** `users/{uid}/missions/{missionId}/campaigns/{campaignId}/cadences/{cadenceId}`

**6. Who may read:** Barry (Context Resolver, Skills — WriteEmailSkill, GenerateNextStepSkill), Hunter module

**7. Who may write:** Platform (user creates, system advances steps)

**8. Lifecycle states:**

```
scheduled
   ↓ (cadence window opens)
active
   ├── paused (parent campaign paused)
   │      └── resumed → active
   ├── completed (terminal — all touchpoints executed)
   └── expired (terminal — cadence window elapsed without completion)
```

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| scheduled | active | Current time reaches cadence start date |
| active | paused | Parent campaign paused |
| paused | active | Parent campaign resumed |
| active | completed | All touchpoints in this cadence executed |
| active | expired | Cadence window elapsed AND touchpoints remain unexecuted |

**10. Illegal transitions:**

- `completed → active` — a completed cadence cannot reopen
- `expired → active` — an expired cadence must be rescheduled as a new cadence
- `scheduled → completed` — must be active first

**11. Relationships:**

- Belongs to exactly one Campaign
- Targets one or more Contacts (inherited from parent Campaign enrollment)
- Produces Signals on touchpoint execution

**12. Retention rule:** Indefinite. Retained with parent Campaign.

**13. Fields:**

```
Cadence {
  cadence_id: string
  campaign_id: string
  mission_id: string
  workspace_id: string
  
  // Definition
  step_number: number
  action_type: string               // email | linkedin_message | call | meeting
  delay_days: number                 // days after previous cadence
  template_guidance: string | null
  
  // Lifecycle
  lifecycle_state: string            // scheduled | active | paused | completed | expired
  lifecycle_changed_at: timestamp
  
  // Window
  scheduled_at: timestamp
  expires_at: timestamp | null
  
  // Platform metadata
  created_at: timestamp
  updated_at: timestamp
}
```

---

## Message

**1. Purpose:** A communication artifact — email, LinkedIn message, or text — sent or received in the context of a business relationship. A Message is a canonical record of a communication that actually happened (or is authorized to happen). Barry-generated drafts are Prepared Actions until approved and sent.

**2. Authority:** Canonical

**3. Persistence:** Durable

**4. Owner:** Platform

**5. Storage:** `users/{uid}/contacts/{contactId}/messages/{messageId}`

**6. Who may read:** Barry (Context Resolver, Skills — AnalyzeReplySkill, WriteEmailSkill), all module UIs

**7. Who may write:** Platform (user sends, integration receives). Message records are created by the Executed Action on successful authorization — not by Barry's drafting process. The creation rule is: Prepared Action (approved) → Executed Action → Message (queued → sent → ...).

**8. Lifecycle states:**

**Outbound:**

```
queued
   ↓ (authorization received from Executed Action)
sent
   ↓ (delivery confirmed)
   delivered
      ├── opened (email tracking confirms open)
      │      └── replied (contact responds — produces contact.reply_received Signal)
      ├── bounced (terminal — invalid address)
      └── failed  (terminal — delivery error; produces retry Signal)
```

**Inbound:**

```
received (terminal — the fact of receipt)
```

A `contact.reply_received` Signal is produced when a message is received. The Observation pipeline handles interpretation — the canonical Message record does not track Barry's analysis of it.

`drafted` is NOT a Message state. A Barry-generated email draft is a Prepared Action until it is approved and sent. Only at the point of authorization does a canonical Message record get created.

`analyzed` and `processed` are NOT Message states. These describe Barry's processing of the message, not the message itself — they are Signal and Observation pipeline states.

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| queued | sent | Integration sends successfully |
| queued | failed | Integration returns error |
| sent | delivered | Delivery confirmation (where available) |
| delivered | opened | Open tracking pixel triggered |
| delivered | bounced | Bounce notification received |
| opened | replied | `contact.reply_received` Signal |

**10. Illegal transitions:**

- `sent → queued` — a sent message cannot be re-queued; create a new message
- `bounced → delivered` — a bounced message cannot be re-delivered
- `failed → sent` — a failed send must be retried as a new Executed Action with idempotency key
- `received → queued` — an inbound message cannot become outbound

**11. Relationships:**

- Belongs to one Contact
- May belong to one Campaign / Cadence
- Produces Signals on state transitions (`contact.email_sent`, `contact.reply_received`, `email.opened`, `email.bounced`)
- Outbound messages are created by an Executed Action (Prepared Action approved → Executed Action → Message created at `queued`)
- Inbound messages produce a `contact.reply_received` Signal on receipt

**12. Retention rule:** Indefinite. All messages retained for relationship history and Learned Intelligence.

**13. Fields:**

```
Message {
  message_id: string
  workspace_id: string
  contact_id: string
  
  // Classification
  direction: string                  // outbound | inbound
  channel: string                    // email | linkedin | text | call_note
  
  // Lifecycle (outbound: queued | sent | delivered | opened | replied | bounced | failed)
  //          (inbound: received)
  lifecycle_state: string            // queued | sent | delivered | opened | replied | bounced | failed | received
  lifecycle_changed_at: timestamp
  
  // Content
  subject: string | null
  body: string
  thread_id: string | null           // for email threading
  
  // Provenance
  campaign_id: string | null
  cadence_id: string | null
  executed_action_id: string | null  // if created by an Executed Action (Barry-authored messages)
  skill_id: string | null            // which Skill generated content (via Prepared Action chain)
  
  // Delivery
  sent_at: timestamp | null
  delivered_at: timestamp | null
  opened_at: timestamp | null
  replied_at: timestamp | null
  bounced_at: timestamp | null
  
  // Platform metadata
  created_at: timestamp
  updated_at: timestamp
}
```

---

# Part II: Barry-Owned Objects — Signal & Observation

---

## Signal

**1. Purpose:** A normalized event produced by a module, integration, or Barry itself, representing something that happened in the business environment that Barry should observe.

**2. Authority:** Operational

**3. Persistence:** Bounded

**4. Owner:** Platform (publishers produce signals; Barry consumes but does not create signals — Executed Actions produce signals, but the publisher is the Action Executor, an operational system, not Barry's intelligence layer)

**5. Storage:** `users/{uid}/signals/{signalId}`

**6. Who may read:** Observation pipeline, Awareness Layer, Think Layer, Context Resolver, audit/debugging surfaces

**7. Who may write:** Signal publishers only — integrations (Gmail, Calendar, Apollo), platform event handlers, Action Executor (on action completion). Barry's intelligence layer never writes signals directly.

**8. Lifecycle states:**

```
received
   ↓ (signal bus accepts and validates)
observed
   ↓ (Observation pipeline processes into normalized observations)
processed
```

Terminal states: `invalid` (schema validation failed), `expired` (TTL elapsed before observation)

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| received | observed | Observation pipeline picks up the signal |
| received | invalid | Schema validation fails |
| observed | processed | All downstream awareness updates complete |
| received | expired | Signal TTL elapsed before observation |

**10. Illegal transitions:**

- `processed → received` — a processed signal cannot be re-ingested; a new signal must be published
- `invalid → observed` — an invalid signal must be republished with corrected schema
- `expired → observed` — an expired signal is lost; the source event must republish

**11. Relationships:**

- References one entity (Contact, Company, Mission, Campaign, Message)
- Consumed by the Observation pipeline
- May be produced by an Executed Action (closing the loop)
- Feeds into one or more Awareness projections (via Observation)

**12. Retention rule:** 90-day rolling window. Signals older than 90 days archived to cold storage. Awareness projections are the durable derivative — they survive signal expiration via validated projection checkpoints. Document 3 defines checkpoint, replay, and retention mechanics.

**13. Fields:**

```
Signal {
  signal_id: string                  // auto-generated unique ID
  signal_type: string                // namespaced: 'contact.reply_received', 'meeting.today'
  workspace_id: string               // userId (workspace boundary)
  
  // Entity reference
  entity_type: string                // contact | company | mission | campaign | meeting | message
  entity_id: string
  
  // Source
  source: string                     // gmail | calendar | apollo | platform | user_action | barry_action
  source_detail: string | null       // specific function or integration endpoint
  
  // Payload
  payload: object                    // event-specific data (schema per signal_type — defined in Document 3)
  
  // Lifecycle
  lifecycle_state: string            // received | observed | processed | invalid | expired
  
  // Timestamps
  occurred_at: timestamp             // when the event actually happened
  received_at: timestamp             // when the signal bus received it
  observed_at: timestamp | null      // when Observation pipeline processed it
  processed_at: timestamp | null     // when all awareness updates completed
  expires_at: timestamp              // received_at + 90 days
}
```

---

## Observation

**1. Purpose:** The deterministic processing step that interprets a Signal into a normalized, structured observation before Awareness aggregates it — Observation is a processing step owned by the Awareness pipeline, not a sixth layer (Document 1, Section 2).

**2. Authority:** Operational

**3. Persistence:** Bounded

**4. Owner:** Barry

**5. Storage:** `users/{uid}/observations/{observationId}`

```
[PROPOSED — persisted Observation trace]
Persisting Observation records is an implementation choice for auditability
and replay support. Observation remains a processing step, not an
architectural object layer. The persistence contract will be confirmed
in Document 3 (Signal Specification).
```

Persisted because: (a) awareness projection checkpoints require knowing what observations have been applied since the last checkpoint, and (b) the reasoning trace requires knowing what observations fed each awareness update.

**6. Who may read:** Awareness Layer, Think Layer (for reasoning trace), audit surfaces

**7. Who may write:** Observation pipeline only (deterministic processing — no AI)

**8. Lifecycle states:**

```
created
   ↓ (Observation pipeline produces structured output from Signal)
applied
   ↓ (downstream Awareness projection updated)
   └── expired (TTL elapsed — observation archived)
```

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| created | applied | Awareness projection successfully updated |
| applied | expired | Retention window elapsed |

**10. Illegal transitions:**

- `applied → created` — an applied observation cannot be unapplied; corrections produce a new correcting observation
- `expired → applied` — expired observations cannot retroactively update awareness

**11. Relationships:**

- Produced from exactly one Signal
- Updates one or more Awareness projections
- Referenced by Awareness update audit trail

**12. Retention rule:** 90-day rolling window (same as Signals). After expiration, the Awareness projections they updated remain valid — observations are the intermediate step, not the durable truth.

**13. Fields:**

```
Observation {
  observation_id: string
  workspace_id: string
  signal_id: string                  // the source Signal
  
  // What was observed
  observation_type: string           // relationship_event | business_event | mission_event | user_behavior
  entity_type: string
  entity_id: string
  
  // Structured output
  facts: [{
    key: string                      // 'reply_sentiment', 'days_since_contact', 'stage_change_direction'
    value: any
    confidence: number               // 0.0-1.0 (1.0 for deterministic observations)
  }]
  
  // Awareness targets
  awareness_targets: string[]        // which projections this updates: ['relationship', 'business']
  
  // Lifecycle
  lifecycle_state: string            // created | applied | expired
  
  // Timestamps
  created_at: timestamp
  applied_at: timestamp | null
  expires_at: timestamp              // created_at + 90 days
}
```

---

# Part III: Barry-Owned Objects — Awareness Layer

Awareness is Barry's persistent, continuously-updated understanding of the business environment. Four projections, each defined separately. All are Derived and Durable — rebuildable from the latest validated projection checkpoint plus retained Signals and Observations since that checkpoint. Document 3 defines checkpoint, replay, and retention mechanics.

---

## Relationship Awareness

**1. Purpose:** Barry's current derived understanding of a specific business relationship's state — sentiment, momentum, risk, engagement patterns, and next expected action.

**2. Authority:** Derived

**3. Persistence:** Durable (rebuildable projection)

**4. Owner:** Barry

**5. Storage:** `users/{uid}/contacts/{contactId}/barry_awareness/relationship`

**6. Who may read:** Context Resolver, Think Layer, all contact-scoped Barry surfaces, Morning Brief, Mission Control

**7. Who may write:** Awareness Layer only (triggered by Observations). No surface, no Skill, no user action writes directly to Relationship Awareness — it is purely derived.

**8. Lifecycle states:**

```
initialized
   ↓ (first Observation about this contact processed)
current
   ↓ (staleness threshold exceeded — no new observations within window)
stale
   ↓ (recomputation triggered)
rebuilding
   └── current (recomputation complete)
```

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| initialized | current | First Observation processed and projection computed |
| current | stale | Time since last observation exceeds staleness threshold for current warmth level |
| stale | rebuilding | Recomputation triggered (new Signal, scheduled refresh, or explicit request) |
| rebuilding | current | Recomputation complete |
| current | current | New Observation processed (projection updated in place) |

**10. Illegal transitions:**

- `stale → current` without `rebuilding` — staleness cannot be cleared without recomputation
- `initialized → stale` — a never-computed projection cannot become stale

**11. Relationships:**

- Belongs to exactly one Contact
- Corresponds to exactly one Relationship (Canonical)
- Parallels exactly one Relationship Memory (Derived)
- Fed by Observations derived from contact-related Signals
- Consumed by Context Resolver for Think Layer input
- Staleness thresholds vary by warmth level (warm: 7 days, cool: 14 days, cold: 30 days)

**12. Retention rule:** Indefinite. Rebuildable from the latest validated projection checkpoint plus retained Signals and Observations since that checkpoint (Document 3 defines checkpoint, replay, and retention mechanics). Retained as long as the Contact exists. When Contact is archived, Relationship Awareness is frozen (no further updates) but retained.

**13. Fields:**

```
RelationshipAwareness {
  workspace_id: string
  contact_id: string
  
  // Engagement state (replaces engage_state)
  engagement_status: string          // never_engaged | in_progress | awaiting_reply | active | dormant | paused
  engagement_changed_at: timestamp
  
  // Derived metrics (replaces engagement_summary)
  total_interactions: number
  total_messages_sent: number
  total_replies_received: number
  reply_rate: number                 // 0.0-1.0
  avg_response_time_hours: number | null
  days_since_last_contact: number
  days_since_last_reply: number | null
  consecutive_no_replies: number
  
  // Relationship quality
  warmth_level: string               // cold | cool | warm | hot
  warmth_source: string              // computed | user_override
  momentum_direction: string         // improving | stable | declining
  risk_score: number                 // 0.0-1.0 (0 = no risk, 1 = high risk)
  health_score: number               // 0.0-1.0 (computed from engagement signals)
  
  // Channel intelligence
  preferred_channel: string | null   // email | linkedin | text
  channel_effectiveness: {
    [channel: string]: {
      sent: number
      replied: number
      reply_rate: number
    }
  }
  
  // Projection metadata
  projection_state: string           // initialized | current | stale | rebuilding
  last_observation_at: timestamp | null
  last_computed_at: timestamp
  staleness_threshold_days: number   // varies by warmth_level
  
  // Existing fields mapping:
  //   engage_state.status              → engagement_status
  //   engage_state.last_session_at     → last_observation_at
  //   engage_state.preferred_channel   → preferred_channel
  //   engagement_summary.*             → total_interactions, reply_rate, etc.
  //   warmth_level                     → warmth_level
  //   healthScore.js output            → health_score
}
```

---

## Business Awareness

**1. Purpose:** Barry's aggregate understanding of the user's overall business state — pipeline health, activity volume, trends, and resource allocation across all relationships and missions.

**2. Authority:** Derived

**3. Persistence:** Durable (rebuildable projection)

**4. Owner:** Barry

**5. Storage:** `users/{uid}/barry_awareness/business`

**6. Who may read:** Context Resolver, Think Layer, Mission Control, Morning Brief

**7. Who may write:** Awareness Layer only (recomputed on contact signals, daily scheduled refresh)

**8. Lifecycle states:**

Same as Relationship Awareness: `initialized → current ↔ stale → rebuilding → current`

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| initialized | current | First computation complete |
| current | stale | Daily refresh overdue (> 24 hours since last computation) |
| stale | rebuilding | Scheduled daily recomputation OR high-priority signal triggers immediate refresh |
| rebuilding | current | Recomputation complete |
| current | current | Signal-triggered incremental update |

**10. Illegal transitions:**

- `stale → current` without `rebuilding`

**11. Relationships:**

- Aggregates across all Contacts, Companies, Missions, and Relationship Awareness projections
- Consumed by Mission Control (Horizon 1, 2, 3 views)
- Consumed by Morning Brief (pipeline summary)
- Fed by all entity-level Signals

**12. Retention rule:** Indefinite. Only current snapshot retained — no history. Historical trends derived from Signals.

**13. Fields:**

```
BusinessAwareness {
  workspace_id: string
  
  // Pipeline state
  total_active_relationships: number
  relationships_at_risk_count: number
  relationships_by_warmth: {
    cold: number, cool: number, warm: number, hot: number
  }
  pipeline_by_stage: {
    [lifecycle_state: string]: number
  }
  
  // Activity metrics
  responses_pending_count: number
  meetings_today_count: number
  nbs_overdue_count: number
  messages_sent_this_week: number
  replies_received_this_week: number
  
  // Trends
  pipeline_velocity: {
    new_contacts_this_week: number
    stage_changes_this_week: number
    deals_closed_this_month: number
  }
  
  // Revenue (if tracked)
  revenue_pipeline_estimate: number | null
  
  // Projection metadata
  projection_state: string           // initialized | current | stale | rebuilding
  last_computed_at: timestamp
  staleness_threshold_hours: 24
}
```

---

## Mission Awareness

**1. Purpose:** Barry's aggregate understanding of all active mission progress, health, and risk across the user's business goals.

**2. Authority:** Derived

**3. Persistence:** Durable (rebuildable projection)

**4. Owner:** Barry

**5. Storage:** `users/{uid}/barry_awareness/missions`

**6. Who may read:** Context Resolver, Think Layer, Mission Control, Morning Brief

**7. Who may write:** Awareness Layer only (updated on mission-related signals)

**8. Lifecycle states:**

Same as Business Awareness: `initialized → current ↔ stale → rebuilding → current`

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| initialized | current | First computation complete |
| current | stale | > 24 hours since last computation OR mission step completed |
| stale | rebuilding | Scheduled recomputation OR mission signal triggers refresh |
| rebuilding | current | Recomputation complete |
| current | current | Incremental update from mission signal |

**10. Illegal transitions:**

- `stale → current` without `rebuilding`

**11. Relationships:**

- Aggregates across all Mission objects
- Consumed by Mission Control (Horizon 2 — "What is in motion?")
- Fed by mission-related Signals (`mission.created`, `mission.step_completed`, `mission.deadline_approaching`)

**12. Retention rule:** Indefinite. Current snapshot only.

**13. Fields:**

```
MissionAwareness {
  workspace_id: string
  
  // Mission health
  active_missions_count: number
  missions_on_track: [{
    mission_id: string, name: string, progress_pct: number, days_remaining: number
  }]
  missions_at_risk: [{
    mission_id: string, name: string, risk_reason: string, days_overdue: number
  }]
  missions_stalled: [{
    mission_id: string, name: string, days_since_activity: number
  }]
  
  // Aggregate metrics
  overall_mission_health_score: number  // 0.0-1.0
  steps_completed_this_week: number
  steps_pending: number
  
  // Projection metadata
  projection_state: string
  last_computed_at: timestamp
  staleness_threshold_hours: 24
}
```

---

## User Awareness

**1. Purpose:** Barry's understanding of the user's work patterns, preferences, and behavioral tendencies — what times they work, how they make decisions, what communication style they prefer, and what approval patterns they follow.

**2. Authority:** Derived

**3. Persistence:** Durable (rebuildable projection)

**4. Owner:** Barry

**5. Storage:** `users/{uid}/barry_awareness/user`

**6. Who may read:** Context Resolver, Think Layer, all Barry surfaces (for personalization)

**7. Who may write:** Awareness Layer only (updated from user behavior signals — session patterns, approval/dismissal actions)

**8. Lifecycle states:**

Same as other awareness projections: `initialized → current ↔ stale → rebuilding → current`

**9. Transitions:**

Same pattern as Business Awareness — stale after 7 days without new user behavior signals.

**10. Illegal transitions:**

- `stale → current` without `rebuilding`

**11. Relationships:**

- Scoped to one workspace/user
- Fed by user action Signals (`nbs.confirmed`, `nbs.dismissed`, session timing patterns)
- Consumed by Think Layer (to personalize priority synthesis and recommendations)
- Consumed by Context Resolver (temporal and preference context)

**12. Retention rule:** Indefinite. Evolves over time. No expiration.

**13. Fields:**

```
UserAwareness {
  workspace_id: string
  
  // Communication preferences (replaces User Barry Memory partial)
  preferred_tone: string | null      // professional | casual | direct | warm
  preferred_channel: string | null   // email | linkedin | text
  tone_effectiveness: {
    [tone: string]: { used: number, positive_outcomes: number, rate: number }
  }
  channel_effectiveness: {
    [channel: string]: { sent: number, replied: number, rate: number }
  }
  
  // Work patterns
  peak_activity_hours: number[]      // hours of day (0-23) when user is most active
  avg_session_duration_minutes: number
  sessions_per_day: number
  preferred_day_of_week: string[]    // days user is most active
  
  // Decision patterns
  recommendation_acceptance_rate: number  // 0.0-1.0
  avg_approval_time_minutes: number | null
  approval_patterns: {
    auto_approve_types: string[]     // action types user consistently approves
    review_types: string[]           // action types user always reviews
    dismiss_types: string[]          // action types user frequently dismisses
  }
  
  // Projection metadata
  projection_state: string
  last_computed_at: timestamp
  staleness_threshold_days: 7
  total_sessions: number
  last_session_at: timestamp
  
  // Existing fields mapping:
  //   User Barry Memory (tone_usage, channel_usage)  → tone_effectiveness, channel_effectiveness
  //   User Barry Memory (total_sessions)             → total_sessions
}
```

---

# Part IV: Barry-Owned Objects — Action Chain

Three linked state machines connected by creation relationships. These are three distinct object types — not one object moving through a combined lifecycle (Document 1, Law 17).

---

## Recommendation

**1. Purpose:** Barry's belief about what should happen next — a prioritized, explainable suggestion produced by the Think Layer that may or may not lead to action.

**2. Authority:** Derived

**3. Persistence:** Ephemeral

**4. Owner:** Barry

**5. Storage:** `users/{uid}/recommendations/{recommendationId}`

**6. Who may read:** All Barry surfaces, Morning Brief, Mission Control, Action Queue UI

**7. Who may write:** Think Layer only (produces recommendations). Surfaces update lifecycle state (presented, dismissed). User approval creates a Prepared Action.

**8. Lifecycle states:**

```
proposed
   ↓ (Think Layer produces it)
presented
   ↓ (surfaced in UI — Morning Brief, Mission Control, drawer, or notification)
   ├── dismissed  (terminal — user explicitly rejects)
   ├── expired    (terminal — TTL elapsed, never acted on)
   └── approved
         │
         │ creates →  PREPARED ACTION
```

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| proposed | presented | Recommendation surfaced in any UI |
| presented | dismissed | User explicitly dismisses |
| presented | expired | TTL elapsed (default: 24 hours for urgent, 72 hours for normal) |
| presented | approved | User approves, triggering Prepared Action creation |

**10. Illegal transitions:**

- `dismissed → approved` — a dismissed recommendation cannot be silently re-approved. If the same action is needed, the Think Layer must produce a new Recommendation with fresh reasoning.
- `expired → any` — an expired recommendation cannot be acted on; it must be regenerated by the Think Layer
- `presented → executed` — a recommendation never directly becomes an execution. It must first become a Prepared Action.
- `approved → dismissed` — once approved, the Prepared Action governs the lifecycle
- `proposed → approved` — a recommendation must be presented to the user before it can be approved

**11. Relationships:**

- Produced by exactly one Think Layer invocation
- References one or more entities (Contact, Company, Mission)
- On approval, creates exactly one Prepared Action
- Carries a reasoning trace linking back to Signals → Observations → Awareness
- May reference a Skill or Workflow to be invoked if approved

**12. Retention rule:** Ephemeral. Dismissed recommendations retained for 30 days (for Learned Intelligence — tracking what the user rejects). Expired recommendations retained for 7 days. Approved recommendations retained until their Prepared Action reaches a terminal state.

**13. Fields:**

```
Recommendation {
  recommendation_id: string
  workspace_id: string
  
  // What
  action_type: string                // follow_up | reply | prepare_brief | research | outreach | stage_change
  description: string                // human-readable: "Follow up with Sarah Chen — no reply in 5 days"
  
  // Who/What entity
  entity_type: string                // contact | company | mission
  entity_id: string
  
  // Priority
  priority: number                   // 0 = critical, 1 = high, 2 = medium, 3 = low
  confidence: number                 // 0.0-1.0
  urgency: string                    // immediate | today | this_week | when_convenient
  
  // Strategy
  suggested_skill_id: string | null
  suggested_workflow_id: string | null
  strategy_parameters: object | null // parameters to pass to the Skill/Workflow
  
  // Reasoning (explainability — Law 11)
  reasoning_trace: {
    signals: string[]                // signal_ids that contributed
    awareness_snapshot: object       // relevant awareness state at decision time
    synthesis: string                // Think Layer's reasoning in natural language
    alternatives_considered: [{
      action_type: string
      reason_rejected: string
    }]
  }
  
  // Lifecycle
  lifecycle_state: string            // proposed | presented | dismissed | expired | approved
  
  // TTL
  ttl_hours: number                  // 24 for urgent, 72 for normal
  
  // Timestamps
  created_at: timestamp
  presented_at: timestamp | null
  decided_at: timestamp | null       // when dismissed, expired, or approved
  expires_at: timestamp              // created_at + ttl_hours
  
  // Linkage
  prepared_action_id: string | null  // set when approved → creates Prepared Action
}
```

---

## Prepared Action

**1. Purpose:** Work that Barry has completed and staged for user review — a drafted email, a generated brief, a proposed stage change — awaiting user approval before execution.

**2. Authority:** Operational

**3. Persistence:** Ephemeral

**4. Owner:** Barry

**5. Storage:** `users/{uid}/prepared_actions/{preparedActionId}`

**6. Who may read:** Action Queue UI, Morning Brief, Mission Control, all Barry surfaces

**7. Who may write:** Skills and Workflows (produce prepared content). User actions update lifecycle state (modified, dismissed, approved).

**8. Lifecycle states:**

```
drafted
   ↓ (Skill or Workflow produces content)
ready_for_review
   ↓ (surfaced in Action Queue / UI)
   ├── modified  (→ returns to ready_for_review — user edits content)
   ├── dismissed (terminal — user rejects)
   ├── expired   (terminal — TTL elapsed)
   └── approved
         │
         │ authorizes →  EXECUTED ACTION
```

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| drafted | ready_for_review | Skill/Workflow completes content generation |
| ready_for_review | modified | User edits prepared content |
| modified | ready_for_review | User finishes editing |
| ready_for_review | dismissed | User explicitly dismisses |
| ready_for_review | expired | TTL elapsed |
| ready_for_review | approved | User approves, authorizing Executed Action |

**10. Illegal transitions:**

- `expired → approved` — an expired prepared action cannot be approved; the work must be redone (content may be stale)
- `dismissed → approved` — a dismissed prepared action cannot be silently re-approved
- `drafted → approved` — must pass through `ready_for_review` (user must see it)
- `approved → modified` — once approved, the Executed Action governs the lifecycle

**11. Relationships:**

- Created by exactly one approved Recommendation
- Produced by exactly one Skill or Workflow invocation
- References one or more entities (Contact, Company, Mission)
- On approval, authorizes exactly one Executed Action
- Contains the prepared content (draft email body, brief document, proposed changes)

**12. Retention rule:** Ephemeral. Dismissed and expired retained for 7 days. Approved retained until their Executed Action reaches a terminal state.

**13. Fields:**

```
PreparedAction {
  prepared_action_id: string
  workspace_id: string
  
  // Provenance
  recommendation_id: string          // the Recommendation that created this
  skill_id: string                   // which Skill produced the content
  workflow_id: string | null         // which Workflow orchestrated (if any)
  
  // What
  action_type: string                // send_email | send_linkedin | create_meeting | stage_change | generate_brief
  description: string
  
  // Who/What entity
  entity_type: string
  entity_id: string
  
  // Prepared content
  content: {
    type: string                     // email_draft | brief_document | stage_change_spec | message_draft
    body: object                     // type-specific content (subject + body for email, document for brief, etc.)
    version: number                  // incremented on user modification
  }
  
  // Capability required
  capability_id: string              // which Capability executes this (e.g., 'gmail.send_email')
  capability_parameters: object      // parameters for the Capability
  
  // Lifecycle
  lifecycle_state: string            // drafted | ready_for_review | modified | dismissed | expired | approved
  
  // TTL
  ttl_hours: number                  // 48 for email drafts, 24 for time-sensitive actions
  
  // Timestamps
  created_at: timestamp
  ready_at: timestamp | null
  modified_at: timestamp | null
  decided_at: timestamp | null
  expires_at: timestamp
  
  // Linkage
  executed_action_id: string | null  // set when approved → authorizes Executed Action
}
```

---

## Executed Action

**1. Purpose:** A record of an action that Barry or the user has completed through the system — the durable audit trail of what was actually done, when, and what happened as a result.

**2. Authority:** Operational

**3. Persistence:** Durable (audit record)

**4. Owner:** Barry

**5. Storage:** `users/{uid}/executed_actions/{executedActionId}`

**6. Who may read:** Audit surfaces, Learned Intelligence pipeline, all Barry surfaces (for history), admin views

**7. Who may write:** Action Executor only (write-once on creation, status updates through completion/verification). No other system modifies Executed Actions.

**8. Lifecycle states:**

```
requested
   ↓ (Action Executor receives authorization from approved Prepared Action)
executing
   ↓ (Capability invoked)
   ├── failed    (terminal — with reason; may produce a retry Signal)
   └── completed
         ↓ (outcome verified)
      verified
         │
         │ produces →  SIGNAL (closing the loop)
```

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| requested | executing | Action Executor invokes the Capability |
| executing | failed | Capability returns error (timeout, auth failure, delivery failure) |
| executing | completed | Capability confirms success |
| completed | verified | Outcome confirmation received (delivery receipt, calendar event created, etc.) |

**10. Illegal transitions:**

- `completed → executing` — a completed action cannot re-execute; a new action must be created
- `verified → any` — verified is the terminal durable state. Once verified, the record is immutable.
- `failed → completed` — a failed action cannot retroactively succeed; a new action must be created
- `failed → executing` — retries create new Executed Actions (with a reference to the failed one)

**11. Relationships:**

- Authorized by exactly one approved Prepared Action
- Invokes exactly one Capability
- On completion/verification, produces one or more Signals (closing the loop)
- Failed actions may produce a retry Signal
- Referenced by Learned Intelligence (outcome tracking)

**12. Retention rule:** Indefinite. Executed Actions are the durable audit trail. Never expired, never deleted. This is how Barry explains what it did and why.

**13. Fields:**

```
ExecutedAction {
  executed_action_id: string
  workspace_id: string
  
  // Provenance (full chain)
  prepared_action_id: string
  recommendation_id: string
  
  // What was done
  action_type: string
  capability_id: string
  capability_parameters: object
  
  // Entity
  entity_type: string
  entity_id: string
  
  // Lifecycle
  lifecycle_state: string            // requested | executing | completed | failed | verified
  
  // Execution details
  started_at: timestamp
  completed_at: timestamp | null
  verified_at: timestamp | null
  
  // Result
  result: {
    success: boolean
    output: object | null            // capability-specific output (message_id for emails, event_id for calendar)
    error: object | null             // error details if failed
  }
  
  // Outcome (populated after verification)
  outcome: {
    signal_ids_produced: string[]    // signals this action produced (closing the loop)
    outcome_type: string | null      // positive | neutral | negative (populated later by attribution)
    outcome_detail: string | null
  }
  
  // Retry tracking
  retry_of: string | null            // executed_action_id of previous failed attempt
  retry_count: number                // 0 for first attempt
  
  // Audit
  idempotency_key: string            // prevents duplicate execution
  created_at: timestamp
}
```

---

## The Closed Loop

This is Barry OS. Every component traces back to this loop:

```
Executed Action
      ↓ produces
   Signal
      ↓ consumed by
  Observation (deterministic processing step)
      ↓ updates
  Awareness (4 projections — continuous, persistent)
      ↓ feeds
   Context Resolver (packages awareness for specific operation)
      ↓ input to
   Think Layer (synthesizes, compares, chooses strategy)
      ↓ produces
  Recommendation (proposed → presented → approved)
      ↓ creates
  Prepared Action (drafted → ready_for_review → approved)
      ↓ authorizes
  Executed Action  ↺
```

**Three linked state machines, three creation relationships:**

```
 RECOMMENDATION          PREPARED ACTION          EXECUTED ACTION
 ┌─────────────┐        ┌──────────────┐         ┌───────────────┐
 │  proposed    │        │  drafted     │         │  requested    │
 │     ↓        │        │     ↓        │         │     ↓         │
 │  presented   │        │  ready_for_  │         │  executing    │
 │     ↓        │        │   review     │         │     ↓         │
 │  approved ───┼─creates─▶     ↓       │         │  completed    │
 │              │        │  approved ───┼─authzs──▶     ↓         │
 │  dismissed   │        │              │         │  verified ────┼──produces──▶ SIGNAL ↺
 │  expired     │        │  dismissed   │         │               │
 └─────────────┘        │  expired     │         │  failed       │
                         └──────────────┘         └───────────────┘
```

Each state machine is independent. A Recommendation can be dismissed without ever creating a Prepared Action. A Prepared Action can expire without creating an Executed Action. But the chain is always: Recommendation creates → Prepared Action authorizes → Executed Action produces → Signal.

---

# Part V: Barry-Owned Objects — Memory and Conversation

---

## Conversation

**1. Purpose:** A Barry chat session scoped to a specific context — contact, company, mission, or global — that maintains conversational continuity across turns within a bounded time window.

**2. Authority:** Operational

**3. Persistence:** Bounded

**4. Owner:** Barry

**5. Storage:** `users/{uid}/barryConversations/{barrySessionKey}`

The `barrySessionKey` is the canonical session identifier. Its approved format (reconciliation §7, Document 1) is `{entityType}:{entityId}:{sessionType}`. `sourceModule` is metadata carried alongside — it is NOT part of the identity key. A conversation about the same contact entered from Scout, Mission Control, or the Hunter drawer is the same conversation. Including `sourceModule` in the key would fragment it across entry points.

**6. Who may read:** Barry chat surfaces (drawer, Mission Control panel, contact profile), Context Resolver, Session-to-Durable Promotion pipeline

**7. Who may write:** Barry chat surfaces (append messages), Promotion pipeline (extracts candidate facts)

**8. Lifecycle states:**

```
started
   ↓ (first message sent)
active
   ├── paused (no activity for 30 minutes — session boundary)
   │      └── resumed → active (user sends new message within retention window)
   └── closed (terminal — user explicitly ends, or 24-hour inactivity)
         ↓ (retention window elapsed)
      expired (terminal — conversation archived, messages purged)
```

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| started | active | First user or Barry message |
| active | paused | 30 minutes of inactivity |
| paused | active | New message within retention window |
| active | closed | User explicitly closes OR 24 hours of inactivity |
| paused | closed | 24 hours of inactivity |
| closed | expired | 30-day retention window elapsed |

**10. Illegal transitions:**

- `expired → active` — an expired conversation cannot be reopened; a new conversation starts
- `closed → active` — once closed, a new conversation must start (a `conversation.closed` signal may trigger Promotion pipeline)

**11. Relationships:**

- Scoped by `barrySessionKey` to one entity context (contact, company, mission, or global)
- Feeds the Session-to-Durable Promotion pipeline on close
- Messages reference entity context
- Prior conversation history fed to Context Resolver for continuity

**12. Retention rule:** 30-day rolling window from `closed` state. Messages capped at 30 per conversation. Active conversations have no expiration — only closed conversations enter the retention countdown.

**13. Fields:**

```
Conversation {
  barry_session_key: string          // {entityType}:{entityId}:{sessionType}
  workspace_id: string
  
  // Context
  entity_type: string | null         // contact | company | mission | null (global)
  entity_id: string | null
  session_type: string               // drawer | mission_control | contact_profile
  source_module: string              // metadata only — scout | hunter | sniper | etc.
  
  // Lifecycle
  lifecycle_state: string            // started | active | paused | closed | expired
  
  // Messages
  messages: [{
    role: string                     // user | barry
    content: string
    timestamp: timestamp
    intent: string | null            // detected intent if any
    metadata: object | null          // skill invoked, recommendation referenced, etc.
  }]
  
  // Session metadata
  mode: string | null                // PRIORITIZE | SUGGEST | GROWTH (for Mission Control)
  
  // Promotion tracking
  candidate_facts_extracted: boolean // whether Promotion pipeline has run
  
  // Timestamps
  started_at: timestamp
  last_activity_at: timestamp
  closed_at: timestamp | null
  expires_at: timestamp | null       // closed_at + 30 days
  
  // Existing storage mapping:
  //   users/{uid}/barryConversations/drawer_{module}  → barrySessionKey format
  //   users/{uid}/barryConversations/missionControl   → barrySessionKey format
  //   reconCoach_{sectionId}                          → barrySessionKey format
  //   icpChat, icp                                    → barrySessionKey format
  //   users/{uid}/contacts/{cid}/barry_sessions/*     → split: session metadata → Conversation,
  //                                                     outcomes → Relationship Memory (via Promotion)
}
```

---

## Session-to-Durable Promotion Pipeline

This is not an object — it is the gate that governs how session-scoped information becomes durable memory. Defined here because it is the critical boundary between Conversation (Operational/Bounded) and Memory (Derived/Durable).

**Current violation:** `barryMemoryService.closeBarrySession()` writes session summaries into durable contact memory (`barry_memory`) with no gate, no confidence score, and no provenance. Every session end writes to memory regardless of session quality.

**Required pipeline:**

```
Conversation turn
  → candidate fact { text, sourceConversationId, sourceTurnIds[], confidence }
  → GATE: confidence ≥ medium
          AND (corroborated by ≥1 signal OR explicitly confirmed by the user)
  → promoted with provenance { sourceSignalIds[], confidence, promotedAt, promotedBy }
  → surfaced as "Barry learned this" with one-click unlearn
```

**Rules:**

1. Nothing reaches durable memory without passing the gate
2. Every durable memory entry carries provenance (where it came from, why it was promoted)
3. Entries below `medium` confidence expire in 30 days
4. Session memory is discarded at 30 days regardless
5. Generation prompts read durable memory only — never raw session memory

**Confidence levels:**

| Level | Threshold | Example |
|---|---|---|
| high | ≥ 0.8 | User explicitly stated "They only respond to LinkedIn" |
| medium | ≥ 0.5 | Corroborated by signal: 3 LinkedIn replies vs 0 email replies |
| low | < 0.5 | Single session inference: "Seemed interested in pricing" |

**Only `medium` and `high` pass the gate.** `low` confidence facts remain in Session Memory and expire with it.

---

## User Memory

**1. Purpose:** Barry's durable knowledge about the user — business goals, operating preferences, ICP criteria, and explicit instructions that apply across all relationships and missions.

**2. Authority:** Derived

**3. Persistence:** Durable

**4. Owner:** Barry

**5. Storage:** `users/{uid}/barry_memory/user`

**6. Who may read:** Context Resolver (included in every Barry operation), Think Layer, all Skills

**7. Who may write:** Promotion pipeline only. User may explicitly edit (add, correct, remove entries).

**8. Lifecycle states:**

```
created
   ↓ (promoted from session or explicitly set by user)
active
   ├── updated (new information supersedes — previous version retained)
   └── removed (terminal — user explicitly unlearns)
```

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| created | active | Promotion pipeline confirms OR user explicitly sets |
| active | updated | New information with higher confidence supersedes |
| active | removed | User clicks "unlearn" or explicitly corrects |

**10. Illegal transitions:**

- `removed → active` — removed entries cannot be silently re-added; they must go through promotion again
- `created → active` without passing promotion gate (unless user explicitly set)

**11. Relationships:**

- Scoped to one workspace/user
- Fed by Promotion pipeline from Conversations
- Fed by user explicit actions
- Consumed by Context Resolver for all operations
- Informs User Awareness (but distinct — Awareness is computed; Memory is learned)

**12. Retention rule:** Indefinite for `high` confidence entries. 30-day expiration for `medium` confidence entries unless re-confirmed. User-set entries never expire.

**13. Fields:**

```
UserMemory {
  workspace_id: string
  
  entries: [{
    entry_id: string
    category: string                 // business_goal | preference | instruction | icp_criteria | operating_style
    content: string                  // "Prefers direct, professional tone" or "Always follow up within 48 hours"
    
    // Provenance
    source: string                   // promotion | user_explicit
    confidence: number               // 0.0-1.0
    source_conversation_id: string | null
    source_signal_ids: string[]
    promoted_at: timestamp
    promoted_by: string              // promotion_pipeline | user
    
    // Lifecycle
    state: string                    // active | updated | removed
    
    // History
    superseded_by: string | null     // entry_id of newer version
    superseded_at: timestamp | null
    
    created_at: timestamp
    updated_at: timestamp
  }]
  
  // Existing fields mapping:
  //   users/{uid}/barry_memory (preferred_tone, preferred_channel)  → entries with category: 'preference'
  //   users/{uid}/icpProfiles                                       → entries with category: 'icp_criteria'
  //   users/{uid}/serviceProfiles                                   → NOT memory — canonical platform data
}
```

---

## Relationship Memory

**1. Purpose:** Barry's durable learned knowledge about a specific business relationship — objections heard, interests confirmed, commitments made, what approaches have worked or failed.

**2. Authority:** Derived

**3. Persistence:** Durable

**4. Owner:** Barry

**5. Storage:** `users/{uid}/contacts/{contactId}/barry_memory/relationship`

**6. Who may read:** Context Resolver (included in contact-scoped operations), Think Layer, WriteEmailSkill, SummarizeRelationshipSkill

**7. Who may write:** Promotion pipeline only. Written ONLY via the promotion pipeline — no direct writes from session close, no direct writes from Skills.

**8. Lifecycle states:**

Same as User Memory: `created → active → updated | removed`

**9. Transitions:**

Same as User Memory. Promotion pipeline confirms facts with provenance. User may correct or unlearn.

**10. Illegal transitions:**

- `removed → active` without re-promotion
- Direct write from `closeBarrySession()` — this is the specific violation being fixed

**11. Relationships:**

- Belongs to exactly one Contact
- Distinct from Relationship (Canonical, Platform) — Relationship stores facts, Memory stores learned knowledge
- Distinct from Relationship Awareness (Derived) — Awareness is computed state, Memory is accumulated knowledge
- Fed by Promotion pipeline from contact-scoped Conversations
- Fed by engagement outcome Signals

**12. Retention rule:** Indefinite for `high` confidence entries. 30-day expiration for `medium` confidence entries unless re-confirmed.

**13. Fields:**

```
RelationshipMemory {
  workspace_id: string
  contact_id: string
  
  entries: [{
    entry_id: string
    category: string                 // objection | interest | commitment | approach_worked | approach_failed | personal_fact | communication_preference
    content: string                  // "Raised budget concerns in Q2 meeting" or "Responds best to value-driven outreach"
    
    // Provenance
    source: string                   // promotion | engagement_outcome | user_explicit
    confidence: number               // 0.0-1.0
    source_conversation_id: string | null
    source_signal_ids: string[]
    promoted_at: timestamp
    promoted_by: string
    
    // Lifecycle
    state: string                    // active | updated | removed
    
    // History
    superseded_by: string | null
    superseded_at: timestamp | null
    
    created_at: timestamp
    updated_at: timestamp
  }]
  
  // Existing fields mapping:
  //   barry_memory.who_they_are              → entries with category: 'personal_fact'
  //   barry_memory.what_has_worked[]         → entries with category: 'approach_worked'
  //   barry_memory.what_has_not_worked[]     → entries with category: 'approach_failed'
  //   barry_memory.known_facts[]             → entries by appropriate category
  //   barry_memory.tone_preference           → entries with category: 'communication_preference'
  //   barry_memory.channel_preference        → entries with category: 'communication_preference'
  //   barry_memory.relationship_summary      → NOT memory — derived, migrates to Relationship Awareness
  //   barry_memory.context_by_session{}      → NOT durable — stays in Session/Conversation Memory
}
```

**This object is distinct from Relationship and Relationship Awareness.** Relationship (Canonical) stores facts the platform owns: when the connection started, what category it is. Relationship Awareness (Derived) stores Barry's computed state: warmth, momentum, risk score. Relationship Memory (Derived) stores Barry's accumulated knowledge: what approaches worked, what objections were raised, what commitments were made. Today these three are conflated in `engage_state`, `engagement_summary`, `barry_memory`, and `relationship_context`. This distinction is how we prevent that fragmentation from recurring.

---

## Mission Memory

**1. Purpose:** Barry's durable learned knowledge about a specific mission — strategy decisions, step outcomes, what worked and what did not for this particular business goal.

**2. Authority:** Derived

**3. Persistence:** Bounded (lifetime of mission + 90 days)

**4. Owner:** Barry

**5. Storage:** `users/{uid}/missions/{missionId}/barry_memory`

**6. Who may read:** Context Resolver (included in mission-scoped operations), Think Layer, Skills (GenerateNextStepSkill)

**7. Who may write:** Promotion pipeline. Step outcomes write automatically (step completion is a confirmed fact, not a session inference).

**8. Lifecycle states:**

Same as other memory types: `created → active → updated | removed`

With addition: `active → archived` when parent Mission reaches `completed` or `abandoned` state + 90-day retention.

**9. Transitions:**

Same as User Memory, plus:

| From | To | Trigger |
|---|---|---|
| active | archived | Parent mission completed/abandoned + 90-day retention elapsed |

**10. Illegal transitions:**

- `archived → active` — archived mission memory is read-only historical reference

**11. Relationships:**

- Belongs to exactly one Mission
- Fed by mission step outcome Signals
- Fed by Promotion pipeline from mission-scoped Conversations
- Cross-referenced by Learned Intelligence (patterns across missions)

**12. Retention rule:** Lifetime of parent Mission + 90 days. After archival, retained in cold storage for Learned Intelligence aggregation.

**13. Fields:**

```
MissionMemory {
  workspace_id: string
  mission_id: string
  
  entries: [{
    entry_id: string
    category: string                 // strategy_decision | step_outcome | approach_worked | approach_failed | audience_insight
    content: string
    
    // Provenance
    source: string                   // step_outcome | promotion | user_explicit
    confidence: number
    source_signal_ids: string[]
    promoted_at: timestamp
    promoted_by: string
    
    // Lifecycle
    state: string                    // active | updated | removed | archived
    
    created_at: timestamp
    updated_at: timestamp
  }]
}
```

---

## Learned Intelligence

**1. Purpose:** Barry's durable, cross-entity knowledge derived from patterns observed across multiple relationships, missions, and sessions — what strategies work for which types of contacts, what time of day gets the best response rates, what ICP characteristics predict success.

**2. Authority:** Derived

**3. Persistence:** Durable

**4. Owner:** Barry

**5. Storage:** `users/{uid}/barry_memory/learned`

**6. Who may read:** Context Resolver, Think Layer (high-value input for strategy selection), Skills

**7. Who may write:** Statistical aggregation pipeline only. Never single-session writes — Learned Intelligence requires patterns observed across 3+ sessions, relationships, or missions.

**8. Lifecycle states:**

```
proposed
   ↓ (statistical pattern detected across 3+ data points)
confirmed
   ├── updated (new data refines the intelligence)
   └── invalidated (terminal — pattern no longer holds)
```

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| proposed | confirmed | Pattern holds across validation window |
| confirmed | updated | New data points reinforce or refine |
| confirmed | invalidated | Recent data contradicts established pattern |

**10. Illegal transitions:**

- `proposed → confirmed` without 3+ data points
- Single-session observation → confirmed (must aggregate across sessions)

**11. Relationships:**

- Aggregated from Relationship Memory, Mission Memory, and Executed Action outcomes across the workspace
- Consumed by Think Layer for strategy selection
- Distinct from User Memory (explicit preferences vs statistical patterns)

**12. Retention rule:** Indefinite. Versioned — superseded intelligence retained for trend analysis. Invalidated intelligence retained for 90 days.

**13. Fields:**

```
LearnedIntelligence {
  workspace_id: string
  
  entries: [{
    entry_id: string
    category: string                 // strategy_effectiveness | timing_pattern | channel_preference | icp_correlation | objection_pattern
    content: string                  // "Value-driven outreach has 2.3x higher reply rate for fintech contacts"
    
    // Statistical basis
    data_points: number              // how many observations support this
    confidence: number               // 0.0-1.0
    first_observed_at: timestamp
    last_confirmed_at: timestamp
    
    // Evidence
    supporting_signals: [{
      signal_type: string
      count: number
      positive_outcomes: number
      negative_outcomes: number
    }]
    
    // Lifecycle
    state: string                    // proposed | confirmed | updated | invalidated
    version: number
    
    // History
    superseded_by: string | null
    
    created_at: timestamp
    updated_at: timestamp
  }]
  
  // Existing fields mapping:
  //   User Barry Memory (tone_usage, channel_usage, channel_reply_rates) → entries with statistical basis
  //   barry_attributions subcollection                                    → evidence for strategy_effectiveness entries
}
```

---

## Session / Conversation Memory

**1. Purpose:** The ephemeral, session-scoped memory of a single Barry conversation — what was discussed, what context was assembled, what was generated. This is NOT durable memory. It exists only within the conversation and for 30 days after close.

**2. Authority:** Derived

**3. Persistence:** Bounded (30-day rolling window)

**4. Owner:** Barry

**5. Storage:** Stored as part of the Conversation object at `users/{uid}/barryConversations/{barrySessionKey}` — not a separate collection. Session memory is the conversation's messages and metadata, not a distinct object.

**6. Who may read:** The active Conversation surface, Promotion pipeline (to extract candidate facts)

**7. Who may write:** Barry chat handler (appends turns), Promotion pipeline (marks facts as extracted)

**8. Lifecycle states:**

Inherits from parent Conversation: `active → closed → expired`

**9. Transitions:**

Governed by parent Conversation lifecycle.

**10. Illegal transitions:**

- Session Memory must NOT automatically become durable memory (Document 1, Law 18). `closeBarrySession()` direct writes to `barry_memory` are the specific violation this lifecycle prevents.

**11. Relationships:**

- Part of exactly one Conversation
- Input to the Session-to-Durable Promotion pipeline
- Output (candidate facts) may become Relationship Memory, User Memory, or Mission Memory — but only through the promotion gate

**12. Retention rule:** 30 days from conversation close. Messages capped at 30 per conversation. Generation prompts read durable memory (Relationship Memory, User Memory) — never raw session memory.

**13. Fields:**

Session Memory does not have independent fields — it is the `messages[]` and `metadata` of its parent Conversation object. See Conversation definition above.

---

## Artifact Memory

**1. Purpose:** Barry's durable knowledge derived from generated artifacts — meeting briefs, account plans, campaign playbooks — that accumulates as artifacts are produced and refined over time.

**2. Authority:** Derived

**3. Persistence:** Durable (versioned)

**4. Owner:** Barry

**5. Storage:** `users/{uid}/barry_artifacts/{artifactId}/memory`

**6. Who may read:** Context Resolver (when artifact context is relevant), Skills that produce related artifacts

**7. Who may write:** Artifact generation Skills (on artifact creation/update), Promotion pipeline

**8. Lifecycle states:**

```
created
   ↓ (artifact generated, memory extracted)
active
   ├── updated (new artifact version refines memory)
   └── superseded (terminal — newer artifact replaces this one)
```

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| created | active | Artifact generation complete |
| active | updated | Artifact revised with new information |
| active | superseded | New artifact of same type for same entity replaces this one |

**10. Illegal transitions:**

- `superseded → active` — a superseded artifact memory is frozen; the newer version governs

**11. Relationships:**

- Belongs to exactly one Artifact
- May reference Contacts, Companies, or Missions
- Fed by artifact generation Skills
- Contributes to Learned Intelligence (patterns across artifacts)

**12. Retention rule:** Lifetime of parent Artifact. Superseded versions retained for 90 days.

**13. Fields:**

```
ArtifactMemory {
  workspace_id: string
  artifact_id: string
  
  // What was learned
  entries: [{
    entry_id: string
    category: string                 // talking_point | company_intel | relationship_insight | strategy_note
    content: string
    
    // Provenance
    source_artifact_version: number
    extracted_at: timestamp
    
    // Lifecycle
    state: string                    // active | updated | superseded
    
    created_at: timestamp
    updated_at: timestamp
  }]
}
```

---

# Part VI: Barry-Owned Objects — Artifacts

---

## Artifact

**1. Purpose:** A reusable Barry output — meeting brief, account plan, prospecting list, campaign playbook, weekly review — that persists as a versioned document and may be revised over time.

**2. Authority:** Derived

**3. Persistence:** Durable (versioned)

**4. Owner:** Barry

**5. Storage:** `users/{uid}/barry_artifacts/{artifactId}`

**6. Who may read:** All Barry surfaces, Morning Brief, Mission Control, user directly

**7. Who may write:** Skills and Workflows (generate artifacts), user (may annotate)

**8. Lifecycle states:**

```
created
   ↓ (Skill or Workflow generates content)
current
   ├── updated (new version generated — version number incremented)
   ├── superseded (terminal — replaced by a newer artifact of same type for same entity)
   └── archived (terminal — user or system archives)
```

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| created | current | Generation complete, artifact ready for consumption |
| current | updated | New version generated (content refreshed) |
| current | superseded | Newer artifact of same type for same entity created |
| current | archived | User archives OR parent entity archived |

**10. Illegal transitions:**

- `superseded → current` — a superseded artifact cannot be restored to current; generate a new one
- `archived → current` — same

**11. Relationships:**

- Scoped to one or more entities (Contact, Company, Mission)
- Produced by one or more Skills/Workflows
- Has one Artifact Memory (knowledge extracted from this artifact)
- Referenced by Prepared Actions (a meeting brief is prepared work)

**12. Retention rule:** Indefinite for current version. Superseded versions retained for 90 days. Archived artifacts retained indefinitely but excluded from active queries.

**13. Fields:**

```
Artifact {
  artifact_id: string
  workspace_id: string
  
  // Classification
  artifact_type: string              // meeting_brief | account_plan | prospecting_list | campaign_playbook | weekly_review | follow_up_pack | morning_brief
  
  // Entity scope
  entity_type: string | null         // contact | company | mission | null (global for weekly_review)
  entity_id: string | null
  
  // Content
  content: {
    format: string                   // markdown | structured_json
    body: string | object
    version: number
  }
  
  // Provenance
  skill_id: string
  workflow_id: string | null
  
  // Lifecycle
  lifecycle_state: string            // created | current | updated | superseded | archived
  
  // Versioning
  version: number
  previous_version_id: string | null
  superseded_by: string | null
  
  // Timestamps
  created_at: timestamp
  updated_at: timestamp
  archived_at: timestamp | null
}
```

---

# Part VII: Barry-Owned Objects — Capability Layer (Interface Only)

These are interface definitions. Implementation detail belongs to Document 4 (Capability Contracts).

---

## Skill

**1. Purpose:** The smallest independently executable Barry capability — an atomic unit of work that accepts structured input, performs one task, and returns structured output.

**2. Authority:** Operational

**3. Persistence:** Durable

**4. Owner:** Barry

**5. Storage:** `barry_registry/skills/{skillId}` (global registry, not per-user)

**6. Who may read:** Think Layer (to select which Skill to invoke), Workflow Engine (to compose Skills), Context Resolver (to know what context a Skill needs)

**7. Who may write:** Registry management only (deploy-time registration). Skills are not created at runtime.

**8. Lifecycle states:**

```
registered
   ↓ (deployed and available)
active
   ├── deprecated (still functional but flagged for removal)
   │      └── deregistered (terminal — removed from registry)
   └── deregistered (terminal — removed from registry)
```

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| registered | active | Deployment validation passes |
| active | deprecated | Newer Skill supersedes, migration period begins |
| deprecated | deregistered | All consumers migrated |
| active | deregistered | Emergency removal |

**10. Illegal transitions:**

- `deregistered → active` — a deregistered Skill must be re-registered as a new version
- A Skill may never contain Workflow logic (Document 1, Law 25)

**11. Relationships:**

- Invoked by Think Layer recommendations
- Composed by Workflows
- Produces Prepared Actions
- Invokes zero or more Capabilities
- Neither a Skill nor a Workflow owns context — context is resolved before either is invoked (Document 1, Law 25)

**12. Retention rule:** Indefinite while active. Deregistered Skills retained in registry history.

**13. Fields:**

```
Skill {
  skill_id: string                   // WriteEmailSkill, ResearchCompanySkill, etc.
  
  // Interface
  name: string
  description: string
  version: string                    // semver
  
  // Contract
  input_schema: object               // JSON Schema of required input
  output_schema: object              // JSON Schema of output
  context_requirements: string[]     // which awareness projections and memory types needed
  
  // Execution
  capability_type: string            // generative | side_effect
  ai_model: string | null            // which Claude model (null for deterministic skills)
  estimated_tokens: number | null
  estimated_latency_ms: number | null
  
  // Lifecycle
  lifecycle_state: string            // registered | active | deprecated | deregistered
  
  // Registry metadata
  registered_at: timestamp
  updated_at: timestamp
}
```

---

## Workflow

**1. Purpose:** A named, ordered composition of Skills that accomplishes a larger goal — a sequence of atomic steps coordinated to produce a compound outcome.

**2. Authority:** Operational

**3. Persistence:** Durable

**4. Owner:** Barry

**5. Storage:** `barry_registry/workflows/{workflowId}`

**6. Who may read:** Think Layer (to select which Workflow to invoke), Morning Brief (to show workflow progress)

**7. Who may write:** Registry management only (deploy-time registration).

**8. Lifecycle states:**

Same as Skill: `registered → active → deprecated → deregistered`

**9. Transitions:**

Same as Skill.

**10. Illegal transitions:**

- `deregistered → active` — must re-register
- A Workflow may never duplicate Skill logic (Document 1, Law 25)
- A Workflow may never own context — context is resolved before invocation

**11. Relationships:**

- Composes one or more Skills in a defined order
- Invoked by Think Layer recommendations
- Produces one or more Prepared Actions (one per step)
- May produce Artifacts as compound output

**12. Retention rule:** Same as Skill.

**13. Fields:**

```
Workflow {
  workflow_id: string                // PrepareMeetingWorkflow, LaunchCampaignWorkflow, etc.
  
  // Interface
  name: string
  description: string
  version: string
  
  // Composition
  steps: [{
    step_number: number
    skill_id: string
    input_mapping: object            // how to map workflow input + prior step output to this step's input
    condition: string | null         // optional condition for step execution
    on_failure: string               // skip | abort | retry
  }]
  
  // Contract
  input_schema: object
  output_schema: object
  context_requirements: string[]
  
  // Lifecycle
  lifecycle_state: string            // registered | active | deprecated | deregistered
  
  // Registry metadata
  registered_at: timestamp
  updated_at: timestamp
}
```

---

## Capability

**1. Purpose:** A declared action that Barry can take through a module or integration — the registry entry that connects Barry's intelligence to external systems.

**2. Authority:** Operational

**3. Persistence:** Durable

**4. Owner:** Barry

**5. Storage:** `barry_registry/capabilities/{capabilityId}`

**6. Who may read:** Action Executor (to invoke capabilities), Think Layer (to know what actions are possible), Autonomy policy engine

**7. Who may write:** Registry management only. Capabilities are registered by integrations at deploy time.

**8. Lifecycle states:**

```
registered
   ↓ (integration deployed and connected)
active
   ├── suspended (integration disconnected or error threshold exceeded)
   │      └── active (integration reconnected or circuit breaker resets)
   └── deregistered (terminal — integration removed)
```

**9. Transitions:**

| From | To | Trigger |
|---|---|---|
| registered | active | Integration health check passes |
| active | suspended | Integration disconnected OR circuit breaker trips |
| suspended | active | Integration reconnected AND health check passes |
| active | deregistered | Integration removed from system |
| suspended | deregistered | Integration removed while suspended |

**10. Illegal transitions:**

- `deregistered → active` — must re-register
- Executing a `suspended` capability — Action Executor must check capability state before invocation

**11. Relationships:**

- Belongs to one integration (Gmail, Calendar, Apollo, Platform)
- Invoked by Action Executor on behalf of approved Prepared Actions
- Skills reference capabilities they require
- Subject to Autonomy Spectrum (observe → recommend → prepare → approval → autonomous)

**12. Retention rule:** Indefinite while registered. Deregistered capabilities retained in audit history.

**13. Fields:**

```
Capability {
  capability_id: string              // gmail.send_email, calendar.create_event, apollo.search_companies, etc.
  
  // Interface
  name: string
  description: string
  integration: string                // gmail | calendar | apollo | platform
  
  // Classification
  capability_type: string            // generative | side_effect
  requires_approval: boolean         // true for side_effects by default
  
  // Contract
  input_schema: object               // parameters the capability accepts
  output_schema: object              // what it returns
  
  // Autonomy
  autonomy_level: string             // observe | recommend | prepare | approval | autonomous
  
  // Reliability
  timeout_ms: number
  retry_policy: {
    max_retries: number
    backoff_ms: number[]
  }
  idempotency_required: boolean      // true for all side_effect capabilities
  
  // Lifecycle
  lifecycle_state: string            // registered | active | suspended | deregistered
  
  // Health
  health_status: string              // healthy | degraded | unavailable
  last_health_check_at: timestamp
  
  // Registry metadata
  registered_at: timestamp
  updated_at: timestamp
}
```

---

## Barry OS Object Relationship Map

```
WORKSPACE (users/{uid})
   │
   ├── User
   │      └── User Memory (Derived)
   │      └── User Awareness (Derived)
   │
   ├── Companies (Canonical)
   │      └── Contacts (Canonical)
   │             │
   │             ├── Relationship (Canonical — Platform-owned facts)
   │             │      distinct from ↓
   │             ├── Relationship Awareness (Derived — Barry's computed state)
   │             │      distinct from ↓
   │             └── Relationship Memory (Derived — Barry's learned knowledge)
   │
   ├── Missions (Canonical)
   │      ├── Campaigns (Canonical)
   │      │      └── Cadences (Canonical)
   │      ├── Mission Awareness (Derived)
   │      └── Mission Memory (Derived)
   │
   ├── Messages (Canonical)
   │
   └── Barry OS
          │
          ├── Signals (Operational/Bounded)
          │      ↓ consumed by
          │   Observation (Operational/Bounded — deterministic processing step)
          │      ↓ updates
          ├── Awareness (Derived/Durable — 4 projections)
          │      │   Relationship Awareness (per-contact)
          │      │   Business Awareness (workspace-wide)
          │      │   Mission Awareness (workspace-wide)
          │      │   User Awareness (workspace-wide)
          │      │
          │      ↓ feeds (via Context Resolver)
          │
          │   Think Layer
          │      ↓ produces
          ├── Recommendations (Derived/Ephemeral)
          │      ↓ creates (on approval)
          ├── Prepared Actions (Operational/Ephemeral)
          │      ↓ authorizes (on approval)
          ├── Executed Actions (Operational/Durable)
          │      ↓ produces
          │    Signals ↺ (THE CLOSED LOOP)
          │
          ├── Conversations (Operational/Bounded)
          │      ↓ feeds (on close)
          │   Promotion Pipeline (gate)
          │      ↓ promotes to
          ├── Memory (Derived — 6 types)
          │      │   User Memory (Durable)
          │      │   Relationship Memory (Durable)
          │      │   Mission Memory (Bounded — mission lifetime + 90 days)
          │      │   Learned Intelligence (Durable)
          │      │   Session/Conversation Memory (Bounded — 30 days)
          │      │   Artifact Memory (Durable — versioned)
          │      │
          │      ↓ feeds
          │   Context Resolver (reads Awareness + Memory + canonical data)
          │
          ├── Artifacts (Derived/Durable — versioned)
          │
          └── Registry
                 ├── Skills (Operational/Durable — interface only)
                 ├── Workflows (Operational/Durable — interface only)
                 └── Capabilities (Operational/Durable — interface only)
```

**The closed loop, expanded:**

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │                                                                      │
  │  Executed Action ──produces──▶ Signal                                │
  │                                  ↓                                   │
  │                              Observation                             │
  │                                  ↓                                   │
  │                              Awareness (4 projections)               │
  │                                  ↓                                   │
  │                           Context Resolver                           │
  │                                  ↓                                   │
  │                            Think Layer                               │
  │                                  ↓                                   │
  │                           Recommendation                             │
  │                                  ↓ creates                           │
  │                          Prepared Action                              │
  │                                  ↓ authorizes                        │
  │  Executed Action ◀──────────────┘                                    │
  │        ↓                                                             │
  │     produces ──▶ Signal ──▶ ...                                      │
  └──────────────────────────────────────────────────────────────────────┘
```

Every component in Barry OS either feeds this loop or serves it. Awareness projections are the persistent state that accumulates. Memory is the durable knowledge that improves each cycle. The Think Layer is the reasoning engine that gets smarter as more data flows through the loop.

---

## Document Status

| Field | Value |
|---|---|
| **Discovery source** | `docs/audits/BARRY_OS_FOUNDATION_AUDIT.md` (commit `09e90f9`) |
| **Discovery authority** | `docs/audits/BARRY_OS_AUDIT_RECONCILIATION.md` |
| **Architecture source** | `docs/barry-os/architecture/BARRY_OS_REFERENCE_ARCHITECTURE.md` (Document 1 — frozen 2026-08-07) |
| **Architecture status** | Corrections applied — pending Team A evidence review |
| **Supersedes** | None |
| **Superseded by** | None (this is the canonical domain model) |
| **Frozen** | No — pending approval |

## Freeze Declaration

Document 2 will be frozen upon approval by Aaron after Team A evidence review.

This document may only be modified if a factual error is discovered during
implementation that directly contradicts an object definition stated here.

It may not be modified to:
- Add new objects without Aaron's approval
- Refine or expand lifecycle states beyond what is defined here
- Incorporate new ideas discovered during Documents 3–5

If implementation uncovers a genuine conflict with an object definition, flag it to Aaron
before making any change. The bar for reopening a frozen document is high.

All future object references in Documents 3, 4, and 5 derive from this document. They do not redefine objects.

---

*No code was written or changed during this document. This is an architecture specification only.*
