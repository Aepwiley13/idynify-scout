# Barry OS Foundation Audit — Findings Report

**Idynify · Team Alpha · Discovery Only — No Code Written or Changed**
**Repository:** `Aepwiley13/idynify-scout` @ `09e90f9` (branch `claude/barry-os-foundation-audit-d9370t`)
**Date:** 2026-08-07

---

## Executive Summary — Read This First

Barry is not one system. Barry is **38 AI endpoints, 9 context implementations, 6 conversation stores, 6 model IDs across 4 model generations, and ~40 UI surfaces**, wired together by convention rather than contract.

Six findings dominate everything else:

1. **There is no signal layer.** Business logic calls Barry directly from the UI on 40+ call sites. Law 2 is violated everywhere. The only thing resembling a signal bus is the inbound-email pipeline (`processNormalizedMessage` → `barry_processing_queue`), which covers exactly one event class out of seventeen.

2. **There is no awareness layer.** All four projections are absent as persisted objects. Business awareness is recomputed from scratch in at least four places (`barryOrientationBrief.js`, `barryMissionChat.js`, `recommendationEngine.js`, `MissionControlDashboardV2.jsx`), each with its own thresholds and each disagreeing with the others.

3. **A Think layer exists, but it is 331 lines wide and reaches 4 of 38 endpoints.** `netlify/functions/utils/barryStrategyRecommender.js` is real reasoning — recency-weighted scoring across four strategies, contact-level and user-level, producing explainable reasons. It is genuinely good. It is consumed by `generate-engagement-message.js`, `barryHunterGenerateStep.js`, `barryHunterProcessEngage.js`, and `barryGenerateSequenceStep.js`. The other 34 AI endpoints jump straight from ad-hoc context to output.

4. **Cost is unmeasurable and the observability that exists is wrong.** `logApiUsage()` writes every operation to `apiLogs` as `APOLLO_<OPERATION>` with `creditsUsed: 1` — Anthropic calls are being logged as Apollo credits. Token counts are captured by 17 of 40 AI call sites and only inside a JSON-stringified `metadata` blob that cannot be aggregated by query.

5. **Eleven frontend call sites point at Netlify functions that do not exist.** `generate-leads`, `generate-leads-v2`, `generate-email`, `generate-linkedin`, `generate-executive-summary`, `barry-phase1-discover` through `barry-phase5-campaign`. These are dead surfaces shipping 404s.

6. **The five layers are conflated at the storage level.** `barry_drafts` (Prepared Action) is written by the same pipeline pass that writes `barry_analysis` (Awareness) and mutates `conversationState` (Fact) — and `contact_status` (Fact) is mutated by `process-barry-queue.js` as a side effect of generating a Recommendation.

**Verdict on the reference architecture: validated in shape, modified in sequencing, one component rejected.** The Signal Bus, Capability Registry, Awareness Layer, Context Resolution, Memory, Action Queue, Morning Brief, and Mission Control model are all the right abstractions and all map onto real code that already exists in scattered form. The **Policy/Autonomy Engine as a distinct layer is rejected for Phase 1** — see §10.14. The **five-memory-type model is modified**: this codebase needs six, because Mission Memory does not exist at all and Artifact storage has no home.

---

# Barry OS Principles

Read these before reading anything else. Every engineer working on Barry must internalize these before touching the codebase.

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

## Principle-by-principle compliance scorecard

| # | Principle | Current state | Evidence |
|---|---|---|---|
| 1 | Orchestration engine | **Violated** | 38 single-shot endpoints. 3 chains exist (`barryHunterProcessEngage`, `barryEnrich`, `process-barry-inbox-queue`), each hard-coded, none reusable. |
| 2 | Never called from business logic | **Violated everywhere** | 40+ `fetch('/.netlify/functions/barry*')` call sites directly inside React components. |
| 3 | Modules publish signals | **Violated** | No module publishes. `timelineLogger` writes per-contact history that nothing subscribes to. |
| 4 | Never owns canonical data | **Mostly held** | One breach: `search-companies.js:991` writes `barry_intel` onto the canonical company document. |
| 5 | AI for judgment, not computation | **Partially violated** | `barryActions.js` uses Haiku to parse intent that is enumerable; `barryValidateContact.js` uses Sonnet for field validation. Counter-example done right: `barryEnrich.js`, `inferRelationshipWarmth.js`, `barryStrategyRecommender.js` are all AI-free by design. |
| 6 | Integrations contribute signals | **Violated** | Only Gmail produces normalized events. Calendar/Apollo/LinkedIn produce nothing. |
| 7 | Improve once, improve everywhere | **Violated** | `barryStrategyRecommender` improvements reach 4 of 38 endpoints. |
| 8 | Mission Control around user work | **Partially held** | `TodaysPriorities` + `usePendingReplies` are work-shaped. KPI tiles are module-shaped. |
| 9 | Proactive preparation | **Partially held** | `barry_drafts` is genuine proactive preparation and is the strongest thing in the codebase. Nothing else prepares. |
| 10 | Five layers distinct | **Violated** | See §3.5. |
| 11 | Explainable | **Partially held** | `barryStrategyRecommender` and `recommendationEngine` both emit reasons. The 34 direct-prompt endpoints emit none. |
| 12 | Think before acting | **Violated at 90% of surfaces** | Think layer exists but reaches 4 endpoints. |

---

# Barry Domain Model

Barry reasons about canonical domain objects. These objects must be explicitly named and defined so engineers do not invent competing concepts for the same thing.

| Object | Definition | Exists in repo today? |
|---|---|---|
| Workspace | The user's Idynify environment — the boundary for all Barry reasoning | **No.** `userId` is used as an implicit workspace boundary. No workspace/tenant object. |
| User | Aaron or any authenticated operator of the workspace | Yes — `users/{userId}` + Firebase Auth |
| Contact | A canonical person record in the user's workspace | Yes — `users/{userId}/contacts/{contactId}` |
| Company | A canonical organization record in the user's workspace | Yes — `users/{userId}/companies/{companyId}` |
| Relationship | The state and history of Aaron's connection with a Contact or Company | **Fragmented** across `warmth_level`, `relationship_state`, `contact_status`, `engage_state`, `conversationState`, `brigade`, `person_type`, `engagement_summary` |
| Mission | A named goal with a defined strategy, audience, and success criteria | Yes — `users/{userId}/missions/{missionId}` |
| Campaign | A structured outreach sequence within a Mission | Partial — `users/{userId}/campaigns`, relationship to Mission undefined |
| Cadence | A timed touchpoint schedule within a Campaign | Yes — `users/{userId}/cadences`, but parented to nothing |
| Meeting | A scheduled or completed interaction with a Contact | **No.** Google Calendar events are fetched live and never persisted. |
| Conversation | A Barry chat session scoped to a context | **Six competing implementations** — see §3.2 |
| Message | A communication artifact — sent or drafted | Yes — `communication_records` (root), plus `barry_drafts` |
| Task | A discrete action item assigned to Aaron or queued for Barry | Partial — `nbs_queue` (Next Best Step) is the closest thing |
| Signal | A normalized event produced by a module or integration | **Only one producer**: `NormalizedMessage` (`src/types/normalizedMessage.js`) |
| Awareness State | Barry's current derived understanding | **Absent as an object.** Recomputed per surface. |
| Recommendation | Barry's belief about what should happen next | Yes, three competing shapes — see §5 |
| Prepared Action | Work Barry has completed and staged for review | Yes — `barry_drafts`, the single best-built concept in the repo |
| Executed Action | An action Barry or Aaron has completed | Partial — `timeline` events, `communication_records` |
| Skill | An atomic Barry capability | **Absent.** No named skills. |
| Workflow | A named combination of Skills | **Absent.** Three hard-coded chains masquerade as workflows. |
| Capability | A declared action Barry can take through a module or integration | **Absent as a registry.** `buildCapabilityBlock()` is a prompt string, not a registry. |
| Artifact | A reusable Barry output | **Absent.** Every generated brief/dossier is thrown away after render. |

**Naming collisions found in the repo that this model resolves:** `Lead` (`users/{uid}/leads`, `LeadList.jsx`, `lead_status`), `Prospect` (`Prospects.jsx`, `ProspectCard.jsx`, `engagementIntent: 'prospect'`), `Person` (`peopleSchema.js`, `PeopleMain.jsx`, `PERSON_TYPE_IDS`), `Contact` (canonical) and `Target` (`Sniper/sections/TargetsSection.jsx`) are **five names for one object**. This is exactly the failure mode the domain model prevents, and it has already happened.

---

# Step 1 — Barry Surface Inventory

40 surfaces found. Layer key: **S**=Signal, **F**=Fact/Awareness, **R**=Recommendation, **P**=Prepared Action, **E**=Executed Action.

## 1.1 Global / Mission Control surfaces

| # | Surface | Path | Barry's role | Context on mount | Own conversation store? | Layers mixed | Skills/Workflows | State | Law 2 violation |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Global Barry drawer** (`BarryChatPanel`, 1598 L) | `src/components/dashboard/BarryChatPanel.jsx`, mounted `layout/MainLayout.jsx:368` | The one true Barry. Chat + orientation + pipeline actions | `buildContextStack(userId)` (500 contacts, 20 missions, RECON, ICP, service profiles, calendar) + `navigationContext` from `ShellContext` | **Yes** — `users/{uid}/barryConversations/missionControl` AND `users/{uid}/barry_sessions/{sid}` | F, R, P, E — all four | Neither. Single-capability, one prompt per turn | Working | **Yes** — calls `barryMissionChat`, `barryActions`, `barryPipelineAction`, `barryOrientationBrief` directly |
| 2 | **Morning Brief** | `src/components/mission-control/BarryMorningBrief.jsx` (175 L) via `MissionControlRightRail.jsx:102` | Renders `orientation` prop produced by surface #1 | None — pure presentational, receives `orientation` | No | F, R | Neither | Working | No (renders only) |
| 3 | **Today's Priorities** | `src/components/mission-control/TodaysPriorities.jsx` (182 L) | Ranked action list | `useRecommendations()` → `recommendationEngine.generateDashboardRecommendations()` | No | F, R | Neither | Working | No (client engine, no AI) |
| 4 | **Mission Control dashboard** | `src/pages/Scout/MissionControlDashboardV2.jsx` (1256 L) | KPI tiles, ICP match table, quick engage | 6 independent Firestore reads (`companies`, `cadences`, `icpProfiles`, `companyProfile`, `contacts`, `users`) | No | F, R, P | Neither | Working | **Yes** — `generate-engagement-message`, `search-companies` |
| 5 | **Legacy Mission Control** | `src/pages/MissionControlDashboardV2.jsx` (583 L) | Superseded dashboard, **not routed** | `recommendationEngine`, `icpScoring` | No | F, R | Neither | **Dead — unrouted** | n/a |
| 6 | **Archived Mission Control** | `src/pages/MissionControlDashboard.archived.jsx` | — | — | — | — | — | **Dead — calls `generate-leads` and `generate-leads-v2`, both non-existent** | n/a |
| 7 | **Scout Mission Control** | `src/pages/Scout/MissionControl.jsx` (1191 L) | Third Mission Control | `barryDossierBriefing`, `FirstTouchModal` | No | F, R, P | Neither | Working (separate route) | **Yes** |
| 8 | **Barry session history** | `src/components/barry/BarrySessionHistoryPanel.jsx` | Lists prior Barry sessions | Reads `users/{uid}/barry_sessions` | Reads only | — | Neither | **Partially broken** — only sees sessions written by surface #1; every module conversation is invisible | No |
| 9 | **Quick Search** | `src/components/mission-control/QuickSearch.jsx` | Entity lookup | Local | No | — | Neither | Working | No |
| 10 | **Recent Outreach Activity** | `src/components/mission-control/RecentOutreachActivity.jsx` | Executed-action feed | Firestore timeline | No | E | Neither | Working | No |
| 11 | **Hunter Readiness Banner** | `src/components/mission-control/HunterReadinessBanner.jsx` | Nudge | Props | No | R | Neither | Working | No |

## 1.2 Contact surfaces

| # | Surface | Path | Role | Context on mount | Store | Layers | Skills/WF | State | Law 2 |
|---|---|---|---|---|---|---|---|---|---|
| 12 | **Contact page (canonical)** | `src/pages/Scout/ContactPage.jsx` | Preloads Barry memory on arrival | `loadContactMemory()` + `readNavigationIntent()` + `barrySessionKey()` | No | F | Neither | Working — **best-designed surface in the repo** | No |
| 13 | **Barry Insight Panel** | `src/components/contacts/BarryInsightPanel.jsx` (113 L), mounted `ContactProfile.jsx:944` | Per-contact recommendations | `generateContactRecommendations(userId, contactId)` | No | F, R | Neither | Working | No (client engine) |
| 14 | **Next Best Step** | `src/components/contacts/NextBestStep.jsx`, `ContactProfile.jsx:954` | Single proposed next action | `nextBestStepService` | No | R, P | Neither | Working | No |
| 15 | **Barry Context strip** | `src/components/contacts/BarryContext.jsx` (172 L) via `ContactSnapshot.jsx:89` | Shows what Barry knows | Props from parent | No | F | Neither | Working | No |
| 16 | **Barry Briefing** | `src/components/contacts/BarryBriefing.jsx` (63 L) | Contact briefing card | Props | No | F | Neither | **Dead — zero importers** | n/a |
| 17 | **Inline Engagement Section** | `src/components/contacts/InlineEngagementSection.jsx` | 4-angle message generation inline | contact doc | No | F, P | Neither | Working | **Yes** — `barryGenerateContext` + `generate-engagement-message` |
| 18 | **Stage Engagement Panels** (6) | `src/components/contacts/{Scout,Hunter,Sniper,Basecamp,Reinforcements,Fallback}EngagementPanel.jsx` via `StageEngagementPanel.jsx` | Per-module engagement UI | contact doc | No | F, P | Neither | Working | Varies per panel |
| 19 | **Quick Engage Drawer** | `src/components/engage/QuickEngageDrawer.jsx`, mounted in `MainLayout.jsx` | Global engage | `useShellEntity` | No | P, E | Neither | Working | Yes |
| 20 | **First Touch Modal** | `src/components/firstTouch/FirstTouchModal.jsx` | First outreach | contact + service profile | No | P | Neither | Working | **Yes** — `barryFirstTouch` |

## 1.3 Hunter surfaces

| # | Surface | Path | Role | Layers | State | Law 2 |
|---|---|---|---|---|---|---|
| 21 | **Barry Reply Card** | `src/components/hunter/BarryReplyCard.jsx` (332 L) in `HunterContactDrawer.jsx:966` | Renders `barry_drafts` + `barry_analysis`, approve/edit/send | F, P, E | Working — **the reference implementation for Prepared Action** | Yes (`barry-approve-send`) |
| 22 | **Barry Recommendation Card** | `src/components/hunter/BarryRecommendationCard.jsx` (214 L) | Recommendation + `BarryReasoningDisplay` | R | Working | No |
| 23 | **Barry Insights Card** | `src/components/hunter/BarryInsightsCard.jsx` (151 L) | Contact + global insights | F | Working | No |
| 24 | **Barry Warning Card** | `src/components/hunter/BarryWarningCard.jsx` | Renders `barry_warning` from guardrail | R | Working | No |
| 25 | **Hunter Contact Card** | `src/components/hunter/HunterContactCard.jsx:136` | One-line "field commander read" | F, R | Working | **Yes — one Haiku call per card render** (see §6) |
| 26 | **Mission Card** | `src/components/hunter/MissionCard.jsx` | Generates next mission step | P | Working | **Yes** — `barryHunterGenerateStep` |
| 27 | **Sequence Panel** | `src/components/hunter/SequencePanel.jsx` | Multi-step sequence | P | Working | **Yes** — `barryGenerateSequenceStep` |
| 28 | **Follow-Up Card / Composer** | `src/components/hunter/FollowUpCard.jsx`, `FollowUpComposer.jsx` | Follow-up drafting | P | Working | **Yes** — `generate-followup` |
| 29 | **Template Library Barry chat** | `src/components/hunter/TemplateLibrary.jsx:678` | In-modal Barry chat for templates | P | Working | **Yes** — `barryGenerateTemplate` |
| 30 | **Outcome Overlay** | `src/components/hunter/HunterOutcomeOverlay.jsx` | Records outcome, triggers attribution | E | Working | **Yes** — `barryOutcomeAttribution` |
| 31 | **Blitz Mode** | `src/pages/Hunter/BlitzMode.jsx` | Rapid engagement | P | Working | **Yes** — `generate-engagement-message` |
| 32 | **Hunter Dashboard** | `src/pages/Hunter/HunterDashboard.jsx` | Engage processing chain trigger | S, F, R, P | Working | **Yes** — `barryHunterProcessEngage` |

