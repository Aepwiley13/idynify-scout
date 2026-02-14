# SCOUT GAME — GATE 4 DELIVERABLE 3: QA PARITY CHECKLIST

**Date:** 2026-02-14
**Source:** SCOUT-GAME-DISCOVERY-COMPLETE.md (Gate 3 approved)
**Target:** QA team — acceptance testing and regression prevention

---

## PURPOSE

Every action the Scout Game performs must produce **byte-identical backend effects** to the existing manual workflow. This checklist validates that the game is a pure UI layer — not a divergent engagement pipeline.

---

## SECTION 1 — ENGAGEMENT PARITY

These tests verify that game engagements produce identical backend events to manual Hunter engagements.

### 1.1 Timeline Event Parity

| # | Test | Manual Workflow Reference | Game Must Match | Pass/Fail |
|---|------|--------------------------|-----------------|-----------|
| 1.1.1 | Send email via Gmail — verify `message_sent` timeline event created | `sendActionResolver.js:376-391` via `HunterContactDrawer.jsx:353-362` | Identical `type`, `actor`, `preview`, `metadata` fields | [ ] |
| 1.1.2 | Send via LinkedIn handoff — verify `message_sent` timeline event created | `sendActionResolver.js:376-391` | Identical event. `metadata.method` = `'native'`, `metadata.sendResult` = `'opened'` | [ ] |
| 1.1.3 | Send via native email (no Gmail) — verify `message_sent` timeline event | `sendActionResolver.js:166-169` | Identical event. `metadata.method` = `'native'` | [ ] |
| 1.1.4 | Verify timeline event Firestore path | `timelineLogger.js:79`: `users/{userId}/contacts/{contactId}/timeline/{eventId}` | Same collection path | [ ] |
| 1.1.5 | Verify `createdAt` field uses `Timestamp.now()` | `timelineLogger.js:84` | Server timestamp, not client Date | [ ] |

### 1.2 Activity Log Parity

| # | Test | Manual Workflow Reference | Game Must Match | Pass/Fail |
|---|------|--------------------------|-----------------|-----------|
| 1.2.1 | Verify `activity_log` array updated on contact doc | `sendActionResolver.js:360-374` | `arrayUnion` with identical entry shape | [ ] |
| 1.2.2 | Verify `last_contacted` field set on contact doc | `sendActionResolver.js:274` | ISO timestamp string | [ ] |

### 1.3 Contact Status Transition Parity

| # | Test | Manual Workflow Reference | Game Must Match | Pass/Fail |
|---|------|--------------------------|-----------------|-----------|
| 1.3.1 | After send: contact status transitions to `'Awaiting Reply'` | `contactStateMachine.js:58,70` — `MESSAGE_SENT` trigger | Identical status value | [ ] |
| 1.3.2 | Status transition logged as timeline event | `contactStateMachine.js:161-179` | Identical `status_changed` event | [ ] |
| 1.3.3 | Verify `updateContactStatus()` called with `STATUS_TRIGGERS.MESSAGE_SENT` | `sendActionResolver.js:394-400` | Same trigger constant | [ ] |

### 1.4 API Usage Logging Parity

| # | Test | Manual Workflow Reference | Game Must Match | Pass/Fail |
|---|------|--------------------------|-----------------|-----------|
| 1.4.1 | Barry generation logged via `logApiUsage` | `generate-engagement-message.js:368-377` | Same operation name, response time, metadata | [ ] |
| 1.4.2 | `userIntent` substring (first 100 chars) logged in metadata | `generate-engagement-message.js:372` | Auto-intent string appears in log | [ ] |

---

## SECTION 2 — SKIP/REJECT PARITY

### 2.1 Company Status on Skip

| # | Test | Manual Workflow Reference | Game Must Match | Pass/Fail |
|---|------|--------------------------|-----------------|-----------|
| 2.1.1 | Skip sets company `status: 'rejected'` | `DailyLeads.jsx:184` | Identical field value | [ ] |
| 2.1.2 | Skip sets `swipeDirection: 'left'` on company doc | `DailyLeads.jsx:186` | Identical field value | [ ] |
| 2.1.3 | No timeline event created on skip | Verified: no `logTimelineEvent` call on left-swipe in `DailyLeads.jsx` | No event | [ ] |
| 2.1.4 | No engagement metrics affected by skip | No engagement counters increment in existing code | Same | [ ] |
| 2.1.5 | Skipped company excluded from future `pending` queries | `DailyLeads.jsx:57`: `where('status', '==', 'pending')` | Status no longer `pending` | [ ] |

### 2.2 Company Status on Defer (NEW — verify G1 compliance)

| # | Test | Expected Behavior | Pass/Fail |
|---|------|------------------|-----------|
| 2.2.1 | Defer sets company `status: 'deferred'` | Single field write on existing `status` field | [ ] |
| 2.2.2 | No new Firestore fields created by defer | Only `status` field modified | [ ] |
| 2.2.3 | Deferred company excluded from current session card stack | Filtered out of `pending` query results | [ ] |
| 2.2.4 | Deferred company re-appears in future sessions | Must be re-queued (status set back to `pending` or queried separately) | [ ] |
| 2.2.5 | No timeline event created on defer | Mirrors skip behavior — no engagement event | [ ] |

