# TEAM A — PHASE 2 GATE C REPORT

**Scope:** B5 (proposal + confirmation) · B6 (T-1 normalization) · B7 (website accelerator), plus two report-only traces.
**Recommendation:** **GATE C PASS**, with three findings that need an owner decision but did not block delivery.

---

## 1. Commits and branches

| Batch | Branch | Head | Base |
|---|---|---|---|
| B5 | `claude/team-a-p2-b5-proposal` | `0a55774` | `716900f` (Gate B) |
| B6 | `claude/team-a-p2-b6-normalize` | `4e52fe0` | `0a55774` |
| B7 | `claude/team-a-p2-b7-accelerator` | `b9bb8ab` | `4e52fe0` |

All pushed. Each batch is one commit and independently revertible.

**Disclosed dependency:** B7 genuinely depends on B6 (it routes website free text through T-1). **B6 does not depend on B5** — it is stacked for a linear history, not for a dependency, and reverts cleanly on its own.

**No collision.** B5 and B6 both touch `barryICPConversation.js`, for different reasons — B5 removes three title gates from its response logic, B6 replaces its three inline enumerations with one import. They are disjoint regions of the file and neither changes what the other did. Reporting the overlap rather than leaving it implicit.

---

## 2. Files changed

**B5** — 788 insertions, 70 deletions
- `src/utils/targetingProposal.js` (new) — the quality floor and the proposal builder
- `src/components/onboarding/TargetingProposal.jsx` + `.css` (new)
- `src/pages/Onboarding/BarryOnboarding.jsx` — renders the proposal; imports the shared floor; proposes proactively
- `netlify/functions/barryICPConversation.js` — three title gates become a non-blocking signal
- `src/pages/Onboarding/FirstExperience.jsx` — passes the transient goal down
- `src/test/targetingProposal.test.js` (new) — **44 tests**
- five Phase 1B test files repointed at the relocated rule (§4)

**B6** — 710 insertions, 166 deletions
- `src/constants/targetingCanon.js` (new) — one home for the three enumerations
- `src/utils/normalizeTargeting.js` (new) — T-1
- `netlify/functions/barryICPConversation.js` — **166 lines of duplicated enumeration deleted**, replaced by one import
- `src/test/normalizeTargeting.test.js` (new) — **53 tests**

**B7** — 575 insertions, 1 deletion
- `src/utils/websiteAccelerator.js` (new)
- `src/pages/Onboarding/BarryOnboarding.jsx` + `.css` — the optional website field and its handler
- `src/test/websiteAccelerator.test.js` (new) — **29 tests**

---

## 3. Before → after: the Prospecting journey

### Before

```
"Who are you hunting?"
   → free text → extraction
   → titles missing? force another turn (3 separate gates)
   → field list: Industries / Company Size / Location / Target Contacts, each "Not specified"
   → confirm disabled unless industries present
   → handleConfirm
```

Three properties of that flow contradicted locked rulings: the title gates forced questions the search does not need, the confirm gate required industries when five other fields narrow a search perfectly well, and the card asked the user to audit Barry's data model rather than agree with his reasoning.

### After

```
"What are you hoping to get done?"  (Gate B)
   → Prospecting
   → optionally: "Or give me your website and I'll do the reading."
        → analyze-website → T-1 → proposed targeting, or one short question
   → free text → extraction (unchanged prompt, unchanged validation)
   → as soon as ONE supported constraint exists, Barry proposes:

        Here's what I've got, Dana.
        You're trying to        win more commercial roofing work in Texas.
        So I'll go looking for  roofing contractors in Texas with 11-20 employees.

        What I picked up along the way
          • You pointed at Beaumont Roofing as the kind of company you want more
            of, so I'll prioritize companies that actually look like it.
          • "roofing contractors" is narrower than Construction, so I'll lead
            with it and use the broader category as a backstop.

        Where I'm less sure
          • I don't know yet who you'd want to talk to inside these companies.
            I'll ask once I've found some.

        I'll go find roofing contractors in Texas with 11-20 employees and put
        them in Scout for you to work through.

        [Let me adjust]   [That's right — go find them]

   → confirm → handleConfirm (unchanged) → D7 gate → attributed search
```

