# SCOUT GAME — GATE 4 DELIVERABLE 2: FRONTEND COMPONENT REGISTRY

**Date:** 2026-02-14
**Source:** SCOUT-GAME-DISCOVERY-COMPLETE.md (Gate 3 approved)
**Target:** Frontend engineering — component planning and ownership

---

## FILE STRUCTURE

```
src/
├── pages/
│   └── Scout/
│       └── ScoutGame.jsx              ← NEW: Main game page (route: /scout/game)
│       └── ScoutGame.css              ← NEW: Game page styles
│
├── components/
│   └── scout-game/                    ← NEW: All game components in dedicated directory
│       ├── GameSessionStart.jsx       ← Session mode selector
│       ├── GameCardStack.jsx          ← Card stack container with swipe logic
│       ├── GameCard.jsx               ← Individual game card (company + contact + messages)
│       ├── GameMessageSelector.jsx    ← 3-strategy message picker
│       ├── GameWeaponSelector.jsx     ← Channel picker (email/LinkedIn/text/call)
│       ├── GameReviewSend.jsx         ← Final review + send confirmation
│       ├── GameSessionBar.jsx         ← Top bar: timer, counter, streak
│       ├── GameIntentChip.jsx         ← Auto-intent display + optional override
│       ├── GameSessionSummary.jsx     ← End-of-session results screen
│       ├── GameLoadingCard.jsx        ← Loading state while Barry generates
│       ├── GameErrorCard.jsx          ← Error state with retry
│       ├── GameDeferButton.jsx        ← "Save for later" action
│       ├── GameSkipButton.jsx         ← Skip/reject action
│       ├── GameProgressRing.jsx       ← Visual progress indicator (15/15 ring)
│       ├── GameStreakIndicator.jsx     ← Streak counter with animation
│       └── scout-game.css             ← Shared game styles
│
├── hooks/
│   └── useScoutGameSession.js         ← NEW: Session state management hook
│   └── useGamePrefetch.js             ← NEW: Message prefetch controller hook
│   └── useGameTimer.js                ← NEW: Timer with pause/resume hook
│
└── utils/
    └── buildAutoIntent.js             ← NEW: Auto-intent construction utility
```

---

## COMPONENT SPECIFICATIONS

### 1. ScoutGame.jsx (Page)

**Role:** Top-level page component. Manages game lifecycle (start → play → summary).

| Prop/State | Type | Source |
|-----------|------|--------|
| `gamePhase` | `'start' \| 'playing' \| 'summary'` | React state |
| `sessionMode` | `string` | From GameSessionStart selection |
| `cards` | `Array<{company, contacts, messages}>` | Firestore + prefetch |

**Imports (existing):** `auth`, `db` from firebase/config. `collection`, `query`, `where`, `getDocs`, `updateDoc`, `doc` from firebase/firestore.

**Route:** Add to `App.jsx` router: `<Route path="/scout/game" element={<ScoutGame />} />`

**Key behaviors:**
- Loads pending companies on mount (mirrors `DailyLeads.jsx:56-67`)
- Initializes session via `useScoutGameSession` hook
- Manages card stack index
- Transitions to summary when user completes or exits

---

### 2. GameSessionStart.jsx

**Role:** Session mode selector. One-tap to begin.

| Prop | Type | Description |
|------|------|-------------|
| `onSelectMode` | `(mode: string) => void` | Callback when user picks a mode |

**Session Modes (4 options):**

| Mode | Label | Description | Maps To |
|------|-------|-------------|---------|
| `direct_pipeline` | "Build Pipeline" | Cold outreach to new prospects | warmth=cold, goal=schedule_meeting |
| `warm_outreach` | "Warm Outreach" | Reconnect with known contacts | warmth=warm, goal=schedule_meeting |
| `re_engagement` | "Re-engage" | Follow up with stale contacts | warmth=followup, goal=rebuild_relationship |
| `new_introductions` | "Introductions" | Open new relationships | warmth=cold, goal=get_introduction |

**UI:** 4 large tappable cards in a 2x2 grid. Each shows icon + label + description. Single thumb tap starts session.

---

### 3. GameCardStack.jsx

**Role:** Container for the swipeable card stack. Manages card transitions and gestures.

| Prop | Type | Description |
|------|------|-------------|
| `cards` | `Array` | Full card stack |
| `currentIndex` | `number` | Current card position |
| `onEngage` | `(card, strategy, weapon) => void` | Engagement callback |
| `onSkip` | `(card) => void` | Skip callback |
| `onDefer` | `(card) => void` | Defer callback |
| `prefetchBuffer` | `Map<string, messages>` | Pre-generated messages by card ID |

**Gesture handling:** Reference implementation at `CompanyCard.jsx:43-60` (existing touch event handlers). Swipe right = engage flow, swipe left = skip, swipe up = defer (optional gesture).

