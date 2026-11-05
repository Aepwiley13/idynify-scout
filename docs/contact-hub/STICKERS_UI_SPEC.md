# Stickers UI (S5–S7): implementation spec and acceptance tests

**Status:** Approved 2026-11-05 by the product owner, with the five decisions in §6 as proposed. Implemented in separate draft PRs (S5, S6, S7) behind the sticker availability flag.
**Builds on:**
- ADR-007, §1 of `NATIVE_STICKERS_PLAN.md`
- S2 rules (#762), S3 flag (#764), S4 services (#763)

**QA:** only in the isolated staging project (`STICKERS_STAGING_RUNBOOK.md`). Never in production, and never on a deploy preview, because previews use production Firebase.

---

## 0. Rules every S5–S7 surface follows

| # | Rule | Why | Enforced by |
|---|---|---|---|
| U1 | **Shown only when `useStickersAvailability()` is `'available'`.** `'checking'` and `'unavailable'` render nothing: no placeholder, no disabled control, no layout space. | The flag is off in production. Impersonation is read-only. | Every surface's tests (AT-x-01) |
| U2 | **Writes go through the S4 services only:** `stickerService` (create, update, archive, restore, subscribe) and `contactStickers` (`addSticker`, `removeSticker`, `addStickerToContacts`). No component imports `firebase/firestore` for sticker fields. | One writer, which the rules and the emulator suite verify. | `stickerWritePaths.test.js`, `verifyWritePaths.mjs` rule 5 (already in CI) |
| U3 | **Not optimistic.** A chip shows a pending state until the transaction resolves, then the stored result. Nothing needs rolling back on screen. | The server can refuse (archived, limit, revoked). | AT-5-07, AT-5-09 |
| U4 | **Every failure maps to one message** (§4), by `StickerError.code` and `reason`. No raw Firebase text. | Stable, translatable, no data in errors. | AT-5-08…AT-5-12 |
| U5 | **Archived stickers are hidden everywhere except the Archived section of the Stickers view** (S7). Memberships are kept, and come back on restore. An ID with no definition is hidden and never removed by the UI. | ADR-007: never deleted. | AT-5-06, AT-6-05, AT-7-07 |
| U6 | **Tags are untouched.** Stickers sit beside tags, look different (sticker chips have a color dot and an optional emoji; tags keep their hashed pill), and never convert. | D1. | AT-5-14, AT-6-10 |
| U7 | **No sticker names in logs, telemetry or error reports.** Codes and counts only. | Privacy | Code review; log-capture assertion in AT-5-12 |
| U8 | **Navigation is unchanged.** The only new URL state is `?sticker=<id>` on People. | ADR-004 | AT-6-03 |

### Shared pieces (built in S5, reused by S6 and S7)
- `StickersProvider` loads the user's registry once per page with `subscribeStickers` and exposes:
  - `stickersById`
  - `active`: sorted with `sortStickers`
  - `archived`
  - `status`: loading, ready or error

  It mounts only when availability is `'available'`.
- `StickerChip`: color dot, optional emoji, name, optional remove button.
- `StickerPicker`: search, recent first, create inline (§1.2). Used by the profile row and the bulk bar.
- `stickerMessages.js`: the code → message map (§4).
- `useStickersAvailability` gains `recheck()`. After a `write_denied` refusal the UI asks the server again, and hides every surface if access is gone (a mid-session revocation). This is the only change to S3 code.

---

## 1. S5 — Contact Profile: Stickers row and picker

### 1.1 Placement
- A **Stickers** row in `IdentityCard`, directly **above** the existing Tags row, with the same label column and spacing.
- No other layout on the Contact Profile moves.

### 1.2 Behaviour
- **Row:**
  - shows `visibleStickers(contact, stickersById)` as chips, in display order (by name)
  - at the end, an **Add sticker** button (`+ Sticker`)
- **Picker** (popover on desktop, bottom sheet under 640 px):
  - search box, focused on open; filters active stickers by name, case-insensitive
  - **Recent** section first: up to 5 stickers this user added most recently, kept in `localStorage` per uid as a convenience. When missing or unreadable, it's skipped silently.
  - then **All stickers**, by name
  - stickers already on the contact are listed with a check mark and are not selectable to add again
  - when the search has no exact name match: **Create sticker "…"** at the bottom. It creates with the next color in palette order, then adds it to this contact.
  - when an active sticker has the same name key: the create option reads **"Board" already exists — use it**, and selects that sticker instead
- **Add:**
  - calls `addSticker(uid, contactId, stickerId)`
  - the chip appears pending, then final
  - result `'already'` is treated as success, with no message
- **Remove:**
  - the chip's × calls `removeSticker`
  - on success, a toast **"Removed Board · Undo"** stays 6 s
  - Undo calls `addSticker` again. The assignment date becomes the time of the undo; this is stated in the toast's accessible description.
  - result `'absent'` is success
- **At 50 stickers:**
  - the picker's add options are disabled
  - a line explains the limit: "This contact has 50 stickers. Remove one to add another."
  - create inline is also disabled
- **Contact not yet saved** (Add Manually): the row is hidden. A contact is never created with stickers (rules); stickers are added after it exists.

### 1.3 Acceptance tests (S5)

**Automation levels:**
- **[U]** Vitest + Testing Library, services mocked at the module boundary
- **[E]** existing emulator suites, already in CI
- **[S]** manual, in staging (runbook §4)

| ID | Given | When | Then | Level |
|---|---|---|---|---|
| AT-5-01 | availability `'checking'` or `'unavailable'` | the profile renders | there is no Stickers row and no picker, and the Tags row is exactly where it was | U |
| AT-5-02 | availability `'available'`; contact has Board and Donor | the profile renders | the row shows Donor and Board in name order, then `+ Sticker` | U |
| AT-5-03 | the picker is open | the user types "bo" | only stickers whose name contains "bo" (any case) are listed; Recent stays above All | U |
| AT-5-04 | no sticker named "Gala" | the user types "Gala" and chooses Create | `createSticker` then `addSticker` are called once each, and the chip appears | U |
| AT-5-05 | an active sticker named "board" exists | the user types "Board" | the option reads "Board" already exists — use it, and choosing it calls `addSticker` with that sticker, not `createSticker` | U |
| AT-5-06 | the contact holds an archived sticker and an unknown ID | the profile renders | neither is shown; no remove call is made for either | U |
| AT-5-07 | `addSticker` is pending | the user looks at the row | the new chip shows a pending state and its remove button is disabled; on resolve it becomes final | U |
| AT-5-08 | `addSticker` rejects with `sticker_archived` | — | no chip is added; message §4 "That sticker was archived…"; the picker no longer lists it once the registry updates | U |
| AT-5-09 | the contact has 50 stickers | the user opens the picker | add and create options are disabled, and the limit line is shown; a direct `limit_reached` rejection shows the same line | U |
| AT-5-10 | `addSticker` rejects `permission_denied` with reason `write_denied` | — | message "Stickers can't be changed right now."; `recheck()` is called; if it returns `'unavailable'`, the row disappears | U |
| AT-5-11 | rejection `permission_denied`, reason `contention_exhausted`, or `write_failed` | — | message "Couldn't save. Try again." with a Retry action that calls `addSticker` once more | U |
| AT-5-12 | any rejection | it is logged | the console line carries the code and reason only: no sticker name, no contact name, no ID (log-capture assertion) | U |
| AT-5-13 | the user removes Board | Undo is pressed within 6 s | `addSticker` is called with Board; the chip returns | U |
| AT-5-14 | the contact has tags | stickers are added or removed | `contact.tags` is unchanged, and no tag write is made | U |
| AT-5-15 | an admin is viewing as U | U's profile renders | no Stickers row; `fetchStickersConfig` is never called (S3 hook test) | U |
| AT-5-16 | the server refuses a direct membership write (archived, other user, 51st, two at once) | — | already proven: `stickers.mjs`, `sticker-services.mjs` | E |
| AT-5-17 | staging, beta, enrolled account | add, remove, undo, create inline, 50 limit, archive in another tab during add | each behaves as above, with screenshots | S |

---

## 2. S6 — People: sticker filter, counts, search, bulk add

### 2.1 Behaviour
- **Filter:**
  - a **Sticker** chip in the existing filter row, next to Tag, with the same look and the same popover pattern
  - lists active stickers with their **count**: the number of contacts People would show with that sticker under the current tab, archived contacts excluded, the same rule the list uses
  - one sticker at a time, like Tag. "Any of several" is a later decision (§6, Q2).
- **URL:** choosing a sticker sets `?sticker=<id>`, and clearing removes it.
  - Opening People with `?sticker=<id>` applies it.
  - If the ID is unknown or archived, the filter is not applied and a one-line notice says "That sticker is archived or no longer exists." No error and no redirect.
- **Combination:** the sticker filter ANDs with every other filter (tag, industry, warmth, source, smart, data, warm signal) and with search. It counts in `activeFilterCount`, and "Clear filters" clears it.
- **Search:** the existing search also matches a contact's **active** sticker names. It's one condition beside the tag match, same case rule.
- **Cards and list rows:** show up to 2 sticker chips (cards) or 1 (rows), with "+n" for the rest, before tags. Archived stickers are never shown.
- **Bulk add:**
  - with contacts selected, the bulk bar gains **Add sticker**, which opens the same picker (create inline allowed)
  - choosing a sticker runs `addStickerToContacts(uid, ids, stickerId)`
  - while it runs, the bar shows progress ("Adding… 12 of 40") and every bulk action is disabled
  - **Result summary:** "Added to 37 · 2 already had it · 1 not changed", with a **Details** list naming each failed contact and its §4 message
  - one failure never undoes the others (S4 behaviour)
  - on any failure the selection is kept, reduced to the failed contacts, so **Retry** applies to them only
- **Not in S6:** bulk remove (§6, Q3), CSV (S8).

### 2.2 Acceptance tests (S6)

| ID | Given | When | Then | Level |
|---|---|---|---|---|
| AT-6-01 | availability not `'available'` | People renders | no Sticker filter, no sticker chips on cards or rows, no Add sticker in the bulk bar, and `?sticker=` is ignored | U |
| AT-6-02 | 3 contacts have Board, and 1 of them is archived | the filter opens | Board shows count 2 | U |
| AT-6-03 | the user picks Board | — | the URL gains `?sticker=<id>`, with no other navigation change; reload keeps the filter; Clear removes it from the URL | U |
| AT-6-04 | the Board filter and the tag filter "Gala" | both apply | only contacts with both are listed; `activeFilterCount` counts 2 | U |
| AT-6-05 | `?sticker=<archived or unknown id>` | People opens | the full list is shown, with the notice line, and no error | U |
| AT-6-06 | a contact has active "Board" and archived "Donor" | the user searches "donor" | the contact is **not** matched on the sticker; "board" matches it | U |
| AT-6-07 | 40 selected; 1 at 50 stickers, 2 already have Board | Add sticker → Board | `addStickerToContacts` is called once with 40 ids; the summary reads Added to 37 · 2 already had it · 1 not changed; Details names the one with "This contact has 50 stickers…" | U |
| AT-6-08 | the summary shows failures | Retry is pressed | it retries only the failed contacts | U |
| AT-6-09 | a bulk add is running | the user presses another bulk action | it is disabled until the run ends | U |
| AT-6-10 | bulk add runs | — | `tags`, `brigade` and every non-sticker field are untouched (service mock asserts the calls; S4 unit tests prove the write shape) | U |
| AT-6-11 | 1,000 loaded contacts with 0–5 stickers each | counts and filter compute | done in one pass, memoized on contacts and registry; no extra Firestore reads (no new query, no new index) | U |
| AT-6-12 | staging: two accounts | account A filters by A's sticker; account B opens A's `?sticker=` link | B sees the "no longer exists" notice: B cannot read A's registry (rules) | S |
| AT-6-13 | staging | bulk add 25 contacts while another tab archives the sticker | the summary counts the late ones as "not changed" with "That sticker was archived…"; the stored data is consistent (same as `sticker-services.mjs`) | S, E |

---

## 3. S7 — People: Stickers view (the grid)

### 3.1 Behaviour
- **Entry:** a third view toggle in People, **Stickers**, beside Cards and List. It's shown only when available, and the choice is remembered like the existing toggle.
- **Grid:**
  - one tile per active sticker: color band, emoji, name, description (one line, truncated), count (same rule as AT-6-02)
  - order: by name
  - empty state: "No stickers yet. Create one to start grouping people." with **New sticker**
- **Tile click:** opens Cards (or List, if that was last used) with `?sticker=<id>`.
- **Tile menu** (⋯):
  - **Edit** (name, color, emoji, description), via `updateSticker`. Validation messages come from §4, and the same-name warning as S5 applies.
  - **Archive**, via `archiveSticker`, after a confirm: "Archive Board? It disappears from pickers and filters. 12 contacts keep it, and it comes back if you restore it."
- **Archived (n):** a collapsed section under the grid, listing archived stickers with **Restore** (`restoreSticker`). Counts are not shown for archived stickers.
- **New sticker:** a dialog with name, color (8 swatches, each with a text label), emoji (optional, ≤ 16), description (optional, ≤ 280).

### 3.2 Acceptance tests (S7)

| ID | Given | When | Then | Level |
|---|---|---|---|---|
| AT-7-01 | availability not `'available'` | People renders | no Stickers toggle; a remembered "stickers" view falls back to Cards | U |
| AT-7-02 | 3 active stickers | the view opens | 3 tiles in name order, each with the right count | U |
| AT-7-03 | the user clicks Board's tile | — | Cards opens with `?sticker=<Board id>` | U |
| AT-7-04 | Edit: name cleared, or 61 characters | Save | the inline message from §4; `updateSticker` is not called | U |
| AT-7-05 | Edit: color changed | Save | `updateSticker(uid, id, { color })` only; the tile updates from the registry subscription | U |
| AT-7-06 | Archive is confirmed | — | `archiveSticker` called; the tile moves to Archived (n); profile rows and filters no longer show it | U |
| AT-7-07 | Restore an archived sticker | — | it returns to the grid, its earlier members show it again, and no membership write is made | U |
| AT-7-08 | `archiveSticker` or `updateSticker` rejects with `permission_denied` | — | message §4; `recheck()`; the view falls back to Cards if access is gone | U |
| AT-7-09 | no stickers | the view opens | the empty state with New sticker | U |
| AT-7-10 | the rules refuse delete, and changes to `created_by`, `created_at`, `status` outside archive/restore, or unknown fields | — | already proven by `stickers.mjs` | E |
| AT-7-11 | staging | create, edit, archive with members, restore; check a member's profile at each step | as above, with screenshots | S |

---

## 4. Messages

| Code (and reason) | Message | Where |
|---|---|---|
| `invalid_name` | "A sticker name needs 1–60 characters." | inline, in the field |
| `invalid_color` | "Pick one of the colors." | inline |
| `invalid_emoji` | "That emoji is too long." | inline |
| `invalid_description` | "A description can be up to 280 characters." | inline |
| `limit_reached` | "This contact has 50 stickers. Remove one to add another." | picker line / toast |
| `sticker_archived` | "That sticker was archived. Restore it from Stickers to use it." | toast |
| `sticker_not_found` | "That sticker no longer exists." | toast |
| `contact_not_found` | "This contact no longer exists." | toast |
| `permission_denied` + `read_denied` | "You can't change stickers on this contact." | toast |
| `permission_denied` + `write_denied` | "Stickers can't be changed right now." (then `recheck()`) | toast |
| `permission_denied` + `contention_exhausted`, or `write_failed` | "Couldn't save. Try again." (Retry) | toast |
| `not_signed_in` | the app's existing sign-in redirect | — |
| anything else | "Something went wrong. Try again." | toast |

---

## 5. Accessibility, mobile, performance

**Accessibility** (WCAG 2.1 AA):
- **Chips:**
  - the row is a `role="list"`, and each chip is a list item
  - the remove button's accessible name is "Remove sticker Board"
  - color is never the only signal: the name is always visible, and swatches carry text labels
  - chip text meets 4.5:1 contrast on its background in light and dark themes, for all 8 colors (a unit test checks the token pairs)
- **Picker:** the combobox pattern.
  - input `role="combobox"` with `aria-expanded` and `aria-controls`
  - options `role="option"`, with `aria-selected` for ones already on the contact
  - keys: Up, Down, Enter, Escape; Home and End in the list
  - focus returns to `+ Sticker` on close
  - the bottom sheet traps focus while open
- **Live regions:** toasts and the bulk summary are announced (`aria-live="polite"`); pending chips have `aria-busy`.
- **Grid:** each tile is a link named "Board, 12 people"; its menu button is named "Board options".
- **Motion:** none is required; `prefers-reduced-motion` disables transitions.
- **Tests:**
  - role and name queries in Testing Library (`getByRole`), which fail when a name or role is missing
  - keyboard-only paths with `user-event` in AT-5-03 and AT-7-02
  - the repo has no automated axe check today. Adding `vitest-axe` is a devDependency decision for S5's PR, not assumed here.

**Mobile** (360 px wide upward):
- every target is ≥ 44 px tall (the existing `minHeight: 44` convention)
- the picker is a bottom sheet under 640 px
- the bulk bar wraps onto two lines
- the grid is 2 columns at 360 px and grows with `auto-fill`, like Cards
- no horizontal scroll

**Performance:**
- one registry subscription per page (the provider)
- no per-contact listeners
- counts are computed client-side from contacts People already loads: no new query, no new index
- the picker filters in memory

---

## 6. Decisions (all approved as proposed, 2026-11-05)

| # | Question | Decision |
|---|---|---|
| Q1 | While an admin views as a user, show that user's stickers read-only? | **No.** Hidden, as the S3 hook does today. A read-only display can follow later. |
| Q2 | People filter: one sticker, or "any of several"? | **One**, like Tag |
| Q3 | Bulk **remove** in S6? | **No**; add only. Remove is per contact, with Undo. |
| Q4 | Undo after remove keeps the original assignment date? | **No**; the date becomes the undo time (the service records each add). |
| Q5 | Stickers view: inside People, as a third toggle? | **Yes**, no new route (U8) |

---

## 7. Definition of done (each of S5, S6, S7)

1. Every [U] test in its section passes, plus the full suite and `check:env`.
2. `verifyWritePaths.mjs` and `stickerWritePaths.test.js` pass: no UI file writes sticker fields.
3. The rules job (emulator) passes unchanged. S5–S7 change no rule.
4. Its [S] tests are run in the **isolated staging project** per the runbook, with screenshots attached to the PR. They are not run on production or a deploy preview.
5. **Rollback:** set the mode to `off` (no deploy) and every surface disappears; or revert the PR. Neither changes stored data.
6. Draft PR, with no merge, deploy or flag change without approval.