---

## SECTION 3 — AUTO-INTENT QUALITY PARITY

These tests verify that auto-constructed intent produces message quality comparable to manual free-form intent.

### 3.1 Message Quality Criteria

| # | Test | Criterion | Pass Threshold | Pass/Fail |
|---|------|-----------|---------------|-----------|
| 3.1.1 | Contact-specific references | Name, title, or company referenced in all 3 messages | ≥ 2 of 3 terms in each message | [ ] |
| 3.1.2 | Subject line quality | No purely generic subjects ("Quick question" without qualifier) | All subjects personalized or qualified | [ ] |
| 3.1.3 | Strategy differentiation | 3 distinct strategies with low word overlap | Jaccard similarity < 0.6 for all pairs | [ ] |
| 3.1.4 | Send-ready quality | No buzzwords, no generic phrases | Zero flagged terms | [ ] |

### 3.2 Auto-Intent Degradation

| # | Test | Input | Expected | Pass/Fail |
|---|------|-------|----------|-----------|
| 3.2.1 | Full fields auto-intent | All contact fields present | Quality comparable to manual | [ ] |
| 3.2.2 | Missing industry | `company_industry` absent | Acceptable quality, no error | [ ] |
| 3.2.3 | Missing title + industry | Both absent | Acceptable quality, graceful fallback | [ ] |
| 3.2.4 | Only company name | Minimal data | Non-empty intent, Barry generates messages | [ ] |

**Reference:** Appendix A test results in discovery document. All 3 test cases pass all 4 criteria.

---

## SECTION 4 — SESSION STATE INTEGRITY

### 4.1 Timer Accuracy

| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 4.1.1 | Timer starts on session begin | `elapsed` = 0 at start | [ ] |
| 4.1.2 | Timer pauses when app goes to background | `document.visibilitychange` → hidden | [ ] |
| 4.1.3 | Timer resumes correctly when app returns to foreground | Pause duration excluded from elapsed | [ ] |
| 4.1.4 | Timer survives page refresh (localStorage) | Session restored with correct elapsed time | [ ] |
| 4.1.5 | Multiple pause/resume cycles accumulate correctly | Total pause = sum of all pause intervals | [ ] |

### 4.2 Session Persistence

| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 4.2.1 | Card position persists across page refresh | `localStorage.scout_game_card_index` restored | [ ] |
| 4.2.2 | Engagement count persists across page refresh | `localStorage.scout_game_engagements` restored | [ ] |
| 4.2.3 | Streak resets on skip, persists on engage | Counter logic correct | [ ] |
| 4.2.4 | Best streak tracks session maximum | `bestStreak` ≥ `currentStreak` always | [ ] |
| 4.2.5 | Session mode persists | Can't change mode mid-session | [ ] |
| 4.2.6 | Session clears on explicit end | All `scout_game_*` localStorage keys removed | [ ] |

---

## SECTION 5 — CHANNEL AVAILABILITY PARITY

### 5.1 Channel Enable/Disable

| # | Test | Condition | Expected | Reference | Pass/Fail |
|---|------|-----------|----------|-----------|-----------|
| 5.1.1 | Email enabled | `contact.email` exists and non-empty | Email button active | `HunterContactDrawer.jsx:786` | [ ] |
| 5.1.2 | Email disabled | No `contact.email` | Email button disabled/grayed | Same | [ ] |
| 5.1.3 | LinkedIn enabled | `contact.linkedin_url` exists | LinkedIn button active | `HunterContactDrawer.jsx:806` | [ ] |
| 5.1.4 | LinkedIn disabled | No `contact.linkedin_url` | LinkedIn button disabled | Same | [ ] |
| 5.1.5 | Text enabled | `contact.phone` exists | Text button active | `HunterContactDrawer.jsx:814` | [ ] |
| 5.1.6 | Call enabled | `contact.phone` exists | Call button active | Same | [ ] |
| 5.1.7 | All channels disabled | No email, LinkedIn, or phone | Card shows "Find Contact" action | G3 compliance | [ ] |

### 5.2 Send Method Resolution

| # | Test | Condition | Expected | Reference | Pass/Fail |
|---|------|-----------|----------|-----------|-----------|
| 5.2.1 | Gmail connected + email → real send | Gmail OAuth active | `method: 'real'`, `sendResult: 'sent'` | `sendActionResolver.js:85-89` | [ ] |
| 5.2.2 | No Gmail + email → native handoff | Gmail not connected | `method: 'native'`, opens mailto: | `sendActionResolver.js:93-96` | [ ] |
| 5.2.3 | LinkedIn → always native | N/A | `method: 'native'`, opens profile | `sendActionResolver.js:97-100` | [ ] |

