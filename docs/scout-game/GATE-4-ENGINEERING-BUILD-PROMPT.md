# SCOUT GAME — GATE 4 DELIVERABLE 1: ENGINEERING BUILD PROMPT

**Date:** 2026-02-14
**Source:** SCOUT-GAME-DISCOVERY-COMPLETE.md (Gate 3 approved)
**Target:** Engineering team — sprint planning and implementation

---

## MISSION STATEMENT

Build "Scout Game Mode" — a gamified, time-boxed engagement workflow layered on top of the existing Scout/Hunter system. The game presents the user with a card stack of pending companies + auto-discovered contacts, auto-generates Barry messages via session-level intent, and tracks session metrics (engagements completed, time elapsed, streak) — all without backend changes.

**North Star:** 15 engagements in 30 minutes. One-handed. Zero typing required.

---

## ARCHITECTURE CONSTRAINTS (NON-NEGOTIABLE)

These 9 guardrails are engineering-signed and must be respected in every PR:

| # | Constraint | What It Means for You |
|---|-----------|----------------------|
| G1 | Zero new backend logic | All new code is React components, hooks, utilities. No Netlify function changes. No Firestore schema changes (except `status: 'deferred'` on existing field). |
| G2 | No data cleanup prerequisite | Game works with whatever data exists. No migration scripts. No backfill jobs. |
| G3 | Missing data never blocks | Cards render with fallbacks. Channels disable gracefully. User can always skip. |
| G4 | No mandatory free-text | Auto-intent satisfies `userIntent` validation. Override is optional. |
| G5 | Manual workflow preserved | Existing Scout/Hunter/RECON routes unchanged. Game is a new route. |
| G6 | Additive layer only | Import existing utils — don't modify them. No changes to `sendActionResolver.js`, `timelineLogger.js`, `contactStateMachine.js`, etc. |
| G7 | Skip = existing reject | `updateDoc(companyRef, { status: 'rejected' })` — identical to `DailyLeads.jsx:184`. |
| G8 | Identical engagement events | Call `executeSendAction()` from `sendActionResolver.js:288`. Same timeline events, same activity logs, same status transitions. |
| G9 | One-handed, thumb-reachable | All primary actions reachable with one thumb. Min 44x44px touch targets. QA validates on 3 devices. |

---

## DATA FLOW

```
Session Start
  │
  ├── User picks Session Mode (one tap)
  │   └── warm_outreach | re_engagement | direct_pipeline | new_introductions
  │
  ├── Load card stack
  │   └── Firestore query: companies where status == 'pending', sorted by fit_score DESC
  │   └── Limit: DAILY_SWIPE_LIMIT (25)
  │
  ├── Prefetch buffer (first 10 cards)
  │   ├── For each company: load auto-discovered contacts (existing Firestore subcollection)
  │   ├── Build auto-intent string: sessionMode + card fields
  │   │   └── buildAutoIntent(contact, company, sessionMode)
  │   │   └── Example: "Cold outreach to VP of Sales at Acme Corp in SaaS — schedule a meeting"
  │   └── Call generate-engagement-message (existing Netlify function, unchanged)
  │       └── Returns: 3 message strategies (direct, warm, value)
  │
  └── Session timer starts (localStorage-backed, pauses on visibilitychange)

Per-Card Loop
  │
  ├── Card displays: company name, contact name+title, ICP score, 3 pre-loaded messages
  │
  ├── User action: ENGAGE
  │   ├── Tap message strategy (1 of 3) → selects message
  │   ├── Tap channel (email/LinkedIn/text/call) → selects weapon
  │   │   └── Default: email if available, else LinkedIn, else first available
  │   ├── Review screen (message + channel) → tap Send
  │   └── executeSendAction() → logTimelineEvent() → updateContactStatus()
  │       └── Identical to HunterContactDrawer.jsx:353-362
  │
  ├── User action: SKIP
  │   └── updateDoc(companyRef, { status: 'rejected' }) — mirrors DailyLeads.jsx:184
  │   └── Advance to next card. No engagement event logged.
  │
  ├── User action: DEFER (new)
  │   └── updateDoc(companyRef, { status: 'deferred' })
  │   └── Card removed from current stack, re-queued for next session
  │
  └── Update session metrics (client-side)
      ├── engagementsCompleted++
      ├── currentStreak++ (reset on skip)
      ├── Update timing: fastestEngagement, averageEngagement
      └── Trigger prefetch for next batch if buffer < 3

Session End
  │
  ├── Display session summary (engagements, time, streak, fastest)
  └── Clear localStorage session keys
```

