# Barry OS Implementation Plan

**Idynify · Document 5 of 5 · Team B**
**Date: 2026-08-11**
**Repository: aepwiley13/idynify-scout**
**Source of Truth: docs/audits/BARRY_OS_FOUNDATION_AUDIT.md (canonical audit — pinned to commit 09e90f9)**
**Discovery Authority: docs/audits/BARRY_OS_AUDIT_RECONCILIATION.md**
**Infrastructure Baseline: FIRESTORE_DATA_ARCHITECTURE.md**

---

## Governance

This document translates the architecture established in Documents 1–4 into a phased, testable build sequence. It does not invent architecture.

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
Capability Contracts        ← Document 4 — FROZEN 2026-08-11
        ↓
Implementation Plan         ← THIS DOCUMENT — build sequence
```

The architecture freeze rule is in force. Documents 1–4 are frozen. This document derives from them — it may reference, sequence, and schedule their defined contracts. It may not redefine objects, lifecycle states, signal contracts, capability contracts, or ownership boundaries.

**What this document defines:**
- The phased build sequence P1 through P12
- A parallel Infrastructure Track (I1–I4)
- Definition of Ready and Definition of Done for every phase
- Exit Gate / Stop Condition for every phase
- Rollout Mode for every migration-heavy phase
- The dependency graph between phases and infrastructure items
- The complete migration matrix
- The RECON execution model decision gate
- Known risks per phase with mitigation strategies

**What this document does NOT define:**
- Object schemas — Document 2
- Signal contracts — Document 3
- Capability contracts — Document 4
- New architectural decisions

---

## Phase Completion Invariant

**Merged ≠ complete.**

A phase is complete only when its Definition of Done is demonstrated with evidence in the target environment. Code merged to main is a necessary condition, not a sufficient one. A phase that cannot demonstrate its Definition of Done does not unlock the next phase.

This invariant applies to every phase in both tracks. The Exit Gate field on each phase specifies what evidence constitutes proof.

---

## Evidence Status Taxonomy

Every migration matrix entry and current-state count must be classified:

```
CONFIRMED CURRENT      Verified on current main (commit or grep evidence)
CONFIRMED HISTORICAL   Verified by audit/reconciliation, may have changed
TARGET                 Desired Barry OS end state
PENDING BASELINE       Dependent on August 17 baseline report evidence
```

Audit counts (38 endpoints, 47 surfaces, 6 stores) are planning baselines from the canonical audit — not automatically current-repository facts. Document 5 uses them as CONFIRMED HISTORICAL unless independently re-verified.

---

## Evidence Levels

```
CONFIRMED   Verified in the canonical audit or reconciliation at a specific file or line.
PROPOSED    A new architectural recommendation not present in the codebase today.
PENDING     Awaiting confirmation. Use sparingly.
```

---

## Dual-Track Structure

Barry OS implementation runs on two parallel tracks. The Barry OS Track (P1–P12) builds the runtime. The Infrastructure Track (I1–I4) addresses platform-level prerequisites that exist independent of Barry OS.

```
Barry OS Track:     P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8 → P9 → P10 → P11 → P12

Infrastructure Track:
  I1 — Legacy model migration (LEGACY_SONNET_4_5 — 8 modules, floor ~2026-09-29)
  I2 — Netlify Modern Functions migration (deadline: 2027-07-01)
  I3 — Firebase telemetry retention, indexing, environment isolation
  I4 — Stripe preview isolation (live Payment Links in client bundle)
