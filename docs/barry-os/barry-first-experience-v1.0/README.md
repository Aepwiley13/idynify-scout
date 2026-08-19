# Barry First Experience — Semantic Design v1.0

**Idynify · First Experience Semantic Model · Team B**
**Date: 2026-08-19**
**Repository: aepwiley13/idynify-scout**
**Governing Contract: Barry Intelligence Contract v0.4-amend**
**Status: Returned for convergence — v1.1**

## Revision History

| Version | Date | Scope |
|---|---|---|
| v1.0 | 2026-08-19 | Initial semantic design: WHO/INTENT/FIRST VALUE/PROGRESSIVE INTELLIGENCE models, five journey tests, accelerator model, anti-patterns, 12 undecided questions |
| v1.1 | 2026-08-19 | Convergence pass: three owner clarifications (WHO name rule, intent taxonomy, multi-company tenancy), intent durability evaluation, accelerator status clause, five-journey convergence matrix against repository evidence, consolidated decision registry |
| v1.1-b | 2026-08-19 | Bounded contract rulings: P-9 confirmation-before-search invariant (proto-targeting → confirm → ICP → search), P-5 intent durability formalized (transient routing context, not intelligence), Journey 1/2/4 corrected to require confirmation before discovery, Journey 2 factual corrections (website extraction scope, targetCompanySize semantic, free-text vs. structured) |

---

## Document Purpose

This document defines the semantic model for the Barry First Experience — the journey from a brand-new user's arrival to their first useful outcome. It is a semantic design, not a UI specification, implementation plan, or schema proposal.

This document applies the intelligence types, governing principles, and invariants established in v0.4-amend. It does not reopen or amend v0.4. Where v0.4 defines what intelligence concepts mean, this document defines how Barry acquires, infers, and uses intelligence during the initial experience.

No code. No schema. No API assumptions. No UI implementation.

---

## Central Product Principle

> Barry should get to know the user, understand their intent, and deliver something useful — before asking for anything else. The user should not feel like they are setting up software.

This is the governing principle for every design decision in this document. Any element that makes the user feel like they are configuring a tool rather than working with an intelligent partner violates this principle.

---

# First Experience Principles

### FE-1: First Value Before First Form

Barry must deliver a useful outcome before the user has completed any structured data collection. The first experience is a conversation, not a setup wizard. If the user has said who they are and what they want, Barry has enough to begin.

### FE-2: Every Input Earns Its Place

Barry never asks for information without the user seeing how that information improves their outcome. If the connection between a question and a benefit is not immediate and visible, the question is deferred.

### FE-3: Silence Is Intelligence

What a user does not say is itself intelligence. A user who provides a name and an intent but no company is not incomplete — they are a user who has not yet needed to share their company. Barry does not treat missing information as a problem to solve unless the current operation requires it.

### FE-4: No Setup Completion State

There is no "onboarding complete" flag. There is no percentage. Barry's understanding of the user deepens continuously through every interaction. Day 1 and Day 100 use the same intelligence acquisition model — the only difference is how much Barry has already learned.

### FE-5: Intent Is the Router

The user's stated intent determines what Barry does first, what intelligence is relevant, and what questions (if any) are worth asking. Two users who give identical WHO information but different intents receive entirely different first experiences.

### FE-6: Accelerators Are Gifts, Not Requirements

A résumé, LinkedIn URL, or company website offered by the user is a gift that reduces future questions. It is never required. It is never requested as a step. Barry may offer the opportunity ("If you share your LinkedIn, I can skip a few questions") but the user who declines is not penalized with a longer setup.

### FE-7: Barry Confirms, Never Interrogates

When Barry needs intelligence, the hierarchy is: discover → infer → confirm → ask. "I see your company is in the cybersecurity space — is that right?" is always preferred over "What industry are you in?" Confirmation requires less cognitive effort and demonstrates that Barry is already working.

### FE-8: First Experience Is Not a Separate Mode

The First Experience is not a modal state that the user enters and exits. It is the first iteration of the same progressive intelligence model that governs all of Barry's ongoing operation. The principles here do not expire — they are the Question Rule (v0.4 Principle 1) applied from the first moment.

---

# WHO Semantic Model

WHO answers the question: "Who is the human sitting down with Barry?"

WHO is the lightest possible baseline. It establishes who Barry is talking to — not what they do, not what they sell, not who they want to reach. Those come from INTENT and progressive intelligence.

## WHO Information Classification

| Information | Classification | Rationale |
|---|---|---|
| **Name** | Normally useful, conversationally acquired | Barry should address the user by name. Name may be stated, inferred from authenticated context (e.g., email display name), or confirmed. It must not create a mandatory profile-form gate before first value. |
| **Primary company or organization** | Useful now | Provides workspace grounding. Enables website inference. Not required — a user may be between companies, independent, or not ready to share. |
| **Company website** | Optional accelerator | High-value inference source. Barry can discover the user's company name, industry, positioning, value proposition, and what they sell from a website. May also extract targeting intelligence about the user's ideal customers (target industries, target company sizes). Not required — many users do not have one, and its absence is not blocking. |
| **Email address** | Required now (platform) | Authentication artifact. Not intelligence Barry asks for — the platform provides it. Barry may infer domain → company from it. |
| **Role or title** | Inferable / confirmable | Inferable from LinkedIn, résumé, or website team page. Barry confirms rather than asks. |
| **Industry** | Inferable | Inferable from company name, website, or domain. Barry confirms if uncertain. |
| **Location** | Progressively learnable | May be available from LinkedIn, public data, or user statement. Not reliably inferable from a website alone. |
| **Company size** | Progressively learnable | May be available from LinkedIn or public data. Not reliably inferable from a website alone. Not asked. |
| **Years in business** | Not relevant now | Never asked. Progressively learnable if relevant to a future operation. |
| **Photo/avatar** | Not relevant now | Never asked. Platform-supplied or progressively available. |

### WHO Semantic Properties

**WHO intelligence is User-scoped.** The name, role, and personal context belong to the User (v0.4 scope), not to the Workspace. A user who works across multiple companies carries the same WHO identity.

**Company is Workspace intelligence.** When the user provides a company, that grounds a Workspace (v0.4 scope). The user's relationship to the company is User intelligence; the company itself is Workspace intelligence. This distinction matters for multi-company users (see §Multi-Company Behavior).

**WHO is not a profile.** Barry does not build a "user profile" from WHO. WHO establishes the minimum conversational ground truth: I know who I am talking to. Everything else is progressive intelligence, acquired through the Question Rule.

**WHO requires only enough identity to begin.** The First Experience requires only enough personal identity to begin a useful conversation. Barry's goal is to establish a baseline understanding of the person — not to make the person complete a profile. A name is normally the minimum social contract, but it may be acquired conversationally, inferred from reliable authenticated context, or confirmed — it must never be a form field that gates first value.

---

# INTENT Semantic Model

INTENT answers the question: "What does the user want to accomplish?"

Intent is expressed in human terms. The user never needs to know what Barry's modules are called, what capabilities exist, or how the platform is organized. The user says what they want; Barry maps that to what Barry can do.

## Intent Is Not a Menu Selection

The user does not choose from a list of capabilities. They describe what they want. Barry's job is to understand. If the user says "I need more clients," Barry understands that as a discovery intent — the user does not need to know the word "discovery" or "Scout."

## Intent Taxonomy Is Not UI Taxonomy

The nine semantic intent types below are useful as an internal classification for how Barry reasons about what the user wants. They are not a UI element. The user does not need to understand, see, or select from Barry's complete internal intent taxonomy. Barry may infer intent from natural language, conversation, or a smaller set of broad choices and map it internally to one or more intent types. Implementation must not prescribe nine buttons, a nine-option selector, or any UI that mirrors the internal taxonomy.

## Human Intent Types

| Human Intent | Semantic Category | What the User Means | ICP Required? |
|---|---|---|---|
| "I need to find new customers" / "I want more clients" / "I need leads" | **Prospecting** | Discovery of new companies that match targeting criteria | Yes — becomes relevant when first search is attempted, not at declaration |
| "I want to grow my existing business" / "I want to engage my network" | **Engagement** | Deeper connection with people the user already knows | No |
| "I want help with my emails" / "I want better email responses" | **Communication** | Assistance with inbox management and email composition | No |
| "I want to prepare for meetings" / "I have a meeting coming up" | **Preparation** | Briefings, talking points, and context for upcoming meetings | No |
| "I want referrals" / "I want introductions from my network" | **Referral** | Leveraging existing relationships for warm introductions | No |
| "I want to manage my pipeline" / "I need to follow up with people" | **Pipeline** | Tracking and progressing existing relationships | No |
| "I want to reach out to someone specific" / "Help me write a message to..." | **Outreach** | Composing communication to a specific person | No |
| "I'm not sure yet" / "Just show me what you can do" | **Exploration** | Orientation — the user wants to understand Barry's capabilities | No |
| "I want to do multiple things" / compound intent | **Compound** | More than one intent. Barry serves the most immediate one first, then returns to the second. | Depends on component intents |

### Intent Semantic Properties

**Intent is not permanent.** A user's first intent is not a classification that follows them forever. It determines what Barry does first. The user may express a different intent at any time, and Barry pivots without requiring re-onboarding.

