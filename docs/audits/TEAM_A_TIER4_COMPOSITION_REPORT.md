# Team A — Tier 4: Barry Context Composition

**Branch:** `claude/team-a-nz6kaz` (merged Tier 2 + Tier 3 baseline, `116bc95`)
**Semantic authority:** Barry Intelligence Contract **v0.4-amend** (`e61d219`, plus `87bbdaf` correcting Match-scoring reachability from Tier 2's finding), on `origin/claude/team-b-tzoklo`.
**Recommendation: TIER 4 VERIFIED**
Build EXIT 0 · **1313 passing** (from 1288) · same 5 known failures · lint identical to baseline.

*When Barry recommends, drafts, or decides — does that decision receive the scopes its operation requires? Four surfaces were writing without one they had already loaded.*

---

## 1. Reachable Barry decision-surface inventory

Reachability established per surface by tracing client call sites or scheduled registration — not by the file existing.

### Decision surfaces (live)

| # | Surface | Callers | Appendix B type |
|---|---|---|---|
| 1 | `barryMissionChat` | 3 | Recommendation / message generation |
| 2 | `barryOrientationBrief` | 1 | Orientation brief |
| 3 | `barryGenerateSequenceStep` | 4 | Message generation |
| 4 | `barryHunterGenerateStep` | 1 | Message generation |
| 5 | `barryHunterProcessEngage` | 1 | Message generation + strategy |
| 6 | `barryGenerateMissionSequence` | 2 | Recommendation |
| 7 | `barryDossierBriefing` | 1 | Recommendation (entity) |
| 8 | `barryOutreachMessage` | 1 | Message generation |
| 9 | `generate-engagement-message` | 5 | Message generation |
| 10 | `barryBulkPersonalize` | 1 | Message generation |
| 11 | `barryPipelineAction` | 1 | Recommendation |
| 12 | `barryActions` | 1 | Recommendation |
| 13 | `barryICPConversation` | 1 | ICP coaching |
| 14 | `barry-coach-section` | 1 | ICP/RECON coaching |
| 15 | `barryOutcomeAttribution` | 1 | Recommendation (outcome) |
| 16 | `barryGenerateTemplate` | 1 | Message generation |
| 17 | `barryHunterCardRead` | 1 | Recommendation |
| 18 | `barryInboxAnalyzer` (via `process-barry-inbox-queue`, scheduled) | system | Reply analysis |

### Not decision surfaces

`barryEnrich`, `barryValidateContact`, `barryGenerateContext`, `barryReconInterview`, `barryReconSection0`, `barry-approve-send`, `process-barry-queue` — enrichment, validation, capture and dispatch. They produce no recommendation, action or generated output of their own.

`recommendStrategy` is **not independently classified**: per the decision-surface rule it is evaluated through `barryHunterProcessEngage` / `barryHunterGenerateStep`, the reachable callers that produce the output.

### Dead / dormant assembler inventory (excluded from classification)

| Item | Evidence |
|---|---|
| **`barryFirstTouch`** | **No client caller.** `FirstTouchModal` renders from `MissionControl.jsx` (unrouted) and `AllLeads.jsx`, and makes no netlify call itself. The only reference to the function is a test. **The packet lists it as a surface to audit; by the Reachability Standard it is not live.** |
| `barry-test-message` | zero callers |
| `barryCSMRead` | zero callers |
| `src/utils/reconCompiler.js` | zero importers (server copy is the live one) |
| `MissionControl.jsx` | unrouted |

---

## 2. Composition matrix

`decision → required scopes → producer/store → assembler → missing → classification`

Scope keys: **W** Workspace · **U** User · **E** Entity · **R** Relationship · **M** Mission · **ICP** (where operation is ICP-dependent). REQ = required, NR = not required, ✓ = available, ✗ = missing.

| Surface | W | U | E | R | M | ICP | Missing | Class |
|---|---|---|---|---|---|---|---|---|
| `barryMissionChat` | REQ ✓ | REQ ✓ | REQ ✓ | REQ ✓ | REQ ✓ | REQ ✓ | — | **COMPLIANT** (reference) |
| `barryOrientationBrief` | REQ ✓ | REQ **✗→✓** | NR | Opt ✓ | REQ ✓ | if exists **✗→✓** | — *(after this tier)* | **PARTIAL → COMPLIANT** |
| `barryGenerateSequenceStep` | REQ ✓ | REQ **✗→✓** | REQ ✓ | REQ ✓ | REQ ✓ | NR (relationship op) | — | **PARTIAL → COMPLIANT** |
| `barryHunterGenerateStep` | REQ ✓ | REQ **✗→✓** | REQ ✓ | REQ ✓ | REQ ✓ | NR | — | **PARTIAL → COMPLIANT** |
| `barryHunterProcessEngage` | REQ ✓ | REQ **✗→✓** | REQ ✓ | REQ ✓ | REQ ✓ | NR | strategy-selection W/ICP (deferred) | **PARTIAL → COMPLIANT** for generation; strategy component below |
| `barryGenerateMissionSequence` | REQ ✓ | REQ ✗ | REQ ✓ | REQ ✓ | REQ ✓ | NR | User | **PARTIAL** |
| `barryDossierBriefing` | REQ ✗ | NR | REQ ✓ | REQ ✗ | NR | REQ ✓ | Workspace, Relationship | **PARTIAL** |
| `barryOutreachMessage` | REQ ✗ | REQ ✗ | REQ ✓ | REQ ✗ | NR | ✓ | W, U, R | **NON-COMPLIANT** |
| `generate-engagement-message` | REQ ✓ | REQ ✗ | REQ ✓ | REQ ✓ | If active ✓ | NR | User | **PARTIAL** |
| `barryBulkPersonalize` | REQ ✗ | REQ ✗ | REQ ✓ | REQ ✓ | NR | NR | W, U | **PARTIAL** |
| `barryPipelineAction` | REQ ✗ | NR | REQ ✓ | REQ ✓ | REQ ✓ | NR | Workspace | **PARTIAL** |
| `barryActions` | NR | NR | ✓ | NR | NR | NR | — | **NOT A DECISION SURFACE** (command dispatch) |
| `barryICPConversation` | REQ ✗ | NR | NR | NR | NR | REQ ✗ | W, ICP | **NON-COMPLIANT** |
| `barry-coach-section` | REQ ✓ | NR | NR | NR | NR | REQ ✓ | — | **COMPLIANT** |
| `barryOutcomeAttribution` | NR | NR | REQ ✓ | REQ ✓ | REQ ✓ | NR | — | **COMPLIANT** |
| `barryGenerateTemplate` | REQ ✗ | REQ ✗ | NR | NR | NR | NR | W, U | **PARTIAL** |
| `barryHunterCardRead` | NR | NR | REQ ✓ | REQ ✓ | NR | NR | — | **COMPLIANT** |
| `barryInboxAnalyzer` | REQ ✗ | REQ ✗ | REQ ✓ | REQ ✓ | If active ✗ | NR (reply analysis) | W, U, M | **NON-COMPLIANT** |

**Totals after this tier:** 6 COMPLIANT · 8 PARTIAL · 3 NON-COMPLIANT · 1 NOT A DECISION SURFACE.

---

## 3. Category 1 gaps implemented — four, one shape

Every one satisfies all five Category 1 conditions: existing producer, authoritative current source, existing consumer, no new schema, no new assembler, no new semantics.

**The pattern.** `communicationStyle` lives on `dashboards/{userId}` — the document each of these functions **already fetches** for RECON. It was never read. So four surfaces assembled Workspace, Relationship and Mission scope and then wrote in Barry's default voice, ignoring the style the user picked in RECON Section 0. **No new read was introduced by any of these fixes** — asserted by test (exactly one dashboard fetch per function).

| Surface | Gap closed | Before → After |
|---|---|---|
| `barryGenerateSequenceStep` | User | `dashboards/{uid}.communicationStyle` → *(never read)* → **→ `userStyleBlock()` → `${userStyle}` in the step prompt** |
| `barryHunterGenerateStep` | User | same |
| `barryHunterProcessEngage` | User | same, threaded into `generateStep1Draft` as a parameter rather than reached across scopes |
| `barryOrientationBrief` | User **and** ICP | style read from the dashboard doc already in hand; ICP via `resolveActiveIcp(db, userId)` → `${icpLine}` in the platform-state block |

### Before/after reachability

**User scope (all four):**
`RECON §0 CommunicationStyleSelector → dashboards/{uid}.communicationStyle → [BROKEN: never read] → prompt → generated message`
becomes
`… → dashboardDoc.data().communicationStyle → userStyleBlock() → prompt → generated message`

**ICP scope (orientation brief):**
`icpProfiles/{icpId} → [BROKEN: not fetched] → brief that discusses "companies matching ICP" without knowing which ICP`
becomes
`icpProfiles/{icpId} → resolveActiveIcp (canonical, Tier 1) → icpLine → brief`

The orientation brief is the one surface here where ICP is required — it reports high-fit counts and "companies matching ICP". Appendix B (v0.4-amend) rates it **"If ICP exists"**, so a zero-ICP workspace omits the line rather than being marked incomplete, and all three unresolved states stay distinct in what Barry is told.

---

## 4. Pre-implementation collision gate — one collision avoided

**`compileReconForPrompt` was the tempting place to add User scope.** It is called by `barryGenerateSequenceStep`, `barryHunterGenerateStep`, `barryHunterProcessEngage`, `barryFirstTouch` (dead) and others — surfaces with **different** scope requirements. Adding the user's voice there would have changed the prompt of every caller at once, including surfaces where User scope is not required, which is precisely the "one global context dump" the gate forbids.

**Decision: the helper is duplicated per function instead** — four small local `userStyleBlock` functions rather than one shared change. Deliberate, and asserted by test: `reconCompiler.js` contains no `communicationStyle`. Each surface assembles its own scopes.

No other shared assembler was modified. `assembleBarryContext` and `recommendStrategy` are untouched.

---

## 5. Match + Coverage co-travel

**No live Barry decision surface consumes Match.** Verified: `fit_score` appears in none of `barryMissionChat.js`, `barryContextAssembler.js`, `barryStrategyRecommender.js`, nor in any surface changed here. Tier 2 established this and it still holds.

So the co-travel requirement is **vacuously satisfied** — there is no decision context receiving Match without Coverage, because none receives Match at all. **No Coverage was persisted and no scoring system was invented.** If a future surface consumes Match, `computeCoverage` (Tier 2) is available to travel with it.

---

## 6. Token-budget decisions for every assembler modified

| Assembler | Included at full fidelity | Truncated | Summarised | Omitted | Why |
|---|---|---|---|---|---|
| `barryGenerateSequenceStep` | contact, step plan, step history, RECON (via existing compiler), **user style (one line)** | — | — | ICP profile beyond messaging | Relationship operation; ICP not required. Style is a single line — no measurable budget cost |
| `barryHunterGenerateStep` | as above + mission goal/step progress, `barry_memory`, strategy | — | — | as above | as above |
| `barryHunterProcessEngage` | as above + guardrail, intake, last-session summary | — | — | Workspace/ICP **inside strategy selection** (see §7) | The strategy component's gap is not a one-line fix — deferred |
| `barryOrientationBrief` | mission/company/reply counts, RECON state, **user style (one line)**, **ICP name + up to 3 industries** | ICP industries capped at 3 | ICP represented by name + top industries, not the whole profile | scoring weights, messaging, full industry list | The brief is 2–3 sentences; the full profile would dominate a prompt that only needs to know which ICP is in play. **Truncation within a present scope, explicitly recorded — not omission.** |

No scope required by any of these operations is entirely absent after this tier.

---

## 7. Split-brain closure

| Pattern | Surfaces | Action |
|---|---|---|
| **Workspace/ICP but no Relationship** | `barryDossierBriefing`, `barryICPConversation` | **Deferred.** Dossier needs per-entity relationship memory; `barryICPConversation` needs Workspace + ICP. Neither is a field on a document already fetched — both need new reads and a decision about which relationship source is authoritative |
| **Relationship but no Workspace/User** | `barryOutreachMessage`, `barryBulkPersonalize`, `barryGenerateTemplate`, `barryInboxAnalyzer` | **Deferred.** These do not currently load `dashboards/{uid}` at all, so adding Workspace scope means new reads plus a token-budget design per surface — beyond a Category 1 addition |
| **Relationship + Mission but no User** | the three generation surfaces + orientation brief | **CLOSED** — §3 |
| **Strategy selection without Workspace/ICP** | `recommendStrategy` inside the two Hunter surfaces | **Deferred.** v0.4's own worked example. The strategy scorer takes contact data and user-level stats; giving it Workspace/ICP changes its scoring inputs, which is new product semantics, not wiring |

Closed exactly the minimum that fits Category 1. Everything requiring a unified assembler stays deferred, as instructed.

---

## 8. Debt

**Category 2 (schema/storage):** `communicationStyle` on `dashboards/{uid}` is User scope stored in a Workspace document (D8 misalignment) · no per-surface record of which scopes a generated output actually received.

**Category 3 (new infrastructure):** the unified context assembly service — required by the eight PARTIAL and three NON-COMPLIANT surfaces above · a relationship-context reader for surfaces that do not load one · Mission as a first-class object.

**Category 4 (new capability):** Workspace/ICP inputs to strategy selection · Coverage travelling with Match to a Barry decision · relationship warmth.

**Dead assemblers:** §1 table. **None deleted** — removal is not composition work.

**Nothing in any category was implemented.**

---

## 9. Tests, build, lint

| | Merged T2+T3 | Tier 4 |
|---|---|---|
| Build | EXIT 0 | **EXIT 0** |
| Passing | 1288 | **1313** |
| Failing | 5 | **5** |
| Lint | 1224 (1142 err, 82 warn) | **1224 (1142 err, 82 warn)** |

+25 tests (`src/test/barryCompositionInvariant.test.js`). Same five known failures (`HunterContactCard` date-fns ×1, `ReconSectionEditor` `matchMedia` ×4). No new lint errors or warnings.

**Zero-ICP semantics re-verified under Tier 4:** no surface hard-fails on a missing ICP, every ICP read stays guarded on an id, and no surface fabricates an identity.

## 10. Boundaries held

No unified context assembly service · no new Firestore structures · no Mission object · no relationship warmth infrastructure · no onboarding redesign · no progressive RECON · Match semantics unchanged · Coverage semantics unchanged · frozen Documents 1–5 untouched · no Phase 2 work.

## Recommendation

**TIER 4 VERIFIED.** Every reachable Barry decision surface is inventoried and classified against Appendix B; the four gaps that were genuinely Category 1 — a scope sitting unread on a document the surface had already fetched — are closed; the one change that would have been a global context dump was identified and deliberately not made; and everything needing a unified assembler is documented as deferred rather than half-built.

**One finding worth your attention:** `barryFirstTouch`, which both the packet and v0.4 treat as a live surface, has no client caller. It is dead by the Reachability Standard.

Holding for review. Phase 2 not started.
