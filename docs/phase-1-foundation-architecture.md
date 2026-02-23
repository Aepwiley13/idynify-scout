# Phase 1 — Foundation Architecture Spec

**Status:** Ready for review before implementation
**Branch:** `claude/cleanup-pre-build-S06kE`
**Prerequisite:** Phase 0 cleanup PRs must be merged before any Phase 1 code is written
**Codebase baseline:** Vite 7.2.4 / React 18.3 / react-router-dom 6.26 / Netlify Functions (classic lambda)

---

## Section 1 — `reconHealth` Data Structure

### Problem This Solves

The current RECON module tracks only one bit per section: `status: 'completed' | 'pending' | 'in_progress'`. There is no concept of quality within a completed section, no staleness detection, no awareness of which sections matter most to Barry's output, and no signal when a user's saved ICP settings have drifted away from what their RECON training describes as their target market. The result: Barry has no way to know whether it has strong context or weak context, and the UI has no way to warn users that their training is stale or inconsistent.

### Failure Mode Prevented

Without `reconHealth`, v2 can't surface the coaching prompt at the right moment, can't block the "Train Barry" completion badge when the data is shallow, and can't detect the ICP-vs-RECON conflict that causes Scout to search for companies that don't match what the user actually described.

---

### Storage Location

`dashboards/{userId}` Firestore document — add a top-level `reconHealth` map field alongside the existing `modules` array.

The `completedAt` timestamps that feed freshness checks already exist inside `modules[].sections[].completedAt`. The `reconHealth` object stores only data that cannot be derived purely from section state at read time.

---

### Section Weights

Not all RECON sections contribute equally to Barry's output. These weights reflect observed usage across all four Barry functions (`barryGenerateContext`, `barryGenerateMissionSequence`, `barryGenerateSequenceStep`, `barryICPConversation`):

| Section | Label | Weight | Rationale |
|---------|-------|--------|-----------|
| 1 | Business Foundation | 25 | Used by every Barry call; absence means zero personalization |
| 2 | Product Deep Dive | 20 | Source of truth for sequence content and feature references |
| 3 | Target Market | 15 | Required for Scout ICP alignment and conflict detection |
| 5 | Pain Points | 15 | Required for mission sequence relevance |
| 9 | Messaging | 10 | Required for sequence tone and value prop framing |
| 4 | Psychographics | 5 | Adds depth; not blocking |
| 6 | Buying Behavior | 3 | Supplementary context |
| 7 | Decision Process | 3 | Supplementary context |
| 8 | Competitive Landscape | 3 | Supplementary context |
| 10 | Behavioral Signals | 1 | Edge-case enrichment |
| **Total** | | **100** | |

---

### Critical Sections

The following sections are designated **critical**. A missing or incomplete critical section produces a `criticalGapFlag` and suppresses the "Barry is fully trained" completion indicator.

| Section | Flag Key | Impact |
|---------|----------|--------|
| 1 | `NO_BUSINESS_FOUNDATION` | Barry has zero context — all output is purely generic |
| 2 | `NO_PRODUCT_DETAIL` | Sequence content cannot reference features, use cases, or integrations |
| 3 | `NO_TARGET_MARKET` | Scout ICP alignment cannot be validated |
| 5 | `NO_PAIN_POINTS` | Mission sequences miss buyer motivation context |

---

### JSON Schema

```json
{
  "reconHealth": {
    "icpSnapshotAtLastReconSave": {
      "industries": ["string"],
      "companySizes": ["string"],
      "revenueRanges": ["string"],
      "locations": ["string"],
      "isNationwide": "boolean",
      "savedAt": "ISO-8601 string"
    },
    "lastScoutSearchAt": "ISO-8601 string | null",
    "userRequestedReviewAt": "ISO-8601 string | null"
  }
}
```

**That's the entire stored shape.** All other fields are computed at read time (see Section 5 for the storage vs. computed decision table).

---

### Computed Shape (read-time derivation)

This is the object passed to UI components and Barry functions. It is never stored — it is always derived on demand from the stored `reconHealth` fields plus `modules[].sections[]` state plus `users/{userId}/companyProfile/current`.