```

Infrastructure items are not Barry OS phases. They may block specific Barry phases. They may run in parallel with others. Each has its own Definition of Ready and Definition of Done.

---

## Baseline Gate

P1 start is gated on the August 17, 2026 baseline report review. No Barry OS implementation phase begins until Aaron reviews the baseline report.

The baseline report will include:
- Seven-day production telemetry with `environment: production`
- Dead endpoint verification (`generate-icp-brief`, `generate-all-reports`) — defect A5-b
- Provider lifecycle re-verification (`claude-sonnet-4-5-20250929`)
- `FIRESTORE_DATA_ARCHITECTURE.md` complete

**Baseline authority:** The baseline report can alter readiness status, sequencing risk levels, blocker status, and migration item evidence. It cannot redefine frozen Documents 1–4. Any baseline finding that appears to conflict with a frozen document must be raised through the Architecture Freeze Rule — not resolved by changing Document 5 unilaterally.

**Model migration gate:** The eight `LEGACY_SONNET_4_5` modules have a floor date of approximately 2026-09-29. Provider lifecycle re-verification (Team A's August 17 deliverable) determines whether this migration is a hard pre-P1 gate or an I1 infrastructure item running parallel to early Barry phases. Document 5 does not assume the outcome before the verification result arrives.

---

# Infrastructure Track

Infrastructure workstreams that run in parallel with P1–P12 and may block specific Barry OS phases.

---

## I1 — Legacy Model Migration

**Goal:** Migrate all endpoints from `LEGACY_SONNET_4_5` and `LEGACY_HAIKU_4_5` to their assigned policy tiers (`MODEL_DEEP` or `MODEL_FAST`).

**Primary dependency:** Provider lifecycle re-verification (Team A, August 17 baseline)

**Definition of Ready:**
- Provider lifecycle re-verified for all three active model identifiers (BO-006)
- Baseline telemetry available to establish per-endpoint latency and token baselines
- Model tier assignment per Skill confirmed (Document 4, Part IX)

**Definition of Done:**
- Zero imports of `LEGACY_SONNET_4_5` remain in `netlify/functions/`
- Zero imports of `LEGACY_HAIKU_4_5` remain in `netlify/functions/`
- All 18 affected endpoints route through `MODEL_FAST` or `MODEL_DEEP` only
- Latency and token usage compared against baseline — no regression > 20%
- `LEGACY_SONNET_4_5` and `LEGACY_HAIKU_4_5` constants deleted from `models.js`

**Exit gate:** `grep -r LEGACY_ netlify/functions/ --include='*.js'` returns zero matches (excluding `models.js` if constants not yet deleted). Production telemetry confirms all endpoints on policy-tier models.

**Rollout mode:** immediate — model constant swap is a one-line change per endpoint, env-overridable via `BARRY_MODEL_FAST` / `BARRY_MODEL_DEEP`

**Affected endpoints (CONFIRMED CURRENT):**

| Constant | Module | Target Tier |
|---|---|---|
| `LEGACY_SONNET_4_5` | `barryValidateContact.js` | MODEL_DEEP (interim — deleted at P4 per R4-004) |
| `LEGACY_SONNET_4_5` | `generate-engagement-message.js` | MODEL_DEEP (interim — deleted at P4) |
| `LEGACY_SONNET_4_5` | `barryGenerateContext.js` | MODEL_DEEP |
| `LEGACY_SONNET_4_5` | `barryGenerateMissionSequence.js` | MODEL_DEEP |
| `LEGACY_SONNET_4_5` | `barryGenerateSequenceStep.js` | MODEL_DEEP |
| `LEGACY_SONNET_4_5` | `barryICPConversation.js` | MODEL_DEEP |
| `LEGACY_SONNET_4_5` | `generate-campaign-messages.js` | MODEL_DEEP |
| `LEGACY_SONNET_4_5` | `generate-followup.js` | MODEL_DEEP |
| `LEGACY_HAIKU_4_5` | `barryMissionChat.js` | MODEL_FAST |
| `LEGACY_HAIKU_4_5` | `barryOrientationBrief.js` | MODEL_FAST |
| `LEGACY_HAIKU_4_5` | `barryReconInterview.js` | MODEL_FAST |
| `LEGACY_HAIKU_4_5` | `barryReconSection0.js` | MODEL_FAST |
| `LEGACY_HAIKU_4_5` | `barryFirstTouch.js` | MODEL_FAST |
| `LEGACY_HAIKU_4_5` | `barryHunterCardRead.js` | MODEL_FAST |
| `LEGACY_HAIKU_4_5` | `barryHunterProcessEngage.js` | MODEL_FAST |
| `LEGACY_HAIKU_4_5` | `barryActions.js` | MODEL_FAST |
| `LEGACY_HAIKU_4_5` | `barryBulkPersonalize.js` | MODEL_FAST |
| `LEGACY_HAIKU_4_5` | `barryHunterGenerateStep.js` | MODEL_FAST |

**Barry phases blocked:** None directly. P4 (Skills Registry) assumes policy-tier models are in use.

**Barry phases parallel to:** P1, P2, P3

**Risk if deferred:** Provider retires `claude-sonnet-4-5-20250929` on or after 2026-09-29. Eight endpoints would begin failing. `LEGACY_HAIKU_4_5` floor is 2026-10-15 — ten more endpoints at risk ~2 weeks later.

**Estimated scope:** LOW — routing is centralized in `models.js`, each endpoint is a one-import change.

---

## I2 — Netlify Modern Functions Migration

**Goal:** Migrate all Netlify Functions from Lambda compatibility mode to the modern runtime before the July 1, 2027 deadline.

**Primary dependency:** RECON execution model decision (Migration Blocker — see RECON Decision Gate below)

**Definition of Ready:**
- RECON execution model decision made by Aaron
- Baseline telemetry confirms which 900s-timeout functions are actively invoked
- Modern runtime compatibility audit complete for all functions

**Definition of Done:**
- All Netlify Functions deploy and execute under the modern runtime
- No `netlify.toml` `[functions.*] timeout` entries exceed 60 seconds for synchronous functions
- RECON generators operate under their selected execution model
- No Lambda-specific APIs used (`event.httpMethod` → `request.method`, etc.)

**Exit gate:** Deploy succeeds under modern runtime flag. All functions that currently have custom timeouts verified against actual execution time in production telemetry. RECON generators confirmed operating under selected model.

**Rollout mode:** feature-flag — Netlify supports per-function runtime selection during migration. Individual functions can be migrated incrementally.

**Affected functions with custom timeouts (CONFIRMED CURRENT):**

| Function | Configured Timeout Ceiling | Risk |
|---|---|---|
| `generate-icp-brief` | 900s (explicit) | HIGH — RECON |
| `generate-all-reports` | 900s (explicit) | HIGH — RECON |
| `generate-section-1` | 900s (explicit) | HIGH — RECON |
| `generate-section-2` | 900s (explicit) | HIGH — RECON |
| `generate-section-3` through `generate-section-10` (8 functions) | No explicit timeout configured; platform runtime default governs | HIGH — RECON |
| `generate-leads` | 900s | MEDIUM |
| `generate-leads-v2` | 900s | MEDIUM |
| `daily-leads-refresh` | 900s | MEDIUM |
| `process-barry-queue` | 900s | MEDIUM |
| `process-scheduled-engagements` | 900s | MEDIUM |
| `process-barry-inbox-queue` | 300s | MEDIUM |
| `gmail-sync-worker` | 300s | MEDIUM |
| `adminGetUsers` | 26s | LOW |
| `barryBulkPersonalize` | 26s | LOW |
| `analyze-website` | 26s | LOW |

**Barry phases blocked:** RECON generator Barry OS capability disposition is deferred until the execution model decision is made. P4 executes the 28 R4-002 dispositions independently; RECON generators are not assigned to any Skill until the Migration Blocker is resolved.

**Barry phases parallel to:** P1, P2, P3. Non-RECON functions can migrate independently.

**Risk if deferred:** Lambda compatibility mode deadline is July 1, 2027. All deployments rejected after that date. ~11 months from baseline start.

**Estimated scope:** HIGH — 20+ functions with custom timeouts, Lambda API compatibility changes, RECON execution model change affects user experience.

---

## I3 — Firebase Telemetry Retention, Indexing, and Environment Isolation

**Goal:** Establish retention policies, composite indexes, and environment isolation for the `apiLogs` telemetry system.

**Primary dependency:** Baseline telemetry confirms production write volume

**Definition of Ready:**
- Seven-day baseline telemetry collected with `environment: production`
- `BARRY_ENV` confirmed in Functions scope (CONFIRMED CURRENT — complete 2026-08-10)
- Write volume and query patterns documented from baseline
- `FIRESTORE_DATA_ARCHITECTURE.md` complete

**Definition of Done:**
- Composite indexes declared in `firestore.indexes.json` for `(endpoint, timestamp desc)`, `(userId, timestamp desc)`, `(environment, timestamp desc)` — per `FIRESTORE_DATA_ARCHITECTURE.md`
- TTL or retention policy defined and enforced on `apiLogs`
- `adminGetApiLogs.js` projection expanded to include `provider`, `model`, `inputTokens`, `outputTokens`, `traceId` — per `FIRESTORE_DATA_ARCHITECTURE.md` known gap
- Historical pre-cutover rows (all `environment: "dev"`) documented as non-comparable

**Exit gate:** `adminGetApiLogs` returns complete telemetry fields. Index performance verified under production query patterns. Retention policy active.

**Rollout mode:** immediate — indexes and projection changes are additive.

**Barry phases blocked:** None directly. P5 (Think Layer) depends on complete telemetry for reasoning trace observability.

**Barry phases parallel to:** P1, P2, P3, P4

**Risk if deferred:** Unbounded `apiLogs` growth. Incomplete telemetry projection makes cost and model reporting impossible through the only reader.

**Estimated scope:** LOW

---

## I4 — Stripe Preview Isolation

**Goal:** Prevent live Stripe Payment Links from being accessible in deploy-preview and branch-deploy contexts.

**Primary dependency:** None

**Definition of Ready:**
- Live Payment Links confirmed at `CheckoutPage.jsx:70-74` (CONFIRMED CURRENT)
- `BARRY_ENV` available in client context (or alternative environment detection)

**Definition of Done:**
- Deploy-preview and branch-deploy contexts do not render live Stripe Payment Links
- Production context renders live Payment Links as today
- No test payment can be initiated from a preview URL

**Exit gate:** Navigate to checkout on a deploy-preview URL. Verify no live Payment Link is reachable.

**Rollout mode:** immediate — environment-conditional rendering.

**Barry phases blocked:** None

**Barry phases parallel to:** All

**Risk if deferred:** A preview URL with live Payment Links can process real charges.

**Estimated scope:** LOW — environment-conditional rendering in one component.

---

# Barry OS Track

---

## P0A — Production Safety (COMPLETE)

**Status:** COMPLETE — shipped `ebf8313`

**Defects resolved:** A1 (send-once idempotency), A4 (inbox queue trigger), A6 (calendar outage), A7 (context failure), A8 (sync ceiling), A9 (collection isolation), A10 (fan-out cap)

---

## P0B — Observability + Cleanup (COMPLETE)

**Status:** COMPLETE

**Defects resolved:** A2 (telemetry attribution — production success verified 2026-08-08), A3 (auth header), A5 (dead call sites removed), A11 (usage counter race), A13 (model centralization — `models.js` created)

---

## P1 — Signal Bus

**Goal:** Establish the canonical event transport for all Barry OS state changes, replacing direct module-to-module calls with a signal-driven architecture.

**Primary dependency:** Baseline report reviewed by Aaron. P0B complete.

**Architectural debt retired:** A12 (`barry_intel` on company docs — Law 5 breach), A15 (inbox queue throughput ceiling), `timelineLogger`/`engagementHistoryLogger` split. Gap B-001 (relationship bounce blind spot) — producer adapter scheduled.

**Definition of Ready:**
- August 17 baseline report reviewed and approved by Aaron
- Current production Firebase project confirmed: single project `idynify-scout-dev`, shared environments (CONFIRMED CURRENT — `FIRESTORE_DATA_ARCHITECTURE.md`)
- `BARRY_ENV` variable confirmed in Functions scope (CONFIRMED CURRENT — complete 2026-08-10)
- Signal bus Firestore path approved through `FIRESTORE_DATA_ARCHITECTURE.md`
- Workspace ownership boundary defined (Document 3, signal envelope)
- Signal idempotency contract defined (Document 3 — FROZEN)
- Signal envelope format approved (Document 3, §Signal Envelope — FROZEN)
- Producer rules defined (Document 3, §Producer Rules — FROZEN)
- Retention and replay rules defined (Document 3, §Retention — FROZEN)

**Definition of Done:**
- Signal bus Firestore listener operational in production
- At least one signal type emitting in production (candidate: `contact.reply_received` — highest-frequency signal, powers ProcessReplyWorkflow)
- Signal envelope validated against Document 3 contract
- Idempotency enforced — duplicate signals rejected
- `barry_intel` writes removed from canonical company documents (A12)
- Gap B-001 scheduled: relationship-email delivery adapter design complete, implementation deferred to P1 delivery (requires Gmail bounce/delivery status API investigation)
- Existing `timelineLogger` and `engagementHistoryLogger` write paths migrated to signal emission

**Exit gate:** Production telemetry shows signals being emitted and consumed. Signal replay produces the same Observations from the same signals. A12 violation no longer present on main.

**Rollout mode:** dual-write — existing module calls continue alongside new signal emissions during transition. Old paths are retired per-module as signal consumers prove equivalent behavior.

**Migration items:**
- `timelineLogger` → signal emission (CONFIRMED HISTORICAL — reconciliation §9)
- `engagementHistoryLogger` → signal emission (CONFIRMED HISTORICAL — reconciliation §9)
- Gmail adapter design for `contact.email_bounced` (Gap B-001 — Document 4)

**Infrastructure requirements:**
- New Firestore path for signal bus (must route through `FIRESTORE_DATA_ARCHITECTURE.md`)
- Firestore security rules for signal bus path

**Known risks:**
- Signal bus write volume under production load unknown until baseline (PENDING BASELINE)
- Gmail bounce/delivery status API capabilities may be limited — adapter scope dependent on API investigation

**Estimated scope:** HIGH

---

## P2 — Context Resolver

**Goal:** Replace nine competing context assembly implementations with a single server-side context resolver that operates within a defined context budget.

**Primary dependency:** P1 complete and signal bus writing to production

**Architectural debt retired:** Nine context implementations consolidated (reconciliation §2.3 / §6). `barryContextStack`'s 500-contact client-side payload eliminated. `reconCompiler` drift resolved. A16 (`CompanyPage.jsx:46` raw sessionKey).

**Definition of Ready:**
- P1 complete — signal bus operational
- Nine competing context implementations identified: `barryContextStack`, `assembleBarryContext`, `barryContextAssembler`, `barryGenerateContext`, `BarryContext.jsx`, `reconCompiler` (context portion), `buildContextStack`, `getCalendarContext`, `getGmailContext` (CONFIRMED HISTORICAL — reconciliation §2.3, Document 1 §Context Resolver)
- Canonical domain model approved (Document 2 — FROZEN)
- Six memory boundaries approved (Document 2, §Memory — FROZEN)
- Awareness/context boundary defined (Document 1, §5 — FROZEN; reconciliation §5 — permanently preserved)
- Context budget contract approved (Document 4, Part VI)
- Failure/degradation behavior approved (A6, A7 resolved in P0A)

**Definition of Done:**
- Single server-side context resolver operational
- All nine previous context paths route through the resolver
- Context budget enforced — no single resolution exceeds defined token limit
- Client-side context assembly eliminated (no 500-contact payload)
- Degradation behavior preserves P0A fixes: calendar outage reported (not hidden), context failure reported (not silenced)
- A16 fixed — `CompanyPage.jsx:46` uses structured `barrySessionKey` object

**Exit gate:** Production telemetry shows all context resolution routing through the single resolver. No client-side `barryContextStack` calls observed. Context budget violations logged (zero in steady state).

**Rollout mode:** shadow — new resolver runs alongside existing implementations, outputs compared. Cutover per-surface once parity demonstrated.

**Migration items:**
- `barryContextStack` → context resolver (CONFIRMED HISTORICAL)
- `assembleBarryContext` → context resolver (CONFIRMED HISTORICAL)
- `barryContextAssembler` → context resolver (CONFIRMED HISTORICAL)
- `barryGenerateContext` → context resolver (CONFIRMED HISTORICAL)
- `BarryContext.jsx` → context resolver (CONFIRMED HISTORICAL)
- `reconCompiler` context portion → context resolver (CONFIRMED HISTORICAL)
- `buildContextStack` → context resolver (CONFIRMED HISTORICAL)
- `getCalendarContext` → context resolver (CONFIRMED HISTORICAL)
- `getGmailContext` → context resolver (CONFIRMED HISTORICAL)

**Infrastructure requirements:**
- Server-side context resolver function
- Context budget configuration

**Known risks:**
- Client-side context assembly may serve latency purposes that server-side resolution cannot match — requires measurement during shadow phase
- Nine implementations may have subtle behavioral differences that surface only in production

**Estimated scope:** HIGH

---

## P3 — Awareness Projections

**Goal:** Establish signal-driven Awareness projections (Relationship Awareness, Business Awareness) that replace computed-on-read patterns with maintained state.

**Primary dependency:** P1 (signals as input), P2 (context resolver provides single input path)

**Architectural debt retired:** Five duplicate business-awareness computations eliminated (reconciliation §9). Awareness confirmed signal-driven, not request-driven (reconciliation §5.2 — permanently enforced).

**Definition of Ready:**
- P1 complete — signals emitting
- P2 complete — context resolution unified
- Awareness projections are signal-driven, not request-driven (reconciliation §5.2, Document 1 §5 — this is a standing constraint, not a design choice)
- Staleness contract approved (Document 2 — FROZEN)
- Awareness projection schemas approved (Document 2 — FROZEN)

**Definition of Done:**
- Relationship Awareness projection computed from signals, not on-demand
- Business Awareness projection computed from signals, not on-demand
- Staleness contract enforced — projections carry `last_updated` and are re-computed when stale
- Five duplicate business-awareness computations eliminated
- Projections readable by Skills (P4 prerequisite)

**Exit gate:** Awareness projections updated within staleness window after signal emission. No on-demand computation paths remain. Production telemetry confirms projection freshness.

**Rollout mode:** shadow — new projections computed alongside existing on-demand patterns. Outputs compared for parity.

**Migration items:**
- Duplicate business-awareness computations (5 paths) → single signal-driven projection (CONFIRMED HISTORICAL — reconciliation §9)

**Infrastructure requirements:**
- Firestore paths for Awareness projections (must route through `FIRESTORE_DATA_ARCHITECTURE.md`)
- Signal bus listeners for Awareness-relevant signal types

**Known risks:**
- Projection staleness window sizing requires production signal volume data (PENDING BASELINE)

**Estimated scope:** MEDIUM

---

## P4 — Skills Registry

**Goal:** Consolidate the 28 AI endpoints with R4-002 dispositions into 15 named Skills with standardized contracts, model tier compliance, and registry-based invocation. RECON generators (12 endpoints) are excluded — their Barry OS capability disposition is deferred pending the RECON Migration Blocker decision.

**Primary dependency:** P2 (context resolver), P3 (awareness projections readable). I1 (model migration) should be complete — all endpoints on policy tiers.

**Architectural debt retired:** 28 R4-002 dispositions executed (Document 4, R4-002). Nine message generators → 1 (`WriteEmailSkill`). R4-004: `barryValidateContact` replaced with deterministic validation, `barryActions` intent parsing replaced with typed tool schemas. RECON generators excluded — see RECON Decision Gate.

**Definition of Ready:**
- P2 and P3 complete — context and awareness available to Skills
- All 15 Skills defined with contracts (Document 4, Part II — FROZEN)
- Two-model policy in place: `MODEL_FAST` and `MODEL_DEEP` (CONFIRMED CURRENT — `models.js`)
- I1 complete — all endpoints on policy tiers (or waived if LEGACY floor extended)
- `barryValidateContact` replacement logic specified (Document 4, R4-004 — deterministic field validation)
- `barryActions` typed tool schema specified (Document 4, R4-004 — 5 types plus `none`)

**Definition of Done:**
- 15 Skills registered and invocable through the Skills Registry
- Each Skill declares its model tier, deterministic flag, inputs, and outputs per Document 4 contracts
- `barryValidateContact` deleted — replaced by deterministic validation rules (Document 4, R4-004)
- `barryActions` intent parsing deleted — replaced by typed tool schemas (Document 4, R4-004)
- All 28 R4-002 dispositions (delete, refactor, absorb) executed
- Each Skill with `Deterministic: yes` verified to invoke no LLM (Law 20)

**Exit gate:** Skills Registry lists all 15 Skills. Each Skill invocable with its declared inputs, producing declared outputs. Zero direct calls to the 28 R4-002 absorbed/deleted endpoints remain. Production telemetry shows all AI invocations (excluding RECON generators pending disposition) routing through Skills.

**Rollout mode:** feature-flag — new Skills deployed alongside existing endpoints. Traffic shifted per-Skill once output parity confirmed. Old endpoints deleted after cutover.

**Migration items (from Document 4, R4-002 — CONFIRMED HISTORICAL):**

| Disposition | Count | Details |
|---|---|---|
| Delete | 12 | `barryOutreachMessage`, `barryFirstTouch`, `generate-engagement-message`, `generate-campaign-messages`, `barryBulkPersonalize`, `generate-followup`, `enrichCompany`, `enrichContact`, `barryHunterGenerateStep`, `barryGenerateSequenceStep`, `barryReconInterview`, `barryValidateContact` |
| Refactor | 15 | `barryHunterProcessEngage`, `barryEnrich` (2 paths), `analyze-website`, `barryICPConversation`, `assembleBarryContext`, `barryGenerateContext`, `barryDossierBriefing`, `nextBestStepService`, `process-barry-inbox-queue` (2 steps), `barryInboxAnalyzer`, `barry-coach-section`, `barryOrientationBrief`, `barryOutcomeAttribution` |
| Non-AI refactor | 1 | `barry-approve-send` → Action Executor handler (P6) |
| PROPOSED (new) | 4 | `ComposeLinkedInSkill`, `GenerateSubjectLineSkill`, `IdentifyObjectionsSkill`, `CategorizeFeedbackSkill` |

**Infrastructure requirements:**
- Skills Registry Firestore path (must route through `FIRESTORE_DATA_ARCHITECTURE.md`)
- Skill invocation telemetry extension

**Known risks:**
- 28 refactor/delete operations across production endpoints — high coordination risk
- PROPOSED Skills (4) have no existing implementation to validate against

**RECON generator disposition:**

```
Barry OS disposition: DEFERRED — RECON Migration Blocker

