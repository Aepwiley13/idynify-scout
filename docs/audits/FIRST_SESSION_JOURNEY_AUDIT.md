# First-Session Journey Audit — Define → Discover → Decide → Engage → Follow up

**Audit only. Nothing here is implemented.** Repo state: `main` @ `7492ae2` (2026-09-26).
Every technical claim is tagged **[V]** VERIFIED (I read the code path) or **[I]** INFERRED.
Every UX finding is tagged **OBS** (OBSERVED: customer evidence, mainly `docs/client-onboarding-feedback-laura-march20.md`) or **TJ** (TEAM JUDGMENT).

---

## 1. ONE-PAGE DECISION SUMMARY

### The journey in five lines

| Stage | What the customer experiences | Backbone that already exists |
|---|---|---|
| **Define** | Tells Barry who they sell to (or pastes a website); Barry proposes a target in words; they say yes. | `/barry` First Experience: `BarryWorkspace` + embedded `BarryOnboarding` + `TargetingProposal` |
| **Discover** | Barry searches while narrating progress, then says "I found N companies." | `search-companies` (ICP-stamped, criteria-fingerprinted, shadow encounter) |
| **Decide** | Approves the best few in-thread, each with a one-line "why it fits"; the rest wait in Daily Discoveries. | Daily Discoveries decision logic in `DailyLeads.handleSwipe` — **logic kept, lifted out of the 3,446-line file** |
| **Engage** | Barry shows the 1–3 right people at an approved company, explains why each matters, drafts; customer reviews and sends. | Canonical contact page `/contact/:id` → `InlineEngagementSection` → `executeSendAction` |
| **Follow up** | Idynify records the send, sets a 3-day follow-up, and Mission Control says what to do next. | `executeSendAction` post-send state + Mission Control recommendations |

### What this audit means (read this first)

1. **Most of the journey already exists.** Onboarding has already been consolidated to one live route (`/barry`); six of the seven "known" routes redirect there. The problem isn't too many onboarding flows now. It's that **the first session ends at ICP confirmation and then drops the customer into modules.**
2. **The strongest lineage (Daily Discoveries swipe) and the first-session experience are on different code paths.** The in-thread "Accept" card and Mission Control's "Approve" both skip the ICP decision stamp, the shadow lineage event, **and** people auto-discovery. So the first company a new customer approves has the weakest provenance in the product, and Barry promises "we can look at the right people there next" when nothing follows.
3. **Drafting doesn't know the ICP.** The single-contact drafter (`generate-engagement-message`) reads Recon §3/5/8/9 and the user doc. It doesn't read the ICP, its persona, its `messaging`, the onboarding transcript, or the website analysis (Recon §1). A brand-new user's first draft is built from almost none of what they just told Barry.
4. **Follow-up can honestly mean only "sent, awaiting reply, follow-up due in 3 days"** until `GMAIL_IDENTITY_MODE=live`. Reply-driven "what to do next" is dark.
5. **Nothing here needs new architecture.** Wire the first session through the approved write paths (Sprints 1–2), don't read shadow before cutover, and derive progress from state rather than flags.

### Decisions needed from Aaron (product direction only)

| # | Decision | Why it's yours | Recommendation |
|---|---|---|---|
| D1 | **Where does "first session" end?** Today `onboardingComplete` is set at ICP confirm (`BarryOnboarding.jsx:614-625`). | It defines activation, redirects and the progress model. | End at **first relevant send**. Derive progress from state, not the flag. |
| D2 | **Hide module navigation until first send?** The IA is "locked — do not reopen without explicit product + architecture approval" (`src/constants/navigationModel.js:1-5`). The sidebar is already hidden during First Experience (`Sidebar.jsx:239`). | Reopens the locked IA. | Yes. Keep the shell, and show modules after first send or on explicit request. |
| D3 | **Approve new lineage writers.** Adding a writer is by design "a conversation about where its ICP came from" (`src/test/icpShadowWrites.test.js:295-308`). The first-session decide/engage surfaces need to become writers, or call a shared writer. | The test names this as a review decision. | Approve **one** shared `companyDecision`/`personDecision` module as the writer, rather than more screens. |
| D4 | **Should drafting read the ICP (persona + `messaging`) and what the customer said in onboarding?** Sprint 2 flagged that "Messaging COPY remains unversioned" (commit `dd01b6e`). | It's a product call about whose voice and context a draft uses. | Yes for the first session: pass the deciding ICP id and read its `messaging` the way mission drafting already does. Versioning of copy can wait. |
| D5 | **Does a mailto "opened" count as a send?** Without Gmail, `executeSendAction` opens mailto and still sets awaiting-reply (`sendActionResolver.js:~590-605`). | It defines "relevant outreach" in the metric. | No. Activation requires `method:'real'` + `SENT`. Put Gmail connect inline, right before the first send. |
| D6 | **One ICP or segments in the first session?** Laura thought in two segments (OBS). Multi-ICP reads are gated on Sprint 3. | It's a scope call. | One ICP in the first session. Offer "add a second audience" after the first send. |
| D7 | **Stale open PRs that collide with this journey:** #432 "Auto-ICP, Auto-Triage, Auto-Handoff" (Jun 25) and #405 "multi-ICP card stacks" (Apr 2). | Ownership call. | Close or explicitly park both. Don't rebase them into this. |

### SHIP NOW (uses today's architecture; no throwaway)

| Item | Size |
|---|---|
| Fix "Review ICP with Barry": the arrival state is dropped by `<Navigate to="/barry" replace/>`, and completed users never enter refine mode (see §3.B). | S |
| Route first-session **Accept** through the same decision path Daily Discoveries uses (`swipedForICPId`, `recordDecision`, ICP-persona auto people discovery). Extract it from `DailyLeads.jsx:1990-2140` into a shared module. | M |
| Filter the first-session results card to the confirmed `icpId`, and show `fit_reasons`/`barry_intel` instead of a bare score. | S |
| After Accept, render the auto-discovered people **in-thread** (the data is already written as `status:'suggested'`, `source:'icp_auto_discovery'`) with a link to `/contact/:id`. | M |
| A pure `deriveJourneyState(uid)` reading legacy, authoritative state only (ICP, accepted companies, contacts, Gmail, `message_sent`), driving the progress UI and "next step". | M |
| Instrumentation: add `company_approved`, `person_selected`, `gmail_connected`, `message_reviewed`, `first_send` to `EVENTS` (§12). | S |
| Drafting receives the deciding `icpId`. `generate-engagement-message` reads `icpProfiles/{id}.targetTitles/messaging` and Recon §1 (mirror `barryGenerateSequenceStep.js:145-160`). | S–M |
| Copy: remove module names from Barry's first words ("so Scout and Hunter know…", `BarryOnboarding.jsx:163-166`) and repoint the welcome email from `/getting-started` to `/barry` (`send-welcome-email.js:99`). | S |
| Redirect and hide legacy first-run routes (§7). | S |