**Renders:** Current card + next card (for transition animation). Previous cards removed from DOM.

---

### 4. GameCard.jsx

**Role:** Individual game card displaying company + contact + pre-loaded messages.

| Prop | Type | Description |
|------|------|-------------|
| `company` | `Object` | Company document from Firestore |
| `contact` | `Object` | Primary contact for this company |
| `messages` | `Array<{strategy, label, subject, message, reasoning}>` | 3 pre-generated messages |
| `isLoading` | `boolean` | True if messages still generating |
| `onSelectStrategy` | `(strategy) => void` | Message selection callback |
| `autoIntent` | `string` | The auto-constructed intent string |
| `sessionMode` | `string` | Current session mode |

**Layout (top to bottom):**
1. Company name + ICP score badge (from `CompanyCard.jsx:108,166`)
2. Contact name + title
3. Intent chip (tappable for override)
4. 3 message strategy cards (tappable)
5. Action buttons: Skip | Defer | (Send appears after strategy + weapon selected)

**Fallbacks:**
- Missing title: render "Contact at {company}" (mirrors `generate-engagement-message.js:176`)
- Missing industry: omit industry line
- Missing score: hide badge
- No messages (loading): show `GameLoadingCard`
- No messages (error): show `GameErrorCard`

---

### 5. GameMessageSelector.jsx

**Role:** Displays 3 message strategies as tappable cards.

| Prop | Type | Description |
|------|------|-------------|
| `messages` | `Array` | 3 strategy objects |
| `selectedStrategy` | `string \| null` | Currently selected strategy |
| `onSelect` | `(strategy) => void` | Selection callback |

**Per-strategy card shows:**
- Strategy label (e.g., "Direct & Short")
- Subject line
- First 2 lines of message body (truncated)
- Reasoning (collapsed, tap to expand)

**Strategy order:** Always `direct` → `warm` → `value`. First card (direct) is visually emphasized as default.

---

### 6. GameWeaponSelector.jsx

**Role:** Channel picker for sending the message.

| Prop | Type | Description |
|------|------|-------------|
| `contact` | `Object` | Contact with email/linkedin_url/phone |
| `selectedWeapon` | `string \| null` | Currently selected channel |
| `onSelect` | `(weapon: string) => void` | Selection callback |
| `gmailConnected` | `boolean` | Whether Gmail OAuth is active |

**Channels (from `sendActionResolver.js:30-36`):**
- EMAIL — enabled if `contact.email` exists
- LINKEDIN — enabled if `contact.linkedin_url` exists
- TEXT — enabled if `contact.phone` exists
- CALL — enabled if `contact.phone` exists

**Default selection logic (new — G1 compliant, pure UI):**
1. If `contact.email` && `gmailConnected` → default EMAIL
2. Else if `contact.linkedin_url` → default LINKEDIN
3. Else if `contact.email` → default EMAIL (native mailto)
4. Else → no default, user must pick

**UI:** Horizontal row of icon buttons. Disabled channels grayed out. Reference: `HunterContactDrawer.jsx:782-822`.

---

### 7. GameReviewSend.jsx

**Role:** Final review before sending. Shows complete message + channel.

| Prop | Type | Description |
|------|------|-------------|
| `message` | `string` | Message body (editable) |
| `subject` | `string` | Subject line (editable) |
| `weapon` | `string` | Selected channel |
| `contact` | `Object` | Contact being engaged |
| `onSend` | `() => void` | Send callback |
| `onBack` | `() => void` | Go back callback |
| `loading` | `boolean` | Send in progress |

**Editable fields:** Subject line input + message body textarea. Reference: `HunterContactDrawer.jsx:765-779`.

**Send button:** `disabled={!message || loading}` — mirrors `HunterContactDrawer.jsx:890`.

---

### 8. GameSessionBar.jsx

**Role:** Persistent top bar showing session metrics.

| Prop | Type | Description |
|------|------|-------------|
| `elapsed` | `number` | Elapsed time in ms (pause-adjusted) |
| `engagements` | `number` | Completed engagements |
| `goal` | `number` | Session goal (default 15) |
| `streak` | `number` | Current consecutive streak |
| `timeLimit` | `number` | Session time limit in ms (default 30min) |

**Layout:** `[Timer] [Engagements: 7/15] [Streak: 3]`

**Timer display:** `MM:SS` countdown from 30:00. When exceeded, switches to count-up with different color. Never stops the session.

---

### 9. GameIntentChip.jsx

**Role:** Displays auto-intent as a compact chip. Tappable for override.

| Prop | Type | Description |
|------|------|-------------|
| `intent` | `string` | Current auto-intent string |
| `onOverride` | `(newIntent: string) => void` | Override callback |
| `sessionMode` | `string` | For showing mode label |

