# TEAM A — PHASE 2 DEBT REGISTER

Recorded, not fixed. Each item names what is true today, why it was not changed
inside the batch that found it, and what a bounded fix would have to decide.

---

## ECON-1 — External Retrieval / Entitlement Boundary Audit

**Status:** open. Owner-authorized as a follow-up during Gate D.

The economically meaningful events are not aligned with explicit user actions.
Evidence gathered in Gate C (`TEAM_A_PHASE2_GATE_C_REPORT.md` §12):

| Candidate action | What it costs today | Aligned with an explicit user action? |
|---|---|---|
| Company discovery | `COMPANIES_SEARCH` × 1–3 pages (× 1–5 with an age filter) | Yes — confirming targeting, or a refresh |
| People search | `PEOPLE_SEARCH` (`per_page: 3`) | **No** — fires on a swipe |
| People match / enrichment | **`PEOPLE_MATCH` × up to 3** per accepted company | **No** — fires on the same swipe |
| Automatic company-detail enrichment | `ORGANIZATIONS_ENRICH` + `PEOPLE_SEARCH` + `PEOPLE_MATCH` × 3 | **No** — fires on page view |
| Explicit contact enrichment | up to 3 Apollo calls + one Google/LinkedIn lookup | Yes — a button |

**ECON-1 must eventually classify each as** core/free reasoning · user-triggered
retrieval · included paid retrieval · metered/premium retrieval.

**Not now:** no pricing, no plans, no credit rules, no entitlement flags.

**Supporting facts.** `deductCredits` has zero callers anywhere in the
repository; the only code that deducts credits is `netlify/functions/enrich-company.js`,
which is unreachable (CLEANUP-2). No Apollo pricing exists anywhere in the
repository, so no external cost figure in any of the above is quantifiable from
repository evidence.

**First instrumentation landed in B8.** `ENRICHMENT_ATTEMPTED` /
`_SUCCEEDED` / `_FAILED` record whether a lookup was tried, on what kind of
identifier, and how it came out — for the First Experience surface only. That
is a start on measurement, not a boundary.

---

## DATA-1 — ICP size vocabulary drift

**Status:** open. Bounded reconciliation recommendation below.

Two incompatible company-size vocabularies are live:

| Source | Values | Used by |
|---|---|---|
| `src/constants/targetingCanon.js` → `COMPANY_SIZE_OPTIONS` | 11 buckets, `'1-10'` … `'10,001+'` | `barryICPConversation` validation, T-1, Apollo `organization_num_employees_ranges` |
| `src/constants/icpOptions.js` → `COMPANY_SIZES` | 5 buckets, `'1-10','11-50','51-200','201-1000','1000+'` | the manual ICP editors |

`'11-50'`, `'51-200'`, `'201-1000'` and `'1000+'` are **not Apollo values**. A
user who sets company size in the manual editor can therefore write a value that
the conversational path would have rejected, and that Apollo will not accept as
a range.

**Deliberately not silently normalized during B6.** Unifying them changes what
the editors write, which is a schema-affecting behaviour change outside Gate C's
authorization — and a silent normalization would have rewritten stored user
targeting without anyone deciding to.

**Bounded reconciliation recommendation.** Three decisions, in order:

1. **Make `COMPANY_SIZE_OPTIONS` the single vocabulary** and point the manual
   editors at it. The coarse set has no consumer that requires it, and the fine
   set is the one Apollo actually accepts.
2. **Decide what happens to already-stored coarse values.** A read-time mapping
   is defensible and lossless in one direction (`'11-50'` → `'11-20'`,`'21-50'`);
   a migration is not required for correctness and should not be bundled with
   the vocabulary change.
3. **Assert it once.** A test that every value any editor can write is in
   `COMPANY_SIZE_OPTIONS` prevents the third copy from appearing.

Scope estimate: one batch, no schema migration, no new UI.

---

## DATA-2 — Source vocabulary

**Status:** open. Preserve current behaviour.

`source` on a contact or company is an unconstrained free string. Observed
values, from the repository: `apollo_api`, `apollo`, `apollo_people_search`,
`people_mode`, `manual`, `networking`, `csv`, `barry_onboarding`,
`barry_onboarding_confirmed`, `website_accelerator`, `icp_auto`.

Nothing gates reasoning on it today, and B8 asserts that the relationship path
reads no source field at all — so the drift is harmless *now*. It stops being
harmless the moment provenance is used to decide entitlement, because
`apollo` and `apollo_api` would be two different answers to the same question.

**Future provenance/entitlement work should establish a declared vocabulary**
before reading the field for anything other than display. No change now.

---

## CLEANUP-2 — Dead enrichment path

**Status:** open. Flagged for deletion through normal cleanup discipline.

`netlify/functions/enrich-company.js` (hyphenated — distinct from the live
`enrichCompany.js`):

- **No caller.** Nothing in `src/` or `netlify/` references it.
- **Returns fabricated contacts** — hardcoded "Sarah Johnson",
  "m.chen@example.com", "+1-555-0103" presented as enrichment results.
- **Is the only code in the repository that deducts credits**, which makes
  reading the credit system misleading: it looks wired when it is not.

**Do not revive it.** Delete through normal cleanup. It is not part of B9's
legacy-onboarding scope, so it needs its own line rather than being swept in.
