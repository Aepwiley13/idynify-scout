# Basecamp + CSM Module — Deployment Review

**Reviewed by:** Claude (Code Review Agent)
**Date:** March 21, 2026
**Spec versions reviewed:** v1.0, v1.1, v1.2
**Codebase commit:** Current HEAD on main

---

## Executive Summary

The existing codebase provides a **solid foundation** for the Basecamp People view but has **zero CSM module implementation**. No CSM components, no health score logic, no success wizard, and no milestone tracking exist yet. The spec is well-structured across all three versions, with v1.2 resolving critical blockers. However, the current deployment has several alignment gaps that must be fixed before Sprint 1 work begins.

**Verdict: The spec is sound and the architecture is buildable. The codebase needs pre-work to resolve the status vocabulary conflict before card redesign can start.**

---

## Part 1: What Exists Today (Codebase Audit)

### Files That Exist and Are Correctly Referenced in Spec

| Spec Reference | Actual File Path | Status |
|---|---|---|
| EngagementCenter.jsx (Lines 64-100) | `src/pages/Basecamp/sections/EngagementCenter.jsx` | EXISTS — `getContactWaveStatus()` at line 64, returns `overdue \| active \| cold \| replied` |
| AllLeads.jsx | `src/pages/Scout/AllLeads.jsx` | EXISTS — has `deriveCardEngageState()` at line 81, returns `not_started \| in_mission \| follow_up_due \| replied \| converted` |
| BasecampMain.jsx | `src/pages/Basecamp/BasecampMain.jsx` | EXISTS — custom layout, NOT MainLayout (correct per spec) |
| timelineLogger.js | `src/utils/timelineLogger.js` | EXISTS — uses `preview`, `metadata`, `actor` fields (v1.2 correct) |
| peopleService.js | `src/services/peopleService.js` | EXISTS — has `customers` lens with `where('person_type', '==', 'customer')` |
| stageSystem.js | `src/constants/stageSystem.js` | EXISTS — has `resolveContactStage()`, maps customer -> basecamp |
| BarryChat.jsx | `src/components/barry/BarryChat.jsx` | EXISTS — has `MODULE_CONFIG` export, NO `basecamp` entry yet |
| gmail-oauth-callback.js | `netlify/functions/gmail-oauth-callback.js` | EXISTS — hardcodes redirect to `/hunter` (v1.2 bug confirmed) |
| PeopleSection.jsx | `src/pages/Basecamp/sections/PeopleSection.jsx` | EXISTS — renders `<AllLeads mode="basecamp" />` |

### Files That Do NOT Exist Yet (Must Be Created Per Spec)

| Planned File | Purpose | Sprint |
|---|---|---|
| `components/csm/CSMDashboard.jsx` | CSM view toggle target — card grid with health signals | Sprint 2 |
| `components/csm/CSMCard.jsx` | Individual CSM card component | Sprint 2 |
| `components/csm/ContactProfile.jsx` | Full contact profile with tabs | Sprint 2 |
| `components/csm/InterventionPlaybook.jsx` | Playbook display and phase state management | Sprint 3 |
| `components/csm/MilestoneGapReport.jsx` | Portfolio gap list | Sprint 3 |
| `components/csm/SuccessWizard.jsx` | 5-step setup wizard | Sprint 1 |
| `lib/healthScore.js` | Health score computation function | Sprint 1 |
| `lib/barryCSM.js` | Barry's Read generation, expansion signals | Sprint 2 |
| `lib/snoozeManager.js` | Snooze write/read/expiry logic | Sprint 1 |

**No `src/lib/` directory exists.** Engineers need to decide: create `src/lib/` (as spec says) or place these in `src/utils/` or `src/services/` to match existing conventions. The codebase currently uses `src/utils/` for utility functions and `src/services/` for data access.

