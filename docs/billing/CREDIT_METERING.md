# Credit metering for paid enrichment (W4)

**Status:** built and tested; **off** until `CREDIT_METERING=on` is set for a deploy context.
Rates are **provisional** until Idynify's Apollo pricing is verified (the Phase 3 credit audit,
`docs/billing/PHASE3_CREDIT_AUDIT.md`). Monthly renewal is the separate W4b PR.

## What is charged

| Function | Most reserved | Charged when the response shows |
|---|---|---|
| `enrichContact` | 1 person | an enriched person |
| `barryEnrich` | 1 person | a field Apollo matched (`provenance` = `apollo_match`) |
| `findContactByLinkedInUrl`, `find-contact-by-email` | 1 person | a contact |
| `captureLinkedIn` | 1 person | a candidate profile Apollo supplied |
| `enrichCompany` | 1 company + 3 people | the company, and each decision maker revealed (at most 3) |
| `searchPeople` | 5 people | each person returned (at most 5: the server cap) |
| `findContact`, `search-companies`, `search-companies-manual` | 0 | nothing; each counts toward the daily search limit |

Rates: `CREDIT_RATES='{"person":1,"company":1}'` (whole credits, 0–100 each). The defaults are
1 and 1: placeholders, not a pricing decision.

## How a lookup is charged

1. **Reserve** (one transaction): not enough credits → `402 insufficient_credits`, before Apollo.
2. The function runs; Apollo is called once.
3. **Settle** (one transaction): charge what was returned, give back the rest. No match, an error
   or a crash → everything given back. One `creditTransactions` entry per lookup.

| Situation | Result |
|---|---|
| Same request while it runs | `409 lookup_in_progress`, no Apollo call |
| Same request within 10 minutes of a charged answer | The same answer replayed; no Apollo call, no charge |
| Same request after 10 minutes | A new, billable lookup |
| A reservation left by a crash (over 2 minutes old) | Given back in full on the next identical request |
| Admin, or an admin acting for a user | Not charged |
| Account without paid access | Not metered; the paid guard refuses it (402) |
| Tokens that do not agree on one account | `401` before anything runs |

Limits: the credit balance; `CREDIT_DAILY_SEARCH_LIMIT` (default 200) searches a day per account
(`429 daily_limit_reached`); `searchPeople` at most 5 people per request (always on).

## Firestore rules (a production deploy, owner approval)

`creditTransactions`, `creditCharges` and `creditUsage` under `users/{uid}` become server-only:
the owner can read them, no client can write them. Today a client can write its own
`creditTransactions`. Rules cases 24–30 in `scripts/rules-check/cases.mjs`.

## Turning it on (each step approved)

1. Set the rates from the measured Apollo cost (`CREDIT_RATES`).
2. Deploy the Firestore rules above.
3. Staging: `CREDIT_METERING=on` with the Apollo mock (W6); run the end-to-end test.
4. Before production: every paying account has a `credits` value (an account without one is told
   it has no credits).
5. Production: `CREDIT_METERING=on`, with W4b's monthly renewal live at the same time, so paying
   customers never run out permanently.