```typescript
interface ReconHealthComputed {
  // Completeness
  weightedScore: number;           // 0–100, weighted by section weights above
  completionPct: number;           // 0–100, unweighted (completed sections / 10 * 100)
  completedSectionIds: number[];   // e.g. [1, 2, 3, 5]

  // Freshness (time-based, >90 days)
  stalenessFlags: {
    sectionId: number;
    completedAt: string;           // ISO-8601
    daysSinceUpdate: number;
    isStale: boolean;              // daysSinceUpdate > 90
  }[];
  hasAnyStaleness: boolean;

  // Critical gaps
  criticalGapFlags: (
    | 'NO_BUSINESS_FOUNDATION'
    | 'NO_PRODUCT_DETAIL'
    | 'NO_TARGET_MARKET'
    | 'NO_PAIN_POINTS'
  )[];
  hasCriticalGaps: boolean;

  // Scout ICP conflict (event-based drift)
  scoutConflictFlags: (
    | 'ICP_INDUSTRY_DRIFT'
    | 'ICP_SIZE_DRIFT'
    | 'ICP_LOCATION_DRIFT'
  )[];
  hasScoutConflict: boolean;

  // User-initiated review
  hasUnreviewedSections: boolean;  // any section.completedAt < userRequestedReviewAt
}
```

---

### Derivation Function Signature (client utility)

Location: `src/shared/reconHealth.js` (new file, Phase 1)

```javascript
/**
 * @param {Object} dashboardData    - Firestore dashboards/{userId} document
 * @param {Object} currentIcpProfile - Firestore users/{userId}/companyProfile/current
 * @returns {ReconHealthComputed}
 */
function computeReconHealth(dashboardData, currentIcpProfile) { ... }
```

This function is pure (no Firestore reads). Callers load the two documents, then pass them in. This makes the function testable and cacheable without additional complexity.

---

---

## Section 2 — Unified ICP Scoring Module

### Problem This Solves

Three divergent ICP scoring implementations exist simultaneously:

1. **`src/utils/icpScoring.js`** — weights `{ industry: 50, location: 25, employeeSize: 15, revenue: 10 }`, reads human-readable range strings, supports adjacent-range partial credit.
2. **`netlify/functions/search-companies.js::calculateFitScore`** — weights `{ industry: 30, size: 25, revenue: 20, location: 25 }`, revenue gets full credit if the field merely exists (regardless of match), uses raw integer employee counts.
3. **`ICPSettings.jsx::recalculateAllScores`** — calls implementation #1 and overwrites every company's `fit_score` in Firestore, silently replacing scores written by implementation #2.

`DailyLeads.jsx` and `ScoutDashboardPage.jsx` sort by `fit_score`. Two users with identical ICPs see different lead rankings depending on whether they've ever opened ICP Settings. This is a silent data integrity failure.

### Failure Mode Prevented

Without a single canonical scorer, every new code path that touches `fit_score` will introduce a fourth implementation. The scoring consolidation must happen before any v2 Scout or coaching feature reads ICP match data.

---

### Canonical Location

`src/shared/icpScoring.js` — a pure JavaScript module with zero node-specific or browser-specific imports.

- **Client** imports: `import { calculateICPScore } from '../../shared/icpScoring'`
- **Netlify functions** import: `import { calculateICPScore } from '../../src/shared/icpScoring.js'`
- **`src/utils/icpScoring.js`** is deleted (Phase 0 item 2)
- **`search-companies.js` inline scorer** is deleted and replaced with the import (Phase 0 item 2)
- **`ICPSettings.jsx`** import path updated to `../../shared/icpScoring`

---

### `normalizeCompany()` Input Layer

Apollo, Firestore, and user-saved company records use inconsistent field names for the same concepts. The scorer must not contain any field-name awareness — `normalizeCompany()` resolves all aliases before scoring logic runs.

```javascript
/**
 * Normalize a raw company record (from any source) into a canonical shape
 * for ICP scoring. Resolves all field-name aliases. Returns null for
 * fields that cannot be determined.
 *
 * @param {Object} raw - Company record from Apollo API, Firestore, or UI state
 * @returns {NormalizedCompany}
 */
function normalizeCompany(raw) { ... }

/**
 * @typedef {Object} NormalizedCompany
 * @property {string|null} industry      - Canonical industry string
 * @property {string|null} location      - Two-letter US state or null
 * @property {string|null} employeeRange - Human-readable range e.g. "51-100"
 * @property {string|null} revenueRange  - Human-readable range e.g. "$1M-$2M"
 */
```