**Recommendation:** Use `src/services/` for `healthScore.js`, `barryCSM.js`, and `snoozeManager.js` since they all involve Firestore reads/writes. This matches the existing pattern (`peopleService.js`, `hunterService.js`, etc.).

---

## Part 2: Spec Soundness Assessment

### The Spec Is Sound (What's Good)

1. **v1.2 corrections are critical and accurate.** The Firestore path fix from `contacts/{contactId}/` to `users/{userId}/contacts/{contactId}/` matches the actual codebase. The existing `timelineLogger.js` already writes to `users/{userId}/contacts/{contactId}/timeline/` — confirmed at line 104.

2. **Status vocabulary conflict correctly identified.** v1.2 Section 12.4 correctly identifies that `deriveCardEngageState()` and `getContactWaveStatus()` are parallel systems with different vocabularies. The mapping table is accurate:
   - `not_started` -> `cold` ✓
   - `in_mission` -> `active` ✓
   - `follow_up_due` -> `overdue` ✓
   - `replied` -> `replied` ✓
   - `converted` -> `converted` (needs to be added to `getContactWaveStatus()`) ✓

3. **`peopleService.js` correction is accurate.** v1.2 correctly says the customer filter is in `peopleService.js` (customers lens, line 68-76), NOT in `stageSystem.js`. The `stageSystem.js` only maps person_type to stages — it doesn't query contacts.

4. **Timeline schema alignment is correct.** v1.2 says to use `preview`, `metadata`, `actor` — and the existing `timelineLogger.js` already uses exactly these fields. The spec correctly warns against introducing `title`, `body`, `source`, `actorId`.

5. **Barry MODULE_CONFIG gap correctly identified.** There's no `basecamp` entry in MODULE_CONFIG. Currently BasecampMain uses `homebase` (line 181), which maps to a red color with GUIDE mode — not CSM-appropriate. The spec correctly calls for a teal/green `basecamp` entry.

6. **Gmail OAuth callback bug confirmed.** Line 135 hardcodes `Location: '/hunter?connected=true'`. No `return_to` or `state` parameter parsing exists.

### Spec Issues / Risks Found

#### ISSUE 1: `getContactWaveStatus()` Does NOT Handle `converted` Status

**Severity: Sprint 1 Blocker**

The spec says to add `converted` to `getContactWaveStatus()`. But the current function (EngagementCenter.jsx line 64-100) has no path that returns `converted`. It only returns `replied | active | cold | overdue`. The function checks `contactStatus`, `warmth`, and `lastContactAt` — but never checks for `converted` or `customer` status.

Meanwhile, `deriveCardEngageState()` in AllLeads.jsx line 85 DOES check: `if (contactStatus === 'converted' || contactStatus === 'customer' || hunterStatus === 'converted') return 'converted'`.

**Action needed:** When remapping, engineers must add the converted check to `getContactWaveStatus()` BEFORE the other checks (converted contacts should not appear as overdue/active/cold).

#### ISSUE 2: `ENGAGE_BADGE_CONFIGS` Color Mismatch with Spec

**Severity: Medium — Sprint 1**

The current `ENGAGE_BADGE_CONFIGS` in AllLeads.jsx uses:
- `not_started` (cold) → gray `#6b7280`
- `in_mission` (active) → purple `#7c3aed`
- `follow_up_due` (overdue) → red `#dc2626`
- `replied` → blue `#0ea5e9`

But the spec Section 2.2 defines card stripe colors as:
- overdue → **red** ✓ (matches)
- active → **green** ✗ (currently purple)
- replied → **blue** ✓ (matches)
- cold → **gray** ✓ (matches)

The `STATUS_CONFIG` in EngagementCenter.jsx (line 103-108) has the correct spec colors (green for active, red for overdue, blue for replied, amber for cold). When the remap happens, engineers should use the EngagementCenter colors, not the AllLeads colors.

**Also note:** The spec says cold = **gray** stripe, but EngagementCenter has cold = **amber** `#f59e0b`. The spec explicitly says "gray (cold)" in Section 2.2. This needs a decision — amber or gray for cold contacts?

