# Team A Takeover Review — IDYNIFY Positioning & Terminology

**Date:** 2026-08-16
**Reviewing team:** Team A
**Reviewed document:** `docs/audits/IDYNIFY_POSITIONING_TERMINOLOGY_HANDOFF.md`
**Status:** Review only. No application code changed. No PR opened. Tier 3 not implemented.

---

## A. Repository Verification

### Drift found

| Item | Handoff claim | Actual | Verdict |
|---|---|---|---|
| Branch tip | `6b9ce5c` | `c09e4fd` | **DRIFT** |
| Commits ahead of `main` | 2 | **3** | **DRIFT** |
| Commits behind `main` | 0 | 0 | Confirmed |
| Pushed | yes | yes | Confirmed |
| Open PR | none | none open for this work | Confirmed |
| Working tree | clean | clean | Confirmed |
| Build | passing | `vite build` exit 0 | Confirmed |
| Tests | 1128 pass / 5 fail | 1128 pass / 5 fail | Confirmed |

The third commit is `c09e4fd — Add positioning and terminology handoff document`. It adds only
`docs/audits/IDYNIFY_POSITIONING_TERMINOLOGY_HANDOFF.md`. It is the handoff document describing itself,
written after the document's own snapshot was taken. No application code is affected.

Both Tier 1/2 commits are present and are **not** ancestors of `origin/main` — the work is unmerged, as claimed.

### Branch assignment note

This session's designated branch is `claude/idynify-positioning-handoff-dcpnhl`. On checkout it sat at
`origin/main` and did **not** contain the Tier 1/2 work. I reset it locally to `c09e4fd` so the review ran
against the real state. I have not pushed that reset. Any Tier 3 work must start from `c09e4fd`, not from `main`.

### Test state confirmed

```
Test Files  2 failed | 50 passed (52)
     Tests  5 failed | 1128 passed (1133)
```

Failures are exactly the two tracked suites: `HunterContactCard` (1) and `ReconSectionEditor` (4, all
`window.matchMedia is not a function` in jsdom). Unchanged by this branch. Issue #545.

---

## B. Completed Work Verification

All four required final states are present and correct in the diff.

| Required final state | Location | Verified |
|---|---|---|
| `Barry • Online` (not `AI SDR • Online`) | `MissionControlDashboardV2.jsx:418` | Yes |
| `Barry is connecting the dots` (not "sales engine", not "learning your relationships") | `MissionControlDashboardV2.jsx:424`, `:502` | Yes |
| `Review companies matched to you` | `ScoutDashboardPage.jsx:278` | Yes |
| `Know who matters, why they matter, and what to do next` | `Homepage.jsx:121` | Yes |
| SWIPE LEFT / SWIPE RIGHT / Back to Swipe preserved | `ScoutDashboardPage.jsx:317,321`, `CompanyProfileView.jsx:528` | Yes |
| Bear → `ASSETS.logoMark` | `NavigationBar.jsx:42`, `UnifiedDashboard.jsx:167` | Yes |
| Homepage bear deferred | `Homepage.jsx:91` untouched | Yes |

### Flags

**B1 — One Tier 1 change landed on dead code.** `ScoutDashboardPage.jsx` is imported at `App.jsx:34` and
never routed. The "Review companies matched to you" fix is correct but currently reaches no user. The live
equivalent surface is `MissionControlDashboardV2`.

**B2 — One Tier 2 change landed on a legacy route.** `UnifiedDashboard.jsx` is routed only at
`/old-dashboard`, under the comment `{/* Protected Routes - Old Flow (keep for backwards compatibility) */}`.
Nothing in the app links to it. The bear replacement there is harmless but low-value. Same for
`NavigationBar.jsx`, which renders only inside `CompanyList` and `ContactSuggestions` — both legacy routes.
Net effect: the two bear replacements that shipped are on low-traffic surfaces, while the bear a prospect
actually sees (Homepage) was deferred. That deferral is your call and I am not reopening it, but the
trade-off should be explicit.

