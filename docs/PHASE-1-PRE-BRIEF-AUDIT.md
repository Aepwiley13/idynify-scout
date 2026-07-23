# Phase 1 Pre-Brief Audit — Contacts, Engagement, and Barry

**Date:** 2026-07-23
**Source:** Current `main` branch, code-level audit
**Purpose:** Inform the Phase 1 engineering brief for Scout Bulk Send

---

## SECTION 1 — WHERE CONTACTS LIVE

### 1.1 Contact Collections in Firestore

There is **one primary contact collection**:

| Path | Purpose |
|---|---|
| `users/{userId}/contacts/{contactId}` | The single, canonical person record. Every contact in the app lives here regardless of stage (Scout, Hunter, Sniper, Basecamp, Reinforcements, Fallback). |

Subcollections under each contact:

| Subcollection Path | Purpose |
|---|---|
| `contacts/{contactId}/timeline/{eventId}` | Engagement event log (sends, status changes, sequence steps, brigade changes) |
| `contacts/{contactId}/barry_sessions/{sessionId}` | Full Barry AI session records with generated messages |
| `contacts/{contactId}/nbs_history/{nbsId}` | Next Best Step history (immutable log) |
| `contacts/{contactId}/brigade_log/{logId}` | Brigade transition log (immutable) |
| `contacts/{contactId}/barry_attributions/{attributionId}` | Outcome attribution records (Sprint 3) |

Other contact-adjacent collections:

| Path | Purpose |
|---|---|
| `users/{userId}/missions/{missionId}` | Missions with embedded `contacts[]` array (per-contact sequence state) |
| `users/{userId}/campaigns/{campaignId}` | Campaign with embedded `contacts[]` array (per-contact draft messages) |
| `users/{userId}/companies/{companyId}` | Company records, linked to contacts via `contact.company_id` |
| `users/{userId}/waves` | Basecamp engagement wave records |
| `users/{userId}/sniper_contacts` | Sniper module contact references |
| `users/{userId}/referrals/{referralId}` | Referral records |
| `users/{userId}/scheduledEngagements` | Scheduled future engagements |
| `leads/{userId}/generatedLeads` | Legacy lead collection (used only by old Prospects/Dashboard pages) |

Schema definitions: `src/firebase/schema.js`, `src/schemas/peopleSchema.js`, `src/schemas/engagementSchema.js`

### 1.2 Scout vs Hunter — Same Records or Different?

**Same records.** There is one `contacts` collection. A contact's "stage" (Scout, Hunter, Sniper, etc.) is a computed property derived from the `person_type` field on the contact document itself.

Mapping (from `src/constants/stageSystem.js`):
- `person_type: 'lead'` → stage `scout`
- `person_type: 'customer'` → stage `basecamp`
- `person_type: 'past_customer'` → stage `fallback`
- Manual override via `stage` field with `stage_source: 'manual_override'`

The shared identifier is simply the Firestore document ID (`contactId`). When a contact is "loaded into Hunter," the same document is updated — no copy is created. The function `loadIntoHunter()` in `src/utils/loadIntoHunter.js` updates fields on the existing contact doc and creates a mission referencing that `contactId`.

### 1.3 Contact Data Fields Available for Personalization

All fields from `createPersonRecord()` in `src/schemas/peopleSchema.js` (line 328) and enrichment fields from `src/schemas/engagementSchema.js`:

**Identity (usable for personalization):**
- `first_name`, `last_name`, `name` — full name, denormalized
- `email`, `work_email`
- `phone`, `phone_mobile`, `phone_direct`
- `title` — job title
- `company` / `company_name` — from the contact doc directly
- `company_id` — FK to companies subcollection
- `industry`
- `location`
- `linkedin_url`
- `website`
- `photo_url`, `twitter_url`
- `seniority` — seniority level
- `job_start_date` — when they started current role (timing signal)
- `num_employees` / `employee_count` — company size

**Enrichment-added fields (populated by Apollo/enrichment):**
- `apollo_person_id`, `email_status` (`verified`|`likely`|`unverified`)
- `last_enriched_at`, `enrichment_provenance` (per-field source map)
- `enrichment_steps[]`, `enrichment_summary`
- `company_phone`, `company_website`, `company_address`
- `company_industry`

**Classification (user-set or system-derived):**
- `person_type` — `lead` | `customer` | `partner` | `network` | `past_customer`
- `brigade` — one of 11 brigade IDs
- `stage` — `scout` | `hunter` | `sniper` | `basecamp` | `reinforcements` | `fallback`
- `relationship_type` — `prospect` | `known` | `partner` | `delegate`
- `warmth_level` — `cold` | `warm` | `hot`
- `strategic_value` — `low` | `medium` | `high` | `critical`
- `engagement_intent` / `engagementIntent` — `prospect` | `warm` | `customer` | `partner`
- `contact_status` — state machine value (New, Engaged, Awaiting Reply, In Conversation, etc.)
- `icp_score`, `icp_breakdown`, `fit_score`