#### ISSUE 3: `CARD_BTN_CONFIG` Labels Already Partially Match Spec

**Severity: Low — informational**

Current AllLeads.jsx `CARD_BTN_CONFIG`:
- `not_started` → 'Engage' ✓ (spec: Cold → 'Engage')
- `in_mission` → 'Follow Up' ✓ (spec: Active → 'Follow Up')
- `follow_up_due` → 'Follow Up Now' ✓ (spec: Overdue → 'Follow Up Now')
- `replied` → 'Respond' ✓ (spec: Replied → 'Respond')
- `converted` → 'View' (spec says 'View Account' — minor label update needed)

This is good news — the remap mostly works. Just need to change 'View' to 'View Account'.

#### ISSUE 4: Default Filter Change Impacts Existing Users

**Severity: Medium — UX Risk**

The spec says default filter on Basecamp People view should be 'Overdue' not 'All People'. Currently `BasecampMain.jsx` defaults to `people` tab (line 209), and AllLeads.jsx likely defaults to showing all contacts.

**Risk:** Existing users who open Basecamp and see zero contacts (because none are overdue) will think the app is broken. The spec should ensure a fallback — if overdue count is 0, show 'All People' instead with a subtle "No overdue contacts — nice work!" message.

#### ISSUE 5: Firestore Rules Are Ready

**Severity: None — this is good**

The firestore rules already allow read/write on `users/{userId}/{document=**}` for the authenticated user. All the new CSM subcollections (`successPlan`, `milestoneTemplates`, `contacts/*/milestones`, etc.) will work without rule changes.

#### ISSUE 6: No `src/components/csm/` Directory Exists

**Severity: None — expected at this stage**

No CSM components exist. This is expected — the spec is pre-Sprint 1. But it confirms that ALL CSM work is net-new.

#### ISSUE 7: `BasecampMain.jsx` Sub-Nav Doesn't Include CSM

**Severity: Expected — Sprint 2 item**

The current `BASECAMP_ITEMS` array (line 173-177) has: People, Companies, Engage. There's no CSM toggle. Per the spec, the CSM toggle goes in the top bar as a view switch (People View / CSM View), not as a sub-nav item. This is correct per spec — no sub-nav change needed.

However, the spec says the toggle is "in the top bar" but BasecampMain's top bar is the icon rail + sub-nav structure. The toggle needs to go inside the main content area's header (above the card grid), not the rail. Engineers should confirm the exact placement.

#### ISSUE 8: Barry Model Decision — `barryMissionChat` Uses Haiku Path

**Severity: Sprint 2 consideration**

The existing `BarryChat.jsx` calls `/.netlify/functions/barryMissionChat` (line 149). The spec says `barryCSM.js` must use `claude-sonnet-4-6`, not Haiku. The existing Barry function likely uses a different model. The CSM Barry service should be a separate Netlify function with its own model config — do NOT reuse `barryMissionChat` for CSM reads.

---

## Part 3: User Flow Assessment

### Flow 1: Basecamp People View (Currently Working)

```
User opens /basecamp
  → BasecampMain renders (custom layout, no MainLayout) ✓
  → Default tab: 'people' ✓
  → PeopleSection renders <AllLeads mode="basecamp" /> ✓
  → Cards show contact photos, status badges, action buttons ✓
```

**Gap:** Cards currently use `deriveCardEngageState()` vocabulary. After the Sprint 1 remap, they need to use `getContactWaveStatus()` vocabulary. The card layout exists but doesn't match the spec's photo zone anatomy (no 3px stripe, no days counter on photo, no floating badge).

### Flow 2: CSM Toggle (Does Not Exist Yet)

```
User clicks "CSM View" toggle → NOTHING HAPPENS (not built)
Expected: Toggle to CSM card grid with health scores, KPI strip
```

### Flow 3: Engagement Center (Working, Not CSM-Related)

