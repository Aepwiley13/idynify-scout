# TEAM A — PHASE 2 GATE B REPORT

**Scope:** B3a (transient intent classification) + B4 (intent → First Value routing).
**Recommendation:** **GATE B PASS.**

---

## 1. Branches and commits

| Batch | Branch | Head | Base |
|---|---|---|---|
| B3a | `claude/team-a-p2-b3a-intent` | `6cb5f4b` | `5b885a7` (B10, which stacks B1 + B2) |
| B4 | `claude/team-a-p2-b4-routing` | `15ccf75` | `6cb5f4b` |

Both pushed. Stacking is a dependency, not a collision: B4 imports B3a's contract module, and B3a imports B1's shell. No two batches modify the same lines for different reasons.

**Deviation from the batch table, disclosed:** the plan put the opening question in B3a and routing in B4. Both live in B4. Shipping the question without the routing would have produced one commit in which a Prospecting user answers "What are you hoping to get done?" and is then immediately re-asked "Who are you hunting?" by the unchanged conversation — an intermediate state worse than either side of it. B3a is therefore the classification *capability* (contract + endpoint + tests, no user-visible change); B4 is where the user meets it. Revert semantics are preserved: reverting B4 restores the single default branch, reverting B3a removes an endpoint mode nothing calls.

---

## 2. Reachable callers and the routing map

### Before

```
/onboarding → FirstExperience → BarryOnboarding → barryICPConversation
```

One branch. The first question was "Who are you hunting?", which presumes the user came to prospect.

### After

```
/onboarding → FirstExperience
                │
                ├─ WHO      (B1, unchanged: one skippable question, never a gate)
                │
                ├─ INTENT   barryMissionChat  { firstExperience: true }
                │              └─ Haiku, one call, no dashboard/RECON/ICP read
                │
                └─ FIRST VALUE
                     ├─ PROSPECTING   → BarryOnboarding → barryICPConversation   (in place, unchanged)
                     ├─ EXPLORATION   → /mission-control-v2
                     ├─ COMMUNICATION → /hunter?tab=replied      | /settings if no mailbox
                     ├─ OUTREACH      → /hunter?tab=all
                     ├─ PIPELINE      → /hunter?tab=today
                     ├─ REFERRAL      → /hunter?tab=all          (+ explicit no-graph statement)
                     ├─ ENGAGEMENT    → deferred, stated honestly (B8)
                     ├─ PREPARATION   → deferred, stated honestly (B8)
                     └─ UNCLEAR       → one clarifying question
```

**`barryICPConversation` callers: still exactly one** — `BarryOnboarding.jsx:195`. Unchanged in both diffs (`git diff 5b885a7 15ccf75 -- netlify/functions/barryICPConversation.js src/pages/Onboarding/BarryOnboarding.jsx` is empty).

**Destinations verified as existing surfaces**, not invented ones: `/mission-control-v2` is where `BarryChatPanel` calls `barryOrientationBrief`; `/hunter`'s `TAB_MAP` (`HunterMain.jsx:140`) accepts `replied`, `today` and `all` — respectively "contacts who have responded", "due follow-ups & priority contacts", and the engagement card feed where a message is drafted; `/settings` is where `handleConnectGmail` lives.

---

## 3. Where classification happens, and why not where the plan first put it

The plan §5 placed classification inside `barryICPConversation`. The B3 collision trace found that additive at the response level and wrong at the semantic level, and the owner accepted the finding. Implemented as ruled:

