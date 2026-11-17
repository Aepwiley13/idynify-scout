# Phase 3 — Enrichment credits: audit, cost model and recommended rates

**Status: audit only. Nothing here changes code, Stripe, Apollo or Firebase.** Credit
consumption is not implemented; this is the review the owner asked for before it is.

## Summary

1. **No credit is ever deducted today.** `deductCredits` (transactional and tested) has no caller
   outside tests. Paying customers' Apollo use is unlimited, and the balance in Settings never
   moves.
2. **No Apollo function checks payment or credits.** Each one checks only that the caller is
   signed in as the account named in the request. Any account, including a new Free one, can call
   them directly. Free signups make this matter: **close it before the Free plan goes live.**
3. **The weekday lead refresh spends Apollo on every account with an ICP**, paid or not
   (`daily-leads-refresh.js`, 09:00 UTC Monday–Friday, up to three company-search pages each).
4. **Repeat lookups are paid again.** None of the enrichment functions reuses an earlier result
   (only `barryEnrich` checks internal data first, and still calls Apollo).
5. **One request can make many paid lookups.** `searchPeople` enriches up to `maxResults` people,
   and `maxResults` comes from the browser with no server cap (the app sends 3; the default is 10).
6. **The actual cost per Apollo credit is unknown here.** Apollo's documentation host is
   unreachable from this session, and Idynify's Apollo plan and invoices are not in the
   repository. The cost model below shows how to measure it and what each value of it means;
   **pricing is not final until it is measured.**

## Every paid Apollo call

Endpoints are the ones in `netlify/functions/utils/apolloConstants.js`. "Credit-bearing" is what
Apollo charges per the public sources at the end, **not verified against Apollo's own pricing
page** (see "Inputs needed").

| # | Function | Called from | Apollo calls per request | Credit-bearing |
|---|---|---|---|---|
| 1 | `enrichContact` | Scout company detail and profile | 1 × `people/match` | Yes: 1 per matched person |
| 2 | `enrichCompany` | Scout company detail, modal, company enrichment services | 1 × `organizations/enrich`, 1 × `mixed_people/api_search`, up to 3 × `people/match` | Yes: about 1 + 3 |
| 3 | `searchPeople` | Company detail, Daily Leads, company decision | 1 × `api_search`, then 1 × `people/match` per candidate, up to `maxResults` (browser-supplied, default 10, uncapped) | Yes: up to N |
| 4 | `barryEnrich` | Contact profile, first-experience onboarding | up to 1 × `people/match`, 1 × `api_search` | Yes: about 1 |
| 5 | `findContactByLinkedInUrl` | LinkedIn link search, capture confirm | 1 × `people/match` | Yes: 1 |
| 6 | `find-contact-by-email` | Hunter "add from email" | 1 × `people/match` (reveals explicitly off) | Yes: 1 |
| 7 | `captureLinkedIn` | Relationship Capture | 1 × `people/match` (with a search in parallel) | Yes: 1 |
| 8 | `findContact` | Find contact, contact search | 1 × `api_search` (5 per page) | Apollo lists People API Search as not consuming credits |
| 9 | `search-companies` | ICP search, Mission Control, Daily Leads, ICP settings, Barry ICP panel, **and the weekday refresh** | up to 3 × `mixed_companies/search` (50 per page) | Disputed: 0, or 1 per page |
| 10 | `search-companies-manual` | Company search | 1 × `mixed_companies/search` (10 per page) | Same as 9 |
| 11 | `daily-leads-refresh` (scheduled) | Every account with an ICP profile | Calls 9 for each one | Same as 9, every weekday, paid or not |

**Phones:** no call sets `reveal_phone_number: true`; one sets it `false` explicitly. Pro's
"mobile numbers" are whatever Apollo returns without the paid phone reveal, so Idynify pays no
mobile-reveal credits today. If true mobile reveal is ever added, it is Apollo's most expensive
lookup (8 credits per the public sources) and must be priced separately.

**Who can call these:** all eleven verify a Firebase ID token and reject a token for a different
account (admins may act for a user). None reads `hasCompletedPayment`, `credits` or the plan.

**Claude:** the Barry functions call Anthropic, which is the other variable cost. It is outside
"Apollo enrichment", but `apiLogs` already records provider, model and tokens per call, so its
cost per active customer can be measured from the admin API activity page.

## The cost model (pricing not final)