**Barry intelligence (on contact doc):**
- `barryContext` — object with `contextBrief`, `confidenceLevel`, `dataQualityScore`, `personaSummary`, `suggestedFirstMove`, `whoYoureMeeting`, `whatRoleCaresAbout[]`, `whatCompanyFocusedOn[]`
- `barry_memory` — object with `who_they_are`, `current_goal`, `relationship_summary`, `what_has_been_tried[]`, `what_has_worked[]`, `what_has_not_worked[]`, `tone_preference`, `channel_preference`, `known_facts[]`, `context_by_session`

**Engagement tracking (on contact doc):**
- `engagement_summary` — denormalized: `total_sessions`, `total_messages_generated`, `total_messages_sent`, `total_attempts`, `replies_received`, `positive_replies`, `first_contact_at`, `last_contact_at`, `last_message_channel`, `last_outcome`, `consecutive_no_replies`, `channel_history`
- `engage_state` — `status`, `last_session_at`, `current_goal`, `preferred_channel`, `channel_blocked`
- `next_best_step` — `type`, `action`, `reasoning`, `due_at`, `status`

**User annotations:**
- `sticky_notes[]` — user notes
- `tags[]` — user-assigned tags

### 1.4 Where Engagement History Lives

Engagement history is stored in **two places**:

1. **Timeline subcollection:** `users/{userId}/contacts/{contactId}/timeline/{eventId}`
   - Written by `src/utils/timelineLogger.js` (`logTimelineEvent()`) and `src/utils/engagementHistoryLogger.js`
   - Event types include: `message_generated`, `message_sent`, `mission_assigned`, `campaign_assigned`, `lead_status_changed`, `contact_status_changed`, `sequence_step_proposed/approved/sent/skipped`, `sequence_completed`, `next_step_queued/completed/dismissed`, `stage_moved`, `brigade_changed`, `barry_guardrail_shown/response`, `message_scheduled/cancelled`, `referral_thank_you_sent`, `referral_ask_sent`, `keep_warm_sent`, `recognition_sent`
   - Each event has: `type`, `actor` (user|barry|system), `timestamp`, `preview`, `metadata` (type-specific)

2. **Denormalized summary on the contact doc itself:** `engagement_summary` object
   - Updated by `executeSendAction()` in `src/utils/sendActionResolver.js` (line 574)
   - Tracks aggregate counts without requiring timeline reads

Status changes are tracked by `src/utils/contactStateMachine.js` which writes the `contact_status` field and logs a `contact_status_changed` timeline event.

### 1.5 Contacts in Every Stage

Contacts appear across **all six stages** — they are the same Firestore documents, filtered by stage/person_type in each UI:

| Stage | UI File(s) | What a Contact Looks Like |
|---|---|---|
| **Scout** | `src/pages/Scout/AllLeads.jsx`, `PeopleMain.jsx` | Card with name, title, company, brigade badge, engage-status badge, ICP score. Actions: Engage (opens FirstTouch or InlineEngagement), assign brigade. |
| **Hunter** | `src/pages/Hunter/HunterDashboard.jsx`, `HunterContactDrawer.jsx` | Card stack (swipe-able). Contact card with Barry insights, sequence progress, step approval. Actions: generate message, approve step, record outcome. |
| **Sniper** | `src/pages/Sniper/SniperMain.jsx` | High-value targets pipeline view. Same contact data plus `sniper_contacts` reference docs with pipeline stage tracking. |
| **Basecamp** | `src/pages/Basecamp/BasecampMain.jsx`, `EngagementCenter.jsx` | Customer cards with health scores, CSM dashboard, milestone tracking. Actions: wave sends, health reads, churn/expansion signal detection. |
| **Reinforcements** | `src/pages/Reinforcements/ReinforcementsMain.jsx` | Referral-focused view. Contact plus `referral_data` (is_referral_source, referrals_sent, etc.). Actions: record referral, ask for referral, thank-you sends. |
| **Fallback** | `src/pages/Fallback/FallbackMain.jsx` | Past/churned customer view. Same contact doc with churn-oriented engagement options. |

Each stage has a dedicated engagement panel component: `ScoutEngagementPanel.jsx`, `HunterEngagementPanel.jsx`, `SniperEngagementPanel.jsx`, `BasecampEngagementPanel.jsx`, `ReinforcementsEngagementPanel.jsx`, `FallbackEngagementPanel.jsx` — all in `src/components/contacts/`.

---

## SECTION 2 — HOW ENGAGEMENT WORKS TODAY

### 2.1 Every Surface Where a User Can Initiate a Send

