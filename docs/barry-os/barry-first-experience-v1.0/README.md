# Barry First Experience — Semantic Design v1.0

**Idynify · First Experience Semantic Model · Team B**
**Date: 2026-08-19**
**Repository: aepwiley13/idynify-scout**
**Governing Contract: Barry Intelligence Contract v0.4-amend**
**Status: Returned for convergence**

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
| **Name** | Required now | Barry must address the user. Cannot be inferred. Minimum social contract. |
| **Primary company or organization** | Useful now | Provides workspace grounding. Enables website inference. Not required — a user may be between companies, independent, or not ready to share. |
| **Company website** | Optional accelerator | High-value inference source. Barry can discover industry, positioning, company size, location, and competitive landscape from a website. Not required — many users do not have one, and its absence is not blocking. |
| **Email address** | Required now (platform) | Authentication artifact. Not intelligence Barry asks for — the platform provides it. Barry may infer domain → company from it. |
| **Role or title** | Inferable / confirmable | Inferable from LinkedIn, résumé, or website team page. Barry confirms rather than asks. |
| **Industry** | Inferable | Inferable from company name, website, or domain. Barry confirms if uncertain. |
| **Location** | Inferable | Inferable from website, IP, LinkedIn, or company data. Progressively learnable. |
| **Company size** | Inferable | Inferable from website, LinkedIn, or public data. Not asked. |
| **Years in business** | Not relevant now | Never asked. Progressively learnable if relevant to a future operation. |
| **Photo/avatar** | Not relevant now | Never asked. Platform-supplied or progressively available. |

### WHO Semantic Properties

**WHO intelligence is User-scoped.** The name, role, and personal context belong to the User (v0.4 scope), not to the Workspace. A user who works across multiple companies carries the same WHO identity.

**Company is Workspace intelligence.** When the user provides a company, that grounds a Workspace (v0.4 scope). The user's relationship to the company is User intelligence; the company itself is Workspace intelligence. This distinction matters for multi-company users (see §Multi-Company Behavior).

**WHO is not a profile.** Barry does not build a "user profile" from WHO. WHO establishes the minimum conversational ground truth: I know who I am talking to. Everything else is progressive intelligence, acquired through the Question Rule.

---

# INTENT Semantic Model

INTENT answers the question: "What does the user want to accomplish?"

Intent is expressed in human terms. The user never needs to know what Barry's modules are called, what capabilities exist, or how the platform is organized. The user says what they want; Barry maps that to what Barry can do.

## Intent Is Not a Menu Selection

The user does not choose from a list of capabilities. They describe what they want. Barry's job is to understand. If the user says "I need more clients," Barry understands that as a discovery intent — the user does not need to know the word "discovery" or "Scout."

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

**Compound intent is normal.** Most users want more than one thing. Barry serves the most actionable intent first and remembers the others. "I want to find new clients and also keep in touch with my existing network" — Barry starts with whichever is more immediately actionable (typically Engagement, because it requires less setup) and returns to Prospecting when the user is ready.

---

# FIRST VALUE Definition

First value is the earliest moment when Barry delivers something the user finds genuinely useful. It is not a demo. It is not a sample. It is a real outcome the user could not have produced as easily without Barry.

## First Value by Intent Type

| Intent | First Value | What Barry Needs | What Barry Does NOT Need |
|---|---|---|---|
| **Prospecting** | A small set of relevant companies based on whatever targeting intelligence Barry has — even if only industry and location inferred from a website | At minimum, one inferable or stated targeting constraint | A fully specified ICP. A completed RECON. Any structured profile. |
| **Engagement** | An insight about one of the user's existing contacts — a recent event, a follow-up suggestion, a conversation starter | Access to the user's contacts or at least one named contact | A contact database import. A completed relationship map. |
| **Communication** | An analyzed email with a suggested response or talking points | One email to analyze (forwarded, pasted, or connected) | Email integration setup. OAuth flow. |
| **Preparation** | A briefing on an upcoming meeting — who the person is, what they care about, what to discuss | One meeting or one person to prepare for (named or from calendar) | Calendar integration. Full relationship history. |
| **Referral** | Identification of a potential introduction path between two people the user knows | At least two contacts or relationships in context | A full network map. CRM integration. |
| **Pipeline** | A status snapshot of a named relationship — where things stand, what to do next | One named contact or company with any history | A complete pipeline import. |
| **Outreach** | A draft message to a specific person incorporating whatever Barry knows about them | A named recipient and an intent (introduce, follow up, pitch, etc.) | A completed ICP. A messaging strategy. RECON completion. |
| **Exploration** | An orientation brief showing what Barry can see and do with what Barry currently knows about the user | WHO baseline (name + whatever else was provided) | Nothing beyond WHO. Barry demonstrates capability from whatever intelligence exists. |

