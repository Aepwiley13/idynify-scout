# IDYNIFY Open PR Reconciliation — Running Ledger

**Purpose:** One place that records what each PR was, what happened to it, what was salvaged, what replaced it, and whether it's safe to close. Updated after each PR's audit + owner decision.

**Canonical location:** this file. Seeded from the owner's working copy on 2026-08-27 and committed here so there is one versioned address and no drifting duplicates. Any local or downloaded copy is a snapshot, not the ledger.

**Audit order:** #584 → #94 → #432 → #405 → #391 → #188 → #18 → #17

**Standing rule for every PR:** compare against current `main` and current architecture, never against the state that existed when the PR was opened. A green CI check means checks passed — it says nothing about whether the work still belongs in the product.

**Standing rule, added 2026-08-27:** "CI green" is not sufficient evidence unless the relevant test files are confirmed to be *included* in CI. Green checks mislead not only about product relevance but about coverage — they may not be running the tests you think they are. See "CI Gate Integrity" below for the discovery that produced this rule.

**Standing rule, added 2026-08-27:** A passing test count is not a passing test run. Test evidence must include the process exit code and any unhandled error count. Vitest reports `Test Files`/`Tests` as passed while a run carrying unhandled errors still exits non-zero — a filter that reads only the pass lines will call that run green.

**Reconciliation policy:** No PR may be merged, closed, or deleted based only on CI status or age. Every disposition must have a documented comparison against current `main`, an A–F classification, an evidence level, an owner decision, and a closure condition.

---

## Summary Table

| PR | Title | Unique vs main | Classification | Evidence level | Salvaged work | Replacement | Owner decision | Closure status |
|----|-------|----------------|-----------------|-----------------|---------------|-------------|-----------------|-----------------|
| #584 | Claude/team c p2 baseline verify 2fjvz1 | `224a2be` only (1 of 22 commits) | C — Partially Salvage | PROVEN | Two-column FE composition, responsive collapse rules, `.barry-fe-scroll` split | Small replacement PR (not yet opened) | Approved with constraints | **Pending replacement merge** |
| #94 | feat(scout): Add automatic async enrichment for Scout+ uploads | TBD | TBD | TBD | TBD | TBD | TBD | Open — up next |
| #432 | Barry AI Employee: Auto-ICP, Auto-Triage, Auto-Handoff | TBD | TBD | TBD | TBD | TBD | TBD | Open |
| #405 | multi-ICP card stacks with per-stack quotas and live count badges | TBD | TBD | TBD | TBD | TBD | TBD | Open |
| #391 | Fix Barry template builder showing wrong stage name | TBD | TBD | TBD | TBD | TBD | TBD | Open |
| #188 | Improve desktop card sizes for better UX | TBD | TBD | TBD | TBD | TBD | TBD | Open |
| #18 | Claude/review and debug f d en c | TBD | TBD | TBD | TBD | TBD | TBD | Open |
| #17 | Apply dating-app style to Saved Contacts section | TBD | TBD | TBD | TBD | TBD | TBD | Open |

*Evidence level key: **PROVEN** (diffs/cherry-pick/test runs verified the claims), **STRONG** (clear evidence but not exhaustively verified), **INFERRED** (conclusion drawn from title/history/context without direct repo verification — flag for a second look before acting on it).*

---

## Baseline Test Debt — RESOLVED

Tracked separately so it could not be mistaken for a regression from the PR audits. Neither issue was a product defect; both were test-harness faults.

| Issue | Owner | Resolution | Status |
|-------|-------|------------|--------|
| `window.matchMedia is not a function` (`ReconSectionEditor.test.jsx`) | Team Z | PR **#586**, commit `cafc054`, merged `1dcb4be` 2026-08-27 | **RESOLVED** |
| Date-dependent `"3 days ago"` assertion (`HunterContactCard.test.jsx`) | Team Z | PR **#586**, commit `cafc054`, merged `1dcb4be` 2026-08-27 | **RESOLVED** |

**PR #586 — `test: stabilize browser API and relative-time test baselines`**
Merged 2026-08-27 by Aepwiley13. Four files, all under `src/test/`, +175/−16, one commit. No application source changed.