| Surface | Trigger | Channel | Barry's Role | Send Handler |
|---|---|---|---|---|
| **Scout AllLeads → FirstTouchModal → InlineEngagementSection** | User clicks "Engage" on a cold contact card in `AllLeads.jsx` | Email (primary), LinkedIn, SMS, Phone | Barry generates 4 strategy options (direct, warm, value, humor) via `generate-engagement-message` | `executeSendAction()` in `sendActionResolver.js` |
| **Scout AllLeads → InlineEngagementSection** (return contact) | User clicks "Follow Up" on a previously-contacted card | Email, LinkedIn, SMS, Phone | Same as above — Barry generates follow-up messages | `executeSendAction()` |
| **Contact Profile → InlineEngagementSection** | User opens full contact profile at `ContactProfile.jsx` and uses the engagement panel | Email, LinkedIn, SMS, Phone | Barry generates messages via `generate-engagement-message` | `executeSendAction()` |
| **Hunter Card Stack → HunterContactDrawer** | User swipes to a contact card in Hunter, opens the drawer | Email, LinkedIn, SMS, Phone | Barry generates via `generate-engagement-message` with mission context | `executeSendAction()` |
| **Hunter → SequencePanel → StepApprovalCard** | Barry proposes a sequence step; user approves and sends | Per-step channel (email, SMS, phone) | Barry generates step content via `barryGenerateSequenceStep` or `barryHunterGenerateStep` | `executeSendAction()` |
| **Hunter → FollowUpComposer** | User composes a follow-up from the Hunter drawer | Email | Barry can generate draft; user edits and sends | Creates campaign doc then `executeSendAction()` per contact |
| **Hunter → EmailWeapon** | User selects contacts and generates campaign emails | Email | `generate-campaign-messages` generates one message per contact | Individual sends via campaign detail view |
| **Hunter → TextWeapon** | User selects contacts and generates SMS messages | SMS | `generate-text-messages` generates one message per contact | Native handoff (`sms:` link) per contact |
| **Hunter → CreateCampaign** | User creates a named campaign with selected contacts | Email | `generate-campaign-messages` generates per-contact messages | Individual sends from `CampaignDetail.jsx` |
| **Hunter → MissionDetail** | User views a mission and approves steps | Per-step channel | `barryGenerateSequenceStep` for just-in-time content | `executeSendAction()` |
| **Basecamp → EngagementCenter** | User selects overdue contacts and launches a wave | Email | No Barry generation — user writes a template with `{{first_name}}` merge tag | `gmail-send-wave` Netlify function (batch send) |
| **Scout → GoToWar** | User selects contacts for multi-contact mission creation | Per-mission channel | `barryGenerateMissionSequence` generates the multi-step plan | Sequence steps are sent individually via `executeSendAction()` |
| **GenerateEmailModal** | Modal triggered from various surfaces for one-off email generation | Email | Calls Barry for message generation | `executeSendAction()` |
| **GenerateLinkedInModal** | Modal for LinkedIn message generation | LinkedIn | Calls Barry for LinkedIn message | Native handoff (opens LinkedIn profile + clipboard) |

### 2.2 Multi-Contact Sending

**Yes, but only in two places today:**

1. **Basecamp EngagementCenter Wave Send** (`src/pages/Basecamp/sections/EngagementCenter.jsx`):
   - User selects overdue contacts (can "Select All Overdue")
   - Writes one email template with `{{first_name}}` merge tags
   - Hits "Launch Wave" → calls `gmail-send-wave` Netlify function
   - Function iterates through recipients sequentially with 500ms delays between sends
   - Replaces `{{first_name}}` with each contact's first name
   - Returns per-contact results (sent/failed/skipped)
   - This is **real batch sending via Gmail API** — the closest thing to what Phase 1 wants

2. **Hunter CreateCampaign / EmailWeapon / TextWeapon**:
   - User selects multiple contacts
   - `generate-campaign-messages` makes separate Claude API calls per contact to generate individualized messages
   - Messages are stored as drafts in a campaign doc
   - User must then go to `CampaignDetail.jsx` and **send each one individually** via `executeSendAction()` — there is no automated batch send from this surface

**The AllLeads bulk select bar** (`AllLeads.jsx:2253`) currently only supports two actions: "Assign Brigade" and "Export CSV." There is no bulk send action.

### 2.3 Mission vs Campaign vs Sequence

These are **genuinely different data structures with different behavior:**

