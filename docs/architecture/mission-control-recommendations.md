# Mission Control Recommendation Architecture
## Verified: July 28, 2026

## Architecture Contract

```
┌─────────────────────────────────────┐
│        Recommendation Engine        │
│                 ↓                   │
│         Mission Control             │
│         ├── Today's Priorities      │
│         └── Barry Orientation       │
│              (reads, does not set)  │
└─────────────────────────────────────┘
```

Mission Control is the single source of truth for recommendations. Barry may
summarize, rephrase, or explain the highest priority — and may mention
supporting context, replies, or matches — but may never present a different
priority as the highest priority than the recommendation engine. Barry consumes
priority data. Barry does not determine it.

## Verification Findings

### 1. `BarryChatPanel` is mounted on the live page

`src/pages/Scout/MissionControlDashboardV2.jsx`

- Line 15 — `import BarryChatPanel from '../../components/dashboard/BarryChatPanel';`
- Line 913 — `<BarryChatPanel ... />` rendered inside the live dashboard.

Not dead code; it renders on every Mission Control load.

### 2. The orientation fetch already sends `context.topPriority`

`src/components/dashboard/BarryChatPanel.jsx:423-427`

```js
const res = await fetch('/.netlify/functions/barryOrientationBrief', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId, authToken, context: kpiContext }),
});
```

`kpiContext` already carries `topPriority`, so `context.topPriority` reaches the
endpoint with no additional network request and no second pipeline.

### 3. Closure in scope at `loadOpeningBrief`

The `kpiContext` prop is assembled at the mount site
(`src/pages/Scout/MissionControlDashboardV2.jsx:913-927`):

```jsx
<BarryChatPanel
  userId={activeUserId || auth.currentUser?.uid}
  kpiContext={{
    totalMatches,
    highFit,
    totalReplies: cadenceReplies,
    topPriority: (!recsError && recommendations[0]) ? {
      title:   recommendations[0].title,
      reason:  recommendations[0].reason,
      urgency: recommendations[0].urgency,
    } : null,
  }}
  kpiContextReady={kpisLoaded && !recsLoading}
  T={T}
/>
```

The fetch is gated so `topPriority` is resolved before it fires
(`src/components/dashboard/BarryChatPanel.jsx:328-332`):

```js
useEffect(() => {
  if (!userId || !kpiContextReady || hasRequestedOrientation.current) return;
  hasRequestedOrientation.current = true;
  loadOrientationBrief(); // → loadOpeningBrief(user, contextStack)
}, [userId, kpiContextReady]);
```

`kpiContextReady = kpisLoaded && !recsLoading`, so when the orientation request
runs, `recommendations` is loaded and `topPriority` is populated.

### Single-source guarantee

Both consumers read the **same** `recommendations` array from one hook —
`useRecommendations(activeUserId)` at
`src/pages/Scout/MissionControlDashboardV2.jsx:680`:

- `TodaysPriorities` — line 931 — renders `recommendations`.
- Barry mount — lines 919-923 — reads `recommendations[0]`.

`useRecommendations` calls `generateDashboardRecommendations(userId)` exactly
once per load, keyed on `[userId, retryCount]`
(`src/hooks/useRecommendations.js:98`). No second recommendation pipeline and
no extra request are introduced.

## Commits That Established This Architecture

| Commit | Subject |
| --- | --- |
| `0efa8cefc6862465e10bc6d383fe8308b18b782f` | feat: wire BarryChatPanel into live Mission Control with KPI context |
| `ef242cf2ddaa4d261b86a8e2a4a2401b5f109c2e` | feat: add Today's Priorities, Recent Outreach Activity, and Hunter Readiness Banner to Mission Control |
| `3564f972dfcae015482e8d5d5fbaa02b79a83cfb` | fix: add error handling to TodaysPriorities and guard Barry on rec errors |

All three are on `origin/main`. As of this report the working tree is clean and
the branch is even with `origin/main` for both files — the requested Sprint 2B
implementation was already present, so no payload change was required.

## Why Barry Does Not Determine Priorities

Barry receives `recommendations[0]` from the same array that renders Today's
Priorities. He may explain, summarize, or reference the top priority — but
cannot reorder or replace it. The recommendation engine is the single source of
truth.

## Runtime Validation Still Required

- Network payload confirmation: `context.topPriority.title` populated
- UI confirmation: Barry's opener matches Today's Priorities
- Fallback confirmation: Barry orients correctly when no priorities exist

To be completed during Team B QA validation.