With **zero** supported constraints Barry does not propose. He asks one question — *"What kind of companies are you trying to reach? Even a rough direction helps."* — and asserts nothing about which fields are blank.

With **one** constraint he proposes and says the net is wide on purpose, rather than asking for more first.

---

## 4. Proof the Phase 1B confirmation semantics are intact

`handleConfirm` still runs, in order: `resolveActiveIcp` → **throw** on `read-failed` → write `icpProfiles/{icpId}` → `setActiveIcpProfile` → project `companyProfile/current` carrying `icpId` + `icpIdSource` → gate → `search-companies` with an explicit `icpId`. Each step is asserted by test (`targetingProposal.test.js` §5), including the ordering of the authoritative write before the projection.

**One relocation, permitted by the gate and disclosed here.** The `hasRetrievalConstraint` predicate was an inline expression inside `handleConfirm`. The proposal has to respect the same floor, and two copies of a quality floor drift — the copy that drifts being the one that lets an unfiltered search wear an ICP label. The rule now lives in `targetingProposal.js` and both read it. **The field list is byte-identical** to the Tier 3 version: `industries`, `companyKeywords`, `companySizes`, `locations`, `isNationwide`, `foundedAgeRange`; `targetTitles`, `revenueRanges` and `lookalikeSeed` remain excluded for the reasons Tier 3 established.

**Five Phase 1B test files were repointed, not weakened.** `icpFirstSearchTargeting` previously lifted the predicate out of the component source with `new Function` and eval'd it, precisely so the gate could not drift; it now **imports** the real function, which is the stronger form of the same guarantee, plus a new assertion that the component is wired to that import and carries no second copy. `reconTargetingReachability` reads the rule where it now lives and adds the same wiring assertion. The other three updated a variable name (`hasRetrievalConstraint` → `canSearch`) or the component's prop signature. Net: **+3 assertions**, none removed.

---

## 5. T-1 normalization and rejection evidence

`src/utils/normalizeTargeting.js`. Emission rule, in priority: **exact canonical match**, then a **curated alias** a human wrote and a property test proves canonical. Nothing else emits.

| Case | Input | Result |
|---|---|---|
| Exact canonical | `Accounting` | → `Accounting` |
| Case / punctuation | `hospital and health care` | → `Hospital & Health Care` |
| Common synonym | `SaaS`, `law firms`, `MSP` | → `Computer Software`, `Legal Services`, `Information Technology and Services` |
| **Unique near-match** | `manufacturing` | **asks** — offers `Electrical/Electronic Manufacturing` |
| Multiple mappings | `education`, `media`, `health` | asks, with 3+ canonical candidates |
| Unsupported | `blockchain gaming` | dropped, and named as dropped |
| Vague size language | `Mid-market`, `SMB`, `enterprise` | **asks** — offers the eleven buckets, picks none |
| Stated range | `50-200 employees` | → `21-50`, `51-100`, `101-200` |
| Region | `the Southwest`, `West Coast` | unsupported — never expanded into states |
| City + state | `Austin, TX` | → `Texas`; `Austin` dropped and named |
| Partial | `accounting and blockchain gaming` | → `Accounting`; the rest dropped |
| Empty | `''`, `null`, non-string | empty — distinct from unsupported |

**Uniqueness is deliberately not treated as evidence of correctness.** `manufacturing` contains exactly one canonical name and a user who says it almost never means electrical/electronic manufacturing, so a unique near-match still asks. This is the single most important rejection rule in the module.

**Property test:** 18 industry phrases × 12 size phrases × 12 location phrases — every emitted value is asserted to be in `APOLLO_INDUSTRIES`, `COMPANY_SIZE_OPTIONS` or `US_STATES`. A separate property test asserts every curated alias resolves to a canonical name.

**Invariants 4–10, asserted:** T-1 contains no `fetch`, no Apollo endpoint, no `icpProfiles`, no `companyProfile`, no `setDoc`/`updateDoc`/`addDoc`, no `hasRetrievalConstraint`, no `barryState`. It imports only the canonical constants.