| | Mission | Campaign | Sequence |
|---|---|---|---|
| **Firestore path** | `users/{userId}/missions/{missionId}` | `users/{userId}/campaigns/{campaignId}` | Embedded as `mission.sequence` on the mission doc |
| **Purpose** | Multi-step tactical execution container targeting a goal | One-shot message batch for multiple contacts | The multi-step plan within a mission |
| **Multi-step?** | Yes, via embedded sequence | No — one message per contact | Yes — 2-5 steps per contact |
| **Approval model** | Each step requires user approval | User edits drafts, sends individually | Each step approval-gated |
| **Channels** | Multi-channel (email, SMS, phone, LinkedIn) per step | Email only (or SMS via TextWeapon) | Per-step channel assignment |
| **Barry generation** | `barryGenerateMissionSequence` for the plan, `barryGenerateSequenceStep` for just-in-time step content | `generate-campaign-messages` for per-contact messages | Content generated at each step via `barryGenerateSequenceStep` |
| **Contact storage** | `contacts[]` array with per-contact sequence progress (`currentStepIndex`, `sequenceStatus`, `stepHistory[]`) | `contacts[]` array with per-contact draft (`subject`, `body`, `status`) | Inherited from parent mission's `contacts[]` |
| **Templates** | 3 mission templates in `src/utils/missionTemplates.js`: `book_meetings` (5 steps), `warm_conversations` (3 steps), `reengage_stalled` (3 steps) | No templates | Sequence plan is generated by Barry |

**Sequence engine:** `src/utils/sequenceEngine.js` handles step progression with statuses `pending` → `active` → `awaiting_outcome` → `completed` and outcomes `no_reply`, `replied_positive`, `replied_negative`, `not_sure`.

### 2.4 Differences Between Send Surfaces (User Experience and Data)

| Surface | User Experience | Underlying Data |
|---|---|---|
| **Hunter Drawer** | Open a contact's drawer → type free-form intent → Barry generates 4 message strategies → pick one → edit → send. Rich context panel with Barry insights, reasoning, guardrail warnings. | Calls `generate-engagement-message` (richest prompt). Logs `message_generated` + `message_sent` timeline events. Updates `contact_status` via state machine. Updates `engagement_summary` counters. |
| **Scout Game / FirstTouch** | Click "Engage" on a cold contact → 3-question intake (relationship, intent, tone) → routes to InlineEngagementSection → Barry generates 4 options → pick → send. | FirstTouchModal (`src/components/firstTouch/FirstTouchModal.jsx`) gathers `engagementIntent` + `userIntent` + `toneContext`, then passes to InlineEngagementSection which calls `generate-engagement-message`. Same data pipeline as Hunter Drawer. |
| **Mission step** | View mission → Barry proposes next step → approve → Barry generates step content (4 angle drafts) → pick one → edit → send. | `barryGenerateSequenceStep` or `barryHunterGenerateStep` generates content. Logs `sequence_step_proposed/approved/sent` timeline events. Updates `mission.contacts[].currentStepIndex` and `stepHistory[]`. Step content adapts based on `previousOutcome`. |
| **FollowUpComposer** | Compose a follow-up from Hunter drawer. Creates a campaign under the hood. | Creates a campaign doc with one contact, generates message via `generate-campaign-messages` or manual compose. Send goes through `executeSendAction()`. |
| **EngagementCenter Wave** | Select overdue contacts → write one template → launch wave. Per-contact progress shown during send. | `gmail-send-wave` function handles batch. Only `{{first_name}}` personalization. Logs to `email_logs` collection and updates contact docs. No Barry generation. |

### 2.5 Engagement Actions Beyond Email

| Channel | Type | What Surfaces Support It | Details |
|---|---|---|---|
| **Email** | **Real tracked send** (Gmail API) or native handoff | All surfaces via `executeSendAction()` | Real send when Gmail OAuth is connected; native `mailto:` or Gmail web compose otherwise. Returns `gmailMessageId` on real send. |
| **SMS/Text** | **Native handoff only** | Hunter TextWeapon, InlineEngagementSection, any surface using `executeSendAction()` with channel `text` | Opens `sms:` URL + copies message to clipboard. No Twilio sending despite `check-twilio-setup.js` existing — it only checks setup status. `TextWeapon.jsx` explicitly states "Manual (copy-paste workflow, no automated sending)". |
| **LinkedIn** | **Native handoff only** | InlineEngagementSection, GenerateLinkedInModal, any surface using `executeSendAction()` with channel `linkedin` | Opens LinkedIn profile URL + copies message to clipboard. No LinkedIn API integration. |
| **Phone/Call** | **Native handoff only** | InlineEngagementSection, any surface using `executeSendAction()` with channel `call` | Opens `tel:` URL. No VoIP or call tracking. |
| **Calendar** | **Real tracked create** (Google Calendar API) or native handoff | CalendarEventModal, InlineEngagementSection | Real event creation when Google Calendar OAuth is connected; opens Google Calendar web compose otherwise. |

All channels still log `message_sent` timeline events and trigger the contact status state machine (contact goes to "Awaiting Reply") regardless of whether it was a real send or native handoff. The `method` field in the timeline event metadata distinguishes `'real'` from `'native'`.

---

## SECTION 3 — HOW BARRY IS LEVERAGED