---

## SECTION 6 — GUARDRAIL VERIFICATION

### 6.1 G1: Zero Backend Logic

| # | Test | Pass/Fail |
|---|------|-----------|
| 6.1.1 | No new files in `netlify/functions/` | [ ] |
| 6.1.2 | No modifications to existing Netlify functions | [ ] |
| 6.1.3 | No new Firestore collections or subcollections | [ ] |
| 6.1.4 | Only `status` field modified on company docs (existing field) | [ ] |

### 6.2 G6: Additive Layer

| # | Test | Pass/Fail |
|---|------|-----------|
| 6.2.1 | No modifications to `sendActionResolver.js` | [ ] |
| 6.2.2 | No modifications to `timelineLogger.js` | [ ] |
| 6.2.3 | No modifications to `contactStateMachine.js` | [ ] |
| 6.2.4 | No modifications to `generate-engagement-message.js` | [ ] |
| 6.2.5 | No modifications to `HunterContactDrawer.jsx` | [ ] |
| 6.2.6 | No modifications to `DailyLeads.jsx` | [ ] |
| 6.2.7 | Existing routes (`/scout`, `/hunter`, `/recon`) unchanged | [ ] |

### 6.3 G9: One-Handed Operation

| # | Test | Device | Pass/Fail |
|---|------|--------|-----------|
| 6.3.1 | Swipe left (skip) with one thumb | iPhone SE | [ ] |
| 6.3.2 | Swipe right (engage flow) with one thumb | iPhone SE | [ ] |
| 6.3.3 | Tap message strategy with one thumb | iPhone SE | [ ] |
| 6.3.4 | Tap channel selector with one thumb | iPhone SE | [ ] |
| 6.3.5 | Tap Send button with one thumb | iPhone SE | [ ] |
| 6.3.6 | All touch targets ≥ 44x44px | iPhone SE | [ ] |
| 6.3.7 | Repeat 6.3.1-6.3.6 | iPhone 14 Pro | [ ] |
| 6.3.8 | Repeat 6.3.1-6.3.6 | Samsung Galaxy S23 | [ ] |

**Test method:** Physical device, dominant hand only, screen recording. Tester holds device in natural grip position.

---

## SECTION 7 — EDGE CASE TESTING

| # | Scenario | Setup | Expected Behavior | Pass/Fail |
|---|---------|-------|-------------------|-----------|
| 7.1 | Barry returns 0 messages | Mock API to return empty array | Error card with retry button. No auto-advance. | [ ] |
| 7.2 | Barry generation timeout | Mock 15s delay on API | Loading card shown. Retry on card activation. | [ ] |
| 7.3 | Gmail rate limit mid-session | Mock 429 response from gmail-send | Rate limit message. Other channels still available. | [ ] |
| 7.4 | Apollo rate limit during prefetch | Mock 429 from searchPeople | Prefetch fails gracefully. Cards without contacts show "Find Contact". | [ ] |
| 7.5 | Contact with no channels | Remove email, linkedin_url, phone from contact | Card renders. "Find Contact" action shown. Skip/defer available. | [ ] |
| 7.6 | Session interrupted (close tab) | Close browser tab mid-session | On return: session restored from localStorage. | [ ] |
| 7.7 | Session interrupted (navigate away) | Click to different route | On return to /scout/game: session restored. | [ ] |
| 7.8 | 25+ cards in pending queue | Load 30 pending companies | Only 25 loaded (DAILY_SWIPE_LIMIT). No crash. | [ ] |
| 7.9 | 0 cards in pending queue | No pending companies | Empty state screen. Suggest refreshing leads. | [ ] |
| 7.10 | Engage same contact twice in session | Complete engagement, then undo skip of same company | Second engagement creates second timeline event. No blocking. | [ ] |

---

## REGRESSION TESTS

After game feature ships, verify these existing flows still work identically:

| # | Flow | Steps | Pass/Fail |
|---|------|-------|-----------|
| R.1 | Manual Scout flow | DailyLeads → swipe right → contacts auto-discovered | [ ] |
| R.2 | Manual Hunter engagement | Open contact → type intent → Barry generates → select strategy → send | [ ] |
| R.3 | Manual skip | DailyLeads → swipe left → company status = rejected | [ ] |
| R.4 | Contact search | Scout → Company Detail → search contacts via Apollo | [ ] |
| R.5 | Gmail send | Hunter → send via email with Gmail connected | [ ] |
| R.6 | LinkedIn handoff | Hunter → send via LinkedIn → profile opens, message copied | [ ] |
| R.7 | Daily quota | Verify 25 swipe limit still enforced in DailyLeads | [ ] |

---

## SIGN-OFF

| Role | Name | Date | Sections Reviewed | Sign-off |
|------|------|------|-------------------|----------|
| QA Lead | | | All | [ ] |
| Frontend Lead | | | 1, 3, 5, 6.2 | [ ] |
| Backend Lead | | | 1, 2, 6.1 | [ ] |
