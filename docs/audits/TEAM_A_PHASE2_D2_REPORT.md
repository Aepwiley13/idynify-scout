# TEAM A — PHASE 2 GATE D2 REPORT (B9)

**Scope:** B9 — legacy First-Experience cleanup.
**Recommendation:** **GATE D2 PASS.**

---

## 1. Branch and commit

`claude/team-a-p2-b9-cleanup` · head **`125c482`** · base `d712da9` (D1/B8). Pushed.
**1257 deletions, 320 insertions** across 8 files — a net removal of 937 lines.

## 2. Files deleted

| File | Lines | Proof before deletion |
|---|---|---|
| `src/pages/Onboarding/OnboardingFlow.jsx` | 743 | §4 |
| `src/components/onboarding/ICPConfirmationCard.jsx` | 187 | §5 |
| `src/components/onboarding/ICPConfirmationCard.css` | 301 | §5 |

## 3. Files modified

| File | Change |
|---|---|
| `src/App.jsx` | removed the dead `ImprovedScoutQuestionnaire` import (imported, never rendered) |
| `src/constants/icpOptions.js` | `COMPANY_SIZES` now re-exports the canonical vocabulary (§9) |
| `src/test/matchCoverageAttribution.test.js` | removed the five rows whose subject was deleted (§15) |
| `src/test/legacyOnboardingRetired.test.js` | **new** — 24 tests |
| `docs/audits/TEAM_A_PHASE2_DEBT_REGISTER.md` | DATA-1 updated; CLEANUP-3 and CLEANUP-4 added |

---

## 4. Route / reachability proof — `OnboardingFlow`

Taken **before** deletion:

```
$ grep -rn "OnboardingFlow" src/ netlify/ --include=*.js --include=*.jsx \
    | grep -v "pages/Onboarding/OnboardingFlow.jsx:"
src/test/matchCoverageAttribution.test.js:71,94,108,120,134   ← source-reading assertions
src/test/firstExperienceResume.test.js:185                    ← asserts absence
src/test/resolveWho.test.js:133                               ← comment
src/test/firstExperienceRouting.test.js:6,53                  ← comment; asserts absence
src/pages/Onboarding/FirstExperience.jsx:6                    ← comment
```

**Zero production imports. Zero JSX usages. Zero route elements.** Every hit was
a test reading the file as text, a test asserting its absence, or a comment.

Now asserted permanently: no file under `src/` (excluding tests) matches
`import OnboardingFlow` or `<OnboardingFlow`, and `App.jsx` contains the string
nowhere.

**Compatibility preserved.** All four legacy URLs still redirect, asserted
individually:

```
/onboarding/flow             → <Navigate to="/onboarding" replace />
/onboarding/recon            → <Navigate to="/onboarding" replace />
/onboarding/barry            → <Navigate to="/onboarding" replace />
/onboarding/company-profile  → <Navigate to="/onboarding" replace />
```

Retiring a component is not the same as breaking an address someone bookmarked.
`/onboarding` still resolves to `FirstExperience`, asserted.

## 5. Reachability proof — `ICPConfirmationCard`

```
$ grep -rn "ICPConfirmationCard" src/ --include=*.jsx --include=*.js --include=*.css \
    | grep -v "components/onboarding/ICPConfirmationCard"
(no output)
```

**Zero references of any kind** — no import, no JSX, no CSS class reference, not
even in a test. Gate C replaced it with `TargetingProposal` and B9 confirmed no
other surface had picked it up.

Asserted after deletion: both files are gone, no source file contains the
string, and the replacement is still wired — `BarryOnboarding` renders
`TargetingProposal` with `onConfirm={handleConfirm}`.

## 6. Proof the four smart questions no longer participate

| Field | Where it lived | Now |
|---|---|---|
| `excludedIndustries` | `OnboardingFlow.jsx:412` only | gone with the file |
| `idealCustomerTypes` | `OnboardingFlow.jsx:411` only | gone with the file |
| `perfectCustomer` | `OnboardingFlow.jsx:414` only | gone with the file |
| `valueProposition` | `ImprovedScoutQuestionnaire.jsx` (unroutable) | see below |

The first three had **zero consumers** anywhere before deletion — verified
against `src/`, `netlify/`, `reconSectionMap.js`, `src/schemas/` and
`src/firebase/`. Asserted: no source file contains any of the three.