### 3.1 Every Place Barry Generates Content

| Function / File | What Barry Receives | What Barry Produces | Handler |
|---|---|---|---|
| **`generate-engagement-message`** | Contact (name, title, company, industry, seniority, email, phone, LinkedIn, job_start_date), user intent, engagement intent, RECON sections 3/5/8/9, service profile, barry_memory, strategy recommendation, barryContext, guardrail state, user company name | 4 message strategies (direct, warm, value, humor) each with subject, body, reasoning | `netlify/functions/generate-engagement-message.js` |
| **`barryFirstTouch`** | Contact (name, title, company, industry, employee count, location, relationship_state, job_start_date), RECON sections 1/2/5, ICP messaging, service profile, user context (300 chars) | Subject line + opening paragraph for first touch | `netlify/functions/barryFirstTouch.js` |
| **`barryGenerateSequenceStep`** | Contact (name, title, company, relationship_type, warmth_level, strategic_value, engagementIntent), mission fields, step plan, step history with outcomes, barry_memory context, strategy recommendation, RECON data, adaptive context based on previous outcome | Single step message content (subject, body) tailored to step type and previous outcomes | `netlify/functions/barryGenerateSequenceStep.js` |
| **`barryHunterGenerateStep`** | Contact (name, title, company, relationship_state), mission outcome_goal, step plan, step history, barry_memory context, strategy recommendation, RECON data, adaptive angle based on previous outcome | 4 angle drafts (value_add, direct_ask, soft_reconnect, pattern_interrupt) | `netlify/functions/barryHunterGenerateStep.js` |
| **`generate-campaign-messages`** | Contact (name, title, company_name) per contact, engagement intent, RECON sections 5/9 | One personalized email (subject + body) per contact | `netlify/functions/generate-campaign-messages.js` |
| **`generate-text-messages`** | Contact data, engagement context | SMS message drafts per contact | `netlify/functions/generate-text-messages.js` |
| **`barryGenerateMissionSequence`** | Mission objective, contacts, strategy fields | Multi-step sequence plan with step types, channels, timing, rationale | `netlify/functions/barryGenerateMissionSequence.js` |
| **`barryGenerateContext`** | Contact data | Context brief: who they are, what their role cares about, what their company focuses on, suggested first move | `netlify/functions/barryGenerateContext.js` |
| **`barryOutreachMessage`** | Company data (name, industry, revenue, size, location, fit_score), ICP profile, buying signals | 3-4 sentence company-level outreach message | `netlify/functions/barryOutreachMessage.js` |
| **`barryDossierBriefing`** | Contact + company data | Dossier-style briefing on the contact | `netlify/functions/barryDossierBriefing.js` |
| **`barryGenerateTemplate`** | Template parameters | Reusable message template | `netlify/functions/barryGenerateTemplate.js` |
| **`barryICPConversation`** | ICP profile data, user questions | ICP analysis chat responses | `netlify/functions/barryICPConversation.js` |
| **`barryMissionChat`** | Mission data, conversation context | Mission-level chat responses | `netlify/functions/barryMissionChat.js` |
| **`barryCSMRead`** | Customer data, health signals | CSM health read analysis | `netlify/functions/barryCSMRead.js` |
| **`barryReconInterview`** | RECON section context | Coaching interview responses | `netlify/functions/barryReconInterview.js` |
| **`barryOrientationBrief`** | User profile, RECON data | Orientation briefing | `netlify/functions/barryOrientationBrief.js` |
| **`generate-section-1` through `generate-section-10`** | RECON questionnaire answers | Section reports and analysis | `netlify/functions/generate-section-*.js` |
| **`generate-icp-brief`** | ICP data | ICP brief document | `netlify/functions/generate-icp-brief.js` |
| **`inferRelationshipWarmth`** | Contact data | Warmth inference | `netlify/functions/inferRelationshipWarmth.js` |

### 3.2 What Context Barry Actually Has Access To

For the **core message generation** (`generate-engagement-message.js`), Barry receives the richest context:

| Context Category | Available? | Actually Passed to Prompt? | How |
|---|---|---|---|
| **User's ICP** | Yes | Yes | RECON section 3 (target market: company size, industries, growth stage, revenue range) is loaded and injected |
| **Contact's engagement history** | Yes | Yes | Via `assembleBarryContext()` which injects total_sent, replies_received, positive_replies, consecutive_no_replies, last_outcome. Also via `barry_memory.what_has_been_tried/worked/not_worked` |
| **Previous sends** | Yes | Yes (indirectly) | Via `barry_memory` (what has been tried, what worked) and recent `barry_sessions` (last 5 sessions with generated messages) |
| **Contact's company** | Yes | Yes | Company name, industry directly. Company size, revenue if enriched |
| **User's product/service description** | Yes | Yes | Via RECON sections 1-2 (business foundation, product) and service profiles |
| **Contact's pain points** | Partially | Yes (user's customer pain points) | RECON section 5 (customer pain intelligence), not per-contact pain points |
| **Messaging preferences** | Yes | Yes | RECON section 9 (email tone, length, key messages, CTAs, personalization level) |
| **Competitive context** | Yes | Yes | RECON section 8 |
| **Strategy recommendation** | Yes | Yes | `barryStrategyRecommender.js` analyzes what has worked/failed and injects guidance |
| **Relationship classification** | Yes | Yes | `relationship_type`, `warmth_level`, `strategic_value` with calibration instructions |
| **Guardrail state** | Yes | Yes | `barryGuardrail.js` detects tone mismatches and modifies the prompt accordingly |

