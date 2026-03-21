# Client Onboarding: Laura — March 20, 2026

_Session length: 32 minutes | Recorded | New user (first session)_

---

## Session Overview

Laura is a new client completing her first onboarding. This session is a live view of how a real user navigates the platform without prior training. Aaron guided her through ICP setup, Barry's company generation, contact discovery, and the engagement flow.

**Modules touched:** Scout → ICP Settings → Talk to Barry → Scout+ (saved companies) → People → Engagement

---

## 1. User Behavior Observations

These are the behavioral signals worth carrying into product decisions.

**A. She thinks in segments, not one ICP**
- Immediately identified two distinct audiences: Hospitality (existing contacts) and Startups (growth target)
- Her instinct: "These are two different battles — we shouldn't mix up the messaging"
- This is how real sellers think. The platform currently doesn't reflect this mental model.

**B. She is validation-driven, not trust-driven**
- Did not blindly accept Barry's output
- Cross-checked every company on their website and LinkedIn
- Checked contact titles before saving
- The platform needs to earn trust through accuracy, not assume it.

**C. She is outcome-oriented, not feature-oriented**
- She wants: find the right companies → find the right people → start outreach
- She does not care about: how Barry works, platform internals, upcoming features
- Feature explanations during onboarding slow her down

**D. She filters fast and expects the system to learn**
- Quickly rejected: "I don't want a magazine", "Not a match", "Maybe not my target company"
- Archived companies when they didn't fit
- Expects the platform to adapt based on her decisions (it doesn't yet)

**E. She gives high-quality product feedback naturally**
- Suggested multiple ICP profiles unprompted
- Comfortable saying when something doesn't work
- This is an ideal beta user — keep her close

---

## 2. Friction Points (What Went Wrong)

Ordered by severity during the session.

| # | Friction | What Happened | Root Cause |
|---|----------|---------------|------------|
| 1 | **ICP Settings not discoverable** | Laura didn't know where to click. Needed step-by-step verbal direction. | Navigation labels unclear; no onboarding prompt |
| 2 | **"Generation time not defined" error** | Appeared during Barry's company generation. Aaron couldn't explain it. | Bug in `barryICPConversation.js` or downstream function |
| 3 | **Barry only returned ~10 companies** | Should have returned more; the list felt thin and required manual intervention to expand | Generation limit or incomplete query execution |
| 4 | **Y Combinator appeared under Hospitality** | Confusing categorization that required Aaron to explain and manually handle | ICP classification logic mismatch |
| 5 | **Barry locked into Hospitality after initial prompt** | Laura tried to expand to Startups and B2C but Barry kept returning hospitality results | No dynamic intent expansion in ICP conversation loop |
| 6 | **Contact title matching was weak** | Had to manually adjust titles, check LinkedIn to find the right people | Barry's persona targeting is based on broad title strings, not role authority scoring |
| 7 | **Dead ends when no contacts were found** | Some saved companies had no viable contacts — no suggestions or fallback | No recovery path when contact query returns empty |
| 8 | **Contact disappeared after LinkedIn add** | After adding Jeff Gray via LinkedIn, the contact wasn't immediately visible | Firestore write latency / UI state not reflecting processing status |
| 9 | **"Find more targets" button stalled silently** | Button appeared to do nothing; no loading state or feedback | Missing loading indicator or silent failure |
| 10 | **Aaron disclosed unfinished features verbally** | Told Laura: "CSV upload is not pretty", "Business card is hit or miss" | Features are accessible but not ready — should be hidden or labeled "Coming Soon" |

---

## 3. Product Bugs — Fix These First

| Priority | Bug | Suspected Location |
|----------|-----|--------------------|
| **P0** | "Generation time not defined" error | `netlify/functions/barryICPConversation.js` |
| **P0** | Barry returning only ~10 companies (should be 20–30+) | `barryICPConversation.js` / `barryGenerateContext.js` |
| **P1** | Y Combinator misclassified under Hospitality | ICP industry classification / scoring logic |
| **P1** | Contact disappears after LinkedIn import (no UI state feedback) | Scout people view / Firestore write timing |
| **P2** | "Find more targets" button stalls with no feedback | `DailyLeads.jsx` / Scout company card flow |

---

## 4. Feature Gaps — Product Roadmap

### High Priority

**Multi-ICP / Target Segment System**
- Laura explicitly asked: "Is there a world in which you build out two separate ICP profiles?"
- She correctly identified that Hospitality and Startups require different messaging, targeting, and company lists
- Current workaround: "just tell Barry what you want that day" — this is not scalable
- What's needed:
  - ICP Profiles (tabs or dropdown switcher in Scout): "Hospitality", "Startups", etc.
  - Each profile stores: industries, target titles, company list, saved contacts, message tone
  - Connects to backlog item #9 (BarryICPPanel extraction from DailyLeads)
- Priority: HIGH — this is a core product evolution, not a feature

**Barry Feedback Loop (Swipe → Learn)**
- Laura filtered companies constantly: matched, skipped, archived
- Barry did not adapt to these signals
- What's needed:
  - Match / Skip / Archive decisions feed back into Barry's next generation pass
  - "Barry learns that: you don't want magazines, you do want networking associations"
  - Long-term: Barry becomes more accurate for each user over time

**Dead-End Recovery**
- When no contacts are found for a saved company, the experience dies
- What's needed:
  - Suggest adjacent roles: "No CEO found — try COO, VP of Ops?"
  - Suggest similar companies: "No contacts here — here are 3 similar companies"
  - Prevent drop-off from the funnel

### Medium Priority

**Guided Onboarding Flow (Replace Aaron as the Guide)**
- Right now Aaron manually walks every new user through the platform
- `BarryOnboarding.jsx` exists but the full ICP → contacts → outreach flow is not guided
- What's needed:
  - Clear step progression: Define ICP → Approve companies → Add contacts → Start outreach
  - Progress indicator so user knows where they are
  - Barry HUD coaching lines for each onboarding phase (same pattern as Go To War)

**Contact Ranking by Authority / Relevance**
- Barry currently matches on title strings only
- Laura had to manually judge whether contacts were decision-makers
- What's needed:
  - Rank contacts: "High probability buyer", "Influencer", "Low priority"
  - Score based on: title seniority, company size match, ICP fit

**System State Clarity**
- Contacts disappearing, buttons appearing to do nothing, no confirmation of saves
- What's needed:
  - Clear processing states: "Saving...", "Processing...", "Saved"
  - Toast confirmations after key actions (company saved, contact added, message sent)
  - Activity log or timeline for recent actions

### Lower Priority

**Gate Unfinished Features During Onboarding**
- CSV upload, business card import: not ready
- Remove from the UI during onboarding or label as "Coming Soon — available [date]"
- Do not rely on Aaron verbally flagging these — it erodes platform trust

**Messaging Confidence Layer**
- Laura saw message suggestions but didn't fully engage with them
- What's needed:
  - "This message is based on: his recent post about X / his title change / your ICP targeting Y"
  - Show the reasoning — build trust in Barry's suggestions

---

## 5. Aaron's Operational Action Items

| # | Action | Priority |
|---|--------|----------|
| 1 | **Follow-up call with Laura next week** (already scheduled) | Immediate |
| 2 | Pre-call: review which companies she engaged, how many contacts she saved | Before call |
| 3 | Send Laura a short "getting started" guide: asking Barry for startups, LinkedIn import, Gmail integration setup | This week |
| 4 | Build an internal onboarding script / checklist for future sessions | This sprint |
| 5 | Stop verbally flagging broken features during onboarding — hide them or label "Coming Soon" | This sprint |
| 6 | Get Laura to connect Gmail in integrations settings before the next call | Next call |

---

## 6. Strategic Takeaway

This session confirms the product's direction.

**What Laura proved users want:**
1. Segmented targeting by audience type (not one-size-fits-all ICP)
2. Barry that learns from their decisions
3. A clear path: define who → find companies → find people → send message → follow up

**The core tension right now:**
- Barry is flexible (open prompt) but vague (unpredictable output)
- Users want controlled flexibility: structured inputs, predictable results, the ability to adjust

**The winning product direction:**
> "The easiest way to go from ICP to a full pipeline."
>
> Define audience → System finds targets → System finds people → System suggests outreach → System follows up

Every friction point in this session is a gap between where the product is and where that direction requires it to be.

---

_Source: Recording — Laura March 20, 2026 (32 min). No highlights. Transcript reviewed in full._