- Classification runs in **`barryMissionChat`**, on a new `firstExperience` request flag. No existing caller sends it, so every established path in that function is unreachable from the new branch.
- The branch is placed **before** the dashboard read, `compileReconForPrompt`, `buildCapabilityBlock` and the opening-brief/ICP-mode fork — after `verifyAuthToken`. Deciding what someone meant needs none of that context, and a first turn is where latency is least affordable. Reading a workspace to infer intent would also be backwards: intent comes from the user, not from their data.
- The classifier prompt carries **no targeting vocabulary** — no `INDUSTRY_NAMES`, no `APOLLO_INDUSTRIES`, no size buckets, no state list, and it never asks for `industries`, `companySizes`, `locations` or `targetTitles` back. Asserted by test.
- **Non-Prospecting intent never invokes ICP extraction to determine routing.** Classification precedes endpoint selection entirely.

---

## 4. Classification contract

`src/utils/firstExperienceIntent.js` — pure, no network, no persistence.

**Nine internal categories:** `EXPLORATION`, `COMMUNICATION`, `OUTREACH`, `PIPELINE`, `ENGAGEMENT`, `PREPARATION`, `REFERRAL`, `PROSPECTING`, `UNCLEAR`.

**User-facing shape:** one open question — *"What are you hoping to get done?"* — and free text. Not nine buttons; the category names never reach the screen, asserted for every intent in every workspace state.

**Response, after normalization:**

```
{ intent, secondaryIntent, confidence, needsConfirmation, restatement, clarifyingQuestion, subject }
```

**Rules the contract enforces on untrusted model output:**

| Rule | Behaviour |
|---|---|
| Unknown label, wrong type, missing | → `UNCLEAR` |
| `confidence` out of range or non-numeric | clamped to `0..1`, nonsense → `0` |
| `confidence < 0.6` | `needsConfirmation` — Barry restates instead of acting |
| Secondary equal to primary, or unreadable | dropped; not a compound intent |
| Free text | bounded (restatement 400, subject 120) before it reaches state |
| Classifier unreachable, timed out, unparseable | → `UNCLEAR`, which asks |

**The asymmetry, stated deliberately:** nothing unreadable ever becomes `PROSPECTING`. A wrong question costs one turn; a wrong ICP costs a workspace. Asserted directly (`firstValueRouting.test.js` §4, §5).

**Prompt-level guards:** the classifier is instructed that Prospecting means people the user does *not* already know, that a named existing relationship is never Prospecting, that a tie involving Prospecting resolves the other way or to `UNCLEAR`, and that it must not imply knowledge of the user's contacts, inbox, calendar or market — it is reading one sentence.

---

## 5. Behaviour per intent

Each row is covered by at least one routing test and one mounted end-to-end test driven through the real UI.

| Intent | Example turn | Precondition | Outcome |
|---|---|---|---|
| **Exploration** | "just having a look around" | none | Mission Control; the orientation brief reports real platform state and is correct at zero ICP |
| **Communication** | "anyone written back?" | mailbox connected **and** someone to hear from | the replies view |
| " | " | no mailbox | *"I'll need access to your email before I can read what's waiting"* → `/settings` |
| " | " | mailbox, no contacts | states which half is missing, offers a real alternative |
| **Outreach** | "I need to email Dana at Acme" | ≥1 contact | engagement feed, naming the person |
| " | " | none | *"There's nobody in your workspace yet"* + find-people / look-around |
| **Pipeline** | "where do things stand with my deals" | ≥1 contact | due follow-ups and what has gone quiet |
| **Referral** | "could Sam introduce me to someone at Acme" | ≥1 contact | drafting path for the named person, **plus** *"I can't see who's connected to whom"* |
| **Prospecting** | "find me manufacturers in Texas" | none | stays here — the unchanged targeting conversation |
| **Engagement** | "I should reconnect with old clients" | — | recognized; *"I can help with that, but not from here yet"*; **B8** |
| **Preparation** | "I have a call with Acme Thursday" | — | recognized, names the meeting back; **B8** |
| **Unclear** | "..." | — | one clarifying question |

### Engagement and Preparation — scope, stated plainly