### First Value Invariants

**FV-1: First value must be reachable within the first conversation.** If the user provides WHO and INTENT, Barry must deliver first value without requiring the user to leave, complete a form, or return later.

**FV-2: First value quality scales with intelligence depth.** A user who provides a website gets a better first Prospecting result than one who provides only a name. But both get a result. The user who provided less sees a useful outcome and understands that providing more produces better outcomes — without Barry lecturing about it.

**FV-3: First value is real, not simulated.** Barry does not show fake data, sample results, or demo content. First value uses whatever real intelligence is available, even if that intelligence is minimal.

**FV-4: First value acknowledges its own limitations.** When Barry delivers a result from limited intelligence, Barry says so: "Based on what I can see, here are three companies that might fit. As I learn more about what you're looking for, these will get sharper." This is honesty, not an apology.

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
- Name (asked — the one required question)
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
4. First value: Barry delivers an orientation brief. "Here's what I can help with: finding new business, managing relationships, preparing for meetings, writing outreach. What sounds closest to what you need?" This is not a feature list — it is Barry demonstrating that it is ready to work, not waiting for configuration.
5. Jordan says: "I guess finding new business."
6. Intent reclassified: **Prospecting**.
7. Barry needs a targeting constraint but has none. Barry asks the minimum: "What kind of companies are you looking to reach? Even a general direction helps — like 'tech startups' or 'local restaurants.'"
8. Jordan says: "Tech companies."
9. Barry can now deliver a Prospecting first value: a set of companies in the tech industry. Results are broad because targeting intelligence is minimal. Barry acknowledges this: "Here are some tech companies I found. As I learn more about the kind of tech company you're looking for — size, location, specific niche — I can narrow this down."

**Test result:** Jordan reached first value (a set of real companies) with only a name and two conversational exchanges. No form. No profile completion. No ICP configuration screen. Barry asked for one thing it could not infer (industry targeting direction) because the intent required it.

**ICP state:** `no-profiles` (valid). If Jordan continues to refine and eventually confirms a targeting definition, that constitutes an authorized ICP creation event per v0.4 §1 ICP Creation Semantics.

---

## Journey 2: The Website Provider

**Profile:** Gives Barry their name and company website.
**Intent:** "I want to find new customers."

**WHO intelligence after first exchange:**
- Name: "Priya" (stated)
- Company website: "www.securelane.io" (stated)
- Company: "SecureLane" (inferred from website)
- Industry: "Cybersecurity" (inferred from website content)
- Company size: ~50 employees (inferred from website team page / public data)
- Location: Austin, TX (inferred from website footer / contact page)
- Value proposition: "Cloud security platform for mid-market enterprises" (inferred from website)

**Barry's path:**
1. Barry greets Priya by name. Asks what brings them here.
2. Priya says: "I want to find new customers."
3. Intent classification: **Prospecting**.
4. Barry has inferred substantial Workspace intelligence from the website. Barry confirms rather than asks: "I can see SecureLane is a cloud security platform based in Austin, focused on mid-market enterprises. Is that right?"
5. Priya confirms (or corrects — any correction becomes canonical).
6. First value: Barry delivers a targeted set of mid-market companies that might need cloud security — using the inferred industry, company size range, and positioning from the website. This is a materially better result than Journey 1 because of the website accelerator.
7. Barry notes what it does not yet know: "I'm using what I found on your website to target this search. Once you tell me more about your ideal customer — or just react to these results — I can get much sharper."