Infrastructure Track I2 owns the runtime/execution feasibility work
required to resolve the blocker. The RECON Decision Gate determines
the execution model. Only after that decision may the generators
receive their final Barry OS capability disposition through the
appropriate governance process.
```

The 12 RECON generators (`generate-section-1` through `generate-section-10`, `generate-icp-brief`, `generate-all-reports`) are not assigned to any Skill in P4. Document 4's R4-002 disposition table does not include them. The migration risk note in Document 4 Part X (RefineICPSkill) identifies the execution model dependency and states the generators "map to `RefineICPSkill`," but this does not appear in R4-002's binding disposition table. Their Barry OS capability assignment requires Aaron's execution model decision first, followed by a governance determination of the appropriate Skill mapping.

**Estimated scope:** HIGH

---

## P5 — Think Layer Promotion & Expansion

**Goal:** Extend `barryStrategyRecommender.js` to cover all 15 Skills (not just the current 4), persist `strategyScores`, and add cross-entity priority comparison as the missing fourth Think function.

**Primary dependency:** P3 (awareness inputs), P4 (Skills reach — all 15 Skills must be invocable)

**Architectural debt retired:** Think layer reaching 4 endpoints → all 15 Skills. Discarded `strategyScores` → persisted (Document 1, Section 4.6). Law 11 (explainable recommendations) satisfiable. BO-010: promotion, not creation.

**Definition of Ready:**
- P3 and P4 complete — awareness readable, all 15 Skills registered
- Reasoning trace store schema approved (reconciliation §9)
- `barryStrategyRecommender.js` confirmed as partial Think layer satisfying 3 of 4 functions (CONFIRMED HISTORICAL — reconciliation §4):
  - ✓ Contact-level strategy selection
  - ✓ Recency-weighted outcome attribution
  - ✓ Explainable reasoning with `reasons[]`
  - ✗ Cross-entity priority comparison — absent

**Definition of Done:**
- Think Layer routes all 15 Skills (not just the current 4)
- `strategyScores` persisted to Firestore, not discarded (Document 1, Section 4.6: "`strategyScores` — persisted, not discarded")
- Cross-entity priority comparison implemented — the fourth Think function
- Reasoning trace produced per invocation: signals → awareness → synthesis → recommendation
- Think Layer invariant enforced: no external side effects (Document 4, Part VII)
- Priority synthesis operational: Critical(0) > High(1) > Medium(2) > Low(3), with tie-breaking by urgency, health score, revenue potential (Document 4, Part VII)

**Exit gate:** Production telemetry shows Think Layer invocations across multiple Skill types. `strategyScores` documents present in Firestore with reasoning traces. Cross-entity comparison produces a priority-ordered queue when multiple recommendations compete.

**Rollout mode:** shadow — extended recommender produces reasoning traces and priority comparisons alongside existing behavior. Think Layer outputs compared to current `barryStrategyRecommender.js` for 4 existing paths; new paths are additive.

**Migration items:**
- `barryStrategyRecommender.js` → extended Think Layer (CONFIRMED HISTORICAL — reconciliation §4)
- `strategyScores` discard → persistence (CONFIRMED HISTORICAL — reconciliation §4.3)

**Infrastructure requirements:**
- Reasoning trace Firestore path (must route through `FIRESTORE_DATA_ARCHITECTURE.md`)
- Complete telemetry (I3 dependency — `provider`, `model`, `tokens` fields must be readable)

**Known risks:**
- Cross-entity priority comparison is the only entirely absent Think function — no existing logic to extend
- Reasoning trace storage volume under production load unknown (PENDING BASELINE)

**Estimated scope:** MEDIUM

---

## P6 — Capability Registry + Action Executor + Action Queue

**Goal:** Establish the Capability Registry that structurally enforces the generative/side-effect distinction, the Action Executor that preserves A1 idempotency across the `barry_drafts → prepared_actions` migration boundary, and the Action Queue.

**Primary dependency:** P5 (Think Layer emitting recommendations)

**Architectural debt retired:** `barryActions` prompt-based intent parsing (replaced at P4 per R4-004 — intent parsing only; the Gmail external-side-effect execution capability, currently implemented as `executeGmailSend` or its P4 successor, survives and migrates behind Action Executor at P6). Unguarded send paths. A14 residual risk (compound failure: Gmail succeeds, terminal writes fail). `barry_drafts → prepared_actions` migration.

**Definition of Ready:**
- P5 complete — Think Layer emitting recommendations with reasoning traces
- Capability manifest schema approved (Document 4, Part IV — FROZEN)
- A1 idempotency guarantee confirmed preserved across migration boundary (Document 4, Part V)
- Autonomy spectrum defined with Phase 1 ceilings (Document 4, Part IV): side-effect capabilities ceiling at Approval, generative capabilities at Prepare or below
- Every external side-effect path migrating behind Action Executor has a repository-verified stable logical-action identity (see Migration-Window Idempotency — Stable Cross-System Identity below). This includes the Gmail send capability (currently `barryActions.js:executeGmailSend` or its P4 successor), which remains reachable after P4 (R4-004 deletes intent parsing, not execution — see path inventory correction below)

**Definition of Done:**
- Capability Registry operational: all capabilities registered with type (generative/side_effect), autonomy ceiling, idempotency key requirements
- Phase 1 ceiling enforced structurally: no side-effect capability executes without Approval
- Action Executor operational with idempotency contract:
  - `idempotency_key` required for all side-effect capabilities
  - Write-once contract for Executed Action enforced
- A14 addressed: outbox or idempotent executor architecture handles the compound-failure case (Gmail succeeds, terminal writes fail)
- `barry_drafts` collection migrated to `prepared_actions`
- Action Queue operational
- **Migration-window idempotency demonstrated:** concurrent execution attempts through legacy (`barry_drafts.sending`) and new (Action Executor) paths for the same logical action cannot both produce an external side effect (see Migration-Window Idempotency below)

**Exit gate:** Side-effect capability invoked through Action Executor in production. Idempotency key prevents duplicate execution. `barry_drafts` collection empty or retired. A14 compound-failure scenario tested and handled. Migration-window concurrency acceptance condition passed (see below).

**Rollout mode:** dual-write then cutover — new `prepared_actions` written alongside `barry_drafts` during transition. A1 idempotency guarantee verified under dual-write before `barry_drafts` path retired.

**Migration items:**
- `barry_drafts` → `prepared_actions` (CONFIRMED HISTORICAL — reconciliation; Document 4, Part V)
- `barry-approve-send` → Action Executor handler (Document 4, R4-002)
- A14 residual risk remediation (defect register — accepted until P6)

**Infrastructure requirements:**
- `prepared_actions` Firestore path (must route through `FIRESTORE_DATA_ARCHITECTURE.md`)
- Action Queue Firestore path (must route through `FIRESTORE_DATA_ARCHITECTURE.md`)
- Capability Registry Firestore path (must route through `FIRESTORE_DATA_ARCHITECTURE.md`)
- Execution claims ledger Firestore path (temporary — migration-only; retired when legacy path cannot produce external side effect; must route through `FIRESTORE_DATA_ARCHITECTURE.md`) — see Migration-Window Idempotency

**Known risks:**
- `barry_drafts → prepared_actions` migration must preserve the A1 send-once guarantee — any gap enables double-sends to real customers (Critical)
- A14 outbox pattern adds a new abstraction — scope and complexity may exceed estimate

**Estimated scope:** HIGH

### Migration-Window Idempotency — G3-1

During the `barry_drafts → prepared_actions` dual-write coexistence window, two execution paths exist simultaneously:

- **Legacy path:** `barry-approve-send.js` claims execution via `barry_drafts.approvalStatus: 'sending'` (Firestore transaction on `users/{userId}/contacts/{contactId}/barry_drafts/{messageRecordId}`)
- **New path:** Action Executor claims execution via Executed Action `executing` state (Firestore transaction on `executed_actions/{idempotency_key}`)

These claims are in different Firestore collections. A Firestore transaction cannot atomically span both. Without a cross-path exclusion mechanism, two workers entering through different paths could both cause the external side effect (Gmail send) for the same logical action.

#### Temporary Migration Synchronization Mechanism

The execution claims ledger is a **temporary P6 migration synchronization mechanism** for the legacy `barry_drafts` → Prepared Action coexistence window. It exists solely to provide mutual exclusion while legacy and target execution paths coexist. It is subordinate to the target architecture defined in Document 4 and does not become a permanent Barry OS object or a third execution authority.

**Retirement condition:** The execution claims ledger is retired when no executable legacy `barry_drafts` path remains capable of producing an external side effect. Specifically: when `barry-approve-send.js` no longer calls `gmail.users.messages.send` through the legacy `barry_drafts` claim path, and no other legacy send function retains its pre-migration execution path, the ledger has no cross-path exclusion role and must be retired. After retirement, Executed Action (Document 4, Part V) is the sole execution claim authority. Retirement means the ledger ceases all execution-control behavior (authorize, veto, expire, recover) and becomes operationally inert — no code path consults it for execution decisions. Historical claim records may be retained solely for audit, observability, or migration evidence, but they must not participate in any execution decision after retirement.

**Rollback constraint:** If the migration is rolled back to the legacy path, the execution claims ledger continues to provide cross-path exclusion for the duration of the rollback window. Rollback must not accidentally convert the temporary ledger into a permanent authority — rollback should either (a) retire the ledger and revert fully to `barry_drafts.sending` as the sole claim path, or (b) keep the ledger operative only while both paths remain simultaneously reachable. Once only one execution path exists (legacy or target), the ledger has no role.

#### Stable Cross-System Identity

##### Identity for the legacy reply-send migration

The migration identity for the `barry-approve-send` flow must remain stable across:
- Retries (same user clicking Send again)
- Regeneration and editing (user edits the draft body before sending)
- Contact merge and re-parenting (contact record changes its parent or is merged with another)
- Migration and backfill (draft moves from `barry_drafts` to `prepared_actions`)
- Rollback (migration reverted to legacy path)
- Legacy-to-Prepared-Action conversion

**Repository-verified candidate: `messageRecordId`**

The `messageRecordId` is a Firestore auto-generated document ID created at `communication_records.add()` (`messageProcessor.js:111`). It is:

- **Immutable once created** — Firestore auto-IDs do not change (CONFIRMED CURRENT)
- **Independent of `contactId`** — created in the top-level `communication_records` collection, not under the `contacts/{contactId}` subtree (CONFIRMED CURRENT — `messageProcessor.js:111`)
- **Stable across contact merge** — if a contact is merged or re-parented, the `contactId` in the `barry_drafts` path changes but the `messageRecordId` remains the same globally unique identifier of the original inbound message
- **Already used as the document key** — `barry_drafts` is keyed by `messageRecordId` (`barry-approve-send.js:290`, `process-barry-inbox-queue.js:169`)

The `contactId` is **not** part of the stable identity because it is mutable — it appears in the `barry_drafts` document path (`users/{userId}/contacts/{contactId}/barry_drafts/{messageRecordId}`) but changes if the contact is merged or re-parented. Using `contactId` in the identity derivation would create a second executable identity for the same logical action when a contact merge occurs during the coexistence window.

**Identity derivation for the legacy reply-send migration:**

```
logical_action_id = messageRecordId
```

The `messageRecordId` alone is sufficient for this migration scope. It is globally unique, immutable, does not contain `contactId`, and already serves as the document key in both `communication_records` (top-level) and `barry_drafts` (nested). No new persistent identity field or Barry OS object is required.

The `idempotency_key` used by Document 4's Action Executor (Part V: `{prepared_action_id}_{capability_id}_{timestamp}`) incorporates the `prepared_action_id`, which must carry a deterministic back-reference to the `messageRecordId` so the mapping is persisted and survives rollback. During the migration window, the `prepared_action` document stores `messageRecordId` as a persisted field.

##### P6 Definition of Ready — stable identity requirement

Every external side-effect path entering Action Executor must first have a repository-verified stable logical-action identity. That identity must remain stable across:
- Retries
- Regeneration and editing
- Contact merge and re-parenting
- Migration and backfill
- Rollback
- Legacy-to-Prepared-Action conversion

A path without a proven stable identity may not migrate behind Action Executor.

**Repository-confirmed external side-effect implementations (CONFIRMED CURRENT):**

| Implementation | External Side Effect | Current Identity | Stable Across Contact Merge? | Migration Scope |
|---|---|---|---|---|
| `barry-approve-send.js` | Gmail send (reply) | `messageRecordId` (Firestore auto-ID from `communication_records`) | Yes — `messageRecordId` is in top-level collection, not under `contactId` | Legacy reply-send migration (this section) |
| `gmail-send.js` | Gmail send (campaign) | `campaignId` + `messageIndex` | Needs verification — `campaignId` may reference contact | Separate migration; not in `barry_drafts` scope |
| `gmail-send-quick.js` | Gmail send (quick engage) | None — no idempotency claim | Needs identity design | Separate migration; not in `barry_drafts` scope |
| `gmail-send-wave.js` | Gmail send (batch wave) | Per-recipient in batch | Needs verification | Separate migration; not in `barry_drafts` scope |
| `send-followup.js` | Gmail send (manual follow-up) | `campaignId` (created per send) | Needs verification | Separate migration; not in `barry_drafts` scope |
| `process-scheduled-engagements.js` | Gmail send (scheduled) | `scheduledEngagements/{docId}` | Needs verification — path includes `userId` | Separate migration; not in `barry_drafts` scope |
| `barryActions.js:executeGmailSend` | Gmail send (AI-driven action) | None — no idempotency claim | Reachable after P4 — R4-004 deletes intent parsing, not execution | Separate migration; requires stable identity before dual-path eligibility |

**`barryActions.js:executeGmailSend` disposition — correction:** R4-004 (Document 4) establishes deletion of `barryActions` **intent parsing** — the AI-classified action routing layer (`parseIntent`, lines 87–142). It does not establish deletion of the action executor functions. At P4, intent parsing is replaced by typed tool schemas with deterministic routing (R4-004: "Action routing among 5 enumerated types plus `none` is a lookup, not reasoning"). The typed tool schemas route to execution functions — they do not eliminate the Gmail side-effect capability. After P4, the `gmail_send` tool type still requires an executor that calls `gmail.users.messages.send` (currently `executeGmailSend`, line 165). This execution path remains reachable and produces the same external side effect (`gmail.send_email` capability, Document 4 Part IV). At P6, this path must route through the Action Executor with the `gmail.send_email` capability contract (Document 4 Part IV: side-effect, approval required, idempotency key required). A stable logical-action identity satisfying corrected Document 4 Part V must be established before this path becomes dual-path eligible. The migration matrix (below) reflects the corrected target state: "Typed tool schemas" at P4 is an intent-routing change, not an execution-path deletion.

The migration-window idempotency mechanism specified below applies to the `barry-approve-send` legacy reply-send path only. Other external side-effect paths — including `barryActions.js:executeGmailSend` — have independent stable-identity requirements that must be resolved as P6 Definition of Ready items before they can migrate behind Action Executor.

#### Candidate Mechanism Evaluation

| Candidate | Claim Authority | Cross-Path Exclusion | Retry Behavior | Rollback Behavior | Doc 4 Compatibility | Recommendation |
|---|---|---|---|---|---|---|
| **A. Temporary execution claims ledger** — a single Firestore collection (`execution_claims/{messageRecordId}`) checked by both paths before any external call; retired when legacy path removed | Single document per `messageRecordId`; whoever creates it first wins | Both paths transactionally create-or-check the same document before Gmail call; second writer sees existing claim and aborts | Retry finds existing claim → returns existing result (replay) | Claim document persists independently of both `barry_drafts` and `prepared_actions`; rollback to legacy path still sees the claim; ledger retires when only one path remains | Implements Document 4 Part V invariant ("only one Executed Action per `idempotency_key` can enter `executing`") as a temporary migration mechanism without changing its authority model | **RECOMMENDED** |
| **B. Legacy collection as single authority** — new path checks `barry_drafts.approvalStatus` before executing; legacy path unchanged | `barry_drafts` document is sole claim authority | New path reads `barry_drafts` status in the same transaction that creates the Prepared Action; aborts if `'sending'` or `'sent'` | Safe — retries blocked by `barry_drafts` status | Natural — rollback simply stops writing `prepared_actions`; `barry_drafts` is unchanged | Contradicts Document 4: the Action Executor's Executed Action is supposed to be the execution claim (Part V, step 5). Making `barry_drafts` the authority during migration means Document 4's claim model is not operative until `barry_drafts` is fully retired | Not recommended — delays Document 4 invariant validation |
| **C. Dual-check with eventual consistency** — each path checks the other path's collection before executing | Split authority — two independent claims that attempt coordination | Each path queries the other's collection before executing; relies on Firestore read consistency | Race window: between the cross-check read and the Gmail call, the other path could claim and execute | Requires cleanup of both collections' state during rollback | Violates "one authoritative execution claim per logical action" — two authorities with a coordination gap | Not recommended — window for double-send exists |
| **D. Hard cutover (no coexistence)** — migrate all `barry_drafts` to `prepared_actions` atomically, switch all traffic at once | Clean — only one authority at any time | No cross-path scenario exists | Safe under single authority | Rollback requires full reverse migration under downtime | Compatible — Document 4 authority is fully operative after cutover | Not recommended — high blast radius; any bug during cutover means production downtime or double-sends for all in-flight actions |

#### Recommended Mechanism: Temporary Execution Claims Ledger

Mechanism A is recommended. It is an implementation of Document 4's existing invariant — "only one Executed Action per `idempotency_key` can enter `executing`" (Part V, §Idempotency Contract) — as a temporary migration synchronization mechanism, without changing its authority model or transaction boundary.

**Document 4 Part V compliance:** This mechanism is a temporary migration synchronization primitive under Document 4 Part V (§Temporary Migration Synchronization Invariant). It must satisfy all six conjunctive conditions to be permitted. The six-condition evaluation appears below (see Document 4 Part V Compliance).

**Specification:**

1. Before making any external call (Gmail send), both paths must transactionally create a claim document at `execution_claims/{messageRecordId}`
2. The claim document records: `messageRecordId`, `source_path` (`legacy` | `executor`), `claimed_at` (server timestamp), `status` (`claiming` | `completed` | `failed`)
3. If the document already exists → the claiming path aborts. If `status: 'completed'` → return the existing result (replay, not re-execute). If `status: 'claiming'` and held < stale threshold → return `claim_in_progress`. If `status: 'claiming'` and held > stale threshold → reclaim (preserving the existing `barry-approve-send.js` stale-claim pattern, currently 2 minutes)
4. The stale-claim reclaim pattern is preserved from the existing A1 implementation (`STALE_CLAIM_MS` in `barry-approve-send.js:67`) — this is not a new mechanism
5. After successful external execution → update claim to `completed` with result reference
6. After failed external execution → update claim to `failed`; release claim so retry can succeed
7. The `prepared_action` document stores `messageRecordId` as a persisted field; the identity derivation uses it, making the mapping deterministic and surviving rollback

**Authority hierarchy during migration window:**

```
Document 4 Part V (frozen)          ← defines the target authority model
    ↓ implemented by