**Field resolution rules for `normalizeCompany()`:**

| Output field | Resolution order | Notes |
|---|---|---|
| `industry` | `raw.industry` → `raw.company_industry` → `null` | Never default to 'Accounting' (fixes BUG from search-companies.js:737) |
| `location` | `raw.state` → `raw.location` → `raw.company_location` → `null` | Extract state abbreviation if full address string |
| `employeeRange` | `raw.company_size` (if string) → convert `raw.estimated_num_employees` (integer) to range → convert `raw.employee_count` (integer) to range → `null` | Integer→range mapping: 1-10→"1-10", 11-20→"11-20", etc. |
| `revenueRange` | `raw.revenue` (if range string, pass through) → convert `raw.organization_revenue` (integer) to range → `null` | Revenue display strings from Apollo ("$1.5M") are not range strings and cannot be matched without parsing |

---

### `calculateICPScore()` Function Signature

```javascript
/**
 * Calculate a company's ICP fit score (0–100).
 *
 * @param {NormalizedCompany} company     - Output of normalizeCompany()
 * @param {ICPProfile}        icpProfile  - User's ICP settings document
 * @param {WeightSchema}      [weights]   - Optional override; defaults to DEFAULT_WEIGHTS
 * @returns {ScoredResult}
 */
function calculateICPScore(company, icpProfile, weights = DEFAULT_WEIGHTS) { ... }

/**
 * @typedef {Object} ICPProfile
 * @property {string[]}  industries    - Selected industry strings
 * @property {string[]}  companySizes  - Selected size range strings e.g. ["51-100", "101-200"]
 * @property {string[]}  revenueRanges - Selected revenue range strings
 * @property {string[]}  locations     - Selected US state strings
 * @property {boolean}   isNationwide  - If true, location always matches
 * @property {boolean}   [skipRevenue] - If true, revenue dimension is excluded from scoring
 */

/**
 * @typedef {Object} WeightSchema
 * @property {number} industry      - 0–100 (percentage points)
 * @property {number} location      - 0–100
 * @property {number} employeeSize  - 0–100
 * @property {number} revenue       - 0–100
 * Note: weights must sum to 100. Caller is responsible for validation.
 */

/**
 * @typedef {Object} ScoredResult
 * @property {number} score         - 0–100 final weighted score
 * @property {Object} breakdown     - Per-dimension raw scores and weighted contributions
 * @property {string} scoreVersion  - Semver string e.g. "2.0" — increment on any weight/logic change
 */
```

**Canonical default weights (v2):**

```javascript
export const DEFAULT_WEIGHTS = {
  industry:     50,
  location:     25,
  employeeSize: 15,
  revenue:      10
};

export const SCORE_VERSION = '2.0';
```

The `scoreVersion` field is written to Firestore alongside `fit_score`. When the scorer's logic or defaults change, bump `SCORE_VERSION`. Any admin query can then identify stale scores by filtering `scoreVersion < '2.0'` and trigger a background recalculation.

**Adjacent-range partial credit:** Preserved from the client implementation (the correct one). A company in the range immediately above or below an ICP-selected range receives 50% of that dimension's weight rather than 0.

**`skipRevenue` handling:** If `icpProfile.skipRevenue === true`, redistribute the revenue weight proportionally across the remaining three dimensions before scoring. This prevents a systematic zero on revenue from artificially depressing fit scores when the user explicitly opted out.

---

---

## Section 3 — Barry Coaching Endpoint (`barry-coach-section`)

### Problem This Solves

Barry currently has no feedback loop into RECON quality. A user who types "software" into the "What problem do you solve?" field gets a green checkmark identical to a user who wrote three specific paragraphs. This means the RECON coaching layer (which v2 is building) has no signal to work from.

The coaching endpoint evaluates a single completed RECON section, classifies its quality, and returns specific, actionable coaching feedback that Barry presents to the user inside the section UI.

### Failure Mode Prevented

Without a coaching quality signal, the v2 RECON progress UI cannot distinguish strong training data from placeholder data. The weighted score computed in Section 1's `reconHealth` relies on section-level quality ratings as multipliers — without quality classification, the weighted score degrades to a simple completion count with renamed variables.

