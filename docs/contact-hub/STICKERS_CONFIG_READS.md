# `stickersConfig`: what it costs while stickers are off

**Status: documented, not changed.** The owner decided not to change it during QA unless measurements justify it. This note is the analysis and the measurement plan.

## What happens today

These surfaces ask `POST /.netlify/functions/stickersConfig` once when they mount:
- People in `people` mode (`AllLeads`)
- the full-page Contact Profile

`StickersProvider` asks once per page. The People side panel reuses the People provider, so it makes no extra call. Scout mode makes none. Since the QA fixes (#777), nothing is asked while an admin is viewing as a user.

Each call is:
- one Netlify function invocation
- one ID-token verification (`verifyIdToken`; Google's public keys are cached by the Admin SDK)
- **3 Firestore document reads**, in parallel (`readStickerAccessInputs`): `feature_flags/stickers`, `users/{uid}`, `sticker_enrollment/{uid}`

With the flag document missing (production today), the answer is always `enabled: false`. The two per-user reads cannot change that answer.

## Is it material?

- **Firestore:** 3 document reads per page open. Negligible next to the contact reads the same pages make.
- **Netlify:** one invocation per People or Profile open, for every signed-in user. Whether that matters depends on traffic and the plan's function allowance. Not measured yet.
- **Latency:** none visible. Surfaces render nothing until the answer arrives, and with stickers off they render nothing anyway.

## How to measure (no code change)

- **Netlify:** the site's function usage and logs for `stickersConfig` give invocations per day. Compare with the plan's included function usage.
- **Firestore** → Usage: reads per day. `stickersConfig` adds about 3 × that invocation count.

**Suggested threshold:** if `stickersConfig` is above roughly 5% of the site's monthly function allowance, or appears in Firestore cost reviews, do optimization 1 below.

## Optimizations, in order (not implemented)

1. **Server short-cut.** Read `feature_flags/stickers` first. When the mode is missing, `off` or `on`, decide without the user and enrollment reads, because the answer cannot depend on them. That is 1 read instead of 3 while off. For `internal` and `beta`, read the other two as today.
   - **Security unchanged:** the same `decideStickerAccess` table, and `firestore.rules` still decides every write.
   - Tests: `stickersConfig.test.js` and the three-way parity suite (`scripts/rules-check/stickers-flag-parity.mjs`) must stay green unchanged.
   - Rollback: revert.
2. **Client session cache (optional).** Remember the answer per uid for a few minutes; `recheck()` and a refused write bypass it. That is about 1 invocation per user per few minutes, instead of one per page open.
   - **Security unchanged:** a stale "available" only shows controls whose writes the rules refuse, and the refusal path already re-checks and hides them.
   - The cost: a newly enrolled user waits up to that time to see stickers.
3. **Not recommended: a build-time switch** that skips the call entirely. It adds a second switch that can disagree with the flag, and needs a redeploy to start the pilot.
