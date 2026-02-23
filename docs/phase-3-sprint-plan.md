# Phase 3 — Sprint Plan

**Status:** In review
**Branch:** `claude/cleanup-pre-build-S06kE`
**Prerequisites:** Phase 0 cleanup merged. Phase 1 foundation confirmed. Phase 2 interaction spec confirmed.

---

## Ground Rules

- **Mobile-first at every sprint.** No sprint ships a UI component that hasn't been validated at 375px.
- **No sprint ships UI that depends on an unconfirmed backend contract.** If the endpoint isn't tested, the UI doesn't land.
- **Barry is an analyst — not a productivity tool.** Every sprint review asks: "Does Barry seem smarter or just busier?" If the answer is busier, the sprint failed.
- **The test at the end of every sprint:** Does this move a user closer to thinking "Barry actually knows my business"?

---

## Sequence Logic

Sprint 1 cleans the codebase. Sprint 2 locks the data model. Sprint 3 puts the coaching contract and performance baseline in place. Sprint 4 ships the experience reframe. Sprint 5 makes the intelligence engine visible. Sprint 6 hardens everything and documents what comes next.

No sprint borrows from an unvalidated prior sprint. The gates are real.

---

## Sprint 1 — Phase 0 Cleanup

**Theme:** Codebase is clean before v2 starts. No new features.

### What Ships

All five Phase 0 items merged in a single PR sequence:

1. `src/utils/reconCompiler.js` deleted. Zero imports of it anywhere in the codebase.
2. `src/utils/icpScoring.js` consolidated into `src/shared/icpScoring.js`. `ICPSettings.jsx` import path updated. Old file deleted.
3. Array serialization bug fixed in `netlify/functions/utils/reconCompiler.js` — `typeof val === 'string'` replaced with `sanitizeReconSection()` helper across all 9 section-compilation blocks.
4. Null guards normalized across all four Barry Netlify functions — zero `|| null` patterns where the value reaches a prompt string.
5. Token instrumentation live: all four Barry functions (`barryGenerateContext`, `barryMissionChat`, `barryGenerateMissionSequence`, `barryGenerateSequenceStep`) log `inputTokens`, `outputTokens`, and `reconPresent: !!reconContext` in every `logApiUsage()` metadata block.

### Who Owns It

Backend for items 1, 3, 4, 5. Both for item 2 (`ICPSettings.jsx` import path is frontend, `search-companies.js` scoring call is backend).

### Definition of Done

- `grep -r "from '../../utils/icpScoring'" src/` returns zero results.
- `grep -r "from '../utils/reconCompiler'" src/` returns zero results.
- A Barry call on a test account with Section 2 completed (including `coreFeatures` array) produces a prompt that includes the array values — confirmed by inspecting the compiled prompt string in logs.
- All four Barry functions write `inputTokens`, `outputTokens`, and `reconPresent` to Firestore `apiLogs` within one production call. Confirmed by checking a real `apiLogs` document post-deployment.
- `scoreVersion: '2.0'` appears in Firestore alongside every `fit_score` write after deployment.
- CI passes. Zero console errors on RECON module load.

### The Risk

ICP scorer consolidation (item 2) touches Firestore score persistence for all users. `ICPSettings.jsx` currently rewrites every company's `fit_score` on each ICP save — after consolidation, the new `normalizeCompany()` input layer must map field aliases correctly or all company scores change silently. Test against 5+ real user profiles in staging before merging.

### Gate Before Sprint 2

Two weeks of token usage data collected post-deployment. Confirm: (a) what percentage of Barry calls include RECON context, (b) approximate cost delta for RECON-enhanced vs. non-RECON calls, (c) no regressions in Barry output quality. This data is the input to the coaching endpoint's cost model in Sprint 3.

---

## Sprint 2 — reconHealth + Unified ICP Scoring

**Theme:** The data model is right before any UI touches it.

### What Ships