**Canonical reuse, as instructed.** The three enumerations existed in more than one copy — industries and states inline in `barryICPConversation` *and* in `src/constants`, size buckets only inside that function. **166 lines of duplicated enumeration are deleted** and all three now come from `src/constants/targetingCanon.js`, which the function, the normalizer and the editors read. Cross-tree imports from `netlify/functions` into `src/` are already precedented (four functions do it).

---

## 6. Website → T-1 → proposal trace

```
user types "northwind.com"
   │
   ├─ POST /.netlify/functions/analyze-website { url, userId, authToken }
   │     returns 8 free-text fields + confidence 0-100, under a no-invention instruction
   │
   ├─ readWebsite(payload)
   │     recognition ← whoTheyServeTo + whatTheySell     (prose, not targeting)
   │     summary     ← icpSummary || valueProposition    (quoted, not asserted)
   │     targeting   ← normalizeTargetingText({ industry: data.targetIndustry,
   │                                            companySize: data.targetCompanySize })
   │                                          ── NO location argument ──
   │
   ├─ ≥1 supported constraint → merge (conversation wins) → step 'confirming'
   │     "I looked at Northwind Roofing. It looks like you help commercial
   │      property managers with roof replacement and maintenance.
   │      Is that still accurate?"
   │
   └─ 0 supported constraints → step 'asking', ONE question about the business
         "Roughly how big are the companies you sell to? A rough headcount is enough."
```

**Nothing not produced is claimed.** The module reads eight named fields; a test asserts it never reads `data.headquarters`, `data.employeeCount`, `data.competitors`, `data.revenue`, `data.role`, `data.teamSize` or `data.location`. **Location is never derived from a website** — asserted against copy that names a city and copy that says "nationwide coverage" — because inferring the user's market from their own address would be a fabrication.

**The user never learns translation happened.** The recognition line is asserted free of "industry", "field", "map", "normalize", "bucket" and "Apollo"; the clarification asks about headcount, not about a field that failed to map. Where the site said something unusable, that phrase appears in the proposal's *"where I'm less sure"* as *"I couldn't place 'adjacent services' against anything I can search on, so I've left it out"* — honest, and still not a form.

**It is an accelerator, not a step.** Offered once, before the conversation starts, below the conversation input; never returns; nothing is gated on it; a blocked or JavaScript-rendered site returns the friendly sentence the function already writes and drops back into the conversation. Anything established by talking beats a later read of the user's own marketing copy.

---

## 7. Proof no website-derived targeting bypasses confirmation

- `websiteAccelerator.js` contains no `setDoc`, `updateDoc`, `addDoc`, `icpProfiles`, `companyProfile`, `setActiveIcpProfile` or `search-companies`.
- The `analyzeSite` handler in `BarryOnboarding` is asserted to contain none of those, and not to call `handleConfirm`. Its only forward move is `setStep('confirming')` — which renders the proposal and waits.
- The creation event is still reachable only from `onConfirm={handleConfirm}`.
- A site yielding no supported constraint reaches `setStep('asking')`, not a proposal.

**Note on an existing write, unchanged by this batch:** `analyze-website` itself writes its extraction to `dashboards/{uid}` RECON §1 and `modules[recon].websiteAnalysis`, and stamps `websiteAnalyzed` on the user document. That is pre-existing behaviour from before this phase, it is RECON intelligence rather than targeting, and B7 did not add, remove or alter it. **No ICP, no bridge and no search results are written by any pre-confirmation path.**

---

## 8. Every search still carries explicit authoritative ICP identity

Unchanged from Phase 1B and re-asserted: `search-companies` returns `400 ICP_REQUIRED` without an `icpId`, stamps every discovered company with that id and has no `DEFAULT_ICP_ID` fallback; `handleConfirm` passes the id it just wrote; `daily-leads-refresh` skips users it cannot resolve. B5/B6/B7 add no new call site — the only `search-companies` caller they touch is `handleConfirm`, and only in that `hasRetrievalConstraint` became `canSearch`.

## 9. D7 quality-floor tests

