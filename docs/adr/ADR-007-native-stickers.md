# ADR-007 — Native stickers

**Status:** Proposed · 2026-11-04 · awaiting product-owner acceptance
**Plan:** `docs/contact-hub/NATIVE_STICKERS_PLAN.md`
**Implemented by:**
- S2 rules (Aepwiley13/idynify-scout#762)
- S3 rollout flag (#764)
- S4 services (#763)

All are drafts.

---

## Decision

Stickers are a user's own named, colored relationship categories ("Board member", "Donor", "Volunteer"), attached to the contacts already in IDYNIFY. There is no second contact store, no data from the original Contact Hub, and no team sharing.

1. **Definitions**
   - `users/{uid}/stickers/{stickerId}`, where `stickerId` is a Firestore auto-ID: never derived from a count, never reused.
   - Fields: `name`, `color`, `emoji`, `description`, `status` (`active` | `archived`), timestamps, `created_by`, `schema_version`.
   - Stickers are **never deleted**: archived ones are hidden, and their memberships are kept for a restore.
2. **Membership** lives on the contact:
   - `sticker_ids[]` (at most 50)
   - `sticker_assignments.<id>` = `{assigned_at, assigned_by}`
   - `sticker_change` = `{op, sticker_id, at}`, naming the one sticker a write adds or removes
3. **One writer.**
   - `src/services/stickers/stickerCore.js` alone writes definitions and membership.
   - Membership changes run in a transaction against the stored contact and sticker, and change the list with `arrayUnion` / `arrayRemove`.
   - A source scan in CI fails the build if any other module writes either.
4. **The rules are the gate.**
   - Every sticker write is a client write.
   - `firestore.rules` checks ownership, the rollout mode, the field shape, that a membership write changes exactly one sticker, that an added sticker exists, belongs to the same user and is active, and the 50 limit.
5. **Rollout lives in Firestore.**
   - `feature_flags/stickers.mode` (`off` | `internal` | `beta` | `on`) and `sticker_enrollment/{uid}`, both server-only.
   - Admins are `users/{uid}.role` in (`admin`, `super_admin`).
   - The rules and the `stickersConfig` endpoint read the same documents and call the same decision.
6. **Stickers and tags stay separate.**
   - Tags remain free-text labels, including CSV import group tags.
   - No automatic conversion either way.
7. **Barry** may read the names of a contact's active stickers and its relationship type. It never writes stickers, never acts on them alone, and does not read contact notes (S10).

## Reason

- **Stable identity.** The original Contact Hub restarted sticker IDs at `stk_100` on every page load and overwrote existing stickers, so contacts silently joined the wrong sticker. Free-text tags have the opposite problem: a rename touches every contact, and two categories with one name merge. An auto-ID with a create-only rule fixes both. A `set()` over an existing sticker is an update that changes `created_at`, and the rules deny it.
- **Client writes need a server-side gate.** Stickers are written from the browser. A UI check is only a convenience; the rules are the only thing that stops a crafted client.
- **Rules cannot read environment variables**, so a rollout mode kept in an env var (the Capture pattern) could not gate client writes. Keeping it in Firestore lets the rules and the endpoint give one answer, and a shared parity table proves they do. That is also why the env admin lists are not used here.
- **Rules cannot loop over a list.** Naming the single changed sticker in `sticker_change` lets them check the set difference against it and look it up. That makes "only an existing active sticker of the same user" enforceable without trusting the client.
- **Contention.** The emulator showed that under contention the server judges a stale write against newer data and refuses it with `permission-denied`, which Firestore does not retry.
  - `arrayUnion` / `arrayRemove` make the change relative to the stored list, so concurrent adds of different stickers both land.
  - A bounded re-read (4 attempts) covers the rest, such as two adds of the same sticker.
  - A genuine refusal fails every attempt.

## Consequences

- **A contact is never created with stickers.** A path that wants both creates the contact, then adds stickers (CSV import in S8).
- **A write that would drop a contact's stickers is refused,** including a full-document `set()` over a contact that has stickers. This is intended: it turns a silent clobber into an error. The create paths that use `set()` run after identity resolution and normally write new documents.
- **A future duplicate merge** (the dedup sprint) must union `sticker_ids` and `sticker_assignments`. If it runs server-side, it needs an exemption in `scripts/lib/stickerWritePaths.mjs`, with a reason, and must produce the same shape.
- **Cost.** A sticker write costs up to four extra document reads in the rules (mode, role, enrollment, sticker). Writes that don't touch sticker fields cost nothing extra.
- **Rollback never broadens.** Set the mode to `off` (no deploy), or make `stickerRulesEnabled()` return false and deploy. **Reverting the rules section is not a rollback**: it would let the owner write stickers and membership unchecked.
- **Admins listed only in `ADMIN_USER_IDS`** are not sticker admins. Set `users/{uid}.role` for anyone who should be.
- **Viewing as another user is read-only** for stickers: the UI hides the controls, and the rules refuse the admin's writes on someone else's data.
- **Barry's read (S10)** will add the first exemption to the write-path scan, as a read.

## Verified by

- `scripts/rules-check/stickers.mjs`: 115 emulator cases against the live rules and the rollback variant.
- `scripts/rules-check/sticker-services.mjs`: the real `stickerCore` against the real rules, concurrency included.
- `src/test/stickersAccess.test.js`, `src/test/stickersConfig.test.js`: the parity table on both sides.
- `src/test/stickerCore.test.js`, `src/test/stickerWritePaths.test.js`, `src/test/useStickersAvailability.test.jsx`.
- Each guard was checked against a deliberate regression (recorded in the PRs).
