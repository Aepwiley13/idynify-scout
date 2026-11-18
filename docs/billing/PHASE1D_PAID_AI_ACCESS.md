# Billing Phase 1d — Claude-powered features are for paid accounts

**Decision (owner):** Free users do not get unrestricted access to Claude-powered features. For
the launch, paid AI features are hidden from Free accounts *and* refused by the server. Hiding a
button is not the control. A path to offer Barry to Free accounts later, as a guided onboarding
assistant, is kept.

## What the server does

Every Netlify function that can reach Claude, directly or through a module it imports, exports
its handler through `withPaidAiAccess` (`netlify/functions/utils/paidAiAccess.js`). Before the
function's own code runs:

| Request | Answer | Claude called? |
|---|---|---|
| No token, or a token that does not verify | 401 `unauthorized` | No |
| Token holder has no paid access (Free, lapsed, no account document) | 402 `paid_plan_required` | No |
| Account cannot be read | 503 `entitlement_unavailable` (nothing assumed) | No |
| Paid account (`hasCompletedPayment`, written only by the webhook and recovery) | the function runs | as before |
| Admin (server lists or server-written `role`), including impersonation | the function runs | as before |
| CORS preflight (`OPTIONS`) | the function's own answer | No |

- The decision uses Phase 1c's `checkPaidApiAccess`, so Apollo and Claude follow one rule.
- **Every** token a request carries (the `Authorization` header and the body's `authToken` and
  `idToken`) must verify and pass, so the check covers the token the function itself reads.
- The token holder is checked, not the body's `userId`. A Free account cannot name a paid
  account's id to get through, and an admin acting for a user still can.
- Nothing in the request body about payment or role counts.
- The Admin SDK is loaded on the first guarded request, so a function never fails to load
  because of the guard. A start-up failure is a 503 refusal.

**Covered:** 39 functions (Barry chat, actions, orientation brief, context, first touch, hunter,
mission sequences, templates, recon interview and sections, ICP conversation, CSM and dossier
reads, outreach, validation, bulk personalize, generated messages, follow-ups, texts, website
analysis and crawling, RECON section and report generation, capture extraction).

**Not wrapped, by review:**

| Function | Why |
|---|---|
| `anthropicKeyCheck` | Calls only Anthropic's free Models API and `messages/count_tokens`, cached per instance (#699) |
| `process-barry-inbox-queue` | Scheduled, with no caller. It checks each queue entry's owner (`ownerAiAccess`): a Free owner's entry is set to `skipped_not_paid` and never sent to Claude; an owner whose account cannot be read stays `pending` for the next run |

`src/test/paidAiAccess.test.js` finds the Claude-powered functions from the source. A new one
that is not wrapped, or a new exemption, fails the test.

## What the screens do

`src/utils/barryAccess.js` decides once, in `MainLayout`, from the account data the app already
holds: paid or admin → Barry as before; otherwise the sidebar Barry control, the More sheet's
Barry tile and Barry's panel are not rendered. The panel is not mounted at all, so it makes no
background request for an opening brief. Without account data (still loading) nothing changes.

Free Contact Hub and Settings call none of these functions (checked by walking their imports),
so contacts, stickers, notes, profiles and My Card are unaffected.

## Introducing Barry for Free accounts later

One server decision and one screen decision:

1. **Server:** give the chosen feature (for example a new onboarding function) a free allowance
   in `paidAiAccess.js`: a per-account counter that only the Admin SDK writes, incremented in a
   transaction before Claude is called, refusing with 402 once spent. Firestore rules already
   keep clients out of server-written fields; the counter lives under the same protection.
2. **Screens:** have `barryAvailableFor` offer that Barry surface while the allowance lasts.

Nothing else changes. Until such an allowance exists, no feature has one.

## Rollback

Revert the PR. The guard adds no data and changes no stored field, apart from Free owners' inbox
queue entries marked `skipped_not_paid`, which can be set back to `pending` if ever wanted.
