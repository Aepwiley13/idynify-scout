# Capture mode, enrollment and the operation record

Relationship Capture (snap a business card, review it, save the person) is off until `CAPTURE_MODE` says otherwise. This page covers the switches, how to let a user in, what `captureConfig` returns and what each scan stores. It implements sections 12, 23 and 24 of the architecture plan.

## Switches

| Variable | Values | Effect |
|---|---|---|
| `CAPTURE_MODE` | `off`, `internal`, `beta`, `on` | Who may capture (below) |
| `CAPTURE_WITNESS` | `on`, `off` | The second-opinion OCR check |
| `CAPTURE_REPORTS` | `on`, `off` | Opt-in bad-scan reports |

Only those exact values count. Unset, empty, mixed-case (`On`) or padded (` on`) values mean **off**, as `GMAIL_IDENTITY_MODE` does. `netlify/functions/utils/captureFlags.js` is the only file that reads `CAPTURE_MODE`.

| Mode | Who may capture |
|---|---|
| `off` | No one. This is the default |
| `internal` | Admins and super admins (`role` on the user document, or `ADMIN_USER_IDS` / `SUPER_ADMIN_USER_IDS`) |
| `beta` | Admins and super admins, plus users enrolled in `capture_enrollment` |
| `on` | Every signed-in user |

**Where to set it.** In the Netlify UI, for the **Production** context only. `netlify.toml` pins `CAPTURE_MODE = "off"` for branch deploys and deploy previews, because they share the production Firebase project: a preview that captured a card would write a real contact. That pin is defence in depth, with the same limits as the `GMAIL_IDENTITY_MODE` pin described in `netlify.toml`.

**Turning it off.** Set `CAPTURE_MODE=off`. New captures stop without a deploy. Already-saved data stays valid, because it uses the normal contact, company and event shapes.

## Enrolling a beta user

Enrollment is the server-only document `capture_enrollment/{uid}`:

```
{ stage: 'beta', enrolledAt: <timestamp>, enrolledBy: '<admin uid>' }
```

A user is enrolled only when `stage` is exactly `'beta'`. Firestore rules deny every client read and write, so a user cannot enroll themselves. Until the admin tool exists, create the document in the Firebase console or with an Admin SDK script. Delete it to remove the user.

Enrollment is deliberately not on `users/{uid}`: that document is partly client-writable, and its `features` map is replaced wholesale by the Stripe webhook.

## `captureConfig`

```
POST /.netlify/functions/captureConfig
Authorization: Bearer <Firebase ID token>
{ "userId": "<uid>" }

200 { "enabled": true, "stage": "beta", "witnessEnabled": false, "reportEnabled": false }
```

- **Who may ask:** the user themselves, or an admin with an active impersonation session for exactly that user, who then gets that user's answer. Any other caller gets 403. This is stricter than `verifyAuthToken`, which lets any admin act as any user.
- **When capture is not enabled:** `stage` is `null` and both switches read `false`.
- **Reads:** only what the mode needs. Nothing when `off` or `on`, the admin check when `internal`, and the enrollment document only in `beta` for a non-admin.
- **Not the gate:** the app shows "Capture a contact" only when `enabled` is true, but every capture endpoint checks the mode itself.
- **Errors:** 405, 400, 401 or 403, with `{ "error": "<code>" }`. The function's own log lines carry the outcome code only; the existing admin checks it reuses log as they always have.

## The operation record

Each scan has one server-only document, `users/{uid}/capture_operations/{operationId}`. The `operationId` is `cap_` plus a lower-case UUIDv4, minted by the client when capture starts. `netlify/functions/utils/captureOperations.js` is the only writer, through the Admin SDK. Firestore rules deny every client read and write, including the owner's.

| From | To | When |
|---|---|---|
| nothing | `created` | First call. A second create returns the existing record |
| `created` | `extracted` | The provider returned a result |
| `created` | `previewed` | Manual entry, or resuming an expired scan |
| `created`, `extracted` | `failed` | `image_rejected`, `no_text` or `config_error`. Terminal |
| `extracted`, `previewed` | `previewed` | Each preview. `previewVersion` + 1 |
| `previewed` | `committed` | Save succeeded. `previewVersion` must match |
| any open state | `expired` | 24 h after the last activity, set on the next touch |
| `committed` | `committed` | A repeat save writes nothing and replays the stored result |

Retryable errors (timeout, rate limit, provider unavailable, bad output, network) leave the state unchanged, so the client retries with the same `operationId`.

**Values-free.** The record holds state, versions, hashes, timings, counts, error codes and result IDs. It never holds what was on the card: no name, email, phone, title, company, website, address, OCR text or image. This is enforced in two ways:
- Each transition accepts only its own fields; anything else is refused with `field_not_allowed`.
- Every string must be code-like (a lower-case token, a `sha256:` hash, a document ID or a `rev_` event ID), so free text is refused with `invalid_field`.

| Field | Set on |
|---|---|
| `operationId`, `state`, `previewVersion`, `createdAt`, `updatedAt`, `lastActivityAt`, `expiresAt` | Every record |
| `extraction` {`status`, `provider`, `model`, `promptVersion`, `ms`, `fieldCount`} | `extracted`; `status` only (`manual` / `resumed`) on created → previewed |
| `previewFingerprint`, `identityInputsHash` | `previewed` |
| `errorCode`, `failedAt` | `failed` |
| `result` {`contactId`, `companyId`, `relationshipEventIds`}, `committedAt` | `committed` |
| `expiredAt` | `expired` |

**Retention.** `expiresAt` is 24 h after the last activity for an open or failed record, and 90 days after commit for a committed one. Nothing deletes records yet. A Firestore TTL policy on `capture_operations.expiresAt`, or a daily cleanup job, is configured separately before Stage 1.

## Firestore rules

`capture_operations`, `capture_reports` and `capture_enrollment` deny every client read and write. The emulator suite in `scripts/rules-check` covers them. Rules changes reach production only when deployed:

```
firebase deploy --only firestore:rules --project idynify-scout-dev
```
