# Firestore emulator checks

Two suites against a **real** Firestore emulator on a throwaway `demo-` project.
No production project, no credentials, no access to real data.

- `cases.mjs` — **who** may write. The append-only rules on `lineageEvents` and
  `criteriaVersions`.
- `write-semantics.mjs` — **what a write does** to the fields it was not told
  about. Guards the rediscovery `updateMask`.

Both exist for the same reason: the behaviour under test is Firestore's own, so
a mock could only assert that we believe what we already believed.

It reads the **live** `firestore.rules` — not a copy — so any change to the
deployed ruleset is checked before the PR is reviewable. CI runs it on every PR.

## Why this exists

The append-only ruleset was wrong twice before it was ever run, and both faults
read as correct while behaving as neither. Neither would have failed at deploy
time; the first would have denied writes for every user.

- **`document.size()` does not exist** for a recursive-wildcard binding. A rule
  whose expression errors evaluates to **deny**, so the guard did not merely
  fail to protect `lineageEvents` — it denied a legitimate update to
  `users/{uid}/icpProfiles/{icpId}`, an ordinary write path.
- **A recursive wildcard matches zero or more segments**, so
  `match /{coll}/{docId}/{rest=**}` also matches 2-deep documents. Firestore
  grants access if *any* matching rule allows it, so the deep rule re-granted
  the update the narrower rule had just withheld. Every guard has to be repeated.

The pattern that works: no path introspection at all. `coll` and `sub` are
single-segment wildcards, which bind plain strings and compare directly.

## Run it

Needs a JDK 21+ (firebase-tools refuses anything older) and network for the
first emulator download. **Run from the repo root** — the CLI refuses a rules
path outside the project directory.

```bash
npm --prefix scripts/rules-check install
npx firebase-tools emulators:exec --only firestore --project demo-icp-rules "node scripts/rules-check/cases.mjs && node scripts/rules-check/write-semantics.mjs"
```

Expected: `19 passed, 0 failed` then `20 passed, 0 failed`.

Case 09 matters most — `update users/U/companies/c1 → ALLOW`. The likely failure
mode of a bad rule is that *every* product write denies, not that the protected
collections stay mutable.

## write-semantics

A REST PATCH with no `updateMask` **replaces** the document — every field absent
from the request is deleted. Measured: a company carrying 32 fields came back
with 15, losing `swipedAt`, `swipedForICPId`, `barryFeedback`, `selected_titles`
and — worst — `apollo_id`, one of the two field names identity resolution checks.

The suite runs a rediscovery against a fully-lived company at every status a
rediscovery can reach, and keeps an unmasked write as a control, so a test that
stops detecting the bug fails loudly rather than passing vacuously.
