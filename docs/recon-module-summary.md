# RECON Module — Technical Summary

**Platform:** Idynify Scout
**Audience:** Technical stakeholders preparing for the RECON redesign
**Status:** Current-state documentation (pre-rebuild)

---

## Purpose

RECON solves the generic AI problem. Without it, Barry — our Claude-powered AI assistant — has no knowledge of who the user is, what they sell, who they sell to, or how they talk about it. RECON is the structured intake process that captures that business context and makes Barry useful. Instead of producing generic outreach and lead scoring, Barry can generate messaging grounded in the user's actual ICP, competitive position, and value proposition.

---

## Core Functionality

RECON is a 10-section form-driven training system, organized into five modules. Sections unlock sequentially — a user must complete Section N before Section N+1 becomes available.

The step-by-step flow:

1. User navigates to `/recon` and lands on the RECON Overview dashboard.
2. Available sections are shown with status: `not_started`, `in_progress`, or `completed`.
3. User opens a section — a structured form loads (`ReconSectionEditor.jsx`) with targeted questions.
4. Answers are saved to Firestore on demand via `saveSectionData()`.
5. When the user marks a section complete, the next section unlocks.
6. As sections complete, `reconCompiler.js` compiles all stored answers into a structured context object and a formatted prompt injection string.
7. That string is injected into Barry's Claude system prompt whenever Barry is invoked — in Scout for ICP scoring, and in Hunter for message generation.

---

## Key Features

- **10 structured sections** covering: business identity, product positioning, target market firmographics, ideal customer psychographics, pain points, buying behaviour, decision process, competitive landscape, messaging framework, and behavioural signals.
- **Sequential unlock logic** enforces a deliberate, ordered completion path.
- **Barry Knowledge Map** — a visual confidence heatmap on the RECON dashboard showing which training dimensions are `trained`, `partial`, or `untrained`, with Barry's overall confidence level (Low / Medium / High) calculated from completion percentage.
- **Impact Preview Panel** — each section shows how completing it affects Scout, Hunter, and Barry specifically.
- **Section Output Modal** — once a section is complete, users can review the AI-interpreted output Barry will draw from.
- **Progress tracking** — real-time percentage completion, tracked at section and module level.

---

## How It Fits Into the Platform

RECON sits between Scout and Hunter in the three-phase workflow:

```
SCOUT  →  RECON  →  HUNTER
```

**Scout → RECON:** Scout surfaces and enriches leads. RECON's ICP definition (Sections 3–4) is what Scout's lead scoring and Barry's contact validation check against. Without RECON, Scout scores leads against no meaningful criteria.

**RECON → Hunter:** When Hunter generates campaign messages, it pulls Sections 5 (pain points) and 9 (messaging framework) directly from compiled RECON data. RECON completion is what separates a generic outreach sequence from one that references real customer frustrations and brand voice.

RECON does not actively trigger Scout or Hunter — it is a passive context layer that enriches both whenever Barry is called.

---

## Data Inputs and Outputs

**Inputs:** User-provided answers across 10 sections. The data covers:
- Company identity, product description, and pricing model (Sections 1–2)
- Target market firmographics and psychographics (Sections 3–4)
- Customer pain points and buying triggers (Sections 5–6)
- Decision-maker dynamics and evaluation criteria (Section 7)
- Competitive landscape and market positioning (Section 8)
- Messaging framework and brand voice (Section 9)
- Purchase readiness signals and seasonal triggers (Section 10)

**Outputs:** `reconCompiler.js` produces two things:

1. A **structured context object** — a keyed JSON representation of all completed section data, consumed programmatically by Barry's backend functions.
2. A **prompt injection string** — a formatted plain-text block prefixed with completion level and structured field-by-field, injected as part of Barry's Claude system prompt. This is what actually influences Barry's output.

---

## Barry's Role in RECON

Barry has a passive role inside RECON itself — he does not generate content within the section forms or guide users through them. His involvement is:

- **Receiving training:** Every completed section adds to the compiled context injected into Barry's system prompt. Barry's confidence level scales with completion: Low below 40%, Medium at 40–80%, High above 80%.
- **Reflecting completeness:** The Barry Knowledge Map on the RECON dashboard surfaces Barry's current training state across dimensions, giving users a clear signal of where gaps remain.
- **Downstream activation:** Barry uses RECON context when generating contact briefings in Scout (`barryGenerateContext.js`) and personalised campaign emails in Hunter (`generate-campaign-messages.js`).

Barry is not interactive inside RECON in the current build.

---

## Current Limitations

These are the primary issues driving the rebuild:

- **Silent incomplete context.** When sections are empty or skipped, `reconCompiler.js` silently omits them. Barry receives no indication that data is missing — he generates output as if the context is complete, producing results that appear confident but lack grounding.
- **Client-side ICP scoring inconsistency.** ICP scoring logic lives in the React client. The backend lead refresh function uses separate logic. The two can produce conflicting scores for the same lead with no reconciliation.
- **Enrichment gaps leak into messages.** Hunter's message generation does not guard against undefined contact fields. When enrichment is incomplete, those gaps appear verbatim in generated outreach.
- **No notification system.** Users have no in-app alerts when RECON training affects downstream results. They must manually check the dashboard to understand Barry's current state.
- **No route-based code splitting.** The full application — including all RECON section components — is bundled into a single 1.9 MB download, regardless of which page the user visits.
- **No section-level guidance from Barry.** Users complete sections without AI assistance interpreting or validating their answers. Poor or vague inputs silently degrade Barry's quality downstream.
- **Reports not persisted.** Any AI-generated output views are regenerated on each visit, incurring repeated API calls with no caching or storage.