**Intent does not require precision.** "I want more business" is a valid intent. Barry can work with ambiguity — confirmation narrows it: "It sounds like you're looking for new prospects. Is that right, or are you more focused on growing business with people you already know?"

**Intent determines ICP relevance.** Per v0.4-amend, ICP is capability-required, not platform-required. The user's intent determines whether ICP intelligence becomes relevant. A user whose intent is Engagement never needs an ICP. A user whose intent is Prospecting will need an ICP — but not at the moment of declaring intent. ICP becomes relevant at the moment Barry needs a targeting definition to execute a discovery operation.

**Compound intent is normal.** Most users want more than one thing. Barry serves the most actionable intent first. "I want to find new clients and also keep in touch with my existing network" — Barry starts with whichever is more immediately actionable (typically Engagement, because it requires less setup). The user may raise the second intent when ready; Barry does not need to durably store or track multiple intents across sessions.

### Intent Durability (v1.1, refined v1.1-b)

Current intent is lightweight routing context, not durable User identity and not a seventh permanent intelligence type.

Example: "I want referrals today" routes Barry now. It should not permanently define the person.

Phase 2 may treat intent as transient routing context without creating a new intelligence store. Intent does not require persistence, attribution per the Intelligence Rule (Principle 2), or any of the five properties (ownership, provenance, confidence, freshness, purpose) that v0.4 requires of intelligence. It is conversational context that determines what Barry does in this interaction.

Compound-intent memory within a single conversation is conversational context — Barry can track "the user also mentioned referrals" within a session without a durable store. Across sessions, the user re-states or Barry infers intent fresh. No cross-session intent persistence is required.

**Semantic boundary — Intent vs. Mission:**

| Property | Intent | Mission |
|---|---|---|
| Duration | This conversation | Across conversations |
| Persistence | None required — conversational context | Required — tracked, stored, progressed |
| Identity | No identifier | Mission identity (v0.4 Part III) |
| Intelligence Rule | Does not apply — not an intelligence artifact | Applies — must have ownership, provenance, confidence, freshness, purpose |
| Example | "I want referrals today" | "Get introduced to 5 VPs at SaaS companies this quarter" |
| Promotion | User or Barry recognizes a persistent objective → becomes Mission | N/A — already Mission |

The boundary: intent is what Barry acts on now; Mission is what Barry helps achieve over time. An objective crosses the boundary when it persists across sessions and Barry is actively tracking progress toward it. This promotion is an explicit event, not an automatic inference from repeated intent.

**v0.4 compatibility:** Fully compatible.
1. v0.4 defines six intelligence types in Part I. Intent is not a seventh — it is routing context, not intelligence.
2. v0.4 defines Mission scope in Part III as "the current objective, when one is active." The intent→Mission boundary adds semantic clarity to "when one is active" without changing the definition.
3. v0.4 Part VI item 9 leaves Mission-as-object explicitly undecided. This interpretation does not decide storage — only the semantic threshold for when routing context matures into a tracked objective.
4. No new intelligence store, schema, or persistence mechanism is implied or required.

---

# FIRST VALUE Definition

First value is the earliest moment when Barry delivers something the user finds genuinely useful. It is not a demo. It is not a sample. It is a real outcome the user could not have produced as easily without Barry.

## First Value by Intent Type

| Intent | First Value | What Barry Needs | What Barry Does NOT Need |
|---|---|---|---|
| **Prospecting** | A small set of relevant companies discovered after the user confirms a targeting definition that Barry proposed from inferred or stated intelligence | User confirmation of a proposed targeting definition (creating an ICP identity), which may be as lightweight as confirming a single inferred industry | A fully specified multi-dimensional ICP. A completed RECON. Any structured profile beyond the confirmed targeting definition. |
| **Engagement** | An insight about one of the user's existing contacts — a recent event, a follow-up suggestion, a conversation starter | Access to the user's contacts or at least one named contact | A contact database import. A completed relationship map. |
| **Communication** | An analyzed email with a suggested response or talking points | One email to analyze (forwarded, pasted, or connected) | Email integration setup. OAuth flow. |
| **Preparation** | A briefing on an upcoming meeting — who the person is, what they care about, what to discuss | One meeting or one person to prepare for (named or from calendar) | Calendar integration. Full relationship history. |
| **Referral** | Identification of a potential introduction path between two people the user knows | At least two contacts or relationships in context | A full network map. CRM integration. |
| **Pipeline** | A status snapshot of a named relationship — where things stand, what to do next | One named contact or company with any history | A complete pipeline import. |
| **Outreach** | A draft message to a specific person incorporating whatever Barry knows about them | A named recipient and an intent (introduce, follow up, pitch, etc.) | A completed ICP. A messaging strategy. RECON completion. |
| **Exploration** | An orientation brief showing what Barry can see and do with what Barry currently knows about the user | WHO baseline (name + whatever else was provided) | Nothing beyond WHO. Barry demonstrates capability from whatever intelligence exists. |

### First Value Invariants

**FV-1: First value must be reachable within the first conversation.** If the user provides WHO and INTENT, Barry must deliver first value without requiring the user to leave, complete a form, or return later.

**FV-2: First value quality scales with intelligence depth.** A user who provides a website gets a richer targeting proposal and a more specific ICP-targeted search than one who provides only a name. But both reach confirmation and first value. The user who provided less sees a useful outcome and understands that providing more produces better outcomes — without Barry lecturing about it.

**FV-3: First value is real, not simulated.** Barry does not show fake data, sample results, or demo content. First value uses whatever real intelligence is available, even if that intelligence is minimal.

**FV-4: First value acknowledges its own limitations.** When Barry delivers a result from limited intelligence, Barry says so: "Based on what I can see, here are three companies that might fit. As I learn more about what you're looking for, these will get sharper." This is honesty, not an apology.

**FV-5: First value is intent-appropriate. (v1.1)** Each intent type has its own first value. Not every journey leads toward Scout or ICP creation. A user whose intent is Engagement receives engagement value; a user whose intent is Preparation receives meeting preparation. The first value table above defines what "useful" means for each intent. Implementation must not funnel all intents through a single Prospecting-shaped path.

---

# Progressive Intelligence Model

Progressive intelligence defines what Barry learns over time and how. It is the Question Rule (v0.4 Principle 1) applied as a continuous process.

## Intelligence Acquisition Phases

### Phase 0: Platform-Provided (Before Barry Speaks)
Intelligence available without asking:
- Email address (from authentication)
- Email domain → probable company (inferable)
- Locale/timezone (from platform)
- Referral source (if trackable — "how did you find us?")

### Phase 1: First Conversation (WHO + INTENT)
Intelligence from the opening exchange:
- Name (conversationally acquired — from authentication context, stated, or confirmed)
- Company/organization (offered or inferred)
- Website (offered as accelerator)
- Intent (asked — "What brings you to Barry?")
- Industry (inferred from company/website, confirmed if uncertain)
- Role (inferred from LinkedIn/résumé if provided, otherwise deferred)

### Phase 2: First Value Delivery
Intelligence from delivering first value:
- Reaction to first value (implicit — did they engage? dismiss? modify?)
- Corrections ("No, not that industry — I'm in medtech")
- Refinements ("Can you find companies that are smaller?")
- These are the highest-value intelligence signals because they are contextual, specific, and free

### Phase 3: Ongoing Use
Intelligence from continued interaction:
- Contact and relationship data (from messages, meetings, introductions)
- Communication style preferences (from how the user writes and what they approve)
- Industry expertise depth (from questions asked and corrections made)
- Targeting refinements (from accept/reject decisions on discovered companies)
- Workspace business context (from conversations where the user discusses their business)
- Mission outcomes (from completed and abandoned missions)

### Phase 4: Deep Intelligence
Intelligence that accumulates over weeks and months:
- User Judgment patterns (v0.4 §4) — systematic preferences revealed through evaluation history
- Engagement patterns — who the user actually talks to vs. who they say they want to reach
- Outcome correlations — which types of introductions, messages, or recommendations produced results
- Seasonal or cyclical patterns in the user's business

## Progressive Intelligence Properties

**No phase is a gate.** Phase 0 through Phase 4 are not sequential steps. They describe the depth of Barry's knowledge. A user in Phase 1 can still benefit from Phase 3 intelligence if they provide it (e.g., by uploading contacts). The phases describe typical progression, not required progression.

**Intelligence attribution is maintained throughout.** Per v0.4 Principle 2 (Intelligence Rule), every piece of progressive intelligence must have ownership, provenance, confidence, freshness, and purpose. Intelligence inferred from a website has different confidence than intelligence stated by the user. Both are valid; both must be attributed.

**Corrections supersede inferences.** When the user corrects Barry's inference, the correction becomes canonical. The original inference is not retained as an alternative — it is replaced. Barry learns from corrections, not just from initial inputs.

---

# Five Journey Tests

Each test user must reach a useful outcome. If any is forced through intelligence collection irrelevant to their intent, the design is wrong.

---

## Journey 1: The Minimalist

**Profile:** Gives Barry almost nothing. Name only. No company, no website, no LinkedIn.
**Intent:** "I'm not sure — show me what you can do."

**WHO intelligence after first exchange:**
- Name: "Jordan" (stated)
- Company: unknown
- Industry: unknown
- All other fields: unknown

