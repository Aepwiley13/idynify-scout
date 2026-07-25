# Scout Intelligence Audit — Smart Contact Selection for Cadences

**Workstream:** Option 1 — Scout Intelligence Audit (research only, no code changes)
**Author:** Team A
**Date:** July 2026
**Purpose:** Establish what Barry already knows about each contact and about the
user, so we can scope "Barry suggests which contacts belong in this cadence."
This document becomes the brief for the next Scout intelligence feature.

---

## Executive Summary

The good news: the data model is rich. Every contact carries strategic
classification (warmth, relationship type, strategic value, brigade), a
persistent `barry_memory` object, a denormalized `engagement_summary`, and — for
enriched contacts — role/seniority/company/industry. The user's ICP lives in a
well-structured RECON dataset. **The raw material for matching mostly exists.**

The hard news, and the three things that will shape the feature:

1. **Contacts are richly *described* but sparsely *scored*.** `icp_score` is
   defined in the schema and read by the UI (AllLeads sorts by it), but **no code
   path writes a numeric `icp_score` onto a contact document.** ICP scoring today
   is a *company/lead* concept (`fit_score` on companies), not a *contact* one.
   Matching cannot lean on a precomputed contact score — it does not exist yet.

2. **`barryContext` has schema drift and is not reliably persisted.** Three
   different shapes are documented across the codebase, the function that
   generates it does not save it to Firestore, and one read path treats it as a
   plain string. It is generated on demand for a single contact profile, not
   maintained as a queryable field across the roster. Treat it as *present for
   some, absent for most.*

3. **Cadences capture almost no intent.** A cadence document stores `name`,
   `subject`, `body`, and the contact list — nothing about goal, audience, or
   objective. The Cadence Name field we just shipped is currently the *only*
   structured signal about what a cadence is *for*. Barry cannot match contacts
   to an intent that was never captured.

The simplest viable v1 is a **rule-based ranker** that uses the fields that *are*
reliably populated (person_type/brigade, warmth_level, engagement recency, title
keywords) plus a lightweight intent captured at compose time. A full Barry/LLM
semantic match is a fast-follow once intent capture and contact scoring exist.

---

## SECTION 1 — What Barry Knows About Each Contact

Contact documents live at `users/{userId}/contacts/{contactId}`. Two schema files
describe them, and they do **not** fully agree — this matters for the feature.

- `src/schemas/peopleSchema.js` — the "Operation People First" person record
  (snake_case: `first_name`, `company`, `barry_memory`, `engagement_summary`).
- `src/schemas/engagementSchema.js` — the "engagement" contract
  (camelCase-ish: `firstName`, `company_name`, `barryContext`, `engagementIntent`).

Real documents are a **superset/merge** of both, because contacts are created and
enriched by many different code paths (manual, CSV, Apollo enrichment, business
card, LinkedIn import, the Scout game). **Any matching logic must treat most
fields as optional and check alternate field names** (e.g. `company` vs
`company_name`, `firstName` vs `first_name`).

### Q1 — Fields that describe who the person is and what they care about

**Identity / firmographic (populated when enriched):**

| Field | Contains | Populated when |
|---|---|---|
| `name` / `first_name` / `last_name` / `firstName` / `lastName` | Person name | Always (name); split fields vary by source |
| `title` | Job title | Manual entry or Apollo enrichment |
| `company` / `company_name` | Company (denormalized) | Manual or enrichment |
| `company_id` | FK to `users/{uid}/companies/{companyId}` | When saved from a company |
| `industry` / `company_industry` | Industry | Enrichment; often missing on manual adds |
| `seniority` | `director` \| `vp` \| `c_suite` \| `founder` \| `owner` … | **Apollo enrichment only** (`apollo_search`) |
| `department` / `departments[]` | Function | Apollo enrichment |
| `location` / `city` / `state` / `country` | Geography | Enrichment |
| `linkedin_url` | Profile URL | Enrichment or manual |
| `job_start_date` | Tenure signal | Apollo enrichment |

