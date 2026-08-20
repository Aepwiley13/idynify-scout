# TEAM A — PHASE 2 GATE D / D1 REPORT (B8)

**Scope:** B8 — Engagement and Preparation First Value.
**Recommendation:** **D1 PASS.**

**Branch:** `claude/team-a-p2-b8-relationship` · head `9718203` · base `b2f1559` (Gate C). Pushed.
**Files:** 1445 insertions, 37 deletions across 11 files — 4 new source files, 1 routing change, 1 shell wiring, 1 analytics addition, 3 test files, 1 debt register.

---

## 1. Exact First Value behaviour

Both intents are served **where they were asked**, about one person, from records the user already owns. Neither is a handoff.

### Engagement — a named person

> **Here's where things stand with Dana Whitfield at Acme Roofing.**
> - You last spoke about 3 months ago.
> - Runs facilities for six sites.
> - The next step you landed on was: send the Q3 maintenance quote
> - What's landed before: short direct notes
> - 3 messages out, 1 back.
>
> You'd already decided on: send the Q3 maintenance quote. That's the natural thing to pick up.
>
> **[Write to them]** [Show me everyone]

Every line is read from the contact record — `barry_memory`, `engagement_summary`, `engage_state.last_barry_session`. Nothing is inferred about the outside world. **Zero external calls.**

### Engagement — nobody named ("old clients")

Not a failed lookup: nobody was named. Barry answers with who it has been longest with, ranked by elapsed time — intelligence the platform owns — capped at three, each offered as a name to pick.

### Preparation — a named person

Same record, read for a meeting: *"Here's what I have on Sam Okafor at Acme."* The recommendation is bounded to the record — *"Going in, the thing you left open was: …"* — and with no history at all it says exactly that, rather than telling the user to pick up where they left off.

### The four honest dead ends

| Situation | Barry says |
|---|---|
| Several people match "Dana" | *"I have more than one Dana. Which one?"* — with the candidates |
| Named, not in the workspace | *"I don't have Riley Chen in your workspace."* + Add them |
| Nobody named, nothing has gone quiet | *"Who did you have in mind?"* |
| No contacts at all | routed to `ROUTE_BLOCKED` before this branch is reached |

### Suggestions are derived, never asserted

Elapsed time and stored outcome pick the recommendation: two or more unanswered messages → *change the approach*; over 180 days → *lead by acknowledging the gap*; no history → *keep it short and ask rather than pitch*.

---

## 2. Proof unsupported capabilities are not simulated

Four claim families are asserted absent across **every** snapshot the module can produce — four contact shapes × two intents, over headline, suggestion, known lines and gaps:

| Claim | Pattern asserted absent |
|---|---|
| News | `news`, `announced`, `press release`, `recently raised`, `funding round`, `in the headlines` |
| Relationship graph | `second-degree`, `mutual connection`, `who they know`, `connected to`, `introduction path` |
| Competitive intelligence | `competitor`, `competitive landscape`, `market share`, `versus their rivals` |
| Briefing | `here's your brief`, `I've prepared a brief`, `briefing document` |

Additionally: `relationshipSnapshot.js` is asserted to contain **no producer** for any of them, and the rendered component is asserted against the same four patterns. Missing fields are stated as gaps — *"I don't have their role. I don't have an email address for them."* — rather than filled in.

The Gate B tests that asserted deferral for these two intents were rewritten, not deleted; the honesty rules they protected moved down into this suite and were **strengthened** from two string checks to a matrix.

---

## 3. Existing-intelligence-first proof

- A full snapshot uses **zero** external calls: `enrichmentWouldHelp(DANA, { wants: 'draft' })` is `false` for a complete record, asserted alongside a snapshot carrying more than three known lines.
- `relationshipSnapshot.js` and `findNamedPerson.js` contain no `fetch(`, no `barryEnrich`, no `APOLLO_ENDPOINTS`, no `.netlify` — asserted.
- **Ordering is asserted in the source:** `const snapshot = buildSnapshot(...)` appears before `const gap = enrichmentWouldHelp(...)`. The answer is built first; retrieval is considered afterwards, if at all.
- The person lookup uses the **local** `peopleService.searchPeople` (Firestore, bounded at 500) — asserted not to be the Apollo-backed `searchPeople` function of the same name.
- The enrichment button does not exist unless the check passes, and the handler refuses again if reached — both asserted.

