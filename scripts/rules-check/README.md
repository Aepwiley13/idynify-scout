# Firestore rules verification

Runs the append-only ruleset in `firestore.rules.proposed` against a **real**
Firestore emulator, on a throwaway `demo-` project. No production project, no
credentials, no access to real data.

Two things caught real bugs here, both of which read as correct and behave as
neither:

- `document.size()` does not exist for a recursive-wildcard binding. The rule
  errors, and an erroring rule **denies** — which broke an ordinary write path,
  not just the collections it was meant to protect.
- A recursive wildcard matches **zero or more** segments, so a deep rule also
  matches shallow documents and re-grants what a narrower rule withheld.

## Run it

Needs a JDK 21+ (firebase-tools refuses anything older) and network for the
first emulator download.

```
cd scripts/rules-check
npm init -y && npm i @firebase/rules-unit-testing firebase
cp ../../firestore.rules.proposed ./firestore.rules   # strip the comment header if you like
printf '{ "firestore": { "rules": "firestore.rules" }, "emulators": { "firestore": { "port": 8080 }, "ui": { "enabled": false } } }' > firebase.json
npx firebase-tools emulators:exec --only firestore --project demo-icp-rules "node cases.mjs"
```

Expected: `19 passed, 0 failed`.

Case 09 is the one that matters most — `update users/U/companies/c1 → ALLOW`.
The likely failure mode of a bad rule is that *every* product write denies, not
that the protected collections stay mutable.
