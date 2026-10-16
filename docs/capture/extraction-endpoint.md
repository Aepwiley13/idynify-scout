# Extraction endpoint (`captureExtract`)

`POST /.netlify/functions/captureExtract` reads one prepared card photo into a CardExtraction v1. It is read-only for the user's data: nothing is matched or saved, and the only write is the values-free operation record. The endpoint runs "an extractor" chosen by server settings. It does not know which extractor it is, and the client cannot choose one.

```
captureExtract.js            auth → capture mode → image check → extractor setting → operation → response
  └─ orchestrator.js         deadline, one retry, reading check, assembly
       ├─ extractor.extract  the only extractor-specific step (extractors.js picks it)
       ├─ cardReading.js     validateCardReading: the extractor's output is checked, not trusted
       └─ assembleExtraction.js   the trust boundary: PR 2 validators, safeguards, confidence → CardExtraction
```

## Request

```
POST  Authorization: Bearer <Firebase ID token>
{
  userId:      'uid…',                                     // must be the token's own user
  operationId: 'cap_<lower-case UUID v4>',                 // minted by the client when the scan starts
  image:       { version: 'card-image/v1', … }             // exactly docs/capture/prepared-image.md
}
```

The server checks `image` again with `checkPreparedImage`: shape and limits, real JPEG header, dimensions that match the header, and metadata stripped before any extractor sees the bytes. PR 6 does not trust PR 5.

## Response

```
200  { operationId, extraction }            extraction: CardExtraction v1 (src/capture/contract.js)
4xx/5xx  { error, operationId?, reason?, retryable? }
```

`extraction.capture.status` is `ok` (a name or a person identifier), `partial` (only other details), or `unreadable` (text read, nothing usable: offer manual entry). `no_text` is never a 200; it is a 422.

## Order of checks

| # | Step | Failure | Operation written? | Extractor called? |
|---|---|---|---|---|
| 1 | Method, JSON body, `userId`, `operationId` format | 405 / 400 `invalid_request` | No | No |
| 2 | Token is valid and is `userId` (no admin acting for another user) | 401 / 403 | No | No |
| 3 | Capture mode covers this user (`captureFlags.js`) | 404 `capture_disabled` | No | No |
| 4 | `checkPreparedImage` | 400 `image_rejected` + `reason` | No | No |
| 5 | `resolveExtractor` (`CAPTURE_EXTRACTOR`) | 503 `config_error` | No | No |
| 6 | `createOperation` (idempotent) | 409 `operation_conflict` + `reason: <state>` | Created if new | No |
| 7 | Extraction | see the tables below | One transition at most | Yes |

## The extractor interface

```
{
  id:              'fake'          lower-case token; recorded on the operation
  adapterVersion:  '1'             bumped when the adapter's mapping changes
  modelId:         'fake-v1'       the configured model, or null
  promptVersion:   'fake-v1'       bumped when the prompt or response schema changes
  billingProvider: 'fake'          the apiLogs provider (anthropic, google, …)
  extract({ image, signal }) → Promise<{ reading, usage, modelId? }>
}
```

- `image` is `{ mimeType, data, widthPx, heightPx }`: the metadata-stripped JPEG, nothing else (no preflight, no user, no operation).
- `signal` is an AbortSignal; pass it to the network call. The orchestrator also stops waiting at the deadline whether or not it is honoured.
- `reading` is a card-reading/v1 (`cardReading.js`): for each field, the printed text (`raw`, or null when not printed) and a 0–1 `score`. Phones also carry a printed `label`, and the company name carries `fromLogo`. There is no place for a level, a check, a source or a company domain. Extra keys make the reading invalid.
- `usage` is `{ inputTokens, outputTokens }`, nulls when unknown.
- `modelId`, when present, names the model that actually served the call (for example a fallback model); it is recorded only if it is a well-formed token.
- Failures throw `CaptureExtractorError(code, { usage, detail })`, with a code from the table below. `detail` is an optional diagnostic code for logs (`http_529`, `refusal`, `max_tokens`; anything not code-shaped is dropped). Nothing else is carried: no vendor message, body or card text.

