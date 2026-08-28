# IDYNIFY Open PR Reconciliation — Running Ledger

**Purpose:** One place that records what each PR was, what happened to it, what was salvaged, what replaced it, and whether it's safe to close. Updated after each PR's audit + owner decision.

**Canonical location:** this file. Seeded from the owner's working copy on 2026-08-27 and committed here so there is one versioned address and no drifting duplicates. Any local or downloaded copy is a snapshot, not the ledger.

**Audit order:** #584 → #94 → #432 → #405 → #391 → #188 → #18 → #17

**Standing rule for every PR:** compare against current `main` and current architecture, never against the state that existed when the PR was opened. A green CI check means checks passed — it says nothing about whether the work still belongs in the product.

**Standing rule, added 2026-08-27:** "CI green" is not sufficient evidence unless the relevant test files are confirmed to be *included* in CI. Green checks mislead not only about product relevance but about coverage — they may not be running the tests you think they are. See "CI Gate Integrity" below for the discovery that produced this rule. **As of PR #590 the gate excludes nothing**, so the rule now guards against regression rather than describing a live gap.

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
| Resolved (was Unknown) | `ReconModulePage` | Its subject took five RECON copy rewrites (2026-08-16/17), which is why it was held back. Resolved three ways: none of the strings the test asserts on — `Loading module...`, `Firestore permission denied`, the `Retry` button, `Business Foundation`, `mockNavigate('/recon')` — appears anywhere in that diff (the rewrites only touched `CONTEXTUAL_TIPS` copy); replaying the July state of both test and component passes 7/7, exit 0; and its July render tree has zero `matchMedia` references, so today's shims do not explain the pass. Never failing either. |

**PR B — `ci: run the two repaired test files again`**
Branch `claude/ci-restore-repaired-tests`, commit `6e72f25`, from `main` @ `1dcb4be`. Removes only the two exclusions for the files #586 repaired; the other six stayed in place pending their own audit, which PR C later completed. One file changed.

| | Files executed | Tests executed | Repaired files |
|---|---|---|---|
| Before | 90 | 2350 | both absent |
| After | 92 | 2377 | both present, 23/23 and 4/4 passing |

Verified from vitest's JSON reporter rather than by reading the flag list. Full suite unchanged at 98 files / 2502 tests passed — with 1 unhandled error and exit code `1`, the same `scrollIntoView` error described above.

**#587 first CI result: `test` FAILURE — and it was correct to fail.** Both repaired files executed; the failure originated inside `ReconSectionEditor.test.jsx`, which is itself the proof of inclusion. The cause was `scrollIntoView`, not #587.

**#589 — `test: shim scrollIntoView for jsdom`.** Commit `dfe6124`, merged `d6c3f29`. Two test-only files: `src/test/helpers/scrollIntoView.js` and the `setup.js` wiring. Guarded no-op, never replaces an existing implementation. Took the full suite from exit `1` to **98 files / 2502 tests / 0 unhandled errors / exit 0**.

**#587 — merged `942aaee`** (commit `6e72f25`, unchanged). After #589 landed, #587's red tick was stale: GitHub's cached merge ref `9790dc5` had parents `1dcb4be` + `6e72f25`, i.e. the pre-#589 base, and a re-run would have replayed that same stale merge SHA. Closing and reopening the PR — no branch edit, no "Update branch" — made GitHub rebuild the merge ref as `5e143b5` (parents `d6c3f29` + `6e72f25`) and dispatch a fresh run, which passed. **Operational note worth keeping: when a PR's base moves, "Re-run all jobs" replays the old merge commit. Close/reopen is what forces a fresh merge ref.**

**PR C — `ci: run the whole test corpus` — MERGED.** Commit `2e805d0`, merge commit **`e073e89`**, merged 2026-08-28T02:55:39Z. One file. Removes **all six** remaining exclusions; `.github/workflows/ci.yml` now contains **0 `--exclude` entries** and the gate runs `npx vitest run` over everything.

Every one of the six was audited individually before removal, and **all six are PROVEN**:

| File | Why it was excluded | Evidence | Level |
|---|---|---|---|
| `hunterSoundHaptics.test.jsx` | Genuinely failing on 2026-07-24 | Repaired by `cc48c80` (2026-07-31), seven days after the exclusion; that commit records the diagnosis in-file. Green four weeks before removal. | PROVEN |
| `HunterCardStack.test.jsx` | Swept in by feature area | No commit to test or subject since `354b1b2`; `setup.js` and `vite.config.js` unchanged in that window. | PROVEN |
| `hunterBootstrap.test.js` | Swept in by feature area | Same, and it is a pure unit test — no DOM, no render, no browser API. No mechanism by which it could have failed. | PROVEN |
| `hunterOutcomeLogic.test.js` | Swept in by feature area | Same. | PROVEN |
| `ReconErrorBoundary.test.jsx` | Swept in by feature area | Same; no `matchMedia`/`scrollIntoView`/`ResizeObserver`/`clipboard` references. | PROVEN |
| `ReconModulePage.test.jsx` | Held as ambiguous | Resolved three ways — see the table above. | PROVEN |