**Default state:** Compact chip showing session mode label (e.g., "Build Pipeline"). Tap to expand.

**Expanded state:** Shows full intent string in editable text input + session mode quick-swap buttons. Tap "Apply" to override and re-generate messages.

---

### 10. GameSessionSummary.jsx

**Role:** End-of-session results screen.

| Prop | Type | Description |
|------|------|-------------|
| `engagements` | `number` | Total engagements |
| `elapsed` | `number` | Total time (pause-adjusted) |
| `streak` | `number` | Best streak |
| `fastest` | `number` | Fastest engagement in ms |
| `average` | `number` | Average engagement time in ms |
| `skipped` | `number` | Cards skipped |
| `deferred` | `number` | Cards deferred |
| `onNewSession` | `() => void` | Start new session |
| `onExit` | `() => void` | Return to Scout main |

**Metrics displayed:**
- Engagements completed vs goal (e.g., "12 / 15")
- Time elapsed (e.g., "27:43")
- Best streak
- Fastest engagement
- Average time per engagement

---

### 11-15. Supporting Components

| Component | Role | Key Props |
|-----------|------|----------|
| `GameLoadingCard.jsx` | Skeleton card while messages generate | `companyName`, `contactName` |
| `GameErrorCard.jsx` | Error state with retry | `error`, `onRetry`, `onSkip` |
| `GameDeferButton.jsx` | "Save for later" button | `onDefer`, `disabled` |
| `GameSkipButton.jsx` | Skip/reject button | `onSkip` |
| `GameProgressRing.jsx` | Circular progress (engagements/goal) | `current`, `total`, `size` |
| `GameStreakIndicator.jsx` | Streak counter with fire animation | `streak`, `bestStreak` |

---

## HOOKS

### useScoutGameSession.js

**Role:** Manages all session state in localStorage + React state.

```javascript
function useScoutGameSession() {
  // Returns:
  return {
    // State
    sessionId,          // string — UUID
    sessionMode,        // string — selected mode
    isActive,           // boolean — session in progress
    engagements,        // number — completed count
    currentStreak,      // number — current consecutive
    bestStreak,         // number — session best
    fastestEngagement,  // number — ms
    averageEngagement,  // number — ms
    cardIndex,          // number — current position

    // Actions
    startSession,       // (mode: string) => void
    recordEngagement,   // (durationMs: number) => void
    recordSkip,         // () => void
    recordDefer,        // () => void
    advanceCard,        // () => void
    endSession,         // () => SessionSummary

    // Persistence
    restoreSession,     // () => boolean — returns true if session restored
    clearSession,       // () => void
  };
}
```

### useGamePrefetch.js

**Role:** Manages message pre-generation buffer.

```javascript
function useGamePrefetch(cards, sessionMode) {
  // Returns:
  return {
    buffer,             // Map<cardId, {messages, error}>
    isLoading,          // boolean — any prefetch in progress
    getMessages,        // (cardId: string) => messages | null
    retryCard,          // (cardId: string) => Promise<void>
    prefetchProgress,   // { loaded: number, total: number }
  };
}
```

### useGameTimer.js

**Role:** Timer with pause/resume via `visibilitychange`.

```javascript
function useGameTimer() {
  // Returns:
  return {
    elapsed,            // number — pause-adjusted elapsed ms
    isRunning,          // boolean
    isPaused,           // boolean
    start,              // () => void
    stop,               // () => void
    getDisplayTime,     // () => string — "MM:SS" format
  };
}
```

---

## UTILITY

### buildAutoIntent.js

**Role:** Pure function. Constructs intent string from card data + session mode.

```javascript
// Input: contact object, company object, session mode string
// Output: non-empty intent string that passes generate-engagement-message.js:81 validation
export function buildAutoIntent(contact, company, sessionMode) { ... }
```

See Engineering Build Prompt for full implementation.

---

## EXISTING COMPONENTS REFERENCED (NOT MODIFIED)

| Component | Import For | Reference Lines |
|-----------|-----------|----------------|
| `CompanyCard.jsx` | Swipe gesture patterns, fallback rendering | Lines 43-60 (touch), 159-289 (render) |
| `HunterContactDrawer.jsx` | Engagement flow reference, weapon grid | Lines 782-822 (weapons), 890 (send gate) |
| `EngagementIntentSelector.jsx` | Intent option patterns | Lines 4-37 |
| `DailyLeads.jsx` | Company loading, swipe status writes | Lines 56-67, 184 |

---

## ROUTING

Add to existing router in `App.jsx`:

```jsx
<Route path="/scout/game" element={<ScoutGame />} />
```

Add navigation entry point in `ScoutMain.jsx` — a "Game Mode" button/card that links to `/scout/game`.
