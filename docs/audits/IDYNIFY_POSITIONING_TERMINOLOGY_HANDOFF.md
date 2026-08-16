# IDYNIFY Positioning & Terminology Handoff

**Date:** 2026-08-16
**Repository:** `Aepwiley13/idynify-scout`
**Branch:** `claude/idynify-product-icon-update-39k25d`
**HEAD:** `6b9ce5c3af41c7bbf499fd909f6cbcfa770986f6`
**Status:** 2 commits ahead of `main`, pushed, no open PR, clean working tree

---

## 1. Repository State

| Item | Value |
|------|-------|
| Branch | `claude/idynify-product-icon-update-39k25d` |
| Commits ahead of main | 2 |
| Commits behind main | 0 |
| Open PR | None |
| Working tree | Clean |
| Build | Passes (`vite build`) |
| Tests | 1128 passed, 5 failed (pre-existing — see Section 11) |

### Commits on this branch (oldest first)

1. **`5b28b6a`** — `Remove banned vocabulary and replace bear emoji with ID mark`
2. **`6b9ce5c`** — `Refine Tier 1 copy: Barry connects context, Scout shows matches`

These commits contain all Tier 1 and Tier 2 work described below. They have NOT been merged to main via PR. A prior sidebar-optimization PR was merged to main before this work began.

---

## 2. Mission

**IDYNIFY is the product. Barry is the intelligence inside the product.**

This work aligns the codebase with IDYNIFY's approved positioning from brief BO-011. The goal is to remove legacy marketing language, third-party brand comparisons, and misaligned copy — replacing it with language that matches the frozen positioning hierarchy. Barry is framed as internal intelligence ("connects the dots"), never as an autonomous agent, AI SDR, or sales engine.

---

## 3. Positioning System (Frozen — from BO-011)

| Layer | Value |
|-------|-------|
| **Brand** | IDYNIFY |
| **Category** | AI Relationship Intelligence for Sales |
| **Framework** | WHO → WHY → NEXT |
| **Promise** | "Know who matters, why they matter, and what to do next" |
| **Barry** | "The intelligence inside IDYNIFY" — connects the dots, connects context |

### Barry Copy Rules

- **Use:** "connects the dots", "connects context", "connects your conversations and activity"
- **Never use:** "learns" (implies training/surveillance), "AI SDR", "sales engine", "always on", "automated"
- Barry is described as intelligence, not as an agent or assistant acting autonomously

### Banned Vocabulary

| Banned | Reason |
|--------|--------|
| Tinder | Third-party brand comparison |
| AI SDR | Implies autonomous agent |
| Sales engine | Implies autonomous system |
| Automated / automate | Misframes the product |
| Always on | Implies surveillance |
| Leads (in most contexts) | See Tier 3 terminology system below |

---

## 4. Tier 1 — Banned Vocabulary Removal (COMPLETED on branch)

Every banned term found in user-facing copy was removed in commits `5b28b6a` and `6b9ce5c`. The full diff follows.

### 4.1 All Changed Files — Before / After

#### `src/pages/GettingStarted.jsx` (line 49)

```diff
- Swipe through companies like Tinder. Fast decisions, no overwhelm.
+ Swipe through companies in seconds. Fast decisions, no overwhelm.
```

**Classification:** "like Tinder" is a banned third-party comparison. The swipe mechanic is preserved because it describes a literal UI interaction.

#### `src/pages/Homepage.jsx` (line 121)

```diff
- It's kind of like Tinder, except for owners and executives
+ Know who matters, why they matter, and what to do next
```

**Classification:** Banned third-party comparison replaced with the approved brand promise from BO-011.

#### `src/components/dashboard/ModuleNavigationGrid.jsx` (line 54)

```diff
- description: 'Automated outreach campaigns',
+ description: 'Outreach campaigns',
```

**Classification:** "Automated" is banned vocabulary.

#### `src/pages/Scout/MissionControlDashboardV2.jsx` (lines 418, 424, 502)

```diff
- AI SDR • Online
+ Barry • Online
```

```diff
- {isSearching && 'Barry is building your sales engine'}
+ {isSearching && 'Barry is connecting the dots'}
```

```diff
- Barry is building your sales engine...
+ Barry is connecting the dots...
```

**Classification:** "AI SDR" and "sales engine" are both banned terms.

