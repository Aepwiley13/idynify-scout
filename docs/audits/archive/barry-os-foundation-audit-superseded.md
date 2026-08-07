# SUPERSEDED — DO NOT IMPLEMENT FROM THIS DOCUMENT

This audit was superseded by:

  docs/audits/BARRY_OS_FOUNDATION_AUDIT.md
  docs/audits/BARRY_OS_AUDIT_RECONCILIATION.md

after repository-level reconciliation on 2026-08-07.

Four findings from this audit were absorbed into the canonical baseline (B-1 through B-4).
All other findings have been resolved. See the reconciliation for the full discrepancy table.

Retained for historical context only.

---

# Barry OS Foundation Audit — Team Alpha Deliverable

**Idynify · Team Alpha · Discovery Only — No Code**
**Audit Date: 2026-08-07**
**Repository: idynify-scout**

---

## Barry OS Principles

1. **Barry is an orchestration engine, not a collection of AI features.** He chains skills and capabilities together to accomplish larger goals — not just respond to individual prompts.
2. **Barry is never called directly from business logic. Business logic publishes signals. Barry observes them.** This is the single most important architectural law. It reduces coupling, future-proofs integrations, makes testing easier, and keeps Barry composable.
3. **Modules publish signals. Barry observes and reasons.** Scout, Hunter, Sniper, Basecamp, Recon, and Reinforcements are applications running on Barry OS. Barry is the runtime, not a feature inside each module.
4. **Barry derives intelligence from canonical data and never owns it.** Contacts, companies, messages, campaigns, and missions belong to the platform. Barry reads them. Barry does not store them.
5. **AI is used for reasoning, judgment, and language — not for deterministic business logic.** Do not ask Claude who replied yesterday. Compute that. Save AI for strategy, tone, relationship advice, planning, and judgment calls.
6. **Every new integration contributes signals and capabilities.** It does not create a new Barry implementation.
7. **Improving Barry in one place improves Barry everywhere.** One intelligence system. Multiple surfaces.
8. **Mission Control is organized around user work, not module boundaries.** The question is what Aaron needs to decide today — not which module produced the information.
9. **Barry prepares work proactively while respecting user autonomy.** Barry should have the answer ready before Aaron asks. Aaron decides how much Barry executes on his own.
10. **Signals, awareness state, recommendations, prepared actions, and executed actions are distinct concepts.** Barry OS must never conflate them.
11. **Barry's reasoning must be explainable, auditable, and improvable.** If Barry cannot explain why he recommended something, that recommendation should not ship.
12. **Barry thinks before he acts.** Between awareness and recommendation, Barry synthesizes information, compares competing priorities, weighs tradeoffs, and chooses strategy. That reasoning layer is where Idynify's differentiation lives.

---

## Barry Domain Model

| Object | Definition |
|---|---|
| Workspace | The user's Idynify environment — the boundary for all Barry reasoning |
| User | Aaron or any authenticated operator of the workspace |
| Contact | A canonical person record in the user's workspace |
| Company | A canonical organization record in the user's workspace |
| Relationship | The state and history of Aaron's connection with a Contact or Company |
| Mission | A named goal with a defined strategy, audience, and success criteria |
| Campaign | A structured outreach sequence within a Mission |
| Cadence | A timed touchpoint schedule within a Campaign |
| Meeting | A scheduled or completed interaction with a Contact |
| Conversation | A Barry chat session scoped to a context — contact, company, mission, or global |
| Message | A communication artifact — email, LinkedIn message, text — sent or drafted |
| Task | A discrete action item assigned to Aaron or queued for Barry |
| Signal | A normalized event produced by a module or integration |
| Awareness State | Barry's current derived understanding of a Relationship, Mission, or the business |
| Recommendation | Barry's belief about what should happen next |
| Prepared Action | Work Barry has completed and staged for Aaron's review or approval |
| Executed Action | An action Barry or Aaron has completed |
| Skill | An atomic Barry capability — WriteEmailSkill, FindContactsSkill, ResearchCompanySkill |
| Workflow | A named combination of Skills — PrepareMeetingWorkflow, LaunchCampaignWorkflow |
| Capability | A declared action Barry can take through a module or integration |
| Artifact | A reusable Barry output — meeting brief, account plan, prospecting list, campaign playbook |

---

## Step 1 — Barry Surface Inventory

### Surface 1: Global Barry Drawer (BarryTrigger → BarryChat)

- **Component:** `BarryTrigger.jsx` + `BarryChat.jsx`
- **File path:** `src/components/barry/BarryTrigger.jsx`, `src/components/barry/BarryChat.jsx`
- **Module:** Global — rendered once in `App.jsx` outside Routes, persists across navigation
- **Barry's role:** Context-aware chat drawer. Module determined by current route (recon→COACH, scout→TARGETING, hunter→PURSUE, sniper→CLOSE, command-center→SUGGEST, basecamp→CSM, reinforcements→CONNECT, fallback→RECOVER)
- **Context passed:** Via `useBarryContext()` hook from `barryContextStore.js` — a lightweight pub/sub singleton. Each module page calls `setBarryContext()` on mount with relevant data (active contact, company, ICP section). Context is merged, not replaced.
- **Data sources:** Whatever the current module page injects via `setBarryContext()`. Varies per module — contact data, company data, ICP profile sections.
- **Conversation store:** Per-module Firestore document at `users/{userId}/barryConversations/drawer_{module}`. Each module key gets its own conversation. **Does NOT share** with Mission Control or contact-level surfaces.
- **Actions:** Calls `/.netlify/functions/barryMissionChat` for all modules. Can trigger MOVE_TO_SNIPER action via `moveContactToSniper()`.
- **Five-layer analysis:** Mixes Recommendation and Prepared Action layers. Barry generates recommendations inline as chat responses and can prepare actions (draft messages, move-to-sniper). No clear separation between awareness derivation and recommendation.
- **Skills/Workflows support:** Neither. Single-capability responses only — one prompt → one response. No chaining.
- **Status:** Working. Functional across all module routes.
- **Direct-call violations:** Module pages call `setBarryContext()` to inject data into Barry — this is publishing context, not calling Barry directly from business logic. **No violation.** However, `BarryChat` directly calls `moveContactToSniper()` from within the chat component — this is Barry executing a side effect from within a UI component. **Mild violation** — the action execution should go through a capability registry.

### Surface 2: Mission Control Barry Chat Panel (BarryChatPanel)

- **Component:** `BarryChatPanel.jsx`
- **File path:** `src/components/dashboard/BarryChatPanel.jsx`
- **Module:** Mission Control (`/mission-control-v2`)
- **Barry's role:** Full command interface. Builds complete context stack on mount. Calls orientation brief. Handles multi-turn conversation with mode switching (PRIORITIZE / SUGGEST / GROWTH).
- **Context passed:** Full context stack built by `buildContextStack()` from `barryContextStack.js` — loads up to 500 contacts, active missions, RECON data (confidence + key sections), ICP profile, service profiles, calendar events. **Most data-rich Barry surface.**
- **Data sources:** `users/{userId}/contacts` (up to 500), `users/{userId}/missions` (active), `dashboards/{userId}` (RECON), `users/{userId}/icpProfiles`, `users/{userId}/serviceProfiles`, `users/{userId}/integrations/googleCalendar` + calendar-list-events function. Context cached 5 min in sessionStorage.
- **Conversation store:** Firestore at `users/{userId}/barryConversations/missionControl`. Also creates per-session docs in `users/{userId}/barry_sessions/{sessionId}`. **Separate from the drawer store.**
- **Actions:** Calls `barryMissionChat` and `barryOrientationBrief` Netlify functions. Can update ICP via `updateIcpFromChat()`. Renders `MessageAngleBlock` for 4-angle message generation. Supports intent-driven actions (DRAFT_MESSAGE, MOVE_TO_SNIPER, ICP_SCOUT_CLARIFY, RESEARCH, etc.).
- **Five-layer analysis:** **Conflates all five layers.** The orientation brief mixes Signal (what happened), Awareness (pipeline state), Recommendation (what to do), and Prepared Action (suggested prompts). Barry's responses can be any layer. No structural separation.
- **Skills/Workflows support:** **Neither.** Single request → single response. The ICP clarification flow is the closest thing to a multi-step workflow, but it's a conversational loop, not an orchestrated skill chain.
- **Status:** Working. Most complete Barry surface.
- **Direct-call violations:** `buildContextStack()` pulls data directly from Firestore in the client. Business logic (recommendations, mode detection) is embedded in `barryMissionChat.js`. **Partial violation** — the recommendation generation happens server-side inside the chat function rather than through a signal/awareness system.

### Surface 3: Mission Control Morning Brief (BarryMorningBrief)

- **Component:** `BarryMorningBrief.jsx`
- **File path:** `src/components/mission-control/BarryMorningBrief.jsx`
- **Module:** Mission Control
- **Barry's role:** Renders orientation brief as a card. Shows pipeline analysis, suggested prompts, pending reply count/preview.
- **Context passed:** Receives `orientation` object from parent (loaded by `BarryChatPanel` or Mission Control dashboard from `barryOrientationBrief`).
- **Data sources:** Consumed from parent — does not load data itself.
- **Conversation store:** None — display-only component.
- **Actions:** Renders suggested prompt chips that trigger `openBarry()` callback. Can display pending reply previews.
- **Five-layer analysis:** Mixes Awareness (pipeline state), Recommendation (what to focus on), and Signal (pending replies). The brief itself is a recommendation presented as awareness.
- **Skills/Workflows support:** None. Display only.
- **Status:** Working.
- **Direct-call violations:** None — pure display component.

### Surface 4: Contact Page Barry Insight Panel (BarryInsightPanel)

- **Component:** `BarryInsightPanel.jsx`
- **File path:** `src/components/contacts/BarryInsightPanel.jsx`
- **Module:** Contact Profile page
- **Barry's role:** Shows Barry's insight/context about a specific contact. Displays relationship summary, known facts, engagement history, and next best step.
- **Context passed:** Contact document data and barry_memory from the contact record.
- **Data sources:** Contact Firestore document (`users/{userId}/contacts/{contactId}`), specifically `barry_memory`, `engage_state`, `engagement_summary`, `next_best_step` fields.
- **Conversation store:** None — reads from persisted contact data.
- **Actions:** Can open Barry drawer (BarryTrigger) with contact context pre-loaded.
- **Five-layer analysis:** Primarily Awareness (relationship state display) and Recommendation (next best step). Does not generate new recommendations — displays pre-computed ones.
- **Skills/Workflows support:** None.
- **Status:** Working.
- **Direct-call violations:** None.

### Surface 5: Contact Page Barry Context (BarryContext)

- **Component:** `BarryContext.jsx`
- **File path:** `src/components/contacts/BarryContext.jsx`
- **Module:** Contact Profile page
- **Barry's role:** Renders Barry's accumulated context for a contact — who they are, what's been tried, what's worked/not worked.
- **Context passed:** Contact data and barry_memory.
- **Data sources:** Same as BarryInsightPanel — contact document.
- **Conversation store:** None — display only.
- **Actions:** None.
- **Five-layer analysis:** Pure Awareness layer — displays derived state.
- **Skills/Workflows support:** None.
- **Status:** Working.
- **Direct-call violations:** None.

### Surface 6: Contact Page Barry Briefing (BarryBriefing)

- **Component:** `BarryBriefing.jsx`
- **File path:** `src/components/contacts/BarryBriefing.jsx`
- **Module:** Contact Profile page
- **Barry's role:** Generates a dossier/briefing for a contact before a meeting or outreach. Calls `barryDossierBriefing` Netlify function.
- **Context passed:** Contact data, engagement history, company info.
- **Data sources:** Contact document + server-side enrichment in `barryDossierBriefing.js`.
- **Conversation store:** None — one-shot generation.
- **Actions:** Generates briefing text via AI call.
- **Five-layer analysis:** Prepared Action — Barry generates a deliverable (briefing document). Conflated with Awareness (includes relationship state in the briefing).
- **Skills/Workflows support:** This is conceptually a Skill (GenerateBriefingSkill) but not implemented as one. Hard-coded single function call.
- **Status:** Working.
- **Direct-call violations:** Component directly calls Netlify function. **Mild violation** — should publish a signal requesting a briefing.

