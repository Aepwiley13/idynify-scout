# Team A — Phase 2 Discovery: Barry First Experience

**Discovery and architecture only. No code, no schema, no screens.** Returned for convergence.
Repository state: `claude/team-a-nz6kaz` @ `050dc60` (Phase 1B closed). No application file was modified in producing this.

---

## 1. Current first-user journey, with friction

### The route a paying user actually takes

```
/signup  → email + password + tier                      2 fields
   ↓      writes users/{uid}: email, tier, credits, hasCompletedPayment:false
/checkout → Stripe                                       PAYMENT GATE
   ↓
/checkout/success → navigate('/onboarding/barry')
   ↓
BarryOnboarding — conversational: "Who are you hunting?"
   ↓ Barry extracts a targeting definition, user CONFIRMS  ← authorized ICP creation event (Tier 1)
   ↓ creates icpProfiles/{icpId}, projects the bridge, fires the first search
/mission-control-v2 (first-run view)
```

### The route someone gets by visiting `/` instead

```
/ → SmartRedirect → paid && !onboardingComplete → /onboarding
   ↓
OnboardingFlow — 6 steps:
   1. "Hi, I'm Barry" (no input)
   2. Website URL       → analyze-website → RECON §1 + websiteAnalysis
   3. Four smart questions → dashboards/{uid} top-level fields
   4. Gmail connect / skip
   5. Build list (reads companies, derives Match)
   6. Done → /mission-control-v2
```

### FINDING F-1 — two competing first-run flows, and they disagree

**This is the largest structural finding in the discovery.** Which flow a user gets depends on how they arrive, and the two write to different places:

| | `BarryOnboarding` (`/onboarding/barry`) | `OnboardingFlow` (`/onboarding`) |
|---|---|---|
| Reached from | `CheckoutSuccessPage`, Mission Control CTAs, DailyLeads | `SmartRedirect` from `/` |
| Creates an ICP | **Yes** — the authorized confirmation event | **No** |
| Writes | `icpProfiles/{icpId}` + bridge projection with `icpId` | RECON §1 via website analysis; four answers as **top-level** `dashboards/{uid}` fields |
| Fires first search | Yes, with explicit `icpId` | No (step 5 only reads and scores existing companies) |
| Marks `onboardingComplete` | Yes | Via `onboarding.markStep('completed')` |

A user who completes `OnboardingFlow` finishes onboarding with **no ICP and no discovery**, then lands on Mission Control. A user who completes `BarryOnboarding` finishes with an ICP and a running search. Both are "onboarded".

### Friction inventory

| # | Barrier | Required? | Disposition |
|---|---|---|---|
| B-1 | **Payment before any Barry contact** | Product decision, not technical | Barry cannot demonstrate value before the wall. **Owner ruling needed** |
| B-2 | Signup collects only email + password — **no name** | — | `OnboardingFlow` step 1 greets `Hi{firstName}` from a field nothing populates. Cheapest possible identity is not being captured at the one moment the user expects to give it |
| B-3 | Website URL as a discrete step with its own screen | **Removable as a step** | The *capability* is valuable and already built. The *screen* is the friction |
| B-4 | Four smart questions | **Deferrable** | Answers go to top-level dashboard fields with **no consumer** (`excludedIndustries`, `idealCustomerTypes`, `perfectCustomer`, `valueProposition`) — asked, stored, never read |
| B-5 | Gmail connect step | **Deferrable** | Already skippable, but it occupies a first-run step before any value has been shown |
| B-6 | "Who are you hunting?" as the opening question | **Not universal** | Assumes intent 4 (new prospects). Users 1, 3 and 5 cannot answer it meaningfully |
| B-7 | ICP confirmation before the first outcome | **Only for discovery** | Correct for discovery; a wall for everyone else |
| B-8 | `/onboarding/company-profile` questionnaire | Direct-URL only | Its search was removed in Tier 3; write is deferred debt. **Should not appear in Phase 2 at all** |
| B-9 | RECON as a 10-section module | **Not onboarding** | Reachable from onboarding's framing but must not become the first experience |

---

## 2. Proposed WHO → INTENT → FIRST VALUE model

```
        WHO                        INTENT                      FIRST VALUE
   ┌──────────────┐          ┌──────────────┐            ┌──────────────────┐
   │ name         │          │ "what are    │            │ one useful thing │
   │ + org/site   │─────────▶│  you here    │───────────▶│ Barry did, before│
   │ (optional)   │          │  to do?"     │            │ any setup        │
   └──────────────┘          └──────────────┘            └──────────────────┘
         │                          │                             │
    Barry DISCOVERS            human terms,              intent decides what
    from what it has           not module names          Barry needs next
```