The batch table assigns their branches to **B8**, not B4 ("B4 — fully-supported intents only"; "B8 — Engagement + Preparation branches"). In Gate B they classify correctly and are answered honestly: Barry names what the user asked for, says the branch is not wired from here yet, and points at the surface that does hold the material. **Nothing is simulated to close the gap** — no news is claimed for Engagement (there is no news producer anywhere in the product) and no meeting briefing is claimed for Preparation (no briefing surface is traced). Both absences are asserted by test against the copy, so a future edit cannot quietly add a plausible sentence.

### Referral — as authorized

Routed through the Outreach path for a named person. The no-graph statement is a correctness requirement rather than tone: v1.0 describes Referral as second-degree path detection, and this product has no relationship graph — contacts are flat records. The test asserts both that Barry says he cannot see connections and that the copy never contains "second-degree", "mutual connection" or "path to".

---

## 6. Ambiguous and compound behaviour

**Ambiguous.** Below 0.6 confidence Barry reads the intent back in plain words and waits — *"You want to reconnect with people you already know. Is that what you're after?"* — with **Yes, that's it** / **Not quite**. Confirming re-routes the settled classification; declining returns to the open question rather than guessing a second time. A low-confidence *Prospecting* reading confirms before anything is created, so no ICP can originate from a guess.

**Genuinely unclear.** One question, not a re-ask of the same question and not a default. The classifier's own question is used when it offered one, otherwise a neutral fallback. A look-around offer sits beneath it so the user is never cornered.

**Compound.** `orderCompound` serves the more actionable half first and holds the other in component state for the session. Actionability is proximity to a real outcome today, not preference: Prospecting is a multi-turn conversation before anything is produced, so it yields to intents that act on something already named; Exploration ranks last because it is always available and therefore never urgent. "I need more leads and I should chase the Acme deal" acts on the deal and offers *"Then work out who to reach"* — reachable, and it lands in the targeting conversation. The held half is never written anywhere.

---

## 7. Required proofs

### 7.1 Non-Prospecting routes never invoke `barryICPConversation`

Three independent proofs:

1. **Diff.** `barryICPConversation.js` and `BarryOnboarding.jsx` are byte-identical across both batches.
2. **Source.** `FirstExperience.jsx` contains no reference to `barryICPConversation`; `barryICPConversation.js` contains no `firstExperience`, `secondaryIntent` or `classifyIntent`.
3. **Behaviour.** The mounted test drives all seven non-Prospecting intents through the real UI with a `fetch` spy and asserts that no call URL contains `barryICPConversation`, that `barryMissionChat` *was* called, and that the targeting conversation never renders. It also asserts the classification request body carries no `icpId`, `existingICP` or `pendingICP`.

Additionally, `reachesIcpConversation()` is asserted false for every non-Prospecting category × both workspace states × both confidence bands, and for `null`, `undefined` and unreadable classifications.

### 7.2 Prospecting still reaches the unchanged ICP path

`ROUTE_IN_PLACE` renders `BarryOnboarding` with everything Phase 1B verified intact behind it: free-text extraction, the clarify loop, `ICPConfirmationCard`, `handleConfirm` as the authorized creation event, the `hasRetrievalConstraint` gate, and `search-companies` with an explicit `icpId`. Proven by the mounted test at high confidence, and by the source assertion that `<BarryOnboarding` appears exactly twice — the `ROUTE_IN_PLACE` branch and a final fallback that exists so a decision-less render can never be a blank screen.

A resumed or refining visit skips the intent question entirely and goes straight to the targeting conversation: someone mid-way through defining targeting, or arriving via "Review ICP with Barry", has already said what they came for. B10's 27 resume tests still pass unchanged.

### 7.3 Zero-ICP operation across non-Prospecting routes

`firstValueRouting.js` contains no `resolveActiveIcp`, `icpProfiles`, `DEFAULT_ICP_ID` or `getActiveIcpId`. Routing is asserted **identical** with `hasIcp: true` and `hasIcp: false` for every category — ICP state is not an input. The mounted test runs every intent against a workspace resolving `no-profiles`. ICP remains capability-required, not platform-required.