### Surface 7: Engagement Panels (Hunter, Scout, Basecamp, Sniper, Fallback)

- **Components:** `HunterEngagementPanel.jsx`, `ScoutEngagementPanel.jsx`, `BasecampEngagementPanel.jsx`, `SniperEngagementPanel.jsx`, `FallbackEngagementPanel.jsx`
- **File path:** `src/components/contacts/` (all)
- **Module:** Per-module engagement flows on contact pages
- **Barry's role:** Each panel provides module-specific engagement actions. Hunter shows step cards, Scout shows ICP fit, Basecamp shows health reads, Sniper shows close zone actions.
- **Context passed:** Contact data, module-specific state.
- **Data sources:** Contact document, module-specific data.
- **Conversation store:** None — action panels, not chat.
- **Actions:** Trigger various Netlify functions (barryHunterProcessEngage, barryFirstTouch, etc.).
- **Five-layer analysis:** Each conflates Recommendation (what to do) with Prepared Action (generate message) and Executed Action (send message). No separation.
- **Skills/Workflows support:** None. Each is a monolithic engagement flow.
- **Status:** Working but inconsistent across modules.
- **Direct-call violations:** **Yes.** Each panel directly calls Barry Netlify functions from within the UI component. This is the primary violation pattern — business logic (engagement flow) directly invokes Barry rather than publishing signals.

### Surface 8: Recon Coach (BarryReconCoach)

- **Component:** `BarryReconCoach.jsx`
- **File path:** `src/components/recon/BarryReconCoach.jsx`
- **Module:** Recon
- **Barry's role:** ICP coaching during Recon section completion. Provides real-time guidance as user fills in sections.
- **Context passed:** Current section data, user's ICP profile, RECON completion state.
- **Data sources:** RECON dashboard data, ICP profiles.
- **Conversation store:** In-memory conversation state — **not persisted**.
- **Actions:** Calls `barry-coach-section` and `barryReconInterview` Netlify functions.
- **Five-layer analysis:** Recommendation layer — coaching advice. Also Prepared Action — suggested section content.
- **Skills/Workflows support:** None.
- **Status:** Working.
- **Direct-call violations:** Component directly calls coaching functions. **Violation.**

### Surface 9: Hunter Barry Surfaces (Multiple)

- **Components:** `BarryInsightsCard.jsx`, `BarryReasoningDisplay.jsx`, `BarryRecommendationCard.jsx`, `BarryReplyCard.jsx`, `BarryWarningCard.jsx`, `StepApprovalCard.jsx`
- **File path:** `src/components/hunter/` (all)
- **Module:** Hunter
- **Barry's role:** Multiple display cards showing Barry's reasoning, recommendations, warnings, and reply analysis during Hunter missions.
- **Context passed:** Mission data, step data, contact data.
- **Data sources:** Mission documents, contact documents, step outcomes.
- **Conversation store:** None — display components.
- **Actions:** Step approval triggers `barryHunterGenerateStep`. Reply analysis via `barryHunterCardRead`.
- **Five-layer analysis:** Mixes Awareness (reasoning display), Recommendation (next step cards), and Prepared Action (step content).
- **Skills/Workflows support:** The Hunter mission sequence is the closest thing to a Workflow in the current codebase — it chains steps. But it's hard-coded, not composable.
- **Status:** Working.
- **Direct-call violations:** **Yes.** Step generation and approval directly call Barry functions.

### Surface 10: Scout Barry ICP Panel (BarryICPPanel)

- **Component:** `BarryICPPanel.jsx`
- **File path:** `src/components/scout/BarryICPPanel.jsx`
- **Module:** Scout
- **Barry's role:** ICP evaluation and company scoring in Scout module.
- **Context passed:** Company data, ICP profile.
- **Data sources:** Company documents, ICP profiles.
- **Conversation store:** None.
- **Actions:** Calls ICP-related scoring and evaluation.
- **Five-layer analysis:** Recommendation (ICP fit assessment).
- **Skills/Workflows support:** None.
- **Status:** Working.
- **Direct-call violations:** **Yes** — directly calls scoring functions.

### Surface 11: Admin Barry Conversations View

- **Component:** `BarryConversationsView.jsx`
- **File path:** `src/components/admin/BarryConversationsView.jsx`
- **Module:** Admin Dashboard
- **Barry's role:** Admin view of all Barry conversations across users. Debugging/monitoring surface.
- **Context passed:** Admin context.
- **Data sources:** Cross-user Barry conversation data via Admin SDK.
- **Conversation store:** Reads from all users' `barryConversations` subcollections.
- **Actions:** Read-only admin viewing.
- **Five-layer analysis:** N/A — admin/observability surface.
- **Skills/Workflows support:** N/A.
- **Status:** Working.
- **Direct-call violations:** None.

### Surface 12: Onboarding Barry (BarryOnboarding, BarryTyping)

- **Component:** `BarryOnboarding.jsx`, `BarryTyping.jsx`
- **File path:** `src/pages/Onboarding/BarryOnboarding.jsx`, `src/components/onboarding/BarryTyping.jsx`
- **Module:** Onboarding flow
- **Barry's role:** Guided onboarding experience where Barry walks the user through initial setup.
- **Context passed:** Onboarding step state.
- **Data sources:** Onboarding state, user profile.
- **Conversation store:** In-memory only.
- **Actions:** Onboarding step completion, ICP initial setup.
- **Five-layer analysis:** Recommendation (guidance).
- **Skills/Workflows support:** None.
- **Status:** Working.
- **Direct-call violations:** None.

### Surface 13: Barry Session History Panel

- **Component:** `BarrySessionHistoryPanel.jsx`
- **File path:** `src/components/barry/BarrySessionHistoryPanel.jsx`
- **Module:** Contact Profile
- **Barry's role:** Displays historical Barry sessions for a contact — past conversations, outcomes, messages generated.
- **Context passed:** Contact ID, user ID.
- **Data sources:** `users/{userId}/contacts/{contactId}/barry_sessions` subcollection.
- **Conversation store:** Reads historical sessions — does not create.
- **Actions:** Read-only.
- **Five-layer analysis:** Awareness (historical state display).
- **Skills/Workflows support:** None.
- **Status:** Working.
- **Direct-call violations:** None.

### Surface Summary

| Surface | Module | Layers Mixed | Skills/Workflows | Direct-Call Violation | Status |
|---|---|---|---|---|---|
| Global Barry Drawer | Global | Rec + Prepared | Neither | Mild (action execution) | Working |
| MC Barry Chat Panel | Mission Control | All five | Neither | Partial (embedded recs) | Working |
| Morning Brief | Mission Control | Aware + Rec + Signal | None | None | Working |
| Barry Insight Panel | Contact | Aware + Rec | None | None | Working |
| Barry Context | Contact | Awareness | None | None | Working |
| Barry Briefing | Contact | Prepared + Aware | Conceptual Skill | Mild | Working |
| Engagement Panels (5) | Per-module | Rec + Prepared + Exec | None | **Yes** | Working |
| Recon Coach | Recon | Rec + Prepared | None | **Yes** | Working |
| Hunter Barry Cards (6) | Hunter | Aware + Rec + Prepared | Proto-Workflow | **Yes** | Working |
| Scout ICP Panel | Scout | Recommendation | None | **Yes** | Working |
| Admin Conversations | Admin | N/A | N/A | None | Working |
| Onboarding Barry | Onboarding | Recommendation | None | None | Working |
| Session History | Contact | Awareness | None | None | Working |

**Key Finding:** 13 distinct Barry surfaces exist. All are working. 7 out of 13 have direct-call violations where business logic invokes Barry functions directly rather than publishing signals. Zero surfaces support composable Skills or Workflows. Every surface uses single-capability request-response patterns.

---

## Step 2 — Barry Service, Function, Skill, and Workflow Inventory

### Netlify Functions (Server-Side AI Endpoints)

| Function | File | Purpose | Model | max_tokens | Layer | Duplicates | AI-for-Deterministic |
|---|---|---|---|---|---|---|---|
| barryMissionChat | netlify/functions/barryMissionChat.js | Main Barry chat interface for Mission Control and drawer | claude-haiku-4-5 | 600-2000 | Rec + Prepared | Core chat — no duplicate | No |
| barryOrientationBrief | netlify/functions/barryOrientationBrief.js | Morning brief / orientation message generation | claude-haiku-4-5 | 300 | Aware + Rec | Overlaps with barryMissionChat opening brief | No |
| barryHunterProcessEngage | netlify/functions/barryHunterProcessEngage.js | Full Hunter engagement flow — 4-angle message generation | claude-haiku-4-5 | 2500 | Prepared | Overlaps generate-engagement-message | Partial |
| barryHunterGenerateStep | netlify/functions/barryHunterGenerateStep.js | Generate next step in Hunter mission sequence | claude-haiku-4-5 | 2500 | Prepared | Overlaps barryGenerateSequenceStep | Yes — partial |
| barryHunterCardRead | netlify/functions/barryHunterCardRead.js | Short insight read for Hunter contact card | claude-haiku-4-5 | 60 | Awareness | Unique | No |
| barryICPConversation | netlify/functions/barryICPConversation.js | ICP clarification conversational flow (multi-mode) | claude-sonnet-4-5 | 500-1500 | Rec + Prepared | Unique | No |
| barryGenerateContext | netlify/functions/barryGenerateContext.js | Generate engagement context for a contact | claude-sonnet-4-5 | 1500 | Awareness | Overlaps barryContextStack (client) | No |
| barryGenerateMissionSequence | netlify/functions/barryGenerateMissionSequence.js | Generate full multi-step mission sequence | claude-sonnet-4-5 | 1800 | Prepared | Related to barryHunterGenerateStep | No |
| barryGenerateSequenceStep | netlify/functions/barryGenerateSequenceStep.js | Generate individual mission step | claude-sonnet-4-5 | 1000 | Prepared | Overlaps barryHunterGenerateStep | Yes |
| barryGenerateTemplate | netlify/functions/barryGenerateTemplate.js | Generate message template | claude-3-5-haiku | 1500 | Prepared | Overlaps generate-campaign-messages | Yes |
| barryFirstTouch | netlify/functions/barryFirstTouch.js | Generate first outreach message for new contact | claude-haiku-4-5 | 800 | Prepared | Overlaps barryOutreachMessage | Yes |
| barryOutreachMessage | netlify/functions/barryOutreachMessage.js | Generate outreach message | claude-sonnet-4-6 | 300 | Prepared | Overlaps barryFirstTouch | Yes |
| barryEnrich | netlify/functions/barryEnrich.js | AI-powered contact/company enrichment | Mixed | Various | Signal + Aware | Overlaps enrichContact/enrichCompany | Partial |
| barryDossierBriefing | netlify/functions/barryDossierBriefing.js | Generate meeting prep dossier | claude-sonnet-4-6 | 200 | Prepared | Unique | No |
| barryCSMRead | netlify/functions/barryCSMRead.js | CSM health read generation | claude-sonnet-4-6 | 150 | Awareness | Unique | No |
| barryActions | netlify/functions/barryActions.js | Execute Barry-suggested actions | claude-haiku-4-5 | 400 | Executed | Unique | Partial |
| barryBulkPersonalize | netlify/functions/barryBulkPersonalize.js | Bulk personalize messages for campaign | Mixed | 300 | Prepared | Overlaps generate-campaign-messages | Yes |
| barryValidateContact | netlify/functions/barryValidateContact.js | AI validation of contact data quality | claude-sonnet-4-5 | N/A | Signal | Unique | **Yes** — validation rules should be deterministic |
| barryReconInterview | netlify/functions/barryReconInterview.js | Real-time Recon section coaching | claude-haiku-4-5 | 300 | Recommendation | Overlaps barry-coach-section | Yes |
| barryReconSection0 | netlify/functions/barryReconSection0.js | Recon Section 0 generation | claude-haiku-4-5 | 500 | Prepared | Unique | No |
| barryPipelineAction | netlify/functions/barryPipelineAction.js | Pipeline stage actions | N/A | N/A | Executed | Unique | Partial |
| barryOutcomeAttribution | netlify/functions/barryOutcomeAttribution.js | Attribution of outcomes to Barry advice | N/A | N/A | Signal | Unique | **Yes** — attribution linking is deterministic |
| barry-coach-section | netlify/functions/barry-coach-section.js | Recon section coaching | claude-sonnet-4-6 | 800 | Recommendation | Overlaps barryReconInterview | Yes |
| barry-approve-send | netlify/functions/barry-approve-send.js | Approve and send Barry-drafted message | N/A | N/A | Executed | Unique | **Yes** — send logic is deterministic |
| barry-test-message | netlify/functions/barry-test-message.js | Test Barry message generation | N/A | N/A | Prepared | Testing utility | N/A |
| process-barry-queue | netlify/functions/process-barry-queue.js | Process queued Barry actions | N/A | N/A | Executed | Unique | Mixed |
| process-barry-inbox-queue | netlify/functions/process-barry-inbox-queue.js | Process incoming reply analysis | N/A | N/A | Signal | Unique | No |