**Strategic classification (user-set or Barry-inferred — the highest-signal
fields for matching):**

| Field | Values | Notes |
|---|---|---|
| `person_type` | `lead` \| `customer` \| `partner` \| `network` \| `past_customer` | The primary lens. Drives workspace + Barry tone. |
| `brigade` | `hot_prospect` \| `warm_prospect` \| `cold_prospect` \| `nurture` \| `stalled` \| `customer_active` \| `customer_past` \| `partner_referral` \| `partner_strategic` \| `network_close` \| `network_casual` | Behavioral contract. Barry suggests, user confirms. See `src/data/brigadeSystem.js`. |
| `relationship_type` | `prospect` \| `known` \| `partner` \| `delegate` | Structural relationship. |
| `warmth_level` | `cold` \| `warm` \| `hot` | Temperature at last interaction. |
| `strategic_value` | `low` \| `medium` \| `high` \| `critical` | Importance to current goals. Already drives recommendation priority. |
| `engagementIntent` / `engagement_intent` | `prospect` \| `warm` \| `customer` \| `partner` | Tone calibration for message generation. |
| `contact_status` | `New` \| `Engaged` \| `Awaiting Reply` \| `In Conversation` \| `Dormant` … | System state machine (`src/utils/contactStateMachine.js`). |
| `lead_status` | `new_lead` \| `contacted` \| `qualified` … `won` \| `lost` | Pipeline stage. |
| `known_contact` (+ `_source`) | boolean | Barry-inferred "personally known" flag. |