**`valueProposition` needed a sharper rule.** A field of the same name survives
in two legitimate places that ask nobody anything: the website accelerator reads
it from `analyze-website`'s output (B7), and RECON's `AlignmentBrief` displays a
stored value. So the assertion is not "the string is absent" but **"nothing
collects it"** — no `handleInputChange('valueProposition')`, no
`answers.valueProposition`, no `name="valueProposition"` in any file. The one
component that did is unroutable (`/scout-questionnaire` redirects to Mission
Control) and its dead import was removed from `App.jsx`.

Separately asserted: none of the four appears in `FirstExperience.jsx`,
`BarryOnboarding.jsx`, `TargetingProposal.jsx` or `RelationshipFirstValue.jsx`.

## 7. Proof historical stored values are untouched

- No file matches `deleteField()` near any of the three retired RECON fields.
- No file matches `migrateRecon`, `rewriteRecon` or `backfillRecon`.
- No read-time reinterpretation exists on the targeting path (§9).
- **All five compatibility flags asserted still present:** `onboardingComplete`
  and `onboarding.completed` in `App.jsx`'s redirect decision;
  `onboardingComplete: true`, `onboardingSource: 'barry_onboarding'`,
  `hasSeenMCWelcome: false` and `barryState:` in `handleConfirm`.

B9 deleted **code**. It wrote nothing, migrated nothing, and read nothing from
any user's data.

---

## 8. `icpOptions.js` consumer / writer trace

| Question | Finding |
|---|---|
| **Consumers of `COMPANY_SIZES`** | exactly one — `src/components/ICPStep2.jsx:4` |
| **Writers using those values** | exactly one — `ICPBuilder.jsx:65`, `setDoc` to `users/{uid}/icp` |
| **UI logic assuming coarse buckets** | none. `ICPStep2` maps the array into a responsive grid and renders `{size}` + "employees". Eleven buttons render as well as five; no index, count or width assumption exists |
| **Would changing the constants reinterpret stored values?** | **No** — see below |

**Why no reinterpretation is possible.** `users/{uid}/icp` has exactly one
reader: `CompanyList.jsx:34`, which passes `icpData.companySizes` to
`callNetlifyFunction('apolloCompanyLookup', …)`. **`apolloCompanyLookup` does
not exist** in `netlify/functions/`. The coarse values therefore never reached
Apollo, never reached `icpProfiles`, and never reached the compatibility bridge.
Changing what the editor *offers* cannot change the meaning of anything already
stored, because nothing consumes the stored meaning.

The other three `icpOptions` exports (`INDUSTRIES`, `TARGET_TITLES`,
`TERRITORIES`) are used by `ICPStep1/3/4` and were **not touched** — only the
size vocabulary was in scope.

## 9. DATA-1 reconciliation performed

`icpOptions.js` no longer defines a size vocabulary:

```js
export { COMPANY_SIZE_OPTIONS as COMPANY_SIZES } from './targetingCanon.js';
```

**Every newly created or edited targeting definition now uses the canonical
eleven buckets** — the same vocabulary D7 gates on, T-1 emits, and Apollo's
`organization_num_employees_ranges` accepts.

Asserted: `COMPANY_SIZES` equals `COMPANY_SIZE_OPTIONS`; every value an editor
can now write is `MATCHED` by `normalizeCompanySize` and round-trips to itself;
none of `'11-50'`, `'51-200'`, `'201-1000'`, `'1000+'` is offered anywhere; and
`icpOptions.js` contains one definition rather than two.

## 10. Remaining DATA-1 debt — Category 2

Documents already written under the coarse vocabulary still hold `'11-50'`,
`'51-200'`, `'201-1000'` or `'1000+'` at `users/{uid}/icp`. **Not migrated, and
not reinterpreted on read** — asserted across every file on the targeting path.

Two owner decisions remain, recorded in the debt register:

1. **Whether to convert at all.** Nothing currently misbehaves because of these
   values — their only reader calls a function that was never built.
2. **How, if so.** A read-time mapping is lossless in one direction
   (`'11-50'` → `'11-20'` + `'21-50'`); a write-time migration is not required
   for correctness. Neither should ride along with unrelated work.

---

## 11. Build

`npm run build` — **exit 0**. (`npm ci` still requires `--force`, as since Tier 1.)

## 12. Tests

**1729 passing · 5 failing · 74 files.**

The 5 failures are the same pre-existing ones carried since Tier 1:
4 × `ReconSectionEditor.test.jsx` (`window.matchMedia is not a function` under
jsdom) and 1 × `HunterContactCard.test.jsx` (a date-fns label).