**Barry's path:**
1. Barry greets Jordan by name. Asks what brings them to Barry — in conversational terms, not as a menu.
2. Jordan says: "I'm not sure — show me what you can do."
3. Intent classification: **Exploration**.
4. First value (Exploration): Barry delivers an orientation brief. "Here's what I can help with: finding new business, managing relationships, preparing for meetings, writing outreach. What sounds closest to what you need?" This is not a feature list — it is Barry demonstrating that it is ready to work, not waiting for configuration.
5. Jordan says: "I guess finding new business."
6. Intent reclassified: **Prospecting**.
7. Barry needs a targeting constraint but has none. Barry asks the minimum: "What kind of companies are you looking to reach? Even a general direction helps — like 'tech startups' or 'local restaurants.'"
8. Jordan says: "Tech companies."
9. Barry proposes a confirmation: "Got it — should I search for tech companies and see what comes up?"
10. Jordan confirms.
11. Confirmation creates a lightweight ICP with industry targeting. Barry executes an ICP-targeted search. Results are broad because the targeting definition is minimal. Barry acknowledges this: "Here are some tech companies I found. As I learn more about the kind of tech company you're looking for — size, location, specific niche — I can narrow this down."

**Test result:** Jordan reached first value (a set of real, ICP-attributed companies) with a name, two conversational exchanges, and one lightweight confirmation. No form. No profile completion. No ICP configuration screen. Barry asked for one thing it could not infer (industry targeting direction) because the intent required it, then confirmed before searching.

**ICP state:** ICP created at step 10 via conversational confirmation — the lightest possible ICP creation event (single industry). Per v0.4 §1 ICP Creation Semantics, the user's explicit confirmation constitutes an authorized ICP creation event. The ICP can be progressively refined through reactions to results.

---

## Journey 2: The Website Provider

**Profile:** Gives Barry their name and company website.
**Intent:** "I want to find new customers."

**WHO intelligence after first exchange:**
- Name: "Priya" (stated)
- Company website: "www.securelane.io" (stated)
- Company: "SecureLane" (inferred from website — `companyName` extraction)
- Industry: "Cybersecurity" (inferred from website content — `description`, `whatTheySell`)
- Value proposition: "Cloud security platform for mid-market enterprises" (inferred from website — `valueProposition`)

**Targeting intelligence extracted from website (distinct from WHO):**
- Target customer description: "mid-market enterprises" (from `whoTheyServeTo` / `icpSummary` — free-text, describes the user's ideal customers, not the user's own company)
- Target industry context: enterprises needing cloud security (from `targetIndustry` — free-text, requires translation to structured search parameters)

**What the website does NOT reliably provide:**
- The user's own company location (not extracted by `analyze-website`)
- The user's own company employee count (not extracted; `targetCompanySize` refers to target customer size, not the user's company)
- Competitive landscape (not extracted by `analyze-website`)

**Barry's path:**
1. Barry greets Priya by name. Asks what brings them here.
2. Priya says: "I want to find new customers."
3. Intent classification: **Prospecting**.
4. Barry has inferred Workspace intelligence and proto-targeting intelligence from the website. Barry confirms rather than asks: "I can see SecureLane is a cloud security platform focused on mid-market enterprises. Is that right?"
5. Priya confirms (or corrects — any correction becomes canonical).
6. Barry proposes a targeting definition from the website-extracted intelligence: "It looks like your ideal customers are mid-market enterprises that need cloud security. Should I search for companies like that?"
7. Priya confirms. Confirmation creates an ICP with targeting criteria derived from the website extraction. Free-text values (e.g., "mid-market enterprises") are translated to structured search parameters at this point — this translation is an implementation concern, not a semantic one.
8. Barry executes an ICP-targeted search. Results are more focused than Journey 1 because the website accelerator provided richer targeting intelligence. Barry notes what it does not yet know: "I'm using what I found on your website to target this search. Once you tell me more about your ideal customer — or just react to these results — I can get much sharper."

**Test result:** Priya reached first value with a name, a website, and one conversational confirmation that doubled as ICP creation. The website accelerator eliminated multiple questions and provided proto-targeting intelligence. Barry demonstrated the Question Rule: discover (website), infer (industry, target customer), confirm ("Is that right?"), propose targeting definition, confirm before search.

**ICP state:** ICP created at step 7 via conversational confirmation. The website accelerator provided richer proto-targeting intelligence than Journey 1, producing a more specific ICP at creation. The ICP can be progressively refined through reactions to results.

---

## Journey 3: The Networker

**Profile:** Has existing customers and a professional network. Wants engagement and referrals.
**Intent:** "I want to stay in touch with my clients and get referrals."

**WHO intelligence after first exchange:**
- Name: "Marcus" (stated)
- Company: "Greenfield Consulting" (stated)
- Website: "www.greenfieldconsulting.com" (stated)
- Industry: Management consulting (inferred)
- Role: Principal (inferred from website or stated)

**Barry's path:**
1. Barry greets Marcus by name. Asks what brings them here.
2. Marcus says: "I want to stay in touch with my clients and get referrals."
3. Intent classification: **Compound** — Engagement + Referral.
4. Both intents are non-ICP-dependent. Barry does not ask about targeting, ideal customer profiles, or discovery criteria. Those are irrelevant to this user's intent.
5. Barry asks the minimum to deliver first value: "Do you have a few key clients or contacts in mind? Even one name gives me a starting point."
6. Marcus names three clients.
7. First value: Barry delivers a relationship snapshot for one of the three — recent news about their company, potential conversation starters, a follow-up suggestion based on how long it has been since contact. For the referral intent, Barry identifies a second-degree connection pattern: "Your client X is in the same space as Y — that might be a referral conversation."

**Test result:** Marcus reached first value without any ICP configuration, RECON questionnaire, or targeting intelligence collection. Barry correctly identified that the user's intent does not require ICP and did not collect it. The Engagement and Referral capabilities activated with relationship data alone.

**ICP state:** `no-profiles` (valid, not blocking). Marcus may never create an ICP, and that is a correct, permanent product state.

---

## Journey 4: The Aspiring Prospector

**Profile:** Wants new prospects but has no defined ICP and no clear targeting criteria.
**Intent:** "I want to find new business, but I'm not sure who to target."

**WHO intelligence after first exchange:**
- Name: "Dana" (stated)
- Company: "Dana Chen Photography" (stated)
- Website: none
- Industry: Photography / creative services (inferred from company name)

**Barry's path:**
1. Barry greets Dana by name. Asks what brings them here.
2. Dana says: "I want to find new business, but I'm not sure who to target."
3. Intent classification: **Prospecting** (with targeting uncertainty).
4. Barry does not launch a targeting questionnaire. Barry engages the Question Rule.
5. Barry's first question is about existing experience, not ideal customers: "Who have been your best clients so far? Even one or two examples help me understand what works for you."
6. Dana says: "I've done work for a few local restaurants and a tech startup."
7. Barry infers proto-targeting intelligence: local businesses, service businesses, small-to-medium. Barry proposes a targeting definition: "It sounds like local businesses — restaurants, maybe other service businesses — have been a good fit. Should I search for more companies like those?"
8. Dana says: "Yeah, and maybe some event venues too."
9. Barry incorporates the refinement and confirms: "Restaurants, service businesses, and event venues — I'll search for those. Let's see what comes up."
10. Dana's confirmation at steps 8–9 creates a lightweight ICP with the confirmed targeting definition.
11. First value: Barry executes an ICP-targeted search and delivers a set of local restaurants, service businesses, and event venues. Barry says: "Here's a first batch. As you tell me which ones look interesting and which don't, I'll learn your taste."

**Test result:** Dana reached first value without ever encountering the word "ICP," completing a form, or explicitly defining targeting criteria. Barry extracted targeting intelligence from Dana's existing experience using the Question Rule. The conversational confirmation ("Yeah, and maybe some event venues too" in response to Barry's proposal) served as the ICP creation event. Future accept/reject decisions on these results become User Judgment (v0.4 §4) and progressive ICP refinement.

**ICP state:** ICP created at step 10 via conversational confirmation. Dana never saw a configuration screen — the ICP was created through natural dialogue. The confirmation threshold was low (industries only), and the ICP can be refined over time.

---

## Journey 5: The Multi-Company Operator

**Profile:** Works across multiple companies or organizations. Fractional executive, consultant, or portfolio operator.
**Intent:** "I work with three different companies and need Barry for all of them."

**WHO intelligence after first exchange:**
- Name: "Alex" (stated)
- Primary company: unclear — Alex works across multiple
- Companies: "Northwind Capital" (investment firm), "TerraGrid" (cleantech startup), "Alex Park Advisory" (personal consulting)

**Barry's path:**
1. Barry greets Alex by name. Asks what brings them here.
2. Alex says: "I work with three different companies — an investment firm, a cleantech startup, and my own advisory. I need Barry for all of them."
3. Barry recognizes the multi-company pattern. Barry does not force Alex to pick one. Barry says: "Let's start with one — which is most pressing right now?"
4. Alex says: "Let's start with my advisory — I need to find new clients."
5. Intent for first context: **Prospecting** (for Alex Park Advisory).
6. Barry proceeds with the Prospecting flow for the advisory.
7. Barry remembers the other two companies. The mechanism for returning to them depends on architectural support that does not yet exist (see §Multi-Company Behavior).