**Nothing here is a final price.** The one unknown is **C, what Idynify pays Apollo per Apollo
credit**. Until C is measured, the table shows margins at three possible values. The $0.02 used
in the first version of this document was an assumption, not a measurement.

### Step 1 — measure the real cost per operation

The simplest reliable measurement uses Apollo's own credit counter, not public price lists:

1. Note the Apollo account's remaining credits (Apollo → Settings → Plans & Billing, or its
   usage page) and the plan's monthly price and included credits. Plan price ÷ included credits
   is C. Note the overage rate as well, in case the included credits run out.
2. From a paid test account, run each operation below **once**, against a person or company
   Idynify has never looked up, and read the counter after each one.
3. Record the credits each operation used, and repeat one of them for the same person, to
   learn whether a repeat lookup is charged again.

That gives "Apollo credits per operation" from Apollo itself. Each operation's cost is then that
number × C.

### Step 2 — the model

What a credit earns, after Stripe's standard US card fee of 2.9% + $0.30 per charge (confirm
against the account's own rate):

| Plan | Price | Credits | Net per month | Net per credit |
|---|---|---|---|---|
| Starter | $20 | 400 | $19.12 | $0.0478 |
| Pro | $50 | 1,250 | $48.25 | $0.0386 |

Per operation. "Apollo credits" are the public figures, to be replaced by Step 1. The proposed
credits are for discussion only.

| Operation | Function(s) | Apollo credits (to verify) | Proposed Idynify credits | Starter margin at C = $0.01 / $0.02 / $0.05 | Pro margin at C = $0.01 / $0.02 / $0.05 |
|---|---|---|---|---|---|
| Enrich one person | 1, 4, 5, 6, 7 | 1 | 2 | 90% / 79% / 48% | 87% / 74% / 35% |
| Enrich a company only | 2 (company part) | 1 | 2 | 90% / 79% / 48% | 87% / 74% / 35% |
| Company plus 3 decision makers | 2 | about 4 | 8 | 90% / 79% / 48% | 87% / 74% / 35% |
| Each person `searchPeople` enriches | 3 | 1 each | 2 each | as one person | as one person |
| People search, no contact details | 8, 3 (search part) | 0 | 0 | no cost | no cost |
| Company search (ICP discovery) | 9, 10, 11 | 0 or 1 per page (disputed) | 0, with a daily cap | up to about 65 pages a month per paid account from the weekday refresh: $0.65 / $1.30 / $3.25 a month | same |

Per plan, if a customer spends every credit on person enrichment at 2 credits each:

| Plan | Lookups | Apollo cost at C = $0.01 / $0.02 / $0.05 | Margin before Claude and hosting |
|---|---|---|---|
| Starter (400 credits) | 200 | $2.00 / $4.00 / $10.00 | 90% / 79% / 48% |
| Pro (1,250 credits) | 625 | $6.25 / $12.50 / $31.25 | 87% / 74% / 35% |

For comparison, today's table charges 1 credit per field, and Apollo charges once per matched
person. One credit per person is below cost at any C above $0.0386 (Pro).

The rate formula, for a target margin `m`, using Pro's lower net per credit:

```
Idynify credits for an operation  =  ceil( Apollo credits × C  ÷  ( $0.0386 × (1 − m) ) )
```

### Step 3 — safeguards against repeat charges and excessive use

| Risk | Safeguard | When |
|---|---|---|
| Free and lapsed accounts spending Apollo | Paid-access guard on every Apollo function and the weekday refresh | **Phase 1c PR (done, in review)** |
| The same person or company paid for twice | Reuse a saved result for the same account and target within a window (proposed 30 days), with no Apollo call and no charge | With metering (3.2) |
| A retry or double-click charging twice | One charge key per account, action and target; reserve, then settle or refund (below) | With metering (3.2) |
| One request triggering many lookups | Server cap on `searchPeople` (proposed 5 people per request) | With metering, or sooner if wanted |
| Heavy use within a paid plan | The plan's credit balance; ICP searches capped per day | With metering |
| Paying Apollo overage | Track Apollo credits used against the plan's included credits monthly (Apollo usage page) | Ongoing, owner |

## What counts as a billable action

A request is charged only when **all** of these hold:

1. It is one of the actions above, and the server decides the cost (the browser never sends it).
2. The account has paid access or enough credits. Otherwise the server answers
   `insufficient_credits` before calling Apollo.
3. Apollo returned a match with data. "No match", an Apollo error and a timeout are not charged;
   a reserved charge is refunded.