1. `src/shared/reconHealth.js` — exports `computeReconHealth(dashboardDoc, icpDoc)` and `assessSectionQuality(sectionId, sectionData)`.
2. `src/shared/reconHealthConstants.js` — exports `SECTION_WEIGHTS`, `CRITICAL_SECTIONS`, `FALLBACK_ASSUMPTIONS` (one string per dimension, Barry's literal working assumption), and `STALENESS_DAYS = 90`.
3. `computeReconHealth()` computes at read time from live documents — no Firestore writes on read. Returns `{ weightedScore, criticalGaps, staleFlags, conflictFlags }`.
4. `assessSectionQuality(sectionId, sectionData)` is a deterministic function (no LLM, no API) that classifies section data as `'strong' | 'weak' | 'incomplete'` using the same rubric as the coaching endpoint — field count, array length, text length thresholds.
5. `icpSnapshotAtLastReconSave` written to `dashboards/{userId}.reconHealth` when `completeSection()` is called for section `s3`. Hook added in `dashboardUtils.js:completeSection()`.
6. `src/shared/icpScoring.js` (from Sprint 1) confirmed as the canonical scorer for both `ICPSettings.jsx` and `search-companies.js`. `scoreVersion: '2.0'` validated in production.

**Key architectural decision:** `assessSectionQuality()` is deterministic. It derives tile states without any API dependency. The LLM coaching endpoint (Sprint 3) uses the same rubric in its prompt and produces coaching *text* — but the Knowledge Map (Sprint 4) uses the deterministic function so tiles render instantly with no network call.

### Who Owns It

Backend for `reconHealth.js`, `reconHealthConstants.js`, and the `completeSection()` hook. Frontend for validating `ICPSettings.jsx` import path and confirming `computeReconHealth()` is consumable from a React component.

### Definition of Done

- `computeReconHealth(dashboardDoc, icpDoc)` tested against 5+ real user profiles. Returns accurate `weightedScore` in all cases. Returns in under 200ms with no network calls.
- `assessSectionQuality(1, {})` returns `'incomplete'`. Called with a Section 1 object containing 3+ substantive string fields returns `'strong'`. Called with 1 short text field returns `'weak'`.
- ICP snapshot write confirmed: completing Section 3 on a test account → `dashboards/{uid}.reconHealth.icpSnapshotAtLastReconSave` contains the ICP state at time of completion.
- Conflict detection tested: changing ICP industry after completing Section 3 → `computeReconHealth()` returns `conflictFlags: ['icp_industry_mismatch']` on next call.
- No false positive conflict flags on 5 test profiles reviewed.

### The Risk

`normalizeCompany()` field alias resolution is the highest-risk mapping in the entire build. If the Apollo field name (`estimated_num_employees`) doesn't resolve to the canonical name (`employeeCount`) correctly, every company score from `search-companies.js` changes without warning. Compare `fit_score` rankings for 5 test companies before and after — ordering should remain consistent even if absolute values shift (v2 weights are deliberately different from v1).

### Gate Before Sprint 3

`computeReconHealth()` live in staging, consuming real user data, returning correct results with no false positives. The function confirmed importable from both a React component and a Netlify function without bundling errors. No regressions on section save or ICP save flows.

---

## Sprint 3 — barry-coach-section Endpoint + Route-Level Code Splitting

**Theme:** Backend coaching contract live. Performance baseline established.

### What Ships

**Backend:**

1. `netlify/functions/barry-coach-section.js` — full implementation per Phase 1 and Phase 2 specs.
   - Input: `{ userId, sectionId, sectionData, authToken }`
   - Output: `{ quality: 'strong'|'weak'|'incomplete', mirror: string, inference: string, confidenceImpact: number, coachVersion: '1.0' }`
   - Gap Warning path: when `quality === 'incomplete'` for a critical section, `inference` is replaced by a `gapWarning` field. No Inference block returned.
   - 800-token response cap. Claude model: `claude-sonnet-4-6`.
   - `logApiUsage()` instrumented: `sectionId`, `quality`, `inputTokens`, `outputTokens`.

**Frontend:**

2. All 40+ page imports in `App.jsx` converted to `React.lazy()`.
3. `AppLoadingShell.jsx` — statically imported skeleton shown during route chunk loading. No spinner. No blank flash.
4. `vite.config.js` `manualChunks` configured: `auth`, `recon`, `scout`, `hunter`, `admin`, `onboarding`.

**Critical UX contract established in this sprint (implemented in Sprint 5):** The section save toast fires on Firestore write success — before the coaching response returns. The coaching call is fire-and-forget from the save handler's perspective. `BarryCoachingResponse.jsx` (Sprint 5) renders a skeleton immediately, fills in when the response arrives. If the user navigates away before it arrives, no harm — `assessSectionQuality()` provides the tile state deterministically. This contract is documented here so Sprint 5 implements it correctly.

### Who Owns It

Backend for the coaching endpoint. Frontend for code splitting.

### Definition of Done

- `barry-coach-section` POST with a valid Section 2 payload (3+ substantive fields) returns `quality: 'strong'` and a `mirror` that references the user's actual input — not a generic paraphrase — within 5 seconds.
- `barry-coach-section` POST with an empty Section 9 `valueProp` field returns `quality: 'incomplete'` and a `gapWarning` string (no `inference` field).
- `barry-coach-section` POST with one-word answers returns `quality: 'weak'` and an `inference` that explicitly names what Barry cannot infer.
- Bundle analysis (`vite build --report`) confirms initial chunk under 220kb uncompressed. No RECON page components in the initial chunk.
- All routes load correctly in staging after lazy migration. Zero console errors on route navigation.
- Lighthouse Performance on `/recon` improves by ≥10 points vs. pre-split baseline on simulated Fast 3G.

### The Risk

Netlify Function cold start (1–3 seconds) combined with Claude API latency produces a 4–7 second coaching response window. If this latency is not handled in the UX contract (save toast fires before coaching returns), users perceive a broken save. The fire-and-forget contract above is the mitigation — validate it works correctly before Sprint 5 builds the component.

Separately: lazy imports fail silently on incorrect import paths. Test every route in staging post-split, not just the happy path.

### Gate Before Sprint 4

Coaching endpoint tested against all three quality classifications — strong, weak, incomplete. Cost-per-section-coaching confirmed acceptable relative to Sprint 1 baseline data. All route chunks loading correctly in staging. No regressions on existing RECON section save flow.

---

## Sprint 4 — Knowledge Map v2

**Theme:** The experience reframe ships.

### What Ships

1. `ReconOverview.jsx` restructured — Knowledge Map promoted to full-width front door. Module cards moved below the map.
2. `KnowledgeMapTile.jsx` — new component. Renders one of five states using CSS classes: `.km-tile--strong`, `.km-tile--weak`, `.km-tile--stale`, `.km-tile--conflict`, `.km-tile--empty`.
3. State derivation via `computeReconHealth()` and `assessSectionQuality()` from Sprint 2. No API calls in this render path.
4. `BarryConfidenceDisplay.jsx` — live 0–100 numeric score with 400ms counter animation. Color-keyed. Session Δ delta displayed after any section save increases the score.
5. Hover state on weak and stale tiles: shows Barry's `fallbackAssumption` string from `FALLBACK_ASSUMPTIONS` in `reconHealthConstants.js`. This is the literal string Barry uses when the section is absent — not a prompt to fill it out, not a warning. The assumption itself.
6. Train Next contextual panel — in-map, updates based on `criticalGaps` from `computeReconHealth()`.
7. Mobile layout: 2-column tile grid on viewports ≤ 768px. Train Next as bottom-anchored strip on mobile.

### Who Owns It

Frontend. Depends on `computeReconHealth()` and `assessSectionQuality()` from Sprint 2. No dependency on the coaching endpoint.

### Definition of Done

- All five tile states render correctly in a QA walkthrough using a single test account manipulated across states.
- Priority order confirmed: conflict tile renders over stale tile when both conditions apply to the same section.
- Hover on a weak tile shows the correct `fallbackAssumption` string for that section's dimension — not a generic message.
- Confidence score counter animates (400ms) when a section is completed. Session Δ shows `↑ +N` after a score-increasing save.
- Fresh test account (zero sections completed): all tiles in `empty` state, score = 0, Train Next points to Section 1.
- Mobile viewport at 375px: tiles render 2-column without overflow, Train Next strip is bottom-anchored, text is not truncated.
- Existing section navigation (click tile → navigate to section editor) works unchanged.
- Zero console errors on first-time user load.

### The Risk

Restructuring `ReconOverview.jsx` is the primary RECON entry point. A regression here blocks users from reaching any section. Test all 10 section navigation paths post-restructure before merging.

Returning users see a significantly changed layout without explanation. Add a one-time acknowledgement state for users who had previously completed sections — not a modal, not a tour, just a changed header state on first load that acknowledges the rebuild.

### Gate Before Sprint 5

Five internal users experience the new Knowledge Map front door on mobile and answer one question: "Does this feel like an intelligence engine or a status dashboard?" If the majority answer "dashboard," the visual hierarchy is wrong — module cards are competing with the map, or the confidence score isn't prominent enough. Fix this before Sprint 5 layers Barry's voice on top of it.

---

## Sprint 5 — Barry Coaching Live + Live Output Preview

**Theme:** The intelligence engine is visible.

### What Ships

**Barry coaching in the section editor:**

1. `BarryCoachingResponse.jsx` — renders Mirror + Inference response below the section form after save. Skeleton state renders immediately on submit, fills in when coaching response arrives. `confidenceImpact`-keyed rendering: strong response shows full Mirror + Inference; weak response shows hedged Inference with an explicit statement of what's missing; incomplete critical section shows Gap Warning (no Inference block).
2. Integration in `ReconSectionEditor.jsx`: coaching call fires in parallel with the Firestore save. Save toast fires on Firestore success. Coaching response renders asynchronously — does not block save confirmation.
3. Gap Warning component: standalone block with the gap description and a link that navigates to the first empty required field in the flagged section.

**Live Output Preview:**

4. `LiveOutputPreview.jsx` — on-demand reveal panel in `ReconOverview.jsx`. Five threshold state previews keyed to `weightedScore` ranges (0–39, 40–64, 65–84, 85–94, 95–100). All previews use `PREVIEW_PERSONA = { name: 'Marcus Reyes', company: 'HealthOps', title: 'Director of Operations' }` — same persona across all five states so users can see what changed.
5. Threshold crossing triggers a 200ms opacity fade transition. No API calls from the preview panel — all threshold content is pre-authored.
6. Greyed-out unlockable slots below the 95% threshold. Each slot names the specific section that unlocks it. Clicking a greyed slot navigates to that section's editor.
7. Five-step threshold progress indicator above the preview.

**First-time user experience:**

8. When all sections are `pending` status: `ReconOverview.jsx` shows zero module cards, zero RECON explanation, one CTA — "Start training →" navigating to Section 1.

### Who Owns It

Frontend. Depends on `barry-coach-section` endpoint from Sprint 3 and the Knowledge Map layout from Sprint 4.

### Definition of Done

- Complete Section 2 with strong data on a test account → Barry shows Mirror that references the user's actual `coreFeatures` and `useCases` values (not generic product language) and Inference with 3+ operational statements.
- Complete Section 2 with one-word answers → Inference block is hedged, explicitly names the gap. No fabricated specifics.
- Complete Section 9 with an empty `valueProp` field → Gap Warning renders. No Inference block. Gap Warning link navigates to the correct empty field.
- Save confirmation toast fires **before** coaching response arrives. Coaching fills in asynchronously without a page reload.
- Fresh account visiting `/recon` for the first time: zero module cards visible. Single "Start training →" CTA. No other content.
- `LiveOutputPreview` shows the correct threshold state for the current `weightedScore`. Greyed slots name the correct unlocking sections.
- Completing sections that push the score across a threshold triggers the preview fade transition.
- `PREVIEW_PERSONA` is consistent — Marcus Reyes appears in all five threshold states.
- Zero console errors. No regression in section save flow.

### The Risk

Barry's coaching copy will be wrong on first pass. The `fallbackAssumption` strings, Gap Warning messages, and Mirror/Inference prompt templates are product copy — not developer copy. These require a dedicated review pass before this sprint ships. Bad Barry copy damages trust faster than no copy at all. Budget a full day for copy review and prompt iteration before sprint close.

### Gate Before Sprint 6

End-to-end test: one team member completes all 10 RECON sections from cold start, reading every coaching response. The question for each response: "Does this demonstrate that Barry read my actual input, or does it read like it could apply to anyone?" Every response must pass. Any that fail get their prompt revised before Sprint 6 starts.

---

## Sprint 6 — Hardening, Edge Cases, First-Time UX, Post-MVP Spec

**Theme:** Ship it right. Document what's next.

### What Ships

**Edge cases and hardening:**

1. Section downgrade path: user re-saves a section with weaker data (fewer fields, shorter answers) → tile correctly transitions from `strong` to `weak`. Confidence score decrements with animation.
2. ICP conflict detection confirmed in production: change ICP industry settings after completing Section 3 → `conflict` tile state renders on next `/recon` load within one page refresh.
3. Session delta confirmed: visit `/recon`, complete a section, return to `/recon` → Δ delta reflects the score change from this session. Delta resets on new session.
4. `reconHealth.lastScoutSearchAt` written on Scout search completion — hook confirmed in `search-companies.js` response handler.
5. `userRequestedReviewAt` write path confirmed: user-triggered review request stores timestamp, staleness flag clears, section enters review state.
6. All four Barry functions confirmed zero `[undefined]` strings in any generated output. Sweep `netlify/functions/utils/reconCompiler.js` for any unguarded field access that survives `sanitizeReconSection()`.

**Mobile hardening:**

7. Tap-hold interaction on Knowledge Map tiles triggers hover content (tooltip) on iOS and Android — no desktop-only hover states.
8. `BarryCoachingResponse.jsx` confirmed readable at 375px — no text overflow, correct font size, skeleton state does not cause layout shift.

**Performance validation:**

9. Lighthouse TTI on `/recon` confirmed under 3 seconds on Fast 3G simulation in Chrome DevTools, post all Sprint 5 components landing.
10. Section-level code splitting within the `recon` chunk — if any individual RECON section editor component exceeds 50kb, split it.

**Post-MVP spec (documented, not built):**

11. `docs/post-mvp-assumption-first-dialogue.md` — full specification for Barry's Assumption-First Dialogue:
    - Trigger: user opens a RECON section for the first time.
    - Barry pre-populates working assumptions from domain, LinkedIn data, and existing CRM signals.
    - User confirms, overrides, or sharpens — starts at ~60% complete rather than blank.
    - Storage of user-confirmed assumptions separate from raw section data.
    - Integration points with `barryGenerateContext` and `barryGenerateSequenceStep`.
    - This spec is the input to the next build cycle. It does not ship in this sprint.

### Who Owns It

Both. Performance validation is frontend. Edge case logic and `lastScoutSearchAt` hook are backend. Mobile hardening is frontend. Post-MVP spec is shared.

### Definition of Done

- ICP conflict tile renders in a QA walkthrough where ICP and RECON Section 3 snapshot deliberately disagree.
- Tile downgrade: re-saving Section 2 with one core feature (was five) transitions tile from `strong` to `weak` with score decrement animation.
- Session delta renders correctly after a within-session score increase.
- Zero `[undefined]` strings in any Hunter-generated output across a 20-sequence test run.
- Tap-hold on mobile triggers Knowledge Map tile tooltip on both iOS Safari and Android Chrome.
- Lighthouse TTI confirmed under 3 seconds on Fast 3G.
- `docs/post-mvp-assumption-first-dialogue.md` committed, reviewed, and marked ready for the next build cycle.

### The Risk

Sprint 6 is the scope creep sprint. Assumption-First Dialogue is post-MVP — it gets specced here, not built. If the team starts building it, Sprint 6 never closes and the entire v2 rebuild stays in progress. The spec is the deliverable. Hold the line.

### The Final Gate

A new user creates an account, visits RECON v2, and completes all 10 sections cold. At the end of the session, they answer one question:

**"Does Barry actually know my business?"**

That's the only definition of done that matters for this entire document. Everything in Phases 0–3 was in service of that sentence.

---

## Post-MVP: Assumption-First Dialogue

Before a user types a single word, Barry arrives pre-loaded — pulls from their domain, LinkedIn, existing CRM data — and presents working assumptions. Users confirm and sharpen, not build from nothing. They start at 60% complete.

This is what turns RECON from a setup step into a product differentiator. It is not in this sprint plan. It is what the next build cycle is for.