**Test result:** Alex was not forced to abandon two companies to use Barry. Alex was not asked to "set up" three separate accounts. Barry acknowledged the multi-company reality as normal, asked which to start with, and delivered first value for the first context.

**Current platform limitation (v1.1):** The platform currently has no tenant or organization model. All data is scoped to `users/{uid}/...`. Multi-company context isolation cannot be safely implemented today. The semantic model describes the desired behavior; the convergence matrix (see §Five-Journey Convergence Matrix) documents the gap.

**Multi-company semantic model:** See §Multi-Company Behavior below.

---

# Information Acquisition Hierarchy

Every piece of information Barry might want during the first experience is classified into exactly one of the following categories. The category determines when and how Barry acquires it.

## Classification Definitions

### Required Now
Information without which the first conversation cannot proceed:
- **Intent** — Barry must know what to do

### Conversationally Acquired
Information Barry needs for natural conversation but which does not require a form:
- **Name** — Barry should address the user by name; acquirable from authenticated context, conversational exchange, or confirmation

### Useful Now
Information that materially improves first value quality. Barry benefits from having it but can proceed without it:
- Primary company or organization
- Company website

### Inferable
Information Barry can derive from available data without asking:
- Industry (from company name, website, email domain)
- Role/title (from LinkedIn, résumé, website team page)
- Value proposition (from website)
- Target customer characteristics (from website — e.g., "who they serve," target industries, target company sizes; these describe the user's ideal customers, not the user's own company)

### Confirmable
Information Barry has inferred and should verify rather than assume:
- Industry (when inference is uncertain — "I see you're in cybersecurity — is that right?")
- Location (when multiple possibilities exist)
- Company details (when inference may be outdated)

### Optional Accelerator
Bulk intelligence inputs the user may offer. Never requested as a step. Always welcomed when given:
- LinkedIn URL
- Facebook profile
- Résumé / CV
- Free-form biography
- Company website (also classified as Useful Now because of its high inference value)
- Contact list / CRM export

### Progressively Learnable
Information Barry acquires through ongoing interaction:
- Communication style preferences
- Targeting refinements (from accept/reject on discovered companies)
- Relationship priorities (from engagement patterns)
- Business context depth (from conversations)
- Seasonal patterns
- Outcome preferences (from mission completion/abandonment patterns)