### Non-Barry AI Functions (generate-* family)

| Function | Model | max_tokens | Purpose | Overlaps Barry? |
|---|---|---|---|---|
| generate-section-1 through generate-section-10 | claude-sonnet-4 | Various | RECON section generation | No — distinct purpose |
| generate-all-reports | claude-sonnet-4 | Various | Batch RECON report generation | No |
| generate-campaign-messages | claude-sonnet-4-5 | Various | Campaign message generation | **Yes** — overlaps barryBulkPersonalize, barryGenerateTemplate |
| generate-engagement-message | claude-sonnet-4-5 | Various | Engagement message generation | **Yes** — overlaps barryHunterProcessEngage, barryOutreachMessage |
| generate-followup | claude-sonnet-4-5 | Various | Follow-up message generation | **Yes** — overlaps barryFirstTouch |
| generate-text-messages | N/A | Various | SMS message generation | Unique |
| generate-icp-brief | claude-sonnet-4 | Various | ICP brief generation | No |
| analyze-website | Various | Various | Website analysis for enrichment | No |
| inferRelationshipWarmth | N/A | N/A | Infer warmth from signals | **Yes** — overlaps barryValidateContact |

### Client-Side Services

| Service | File | Purpose | Layer |
|---|---|---|---|
| barryMemoryService | src/services/barryMemoryService.js | Memory CRUD — contact memory, user memory, session management, context assembly, outcome recording, brigade transitions | All five layers |
| barryCSM | src/services/barryCSM.js | CSM-specific context builder, health reads, expansion/churn signal detection | Signal + Awareness |
| barryContextStore | src/context/barryContextStore.js | Lightweight pub/sub context store for Barry drawer | Context (session) |
| barryContextStack | src/utils/barryContextStack.js | Full context stack builder for Mission Control — contacts, missions, RECON, calendar | Context assembly |
| recommendationEngine | src/utils/recommendationEngine.js | Client-side recommendation derivation from Firestore data | Recommendation |
| nextBestStepService | src/services/nextBestStepService.js | Next Best Step derivation, confirmation, completion | Recommendation + Prepared |
| healthScore | src/services/healthScore.js | Deterministic health score computation | Awareness (computed) |
| referralIntelligenceService | src/services/referralIntelligenceService.js | Referral network analysis and scoring | Awareness + Recommendation |
| outreachService | src/services/outreachService.js | Outreach management and execution | Executed Action |

### Key Finding: Duplication Map

**Message Generation — 6 implementations:**
1. `barryHunterProcessEngage` (Hunter 4-angle flow)
2. `barryOutreachMessage` (Generic outreach)
3. `barryFirstTouch` (First contact)
4. `barryBulkPersonalize` (Bulk campaign)
5. `generate-engagement-message` (Legacy engagement)
6. `generate-campaign-messages` (Legacy campaign)

**Mission Step Generation — 3 implementations:**
1. `barryHunterGenerateStep`
2. `barryGenerateSequenceStep`
3. `barryGenerateMissionSequence`

**Recon Coaching — 2 implementations:**
1. `barry-coach-section`
2. `barryReconInterview`

**Context Assembly — 2 implementations:**
1. `barryGenerateContext` (server-side)
2. `barryContextStack.js` (client-side)

**Total AI Netlify functions:** 37
**Total lines of AI function code:** 14,350+
**Functions with duplication:** 12 (32%)

---

## Step 3 — Barry Context, Memory, and Awareness Audit

### Context Implementations

**1. barryContextStore (Client — Global)**
- **File:** `src/context/barryContextStore.js`
- **Type:** Session Memory
- **Scope:** Module-level, global singleton
- **Fields:** Arbitrary key-value pairs set by each module page on mount
- **Writers:** Each module page via `setBarryContext()` on mount
- **Readers:** `BarryTrigger` via `useBarryContext()` hook
- **Issues:** Context is merged (not replaced) — stale context from previous modules can bleed into current module. Cleared only on explicit `clearBarryContext()` call. **Cross-module contamination risk.**

**2. barryContextStack (Client — Mission Control)**
- **File:** `src/utils/barryContextStack.js`
- **Type:** Aggregated context assembly (mixes all memory types)
- **Scope:** User-level, built on Mission Control mount
- **Fields:** contacts (up to 500), missions, recon (confidence + sections), icpProfile, serviceProfiles, calendarEvents, user_style, timestamp
- **Writers:** Built from Firestore queries on each mount
- **Readers:** `BarryChatPanel` — sent with every chat message
- **Issues:** Loads ALL contacts up to 500. No filtering by relevance. Entire payload sent to every AI call. RECON sections truncated to 300 chars. **Cached 5 min in sessionStorage** — cache key is per-user, handles impersonation. No cache invalidation on data change.

**3. barry_memory (Firestore — Per Contact)**
- **File:** Defined in `src/schemas/peopleSchema.js`, managed by `src/services/barryMemoryService.js`
- **Type:** Relationship Memory
- **Scope:** Contact-scoped
- **Fields:** who_they_are, current_goal, relationship_summary, what_has_been_tried[], what_has_worked[], what_has_not_worked[], tone_preference, channel_preference, last_updated_at, known_facts[], context_by_session{}
- **Writers:** `barryMemoryService.updateContactMemory()`, `addKnownFact()`, `setWhoTheyAre()`, `recordEngagementOutcome()`
- **Readers:** `assembleBarryContext()`, `loadContactMemory()`, engagement panels, insight panels
- **Issues:** Arrays are bounded (MAX_KNOWN_FACTS=30, MAX_WHAT_HAS_BEEN_TRIED=20). Old entries dropped FIFO. No compression or summarization of dropped entries — **information is silently lost**. `context_by_session` is an object keyed by sessionId with no structure — grows unbounded before being capped at 20.

**4. User Barry Memory (Firestore — Per User)**
- **File:** Managed by `barryMemoryService.js`
- **Type:** User Memory (Learned Intelligence)
- **Path:** `users/{userId}/barry_memory`
- **Fields:** preferred_tone, preferred_channel, tone_usage{}, channel_usage{}, channel_reply_rates{}, total_sessions, last_session_at, last_updated_at
- **Writers:** `updateUserBarryMemory()`
- **Readers:** `loadUserBarryMemory()`, `assembleBarryContext()`
- **Issues:** Only tracks tone and channel preferences. **No user ICP preferences, no business goals, no operating preferences, no communication style.** These exist elsewhere (icpProfiles, companyProfile, communicationStyle on dashboards document) but are not consolidated into Barry's user memory.

**5. Barry Sessions (Firestore — Per Contact)**
- **File:** Managed by `barryMemoryService.js`
- **Path:** `users/{userId}/contacts/{contactId}/barry_sessions/{sessionId}`
- **Type:** Conversation/Session Memory
- **Fields:** started_at, ended_at, status, brigade_at_start, goal, channel_attempted, channel_blocked, channel_pivot, generated_messages[], selected_message_id, sent_message_id, barry_questions[], context_used{}, session_summary, proposed_nbs, outcome
- **Writers:** `startBarrySession()`, `addGeneratedMessage()`, `markMessageAction()`, `closeBarrySession()`
- **Readers:** `loadRecentSessions()` (loads 3-5 most recent)
- **Issues:** Per-contact sessions only. **No global session log.** Mission Control conversations stored separately in `barryConversations/missionControl`. No cross-referencing between contact sessions and global sessions. Session memory contamination into relationship memory is **partially controlled** — `closeBarrySession()` explicitly updates `barry_memory` from session data, which means session outcomes DO become durable memory. This is intentional for outcomes but means every session summary appends to `relationship_summary` with no summarization. **Risk of unbounded growth.**

**6. Barry Conversations (Firestore — Per Module)**
- **Path:** `users/{userId}/barryConversations/{drawer_module | missionControl}`
- **Type:** Conversation/Session Memory
- **Fields:** messages[], conversationHistory[], mode, updatedAt
- **Writers:** `BarryChat.jsx`, `BarryChatPanel.jsx`
- **Readers:** Same components on mount (resume prior session)
- **Issues:** One document per module key. Messages capped at 30, conversationHistory at 20. **Separate from barry_sessions** — these are drawer chat histories, not engagement session records. Two different session memory systems that do not cross-reference.

**7. Engagement Summary (Firestore — Per Contact)**
- **Path:** `users/{userId}/contacts/{contactId}` (field: `engagement_summary`)
- **Type:** Derived Awareness (denormalized stats)
- **Fields:** total_sessions, total_messages_generated, total_messages_sent, total_attempts, replies_received, positive_replies, first_contact_at, last_contact_at, last_message_channel, last_outcome, consecutive_no_replies, channel_history{}
- **Writers:** `updateEngagementSummary()`, `recordEngagementOutcome()`
- **Readers:** `assembleBarryContext()`, engagement panels, recommendation engine
- **Issues:** Denormalized from timeline events. No automated reconciliation if counters drift. **The closest thing to Relationship Awareness** in the current system.

**8. Engage State (Firestore — Per Contact)**
- **Path:** `users/{userId}/contacts/{contactId}` (field: `engage_state`)
- **Type:** Relationship Awareness (current state)
- **Fields:** status, last_session_at, current_goal, preferred_channel, channel_blocked, last_barry_session{summary, outcome, next_step, sessionId}
- **Writers:** `startBarrySession()`, `closeBarrySession()`
- **Readers:** Engagement panels, context assembly
- **Issues:** Tightly coupled to Barry session lifecycle. Status values: 'never_engaged', 'in_progress', 'awaiting_reply', 'paused'. **This is the closest thing to a Relationship Awareness projection** but it only tracks engagement state, not broader relationship state.

### Memory Type Mapping

| Memory Type (Proposed) | Current Implementation | Coverage |
|---|---|---|
| User Memory | User Barry Memory (partial) + ICP profiles + communicationStyle + companyProfile | **Fragmented.** Exists across 4+ Firestore locations. No unified representation. |
| Relationship Memory | barry_memory (per contact) + engage_state + engagement_summary | **Exists but split.** Three separate objects on the contact document. Reasonably consistent. |
| Mission Memory | Mission documents + step outcomes + barry_reasoning | **Exists but module-specific.** Only within Hunter missions. No cross-mission memory. |
| Learned Intelligence | User Barry Memory (tone/channel usage only) + barry_attributions subcollection | **Minimal.** Only learns tone and channel preferences. Attribution data exists but is not fed back into future recommendations. |
| Conversation/Session Memory | barry_sessions + barryConversations | **Two separate systems.** Contact-level sessions and module-level drawer conversations are not connected. |

### Awareness Projection Analysis

| Projection | Currently Exists? | Evidence |
|---|---|---|
| Relationship Awareness | **Partial.** | `engage_state` tracks per-contact engagement state. `engagement_summary` tracks aggregate stats. `barry_memory` stores relationship history. But these are per-contact fragments, not a unified relationship awareness projection. No cross-contact view. |
| Business Awareness | **Does not exist.** | The closest equivalent is `barryOrientationBrief` which computes pipeline stats at query time. No persistent business awareness state. `recommendationEngine` derives recommendations ad hoc but does not maintain awareness. |
| Mission Awareness | **Does not exist.** | Mission progress is stored on mission documents but not aggregated into an awareness projection. Barry learns about missions only through the context stack sent with each chat message. |
| User Awareness | **Minimal.** | User Barry Memory tracks tone and channel preferences only. Does not track approval patterns, timing preferences, communication style preferences. No behavioral learning beyond engagement statistics. |

### Critical Questions Answered

**How many distinct Barry context implementations exist?** Eight (8). Listed above. Three are primary context assembly paths (barryContextStore, barryContextStack, assembleBarryContext).