Executed Action collection          ← permanent authority (new path)
    ↓ synchronized with (temporary)
execution_claims/{messageRecordId}  ← migration-only cross-path exclusion
    ↑ synchronized with (temporary)
barry_drafts.approvalStatus         ← legacy authority (retired with legacy path)
```

After the legacy `barry_drafts` execution path is removed, the temporary ledger is retired and this hierarchy collapses to Document 4's target: Executed Action as sole authority.

#### Document 4 Part V Compliance

The temporary execution claims ledger is evaluated below against Document 4 Part V (§Temporary Migration Synchronization Invariant). A temporary migration synchronization primitive is permitted if and only if it satisfies convergence plus all six conjunctive conditions. Each condition is evaluated against the mechanism as specified above.

**Convergence requirement** (Document 4 Part V, §Migration Identity Contract): The mechanism converges to a single execution authority — Executed Action — when the legacy path is removed and the ledger is retired. **PASS.**

**Condition 1 — Bounded coexistence window:** The ledger operates only during the `barry_drafts → prepared_actions` dual-write coexistence window. It is created at P6 entry (when dual-write begins) and retired at legacy path removal (when `barry-approve-send.js` and all other legacy send functions no longer call `gmail.users.messages.send` through the legacy claim path). The window is bounded by the migration timeline, not open-ended. **PASS.**

**Condition 2 — Permanent authority unchanged:** The ledger does not modify, replace, or supersede the Executed Action as the permanent execution authority defined in Document 4 Part V. Both legacy (`barry_drafts.approvalStatus`) and target (`Executed Action.executing`) authorities continue to operate through their own transaction boundaries. The ledger provides the minimum cross-path execution-control behavior necessary to enforce the send-once invariant during coexistence — it does not alter the authority model of either path. **PASS.**

**Condition 3 — Mutual exclusion only:** The ledger's sole function is mutual exclusion: ensuring that at most one execution path produces the external side effect (Gmail send) for a given logical action. It does not route actions, select execution paths, schedule execution, transform payloads, or perform any function beyond cross-path claim arbitration. **PASS.**

**Condition 4 — Automatic capability-based retirement:** The ledger retires automatically when no legacy path can produce an external side effect — i.e., when the capability it synchronizes (cross-path mutual exclusion) has no remaining operational role. Retirement is triggered by the removal of legacy execution paths, not by a manual decision or calendar date. Once retired, the ledger ceases all execution-control behavior. **PASS.**

**Condition 5 — No permanent promotion:** The ledger is specified as temporary and migration-only throughout this document (see P6 Definition of Ready, §Temporary Migration Synchronization Mechanism, §Recommended Mechanism, and the authority hierarchy diagram). No upgrade path, feature extension, or post-migration role is defined or permitted. The ledger does not appear in Document 4's target architecture. **PASS.**

**Condition 6 — Operationally inert after retirement:** After retirement, the ledger ceases all execution-control behavior (authorize, veto, expire, recover). No code path consults it for execution decisions. Historical claim records may be retained solely for audit, observability, or migration evidence, but they do not participate in any execution decision. The ledger is operationally inert. **PASS.**

**Escalation clause status:** All six conditions are satisfied. Convergence is demonstrated. The escalation clause (Document 4 Part V, §Escalation Clause) is not triggered.

#### Concurrency Acceptance Condition

P6's exit gate requires demonstrating the following before the migration window opens:

> **Two workers entering through different paths (legacy `barry_drafts.sending` and new Action Executor) for the same logical action cannot both produce an external side effect.**

**Test 1 — Concurrent cross-path execution:**
1. Create a `barry_draft` with a known `messageRecordId`
2. Create a corresponding `prepared_action` referencing the same `messageRecordId`
3. Concurrently trigger both the legacy send path and the new Action Executor path
4. Verify: exactly one Gmail send occurs. The second path receives either `claim_in_progress` or a replay of the first result.
5. Repeat under: normal conditions, stale-claim reclaim conditions, and crash-recovery conditions (function dies between claim and Gmail call)

**Test 2 — Mutable-identity (contact merge during coexistence):**
1. Create a `barry_draft` for contact A with `messageRecordId` M
2. Merge contact A into contact B (re-parent)
3. Verify: the execution claims ledger keyed by `messageRecordId` M prevents a second executable identity from being created under contact B's path
4. Attempt send through both old path (contact A) and new path (contact B) for the same `messageRecordId` M
5. Verify: at most one Gmail send occurs regardless of which `contactId` path is used

Both tests must pass before the dual-write window is opened to production traffic.

---

## P7 — Workflows

**Goal:** Promote existing proto-workflow implementations to named Workflows with composition rules, failure strategies, and Skill-based step execution.

**Primary dependency:** P4 (Skills Registry), P6 (Capability Registry and Action Executor — Workflows that produce Prepared Actions need the executor)

**Architectural debt retired:** `barryHunterProcessEngage` and `process-barry-inbox-queue` promoted from bespoke chains to Workflows (reconciliation §9).

**Definition of Ready:**
- P4 complete — all 15 Skills registered and invocable
- P6 complete — Action Executor operational for terminal steps that produce Prepared Actions
- All 7 Workflows defined with contracts (Document 4, Part III — FROZEN)
- Workflow composition rules defined (Document 4, R4-003 — FROZEN):
  - Workflows orchestrate Skills; Skills never orchestrate Workflows
  - No nesting of Workflows within Workflows
  - One context resolution per Workflow invocation
  - Sequential execution model with per-step failure strategy

**Definition of Done:**
- All 7 Workflows registered and invocable:
  1. `ProcessReplyWorkflow` — existing proto: `process-barry-inbox-queue.js`
  2. `EngageContactWorkflow` — existing proto: `barryHunterProcessEngage.js`
  3. `PrepareMeetingWorkflow`
  4. `LaunchCampaignWorkflow`
  5. `QualifyProspectWorkflow`
  6. `MorningBriefWorkflow`
  7. `ReconnectDormantWorkflow`
- Per-step failure strategy enforced (skip / abort / retry per Document 4)
- Existing proto-workflows (`process-barry-inbox-queue`, `barryHunterProcessEngage`) replaced by Workflow invocations
- Composition hierarchy verified: no Skill-invokes-Workflow, no Workflow-invokes-Workflow patterns

**Exit gate:** All 7 Workflows invocable. `ProcessReplyWorkflow` and `EngageContactWorkflow` producing equivalent outputs to their proto-implementations. Production telemetry shows Workflow step execution with per-step success/failure tracking.

**Rollout mode:** feature-flag — new Workflows deployed alongside existing proto-implementations. Traffic shifted per-Workflow once output parity confirmed.

**Migration items:**
- `process-barry-inbox-queue.js` → `ProcessReplyWorkflow` (CONFIRMED HISTORICAL — reconciliation §9, Document 4)
- `barryHunterProcessEngage.js` → `EngageContactWorkflow` (CONFIRMED HISTORICAL — reconciliation §9, Document 4)

**Infrastructure requirements:**
- Workflow execution Firestore path (must route through `FIRESTORE_DATA_ARCHITECTURE.md`)
- Workflow step telemetry

**Known risks:**
- Five of seven Workflows have no existing implementation — built new from Skill compositions
- Proto-workflow behavior may have undocumented edge cases that the new Workflow does not replicate

**Estimated scope:** MEDIUM

---

## P8 — Morning Brief + Mission Control Aggregation

**Goal:** Deliver a unified Morning Brief from Awareness projections and Action Queue, and consolidate Mission Control's data consumption to Awareness-only (BO-002).

**Primary dependency:** P3 (Awareness projections populated), P6 (Action Queue populated)

**Architectural debt retired:** Three morning-brief implementations consolidated. Three recommendation vocabularies unified. Mission Control consuming Awareness (BO-002), not modules directly.

**Definition of Ready:**
- P3 complete — Awareness projections populated and readable
- P6 complete — Action Queue populated
- `barryOrientationBrief.js` behavior documented as baseline (CONFIRMED HISTORICAL)
- BO-002 enforced — Mission Control → Awareness → Signals → Modules (Document 1, §8)

**Definition of Done:**
- Single Morning Brief implementation operational, fed by Awareness projections
- Three existing morning-brief implementations retired
- Three recommendation vocabularies consolidated into one
- Mission Control reads exclusively from Awareness projections — no direct module queries
- A10 index follow-up complete — Mission Control queries use proper indexes (defect register, P8 scope)

**Exit gate:** Morning Brief renders in production from Awareness data. Mission Control loads without direct module queries. `barryOrientationBrief.js` retired.

**Rollout mode:** cutover — new Morning Brief replaces existing implementations. Awareness projections provide the same data through a unified interface.

**Migration items:**
- Three morning-brief implementations → one (CONFIRMED HISTORICAL — reconciliation §9)
- Three recommendation vocabularies → one (CONFIRMED HISTORICAL — reconciliation §9)
- A10 index follow-up (defect register — cap applied in P0A, index in P8)

**Infrastructure requirements:** None beyond P3 and P6 outputs

**Known risks:**
- Morning Brief is a visible user-facing feature — quality regression immediately noticeable

**Estimated scope:** MEDIUM

---

## P9 — Surface Consolidation

**Goal:** Consolidate 47 architectural surfaces to ~12 and 6 conversation stores to 1, unified by `barrySessionKey` (BO-009).

**Primary dependency:** P8 (Morning Brief live — provides the "Barry learned this" surface needed for P10). `barrySessionKey` schema extended per reconciliation §7.4.

**Architectural debt retired:** 47 surfaces → ~12 (CONFIRMED HISTORICAL — canonical audit). 6 conversation stores → 1 (CONFIRMED HISTORICAL — reconciliation §2.4). A9 unified — `barry_sessions` name collision resolved at collection level (reconciliation §8). `barrySessionKey` wired to unified store (BO-009, reconciliation §7).

**Definition of Ready:**
- P8 complete — Morning Brief live
- `barrySessionKey` format confirmed: `{entityType}:{entityId}:{sessionType}`, `sourceModule` as metadata (BO-009, reconciliation §7.1)
- Six conversation stores identified (CONFIRMED HISTORICAL — reconciliation §2.4):
  1. `drawer_{module}` (9 possible keys)
  2. `missionControl`
  3. `reconCoach_{sectionId}`
  4. `icpChat`
  5. `icp`
  6. `barry_sessions` (user-level and contact-level — A9)
- Surface consolidation target (~12) approved

**Definition of Done:**
- Single conversation store keyed by `barrySessionKey`
- All six existing stores migrated or draining into the unified store
- A9 fully unified — no `barry_sessions` name collision
- Surface count reduced to ~12 (from 47)
- `barrySessionKey` wired server-side — currently computed everywhere, used nowhere server-side (reconciliation §7)

**Exit gate:** Single conversation store responding to all Barry conversation queries. Old stores empty or draining. Surface inventory at target count. No server-side code references legacy store names.

**Rollout mode:** migration — conversation data migrated in batch to unified store, then read-old/write-new during transition. Old stores retired after drain period.

**Migration items:**
- 6 conversation stores → 1 (CONFIRMED HISTORICAL — reconciliation §2.4)
- 47 surfaces → ~12 (CONFIRMED HISTORICAL — canonical audit)
- `barrySessionKey` server wiring (reconciliation §7 — "small, and no historical migration required")

**Infrastructure requirements:**
- Unified conversation store Firestore path (must route through `FIRESTORE_DATA_ARCHITECTURE.md`)

**Known risks:**
- Conversation data migration must preserve existing conversations — data loss is visible to users
- Surface consolidation touches frontend components across all modules

**Estimated scope:** HIGH

---

## P10 — Memory Promotion Pipeline

**Goal:** Replace `closeBarrySession()`'s unguarded auto-write to durable contact memory with the promotion pipeline defined in Document 2, enforcing confidence gates and provenance tracking.

**Primary dependency:** P9 (unified conversation store — promotion pipeline reads from it; "Barry learned this" surface needed)

**Architectural debt retired:** Law 18 violation — `closeBarrySession()` auto-write with no gate, no confidence score, no provenance (BO-007, reconciliation §6.3, §10). Legacy memory entries drain naturally.

**Definition of Ready:**
- P9 complete — unified conversation store live (promotion pipeline reads from it)
- Memory promotion rules confirmed (Document 2, §Memory — FROZEN):
  - Confidence gate required
  - Corroboration requirement
  - Provenance tracking
- Legacy memory drain strategy approved by Aaron (reconciliation §6.3 — backfill decision)
- Six memory types confirmed (reconciliation §6 — CONFIRMED HISTORICAL):
  1. Session Conversation Memory
  2. Relationship Memory (durable)
  3. User Memory
  4. Artifact Memory
  5. Entity Cache
  6. System Configuration

**Definition of Done:**
- `closeBarrySession()` auto-write pattern replaced by promotion pipeline
- Confidence gate enforced: session content requires minimum confidence score before reaching durable memory
- Provenance tracking: all durable memory entries carry `provenance` field
- Legacy memory entries (`what_has_worked`, `known_facts`) marked `provenance: 'pre_promotion_pipeline', confidence: 'low'`
- Legacy entries draining via 30-day expiry — not deleted wholesale
- New durable memory entries carry `provenance: 'promotion_pipeline', confidence: <score>`

**Exit gate:** `closeBarrySession()` no longer writes directly to durable memory. Promotion pipeline gates visible in telemetry. Legacy entries aging out. No new entries without provenance and confidence.

**Rollout mode:** read-old/write-new — legacy memory readable throughout transition. New promotion pipeline writes alongside existing entries. Legacy entries drain via 30-day expiry.

**Migration items:**
- `closeBarrySession()` → promotion pipeline (CONFIRMED HISTORICAL — reconciliation §10, BO-007)
- Legacy memory entries: mark and drain, not delete (reconciliation §6.3)

**Infrastructure requirements:**
- Promotion pipeline Firestore paths (must route through `FIRESTORE_DATA_ARCHITECTURE.md`)
- Confidence scoring model for memory promotion

**Known risks:**
- Legacy memory drain (30 days) means old and new formats coexist during transition
- Backfill decision for existing durable memory is Aaron's call (reconciliation §6.3)

**Estimated scope:** MEDIUM

---

## P11 — Orchestration

**Goal:** Unify Workflows, Think Layer, and Action Executor into a coherent orchestration layer where Barry's full cycle — signal → awareness → think → prepare → execute — operates end-to-end.

**Primary dependency:** P7 (Workflows live), P8 (Morning Brief and Mission Control aggregation complete)

**Architectural debt retired:** Ad-hoc orchestration patterns replaced by unified runtime.

**Definition of Ready:**
- P7 complete — all 7 Workflows operational
- P8 complete — Morning Brief and Mission Control consuming from Awareness
- All five layers (Signal → Awareness → Recommendation → Prepared Action → Executed Action) individually operational

**Definition of Done:**
- End-to-end flow operational: signal emitted → Awareness updated → Think Layer produces recommendation → Workflow executes Skills → Prepared Action generated → Approval → Action Executor fires
- "Aaron says 'Responses' and Barry walks him through each one. Aaron confirms, adjusts, or skips. Barry executes." — the North Star scenario functional
- Orchestration telemetry: full trace from signal to execution observable

**Exit gate:** North Star scenario demonstrated end-to-end in production. Telemetry trace shows complete signal-to-execution path.

**Rollout mode:** cutover — orchestration layer replaces ad-hoc coordination patterns.

**Migration items:**
- Ad-hoc module coordination → orchestration layer (TARGET)

**Infrastructure requirements:** None beyond prior phases

**Known risks:**
- End-to-end integration testing across all five layers — combinatorial complexity

**Estimated scope:** MEDIUM

---

## P12 — Controlled Autonomy

**Goal:** Introduce controlled autonomy for selected capabilities based on demonstrated reliability, confidence scoring, and user preference, moving selected capabilities past the Phase 1 Approval ceiling.

**Primary dependency:** P6 (Capability Registry with autonomy spectrum), Enterprise Foundations E5 (Confidence) and E7 (Permissions) — reconciliation §9

**Architectural debt retired:** Phase 1 Approval ceiling relaxed for proven capabilities. Enterprise Foundations E5/E7 dependency satisfied.

**Definition of Ready:**
- P6 complete — Capability Registry enforcing autonomy spectrum
- Confidence scale unified (reconciliation §9 — Enterprise Foundation E5)
- Audit trail complete (reconciliation §9 — Enterprise Foundation E4, largely satisfied by P5 reasoning traces)
- User preference infrastructure for per-capability autonomy levels
- Demonstrated reliability data from production operation of capabilities at Approval level

**Definition of Done:**
- At least one side-effect capability operating at Autonomous level with:
  - Confidence threshold met
  - User explicit opt-in
  - Full audit trail
  - Rollback capability
- Autonomy level enforcement remains structural (Capability Registry field, not prompt instruction — Document 4, Part IV)
- No capability moves past Approval without explicit user authorization

**Exit gate:** Autonomous capability executes in production without Approval prompt. Audit trail complete. User can revoke autonomy and return to Approval.

**Rollout mode:** feature-flag — per-capability, per-user autonomy promotion. Each capability independently toggleable.

**Migration items:** None — new capability, not migration

**Infrastructure requirements:**
- User preference storage for autonomy levels
- Confidence scoring integration from E5

**Known risks:**
- Autonomous side-effect execution (e.g., sending email without approval) is the highest-trust Barry OS capability — requires extensive production track record at Approval level first
- User trust calibration: premature autonomy erodes trust; overly conservative limits reduce value

**Estimated scope:** MEDIUM

---

# RECON Decision Gate

The RECON generators are classified HIGH MIGRATION RISK (Document 4, RefineICPSkill). This section defines the decision gate — it does not select the execution model.

## Affected Functions (CONFIRMED CURRENT)

| Function | Configured Timeout Ceiling | Evidence |
|---|---|---|
| `generate-icp-brief` | 900s (explicit — `netlify.toml`) | CONFIRMED CURRENT |
| `generate-all-reports` | 900s (explicit — `netlify.toml`) | CONFIRMED CURRENT |
| `generate-section-1` | 900s (explicit — `netlify.toml`) | CONFIRMED CURRENT |
| `generate-section-2` | 900s (explicit — `netlify.toml`) | CONFIRMED CURRENT |
| `generate-section-3` through `generate-section-10` | No explicit timeout configured; the applicable platform runtime default governs | CONFIRMED CURRENT |

Total: 12 functions. Four have explicit 900-second configured ceilings in `netlify.toml`. Eight (`generate-section-3` through `generate-section-10`) have no explicit timeout configuration — the applicable platform runtime default governs their timeout behavior.

Configured timeout ceilings are not observed execution durations. Actual execution durations remain PENDING BASELINE until the August 17 baseline provides runtime telemetry evidence.

Under the modern Netlify runtime, synchronous functions are limited to 60 seconds.

## Current User Experience

The user initiates RECON section generation and waits for completion. The UI presents a loading state while the function executes. This is a synchronous, blocking interaction.

## Evidence Required Before Decision

1. **Actual execution time data** from baseline week production telemetry:
   - How long does each `generate-section-*` function actually take?
   - Do any complete within 60 seconds?
   - What is the p50, p95, and p99 execution time?
2. **Dead endpoint verification** — A5-b (PENDING BASELINE):
   - Are `generate-icp-brief` and `generate-all-reports` invoked in production at all?
   - If never invoked, their migration risk is zero — delete rather than migrate
3. **Modern runtime background function capabilities** and constraints

## Viable Target Execution Models

| Model | Description | Customer-Visible Change |
|---|---|---|
| **Background function** | Netlify background functions (15-minute timeout). Function returns immediately; result written to Firestore; UI polls. | User sees "processing..." state instead of waiting. No synchronous progress indication. |
| **Chunked synchronous** | Break section generation into sub-tasks, each < 60s. UI shows section-by-section progress. | User sees incremental progress but with more round-trips. Partial results visible during generation. |
| **Queue-driven async** | Signal Bus queues RECON work. Background consumer processes. | Same as background function from UX perspective, but uses Barry OS signal infrastructure. |
| **Hybrid** | Sections that complete < 60s remain synchronous; longer sections use background processing. | Mixed UX — some sections instant, others async. |

## Decision Classification

**Migration Blocker.** Multiple valid execution models produce different observable behavior. The user experience of RECON section generation changes under each model. This decision belongs to Aaron.

Document 5 schedules the decision gate. Document 5 does not select the execution model.

**Decision required before:** RECON generators can receive their final Barry OS capability disposition. P4 executes the 28 R4-002 dispositions independently; RECON generator disposition is deferred until this decision is made.

**Decision informed by:** August 17 baseline execution time data (PENDING BASELINE), A5-b dead endpoint verification.

---

# Dependency Graph

```
Baseline Report (Aug 17)
    │
    ├─── I1 (Model Migration) ───────────────── parallel to P1–P3
    │
    ├─── I3 (Firebase Telemetry) ────────────── parallel to P1–P4
    │
    ├─── I4 (Stripe Isolation) ──────────────── parallel to all
    │
    ├─── I2 (Netlify Migration)
    │    └── RECON Decision Gate ──── blocks RECON capability disposition
    │                                 (not P4 — P4 executes 28 R4-002
    │                                  dispositions independently)
    │
    v
    P1 (Signal Bus)
    │
    v
    P2 (Context Resolver)
    │
    v
    P3 (Awareness Projections)
    │
    v
    P4 (Skills Registry) ◄── I1 (model migration)
    │
    v
    P5 (Think Layer)
    │
    v
    P6 (Capability Registry
    │   + Action Executor)
    │
    ├───────────┐
    v           v
    P7          P8 (Morning Brief)
    (Workflows)  │
    │           │
    ├───────────┘
    v
    P9 (Surface Consolidation)
    │
    v
    P10 (Memory Promotion)
    │
    v
    P11 (Orchestration) ◄── P7, P8
    │
    v
    P12 (Controlled Autonomy) ◄── E5, E7
