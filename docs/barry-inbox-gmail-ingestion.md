# Barry Inbox Intelligence — Gmail Ingestion (Team A, Sprint 1)

Team A owns everything from the Gmail API up to the `NormalizedMessage` object.
Everything after that — contact matching, timeline events, conversation state,
relationship context, the Barry queue — belongs to Team B and is reached through
a single call:

```js
await processNormalizedMessage(db, normalizedMessage);
```

That call is the entire integration surface.

## Files

| File | Role |
| --- | --- |
| `netlify/functions/utils/gmailMessageService.js` | Shared service — OAuth, Gmail API access, MIME decoding, normalization, classification, filtering |
| `netlify/functions/gmail-sync-worker.js` | Scheduled worker — runs every 10 minutes, drives all ingestion |
| `src/test/gmailMessageService.test.js` | Unit tests for the service (81 tests) |
| `src/test/gmailSyncWorker.test.js` | Worker tests against a fake Firestore + fake Gmail client (28 tests) |

## Firestore schema change

Sync state is added to the **existing** Gmail integration document. No existing
field is modified or removed.

**Path:** `users/{userId}/integrations/gmail`

**Untouched existing fields:** `accessToken`, `refreshToken`, `expiresAt`,
`status`, `email`, `updatedAt`.

**New fields:**

| Field | Type | Meaning |
| --- | --- | --- |
| `lastHistoryId` | `string \| null` | Gmail `historyId` cursor for incremental sync. Absent until the first successful run. |
| `lastSuccessfulSyncAt` | `string \| null` | ISO 8601 UTC. Written only when a run completes with zero failures. |
| `syncStatus` | `"idle" \| "syncing" \| "error" \| "needs_reconnect"` | Current state of this account's sync. |
| `lastSyncError` | `string \| null` | Error text when `syncStatus === "error"`. Cleared on the next clean run. |
| `nextSyncAt` | `string \| null` | ISO 8601 UTC. Informational — when the next run is expected. |

No Firestore rules change is required: these fields live on a document the
backend already writes with admin credentials, and no client reads them yet.

No new composite index is required either. The worker finds connected accounts
with a collection-group query on a single field
(`collectionGroup('integrations').where('status', '==', 'connected')`), which
Firestore's automatic single-field indexing already covers, and filters to the
`gmail` document in memory.

## How the worker runs

Scheduled with the `@netlify/functions` `schedule()` helper — the cron lives in
the function export, not in `netlify.toml`:

```js
export const handler = schedule('*/10 * * * *', syncHandler);
```

`netlify.toml` gains only a timeout entry for the function, since a run may walk
up to 50 accounts.

Each invocation:

1. Finds every user with `integrations/gmail.status === "connected"`, ordered
   least-recently-synced first so a growing tenant list still gets fair
   coverage. Caps at 50 accounts per run.
2. Per user: loads OAuth credentials, refreshes the token if it is within 60
   seconds of expiry, and does a `users.getProfile` scope check.
3. Pulls new message IDs — incrementally via `users.history.list` when a cursor
   exists, otherwise the 20 most recent INBOX messages.
4. For each message: fetch → normalize → filter → validate → hand to Team B.
5. Advances the cursor and stamps `lastSuccessfulSyncAt`.

A per-run time budget (240 s) stops the worker picking up new accounts near the
function timeout; deferred accounts sort first on the next run.

### Cursor safety

The rule that matters: **the cursor advances only after every message in the
batch has been processed successfully.**

- If a message fails, the worker stops on it and leaves `lastHistoryId`
  untouched. The next run replays the batch; Team B's idempotency makes the
  replay a no-op for anything already stored.
- Advancing early would skip a message permanently. Not advancing costs at most
  a duplicate call. The trade is deliberately asymmetric.
- On bootstrap, the cursor is the mailbox `historyId` captured *before* the
  batch was fetched, so mail arriving mid-run is replayed rather than skipped.

### Failure isolation