#### `src/pages/ScoutDashboardPage.jsx` (line 278)

```diff
- <p className="text-xs text-gray-400 font-mono">Swipe to find your ideal customers</p>
+ <p className="text-xs text-gray-400 font-mono">Review companies matched to you</p>
```

**Classification:** "Swipe to find your ideal customers" is positioning language (not a literal UI instruction). "ideal customers" carries old framing. Replaced with neutral, accurate description.

### 4.2 Swipe Occurrence Classification

Every "swipe" occurrence was individually classified:

| Location | Text | Classification | Action |
|----------|------|----------------|--------|
| `GettingStarted.jsx:49` | "Swipe through companies like Tinder" | Positioning + banned brand | Replaced — removed "like Tinder", kept swipe mechanic |
| `ScoutDashboardPage.jsx:278` | "Swipe to find your ideal customers" | Positioning language | Replaced with "Review companies matched to you" |
| `ScoutDashboardPage.jsx:317` | "SWIPE LEFT = Not Interested" | Literal UI instruction | **Preserved** — describes the actual swipe interaction |
| `ScoutDashboardPage.jsx:321` | "SWIPE RIGHT = Interested" | Literal UI instruction | **Preserved** — describes the actual swipe interaction |
| `CompanyProfileView.jsx:528` | "Back to Swipe" | Literal UI navigation | **Preserved** — describes what the button does |

---

## 5. Tier 2 — Bear Emoji Replacement (COMPLETED on branch)

The bear emoji (🐻) was replaced with the approved IDYNIFY pocket icon (`ASSETS.logoMark`) in exactly two locations:

#### `src/components/NavigationBar.jsx` (lines 41–46)

```diff
- <div className="text-4xl cursor-pointer"
-   style={{ animation: 'floatBear 6s ease-in-out infinite' }}>
-   🐻
+ <div className="cursor-pointer"
+   style={{ animation: 'floatBear 6s ease-in-out infinite', width: 36, height: 36 }}>
+   <img src={ASSETS.logoMark} alt="IDYNIFY"
+     style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
```

Import added: `import { ASSETS } from '../theme/tokens';`

#### `src/pages/UnifiedDashboard.jsx` (lines 167–169)

```diff
- <div className="text-4xl">🐻</div>
+ <div style={{ width: 36, height: 36 }}>
+   <img src={ASSETS.logoMark} alt="IDYNIFY"
+     style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
+ </div>
```

Import added: `import { ASSETS } from "../theme/tokens";`

### Asset Reference

`ASSETS.logoMark` resolves to `/assets/Short_Logo_Idynify.png` (defined in `src/theme/tokens.js:57`).

---

## 6. Intentionally NOT Changed

These items were reviewed and intentionally left as-is:

| Location | Content | Reason |
|----------|---------|--------|
| `ScoutDashboardPage.jsx:317` | "SWIPE LEFT = Not Interested" | Literal UI interaction |
| `ScoutDashboardPage.jsx:321` | "SWIPE RIGHT = Interested" | Literal UI interaction |
| `CompanyProfileView.jsx:528` | "Back to Swipe" | Literal UI navigation label |
| `Homepage.jsx:91` | Bear emoji (🐻) with `floatBear` animation | Deferred to Homepage sprint (Section 9) |
| `Homepage.jsx:94` | "Find Companies You Can Sell To—" | Deferred to Homepage sprint |
| `Homepage.jsx:200` | "Build your prospect database" | Deferred to Homepage sprint |
| All Barry avatar / chat / coaching components | Various | Out of scope — Barry's visual identity is separate from positioning copy |
| All Firestore collections, routes, API endpoints, schema fields | Various | This is UI copy only — never rename internal implementation |

---

## 7. Tier 3 — "Leads" Terminology Matrix (AUDIT ONLY — NOT IMPLEMENTED)

### Terminology System

Do NOT perform a global leads → contacts replacement. IDYNIFY uses a multi-term system:

| Term | Definition | When to Use |
|------|-----------|-------------|
| **People** | Universal container — anyone in the system | Default when no specific lifecycle state applies |
| **Contact** | The canonical record of a person | When referring to the stored record itself |
| **Prospect** | Someone being actively pursued | When the relationship is in active pursuit |
| **Customer** | After conversion | Post-sale / post-conversion |
| **Partner** | Referral / channel relationship | When the relationship is collaborative, not sales |
| **Match** | A Scout-surfaced company or person | When describing what Scout found |
| **Lead** | A genuinely sales-specific lifecycle state | ONLY when the CRM concept of "lead" is semantically correct |