`icpFirstSearchTargeting.test.js` (20) + `reconTargetingReachability.test.js` (23) still pass, now against the imported predicate, plus `targetingProposal.test.js` §1 (9 more):

- Each of the six supported fields **alone** permits a search.
- Titles alone, revenue alone, and a lookalike seed alone **do not**.
- Empty arrays do not count; an empty definition does not search.
- Two constraints are not treated as better than one for the purpose of starting — no count, percentage or completeness rule was added.
- `NEEDS_TARGETING` is still written, and still distinct from ERROR/SEARCHING/READY and from the three unresolved reasons.

## 10. Non-Prospecting routes remain unaffected

`firstValueRouting.test.js` (43) and `firstExperienceIntentFlow.test.jsx` (37) pass unchanged on the B7 head. Only `ROUTE_IN_PLACE` reaches `BarryOnboarding`, and only `PROSPECTING` produces `ROUTE_IN_PLACE` — asserted for every category in every workspace state. Nothing in B5/B6/B7 is reachable from a non-Prospecting route. Zero-ICP operation across those routes is unchanged.

---

## 11. Source / intelligence / entitlement — architectural check

**The principle holds today.** Nothing gates Barry's reasoning on Scout provenance.

| Concept | Where it lives now | Coupled to discovery? |
|---|---|---|
| **Source** | a `source` string on the record — `apollo_api`, `people_mode`, `manual`, `networking`, `csv` | — |
| **Intelligence** | `icpScoring.js` (Match), `barryContextAssembler`, `relationshipContext`, `compileReconForPrompt` | **No** |
| **Entitlement** | not modelled | n/a |

**Evidence:**
- `src/utils/icpScoring.js` contains **no** reference to `source`, `apollo_organization_id` or `apollo_person_id`. Match is computed from company fields whatever their origin.
- `barryContextAssembler.js` contains no Apollo or provenance reference.
- The only `source ===` comparisons that affect behaviour are in `ContactDetailModal`, and they *widen* what a manual/networking record can do (letting the user edit `company_name`) — the correct polarity. The other two decide whether to render an Apollo-specific field. Display, not reasoning.
- Manual contact creation is live (`/scout/plus` → Add Manually). CSV, business-card and LinkedIn-link import are present as **disabled "Coming Soon" tiles**.

**B5/B6/B7 introduce no coupling.** All three are on the targeting-definition side and never touch record provenance.

**The seam that already exists, and is the right one.** External retrieval — not intelligence — is what requires provenance: `searchPeople` needs `apollo_organization_id`, `barryEnrich` needs `apollo_person_id` or `linkedin_url`. Those are exactly the externally costly capabilities a future entitlement layer would govern, and they sit cleanly outside the reasoning path. A manually added or imported contact can be scored, contextualized, drafted to and reasoned about without any of them.

**Debt, reported not fixed:** `source` is a free string with no enumeration and at least six observed values (`apollo_api`, `apollo`, `apollo_people_search`, `people_mode`, `manual`, `networking`). A future entitlement design will want a declared vocabulary. Not expanded here.

---

## 12. Economic-boundary trace

```
DISCOVERY ──────► SAVE/ACCEPT ──────► CONTACT ──────► ENRICH ──────► ENGAGE
   Apollo             Apollo            (same as        Apollo         no
 companies           people             save/accept)   people      external
   search        search + match                       match/search    cost
```