| Situation | Behaviour |
| --- | --- |
| Token refresh fails | `syncStatus: "needs_reconnect"`, user skipped, loop continues |
| `getProfile` returns 403 (missing read scope) | `syncStatus: "needs_reconnect"`, user skipped, loop continues |
| `history.list` returns 404 (cursor aged out) | Falls back to a 20-message inbox poll, cursor reset |
| Any other per-user error | `syncStatus: "error"` + `lastSyncError`, loop continues |
| A message fails validation | Logged and skipped; Team B is never called with an invalid payload |

One user failing never stops the loop for another — the worker processes users
serially with a `try`/`catch` around each.

## Message normalization

`normalizeMessage(rawMessage, idynifyUserId, gmailAccountId, options)` produces
the `NormalizedMessage` defined in `src/types/normalizedMessage.js`. Team B owns
that schema; Team A conforms to it and validates every payload with
`validateNormalizedMessage()` before handing it over.

Notable guarantees:

- `bodyText` is plain text with quoted replies and the signature removed, capped
  at 50,000 characters, and never empty — it falls back to the subject.
- `quotedReplyText` and `signature` carry the separated content.
- `receivedAt` comes from Gmail's `internalDate` (epoch ms) converted to ISO
  8601 UTC, falling back to the `Date` header.
- `gmailMessageId` is `msg.id`, never `msg.threadId`.
- `attachments` and `ccEmails` are always arrays, never `null`.
- `fromEmail` is lowercased and trimmed, with the display name stripped out.

### Classification

`classifyMessage()` evaluates in the order **automated → internal → reply →
new_inbound → unknown**.

Automated is checked first on purpose: a newsletter whose subject happens to
start with `Re:` would otherwise be mistaken for a real reply. Nothing real is
lost by the reordering, because automated mail on a thread Idynify already knows
about is still ingested (see filtering below).

### Filtering

`shouldProcessMessage()` implements Section 4 of the spec. The bias is toward
processing — Team B queues unknown senders in `unmatched_messages`, so a false
positive is cheap while a dropped reply from a real prospect is not.

Hard skips: outbound mail, self-sent mail, internal test mail, automated mail on
an unknown thread, and anything labelled `SPAM`, `TRASH`, `DRAFT`,
`CATEGORY_PROMOTIONS`, `CATEGORY_UPDATES`, `CATEGORY_SOCIAL` or
`CATEGORY_FORUMS`. Everything else goes to Team B.

## Deviations from the Sprint 1 spec

Three places where the spec's sample code and the spec's own contract disagreed;
the contract won in each case.

1. **Outbound category.** The spec's `normalizeMessage()` sample sets
   `category: 'outbound'`, but `"outbound"` is not one of the five
   `MESSAGE_CATEGORIES` and `validateNormalizedMessage()` rejects it. Outbound
   messages get `category: "unknown"` instead, keeping every payload
   schema-valid. They are filtered out before Team B either way.

2. **`classifyMessage` signature.** The spec exports it as a synchronous
   function, but its `new_inbound` rule needs a Firestore contacts lookup. The
   signature stays synchronous; the caller performs the lookup and passes
   `{ isKnownContact, threadMessageCount }` as an optional fifth argument.

3. **`sentAt`.** The sample hardcodes `null`. It is populated from the `Date`
   header when parseable — same type, strictly more information.

Two additions the spec did not specify:

- **A per-run time budget** so a large tenant list cannot push the worker past
  its function timeout mid-message.
- **`normalizeMessage` takes an `options` argument** for `threadMessageCount`
  and `isKnownContact`; the spec left `threadMessageCount` for "the caller" to
  set without saying how.

## Testing

```bash
npx vitest run src/test/gmailMessageService.test.js src/test/gmailSyncWorker.test.js
```

109 tests cover MIME decoding (single-part, multipart/alternative nested in
multipart/mixed, HTML-only, attachments), address parsing, quoted-reply
stripping across five marker styles, signature extraction, all five categories,
Section 4 filtering, cursor advance/hold behaviour, stale-cursor fallback,
scope-check reconnect, and per-user failure isolation.

For the end-to-end handoff test against Team B's deployed pipeline, see
Section 8 of the Team A specification.
