# One real Apollo enrichment: the manual test (not yet approved to run)

**Status:** prepared, **not to be run** until the owner approves it, after Idynify's Apollo plan and
cost per credit are confirmed. Nothing in the repository enables real Apollo spending in staging:
the staging tools refuse an Apollo key (preflight I5) and only allow the local stand-in.

## Purpose

The end-to-end test ([FREE_TO_SCOUT_E2E.md](FREE_TO_SCOUT_E2E.md)) uses a stand-in for Apollo. This
one manual test confirms, with one real lookup, that:

1. Apollo's real response is read the way the stand-in's is: the person is enriched, nothing the
   customer entered is overwritten, and the charge rule (`creditMetering.js` METERED) sees a match;
2. Idynify's credits go down by the configured rate, once;
3. Apollo's own usage page shows the credits Apollo charged, which gives the real cost per lookup
   for setting `CREDIT_RATES`.

## Cost and scope

One `people/match` on a person with a public profile: Apollo's usual cost is about one credit
(to confirm against the owner's plan). The test makes **one** lookup and stops.

## Two ways to run it (owner chooses)

**A. Production, on the owner's own paying account (recommended, no staging change).** After the
launch release with metering on: open one of the owner's own contacts that has a name and company,
press **Enrich contact** once, and check steps 4–6 below on that account. The owner's own Apollo key
is already where it belongs.

**B. Staging, with a staging-only Apollo key.** Needs a small, separately approved change: a
`--apollo-live` flag for `stagingDev.mjs` that allows `APOLLO_API_KEY` from the env file for one
run, with a confirmation prompt and the stand-in off. Not built.

## Steps

1. (B only) Store the key like the Stripe test key: hidden prompt, an env file outside the
   repository with `umask 077`, never pasted into chat or a commit
   ([CHECKOUT_TEST_MODE_VALIDATION.md](CHECKOUT_TEST_MODE_VALIDATION.md) §1.5).
2. Note the account's credits remaining and Apollo's usage counter (Apollo → Settings → Usage).
3. Enrich one contact once.
4. The contact shows the found details; every value that was already on the contact is unchanged;
   any title or company difference is offered as a suggestion, not applied.
5. The account's credits went down by the `person` rate exactly once; one `creditTransactions`
   entry with that cost.
6. Apollo's usage went up by the credits Apollo charged for one lookup. Record it: that is the
   real cost per lookup for the credit-rate decision.
7. (B only) Delete the key from the env file and rotate it if it was created for this test.

Record: date and time (UTC), who ran it, the contact (by id, not name), the credits before and
after, Apollo's usage before and after.