| Stage | Trigger | External calls | What is retrieved | IDYNIFY credits | Cost evidence |
|---|---|---|---|---|---|
| **Discovery** | `handleConfirm`, DailyLeads refresh, `daily-leads-refresh` cron → `search-companies` | `COMPANIES_SEARCH` × 1–3 pages (`per_page: 50`); × 1–5 when `foundedAgeRange` is set | company fields only — **no people** | **none** | external cost exists, **not quantifiable from the repo** |
| **Save / accept** | swipe right in DailyLeads, when the company has `apollo_organization_id` **and** the ICP has `targetTitles` | `PEOPLE_SEARCH` ×1 (`per_page: 3`) **+ `PEOPLE_MATCH` × up to 3**, one per candidate | **person-level: name, title, email, linkedin_url, phone_numbers** | **none** | ↑ |
| **Contact** | *the same event* — there is no separate contact stage | ↑ | ↑ | **none** | ↑ |
| **Enrich (company)** | opening `CompanyDetail` when enrichment is absent or >14 days old — **automatic on mount** | `ORGANIZATIONS_ENRICH` ×1 + `PEOPLE_SEARCH` ×1 (`per_page: 3`) + `PEOPLE_MATCH` × up to 3 | company enrichment + up to 3 decision makers | **none** | ↑ |
| **Enrich (contact)** | explicit user action in `ContactProfile` → `barryEnrich` | `PEOPLE_MATCH` and/or `PEOPLE_SEARCH` (`per_page: 3`), then a Google/LinkedIn lookup, then optionally `PEOPLE_MATCH` again | one person | **none** | ↑ |
| **Engage** | `generate-engagement-message`, `barryOutreachMessage`, sequence steps | Anthropic only | — | **none** | model tokens, logged via `logApiUsage` |

### The three findings

**F-1 — contact enrichment happens at save/accept, in the background, not at an explicit enrichment step.** A swipe right fires `searchPeople`, which is **1 people search + up to 3 `PEOPLE_MATCH` calls** — `PEOPLE_MATCH` being Apollo's enrichment endpoint. Email, title, LinkedIn URL and phone numbers are retrieved and persisted at that moment. The user performed one gesture. This is the single most important boundary for a future service-level design: the costly event is a swipe, not a button labelled "enrich".

**F-2 — `deductCredits` has zero callers anywhere in the repository.** `netlify/functions/utils/creditTracking.js` defines `creditCosts` (`addCompany: 1`, `getContactName: 1`, `revealEmail: 1`, `revealPhone: 1`, `enrichCompanyFull: 10`) and a `deductCredits` function. **Nothing imports either.** The `users.credits.*` fields the Admin UI renders are written only by `stripe-webhook` on purchase. No IDYNIFY internal credit is ever deducted by any live path.

The one place credits *are* deducted is `netlify/functions/enrich-company.js` (hyphenated), which has **no caller** and returns **hardcoded fake contacts** — "Sarah Johnson", "m.chen@example.com". Dead code; not revived, per standing instruction.

**F-3 — company enrichment is automatic on page view.** `CompanyDetail` calls `enrichCompanyData` on mount when enrichment is missing or stale, spending up to 5 Apollo calls. The code's own comment acknowledges this ("it also spends an Apollo credit on a record the user may be about to reject") and guards only the `previewOnly` case.

### Cost classification, as requested

- **IDYNIFY internal credit deductions:** none on any reachable path (F-2).
- **Known external Apollo cost:** none — the repository contains no Apollo pricing. `.env.example` and `apolloConstants.js` carry endpoints and a key, no rates.
- **External cost that exists but cannot be quantified from repository evidence:** every Apollo call above. `PEOPLE_MATCH` is the enrichment endpoint and is the most likely to be metered.
- **Calls for which no cost evidence exists:** the Google/LinkedIn lookup in `barryEnrich` (`linkedinSearch.js`).

**No behaviour was changed as part of this trace.**

---

## 13. Apollo enrichment payload finding, for future B8

**Answer to the gate question: no unexpectedly expensive expansion in the request payloads. The existing one-person authorization remains sufficient — with one nuance the owner should see.**

Every `barryEnrich` payload, verbatim:

| Step | Endpoint | Body |
|---|---|---|
| 1a | `PEOPLE_MATCH` | `{ id }` or `{ linkedin_url }` |
| 1b | `PEOPLE_SEARCH` | `{ q_keywords: "<name> <company>", page: 1, per_page: 3 }` |
| 1c-retry | `PEOPLE_MATCH` | `{ linkedin_url }` |

- **No `reveal_personal_emails`.** Absent from every payload.
- **No `reveal_phone_number`.** Absent from every payload. `phone_numbers` is read from whatever the response already contains.
- **No bulk endpoint.** `bulk_match` / `bulk_people` appear nowhere in the repository.
- **No webhook or async enrichment.**
- **Scope is one person.** No fan-out across a company, a list, or a network.