---

## 4. Every external call reachable from B8

| Call | Kind | When | Cost |
|---|---|---|---|
| `peopleService.searchPeople(uid, term)` | **Firestore read**, ≤500 docs | on mount, when a name was given | internal |
| `peopleService.loadPeopleForLens(uid,'all',{pageSize:200})` | **Firestore read**, ≤200 docs | on mount, only when nobody was named | internal |
| `POST /.netlify/functions/barryEnrich` | **Apollo**, one person | only on an explicit press, only when the gap check passes | external |

Asserted: the set of `/.netlify/functions/...` endpoints referenced anywhere in the component is exactly `['barryEnrich']`.

**Deliberately not wired: the calendar.** `calendar-list-events` exists and would let Preparation name the user's upcoming meetings. It is a second integration probe with its own failure mode, and the accepted acceptance floor for Preparation is contact and company context — *"assembled, not a purpose-built briefing"*. Skipped, and reported rather than half-built.

---

## 5. Maximum Apollo calls for one First Value interaction

**Zero**, unless the user presses the lookup button.

If they do, `barryEnrich` runs its existing chain for that one person: **at most 3 Apollo requests** (`PEOPLE_MATCH` by id or LinkedIn → `PEOPLE_SEARCH` `per_page: 3` → `PEOPLE_MATCH` re-run after a LinkedIn discovery) plus **1 Google/LinkedIn lookup**. Each step is internally guarded, so all three fire only in the worst case. This matches the Gate C finding exactly; B8 adds no call and changes no payload.

**The button appears at most once per interaction**, and `enriching` blocks re-entry.

---

## 6. Proof there is no fan-out

- The request body sends `contact: { … }` — **one object**. Asserted: the handler contains no `contacts:`, no `.map(`, no `forEach`, no `for (`.
- Exactly **one** `fetch(` in the handler.
- **No enrichment on mount.** The mount effect is asserted to contain no `fillTheGap`, no `barryEnrich`, no `fetch(`.
- **The quiet list is inert.** `rankByQuiet` and everything after it is asserted free of `fetch(`, `barryEnrich` and `logEvent` — surfacing three people who have gone quiet enriches none of them.
- **The candidate list is inert.** Asserted that `candidates.map` is not wired to `fillTheGap`.
- No company sweep, no network sweep, no bulk endpoint, no phone-reveal flag — B8 adds no payload of its own.

---

## 7. Behaviour when enrichment fails

The snapshot is built from `contact`, not from the lookup, so a failure leaves the answer standing. Barry says so: *"That lookup didn't come back. Everything above still holds — it's just what I already had."*

The handler `catch`es rather than throwing to an error boundary, and `finally` clears the busy state. `ENRICHMENT_FAILED` is recorded with a reason (`request_failed` or `no_data`).

**Success is measured against the ask, not against the response.** A lookup that returns a job title when the ask was an address is recorded as a failure and told to the user as one — *"I couldn't turn up an address for them."* Recording it as a win would make the cost data say the opposite of what happened.

---

## 8. Behaviour when no Apollo identifiers exist

`enrichmentWouldHelp` returns `{ helpful: false, reason: 'no-identifier' }` and the button never renders. Searching by name alone for a contact the user already owns is speculative spend on a record we cannot confidently match — so it is not offered, rather than offered and likely wasted.

The snapshot is unaffected: a record with no identifiers and a full history produces the full answer.

---

## 9. Behaviour for manually created and user-owned contacts

Asserted across five provenances — `manual`, `networking`, `csv`, `apollo_api`, and **no source field at all** — that the same record produces the same snapshot, the same suggestion, and the same lookup result.