**Test result:** Priya reached first value with a name, a website, and one conversational confirmation. The website accelerator eliminated multiple questions. Barry demonstrated the Question Rule: discover (website), infer (industry, size, positioning), confirm ("Is that right?"), ask nothing.

**ICP state:** `no-profiles`, but Barry has accumulated proto-targeting intelligence. If Priya confirms a targeting definition through continued refinement, that constitutes an authorized ICP creation event.

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
7. Barry can now infer proto-targeting intelligence: local businesses, service businesses, small-to-medium, probably in the user's metro area. Barry confirms: "It sounds like local businesses — restaurants, maybe other service businesses — have been a good fit. Should I look for more companies like those?"
8. Dana says: "Yeah, and maybe some event venues too."
9. First value: Barry delivers a set of local restaurants, service businesses, and event venues near Dana's inferred location. These are real results, not perfect results. Barry says: "Here's a first batch. As you tell me which ones look interesting and which don't, I'll learn your taste."

**Test result:** Dana reached first value without ever encountering the word "ICP," completing a form, or explicitly defining targeting criteria. Barry extracted targeting intelligence from Dana's existing experience using the Question Rule. Future accept/reject decisions on these results become User Judgment (v0.4 §4) and progressive targeting intelligence.

**ICP state:** `no-profiles`. Barry has accumulated proto-targeting intelligence from conversation. When (if) this intelligence is confirmed as a targeting definition by the user, it becomes an authorized ICP creation event.

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
3. Barry recognizes the multi-company pattern. Barry does not force Alex to pick one. Barry says: "I can work with you across all three. Which one should we start with?"
4. Alex says: "Let's start with my advisory — I need to find new clients."
5. Intent for first context: **Prospecting** (for Alex Park Advisory).
6. Barry proceeds with the Prospecting flow for the advisory, treating it as the active Workspace context.
7. Barry remembers the other two companies. When Alex is ready, Barry can switch context: "Ready to work on Northwind Capital or TerraGrid?"

**Test result:** Alex was not forced to abandon two companies to use Barry. Alex was not asked to "set up" three separate accounts. Barry acknowledged the multi-company reality as normal, asked which to start with, and delivered first value for the first context while preserving the others.

**Multi-company semantic model:** See §Multi-Company Behavior below.

---

# Information Acquisition Hierarchy

Every piece of information Barry might want during the first experience is classified into exactly one of the following categories. The category determines when and how Barry acquires it.

## Classification Definitions

### Required Now
Information without which the first conversation cannot proceed. There are exactly two:
- **Name** — Barry must address the user
- **Intent** — Barry must know what to do

### Useful Now
Information that materially improves first value quality. Barry benefits from having it but can proceed without it:
- Primary company or organization
- Company website

### Inferable
Information Barry can derive from available data without asking:
- Industry (from company name, website, email domain)
- Location (from website, IP locale, company data)
- Company size (from website, public data)
- Role/title (from LinkedIn, résumé, website team page)
- Value proposition (from website)
- Competitive landscape (from website + industry inference)

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
- Company name, industry, positioning → Workspace scope
- Products/services → Workspace scope
- Company size indicators → Workspace scope
- Location → Workspace scope
- Value proposition → Workspace scope
- Competitive positioning → Workspace scope
- Client types or case studies → proto-targeting intelligence
- Team information → Workspace scope

**Confidence level:** Medium-high. Websites are public and authored, but may be outdated.

## Accelerator Processing Invariants

**ACC-1: Extract, don't interrogate.** Barry processes the accelerator and proceeds. Barry does not ask clarifying questions about the accelerator content unless it is ambiguous in a way that affects the current operation.

**ACC-2: Attribute all extracted intelligence.** Per v0.4 Principle 2, every piece of intelligence extracted from an accelerator must carry provenance ("inferred from LinkedIn profile"), confidence, and scope ownership.

**ACC-3: Accelerator intelligence is provisional until confirmed.** Inferred intelligence has lower confidence than stated intelligence. Barry may confirm key inferences ("I see from your LinkedIn that you're a VP of Sales at Acme — is that current?") but must not re-ask what is clear.

