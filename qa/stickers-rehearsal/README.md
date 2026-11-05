# Stickers end-to-end rehearsal (emulators only)

QA tooling, not app code, and not on `main`. It drives the real People and
Contact Profile pages, the real `stickersConfig` function and the real
`firestore.rules` on the local Firebase emulators (project
`demo-contact-hub`, which cannot reach any real backend), with the synthetic
contacts from `docs/staging/synthetic-contacts.csv`.

Used for the 2026-11-05 launch-readiness rehearsal: 51 checks
(access matrix, profile, People, Stickers view, revocation, view-as,
rollback, regression). It is the base for the staging QA driver.

Run (paths are this session's; adjust):
1. `ln -s <repo>/firestore.rules firestore.rules` here, then
   `npx --yes firebase-tools@15 emulators:start --only firestore,auth --project demo-contact-hub`
2. `REPO=<repo checkout> <repo>/node_modules/.bin/vite --config vite.config.mjs` (port 5299)
3. `node seed.mjs <repo>/docs/staging/synthetic-contacts.csv`
4. `PW_PATH=$(npm root -g)/playwright node rehearse.cjs <out dir> <repo>/firestore.rules <repo>/docs/staging/synthetic-contacts.csv`