### SHIP AFTER DEPENDENCY

| Item | Dependency |
|---|---|
| "Why this company / person fits **this ICP, under criteria v‑N**", read from `icpRelationships`/`lineageEvents`/`criteriaVersions` | Sprint 3 read cutover past **Stage 1** (only the reconciler runner is approved; no Stage 2 is defined in the repo [V]) |
| Reply → "they answered, here's what to do" in the first-session follow-up | `GMAIL_IDENTITY_MODE=live`, blocked by the cursor-wedge defect (ADR-006 §Blocker) and per-tenant activation scoping [I] |
| ICP stamp on one-off sends and missions (reply attribution beyond bulk cadences) | A decision on where send-level ICP context lives (send event vs enrollment) + Sprint 3's explicit-ICP-choice UI (`BulkSendExecutor.jsx:166-170` comment) |
| Multi-ICP segments inside the journey | Sprint 3 read cutover + D6 |
| "Don't show me this again" that persists | `exclusions` has a reader (`icpRelationshipService.isExcluded`) but **no writer** [V] |

### PRESERVE EXPERIENCE / DO NOT IMPLEMENT YET

| Experience | Why wait |
|---|---|
| Barry learns from approve/reject decisions (OBS: Laura "expects the platform to adapt… it doesn't yet") | It needs relationship reads (post-cutover) or it becomes a parallel learning store |
| `BarryReplyCard` / pending replies as the "Idynify remembered" moment | It reads `conversationState=='user_action_required'` (`usePendingReplies.js:184`), which only the live canonical writer sets |
| Ambiguous-attribution review ("this reply spans two ICPs") | `icpAttribution.js` is derivation-only and dark by design |
| Contact authority ranking ("high-probability buyer") (OBS: Laura) | There's no persisted person↔ICP evaluation readable yet |
| Go To War / Scout Game rapid review-send | Strong, but post-activation (§11) |

---

## 1a. STOP-RULE REPORT (lineage blockers)

**There's no fundamental blocker to the *experience*.** Every step can run today on authoritative legacy state. **There is one structural blocker to *lineage*, and it's cheap to fix:**

| | |
|---|---|
| **What's broken** | There's no shared decision write path. The only code that stamps `swipedForICPId`, writes the shadow decision event, and fires ICP-persona people discovery lives inline in `DailyLeads.handleSwipe` (`DailyLeads.jsx:2004-2130`) [V]. Three other accept paths bypass all of it: `CompanyResultsCard.jsx:13-29`, `MissionControlDashboardV2.jsx:926-935`, `CompanyDetail.jsx:~905-918` [V]. |
| **Where it occurs** | ICP → Company decision, and Company → Person. |
| **Journey steps affected** | Decide and Engage. The in-thread first-session Accept is a bypass path. |
| **Can the experience be preserved?** | Yes. The in-thread card stays; its write changes. |
| **Why the reconciler won't catch it** | A decided company with no `swipedForICPId` is classified `expected-gap` (commit `fc2a81f`, `icpReconcile.js`) [V]. Bypass-path decisions are invisible to the Stage 1 gate. |
| **Dependency that resolves it** | None external. Extract the decision path and approve it as a writer (D3). |
| **Can Best-of analysis proceed?** | Yes. It continues below. |

A second, softer break: **Message** has no durable object. Generated text lives in `timeline.message_generated`, and sent text in `timeline.message_sent.metadata.fullMessage` and `email_logs`. Nothing links a draft to its send, or either to an ICP [V]. That doesn't block the journey, but "which message belongs to that context" can't be answered (§3.C).

---

## 2. CURRENT-FLOW MAP

**The original seven aren't the full set.** Six of them are pure redirects. The live first-run surface is `/barry`, plus `/getting-started` (reached only from the welcome email).