**WHO** is one screen at most, and mostly pre-filled: name (captured at signup, where the user already expects to type it) and organization or website (optional). Barry discovers the rest.

**INTENT** is a question the user can answer without knowing the product. Not "which module?" but *"What are you trying to get done?"* — with a free-text field, because a user who types "I want to reconnect with old clients before Q4" has just told Barry more than any menu would.

**FIRST VALUE** is intent-determined and must arrive **before** any profile is complete. Barry's Question Rule ordering, applied literally: **Discover** what the website/email/uploads give → **Infer** the rest → **Confirm** the two or three things that matter → **Ask** only what cannot be known → **Learn** the remainder over time.

The critical inversion: today the flow is *configure, then value*. The model is *value, then progressively configure* — and configuration is mostly Barry confirming its own inferences.

---

## 3. Five worked user journeys

### User 1 — gives almost nothing (name only)

| | |
|---|---|
| **Barry can help immediately with** | Nothing intelligence-derived. This is the honest answer. What Barry *can* do is ask one good question and act on the answer |
| **Barry must ask** | Intent, in one free-text line |
| **Deferred** | Everything else |
| **First value** | Barry reflects the intent back as a plan: *"You want to find new customers. I'll need to know who you're looking for — tell me about your business, or paste your website and I'll read it."* The value is orientation, not fabricated intelligence |
| **Anti-pattern to avoid** | Presenting an empty dashboard, or a 10-section questionnaire, as "your workspace" |

### User 2 — gives a company website

| | |
|---|---|
| **Barry discovers** | Company name, what they do, main product, current customers (RECON §1); target industry, target company size, value proposition, ICP summary (`websiteAnalysis`). **All eight already extracted by `analyze-website` today** |
| **Barry infers** | A candidate targeting definition from `targetIndustry` + `targetCompanySize` + `icpSummary` |
| **Barry confirms** | *"You're Wiley Strategies — you help credit unions with member growth. Sound right?"* and then, only for discovery intent, the proposed targeting |
| **Barry must ask** | Intent only |
| **First value** | A business profile the user did not fill in, shown back to them in one screen |
| **Note** | This is the strongest existing capability in the product and it is currently buried as step 2 of the flow most users never see |

### User 3 — has customers and a network; wants engagement or referrals

| | |
|---|---|
| **Barry can help immediately with** | Everything relationship-oriented — this is exactly what v0.4-amend protects. Contact import, reply analysis, follow-up, meeting prep, referral outreach |
| **Barry must ask** | Intent; then where the people are (Gmail connect, or a paste/upload) |
| **Deferred** | **ICP entirely.** Zero ICP is valid; this user may never need one |
| **First value** | *"I found 340 people in your Gmail. Twelve of them you haven't spoken to in over six months."* Real, specific, requires no ICP |
| **Blocker today** | The only first-run path that creates anything (`BarryOnboarding`) opens with *"Who are you hunting?"* — a discovery question this user should never be asked |

### User 4 — wants new prospects, no ICP yet