**No branch reads a source field.** All three B8 files are asserted free of `.source`, `source ===`, `apollo_api` and `people_mode`.

A manually created contact with a full history gets the **complete** answer and is simply never offered a lookup — because there is no identifier to look up against, not because of where it came from. That is the freemium principle holding in code: what varies is IDYNIFY-funded retrieval, not whether Barry is allowed to think.

---

## 10. Proof zero ICP remains valid

All three B8 files are asserted free of `resolveActiveIcp`, `icpProfiles`, `icpId`, `DEFAULT_ICP_ID`, `getActiveIcpId` and `hasRetrievalConstraint`. `buildSnapshot` takes no ICP input at all, which is the strongest form of the guarantee.

`ROUTE_RELATIONSHIP` is a **new kind**, deliberately not `ROUTE_IN_PLACE`: the Gate B assertion that only Prospecting can reach the ICP conversation is written against that kind, and relationship work must never widen it. Asserted that both intents produce `ROUTE_RELATIONSHIP` and that `reachesIcpConversation` is false for both.

---

## 11. Tests, build, lint

| | Gate C (`b2f1559`) | **D1 (`9718203`)** |
|---|---|---|
| `npm run build` | exit 0 | **exit 0** |
| Tests passing | 1641 | **1706** (+65) |
| Tests failing | 5 | **5 — the same 5** |
| Lint errors | 1142 | **1142** |

New: `relationshipFirstValue.test.js` — **59 tests**. Updated: `firstValueRouting.test.js` (43 → 47), `firstExperienceIntentFlow.test.jsx` (37 → 39). `npm ci` still requires `--force`. The 5 failures remain the pre-existing 4 × `ReconSectionEditor` and 1 × `HunterContactCard`.

---

## 12. Deviations and findings

**Deviations**

1. **Three Gate B tests were rewritten.** They asserted `ROUTE_DEFERRED` for Engagement and Preparation — the exact behaviour B8 was authorized to replace. The honesty rules they protected were moved into §2 and strengthened from two string checks to a four-family matrix over every producible snapshot. Net across the suite: **+6 assertions**.

2. **`ROUTE_RELATIONSHIP` is a new route kind.** Reusing `ROUTE_IN_PLACE` would have been smaller but would have widened the set of decisions that can reach the ICP conversation — the one thing Gate B's strongest assertion is written against.

3. **The calendar is not wired** — §4, with the reason.

**Findings**

4. **A real bug, caught because a test masked it.** The first version of the quiet list called `searchPeople(uid, '  ')`; that function short-circuits to `[]` below two characters, so the list would have been silently and permanently empty. The mounted test passed anyway because the mock ignored the term. Fixed to a bounded `loadPeopleForLens` read, and the mock was tightened to reproduce the real short-circuit.

5. **`barryEnrich` returns `enrichedData` on success regardless of whether it found anything useful.** B8 does not treat that as success — §7. Worth knowing for ECON-1: a naive success metric on this endpoint would overcount.

**Debt recorded, not fixed** — `docs/audits/TEAM_A_PHASE2_DEBT_REGISTER.md`: **ECON-1** (retrieval/entitlement boundary, with the five expensive-action candidates classified for future decision), **DATA-1** (ICP size vocabulary drift, with a three-decision bounded reconciliation recommendation), **DATA-2** (source vocabulary, eleven observed values), **CLEANUP-2** (`enrich-company.js`, unreachable, fabricated contacts, and the only code that deducts credits).

---

## 13. Nothing outside scope

No pricing, plans, credit rules or entitlement flags. No plan checks. No import system. No schema change. No B9 deletion. No B11 analytics beyond the three enrichment events B8 needs to satisfy its own instrumentation requirement — and those are additive to `EVENTS`, which B11 will extend rather than replace. Provenance is not a prerequisite for anything. Existing enrichment behaviour elsewhere in the product is unchanged.

**Recommendation: D1 PASS.** Holding for review before B9.