**The nuance:** "at most one enrichment attempt" is not literally one HTTP call. For a single named person the chain can make **up to three Apollo calls** — an exact match, a fuzzy fallback capped at 3 results, and a re-match after a LinkedIn URL is discovered — plus one Google/LinkedIn lookup. Each step is guarded (1b only runs when there is no Apollo ID; 1c only when Apollo returned no LinkedIn URL), so the three fire together only in the worst case. It is a sequential fallback for one person, not a fan-out, and it matches the spirit of the ruling. Reporting it precisely rather than deciding on the owner's behalf; **B8 is not started either way.**

---

## 14. Build / test / lint

| | Gate B (`716900f`) | B5 (`0a55774`) | B6 (`4e52fe0`) | **Gate C (`b9bb8ab`)** |
|---|---|---|---|---|
| `npm run build` | exit 0 | exit 0 | exit 0 | **exit 0** |
| Tests passing | 1512 | 1559 | 1612 | **1641** (+129) |
| Tests failing | 5 | 5 | 5 | **5 — the same 5** |
| Lint errors | 1142 | 1142 | 1142 | **1142** |

`npm ci` still requires `--force` (android/arm-only optional dependency), as recorded since Tier 1. The 5 failures remain the pre-existing 4 × `ReconSectionEditor` (`window.matchMedia` in jsdom) and 1 × `HunterContactCard` (date-fns label). **Zero lint errors added across all three batches.**

One real defect was caught by lint during B6 and fixed before commit: deleting the inline enumerations also removed the derived `INDUSTRY_NAMES` constant used by two prompt templates. `npm run build` does not cover Netlify functions, so lint was the only signal.

---

## 15. Deviations and new findings

**Deviations**

1. **B5 modified `barryICPConversation.js`,** which Gate B told me to leave alone absent a verified defect. Three blocks forced a clarification turn when no target titles had been extracted. Titles are a *person* filter — `mixed_companies/search` never receives them — so their absence is not a reason a search cannot run, and blocking on them contradicts the locked floor and makes the authorized B5 experience impossible to deliver. They now set `missingTargetTitles` and Barry surfaces it as something he does not know yet. **The canonical validation that matters is untouched:** industries, sizes and states are still filtered against the supported sets, asserted by test.

2. **B5 replaced the confirm gate `canConfirm = hasIndustries`.** Company keywords, size, location, nationwide and founded-age all narrow a search; requiring an industry contradicts the locked floor. `ICPConfirmationCard` is left in the tree, now unused on this path — deletion is B9's.

3. **Five Phase 1B test files were edited.** Repointed at the relocated rule, net +3 assertions, none removed. Detailed in §4 because "I changed the tests" deserves more than a line.

4. **B6 is stacked on B5 without depending on it** (§1).

**New findings, reported not fixed**

5. **F-1 / F-2 / F-3** — §12.
6. **`src/constants/icpOptions.js` exports a second, incompatible size vocabulary.** `COMPANY_SIZES = ['1-10','11-50','51-200','201-1000','1000+']` — five coarse buckets — versus the eleven `COMPANY_SIZE_OPTIONS` Apollo requires. `1000+` and `201-1000` are not Apollo values. The manual ICP editors use the coarse set. **This is live drift**, and it is exactly the class of thing B6 was told to prevent. I did not unify them: they are used by different surfaces, and reconciling them changes what those editors write, which is beyond Gate C. Recommend it as a bounded follow-up.
7. **`source` is an unconstrained free string** with at least six observed values — §11.
8. **`enrich-company.js` is unreachable dead code returning fabricated contacts** — §12, F-2.

---

## 16. Nothing outside scope

No pricing, entitlement, plan check, import system, multi-tenant, LinkedIn or enrichment architecture was built. No new schema. No B8, B9 or B11. The B8 ruling was not reopened. No Phase 1B ruling reopened. The economic trace changed no behaviour.

**Recommendation: GATE C PASS.** Holding for review.