---

### Function Location

`netlify/functions/barry-coach-section.js` (new file)

---

### Input Contract

```javascript
// POST /.netlify/functions/barry-coach-section
// Request body (JSON):
{
  "userId":     "string",   // Firebase UID
  "authToken":  "string",   // Firebase ID token
  "sectionId":  1,          // integer 1–10
  "sectionData": {          // The section's data object as stored in Firestore
    // Section-specific fields, e.g.:
    "companyName": "Acme Corp",
    "whatYouDo":   "We help...",
    "coreFeatures": ["Feature A", "Feature B"],
    // ... all fields for this section
  }
}
```

---

### Output Contract

```javascript
// Response body (JSON):
{
  "success": true,
  "coaching": {
    "quality":          "strong" | "weak" | "incomplete",
    "confidenceImpact": -25 | -15 | -10 | 0 | 2 | 5 | 10,
    "headline":         "string",   // One-sentence summary for the UI badge
    "feedback": [                   // 2–4 specific, actionable coaching notes
      {
        "field":   "string | null", // Which field the note targets, or null for general
        "note":    "string",        // The coaching observation
        "example": "string | null"  // Optional: a concrete example of stronger content
      }
    ],
    "strengthNotes": [              // What the user did well (1–2 items, only if quality ≥ weak)
      "string"
    ],
    "coachVersion": "1.0"           // Increment when prompt or scoring logic changes
  }
}
```

---

### Quality Scoring Model

Quality is assessed by Claude against the following rubric. The rubric is injected into the system prompt — it is not evaluated programmatically before the Claude call.

| Classification | Criteria |
|---|---|
| **`strong`** | ≥3 substantive responses; no empty or placeholder values; array fields have ≥2 specific items; free-text fields contain ≥20 words with concrete detail (company names, specific features, real numbers); responses are specific to this user's business, not generic |
| **`weak`** | Section is "completed" but responses are surface-level; <2 items in multi-selects; free-text fields are vague, generic, or <10 words; key fields filled with placeholders (e.g. "TBD", "software", "various") |
| **`incomplete`** | ≥1 required field for this section is null, empty string, or empty array despite `status === 'completed'`; or section `status !== 'completed'` |

**`confidenceImpact` delta values** — how much this section's quality changes Barry's effective context confidence:

| Quality | Section weight tier | confidenceImpact |
|---|---|---|
| `strong` | High (s1, s2, s3, s5) | `+10` |
| `strong` | Medium (s9) | `+5` |
| `strong` | Low (s4, s6, s7, s8, s10) | `+2` |
| `weak` | High (s1, s2, s3, s5) | `-15` |
| `weak` | Medium | `-10` |
| `weak` | Low | `-5` |
| `incomplete` | Critical (s1, s2, s3, s5) | `-25` |
| `incomplete` | Non-critical | `-10` |

These deltas accumulate into a `contextConfidenceScore` displayed in the RECON health dashboard. A fully completed, all-strong RECON profile would have a `contextConfidenceScore` of 100. The baseline (all sections missing) is 0.

---

### Streaming Architecture

The current Netlify Functions in this codebase use the classic lambda pattern (request → complete response). The coaching endpoint **follows the same non-streaming pattern** to stay consistent and avoid introducing a new runtime dependency (Netlify Functions v2 or Edge Functions) in Phase 1.

The coaching response is capped at `max_tokens: 800`. At typical Claude throughput, this completes in under 3 seconds — acceptable for a user-triggered action (tapping "Get coaching feedback" after saving a section). Streaming is documented as a Phase 2 upgrade path if latency becomes a UX concern.

**Future streaming upgrade path (Phase 2 only):**
- Migrate to Netlify Functions v2 with `stream: true`
- Frontend switches from `await response.json()` to consuming a `ReadableStream`
- Quality classification token emitted first as a structured prefix, coaching notes stream after

---

### Claude Call Parameters

```javascript
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',          // Current production model
  max_tokens: 800,
  messages: [{
    role: 'user',
    content: coachingPrompt             // Section data + rubric injected here
  }]
});
```

**Token logging:** Per Phase 0 item 5 requirements, both `response.usage.input_tokens` and `response.usage.output_tokens` are captured and logged via `logApiUsage()` metadata.