## 1.4 Scout / Recon / Onboarding / Other surfaces

| # | Surface | Path | Role | Layers | State | Law 2 |
|---|---|---|---|---|---|---|
| 33 | **Barry ICP Panel** | `src/components/scout/BarryICPPanel.jsx` (331 L) in `DailyLeads.jsx` | ICP conversation, refines search | F, R, E | Working | **Yes** — `barryMissionChat` |
| 34 | **Daily Discoveries Barry intel** | `src/pages/Scout/DailyLeads.jsx:510` | Renders `company.barry_intel` | F | Working | No (field read) — but **the write at `search-companies.js:991` breaches Law 5** |
| 35 | **Bulk Compose Modal** | `src/components/scout/BulkComposeModal.jsx` | Bulk personalization, up to 25 contacts | P | Working | **Yes** — `barryBulkPersonalize` (1 Haiku call **per contact**) |
| 36 | **Find Contact / Contact Search** | `src/components/scout/FindContact.jsx`, `pages/Scout/ContactSearch.jsx` | Contact validation | F | Working | **Yes** — `barryValidateContact` |
| 37 | **Scout Game** | `src/pages/Scout/ScoutGame.jsx` + `useGamePrefetch.js` | Card-swipe engagement with 10-card AI prefetch buffer | P | Working | **Yes — highest-volume AI surface in the product** (see §6) |
| 38 | **Recon Coach / Guide** | `src/components/recon/BarryReconCoach.jsx` (415 L), `BarryReconGuide.jsx` | Section interview | F | Working | **Yes** — `barryReconInterview`, `barryReconSection0`; **own conversation store** `barryConversations/reconCoach_{sectionId}` |
| 39 | **Recon Section Editors 1–10** | `src/components/recon/Section{1..10}*.jsx` | Section generation | F | Working | **Yes** — `generate-section-1..10` (10 near-identical endpoints) |
| 40 | **Recon Section Editor coaching** | `src/pages/Recon/ReconSectionEditor.jsx` | Post-save coaching | F, R | Working | **Yes** — `barry-coach-section` |
| 41 | **Barry Onboarding** | `src/pages/Onboarding/BarryOnboarding.jsx` | ICP conversation onboarding | F | Working | **Yes** — `barryICPConversation` (1043 L endpoint, 4 AI call sites) |
| 42 | **Basecamp CSM** | `src/components/csm/InterventionPlaybook.jsx`, `SuccessWizard.jsx` | Customer health read | F, R | Working | **Yes** — `barryCSMRead` |
| 43 | **Admin Barry Conversations** | `src/components/admin/BarryConversationsView.jsx` | Admin view of `barryConversations/icp` | — | Working | No |
| 44 | **Barry HUD** | `src/components/BarryHUD.jsx` (192 L) in `GoToWar.jsx` | Legacy phase HUD | — | Legacy | No |
| 45 | **BarryChat + BarryTrigger** | `src/components/barry/BarryChat.jsx` (519 L), `BarryTrigger.jsx` (112 L) | Old per-module drawer | F, R | **Dead** — `App.jsx:356`: *"BarryTrigger removed"*. `BarryChat` still writes `barryConversations/drawer_{module}` if ever mounted | n/a |
| 46 | **Mission Phase 1–5 pages** | `src/pages/MissionPhase{1..5}Page.jsx` + `components/Phase{1..5}*.jsx` | Legacy 5-phase wizard | — | **Broken — all five call non-existent endpoints** (`barry-phase1-discover` … `barry-phase5-campaign`) | n/a |
| 47 | **ICP Validation Page** (×4 copies) | `src/pages/ICPValidationPage.jsx`, `components/ICPValidationPage.jsx` + `OLD`, `OLD2`, `old3` | ICP brief | F | 1 working, 3 dead; `OLD.jsx` calls non-existent `generate-executive-summary` | n/a |

### Step 1 summary findings