- **matchMedia:** jsdom 28 does not implement it, and eleven application modules call it unguarded during render. Six test files had each hand-rolled the same stub. Replaced with one canonical shim at `src/test/helpers/matchMedia.js`, installed from `src/test/setup.js` — a real `MediaQueryList` with a live `matches` getter over `window.innerWidth`, both listener APIs, and `setViewportWidth()`. Install is skipped when `matchMedia` already exists, so the six local stubs still win and were left untouched.
- **Relative time:** the spec mocked `date-fns` and asserted `'3 days ago'`, but the card stopped importing `date-fns` when `formatRelativeTime` landed (D3.09 format divergence). The mock was dead and the assertion checked a string the product cannot emit. Now freezes `Date` only and asserts the real formatter's real output, `'3d ago'`.
- **Side effect:** fixing the shim let `ReconSectionEditor`'s four specs execute for the first time; three asserted a redirect the product no longer performs. **Owner-confirmed contract (2026-08-27):** a locked or unreadable Recon section renders the lock gate in place and does not automatically redirect; Back is the explicit path out. Assertions updated to that contract, with the Bug 3 guarantee preserved and strengthened.

Result — corrected 2026-08-27, see "Correction" below: full suite **98 test files passed, 2502 tests passed, 1 unhandled error, process exit code 1**, from 96 files / 2497 passed / 5 failed. The two tracked failures are genuinely fixed; the run as a whole is not green.

**Correction to the evidence originally recorded for #586.** This was first reported as "98 files / 2502 tests, all passing." That was wrong. The pass counts were right, the run was not: vitest also printed `Errors 1 error` and exited `1`. The reporting filter matched only the `Tests` / `Test Files` summary lines and the exit code was never checked, so an unhandled-error block went unseen. #586 was merged on that incomplete evidence.

**The unhandled error, newly exposed by #586:**

```
TypeError: messagesEndRef.current?.scrollIntoView is not a function
  src/components/recon/BarryReconGuide.jsx:219
  originating in src/test/ReconSectionEditor.test.jsx
```

jsdom does not implement `scrollIntoView` (confirmed: `typeof el.scrollIntoView === 'undefined'` in jsdom 28.1.0). The `?.` guards a null ref, not a missing method. Provenance, established by running each revision: pre-#586 at `44c14a8` the file failed on `matchMedia` and never mentioned `scrollIntoView` — the component never mounted far enough to reach it. #586 fixed `matchMedia`, the component now mounts, `BarryReconGuide`'s effect fires, and the missing method throws. Not an application defect: `scrollIntoView` exists in every real browser. It is the same class of test-environment gap as `matchMedia`, and a wider one — 24 call sites across 20 application files, with no test stubbing it.