4. It is not a repeat. The same person or company enriched again by the same account within a
   window (recommend 30 days) returns the saved result without calling Apollo or charging.

## No double charges, safe failures and refunds

The design reuses what exists: `deductCredits`/`refundCredits` (transactional, emulator-tested
under concurrency) and the `users/{uid}/creditTransactions` log.

1. **One key per action.** The server derives `chargeId = hash(uid, action, target)`. A
   double-click, a retry or a replayed request carries the same key.
2. **Reserve.** In one transaction: if `creditTransactions/{chargeId}` exists, return its outcome
   (no second deduction). Otherwise check the balance, deduct, and write the charge as `reserved`.
3. **Call Apollo once.**
4. **Settle.** In one transaction: a match → `settled` (and the result saved for reuse); no match,
   error or timeout → credits returned and the charge marked `refunded` with the reason.
5. **A crash between 2 and 4** leaves the charge `reserved`. The next request with the same key,
   or a sweep of charges reserved for more than 10 minutes, refunds it. We cannot tell whether
   Apollo charged us, so the customer gets the benefit of the doubt.
6. **The log becomes server-only.** Today `firestore.rules` lets a customer write their own
   `creditTransactions` (the balance itself is protected). One rules line closes that, so the log
   can serve as the record of what was charged and refunded.

## Monthly allocation goes with metering

Credits are granted once, at checkout, and never reset. If consumption ships without renewal,
paying customers run out permanently. Renewal must ship with metering:

- The webhook handles `invoice.paid`. A `subscription_cycle` invoice resets the plan's allowance
  (purchased pack credits are kept). A `subscription_create` invoice is ignored, because checkout
  already granted credits. One `billingAllocations` marker per invoice means a replay never
  grants twice, and an invoice paid before the ledger epoch never grants.
- **Production change:** `invoice.paid` must be added to the live webhook endpoint's events
  (the owner, in Stripe).

## Recommended order (each step for approval)

| Step | What | Why first |
|---|---|---|
| 3.0 | **Paid-access guard** on the Apollo functions; the weekday refresh skips accounts without paid access. **Built as the Phase 1c PR.** The `searchPeople` cap moves to 3.2 | Closes findings 2 and 3. **Needed before the Free plan is switched on in production** |
| 3.1 | Measure C and credits per operation (Step 1 above); the owner sets the rates | Fixes the numbers; nothing is priced before this |
| 3.2 | Metering with reserve/settle/refund and repeat-lookup reuse; the log made server-only | Findings 1 and 4 |
| 3.3 | Renewal allocation via `invoice.paid` | Must ship with 3.2 |
| 3.4 | Credit packs (Phase 4), priced at or above $0.0386 per credit | Needs 3.2 |

## Inputs needed from the owner

1. **Idynify's Apollo plan:** name, monthly price, credits included per month, and the overage
   rate (Apollo Settings → Plans & Billing). This gives C.
2. **The Step 1 measurement:** each operation run once from a paid test account, with Apollo's
   credit counter read before and after.
3. **Last month's Apollo credit usage** next to the admin API activity counts by endpoint, as a
   cross-check on real traffic.
4. **The target margin.**

## Sources and limits

- Code: every file named above, read at `main` `a530b2a`.
- Apollo's own pricing page (`docs.apollo.io/docs/api-pricing`) could not be fetched from this
  session (host not reachable). The per-endpoint costs above are from public third-party
  write-ups, which agree on 1 credit per matched person and 8 per phone, and disagree on
  company search:
  [Apollo API pricing (official, not fetched)](https://docs.apollo.io/docs/api-pricing),
  [Activepieces: Apollo API docs, rate limits and credits](https://www.activepieces.com/blog/apollo-api-docs-rate-limits-and-credits-2026-guide.md),
  [Usage Pricing: Apollo API credit rates, 2026-07-18](https://usagepricing.com/blueprint/activity/apollo-2026-07-18-api-credit-rates),
  [Cleanlist: Apollo API guide](https://www.cleanlist.ai/blog/2026-10-15-apollo-api-guide),
  [Superdupr: Apollo pricing 2026](https://superdupr.com/blog/apollo-pricing.md),
  [Apollo: what are credits](https://knowledge.apollo.io/hc/en-us/articles/9527776320781-What-Are-Credits).
  The $0.20 overage figure is from these third-party sources and is used only as a worst case.