### Not Relevant to This User's Intent
Information that Barry does not attempt to acquire because the user's intent does not require it:
- ICP targeting criteria (for Engagement, Communication, Preparation, Referral, Pipeline intents)
- RECON §3 data (for non-Prospecting intents)
- Revenue ranges (unless Prospecting intent requires it for search)
- Employee count preferences (unless Prospecting intent requires it for search)
- Competitive intelligence (unless the user's operation requires it)

**The "not relevant" classification is dynamic.** If the user's intent changes, previously irrelevant information may become useful. The classification is per-intent, not per-user.

---

# Intelligence Accelerator Model

Intelligence accelerators are optional inputs that reduce the number of questions Barry needs to ask. They are the user's gift to Barry — never required, never a step, always beneficial.

## Accelerator Semantics

An accelerator is any user-provided input that contains intelligence Barry can extract, attribute, and apply to the current operation without further questions.

### Accelerator Processing Rule

> When the user provides an accelerator, Barry extracts what is useful and proceeds. A user who provides a résumé should not be asked questions the résumé already answers.

This is not a politeness rule. It is a Question Rule application: the résumé is a discovery source. Barry discovers from it. Barry does not then ask for what it already discovered.

## Accelerator Types

### LinkedIn URL
**What Barry extracts:**
- Current role and title → User scope
- Company and industry → Workspace scope
- Location → Workspace scope
- Professional experience → User scope (progressive)
- Skills and expertise → User scope
- Network size and type → context for Relationship scope later
- Education → User scope (progressive, low priority)
- Recommendations → User scope (progressive)

**What Barry does NOT extract:**
- Connection list (requires API access — not available per integration principles below)
- Private profile data
- Message history

**Confidence level:** Medium-high. LinkedIn profiles are self-reported but typically current.

### Facebook Profile
**What Barry extracts:**
- Name confirmation → User scope
- Location → User scope or Workspace scope
- Interests → User scope (progressive)
- Business pages managed → potential Workspace context

**What Barry does NOT extract:**
- Friend list (requires API access)
- Private posts
- Detailed personal information

**Confidence level:** Medium. Social profiles may be less professionally curated.

### Résumé / CV Upload
**What Barry extracts:**
- Name, title, location → User scope
- Current and past companies → Workspace scope (current), User scope (history)
- Industry expertise → User scope
- Skills → User scope
- Client types served → proto-targeting intelligence
- Achievements → Workspace context (value proposition evidence)
- Education → User scope (progressive)

**What Barry does NOT extract:**
- References / contact information (privacy boundary)
- Salary or compensation data

**Confidence level:** High. Résumés are authored documents with stated facts.

**Special property:** A résumé is the richest single-document accelerator. A user who uploads a résumé has potentially provided enough intelligence for Barry to infer industry, role, expertise depth, client types, and even proto-targeting criteria — all without a single question.

### Free-Form Biography
**What Barry extracts:**
- Whatever the user chose to say. Barry parses natural language for:
  - Name, company, role
  - Industry and expertise
  - Business goals
  - Client types or target market descriptions
  - Personal style or communication preferences
  - Current challenges or needs

**Confidence level:** High. The user authored it; attribution is direct.

**Special property:** Free-form input is the most flexible accelerator. It has no structure requirements. "I'm a freelance designer who works with startups in the Bay Area and I need help finding more clients" contains name-context, industry, location, company type, company size range, and intent.

### Company Website
**What Barry extracts:**
- Company name → Workspace scope (`companyName`)
- What the company does → Workspace scope (`description`)
- What they sell → Workspace scope (`whatTheySell`)
- Value proposition → Workspace scope (`valueProposition`)
- Who they serve → proto-targeting intelligence (`whoTheyServeTo` — describes the user's ideal customers, not the user's own company)
- Target industry → proto-targeting intelligence (`targetIndustry` — free-text, describes the types of companies the user targets)
- Target company size → proto-targeting intelligence (`targetCompanySize` — free-text, describes the size of companies the user targets, not the user's own company size)
- ICP summary → proto-targeting intelligence (`icpSummary` — synthesized description of the user's ideal customer)

**What the website does NOT reliably provide:**
- The user's own company location (not extracted by `analyze-website`)
- The user's own company employee count (not extracted; `targetCompanySize` refers to target customers)
- Competitive landscape (not extracted)
- Team information (not extracted)

**Free-text vs. structured:** Website-extracted targeting values (`targetIndustry`, `targetCompanySize`, `whoTheyServeTo`) are free-text descriptions, not structured parameters. They require translation to search-ready formats (e.g., Apollo industry codes, employee count ranges) before they can drive ICP-targeted discovery. This translation is an implementation concern.

**Confidence level:** Medium-high. Websites are public and authored, but may be outdated.

## Accelerator Processing Invariants

**ACC-1: Extract, don't interrogate.** Barry processes the accelerator and proceeds. Barry does not ask clarifying questions about the accelerator content unless it is ambiguous in a way that affects the current operation.

**ACC-2: Attribute all extracted intelligence.** Per v0.4 Principle 2, every piece of intelligence extracted from an accelerator must carry provenance ("inferred from LinkedIn profile"), confidence, and scope ownership.

**ACC-3: Accelerator intelligence is provisional until confirmed.** Inferred intelligence has lower confidence than stated intelligence. Barry may confirm key inferences ("I see from your LinkedIn that you're a VP of Sales at Acme — is that current?") but must not re-ask what is clear.

**ACC-4: No accelerator gates any operation.** Barry never says "upload your résumé before we can continue." Every accelerator is additive. No operation requires a specific accelerator.

**ACC-5: Accelerators compose.** A user who provides both a LinkedIn URL and a website gives Barry richer intelligence than either alone. Barry synthesizes rather than processing each in isolation.

**ACC-6: Accelerator status is semantic classification, not capability claim. (v1.1)** The accelerator types listed above (website, LinkedIn, Facebook/social, résumé/document, free-form biography) are semantic classifications within the intelligence acquisition model. Their inclusion here does not claim that the processing capability for each accelerator currently exists in the codebase. Missing accelerator processing is an implementation gap, not a First Experience prerequisite. The architecture should permit future accelerators to plug into the WHO/intelligence acquisition pipeline without redesigning the First Experience model. No APIs, OAuth mechanisms, parsers, schemas, or vendors are specified by this classification.

---

# Rules for When Barry May Ask vs. Infer and Confirm

These rules operationalize v0.4 Principle 1 (Barry's Question Rule) for the First Experience.

## The Hierarchy (from v0.4, restated with First Experience specifics)

### 1. Discover
Barry examines available intelligence sources without involving the user:
- Email domain → probable company
- Website → industry, size, positioning, location, value proposition
- Accelerator inputs → see Intelligence Accelerator Model
- Platform-provided data → locale, timezone, referral source

**First Experience application:** Discovery happens before and between conversation turns. Barry processes a website in the background and arrives at the next turn with inferences ready. The user experiences Barry as already informed, not as waiting for input.

### 2. Infer
Barry derives intelligence from discovered facts:
- Company name + industry → probable company size range
- Industry + location → probable competitive landscape
- Role + company size → probable sales motion type
- Accept/reject patterns → targeting preference refinement

**First Experience application:** Inferences are Barry's working hypotheses. They are good enough to act on, and acting on them produces confirmation or correction signals.

### 3. Confirm
Barry states an inference and asks the user to verify:
- "I see SecureLane is in the cybersecurity space — is that right?"
- "It looks like you're based in Austin — is that where your clients are too?"

**First Experience application:** Confirmation is the preferred question form. It demonstrates that Barry has done work, requires minimal cognitive effort from the user, and produces a binary signal (yes/no) plus optional correction.

**Rules for confirmation:**
- Confirm only when the inference materially affects the current operation
- Do not confirm trivial or low-impact inferences (confirmed location when the operation does not require it)
- Bundle confirmations when possible ("I see you're in cybersecurity, based in Austin, targeting mid-market. Does that sound right?") rather than asking one at a time
- Accept "close enough" — if the user says "yeah, more or less," treat the inference as confirmed with normal confidence

### 4. Ask
Barry poses a direct question when it cannot discover, infer, or confirm:
- "What kind of companies are you looking to reach?"
- "Who have been your best clients so far?"

**First Experience application:** Direct questions are the last resort. They are acceptable when:
- The information is required for the current operation (not for profile completeness)
- No discovery or inference path exists
- The question is specific and connected to an immediate outcome
- The user can see why Barry is asking

**Rules for asking:**
- Never ask more than one direct question per turn (confirmations are not direct questions)
- Never ask a question whose answer Barry could have discovered
- Never ask a question whose answer is not relevant to the current operation
- State why the question matters: "To find the right companies, I need to know roughly what industry you're targeting"

### 5. Learn
Barry absorbs intelligence from ongoing interaction:
- User reactions to first value
- Accept/reject decisions
- Corrections and refinements
- Communication style from written messages
- Engagement patterns

**First Experience application:** Learning is passive and continuous. Barry does not announce that it is learning. The user experiences Barry getting better over time without being told.

---

# Zero-ICP Behavior

Per v0.4-amend, ICP is capability-required, not platform-required. A Workspace with zero ICPs is a valid product state. This section defines how the First Experience operates without an ICP.

## When ICP Is Not Relevant

For intents that do not require targeting — Engagement, Communication, Preparation, Referral, Pipeline — Barry operates with full capability in a zero-ICP state. Barry does not:
- Mention ICP
- Suggest that the user should create one
- Nudge toward profile completion
- Treat the user as having an incomplete setup

The user who wants to manage their relationships has a complete, fully functional Barry. ICP is not a missing piece — it is an irrelevant concept for their current operation.

## When ICP Becomes Relevant

For Prospecting intent, ICP becomes relevant when Barry needs a targeting definition to execute a discovery search. But ICP does not appear as a configuration form. The progression is:

1. User expresses Prospecting intent
2. Barry needs targeting constraints to search
3. Barry applies the Question Rule: discover (from website, accelerators), infer (from industry, past clients), clarify if needed
4. Barry proposes a targeting definition from accumulated intelligence
5. User confirms the proposed targeting definition — this confirmation is an ICP creation event per v0.4 §1 ICP Creation Semantics, creating an explicit ICP identity
6. Barry executes ICP-targeted discovery search with the confirmed targeting definition
7. The user's reactions to results (accept/reject, refinements, corrections) progressively sharpen the targeting definition through ICP updates
8. At no point does Barry say "let's set up your ICP" or present an ICP configuration form — but confirmation always precedes ICP-targeted search

**Confirmation-before-search invariant (v1.1-b):** ICP-targeted company discovery requires a confirmed ICP identity. Every discovered company is persisted with ICP attribution. Proto-targeting intelligence may inform Barry's conversation and proposal, but it does not produce persisted company discovery on its own. This preserves the Phase 1B attribution invariant: no company-write path exists without ICP identity.

## Proto-Targeting Intelligence

Intelligence that would eventually constitute an ICP but has not yet been explicitly confirmed as a targeting definition is proto-targeting intelligence. It is:
- Accumulated through conversation, accelerators, and behavior
- Attributed per the Intelligence Rule
- Used by Barry conversationally — to propose, clarify, and refine a targeting definition before confirmation
- Not persisted as an independent intelligence object — it exists as conversational context until confirmation creates a formal ICP

Proto-targeting intelligence does not require an independent semantic identity or lifecycle. It is working context within the Question Rule progression (discover → infer → clarify → propose → confirm). It has no `icpId`, no storage path, and no consumers beyond Barry's conversational reasoning. When the user confirms a targeting definition, the confirmed definition becomes the authoritative ICP representation; the proto-targeting context that led to it is superseded, not preserved as a parallel object.

## ICP Creation Through Conversational Confirmation

Barry proposes a targeting definition when accumulated intelligence is sufficient. The confirmation may be as lightweight as a single exchange:

"It sounds like you're looking for mid-market SaaS companies. Should I search for companies like that?"

User confirmation of this proposal constitutes an authorized ICP creation event per v0.4 §1 ICP Creation Semantics. The confirmed definition becomes an `icpProfiles/{icpId}` representation with explicit ICP identity. Subsequent searches are ICP-targeted and produce attributed company discovery.

The confirmation threshold can be low — even a single confirmed industry is sufficient to create an ICP and execute an attributed search. The ICP can be refined through subsequent updates as the user reacts to results. The goal is to minimize the distance between Prospecting intent and first value while preserving attribution.

---

# Multi-Company/Organization Behavior

Working across multiple companies or organizations is normal, not an edge case. The First Experience must accommodate this from the first conversation.

## Semantic Model

Per v0.4, User and Workspace are distinct scopes. A person's identity should conceptually persist across organizational contexts. This is a semantic design principle, not a claim about current platform capability.

**Current platform limitation (v1.1):** The current platform cannot safely represent isolated multi-company contexts. All data is scoped to `users/{uid}/...` and no tenant or organization model exists. Phase 2 must not imply that independent Workspaces currently exist and does not authorize tenant architecture. The First Experience should avoid unnecessary decisions that prevent future multi-company support.

**User identity persists across organizational contexts.** Alex Park is the same person whether working on Northwind Capital, TerraGrid, or Alex Park Advisory. User-scoped intelligence (name, communication style, role history, personal preferences) is conceptually tied to the person, not to any single company context.

**Company-specific intelligence should not leak between contexts.** Each company context has its own business identity, value proposition, competitive landscape, client base, and (potentially) targeting definitions. When multi-company support becomes architecturally feasible, company-specific intelligence must not cross context boundaries.

## First Experience for Multi-Company Users

1. Barry recognizes the multi-company pattern when the user mentions multiple companies or organizations.
2. Barry asks which to start with — this is the one required decision. Barry does not ask the user to configure all companies upfront.
3. Barry establishes the first company context and delivers first value within it.
4. Barry remembers the other companies. The mechanism for context switching depends on architectural support that does not yet exist — the First Experience should not make promises about switching that the platform cannot fulfill.

## Design Principles for Future Multi-Company Support

The First Experience should avoid decisions that foreclose multi-company architecture:
- Do not hard-wire the assumption that one user = one company
- Do not store company-specific intelligence in user-global paths if a company-scoped alternative is feasible
- Do not conflate User-scoped intelligence (personal style, name) with Workspace-scoped intelligence (business identity, ICP)
- When multi-company architecture arrives, the second company should not require a separate onboarding

## Multi-Company Anti-Patterns

- Leaking client intelligence from one company context into another
- Forcing the user to choose a "primary" company
- Treating multi-company as a premium or advanced feature
- Implying that isolated multi-company contexts currently exist when they do not

---

# Integration Source Principles

Integrations (LinkedIn, email, calendar, CRM) are future intelligence sources. The First Experience must not depend on them and must not design around assumed API capabilities.

## Principles

### INT-1: No Integration Is Required for First Value

Every first value path defined above must be achievable without any third-party integration. If first value for the Communication intent requires an OAuth connection to Gmail, the design is wrong. The user can paste or forward an email. The user can name a contact. Barry works with what is available.

### INT-2: Integrations Are Intelligence Amplifiers

When an integration exists, it amplifies Barry's intelligence:
- Email integration → automatic relationship signals, communication history
- Calendar integration → automatic meeting preparation
- CRM integration → existing relationship data, pipeline state
- LinkedIn integration → richer contact and company data

But amplification is additive. The base experience is complete without it.

### INT-3: No API Capability Assumptions

This semantic model does not assume that any specific API is available, affordable, rate-unlimited, or permitted by the third party's terms of service. Integration principles describe what intelligence Barry would use if it were available — not how Barry obtains it.

Specifically:
- Do not assume LinkedIn provides programmatic profile access
- Do not assume LinkedIn provides network/connection data
- Do not assume social platforms provide public API access to profile data
- Do not assume email providers allow automated message analysis beyond what the user explicitly grants

### INT-4: User-Provided vs. API-Provided Is Transparent

A LinkedIn URL pasted by the user is a user-provided accelerator. A LinkedIn profile fetched through an API integration is API-provided intelligence. Both contain similar information, but:
- User-provided has explicit consent (the user chose to share it)
- API-provided has integration-level consent (the user authorized the connection)
- Both must be attributed per the Intelligence Rule (v0.4 Principle 2)
- Neither is more authoritative than the other — provenance differs, but both are valid sources

### INT-5: Integration Setup Is Not Part of the First Experience

If Barry benefits from an integration, Barry may mention it after delivering first value: "If you connect your email, I can start spotting follow-up opportunities automatically." But integration setup is never part of the first conversation's critical path. The user who never connects an integration still has a complete product.

---

# Anti-Patterns to Prohibit

The following patterns violate the First Experience principles and must not appear in any implementation.

### AP-1: The Setup Wizard
A multi-step form or wizard that must be completed before Barry becomes useful. Prohibited because it violates FE-1 (First Value Before First Form).

### AP-2: The Completeness Bar
A profile completeness indicator (percentage, progress bar, checklist) that implies the user has work to do before Barry is "ready." Prohibited because it violates FE-4 (No Setup Completion State).

### AP-3: The Feature Menu
Presenting Barry's capabilities as a list or menu that the user selects from before starting. Prohibited because it violates FE-5 (Intent Is the Router) — the user describes what they want; they do not browse a catalog.

### AP-4: The ICP Gate
Requiring ICP definition before any functionality is available. Prohibited because it violates the v0.4-amend ruling that ICP is capability-required, not platform-required.

### AP-5: The Intelligence Interrogation
Asking multiple questions in sequence before delivering any value. "What industry? What size? What location? What revenue range?" is an interrogation. Prohibited because it violates FE-2 (Every Input Earns Its Place) and FE-7 (Barry Confirms, Never Interrogates).

### AP-6: The Premature RECON
Launching a RECON-style questionnaire before the user has expressed an intent that requires the intelligence being collected. Prohibited because RECON is an acquisition method (v0.4 §6), not a required first step. RECON questions appear when and if their answers are needed for the current operation.

### AP-7: The Integration Prerequisite
Requiring a third-party integration (email, CRM, calendar, social) before first value can be delivered. Prohibited because it violates INT-1 (No Integration Is Required for First Value).

### AP-8: The False Choice
Presenting a limited set of user types, business types, or intent categories that the user must select from. "Are you a: Salesperson / Marketer / Founder / Other?" is a false choice. Prohibited because it flattens intent into a category and excludes users who do not fit.

### AP-9: The Silent Default
Creating an ICP, workspace configuration, or intelligence object without the user's explicit creation or confirmation. Prohibited per v0.4 §1 ICP Creation Semantics.

### AP-10: The Cross-Workspace Leak
Using intelligence from one Workspace context in another. A consulting client's proprietary information used to enrich a different client's targeting. Prohibited because it violates Workspace scope boundaries (v0.4 Part III).

### AP-11: The Interrogation Recovery
When a user provides minimal information, compensating by asking more questions rather than working with less intelligence at lower fidelity. "You haven't told me enough — let me ask you some questions" is prohibited. Barry works with what it has and gets better over time.

### AP-12: The Onboarding Trap
Any mechanism that makes the first experience substantially different from the ongoing experience. If first-time users go through a flow that returning users never see, the first experience is a separate mode rather than the first iteration of the progressive intelligence model. Prohibited because it violates FE-8 (First Experience Is Not a Separate Mode).

---

# Explicitly Undecided Questions Requiring Owner Ruling

The following questions are surfaced by this design but not decided by it. Each requires an owner ruling before implementation.

### U-1: Workspace Creation Semantics
When the user mentions a company, does Barry create a Workspace object immediately, or is Workspace creation an explicit event (analogous to ICP creation semantics in v0.4)? This matters for multi-company users — does mentioning three companies create three Workspaces, or does Workspace creation require explicit confirmation?

### U-2: Proto-Targeting Intelligence Persistence
How and where is proto-targeting intelligence stored before it becomes a confirmed ICP? It is semantically Workspace-scoped but not yet an ICP. Does it live as conversational memory, as a provisional intelligence store, or as a draft ICP object? This is a storage/schema question that this semantic model deliberately does not decide.

### U-3: Accelerator Processing Timing
When the user provides a LinkedIn URL or uploads a résumé, does Barry process it synchronously (the user waits while Barry reads it) or asynchronously (Barry acknowledges receipt and processes in the background, arriving at the next turn with extracted intelligence)? This affects conversational flow design.

### U-4: Multi-Company Workspace Switching UX
The semantic model defines that context switching is conversational. The UX question remains: is there a visual workspace indicator? Can the user switch via UI element as well as conversation? Is the workspace context persistent across sessions? These are UX decisions that this semantic model deliberately does not decide.

### U-5: First Value Quality Floor
The design states that first value quality scales with intelligence depth. Is there a minimum quality floor below which Barry should not present results? If a user provides only "tech companies" as targeting intelligence, should Barry present the broad results or say "I need at least one more constraint to give you useful results"? This is a product quality decision.

### U-6: Accelerator Privacy Boundaries
When a user uploads a résumé, what information is Barry permitted to extract? The accelerator model says "references / contact information" is a privacy boundary. Are there other boundaries? Who defines them — the platform, the user, or both?

### U-7: ICP Confirmation Proactivity
When proto-targeting intelligence reaches a coherent state, should Barry proactively propose an ICP confirmation ("Want me to save this as your targeting profile?"), or should it wait until the user asks? How often may Barry propose? What constitutes "coherent enough" to propose?

### U-8: Cross-Session Intelligence Continuity
When a user returns after days or weeks, what does Barry remember? All progressive intelligence? Only confirmed facts? Does Barry re-confirm stale inferences? This affects the distinction between the First Experience and the Returning Experience.

### U-9: Returning User Experience
This document covers the first experience. When a returning user arrives, does Barry resume from where they left off, re-greet, or adapt based on how long they've been away? The progressive intelligence model implies continuity, but the UX of that continuity is undecided.

### U-10: Intent Conflict Resolution
When the user expresses compound intent where the component intents have conflicting requirements (e.g., "I want to find new customers AND manage my existing ones"), how does Barry prioritize? The current design says "serve the most immediately actionable one first." Is that always correct? What if the user expected both to begin simultaneously?

### U-11: Accelerator Intelligence Expiration
Intelligence extracted from a LinkedIn profile or résumé may become stale. How long does inferred intelligence from an accelerator remain valid? Is there a freshness policy? Does Barry re-process an accelerator if the user provides an updated version?

### U-12: Group or Team First Experience
This document assumes a single user. When multiple users share a Workspace (a team at the same company), how does the First Experience work for the second user? Do they inherit Workspace intelligence? Do they go through their own WHO + INTENT? This intersects with Workspace creation semantics (U-1).

---

# Convergence Addendum (v1.1)

This addendum reconciles the five journey tests against repository evidence, consolidates all decision questions, identifies v0.4 interpretations required, and specifies what must be locked before Phase 2 implementation begins.

---

## Five-Journey Convergence Matrix

Each journey is tested against current repository capability. Evidence is from codebase research, not from Team A's report (which has not been committed to the repository as of this writing).

### Journey 1: The Minimalist (Jordan — name only, "tech companies")

| Requirement | Repository Support | Gap | Semantic Model Change? |
|---|---|---|---|
| Conversational intent capture | No current path maps conversational intent to a Barry routing decision. `SmartRedirect` (App.jsx:321) routes all new users to `OnboardingFlow`, which is a 6-step wizard. | **Critical gap.** Current platform assumes all users enter through a structured onboarding flow, not a conversation. | No — the model correctly describes what should happen. |
| "Tech companies" → confirm → ICP → search | `buildApolloQuery` (search-companies.js:659) can run with just `industries: ["technology"]` as keyword tags. Technically functional. Confirmation-before-search (v1.1-b) means conversational targeting → user confirmation → ICP creation → search. | **Wiring gap.** No current path converts conversational confirmation into the `companyProfile`/`icpProfiles` object and then to `search-companies.js:237`. | No — model describes confirmation-to-search correctly. |
| No completion-flag gate | `useOnboardingState` (useOnboardingState.js:75-81) has a 7-day safety valve: accounts older than 7 days are treated as "complete." New users ARE gated by onboarding flow. | **Anti-pattern conflict.** Current `OnboardingFlow` is AP-1 (Setup Wizard) and AP-12 (Onboarding Trap). | No — model correctly prohibits this. Implementation must resolve. |

**Owner ruling required?** No for the semantic model. Implementation must build the conversational-to-search bridge.

### Journey 2: The Website Provider (Priya — name + website, Prospecting)

| Requirement | Repository Support | Gap | Semantic Model Change? |
|---|---|---|---|
| Website analysis | **EXISTS.** `analyze-website.js` (658 lines) fetches URL, strips HTML, sends to Claude, extracts `companyName`, `description`, `whatTheySell`, `whoTheyServeTo`, `targetIndustry`, `targetCompanySize`, `valueProposition`, `icpSummary`. | None — capability exists. | No. |
| Extracted targeting → search | Website analysis stores `targetIndustry` and `targetCompanySize` under `modules[recon].websiteAnalysis` sub-object. `buildApolloQuery` reads from `companyProfile` object. **These are different paths.** | **Wiring gap.** Website-extracted targeting intelligence does not reach the search function. `targetIndustry` from website analysis is stored but never promoted to the `companyProfile.industries` field that `buildApolloQuery` reads. | No — model correctly describes website as accelerator. Gap is implementation wiring. |
| Confirm rather than ask | No current path supports confirmation-then-search from website inferences. `OnboardingFlow` Step 3 ("smart questions") asks additional questions after website analysis, even when the website already answered them. | **Partial conflict with FE-7.** Current flow asks questions the website may have already answered rather than confirming inferences. | No — model correctly prohibits re-asking. |

**Owner ruling required?** No for the semantic model. Implementation must wire website analysis output to search parameters.

### Journey 3: The Networker (Marcus — engagement + referrals, no ICP needed)

| Requirement | Repository Support | Gap | Semantic Model Change? |
|---|---|---|---|
| Non-prospecting intent path | No current routing supports non-prospecting intent. `SmartRedirect` sends all new users to `OnboardingFlow`, which is prospecting-oriented (Step 5: "build list", Step 6: "show first prospects"). | **Critical gap.** The current platform has no first experience for users who do not want to prospect. | No — model correctly defines non-prospecting paths. |
| Contact-based first value | Contact data at `users/{uid}/contacts`. New user has zero contacts. First value requires user to name contacts or import them. CSV upload, business card capture, and LinkedIn import exist. | **Realistic constraint.** First value for Engagement intent genuinely requires at least one contact to exist. The model is honest about this ("access to the user's contacts or at least one named contact"). | No. |
| Zero-ICP non-blocking | `getActiveIcpId` falls back to `DEFAULT_ICP_ID = 'default'`. Several surfaces read this fallback without checking whether a real ICP exists. | **Defect, not a gap.** The silent default violates v0.4 ICP Availability States. Non-prospecting surfaces should not encounter ICP resolution at all. | No — v0.4 already governs this. |

**Owner ruling required?** P-6 below: how does Barry deliver Engagement first value when the user has zero contacts? This is a product scope question — is "name a contact and I'll research them" sufficient first value, or must Barry have pre-existing contact data?

### Journey 4: The Aspiring Prospector (Dana — no website, no ICP, targeting uncertainty)

| Requirement | Repository Support | Gap | Semantic Model Change? |
|---|---|---|---|
| Conversational targeting from past clients | No current path extracts targeting intelligence from conversational description of past clients. `BarryOnboarding` uses a Claude-powered conversational ICP builder, which is the closest analog — but it saves to `companyProfile/current` and is labeled "legacy." | **Partial support.** `BarryOnboarding.handleConfirm()` is the only existing path that creates a formal ICP from conversation. But it follows its own multi-step flow, not the progressive confirmation model this design describes. | No — model describes the semantic process correctly. `BarryOnboarding` is evidence that conversational ICP creation has been attempted, but the current implementation doesn't match the progressive model. |
| Search with minimal targeting | `buildApolloQuery` can execute with minimal filters. `adaptiveSignals.savedIndustries` (search-companies.js:693-699) can bias results toward historically accepted industries. | **Partial support.** Adaptive signals exist but only apply after the user has accepted companies in prior batches — not available for first search. | No. |
| Proto-targeting → progressive refinement | No current mechanism stores proto-targeting intelligence as a distinct concept. Intelligence is either a formal ICP in `companyProfile/current` or nothing. | **Resolved by v1.1-b.** Proto-targeting is conversational context, not a stored object. Confirmation creates a formal ICP — no intermediate persistence needed. Progressive refinement updates the existing ICP. | No. |

**Owner ruling required?** U-5 (quality floor) applies — is a single-industry search sufficient first value?

### Journey 5: The Multi-Company Operator (Alex — three companies)

| Requirement | Repository Support | Gap | Semantic Model Change? |
|---|---|---|---|
| Multi-company awareness | No tenant or organization model exists. `ShellContext.jsx:327-332` explicitly documents: "Idynify has no tenant/organization model today; all data is scoped `users/{uid}/...`" | **Fundamental architecture gap.** Multi-company is aspirational, not current capability. | **Yes — v1.1 amendment applied.** Multi-company section now explicitly states the platform limitation and does not imply current tenancy. |
| Context switching | Not possible today. All data is user-scoped. No mechanism to isolate one company's data from another within a single user account. | **Not achievable without architecture.** | No further change — v1.1 amendment addresses this. |
| User identity persistence across contexts | User identity (`users/{uid}`) already persists since there is only one context per user. The distinction between User and Workspace is conceptual in v0.4 but not architecturally enforced. | **Conceptually aligned, architecturally unimplemented.** | No. |

**Owner ruling required?** Multi-company architecture is a FUTURE ARCHITECTURE question. The semantic model now correctly avoids implying current capability. Implementation may offer a graceful acknowledgment ("I can help with one company context at a time right now") rather than a multi-company switching flow.

---

## Repository Evidence: Competing Onboarding Authorities

Four onboarding paths exist in the current codebase, creating genuine overlap:

| Component | Route | What It Does | Completion Flag | Creates ICP? |
|---|---|---|---|---|
| `OnboardingFlow` | `/onboarding` | 6-step wizard (Meet Barry → Website analysis → Smart questions → Gmail → Build list → First prospects) | `onboarding.completed` (nested) | No — populates RECON fields, not `companyProfile` |
| `BarryOnboarding` | `/onboarding/barry` (labeled "legacy") | Conversational ICP builder via Claude | `onboardingComplete` (root) | Yes — saves to `companyProfile/current` |
| `ReconOnboardingWizard` | `/onboarding/recon` | 5-module RECON depth wizard | `onboardingComplete` (root) | No |
| `GettingStarted` | `/getting-started` | Static informational page | None | No |

**Competing completion flags:** `SmartRedirect` (App.jsx:321) checks BOTH `userData?.onboardingComplete || userData?.onboarding?.completed`. Two different flag schemas compete for the same semantic: "has this user been onboarded?"

**Semantic model implications:** All four paths conflict with FE-4 (No Setup Completion State), FE-8 (First Experience Is Not a Separate Mode), and AP-1 (The Setup Wizard). The semantic model correctly prohibits these patterns. The existence of four competing flows is implementation debt, not a semantic model deficiency. Which flow (if any) survives is an implementation decision that must align with this semantic model.

---

## Repository Evidence: RECON Question Consumption

| Section | Name | Weight | Client-side `RECON_SECTION_MAP` | Server-side `compileReconForPrompt` |
|---|---|---|---|---|
| §1 | Business Foundation | 25% | Yes (`icp`) | Yes |
| §2 | Product Deep Dive | 20% | Yes (`valueProposition`) | Yes |
| §3 | Target Market | 15% | No | Yes |
| §4 | Psychographics | 5% | Yes (`psychographics`) | Yes |
| §5 | Pain Points | 15% | Yes (`painPoints`) | Yes |
| §6 | Buying Behavior | 3% | No | Yes |
| §7 | Decision Process | 3% | No | Yes |
| §8 | Competitive Landscape | 3% | No | Yes |
| §9 | Messaging | 10% | Yes (`outreachContext`) | Yes |
| §10 | Behavioral Signals | 1% | No | Yes |

**Implication for First Experience:** The semantic model classifies RECON as an acquisition method (per v0.4 §6), not a First Experience prerequisite (AP-6). The current `OnboardingFlow` treats RECON-like questions as a setup step — "smart questions" in Step 3 populate RECON Section 1 fields. The semantic model says these questions should appear when and if their answers are needed for the current operation, not as a setup gate.

---

## Consolidated Decision Registry

All U-questions (from v1.0) and P-questions (derived from repository evidence cross-read) are consolidated, duplicates merged, and each classified.

### MUST DECIDE BEFORE IMPLEMENTATION

These decisions block Phase 2 implementation. Without them, the implementation has no clear target.

| ID | Question | Source | Why Blocking |
|---|---|---|---|
| **D-1** | **Onboarding authority resolution.** Which onboarding path(s) survive? Four competing flows exist with two different completion flags. The First Experience semantic model prohibits setup wizards (AP-1) and completion states (FE-4). Must the current flows be retired, adapted, or replaced? | U-1, P-3 | Cannot build the First Experience while four competing flows contest the same entry point. |
| **D-2** | **~~Proto-targeting intelligence persistence.~~** **RESOLVED by v1.1-b.** Proto-targeting intelligence does not require independent persistence. It is conversational context used by Barry to propose a targeting definition. Confirmation creates a formal ICP; no intermediate storage object is needed. The conversation-to-search path is: proto-targeting (conversational) → user confirmation → ICP creation → ICP-targeted search. | U-2, P-1 | ~~Resolved~~ — no longer blocking. |
| **D-3** | **Website analysis → search wiring.** Website analysis extracts `targetIndustry` and `targetCompanySize` but stores them in `websiteAnalysis` sub-object, disconnected from `buildApolloQuery`. Must the wiring be built as Cat 1 reconciliation, or does it require schema changes (Cat 2)? | P-2 | Journey 2 (Website Provider) cannot deliver first value without this wiring. |
| **D-4** | **DEFAULT_ICP_ID disposition.** The `'default'` fallback in `getActiveIcpId` violates v0.4 ICP Availability States. What replaces it? Must every consumer handle `no-profiles` / `none-active` / `read-failed` explicitly? | P-4 | Zero-ICP behavior throughout the platform depends on how the silent default is retired. |
| **D-5** | **Non-prospecting intent routing.** Current platform routing (`SmartRedirect` → `OnboardingFlow`) assumes all users are prospectors. How do Engagement, Communication, Preparation, and other non-prospecting intents reach their first value without passing through a prospecting-oriented onboarding? | P-5 | Journeys 1 (Exploration), 3 (Networker), and any non-prospecting intent cannot reach first value through the current routing. |
| **D-6** | **First value quality floor.** Is there a minimum targeting intelligence threshold below which Barry should not execute a search? Apollo returns broad results with zero filters. Is a single-industry search ("tech companies") sufficient first value, or must Barry acquire at least N targeting constraints? | U-5, P-7 | Journeys 1 and 4 depend on whether broad search results constitute meaningful first value. |

### OWNER BUSINESS DECISIONS

These are product and business decisions that the semantic model surfaces but cannot make.

| ID | Question | Source | Nature |
|---|---|---|---|
| **D-7** | **Engagement first value for zero-contact users.** A new user with Engagement intent has zero contacts. Is "name a contact and I'll research them" sufficient first value? Or must Barry have pre-existing contact data? | P-6 | Product scope — defines the minimum viable Engagement experience. |
| **D-8** | **Cross-session intelligence continuity.** When a user returns after days or weeks, what does Barry remember? All progressive intelligence? Only confirmed facts? Does Barry re-confirm stale inferences? | U-8 | Product policy — defines the returning user contract. |
| **D-9** | **Returning user experience.** Does Barry resume from where they left off, re-greet, or adapt based on time away? | U-9 | Product UX — closely related to D-8. |
| **D-10** | **Intent durability → Mission promotion.** Should the intent→Mission semantic boundary described in this document's Intent Durability section be adopted as a v0.4 interpretation? | v1.1 | Semantic governance — recommended for owner ruling. See v0.4 interpretation below. |
| **D-11** | **Whether Barry provides meaningful value before payment.** | Owner instruction | Business model decision. This semantic model does not decide it. |
| **D-12** | **ICP confirmation proactivity.** When proto-targeting intelligence is coherent, should Barry proactively propose an ICP, or wait for the user? How often? What threshold? | U-7 | Product behavior — defines Barry's assertiveness. |

### MAY DEFER

These may be deferred past initial implementation without blocking the First Experience.

| ID | Question | Source | Why Deferrable |
|---|---|---|---|
| **D-13** | **Accelerator processing timing.** Synchronous vs. asynchronous processing of LinkedIn URLs, résumés, etc. | U-3 | Implementation detail. Can start with synchronous and optimize later. |
| **D-14** | **Accelerator privacy boundaries.** What information may Barry extract from a résumé? Are there boundaries beyond references/contact information? | U-6 | Can start with reasonable defaults (exclude references, salary, sensitive personal data). |
| **D-15** | **Intent conflict resolution.** How does Barry handle compound intents with conflicting requirements? | U-10 | Edge case. "Serve the most actionable first" is a sufficient starting heuristic. Observable before deciding. |
| **D-16** | **Accelerator intelligence expiration.** How long does inferred intelligence from accelerators remain valid? | U-11 | Can start without expiration. Freshness policy can be added when staleness is observable. |

### FUTURE ARCHITECTURE

These require architectural work that is beyond Phase 2 scope.

| ID | Question | Source | Dependency |
|---|---|---|---|
| **D-17** | **Multi-company workspace switching.** Visual workspace indicator, UI switching, context persistence. | U-4 | Requires tenant/organization model that does not exist. |
| **D-18** | **Team / group first experience.** How does the second user on a team inherit Workspace intelligence? | U-12 | Requires multi-user workspace architecture. |
| **D-19** | **RECON capability bypass interaction.** `reconCapability.js` instructs Barry "Do NOT tell the user their ICP is 'not configured'" when RECON score >= 60%. How does this interact with zero-ICP semantics? | P-8 | Cat 1 reconciliation work — must align with D-4 (DEFAULT_ICP_ID disposition). |

---

## v0.4 Interpretations Required

### Interpretation 1: Intent Is Not an Intelligence Type

v0.4 defines six intelligence types in Part I (ICP, Match, Coverage, User Judgment, Eligibility, RECON). Intent as defined in this document is not a seventh type — it is routing intelligence that determines what Barry does, not a stored intelligence artifact with the five properties required by Principle 2 (ownership, provenance, confidence, freshness, purpose).

**Assessment:** No v0.4 conflict. Intent operates at a different layer than the intelligence types. If intent ever requires persistence and attribution (e.g., for the returning user experience), it would need to satisfy the Intelligence Rule — but that is a future decision (D-8, D-9), not a current requirement.

### Interpretation 2: Intent → Mission Promotion Boundary

Current intent is ephemeral routing intelligence. An objective that persists across sessions and becomes something Barry tracks may be promoted to Mission intelligence (v0.4 Part III, Mission scope).

**Assessment:** Compatible with v0.4. The contract defines Mission scope but does not define when or how an objective becomes a Mission. This interpretation adds a semantic boundary that v0.4 implies but does not state: routing intent is not Mission; a durable, tracked objective is. v0.4 Part VI item 9 (Mission as first-class object) remains explicitly undecided — this interpretation does not decide storage, only the semantic threshold.

**Recommendation:** Adopt as a v0.4 interpretation if owner approves (D-10).

### Interpretation 3: Proto-Targeting Intelligence and v0.4 ICP Creation Semantics

v0.4 §1 states: "An ICP must originate from an explicit creation or confirmation event." This document introduces proto-targeting intelligence — conversational context Barry uses to propose a targeting definition before confirmation.

**Assessment:** Compatible with v0.4. Proto-targeting intelligence is not an ICP, not a stored intelligence object, and not a provisional targeting artifact. It has no independent identity, no `icpId`, no storage path, and no consumers beyond Barry's conversational reasoning. It is conversational context — the working hypothesis Barry builds through dialogue to propose a targeting definition. It becomes an ICP only when the user explicitly confirms a targeting definition — satisfying v0.4's creation semantics.

**Boundary condition:** Proto-targeting intelligence must never be silently promoted to a formal ICP. The boundary between "Barry's working hypothesis about your targeting" and "your confirmed targeting profile" must be explicit and user-visible. Silent promotion would violate both v0.4 ICP Creation Semantics and AP-9 (The Silent Default).

**v1.1-b clarification:** No provisional targeting object is required. Proto-targeting does not need persistence, a schema, or independent identity. D-2 (proto-targeting persistence question) is resolved: proto-targeting is conversational context only.

### Interpretation 4: Confirmation-Before-Search Invariant (P-9)

v0.4 §1 ICP Creation Semantics require an explicit creation or confirmation event. The live codebase enforces this: `search-companies.js` returns `400 ICP_REQUIRED` when no `icpId` is present, and every discovered company is persisted with ICP attribution via `buildApolloQuery`.

**Assessment:** The confirmation-before-search sequence is not merely a semantic preference — it is an invariant required by both the contract and the live codebase. The sequence is:

1. Proto-targeting (conversational context) — Barry builds a working hypothesis
2. User confirmation — explicit event satisfying v0.4 ICP Creation Semantics
3. ICP creation — `BarryOnboarding.handleConfirm()` or equivalent authorized boundary
4. ICP-targeted search — `search-companies` with valid `icpId`

Proto-targeting alone cannot produce persisted company discovery. No unattributed company-write path exists in the current codebase.

**v0.4 compatibility:** This invariant strengthens v0.4's Attribution Invariant (Principle 5) by ensuring no company intelligence enters the system without ICP attribution. It does not conflict with any v0.4 provision.

---

## Decisions That Must Be Locked Before Phase 2 Implementation

The following five decisions (D-1, D-3 through D-6) are implementation-blocking. D-2 (proto-targeting persistence) was resolved by v1.1-b: proto-targeting is conversational context only, requiring no persistence or provisional object. Without the remaining five decisions, the First Experience cannot be built because the implementation has no clear target for:

1. **Entry point** (D-1, D-5) — what the user sees when they arrive
2. **Intelligence storage** (D-3) — where website-inferred intelligence lives
3. **ICP fallback behavior** (D-4) — what happens platform-wide when no ICP exists
4. **Quality threshold** (D-6) — what constitutes sufficient first value for Prospecting

Owner business decisions (D-7 through D-12) inform product behavior but do not block the core architecture. Deferrable decisions (D-13 through D-16) can be resolved during implementation. Future architecture decisions (D-17 through D-19) are explicitly out of Phase 2 scope.

---

*This document was produced by Team B. No code was written or changed during its production. This is a semantic design document only.*

*Status: Returned for convergence — v1.1-b. No implementation is authorized by this document. Decisions D-1, D-3 through D-6 must be locked before Phase 2 implementation (D-2 resolved by v1.1-b). Owner business decisions D-7 through D-12 are requested. v0.4 interpretation on intent durability (D-10) recommended for owner ruling.*