For **campaign message generation** (`generate-campaign-messages.js`), Barry receives much less:

| Context Category | Actually Passed? |
|---|---|
| Contact name, title, company | Yes |
| RECON sections 5 and 9 | Yes |
| Barry memory, engagement history, strategy rec | **No** |
| Service profiles | **No** |

### 3.3 Barry in Scout vs Hunter vs Missions

Barry **behaves differently in each context** — these are separate Netlify functions with different prompts and different context assemblies:

| Context | Function | Key Differences |
|---|---|---|
| **Scout (FirstTouch)** | `barryFirstTouch.js` | Lightweight. Uses `claude-haiku-4-5-20251001`. No barry_memory or engagement history. Focuses on first-impression signals (new role timing, small team, industry). Returns subject line + opening paragraph only. |
| **Scout/Hunter (full engagement)** | `generate-engagement-message.js` | Richest context. Uses `claude-sonnet-4-5-20250929`. Full barry_memory, strategy recommendation, guardrails, RECON sections 3/5/8/9, service profile. Returns 4 strategy options. The same function serves both Scout and Hunter engagement panels. |
| **Mission sequence steps** | `barryGenerateSequenceStep.js` | Uses `claude-sonnet-4-5-20250929`. Knows mission strategy, step history, previous outcomes. Adapts tone based on outcome (no_reply → pattern interrupt, positive_reply → direct ask). Returns single step content. |
| **Mission sequence steps (Hunter variant)** | `barryHunterGenerateStep.js` | Uses `claude-haiku-4-5-20251001`. Similar to above but returns 4 angle drafts. Writes draft directly to mission doc. |
| **Campaign bulk** | `generate-campaign-messages.js` | Simplest. Uses `claude-sonnet-4-5-20250929`. Separate API call per contact but with minimal context. No memory, no strategy, no service profile. |
| **Company-level outreach** | `barryOutreachMessage.js` | Uses `claude-sonnet-4-6`. Company-level only — no individual contact data at all. |

### 3.4 Can Barry Personalize at the Individual Contact Level?

**Yes, in two ways today:**

1. **`generate-engagement-message.js`** — When called for a single contact, Barry receives that contact's full data (name, title, company, industry, seniority, job_start_date) and generates messages referencing those specific details. The prompt explicitly requires: "Messages must be SPECIFIC to this contact - reference their name, title, company, or industry." This is the primary per-contact personalization engine.

2. **`generate-campaign-messages.js`** — Makes separate Claude API calls per contact, passing each contact's name, title, and company into the prompt. Each contact gets a unique message, but with significantly less context than the full engagement generator.

**What drives personalization today:**
- Contact identity: name, title, company, industry, seniority
- Timing signals: `job_start_date` (days in current role)
- Engagement history: via barry_memory (what has been tried, what worked)
- Relationship classification: warmth_level, strategic_value, relationship_type
- Barry's existing context brief: `barryContext.whoYoureMeeting`, `whatRoleCaresAbout`, `whatCompanyFocusedOn`

**What personalization does NOT exist today:**
- There is no function that generates a "personalized opening line" as a standalone output. The closest is `barryFirstTouch.js` which generates a subject line + opening paragraph, but it's designed for first-touch only and uses minimal context (no barry_memory, no engagement history).
- The wave sender (`gmail-send-wave`) only personalizes `{{first_name}}` — no Barry-generated per-contact content.

### 3.5 Barry's Current Biggest Limitation

**Barry cannot generate personalized content at scale with full context.**

The core issue: the richest Barry function (`generate-engagement-message`) is designed for **one contact at a time** with a heavy context assembly (RECON, barry_memory, strategy recommendation, guardrails, service profile). The bulk-capable function (`generate-campaign-messages`) strips out most of that intelligence — no barry_memory, no strategy recommendation, no service profiles, no engagement history.

This means:
- A user engaging 1 contact gets Barry's full intelligence
- A user engaging 20 contacts via campaign gets Barry's basic intelligence (name + title + company only, plus RECON)
- A user sending a wave to 20 contacts via Basecamp gets **zero Barry intelligence** — just `{{first_name}}` merge tags

