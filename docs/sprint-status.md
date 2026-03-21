# Sprint Status — idynify Scout
_Last updated: 2026-03-19_

---

## Active Sprint: Go To War (Command Center)

**Branch:** `claude/create-alignment-brief-page-vuwR9`
**Status:** Day 1 complete — all 8 phases implemented and aligned with spec

### Aaron's Pre-Sprint Locked Calls (all 5 resolved)

| # | Item | Decision |
|---|------|----------|
| 1 | **Data model** | `waitingForReply: bool` removed from Mission root. Replaced on `mission.roster[n]` with `replyStatus: 'no-reply' \| 'replied' \| 'bounced'` and `lastContactedAt: Timestamp \| null`. This is what Lane 6 queries. |
| 2 | **Lane 3 scope** | Send engine uses a **global per-sender queue** — not per-mission. 90-second minimum interval across ALL active missions for that user. Prevents simultaneous sends across missions. |
| 3 | **Barry HUD content** | 8 phase-aware coaching lines written and embedded in `BarryHUD.jsx`. Shell goes up Day 1 with real lines. See `src/components/BarryHUD.jsx`. |
| 4 | **Blocker gating** | Lanes 1 and 3 start Day 1 regardless of other blockers. They don't wait on each other. |
| 5 | **Voice/audio** | Deferred to Sprint 2, pending legal review. Not cut — parked. |

### Day 1 Lane Status

**Lane 1 (Frontend / Command Center):**
- [x] Go To War route created — `/people?tab=go_to_war`, dedicated view in Command Center
- [x] Scout company card audit — CompanyCard is a swipe-only component, not extensible for list+checkbox. Verdict: build new `ContactRosterRow` list component for roster phase. See GoToWar.jsx Phase 2.
- [x] Barry HUD shell built — persistent top strip, 8-phase-aware, real coaching lines in place
- [x] Phase labels reconciled with spec — Brief, Roster, Approach, Sequence, Approve, Launch, Monitor, Debrief
- [x] Roster phase consolidated — tabbed UI with Contacts / Companies / Decision Makers sub-tabs
- [x] Approach phase added — strategy config (outcome goal, engagement style, timeframe, next step type)
- [x] Sequence phase split — dedicated phase for Barry sequence generation with regenerate option
- [x] Approve phase added — per-step review with approve/skip/undo per step, all steps must be reviewed before launch
- [x] Resume banner — checks for active missions on mount, allows resuming mid-flow missions
- [x] Firestore persistence — send state (stepHistory, currentStepIndex, lastContactedAt, replyStatus) persisted after each manual send
- [x] Debrief persistence — outcomes and notes saved to Firestore, mission marked as completed
- [x] Save debrief button — "Complete Mission" CTA on Phase 8

**Lane 3 (Backend / Infra):**
- [ ] Check if Hunter email send logs a `sent` event to Firebase — **Answer: No.** `gmail-send.js` updates campaign doc status to "sent" but does NOT emit to a Firebase events collection. `emailLog.js` utility exists but is not wired in. This sets scope: Cloud Tasks architecture must include a send-event write to Firestore for Lane 6 reply tracking.
- [x] 90s global per-sender send throttle — enforced client-side with countdown timer and disabled send buttons during cooldown
- [ ] Cloud Tasks architecture — server-side global per-sender queue (IN PROGRESS, client-side throttle in place as interim)

**Lanes 2, 4, 5, 6:** Partially unblocked — Lane 6 reply tracking still needs `emailLog.js` wiring on the backend.

---

## Go To War — Feature Spec

**Location:** Command Center → Go To War tab
**Route:** `/people?tab=go_to_war`
**UX:** One room, persistent Barry HUD at top, 8-phase inline flow, URL params for deep-linking

### 8 Phases

| # | Phase | Description |
|---|-------|-------------|
| 1 | Brief | Define objective (goal type: book meetings / warm conversations / reengage stalled) |
| 2 | Roster | Select contacts from list with checkboxes |
| 3 | Approach | Engagement style + channel selection |
| 4 | Sequence | Barry-generated message sequence (approval-gated) |
| 5 | Approve | Per-message review and edit before send |
| 6 | Launch | Fire. Missions go live. |
| 7 | Monitor | Track replies and engagement in real time |
| 8 | Debrief | Record outcomes, train Barry for next wave |

### Data Model (Mission Roster Contact)

```js
// users/{userId}/missions/{missionId}
mission.roster[n] = {
  contactId: string,
  name: string,
  email: string | null,
  phone: string | null,

  // Lane 6 fields — replaces old `waitingForReply: bool`
  replyStatus: 'no-reply' | 'replied' | 'bounced',   // default: 'no-reply'
  lastContactedAt: Timestamp | null,                  // set when a message is sent

  currentStepIndex: number,
  status: 'pending' | 'active' | 'awaiting_outcome' | 'completed',
  stepHistory: [ /* see mission data model */ ],
}
```

### Architecture Notes

- **Send queue:** Global per-sender (not per-mission). Key: `queue:{userId}`. Min interval: 90s between sends across all active missions.
- **Reply tracking:** After `lastContactedAt` is set, Lane 6 polls for inbound email and updates `replyStatus`.
- **HUD:** `BarryHUD.jsx` — phase prop drives which coaching line shows. Import into any phase view.
- **Resume banner:** Shown in Go To War view if any mission has `status = 'active'` with `warPhase` set.
- **Voice/audio:** Parked. Sprint 2, after legal review.

---

## Previous Sprint: Closed

| # | Item | Notes |
|---|------|-------|
| 1 | Barry context store (`barryContextStore.js`) | Pub/sub singleton live; `BarryTrigger` reads from it |
| 2 | Unified `BarryChat` component | Single entry point across all modules |
| 3 | RECON Section 0 (`barryReconSection0.js`) | Foundation interview live |
| 4 | Barry Actions (`barryActions.js`) | Structured action dispatch in place |
| 6 | Contact snapshot UI | `ContactSnapshot.jsx` + `BarryContext.jsx` wired |
| 7 | 18-field profile schema | Contract in `scoutContactContract.js` |
| 8 | Coach wiring | `barry-coach-section.js` live; coach responses in `barryMissionChat` |
| — | Alignment Brief page | `/recon/alignment-brief` — Barry training score + dimension status |

---

## Backlog (Post Go To War)

### #9 — BarryICPPanel extraction from `DailyLeads.jsx`
**Status:** Ready to cut. Blocker (context store) is in production.
- `BarryICPPanel` (~290 lines) is inline in a 2,561-line file
- Move ICP trigger → open unified Barry drawer with `module="scout"`
- Delete lines 872–1161 + `IcpReclarificationModal`
- Estimated diff: ~−400 lines in DailyLeads, ~+20 lines wiring

### #5 — Daily intelligence drops
**Status:** Nothing built yet.
- Part 1: Netlify cron `0 7 * * *` — fan out to `barryDailyIntelligence.js` per user
- Part 2: `barryDailyIntelligence.js` — 1 coaching nudge + 2–3 contact prompts + 1 market signal
- Part 3: RECON panel UI reading `users/{userId}/dailyIntel`

### #10 — Slack + LinkedIn integrations
- Slack first: `slackWebhook` field + `notify-slack.js` + hook into daily intel
- Then LinkedIn OAuth 2.0 flow