---

## AUTO-INTENT CONSTRUCTION

The core innovation. Eliminates mandatory free-text input (Blocker 1 resolution).

```javascript
// Pure client-side function — no backend call
function buildAutoIntent(contact, company, sessionMode) {
  const title = contact.title || 'contact';
  const companyName = company.name || contact.company_name || 'their company';
  const industry = company.industry || contact.company_industry || '';

  const SESSION_TEMPLATES = {
    warm_outreach: {
      warmth: 'warm',
      goalVerb: 'reconnect with',
      goalSuffix: 'and schedule a meeting'
    },
    re_engagement: {
      warmth: 'follow-up',
      goalVerb: 'follow up with',
      goalSuffix: 're-establish connection'
    },
    direct_pipeline: {
      warmth: 'cold',
      goalVerb: 'introduce ourselves to',
      goalSuffix: 'and schedule a meeting'
    },
    new_introductions: {
      warmth: 'cold',
      goalVerb: 'make initial contact with',
      goalSuffix: 'open the relationship'
    }
  };

  const template = SESSION_TEMPLATES[sessionMode] || SESSION_TEMPLATES.direct_pipeline;
  const industryClause = industry ? ` in ${industry}` : '';

  return `${template.warmth.charAt(0).toUpperCase() + template.warmth.slice(1)} outreach — ${template.goalVerb} ${title} at ${companyName}${industryClause}. Goal: ${template.goalSuffix}`;
}
```

**Degradation ladder (tested and passing):**

| Available Data | Example Output |
|---------------|---------------|
| All fields | "Cold outreach — introduce ourselves to VP of Sales at Acme Corp in SaaS. Goal: and schedule a meeting" |
| Missing industry | "Cold outreach — introduce ourselves to VP of Sales at Acme Corp. Goal: and schedule a meeting" |
| Missing title + industry | "Cold outreach — introduce ourselves to contact at Acme Corp. Goal: and schedule a meeting" |
| Only company name | "Cold outreach — introduce ourselves to contact at Acme Corp. Goal: and schedule a meeting" |

All strings pass Barry's validation: `userIntent.trim().length > 0` (`generate-engagement-message.js:81`).

---

## SESSION STATE MANAGEMENT

All session state is client-side. No backend writes for session tracking.

```
localStorage keys:
  scout_game_session_id      — UUID, created at session start
  scout_game_session_mode    — enum: warm_outreach|re_engagement|direct_pipeline|new_introductions
  scout_game_session_start   — ISO timestamp
  scout_game_pause_duration  — accumulated pause time in ms
  scout_game_last_active     — ISO timestamp of last active moment
  scout_game_card_index      — current position in card stack
  scout_game_engagements     — count of completed engagements
  scout_game_streak          — current consecutive engagement streak
  scout_game_best_streak     — best streak this session
  scout_game_fastest_ms      — fastest single engagement in ms
  scout_game_timing_array    — JSON array of per-engagement durations

React state (ephemeral, per-card):
  cardOpenedAt               — timestamp when current card became active
  selectedStrategy           — which of 3 messages user picked
  selectedWeapon             — which channel user picked
  message/subject            — editable message content
  prefetchBuffer             — array of pre-generated message payloads
```

**Timer implementation:**
```javascript
useEffect(() => {
  const handler = () => {
    if (document.hidden) {
      // Pause: record when we went inactive
      localStorage.setItem('scout_game_last_active', new Date().toISOString());
    } else {
      // Resume: add pause duration
      const lastActive = localStorage.getItem('scout_game_last_active');
      if (lastActive) {
        const pauseMs = Date.now() - new Date(lastActive).getTime();
        const accumulated = parseInt(localStorage.getItem('scout_game_pause_duration') || '0');
        localStorage.setItem('scout_game_pause_duration', String(accumulated + pauseMs));
      }
    }
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}, []);
```

---