- **Conversation stores: 6.** `barryConversations/missionControl`, `barryConversations/drawer_{module}`, `barryConversations/icp`, `barryConversations/icpChat`, `barryConversations/reconCoach_{sectionId}`, plus `users/{uid}/barry_sessions/{sid}`.
- **Skills or Workflows supported by any surface: zero.** Every surface is single-capability request/response.
- **Law 2 violations: 40+ direct call sites**, in 33 distinct components.
- **Dead or broken surfaces: 11** (#5, #6, #16, #45 ×2, #46 ×5, #47 ×3).
- **Layer conflation:** 14 surfaces mix three or more layers. Surface #1 mixes all four non-signal layers in one component.

---

# Step 2 — Barry Service, Function, Skill, and Workflow Inventory

## 2.1 Server-side AI endpoints (Netlify functions)

40 modules call the Anthropic API; 46 distinct `messages.create` call sites. Layer key as above. Cost class in §6.

| Function | Purpose | Layer | Input → Output | Consumed by | Duplicate of | Skill / Workflow / Neither | AI-for-deterministic? | Cached? |
|---|---|---|---|---|---|---|---|---|
| `barryMissionChat.js` (1234 L) | Global Barry chat + opening brief + ICP reclarification | F,R,P | `{userId, authToken, message, contextStack, navigationContext}` → `{response_text, angles, actions}` | #1, #33, Daily Leads | Overlaps `barryOrientationBrief` opening-brief path | Neither | Partially — `loadServerSideRecommendations()` duplicates `recommendationEngine.js` in JS, correctly AI-free | No |
| `barryOrientationBrief.js` (323 L) | 2–3 sentence Mission Control orientation | F,R | KPI ctx → `{brief, suggestedPrompts, mode}` | #1 | `barryMissionChat` `__OPENING_BRIEF__` path | Neither — **closest thing to a Morning Brief Skill** | No — computes facts deterministically, uses Haiku for prose only. **Correct pattern.** | Yes, 10 min sessionStorage |
| `barryActions.js` (~450 L) | Gmail/Calendar intent parse + execute | R,P,E | message → `{action_type, parameters, confirmation_required}` | #1 | — | **Closest thing to a Capability Registry** — 5 declared actions with `confirmation_required` per action | **Yes** — Haiku parses intent into a 6-value enum. Deterministic-ish; should be a typed tool schema | No |
| `barryPipelineAction.js` (453 L) | Mutates contacts/missions from chat | E | action → mutation | #1 | — | Side-effect capability | No AI | n/a |
| `generate-engagement-message.js` (615 L) | 4-angle message generation | P | contact+intent → 4 messages w/ reasoning | #4, #17, #31, #37 | **Canonical 4-angle generator** | Neither — should be `WriteEngagementMessageSkill` | No | **No** |
| `barryHunterGenerateStep.js` (264 L) | 4-angle draft for mission step 2+ | P | mission+outcome → 4 angles | #26 | **Duplicate of `generate-engagement-message`** | Neither | No | No |
| `barryGenerateSequenceStep.js` (373 L) | Sequence step generation | P | sequence ctx → step | #27, #22, `MissionDetail` | Partial duplicate of above | Neither | No | No |
| `barryFirstTouch.js` (246 L) | First-touch message | P | contact+serviceProfile → message | #20 | Partial duplicate | Neither | No | No |
| `barryOutreachMessage.js` (126 L) | Outreach message | P | contact → message | `outreachService.js` | **Duplicate** | Neither | No | No |
| `barryBulkPersonalize.js` (391 L) | Personalized opener per contact, ≤25 | P | contacts[] + body → openers[] | #35 | Partial duplicate | **Closest thing to a batched Skill** | No | No |
| `generate-followup.js` (113 L) | Follow-up from outcome | P | original+outcome → follow-up | #28 | Duplicate | Neither | No | No |
| `generate-campaign-messages.js` | Campaign message set | P | campaign → messages | `CreateCampaign`, `EmailWeapon` | Duplicate | Neither | No | No |
| `generate-text-messages.js` | SMS variants | P | contact → SMS | `TextWeapon` | Duplicate (SMS channel) | Neither | No | No |
| `barryGenerateTemplate.js` (179 L) | Email template | P | stage+description → template | #29 | Partial duplicate | Neither | No | No |
| `barryGenerateMissionSequence.js` (338 L) | Full mission sequence | R,P | mission → sequence | `CreateMission`, `GoToWar` | — | **Closest thing to `LaunchCampaignWorkflow`** | No | No |
| `barryHunterProcessEngage.js` (442 L) | **Chain**: load ctx → guardrail → warmth → strategy → generate | F,R,P | contactId → full engage package | #32 | — | **The only real Workflow in the repo** | No | No |
| `barryHunterCardRead.js` (183 L) | One-line card read | F,R | contact → 1 sentence | #25 | — | Neither | Borderline — a rule-based read would cover most cases | Yes (in-function) |
| `barryCSMRead.js` (213 L) | Customer health read | F,R | customer → assessment | #42 | Same shape as `barryHunterCardRead` | Neither | Borderline | Yes |
| `barryDossierBriefing.js` (116 L) | Contact dossier | F | contact → briefing | #7 | Overlaps `barryHunterCardRead` | **Closest thing to `GenerateMeetingBriefSkill`** | No | **No** |
| `barryValidateContact.js` (204 L) | Contact field validation | F | contact fields → validity | #36 | — | Neither | **Yes** — Sonnet-4.5 @ 500 tokens for what is field-shape validation | No |
| `barryICPConversation.js` (1043 L, 4 AI sites) | Onboarding ICP conversation | F | messages → ICP | #41 | Overlaps `barryMissionChat` ICP path, `barry-coach-section` | Neither | Partially — Apollo industry mapping is a lookup table done by prompt | No |
| `barryReconInterview.js` (227 L) | Recon section coaching | F | section → guidance | #38 | Near-duplicate of `barryReconSection0` | Neither | No | No |
| `barryReconSection0.js` (209 L) | Section 0 coaching | F | answers → guidance | #38 | Near-duplicate of above | Neither | No | No |
| `barry-coach-section.js` (231 L) | Post-save section coaching | F,R | section → mirror+inference | #40 | Overlaps `barryReconInterview` | Neither | No | No |
| `generate-section-1..10.js` (10 files, ~200 L each) | Recon section generation | F | answers → section | #39 | **10 near-identical files** | Neither — should be one `GenerateReconSectionSkill(sectionId)` | No | No |
| `generate-icp-brief.js` + `.cjs` | ICP brief | F | ICP → brief | #47 | **`.js` and `.cjs` are two copies** | Neither | No | No |
| `generate-all-reports.js` | All recon reports | F | dashboard → reports | — | Duplicates `generate-section-*` | **Closest thing to a batched Workflow** | No | No |
| `analyze-website.js` (~650 L) | Website → business profile | F | URL → profile JSON | Onboarding | — | `ResearchCompanySkill` candidate | No | No |
| `utils/barryInboxAnalyzer.js` (209 L) | Inbound message → `ConversationAnalysis` | F | message → 15-field analysis | `process-barry-inbox-queue` | — | **`AnalyzeInboundMessageSkill` candidate — best-specified output contract in the repo** | No | Idempotent (skips if analysis exists) |
| `utils/barryDraftComposer.js` (165 L) | Analysis → `DraftReply` | P | analysis → draft | `process-barry-inbox-queue` | — | **`ComposeReplySkill` candidate** | No | Idempotent |

## 2.2 Server-side non-AI Barry services

| Module | Purpose | Layer | Notes |
|---|---|---|---|
| `utils/barryContextAssembler.js` (471 L) | Server context assembly for a contact | F | **The best context implementation in the repo.** Priority-tiered truncation (P0–P3), 30 s TTL cache, 1200-char budget. Consumed by only 4 endpoints. |
| `utils/barryStrategyRecommender.js` (331 L) | Strategy + channel scoring | **Think** | Recency-weighted (0.7^i), contact + user level, emits `reasons[]`. **The Think layer.** Reaches 4 endpoints. |
| `utils/barryGuardrail.js` (188 L) | Pre-generation relationship mismatch check | R | Rule-based, zero AI, 4 rules. Reaches 2 endpoints. |
| `utils/relationshipContext.js` (80 L) | Upserts `relationship_context` doc | F | Sprint 2 structure; Sprint 3 fills it |
| `utils/messageProcessor.js` (291 L) | 7-step inbound pipeline | S,F | **The only signal pipeline in the product** |
| `utils/contactMatcher.js` (194 L) | Contact match waterfall w/ confidence | F | Emits `MATCH_CONFIDENCE` — the only confidence-scored inference |
| `utils/reconCompiler.js` (157 L) | RECON → prompt | F | **Drifted from `src/utils/reconCompiler.js` (243 L)** |
| `utils/reconCapability.js` (124 L) | RECON score + capability block | F | Weighted section scoring; prompt string, not a registry |
| `utils/anthropicRetry.js` (42 L) | Retry wrapper | — | Used by 3 of 40 AI modules |
| `utils/logApiUsage.js` (98 L) | Usage logging | — | **Mislabels everything as Apollo** |
| `barryEnrich.js` (1039 L) | Multi-source enrichment orchestration | F | **Zero AI by design** — doc comment: *"Barry orchestrates tools, Barry does not think."* Best example of Principle 5 in the repo |
| `barryOutcomeAttribution.js` (447 L) | Outcome → strategy attribution | Learned Intelligence | Zero AI. Writes `barry_attributions` + `strategy_stats` |
| `inferRelationshipWarmth.js` (409 L) | Behavioral warmth inference | F | Zero AI |
| `process-barry-queue.js` (169 L) | Scheduled 9am M–F re-engage sweep | S→R | **Mutates `contact_status` (Fact) while producing a Recommendation** — layer conflation |
| `process-barry-inbox-queue.js` | Analysis + draft orchestrator | F,P | Idempotent, 10 entries per run, **has no scheduler** |
| `gmail-sync-worker.js` (847 L incl. service) | Gmail poll every 10 min, 50 users, 50 msgs/user | S | The only real signal producer |
| `barry-approve-send.js` (325 L) | Approved draft → Gmail send | E | **No double-send guard** — see §7 |

## 2.3 Client-side Barry services and hooks

| Module | Purpose | Layer | Duplicate of |
|---|---|---|---|
| `src/services/barryMemoryService.js` (992 L) | Contact memory, user memory, sessions, outcomes, brigade | F, memory | `assembleBarryContext()` duplicates `barryContextAssembler.js` |
| `src/utils/barryContextStack.js` (316 L) | Workspace context (500 contacts, missions, RECON, calendar) | F | Third context implementation |
| `src/context/barryContextStore.js` (36 L) | Module pub/sub context singleton | F | Fourth — **orphaned** (only consumer `BarryTrigger` is unmounted) |
| `src/context/ShellContext.jsx` | `navigationContext` (11 fields) | Session | Fifth |
| `src/utils/recommendationEngine.js` (1151 L) | 11 recommendation types, priority weights, dismissals | R | Duplicated server-side in `barryMissionChat.loadServerSideRecommendations()` |
| `src/services/nextBestStepService.js` (635 L) | 11 NBS types, queue, morning briefing | R,P | `generateMorningBriefing()` duplicates `barryOrientationBrief` |
| `src/hooks/useRecommendations.js` (137 L) | Normalizes engine output to Sprint-2A contract | R | Wrapper (correct) |
| `src/hooks/usePendingReplies.js` (192 L) | Walks contacts → `barry_drafts` + `barry_analysis` | F,P | **N+1 read pattern; no index** |
| `src/hooks/useGamePrefetch.js` | 10-card AI prefetch buffer, max 3 concurrent | P | Highest AI volume in product |
| `src/services/barryCSM.js` | CSM health | F,R | — |
| `src/utils/timelineLogger.js` / `engagementHistoryLogger.js` | Timeline writes, ~30 event types | S | **Two loggers, overlapping event vocabularies** |
| `src/services/analytics.js` | Product events to `analytics_events` | S | Separate event stream from timeline |

## 2.4 Call frequency classification

| Class | Basis | Endpoints |
|---|---|---|
| **Measured** | none | — |
| **Calculated** | fixed schedule in code | `gmail-sync-worker` (`*/10 * * * *`, ≤50 users × ≤50 msgs), `process-barry-queue` (`0 9 * * 1-5`), `daily-leads-refresh` (`0 9 * * 1-5`) |
| **Estimated** | derived from UI trigger shape | `barryHunterCardRead` (1/card render), `generate-engagement-message` (1/engagement + 10/game session prefetch), `barryBulkPersonalize` (1/contact, ≤25/batch), `barryOrientationBrief` (≤6/day at 10-min TTL), `barryMissionChat` (1/user turn) |
| **Unknown** | no instrumentation and no fixed trigger | all 30 remaining endpoints |

---

# Step 3 — Barry Context, Memory, and Awareness Audit

## 3.1 Context implementations — there are nine

| # | Implementation | File | Scope | Loads | Cache | Consumers |
|---|---|---|---|---|---|---|
| 1 | `assembleBarryContext` (server) | `netlify/functions/utils/barryContextAssembler.js` | Contact | contact, `barry_memory`, user memory, 5 sessions, `strategy_stats`, 5 attributions | 30 s in-memory Map, 100 entries | 4 endpoints |
| 2 | `assembleBarryContext` (client) | `src/services/barryMemoryService.js:599` | Contact | same shape, client SDK | None | Contact surfaces |
| 3 | `buildContextStack` | `src/utils/barryContextStack.js` | Workspace | 500 contacts, 20 missions, dashboard, ICP, 5 service profiles, 30 calendar events | 5 min sessionStorage | `BarryChatPanel` |
| 4 | `barryContextStore` | `src/context/barryContextStore.js` | Module | whatever a page sets | None | **Orphaned** |
| 5 | `navigationContext` | `src/context/ShellContext.jsx:323` | Session | 11 route/entity fields | Memo | Every Barry request |
| 6 | `relationship_context` | `netlify/functions/utils/relationshipContext.js` | Contact | inbound summary, conversation state, 6 Sprint-3 arrays | Firestore doc | Inbox analyzer, draft composer |
| 7 | `compileReconForPrompt` | `netlify/functions/utils/reconCompiler.js` (157 L) | Workspace | RECON sections | None | 4 endpoints |
| 8 | `compileReconForPrompt` | `src/utils/reconCompiler.js` (243 L) | Workspace | RECON sections | None | Client — **drifted from #7** |
| 9 | Inline assembly | `barryHunterProcessEngage.js`, `barryICPConversation.js`, `barryOrientationBrief.js`, `barryMissionChat.js` | varies | ad hoc Firestore reads | None | themselves |

**Answer: nine distinct Barry context implementations.** Five of them (#1, #2, #3, #6, #9) can hold contradictory views of the same contact at the same moment, because none reads the others.

## 3.2 Conversation stores — there are six

| Store | Path | Written by | Read by |
|---|---|---|---|
| Mission Control thread | `users/{uid}/barryConversations/missionControl` | `BarryChatPanel.jsx:60` | `BarryChatPanel.jsx:75` |
| Per-module drawer | `users/{uid}/barryConversations/drawer_{module}` | `BarryChat.jsx:189,243` | `BarryChat.jsx:108` — **dead component** |
| ICP result | `users/{uid}/barryConversations/icp` | `BarryICPPanel.jsx:92` | admin view |
| ICP chat | `users/{uid}/barryConversations/icpChat` | `BarryICPPanel.jsx:79` | itself |
| Recon coach | `users/{uid}/barryConversations/reconCoach_{sectionId}` | `BarryReconCoach.jsx:159` | itself |
| Session index | `users/{uid}/barry_sessions/{sid}` | `BarryChatPanel.jsx:87,106` | `BarrySessionHistoryPanel.jsx:112` |

**Critical schema contradiction:** `barry_sessions` names **two different collections with different parents and different schemas**:
- `users/{uid}/contacts/{cid}/barry_sessions/{sid}` — engage-session records (`peopleSchema.js:433`, `barryMemoryService.js:291`, `barryContextAssembler.js:218`)
- `users/{uid}/barry_sessions/{sid}` — chat-panel session index (`BarryChatPanel.jsx:87`)

An engineer reading `barry_sessions` in one file and writing it in another will silently produce the wrong document. ADR-005 declares memory is keyed by contact and sessions live beneath it — the second collection contradicts the accepted ADR.

## 3.3 The five memory types

### User Memory — **partially exists, incomplete**
- **Where:** `users/{uid}/barry_memory/current` (`peopleSchema.PEOPLE_PATHS.userBarryMemory`)
- **Fields:** `preferred_tone`, `preferred_channel`, `tone_usage{}`, `channel_usage{}`, `total_sessions`
- **Written by:** `barryMemoryService.updateUserBarryMemory()` (client only)
- **Read by:** `barryContextAssembler` (server), `barryMemoryService` (client)
- **Missing:** business facts, ICP, goals, operating preferences, working hours, risk tolerance. Those live scattered in `dashboards/{uid}` (RECON), `users/{uid}/companyProfile/current`, `users/{uid}/icpProfiles`, `users/{uid}/serviceProfiles` — **four more locations, none of which Barry treats as memory.**
- **Drift:** `derivePreferredTone()` writes only when usage counts cross a threshold; nothing else validates the field. `channel_preference` on contact memory shadows `preferred_channel` on user memory with no precedence rule stated anywhere except one `||` in `barryContextAssembler.js:128`.

### Relationship Memory — **exists, and is fragmented across four documents**
- `users/{uid}/contacts/{cid}.barry_memory` — `who_they_are`, `current_goal`, `relationship_summary`, `what_has_been_tried[≤20]`, `what_has_worked[≤15]`, `what_has_not_worked[≤15]`, `known_facts[≤30]`, `tone_preference`, `channel_preference`, `context_by_session{≤20}`
- `users/{uid}/contacts/{cid}/relationship_context/{uid}` — `openQuestions[]`, `openCommitments[]`, `objections[]`, `positiveSignals[]`, `informationShared[]`, `conversationState`, `recommendedAction`
- `users/{uid}/contacts/{cid}.engage_state` — `status`, `current_goal`, `last_barry_session{summary,next_step}`
- `users/{uid}/contacts/{cid}.engagement_summary` — counters
- **The same concept under different names:** `barry_memory.current_goal` and `engage_state.current_goal` are the same field in two places, written by different code paths, never reconciled. `barry_memory.what_has_not_worked` and `relationship_context.objections` are the same concept from two sprints.
- **Drift:** `relationship_context` uses camelCase; `barry_memory` uses snake_case; both are on the same contact.

### Mission Memory — **does not exist**
`users/{uid}/missions/{mid}` carries `outcome_goal`, `steps[]`, `status`, `barry_reasoning`. There is no store for mission strategy, decisions, progress rationale, or campaign context. `barryGenerateMissionSequence` produces a sequence and forgets why.

### Learned Intelligence — **exists and is the most mature Barry subsystem**
- `users/{uid}/barry_memory/strategy_stats` — `angle_outcomes{}`, `channel_outcomes{}`, `guardrail_outcomes{}`, `total_attributions`
- `users/{uid}/contacts/{cid}/barry_attributions/{id}` — `outcome`, `outcome_class`, `strategy_used`, `channel_used`, `followed_advice`, `guardrail_type`, `guardrail_action`
- Written by `barryOutcomeAttribution.js` (zero AI). Read by `barryContextAssembler` and `barryStrategyRecommender`.
- **Gating is sound:** stats suppressed below 3 attributions, insights below 5, per-strategy minimum 3 uses.
- **Gap:** learns only from message outcomes. Nothing learns from approvals, edits, dismissals, or rejected recommendations — `recommendationEngine.dismissRecommendation()` writes a dismissal that only suppresses for 7 days and never feeds `strategy_stats`.

### Conversation / Session Memory — **exists in six places and DOES contaminate durable memory**
- Six stores (§3.2), plus contact-scoped `barry_sessions`.
- **Contamination path, confirmed:** `barryMemoryService.closeBarrySession()` (line 427) writes the session's derived summary into the contact document at line 452, and `updateContactMemory()` (line 123) appends session-derived strings into `what_has_been_tried` / `what_has_worked` / `what_has_not_worked` — arrays that `barryContextAssembler` injects into every future prompt at priority P1. A single mislabeled session permanently biases every subsequent generation for that contact. There is no review step, no confidence gate, and no unlearn path. `boundArray()` only trims by age.
- **Law 18 is violated by design, not by accident.**

## 3.4 The four awareness projections

| Projection | Exists? | What is there instead |
|---|---|---|
| **Relationship Awareness** | **No — reconstructed per surface** | Eight competing fields on the contact document (`contact_status` 203 refs, `warmth_level` 117, `relationship_state` 117, `person_type` 81, `hunter_status` 68, `conversationState` 50, `engage_state` 40, `lead_status` 32, `engagement_intent` 25, `brigade` 296, `stage` 534). `src/constants/statusModel.js` documents the contradiction explicitly and adds three *more* fields as a compatibility layer, dual-writing rather than migrating. |
| **Business Awareness** | **No** | Recomputed independently in `barryOrientationBrief.js:112-192`, `barryMissionChat.loadServerSideRecommendations()`, `recommendationEngine.generateDashboardRecommendations()`, `MissionControlDashboardV2.jsx:716-800`, and `nextBestStepService.generateMorningBriefing()`. Five implementations, five threshold sets. `recommendationEngine` uses `STALLED_AWAITING_REPLY: 14`; `barryOrientationBrief` uses `staleMissions > 14`; `barryMissionChat` has its own `TIMEFRAME_DAYS`. They will disagree. |
| **Mission Awareness** | **No** | `missions` read raw at 4+ sites |
| **User Awareness** | **Partial** | `barry_memory/current` (tone/channel) + `strategy_stats`. Nothing tracks approval behavior, timing, or edit patterns. `analytics_events` collects navigation but no consumer reads it. |

## 3.5 Where the five layers are conflated

| Conflation | Location | Consequence |
|---|---|---|
| Recommendation → Fact | `process-barry-queue.js:131` sets `contact_status: 'Awaiting Reply'` while generating a `follow_up_due` notification | Barry's recommendation permanently rewrites relationship state. Cannot be undone or explained. |
| Awareness → Prepared Action, same pass | `process-barry-inbox-queue.js` steps 3 and 6 write `barry_analysis` and `barry_drafts` in one transaction-less loop | A draft can exist for an analysis that failed to persist, and vice versa |
| Fact → Signal | `messageProcessor.js` step 7 emits to `barry_processing_queue` only after writing 4 documents | The "signal" is a work item, not an event; it cannot be replayed or fanned out |
| Prepared Action → Executed | `barry-approve-send.js` sends to Gmail, then writes the record | Gmail send succeeds, Firestore write fails, user retries, message sent twice |
| Session → Durable memory | `barryMemoryService.closeBarrySession()` → contact `barry_memory` | See §3.3 |
| Recommendation → Recommendation | `recommendationEngine` (client), `loadServerSideRecommendations` (server), `nextBestStepService` (client) | Three recommendation vocabularies with no shared IDs. A recommendation dismissed in one is still live in the others. |

## 3.6 Does a Think layer exist?

**Yes — one, and it is good.** `netlify/functions/utils/barryStrategyRecommender.js` (331 L):
- Inputs: contact, `engagementIntent`, `strategyStats`, `barryMemory`, `recentAttributions`
- Reasoning: four strategies scored 0–100 from six weighted signal sources, recency-decayed at `0.7^i`, relationship-state adjustments, high-value-cold humor suppression, user-level aggregate rates
- Output: `{recommendation:{strategy, confidence, bestChannel, avoidStrategies, reasons[]}, promptGuidance, strategyScores}`
- Emits a differentiation gate: no recommendation surfaces unless the top strategy leads the second by ≥10 points

**But:** it reaches 4 of 38 AI endpoints, reasons only about message strategy, never compares priorities *across* relationships or missions, and never weighs urgency against relationship value. It is a strategy chooser, not a priority arbiter. The half of the Think layer that decides *who matters most today* does not exist anywhere.

**Everywhere else, Barry jumps directly from context to output.**

## 3.7 Where context is lost on navigation

| Boundary | What is lost | Cause |
|---|---|---|
| Any pathname change | Entity context, action context | `ShellContext` clears entity state on pathname change (deliberate, per ADR-005) |
| Mission Control → Contact page | The chat thread's knowledge of the contact | `BarryChatPanel` holds one thread; the contact surfaces hold none |
| Module → Module | Nothing now (positive) | Modules consolidated onto the shell Barry — `SniperMain.jsx:7`, `BasecampMain.jsx:7`, `ReinforcementsMain.jsx:7`, `FallbackMain.jsx:7` all carry *"own Barry instance"* removal notes |
| Recon → anywhere | The entire coaching conversation | `barryConversations/reconCoach_{sectionId}` is never read outside Recon |
| Refresh | `navigationContext`, `barryContextStore` | Router state + in-memory singleton |
| Impersonation switch | `barryContextStack` cache is per-user keyed (correct); `barryContextStore` is not (leaks) | `getCacheKey(userId)` vs module-level `_ctx` |

**And the sharpest one:** ADR-005 states *"The key is produced and carried; it is not yet consumed."* `barrySessionKey` is computed on `ContactPage.jsx:71`, rides `navigationContext` on every request, and **no server endpoint reads it**. Barry is told which conversation this is and ignores it.

---

# Step 4 — Signal and Data Source Audit

## 4.1 Signal map

| Event | Barry knows | Partially knows | Blind to | Evidence |
|---|---|---|---|---|
| `contact.reply_received` | ✅ | | | `gmail-sync-worker` → `messageProcessor` → `barry_processing_queue` → analysis + draft. **The only fully-wired signal.** |
| `contact.email_sent` | | ⚠️ | | Written to `timeline` + `communication_records` by `gmail-send*.js` and `barry-approve-send.js`, but **no queue entry, no awareness update**. Barry learns a message was sent only when he next reads the contact. |
| `contact.status_changed` | | ⚠️ | | `timelineLogger` `contact_status_changed`. Also mutated silently by `process-barry-queue.js:131` **without** a timeline write. |
| `contact.meeting_booked` | | | ❌ | `calendar-create-event.js` writes to Google Calendar and returns. No Firestore write, no timeline event, no signal. |
| `contact.added_to_campaign` | | ⚠️ | | `timelineLogger` `campaign_assigned` |
| `campaign.step_completed` | | ⚠️ | | `timelineLogger` `sequence_step_sent` — contact-scoped only. No campaign-level roll-up. |
| `campaign.goal_achieved` | | | ❌ | No goal-achievement detection anywhere |
| `scout.company_discovered` | | | ❌ | `search-companies.js` writes company docs; no event |
| `scout.company_accepted` | | ⚠️ | | `company.status = 'accepted'` + `swipedAt`. Read by `barryOrientationBrief` (7-day window) — inferred by query, not received as a signal. |
| `reinforcement.followup_due` | | ⚠️ | | `process-barry-queue.js` writes `notifications` docs `type: 'follow_up_due'`. **Barry does not read the notifications collection.** |
| `reinforcement.email_sent` | | ⚠️ | | Same path as `contact.email_sent` |
| `mission.created` | | | ❌ | `missionService.js` writes mission docs; no event |
| `mission.stage_changed` | | | ❌ | `mission.steps[].status` mutated in place, no event |
| `company.enriched` | | | ❌ | `enrichCompany.js` / `barryEnrich.js` write fields, no event |
| `contact.enriched` | | | ❌ | `enrichContact.js` writes fields, no event |
| `calendar.meeting_today` | | ⚠️ | | `barryContextStack.getCalendarContext()` fetches 30 days live and fuzzy-matches attendee emails and titles against Hunter contacts. Not persisted, not a signal, and **silently returns `[]` on any failure** (`barryContextStack.js:203`) — Barry cannot distinguish "no meetings" from "calendar failed". |
| `calendar.meeting_created` | | | ❌ | See `contact.meeting_booked` |

**Score: 1 known, 7 partially known, 9 blind.**

## 4.2 The one real signal pipeline

`netlify/functions/utils/messageProcessor.js` — `processNormalizedMessage(db, message)`:

1. Duplicate check on `gmailMessageId` + `idynifyUserId`
2. Contact matching waterfall (`contactMatcher.js`) with `MATCH_CONFIDENCE` HIGH/MEDIUM/LOW
3. Persist `communication_records/{id}`
4. Timeline event — **only if HIGH or MEDIUM confidence**
5. Update `conversationState` via `resolveInboundTransition()`
6. Upsert `relationship_context`
7. Emit to `barry_processing_queue`

This is a well-built pipeline with a typed input contract (`src/types/normalizedMessage.js` with `validateNormalizedMessage()`), a typed result (`processingResult.js`), and a state machine (`conversationState.js`). **It is the template for the signal bus.** Its defects: the queue entry is a work item rather than an event (single consumer, no fan-out, no replay), LOW-confidence matches drop to `unmatched_messages` and disappear, and `process-barry-inbox-queue` has **no scheduler entry in `netlify.toml`** — nothing invokes it on a timer.

## 4.3 Data sources Barry could use but does not

| Source | Location | Currently used by Barry |
|---|---|---|
| `users/{uid}/analytics_events` | `services/analytics.js` | Nothing reads it |
| `users/{uid}/notifications` | `process-barry-queue.js`, `notificationService.js` | `HunterDashboard` onSnapshot only |
| `users/{uid}/nbs_queue` | `nextBestStepService.js` | `loadNbsQueue`/`loadOverdueNbs`; not in any Barry prompt |
| `users/{uid}/contacts/{cid}/brigade_log` | `barryMemoryService.applyBrigadeTransition()` | Nothing |
| `users/{uid}/contacts/{cid}/nbs_history` | `nextBestStepService` | Nothing |
| `apiLogs` | `logApiUsage` | Admin dashboard only |
| `email_logs` | `utils/emailLog.js` | Admin only |
| `unmatched_messages` | `gmailMessageService.js` | Nothing — dropped replies are invisible |
| `users/{uid}/linkedin_connections` | `import-linkedin-connections.js` | `scoreLinkedInConnection.js` only |
| `users/{uid}/companies` | Scout | Read by `barryOrientationBrief`, `barryMissionChat`. **Not by any contact-level Barry surface** — Barry drafting a message to a contact cannot see the company record. |

---

# Step 5 — Duplicate Implementation Audit

| # | Capability duplicated | Implementations | How they differ | Most complete | Skill/Workflow candidate | Disposition |
|---|---|---|---|---|---|---|
| 1 | **Barry context assembly** | `netlify/functions/utils/barryContextAssembler.js` (471 L) · `src/services/barryMemoryService.js:599` (client) | Server has priority truncation, 30 s cache, strategy stats, attributions; client has none | **Server** | `ResolveContactContextSkill` | **Consolidate** → one server contract; client calls it |
| 2 | **Workspace context** | `barryContextStack.js` (client, 500 contacts) · inline loads in `barryMissionChat`, `barryOrientationBrief` | Client sends 500 contacts over the wire on every message; server re-reads the same data | Server reads | `ResolveWorkspaceContextSkill` | **Replace** both with server-side workspace context resolver |
| 3 | **RECON compiler** | `src/utils/reconCompiler.js` (243 L) · `netlify/functions/utils/reconCompiler.js` (157 L) | **Drifted — 86 lines apart** | Client (longer) — but neither is authoritative | `CompileReconContextSkill` | **Consolidate** → shared module, single source |
| 4 | **RECON section map** | `src/utils/reconSectionMap.js` (37 L) · `netlify/functions/utils/reconSectionMap.js` (6 L) | Server is a stub | Client | — | **Consolidate** |
| 5 | **Recommendation generation** | `recommendationEngine.js` (1151 L, 11 types) · `barryMissionChat.loadServerSideRecommendations()` · `nextBestStepService.deriveNextBestStep()` (11 NBS types) | Three vocabularies, three threshold sets, no shared IDs | `recommendationEngine` | `GenerateRecommendationsSkill` | **Consolidate** → server-side, one vocabulary, one ID space |
| 6 | **Morning / orientation brief** | `barryOrientationBrief.js` · `barryMissionChat` `__OPENING_BRIEF__` path · `nextBestStepService.generateMorningBriefing()` | Three briefs, three data sets | `barryOrientationBrief` | `GenerateMorningBriefSkill` | **Consolidate**; delete the other two |
| 7 | **4-angle message generation** | `generate-engagement-message.js` (615 L) · `barryHunterGenerateStep.js` · `barryGenerateSequenceStep.js` · `barryFirstTouch.js` · `barryOutreachMessage.js` · `barryBulkPersonalize.js` | Different prompts, different context depth; only the first three use guardrail + strategy recommender | `generate-engagement-message` | `WriteEngagementMessageSkill(intent, channel, stepContext)` | **Consolidate** all six into one parameterised Skill |
| 8 | **Follow-up generation** | `generate-followup.js` · `generate-campaign-messages.js` · `generate-text-messages.js` · `barryGenerateTemplate.js` | Channel and framing differ only | `generate-campaign-messages` | `WriteFollowUpSkill(channel)` | **Consolidate** into #7 with a channel parameter |
| 9 | **RECON section generation** | `generate-section-1.js` … `generate-section-10.js` (10 files, ~200 L each, ~2 000 L total) | Prompt text only | any | `GenerateReconSectionSkill(sectionId)` | **Consolidate** → 1 file + 10 prompt templates |
| 10 | **ICP brief generation** | `generate-icp-brief.js` (4096 tok) · `generate-icp-brief.cjs` (2048 tok) · `generate-all-reports.js` | `.cjs` is a stale copy | `.js` | `GenerateIcpBriefSkill` | **Delete** `.cjs`; **consolidate** `generate-all-reports` |
| 11 | **RECON coaching** | `barryReconInterview.js` · `barryReconSection0.js` · `barry-coach-section.js` | Mode differs (`intro`/`ask` vs section 0 vs post-save) | `barryReconInterview` | `CoachReconSectionSkill(mode)` | **Consolidate** |
| 12 | **One-line entity read** | `barryHunterCardRead.js` (60 tok) · `barryCSMRead.js` (150 tok) · `barryDossierBriefing.js` (200 tok) | Persona + audience differ | `barryDossierBriefing` | `SummarizeRelationshipSkill(depth)` | **Consolidate** |
| 13 | **Mission Control dashboard** | `pages/Scout/MissionControlDashboardV2.jsx` (routed) · `pages/MissionControlDashboardV2.jsx` (unrouted) · `pages/MissionControlDashboard.archived.jsx` · `pages/Scout/MissionControl.jsx` · `pages/UnifiedDashboard.jsx` · `pages/Dashboard.jsx` | Generations of the same screen | routed V2 | — | **Delete** the four unrouted; **consolidate** `Scout/MissionControl.jsx` |
| 14 | **ICP Validation page** | `pages/ICPValidationPage.jsx` · `components/ICPValidationPage.jsx` · `OLD` · `OLD2` · `old3` | Generations | `pages/` | — | **Delete** 4 |
| 15 | **Scout questionnaire / phases** | `ImprovedScoutQuestionnaire.jsx` + ` copy.jsx` · `ScoutQuestionnaire OLD.jsx` · `old2.jsx` · `Phase1Discovery{,copy,copy2,copy3}.jsx` · `Phase2Scoring{,copy,2copy}.jsx` · `Phase5CampaignBuilder{,2}.jsx` · `LaunchSequence{, old}.jsx` | Copies | — | — | **Delete** 13 files; all call non-existent endpoints |
| 16 | **Brigade system** | `src/utils/brigadeSystem.js` (207 L) · `src/data/brigadeSystem.js` (681 L) | Definitions vs helpers, overlapping | `data/` | — | **Consolidate** |
| 17 | **Timeline logging** | `timelineLogger.js` (~12 types) · `engagementHistoryLogger.js` (~30 types, "extends not replaces") | Two vocabularies on one collection | `engagementHistoryLogger` | `EmitSignalCapability` | **Consolidate** → one signal emitter |
| 18 | **Contact status model** | `contact_status` · `lead_status` · `relationship_state` · `warmth_level` · `conversationState` · `hunter_status` · `stage` · `brigade` · `person_type` · plus `statusModel.js`'s three new fields | Nine+ overlapping dimensions, dual-written | `statusModel.js` (documented, three-dimension) | — | **Consolidate** → the three `statusModel` dimensions; backfill and delete the rest (`docs/STATUS_ARCHITECTURE.md` already has the plan) |
| 19 | **Section 1 Foundation** | `Section1Foundation.jsx` · `Section1Foundation.backup.jsx` | Backup file in tree | live | — | **Delete** |
| 20 | **`barry_sessions` collection name** | `users/{uid}/contacts/{cid}/barry_sessions` · `users/{uid}/barry_sessions` | Same name, different parent + schema | contact-scoped (ADR-005) | — | **Replace** — rename the user-scoped one to `barry_conversations_index` |

**Totals: 20 duplicate capability groups. Recommended deletions: ~30 files (~8 000 lines). Recommended consolidations: 12 groups → 8 named Skills.**

---

# Step 6 — Cost Baseline

## 6.1 Per-endpoint cost table

Token counts are **estimated** from `max_tokens` (output ceiling) and prompt construction inspection unless stated otherwise. Nothing in this product measures actual tokens in a queryable form.

| Function | Model | Prompt tok | Completion tok | Basis | Calls/user/day | Basis | Trigger | Cached | AI-for-deterministic | Duplicates |
|---|---|---|---|---|---|---|---|---|---|---|
| `generate-engagement-message` | sonnet-4-5 | ~2 500 | ≤4 096 | Estimated | **10–40** | Estimated (1/engagement + 10/game prefetch) | User | **No** | No | #7 |
| `barryHunterCardRead` | haiku-4-5 | ~800 | ≤60 | Estimated | **5–30** | Estimated (1 per card render) | Auto on render | In-function | Borderline | #12 |
| `barryMissionChat` | haiku-4-5 | **~15 000+** | ≤2 000 | Estimated — contextStack ships 500 contacts | **5–20** | Estimated (1/turn) | User | No | Partial | #6 |
| `barryOrientationBrief` | haiku-4-5 | ~900 | ≤300 | Estimated | **2–6** | Calculated (10-min TTL) | Auto on MC mount | 10 min | **No — correct pattern** | #6 |
| `barryBulkPersonalize` | haiku-4-5 | ~1 200 ea | ≤300 ea | Estimated | **0–25 per batch** | Estimated | User | No | No | #7 |
| `barryHunterGenerateStep` | haiku-4-5 | ~3 000 | ≤2 500 | Estimated | 2–10 | Estimated | User | No | No | #7 |
| `barryHunterProcessEngage` | haiku-4-5 | ~3 000 | ≤2 500 | Estimated | 2–10 | Estimated | User | No | No | — |
| `barryGenerateSequenceStep` | sonnet-4-5 | ~2 500 | ≤1 000 | Estimated | 2–8 | Estimated | User | No | No | #7 |
| `barryFirstTouch` | haiku-4-5 | ~1 500 | ≤800 | Estimated | 1–5 | Estimated | User | No | No | #7 |
| `barryOutreachMessage` | **sonnet-4-6** | ~1 000 | ≤300 | Estimated | 1–5 | Estimated | User | No | No | #7 |
| `barryDossierBriefing` | **sonnet-4-6** | ~1 500 | ≤200 | Estimated | 1–5 | Estimated | User | **No** | No | #12 |
| `barryCSMRead` | **sonnet-4-6** | ~1 200 | ≤150 | Estimated | 1–5 | Estimated | User | Yes | Borderline | #12 |
| `barryActions` | haiku-4-5 | ~600 | ≤400 | Estimated | 0–5 | Estimated | User | No | **Yes** — enum parse | — |
| `barryValidateContact` | sonnet-4-5 | ~600 | ≤500 | Estimated | 0–10 | Estimated | User | No | **Yes** — field validation | — |
| `barryGenerateMissionSequence` | sonnet-4-5 | ~3 000 | ≤1 800 | Estimated | 0–3 | Estimated | User | No | No | — |
| `barryGenerateContext` | sonnet-4-5 | ~2 000 | ≤1 500 | Estimated | 1–5 | Estimated | User | No | No | — |
| `barryGenerateTemplate` | **3-5-haiku (legacy)** | ~1 000 | ≤1 500 | Estimated | 0–3 | Estimated | User | No | No | #8 |
| `barryICPConversation` (×4 sites) | sonnet-4-5 | ~2 000 | ≤1 500 ×3, ≤500 | Estimated | 0–10 (onboarding only) | Estimated | User | No | Partial | #11 |
| `barryReconInterview` | haiku-4-5 | ~1 500 | ≤300 | **Measured** (`usage` in metadata) | 0–20 (Recon only) | Estimated | User | No | No | #11 |
| `barryReconSection0` | haiku-4-5 | ~1 200 | ≤500 | **Measured** | 0–10 | Estimated | User | No | No | #11 |
| `barry-coach-section` | **sonnet-4-6** | ~2 000 | ≤800 | **Measured** | 0–10 | Estimated | User | No | No | #11 |
| `generate-section-1..10` | **sonnet-4-20250514 (legacy)** | ~3 000 ea | ≤4 096 ea | **Measured** (`tokensUsed`) | 0–10 total | Estimated | User | No | No | #9 |
| `generate-icp-brief` | **sonnet-4-20250514** | ~3 000 | ≤4 096 | **Measured** | 0–2 | Estimated | User | No | No | #10 |
| `generate-icp-brief.cjs` | **sonnet-4-20250514** | ~3 000 | ≤2 048 | Estimated | **0 — dead** | — | — | — | — | #10 |
| `generate-all-reports` | **sonnet-4-20250514** | ~4 000 | ≤6 144 | **Measured** | 0–1 | Estimated | User | No | No | #10 |
| `generate-followup` | sonnet-4-5 | ~1 200 | ≤1 000 | Estimated | 1–5 | Estimated | User | No | No | #8 |
| `generate-campaign-messages` | sonnet-4-5 | ~2 000 | ≤1 024 | Estimated | 0–5 | Estimated | User | No | No | #8 |
| `generate-text-messages` | **3-5-sonnet-20241022 (legacy)** | ~800 | ≤300 | Estimated | 0–5 | Estimated | User | No | No | #8 |
| `analyze-website` | **sonnet-4-6** | ~8 000 | ≤1 024 | Estimated | 0–2 | Estimated | User | No | No | — |
| `barryInboxAnalyzer` | **sonnet-4-6** | ~3 000 | ≤1 500 | Estimated | **1 per inbound reply** | Calculated | **Automatic** | Idempotent | No | — |
| `barryDraftComposer` | **sonnet-4-6** | ~3 000 | ≤2 000 | Estimated | **1 per inbound reply** | Calculated | **Automatic** | Idempotent | No | — |

## 6.2 Estimated totals per user per day

Two profiles, because the spread is enormous:

**Light day** (opens Mission Control twice, reviews 3 replies, sends 2 messages):
- ~6 orientation + ~6 chat turns + ~6 inbox (3 replies × analyze+draft) + ~8 card reads + ~2 engagement messages ≈ **28 calls**
- ≈ 120 k input / 20 k output tokens

**Heavy day** (Scout Game session, bulk compose, Hunter run):
- 10-card prefetch × 2 sessions (20 × `generate-engagement-message` @ ≤4 096 out) + 25 bulk personalize + 30 card reads + 20 chat turns (15 k prompt each = 300 k input alone) + 10 inbox ≈ **105+ calls**
- ≈ **600 k+ input / 100 k+ output tokens**

**These figures are estimates and must not be used for budgeting.** The purpose of stating them is to size the observability gap: a 4× spread between profiles, with the dominant term (`barryMissionChat` prompt size) entirely unmeasured.

## 6.3 Highest cost and most redundant

1. **`barryMissionChat` prompt size.** `barryContextStack` ships up to 500 contact records to the client, then back to the server, on **every message**. At ~30 tokens per contact that is ~15 000 prompt tokens per turn regardless of whether the question concerns one contact or none. This is the single largest cost line in the product and it grows linearly with the customer's contact count. It is also a data-exposure surface: the full contact list transits the browser.
2. **Scout Game prefetch.** `useGamePrefetch` fires up to 10 concurrent `generate-engagement-message` calls (Sonnet, ≤4 096 output each) speculatively, for cards the user may never reach. No cache, no reuse, results discarded on session end.
3. **`barryHunterCardRead` per render.** One Haiku call per card, on mount, with no client cache. Scrolling a 30-card list is 30 calls.
4. **Ten `generate-section-*` files.** ~2 000 lines of duplicated code; each maintained separately; all on a legacy model.
5. **Three morning-brief implementations** computing the same facts.

## 6.4 AI used for deterministic logic

| Endpoint | What is being generated that should be computed |
|---|---|
| `barryActions.js` | Parsing a message into one of six enumerated action types. This is a tool-schema problem, not a language problem. |
| `barryValidateContact.js` | Contact field validation (Sonnet-4.5, 500 tokens). Email/name/title shape checks are regex and lookup. |
| `barryICPConversation.js` | Apollo industry mapping. `APOLLO_INDUSTRIES` is a constant array in the same file; matching against it is a lookup, not inference. |
| `barryHunterCardRead.js` / `barryCSMRead.js` | Both take fully structured input and emit one sentence. The *selection* of what to say is deterministic; only the phrasing needs a model. Should be: compute the read deterministically, template it, and call AI only when the templated result is inadequate. |
| `barryMissionChat.loadServerSideRecommendations` | Correctly AI-free — cited as the counter-example. |

**Correctly AI-free and worth protecting:** `barryEnrich.js`, `inferRelationshipWarmth.js`, `barryOutcomeAttribution.js`, `barryGuardrail.js`, `barryStrategyRecommender.js`, `recommendationEngine.js`, `barryPipelineAction.js`.

## 6.5 What could be batched, cached, or eliminated

| Action | Saving |
|---|---|
| Replace `contextStack` with server-side context resolution + entity-scoped retrieval | Largest single saving; eliminates ~15 k tokens/turn |
| Cache `barryHunterCardRead` on the contact document with a signal-driven invalidation | ~90 % of card-read calls |
| Make Scout Game prefetch depth adaptive (3 not 10) and persist unused drafts as reusable Artifacts | ~70 % of game calls |
| Consolidate `generate-section-1..10` → 1 Skill | Maintenance, not tokens |
| Delete the 11 dead endpoint call sites and 30 dead files | Eliminates 404 traffic and reviewer confusion |
| Batch `barryBulkPersonalize` into one call with N contacts instead of N calls | ~80 % of bulk tokens |
| Standardise on 2 models (one fast, one deep) instead of 6 | Predictable cost per class |

## 6.6 Observability roadmap

**What exists:** `logApiUsage()` → `apiLogs` (root collection), plus `users/{uid}/apiUsage/summary`. `creditTracking.js` for Apollo credits.

**What is wrong with it:**
- Every operation is written as `endpoint: "APOLLO_" + operation.toUpperCase()` and `creditsUsed: 1`. **Anthropic spend is being recorded as Apollo credits.** `apiLogs` cannot answer "what did Claude cost yesterday".
- Token counts are captured by 17 of ~46 AI call sites, and only inside `metadata` as a JSON **string** — not queryable, not aggregatable.
- It writes via the **Firestore REST API with no auth header** (`logApiUsage.js:57`), relying on the `apiLogs` rule `allow write: if request.auth != null` — but the fetch carries no token, so in production these writes are either failing silently or the rule is not being enforced on this path. Either way, the numbers cannot be trusted.
- The summary update is a read-then-write with no transaction — concurrent calls lose counts.
- No trace ID. A Mission Control turn that fans out to `barryMissionChat` + `barryPipelineAction` produces two unlinked rows.

**Roadmap, in order:**

| Phase | Deliverable |
|---|---|
| O1 | Fix `logApiUsage` — separate `provider` (`anthropic` \| `apollo` \| `google`), real `model`, `inputTokens`/`outputTokens` as **integers**, authenticated writes, `FieldValue.increment()` for summaries |
| O2 | Add `traceId` + `spanId` to every Barry request; propagate through `navigationContext`; one trace per user intent |
| O3 | Record on every AI call: `signalIds[]`, `contextVersion`, `promptTemplateId`, `thinkLayerVersion`, `skillName`, `workflowName`, `cacheHit` |
| O4 | `barry_usage_daily/{uid}/{date}` rollup written by a scheduled function; cost per user per day becomes a query |
| O5 | Reasoning trace store: for each Recommendation, persist the inputs the Think layer saw and the scores it produced (`strategyScores` is already computed and thrown away by `barryStrategyRecommender`) |
| O6 | Eval harness — replay stored traces against new prompts/models, diff outcomes |

---

# Step 7 — Enterprise Foundation Audit

| Foundation | Exists today | Barry OS will require |
|---|---|---|
| **Identity & tenancy** | `userId` from Firebase Auth is the only boundary. `firestore.rules` scopes `users/{userId}/**` to `request.auth.uid == userId` — correct for single-user. **`organization_id` is carried in `navigationContext` and is always `null`** (`PHASE7_BARRY_CONTEXT_CONTRACT.md` calls this out as schema drift). Root collections `communication_records`, `barry_processing_queue`, `unmatched_messages`, `dashboards`, `apiLogs` are tenant-scoped by **field**, not by path. Impersonation is a real subsystem (`ImpersonationContext`, `impersonation.js`, `impersonationSessions`) with a read-only guard. | A first-class `Workspace` object. Every signal, context, memory, recommendation, and action carries `workspaceId`. Root collections repathed under the workspace or given composite rules. `organization_id` populated. |
| **Permissions** | Binary: you own your workspace or you do not. Admin/super-admin via `adminAuth.js`, `superAdminAuth.js`, `ADMIN_USER_IDS`. **Barry has no permission model at all** — `barryPipelineAction` and `barryActions` mutate whatever they are asked to, gated only by `confirmation_required` on two of five action types. | Per-capability permissions. Read scopes (which collections Barry may see) separate from action scopes (what he may mutate). Autonomy level per capability class per user. |
| **Auditability** | `utils/auditLog.js` (236 L) exists for admin actions. **Barry's recommendations and actions are not auditable.** `barryStrategyRecommender` computes `strategyScores` with `reasons[]` and returns them — and the four consumers use `promptGuidance` and discard the scores. `barry_attributions` records what happened after, never what Barry saw before. | Every Recommendation persists: signals consumed, context version, Think-layer scores, chosen strategy, confidence. Every Executed Action links back to the Recommendation and the Prepared Action that produced it. |
| **Observability** | See §6.6. Trace: none. | O1–O6. |
| **Reliability** | `utils/anthropicRetry.js` exists and is used by **3 of 40** AI modules. Gmail token refresh is handled (`barry-approve-send.js:215`) and fails closed with `GMAIL_REFRESH_FAILED`. `apolloErrorLogger.js` exists. **Failure modes that fail silent:** `barryContextStack.getCalendarContext()` returns `[]` on any error; `barryContextAssembler` returns `{context:null, promptContext:''}` on error — Barry generates with **no memory** and no one is told; `barryOrientationBrief` catches AI failure and falls through to a deterministic brief (**this one is correct**). `gmail-sync-worker` has a 240 s run budget and 50-user cap — **user 51 is never synced** and nothing reports it. | Explicit degradation contract per dependency: which layer is unavailable, what Barry may still do, what the user is told. Retry on all AI calls. Dead-letter queue for `unmatched_messages` and failed queue entries. |
| **Idempotency** | `messageProcessor` deduplicates on `gmailMessageId`. `process-barry-inbox-queue` checks for an existing `barry_analysis` before reprocessing. **`barry-approve-send.js` has no double-send guard** — it does not read `approvalStatus` before sending, so two clicks or two tabs send twice; and its own comment at line 264 acknowledges that a post-send Firestore failure must not be reported as a failure, *because the user would send it again*. `gmail-send*.js` similarly unguarded. | Idempotency key on every side-effect capability, checked before the external call, stored with the result. |
| **Confidence** | `contactMatcher.js` `MATCH_CONFIDENCE` HIGH/MEDIUM/LOW is the only propagated confidence — and it gates timeline writes correctly. `barryInboxAnalyzer` emits `confidence`, `barryDraftComposer` emits `confidence`, `barryStrategyRecommender` emits `high/moderate/low`, `barryActions` emits a 0–1 float with a 0.7 threshold. **None of these are reconciled, surfaced consistently, or used to gate autonomy.** `inferRelationshipWarmth` writes `warmth_level_source` — the right instinct, applied once. | One confidence scale. Every inference carries confidence + source. Autonomy gated on confidence. Low-confidence inferences never silently become facts. |
| **Evaluation** | 51 test files in `src/test`, including good unit coverage of `barryContextAssembler`, `barryGuardrail`, `barryStrategyRecommender`, `barryInboxIntelligence`. **No outcome-quality evaluation.** `barryOutcomeAttribution` is the only feedback loop and it measures message strategy only. | Golden-set replay harness. Per-Skill quality metrics. A/B on prompt versions. Recommendation acceptance rate as a first-class metric. |

---

# Step 8 — Mission Control Dependency Audit

## 8.1 What Mission Control currently pulls from each module

`src/pages/Scout/MissionControlDashboardV2.jsx` (the routed one):

| Module | Pulled | How |
|---|---|---|
| Scout | `users/{uid}/companies` (all, filtered `accepted`), scored client-side via `icpScoring.calculateICPScore` | `getDocs` — full collection scan |
| Scout | `users/{uid}/cadences` (all) | `getDocs` |
| Scout | `users/{uid}/icpProfiles`, `companyProfile/current` | `getDocs`/`getDoc` |
| People | `users/{uid}/contacts` (all) | `getDocs` — full collection scan |
| Hunter | via `useRecommendations` → `recommendationEngine` (mission queries, capped 50) | client engine |
| Hunter | `usePendingReplies` → contacts where `conversationState == 'user_action_required'`, then `barry_drafts` + `barry_analysis` per contact | **N+1** |
| Recon | `dashboards/{uid}` completion | `getDoc` |
| Barry | `barryOrientationBrief` (server, reads dashboards/missions/companies/pendingReplies again) | fetch |
| Gmail | nothing directly | — |
| Calendar | nothing (only the global Barry drawer sees calendar, via `barryContextStack`) | — |

**The same data is read three times per Mission Control load** — once by the page, once by `recommendationEngine`, once by `barryOrientationBrief` server-side. Each applies different filters.

## 8.2 Three-horizon analysis

### Horizon 1 — Immediate: what Aaron must act on right now

| User-work concept | Data exists? | Barry awareness needed | Missing |
|---|---|---|---|
| **Needs Response** | ✅ `barry_drafts` + `conversationState == 'user_action_required'` | Relationship + Business Awareness | A top-level index. `usePendingReplies` walks contacts because *"there is no top-level index of pending drafts"* (its own comment). Does not scale. |
| **Meeting Today** | ❌ Calendar fetched live only in the Barry drawer, fuzzy-matched, never persisted, silently empty on failure | Business Awareness | Persisted `Meeting` objects; `calendar.meeting_today` signal |
| **Follow-Up Due** | ⚠️ `notifications` `type: 'follow_up_due'` (written 9am M–F) + `nbs_queue` overdue | Relationship Awareness | Neither reaches Mission Control. `TodaysPriorities` reads `recommendationEngine` only. |
| **Decision Needed** | ❌ | Mission Awareness | No concept of a pending decision |
| **Relationship at Risk** | ⚠️ `recommendationEngine` `HIGH_VALUE_DORMANT` (30 d), `STALLED_AWAITING_REPLY` (14 d) | Relationship Awareness | Thresholds disagree with `barryOrientationBrief`'s 14-day mission staleness; no risk score |

### Horizon 2 — Active: what is in motion

| Concept | Exists? | Missing |
|---|---|---|
| **Waiting on Someone** | ⚠️ `contact_status == 'Awaiting Reply'` — but also set as a *side effect* of `process-barry-queue` | A clean "we are blocked on them" fact |
| Campaign progress | ⚠️ `mission.steps[].status` | No campaign-level roll-up; `campaigns` and `missions` have no defined relationship |
| Active relationships | ⚠️ `engagement_summary` counters | No activity projection |
| Pipeline | ❌ | `Sniper/sections/PipelineSection.jsx` exists but Mission Control does not read it |
| Commitments | ⚠️ `relationship_context.openCommitments[]` — **written by the inbox pipeline, read by nothing** | Surface it |
| Introductions | ⚠️ `referralIntelligenceService.js`, `nbs_type: intro_offer` | Not in Mission Control |
| **New Opportunity** | ⚠️ `company.status == 'accepted'` in last 7 d (`barryOrientationBrief` only) | Not a Mission Control tile |
| **Barry Prepared This** | ✅ `barry_drafts` | Only visible in the Hunter drawer and the brief count — **not a Mission Control section** |
| **Barry Recommends This** | ✅ `TodaysPriorities` | Does not include NBS or notifications |

### Horizon 3 — Strategic

| Concept | Exists? |
|---|---|
| ICP trends | ⚠️ `icpScoring` scores at read time; swipe feedback in `barryMissionChat.loadSwipeFeedback()`; nothing trends over time |
| Relationship growth | ❌ |
| Pipeline health | ❌ |
| Partner health | ⚠️ `healthScore.js`, `barryCSM.js`, `referralIntelligenceService.js` — Basecamp-local |
| **Goal Progress** | ❌ Recon Section 0 captures quantitative targets; nothing measures against them |

## 8.3 How Mission Control differs from Scout's own dashboard

It largely does not, and that is the finding. `MissionControlDashboardV2.jsx` lives **inside `src/pages/Scout/`**, scores companies with Scout's scorer, renders an ICP match table, and its KPI tiles are Scout counts. The three genuinely cross-module elements are `TodaysPriorities`, `usePendingReplies`, and the Barry orientation brief. Everything else is Scout with a different header. Reorganising around the ten user-work concepts is the change that makes Mission Control a distinct surface rather than a second Scout.

---

# Step 9 — Integration Readiness Audit

| Integration | Where | How it connects to Barry today | Signals produced | Capabilities declared |
|---|---|---|---|---|
| **Gmail** | `gmail-oauth-{init,callback}.js`, `gmail-send{,-quick,-wave}.js`, `gmail-poll-replies.js`, `gmail-sync-worker.js` (scheduled `*/10`), `utils/gmailMessageService.js` (847 L), `barry-approve-send.js`. Tokens at `users/{uid}/integrations/gmail`. | **The only integration wired to Barry properly** — inbound flows through `messageProcessor` into `barry_processing_queue`, which triggers analysis + draft | `contact.reply_received` (normalized). Outbound: none. | None — Barry reaches Gmail through 3 different hard-coded functions |
| **Google Calendar** | `calendar-oauth-{init,callback}.js`, `calendar-list-events.js`, `calendar-create-event.js`, `calendar-disconnect.js`. Tokens at `users/{uid}/integrations/googleCalendar`. | Read once by `barryContextStack.getCalendarContext()`, fuzzy-matched to contacts by email/title, **never persisted**. Write via `barryActions` `calendar_book`. | **None** | `barryActions` declares `calendar_book` + `calendar_check` inline — the closest thing to a capability declaration in the repo |
| **Apollo** | `search-companies.js`, `searchPeople.js`, `enrichContact.js`, `enrichCompany.js`, `findContact.js`, `utils/apolloConstants.js`, `utils/creditTracking.js` | Barry orchestrates via `barryEnrich.js` (1039 L, zero AI). `search-companies.js:991` writes `barry_intel` onto company docs. | **None** | None |
| **LinkedIn** | `utils/linkedinSearch.js` (Google Custom Search scrape, not the LinkedIn API), `findContactByLinkedInUrl.js`, `import-linkedin-connections.js`, `retryLinkedInPhoto.js`, `scoreLinkedInConnection.js`, `LinkedInImportModal.jsx`, `GenerateLinkedInModal.jsx` (calls **non-existent** `generate-linkedin`) | **Not connected to Barry at all.** `linkedin_connections` is written and read by one scorer. | **None** | None |
| **Stripe** | `create-checkout-session.js`, `stripe-webhook.js` | Not connected | None | None |
| **Resend (email)** | `resendWebhook.js`, `utils/emailLog.js`, `send-welcome-email.js`, `track-open.js` | `track-open.js` records opens — **Barry never sees them** | None (open/bounce events land in `email_logs`, unread by Barry) | None |
| **Twilio (SMS)** | `check-twilio-setup.js` (returns `false`, admin setup required), `generate-text-messages.js` | Message generation exists; **no send path** | None | None |
| **Crisp** | `CrispChat.jsx` | Not connected | None | None |

## 9.1 Is there a normalized event format all integrations could write to?

**Almost.** `src/types/normalizedMessage.js` defines `NormalizedMessage` with `validateNormalizedMessage()`, and `src/types/processingResult.js` defines the result. This is a genuine typed contract and it is the right seed. But it is **message-shaped**, not event-shaped: it assumes a `gmailMessageId`, a `bodyText`, a `fromEmail`. A calendar event, an Apollo enrichment, or a Stripe payment cannot be expressed in it.

The generalisation is small: keep the envelope discipline, replace the payload with a typed union.

## 9.2 Is there a capability registry?

**No.** Three things gesture at one:
- `barryActions.js` `INTENT_SYSTEM` — 5 actions with `confirmation_required` flags, expressed as prompt text
- `reconCapability.buildCapabilityBlock()` — a **prompt string** describing Barry's knowledge state, not his abilities
- `barryPipelineAction.js` — 4 pipeline mutations, hard-coded in a switch

None is queryable, versioned, or extensible without editing Barry.

## 9.3 What would it take to add LinkedIn without rebuilding Barry?

**Today:** a new OAuth flow, a new Netlify function per operation, a new normalized-message variant, edits to `messageProcessor`, `barryInboxAnalyzer` prompt, `barryDraftComposer` prompt, `barry-approve-send` (which hard-codes Gmail), `contactMatcher`, plus a new send path and new UI. **Roughly 8 files edited inside Barry, and Barry's prompts change.**

**With the Signal Bus + Capability Registry:** LinkedIn publishes `message.received` / `message.sent` signals in the normalized envelope, and registers `SendLinkedInMessageCapability` + `FetchLinkedInProfileCapability` with declared `sideEffect: true`, an idempotency contract, and a permission scope. **Zero edits inside Barry.** The Think layer's channel scoring already handles arbitrary channel names (`barryStrategyRecommender.channel_outcomes` is keyed by string).

## 9.4 What would it take to add any future integration?

Four artifacts, no Barry edits:
1. A signal adapter emitting the normalized envelope
2. A capability manifest (name, class, inputs, outputs, side-effect flag, idempotency key strategy, permission scope, autonomy ceiling)
3. A credential record under `users/{uid}/integrations/{name}` following the existing shape
4. A health contract (connected / degraded / disconnected) so Barry can say what he cannot see

---

# Step 10 — Recommended Barry OS Architecture

## 10.0 Verdict on the reference architecture

**Validated:** Signal/Event Layer, Capability Registry, Awareness Projections, Context Engine, Think Layer, Skills, Workflows, Memory, Action Queue, Morning Brief, Mission Control aggregation, Action Executor, canonical-data-read-only.

**Modified:**
- **Memory: five types → six.** Add **Artifact Memory**. Every brief, dossier, prospecting list, and generated sequence in this codebase is rendered once and discarded. `barryDossierBriefing` regenerates the same dossier every time the modal opens.
- **Awareness: add a staleness contract.** The reference model names four projections but not their freshness semantics. In a system where `barryContextStack` caches 5 minutes, `barryContextAssembler` caches 30 seconds, and `barryOrientationBrief` caches 10 minutes, unspecified staleness is how the four projections will start disagreeing the way the five brief implementations already do.
- **Orchestrator and Planner should be one component, not two.** The reference diagram lists `Context Engine · Think Layer · Planner / Orchestrator`. In this codebase the distinction has no anchor: `barryHunterProcessEngage` plans and executes in one pass and is better for it. Splitting them now creates a boundary with no evidence behind it.

**Rejected for Phase 1:**
- **Policy / Autonomy Engine as a distinct layer.** There is no permission model, no confidence scale, and no audit trail to build policy on. A policy layer over unaudited, unconfident capabilities is theatre — it would gate actions on data that does not exist. Autonomy in Phase 1 belongs as **two fields on the Capability Registry entry** (`autonomyCeiling`, `requiresConfirmation`), enforced by the Action Executor. Promote it to a layer once Confidence and Auditability are real (Enterprise Foundations E3–E5).
- **`barryContextStore.js`** — delete, not migrate. Its only consumer is unmounted.

**Revised reference architecture:**

```
                             USER
                              │
                        BARRY SURFACES
        Mission Control · Morning Brief · Contextual Barry
                              │
                        BARRY OS CORE
   Context Resolver ── Think Layer ── Orchestrator (plan + run)
                  Skills · Workflows · Artifacts
              Memory (6 types)   Reasoning Trace Store
                              │
                    Four Awareness Projections
             Relationship · Business · Mission · User
                    (persisted + staleness contract)
                              │
                     Prioritized Action Queue
                              │
      Capability Registry (incl. autonomyCeiling per capability)
                              │
                       Action Executor
                  (idempotency · audit · confidence)
                              │
                        SIGNAL BUS
                 (normalized envelope · replayable)
                              │
       Idynify Modules + External Integrations (adapters)
                              │
             Canonical Domain Data (READ ONLY)
```

## 10.1 Signal Bus Contract

```jsonc
{
  "signalId":    "sig_01J...",          // ULID, sortable, idempotency key
  "type":        "contact.reply_received",
  "version":     1,
  "occurredAt":  "2026-08-07T14:22:10Z", // when it happened in the world
  "receivedAt":  "2026-08-07T14:22:41Z", // when Barry OS learned it
  "workspaceId": "ws_abc",
  "actor":       { "kind": "integration", "id": "gmail" },  // user | module | integration | barry
  "subject":     { "kind": "contact", "id": "contact_123" },
  "related":     [ { "kind": "company",  "id": "company_9" },
                   { "kind": "mission",  "id": "mission_4" } ],
  "payload":     { /* typed per `type` */ },
  "confidence":  { "value": "high", "source": "email_exact_match" },
  "traceId":     "trc_...",
  "dedupeKey":   "gmail:msg_18f3a..."    // natural key; bus rejects repeats
}
```

Rules: append-only; consumers are idempotent on `signalId`; replayable from any point; a signal never carries derived state; LOW-confidence subject resolution publishes with `subject.kind: "unresolved"` rather than dropping to `unmatched_messages` invisibly.

**Top 20 platform signals** — the 17 from the brief, ordered by build priority, plus three the audit found are needed and missing from the list:

| # | Signal | Producer today | Status |
|---|---|---|---|
| 1 | `contact.reply_received` | `gmail-sync-worker` → `messageProcessor` | ✅ exists — adapt the envelope |
| 2 | `contact.email_sent` | `gmail-send*.js`, `barry-approve-send.js` | ⚠️ writes timeline, publishes nothing |
| 3 | `calendar.meeting_today` | — | ❌ new — highest-value missing signal |
| 4 | `calendar.meeting_created` | `calendar-create-event.js` | ❌ new |
| 5 | `contact.meeting_booked` | — | ❌ new |
| 6 | `contact.status_changed` | `timelineLogger`, `process-barry-queue` | ⚠️ two writers, one silent |
| 7 | `reinforcement.followup_due` | `process-barry-queue` | ⚠️ writes `notifications`, not a signal |
| 8 | `mission.created` | `missionService.js` | ❌ new |
| 9 | `mission.stage_changed` | mission step mutations | ❌ new |
| 10 | `campaign.step_completed` | `timelineLogger` `sequence_step_sent` | ⚠️ contact-scoped only |
| 11 | `campaign.goal_achieved` | — | ❌ new |
| 12 | `contact.added_to_campaign` | `timelineLogger` `campaign_assigned` | ⚠️ |
| 13 | `scout.company_accepted` | swipe → `company.status` | ⚠️ inferred by query |
| 14 | `scout.company_discovered` | `search-companies.js` | ❌ new |
| 15 | `contact.enriched` | `enrichContact.js`, `barryEnrich.js` | ❌ new |
| 16 | `company.enriched` | `enrichCompany.js` | ❌ new |
| 17 | `reinforcement.email_sent` | shared with #2 | ⚠️ |
| 18 | **`user.recommendation_dismissed`** | `recommendationEngine.dismissRecommendation()` | ❌ new — **required for User Awareness and Learned Intelligence; currently a 7-day suppression that teaches Barry nothing** |
| 19 | **`user.draft_edited`** | `BarryReplyCard` edit-before-send | ❌ new — **the highest-signal learning event in the product and it is thrown away** |
| 20 | **`integration.health_changed`** | Gmail refresh failure, Apollo error, calendar timeout | ❌ new — **required so Barry can say what he cannot see instead of silently returning `[]`** |

## 10.2 Barry Skills Registry

Atomic, single-purpose, no side effects unless declared. Derived from what already exists:

| Skill | Replaces | Class |
|---|---|---|
| `WriteEngagementMessageSkill(contact, intent, channel, angleCount)` | `generate-engagement-message`, `barryHunterGenerateStep`, `barryGenerateSequenceStep`, `barryFirstTouch`, `barryOutreachMessage`, `barryBulkPersonalize`, `generate-followup`, `generate-campaign-messages`, `generate-text-messages` | Generative |
| `SummarizeRelationshipSkill(contact, depth)` | `barryHunterCardRead`, `barryCSMRead`, `barryDossierBriefing` | Generative |
| `AnalyzeInboundMessageSkill(messageRecord)` | `barryInboxAnalyzer` | Generative |
| `ComposeReplySkill(analysis, tone)` | `barryDraftComposer` | Generative |
| `ResearchCompanySkill(company)` | `analyze-website`, `enrichCompany` | Generative + external read |
| `FindContactsSkill(icp, filters)` | `searchPeople`, `search-companies`, `findContact` | External read |
| `EnrichContactSkill(contact)` | `barryEnrich`, `enrichContact` | External read — **already AI-free, keep it that way** |
| `ScoreICPFitSkill(company, icp)` | `icpScoring.calculateICPScore` | **Deterministic — no AI** |
| `InferRelationshipWarmthSkill(contact)` | `inferRelationshipWarmth` | **Deterministic — no AI** |
| `CheckRelationshipGuardrailSkill(contact, intent)` | `barryGuardrail` | **Deterministic — no AI** |
| `GenerateReconSectionSkill(sectionId, answers)` | `generate-section-1..10`, `generate-icp-brief`, `generate-all-reports` | Generative |
| `CoachReconSectionSkill(sectionId, mode)` | `barryReconInterview`, `barryReconSection0`, `barry-coach-section` | Generative |
| `GenerateMeetingBriefSkill(contact, meeting)` | — new | Generative |
| `DraftLinkedInMessageSkill(contact)` | `generate-linkedin` (currently a 404) | Generative |
| `AttributeOutcomeSkill(outcome)` | `barryOutcomeAttribution` | **Deterministic — no AI** |

**38 AI endpoints → 15 Skills, 5 of which need no model at all.**

## 10.3 Barry Workflows Registry

| Workflow | Composition | Nearest thing today |
|---|---|---|
| `PrepareMeetingWorkflow` | `ResearchCompanySkill` → `SummarizeRelationshipSkill` → `GenerateMeetingBriefSkill` → emit Artifact | Nothing. Calendar is not even persisted. |
| `ReconnectDormantRelationshipWorkflow` | `SummarizeRelationshipSkill` → `CheckRelationshipGuardrailSkill` → Think → `WriteEngagementMessageSkill` | `nextBestStepService` `check_in` NBS proposes it; nothing executes it |
| `LaunchCampaignWorkflow` | `FindContactsSkill` → `ScoreICPFitSkill` → `WriteEngagementMessageSkill` → `CreateMissionCapability` → queue | `barryGenerateMissionSequence` + `GoToWar.jsx` do a fragment of this |
| `QualifyProspectWorkflow` | `ResearchCompanySkill` → `ScoreICPFitSkill` → `SummarizeRelationshipSkill` | `barryEnrich` does the enrichment half, AI-free |
| `ProcessInboundReplyWorkflow` | `AnalyzeInboundMessageSkill` → update Relationship Awareness → Think → `ComposeReplySkill` → Action Queue | **`process-barry-inbox-queue` already is this** — promote it, do not rebuild it |
| `EngageContactWorkflow` | context → `CheckRelationshipGuardrailSkill` → `InferRelationshipWarmthSkill` → Think → `WriteEngagementMessageSkill` | **`barryHunterProcessEngage` already is this** — promote it |

Two of six already exist as working chains. That is the strongest argument that the Workflow abstraction fits this codebase rather than being imposed on it.

## 10.4 Capability Registry Contract

```jsonc
{
  "name":             "SendEmailCapability",
  "provider":         "gmail",
  "class":            "side_effect",       // "generative" | "read" | "side_effect"
  "version":          1,
  "inputs":           { "to": "email", "subject": "string", "body": "string", "threadId": "string?" },
  "outputs":          { "providerMessageId": "string", "threadId": "string" },
  "reversible":       false,
  "idempotency":      { "strategy": "key", "keyFrom": ["threadId", "bodyHash"] },
  "permissionScope":  "email:send",
  "autonomyCeiling":  "approval",          // observe | recommend | prepare | approval | autonomous
  "confidenceFloor":  "medium",            // below this, never auto-execute
  "emitsSignals":     ["contact.email_sent"],
  "healthCheck":      "gmail.connection_status",
  "costClass":        "external_api"
}
```

**Generative vs side-effect — the distinction that must be enforced:**

| | Generative | Side-effect |
|---|---|---|
| Changes the world | No | Yes |
| Safe to retry | Yes | Only with an idempotency key |
| Safe to speculate/prefetch | Yes (costs tokens) | **Never** |
| Needs confirmation | No | Per `autonomyCeiling` |
| Audit requirement | Trace + tokens | Trace + tokens + actor + reversal path |

`barryActions.js` already gets this half-right with `confirmation_required: true` for `gmail_send` and `calendar_book`. It is a prompt instruction rather than an enforced contract — the model decides whether to require confirmation. That is the wrong place for that decision.

## 10.5 Think Layer Specification

**Inputs:**
- Four Awareness projections (current + staleness)
- Relevant memory: user, relationship, mission, learned intelligence
- Active signals since last session
- Capability Registry (what is actually possible right now, including integration health)
- User preferences and autonomy settings

**Process:**
1. **Synthesize** — reconcile signals against awareness; identify what changed since the user's last session
2. **Compare** — score every candidate action across all relationships and missions on one scale
3. **Weigh** — urgency × relationship value × timing fit × effort × confidence
4. **Choose** — select strategy per candidate, using `barryStrategyRecommender`'s existing scoring for the message-strategy dimension
5. **Explain** — emit the reasoning trace

**Output:**
```jsonc
{
  "thinkId": "thk_...", "traceId": "trc_...", "version": "1.0",
  "asOf": "2026-08-07T08:00:00Z",
  "inputs":  { "signalIds": [...], "awarenessVersions": {...}, "memoryVersions": {...} },
  "candidates": [ { "subject": {...}, "action": "reply_today",
                    "score": 87, "urgency": 0.9, "relationshipValue": 0.8,
                    "timingFit": 0.7, "confidence": "high",
                    "strategy": "warm", "strategyScores": {...},
                    "reasons": ["Replied positively 2 days ago",
                                "Warm strategy 71% positive across 14 outcomes"],
                    "competingWith": ["cand_02"], "tradeoff": "..." } ],
  "suppressed": [ { "subject": {...}, "reason": "snoozed until 2026-08-12" } ]
}
```

**Two properties this codebase makes non-negotiable:** (a) `strategyScores` must be **persisted**, not discarded — `barryStrategyRecommender` computes them today and every caller throws them away, which is precisely why nothing is auditable; (b) the trace must record what Barry *did not* recommend and why, because `recommendationEngine`'s dismissal suppression currently makes recommendations vanish with no record.

**Build on `barryStrategyRecommender.js`.** Do not rewrite it. It needs one new dimension — cross-entity priority comparison — and its output persisted.

## 10.6 Orchestration Model — "find 30 Utah credit unions and prepare outreach"

```
User utterance
  → Orchestrator: parse to WorkflowRequest (typed, not free-form)
      { workflow: "LaunchCampaignWorkflow",
        params: { icpHint: "credit unions", geo: "UT", count: 30 } }

  → Context Resolver
      global(user, workspace) + workspace(ICP, RECON, service profiles)
      + temporal(today, calendar) + session(navigationContext)

  → FindContactsSkill                    [read · Apollo]
      → signal: scout.company_discovered ×N

  → ResearchCompanySkill (batch)          [generative + read]
      → signal: company.enriched ×N

  → ScoreICPFitSkill                      [DETERMINISTIC — no model call]
      → rank, cut to 30

  → FindContactsSkill (titles per company)[read · Apollo]
      → signal: contact.enriched ×M

  → Think Layer
      per contact: strategy + channel + confidence + reasons
      cross-contact: sequence order, send pacing, which 5 go first

  → WriteEngagementMessageSkill (batched) [generative]

  → CreateMissionCapability               [side_effect · internal]
      → signal: mission.created

  → Artifact: "Utah Credit Union Prospecting List" (reusable, versioned)

  → Action Queue: 30 Prepared Actions, ranked, autonomyCeiling: "approval"

  → Morning Brief reads the queue — no additional AI call
```

**Every step above exists in some form today**, in six different functions, none composable, with `ScoreICPFitSkill` currently running client-side in `MissionControlDashboardV2.jsx` and `DailyLeads.jsx` separately. The orchestration model is not new capability — it is the same capability, addressable.

## 10.7 Four Awareness Projections

| Projection | Persisted | Calculated | Staleness | Update trigger |
|---|---|---|---|---|
| **Relationship** `workspaces/{ws}/awareness/relationship/{contactId}` | state, sentiment, next expected action, open commitments, days-since-touch, risk score, confidence, `computedAt`, `sourceSignalIds[]` | "days until stale" | **Stale after 24 h or any subject-matching signal** | Signal-driven |
| **Business** `workspaces/{ws}/awareness/business/current` | responses pending, meetings today, at-risk relationships, pipeline movement, new opportunities | counts | **Stale after 15 min or any signal** | Signal-driven + 15-min floor |
| **Mission** `workspaces/{ws}/awareness/mission/{missionId}` | progress, on-track/at-risk, blocking step, days to deadline | % complete | **Stale after 6 h or mission signal** | Signal-driven |
| **User** `workspaces/{ws}/awareness/user/current` | approval rate, edit rate, preferred send windows, tone, channel, dismissal patterns | rolling windows | **Stale after 7 d** | Batch nightly |

**Rules:**
- A projection carries `computedAt`, `sourceSignalIds[]`, and `confidence`. A consumer that reads a stale projection is told it is stale rather than being handed a stale number that looks fresh — this is the specific failure `barryContextStack.getCalendarContext()` has today.
- Projections are **derived and rebuildable**. Deleting the whole awareness tree and replaying signals must reproduce it. That is what makes it safe for Barry to write.
- Barry writes projections. Barry never writes canonical data.

## 10.8 Barry Context Resolution Contract

One resolver, five layers, replacing all nine implementations:

```jsonc
resolveContext({ workspaceId, userId, entity, surface, intent, budgetTokens })
→ {
    global:    { user, workspace, autonomySettings, integrationHealth },
    workspace: { icpProfiles, recon(compiled, versioned), serviceProfiles, activeMissionSummary },
    entity:    { contact | company | mission, relationshipMemory, missionMemory,
                 relationshipAwareness, recentSignals, attributions },
    session:   { navigationContext, conversationId, arrivalIntent, barrySessionKey },
    temporal:  { now, timezone, meetingsToday, sendWindow, whatChangedSinceLastSession },
    meta:      { contextVersion, tokensUsed, budgetTokens,
                 droppedSections: ["P3.sessionSummaries"], staleProjections: [] }
  }
```

**Keep from the existing code:** `barryContextAssembler`'s P0–P3 priority truncation and its 1200-char budget discipline — it is the only place in the repo that degrades gracefully under a token budget, and it must be generalised, not replaced. **Add:** `meta.droppedSections` so a caller can tell whether Barry saw the memory or not. Today a truncated context and a failed context are indistinguishable — `assembleBarryContext` returns `promptContext: ''` for both.

**Kill:** shipping 500 contacts from the client. Entity-scoped retrieval plus workspace summary replaces it.

## 10.9 Barry Memory Architecture — six types

| Type | Home | Scope | Retention | Written by | Contamination guard |
|---|---|---|---|---|---|
| **User Memory** | `workspaces/{ws}/memory/user` | workspace | Permanent, versioned | Explicit user statements + nightly batch from User Awareness | Never written from a single session |
| **Relationship Memory** | `.../memory/relationship/{contactId}` | contact | Permanent, bounded arrays | Promotion pipeline only | **Every entry carries `sourceSignalIds[]`, `confidence`, `promotedAt`, `promotedBy`; entries below `medium` confidence expire in 30 d** |
| **Mission Memory** | `.../memory/mission/{missionId}` | mission | Life of mission + 1 y | Mission decisions, strategy changes | Same |
| **Learned Intelligence** | `.../memory/learned/{scope}` | workspace | Rolling 12 mo | `AttributeOutcomeSkill` + `user.draft_edited` + `user.recommendation_dismissed` | Statistical gating already correct (min 3/5) — keep it |
| **Conversation / Session** | `.../conversations/{conversationId}/turns` | session | **30 days, then discarded** | Chat surfaces | **Never read by generation prompts except through the promotion pipeline** |
| **Artifact Memory** *(new)* | `.../artifacts/{artifactId}` | workspace | Permanent, versioned | Workflows | Immutable once published; new version on change |

**The promotion pipeline — the fix for Law 18:**

Session content becomes durable memory only by passing through an explicit, auditable step:

```
Conversation turn
  → candidate fact  { text, sourceConversationId, sourceTurnIds[], confidence }
  → gate: confidence ≥ medium  AND  corroborated by ≥1 signal OR explicit user confirmation
  → promoted to Relationship/User Memory with full provenance
  → surfaced in the UI as "Barry learned this" with a one-click unlearn
```

Today `barryMemoryService.closeBarrySession()` writes session-derived strings straight into arrays that every future prompt reads at priority P1, with no gate and no unlearn. That single line is the largest correctness risk in Barry's memory system, because its effects are permanent, invisible, and compounding.

## 10.10 Action Queue Contract

```jsonc
{
  "actionId": "act_...", "workspaceId": "ws_abc",
  "kind": "reply" | "outreach" | "follow_up" | "meeting_prep" | "decision" | "review",
  "subject": { "kind": "contact", "id": "..." },
  "state": "recommended" | "prepared" | "awaiting_approval" | "scheduled" | "executing" | "done" | "dismissed" | "expired",
  "rank": 1, "score": 87,
  "urgency": 0.9, "relationshipValue": 0.8, "effortMinutes": 3, "confidence": "high",
  "thinkId": "thk_...",              // → full reasoning trace
  "preparedArtifact": { "kind": "draft", "ref": "..." },
  "capability": "SendEmailCapability",
  "autonomyLevel": "approval",
  "expiresAt": "2026-08-08T17:00:00Z",
  "supersededBy": null,
  "outcome": { "completedAt": null, "result": null, "userEdited": null }
}
```

**Ranking:** `score = w_u·urgency + w_v·relationshipValue + w_t·timingFit − w_e·effort`, weights from User Awareness, ties broken by relationship value. The Think layer produces the score; the queue never re-ranks (this is the specific mistake `useRecommendations.js` correctly avoids and documents: *"It does NOT re-rank, does NOT add a second prioritization pipeline"* — that discipline must hold system-wide).

**Presentation:** one queue, filtered into the ten user-work concepts. Mission Control, the Morning Brief, and the contact page render the same queue through different filters — never their own list. This is the single change that makes Law 1 real.

**Completion:** every terminal transition emits a signal (`action.completed`, `action.dismissed`, `user.draft_edited`) which feeds Learned Intelligence and User Awareness. The loop that `barryOutcomeAttribution` opened for messages closes for everything.

## 10.11 Barry Artifacts

| Artifact | Produced by | Reused by | Exists today |
|---|---|---|---|
| Meeting Brief | `PrepareMeetingWorkflow` | Morning Brief, contact page, calendar | No |
| Account Plan | `QualifyProspectWorkflow` | Basecamp, Sniper | No |
| Prospecting List | `LaunchCampaignWorkflow` | Scout, Hunter, Mission Control | Ephemeral (`search-companies` results) |
| Weekly Review | scheduled workflow | Mission Control H3 | No |
| Follow-Up Pack | `ReconnectDormantRelationshipWorkflow` | Reinforcements | No |
| Campaign Playbook | `LaunchCampaignWorkflow` | Hunter, Templates | Partial — `TemplateLibrary` |
| Relationship Dossier | `SummarizeRelationshipSkill` | contact page, Hunter drawer, brief | **Regenerated every open** (`barryDossierBriefing`) |
| RECON Compilation | `GenerateReconSectionSkill` | every generative Skill | Partial — `dashboards/{uid}`, recompiled per call by two drifted compilers |

Artifacts are immutable + versioned, carry `producedBy` (workflow + version), `sourceSignalIds[]`, and `expiresAt`. Making the dossier an Artifact removes an AI call from every contact-page open.

## 10.12 Morning Brief Data Contract

Everything below must be readable from Awareness + the Action Queue with **zero AI calls** for the data. One optional generative call renders prose — and the deterministic fallback must always be present, exactly as `barryOrientationBrief.js:259-273` already does it correctly today.

```jsonc
{
  "asOf": "2026-08-07T07:00:00Z", "workspaceId": "ws_abc",
  "sinceLastSession": { "lastSessionAt": "...", "newSignals": 43 },
  "needsResponse":   { "count": 10, "draftsReady": 10,
                       "items": [ { "contactId", "name", "company", "subject",
                                    "urgency", "actionId", "draftRef" } ] },
  "meetingsToday":   { "count": 1,
                       "items": [ { "meetingId", "at", "contactId", "briefArtifactId" } ] },
  "followUpsDue":    { "count": 12, "items": [...] },
  "newOpportunities":{ "count": 28, "icpProfileId", "items": [...] },
  "relationshipsAtRisk": { "count": 3, "items": [...] },
  "decisionsNeeded": { "count": 1, "items": [...] },
  "goalProgress":    [ { "goal", "target", "current", "trend" } ],
  "barryPrepared":   { "drafts": 10, "sequences": 12, "lists": 1 },
  "barryRecommends": { "topActionIds": ["act_1","act_2","act_3"] },
  "integrationHealth": [ { "name": "gmail", "status": "connected" },
                         { "name": "googleCalendar", "status": "degraded",
                           "detail": "token refresh failed 2026-08-06" } ],
  "staleness": { "businessAwareness": "fresh", "relationshipAwareness": "fresh" }
}
```

`integrationHealth` is in the contract deliberately: today when Calendar fails, `barryContextStack` returns `[]` and Barry confidently reports no meetings. A brief that cannot say "I could not see your calendar" is worse than no brief.

## 10.13 Mission Control Aggregation Contract

Mission Control reads **only** Awareness + Action Queue + Artifacts. No module queries, no client-side scoring, no third recommendation engine.

```jsonc
{
  "horizon1": { "needsResponse", "meetingToday", "followUpDue",
                "decisionNeeded", "relationshipAtRisk" },
  "horizon2": { "campaignProgress", "activeRelationships", "pipeline",
                "commitments", "introductions", "waitingOnSomeone",
                "newOpportunity", "barryPreparedThis" },
  "horizon3": { "icpTrends", "relationshipGrowth", "pipelineHealth",
                "partnerHealth", "goalProgress" },
  "barryRecommends": { "topActionIds": [...] }
}
```

Each block is a filter over the same queue, so a dismissal in one place is a dismissal everywhere — the defect §3.5 identifies across `recommendationEngine`, `nextBestStepService`, and `barryMissionChat`.

## 10.14 Autonomy Spectrum

| Level | Barry does | User does | Sensible defaults from this codebase |
|---|---|---|---|
| **Observe** | Records the signal, updates awareness | Nothing | All signal ingestion. `gmail-sync-worker` is already here. |
| **Recommend** | Ranks and explains | Decides | Default for every `kind` in the Action Queue. `recommendationEngine` is already here. |
| **Prepare** | Produces the artifact, does not send | Reviews, edits, approves | Default for generative capabilities. `barry_drafts` is already here and is the model. |
| **Approval** | Executes on explicit click | Approves each | Default for **all** side-effect capabilities. `barry-approve-send` is here — minus the idempotency guard. |
| **Autonomous** | Executes within a policy envelope | Reviews after | **Nothing should be here in Phase 1.** Requires Confidence + Auditability + Idempotency, none of which exist. |

| Capability class | Observe | Recommend | Prepare | Approval | Autonomous |
|---|---|---|---|---|---|
| Read / enrich | ✓ default | ✓ | — | — | ✓ safe (already effectively autonomous) |
| Generative (message, brief) | ✓ | ✓ | ✓ default | — | ✓ once cost is measured |
| Internal mutation (status, mission) | ✓ | ✓ | ✓ | ✓ default | later |
| External send (email, SMS, LinkedIn) | ✓ | ✓ | ✓ | ✓ **ceiling in Phase 1** | never without idempotency + confidence floor |
| External schedule (calendar) | ✓ | ✓ | ✓ | ✓ **ceiling** | later |

## 10.15 Enterprise Foundation Roadmap

| Order | Foundation | Today | Why this order |
|---|---|---|---|
| **E1** | **Observability** | Broken (mislabels Anthropic as Apollo) | Nothing else can be measured or justified until this is right. Cheapest fix, highest leverage. |
| **E2** | **Identity & tenancy** | `userId` only, `organization_id` null | Every new object (signal, awareness, queue item) needs a workspace key. Retrofitting it later touches everything. |
| **E3** | **Idempotency** | Only inbound dedupe | Blocks any autonomy above Approval, and there is a live double-send defect today. |
| **E4** | **Auditability** | None for Barry | Required by Law 11. `strategyScores` already exist — persisting them is most of the work. |
| **E5** | **Confidence** | Fragmented across 5 scales | Depends on E4. Gates E7. |
| **E6** | **Reliability** | Partial, several silent-failure paths | Degradation contract per dependency; `integration.health_changed` signal. |
| **E7** | **Permissions** | Binary | Depends on E2 + E5. Needed before multi-user. |
| **E8** | **Evaluation** | Unit tests only | Depends on E1 + E4 (traces are the eval corpus). |

---

# Step 11 — Migration Map

## 11.1 Disposition table

| Implementation | Location | Disposition | Reason | Migration path |
|---|---|---|---|---|
| `barryContextAssembler.js` | `netlify/functions/utils/` | **Keep** | Best context impl; priority truncation is the right pattern | Becomes the entity layer of Context Resolver; add `meta.droppedSections` |
| `barryStrategyRecommender.js` | `netlify/functions/utils/` | **Keep** | The Think layer | Add cross-entity priority scoring; persist `strategyScores` |
| `barryGuardrail.js` | `netlify/functions/utils/` | **Keep** | Rule-based, zero AI, correct | Becomes `CheckRelationshipGuardrailSkill` |
| `barryOutcomeAttribution.js` | `netlify/functions/` | **Keep** | Only working learning loop | Becomes `AttributeOutcomeSkill`; extend to edits + dismissals |
| `barryEnrich.js` | `netlify/functions/` | **Keep** | Zero-AI orchestration done right | Becomes `EnrichContactSkill` |
| `inferRelationshipWarmth.js` | `netlify/functions/` | **Keep** | Deterministic inference w/ source field | Becomes `InferRelationshipWarmthSkill`; feed Relationship Awareness |
| `messageProcessor.js` + `contactMatcher.js` + `types/*` | `netlify/functions/utils/`, `src/types/` | **Keep** | The signal pipeline template | Generalise `NormalizedMessage` → signal envelope |
| `process-barry-inbox-queue.js` | `netlify/functions/` | **Keep** | Already `ProcessInboundReplyWorkflow` | Promote to Workflow; **add a scheduler entry — it has none** |
| `barryHunterProcessEngage.js` | `netlify/functions/` | **Keep** | Already `EngageContactWorkflow` | Promote to Workflow |
| `barryInboxAnalyzer.js` / `barryDraftComposer.js` | `netlify/functions/utils/` | **Keep** | Best-specified output contracts | Become `AnalyzeInboundMessageSkill` / `ComposeReplySkill` |
| `barry_drafts` + `BarryReplyCard` | Firestore + `components/hunter/` | **Keep** | The Prepared Action reference implementation | Becomes an Action Queue item renderer |
| `recommendationEngine.js` | `src/utils/` | **Consolidate** | Best recommendation logic, wrong tier (client) | Move server-side; merge NBS + server-side vocab into one ID space |
| `nextBestStepService.js` | `src/services/` | **Consolidate** | 11 NBS types overlap 11 recommendation types | Merge into recommendation vocabulary; keep the queue semantics |
| `barryMemoryService.js` | `src/services/` | **Consolidate + fix** | Duplicates server assembler; **contaminates durable memory** | Split: keep memory writes, delete `assembleBarryContext`, insert promotion pipeline before every durable write |
| `barryContextStack.js` | `src/utils/` | **Replace** | Ships 500 contacts per turn; largest cost line | Server-side workspace context + entity retrieval |
| `barryMissionChat.js` | `netlify/functions/` | **Consolidate** | 1234 L doing chat + brief + ICP + recommendations | Split into Orchestrator entry + `GenerateMorningBriefSkill`; delete the recommendation loader |
| `barryOrientationBrief.js` | `netlify/functions/` | **Keep as the seed** | Correct AI-for-prose pattern with deterministic fallback | Becomes `GenerateMorningBriefSkill` over the Brief Data Contract |
| 9 message generators (§5 #7, #8) | `netlify/functions/` | **Consolidate** | Nine prompts, one job | → `WriteEngagementMessageSkill(intent, channel, angleCount)` |
| `generate-section-1..10.js` | `netlify/functions/` | **Consolidate** | 10 near-identical files | → `GenerateReconSectionSkill(sectionId)` + 10 templates |
| `barryReconInterview` / `barryReconSection0` / `barry-coach-section` | `netlify/functions/` | **Consolidate** | Same job, 3 modes | → `CoachReconSectionSkill(mode)` |
| `barryHunterCardRead` / `barryCSMRead` / `barryDossierBriefing` | `netlify/functions/` | **Consolidate** | Same job, 3 depths | → `SummarizeRelationshipSkill(depth)`, cached as an Artifact |
| `barryActions.js` | `netlify/functions/` | **Replace** | Intent parsing by prompt; confirmation decided by the model | → Capability Registry + typed tool schemas + Action Executor |
| `barryValidateContact.js` | `netlify/functions/` | **Replace** | AI for field validation | Deterministic validator |
| `logApiUsage.js` | `netlify/functions/utils/` | **Replace** | Labels Anthropic spend as Apollo; unauthenticated writes; lossy summary | New telemetry writer (E1) |
| `barryContextStore.js` | `src/context/` | **Delete** | Only consumer unmounted | — |
| `BarryChat.jsx` + `BarryTrigger.jsx` | `src/components/barry/` | **Delete** | Superseded by shell Barry (`App.jsx:356`) | Verify no `drawer_*` threads carry needed history first |
| `BarryBriefing.jsx` | `src/components/contacts/` | **Delete** | Zero importers | — |
| `users/{uid}/barry_sessions` | Firestore | **Replace** | Collides by name with the contact-scoped collection | Rename to `barry_conversations_index`; migrate `BarrySessionHistoryPanel` |
| 5 conversation stores | Firestore | **Consolidate** | Six threads, one Barry | One `conversations/{conversationId}` keyed by `barrySessionKey` — **which is already computed and already ignored** |
| `MissionPhase{1..5}Page` + `Phase{1..5}*` components | `src/pages/`, `src/components/` | **Delete** | Call 5 non-existent endpoints | — |
| `generate-leads`, `generate-leads-v2`, `generate-email`, `generate-linkedin`, `generate-executive-summary` call sites | various | **Delete** | Endpoints do not exist | Re-point `GenerateLinkedInModal` at `DraftLinkedInMessageSkill` |
| 4 unrouted Mission Controls + 4 ICP Validation copies + 13 questionnaire/phase copies + `Section1Foundation.backup.jsx` + `generate-icp-brief.cjs` | various | **Delete** | Dead code, ~8 000 lines | — |
| `reconCompiler` ×2, `reconSectionMap` ×2, `brigadeSystem` ×2 | `src/` + `netlify/` | **Consolidate** | Drifted duplicates | Shared module |
| `timelineLogger` + `engagementHistoryLogger` | `src/utils/` | **Consolidate** | Two vocabularies, one collection | One signal emitter publishing to the bus |
| 9 status fields + `statusModel.js` 3 fields | contact document | **Consolidate** | Documented contradiction, dual-written | Execute the backfill in `docs/STATUS_ARCHITECTURE.md`; delete the legacy 9 |
| `search-companies.js:991` `barry_intel` write | `netlify/functions/` | **Replace** | Barry writing derived intel onto canonical company docs (Law 5) | Move to Relationship/Company Awareness |
| `barry-approve-send.js` | `netlify/functions/` | **Keep + fix** | Correct send path, **no double-send guard** | Add idempotency key check before the Gmail call (E3) |

## 11.2 Recommended phased build sequence

**Reference:** `Foundation → Awareness → Think Layer → Context → Skills → Workflows → Actions → Morning Brief → Surface Consolidation → Orchestration → Autonomy`

**Recommended, derived from findings:**

```
P0  Observability + Dead Code Removal
P1  Signal Bus (Foundation)
P2  Context Resolver
P3  Awareness Projections
P4  Skills Registry
P5  Think Layer promotion
P6  Capability Registry + Action Executor + Action Queue
P7  Workflows
P8  Morning Brief + Mission Control Aggregation
P9  Surface Consolidation
P10 Memory Promotion Pipeline
P11 Orchestration
P12 Autonomy
```

### Deviations from the reference, and why

| Deviation | Reasoning |
|---|---|
| **P0 inserted before Foundation** | Two reasons. (a) Cost is currently unmeasurable *and mislabeled* — every consolidation decision after this point needs a number, and today there is none. (b) ~8 000 lines of dead code across 30 files, including 11 call sites pointing at endpoints that do not exist, will otherwise be migrated by mistake. This is days of work that de-risks months. |
| **Context (P2) moved ahead of Awareness (P3)** | The reference orders Awareness → Think → Context. In this codebase Awareness cannot be built first: there are nine context implementations and the awareness projections would have to choose one to read from. Fixing context first gives the projections a single input. The `barryContextStack` cost problem is also the single largest cost line and it is fixed here. |
| **Think Layer (P5) moved after Skills (P4)** | The reference puts Think third. Here the Think layer already exists and works; its problem is reach, not existence. It reaches 4 of 38 endpoints because there are 38 endpoints. Building the Skills registry first means Think plugs into 15 Skills rather than being wired into 38 functions one at a time. **This is the deviation with the largest schedule impact and it is driven directly by §3.6.** |
| **Capability Registry + Action Executor (P6) pulled forward, merged with Actions** | The reference lists Actions seventh and treats the registry as part of the final architecture. But the double-send defect in `barry-approve-send.js` is live today, and every Workflow in P7 will call side-effect capabilities. Building Workflows over an unguarded executor bakes in the defect. |
| **Memory Promotion Pipeline (P10) called out as its own phase** | The reference folds memory into Foundation. Here memory *exists* and is *actively contaminating itself* (§3.3). This is a correctness fix requiring a backfill decision — which existing `what_has_worked` entries are trustworthy? — and it cannot be a sub-task of another phase. It is placed after Surface Consolidation because the promotion UI ("Barry learned this / unlearn") needs a consolidated surface to live on. |
| **Autonomy (P12) reduced in scope** | The reference implies a Policy/Autonomy Engine. Per §10.0, Phase 1 ships two registry fields enforced by the executor, ceiling at Approval for all side-effect capabilities. The full engine waits for E5 (Confidence) and E7 (Permissions). |
| **Surface Consolidation (P9) kept late, as in the reference** | Agreed with the reference and worth stating: it is tempting to consolidate 40 surfaces early because the duplication is so visible. But every surface currently owns its own context and its own calls. Consolidating before P2–P6 means consolidating onto nothing. |

### Phase detail

| Phase | Deliverable | Depends on | Retires |
|---|---|---|---|
| **P0** | Fixed telemetry (provider/model/tokens/trace, authenticated, incremented); delete 30 dead files + 11 dead call sites | — | §5 #13,14,15,19; `generate-icp-brief.cjs`; `barryContextStore`; `BarryChat`/`BarryTrigger`; `BarryBriefing` |
| **P1** | Signal envelope; bus collection; Gmail adapter migrated; publishers for signals 1–7 and 18–20 | E2 (workspaceId) | `timelineLogger`/`engagementHistoryLogger` split |
| **P2** | `resolveContext()` with 5 layers + budget + `droppedSections`; server-side workspace context | P1 | `barryContextStack`, client `assembleBarryContext`, 2× `reconCompiler`, inline assembly ×4 |
| **P3** | Four projections, persisted, staleness contract, signal-driven rebuild | P1, P2 | 5× business-awareness recomputation |
| **P4** | 15 Skills; 5 of them AI-free; one Skill = one prompt template + one contract | P2 | 38 endpoints → 15 |
| **P5** | Think layer over Skills; cross-entity priority; `strategyScores` persisted to a reasoning trace | P3, P4, E4 | Direct context→output paths |
| **P6** | Capability Registry; Action Executor with idempotency + audit; Action Queue | P5, E3 | `barryActions`, `barryPipelineAction`, unguarded send paths |
| **P7** | 6 Workflows; 2 are promotions of existing chains | P4, P6 | `barryHunterProcessEngage`, `process-barry-inbox-queue` as bespoke functions |
| **P8** | Morning Brief over the Data Contract (zero AI for data); Mission Control aggregation over three horizons | P3, P6 | 3 brief implementations; 3 recommendation vocabularies |
| **P9** | 40 surfaces → ~12; one conversation store keyed by `barrySessionKey` | P8 | 6 conversation stores; 14 layer-mixing surfaces |
| **P10** | Promotion pipeline + provenance + unlearn UI; backfill decision on existing memory arrays | P9 | Law 18 violation |
| **P11** | Orchestrator; the Utah credit unions flow end to end; Artifacts | P7, P8 | — |
| **P12** | Autonomy fields enforced; ceiling at Approval for side effects | P6, E5 | — |

---

# The Barry OS Constitution

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

# Acceptance Criteria

- [x] Every Barry surface is inventoried with five-layer analysis, Skills/Workflows support noted, and direct-call violations flagged — §1, 47 entries
- [x] Every Barry service and AI endpoint is documented with cost classification — §2, §6
- [x] All five memory types are identified and their current state documented — §3.3 (six recommended, §10.9)
- [x] All four awareness projections are identified or confirmed absent — §3.4, all four absent or partial
- [x] A Think layer is identified or confirmed absent — §3.6, present but reaching 4 of 38 endpoints
- [x] The five layers are traced through the current architecture with conflation points flagged — §3.5, six conflation points
- [x] Potential Barry Skills and Workflows are identified from current capabilities — §10.2, §10.3
- [x] Schema contradictions across Barry context objects are documented — §3.1, §3.2, §5 #18, #20
- [x] Signal map covers all major platform events — §4.1, 17 events
- [x] Every duplicate implementation has a disposition recommendation — §5, 20 groups; §11.1
- [x] Cost baseline uses measured/calculated/estimated/unknown classification — §6.1, §2.4
- [x] AI-for-deterministic-logic antipatterns are identified — §6.4
- [x] Observability roadmap is included — §6.6, O1–O6
- [x] Enterprise foundation findings cover all eight areas — §7
- [x] Mission Control audit is organized across three horizons and around user work concepts — §8.2
- [x] All four existing integrations are audited for Barry signal production — §9, eight audited
- [x] Recommended Barry OS architecture either validates or modifies the reference model with evidence — §10.0
- [x] Think layer specification is included — §10.5
- [x] Skills Registry and Workflows Registry are included — §10.2, §10.3
- [x] Barry Artifacts are defined — §10.11
- [x] Migration map covers every current implementation — §11.1
- [x] Phased build sequence is derived from findings with deviations from reference explained — §11.2
- [x] Barry OS Constitution with all 24 laws is included — above
- [x] No code was written or changed during this audit — this report is the only file added

---

# Appendix A — Defects Found During Audit

Not part of the architecture recommendation. Flagged because they are live in production and cheap to fix.

| # | Defect | Location | Impact |
|---|---|---|---|
| A1 | `barry-approve-send` has no double-send guard; does not check `approvalStatus` before calling Gmail | `netlify/functions/barry-approve-send.js:249` | Two clicks or two tabs send the reply twice. The code's own comment at line 264 acknowledges the retry risk. |
| A2 | `logApiUsage` writes every operation as `APOLLO_<OP>` with `creditsUsed: 1` | `netlify/functions/utils/logApiUsage.js:20,28` | Anthropic spend recorded as Apollo credits; `apiLogs` is unusable for AI cost |
| A3 | `logApiUsage` POSTs to the Firestore REST API with no auth header | `logApiUsage.js:57` | Writes silently failing, or the `apiLogs` rule not enforced on this path |
| A4 | `process-barry-inbox-queue` has no scheduler entry | `netlify.toml` (timeout only) | Inbound analysis + drafts may never run unless invoked manually |
| A5 | 11 frontend call sites target non-existent Netlify functions | `Phase{1..5}*.jsx`, `LaunchSequence.jsx`, `GenerateEmailModal.jsx`, `GenerateLinkedInModal.jsx`, `ICPValidationPage OLD.jsx`, `Dashboard.jsx` | Silent 404s on user action |
| A6 | `getCalendarContext` returns `[]` on any failure | `src/utils/barryContextStack.js:203` | Barry reports "no meetings" when the calendar is unreachable |
| A7 | `assembleBarryContext` returns empty context on error, indistinguishably from "no memory" | `barryContextAssembler.js:179` | Barry generates cold messages for warm contacts with no signal that memory was lost |
| A8 | `gmail-sync-worker` caps at 50 users with no overflow reporting | `gmail-sync-worker.js` `MAX_USERS_PER_RUN` | Users beyond 50 silently never sync |
| A9 | `barry_sessions` names two different collections | `peopleSchema.js:433` vs `BarryChatPanel.jsx:87` | Wrong-collection writes; `BarrySessionHistoryPanel` shows an incomplete history |
| A10 | `usePendingReplies` is an N+1 read with no index | `src/hooks/usePendingReplies.js:95,111` | Mission Control load time grows with pending-reply count |
| A11 | `logApiUsage` summary is read-then-write, not `FieldValue.increment()` | `logApiUsage.js:68-90` | Concurrent calls lose counts |
| A12 | `search-companies.js` writes `barry_intel` onto canonical company documents | `search-companies.js:991` | Law 5 breach; derived intel in canonical storage |

---

**Report ends. No implementation begins until the five follow-on documents are approved by Aaron and Team Beta.**