---

---

## Section 4 — Route-Level Code Splitting (Vite + React.lazy)

### Problem This Solves

`src/App.jsx` currently imports 40+ page components as static ES imports at the top of the file. Every import is included in the initial JavaScript bundle regardless of which route the user visits. The result is a 1.9MB uncompressed initial payload. A user who logs in to check the Hunter dashboard downloads the entire RECON section editor tree before seeing anything.

### Failure Mode Prevented

Bundle size above ~400kb (uncompressed) causes measurable Time to Interactive regressions on mobile networks. The coaching UI being built in Phase 1 adds more component weight. Splitting before adding v2 components prevents the bundle from growing past a recoverable threshold.

---

### Migration Plan

**Phase 4a — Route-level lazy loading (this PR)**

Replace all static page imports in `App.jsx` with `React.lazy(() => import(...))` and wrap the router in a single `<Suspense fallback={<AppLoadingShell />}>`.

No component logic changes. No refactoring. Only the import style changes.

**Chunk groupings** (via `webpackChunkName` magic comments for readable bundle names):

```javascript
// Auth cluster — always tiny, can be eager
const Login             = lazy(() => import(/* webpackChunkName: "auth" */ './pages/Login'));
const Signup            = lazy(() => import(/* webpackChunkName: "auth" */ './pages/Signup'));
const ForgotPassword    = lazy(() => import(/* webpackChunkName: "auth" */ './pages/ForgotPassword'));

// RECON cluster — large, only loaded on /recon routes
const ReconOverview     = lazy(() => import(/* webpackChunkName: "recon" */ './pages/Recon/ReconOverview'));
const ReconModulePage   = lazy(() => import(/* webpackChunkName: "recon" */ './pages/Recon/ReconModulePage'));
const ReconSectionEditor= lazy(() => import(/* webpackChunkName: "recon" */ './pages/Recon/ReconSectionEditor'));
const BarryTraining     = lazy(() => import(/* webpackChunkName: "recon" */ './pages/Recon/BarryTraining'));
const RECONModulePage   = lazy(() => import(/* webpackChunkName: "recon" */ './pages/RECONModulePage'));
const RECONSectionPage  = lazy(() => import(/* webpackChunkName: "recon" */ './pages/RECONSectionPage'));

// Scout cluster — large, only loaded on /scout routes
const ScoutMain         = lazy(() => import(/* webpackChunkName: "scout" */ './pages/Scout/ScoutMain'));
const ScoutDashboardPage= lazy(() => import(/* webpackChunkName: "scout" */ './pages/ScoutDashboardPage'));
const DailyLeads        = lazy(() => import(/* webpackChunkName: "scout" */ './pages/Scout/DailyLeads'));
const AllLeads          = lazy(() => import(/* webpackChunkName: "scout" */ './pages/Scout/AllLeads'));
const CompanyDetail     = lazy(() => import(/* webpackChunkName: "scout" */ './pages/Scout/CompanyDetail'));
const ContactProfile    = lazy(() => import(/* webpackChunkName: "scout" */ './pages/Scout/ContactProfile'));
const ICPSettings       = lazy(() => import(/* webpackChunkName: "scout" */ './pages/Scout/ICPSettings'));
const ScoutGame         = lazy(() => import(/* webpackChunkName: "scout" */ './pages/Scout/ScoutGame'));
// ... remaining Scout pages

// Hunter cluster
const HunterDashboard   = lazy(() => import(/* webpackChunkName: "hunter" */ './pages/Hunter/HunterDashboard'));
const CreateMission     = lazy(() => import(/* webpackChunkName: "hunter" */ './pages/Hunter/CreateMission'));
const MissionDetail     = lazy(() => import(/* webpackChunkName: "hunter" */ './pages/Hunter/MissionDetail'));
// ... remaining Hunter pages

// Admin cluster — rarely accessed, no user-facing impact if it loads slowly
const AdminDashboard    = lazy(() => import(/* webpackChunkName: "admin" */ './pages/Admin/AdminDashboard'));
const UserDetail        = lazy(() => import(/* webpackChunkName: "admin" */ './pages/Admin/UserDetail'));
// ... remaining Admin pages

// Onboarding cluster — first-run only
const BarryOnboarding   = lazy(() => import(/* webpackChunkName: "onboarding" */ './pages/Onboarding/BarryOnboarding'));
const GettingStarted    = lazy(() => import(/* webpackChunkName: "onboarding" */ './pages/GettingStarted'));
```