| Route | Component | Entry point | Purpose | Exit | Reachability | Status |
|---|---|---|---|---|---|---|
| `/getting-started` | `pages/GettingStarted.jsx` | Welcome email link only (`send-welcome-email.js:99`) [V] | Explains "What is Scout / What is Recon" | `/scout`, `/recon` | Live; not linked in-app [V] | **Live, legacy framing**; exposes module names |
| `/onboarding` | — | `CheckoutSuccessPage.jsx:13,98`; MC `:581,:624`; DailyLeads `:2728`; `ScoutDashboardPage` | — | → `/barry` | Redirect (`App.jsx:363`) [V] | Alias. **Drops `location.state`** (§3.B) |
| `/onboarding/flow` | — | none in-app | — | → `/barry` | `App.jsx:364` [V] | Alias |
| `/onboarding/recon` | — | none | — | → `/barry` | `App.jsx:365` [V] | Alias |
| `/onboarding/barry` | — | none (a test asserts no source links it) | — | → `/barry` | `App.jsx:366` [V] | Alias |
| `/onboarding/company-profile` | — | none | retired questionnaire | → `/barry` | `App.jsx:734` [V] | Alias (not in original list) |
| `/scout-questionnaire` | — | `UnifiedDashboard.jsx:36`, `ImprovedScoutQuestionnaire` (unrouted) | — | → `/mission-control-v2` | `App.jsx:369` [V] | Alias |
| `/icp-validation` | — | `ImprovedScoutQuestionnaire.jsx:355` (unrouted) | — | → `/mission-control-v2` | `App.jsx:370` [V] | Alias |
| **`/barry`** | `pages/Barry/BarryWorkspace.jsx` | `SmartRedirect` when `!onboardingComplete && !onboarding.completed` (`App.jsx:317-320`); all aliases above | **The canonical First Experience**: WHO → INTENT → first value, in one thread | In-thread buttons → `/scout` (Daily Discoveries), Hunter tabs, `/settings` | Live [V] | **Canonical** |
| `/questionnaire` | `pages/Questionnaire.jsx` | direct URL only | 6-question form → top-level `icpData/{uid}` | `/dashboard` → MC | Live by URL [V] | **Dead-end legacy**; its write has no reader [V] |
| `/icp`, `/icp-brief` | `ICPBuilder`, `ICPBriefView` | `CompanyList.jsx:136`, each other | Old Module-1 ICP form → `users/{uid}/icp` + brief | each other | Live by URL [V] | Legacy; `users/{uid}/icp` is read only by `CompanyList` [V] |
| `/companies`, `/old-scout`, `/add-company`, `/lead-review`, `/old-dashboard` | MVP components | URL only | old MVP | — | Live by URL (`App.jsx:754-803`) [V] | Legacy |
| `/mission-control-v2/recon[/section/:id]` | `RECONModulePage`, `RECONSectionPage` | `Section1Foundation.jsx:325`, `Section2…:686`, `Section10…:339` [V] | old Recon shell | itself | Live (`App.jsx:559-575`) | **Duplicate** of `/recon` (`ReconMain`) |
| `/recon/user-profile` | `ReconSection0` | Recon nav | Barry "Section 0" profile interview | Recon | Live [V] | Not first-run; its output is orphaned (§3.B) |
| (unrouted) `FirstExperience.jsx` | — | tests only (`firstExperienceIntentFlow.test.jsx`) [V] | superseded FE page | — | **Unreachable** | Dead code |
| (unrouted) `ReconOnboardingWizard`, `OnboardingStep`, `ImprovedScoutQuestionnaire`, `CompanyQuestionnaire`, `ScoutDashboardPage` | — | no importer except `App.jsx` import of `ScoutDashboardPage` with no `<Route>` [V] | — | — | **Unreachable** | Dead code |
| (unreachable mode) standalone `BarryOnboarding` (non-`embedded`) | — | only via `FirstExperience.jsx` (unrouted) [V] | has the 3-step progress bar added after Laura (`BarryOnboarding.jsx:757-765`) | → MC after 2.5s | **Unreachable** [V] | The Laura-driven progress indicator is currently invisible |
| `/mission-control-v2` first-run view | `FirstRunView` in `MissionControlDashboardV2.jsx:308` | Only when `onboardingComplete && onboardingSource==='barry_onboarding' && hasSeenMCWelcome===false` (`:942-945`) [V] | Narrated search progress + first matches | `/scout` Daily Discoveries | Live; embedded `/barry` users see it only if they navigate there [I] | Secondary first-run surface |

**Signup path [V]:** `/signup` (email, password, tier; `Signup.jsx:119`) → `/checkout` → `/checkout/success` → `/onboarding` → `/barry`.

---

## 3. ICP CAPTURE INVENTORY + LINEAGE MAP

### A. What is actually collected (only what exists)