There is no middle ground: a function that takes N contacts and generates per-contact personalized opening lines using the full (or near-full) context stack at a cost/latency that scales.

---

## SECTION 4 — WHAT WE NEED FOR PHASE 1 (SCOUT BULK SEND)

### 4.1 Which Contact List UI Has Multi-Select?

**`src/pages/Scout/AllLeads.jsx`** — this is the best candidate.

Multi-select implementation:
- **State:** `bulkMode` boolean (line 1157), `selectedIds` Set (line 1158)
- **Toggle:** `toggleSelect(contactId)` function (line 1425) — toggles a contact in/out of the Set
- **UI trigger:** "Select" button (line 2024-2027) toggles `bulkMode`
- **Card integration:** `AllLeadsCard` receives `isSelected`, `bulkMode`, `onSelect` props (lines 2086-2088). In bulk mode, clicking a card toggles selection instead of opening it (line 518)
- **Bulk action bar:** Floating bar at bottom (line 2253-2311) appears when `selectedIds.size > 0`

**Current bulk actions available (line 2253-2311):**
1. "Assign Brigade" — dropdown to assign all selected contacts to a brigade
2. "Export" — CSV export of selected contacts
3. "Clear" — deselects all

**What's missing for Phase 1:** A "Compose" or "Bulk Send" button in the bulk action bar.

### 4.2 Where to Add the Compose Surface

**Recommended: Add a compose step triggered from the AllLeads bulk action bar.**

The flow would be:
1. User enters bulk mode in AllLeads → selects contacts → clicks a new "Compose" button in the bulk action bar
2. A modal or side panel opens with the compose surface (subject line, shared email body, Barry personalization toggle)
3. User writes the shared body and triggers Barry personalization
4. Progress UI shows per-contact send status

**Why AllLeads:**
- Already has working multi-select with Set-based state management
- Already has the floating bulk action bar pattern
- Lives in Scout which is the natural "list of people" view
- Is the most-used contact list surface

**Alternative considered:** Basecamp EngagementCenter already has wave sending, but it's scoped to overdue Basecamp customers — wrong audience for Scout prospects.

**Compose surface pattern to follow:** The closest existing pattern is `EngagementCenter.jsx` (line 856-948) which has:
- Template selection → message body textarea → preview modal → launch button
- Per-contact send progress tracking (`sendProgress` state)
- Wave doc creation in Firestore before sending

### 4.3 Closest Barry Function for Personalized Opening Lines

**`barryFirstTouch.js`** is the closest — it already generates a subject line + opening paragraph for a single contact. But it needs significant changes:

**What `barryFirstTouch.js` does today:**
- Takes one contact + service profile + RECON context
- Uses `claude-haiku-4-5-20251001` (fast, cheap)
- Returns `{ subjectLine, openingParagraph }` as JSON
- Loads RECON sections 1, 2, 5 and active ICP messaging

**What needs to change for "generate a personalized opening line per contact":**
1. **New function or adaptation:** Create a `barryBulkPersonalize.js` that accepts an array of contacts + a shared message body, and generates one personalized opening line per contact
2. **Contact context scope:** Each personalized line needs at minimum: `name`, `title`, `company`, `industry`, `job_start_date`. For richer personalization: `barryContext.personaSummary`, `warmth_level`
3. **Output format change:** Return `{ contactId, openingLine }` per contact instead of full opening paragraph
4. **Batching strategy:** Either N separate Claude calls (parallel, using Haiku for speed/cost) or a single Claude call with all N contacts in the prompt (limited by context window). For up to ~20 contacts, a single-prompt approach with Sonnet would work and produce more consistent quality.

**Alternative: `generate-campaign-messages.js`** — already handles multiple contacts, but generates full messages not opening lines, and uses less context. Could be adapted by changing the prompt to generate opening lines only.

### 4.4 Existing Send Infrastructure for Per-Contact Email Delivery

**`gmail-send-wave.js`** is the existing batch send infrastructure:

**What it does today:**
- Receives `recipients[]` array with `contactId`, `email`, `firstName`, `lastName`, `existingThreadId`
- Receives shared `subject` and `messageTemplate`
- Sends sequentially with **500ms delays** between sends (line 258)
- Personalizes `{{first_name}}` merge tag per contact
- Logs to `email_logs` collection per send
- Updates contact docs with `gmail_last_message_id`, `hunter_status`, `last_sent_at`
- Updates wave doc with stats
- Returns per-contact results (sent/failed/skipped)