**Barry-inference provenance** — every inferred field carries `*_source`
(`barry_inferred` \| `user_set`), `*_inferred_at`, and `*_inference_reason`.
User-set values always win. Useful for *explaining* a match ("warm, per your
setting" vs "warm, Barry inferred from 2 replies").

**ICP score — defined but effectively empty at contact level:**

- `icp_score: number (0-100) | null` and `fit_score: number (0-100) | null` exist
  in both schemas and are initialized to `null` (`peopleSchema.js:407`).
- `icp_score` is **read** — `AllLeads.jsx:1607` sorts by `b.icp_score || 0`.
- **No writer sets a numeric `icp_score` on a contact document.** The active ICP
  scoring lives on the *company/lead* side (`fit_score` in `search-companies.js`,
  `DailyLeads`, `SavedCompanies`, `CompanyCard`). So on a real contact roster,
  `icp_score` is almost always `null`. **Matching cannot rely on it today.**

### Q2 — The `barryContext` object

This is the single most confusing part of the audit. **`barryContext` is
documented three different ways and none fully match what runs in production.**

**(A) What the code actually generates** — `netlify/functions/barryGenerateContext.js`
returns (and `src/components/contacts/MeetSection.jsx` consumes) this shape:

```
barryContext = {
  whoYoureMeeting: "One calm factual sentence about the person",
  whatRoleCaresAbout: [ "Often responsible for…", "Usually focused on…", … ],
  whatCompanyFocusedOn: [ "Based on public signals: …", … ],
  conversationStarters: [ "curiosity-based opener", … ],
  calmReframe: "one grounding sentence",
  reconInsight: "how this contact relates to the user's business" | null,
  generatedAt: ISO,
  reconEnhanced: boolean
}
```

**(B) What `engagementSchema.js` documents** (lines 99-128) — a *different* shape:
`{ contextBrief, confidenceLevel, dataQualityScore, enrichmentSummary, generatedAt,
personaSummary, suggestedFirstMove }`.

**(C) What the PersistentEngageBar zero-state expects** (lines 411-455) —
`personaSummary` and `suggestedFirstMove`.

**Mapping to the fields the brief asked about:**

| Field asked about | Reality |
|---|---|
| `personaSummary` | Documented in (B)/(C), **not produced by the generator (A)**. Closest live equivalent: `whoYoureMeeting`. |
| `whoYoureMeeting` | ✅ Produced by (A). |
| `whatRoleCaresAbout` | ✅ Produced by (A) (array). |
| `whatCompanyFocusedOn` | ✅ Produced by (A) (array). |
| `suggestedFirstMove` | Documented in (B)/(C), **not produced by (A)**. Closest live equivalent: `conversationStarters[0]`. |

**Population reality:** `barryGenerateContext` **returns** the object to the
caller but **does not persist it to Firestore**. Persistence depends on the
calling surface, and I found no reliable `updateDoc({ barryContext })` writer.
`AllLeads.jsx:354` even guards with `typeof contact.barryContext === 'string'`,
implying some legacy docs store a bare string. **Conclusion: `barryContext` is
generated on demand for the profile you are looking at, is inconsistently
persisted, and is present on only a minority of contacts.** It is a poor primary
key for roster-wide matching until it is (a) shape-normalized and (b)
persisted-on-write.

### Q3 — The `barry_memory` object

Defined in `peopleSchema.js` (`createBarryMemory()`), per-contact:

```
barry_memory = {
  who_they_are, current_goal, relationship_summary,
  what_has_been_tried[], what_has_worked[], what_has_not_worked[],
  tone_preference, channel_preference,
  known_facts[], context_by_session{}, last_updated_at
}
```

**Population:** initialized empty on every new contact and **grows only through
engagement** — Barry writes to it during/after engage sessions. So it is
populated for **previously engaged contacts only**, and empty (all `null`/`[]`)
for the long tail of never-engaged leads. There is also a **user-level**
`barry_memory` document at `users/{userId}/barry_memory` holding global
preferences and per-channel reply rates (see Q6/engagementSchema lines 859-874).

### Q4 — Engagement-history fields (has this contact been reached before?)

Two layers, both useful for matching, both **denormalized onto the contact** so no
subcollection query is needed:

**`engagement_summary`** (`createEngagementSummary()`):
`total_attempts`, `total_messages_sent`, `replies_received`, `positive_replies`,
`first_contact_at`, **`last_contact_at`**, `last_message_channel`,
**`last_outcome`** (`no_reply` \| `replied_positive` \| `replied_negative` \|
`bounced`), **`consecutive_no_replies`**, and `channel_history` (per-channel
attempts/replies).

**`engage_state`**: `status` (`never_engaged` \| `in_progress` \| `awaiting_reply`
\| `paused`), `last_session_at`, `preferred_channel`, `current_goal`.

Plus `next_step_due` / `next_step_type` (overdue follow-ups) and `contact_status`
(state machine). **The full event log** is the `timeline` subcollection
(`.../timeline/{eventId}`) — richer, but requires a per-contact read, so not
suitable for scanning the whole roster at compose time.

> ⚠️ **Data-quality caveat (documented in `engagementSchema.js:154-174`):** the
> timeline logger writes `createdAt` while readers `orderBy('timestamp')`, so some
> timeline events silently don't appear in order. Prefer the denormalized
> `engagement_summary` fields for matching; treat the timeline as best-effort.

**Bottom line for Q1-Q4:** the "has this been contacted / how recently / what
happened" question is **well answered** by `engagement_summary` + `engage_state`
+ `contact_status`. The "who is this / what do they care about" question is
**well answered for enriched contacts** (title, seniority, industry, company) and
**weakly answered** by `barryContext` (unreliable) and `barry_memory`
(engaged-only). The "how good a fit is this" question (`icp_score`) is
**effectively unanswered at the contact level.**

---

## SECTION 2 — What the User Tells Us

### Q5 — Intent captured when a user runs a cadence

**Almost none.** The cadence document (written fire-and-forget by
`src/components/scout/BulkSendExecutor.jsx` on completion, at
`users/{userId}/cadences/{id}`) contains:

```
{ userId, name, subject, body, contactCount, contacts[],
  sentCount, openedCount, failedCount, createdAt, completedAt }
```

- `name` — **now user-provided** (Workstream A, just shipped). This is currently
  the **only** semantic signal about a cadence's purpose.
- `subject` / `body` — the message content (implies intent, but only as free text).
- `contacts[]` — who it went to, with per-contact `status`/`reason`.

There is **no** `goal`, `audience_type`, `objective`, `intent`, or `brigade`
field on the cadence. The compose flow (`BulkComposeModal.jsx`) captures name,
subject, body, personalization toggle, optional attachment/CC — and the recipient
list is **manually assembled** by the user via search. **This is the core gap the
feature must close:** to match contacts to a cadence, we need to know what the
cadence is *trying to do*, and right now we only know its name.

**Relevant prior art that already models intent (not wired into Cadences):**
`src/utils/buildAutoIntent.js` defines `SESSION_MODES`
(`direct_pipeline`, `warm_outreach`, `re_engagement`, `new_introductions`), each
mapping to a warmth level, relationship type, and `engagementIntent`. Missions
carry even richer structured intent (`objective_type`, `outcome_goal`,
`time_horizon`, `engagement_style` — see `firebase/schema.js`). **This is a
proven pattern to lift into the cadence compose step.**

### Q6 — RECON / ICP data available for the user

Two stores, both usable:

**1. RECON dataset** — `dashboards/{userId}.modules[recon].sections[]`, each
section keyed by numeric `sectionId` with `status: 'completed'` and a `data`
object. Compiled for prompts by `netlify/functions/utils/reconCompiler.js`.
Canonical section map (`src/utils/reconSectionMap.js`):

| Section | Content | Relevance to contact matching |
|---|---|---|
| 1 — Business Foundation / ICP | Who the user is, what they sell, current customers | **High** — baseline ICP definition |
| 2 — Product Deep Dive | Features, differentiation, use cases | Medium |
| 3 — Target Market | Industries, company sizes, geographies | **High** — direct firmographic match criteria |
| 4 — Psychographics | Buyer fears, goals, values | Medium — persona/title fit |
| 5 — Pain Points | Primary pain, triggers, workarounds | **High** — role/context match |
| 6 — Buying Behavior & Triggers | Buying signals | Medium |
| 7 — Decision Process | Who decides | Medium — seniority match |
| 8 — Competitive Landscape | Competitors | Low |
| 9 — Messaging & Value Prop | Voice, proof points | Low for *selection*, high for *drafting* |
| 10 — Behavioral Signals | — | Low |

The client-side loader `src/utils/barryContextStack.js` already extracts the
highest-value sections (ICP=1, valueProposition=2, psychographics=4, painPoints=5,
outreachContext=9) plus a `reconConfidence` score, caches them for 5 min, and
ships them to Barry. **The most relevant sections for matching contacts to
outreach are 1 (ICP), 3 (Target Market), and 5 (Pain Points)** — these define the
firmographic + role criteria a good-fit contact should meet.

**2. ICP profiles** — `users/{userId}/icpProfiles/{id}` (multi-ICP support), with
`isActive` / `status: 'active'` flags and a per-profile `messaging` object. A
pre-migration fallback reads `users/{userId}/companyProfile/current`. Legacy
single-ICP docs also exist at `users/{userId}/icp` and `users/{userId}/icpBrief`.
**A matching feature should resolve the active ICP profile via the existing
`getActiveMessagingProfile()` logic in `barryContextStack.js` rather than reading
raw docs.**

**Takeaway:** the user's side is in good shape. RECON gives us the ICP definition
(what a good contact looks like); the gap is entirely on **capturing per-cadence
intent** (Q5).

---

## SECTION 3 — The Matching Opportunity

### Q7 — Simplest possible version of "Barry suggests which contacts to include"

**A rule-based ranker over the roster, seeded by a lightweight intent picker.**
No new data model, no LLM required for v1.

**Inputs Barry would need:**
1. **Cadence intent** — captured at compose time via a small dropdown reusing
   `SESSION_MODES` from `buildAutoIntent.js` (e.g. "New pipeline / cold",
   "Warm re-engagement", "Customer expansion", "Partner / referral"). One click,
   maps cleanly to `person_type` + `warmth_level` + `brigade` targets.
2. **The contact roster** — already loaded (up to 500) by `barryContextStack.js`,
   carrying `person_type`, `warmth_level`, `strategic_value`, `contact_status`,
   `last_interaction`, `title`, `company`.
3. **RECON ICP sections 1/3/5** — already extracted, for optional keyword
   matching against `title` / `industry`.

**What Barry would produce:** a ranked shortlist ("these 12 contacts match"),
each with a one-line, explainable reason derived from the rule that fired
("Warm lead, no reply in 30 days" / "C-suite in your target industry" /
"High strategic value, never contacted"). Rendered as a "Barry suggests" panel in
the compose step with checkboxes to accept/adjust — the user stays in control.

**Illustrative v1 scoring (pure client-side, deterministic, explainable):**

```
score = 0
if contact.person_type matches intent.target_type:        score += 40
if contact.warmth_level matches intent.target_warmth:      score += 20
if intent is re-engagement and consecutive_no_replies>0
   and last_contact_at is stale:                           score += 20
if intent is new-pipeline and engage_state == never_engaged: score += 20
if contact.strategic_value in {high, critical}:            score += 10
if title/industry keyword-matches RECON section 1/3:       score += 10
exclude: is_archived, no email, already in this cadence
```

This is buildable in ~1-2 days because **every field it reads is already
populated and already loaded.** It degrades gracefully: a contact missing
`warmth_level` or `title` simply scores lower, never errors.

### Q8 — What's missing that would make matching significantly better

In priority order:

1. **Per-cadence intent capture (biggest lever).** Nothing downstream can be
   smart until we know the cadence's goal/audience. Add structured intent to the
   compose step and persist it on the cadence doc. Low effort, unlocks everything.
2. **A real contact-level `icp_score`.** The field exists and the UI already
   sorts by it — but nothing populates it. A batch/enrichment-time scorer that
   grades each contact against the active ICP (sections 1/3/5) would give matching
   a strong numeric signal and light up existing UI for free.
3. **Normalized + persisted `barryContext`.** Pick one shape, write it on
   enrichment, and store it on the contact doc so it's queryable across the roster
   instead of regenerated per profile. Enables semantic (LLM) matching later.
4. **Better enrichment coverage.** `seniority`, `industry`, `department`,
   `job_start_date` are Apollo-only. Matching quality scales with how many
   contacts are enriched; unenriched contacts fall back to weak signals (name +
   maybe company).
5. **Field-name normalization.** `company` vs `company_name`, `firstName` vs
   `first_name`, two `barry_memory`/`barryContext` schemas — every consumer
   re-implements fallback chains. A single normalizer would de-risk matching.

**v2 (once 1-3 exist):** a Barry/LLM semantic pass that reads the cadence
intent + `body` and the shortlist's `barryContext`/`barry_memory` to re-rank and
explain in natural language ("Terri cares about CRA initiatives, which this
cadence leads with"). The `barryBulkPersonalize` function already demonstrates the
per-contact LLM fan-out pattern we'd reuse.

### Q9 — Top 3 risks / unknowns

1. **Sparse, inconsistent contact data.** Matching is only as good as the fields
   populated. Warmth/relationship/strategic_value are **optional and often unset**;
   `icp_score` is effectively empty; `barryContext`/`barry_memory` exist for a
   minority. **Risk:** a "smart" suggestion that is actually near-random for users
   who haven't enriched or classified their roster. **Mitigation:** rank on the
   most-populated fields first (`person_type`, `engage_state`, `last_contact_at`),
   show reasons so users can sanity-check, and degrade to "no strong match — pick
   manually" instead of guessing.

2. **Intent capture UX vs. friction.** The whole feature hinges on the user
   telling us the cadence's goal (Q5/Q8). Too heavy and it hurts the compose flow
   we're simultaneously polishing; too light and matches are vague. **Unknown:**
   the right granularity — a single 4-option mode picker, or richer
   objective/audience fields. **Mitigation:** start with the proven 4
   `SESSION_MODES`, make it optional (skip → today's manual behavior), measure.

3. **Trust, correctness, and Barry's guardrails.** `barryGenerateContext`
   explicitly forbids scoring/ranking/qualifying people ("NEVER score, rank, or
   qualify this person") — a *selection* feature is philosophically adjacent to
   that line and must be framed as "surfacing relevant contacts," not "grading
   humans." A wrong or tone-deaf suggestion (e.g. surfacing a `bounced` or
   `replied_negative` contact for cold outreach) erodes trust fast. **Mitigation:**
   hard exclusion rules (bounced, archived, no-email, recently-negative),
   always-editable shortlist, and explainable reasons on every suggestion.

---

## Recommended Next Step (scope for the follow-on feature)

**Phase 1 (small, ships fast):**
- Add an optional **intent picker** to `BulkComposeModal` Step 1, reusing
  `SESSION_MODES`. Persist `intent` (+ derived `target_type`/`target_warmth`) on
  the cadence document alongside the `name` we just added.
- Add a **rule-based "Barry suggests" panel** that ranks the already-loaded roster
  by the deterministic scoring above and pre-checks the top matches, each with a
  one-line reason. Fully manual override retained.

**Phase 2 (fast-follow, higher ceiling):**
- Populate a real contact-level `icp_score` at enrichment time against RECON
  sections 1/3/5 (lights up existing AllLeads sort for free).
- Normalize + persist `barryContext` on write; add an optional Barry/LLM
  re-rank + natural-language reasons over the Phase 1 shortlist.

Phase 1 depends on **zero** new infrastructure — every input already exists and
is already loaded at compose time. That is the cheapest path to "Barry says: these
12 contacts match what you're trying to do."

---

## Appendix — Key file references

| Concern | File |
|---|---|
| Person record schema (snake_case) | `src/schemas/peopleSchema.js` |
| Engagement/contact contract (camelCase) + `barryContext` doc | `src/schemas/engagementSchema.js` |
| Firestore collection map, ICP/RECON section docs | `src/firebase/schema.js` |
| `barryContext` generator (actual shape) | `netlify/functions/barryGenerateContext.js` |
| `barryContext` consumer (UI) | `src/components/contacts/MeetSection.jsx` |
| RECON → prompt compiler | `netlify/functions/utils/reconCompiler.js` |
| RECON section map + relevance | `src/utils/reconSectionMap.js` |
| Roster + ICP + RECON loader (already loads everything matching needs) | `src/utils/barryContextStack.js` |
| Structured intent prior art (`SESSION_MODES`) | `src/utils/buildAutoIntent.js` |
| Cadence document write (intent gap) | `src/components/scout/BulkSendExecutor.jsx` |
| Cadence compose flow | `src/components/scout/BulkComposeModal.jsx` |
| Per-contact LLM fan-out pattern (reuse for v2) | `netlify/functions/barryBulkPersonalize.js` |
| Brigade behavioral contracts | `src/data/brigadeSystem.js` / `engagementSchema.js` (`BRIGADE_BARRY_CONTRACT`) |
| `icp_score` read (no writer) | `src/pages/Scout/AllLeads.jsx:1607` |

## Appendix — Flags (not workarounds)

- **`barryContext` schema drift** — three documented shapes; generator output
  matches none of the docs exactly. Needs a decision + normalization before it can
  be a matching input.
- **`icp_score` is a dead field at contact level** — schema'd and sorted-on, never
  written. Either populate it or stop implying it works.
- **Timeline `createdAt` vs `timestamp` bug** (`engagementSchema.js:154-174`) —
  some events silently missing from ordered reads. Prefer `engagement_summary`.
- **Cadence intent is uncaptured** — the feature's single hardest dependency;
  recommend closing it in the same sprint that adds matching.