CI could not see any of this, because `ReconSectionEditor.test.jsx` was on the exclusion list. The 90-file CI command exits `0` legitimately: it never runs the file. PR B (#587) removes the exclusion and CI fails immediately — the gate catching a latent defect on its first look at that file.

**Follow-up recorded, not done:** `formatRelativeTime` still has no direct unit test; its `Yesterday` / `Xw ago` / `Xmo ago` boundaries are uncovered.

---

## CI Gate Integrity

**Discovered 2026-08-27 while verifying PR #586.** Both files that PR repaired are on the `--exclude` list in `.github/workflows/ci.yml`, so #586's own green check executed neither of them. The gate was partially blind by design.

The list came from a single commit, `354b1b2` (2026-07-24, "Add vitest CI workflow for PRs against main"), whose message is the entire recorded rationale: *"Excludes 8 Hunter/Recon test files with 10 known pre-existing failures so they don't create noise on every PR."* No per-file justification, no issue link, no owner, no expiry. `ci.yml` has three commits total, all the same day.

**Measured on plain `main`:** of the eight excluded files, six pass untouched; the only failures were in the two #586 repaired.

| Group | Files | Finding |
|-------|-------|---------|
| Excluded by association | `HunterCardStack`, `hunterBootstrap`, `hunterOutcomeLogic`, `ReconErrorBoundary` | Neither test nor subject has changed since the exclusion; `setup.js` and `vite.config.js` unchanged in that window. Two are pure unit tests with no DOM. Evidence says they were never failing. 104 tests, including the relationship-seeding and `relationship_state` transition engines. |
| Genuinely failing, since repaired | `hunterSoundHaptics` | Repaired 2026-07-31 by `cc48c80`, seven days after exclusion. Green for four weeks. |
| Unknown | `ReconModulePage` | Passes today, but its subject moved during the window (five RECON copy rewrites, 2026-08-16/17). July status not establishable from history. The only one where "it may have had a reason" is still live. |

**PR B — `ci: run the two repaired test files again`**
Branch `claude/ci-restore-repaired-tests`, commit `6e72f25`, from `main` @ `1dcb4be`. Removes only the two exclusions for the files #586 repaired; the other six stay pending their own audit. One file changed.

| | Files executed | Tests executed | Repaired files |
|---|---|---|---|
| Before | 90 | 2350 | both absent |
| After | 92 | 2377 | both present, 23/23 and 4/4 passing |

Verified from vitest's JSON reporter rather than by reading the flag list. Full suite unchanged at 98 files / 2502 tests passed — with 1 unhandled error and exit code `1`, the same `scrollIntoView` error described above.

**#587 GitHub CI result: `test` FAILURE.** Both repaired files did execute — the failure originates inside `ReconSectionEditor.test.jsx`, which is itself the proof of inclusion. #587's change is correct; its precondition is not yet met. A `scrollIntoView` test-environment shim must land first. Measured with a prototype shim (not committed): the full 98-file suite exits `0` with zero unhandled errors, and the 92-file post-#587 command exits `0` at 92 files / 2377 tests. `scrollIntoView` is the only immediate blocker in the current corpus.

**Recommended sequence for the remaining six (a later PR C, not yet started):** `hunterSoundHaptics` first, then the four association-excluded files as one change, holding `ReconModulePage` for a targeted look.

**Structural recommendation:** any CI exclusion should carry a dated comment naming why it exists and who reviews it, so the next one cannot silently outlive its cause.

---

## #584 — Detail

**Original intent:** Not a feature PR — the working trunk for the entire Gate 1 → Gate 3 program. 21 of 22 commits already landed on main via 8 separate PRs (#577–#583, #585). Only `224a2be` ("Visual composition: two-column FE layout with full-body Barry presence") is materially unique.

**Architecture compatibility:** PARTIAL — breaches the `AUTH_ASSETS` (pre-auth-only) contract, duplicates the existing `BarryPanel` pattern instead of extracting it, misuses `BRAND.purple` (Hunter module accent) as a general brand color, hardcodes a border instead of using `T.border`.

**Product compatibility:** PASS — copy matches frozen BO-011 positioning verbatim, no banned vocabulary.

**Evidence level:** PROVEN — empty `git diff origin/main 73a505f`, clean cherry-pick verified (`rc=0`), test comparison run against both PR head and main.

**Decision owner:** Product owner
**Decision date:** 2026-08-27

**Owner decisions:**
1. Full-body Barry approved for authenticated First Experience — as an explicit exception, not general permission. Establish `BARRY_ASSETS` / shared `BRAND_ASSETS.barry` rather than expanding `AUTH_ASSETS`.
2. Preserve the current #585 color hierarchy (white bubbles on lavender page). Do not let `224a2be`'s reversal (lavender bubbles on white page) land silently — that's a visual decision to be made deliberately later, not inherited from a layout cherry-pick.

**Definition of Done for closing #584:**
- [ ] Replacement PR created from current `main`
- [ ] Only the approved/salvaged visual composition carried forward
- [ ] Barry asset boundary corrected (`BARRY_ASSETS`/shared `BRAND_ASSETS.barry`, not `AUTH_ASSETS`)
- [ ] `BarryPanel` reused/extracted rather than hand-rolled second `<picture>`; width/height/decoding/fetchpriority restored
- [ ] Approved Barry sentence lifted to a shared constant
- [ ] `BRAND.purple` misuse replaced with correct brand/theme token
- [ ] Hardcoded borders replaced with `T.border`
- [ ] #585 color hierarchy preserved (not reversed)
- [ ] Misleading test edits (`gate3-batch2:203`) not carried forward
- [ ] FE tests repaired to actually isolate/fail on the First Experience render
- [ ] Replacement PR visually verified (desktop, tablet, mobile screenshots)
- [ ] Replacement PR merged
- [x] `224a2be` recorded in this ledger before branch deletion
- [x] Pre-existing test failures assigned to a named owner with a target date — Team Z, resolved via #586
- [ ] **Only then:** close #584 and delete its branch

---

## #94 — Kickoff (next up)

Read-only reconciliation. Do not merge, close, rebase, or modify. Compare against current `main` and the **current enrichment architecture** (post-retirement of the unsafe `enrich-company` path), not the architecture at the time the PR was opened.

Check specifically for:
- References to or recreation of the retired `enrich-company` behavior
- Firestore writes and write destinations
- Credit deductions
- Mock enrichment data or fallback data
- Scheduled/background enrichment behavior
- Upload-triggered enrichment
- Company vs. contact enrichment responsibilities
- Duplicate endpoints/functions
- Authentication/authorization
- Retries/idempotency
- Whether later Scout or Barry work already superseded parts of it
- Whether useful async-enrichment logic can be salvaged without reviving unsafe legacy behavior

Prove every conclusion with diffs, commit comparisons, file paths, tests, and current replacements. Return the same A–F classification.

**Standing constraint regardless of classification:** anything touching Firestore writes or credit deductions goes through a small, fresh, reviewed replacement PR — never a wholesale merge of the original — even if classified A.

**STOP after #94** for owner review.
