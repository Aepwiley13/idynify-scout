# Stripe test mode for staging billing work

**Who this is for:** whoever validates billing changes before release. Everything here runs
against Stripe **test mode** and the **staging** Firebase project (`idynify-staging`). Nothing
here touches live Stripe, production Firebase or Netlify.

Production billing is governed by [BILLING_CUTOVER_RUNBOOK.md](../BILLING_CUTOVER_RUNBOOK.md)
and [BILLING_RELEASE_APPROVAL_PACKET.md](../BILLING_RELEASE_APPROVAL_PACKET.md). This document
does not change either.

## What the tools allow, and what they refuse

The staging tools refuse every integration key by default. A **billing run** (`--billing`)
allows Stripe and nothing else:

| Variable | Allowed in a billing run | Refused |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` or `rk_test_…` | Any live key (`sk_live_`, `rk_live_`) by name; anything unrecognisable |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…`, the secret `stripe listen` prints | Anything else |
| `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO` | `price_…` ids from the setup script below | Anything else |
| `STRIPE_PORTAL_CONFIGURATION_ID` (optional) | `bpc_…` | Anything else |
| `BILLING_LEDGER_EPOCH_UNIX` | Staging's own Unix time in seconds | Missing, or not seconds |
| Every other integration key (Apollo, Anthropic, Gmail, …) | — | Still refused |

Stripe and `BILLING_*` variables are only ever read from the env file. `stagingDev.mjs` drops
them from the shell, so a live key exported in a terminal can never reach the app.

The staging epoch is unrelated to production's (`1794632515`). It only makes the webhook grant
credits in staging the way it does in production. Use the time the session starts.

## Setup and each session

The procedure (key, catalog, env file, starting the app with `--billing --apollo-mock`, test cards,
test clocks) is in [STAGING_VALIDATION_RUNBOOK.md](STAGING_VALIDATION_RUNBOOK.md), the single source
of truth for staging validation. This page only describes what the tools allow and refuse.

## What this never does

- Use a live key, read live data, or change any live Stripe setting.
- Touch production Firebase (`idynify-scout-dev`); the preflight refuses it.
- Deploy anything, or read Netlify's variables (`netlify dev --offline`, unlinked checkout).

Test data can be removed at any time from the Stripe Dashboard in test mode
(Developers → "Delete all test data"); that is the owner's call.