| | |
|---|---|
| **Barry discovers** | Website-derived targeting signals, if a site was given |
| **Barry infers** | A proposed targeting definition |
| **Barry confirms** | The definition — **this is the authorized ICP creation event** (v0.4-amend Part VI #16, `BarryOnboarding.handleConfirm`) |
| **Barry must ask** | Only what the site did not yield **and** what D7 requires: at least one retrieval constraint — industry, location, or company size |
| **Deferred** | Scoring weights, revenue ranges (dormant), titles, messaging, all of RECON §2–§10 |
| **First value** | A first list of companies |
| **Constraint carried from Phase 1B** | D7 is enforced. If the confirmed definition carries no supported constraint, no search runs and `barryState` is `NEEDS_TARGETING` — Barry must ask for one more thing rather than run an unfiltered search |

### User 5 — one person, multiple companies or organizations

| | |
|---|---|
| **Barry can help with** | Whatever the *current* context supports — but only one context at a time |
| **Barry must ask** | Which organization this session is about |
| **Deferred** | Everything about the second organization |
| **First value** | Same as users 2–4, for the first organization |
| **Blocker** | **Architectural, and unsolved.** See §9. This user cannot be served correctly today, and no amount of onboarding design fixes it |

---

## 4. Discover / Infer / Confirm / Ask, by intent

| Intent | Barry DISCOVERS | Barry INFERS | Barry CONFIRMS | Barry must ASK | LEARNS over time |
|---|---|---|---|---|---|
| **Engage my network** | contacts, threads, last-contact dates (Gmail) | who has gone cold; who is strategically valuable | *"Reconnect with these twelve?"* | intent; connect a mailbox | tone, what gets replies, relationship state |
| **Referrals** | existing customers/contacts, engagement history | who is most likely to refer | the shortlist | intent; who counts as a customer | outcomes per ask |
| **Prepare for a meeting** | contact, company, thread history, calendar | what the meeting is about | the attendee and topic | intent; which meeting | what preparation the user actually uses |
| **Find new customers** | website → business + targeting signals | a candidate ICP | **the targeting definition** (creation event) | intent; ≥1 retrieval constraint if the site gave none | which matches get saved; swipe judgment |
| **Just looking / unclear** | nothing yet | nothing | nothing | one open question | everything |

**The rule that keeps this honest:** Barry only confirms things it actually inferred from something. A confirmation screen showing empty fields is an interrogation wearing a friendlier label.

---

## 5. Minimum information per intent

| Intent | Hard minimum | Why |
|---|---|---|
| Engage network / referrals / meeting prep | **intent + a source of people** | No ICP. No business profile. v0.4-amend: these operations are not ICP-dependent |
| Find new customers | **intent + ≥1 retrieval constraint** (industry, location, or company size) | D7. Below this a search is not ICP-targeted, and Phase 1B enforces that |
| Anything at all | **intent** | One question |

**Nothing else is a minimum.** Name, website, company, résumé, Gmail — all accelerators. A user who supplies two facts is not in an incomplete state, and no surface should tell them they are. (Phase 1B already established the display rule: only a surface attempting an ICP-dependent operation explains the requirement.)

---

## 6. Intelligence accelerators

| Accelerator | Status today | What it removes |
|---|---|---|
| **Company website** | **Built and working** — `analyze-website`, 8 fields, maps to RECON §1 + `websiteAnalysis`, friendly failure messages, never overwrites user-entered fields | Business identity, what they sell, who they serve, target industry, target size, value prop, ICP summary — potentially the entire "tell me about your business" conversation |
| **Free-form "tell me about yourself"** | **Built** — `BarryOnboarding` extracts a targeting definition from open text | Structured targeting questions |
| **Gmail** | **Built** — OAuth, sync worker, inbox analysis | "Who do you know?" entirely. The single highest-value accelerator for users 1, 3, 5 |
| **Résumé / document upload** | **Not built** | Personal work history, current org, role, industry, tenure — the WHO half, for a user with no company website |
| **LinkedIn URL** | **Not built.** Treat as a *potential* future source only | Nothing today. **Design nothing that depends on it** |
| **Facebook / social** | Not built | As above |
| **Calendar** | **Built** — Google Calendar integration | Upcoming meetings, who matters this week |

**Design rule that falls out of this:** every accelerator must be *offered*, never *required*, and each one must visibly retire questions. A user who uploads a résumé and is then asked their job title has been told their upload was pointless.

---

## 7. Immediate vs. progressive

**Immediate (before any configuration):**
- capture name at signup (B-2 — the cheapest fix in this document)
- one intent question
- act on whatever was given: read the site, read the mailbox, or say honestly that Barry needs one thing
- show one concrete result

**Progressive (earned, in context, never as a gate):**
- targeting definition — only when discovery is attempted
- RECON depth — as decisions need it, never as a questionnaire
- Gmail/calendar — offered at the moment they would pay off
- messaging, weights, revenue, titles — on demand, in settings
- second organization — when the user reveals one (§9)

**The test for anything claiming a place in "immediate":** does the user get something back for it *in this session*? If not, it is progressive.

---

## 8. Existing capabilities reusable without new code

| Capability | Where | Reuse |
|---|---|---|
| Website → business profile | `analyze-website` | WHO, for users with a site |
| Free-text → targeting definition | `BarryOnboarding` extraction | Intent 4 |
| **Authorized ICP creation** | `BarryOnboarding.handleConfirm` | The confirmation event, already ruled authorized |
| Canonical ICP resolution + 3 states | `resolveActiveIcp` (Tier 1) | Every surface deciding what a user can do yet |
| D7 constraint gate | `hasRetrievalConstraint` (Tier 1/3) | Prevents claiming a targeted search without one |
| Zero-ICP handling | Tier 1/2/4 | Users 1, 3, 5 already work |
| Match on demand + Coverage | `calculateICPScore`, `computeCoverage` (Tier 2) | First-value list, honestly attributed |
| Gmail OAuth + sync + inbox analysis | `gmail-sync-worker`, `barryInboxAnalyzer` | Intent 1–3 first value |
| Calendar | existing integration | Meeting prep |
| Orientation brief | `barryOrientationBrief` (now with User + ICP scope) | The "here's where you are" moment |
| Progress/step machine | `useOnboardingState` | Resumability, without new state design |

**Most of Barry's first experience already exists. It is assembled in the wrong order, behind the wrong questions, in two flows that disagree.**

---

## 9. Architecture and schema blockers — surfaced, not solved

**A-1 — User ≡ Workspace. The blocker for user 5.**
Every path is `users/{uid}/…` and `dashboards/{uid}`: `icpProfiles`, `companies`, `contacts`, `missions`, `serviceProfiles`, RECON, integrations. There is no organization or workspace object. `ShellContext.jsx:327` documents this explicitly as known schema drift: *"Idynify has no tenant/organization model today; all data is scoped users/{uid}/… and `organization_id` elsewhere refers to Apollo prospect companies, not the account's org."*
Consequence: one person working across two organizations must either blend both into one workspace or hold two logins. **Multi-ICP is not a substitute** — ICPs are targeting definitions inside one workspace, sharing its contacts, RECON and integrations.

**A-2 — No identity capture at signup.** `users/{uid}` gets email, tier, credits, payment state. No name, no organization, no website. The one moment a user expects to introduce themselves collects nothing about them.

**A-3 — Two first-run flows with different outcomes.** F-1. Not solvable by adding screens; it needs one decision about which flow is the flow.

**A-4 — Onboarding answers with no consumer.** `OnboardingFlow`'s four questions write top-level `dashboards/{uid}` fields (`excludedIndustries`, `idealCustomerTypes`, `perfectCustomer`, `valueProposition`) that nothing reads. Asking a question whose answer is never used is the exact opposite of Barry's Question Rule.

**A-5 — RECON §3 scope misalignment** (Phase 1B Category 2 debt). §3 is ICP-specific intelligence stored user-scoped. Any Phase 2 flow that collects targeting inherits this.

**A-6 — Payment precedes all intelligence.** Technically clean; a product constraint on "give Barry almost nothing and it starts helping".

**A-7 — No document/upload ingestion path.** No storage bucket, parser or extraction route for résumés or documents. The accelerator the objective names most concretely does not exist.

---

## 10. What must NOT be part of onboarding

- **RECON as a questionnaire.** Not renamed, not "progressive", not a shortened version. RECON is an acquisition method for intelligence Barry needs *later*
- **ICP creation as a required step.** Zero ICP is valid and frozen in v0.4-amend
- **`/onboarding/company-profile`** (`CompanyQuestionnaire`) — its search was removed in Tier 3, its write is deferred debt, and it duplicates every other path
- **Scoring weights, revenue ranges, target titles, messaging** — settings, and revenue is dormant anyway
- **Anything gated on LinkedIn or social APIs**
- **A completeness meter, profile percentage, or "finish setup" nag** — directly contradicts "two pieces of information is not an incomplete state"
- **Module names as intent choices** — "Scout / Hunter / Sniper" tells a new user nothing
- **A second flow.** Whatever Phase 2 produces must replace both existing flows, not become a third

---

## 11. Open product decisions requiring owner ruling

| # | Decision | Why it blocks design |
|---|---|---|
| **P-1** | **Which flow is the flow?** `BarryOnboarding` (creates an ICP) or `OnboardingFlow` (does not), or one replacement | Everything downstream depends on it. Two flows cannot both be the first experience |
| **P-2** | **Does Barry get to help before payment?** | Determines whether "walk in and Barry starts helping" is literal or post-checkout |
| **P-3** | **Is name captured at signup?** | Trivially cheap, but it changes the signup form and the WHO step |
| **P-4** | **Multi-organization: solve, defer, or declare out of scope?** | User 5 cannot be served without an answer. A workspace object is Category 3 |
| **P-5** | **Is intent stored intelligence?** If a user says "reconnect with old clients", does that persist, and in what scope? | Determines whether intent is a routing input or a durable intelligence type — a v0.4 question, not a UI one |
| **P-6** | **Is document/résumé upload in Phase 2 scope?** | It is the one named accelerator with no existing capability (A-7) |
| **P-7** | **What is "first useful outcome" per intent, concretely?** | The success criterion for the whole phase. Without it, "first value" stays a slogan |
| **P-8** | **What happens to the four consumer-less onboarding questions** (A-4) — wire, move, or drop? | They are collected today; leaving them collected-and-unread contradicts the Intelligence Rule |

---

## 12. Confirmation

No code was written. No schema proposed. No screens designed. No Phase 1B contract or ruling reopened — v0.4-amend is treated as frozen throughout, and its ICP cardinality, creation semantics and availability states are load-bearing in §3–§5 rather than revisited.

**Returned for convergence.**
