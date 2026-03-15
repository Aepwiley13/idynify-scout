# Sprint Status — idynify Scout
_Last updated: 2026-03-14_

---

## Current State: 7 of 10 Done

Sprint 1 and Sprint 3 are fully closed in a single commit (`56456d4`).
Branch: `claude/review-codebase-brief-WqQqZ` (merged to `main`).

---

## ✅ Closed

| # | Item | Notes |
|---|------|-------|
| 1 | Barry context store (`barryContextStore.js`) | Pub/sub singleton live; `BarryTrigger` reads from it |
| 2 | Unified `BarryChat` component | Single entry point across all modules |
| 3 | RECON Section 0 (`barryReconSection0.js`) | Foundation interview live |
| 4 | Barry Actions (`barryActions.js`) | Structured action dispatch in place |
| 6 | Contact snapshot UI | `ContactSnapshot.jsx` + `BarryContext.jsx` wired |
| 7 | 18-field profile schema | Contract in `scoutContactContract.js` |
| 8 | Coach wiring | `barry-coach-section.js` live; coach responses in `barryMissionChat` |

---

## 🔜 Remaining — In Priority Order

---

### #9 — BarryICPPanel extraction from `DailyLeads.jsx`
**Status:** Ready to cut. The blocker (context store) is in production.

**What to do:**
- `BarryICPPanel` (lines 872–1161, ~290 lines) and `IcpReclarificationModal` (lines 1165–~1260) are inline components inside a 2,561-line file
- `icpProfile` state and `onSearchComplete` callback live only in `DailyLeads.jsx` local state
- **Move ICP trigger** → open the unified Barry drawer with `module="scout"` so Barry reads ICP context from the context store like every other module does
- **Delete** lines 872–1161 (BarryICPPanel) and the `IcpReclarificationModal` component below it
- **Update** the two call sites at lines 2526 and 2538 to use the unified drawer trigger

**Why first:** Every new feature gets built on top of `DailyLeads`. 2,561 lines with two dead inline components is debt that compounds.

---

### #5 — Daily intelligence drops
**Status:** Nothing exists yet. Three-part build.

**Part 1 — Scheduler**
- Netlify scheduled function (cron: `0 7 * * *` — 7am per user timezone)
- Query `users` collection for active users with `lastActive > 30 days ago`
- Fan out to `barryDailyIntelligence.js` per user

**Part 2 — `barryDailyIntelligence.js`**
- Load user's RECON profile (from `users/{userId}/recon`) + top contacts (by warmth, last touched)
- Call Claude to generate: 1 coaching nudge + 2–3 contact follow-up prompts + 1 market signal (if enriched data available)
- Write result to `users/{userId}/dailyIntel/{date}` in Firestore

**Part 3 — RECON panel UI**
- New section in `RECONSectionPage.jsx` (or a dedicated panel component)
- Reads from `users/{userId}/dailyIntel` collection, sorted by date descending
- Shows today's drop at the top; previous drops collapsed below
- Empty state: "Your first intel drop arrives tomorrow morning."

**Why this matters:** RECON currently feels like a one-time setup. Daily drops make it a living coaching relationship — highest retention impact of anything left on the list.

---

### #10 — Slack + LinkedIn integrations
**Status:** LinkedIn enrichment utilities exist (`linkedinSearch.js`, `enrichContact.js`, `retryLinkedInPhoto.js`) — OAuth does not. No Slack code exists anywhere.

**Do Slack first:**
- Add `slackWebhook` field to Homebase/user settings UI + Firestore `users/{userId}` doc
- Create `netlify/functions/notify-slack.js` — simple incoming webhook POST
- Hook into `barryDailyIntelligence.js`: if `slackWebhook` is set, POST the day's intel drop to the user's channel
- Half-day build. Immediately puts Barry's output into users' actual workflow.

**Then LinkedIn OAuth:**
- Standard OAuth 2.0 flow via a Netlify function pair (`linkedin-auth-start.js`, `linkedin-auth-callback.js`)
- Store access token in `users/{userId}/integrations/linkedin`
- Use token in `linkedinSearch.js` to replace the current scrape-dependent path
- Longer lift; unblocked by Slack.

---

## Architecture Reference

```
barryContextStore.js        ← pub/sub singleton (done)
  └── setBarryContext()     ← called by each module page on mount
  └── useBarryContext()     ← read by BarryTrigger → BarryChat

barryMissionChat.js         ← main conversation function (done)
  └── effectiveContextStack ← server-side contact load when stack not passed
  └── moduleContext         ← appended to system prompt from context store

barryDailyIntelligence.js   ← NOT YET BUILT (#5)
  └── writes → users/{uid}/dailyIntel/{date}

RECONSectionPage.jsx        ← sections 1–10 exist; intel panel NOT YET BUILT (#5)
```

---

## Next PR Target

`#9` (BarryICPPanel removal) is a clean, reviewable PR with no new dependencies.
Estimated diff: ~−400 lines in `DailyLeads.jsx`, ~+20 lines wiring the context store trigger.