---

### `vite.config.js` Changes Required

```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor splitting — lock framework code to stable cache entries
          'vendor-react':    ['react', 'react-dom', 'react-router-dom'],
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          'vendor-ui':       ['lucide-react'],
        }
      }
    }
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },
});
```

---

### Suspense Boundary Placement

One boundary at the router level is sufficient for Phase 4a. Do not add nested Suspense boundaries inside route components until Phase 4b (component-level splits).

```jsx
// In App.jsx — the single Suspense boundary wraps all routes
function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<AppLoadingShell />}>
        <Routes>
          {/* ... all Route definitions unchanged */}
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
```

`AppLoadingShell` is a minimal skeleton component (no Firestore reads, no auth checks) that renders the nav frame with a spinner. It should be statically imported, never lazy.

---

### Expected Bundle Impact After Phase 4a

| Chunk | Approx. size (gzipped) | Loaded on |
|---|---|---|
| Initial shell (App + auth + router) | ~80–120 kb | Every page load |
| vendor-react | ~45 kb | Every page load (cached) |
| vendor-firebase | ~35 kb | Every page load (cached) |
| vendor-ui (lucide-react) | ~20 kb | Every page load (cached) |
| recon chunk | ~300–400 kb | /recon/* routes only |
| scout chunk | ~250–350 kb | /scout/* routes only |
| hunter chunk | ~200–300 kb | /hunter/* routes only |
| admin chunk | ~150–200 kb | /admin/* routes only |

**Initial payload (first visit, no cache):** ~200–220 kb gzipped. Below the 200 kb uncompressed target after Phase 4b component-level splits bring the initial shell lower.

---

### Phase 4b — Component-Level Splits (after Phase 4a is stable)

Not in scope for this PR. Documented here to guide future work:

1. RECON section components (`Section1Foundation` through `Section10BehavioralSignals`) — lazy-load per section inside `ReconSectionEditor`
2. `BarryContext`, `BarryInsightPanel` — lazy within `ContactProfile` (these pull in the Anthropic call plumbing even for contacts where Barry hasn't been run)
3. Heavy chart components in `AdminDashboard` — lazy per admin tab

---

---

## Section 5 — Context Health System Freshness Rules

### Problem This Solves

RECON training data becomes misleading when it's old (the business changed), when ICP settings diverge from what RECON describes, or when the user has explicitly flagged sections for review but not yet acted on them. Without freshness rules, the system has no way to downgrade context confidence or prompt re-training — RECON always appears as "done" once completed.

### Failure Mode Prevented

A user who completed RECON 18 months ago and has since pivoted their target market will receive Barry coaching based on outdated business context. Without staleness detection, neither the user nor Barry knows the context is stale. The coaching endpoint (Section 3) and the weighted score (Section 1) both silently use incorrect data.

---

### Trigger Types and Storage Decision

| Signal | Type | Stored? | Computed at read time? | Location |
|---|---|---|---|---|
| Per-section `completedAt` timestamp | Time-based | Yes (in `modules[].sections[].completedAt`) | No | Existing Firestore field |
| Section freshness flag (>90 days) | Time-based | **No** | **Yes** | Derived from `completedAt` vs `Date.now()` |
| ICP settings at time of RECON Section 3 save | Event-based | **Yes** | No | `reconHealth.icpSnapshotAtLastReconSave` |
| ICP drift flags (`ICP_INDUSTRY_DRIFT`, etc.) | Event-based | **No** | **Yes** | Derived by comparing current ICP vs snapshot |
| User-requested review timestamp | User-initiated | **Yes** | No | `reconHealth.userRequestedReviewAt` |
| Sections needing review (after user request) | User-initiated | **No** | **Yes** | Derived: `section.completedAt < userRequestedReviewAt` |
| Last Scout search timestamp | Event trigger | **Yes** | No | `reconHealth.lastScoutSearchAt` |
| Weighted completeness score | Completeness | **No** | **Yes** | Derived from section statuses + weights |
| Critical gap flags | Completeness | **No** | **Yes** | Derived from which critical sections are missing |

**Rationale for preferring computed over stored:**
Stored freshness flags create a race condition: a flag is written as "stale", then the user immediately re-trains a section, but the flag hasn't been cleared yet. Computed-at-read-time derivations are always accurate because they read from the source of truth (timestamps, live ICP settings) without an intermediary state to get out of sync.

---

### Time-Based Freshness Rule

**Threshold:** 90 days from `section.completedAt`

**Scope:** Per-section, not global. A single stale section produces a per-section freshness flag, not a blanket "RECON is stale" indicator. The UI surfaces which specific section needs re-evaluation.

**Derivation logic:**

```javascript
const STALENESS_DAYS = 90;

function isSectionStale(section) {
  if (!section.completedAt) return false;
  const completedDate = new Date(section.completedAt);
  const daysSince = (Date.now() - completedDate.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince > STALENESS_DAYS;
}
```

**Why 90 days?** Business positioning (product features, target market, competitive set) changes meaningfully on a quarterly cadence for early-stage companies. Anything completed inside a quarter is still fresh enough for Barry's coaching to be accurate. Beyond 90 days, a re-validation prompt is appropriate.

---

### Event-Based Freshness Rule — Scout ICP Drift

**Trigger:** User saves ICP settings (`users/{userId}/companyProfile/current`) after having completed RECON Section 3 (Target Market).

**Mechanism:**
1. When RECON Section 3 is saved as `completed`, the current ICP profile fields (`industries`, `companySizes`, `revenueRanges`, `locations`, `isNationwide`) are snapshotted into `reconHealth.icpSnapshotAtLastReconSave`.
2. At read time, `computeReconHealth()` compares the live ICP profile against the snapshot.
3. Divergence beyond the tolerance rules below produces a `scoutConflictFlag`.

**Drift detection rules:**

| Flag | Condition |
|---|---|
| `ICP_INDUSTRY_DRIFT` | `currentIcp.industries` has no overlap with `snapshot.industries` (completely different industry selections) |
| `ICP_SIZE_DRIFT` | `currentIcp.companySizes` has no overlap with `snapshot.companySizes` AND `snapshot.companySizes` was non-empty |
| `ICP_LOCATION_DRIFT` | `currentIcp.isNationwide !== snapshot.isNationwide` OR (`currentIcp.locations` has no overlap with `snapshot.locations` AND `snapshot.locations` was non-empty) |

**Partial overlap is not flagged.** A user who added new industries to their ICP without removing the original ones is expanding scope, not drifting. Only zero-overlap constitutes a conflict that warrants a warning.

**Snapshot write location:** `reconHealth.icpSnapshotAtLastReconSave` is written by the **RECON section save handler** (whichever Netlify function or client code marks Section 3 as `completed`), not by the ICP settings save handler. The snapshot captures "what the ICP looked like when RECON was trained against it."

---

### User-Initiated Freshness Trigger

**Mechanism:** User taps "Mark all for review" in the RECON health dashboard. This writes `reconHealth.userRequestedReviewAt = new Date().toISOString()`.

**Derivation:** At read time, any section where `section.completedAt < reconHealth.userRequestedReviewAt` is flagged as `needsReview: true`. The section is not reverted to `pending` — it retains its `completed` status and data. The review flag is a soft prompt, not a hard block.

**Clearing the flag:** When a section is re-saved after `userRequestedReviewAt` (i.e., the section's new `completedAt` is ≥ `userRequestedReviewAt`), the review flag clears automatically via the computed derivation — no explicit clear operation needed.

---

### Implementation Note — No Background Jobs Required

All freshness computations are synchronous, in-memory derivations performed once per page load (or on-demand when a component mounts). There are no scheduled Cloud Functions, no Pub/Sub triggers, and no background jobs associated with the freshness system.

The only Firestore writes in the freshness system are:
1. `reconHealth.icpSnapshotAtLastReconSave` — written when Section 3 is completed
2. `reconHealth.userRequestedReviewAt` — written when user taps "Mark for review"
3. `reconHealth.lastScoutSearchAt` — written when a Scout search completes (already a write event)

All other freshness state is ephemeral and derived on demand.

---

*End of Phase 1 Foundation Architecture Spec*
*Generated: 2026-02-23*
*Branch: claude/cleanup-pre-build-S06kE*