**Does a Think layer currently exist?** **No.** Barry jumps directly from context assembly to output generation. The barryMissionChat function receives context and generates a response in a single AI call. There is no intermediate synthesis, priority comparison, or strategy selection step. The `determineBarryMode()` function in barryMissionChat is the closest equivalent — it switches between PRIORITIZE, SUGGEST, and GROWTH modes based on simple heuristics (urgent items → PRIORITIZE, no missions → GROWTH, else → SUGGEST). This is a routing decision, not reasoning.

**Does a derived awareness / state layer currently exist?** **Partially.** `engagement_summary` and `engage_state` on each contact are derived awareness fields. `healthScore.js` computes health scores deterministically. `recommendationEngine.js` derives recommendations from data. But these are computed ad hoc per query — there is no persistent awareness layer that updates when signals arrive.

**Where does context get lost when the user navigates between modules?** Context is lost in the `barryContextStore` pub/sub singleton. When a user navigates from Scout to Hunter, the Scout page unmounts and may call `clearBarryContext()`, losing Scout context. The new module page sets its own context. If the Barry drawer was open with Scout context and the user navigates, the drawer may still hold stale merged context. The `barryContextStack` (Mission Control) is isolated and does not share with the drawer.

**Does session memory currently contaminate relationship or user memory?** **Yes, intentionally but without controls.** `closeBarrySession()` writes session outcomes directly into `barry_memory` (relationship memory) and `updateUserBarryMemory()` (user memory). Session summaries append to `relationship_summary` without summarization. There is no gate preventing conversational noise from becoming durable memory. Every session end writes to memory regardless of session quality.

**Do any of the four awareness projections currently exist?** **Only Relationship Awareness exists in partial form** (engage_state + engagement_summary + barry_memory per contact). The other three (Business, Mission, User) do not exist as persistent projections.

---

## Step 4 — Signal and Data Source Audit

### Data Sources in the Platform

| Source | Collection/Integration | What Barry Can See | What Barry Cannot See |
|---|---|---|---|
| Contacts | `users/{uid}/contacts` | All contact fields, barry_memory, engage_state, engagement_summary | Timeline subcollection (requires separate query) |
| Companies | `users/{uid}/companies` | Company data, status, swipe feedback, barryFeedback scores | Company enrichment history |
| Missions | `users/{uid}/missions` | Active missions, steps, outcomes | Archived missions |
| RECON | `dashboards/{uid}` | RECON sections (truncated to 300 chars), confidence score | Full section data |
| ICP Profiles | `users/{uid}/icpProfiles` | Active ICP profile, messaging, filters | Profile history/versions |
| Gmail | `gmail-*` Netlify functions | Send emails, poll replies, get threads | Real-time inbox (poll-based only) |
| Calendar | `calendar-*` Netlify functions | Upcoming events, attendee matching | Calendar availability, recurring patterns |
| Apollo | `search-companies`, `searchPeople`, `enrichContact/Company` | Company search, people search, contact enrichment | API usage limits, credit balance |
| LinkedIn | `import-linkedin-connections`, `findContactByLinkedInUrl` | Connection import, profile lookup | Real-time activity, messages, engagement |
| Stripe | `stripe-webhook`, `create-checkout-session` | Subscription status | Payment history details |
| Service Profiles | `users/{uid}/serviceProfiles` | Service/product descriptions | N/A |
| Notifications | `users/{uid}/notifications` | Barry-generated notifications | User notification preferences |
| Barry Sessions | `contacts/{cid}/barry_sessions` | Past session records | Cross-contact session correlation |
| Barry Conversations | `users/{uid}/barryConversations` | Module-level chat histories | Cross-module conversation correlation |
| API Logs | `apiLogs` | API usage tracking | Real-time cost data |

### Signal Map

| Event | Barry Knows | Partially Knows | Blind To |
|---|---|---|---|
| contact.reply_received | | X (via gmail-poll-replies, periodic) | Real-time notification |
| contact.email_sent | X (recorded at send time) | | |
| contact.status_changed | X (contact_status field updated) | | Change reason/trigger |
| contact.meeting_booked | | X (calendar events matched to contacts) | Unmatched meetings |
| contact.added_to_campaign | | X (active_mission_id on contact) | Campaign assignment history |
| campaign.step_completed | X (mission step outcomes) | | Step-level analytics |
| campaign.goal_achieved | | | X — No goal completion detection |
| scout.company_discovered | X (companies collection, status field) | | Discovery source details |
| scout.company_accepted | X (barryFeedback score, status='accepted') | | Acceptance reasoning history |
| reinforcement.followup_due | | X (next_best_step.due_at) | Cross-contact follow-up coordination |
| reinforcement.email_sent | X (outreach service records) | | Delivery confirmation |
| mission.created | X (mission document exists) | | Creation context/intent |
| mission.stage_changed | X (step status tracking) | | Stage change reasoning |
| company.enriched | X (enrichment_provenance on contact) | | Enrichment freshness/staleness |
| contact.enriched | X (enrichment_steps, enrichment_summary) | | Re-enrichment triggers |
| calendar.meeting_today | X (calendar-list-events function) | | Meeting prep status |
| calendar.meeting_created | | X (only visible via calendar poll) | Real-time creation event |
| contact.warmth_changed | X (warmth_level field + source tracking) | | Historical warmth trajectory |
| contact.brigade_changed | X (brigade_history array) | | Brigade transition reasoning history |
| email.opened | X (track-open function) | | Open frequency/patterns |
| email.bounced | X (engagement_summary.last_outcome) | | Bounce reason details |
| nbs.confirmed | X (next_best_step.user_confirmed) | | Confirmation timing patterns |
| nbs.dismissed | X (next_best_step.status='dismissed') | | Dismissal reasoning |

**Key Finding:** Barry is **blind to real-time events**. All signal awareness is either poll-based (Gmail replies checked periodically) or computed at query time. There is no event bus, no webhook-driven signal processing, no real-time awareness update. Barry learns about changes only when a surface is loaded and data is re-queried.

**No normalized event format exists.** Each data source writes to its own Firestore collection with its own schema. There is no `Signal` object, no event log, no signal bus.

---

## Step 5 — Duplicate Implementation Audit

| Capability | Implementation 1 | Implementation 2 | Implementation 3+ | Disposition |
|---|---|---|---|---|
| **Message Generation** | `barryHunterProcessEngage` (4-angle, Haiku) | `barryOutreachMessage` (single, Sonnet) | `barryFirstTouch`, `generate-engagement-message`, `generate-campaign-messages`, `barryBulkPersonalize` | **Consolidate into WriteEmailSkill.** barryHunterProcessEngage is most complete. Others should call a shared skill with different parameters. |
| **Step Generation** | `barryHunterGenerateStep` (Haiku) | `barryGenerateSequenceStep` (Sonnet) | `barryGenerateMissionSequence` (full sequence) | **Consolidate.** barryHunterGenerateStep and barryGenerateSequenceStep do the same thing at different quality levels. Merge into GenerateStepSkill with model selection parameter. |
| **Recon Coaching** | `barry-coach-section` (Sonnet, 800 tokens) | `barryReconInterview` (Haiku, 300 tokens) | — | **Keep barry-coach-section, delete barryReconInterview.** coach-section is more capable. |
| **Context Assembly** | `barryContextStack.js` (client, 500 contacts) | `barryGenerateContext` (server, focused) | `assembleBarryContext()` in barryMemoryService (per-contact) | **Consolidate.** Client-side context stack should not exist — context assembly should be server-side only. Single context resolution service. |
| **Contact Enrichment** | `barryEnrich` (AI-powered) | `enrichContact` (Apollo) | `enrichCompany` (Apollo + Google) | **Keep all three — different data sources.** But consolidate the orchestration into an EnrichContactWorkflow that chains them. |
| **Warmth Inference** | `inferRelationshipWarmth` (function) | Barry inline inference in barryHunterProcessEngage | barry_warmth_suggestion field on contact | **Consolidate into InferRelationshipSkill.** Currently three separate warmth inference paths with no consistency guarantee. |
| **Validation** | `barryValidateContact` (AI, Sonnet) | Deterministic field validation in schemas | — | **Replace with deterministic validation.** Contact validation (email format, required fields, duplicate detection) does not need AI. |
| **Outcome Attribution** | `barryOutcomeAttribution` (function) | Inline attribution in barryMemoryService | — | **Consolidate into single attribution path.** Currently both the Netlify function and client service can write attribution data. |

**Total duplicated capabilities:** 8
**Recommended consolidation:** 6 merges, 1 replacement, 1 deletion

---

## Step 6 — Cost Baseline

### AI API Call Inventory

| Function | Model | Est. Input Tokens | Est. Output Tokens | Trigger | Cached | Frequency (per user/day) |
|---|---|---|---|---|---|---|
| barryMissionChat | Haiku 4.5 | ~3,000 | 600-2,000 | User action | No | 5-20 (estimated) |
| barryOrientationBrief | Haiku 4.5 | ~2,000 | 300 | Auto on MC load | 10 min client cache | 1-3 |
| barryHunterProcessEngage | Haiku 4.5 | ~2,500 | 2,500 | User action | No | 2-10 |
| barryHunterGenerateStep | Haiku 4.5 | ~1,500 | 2,500 | User action | No | 1-5 |
| barryHunterCardRead | Haiku 4.5 | ~800 | 60 | Auto on card render | No | 5-20 |
| barryICPConversation | Sonnet 4.5 | ~3,000 | 500-1,500 | User action | No | 0-5 |
| barryGenerateContext | Sonnet 4.5 | ~2,000 | 1,500 | User action | No | 0-3 |
| barryGenerateMissionSequence | Sonnet 4.5 | ~2,500 | 1,800 | User action | No | 0-2 |
| barryGenerateSequenceStep | Sonnet 4.5 | ~1,500 | 1,000 | User action | No | 0-3 |
| barryGenerateTemplate | Haiku 3.5 | ~1,000 | 1,500 | User action | No | 0-2 |
| barryFirstTouch | Haiku 4.5 | ~1,200 | 800 | User action | No | 1-5 |
| barryOutreachMessage | Sonnet 4.6 | ~1,500 | 300 | User action | No | 1-5 |
| barryEnrich | Mixed | ~2,000 | Variable | User action | No | 0-5 |
| barryDossierBriefing | Sonnet 4.6 | ~1,500 | 200 | User action | No | 0-2 |
| barryCSMRead | Sonnet 4.6 | ~1,000 | 150 | User action | No | 0-3 |
| barryActions | Haiku 4.5 | ~800 | 400 | User action | No | 0-2 |
| barryBulkPersonalize | Mixed | ~500 per msg | 300 per msg | User action | No | 0-1 (batch) |
| barryValidateContact | Sonnet 4.5 | ~1,000 | N/A | Auto | No | 0-5 |
| barryReconInterview | Haiku 4.5 | ~1,000 | 300 | User action | No | 0-5 |
| barryReconSection0 | Haiku 4.5 | ~800 | 500 | User action | No | 0-1 |
| barry-coach-section | Sonnet 4.6 | ~1,500 | 800 | User action | No | 0-5 |
| generate-section-1 to -10 | Sonnet 4 | ~2,000 each | ~1,000 each | User action | No | 0-1 each |
| generate-campaign-messages | Sonnet 4.5 | ~1,500 | Variable | User action | No | 0-2 |
| generate-engagement-message | Sonnet 4.5 | ~1,500 | Variable | User action | No | 0-3 |
| generate-followup | Sonnet 4.5 | ~1,500 | Variable | User action | No | 0-3 |

### Cost Analysis

**Classification:** All frequency estimates are **estimated** based on code analysis. No runtime metrics, no APM, no token counting infrastructure exists. The `logApiUsage` utility logs to Firestore but tracks Apollo API credits, not Anthropic token usage.

**Estimated daily cost per active user (moderate usage):**
- Haiku 4.5 calls: ~30-60 calls × ~3,500 avg tokens = 105K-210K tokens/day
- Sonnet calls: ~5-15 calls × ~3,500 avg tokens = 17.5K-52.5K tokens/day
- Estimated cost: $0.10-0.50/user/day (Haiku) + $0.15-0.50/user/day (Sonnet) = **$0.25-1.00/user/day**