| Item | Where collected | Where stored | ICP-associated? | Versioned? | Downstream readers |
|---|---|---|---|---|---|
| Name (WHO) | `/barry` FE (`useFirstExperienceController.js` `who` phase) | `rememberName` → user doc [V] | No | No | FE greeting, Barry [V] |
| Intent ("what are you hoping to get done") | `/barry` FE | Not stored; classified via `barryMissionChat firstExperience:true`, only categorical analytics [V] | No | No | Routing only |
| Industries, company sizes, locations/nationwide, target titles, lookalike seed, company keywords, founded age | `/barry` embedded `BarryOnboarding` via `barryICPConversation` | `icpProfiles/{icpId}` (authoritative) + `companyProfile/current` bridge projection (`BarryOnboarding.jsx:~540-590`) [V] | **Yes** | Lazily: `criteriaVersions` minted on first discovery/decision/send (`icpRelationshipService.ensureCriteriaVersion`, `icpRelationshipWriter`) [V]. Shadow. | Discovery (`search-companies`), scoring, DailyLeads persona (`resolveSearchIcp`), cadence stamp, Barry chat context stack [V]. **Not** single-contact drafting [V] |
| Free-text conversation (what they sell, pains, anything else said) | `/barry` embedded | `barryConversations/icp.messages` + canonical turns [V] | Loosely (`confirmedICP`) | No | **Nothing downstream.** Only FE mode resolution and admin view (`BarryConversationsView.jsx:24`) [V] |
| Website → company name, what you do, main product, current customers | `/barry` accelerator (`analyze-website`) | `dashboards/{uid}` Recon §1 + `recon.websiteAnalysis` (`analyze-website.js:376-426`) [V]; also *proposes* ICP criteria | Proposes into ICP only on confirm | No | `barryContextStack` (§1 as `icp`), `compileReconForPrompt` (mission drafting) [V]. **Not** `generate-engagement-message` (reads §3/5/8/9) [V] |
| Messaging (tone, CTAs, key messages) | ICP Settings → `Section9MessagingFlow`; Recon §9 | `icpProfiles/{id}.messaging` **and** Recon §9 on `dashboards` (copied by `dashboardUtils.js:328-358`) [V] | Yes (per-ICP) + No (dashboard copy) | No (Sprint 2 declined to version copy) | Mission drafting (`barryGenerateSequenceStep.js:156`, `barryHunterGenerateStep.js:163`), chat stack (`barryContextStack.js:294`) read ICP copy; `generate-engagement-message` reads **dashboard §9** only [V] |
| Pain points, psychographics, firmographics, competition | Recon §3–§8 (not first-run) | `dashboards/{uid}` [V] | No | No | Drafters and chat [V] |
| Sender profile (identity, style, targets) | Recon Section 0 | `users/{uid}/reconProfile/section0` (`barryReconSection0.js:166`) [V] | No | No | **Only its own interview and page** [V] |
| Legacy questionnaire answers | `/questionnaire` | top-level `icpData/{uid}` (`Questionnaire.jsx:82`) [V] | No | No | **None** [V] |
| Legacy Module-1 ICP | `/icp` | `users/{uid}/icp` + `icpBrief` (`ICPBuilder.jsx:60-90`) [V] | No | No | `CompanyList` (legacy) only [V] |
| Legacy Scout questionnaire | (unrouted) | `users.scoutData` [V] | No | No | none live [V] |
| Legacy smart-questions (`excludedIndustries`, `perfectCustomer`, …) | old `/onboarding` flow (removed) | top-level `dashboards/{uid}` fields | No | No | "asked, stored, never read" per `TEAM_A_PHASE2_DISCOVERY_BARRY_FIRST_EXPERIENCE.md` B-4 [I: I didn't re-read every consumer] |

### B. Orphaned context and breaks

| Finding | Evidence | Tag |
|---|---|---|
| **The onboarding transcript is never read downstream.** Whatever the customer said beyond targeting fields is lost to Barry. | Only readers: `useFirstExperienceController.js:97`, `BarryOnboarding`, admin view | [V] |
| **The first draft doesn't read the ICP.** Persona titles, ICP `messaging`, and the ICP the person was found under are all absent from `generate-engagement-message`. | `generate-engagement-message.js:147-180` reads `dashboards` + `users`; no `icpProfiles`/`companyProfile` read (grep) | [V] |
| **Website analysis (§1) isn't used by the single-contact drafter**, though mission drafting and chat use it. | §1 absent from `generate-engagement-message.js` section list (3,5,8,9) | [V] |
| **"Context by Barry" (why this person matters) doesn't know the ICP.** | `barryGenerateContext.js:65` reads `dashboards` only | [V] |
| **Drafter's "USER'S COMPANY" line reads `users.companyName`**, and no writer was found for it. | `generate-engagement-message.js:446`; repo grep | [I] |
| **Section 0 profile is orphaned.** | `reconProfile/section0` readers = its own function + page | [V] |
| **Firmographics are collected twice**: ICP criteria (structured) and Recon §3 (free-form). No sync either way. | Recon components write no `icpProfiles`/`companyProfile` (grep) | [V] |
| **Messaging is stored twice** (ICP `messaging` and Recon §9), and different drafters read different copies. | see table above | [V] |
| **"Review ICP with Barry" re-asks from scratch.** `navigate('/onboarding',{state:{arrival}})` hits `<Navigate to="/barry" replace/>`, which carries no state. And `/barry` runs the FE controller only when `!onboardingComplete`, so every Review-ICP user (who, by construction, has completed onboarding) lands in generic chat, not refine mode. | `App.jsx:363`; `BarryWorkspace.jsx:59,197-200,382`; `firstExperienceMode.js:45`. Tests assert source strings only (`firstExperienceRouting.test.js:86`). React Router dropping state on `<Navigate>` without a `state` prop: [I] from library semantics. | [V]/[I] |
| **First-session results card shows pending companies from *any* ICP**, scored against the bridge. | `BarryWorkspace.jsx:141-155` (`where('status','==','pending')` only) | [V] |
| **Barry promises a next step that doesn't happen**: "We can look at the right people there next." | `BarryWorkspace.jsx:489-492`; `CompanyResultsCard` fires no people search | [V] |
| **Stored `fit_score`s from before Tier 2 have no reliable ICP attribution.** | `ICPSettings.jsx:330-351` | [V] |
| **Laura was "locked into Hospitality" and couldn't expand** | Laura doc friction #5 | OBS |

### C. Lineage: ICP → Company → Person → Message → Send → Follow-up

| Question | Answerable today? | Where / why not |
|---|---|---|
| Which ICP did this company come from? | **Yes (legacy)** | `companies.icpId` + `icpCriteriaFingerprint` at discovery (`search-companies.js:1412`, `:1452`) [V]. `icpId` points at a **mutable** doc [V] |
| Which criteria version made it eligible? | **Shadow only** | `icpRelationships.encounteredUnderVersion` via `recordDiscoveryEncounter` (`search-companies.js:1430-1507`) [V]; unreadable until cutover |
| Why was the company selected? | **Partially** | `fit_reasons`/`barry_intel` stamped at discovery (`:1600`, `:~1418`) [V]; decision reason = optional `barryFeedback` (DailyLeads only) [V] |
| Under which ICP was it **approved**? | **Only via Daily Discoveries** | `swipedForICPId` + shadow `accepted` event (`DailyLeads.jsx:2016,2031-2039`) [V]. **Breaks** in `CompanyResultsCard`, MC approve, CompanyDetail approve [V] |
| Why was the person selected? | **Weak** | Company `selected_titles` (`titles_source:'icp_auto'`) + contact `source:'icp_auto_discovery'` [V]. The contact doc carries **no** `icpId` [V]. Shadow person relationship only on DailyLeads auto-discovery and People tab (`:2118-2125`, `:2566-2597`) [V] |
| Which company/person relationship? | **Yes** | `contacts.company_id` [V] |
| Which message belongs to that context? | **No** | No message object. `timeline.message_generated` (3 surfaces) and `message_sent` aren't linked by id; no ICP on either [V] |
| Which send belongs to that message? | **Partially** | `timeline.message_sent.metadata.fullMessage/gmailMessageId`, `email_logs` (`gmail-send-quick.js:445-462`) [V] |
| Under which ICP was it sent? | **Bulk cadences only, and from the *globally active* ICP** | `BulkSendExecutor.jsx:171-181` stamps `resolveActiveIcp()`, not the ICP the contact came from [V]. One-off sends and missions: none [V] |
| Which reply belongs to that outreach? | **Dark** | `relationship_events` isn't created in `dry_run` (`relationshipEventWriter.js:85-88`); `icpAttribution.js` is derivation-only and unread [V]. Legacy: manual `gmail-poll-replies` (AllLeads button) sets `hunter_status:'in_conversation'` (`gmail-poll-replies.js:138-193`) [V] |
| Which follow-up state belongs to that relationship? | **Yes, but ICP-less** | `hunter_status:'awaiting_reply'`, `next_step_due=+3d`, `engagement_summary.*` (`sendActionResolver.js:~590-605`, `gmail-send-quick.js:414-437`) [V] |

**Lineage breaks at:** (1) company approve outside Daily Discoveries; (2) contact carries no ICP; (3) no message object; (4) send-level ICP exists only on bulk enrollments; (5) reply attribution dark.

### D. Where each kind of context should live (use what's approved)

| Context | Source of truth | Status | Rule |
|---|---|---|---|
| Customer intent / targeting criteria | `icpProfiles/{icpId}` | Live | Edit-in-place stays. History is carried by `criteriaVersions` |
| What criteria made something eligible | `icpProfiles/{id}/criteriaVersions/{v}` (immutable) | Shadow | Already minted lazily. Don't add another version store |
| Company ↔ ICP fit, decision, skip | `icpRelationships` + `lineageEvents` | Shadow | Every accept path writes through one shared module. Legacy `swipedForICPId` stays authoritative until cutover |
| Person ↔ ICP (direct / inherited) | `icpRelationships` (subjectType `person`) | Shadow | Don't put `icpId` on the contact doc; that recreates the mutable-pointer problem |
| Engagement ICP context | Send-time stamp `{icpId, icpCriteriaVersionId}` | Bulk only | Extend the **same stamp** to one-off sends as a field on `timeline.message_sent` metadata. Needs D4-level approval, and it's written-not-read |
| Reply / relationship truth | `relationship_events` (ADR-006, single writer) | Dry-run | Nothing else writes reply state. Attribution stays derived |
| What the customer said about their business | Recon §1/§2 on `dashboards` | Live | On ICP confirm, write the transcript summary + website analysis into §1 (it already takes website analysis). Don't hang it on the ICP doc |
| Messaging voice | `icpProfiles.messaging` (per ICP) | Live | Drafter reads the ICP copy, falling back to §9. Stop the dashboard copy after migration |
| Sender profile | `reconProfile/section0` | Live, orphaned | Feed it into the drafter's user block, or stop asking for it in the first session |

---

## 4. BEST-OF INVENTORY

| # | Experience / Interaction | Exists today | Evidence | Why keep | Value | Exp. survives? | Impl. survives? | Step | Must/Nice | Effort |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Barry targeting conversation** ("Who are you hunting?" → clarify → confirm) | `BarryOnboarding` embedded in `/barry` | OBS (Laura used Barry for ICP; P0 bug fixed) | The one place the customer states intent in their own words | High: it's the spine of intent | Yes | **Yes** (embedded mode) | Define | Must | — |
| 2 | **TargetingProposal**: "You're trying to… So I'll go looking for… Where I'm less sure…" | `TargetingProposal.jsx` | TJ | Customer agrees with reasoning instead of checking fields; this is the "oh, that's smart" moment | High: it earns trust (OBS: Laura is validation-driven) | Yes | Yes | Define | Must | — |
| 3 | **Website accelerator** ("give me your website and I'll do the reading") | `BarryOnboarding.jsx:902-924`, `analyze-website` | TJ (prior audit calls it "the strongest existing capability… buried") | Less typing, smarter first impression | High | Yes | Yes | Define | Must | — |
| 4 | **Honest blocked/deferred routing** ("I can do that as soon as there's someone to do it with") | `firstValueRouting.js` | TJ | Never fabricates first value | Medium | Yes | Yes | Define | Nice | — |
| 5 | **Refine mode for returning users** ("Review ICP with Barry") | `firstExperienceMode.js` | TJ | Existing users aren't treated as new | High | Yes | **No**: broken by redirect + FE gate (§3.B) | Define | Must | S |
| 6 | **3-step progress bar** (Define ICP → Review → Find Targets) | Standalone `BarryOnboarding.jsx:757-765`, **unreachable** | OBS (added from Laura: "progress indicator so user knows where they are") | Customer knows where they are | High | Yes | **No**: rebuild as the single journey progress model on derived state | All | Must | M |
| 7 | **Narrated search progress** ("Finding companies similar to your best customers… Ranking your top opportunities…") | MC `FirstRunView` (`:300-305`, `:386-400`) | TJ | Waiting feels like work being done | Medium | Yes | **No**: move the copy and progress list into the `/barry` thread | Discover | Must | S |
| 8 | **Saved-ICP summary card** (strategy / industry / size / location / titles) | `BarryOnboarding.jsx:~835-880` (`step==='saving'`) | TJ | Confirms what Barry will act on | Medium | Yes | Yes | Define | Nice | — |
| 9 | **In-thread "I found N companies… here are a few worth starting with" + Accept/Skip** | `BarryWorkspace.jsx:128-180`, `CompanyResultsCard` | TJ | First value arrives in the conversation | High | Yes | **No**: write path bypasses lineage + people discovery; unfiltered by ICP; bare score | Decide | Must | M |
| 10 | **Fit reasons / Barry intel on company card** | `search-companies buildBarryIntel`, `fit_reasons`; shown in DailyLeads/MC | TJ; OBS (Laura cross-checked every company) | Says *why* | High | Yes | Yes (legacy); upgrade to relationship reads post-cutover | Decide | Must | S |
| 11 | **Daily Discoveries swipe with save toast, undo, gesture capture, double-fire guard** | `DailyLeads.jsx` | OBS (toast added after Laura) | Fast, confident decisions | High | Yes | **Logic yes, location no**: extract from the 3,446-line file | Decide | Must | M |
| 12 | **ICP-persona auto people discovery after approve** | `DailyLeads.jsx:2066-2130` | OBS (Laura: find companies → find people) | Removes the "now what?" gap | High | Yes | **No**: only reachable from DailyLeads | Engage | Must | (in #11) |
| 13 | **Context by Barry** (why this person matters) | `BarryContext.jsx` + `barryGenerateContext` | TJ | "Barry explained why they matter" | High | Yes | Partially: add ICP + persona to its input | Engage | Must | S |
| 14 | **RelationshipFirstValue** ("where things stand with one person, from the record") | `RelationshipFirstValue.jsx` | TJ | Honest, no external cost | Medium | Yes | Yes | Engage (relationship intent) | Nice | — |
| 15 | **Send guard** (only generated or typed content, explicit send) | `sendActionResolver.assertSendable` | TJ | Trust: no plan text ever sent | High | Yes | Yes | Engage | Must | — |
| 16 | **Gmail connect with return-to** | `gmail-oauth-callback.js:42-151` | OBS (Aaron had to ask Laura to connect Gmail) | Connect at the moment of need, come back | High | Yes | Yes; add an inline entry on the contact page | Engage | Must | S |
| 17 | **Auto follow-up due in 3 days + awaiting-reply state** | `sendActionResolver.js:~590-605` | TJ | "It tells me what to do next" | High | Yes | Yes | Follow up | Must | — |
| 18 | **Mission Control recommendations as next action** | `useRecommendations` | TJ | One obvious next action | High | Yes | Yes | Follow up | Must | — |
| 19 | **Arrival banner** (why this screen opened) | `ArrivalBanner.jsx`, ADR-005 | TJ | Context appears without searching | Medium | Yes | Yes | Engage/Follow up | Nice | — |
| 20 | **Pending replies / BarryReplyCard** | `usePendingReplies`, `BarryReplyCard.jsx` | TJ | The "Idynify remembered" magic | High | Yes | Yes, but dark until live | Follow up | Must (later) | — |
| 21 | `/getting-started` explainer | `GettingStarted.jsx` | TJ | Teaches module names; contradicts the goal | Low | **No** | No | — | — | S (redirect) |
| 22 | Legacy questionnaires (`/questionnaire`, `/icp`) | see §2 | TJ | Writes with no readers | Low | No | No | — | — | S |

---

## 5. DATA / STATE MAP

```
icpProfiles/{icpId} ──(bridge projection)──► companyProfile/current   [legacy; "not an identity source"]
   └─ criteriaVersions/{v}  [shadow, immutable, lazy]
        │
companies/{cid}.icpId + icpCriteriaFingerprint + fit_reasons + barry_intel  [legacy, at discovery]
companies/{cid}.status / swipedForICPId / approvedAt / swipe_source          [legacy decision, 4 writers]
icpRelationships/{icp__company__cid} + lineageEvents                       [shadow]
        │
contacts/{id}.company_id, source, status:'suggested'|…                     [legacy; NO icpId]
icpRelationships/{icp__person__id}                                         [shadow; 2 paths only]
        │
timeline: message_generated / message_sent   email_logs   cadences.contacts[].{icpId,icpCriteriaVersionId,gmailThreadId}
        │
integrations/gmail.status/connectedAt
        │
contacts.hunter_status / next_step_due / gmail_thread_id / engagement_summary  [legacy follow-up]
relationship_events  [ADR-006; not created in dry_run]   → icpAttribution (derived, dark)
```

| Issue | Detail | Tag |
|---|---|---|
| ID mismatch: ICP for engagement | Bulk stamp uses the globally active ICP, not the contact's discovery ICP (`BulkSendExecutor.jsx:171-181`) | [V] |
| Duplicated state | Criteria on `icpProfiles` and the bridge; messaging on the ICP and Recon §9; firmographics on the ICP and Recon §3 | [V] |
| Same concept, many shapes | Decision time as `swipedAt` (ISO), `approvedAt` (serverTimestamp), or none; `swipe_source` present on only some paths | [V] |
| Broken provenance | Accept via results card / MC / CompanyDetail → no `swipedForICPId`, no event | [V] |
| Missing completion states | "Message reviewed" isn't recorded anywhere; `onboarding.*` step flags never advanced (`markStep` has no caller) | [V] |
| Disappearing records | Contacts both `suggested` and engaged were counted nowhere; mitigated by `engagementPromotionPatch` | [V] |
| Written but not read | `swipe_gesture` (by design), all shadow collections, `icpData/{uid}`, `users.scoutData`, `reconProfile/section0` beyond its page, onboarding transcript | [V] |
| Reserved but unwritten | `exclusions` (reader only) | [V] |
| Shadow/dark | `icpRelationships`, `lineageEvents`, `criteriaVersions`, person relationships, cadence ICP stamp reads, `icpAttribution`, `relationship_events` (dry_run) | [V] |
| Production Gmail mode | `netlify.toml` sets `dry_run` only for branch/preview; production relies on the fail-safe default unless set in the Netlify UI | [V] code / [I] prod env |
| Legacy vs new conflict | `onboardingComplete` (flag) vs `onboarding.completed` (old flow) both gate `SmartRedirect` (`App.jsx:317`) | [V] |

---

## 6. PROPOSED CANONICAL JOURNEY

One route (`/barry`) owns the first session. It hands off to existing canonical surfaces (`/contact/:id`, Daily Discoveries, Mission Control) and brings the customer back with one progress model.

**Define.** *Backbone:* `/barry` First Experience with embedded `BarryOnboarding` + `TargetingProposal`.
Preserved from elsewhere: the 3-step progress idea from standalone `BarryOnboarding` (rebuilt as the five-stage journey rail); the saved-ICP summary card; the website accelerator offered first; refine mode for returning users (fixed).
Change: on confirm, also write the transcript summary into Recon §1 (Barry doesn't re-ask); copy no longer names Scout or Hunter.

**Discover.** *Backbone:* `search-companies` with the confirmed `icpId` (already true).
Preserved: MC `FirstRunView` narration lines and progress list, rendered in-thread while `barryState==='SEARCHING'`. The MC first-run view becomes redundant for `/barry` users.

**Decide.** *Backbone:* Daily Discoveries decision logic, extracted into a shared module (company accept/reject/skip + persona people discovery + shadow events).
Preserved: the in-thread results card presentation (top 5, filtered to `icpId`), with `fit_reasons`/`barry_intel` instead of a bare number; save toast and undo from DailyLeads. "Review the rest" hands off to Daily Discoveries.

**Engage.** *Backbone:* canonical contact page `/contact/:id` (`ContactProfile` → `InlineEngagementSection` → `generate-engagement-message` → `executeSendAction`).
Preserved: in-thread people card after Accept (from the auto-discovery the shared module fires); Context by Barry (fed the ICP + persona); inline Gmail connect with `returnTo`; send guard; arrival banner explaining "you approved Acme under *My ICP*".
Change: the drafter receives `icpId` and reads the ICP persona/messaging + Recon §1.

**Follow up.** *Backbone:* `executeSendAction` post-send state + Mission Control recommendations.
Preserved: a confirmation that the send was recorded; the 3-day follow-up due date surfaced as "Next: follow up with Dana on Thu"; later (post-live) `BarryReplyCard`.
Honest scope today: "follow-up state reached" = `hunter_status:'awaiting_reply'` + `next_step_due` set after a real Gmail send.

---

## 7. REUSE / IMPROVE / MERGE / REDIRECT / HIDE / DEPRECATE

| Piece | Action |
|---|---|
| `/barry` · `BarryWorkspace` FE | **Reuse**. Fix the FE gate to use derived journey state instead of `onboardingComplete` |
| `BarryOnboarding` (embedded) | **Reuse** |
| `BarryOnboarding` standalone mode + `FirstExperience.jsx` | **Deprecate** (keep code; unreachable). Port the progress bar concept first |
| `TargetingProposal`, website accelerator, `firstValueRouting` | **Reuse** |
| `firstExperienceMode` refine | **Improve**: make it reachable (pass arrival via query/state straight to `/barry`; don't gate on `onboardingComplete`) |
| `CompanyResultsCard` | **Improve**: call the shared decision module; filter by `icpId`; show reasons |
| `DailyLeads.handleSwipe` + People-mode decision code | **Merge** into a shared decision module; DailyLeads calls it. Update the T-12 allowlist (D3) |
| MC `handleApprove`, `CompanyDetail` approve | **Merge** onto the shared module |
| MC `FirstRunView` | **Consolidate**: copy/progress move into `/barry`; view kept as fallback for legacy `onboardingSource` users |
| `generate-engagement-message` | **Improve**: accept `icpId`; read ICP persona/messaging + Recon §1 |
| `barryGenerateContext` | **Improve**: accept ICP context |
| `/getting-started` | **Redirect** → `/barry`; repoint the welcome email |
| `/questionnaire`, `/icp`, `/icp-brief`, `/companies`, `/old-scout`, `/add-company`, `/lead-review`, `/old-dashboard` | **Redirect** → `/barry` (ICP ones) or `/mission-control-v2`. Keep components for rollback |
| `/mission-control-v2/recon[...]` | **Redirect** → `/recon[...]`; fix the three `navigate('/mission-control-v2/recon')` calls |
| `ReconOnboardingWizard`, `OnboardingStep`, `ImprovedScoutQuestionnaire`, `CompanyQuestionnaire`, `ScoutDashboardPage` import | **Deprecate** (unreachable). Delete in a later pass |
| `useOnboardingState` step flags / `markStep` | **Deprecate** in favor of `deriveJourneyState`. Keep reading `onboarding.completed` for historical users |
| Recon Section 0 | **Hide** from first session; feed its output into drafting later |
| Sidebar during first session | **Hide** until first send (D2); already hidden during FE |

---

## 8. EXISTING-USER MIGRATION BEHAVIOR

Progress = `deriveJourneyState(uid)`, read-only over authoritative legacy state. No new flags.

| User has | Derived state | True next step |
|---|---|---|
| Nothing | `define` | `/barry` begin |
| `barryConversations/icp` in progress | `define` (resume) | `/barry` resumes (already implemented) |
| Active ICP, no accepted companies | `decide` | Results card for that ICP, or Daily Discoveries |
| ICP, no active flag (`none-active`) | `define` (choose) | Barry asks which ICP to use; never auto-promotes (`resolveActiveIcp` contract) |
| Legacy-only ICP data (`icpData`, `users/{uid}/icp`, `scoutData`, bridge without `icpProfiles`) | `define` (refine) | Barry opens refine mode **pre-filled** from the legacy answers as a proposal. The user confirms, which creates `icpProfiles` through the normal confirm path |
| Partial Recon | unaffected | Recon isn't a first-session gate |
| Accepted companies, no contacts | `engage` (people) | People at the most recent accepted company |
| Contacts, Gmail not connected | `engage` (connect) | Inline Gmail connect on first draft |
| Gmail connected, no `message_sent` with `method:'real'` | `engage` (send) | Draft for the top contact |
| Cadence enrollment or sends | `followup` | Mission Control recommendations |
| Relationship state (post-live) | `followup` | Reply card |

Historical answers are **proposed, never silently promoted**. That matches the Tier 1 rule that only a confirmation creates an ICP (`BarryOnboarding.jsx` confirm comment). `SmartRedirect` keeps honoring `onboardingComplete || onboarding.completed` for routing until `deriveJourneyState` replaces it, so no existing user is sent back through onboarding.

---

## 9. WORK-IN-FLIGHT COLLISIONS AND REUSE POINTS

| System | Uses now | Writes now | Can't read yet | Depends on cutover | Duplication risk if done wrong |
|---|---|---|---|---|---|
| ICP relationship layer | — | Yes, via shared decision module | Yes (T-12) | Yes, for "why" UI | A screen-local `approvedForIcp` field |
| Criteria versions | — | Yes (lazy) | Yes | Yes | A "snapshot" copy on companies |
| Multiple ICPs | `resolveActiveIcp`, `resolveSearchIcp` | — | Relationship-based membership | Yes | Stale PRs #405, #432 |
| Daily Discoveries | Backbone for Decide | Yes | — | No | A second swipe/approve implementation |
| Company ↔ ICP | Legacy `icpId`/`swipedForICPId` | Shadow | Yes | Yes | Writing `icpId` on accept (it's the discovery stamp, per `fc2a81f`) |
| Person ↔ ICP | — | Shadow (2 paths → via shared module) | Yes | Yes | `icpId` on contact docs |
| Cadence/engagement | Bulk ICP stamp | Yes | Attribution | Yes | A new enrollment schema for single sends; extend the existing stamp instead |
| Gmail integration | Connect + send | Yes | — | No | — |
| Relationship events | — | Only via the ADR-006 writer | Dry-run | `live` | Any first-session "replied" flag |
| Reply attribution | — | No (derived) | Yes | Yes + live | A stored attribution field |
| Barry context | Chat stack reads ICP | Recon §1 on confirm | — | No | A new "onboarding context" doc; use Recon §1 |
| Lineage events | — | Yes | Yes | Yes | Analytics events used as lineage (keep them separate) |

---

## 10. EFFORT

| Item | Size |
|---|---|
| Review-ICP arrival + refine gate fix | S |
| Shared company/person decision module (extract + 4 call sites + allowlist + tests) | M |
| Results card: ICP filter + reasons | S |
| In-thread people card after accept | M |
| `deriveJourneyState` + journey progress rail | M |
| Narration copy into thread | S |
| Drafter reads ICP + Recon §1; Context by Barry reads ICP | S–M |
| Transcript → Recon §1 on confirm | S |
| Inline Gmail connect on contact page | S |
| Instrumentation events | S |
| Redirects / copy / welcome-email link | S |
| Send-level ICP stamp on one-off sends (after D4) | M |

**Experience YES / Implementation NO: 8 items**

| # | Item | Size |
|---|---|---|
| 1 | Refine mode ("Review ICP with Barry") | S |
| 2 | Journey progress indicator (Laura-driven 3-step bar) | M |
| 3 | Narrated search progress (MC FirstRunView) | S |
| 4 | In-thread results + Accept card | M |
| 5 | Daily Discoveries decision logic (location) | M |
| 6 | ICP-persona people auto-discovery (reachability) | (in 5) |
| 7 | Context by Barry (inputs) | S |
| 8 | Onboarding progress flags → derived state | M |

Hidden cost sits in #5/#6. `DailyLeads.jsx` is 3,446 lines, the decision path carries a double-fire guard, undo semantics, and shadow-write ordering invariants (I-11: legacy first), and `icpShadowWrites`, `icpPersonLineage` and `companySkipCycleGuard` tests all pin it.

---

## 11. NOT-IN-FIRST-SESSION LIST

| Item | Why not now |
|---|---|
| Scout+ (CSV, business card, LinkedIn link, Find Contacts) | Secondary discovery. Those paths carry no ICP by design. OBS: Aaron verbally flagged CSV/business card as rough |
| Total Market | Analysis, not activation |
| Game Mode (`/scout/game`) | Needs a contact backlog |
| Cadences / bulk compose | Power workflow; one send first |
| Hunter missions, Go To War, Sniper, Basecamp, Reinforcements, Fallback | Module concepts; relationship depth after activation |
| Recon §2–§10, Section 0, Alignment Brief, Barry Training | Deepens Barry; not needed for first value |
| Multi-ICP creation | D6; gated reads |
| ICP Settings raw form | Barry refine covers it |
| Command Center tabs, admin tools | Post-activation |

---

## 12. INSTRUMENTATION / ACTIVATION FUNNEL

**Activation window: 24 hours from `users.paymentCompletedAt`** (written by `CheckoutPage.jsx:95` / `stripe-webhook.js:100` [V]). "Same session" can't be measured: `analytics_events` carry no session id (`analytics.js`) [V]. "Same browser session" isn't persisted. Report 72h as a secondary cut.

**Activated** = a `message_sent` timeline event with `metadata.method==='real'` and `sendResult==='sent'` inside the window, to a contact whose company is `accepted`, with an active ICP resolved at send.

| Stage | Available today? | Tag | Reliable? | Missing | Recommended event |
|---|---|---|---|---|---|
| ICP created | `targeting_confirmed` event; `icpProfiles.createdAt` (ISO) | [V] | Yes | — | reuse |
| Company approved | `companies.status/swipedAt/approvedAt` (inconsistent); `lineageEvents` DailyLeads only | [V] | **No**: 4 writers, 3 timestamp shapes | analytics event | `company_approved {surface, has_icp}` from the shared module |
| Person selected | People-tab shadow decision; `engagementPromotionPatch` on first engage | [V] | Partial | explicit event | `person_selected {surface, source}` |
| Gmail connected | `integrations/gmail.connectedAt/status` | [V] | Yes (current state; reconnects overwrite) | event | `gmail_connected {surface}` |
| Message reviewed | `message_generated` timeline on 3 surfaces; review itself not recorded | [V] | **No** | event | `message_reviewed` at `explicitSend===true` in `assertSendable` callers |
| Message sent | `timeline.message_sent` (`method`, `sendResult`), `email_logs`, `contacts.last_sent_at` | [V] | Yes, with `method==='real'` | first-send marker | `first_send` (derived is fine) |
| Follow-up state reached | `hunter_status:'awaiting_reply'` + `next_step_due` | [V] | Yes, as "awaiting reply". **Not** reply-driven | — | none now. Post-live: `relationship_events` `inbound_reply` |

The funnel queries need per-user subcollection reads (`analytics_events`, contact `timeline`) via collection-group queries. Index needs are [I].

---

## 13. SEQUENCING

| Step | Supported today? | Depends on | Throwaway if done now? | Minimum genuinely new | Label |
|---|---|---|---|---|---|
| Define | **Yes** | — | No | Refine fix; transcript → §1; copy | **SHIP NOW** |
| Discover | **Yes** | — | No | Narration in thread | **SHIP NOW** |
| Decide | **Partially** (lineage only on DailyLeads) | D3 approval | No: it writes to the approved shadow model | Shared decision module; results card changes | **SHIP NOW** |
| Decide: "why, under which criteria version" | No | Sprint 3 read cutover beyond Stage 1 | **Yes**, if built on legacy `fit_score` | — | **SHIP AFTER DEPENDENCY** |
| Engage | **Partially** (drafter lacks ICP) | D4 | Small: reading `company.swipedForICPId ‖ icpId` is legacy, swapped for relationship reads after cutover | In-thread people card; drafter input; inline Gmail | **SHIP NOW** |
| Engage: send-level ICP on one-off sends | No | D4 + stamp design | Yes, if a new schema is invented | Reuse the enrollment stamp shape | **SHIP AFTER DEPENDENCY** |
| Follow up (awaiting reply + next step) | **Yes** | — | No | Next-step surfaced in thread/MC | **SHIP NOW** |
| Follow up (reply-driven) | No | `GMAIL_IDENTITY_MODE=live` | Yes | — | **PRESERVE EXPERIENCE / DO NOT IMPLEMENT YET** |

---

## FINAL ACCEPTANCE CHECK

- **Simpler than today:** one entry route, zero module names before first send, one progress model derived from state, and about 12 legacy routes redirected.
- **Richer than any single onboarding today:** it combines the targeting proposal, website reading, narrated discovery, reasoned approval, auto-found people with Barry's why, an ICP-aware draft, a guarded Gmail send, and a recorded follow-up. No current flow goes past discovery.
- **Uses approved systems:** writes go through Sprint 1–2 shadow paths, nothing reads shadow before cutover, reply truth stays with ADR-006, and no parallel stores are created.