### Adding an extractor (PR 7)

1. Write `netlify/functions/utils/capture/<name>Extractor.js` exporting a factory `(env) => extractor`. Throw from the factory when it cannot be built, for example when a key is missing (it becomes `config_error`).
2. Implement `extract()`: send the image, map the vendor's response to a card-reading/v1, and map the vendor's errors to the codes below.
3. Set `modelId` and `promptVersion`.
4. Add one line to `REGISTRY` in `extractors.js`.
5. Set `CAPTURE_EXTRACTOR=<id>` for the Production context.

Nothing else changes: the endpoint, the orchestrator, the assembler, the operation record and the response stay as they are. The import guard (`src/test/captureNoProductionImports.test.js`) fails if the endpoint, the orchestrator or the assembler names an extractor or a vendor.

## The trust boundary

Every extractor's reading goes through `validateCardReading`, then `assembleExtraction`, then `validateCardExtraction`. Only the orchestrator imports the assembler, and the endpoint returns only what the orchestrator built.

- Levels come from `confidence.js`, never from the extractor. Its score sets the starting level, then: a failing validator check forces `unknown`, a doubt or a doubting safeguard caps `possible`, and every identifier (email, phone, website, domain, LinkedIn) is capped at `likely`, because no witness runs in V1. A photo that reached extraction with a quality warning is capped at `likely` everywhere.
- Validators check, they never repair. A malformed email stays as printed, with level `unknown` and no normalized form. An OCR-suspect host (`example.c0m`) is `possible`, and nothing is corrected.
- Nothing is invented. A field that is not printed is `{ value: null, level: 'unknown' }`. The company domain comes only from a printed website, or else from a work email, and never from a free-mail, ISP, role or shared-host address. It is never above the text it came from. A company name never comes from a domain. A website that is really an email (or an email's local part) is dropped. A name part that is not in the printed full name is dropped, and a name part is never more certain than the full name. A phone kind only the extractor names, with no printed label, stops at `likely`.
- An assembly that would break the contract is `invalid_output`, never a partial answer.

## Operation transitions

| Before | Outcome | After | HTTP |
|---|---|---|---|
| (none) | any | `created` first, then as below | |
| `created` | extraction `ok` / `partial` / `unreadable` | `extracted` (`unreadable` is stored as `partial`) | 200 |
| `created` | `no_text`, `image_rejected`, `config_error` (from the extractor) | `failed` + `errorCode` | 422 / 400 / 503 |
| `created` | retryable error | `created` (unchanged) | 429 / 502 / 503 / 504 |
| `extracted` | any | `extracted` (unchanged: the response was lost, so it reads again with no second transition) | as the outcome |
| `failed`, `expired`, `previewed`, `committed` | not run | unchanged | 409 `operation_conflict`, `reason` = state |
| open and untouched for 24 h | not run | `expired` | 409, `reason: expired` |

Two concurrent requests for one scan both answer, and the second transition is refused by the store (`invalid_transition`), which is tolerated.

## Retries

| Error | Retried in the request | Client may retry the same `operationId` | HTTP |
|---|---|---|---|
| `timeout` | Once, if ≥ 5 s of the 22 s deadline remain | Yes | 504 |
| `rate_limited` | Once | Yes | 429 |
| `unavailable` (also any unmapped exception) | Once | Yes | 503 |
| `network` | Once | Yes | 502 |
| `invalid_output` (a malformed reading) | Once | Yes | 502 |
| `invalid_output` (an assembly that breaks the contract) | No | Yes | 502 |
| `config_error` | No | No (the scan fails) | 503 |
| `image_rejected` (by the extractor) | No | No (the scan fails; retake) | 400, `reason: rejected_by_extractor` |
| `no_text` | No | No (the scan fails; retake) | 422 |

Limits: 22 s for the whole extraction, measured from the start of the request (the function's own limit is 26 s, set in `netlify.toml`), 12 s per attempt, and at most 2 attempts. A retryable response carries `retryable: true`.

## Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `method_not_allowed` | 405 | Not POST |
| `invalid_request` | 400 | Body is not JSON, or `userId` / `operationId` is malformed |
| `image_rejected` | 400 | The image failed the server check (`reason`: an `IMAGE_ERRORS` code) or the extractor refused it (`reason: rejected_by_extractor`) |
| `unauthorized` | 401 | No token, or the token is invalid |
| `forbidden` | 403 | The token belongs to another user |
| `capture_disabled` | 404 | The capture mode does not cover this user |
| `operation_conflict` | 409 | The scan is failed, expired, previewed or committed (`reason` names the state) |
| `no_text` | 422 | Nothing readable on the photo |
| `rate_limited` | 429 | The extractor is rate-limited |
| `internal_error` | 500 | Anything unexpected; nothing from the error is returned or logged |
| `invalid_output` | 502 | The extractor's answer was malformed |
| `network` | 502 | The extractor could not be reached |
| `unavailable` | 503 | The extractor failed |
| `config_error` | 503 | No usable extractor is configured |
| `timeout` | 504 | No answer within the deadline |

## Settings

| Variable | Values | Default |
|---|---|---|
| `CAPTURE_MODE` | `off` / `internal` / `beta` / `on` (docs/capture/capture-mode.md) | off. Pinned off for branch deploys and deploy previews |
| `CAPTURE_EXTRACTOR` | a registered id: `fake` | none: `config_error` |
| `CAPTURE_FAKE_SCENARIO` | see below | `card` |
| `CAPTURE_FAKE_DELAY_MS` | 0–15000 | 0 |

The fake extractor is refused unless the mode is `internal`, so a beta or general user can never be answered by it.

## The fake extractor

Deterministic, offline and free, and kept permanently, for CI, local runs, Capture Lab UI work and error states. It reads the same fictional card every time: Avery Quinn of Example Robotics, `example.com` (RFC 2606) and 555-01xx numbers. `CAPTURE_FAKE_SCENARIO` picks what every call does:

| Scenario | Result |
|---|---|
| `card` | The full card: 200, status `ok` |
| `partial` | Company details only: 200, `partial` |
| `low_confidence` | The card with low scores: 200, fields to review, nothing confirmed |
| `unreadable` | Text with nothing usable: 200, `unreadable` |
| `no_text` | 422, the scan fails |
| `invalid_output` | A reading carrying a domain (which no extractor may supply): refused twice, 502 |
| `timeout` | Never answers: 504 after 22 s |
| `timeout_once` | Times out on the first attempt, then reads the card: 200 after about 12 s |
| `rate_limited_once` | Rate-limited on the first attempt, then reads the card: 200 |
| `rate_limited`, `unavailable`, `network` | Fails twice with that code |
| `config_error`, `image_rejected` | Fails once, not retried; the scan fails |

An unknown scenario or delay is a `config_error`.

## Logging

Every log line from this endpoint is one JSON object written by `captureLog` (`evt: 'capture'`). Keys outside an allowlist are dropped, strings are cut to 64 characters, and arrays keep only short code strings. The import guard fails the build if capture server code calls `console` directly.

**Logged:** `operationId`, outcome and error codes, the extractor's diagnostic `detail` code, HTTP status, operation state, extractor id, adapter version, model id, prompt version, attempts, timings (`providerMs`, `validateMs`, `totalMs`), token counts, image size (`bytes`, `widthPx`, `heightPx`), how many metadata segments were removed, preflight warning codes and the override flag, extraction status, and field counts by level.

**Never logged:** the image or its base64, any name, email, phone, title, company, website, address or LinkedIn URL, OCR or card text, any extracted or normalized value, the ID token, or the user ID. (The existing `logApiUsage` call records the user ID on its usage row, as it does for every endpoint, with provider, model, tokens, timing, error code, and `{ operationId, attempts, extractor, promptVersion }`.)

## The operation record

`users/{uid}/capture_operations/{operationId}` holds state, timestamps, `previewVersion`, and after extraction `extraction: { status, provider, model, promptVersion, ms, fieldCount }`, or after a failure `errorCode`. `captureOperations.js` refuses any other field and holds every string to a code format. The tests check every write of a full run for card values and image bytes.
