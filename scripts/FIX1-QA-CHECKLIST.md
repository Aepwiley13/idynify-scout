# Fix 1 — Path-Mapped Expected-Writes Checklist

Verifies the Firestore write surface of a **sequence-step send** (`SequencePanel.jsx` → `executeSendAction`) on current `main`. Companion to `scripts/qa-fix1-verify.mjs`, which asserts all of the DB items below automatically.

- `{uid}` = authenticated user id · `{cid}` = contactId · `{mid}` = missionId
- "in window" = written since the moment just before the test send (the script's `--minutes`/`--since` window)

---

## A. Gmail-connected email send (SEND_RESULT.SENT) — expect ALL

| # | Item | Firestore path | Field / shape | Expected | Script check |
|---|------|----------------|---------------|----------|--------------|
| 1 | Email arrives | — (recipient inbox) | — | Real email received | **manual** (not in script) |
| 2 | Success banner after resolve | — (UI) | — | Banner shows only after `executeSendAction` resolves | **manual** (not in script) |
| 3a | `message_sent` event | `users/{uid}/contacts/{cid}/timeline/{id}` | `type == 'message_sent'`, `actor == 'user'` | exactly 1 in window | ✅ |
| 3b | `contact_status_changed` ×2 | `users/{uid}/contacts/{cid}/timeline/{id}` | `type == 'contact_status_changed'` | **2** in window (one per state write) | ✅ |
| 3c | `sequence_step_sent` event | `users/{uid}/contacts/{cid}/timeline/{id}` | `type == 'sequence_step_sent'`, `preview == 'Sent Step N'` | exactly 1 in window | ✅ |
| 4 | Two awaiting-reply state writes | `users/{uid}/contacts/{cid}` | `contact_status`, `contact_status_updated_at` | `contact_status == 'awaiting_reply'`; the two writes are observable as the 2× `contact_status_changed` in 3b | ✅ (final value + count) |
| 5 | activity_log append + last_contacted | `users/{uid}/contacts/{cid}` | `activity_log[]` entry `{type:'email_sent', timestamp, channel:'email', …}`; `last_contacted` (ISO) | ≥1 send entry in window; `last_contacted` in window | ✅ |
| 6 | Mission per-contact progress | `users/{uid}/missions/{mid}` → `contacts[]` where `contactId == {cid}` | `stepHistory[]` entry `action:'sent'` (+`sentAt`); `sequenceStatus == 'awaiting_outcome'`; `lastTouchDate` (ISO) | all three in window | ✅ |
| 7 | email_logs record | `email_logs` (top-level) | `{userId:{uid}, contactId:{cid}, source:'quick_engage', status:'sent', gmailMessageId, sentAt}` | exactly 1 in window | ✅ |

> Timeline note: assert the four docs (3a+3b+3c) **as a set** — several writes are fire-and-forget, so their relative timestamp order can shuffle. A full approve→send run shows **6** timeline docs (adds `sequence_step_proposed` + `sequence_step_approved` from the approval action, which precede these four).

## B. Failed send (SEND_RESULT.FAILED) — step must NOT advance

Run the script with `--mode failed`.

| # | Item | Firestore path | Expected | Script check |
|---|------|----------------|----------|--------------|
| 1 | No step advance | `users/{uid}/contacts/{cid}/timeline` | **no** `sequence_step_sent` in window | ✅ |
| 2 | No send logged | `users/{uid}/contacts/{cid}/timeline` | **no** `message_sent` in window | ✅ |
| 3 | Mission unchanged | `users/{uid}/missions/{mid}` → `contacts[]` | **no** new `stepHistory action:'sent'` in window | ✅ |
| 4 | No email logged | `email_logs` | **no** `quick_engage` doc in window | ✅ |
| 5 | `onSent()` not fired | — | implied by 1 & 3 (no advance, no `sequence_step_sent`) | ✅ (via 1, 3) |

## C. Phone step — record-only, unchanged

| Item | Expected | Check |
|------|----------|-------|
| No `executeSendAction` call | No `message_sent`, no `activity_log` email entry, no `email_logs` doc | manual / DB spot-check |
| Step advances (record-only) | `sequence_step_sent` present; `stepHistory action:'sent'` | manual / DB spot-check |

## D. Calendar step — record-only (deferred, see PHASE2-KNOWN-ISSUES.md #4)

| Item | Expected | Check |
|------|----------|-------|
| No `executeSendAction` call | No `calendar-create-event` call, no real event created | manual |
| Record-only, step advances | `sequence_step_sent` present; `stepHistory action:'sent'` | manual |

---

## Running the script

```bash
# credentials (one of):
export FIREBASE_PROJECT_ID=... FIREBASE_CLIENT_EMAIL=... FIREBASE_PRIVATE_KEY='...'
# or: export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# successful send:
node scripts/qa-fix1-verify.mjs --uid <uid> --contact <cid> --mission <mid> --minutes 10

# failed send:
node scripts/qa-fix1-verify.mjs --uid <uid> --contact <cid> --mission <mid> --mode failed
```

Exit code: `0` all passed · `1` one or more failed · `2` setup/usage error. Read-only — never writes, never sends.