## PREFETCH STRATEGY

Barry generation is 3-8 seconds (the critical path). The prefetch buffer ensures messages are ready before the user sees the card.

- **Initial load:** Prefetch first 10 cards in parallel
- **Ongoing:** When buffer drops below 3 unviewed cards, trigger next batch
- **Per-engagement time budget:** ~120 seconds (target: 15 in 30 min)
- **Prefetch runway:** With 10-card buffer at 120s/card, we have ~1200s of runway vs 3-8s generation time

```javascript
// Prefetch controller
async function prefetchMessages(cards, sessionMode, startIndex, count = 10) {
  const batch = cards.slice(startIndex, startIndex + count);
  const promises = batch.map(async (card) => {
    const intent = buildAutoIntent(card.contact, card.company, sessionMode);
    try {
      const response = await fetch('/.netlify/functions/generate-engagement-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: card.contact.id,
          userIntent: intent,
          engagementIntent: 'prospect', // or derive from sessionMode
          // Auth handled by existing function
        })
      });
      return { cardId: card.id, messages: await response.json(), error: null };
    } catch (err) {
      return { cardId: card.id, messages: null, error: err.message };
    }
  });
  return Promise.allSettled(promises);
}
```

**Failure handling:** If prefetch fails for a card, show loading spinner when card becomes active and retry. Do not block card navigation. User can skip.

---

## EDGE CASES (FROM DISCOVERY SECTION 11)

| # | Scenario | Behavior |
|---|---------|----------|
| 1 | Barry returns 0 messages | Show error + retry button on card. Don't auto-advance. Don't count as engagement. |
| 2 | LinkedIn URL malformed/404 | Mirror existing: `window.open()` — browser handles error. LinkedIn button disabled if no URL. |
| 3 | API rate limit mid-session | Show rate limit message. Allow switching to non-limited channels. Don't end session. |
| 4 | Contact already engaged recently | No blocking. Optionally show `last_contacted` date as info. Mirror existing behavior (no cadence enforcement). |
| 5 | Same card in multiple sessions | Intentional. Pending companies carry over. Engaged/skipped cards don't reappear (status changed). |
| 6 | Stale card data mid-session | No expiration. Barry generates from whatever data exists. Data quality ≠ game flow issue. |
| 7 | Barry generation timeout mid-prefetch | Netlify default 10s timeout. Show loading state on card, retry when card becomes active. Not a blocker. |

---

## WHAT NOT TO BUILD

- No backend Netlify functions
- No Firestore schema migrations
- No new collections or subcollections
- No cron jobs or background workers
- No push notifications
- No leaderboards or cross-user competition
- No persistent gamification state in Firestore
- No A/B testing infrastructure (deferred — just add `intentSource: 'auto'|'manual'` to existing `logApiUsage` metadata)
- No analytics dashboard
- No settings page for game configuration

---

## SPRINT STRUCTURE (SUGGESTED)

**Week 1: Core Flow**
- Session start screen + mode selector
- Card stack component with swipe gestures
- Auto-intent builder + prefetch controller
- Engagement actions (send, skip, defer)

**Week 2: Polish + Integration**
- Session metrics display (timer, counter, streak)
- Session summary screen
- Intent override chip (optional)
- G9 device testing (iPhone SE, iPhone 14 Pro, Samsung S23)
- Integration testing against existing engagement pipeline

---

## KEY FILES TO IMPORT (NOT MODIFY)

| Utility | Import Path | What You Need |
|---------|------------|--------------|
| `executeSendAction` | `../../utils/sendActionResolver` | The send function. Call it identically to `HunterContactDrawer.jsx:353-362`. |
| `logTimelineEvent`, `ACTORS` | `../../utils/timelineLogger` | Already called by `executeSendAction`. Don't call separately. |
| `updateContactStatus`, `STATUS_TRIGGERS` | `../../utils/contactStateMachine` | Already called by `executeSendAction`. Don't call separately. |
| `auth`, `db` | `../../firebase/config` | Firestore + Auth references. |
| `updateDoc`, `doc`, etc. | `firebase/firestore` | For skip/defer status writes. |
| `CHANNELS`, `SEND_RESULT` | `../../utils/sendActionResolver` | Channel constants for weapon selection. |