```
User clicks "Engage" tab → EngagementCenter renders
  → Shows wave campaign builder (check-ins, product updates, meeting requests)
  → Uses getContactWaveStatus() for status ✓
```

This is a SEPARATE feature from CSM. The Engage tab is for running outreach waves — it's not the CSM dashboard.

### Flow 4: Gmail OAuth (Working but Buggy per Spec)

```
User connects Gmail from Hunter
  → OAuth flow starts
  → Callback at gmail-oauth-callback.js
  → Redirects to /hunter?connected=true (HARDCODED)
  → Should support return_to param for wizard Step 4
```

---

## Part 4: Critical Pre-Sprint 1 Actions

These must be done BEFORE Sprint 1 card redesign work begins:

### Action 1: Resolve Status Vocabulary (BLOCKER)

1. Add `converted` return value to `getContactWaveStatus()` in EngagementCenter.jsx
2. Remap `ENGAGE_BADGE_CONFIGS` in AllLeads.jsx from `deriveCardEngageState()` vocabulary to `getContactWaveStatus()` vocabulary
3. Remap `CARD_BTN_CONFIG` similarly
4. Deprecate `deriveCardEngageState()` (or keep as internal wrapper that calls `getContactWaveStatus()`)

### Action 2: Decide Cold Color

Spec says gray, EngagementCenter.jsx says amber. Pick one. Recommendation: go with the spec (gray) since cold contacts are low-priority and gray signals that.

### Action 3: Decide `lib/` vs `services/` Path

The spec says `lib/healthScore.js`. The codebase has no `lib/` directory. Decide now:
- Option A: Create `src/lib/` as spec says
- Option B: Put in `src/services/` to match existing patterns (recommended)

### Action 4: Add `basecamp` to Barry MODULE_CONFIG

This is a one-line addition but it's a prerequisite for the CSM toggle. Currently `homebase` is used which gives a red GUIDE persona — wrong for CSM. Add:
```js
basecamp: { color: '#14b8a6', label: 'CSM', opening: "I have your full portfolio loaded. Who needs attention today?" }
```

---

## Part 5: Open Questions the Spec Still Needs Answered

These are listed in Section 13.2 of v1.2 and still need decisions:

| Question | Sprint Blocked | Recommendation |
|---|---|---|
| Health score computation frequency | Sprint 1 | Event-triggered + 24h fallback (as spec recommends) |
| Slack + Salesforce OAuth | Sprint 3 | Start LinkedIn partner API application NOW |
| Batch outreach — send or draft only? | Sprint 3 | Draft only for MVP (as spec recommends) |
| CSM module tier gating | Sprint 2 | HUNTER tier+. Blocks BasecampMain toggle logic. |

---

## Part 6: Overall Verdict

### Is the spec sound?
**Yes.** v1.2 is a well-corrected, implementable specification. The three iterations show good engineering feedback cycles. The codebase integration map (Section 12) is accurate — every file reference checks out against the actual code.

### Is the flow in sync?
**Partially.** The existing People view flow works. The CSM flow doesn't exist yet (expected). The critical sync issue is the dual status vocabulary — two parallel systems that will create card rendering bugs if not resolved first.

### Is it usable by a user?
**The existing Basecamp People view is usable.** Users can see contacts, filter by brigade, open profiles, and engage. The CSM module is entirely unbuilt — users will have zero visibility into customer health, milestones, or renewal risk until Sprint 2 ships.

### Top 3 Risks

1. **Status vocabulary conflict** — If not resolved first, all card work in Sprint 1 will build on the wrong foundation and need rework
2. **No `lib/` directory convention** — Small but will cause inconsistency if engineers create some files in `lib/` and some in `services/`
3. **Gmail OAuth callback** — Must be fixed before wizard Step 4, and it touches an existing production flow (Hunter). Test thoroughly.

---

*Review complete. Ready for sprint planning.*