Gate impact measured one file at a time, then together, rather than assuming isolation:

| Restored | Files | Tests | Unhandled | Exit |
|---|---|---|---|---|
| *baseline (6 excluded)* | 92 | 2377 | 0 | 0 |
| `hunterSoundHaptics` | 93 | 2391 | 0 | 0 |
| `HunterCardStack` | 93 | 2386 | 0 | 0 |
| `hunterBootstrap` | 93 | 2409 | 0 | 0 |
| `hunterOutcomeLogic` | 93 | 2435 | 0 | 0 |
| `ReconErrorBoundary` | 93 | 2382 | 0 | 0 |
| `ReconModulePage` | 93 | 2384 | 0 | 0 |
| **all six** | **98** | **2502** | **0** | **0** |

No new failure and no jsdom or runtime gap appeared when any file was restored. Re-running all six with the `matchMedia` and `scrollIntoView` shims disabled also passes, so the exclusions were never protecting against the gaps #586 and #589 closed.

**Final CI corpus: 98 files / 2502 tests / 0 unhandled errors / exit code 0.** Recovered by PR C: 125 tests, including the relationship-seeding rule (*"wrong seeds here corrupts Barry's recommendations platform-wide"*) and the `relationship_state` transition engine. Gate coverage over the whole sequence: 90 → 92 → **98** files, 2350 → 2377 → **2502** tests.

**#590 GitHub CI evidence, kept separate from the local runs above:** run 33136907337, `run_attempt: 1`, created 4s after the PR opened, recorded base `f32dfc7` matching `main`, merge ref `d76ed5c` with parents `f32dfc7` + `2e805d0`. `test` **success**, zero failure-level annotations. Workflow at the PR head confirmed to hold 0 `--exclude` entries — so for the first time in this sequence the green tick and the thing being verified were the same object. CI's own file and test counts remain unreadable (job logs return `403 — admin rights`).

## Permanent CI exclusion policy

In force from 2026-08-28, recorded as a comment in `.github/workflows/ci.yml` itself so it is unavoidable at the point of use. **Any exclusion added to the test gate must carry, beside it:**

1. **the reason** it exists,
2. **a named owner**, and
3. **a review/removal condition or expiry date.**

An exclusion with no removal condition is a permanent blind spot. The previous list was added for one red run on 2026-07-24, had none of the three, and silently outlived its cause by five weeks — hiding a real failure from CI the entire time.

## Latent jsdom gaps — documented risk only, deliberately unshimmed

Found by a read-only scan of browser APIs jsdom does not implement, probed empirically in the real vitest environment (jsdom 28.1.0).

| API | Call sites | Guarding | Status |
|---|---|---|---|
| `ResizeObserver` | 4 sites — `ContactSnapshot`, `ContactDetailModal`, `CompanyDetailModal`, `MissionControl` | None. All are bare `new ResizeObserver(...)` inside `useEffect`. | **Latent.** No current test mounts these components. |
| `navigator.clipboard` | 13 sites across 8 files | Mixed. `IdentityCard.jsx:168,476` use `try/catch` and are safe; `sendActionResolver.js:251,271,317` and `InlineEngagementSection.jsx:87` only handle a rejected promise, so an undefined `navigator.clipboard` throws synchronously first. | **Latent.** Not reached by any test. |

**Do not shim these without a test that actually exercises them.** A shim added now would be a mock with no test behind it. They become real the moment someone writes a test that mounts one of those components — that change carries the shim.

Checked and found irrelevant: `IntersectionObserver`, `requestIdleCallback`, `Element.animate`, `speechSynthesis`, `Notification`, `checkVisibility` (zero call sites); `window.scrollTo`, `requestAnimationFrame`, `MutationObserver`, `getComputedStyle` (jsdom implements them); `visualViewport` (3 sites, properly guarded); `dialog.showModal` (false positive — a React state variable). `navigator.vibrate` and `AudioContext` are absent from jsdom but the application guards availability by design and `hunterSoundHaptics.test.jsx` covers them.

**Open follow-ups, recorded not done:** retire the six local `matchMedia` stubs now that a canonical shim exists; add direct unit coverage for `formatRelativeTime` (its `Yesterday` / `Xw ago` / `Xmo ago` boundaries are untested).

*(The structural recommendation that stood here — that every exclusion carry a dated reason and reviewer — is now the enforced policy above, committed into `ci.yml` by PR #590.)*

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