### Decision Framework for Each Occurrence

For every instance below, the implementing team must ask:

1. Is "lead" here describing a CRM lifecycle concept that is genuinely about sales qualification? → Keep as "Lead"
2. Is it a generic label for "person in the system"? → Replace with "People" or "Contact"
3. Is it describing what Scout surfaced? → Replace with "Match" or "Discovery"
4. Is it describing someone being pursued? → Replace with "Prospect"
5. Is it a verb ("lead with value")? → Keep as-is (not a noun)

### Complete Inventory — 149 User-Facing Occurrences

The following is every user-facing occurrence of "lead" or "leads" in the `src/` directory. Internal identifiers (variable names, function names, Firestore references, route paths, console.log) are excluded.

#### `src/components/ICPScoring.jsx` (9 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 1 | 248 | `BARRY AI FOUND YOUR LEADS!` | ICP Scoring heading | Match/Discovery |
| 2 | 250 | `{mockLeads.length} LEADS DETECTED` | ICP Scoring subheading | Match/Discovery |
| 3 | 261 | `LEAD FILTERING SETTINGS` | Filter panel heading | Match/Prospect |
| 4 | 306 | `Show all leads (no filter)` | Radio button label | Match/Prospect |
| 5 | 350 | `Showing {filteredLeads.length} of {mockLeads.length} total leads` | Filter summary | Match/Prospect |
| 6 | 359 | `- {excellentLeads.length} leads` | Section counter | Match/Prospect |
| 7 | 372 | `- {goodLeads.length} leads` | Section counter | Match/Prospect |
| 8 | 385 | `- {moderateLeads.length} leads` | Section counter | Match/Prospect |
| 9 | 405 | `...and 100-200 leads` | Upgrade CTA | Match/Prospect |

