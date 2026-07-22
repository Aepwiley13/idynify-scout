# Phase 2 — Known Issues & Design Constraints

_Captured during Phase 0 (Foundation Fixes), July 2026._

**These are not bugs. They are design constraints that must be inputs to Phase 2 — not discoveries during Phase 2.** Each was surfaced and deliberately scoped out of Phase 0; each one shapes how Phase 2 (Hunter follow-up surfacing) must be designed. Do not build follow-up automation without accounting for all four.

---

## 1. `email_logs` cannot distinguish sequence sends from one-off drawer sends

Both are tagged `source: 'quick_engage'` because `executeSendAction` routes through `gmail-send-quick`, which hardcodes that tag ([netlify/functions/gmail-send-quick.js](netlify/functions/gmail-send-quick.js)).

**Implication:** If Phase 2 needs sequence-vs-one-off performance data, that distinction must come from the timeline (`sequence_step_sent` presence in `users/{uid}/contacts/{id}/timeline`), **not** from `email_logs`. `email_logs` alone cannot make this distinction.

## 2. `contact_status_changed.statusFrom` is unreliable

Neither `executeSendAction` nor `recordStepSent` passes `currentStatus` to `updateContactStatus`, so it defaults to `NEW` ([src/utils/contactStateMachine.js:240](src/utils/contactStateMachine.js:240)). Every `contact_status_changed` event reads `NEW → awaiting_reply` regardless of the contact's actual prior state.

**Implication:** If Phase 2 reads `statusFrom` to reason about a contact's journey, it will get bad data. The event tells you a status *change happened* and its target, but the `from` value cannot be trusted.

## 3. No reply detection exists

The `awaiting_reply` transitions are **send-side only** — they fire when a message goes out, not when a reply comes in. The Gmail OAuth scope is send-only (`gmail.send`, [netlify/functions/gmail-oauth-init.js](netlify/functions/gmail-oauth-init.js)).

**Implication:** Phase 2's follow-up surfacing must account for the fact that Barry cannot know whether a contact has replied. **Auto-send is not safe** until `gmail.readonly` or `gmail.metadata` scope is added and re-consent is collected from existing users. Until then, Phase 2 should surface follow-ups for one-tap approval only — never send automatically.

## 4. Calendar-from-sequence is deferred

Calendar steps in sequences are currently record-only (`onSent()` called directly, no `executeSendAction`). Routing calendar sequence steps to the real `createCalendarEventViaApi` requires date/time fields that `GeneratedContentReview` does not capture. This is net-new UI work scoped to a later phase, not Phase 0.

---

_These four items feed directly into the Phase 2 brief. Do not lose them._