### 7.4 No persistence

The contract module imports nothing from Firestore and names no storage field. The classification branch in `barryMissionChat` contains no `.set(`, `.update(` or `FieldValue`, and does not copy the user's turn into telemetry. `FirstExperience.jsx` imports only read APIs. Intent is component state and dies with the session; the user's *words* persist in `barryConversations/icp.messages` exactly as before, which is a transcript, not an intent field.

---

## 8. Files changed

**B3a (`6cb5f4b`)** — 594 insertions, 0 deletions
- `src/utils/firstExperienceIntent.js` (new, 200)
- `netlify/functions/barryMissionChat.js` (+134, additive branch and prompt builder)
- `src/test/firstExperienceIntent.test.js` (new, 260) — **43 tests**

**B4 (`15ccf75`)** — 1340 insertions, 38 deletions
- `src/utils/firstValueRouting.js` (new, 257)
- `src/pages/Onboarding/FirstExperience.jsx` (rewritten in place)
- `src/test/firstValueRouting.test.js` (new, 334) — **43 tests**
- `src/test/firstExperienceIntentFlow.test.jsx` (new, 434) — **37 mounted tests**

---

## 9. Build / test / lint

`npm ci` still fails on an android/arm-only optional dependency; `npm ci --force` is required, as recorded since Tier 1.

| | Gate A baseline (`5b885a7`) | Gate B (`15ccf75`) |
|---|---|---|
| `npm run build` | exit 0 | **exit 0** |
| Tests passing | 1389 | **1512** (+123 new) |
| Tests failing | 5 | **5 — the same 5** |
| Lint | 1224 problems / **1142 errors** | 1224 problems / **1142 errors** |

The 5 failures are pre-existing and untouched: 4 × `ReconSectionEditor` (`window.matchMedia is not a function` in jsdom) and 1 × `HunterContactCard` (date-fns label).

**Lint correction to the record.** Gate A was reported at 1220 problems / 1138 errors. Measured directly on `5b885a7` now, the parent branch is 1224 / 1142 — the earlier figure was taken before the Gate A closure commit landed. Against the correct parent, **both batches add zero lint errors**, verified by a per-file JSON diff of the two runs.

---

## 10. Deviations

1. **Opening question moved from B3a to B4** — §1. Avoids an intermediate state where the user is asked twice.
2. **Engagement and Preparation classify but do not route** — §5. Their branches are B8 by the batch table; Gate B answers them honestly rather than crossing the boundary or faking an outcome.
3. **A readiness probe was added** that the plan did not name: one `limit(1)` contacts query and one integrations read. Preconditions had to be known *before* routing, because sending someone to an empty surface is a dead end rather than a first value. A failed read reports the pessimistic answer, which yields a recoverable turn.

## 11. Correction to the record

The Convergence Matrix listed Communication as reachable "via `barryInboxAnalyzer`, `gmail-sync-worker`". On re-verification for routing, `barryInboxAnalyzer` is a **server-side util** (`netlify/functions/utils/`), invoked only by the scheduled `process-barry-inbox-queue`; it has no HTTP endpoint and no client caller. Its output surfaces through `BarryReplyCard` inside `HunterContactDrawer`. The capability is real and the destination above is correct, but Communication's first value depends on an inbound reply against an existing contact — so for a genuinely new user on day one it is reachable in principle and empty in practice. That is why the route checks both preconditions and says which one is missing, rather than handing over an empty view.

---

## 12. Nothing outside scope

`barryICPConversation` untouched. No schema change, no migration, no new service, no tenancy work, no Phase 1B ruling reopened. No provisional targeting object, temporary ICP identity, anonymous discovery, or unattributed persistence. No intent field, collection, history, or taxonomy document. B5–B9 and B11 not begun.

**Recommendation: GATE B PASS.** Holding for review before Gate C.