**B3 — "Barry learns" survives in at least five user-facing places.** The handoff's own Barry rule says
never use "learns". Tier 1 fixed only the `MissionControlDashboardV2` instance. Still live:

| Location | Text |
|---|---|
| `GettingStarted.jsx:108` | `Barry learns your market` |
| `GettingStarted.jsx:169` | `Barry learns` |
| `OnboardingFlow.jsx:561` | `STEP 2: Barry Learns Your Business` |
| `ReconFeedbackToast.jsx:120` | `Barry learned: {feedback.learned}` |
| `GoToWar.jsx:1456` | `This helps Barry learn your patterns.` |

`OnboardingFlow` and `ReconFeedbackToast` are both live, high-traffic onboarding surfaces. This is a Tier 1
gap, not Tier 3, and I'd treat it as the highest-priority unfinished positioning work on the branch.

**B4 — "Tinder" survives in a served public asset.** `public/social-preview-template.html:172` contains
`It's like Tinder for your ICP`, plus `public/README-SOCIAL-PREVIEW.md` and `public/SOCIAL-PREVIEW-SPECS.md`,
and `docs/scout-technical-audit.html:685`. This is Issue #556 and the handoff scoped it out, but the template
file sits under `public/` and is served.

**B5 — Automation language remains, in three places worth a decision.** `BarryOnboarding.jsx:58`
("Automatic refresh resumes Monday"), `HunterContactDrawer.jsx:1613` ("Barry will send it automatically at
the scheduled time"), `PersistentEngageBar.jsx:795` ("Barry will automatically suggest alternatives"). Unlike
"Automated outreach campaigns", these describe behavior the product genuinely performs. I would keep them and
narrow the ban to positioning claims rather than behavioral descriptions — but that is a positioning call,
not mine.

**B6 — `WhyIdynify.jsx` already holds approved on-model copy.** `src/components/auth/WhyIdynify.jsx` carries
"Know who matters" / "Barry connects the dots" / "Barry connects your conversations and activity to tell you
what's really happening", with a docstring naming the banned vocabulary list. This should be treated as the
reference implementation for Barry copy elsewhere; it is more on-model than anything Tier 1 produced.

---

## C. Tier 3 Matrix Review

The audit's mechanics are sound — I spot-checked line numbers across seven files and all resolved to the
claimed strings. The problem is the judgment layer. Three findings change the shape of the work:

> **C-α — Two of the "open questions" are already decided and shipped.**
> `ScoutMain.jsx:55` labels the surface **`Daily Discoveries`**. `ScoutMain.jsx:56` labels the other surface
> **`People`**. `mobileNavigation.js:73` groups under section `Daily Discoveries`. `AllLeads.jsx:2469`
> cross-links to `Daily Discoveries`. `scoutSubNav.test.jsx:90` asserts the strip reads
> `'Daily Discoveries', 'People', 'Saved Companies', 'Scout+'` and passes today.
> These are not renames to approve. They are renames already made, with ~14 stale references left behind.

> **C-β — The highest-concentration file is a dead route.** The handoff instructs the next team to
> "start with the highest-concentration files: `UnifiedDashboard.jsx` (20)". That file is reachable only at
> `/old-dashboard`. Starting there would spend a third of the effort on a surface no user reaches.

> **C-γ — Three files in the matrix are unreachable code.** `ICPScoring.jsx` (entries 1–9) has no import
> anywhere in `src/`. `components/scout/AddContactModal.jsx` (entries 35–37) has no import — Sniper's
> `PipelineSection.jsx` defines its own local component of the same name. `pages/Scout/ContactSearch.jsx`
> (entries 111–112) has no import. That is 14 of 149 entries on code that cannot render.

Reviewed by cluster rather than by row, per your instruction not to repeat the matrix. Every one of the 149
entries falls into exactly one cluster below.

| Current UI | Current Proposal | Team A Recommendation | Why | Confidence | Needs Aaron Decision? |
|---|---|---|---|---|---|
| `Approve & Add to Leads` (#119, MissionControl) | "Approve & Add to People" | **`Approve & Save Company`** | `handleApprove` writes `users/{uid}/companies/{id}` `status:'accepted'`. It adds zero people to anything. The current label promises contacts and delivers a saved company. Both the existing label and the proposal are factually wrong. | High | No — this is a bug fix |
| `Add to Leads` / `Add {n} to Leads` / `Save to Leads` (#42, 97, 99–101, 105–108) | "Add to People" | **`Save to People`** / **`Save {n} to People`** | Traced: writes `users/{uid}/contacts/{id}` with `record_status: suggested`. Never sets `person_type`. Same screen already says `Saved Contacts (n)` and `View All People →`, and the button's done-state is `Saved`. "Save" is the established verb; "People" the established destination. "Add" would introduce a third verb. | High | No |
| `Select contacts to add as leads` (#41, 98, 104) | "add to your people" | **`Select contacts to save`** | Names the action once. The destination is already named by the button beneath it. | Medium | No |
| `Search your existing leads & people…` / `Search all leads & people by name…` (#43–44, 102–103, 109–110) | "Search your people…" | **Accept** | It searches one collection (`contacts`). "leads & people" describes a single store as two. | High | No |
| `Daily Leads` as a surface name (#27, 47–49, 53–54, 71, 94–95, 115, 117, 120) | "Daily Discoveries" | **Ratify — finish an existing rename** | Already the shipped label in the sub-nav, mobile nav, and Scout's own cross-links, with a passing test asserting it. These are stale references, not a proposed rename. | High | No |
| `Daily Lead Insights` (#116, page heading) | "Daily Discoveries" | **`Daily Discoveries`** | The page heading currently contradicts the nav item that navigates to it. The surface holds a Companies tab and a People tab, both ICP-matched — "Discoveries" covers the mixed queue; "Matches" would too but is not what shipped. | High | No |
| `Total Leads` (#96, AllLeads stat badge) | "Total People" | **`Total People`** | The only outlier on its own screen: sibling lenses already say `All People`, sub-nav says `People`, empty states say `No Contacts Yet`. And `AllLeads` renders with `mode="basecamp"` (customers) and `mode="fallback"` (archived) — "Leads" is flatly wrong there. | High | No |
| `desc: 'My leads'` (#121, ScoutMain) | "My people" | **`My people`** | Its sibling `label` is already `People`; only the description lagged. | High | No |
| `Company Lead Score` (#40) and `contributes to the lead score` (#118) | "Company Match Score" / "match score" | **Ratify `Match Score`** | `icpScoring.js` computes a weighted **fit-to-ICP** score for a company whose `record_status` is `suggested`. Nothing is a prospect at scoring time. `CompanyCard` already carries a `This is a Match` button inches away. "Prospect Score" would name a lifecycle state the record has not reached. | High | No |
| RECON "lead scoring" (#75–77, 80–81, 89, 91, 146) | "prospect scoring" | **`match scoring`** | Same engine as the row above. RECON's own adjacent copy already reads "Barry cannot assess whether a **prospect** matches your ICP" — the noun should follow what Scout's card says. | Med-High | **Yes** — confirm Scout lands on "Match Score" first |
| RECON "prioritizes leads showing intent" (#30, 79, 85–86, 88, 90, 92, 145, 147) | "prospects" | **`matches`** — or keep "prospects" | Genuinely ambiguous. Prioritization reorders the *discovery queue* (matches), but "high-intent prospect" is idiomatic and reads better. This is the one cluster where I do not have a confident answer. | Medium | **Yes** |
| `competitor-locked leads` (#82–83, 87) | "competitor-locked prospects" | **`competitor-locked companies`** | The filter operates on companies in the Scout queue. Note `ReconModulePage.jsx:164` already says "prospects locked into competitor ecosystems" two lines away — pick one. | Medium | **Yes** |
| `worth 10x a cold lead` (#84) | "a cold prospect" | **Accept `cold prospect`** | `cold_prospect` is a literal brigade id in `brigadeSystem.js`. This is the one sentence where the CRM word is exactly right. | High | No |
| `score leads based on how well they match…` (#29) | "Prospects/Matches" | **`score companies based on how well they match your target market`** | The sentence already contains "match" — "score matches based on how well they match" is circular. The scored object is a company. | High | No |
| `refresh leads manually` (#69–70, Barry onboarding) | "refresh matches" | **`refresh your queue`** | The action re-runs company discovery into the Daily queue (`ICPSettings.jsx:552`: "new companies added to Daily Discoveries"). "Matches" names items; "queue" names what the button refreshes. | Medium | No |
| `every lead, message, and conversation` / `finding leads, qualifying prospects` (#72–73) | "prospect" swaps | **`every relationship, message and conversation`** / **`finding the right companies, qualifying prospects`** | This is Barry's greeting — a positioning surface, not a label. The relationships-central principle applies here more than anywhere in the matrix. | Medium | **Yes** — positioning copy |
| `Help Barry send better leads your way.` (#113) | "better matches" | **Accept `better matches`** | It is rejection feedback on a Scout-surfaced item. "Match" is exactly right. | High | No |
| `Loading lead insights...` (#114) | "Loading insights..." | **`Loading your queue…`** | Names what is loading. | Medium | No |
| `Lead / Contact List` / `Lead / Contact Upload` (#38–39) | "Contact List" / "Contact Upload" | **Accept** | Sibling option is `Company List Upload`; the pair should be Company / Contact. | Medium | No |
| `Confirm & Save Lead` (#46, FindContact — live) | "Confirm & Save Contact" | **Accept** | Creates a contact record. (#112, the `ContactSearch.jsx` twin, is dead code — see below.) | High | No |
| `saved to your leads` / `Go to Lead` / `View in Leads` (#122–124, ScoutPlus — live) | "your people" / "View in People" | **`saved to your People` / `View in People`** | `handleViewResults` navigates to `activeTab: 'all-leads'`, whose visible label is already `People`. Today the button names a destination that does not exist. | High | No |
| `Weekly leads enriched` / `Need more leads?` (#24–25) | "Contacts enriched" | **`Weekly contacts enriched`** | Adjacent label already reads `Daily contacts`. Low priority — `QuotaDisplay` renders only inside legacy `ContactSuggestions`. | Medium | No |
| Admin `{n} leads` / `label="Leads"` / `Total Leads` (#62–64) | "Contacts" / "People" | **`Contacts`** | Reads `recon.leadsTotal`, which counts contact docs. Internal audience, so lowest positioning risk, but consistency is cheap. | Medium | No |
| `Target lead` fallback (#93, Reinforcements) | "Target contact" | **`Referral target`** | This is a referral/introduction opportunity. The person is someone the user wants an intro to — the canonical non-sales relationship case in your §3. | Medium | No |
| `lead generation` / `Generate unlimited qualified leads` (#65–66, checkout pages) | "prospect discovery" | **Accept, but sequence it** | These are purchase-flow feature descriptions. They should match whatever Stripe product/marketing copy says, or the two will diverge. | Medium | **Yes** |
| `Select contacts and build leads` (#67) / `the better your leads` (#74) | "pipeline" / "matches" | **Accept both, deprioritize** | `GettingStarted` and `Questionnaire` are both effectively orphaned routes. | Medium | No |
| `label: 'Lead'`, person-type and brigade copy (#26, 58–61, 148–149) | Keep as Lead | **Ratify Keep — and protect** | This is the only place "Lead" is load-bearing. `person_type: 'lead'` is a real stored state with its own brigades and Barry behavior contract. Every other change must avoid colliding with it. | High | No |
| Verb usages — `Lead with value`, `lead with what has changed` (#28, 52, 55–57) | Keep | **Ratify Keep** | Verb, not noun. | High | No |
| User-language placeholders (#10, 12–13, 33–34, 50–51) | Keep | **Ratify Keep** | These are examples of the *user's* vocabulary inside their own input fields. Sanitizing them makes the placeholder less recognizable, not more accurate. | High | No |
| `Engineering Lead` job title (#45) | Keep | **Ratify Keep** | Job title. | High | No |
| `Lead nurturing` multi-select option (#32) | Keep | **Ratify Keep** | Standard CRM activity the user is self-reporting. | High | No |
| `[LEAD:QUALIFIED]` decorative (#11) | Assess removal | **`[MATCH:SCORED]`** | Decorative floating code text; cheap to make on-model. Its Homepage twin `[LEADS:TRACKING]` (#68) is **out of scope** per §10. | Medium | No |
| `UnifiedDashboard.jsx` — all 20 entries (#125–144) | Various | **EXCLUDE from Tier 3** | Routed only at `/old-dashboard` under an explicit backwards-compatibility comment; nothing links to it. | High | **Yes** — retire the route, or leave frozen? |
| `ICPScoring.jsx` (#1–9) | Match/Prospect | **EXCLUDE — dead code** | No import anywhere in `src/`. | High | **Yes** — delete? |
| `components/scout/AddContactModal.jsx` (#35–37) | "saved to your people" | **EXCLUDE — dead code** | No import. Sniper defines its own local `AddContactModal`. | High | **Yes** — delete? |
| `pages/Scout/ContactSearch.jsx` (#111–112) | "added to your people" | **EXCLUDE — dead code** | No import. Live twin is `components/scout/FindContact.jsx`. | High | **Yes** — delete? |
| `Lead Review` cluster — `LeadList`, `LeadDetail`, `NavigationBar` (#14–23) | "Contact Review" | **EXCLUDE — orphaned legacy** | `/lead-review` is reachable only by typing the URL. `NavigationBar` renders only inside `CompanyList` / `ContactSuggestions`, themselves legacy routes. Renaming polishes a screen no one reaches. | High | **Yes** — retire the cluster? |

**Net effect on scope:** of 149 entries, **41 should be excluded** (dead or legacy code), **~26 are already
ratified keeps**, leaving **~82 live strings** actually worth changing. That is roughly half the work the
handoff scoped, concentrated in about a dozen files.

---

## D. Product Surface Decisions

**1. Daily Leads → `Daily Discoveries`.** Not because it was proposed — because it already shipped. The
name is live in the Scout sub-nav, mobile nav, and Scout's own cross-links, and a passing test asserts it.
The surface holds two tabs (Companies, People), both scored against the ICP, both `record_status: suggested`.
"Discoveries" correctly covers a mixed queue where "Matches" would name only the items. Ratify and finish it;
the page heading `Daily Lead Insights` is the loudest remaining contradiction.

**2. All Leads → `People`.** Also already shipped. The screen's own lenses read `All People`, its empty
states read `No Contacts Yet`, its sub-nav entry reads `People`. Only the `Total Leads` stat badge and a
stale `desc` remain. Critically, this component is the shared people-roster renderer — `mode` of `people`,
`scout`, `hunter`, `sniper`, `basecamp`, `fallback` — so "Leads" is wrong in Basecamp (customers) and
Fallback (archived/lost) regardless of positioning.

**3. Add to Leads → `Save to People`.** The action creates a `Contact` in `suggested` state and never assigns
a relationship type. "Lead" is a real, different, stored state — so "Add to Leads" claims a lifecycle
assignment the code does not make. That is the strongest argument here, and it is a correctness argument, not
a tone one. "Save" is already the screen's verb (`Saved Contacts (n)`, done-state `Saved`); "People" is
already the destination's name (`View All People →`). Of the options you listed, `Save Contact` is the
runner-up and is the better label for the single-record case in `FindContact`.

**4. Lead scoring → `Match Score`.** Your instinct is right, and the code confirms it. `icpScoring.js`
computes a weighted **fit** score against ICP criteria for a company that the user has not kept yet.
Nothing is a prospect at that moment. `CompanyCard` already has a `This is a Match` button adjacent to
`Company Lead Score`, so the card contradicts itself today. `Prospect Score` would be semantically wrong.
Where RECON talks about *prioritization by buying intent* rather than *fit*, the answer is genuinely less
clear — see the flagged row in section C.

**5. Lead Review → retire, do not rename.** `/lead-review` is orphaned. `NavigationBar`'s "Lead Review" link
only appears inside two other legacy screens. Renaming it produces a polished screen that no user reaches
and an extra surface to keep consistent forever. Recommend a separate decision to delete the cluster
(`LeadList`, `LeadDetail`, `NavigationBar`, `CompanyList`, `ContactSuggestions`, `QuotaDisplay`,
`/old-dashboard`, `/questionnaire`) rather than folding it into a copy sprint.

**6. Scout-generated results → `Match` (the item), surfaced in `Daily Discoveries` (the surface).** Keep
these two words doing different jobs. A Match is a single scored company or person. Daily Discoveries is the
queue they arrive in. "Discovery" should never be used for a single item and "Match" should never be used
for the surface — that is the distinction that keeps `Match Score` meaningful.

**7. Stored person records → `Contact` (the record), `People` (the collection and the screen).** Already the
shipped vocabulary throughout `AllLeads`, `CompanyDetail`, `CompanyLeads`, and the Scout sub-nav.

**How they relate:** Scout surfaces **Matches** into **Daily Discoveries**. The user saves one; it becomes a
**Contact** in **People**. The Contact then carries a relationship type — **Lead**, **Customer**,
**Partner**, **Network**, or **Past Customer** — which is a separate axis from the record existing at all.
"Lead" appears exactly once in that chain, at the end, where it means something.

---

## E. Terminology Architecture

Your proposed model is close but needs one structural correction: the product does not implement a linear
`Match → Prospect → Customer` pipeline. It implements a **record with three independent status axes**, plus a
branching relationship type. And **Prospect is not a peer of Lead — it is a sub-state of Lead.**

### What the code actually does

```
PERSON — the human. Never stored as such; not a UI word.
   │
   └── CONTACT — users/{uid}/contacts/{id}. One collection. The only stored person record.
         │
         ├── record_status ....... Does this record count?
         │      suggested ........ Scout surfaced it; the user has not kept it   ← a MATCH lives here
         │      active ........... the user kept it
         │      archived / rejected
         │
         ├── person_type ......... What is this relationship?   (branches, does not sequence)
         │      lead ............. brigades: hot_prospect · warm_prospect · cold_prospect · nurture · stalled
         │      customer ......... brigade:  customer_active
         │      partner .......... brigades: partner_referral · partner_strategic
         │      network .......... brigades: network_close · network_casual
         │      past_customer .... brigade:  customer_past
         │
         └── stage ............... Which module owns the work?
                scout · hunter · sniper · basecamp · reinforcements · fallback
```

Sources: `src/constants/statusModel.js`, `src/data/brigadeSystem.js` (`PERSON_TYPES`),
`src/utils/brigadeSystem.js` (`BRIGADE_CONTRACTS`), `src/constants/stageSystem.js`.

### Three corrections to the model in your brief

**E1 — MATCH is not a state on the person. It is how the record arrived.** A Match is a Contact (or a
company) with `record_status: suggested` and a computed ICP fit score. It is a property of the *discovery
surface*, not of the human. This is why `Match Score` is right and `Prospect Score` is wrong: the score is
computed before any relationship exists.

**E2 — PROSPECT sits *inside* Lead, not before it.** `person_type: 'lead'` carries the brigades
`hot_prospect`, `warm_prospect`, `cold_prospect`. So in this codebase, "prospect" is a temperature within an
active-pursuit relationship — the reverse of the ordering in your brief, where Prospect precedes Lead.
Practical consequence: **"Prospect" should not be used as a top-level UI noun**, because it names a
sub-state, and using it broadly would make it ambiguous with the brigade the user actually sets.

**E3 — The types branch, they do not sequence.** `Customer` and `Partner` are not downstream of `Lead`.
`stageSystem.js` maps `customer → Basecamp`, `past_customer → Fallback`, `lead → Scout`, and leaves
`partner` and `network` deliberately outside the pipeline. This is exactly the relationships-central
principle from your §3 — and it is already built. Nothing in the terminology work should reintroduce a funnel.

### The model I recommend adopting

```
Scout discovery → MATCH (suggested) → saved → CONTACT (active, in PEOPLE)
                                                   │
                                                   └── relationship type:
                                                         Lead ──(brigade: hot / warm / cold prospect)
                                                         Customer
                                                         Partner
                                                         Network
                                                         Past Customer
```

Vocabulary rules that fall out of it:

| Word | Means | Never use it for |
|---|---|---|
| **People** | the collection, and the screen | a single record |
| **Contact** | the stored record | a relationship state |
| **Match** | a scored, unsaved discovery | a saved person |
| **Discoveries** | the review queue surface | a single item |
| **Lead** | `person_type: 'lead'` | "a person in the system" |
| **Prospect** | a brigade *within* Lead | a top-level UI noun |
| **Customer / Partner** | their own person types | anything upstream |

### One inaccuracy in the handoff's guardrails

The handoff's §8 lists `users/{uid}/leads` as a Firestore collection not to rename. **That collection is not
in use.** `leads` appears once as an unused constant at `src/firebase/schema.js:43`; every write path targets
`contacts`. The guardrail is still correct in spirit — but an implementer looking for a `leads` collection to
protect will not find one, and might conclude the guardrails were written from memory rather than from the
code. Worth correcting before anyone works from that document.

---

## F. Risks & Contradictions

**F1 — "People" the label vs. "Lead" the state.** Once buttons say `Save to People`, the word "Lead" survives
only as a `person_type` chip in the People screen. That is the correct outcome, but it means a user sees
"People" as a place and "Lead" as a tag — and those must never be presented as alternatives to each other.
Any copy of the form "Add to People or Leads" would break the model. Mitigation: buttons use **verbs**
(`Save`), the destination is **People**, and `Lead` appears only inside the relationship-type selector.

**F2 — URLs will contradict labels.** `?tab=daily-leads` and `?tab=all-leads` stay (correctly frozen), while
the UI says Daily Discoveries and People. This is already true today and has not caused a problem, but it
becomes visible when users share or bookmark links. Accept, and note it for a future route-migration sprint.

**F3 — RECON may promise scoring behavior that is not implemented.** `ReconModulePage.jsx`'s `feedsInto`
arrays claim "Scout prioritizes leads showing real purchase intent signals" and "Scout will deprioritize
competitor-locked leads". I did not find scoring code implementing intent or competitor-lock weighting —
`icpScoring.js` weights industry, location, employee size, and revenue only. Renaming the noun in those
sentences makes them *more* prominent without making them true. **This is a product-accuracy risk that
predates the terminology work and should be verified separately.**

**F4 — Ordering dependency between Scout and RECON.** RECON's copy describes what Scout does. If RECON starts
saying "match scoring" before `CompanyCard` says `Match Score`, RECON references a name that does not exist
on screen. Scout must land first.

**F5 — `AllLeads` is shared across six modules.** Any label change there propagates to Sniper, Basecamp, and
Fallback simultaneously. `Total People` is safe in all six; anything sales-flavored is not. Changes to this
file need a per-mode read, not a per-string read.

**F6 — Admin metrics vs. field names.** Renaming admin's `Leads` to `Contacts` while the underlying field
stays `recon.leadsTotal` is fine for users but will confuse whoever debugs it. Recommend a code comment at
each admin call site rather than leaving the mismatch bare.

**F7 — Checkout copy has an external counterpart.** `CheckoutPage` and `CheckoutSuccessPage` describe what
the customer is buying. Changing "lead generation" to "prospect discovery" in-app while Stripe product
descriptions and any marketing site still say "leads" creates a purchase-flow inconsistency that is worse
than the original wording.

**F8 — Tier 1's "learns" gap will read as inconsistency.** If Tier 3 ships while `OnboardingFlow` still says
"Barry Learns Your Business", a new user meets the banned framing on their second screen and the corrected
framing on their fifth. Fix B3 before or with Tier 3.

---

## G. Recommended Implementation Plan

Six batches, sequenced so each one is independently reviewable and independently revertable. Nothing below is
implemented, and I will not start any of it without your go-ahead.

**Batch 0 — Tier 1 completion (do this first, independent of Tier 3).**
Remove the remaining "Barry learns" instances (B3) — `GettingStarted` ×2, `OnboardingFlow`, `ReconFeedbackToast`,
`GoToWar`. ~5 strings. Closes the gap that makes everything downstream look inconsistent.
*Depends on: your call on B5 (automation language) — can proceed without it.*

**Batch 1 — Finish the renames that already shipped.**
`Daily Leads` → `Daily Discoveries` (11 live strings) and the two `AllLeads`/`ScoutMain` stragglers
(`Total Leads` → `Total People`, `desc: 'My leads'` → `'My people'`). Zero new product decisions — this only
removes contradictions with names already in the nav and already asserted by a passing test. Lowest risk in
the whole project; highest consistency payoff.

**Batch 2 — The save action.**
`Add to Leads` / `Save to Leads` → `Save to People`, plus the `MissionControl` label correction to
`Approve & Save Company`, the `Select contacts to save` subtitles, the `Search your people…` placeholders,
and the `ScoutPlus` / `FindContact` success copy. ~22 strings across `CompanyDetail`, `CompanyProfileView`,
`CompanyDetailModal`, `MissionControlDashboardV2`, `ScoutPlus`, `FindContact`. This is the batch users touch
most, and it contains the one genuine bug.

**Batch 3 — Scoring, Scout side only.**
`Company Lead Score` → `Company Match Score`; `ICPSettings` "lead score" → "match score"; the
`ReconFeedbackToast` circular sentence. ~4 strings. Must land before Batch 4.

**Batch 4 — Scoring, RECON side.**
The ~17 RECON strings, split into the *fit* group (→ match scoring, my recommendation) and the
*prioritization* group (→ your decision, per section C). **Blocked on two answers from you: the
prioritization noun, and the competitor-locked noun.** Also the right moment to check F3 — whether the
described behavior exists.

**Batch 5 — Long tail.**
Admin metrics, `CSVUpload` labels, `Reinforcements` fallback, `Questionnaire`/`GettingStarted` tips, the
`[LEAD:QUALIFIED]` decorative string, `QuotaDisplay`. ~12 strings, low traffic, low risk.
**Excludes checkout copy (F7)** until the Stripe/marketing question is settled.

**Not a batch — a separate decision.**
The dead and legacy cluster: `ICPScoring.jsx`, `components/scout/AddContactModal.jsx`,
`pages/Scout/ContactSearch.jsx`, `ScoutDashboardPage.jsx`, and the `/lead-review` + `/old-dashboard` +
`/questionnaire` routes with `LeadList`, `LeadDetail`, `NavigationBar`, `CompanyList`, `ContactSuggestions`,
`QuotaDisplay`. That is 41 matrix entries and five unreachable files. Deleting them is a bigger cleanup win
than renaming them, but it is a code-removal decision, not a copy decision, and it should not ride along with
a terminology sprint.

### Verification gate for every batch

- [ ] Build passes (`npm run build`)
- [ ] Tests unchanged at 1128 pass / 5 known failures
- [ ] `scoutSubNav.test.jsx` and `mobileNavigation.test.jsx` still pass — they assert nav labels
- [ ] No Firestore path, route path, tab `value`, analytics event, schema field, variable, function, or
      component filename touched
- [ ] Every changed string confirmed to render on a reachable route
- [ ] `Homepage.jsx` lines 91, 94, 200 untouched

---

## Open questions for you

1. **Prioritization noun** (Batch 4): "Scout prioritizes ___ showing buying intent" — matches, or prospects?
2. **Competitor-locked noun** (Batch 4): companies, or prospects? `ReconModulePage` currently uses both.
3. **The dead/legacy cluster**: delete, or freeze and leave? 41 matrix entries hang on this.
4. **Checkout copy** (F7): is there Stripe/marketing copy that has to change in step?
5. **Barry greeting rewrite** (`ReconOnboardingWizard`): positioning copy, not a label — do you want to write it?
6. **B5 automation language**: keep behavioral descriptions ("Barry will send it automatically at the
   scheduled time"), or ban the word outright?
7. **F3**: does Scout actually implement intent-based and competitor-lock prioritization? If not, RECON is
   describing unbuilt behavior and the copy needs more than a noun swap.
