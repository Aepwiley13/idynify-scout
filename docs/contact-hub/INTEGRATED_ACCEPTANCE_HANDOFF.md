# Contact Hub integrated acceptance handoff

Updated: 2026-11-22

## Local checkpoints

- Integrated Contact Hub implementation: `2f4b355b`.
- Outbound reliability audit and mocked-provider characterization: `53374189` on `fix/contact-hub-free-import`, a direct descendant of `2f4b355b`.
- Previous documentation checkpoint: `b133ada2` on `fix/contact-hub-free-import`.
- Accepted staging candidate: `2f4697fa` on `staging/contact-hub-candidate`, preserved at `~/idynify-staging/contact-hub-unified-qa`.
- The accepted candidate's server remains on `127.0.0.1:8893`. No staging data, rules, indexes, or flags were changed.

## Verification completed tonight

- Action Center isolated browser flow: 54/54 checks passed for notes, reminders, activity, access modes, responsiveness, stickers, and profile actions.
- Contact Hub photo browser flow: 60/60 passed across desktop/mobile and light/dark, including camera/library entry, crop, preview, failed-save recovery, save, view, remove, hidden state, restore, URL validation, and read-only access. All writes were in-memory mocks.
- Integrated workspace browser flow: 23/23 passed for Free, Scout, and read-only sessions, including My People, Import entry point, My Card, Sticker Wall, person route, Action Center default, and access visibility.
- The initial workspace smoke timed out during a cold fixture load. After Vite warmed, My People rendered without browser errors and the canonical smoke passed. This was fixture/browser startup timing, not a product defect. No application or fixture code was changed.
- Focused tests: 453 passed across 14 files covering My Card, import and duplicate prevention, Contact Hub routes, individual and bulk deletion UI, trusted deletion cleanup, stickers, photo writer, and merge services.
- Synthetic duplicate review, dismissal, merge preview, and conditional rollback browser flow: 13/13 passed.
- Trusted individual/bulk deletion used synthetic handler/UI tests. No staging deletion or live persistence was exercised.
- No live Firebase, Gmail, or provider calls were made. All browser flows used local fixtures.

Screenshots and reports from the completed browser runs are under:

- `/tmp/idynify-contacthub-integrated-action`
- `/tmp/idynify-contacthub-integrated-merge`
- `/tmp/idynify-contacthub-integrated-photo`
- `/tmp/idynify-contacthub-integrated-workspace`

## Activation gates

Keep merge execution, trusted contact deletion, private photo persistence, Contact Hub Gmail connection, and live Gmail sending disabled. The existing photo deletion cleanup, physical-device camera test, real staging permission checks, Gmail OAuth lifecycle, and outbound sender safety blockers remain open. See `OUTBOUND_MERGE_SAFETY_MATRIX.md` for the separate-team outbound handoff and `CONTACT_HUB_STAGING_ACCEPTANCE.md` for staging requirements.

## Continuation point

Continue on `fix/contact-hub-free-import` at the latest local documentation checkpoint. Preserve the separate `staging/contact-hub-candidate` worktree and port 8893. The integrated local review is ready. Keep deletion and merge demonstrations synthetic. Real photo persistence, Gmail, and deletion activation remain gated pending their documented lifecycle requirements. Do not deploy, change activation flags, or modify production as part of local acceptance.

The isolated review fixture is running at `127.0.0.1:5318`. To restart it later from the audit worktree:

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