**Highest-cost and most redundant calls:**
1. **barryHunterProcessEngage** — 2,500 output tokens per call, high frequency. Generates 4 message angles every time.
2. **barryMissionChat** — Called on every chat message with full context stack (500 contacts).
3. **Message generation duplication** — 6 separate functions for message generation with no shared infrastructure.
4. **barryHunterCardRead** — Low cost per call (60 tokens) but auto-triggered on every card render. Volume is the issue.

**AI used for deterministic logic:**
1. `barryValidateContact` — Contact validation should be rule-based
2. `barryOutcomeAttribution` — Linking outcomes to advice is a data join, not reasoning
3. `barry-approve-send` — Send approval is a permission check, not AI
4. Mode detection in `barryMissionChat` uses simple heuristics that are already deterministic — the AI call is unnecessary for mode switching

**Caching/batching opportunities:**
1. Orientation brief: Currently cached 10 min client-side. Could be server-cached.
2. Hunter card reads: Could be cached per contact per day.
3. Context stack: Could be server-side with invalidation on data changes instead of rebuilt every 5 min.
4. Message generation: Could batch-generate message templates instead of per-request.

**Observability roadmap needed:**
1. Token counting per function per user per day
2. Latency tracking per AI endpoint
3. Cache hit rate tracking
4. Cost-per-capability dashboard
5. AI-for-deterministic detection in code review

---

## Step 7 — Enterprise Foundation Audit

### 1. Identity and Tenancy

**Current state:** Firebase Authentication provides user identity. Each user has a Firestore path `users/{userId}` that serves as the workspace boundary. Firestore rules enforce `request.auth.uid == userId` for all read/write operations. Impersonation is handled through a dedicated `ImpersonationContext` that wraps `auth.currentUser` with `getEffectiveUser()`.

**Barry OS requirement:** Barry currently receives `userId` as a parameter on every call. There is no explicit workspace or tenant concept — the user IS the tenant. Multi-user workspaces (team accounts) would require a tenant layer above userId. The current architecture assumes single-user workspaces.