**What needs to change for Phase 1:**
1. **Support per-contact unique bodies:** Currently uses one `messageTemplate` with `{{first_name}}` replacement. Phase 1 needs each contact to have a unique opening line prepended to the shared body. Change: accept `recipients[].personalizedOpening` and prepend it to the shared body.
2. **Progress streaming:** Currently returns all results at once after all sends complete. Phase 1 wants a progress UI showing per-contact status in real-time. Options: (a) Use polling — frontend creates a wave doc, function updates it per send, frontend polls. (b) Use Server-Sent Events from the Netlify function. (c) Send from the frontend using sequential `gmail-send-quick` calls with client-side progress state (simplest, but slower).
3. **Timeline logging:** `gmail-send-wave` currently does NOT log timeline events — it only logs to `email_logs` and updates contact docs. Phase 1 should add `logTimelineEvent()` calls or a batch equivalent.
4. **State machine updates:** `gmail-send-wave` does NOT trigger the contact status state machine. Phase 1 should call `updateContactStatus()` per contact after send.
5. **Delays between sends:** 500ms is probably fine for batches under 50. For larger batches, may need configurable delays to respect Gmail's daily sending limits (500 emails/day for consumer Gmail, 2000/day for Google Workspace).

### 4.5 Three Biggest Risks / Unknowns for Phase 1

**Risk 1: Barry personalization latency and cost at scale.**

Generating a unique opening line per contact requires a Claude API call. Options:
- **N parallel Haiku calls** (~1s each, ~$0.001/contact): Fast but costs scale linearly. For 20 contacts, ~$0.02 and ~2-3s total (parallel).
- **Single Sonnet call with all N contacts** (~5-8s, ~$0.01): More coherent quality but single point of failure. Prompt grows linearly. Works up to ~30-40 contacts before context window pressure.
- **Hybrid:** Batch contacts into groups of 10 for single-call personalization.

Unknown: How large will batches typically be? 5-10 contacts is cheap and fast. 50+ contacts starts to hit cost/latency/reliability concerns. **Recommend capping Phase 1 at 25 contacts per bulk send** and solving scale later.

**Risk 2: Gmail rate limits and deliverability.**

Gmail API enforces sending limits:
- Consumer Gmail: ~500 sends/day
- Google Workspace: ~2,000 sends/day
- Per-second rate: unclear, but `gmail-send-wave` uses 500ms delays

Sending 25 personalized emails in rapid succession could trigger spam filters. Unknown: What are users' typical Gmail account types? How many bulk sends per day will users attempt?

**Recommend:** Enforce a per-batch limit (25), enforce minimum delay between sends (1-2 seconds), track daily send count per user, and warn when approaching limits.

**Risk 3: Progress UI and failure recovery.**

The current `gmail-send-wave` function runs as a single Netlify function invocation that sends all emails sequentially. If it times out (Netlify functions have a 10-second default, 26-second max on paid plans), some emails may send while others don't, with no way to resume.

Unknowns:
- What happens if send 12 of 25 succeeds and then the function times out?
- How does the user know which contacts were sent and which weren't?
- Can the user retry just the failed ones?

**Recommend:** Move to a client-driven send loop (frontend calls `gmail-send-quick` per contact sequentially, updates progress state after each) rather than a single serverless function. This gives natural progress UI, natural failure isolation per contact, and avoids function timeout issues. The tradeoff is that the user must keep the browser tab open during the send.

---

## APPENDIX — KEY FILE REFERENCE

| Area | Files |
|---|---|
| Contact schema | `src/schemas/peopleSchema.js`, `src/schemas/engagementSchema.js`, `src/firebase/schema.js` |
| Contact list + multi-select | `src/pages/Scout/AllLeads.jsx` |
| Send orchestration | `src/utils/sendActionResolver.js` |
| Batch send | `netlify/functions/gmail-send-wave.js` |
| Single email send | `netlify/functions/gmail-send-quick.js` |
| Core Barry message gen | `netlify/functions/generate-engagement-message.js` |
| Campaign message gen | `netlify/functions/generate-campaign-messages.js` |
| First touch gen | `netlify/functions/barryFirstTouch.js` |
| Sequence step gen | `netlify/functions/barryGenerateSequenceStep.js` |
| Barry context assembly | `netlify/functions/utils/barryContextAssembler.js` |
| Barry memory service | `src/services/barryMemoryService.js` |
| Strategy recommender | `netlify/functions/utils/barryStrategyRecommender.js` |
| Timeline logger | `src/utils/timelineLogger.js` |
| Contact state machine | `src/utils/contactStateMachine.js` |
| Sequence engine | `src/utils/sequenceEngine.js` |
| Stage system | `src/constants/stageSystem.js` |
| Brigade system | `src/data/brigadeSystem.js` |
| Mission service | `src/services/missionService.js` |
| Mission templates | `src/utils/missionTemplates.js` |
| Engagement panel (per-stage) | `src/components/contacts/ScoutEngagementPanel.jsx`, etc. |
| Wave sender UI | `src/pages/Basecamp/sections/EngagementCenter.jsx` |