New: `legacyOnboardingRetired.test.js` — **24 tests**.
Reduced: `matchCoverageAttribution.test.js` — 5 assertions removed (§15).

## 13. Lint

| | D1 (`d712da9`) | **D2 (`125c482`)** |
|---|---|---|
| Problems | 1224 | **1219** |
| Errors | 1142 | **1139** |
| Warnings | 82 | **80** |

**Three fewer errors and two fewer warnings** — the deleted files carried them.
This is the first batch in Phase 2 to move the baseline in the right direction;
every prior batch held it exactly flat.

## 14. Debt-register update

`docs/audits/TEAM_A_PHASE2_DEBT_REGISTER.md` is current through B9:

- **ECON-1** — unchanged, open. Gate C/D1 evidence preserved in full.
- **DATA-1** — **new writes reconciled**; the full trace and the remaining
  Category 2 stored-value decision recorded.
- **DATA-2** — unchanged, open. `source` remains an unconstrained string.
- **CLEANUP-2** — unchanged, open. `enrich-company.js` not revived.
- **CLEANUP-3 — new.** The `/icp` → `/icp-brief` → `/companies` Module 1–5
  cluster is routed and reachable but calls five Netlify functions that do not
  exist (`apolloCompanyLookup`, `generateICPBrief`, `apolloContactEnrich`,
  `apolloContactSuggest`, `learningEngine`). A user can complete the ICP builder
  and the brief generation then fails; `/companies` fails outright. It is the
  only remaining writer of ICP-shaped targeting outside the canonical path.
- **CLEANUP-4 — new.** Four orphaned components with zero importers:
  `OnboardingStep.jsx`, `ReconOnboardingWizard.jsx/.css`,
  `ImprovedScoutQuestionnaire.jsx`, and `barry-phase1-discover.js` — the last
  being a Netlify-style handler living under `src/components/` that carries a
  **fourth** company-size vocabulary of its own.

## 15. Deviations and findings

**Deviations**

1. **Five assertions were removed from `matchCoverageAttribution.test.js`.**
   `OnboardingFlow` was one of four surfaces displaying Match, and the Tier 2
   invariant was asserted per surface. With the surface deleted there is nothing
   to assert — so the rows were removed rather than repointed. **The invariant
   itself is unchanged and still asserted for all three remaining surfaces**
   (`SavedCompanies`, `CompanyDetail`, `MissionControlDashboardV2`), and B9 adds
   24 new assertions. Net across the suite: **+19**.

2. **`ImprovedScoutQuestionnaire.jsx` was not deleted**, only its dead import.
   B9 authorized deleting `OnboardingFlow` and `ICPConfirmationCard` by name;
   the questionnaire is unroutable, so the required outcome — the field is not a
   First Experience question — is already met. Recorded as CLEANUP-4 rather than
   deleted unasked.

3. **`OnboardingStep.jsx` and `ReconOnboardingWizard.jsx/.css` were not deleted.**
   Both are unreachable orphans of the same retirement, neither was named.
   Recorded as CLEANUP-4.

**Findings**

4. **The `/icp` MVP cluster is dead at runtime** — CLEANUP-3. Found while
   tracing whether the DATA-1 change could reinterpret stored values. It is the
   reason that change is provably safe, and it is a real user-facing break that
   predates this phase.

5. **A fourth company-size vocabulary exists** in `barry-phase1-discover.js`,
   including a `'1000+' → '1001-10000'` mapping. Unreachable, so harmless —
   recorded rather than edited, since silently touching an unreachable file is
   how a fifth copy gets made.

6. **Four of my own assertions were too blunt on first run** and caught real
   things: `AlignmentBrief` reading `valueProposition` for display, the word
   "Backfilling" in an unrelated comment, my own comment naming the retired
   buckets, and the stale vocabulary in `barry-phase1-discover.js`. Each was
   narrowed to the property that actually matters rather than relaxed.

**Hard boundaries — none crossed.** No Phase 1B ICP identity rule, no D7, no T-1
semantics, no B8 Engagement behaviour, no Apollo enrichment, no save/swipe
enrichment, no CompanyDetail auto-enrichment. No credit system, pricing,
entitlements, freemium, import architecture, multi-tenancy or social ingestion.
**B11 not started. Phase 3 not started.** No historical stored data deleted.

---

**Recommendation: GATE D2 PASS.**