**Gap:** No tenant/workspace abstraction. No team-level Barry (Barry that understands a team's shared pipeline). No workspace-scoped signals or awareness.

### 2. Permissions

**Current state:** Firestore rules provide row-level security (users can only access their own data). Netlify functions verify auth tokens against Firebase. No granular permission model for what Barry may do — Barry has the same access as the authenticated user.

**Barry OS requirement:** An autonomy spectrum where each capability class has configurable authorization levels (Observe → Recommend → Prepare → Approval → Autonomous).

**Gap:** No per-capability permission model. No autonomy levels. No policy engine. Barry either can or cannot do something based on whether the Netlify function exists.

### 3. Auditability

**Current state:** `barryOutcomeAttribution` tracks which Barry advice preceded which outcomes. `barryMemoryService` logs session records with generated messages, selected messages, and outcomes. `apiLogs` collection tracks API usage. Brigade transitions are logged with immutable log entries.

**Barry OS requirement:** Every recommendation and action should be explainable after the fact — what signals, what context, what reasoning.

**Gap:** **No prompt logging.** The system prompts sent to Claude are not persisted. After an AI call completes, there is no record of what context was sent or what reasoning was applied. Session records store outcomes but not the full reasoning chain. Recommendations from `recommendationEngine.js` are not logged — they're computed and displayed without recording what was shown to the user.

### 4. Observability

**Current state:** `logApiUsage` tracks API calls to Firestore. Console logging throughout. No structured logging framework. No APM. No distributed tracing. No metrics dashboard.

**Barry OS requirement:** Signals, context assembly, reasoning, and outcomes should be traceable per interaction.

**Gap:** **Minimal observability.** No token usage tracking for Anthropic calls. No latency monitoring. No error rate dashboards. No way to answer "why did Barry recommend X to user Y on date Z."

### 5. Reliability

**Current state:** Netlify functions have built-in retry on timeout. Client-side code uses try/catch with console.error logging and fallback values. `barryContextStack` returns `emptyStack()` on failure. Memory operations are non-blocking (never throw).

**Barry OS requirement:** Graceful degradation when external services fail. Barry should function (at reduced capability) even when Gmail, Apollo, LinkedIn, or the Anthropic API is down.

**Gap:** No circuit breaker pattern. No service health monitoring. No degraded-mode behavior. If the Anthropic API is down, every Barry surface shows "Something went wrong — try again." No offline capability, no cached reasoning, no fallback responses.

### 6. Idempotency

**Current state:** Message sending (gmail-send) does not appear to have idempotency keys. `barryMemoryService` operations use Firestore merge writes which are naturally idempotent for updates. Session creation uses `addDoc` which generates unique IDs. No explicit duplicate prevention for outbound messages.

**Barry OS requirement:** Barry must never send a message twice or execute a duplicated action.

**Gap:** **No idempotency keys on outbound actions.** If a gmail-send call times out and is retried by the Netlify runtime, the email could be sent twice. No deduplication on notification generation. No operation log for side-effect actions.

### 7. Confidence

**Current state:** RECON has a confidence score (`calculateReconConfidence`). Health scores have explicit signal breakdowns. Barry warmth inference tracks source (`barry_inferred` vs `user_set`). `barryFeedback.score` provides ICP fit confidence (1-10).

**Barry OS requirement:** Every uncertain inference should carry a confidence indicator.

**Gap:** **AI-generated recommendations carry no confidence score.** When Barry suggests "Follow up in 2 days," there is no indication of how confident Barry is. Message generation provides 4 angles without ranking by expected effectiveness. Entity matching (calendar attendees to contacts) is best-effort with no confidence output.

### 8. Evaluation

**Current state:** `barryOutcomeAttribution` links outcomes to Barry advice. `engagement_summary` tracks reply rates per channel. User Barry Memory tracks which tones and channels get results. The `inferRelationshipWarmth` function has test coverage.

**Barry OS requirement:** Barry's improvement should be measurable objectively over time.

**Gap:** **No evaluation framework.** There is no A/B testing infrastructure. No baseline metrics for recommendation acceptance rate, message effectiveness, or NBS completion rate. Attribution data exists but is not aggregated into evaluation dashboards. No way to measure whether Barry is getting better or worse over time.

---

## Step 8 — Mission Control Dependency Audit

### Current Mission Control Data Sources

Mission Control (`MissionControlDashboardV2.jsx`) pulls from:

1. **Contacts** — up to 500 via `barryContextStack.buildContextStack()`
2. **Active Missions** — via missions collection query
3. **RECON** — dashboard document with confidence and section data
4. **Calendar** — upcoming meetings matched to contacts
5. **Recommendations** — via `useRecommendations()` hook → `recommendationEngine.js`
6. **Orientation Brief** — via `barryOrientationBrief` Netlify function
7. **Pending Replies** — via `usePendingReplies()` hook
8. **ICP Profile** — active profile for targeting context
9. **Service Profiles** — for Barry's understanding of what the user sells

### Three-Horizon Analysis

#### Horizon 1 — Immediate: What does Aaron need to act on right now?

| Data Point | Currently Exists? | Barry Awareness? | Missing? |
|---|---|---|---|
| Responses needing reply | Yes (gmail-poll-replies, usePendingReplies) | Partial (poll-based, not real-time) | Real-time reply detection. Barry can draft replies but only after polling. |
| Meetings today | Yes (calendar-list-events) | Yes (matched to contacts) | Meeting prep status (has brief been generated?). Pre-meeting context assembly. |
| Urgent follow-ups | Yes (NBS with status=pending, type=follow_up) | Yes (recommendationEngine surfaces these) | Priority ranking across follow-ups. |
| Stalled high-value contacts | Yes (recommendationEngine detects) | Yes (priorityWeight 0-1) | Relationship risk score. |
| Messages awaiting send | Partial (prepared actions in engage_state) | No — Barry does not track unsent drafts globally | Global draft queue. |

**What differs from Scout's dashboard:** Scout's dashboard shows discovered companies and ICP matches. Mission Control should show the cross-module view — what's urgent across all relationships, not just new discoveries.

#### Horizon 2 — Active: What is in motion?

| Data Point | Currently Exists? | Barry Awareness? | Missing? |
|---|---|---|---|
| Campaign/Mission progress | Yes (mission steps, outcomes) | Partial (in context stack) | Aggregated mission health across all active missions. |
| Active relationships | Yes (contacts with engage_state.status != 'never_engaged') | Partial (in context stack but not prioritized) | Relationship trajectory (improving/declining). |
| Pipeline state | Yes (contact_status + lead_status) | Partial (mode detection uses these) | Pipeline velocity metrics. |
| Commitments made | Partial (NBS with status=confirmed) | No persistent tracking | Commitment tracking across relationships. |
| Introductions in progress | Partial (referral_data on contacts) | No | Introduction status tracking. |

#### Horizon 3 — Strategic: What is the bigger picture?

| Data Point | Currently Exists? | Barry Awareness? | Missing? |
|---|---|---|---|
| ICP trends | Partial (swipe feedback, barryFeedback scores) | Partial (loaded in swipeFeedback) | ICP evolution over time. Win/loss pattern analysis. |
| Relationship growth | Partial (engagement_summary stats) | No aggregate view | Network growth rate. Relationship depth trends. |
| Pipeline health | Partial (contact_status distribution) | No | Pipeline stage conversion rates. |
| Partner health | No | No | Partner relationship tracking. |
| Goal progress | Partial (mission timeframe tracking) | No | Cross-mission goal alignment. OKR-level tracking. |

### User Work Concept Mapping

| Concept | Currently Surfaced? | Source | Gap |
|---|---|---|---|
| Needs Response | Yes | usePendingReplies, gmail-poll-replies | Not real-time. No draft-ready indicator. |
| Meeting Today | Yes | calendar-list-events | No prep status. No brief availability indicator. |
| Follow-Up Due | Yes | NBS pending items, recommendationEngine | No cross-contact prioritization. |
| Decision Needed | Partial | NBS pending confirmation | No aggregated decision queue. |
| Relationship at Risk | Yes | recommendationEngine (stalled, dormant) | No risk scoring model. |
| New Opportunity | Partial | Scout discoveries, ICP matches | Not surfaced in Mission Control. |
| Waiting on Someone | Yes | engage_state.status = 'awaiting_reply' | No aging indicator. |
| Goal Progress | Partial | Mission step completion | No aggregated goal tracking. |
| Barry Prepared This | No | — | No prepared action queue visible in MC. |
| Barry Recommends This | Yes | recommendationEngine (5 items) | Limited to 5 recommendations. No explanation depth. |

---

## Step 9 — Integration Readiness Audit

### Current Integrations

#### 1. Gmail Integration
- **Connection:** OAuth 2.0 via `gmail-oauth-init/callback` functions. Token stored in `users/{uid}/integrations/googleCalendar` (shared doc).
- **Capabilities:** Send email (`gmail-send`), send wave (`gmail-send-wave`), send quick (`gmail-send-quick`), poll replies (`gmail-poll-replies`), get thread (`gmail-get-thread`), sync worker (`gmail-sync-worker`).
- **Barry connection:** Barry drafts messages → user approves → `barry-approve-send` → `gmail-send`. Reply polling populates `process-barry-inbox-queue`.
- **Signal production:** Poll-based. No webhook. Replies detected by periodic polling, not real-time events.
- **Normalized event format:** None. Each function writes to its own Firestore fields.

#### 2. Google Calendar Integration
- **Connection:** OAuth 2.0 via `calendar-oauth-init/callback`. Stored in `users/{uid}/integrations/googleCalendar`.
- **Capabilities:** List events (`calendar-list-events`), create event (`calendar-create-event`), disconnect (`calendar-disconnect`).
- **Barry connection:** `barryContextStack` matches calendar events to contacts by email and name. Calendar data included in every Mission Control chat message.
- **Signal production:** Pull-based via `calendar-list-events`. No webhook for new events.
- **Normalized event format:** None.

#### 3. Apollo Integration
- **Connection:** API key in environment variables.
- **Capabilities:** Company search (`search-companies`), people search (`searchPeople`), contact enrichment (`enrichContact`), company enrichment (`enrichCompany`).
- **Barry connection:** Barry can trigger searches via `barryICPConversation` intent. Enrichment feeds into contact/company records that Barry reads.
- **Signal production:** None. Apollo is pull-only.
- **Normalized event format:** None.

#### 4. LinkedIn Integration (Partial)
- **Connection:** CSV import (`import-linkedin-connections`), URL lookup (`findContactByLinkedInUrl`), photo retry (`retryLinkedInPhoto`).
- **Capabilities:** Import connections, resolve LinkedIn profiles, scrape photos.
- **Barry connection:** LinkedIn data enriches contact records. No direct Barry-to-LinkedIn messaging.
- **Signal production:** None.
- **Normalized event format:** None.

#### 5. Stripe Integration
- **Connection:** Webhook (`stripe-webhook`), checkout (`create-checkout-session`).
- **Capabilities:** Subscription management.
- **Barry connection:** None — Barry does not reason about billing.
- **Signal production:** None relevant to Barry.

### Integration Readiness Assessment

**Is there a normalized event format?** **No.** Each integration writes to its own Firestore fields with its own schema. There is no `Signal` type, no event bus, no standardized event envelope.

**Is there a capability registry?** **No.** Barry's capabilities are hard-coded as Netlify functions. There is no registry where integrations declare "through me, Barry can do X." The `MODULE_CONFIG` in BarryChat.jsx is the closest equivalent — it maps modules to Barry modes — but it does not declare capabilities.

**What would it take to add LinkedIn messaging so Barry can use it without rebuilding Barry?**
1. Add LinkedIn OAuth or cookie-based auth integration
2. Create `linkedin-send-message` Netlify function
3. Add `linkedin` as a channel option in the engagement flow
4. Update every engagement panel to support the new channel
5. Update `barryHunterProcessEngage` to include LinkedIn in its prompt
6. Update message generation functions to handle LinkedIn format
7. **Estimated effort: 2-3 sprints. Would require touching 8+ files and functions.**

With Barry OS Signal Bus + Capability Registry:
1. LinkedIn integration publishes `linkedin.connected` signal and registers `send_linkedin_message` capability
2. Barry's capability registry picks up the new channel
3. Barry's message generation skill accepts channel parameter
4. **Estimated effort: 1 sprint. Would require touching 2-3 files.**

**The current architecture requires rebuilding Barry for every new integration.** The proposed architecture makes new integrations additive.

---

## Step 10 — Recommended Barry OS Architecture

### Architecture Validation

The reference architecture is **validated with modifications.** The core structure — Signal Bus → Awareness Layer → Think Layer → Context Resolution → Skills/Workflows → Action Queue — is correct and necessary. Modifications based on findings:

1. **Signal Bus** — Must be implemented. Nothing equivalent exists today. The current architecture has no event system.
2. **Capability Registry** — Must be implemented. No equivalent exists. Capabilities are hard-coded in Netlify functions.
3. **Awareness Layer** — Partially exists (engage_state, engagement_summary, health scores). Needs formalization and persistence.
4. **Think Layer** — Does not exist. Must be built. This is the highest-value addition.
5. **Context Resolution** — Partially exists (3 separate implementations). Must be consolidated.
6. **Memory** — Partially exists (3 of 5 types). User Memory and Learned Intelligence need significant expansion.
7. **Skills/Workflows** — Do not exist. All current capabilities are monolithic functions. Must be decomposed.
8. **Action Queue** — Does not exist. NBS system is the closest equivalent but only handles one step at a time.

### Signal Bus Contract

**Format:** Every platform event should be normalized to:

```
{
  signal_id: string,          // Unique ID
  signal_type: string,        // Namespaced event type
  workspace_id: string,       // User/workspace boundary
  entity_type: string,        // 'contact' | 'company' | 'mission' | 'campaign' | 'meeting' | 'message'
  entity_id: string,          // ID of the affected entity
  source: string,             // 'gmail' | 'calendar' | 'apollo' | 'platform' | 'user_action'
  payload: object,            // Event-specific data
  occurred_at: timestamp,     // When the event happened
  processed_at: timestamp     // When Barry processed it (null if unprocessed)
}
```

**Top 20 Platform Events:**

| # | Signal Type | Source | Priority |
|---|---|---|---|
| 1 | `contact.reply_received` | gmail | Critical |
| 2 | `contact.email_sent` | gmail | High |
| 3 | `contact.email_opened` | track-open | Medium |
| 4 | `contact.email_bounced` | gmail | High |
| 5 | `contact.status_changed` | platform | High |
| 6 | `contact.warmth_changed` | platform/barry | Medium |
| 7 | `contact.added` | platform | Medium |
| 8 | `contact.enriched` | apollo | Low |
| 9 | `meeting.today` | calendar | Critical |
| 10 | `meeting.created` | calendar | Medium |
| 11 | `mission.created` | platform | Medium |
| 12 | `mission.step_completed` | platform | High |
| 13 | `mission.step_sent` | platform | Medium |
| 14 | `mission.deadline_approaching` | platform | High |
| 15 | `company.discovered` | scout | Medium |
| 16 | `company.accepted` | scout | Medium |
| 17 | `company.rejected` | scout | Low |
| 18 | `nbs.confirmed` | user_action | High |
| 19 | `nbs.dismissed` | user_action | Medium |
| 20 | `nbs.overdue` | platform | High |

### Barry Skills Registry

**Current capabilities mapped to named Skills:**

| Skill | Current Implementation(s) | Description |
|---|---|---|
| WriteEmailSkill | barryHunterProcessEngage, barryOutreachMessage, barryFirstTouch, generate-engagement-message, generate-campaign-messages, barryBulkPersonalize | Generate email message in specified tone, angle, and channel |
| ResearchCompanySkill | barryEnrich (company portion), enrichCompany, analyze-website | Research and enrich a company record |
| ResearchContactSkill | barryEnrich (contact portion), enrichContact, findContact | Research and enrich a contact record |
| ScoreICPFitSkill | barryICPConversation (scoring mode), ICPScoring.jsx | Score a company/contact against ICP criteria |
| SummarizeRelationshipSkill | assembleBarryContext (context output), barryContext.jsx | Produce a relationship summary for a contact |
| GenerateMeetingBriefSkill | barryDossierBriefing | Generate a pre-meeting briefing document |
| InferRelationshipStateSkill | inferRelationshipWarmth, barry inline warmth inference | Infer warmth, engagement intent, or relationship state |
| GenerateNextStepSkill | nextBestStepService.deriveNextBestStep | Propose the next best action for a contact |
| DraftFollowUpSkill | generate-followup, barryFirstTouch | Generate a follow-up message based on prior interaction |
| AnalyzeReplySkill | process-barry-inbox-queue, barryInboxAnalyzer | Analyze an incoming reply for sentiment and intent |
| CoachICPSkill | barry-coach-section, barryReconInterview | Provide real-time coaching during ICP/RECON completion |
| GenerateOrientationSkill | barryOrientationBrief | Generate a daily orientation/morning brief |
| ComputeHealthScoreSkill | healthScore.js (deterministic) | Compute health score from engagement signals |
| DetectChurnSignalsSkill | barryCSM.detectChurnSignals (deterministic) | Detect churn risk indicators |
| DetectExpansionSignalsSkill | barryCSM.detectExpansionSignals (deterministic) | Detect expansion/upsell opportunities |

### Barry Workflows Registry

| Workflow | Skills Chained | Current Equivalent |
|---|---|---|
| **PrepareMeetingWorkflow** | ResearchCompanySkill → SummarizeRelationshipSkill → GenerateMeetingBriefSkill | barryDossierBriefing (monolithic) |
| **ReconnectDormantRelationshipWorkflow** | SummarizeRelationshipSkill → InferRelationshipStateSkill → WriteEmailSkill | No equivalent — done manually |
| **LaunchCampaignWorkflow** | ScoreICPFitSkill → ResearchCompanySkill → ResearchContactSkill → WriteEmailSkill | barryICPConversation + barryGenerateMissionSequence (loosely chained via user actions) |
| **QualifyProspectWorkflow** | ResearchCompanySkill → ScoreICPFitSkill → SummarizeRelationshipSkill | barryEnrich + ICPScoring (loosely chained) |
| **ProcessReplyWorkflow** | AnalyzeReplySkill → SummarizeRelationshipSkill → GenerateNextStepSkill → WriteEmailSkill (draft) | process-barry-inbox-queue + manual user action |
| **MorningBriefWorkflow** | ComputeHealthScoreSkill → DetectChurnSignalsSkill → GenerateOrientationSkill | barryOrientationBrief (monolithic with inline computations) |
| **EnrichAndScoreWorkflow** | ResearchCompanySkill → ResearchContactSkill → ScoreICPFitSkill | barryEnrich + ICPScoring (separate calls) |

### Capability Registry Contract

```
{
  capability_id: string,           // 'gmail.send_email'
  capability_name: string,         // 'Send Email via Gmail'
  integration: string,             // 'gmail'
  type: 'generative' | 'side_effect',
  requires_approval: boolean,      // true for side_effects
  parameters: ParameterSchema,     // Input schema
  output: OutputSchema,            // What it returns
  autonomy_level: 'observe' | 'recommend' | 'prepare' | 'approval' | 'autonomous'
}
```

**Generative capabilities** (produce output, no external side effects):
- Generate email draft
- Generate meeting brief
- Research company
- Score ICP fit
- Analyze reply sentiment
- Compute health score

**Side-effect capabilities** (mutate external state):
- Send email via Gmail
- Create calendar event
- Search Apollo for companies
- Search Apollo for people
- Move contact between stages
- Update contact status
- Confirm/dismiss NBS

### Think Layer Specification

**The Think layer does not currently exist.** It must be built between Awareness and Recommendation.

**Inputs:**
- Awareness projections (Relationship, Business, Mission, User)
- Current signals (what just happened)
- User context (what surface they're on, what they asked)
- Memory (all five types)

**Processing:**
1. **Synthesize** — Combine signals across multiple relationships and missions into a unified picture
2. **Compare priorities** — Rank competing demands (respond to high-value reply vs. follow up on overdue NBS vs. prepare for today's meeting)
3. **Weigh tradeoffs** — Consider timing (morning vs afternoon), relationship value (critical vs low), urgency (time-sensitive vs can wait), and user preferences
4. **Choose strategy** — Select the approach (which skill, which workflow, what tone, what angle) based on synthesis

**Outputs:**
- Prioritized recommendation list with confidence scores
- Strategy selection per recommendation (which skill/workflow to invoke)
- Reasoning trace (explainable chain from signals → awareness → synthesis → recommendation)

**Implementation approach:** The Think layer should be a distinct AI call with a structured prompt that receives awareness projections and outputs prioritized recommendations with reasoning. It is NOT the same as the chat response generation. It runs before the response generator, informing what the response should contain.

### Orchestration Model

**"Find me 30 Utah credit unions and prepare outreach" — end to end:**

```
User Request
    │
    ▼
Think Layer
    │ Determines: LaunchCampaignWorkflow with parameters
    │   industry=credit_unions, location=Utah, count=30
    │
    ▼
Orchestrator
    │
    ├── Step 1: ScoreICPFitSkill
    │     Input: industry=credit_unions, location=Utah
    │     Output: ICP scoring criteria for credit unions
    │
    ├── Step 2: ResearchCompanySkill (via Apollo)
    │     Input: search_companies(industry=credit_unions, state=Utah, limit=30)
    │     Output: 30 company records
    │     Capability: apollo.search_companies
    │
    ├── Step 3: ResearchContactSkill (via Apollo) × 30
    │     Input: search_people(company_id, titles=ICP_target_titles)
    │     Output: Contact records per company
    │     Capability: apollo.search_people
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
          Input: 30 prepared outreach messages
          Output: Action items in Morning Brief
          Status: Prepared (awaiting approval)
```

**Current architecture cannot do this.** Today this requires:
1. User manually searches in Scout
2. User manually accepts companies one by one
3. User manually creates a mission per contact
4. Barry generates steps one at a time
5. User approves each step individually

### Four Awareness Projections

**Relationship Awareness:**
- **Persisted fields:** engage_state (current), engagement_summary (aggregate), barry_memory (history), warmth_level, strategic_value
- **Calculated fields:** days_since_last_contact, reply_rate, health_score, momentum_direction
- **Staleness detection:** Compare last_contact_at to current time. Flag if > threshold per warmth level (warm: 7 days, cold: 30 days)
- **Update trigger:** Any signal involving this contact

**Business Awareness:**
- **Persisted fields:** None currently — must be built
- **Proposed:** `users/{uid}/barry_awareness/business` document
- **Fields:** total_active_relationships, relationships_at_risk_count, pipeline_by_stage{}, responses_pending_count, meetings_today_count, nbs_overdue_count, revenue_pipeline_estimate, last_computed_at
- **Update trigger:** Any contact signal, daily recomputation

**Mission Awareness:**
- **Persisted fields:** None currently — must be built
- **Proposed:** `users/{uid}/barry_awareness/missions` document
- **Fields:** active_missions_count, missions_on_track[], missions_at_risk[], missions_stalled[], overall_mission_health_score, last_computed_at
- **Update trigger:** Mission step completion, deadline approaching

**User Awareness:**
- **Persisted fields:** User Barry Memory (tone_usage, channel_usage, channel_reply_rates)
- **Proposed expansion:** approval_patterns{}, peak_activity_hours[], preferred_communication_style, avg_session_duration, recommendation_acceptance_rate, last_computed_at
- **Update trigger:** User action patterns, session completion

### Barry Context Resolution Contract

For any Barry surface, context is assembled as:

```
{
  // Layer 1: Global
  workspace: { id, user, subscription_tier },
  
  // Layer 2: Awareness Projections
  awareness: {
    relationship: AwarenessProjection | null,  // If entity-scoped
    business: BusinessAwareness,
    mission: MissionAwareness,
    user: UserAwareness
  },
  
  // Layer 3: Entity
  entity: {
    type: 'contact' | 'company' | 'mission' | null,
    data: EntityRecord | null,
    memory: RelationshipMemory | MissionMemory | null
  },
  
  // Layer 4: Session
  session: {
    surface: string,           // 'mission_control' | 'drawer_hunter' | 'contact_profile'
    module: string,            // 'hunter' | 'scout' | etc.
    conversation_history: Message[],
    navigation_context: object  // What the user just navigated from
  },
  
  // Layer 5: Temporal
  temporal: {
    time_of_day: string,
    day_of_week: string,
    meetings_today: Meeting[],
    signals_since_last_session: Signal[]
  },
  
  assembled_at: timestamp
}
```

### Barry Memory Architecture

| Memory Type | Storage Location | Retention | Scoping | Session → Durable Gate |
|---|---|---|---|---|
| User Memory | `users/{uid}/barry_memory/user_profile` | Permanent, user-editable | User-scoped | Only through explicit user confirmation or 3+ consistent session patterns |
| Relationship Memory | `contacts/{cid}` → `barry_memory` field | Permanent, summarized quarterly | Contact-scoped | Session outcomes write to memory. Session conversation does NOT write to memory. |
| Mission Memory | `missions/{mid}` → `barry_memory` field (new) | Lifetime of mission + 90 days | Mission-scoped | Step outcomes write to memory. Strategy decisions write to memory. |
| Learned Intelligence | `users/{uid}/barry_memory/learned` | Permanent, versioned | User-scoped | Statistical aggregation only — never single-session writes |
| Session Memory | `users/{uid}/barryConversations/{key}` | 30-day rolling window | Session-scoped | **Must NOT automatically become durable.** Explicit extraction required. |

**Gate between session and durable memory:** Today, `closeBarrySession()` directly writes session data into `barry_memory`. This must be changed. Session memory should be extracted into durable memory only when: (a) an engagement outcome is recorded, (b) the user explicitly confirms a fact, or (c) a pattern is observed across 3+ sessions.

### Action Queue Contract

```
{
  action_id: string,
  workspace_id: string,
  type: 'recommendation' | 'prepared_action' | 'scheduled_action',
  priority: number,           // 0 = critical, 1 = high, 2 = medium, 3 = low
  entity_type: string,
  entity_id: string,
  
  // What
  action_type: string,        // 'send_email' | 'follow_up' | 'review_reply' | etc.
  skill_id: string,           // Which skill prepared this
  workflow_id: string | null,  // Which workflow this belongs to
  
  // Content
  prepared_content: object | null,  // Draft email, briefing, etc.
  reasoning: string,           // Why Barry recommends this
  confidence: number,          // 0.0 - 1.0
  
  // Status
  status: 'queued' | 'presented' | 'approved' | 'executing' | 'completed' | 'dismissed',
  presented_at: timestamp | null,
  decided_at: timestamp | null,
  completed_at: timestamp | null,
  
  // Scheduling
  due_at: timestamp,
  created_at: timestamp,
  expires_at: timestamp | null
}
```

### Barry Artifacts

| Artifact | Description | Current Equivalent | Skills Used |
|---|---|---|---|
| Meeting Brief | Pre-meeting dossier with contact context, relationship history, company intel, talking points | barryDossierBriefing (partial) | ResearchCompanySkill + SummarizeRelationshipSkill + GenerateMeetingBriefSkill |
| Account Plan | Strategic plan for a high-value company relationship | Does not exist | ResearchCompanySkill + SummarizeRelationshipSkill + GenerateNextStepSkill |
| Prospecting List | Scored and ranked list of target companies/contacts | barryICPConversation output (partial) | ScoreICPFitSkill + ResearchCompanySkill + ResearchContactSkill |
| Weekly Review | Summary of week's activity, outcomes, and next week priorities | Does not exist | ComputeHealthScoreSkill + GenerateOrientationSkill |
| Follow-Up Pack | Batch of prepared follow-up messages for overdue contacts | Does not exist | SummarizeRelationshipSkill + WriteEmailSkill (batch) |
| Campaign Playbook | Multi-step outreach strategy for a mission | barryGenerateMissionSequence (partial) | ScoreICPFitSkill + WriteEmailSkill + GenerateNextStepSkill |
| Morning Brief | Daily orientation with priorities, pending items, and prepared work | barryOrientationBrief (exists) | ComputeHealthScoreSkill + DetectChurnSignalsSkill + GenerateOrientationSkill |

### Morning Brief Data Contract

Data required to produce a complete morning briefing **without additional AI calls** (precomputed from awareness projections):

```
{
  // Horizon 1 — Act Now
  responses_pending: [{ contact_id, contact_name, company, reply_preview, received_at, draft_ready: boolean }],
  meetings_today: [{ event_id, title, contact_id, contact_name, start_time, brief_ready: boolean }],
  nbs_overdue: [{ nbs_id, contact_id, contact_name, action, due_at, days_overdue }],
  
  // Horizon 2 — In Motion
  active_missions_summary: { total, on_track, at_risk, stalled },
  pipeline_movement: { new_this_week, stage_changes, responses_received },
  follow_ups_due_this_week: [{ contact_id, contact_name, action, due_at }],
  
  // Horizon 3 — Strategic
  relationships_at_risk: [{ contact_id, contact_name, risk_reason, days_since_contact }],
  icp_match_quality: { avg_score, trend_direction },
  goal_progress: [{ mission_name, progress_pct, days_remaining }],
  
  // Barry Prepared
  prepared_actions: [{ action_id, type, contact_name, description, prepared_at }],
  drafted_replies: [{ contact_id, contact_name, draft_preview }],
  
  // Meta
  total_contacts: number,
  total_active_relationships: number,
  computed_at: timestamp
}
```

### Mission Control Aggregation Contract

Mission Control pulls from Barry's awareness layer across three horizons:

**Horizon 1 (Immediate):** `awareness.business.responses_pending` + `awareness.business.meetings_today` + `action_queue.filter(priority <= 1)`

**Horizon 2 (Active):** `awareness.mission` (active mission health) + `awareness.relationship` (active relationship states) + `action_queue.filter(type == 'follow_up')`

**Horizon 3 (Strategic):** `awareness.business` (trend metrics) + `awareness.user` (pattern insights) + aggregated mission/relationship health over time

### Autonomy Spectrum

| Capability Class | Observe | Recommend | Prepare | Approval | Autonomous |
|---|---|---|---|---|---|
| **Email Drafting** | Barry sees the contact needs a follow-up | Barry recommends a follow-up | Barry drafts the email | Barry shows draft, user sends | Barry sends on schedule |
| **Contact Enrichment** | Barry sees incomplete data | Barry suggests enriching | Barry enriches and stages | User reviews enrichment | Barry auto-enriches on import |
| **ICP Scoring** | Barry sees unscored contacts | Barry suggests scoring | Barry scores and ranks | User reviews scores | Barry auto-scores on import |
| **Meeting Prep** | Barry sees a meeting today | Barry recommends preparing | Barry generates brief | User reviews brief | Barry auto-generates 1 hour before |
| **Campaign Launch** | Barry sees ICP matches | Barry suggests a campaign | Barry builds the sequence | User reviews and launches | Barry auto-launches on criteria |
| **Reply Handling** | Barry detects a reply | Barry analyzes sentiment | Barry drafts a response | User reviews and sends | Barry auto-responds per policy |
| **Stage Transitions** | Barry detects momentum signals | Barry suggests stage change | Barry prepares transition | User confirms transition | Barry auto-transitions on criteria |

### Enterprise Foundation Roadmap

| Foundation | Current State | Priority | Effort | Dependency |
|---|---|---|---|---|
| 1. Identity/Tenancy | Firebase Auth, single-user | Low (MVP) | Low | None |
| 2. Permissions/Autonomy | None | **High** | Medium | Foundation (Signal Bus) |
| 3. Auditability | Partial (attribution, session logs) | **High** | Medium | Observability |
| 4. Observability | Minimal (API logs only) | **Critical** | Medium | None — build first |
| 5. Reliability | Basic try/catch | Medium | Medium | Observability |
| 6. Idempotency | None for outbound actions | **High** | Low | None |
| 7. Confidence | None for AI outputs | Medium | Low | Think Layer |
| 8. Evaluation | None | Medium | High | Observability + Auditability |

**Recommended order:** Observability → Idempotency → Auditability → Permissions/Autonomy → Reliability → Confidence → Evaluation → Identity/Tenancy (only if multi-user)

---

## Step 11 — Migration Map

### Implementation Disposition Table

| Implementation | Location | Disposition | Reason | Migration Path |
|---|---|---|---|---|
| barryMissionChat | netlify/functions/ | **Keep + Refactor** | Core chat interface. Refactor to use Skills and Think Layer. | Extract message generation into WriteEmailSkill. Extract mode detection into Think Layer. Keep as surface handler. |
| barryOrientationBrief | netlify/functions/ | **Keep + Refactor** | Morning brief is a key surface. Refactor to consume Awareness projections. | Convert to MorningBriefWorkflow that chains Skills. Remove inline data loading. |
| barryHunterProcessEngage | netlify/functions/ | **Consolidate** | Primary engagement flow but duplicates message generation. | Extract into WriteEmailSkill (4-angle mode). Hunter engagement panel calls WriteEmailSkill via capability registry. |
| barryHunterGenerateStep | netlify/functions/ | **Consolidate** | Overlaps barryGenerateSequenceStep. | Merge into GenerateStepSkill with model selection parameter. |
| barryHunterCardRead | netlify/functions/ | **Keep** | Unique, low-cost, high-value. | Add caching (per contact per day). |
| barryICPConversation | netlify/functions/ | **Keep + Refactor** | Complex multi-mode ICP flow. | Extract scoring into ScoreICPFitSkill. Keep conversational flow as ICP Workflow. |
| barryGenerateContext | netlify/functions/ | **Replace** | Duplicated by client-side barryContextStack. | Replace both with unified Context Resolution Service (server-side only). |
| barryGenerateMissionSequence | netlify/functions/ | **Keep + Refactor** | Unique capability for full sequence generation. | Becomes LaunchCampaignWorkflow orchestrating multiple Skills. |
| barryGenerateSequenceStep | netlify/functions/ | **Delete** | Duplicated by barryHunterGenerateStep. | Consumers switch to GenerateStepSkill. |
| barryGenerateTemplate | netlify/functions/ | **Consolidate** | Template generation overlaps message generation. | Absorb into WriteEmailSkill with template mode. |
| barryFirstTouch | netlify/functions/ | **Delete** | Overlaps barryOutreachMessage and barryHunterProcessEngage. | Consumers use WriteEmailSkill with first_touch context. |
| barryOutreachMessage | netlify/functions/ | **Consolidate** | One of 6 message generators. | Absorb into WriteEmailSkill. |
| barryEnrich | netlify/functions/ | **Keep + Refactor** | Complex enrichment pipeline. | Split into ResearchCompanySkill and ResearchContactSkill. Keep as EnrichmentWorkflow. |
| barryDossierBriefing | netlify/functions/ | **Keep + Refactor** | Unique briefing generation. | Becomes GenerateMeetingBriefSkill. Wire into PrepareMeetingWorkflow. |
| barryCSMRead | netlify/functions/ | **Keep** | Unique CSM intelligence. | Register as CSM-specific Skill. |
| barryActions | netlify/functions/ | **Replace** | Action execution should go through Action Queue. | Replace with Action Executor that reads from Action Queue and invokes capabilities via registry. |
| barryBulkPersonalize | netlify/functions/ | **Consolidate** | Bulk mode of message generation. | Absorb into WriteEmailSkill with batch mode. |
| barryValidateContact | netlify/functions/ | **Replace** | AI used for deterministic validation. | Replace with rule-based validation service. No AI needed. |
| barryReconInterview | netlify/functions/ | **Delete** | Duplicated by barry-coach-section. | Consumers switch to barry-coach-section (CoachICPSkill). |
| barryReconSection0 | netlify/functions/ | **Keep** | Unique section generation. | Register as RECON-specific Skill. |
| barryPipelineAction | netlify/functions/ | **Replace** | Pipeline actions should go through capability registry. | Replace with capability-registered pipeline actions. |
| barryOutcomeAttribution | netlify/functions/ | **Replace** | Attribution is deterministic data joining. | Replace with deterministic attribution service. Remove AI. |
| barry-coach-section | netlify/functions/ | **Keep** | Best coaching implementation. | Register as CoachICPSkill. |
| barry-approve-send | netlify/functions/ | **Replace** | Send approval is deterministic. | Replace with Action Executor capability. |
| barryContextStack | src/utils/ | **Replace** | Client-side context assembly is wrong layer. | Replace with server-side Context Resolution Service. |
| barryContextStore | src/context/ | **Keep + Refactor** | Lightweight pub/sub is correct pattern. | Refactor to publish entity context only (not assembled context). Context resolution moves server-side. |
| barryMemoryService | src/services/ | **Keep + Refactor** | Core memory management. | Split into per-memory-type services. Add session→durable gate. |
| barryCSM | src/services/ | **Keep** | Clean CSM context builder. | Register signals and capabilities. |
| recommendationEngine | src/utils/ | **Keep + Refactor** | Good recommendation derivation. | Feed into Think Layer as input. Output through Action Queue. |
| nextBestStepService | src/services/ | **Keep + Refactor** | Good NBS model. | NBS becomes one type of recommendation in Action Queue. |
| generate-section-1 through -10 | netlify/functions/ | **Keep** | RECON section generation is distinct. | Not part of Barry OS core — module-specific capability. |
| generate-campaign-messages | netlify/functions/ | **Delete** | Duplicated by barryBulkPersonalize → WriteEmailSkill. | Consumers use WriteEmailSkill batch mode. |
| generate-engagement-message | netlify/functions/ | **Delete** | Duplicated by barryHunterProcessEngage → WriteEmailSkill. | Consumers use WriteEmailSkill. |
| generate-followup | netlify/functions/ | **Delete** | Duplicated by barryFirstTouch → WriteEmailSkill. | Consumers use WriteEmailSkill with follow_up context. |
| inferRelationshipWarmth | netlify/functions/ | **Consolidate** | Warmth inference exists in 3 places. | Consolidate into InferRelationshipStateSkill. |
| BarryChat.jsx | src/components/barry/ | **Keep + Refactor** | Primary drawer surface. | Consume from Context Resolution Service. Actions through capability registry. |
| BarryChatPanel.jsx | src/components/dashboard/ | **Keep + Refactor** | Primary MC surface. | Consume from Context Resolution + Awareness projections. |
| BarryMorningBrief.jsx | src/components/mission-control/ | **Keep + Refactor** | Morning brief display. | Consume from MorningBriefWorkflow output. |
| Engagement Panels (5) | src/components/contacts/ | **Consolidate** | 5 module-specific panels with same pattern. | Consolidate into single EngagementPanel that reads capabilities from registry per module. |

### Disposition Summary

| Disposition | Count |
|---|---|
| Keep | 6 |
| Keep + Refactor | 12 |
| Consolidate | 5 |
| Replace | 6 |
| Delete | 7 |
| **Total** | **36** |

### Phased Build Sequence

**Derived from findings. This sequence differs from the reference in two ways:**

1. **Observability is moved to Phase 0** — Before building anything, we need the ability to measure what exists. Without observability, we cannot validate that the new architecture is better.
2. **Skills are moved before the Think Layer** — The Think Layer needs Skills to invoke. Building Skills first means the Think Layer has capabilities to orchestrate from day one.

```
Phase 0: Observability Foundation
    │ Token usage tracking per function per user
    │ Latency monitoring for all AI endpoints
    │ Cost dashboard
    │ Reasoning trace logging
    │
Phase 1: Signal Bus + Domain Model
    │ Normalized Signal type
    │ Signal persistence (Firestore subcollection)
    │ Top 10 signals wired (contact.reply_received, contact.email_sent,
    │   meeting.today, mission.step_completed, nbs.confirmed, nbs.dismissed,
    │   contact.status_changed, contact.enriched, company.discovered, contact.added)
    │
Phase 2: Memory Consolidation + Context Resolution
    │ Unify 3 context assembly paths into single server-side service
    │ Separate 5 memory types with distinct storage
    │ Add session→durable gate
    │ Client sends entity context only; server resolves full context
    │
Phase 3: Skills Registry
    │ Define Skill interface (input schema, output schema, model, capability type)
    │ Migrate top 5 capabilities to Skills:
    │   WriteEmailSkill, ResearchCompanySkill, ScoreICPFitSkill,
    │   GenerateMeetingBriefSkill, GenerateNextStepSkill
    │ Delete duplicates (barryFirstTouch, barryGenerateSequenceStep,
    │   generate-campaign-messages, generate-engagement-message, generate-followup)
    │
Phase 4: Awareness Layer
    │ Relationship Awareness projection (formalize engage_state + engagement_summary)
    │ Business Awareness projection (new — aggregate cross-contact state)
    │ Mission Awareness projection (new — aggregate mission health)
    │ User Awareness expansion (beyond tone/channel)
    │ Staleness detection and re-computation triggers
    │
Phase 5: Think Layer
    │ Reasoning service between Awareness and Recommendation
    │ Priority synthesis across relationships and missions
    │ Strategy selection (which skill, which approach)
    │ Reasoning trace output for auditability
    │
Phase 6: Action Queue + Capability Registry
    │ Prioritized action queue (replaces ad hoc recommendations)
    │ Capability registry (modules declare what Barry can do)
    │ Autonomy spectrum per capability class
    │ Generative vs side-effect capability distinction
    │
Phase 7: Workflows + Orchestration
    │ Workflow engine (chain Skills)
    │ PrepareMeetingWorkflow, LaunchCampaignWorkflow,
    │   QualifyProspectWorkflow, ReconnectDormantRelationshipWorkflow
    │ Multi-step orchestration with intermediate state
    │
Phase 8: Morning Brief + Barry Artifacts
    │ Morning Brief from precomputed Awareness data
    │ Meeting Brief artifact
    │ Prospecting List artifact
    │ Weekly Review artifact
    │
Phase 9: Surface Consolidation
    │ Merge 5 engagement panels into single capability-driven panel
    │ Unify drawer and MC chat to same context resolution
    │ Surface registration model (surfaces declare what they need)
    │
Phase 10: Enterprise Hardening
    │ Idempotency on all outbound actions
    │ Confidence scores on all AI outputs
    │ Evaluation framework with baseline metrics
    │ Circuit breaker for external service failures
    │
Phase 11: Autonomy + Continuous Improvement
    │ Full autonomy spectrum implementation
    │ Learned Intelligence feedback loop
    │ Barry self-improvement measurement
    │ New integration pattern (add LinkedIn end-to-end)
```

**Deviations from reference sequence:**

| Reference Step | Actual Position | Reason |
|---|---|---|
| Foundation | Phase 0 + 1 | Split into Observability (must be first) and Signal Bus. |
| Awareness | Phase 4 | Moved after Skills because awareness projections need to be computed by skills, and skills need context resolution. |
| Think Layer | Phase 5 | Unchanged position relative to Awareness. Needs awareness as input and skills as output. |
| Context | Phase 2 | Moved earlier because context consolidation is foundational — every subsequent phase depends on unified context. |
| Skills | Phase 3 | Moved before Awareness because skills are atomic and can be built independently. Awareness needs skills to recompute. |
| Workflows | Phase 7 | Slightly later — needs Skills, Think Layer, and Action Queue. |
| Actions | Phase 6 | Paired with Capability Registry — they're the same system. |
| Morning Brief | Phase 8 | Unchanged — needs Awareness + Skills + Workflows. |
| Surface Consolidation | Phase 9 | Unchanged. |
| Orchestration | Phase 7 | Combined with Workflows — they're the same capability. |
| Autonomy | Phase 11 | Last — requires everything else. |

---

## Barry OS Constitution

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

---

## Acceptance Criteria Checklist

- [x] Every Barry surface is inventoried with five-layer analysis, Skills/Workflows support noted, and direct-call violations flagged — **13 surfaces documented**
- [x] Every Barry service and AI endpoint is documented with cost classification — **37 Netlify functions + 9 client services documented**
- [x] All five memory types are identified and their current state documented — **3 of 5 exist in partial form**
- [x] All four awareness projections are identified or confirmed absent — **Only Relationship Awareness partially exists**
- [x] A Think layer is identified or confirmed absent — **Confirmed absent**
- [x] The five layers are traced through the current architecture with conflation points flagged — **7 of 13 surfaces conflate layers**
- [x] Potential Barry Skills and Workflows are identified from current capabilities — **15 Skills, 7 Workflows defined**
- [x] Schema contradictions across Barry context objects are documented — **8 distinct context implementations, 2 conversation stores, fragmented user memory**
- [x] Signal map covers all major platform events — **24 events mapped across Known/Partial/Blind**
- [x] Every duplicate implementation has a disposition recommendation — **8 duplication patterns, all with dispositions**
- [x] Cost baseline uses measured/calculated/estimated/unknown classification — **All estimates classified as estimated (no runtime metrics exist)**
- [x] AI-for-deterministic-logic antipatterns are identified — **4 antipatterns: barryValidateContact, barryOutcomeAttribution, barry-approve-send, mode detection**
- [x] Observability roadmap is included — **5-item roadmap in Cost section + Phase 0 in build sequence**
- [x] Enterprise foundation findings cover all eight areas — **All 8 documented with current state and gaps**
- [x] Mission Control audit is organized across three horizons and around user work concepts — **3 horizons + 10 user work concepts mapped**
- [x] All four existing integrations are audited for Barry signal production — **5 integrations (Gmail, Calendar, Apollo, LinkedIn, Stripe) documented**
- [x] Recommended Barry OS architecture either validates or modifies the reference model with evidence — **Validated with modifications — all 15 contracts specified**
- [x] Think layer specification is included — **Inputs, processing steps, and outputs defined**
- [x] Skills Registry and Workflows Registry are included — **15 Skills, 7 Workflows**
- [x] Barry Artifacts are defined — **7 artifact types defined**
- [x] Migration map covers every current implementation — **36 implementations with dispositions**
- [x] Phased build sequence is derived from findings with deviations from reference explained — **11 phases with 6 deviations explained**
- [x] Barry OS Constitution with all 24 laws is included — **All 24 laws verbatim**
- [x] No code was written or changed during this audit — **Confirmed: audit document only**

---

## What Comes After This Audit

Once Team Alpha delivers this report and it is reviewed and approved by Aaron and Team Beta, the next phase produces five documents before any implementation begins:

1. **Barry OS Reference Architecture** — validated from repository findings
2. **Barry OS Domain Model** — finalized object definitions
3. **Barry OS Event and Signal Specification** — full signal bus contract
4. **Barry OS API and Capability Contracts** — Skills, Workflows, Capability Registry
5. **Barry OS Phased Implementation Plan** — sprint-by-sprint build sequence

No implementation begins until all five are approved.

---

*No code was written or changed during this audit. This document is a discovery-only deliverable.*
