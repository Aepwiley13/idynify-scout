# Firestore rules verification

Runs the rules suite against a **real** Firestore emulator on a throwaway
`demo-` project. No production project, no credentials, no access to real data.

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
npx firebase-tools emulators:exec --only firestore --project demo-icp-rules "node scripts/rules-check/cases.mjs"
```

Expected: `19 passed, 0 failed`.

Case 09 matters most — `update users/U/companies/c1 → ALLOW`. The likely failure
mode of a bad rule is that *every* product write denies, not that the protected
collections stay mutable.