```

**Critical path:** Baseline → P1 → P2 → P3 → P4 → P5 → P6 → P7/P8 → P9 → P10 → P11 → P12

**Blocking dependencies:**
- I1 blocks P4 (all endpoints must be on policy tiers before Skills consolidation)
- I2 RECON decision blocks RECON generator capability disposition (not P4 — P4 executes R4-002 dispositions independently)
- I3 supports P5 (complete telemetry needed for reasoning trace observability)

**Non-blocking parallelism:**
- I1 runs parallel to P1–P3
- I2 non-RECON functions run parallel throughout
- I3 runs parallel to P1–P4
- I4 runs parallel to everything
- P7 and P8 can run in parallel after P6

---

# Enterprise Foundation Ordering

From reconciliation §9, unchanged from the canonical audit:

```
E1 Observability → E2 Identity/Tenancy → E3 Idempotency → E4 Auditability → E5 Confidence → E6 Reliability → E7 Permissions → E8 Evaluation
```

| Foundation | Landing Phase | Status |
|---|---|---|
| E1 Observability | P0B | Complete — `models.js`, `logApiUsage.js` centralized |
| E2 Identity/Tenancy | P1 | Signal envelope carries workspace ownership |
| E3 Idempotency | P0A (partial) / P6 (complete) | A1 guarantee in P0A; Action Executor completes in P6 |
| E4 Auditability | P5 | Reasoning traces persisted |
| E5 Confidence | P12 | Confidence scale unified |
| E6 Reliability | P6 | Circuit breakers, Action Executor failure handling |
| E7 Permissions | P12 | Per-capability autonomy levels |
| E8 Evaluation | Post-P12 | Outcome evaluation at scale |

---

# Migration Matrix

Complete disposition of every current implementation's path to Barry OS.

| Implementation | Current State | Evidence Status | Target State | Phase | Risk | Rollout Mode | Notes |
|---|---|---|---|---|---|---|---|
| `barry_drafts` | Firestore collection for draft actions | CONFIRMED HISTORICAL | `prepared_actions` | P6 | MEDIUM | dual-write | A1 guarantee must transfer |
| `closeBarrySession()` | Auto-write to durable memory | CONFIRMED HISTORICAL | Promotion pipeline | P10 | HIGH | read-old/write-new | BO-007 confirmed violation |
| `barry_intel` on Company docs | BO violation — derived intel in canonical storage | CONFIRMED HISTORICAL | `CompanyIntelArtifact` | P1 | LOW | immediate | A12, `search-companies.js:991` |
| `barrySessionKey` | Computed everywhere, used nowhere server-side | CONFIRMED HISTORICAL | Unified conversation store key | P9 | MEDIUM | migration | BO-009, reconciliation §7 |
| RECON generators (12) | Synchronous; 4 with explicit 900s configured ceiling, 8 governed by platform runtime default | CONFIRMED CURRENT | Execution model TBD — Migration Blocker; Barry OS capability disposition DEFERRED | I2 | HIGH | TBD | Requires Aaron decision |
| `barryValidateContact` | AI-powered field validation (Sonnet) | CONFIRMED CURRENT | Deterministic validation rules | P4 | LOW | immediate | R4-004, Law 20 |
| `barryActions` | AI-classified intent parsing (Haiku) | CONFIRMED CURRENT | Typed tool schemas | P4 | LOW | immediate | R4-004, Law 20 |
| 9 context implementations | Independent assembly paths | CONFIRMED HISTORICAL | Single context resolver | P2 | HIGH | shadow → cutover | Reconciliation §2.3 |
| 5 business-awareness computations | Duplicate on-demand | CONFIRMED HISTORICAL | Signal-driven projection | P3 | MEDIUM | shadow | Reconciliation §9 |
| 28 R4-002 dispositions | Scattered across modules | CONFIRMED HISTORICAL | 15 Skills | P4 | HIGH | feature-flag | R4-002 (RECON generators excluded — disposition DEFERRED) |
| 47 architectural surfaces | Across 7 directories | CONFIRMED HISTORICAL | ~12 surfaces | P9 | HIGH | migration → cutover | Canonical audit |
| 6 conversation stores | Independent, no cross-reference | CONFIRMED HISTORICAL | 1 store, `barrySessionKey` | P9 | HIGH | migration | Reconciliation §2.4 |
| 6 message generators | Independent implementations | CONFIRMED HISTORICAL | `WriteEmailSkill` | P4 | MEDIUM | feature-flag | R4-002 |
| `barryStrategyRecommender.js` | Partial Think Layer (3/4 functions) | CONFIRMED HISTORICAL | Full Think Layer (4/4) | P5 | MEDIUM | shadow | BO-010, reconciliation §4 |
| `strategyScores` | Discarded by all 4 consumers | CONFIRMED HISTORICAL | Persisted | P5 | LOW | immediate | Document 1, §4.6 |
| `barryHunterProcessEngage.js` | Proto-workflow | CONFIRMED HISTORICAL | `EngageContactWorkflow` | P7 | MEDIUM | feature-flag | Document 4, Part III |
| `process-barry-inbox-queue.js` | Proto-workflow | CONFIRMED HISTORICAL | `ProcessReplyWorkflow` | P7 | MEDIUM | feature-flag | Document 4, Part III |
| 3 morning-brief implementations | Independent | CONFIRMED HISTORICAL | Single Morning Brief | P8 | MEDIUM | cutover | Reconciliation §9 |
| 3 recommendation vocabularies | Independent | CONFIRMED HISTORICAL | Unified vocabulary | P8 | LOW | cutover | Reconciliation §9 |
| Legacy memory entries | No provenance, no confidence | CONFIRMED HISTORICAL | Marked `pre_promotion_pipeline` | P10 | LOW | drain (30-day) | Reconciliation §6.3 |
| `generate-icp-brief` | Possibly dead endpoint; explicit 900s configured ceiling | PENDING BASELINE | Delete or migrate — RECON disposition DEFERRED | I2 | MEDIUM | TBD | A5-b |
| `generate-all-reports` | Possibly dead endpoint; explicit 900s configured ceiling | PENDING BASELINE | Delete or migrate — RECON disposition DEFERRED | I2 | MEDIUM | TBD | A5-b |
| 8 LEGACY_SONNET_4_5 modules | Legacy model identifier | CONFIRMED CURRENT | MODEL_DEEP | I1 | MEDIUM | immediate | BO-006, floor ~2026-09-29 |
| 10 LEGACY_HAIKU_4_5 modules | Dated snapshot identifier | CONFIRMED CURRENT | MODEL_FAST | I1 | LOW | immediate | BO-006, floor ~2026-10-15 |
| Stripe Payment Links | Live in all deploy contexts | CONFIRMED CURRENT | Environment-conditional | I4 | MEDIUM | immediate | `CheckoutPage.jsx:70-74` |
| `apiLogs` | No retention, no indexes | CONFIRMED CURRENT | Retention + indexes | I3 | LOW | immediate | `FIRESTORE_DATA_ARCHITECTURE.md` |

---

## Document Status

| Field | Value |
|---|---|
| **Discovery source** | `docs/audits/BARRY_OS_FOUNDATION_AUDIT.md` (commit `09e90f9`) |
| **Discovery authority** | `docs/audits/BARRY_OS_AUDIT_RECONCILIATION.md` |
| **Architecture source** | `docs/barry-os/architecture/BARRY_OS_REFERENCE_ARCHITECTURE.md` (Document 1 — FROZEN 2026-08-07) |
| **Domain model** | `docs/barry-os/architecture/BARRY_OS_DOMAIN_LIFECYCLE_MODEL.md` (Document 2 — FROZEN 2026-08-08) |
| **Signal specification** | `docs/barry-os/architecture/BARRY_OS_SIGNAL_SPECIFICATION.md` (Document 3 — FROZEN 2026-08-08) |
| **Capability contracts** | `docs/barry-os/architecture/BARRY_OS_CAPABILITY_CONTRACTS.md` (Document 4 — FROZEN 2026-08-11) |
| **Infrastructure baseline** | `FIRESTORE_DATA_ARCHITECTURE.md` |
| **Architecture status** | FROZEN 2026-08-11 — approved by Aaron after Team A review |
| **Supersedes** | None |
| **Superseded by** | None (this is the canonical implementation plan) |
| **Frozen** | Yes — FROZEN 2026-08-11 |

## Freeze Declaration

Document 5 was frozen 2026-08-11 upon approval by Aaron after Team A evidence review.

This document may only be modified if:
- A baseline finding alters readiness or risk status
- A genuine sequencing conflict is discovered during implementation
- Aaron approves a scope change through governance

It may not be modified to:
- Redefine objects, lifecycle states, signal contracts, or capability contracts from Documents 1–4
- Add new phases without Aaron's approval
- Resolve the RECON Migration Blocker without Aaron's decision
- Change the architecture freeze rule
