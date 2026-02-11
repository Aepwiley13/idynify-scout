# ICP Contact Discovery — Implementation Plan

> **Status:** Pre-Implementation Review
> **Branch:** `claude/review-icp-orchestration-n82SK`
> **Date:** 2026-02-11
> **Scope:** Replace hardcoded KDM seniority logic with ICP-driven contact discovery

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Confirmed Decisions](#2-confirmed-decisions)
3. [Schema Diffs](#3-schema-diffs)
4. [Apollo Call Flow — Before vs After](#4-apollo-call-flow--before-vs-after)
5. [Cost Model](#5-cost-model)
6. [File-by-File Change List](#6-file-by-file-change-list)
7. [Feature Flag Implementation](#7-feature-flag-implementation)
8. [Lifecycle States](#8-lifecycle-states)
9. [Migration Strategy](#9-migration-strategy)
10. [Risk & Rollback Plan](#10-risk--rollback-plan)
11. [Implementation Phases](#11-implementation-phases)
12. [Open Items](#12-open-items)

---

## 1. Executive Summary

**What we're doing:**
Replacing the hardcoded seniority-based Key Decision Makers (KDM) logic with ICP-driven contact discovery. Instead of always searching for "director/vp/c_suite in sales/marketing/operations/finance," the system will search for contacts matching the user's ICP `primaryTitles` (max 3).

**What changes:**
- KDM section becomes "ICP Contacts" (powered by user's ICP titles, not hardcoded seniority)
- Apollo calls drop from **11 per search → max 4** (1 PEOPLE_SEARCH + 3 PEOPLE_MATCH)
- New `primaryTitles[]` field on ICP (max 3, drives contact discovery)
- New `icpContacts` cache on company documents (14-day TTL)
- No email display or enrichment write before user saves contact
- Button-click-only search (no auto-trigger on mount)
- Both "ICP Contacts" and existing saved contacts displayed side by side in KDM area

**What doesn't change:**
- Existing enrichment flow (Approve → Save → Enrich)
- Credit system (credits only consumed on email enrichment)
- `targetTitles` array (not deleted, still used by ICPBuilder)
- `selected_titles` per-company (becomes optional override)
- All other CompanyDetail sections

---

## 2. Confirmed Decisions

| Decision | Answer |
|----------|--------|
| PEOPLE_MATCH for display | YES — capped at 3 (name, LinkedIn, title only) |
| Title source of truth | Global ICP `primaryTitles[]` (max 3) |
| `selected_titles` | Optional per-company override, not primary driver |
| `titlePreferences` | Soft-deprecated (stop relying, don't delete) |
| Title cap | Flexible `targetTitles`, but only 3 `primaryTitles` drive search |
| ICP change → refresh | Manual only (user clicks "Refresh ICP Contacts") |
| Auto-search on mount | NO — button-click-only for max cost control |
| Cache strategy | 14-day TTL on company doc, store titles-at-fetch-time |
| Saved contacts | Permanent — users accumulate leads over time |
| Apollo credits | PEOPLE_SEARCH + PEOPLE_MATCH = free (Basic plan). Credits only on email enrichment |
| Legacy companies | Lazy population (no backfill) |
| Deployment | Direct to Netlify production (feature flags required) |
| UX layout | Both "ICP Contacts" + existing saved contacts in KDM section |
| Barry | Validation layer for titles (not full chat rebuild) |
| Feature flags | Firestore-based per-user (`featureFlags.icpContactV2`) |

---

## 3. Schema Diffs

### 3A. ICP Document — `users/{userId}/icp`

```diff
 {
   industries: string[],
   companySizes: string[],
   targetTitles: string[],        // UNCHANGED — still used by ICPBuilder
   territories: string[],
+  primaryTitles: string[],       // NEW — max 3, drives contact discovery
+  primaryTitlesUpdatedAt: string  // NEW — ISO timestamp
 }
```

**Rules:**
- `primaryTitles` max length = 3
- Must be subset of or derived from `targetTitles`
- If `primaryTitles` is empty/missing, fall back to first 3 of `targetTitles`
- Barry validation can suggest edits to `primaryTitles`

### 3B. Company Document — `users/{userId}/companies/{companyId}`

```diff
 {
   name: string,
   domain: string,
   status: 'accepted' | 'rejected' | 'archived',
   selected_titles: [{title, rank, score}],      // UNCHANGED — optional override
   titles_updated_at: string,
   apolloEnrichment: { ... },                     // UNCHANGED
   apolloEnrichedAt: timestamp,                   // UNCHANGED
+  icpContacts: {                                 // NEW — ICP contact cache
+    contacts: [{                                 // Max 3 contacts
+      id: string,                                // Apollo person ID
+      name: string,
+      first_name: string,
+      last_name: string,
+      title: string,
+      linkedin_url: string | null,
+      photo_url: string | null,
+      seniority: string | null,
+      departments: string[]
+    }],
+    titlesUsed: string[],                        // Snapshot of primaryTitles at fetch time
+    lastFetchedAt: string,                       // ISO timestamp
+    status: 'found' | 'none_found' | 'error'    // Fetch result status
+  }
 }
```

**Rules:**
- No `email` field in `icpContacts.contacts` (email only revealed at enrichment)
- `titlesUsed` preserves which ICP titles were active when contacts were fetched
- TTL: 14 days (matches existing `apolloEnrichedAt` cache pattern)
- `status: 'none_found'` prevents repeated empty searches

### 3C. User Feature Flags — `users/{userId}` (top-level field)

```diff
 {
   credits: { ... },
   email: string,
   profile: { ... },
+  featureFlags: {                // NEW — feature flag object
+    icpContactV2: boolean        // NEW — enables ICP contact discovery
+  }
 }
```

### 3D. Contact Document — `users/{userId}/contacts/{contactId}`

```diff
 {
   apollo_person_id: string,
   name: string,
   title: string,
   source: 'manual' | 'apollo' | 'csv_import' | 'networking' | 'decision_makers',
+  source: 'manual' | 'apollo' | 'csv_import' | 'networking' | 'decision_makers' | 'icp_discovery',
   // ... rest unchanged
 }
```

Only change: new `source` value `'icp_discovery'` to distinguish ICP-found contacts from legacy KDM contacts.

---

## 4. Apollo Call Flow — Before vs After

### BEFORE (Current — enrichCompany.js + searchPeople.js)

```
enrichCompany.js (on company enrich):
  1x ORGANIZATIONS_ENRICH              (company data)
  1x PEOPLE_SEARCH                     (hardcoded seniority: director/vp/c_suite/founder/owner)
  3x PEOPLE_MATCH                      (enrich each of 3 decision makers)
  = 5 API calls per company enrich

searchPeople.js (on title search):
  1x PEOPLE_SEARCH                     (user-selected titles, per_page: 10)
  10x PEOPLE_MATCH                     (enrich each of 10 candidates)
  = 11 API calls per title search

TOTAL WORST CASE: 16 API calls per company interaction
```

### AFTER (New — ICP Contact Discovery)

```
New icpContactSearch function (on button click):
  1x PEOPLE_SEARCH                     (primaryTitles, org_id, per_page: 3)
  3x PEOPLE_MATCH                      (enrich each of 3 candidates — NO email field used)
  = 4 API calls per ICP search

enrichCompany.js (on company enrich — MODIFIED):
  1x ORGANIZATIONS_ENRICH              (company data — unchanged)
  0x PEOPLE_SEARCH                     (REMOVED — no more hardcoded KDM search)
  0x PEOPLE_MATCH                      (REMOVED — KDM no longer fetched here)
  = 1 API call per company enrich

TOTAL WORST CASE: 5 API calls per company interaction
                   (1 enrich + 4 ICP search)
```

### Call Reduction Summary

| Scenario | Before | After | Reduction |
|----------|--------|-------|-----------|
| Company enrich only | 5 | 1 | -80% |
| Company enrich + title search | 16 | 5 | -69% |
| Title search only | 11 | 4 | -64% |

---

## 5. Cost Model

### Apollo Basic Plan — Credit Impact

Per user confirmation: **PEOPLE_SEARCH + PEOPLE_MATCH = zero credits** on Basic plan.
Credits only consumed when email is enriched/revealed.

**ICP Contact Discovery (display only): $0 per search**
- 1x PEOPLE_SEARCH (free)
- 3x PEOPLE_MATCH without email reveal (free)

**Credits are only consumed when:**
- User clicks "Save as Lead" → triggers enrichment → email revealed → credit consumed
- This is the existing flow and is unchanged

### Worst-Case Volume Estimates

| Metric | Value | Notes |
|--------|-------|-------|
| ICP search per company | 4 API calls | Button-click only, not automatic |
| Cache TTL | 14 days | Prevents redundant calls |
| Max daily searches per user | ~10-20 | Estimated based on manual click behavior |
| API calls per user per day | ~40-80 | With cache, likely much lower |

**Risk factor:** Apollo rate limits on Basic plan. If rate-limited (429), we already have error categorization in `apolloErrorLogger.js`. No new handling needed — existing retry logic applies.

---

## 6. File-by-File Change List

### Phase 1: Schema & Feature Flags

| File | Change | Lines |
|------|--------|-------|
| `src/firebase/schema.js` | Add `icpContacts` and `featureFlags` to schema docs, add `primaryTitles` path | L28-65 |
| `firestore.rules` | Add read/write rules for `featureFlags` field | TBD |

### Phase 2: ICP primaryTitles

| File | Change | Lines |
|------|--------|-------|
| `src/components/ICPBuilder.jsx` | Add `primaryTitles` selection step (pick top 3 from targetTitles) | After Step 3 |
| `src/components/ICPStep3.jsx` | Add "Mark as Primary" toggle on title cards (max 3) | New UI element |
| `src/constants/icpOptions.js` | No change needed | — |
| `src/pages/Onboarding/BarryOnboarding.jsx` | Auto-set `primaryTitles` from first 3 of Barry's extracted `targetTitles` | L~120 |
| `netlify/functions/barryICPConversation.js` | Add `primaryTitles` to `processInitialInput()` response | L514-648 |

### Phase 3: ICP Contact Search (New Backend Function)

| File | Change | Lines |
|------|--------|-------|
| `netlify/functions/searchICPContacts.js` | **NEW FILE** — ICP contact search function | New |
| `netlify/functions/utils/apolloConstants.js` | No change (PEOPLE_SEARCH + PEOPLE_MATCH already defined) | — |
| `netlify/functions/utils/scoutContactContract.js` | No change (mapApolloToScoutContact already works) | — |

**`searchICPContacts.js` specification:**
```
Input:  { userId, authToken, organizationId, primaryTitles: string[] }
Flow:
  1. Validate auth
  2. Check company.icpContacts cache (14-day TTL)
  3. If cache valid → return cached contacts
  4. If cache expired/missing:
     a. 1x PEOPLE_SEARCH (organization_ids: [orgId], person_titles: primaryTitles, per_page: 3)
     b. For each candidate (max 3): 1x PEOPLE_MATCH (id: candidate.id)
     c. Map via mapApolloToScoutContact() — STRIP email fields
     d. Write to company.icpContacts cache
     e. Return contacts
Output: { contacts: [], titlesUsed: [], status: 'found' | 'none_found', fromCache: boolean }
```

### Phase 4: Modify enrichCompany.js (Remove Hardcoded KDM)

| File | Change | Lines |
|------|--------|-------|
| `netlify/functions/enrichCompany.js` | Remove decision maker search block (lines 81-175). Keep ORGANIZATIONS_ENRICH only. Feature-flag gated. | L81-175 |

**Conditional logic:**
```javascript
// If icpContactV2 flag is ON for this user:
//   - Skip hardcoded KDM search entirely
//   - Only run ORGANIZATIONS_ENRICH
//   - decisionMakers field becomes empty array (legacy compat)
// If flag is OFF:
//   - Existing behavior unchanged
```

### Phase 5: Frontend — CompanyDetail KDM Section

| File | Change | Lines |
|------|--------|-------|
| `src/pages/Scout/CompanyDetail.jsx` | Add "ICP Contacts" section alongside existing KDM section | L919-1017 |
| `src/pages/Scout/CompanyDetail.jsx` | Add "Find ICP Contacts" button (triggers searchICPContacts) | New |
| `src/pages/Scout/CompanyDetail.jsx` | Add "Refresh ICP Contacts" button (force refresh cache) | New |
| `src/pages/Scout/CompanyDetail.jsx` | Feature-flag gate: show ICP section if `icpContactV2`, else show legacy KDM | New |
| `src/pages/Scout/CompanyDetail.css` | Add `.icp-contacts-section` styles (mirror existing `.decision-makers-section`) | New |

**UX Layout (Option B — Both Sections):**
```
┌─────────────────────────────────────┐
│  ICP Contacts at [Company Name]     │  ← NEW section (feature-flagged)
│  ┌─────┐ ┌─────┐ ┌─────┐          │
│  │Card1│ │Card2│ │Card3│          │
│  └─────┘ └─────┘ └─────┘          │
│  [Find ICP Contacts] [Refresh]      │  ← Button-click-only
│  Searched for: VP Sales, CMO, CRO   │  ← Shows titlesUsed from cache
├─────────────────────────────────────┤
│  Saved Contacts (12)                │  ← EXISTING section (unchanged)
│  ┌─────┐ ┌─────┐ ┌─────┐ ...      │
│  │Lead1│ │Lead2│ │Lead3│          │
│  └─────┘ └─────┘ └─────┘          │
│  [View All Leads]                   │
└─────────────────────────────────────┘
```

### Phase 6: Barry Title Validation

| File | Change | Lines |
|------|--------|-------|
| `netlify/functions/barryICPConversation.js` | Add title validation logic in `processInitialInput()` | L514-648 |
| `netlify/functions/barryICPConversation.js` | Validate: too vague, too generic, >3 selected | New checks |

**Validation rules:**
- If title is too vague (e.g., "Manager"): ask for specificity
- If title is too generic (e.g., "Employee"): suggest alternatives
- If >3 titles selected for primaryTitles: ask user to narrow down
- Confirm final 1-3 primary titles before saving

---

## 7. Feature Flag Implementation

### Storage

```javascript
// Firestore: users/{userId}
{
  featureFlags: {
    icpContactV2: true  // or false / missing
  }
}
```

### Reading (Frontend)

```javascript
// In CompanyDetail.jsx (or any component)
const [featureFlags, setFeatureFlags] = useState({});

useEffect(() => {
  const userDoc = await getDoc(doc(db, 'users', user.uid));
  setFeatureFlags(userDoc.data()?.featureFlags || {});
}, [user.uid]);

const useICPContacts = featureFlags.icpContactV2 === true;
```

### Reading (Backend — Netlify Functions)

```javascript
// In enrichCompany.js or searchICPContacts.js
const userDoc = await db.collection('users').doc(userId).get();
const flags = userDoc.data()?.featureFlags || {};
const useICPv2 = flags.icpContactV2 === true;
```

### Rollout Strategy

1. **Dev/testing:** Enable for your user ID only
2. **Canary:** Enable for 2-3 beta users
3. **Full rollout:** Set `icpContactV2: true` for all users
4. **Cleanup:** Remove flag checks once stable (keep flag field for future use)

---

## 8. Lifecycle States

### ICP Contact Discovery Lifecycle

```
[No ICP Set]
    │
    ▼ (user completes ICP with primaryTitles)
[ICP Ready]
    │
    ▼ (user opens CompanyDetail)
[Company Loaded — No ICP Cache]
    │
    ▼ (user clicks "Find ICP Contacts")
[Searching Apollo...]
    │
    ├── contacts found → [ICP Contacts Cached] → display cards
    │                         │
    │                         ▼ (14 days pass)
    │                     [Cache Expired] → user clicks "Refresh"
    │
    └── no contacts found → [None Found Cached] → show "No ICP matches"
                                │
                                ▼ (14 days pass)
                            [Cache Expired] → user clicks "Refresh"
```

### Contact Save Lifecycle (within ICP section)

```
[ICP Contact Displayed]         ← name, title, LinkedIn only (no email)
    │
    ▼ (user clicks "Add to Leads")
[Contact Saved]                 ← written to users/{userId}/contacts
    │                              source: 'icp_discovery'
    │                              status: 'pending_enrichment'
    │
    ▼ (user clicks "Enrich" in contact profile)
[Enrichment Running]            ← barryEnrich called
    │                              credits consumed for email reveal
    │
    ├── success → [Enriched]    ← email, phone, full profile available
    │                              lead_status: 'saved'
    │                              export_ready: true
    │
    └── failure → [Enrichment Failed]
                                   status: 'enrichment_failed'
```

---

## 9. Migration Strategy

### What Happens to Existing Data

| Data | Action | Reason |
|------|--------|--------|
| `company.apolloEnrichment.decisionMakers` | Kept (read-only) | Legacy KDM still displayed when flag is OFF |
| `company.selected_titles` | Kept | Becomes optional override |
| `contactScoring.titlePreferences` | Soft-deprecated | Stop reading, don't delete |
| `users/{userId}/icp.targetTitles` | Kept | `primaryTitles` derives from it |
| Existing saved contacts | Unchanged | Already in `contacts` collection |

### Legacy Company Handling

- Companies saved before this feature will NOT have `icpContacts` cache
- When user opens them, the "Find ICP Contacts" button appears
- No backfill job needed (lazy population confirmed)
- Legacy KDM cards still display from `apolloEnrichment.decisionMakers` (if flag OFF or as secondary data)

### primaryTitles Bootstrapping

For existing users who already have `targetTitles` but no `primaryTitles`:

```javascript
// On first load of CompanyDetail (when flag is ON):
if (!icpData.primaryTitles || icpData.primaryTitles.length === 0) {
  // Auto-populate from first 3 targetTitles
  const bootstrapped = (icpData.targetTitles || []).slice(0, 3);
  await updateDoc(doc(db, 'users', userId, 'icp'), {
    primaryTitles: bootstrapped,
    primaryTitlesUpdatedAt: new Date().toISOString()
  });
}
```

---

## 10. Risk & Rollback Plan

### Risk Matrix

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Apollo rate limit on Basic plan | Medium | Low | Cache + button-click-only + max 4 calls |
| Users confused by two contact sections | Low | Medium | Clear labels + section headers |
| `primaryTitles` empty (no ICP set) | Medium | Medium | Fallback to first 3 `targetTitles` |
| Netlify function timeout | Low | Low | 4 API calls << 900s timeout |
| Feature flag not read correctly | Medium | Low | Default to legacy behavior if flag missing |
| Data inconsistency during rollout | Low | Low | ICP cache is additive, doesn't modify existing data |

### Rollback Plan

**Level 1 — Disable feature (instant):**
```javascript
// Set flag to false for all users
// Firestore console or admin script:
db.collection('users').get().then(users => {
  users.forEach(user => {
    user.ref.update({ 'featureFlags.icpContactV2': false });
  });
});
```
Result: All users immediately see legacy KDM behavior. ICP cache data stays on company docs but is ignored.

**Level 2 — Revert code (5 min):**
```
git revert <commit-hash>
netlify deploy --prod
```
Result: New function removed, enrichCompany.js restored to original, CompanyDetail shows only legacy KDM.

**Level 3 — Clean up data (if needed):**
```javascript
// Remove icpContacts from all company docs
// Only needed if data is causing issues (unlikely)
```

### What is NOT at Risk

- Existing contacts/leads — untouched
- Existing enrichment flow — untouched
- Credit system — untouched
- Company enrichment data — untouched (we only skip KDM search, not org enrich)
- Other CompanyDetail sections — untouched

---

## 11. Implementation Phases

### Phase 1: Foundation (Feature Flags + Schema)
**Files:** `schema.js`, `firestore.rules`, user document
**Effort:** Small
- Add `featureFlags` field to user documents
- Update schema documentation
- Add `primaryTitles` path documentation
- No user-facing changes

### Phase 2: ICP primaryTitles
**Files:** `ICPBuilder.jsx`, `ICPStep3.jsx`, `BarryOnboarding.jsx`, `barryICPConversation.js`
**Effort:** Medium
- Add primaryTitles selection UI (pick top 3)
- Auto-bootstrap for existing users
- Barry validation for title quality
- No contact search changes yet

### Phase 3: Backend — ICP Contact Search
**Files:** New `searchICPContacts.js`, modify `enrichCompany.js`
**Effort:** Medium
- Create new Netlify function
- Add cache read/write logic
- Strip email from display response
- Feature-flag gate enrichCompany KDM removal

### Phase 4: Frontend — CompanyDetail ICP Section
**Files:** `CompanyDetail.jsx`, `CompanyDetail.css`
**Effort:** Medium
- Add ICP Contacts section (gated by flag)
- "Find ICP Contacts" button
- "Refresh ICP Contacts" button
- "Add to Leads" flow (reuse existing save logic)
- Display `titlesUsed` from cache

### Phase 5: Testing & Rollout
**Effort:** Small
- Enable flag for dev user
- Test all flows (search, cache, save, enrich)
- Enable for beta users
- Full rollout
- Monitor Apollo API usage

---

## 12. Open Items

| Item | Status | Notes |
|------|--------|-------|
| Apollo rate limits on Basic plan | Need to verify | Check Apollo docs for daily/hourly limits |
| Approximate active user count | Not provided | Needed for volume projection |
| Approximate saved companies count | Not provided | Needed for cache storage estimate |
| Firestore rules for `featureFlags` | To implement | Ensure only admin can write flags |
| Barry title validation prompts | To design | Exact Claude prompts for vague/generic title detection |
| `selected_titles` override UX | To design | How user switches from ICP titles to manual title search |

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                          │
│                                                                  │
│  CompanyDetail.jsx                                               │
│  ┌─────────────────────────────┐  ┌──────────────────────────┐  │
│  │  ICP Contacts Section       │  │  Saved Contacts Section  │  │
│  │  [Find ICP Contacts] btn    │  │  (existing, unchanged)   │  │
│  │  [Refresh] btn              │  │                          │  │
│  │  ┌──────┐┌──────┐┌──────┐  │  │  ┌──────┐┌──────┐...    │  │
│  │  │Card 1││Card 2││Card 3│  │  │  │Lead 1││Lead 2│       │  │
│  │  └──────┘└──────┘└──────┘  │  │  └──────┘└──────┘       │  │
│  │  "Searched: VP Sales, CMO"  │  │  [View All Leads]        │  │
│  │  [Add Selected to Leads]    │  │                          │  │
│  └─────────────┬───────────────┘  └──────────────────────────┘  │
│                │                                                  │
│                │ POST /.netlify/functions/searchICPContacts       │
│                ▼                                                  │
├──────────────────────────────────────────────────────────────────┤
│                     NETLIFY FUNCTIONS                             │
│                                                                  │
│  searchICPContacts.js (NEW)                                      │
│  ┌─────────────────────────────────────────────┐                │
│  │ 1. Validate Firebase auth                    │                │
│  │ 2. Read user's primaryTitles from ICP doc    │                │
│  │ 3. Check company.icpContacts cache           │                │
│  │    ├── cache valid → return cached            │                │
│  │    └── cache miss/expired:                    │                │
│  │        a. PEOPLE_SEARCH (titles, org, max 3)  │                │
│  │        b. 3x PEOPLE_MATCH (no email)          │                │
│  │        c. Write to company.icpContacts cache   │                │
│  │        d. Return contacts                     │                │
│  └─────────────────────────────────────────────┘                │
│                                                                  │
│  enrichCompany.js (MODIFIED)                                     │
│  ┌─────────────────────────────────────────────┐                │
│  │ If icpContactV2 flag ON:                     │                │
│  │   - SKIP hardcoded KDM search (lines 81-175) │                │
│  │   - Only run ORGANIZATIONS_ENRICH             │                │
│  │ If flag OFF:                                  │                │
│  │   - Existing behavior (unchanged)             │                │
│  └─────────────────────────────────────────────┘                │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                     APOLLO API (External)                        │
│                                                                  │
│  PEOPLE_SEARCH ──→ Find candidates by title + org (FREE)        │
│  PEOPLE_MATCH  ──→ Get full profile per candidate (FREE)        │
│  ORG_ENRICH    ──→ Company data by domain (FREE)                │
│                                                                  │
│  Credits consumed ONLY when email is enriched (Save → Enrich)   │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                     FIRESTORE (Database)                         │
│                                                                  │
│  users/{userId}/                                                 │
│  ├── icp                                                         │
│  │   ├── targetTitles: [...]        (unchanged)                  │
│  │   ├── primaryTitles: [max 3]     (NEW)                       │
│  │   └── primaryTitlesUpdatedAt     (NEW)                       │
│  ├── featureFlags                                                │
│  │   └── icpContactV2: boolean      (NEW)                       │
│  ├── companies/{companyId}                                       │
│  │   ├── apolloEnrichment           (unchanged)                  │
│  │   ├── selected_titles            (unchanged, optional override)│
│  │   └── icpContacts                (NEW — cached ICP results)   │
│  │       ├── contacts: [{name, title, linkedin_url, ...}]       │
│  │       ├── titlesUsed: [...]                                   │
│  │       ├── lastFetchedAt: ISO                                  │
│  │       └── status: 'found' | 'none_found'                    │
│  └── contacts/{contactId}                                        │
│      └── source: 'icp_discovery'    (NEW source value)          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

*This document is the complete pre-implementation specification. All architectural decisions have been confirmed. Ready for implementation upon approval.*