**ACC-4: No accelerator gates any operation.** Barry never says "upload your résumé before we can continue." Every accelerator is additive. No operation requires a specific accelerator.

**ACC-5: Accelerators compose.** A user who provides both a LinkedIn URL and a website gives Barry richer intelligence than either alone. Barry synthesizes rather than processing each in isolation.

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

For Prospecting intent, ICP becomes relevant when Barry needs a targeting definition to execute a discovery search. But ICP does not appear as a configuration step. The progression is:

1. User expresses Prospecting intent
2. Barry needs targeting constraints to search
3. Barry applies the Question Rule: discover (from website, accelerators), infer (from industry, past clients), confirm ("companies like these?")
4. When Barry has enough targeting intelligence to produce useful results, Barry searches
5. The user's reactions to results (accept/reject, refinements, corrections) progressively sharpen targeting
6. At no point does Barry say "let's set up your ICP" or present an ICP configuration form

## Proto-Targeting Intelligence

Intelligence that would eventually constitute an ICP but has not yet been explicitly confirmed as a targeting definition is proto-targeting intelligence. It is:
- Accumulated through conversation, accelerators, and behavior
- Attributed per the Intelligence Rule
- Used for searches with appropriate confidence acknowledgment
- Not yet an ICP object — it becomes one when the user confirms a targeting definition

## ICP Creation Through Progressive Confirmation

When proto-targeting intelligence reaches a coherent state — Barry has enough accumulated intelligence to propose a targeting definition — Barry may offer a confirmation event:

"Based on what I've learned, it seems like you're looking for mid-market SaaS companies in North America with 50–500 employees. Want me to use that as your targeting profile going forward?"

User confirmation of this proposal constitutes an authorized ICP creation event per v0.4 §1 ICP Creation Semantics.

This is not a required step. A user may use proto-targeting intelligence indefinitely without ever confirming a formal ICP. Confirmation is a convenience that improves consistency, not a gate that blocks functionality.

---

# Multi-Company/Organization Behavior

Working across multiple companies or organizations is normal, not an edge case. The First Experience must accommodate this from the first conversation.

## Semantic Model

Per v0.4, User and Workspace are distinct scopes. A single User may be associated with multiple Workspaces. This is the foundational distinction.

**User identity persists across Workspaces.** Alex Park is the same person whether working on Northwind Capital, TerraGrid, or Alex Park Advisory. User-scoped intelligence (name, communication style, role history, personal preferences) travels with the user.

**Workspace intelligence is Workspace-specific.** Each company has its own business context, value proposition, competitive landscape, client base, and (potentially) targeting definitions. Workspace-scoped intelligence does not leak between companies.

## First Experience for Multi-Company Users

1. Barry recognizes the multi-company pattern when the user mentions multiple companies or organizations.
2. Barry asks which to start with — this is the one required decision. Barry does not ask the user to configure all companies upfront.
3. Barry establishes the first Workspace context and delivers first value within it.
4. Barry remembers the other companies and makes switching natural: "Ready to work on TerraGrid?" — not "Please configure your next workspace."

## Context Switching

Workspace context switching is a natural part of multi-company operation:
- Barry maintains awareness of which Workspace is active
- Switching is conversational: "Let's focus on Northwind" or "What about TerraGrid?"
- User-scoped intelligence persists across switches
- Workspace-scoped intelligence is scoped to the active Workspace
- ICP, Match, and Eligibility are Workspace-and-ICP-scoped — they do not transfer between Workspaces

## Multi-Company Anti-Patterns

- Requiring the user to "set up" each company before using it
- Treating the second company as a separate onboarding
- Leaking client intelligence from one company into another company's context
- Forcing the user to choose a "primary" company
- Treating multi-company as a premium or advanced feature

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

*This document was produced by Team B. No code was written or changed during its production. This is a semantic design document only.*

*Status: Returned for convergence. No implementation is authorized by this document. Owner rulings on U-1 through U-12 are requested before implementation design begins.*