#### `src/components/ImprovedScoutQuestionnaire.jsx` (4 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 10 | 297 | `...We deliver 30 qualified leads daily` | Validation error example | Keep (example text) |
| 11 | 459 | `[LEAD:QUALIFIED]` | Decorative floating text | Cosmetic — assess removal |
| 12 | 927 | `...They can't find qualified leads...` | Placeholder text | Keep (user's own language) |
| 13 | 943 | `...deliver 30 qualified leads daily...` | Placeholder text | Keep (user's own language) |

#### `src/components/LeadDetail.jsx` (5 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 14 | 148 | `Lead marked as in progress` | Alert | Contact/Prospect |
| 15 | 152 | `Failed to update lead. Please try again.` | Error alert | Contact/Prospect |
| 16 | 196 | `No phone number available for this lead` | Alert | Contact/Prospect |
| 17 | 300 | `✓ Lead Info Accurate` | Action button | Contact/Prospect |
| 18 | 312 | `✗ Lead Info Incorrect` | Action button | Contact/Prospect |

#### `src/components/LeadList.jsx` (4 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 19 | 90 | `Loading leads...` | Loading state | People/Contacts |
| 20 | 135 | `Lead Review` | Page heading | Contact Review |
| 21 | 137 | `Review and validate your enriched leads` | Page subtitle | Contacts/Matches |
| 22 | 178 | `No leads found` | Empty state | Contacts/People |

#### `src/components/NavigationBar.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 23 | 28 | `'Lead Review'` | Nav link label | Contact Review |

#### `src/components/QuotaDisplay.jsx` (2 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 24 | 114 | `Weekly leads enriched` | Quota label | Contacts enriched |
| 25 | 137 | `Need more leads? Upgrade your plan` | Upgrade CTA | Contacts/Prospects |

#### `src/components/contacts/BrigadeSelector.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 26 | 31 | `label: 'Lead'` | Brigade category label | **Keep as Lead** (CRM lifecycle state) |

#### `src/components/dashboard/MissionCardDeck.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 27 | 571 | `aria-label="Scout daily leads deck"` | Accessibility label | "Scout daily discoveries deck" |

#### `src/components/recon/ImpactPreviewPanel.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 28 | 73 | `Lead with integration, not replacement.` | Example content | **Keep** (verb usage — "lead with") |

#### `src/components/recon/ReconFeedbackToast.jsx` (2 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 29 | 25 | `...score leads based on how well they match...` | Barry feedback toast | Prospects/Matches |
| 30 | 40 | `...prioritize leads showing active buying behavior.` | Barry feedback toast | Prospects |

#### `src/components/recon/Section1Foundation.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 31 | 93 | `...pattern matching for lead quality.` | Barry context text | Prospect quality |

#### `src/components/recon/Section2ProductDeepDive.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 32 | 65 | `"Lead nurturing"` | Multi-select option | **Keep as Lead** (standard CRM term) |

#### `src/components/recon/Section5PainPointsMotivations.jsx` (2 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 33 | 79 | `...ignoring non-urgent leads...` | Placeholder text | Keep (user's own language context) |
| 34 | 88 | `...Marketing (lead waste)...` | Placeholder text | Keep (user's own language context) |

#### `src/components/scout/AddContactModal.jsx` (3 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 35 | 204 | `Your contact has been saved to your leads.` | Success message | "saved to your people" |
| 36 | 205 | `Your contacts have been saved to your leads.` | Success message | "saved to your people" |
| 37 | 235 | `'Go to Lead'` / `'View in Leads'` | Action button | "View in People" |

#### `src/components/scout/CSVUpload.jsx` (2 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 38 | 421 | `Lead / Contact List` | Upload type heading | Contact List |
| 39 | 468 | `'Lead / Contact Upload'` | Section title | Contact Upload |

#### `src/components/scout/CompanyCard.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 40 | 276 | `Company Lead Score` | Score label | Company Match Score |

#### `src/components/scout/CompanyDetailModal.jsx` (4 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 41 | 632 | `Select contacts to add as leads` | Section subtitle | "add to your people" |
| 42 | 701 | `Add ${selectedDecisionMakers.length} to Leads` | Button | "Add to People" |
| 43 | 723 | `Search your existing leads & people...` | Section subtitle | "Search your people..." |
| 44 | 739 | `placeholder="Search all leads & people by name..."` | Search placeholder | "Search all people..." |

#### `src/components/scout/ContactTitleSetup.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 45 | 24 | `"Engineering Lead"` | Job title option | **Keep** (job title, not CRM term) |

#### `src/components/scout/FindContact.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 46 | 508 | `Confirm & Save Lead` | Submit button | "Confirm & Save Contact" |

#### `src/components/scout-game/GameSessionStart.jsx` (3 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 47 | 114 | `Start by approving your Daily Leads` | Guidance text | "Daily Discoveries" |
| 48 | 118 | `Process your Daily Leads first...` | Empty state | "Daily Discoveries" |
| 49 | 124 | `Go to Daily Leads` | CTA button | "Go to Daily Discoveries" |

#### `src/components/serviceProfiles/ServiceProfileSetup.jsx` (3 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 50 | 17 | `...convert visitors into leads` | Placeholder | Keep (user's own language context) |
| 51 | 23 | `...doesn't generate leads` | Placeholder | Keep (user's own language context) |
| 52 | 36 | `Lead with ROI...` | Placeholder | **Keep** (verb usage — "lead with") |

#### `src/components/shared/SharedCompaniesView.jsx` (2 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 53 | 422 | `Accept companies in Daily Leads...` | Empty state (Scout) | "Daily Discoveries" |
| 54 | 425 | `Accept companies in Daily Leads...` | Empty state (All) | "Daily Discoveries" |

#### `src/data/brigadeSystem.js` (7 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 55 | 116 | `...lead with what you bring to them` | Barry guidance | **Keep** (verb usage) |
| 56 | 149 | `Lead with value, not need` | Barry guidance | **Keep** (verb usage) |
| 57 | 279 | `...lead with what has changed` | Barry guidance | **Keep** (verb usage) |
| 58 | 600 | `label: 'Lead'` | Person type label | **Keep as Lead** (CRM lifecycle state) |
| 59 | 601 | `description: 'Anyone you are actively working...'` | Person type description | **Keep** (defines the Lead lifecycle) |
| 60 | 602 | `barryContext: 'This person is a lead...'` | Barry context | **Keep** (CRM lifecycle reference) |
| 61 | 625 | `...not a current lead or customer` | Network type description | **Keep** (CRM lifecycle contrast) |

#### `src/pages/Admin/AdminDashboard.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 62 | 332 | `{user.recon?.leadsTotal ?? 0} leads` | Admin user row metric | Contacts / People |

#### `src/pages/Admin/TenantHealth.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 63 | 167 | `label="Leads"` | Admin stat box | "People" or "Contacts" |

#### `src/pages/Admin/UserDetail.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 64 | 589 | `Total Leads` | Admin metric card | "Total Contacts" |

#### `src/pages/CheckoutPage.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 65 | 179 | `...lead generation` | Page subtitle | "prospect discovery" |

#### `src/pages/CheckoutSuccessPage.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 66 | 76 | `Generate unlimited qualified leads` | Feature description | "Discover unlimited qualified prospects" |

#### `src/pages/GettingStarted.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 67 | 57 | `Select contacts and build leads` | Feature title | "Select contacts and build your pipeline" |

#### `src/pages/Homepage.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 68 | 38 | `[LEADS:TRACKING]` | Decorative floating text | Cosmetic — assess removal or rephrase |

#### `src/pages/Onboarding/BarryOnboarding.jsx` (3 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 69 | 59 | `You can refresh leads manually...` | Barry chat message | "refresh matches" |
| 70 | 393 | `You can also refresh leads manually...` | Barry wrap-up message | "refresh matches" |
| 71 | 579 | `Taking you to Daily Leads in a moment` | Redirect message | "Daily Discoveries" |

#### `src/pages/Onboarding/ReconOnboardingWizard.jsx` (2 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 72 | 55 | `...every lead, message, and conversation...` | Barry greeting | "every prospect, message..." |
| 73 | 57 | `...finding leads, qualifying prospects...` | Barry greeting | "finding prospects, qualifying matches..." |

#### `src/pages/Questionnaire.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 74 | 23 | `...the better your leads.` | Tip text | "the better your matches" |

#### `src/pages/Recon/AlignmentBrief.jsx` (2 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 75 | 288 | `...and lead scoring.` | Subtitle | "prospect scoring" |
| 76 | 403 | `Barry may score leads using outdated criteria.` | Warning text | "score prospects" |

#### `src/pages/Recon/BarryTraining.jsx` (4 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 77 | 40 | `Scout lead scoring reflects...` | Impact description | "prospect scoring" |
| 78 | 41 | `All leads are treated equally...` | Missing-impact description | "All prospects" |
| 79 | 85 | `Scout prioritizes leads showing...` | Impact description | "prospects showing" |
| 80 | 270 | `ICP-based lead scoring...` | Progress unlock text | "prospect scoring" |

#### `src/pages/Recon/ReconModulePage.jsx` (8 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 81 | 23 | `Scout's lead scoring more accurate` | Tip | "prospect scoring" |
| 82 | 69 | `filter out competitor-locked leads` | Tip | "competitor-locked prospects" |
| 83 | 79 | `Scout will deprioritize competitor-locked leads` | Tip | "competitor-locked prospects" |
| 84 | 86 | `...is worth 10x a cold lead` | Tip | "a cold prospect" |
| 85 | 91 | `Scout will surface high-intent leads faster` | Tip | "high-intent prospects" |
| 86 | 96 | `Scout will prioritize high-intent leads` | Tip | "high-intent prospects" |
| 87 | 159 | `filter out competitor-locked leads` | Description | "competitor-locked prospects" |
| 88 | 177 | `Scout prioritizes leads showing real purchase intent` | Capability text | "prospects showing..." |

#### `src/pages/Recon/ReconOverview.jsx` (4 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 89 | 44 | `'Scout lead scoring'` | Impact area tag | "Scout prospect scoring" |
| 90 | 77 | `'Scout lead prioritization'` | Impact area tag | "Scout prospect prioritization" |
| 91 | 89 | `Better lead scoring...` | Platform impact text | "prospect scoring" |
| 92 | 90 | `Prioritizes leads showing real purchase intent` | Platform impact text | "Prioritizes prospects" |

#### `src/pages/Reinforcements/sections/OpportunitiesSection.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 93 | 63 | `'Target lead'` (fallback) | Referral card label | "Target contact" |

#### `src/pages/Scout/AllLeads.jsx` (3 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 94 | 1748 | `...add new ones via Daily Leads.` | Empty state | "Daily Discoveries" |
| 95 | 1751 | `Accept companies in Daily Leads...` | Empty state | "Daily Discoveries" |
| 96 | 1899 | `label: 'Total Leads'` | Stat badge label | "Total People" |

#### `src/pages/Scout/CompanyDetail.jsx` (7 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 97 | 1437 | `Add {n} to Leads` | Button | "Add to People" |
| 98 | 1454 | `Select contacts to add as leads` | Subtitle | "add to your people" |
| 99 | 1538 | `Add {n} to Leads` | Button | "Add to People" |
| 100 | 1666 | `Add {n} to Leads` | Bulk approve button | "Add to People" |
| 101 | 1813 | `Add to Leads` | Individual contact button | "Add to People" |
| 102 | 1833 | `Search your existing leads & people...` | Section subtitle | "Search your people..." |
| 103 | 1849 | `placeholder="Search all leads & people by name..."` | Search placeholder | "Search all people..." |

#### `src/pages/Scout/CompanyProfileView.jsx` (7 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 104 | 687 | `subtitle="Select contacts to add as leads"` | Subtitle | "add to your people" |
| 105 | 732 | `Add {n} to Leads` | Button | "Add to People" |
| 106 | 793 | `Add {n} to Leads` | Bulk approve button | "Add to People" |
| 107 | 830 | `Save to Leads` | Individual contact button | "Save to People" |
| 108 | 867 | `Save to Leads` | Suggested contact button | "Save to People" |
| 109 | 879 | `subtitle="Search your existing leads & people..."` | Subtitle | "Search your people..." |
| 110 | 891 | `placeholder="Search all leads & people by name..."` | Placeholder | "Search all people..." |

#### `src/pages/Scout/ContactSearch.jsx` (2 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 111 | 243 | `...has been added to your leads!` | Success message | "added to your people" |
| 112 | 532 | `Confirm & Save Lead` | Submit button | "Confirm & Save Contact" |

#### `src/pages/Scout/DailyLeads.jsx` (4 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 113 | 54 | `Help Barry send better leads your way.` | Rejection feedback | "better matches" |
| 114 | 2050 | `Loading lead insights...` | Loading state | "Loading insights..." |
| 115 | 2068 | `...curate your daily leads.` | ICP gate message | "daily discoveries" |
| 116 | 2142 | `Daily Lead Insights` | Page heading | "Daily Discoveries" |

#### `src/pages/Scout/ICPSettings.jsx` (2 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 117 | 552 | `{n} new companies added to Daily Leads` | Success message | "Daily Discoveries" |
| 118 | 936 | `...contributes to the lead score...` | Description | "match score" |

#### `src/pages/Scout/MissionControlDashboardV2.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 119 | 297 | `Approve & Add to Leads` | Button | "Approve & Add to People" |

#### `src/pages/Scout/SavedCompanies.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 120 | 171 | `Match with companies in Daily Leads...` | Empty state | "Daily Discoveries" |

#### `src/pages/Scout/ScoutMain.jsx` (1 occurrence)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 121 | 56 | `desc: 'My leads'` | Tab descriptor | "My people" |

#### `src/pages/Scout/ScoutPlus.jsx` (3 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 122 | 246 | `Your contact has been saved to your leads.` | Success message | "saved to your people" |
| 123 | 247 | `Your contacts have been saved to your leads.` | Success message | "saved to your people" |
| 124 | 283 | `'Go to Lead'` / `'View in Leads'` | Action button | "View in People" |

#### `src/pages/UnifiedDashboard.jsx` (20 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 125 | 137 | `Barry found {n} qualified leads for you!` | Celebration overlay | "qualified matches" |
| 126 | 156 | `View Your Leads →` | CTA button | "View Your Matches →" |
| 127 | 181 | `{n} Leads` | Header badge | "People" or "Matches" |
| 128 | 206 | `🚀 Leads (${n})` | Tab label | "People" or "Matches" |
| 129 | 234 | `...Approve it to see your leads!` | Welcome text | "your matches" |
| 130 | 235 | `You have ${n} leads ready for action!` | Status text | "matches" or "prospects" |
| 131 | 268 | `Leads Generated` | Status card heading | "Matches Found" |
| 132 | 294 | `Leads Ready!` | CTA card heading | "Matches Ready!" |
| 133 | 296 | `Barry found {n} leads matching your ICP.` | Card description | "matches" |
| 134 | 302 | `View Leads →` | CTA button | "View Matches →" |
| 135 | 399 | `...guide Barry's lead generation.` | ICP prompt | "prospect discovery" |
| 136 | 433 | `No Leads Yet` | Empty state heading | "No Matches Yet" |
| 137 | 435 | `...generate your first batch of leads!` | Empty state text | "matches" |
| 138 | 443 | `Your Leads` | Section heading | "Your Matches" or "Your People" |
| 139 | 445 | `{n} of {n} leads match your filters` | Filter count | "matches" |
| 140 | 462 | `Filter Leads` | Filter heading | "Filter Results" |
| 141 | 494 | `Show all leads` | Radio button label | "Show all" |
| 142 | 540 | `- {n} leads` | Counter | "matches" |
| 143 | 557 | `- {n} leads` | Counter | "matches" |
| 144 | 570 | `No leads match your current filters.` | Empty filter state | "No results match..." |

#### `src/shared/reconHealthConstants.js` (3 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 145 | 55 | `Lead prioritization doesn't account for...` | Health display | "Prospect prioritization" |
| 146 | 74 | `...Lead scoring is unweighted.` | Impact text | "Prospect scoring" |
| 147 | 114 | `Lead prioritization doesn't account for...` | Impact text | "Prospect prioritization" |

#### `src/utils/brigadeSystem.js` (2 occurrences)

| # | Line | Text | UI Surface | Proposed Category |
|---|------|------|------------|-------------------|
| 148 | 32 | `label: 'Lead'` | Brigade label | **Keep as Lead** (CRM lifecycle) |
| 149 | 34 | `...is now a Lead. Barry will focus on...` | Transition toast | **Keep as Lead** (CRM lifecycle) |

### Summary Statistics

| Metric | Count |
|--------|-------|
| Total user-facing occurrences | 149 |
| Files containing occurrences | 53 |
| Recommended **Keep as "Lead"** | ~18 (CRM lifecycle, verb usage, user language placeholders) |
| Recommended **Replace** | ~131 |
| Most common replacement: "People" | ~25 instances ("Add to Leads" → "Add to People") |
| Most common replacement: "Matches" / "Discoveries" | ~30 instances (Scout-surfaced results) |
| Most common replacement: "Prospects" | ~25 instances (scoring, prioritization) |
| "Daily Leads" → "Daily Discoveries" | ~10 instances |
| "Lead scoring" → "Prospect scoring" or "Match scoring" | ~12 instances |

### Critical Guardrails for Implementation

1. **Do NOT rename any Firestore collection** — `leads`, `contacts`, `companies` stay as-is in code
2. **Do NOT rename any route path** — `/lead-review`, `/scout?tab=all-leads` stay as-is in router config
3. **Do NOT rename any API endpoint, analytics event, or schema field**
4. **Do NOT rename internal variable names** — `filteredLeads`, `handleLeadClick`, `mockLeads` stay as-is
5. **This is UI copy only** — change the visible label, not the underlying implementation
6. Tab names like "All Leads" (in ScoutMain.jsx) require coordination: the `label` property is what users see, while the `value` property is what code uses. Change the label, keep the value.

---

## 8. Internal vs. UI Copy Boundary

This distinction is critical for implementation safety:

| Layer | Example | Change? |
|-------|---------|---------|
| **UI label** | "Add to Leads" button text | YES — rename per matrix |
| **Route path** | `/lead-review` | NO |
| **Firestore collection** | `users/{uid}/leads` | NO |
| **Variable name** | `filteredLeads` | NO |
| **Function name** | `handleAddToLeads()` | NO |
| **Analytics event** | `lead_approved` | NO |
| **CSS class** | `.lead-card` | NO |
| **Import path** | `from './LeadList'` | NO |
| **Component filename** | `LeadDetail.jsx` | NO (or coordinate separately) |
| **Tab `value` prop** | `value="leads"` | NO |
| **Tab `label` prop** | `label="Leads (5)"` | YES |

---

## 9. Homepage Deferred Work

The following Homepage items were explicitly deferred to a future Homepage sprint. They were NOT changed in this work:

| Line | Content | Reason Deferred |
|------|---------|-----------------|
| `Homepage.jsx:91` | `🐻` with `floatBear` animation | Bear emoji replacement scoped to NavigationBar + UnifiedDashboard only; Homepage has its own design sprint |
| `Homepage.jsx:94` | `"Find Companies You Can Sell To—"` | Homepage copy is a separate positioning deliverable |
| `Homepage.jsx:200` | `"Build your prospect database"` | Homepage copy is a separate positioning deliverable |

The Homepage also contains `[LEADS:TRACKING]` (line 38) as decorative floating code text — see Tier 3 matrix entry #68.

---

## 10. Remaining Legacy Issues

### Open GitHub Issues (relevant to this work)

| Issue | Title | Status |
|-------|-------|--------|
| #556 | [Brand Cleanup] Remove legacy Tinder copy from social preview docs | Open |
| #539 | [Brand Step 3] Replace sidebar wordmark with IDYNIFY logo asset | Open (work completed and merged in earlier PR #559) |
| #545 | Pre-existing test failures (HunterContactCard, ReconSectionEditor) | Open |

### Known Legacy Copy Not Addressed

- Barry onboarding messages still reference "leads" (3 occurrences — see matrix #69–71)
- RECON training descriptions extensively use "lead scoring" (12+ occurrences — see matrix)
- Admin dashboard metrics display "leads" (3 occurrences — see matrix #62–64)
- "Daily Leads" is used as a product surface name in ~10 locations — renaming requires product decision on new name ("Daily Discoveries" is proposed but not approved)

---

## 11. Test State

| Suite | Result |
|-------|--------|
| Total tests | 1128 passed |
| Failed tests | 5 (pre-existing) |

### Pre-existing failures (confirmed failing on `main` — not caused by this branch)

| Test | File | Issue |
|------|------|-------|
| HunterContactCard (1 failure) | `src/test/HunterContactCard.test.jsx` | Tracked in #545 |
| ReconSectionEditor (4 failures) | `src/test/ReconSectionEditor.test.jsx` | Tracked in #545 |

Build passes cleanly with `vite build`.

---

## 12. Asset Reference

### Brand Assets (in `src/theme/tokens.js`)

```
ASSETS.logoFull:          "/assets/Idynify_logo1.png"           // Canonical master (2172×724, not served directly)
ASSETS.logoFullOptimized: {
  webp: "/assets/sidebar/idynify-wordmark.webp",                // 204×68, 20.3 KB — sidebar wordmark
  png:  "/assets/sidebar/idynify-wordmark.png",                 // 204×68, 23.6 KB — PNG fallback
  avif: "/assets/sidebar/idynify-wordmark.avif",                // 204×68, 9.2 KB — not used in production
}
ASSETS.logoMark:          "/assets/Short_Logo_Idynify.png"      // Pocket icon — used for bear emoji replacement
```

The sidebar uses a `<picture>` element with WebP → PNG fallback (AVIF excluded from production due to pixel drift on brand typography). This was merged to main in PR #559.

---

## 13. Instructions for Next Team

### What this branch contains

Two commits of completed, tested Tier 1 and Tier 2 work. No PR has been opened. The branch is pushed and 2 commits ahead of main.

### To resume

1. **Review the diff** — `git diff origin/main..HEAD` shows all 7 changed files
2. **Open a PR** when ready — no PR exists yet; the work is ready for review
3. **Tier 3 implementation** — use the matrix in Section 7 as the specification
   - Start with the highest-concentration files: `UnifiedDashboard.jsx` (20), `CompanyDetail.jsx` (7), `CompanyProfileView.jsx` (7)
   - Apply the terminology system, not a global find-and-replace
   - Respect every guardrail in Section 8
   - Get product approval on "Daily Leads" rename before implementing (proposed: "Daily Discoveries")
4. **Do NOT touch** Homepage copy (deferred), Firestore collections, route paths, or internal identifiers

### Verification checklist before merging any Tier 3 work

- [ ] Every changed string confirmed to be user-visible (not internal identifier)
- [ ] No Firestore collections, routes, or schema fields renamed
- [ ] No variable or function names changed
- [ ] Build passes
- [ ] Pre-existing test failures unchanged (5 failures in #545)
- [ ] Barry copy uses "connects the dots" / "connects context" — never "learns", "AI SDR", "sales engine"
- [ ] Tab `value` props unchanged (only `label` props changed)
- [ ] Homepage.jsx lines 91, 94, 200 untouched
