# Contact Hub integrated acceptance handoff

Date: 2026-11-22

## Local checkpoints

- Integrated Contact Hub implementation: `2f4b355b`.
- Outbound reliability audit and mocked-provider characterization: `53374189` on `fix/contact-hub-free-import`, a direct descendant of `2f4b355b`.
- Accepted staging candidate: `2f4697fa` on `staging/contact-hub-candidate`, preserved at `~/idynify-staging/contact-hub-unified-qa`.
- The accepted candidate's server remains on `127.0.0.1:8893`. No staging data, rules, indexes, or flags were changed.

## Verification completed tonight

- Action Center isolated browser flow: 54/54 checks passed for notes, reminders, activity, access modes, responsiveness, stickers, and profile actions.
- Synthetic duplicate review, persistent dismissal, merge preview, and conditional rollback: 13/13 checks passed.
- Contact Hub photo browser run was stopped before completion. It had reached the desktop dark-theme preview; do not count the photo suite as passed.
- The integrated `?workspace=1` browser smoke did not load My People beyond its loading state. This is a fixture/browser review blocker, not evidence of a candidate regression. Diagnose it before using this fixture to accept My People, My Card, Sticker Wall, or CSV import.
- No live Firebase, Gmail, or provider calls were made. All browser flows used local fixtures.

Screenshots and reports from the completed browser runs are under:

- `/tmp/idynify-contacthub-integrated-action`
- `/tmp/idynify-contacthub-integrated-merge`
- `/tmp/idynify-contacthub-integrated-photo` (partial; not acceptance evidence)

## Activation gates

Keep merge execution, trusted contact deletion, private photo persistence, Contact Hub Gmail connection, and live Gmail sending disabled. The existing photo deletion cleanup, physical-device camera test, real staging permission checks, Gmail OAuth lifecycle, and outbound sender safety blockers remain open. See `OUTBOUND_MERGE_SAFETY_MATRIX.md` for the separate-team outbound handoff and `CONTACT_HUB_STAGING_ACCEPTANCE.md` for staging requirements.

## Continuation point

Resume on `fix/contact-hub-free-import` at `53374189`. Preserve the separate `staging/contact-hub-candidate` worktree and port 8893. First repair or diagnose only the synthetic workspace fixture load, then finish the photo browser run and acceptance checks for My People, My Card, stickers, import, and deletion using isolated fixtures. Keep deletion and merge demonstrations synthetic. Do not deploy, change activation flags, or modify production as part of local acceptance.

The temporary review fixture used `127.0.0.1:5318` and has been stopped. Restart it from the audit worktree with:

```sh
VITE_CONTACT_HUB_GMAIL=off VITE_CONTACT_HUB_PHOTO_OVERRIDES=off VITE_CONTACT_HUB_DELETE=off VITE_CONTACT_HUB_MERGE=off VITE_CONTACT_HUB_MERGE_EXECUTION=off \
  node node_modules/vite/bin/vite.js --config scripts/visual/contact-profile/vite.config.mjs \
  --configLoader runner --host 127.0.0.1 --port 5318 --strictPort
```

Workspace review URL:

```text
http://127.0.0.1:5318/scripts/visual/contact-profile/profile.html?workspace=1
```

Synthetic Action Center, duplicate/merge, and photo demos use the same path with `?action=1`, `?duplicates=1&merge_demo=1`, and `?action=1&photo=1` respectively.
