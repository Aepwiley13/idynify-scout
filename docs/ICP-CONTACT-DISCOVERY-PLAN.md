# ICP Contact Discovery — Implementation Plan

## Problem Statement

When a user swipes right (saves) a company, **nothing happens with contacts**. The user must:
1. Navigate back to Saved Companies
2. Click into the company
3. Open the Title Selection Modal
4. Manually pick titles
5. Click "Search Contacts"
6. Wait for results
7. Individually approve each contact

This friction means most saved companies sit with **zero contacts** indefinitely. The ICP profile already has `targetTitles` — the user told us who they want to reach. We should use that immediately.

---

## What This Plan Does

**Automatically discover ICP-matched contacts the moment a company is saved.** No new APIs. No new infrastructure. We wire together existing pieces that are currently disconnected.

## What This Plan Does NOT Do

- Does NOT remove any existing functionality
- Does NOT change the Title Selection Modal flow
- Does NOT change the Contact Search flow in CompanyDetail
- Does NOT change how decision makers work in CompanyDetailModal
- Does NOT change how contacts are approved, enriched, or scored
- Does NOT add new Netlify functions or API endpoints
- Users retain full manual control — auto-discovered contacts are **suggestions**, not auto-approved

---

## Current Architecture (What Exists Today)

### Data Stores

| Collection Path | Purpose | Key Fields |
|---|---|---|
| `users/{uid}/companyProfile/current` | ICP definition | `targetTitles: string[]`, `industries`, `companySizes`, `locations` |
| `users/{uid}/contactScoring/titlePreferences` | Contact scoring config | `titles: [{title, priority, order}]` |
| `users/{uid}/companies/{companyId}` | Saved company | `status`, `selected_titles`, `apolloEnrichment`, `contact_count` |
| `users/{uid}/contacts/{contactId}` | Individual contacts | `company_id`, `status`, `source`, `lead_owner` |

### Current Save Flow (DailyLeads.jsx:164-272)

```
Swipe Right → status: 'accepted' → check titlePreferences → move to next card
```

- Line 182-187: Sets `status: 'accepted'`, `swipedAt`, `swipeDirection`
- Line 220-258: First-time check — if no `titlePreferences` exist, auto-populates from ICP `targetTitles` or shows ContactTitleSetup modal
- **Gap:** Never sets `selected_titles` on the company doc. Never calls `searchPeople`.

### Current Contact Search (CompanyDetail.jsx:35-74)

```
Load company → read selected_titles → if titles exist → searchContacts()
```

- Line 58: Reads `selected_titles` from company doc
- Line 67-69: Auto-searches ONLY if `selected_titles.length > 0`
- **Gap:** `selected_titles` is never set at save time, so this never fires automatically.

### Current Decision Makers (enrichCompany.js:81-175)

```
Open CompanyDetailModal → enrichCompanyData() → Apollo PEOPLE_SEARCH (hardcoded seniority/dept)
```

- Line 91-96: Hardcoded filters: `person_seniority: ['director', 'vp', 'c_suite', 'founder', 'owner']`, `person_departments: ['sales', 'marketing', 'operations', 'finance']`
- **Completely separate from user's ICP targetTitles.**

### Current Title Selection (TitleSelectionModal.jsx:107-134)

```
User selects titles → saves to company.selected_titles → onConfirm callback → navigates to CompanyDetail
```

- Line 119-122: Writes `selected_titles` array + `titles_updated_at` to company doc
- This is the ONLY path that sets `selected_titles` on a company today

---

## Implementation Plan

### Phase 1: Auto-Set Titles on Save (Frontend Only)

**Goal:** When a user saves a company, automatically snapshot their ICP `targetTitles` onto the company doc as `selected_titles`.

**File:** `src/pages/Scout/DailyLeads.jsx`

**Change:** Inside `handleSwipe()`, after setting `status: 'accepted'` (line 187), add logic to:

1. Read `targetTitles` from `users/{uid}/companyProfile/current` (we already fetch this on line 227-228 for titlePreferences check — reuse it)
2. If `targetTitles` exists and has entries, write them to the company doc as `selected_titles`

**Exact insertion point:** After line 187 (status update), before line 189 (swipe progress)

```javascript
// Auto-set selected_titles from ICP targetTitles
const icpProfileRef = doc(db, 'users', user.uid, 'companyProfile', 'current');
const icpProfileDoc = await getDoc(icpProfileRef);

if (icpProfileDoc.exists() && icpProfileDoc.data().targetTitles?.length > 0) {
  const targetTitles = icpProfileDoc.data().targetTitles;
  const formattedTitles = targetTitles.map((title, index) => ({
    title,
    rank: index + 1,
    score: 100 - (index * 10)
  }));

  await updateDoc(companyRef, {
    selected_titles: formattedTitles,
    titles_updated_at: new Date().toISOString(),
    titles_source: 'icp_auto'  // Track that these were auto-set
  });
}
```

**What this enables:** When the user later opens CompanyDetail, `selected_titles` already exists, so `searchContacts()` fires automatically (CompanyDetail.jsx:67-69).

**What this preserves:**
- The existing titlePreferences auto-population (line 220-258) still runs — it handles the `contactScoring` collection, which is separate
- The TitleSelectionModal still works — user can override `selected_titles` anytime
- The ContactTitleSetup modal still shows on first swipe if no titlePreferences exist
- Nothing changes for companies that were already saved (no `selected_titles` = no change)

**Edge cases:**
- User has no ICP targetTitles → nothing is set, behaves exactly as today
- User has targetTitles → they get auto-applied, user sees contacts when they open the company
- User later changes titles via TitleSelectionModal → overwrites auto-set titles (line 119-122 does a full replace)

**Optimization: Avoid duplicate Firestore reads.** The ICP profile is already fetched on line 227-228 for the titlePreferences check. Restructure to fetch it once and reuse:

```javascript
// Fetch ICP profile once (used for both title auto-set and preferences check)
const icpProfileRef = doc(db, 'users', user.uid, 'companyProfile', 'current');
const icpProfileDoc = await getDoc(icpProfileRef);
const targetTitles = icpProfileDoc.exists() ? icpProfileDoc.data().targetTitles || [] : [];
```

Then use `targetTitles` in both the auto-set block and the existing titlePreferences block (line 230).

---

### Phase 2: Background Contact Search on Save

**Goal:** Trigger `searchPeople` in the background immediately after saving, so contacts are ready when the user opens the company.

**File:** `src/pages/Scout/DailyLeads.jsx`

**Change:** After writing `selected_titles` to the company doc (Phase 1), fire a non-blocking call to `searchPeople`:

```javascript
// Background contact search — non-blocking (don't await)
if (company.apollo_organization_id && formattedTitles.length > 0) {
  const authToken = await user.getIdToken();

  fetch('/.netlify/functions/searchPeople', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: user.uid,
      authToken,
      organizationId: company.apollo_organization_id,
      titles: formattedTitles.map(t => t.title)
    })
  })
  .then(res => res.json())
  .then(async (result) => {
    if (result.success && result.people?.length > 0) {
      // Save as suggested contacts (NOT auto-approved)
      for (const person of result.people) {
        const contactId = `${company.id}_${person.id}`;
        const contactRef = doc(db, 'users', user.uid, 'contacts', contactId);
        await setDoc(contactRef, {
          ...person,
          company_id: company.id,
          company_name: company.name,
          lead_owner: user.uid,
          status: 'suggested',        // NOT 'pending_enrichment' — user must approve
          source: 'icp_auto_discovery',
          discovered_at: new Date().toISOString()
        });
      }

      // Update company with discovery metadata
      await updateDoc(companyRef, {
        auto_contact_status: 'completed',
        auto_contact_count: result.people.length,
        auto_contact_searched_at: new Date().toISOString()
      });
    }
  })
  .catch(err => {
    console.error('Background contact search failed:', err);
    // Non-critical — user can still search manually
  });
}
```

**What this preserves:**
- Contacts saved with `status: 'suggested'` — they are NOT auto-approved
- The user still sees them as suggestions when they open CompanyDetail
- Manual search via CompanyDetail still works independently
- If the background search fails, the user experience is identical to today

**Required: Undo Cleanup (DailyLeads.jsx `handleUndo`, line 274+)**

When the user undoes a save, the current code resets `status` to `'pending'` but doesn't clean up auto-discovered data. We must extend `handleUndo` to:

1. Clear `selected_titles` and auto-contact metadata from the company doc
2. Delete any contacts with `source: 'icp_auto_discovery'` for that company

```javascript
// Inside handleUndo, after resetting company status (line 288):

// Clean up auto-set titles if they were from ICP
if (lastSwipe.direction === 'right') {
  await updateDoc(companyRef, {
    selected_titles: null,
    titles_updated_at: null,
    titles_source: null,
    auto_contact_status: null,
    auto_contact_count: null,
    auto_contact_searched_at: null
  });

  // Delete auto-discovered contacts for this company
  const autoContactsQuery = query(
    collection(db, 'users', user.uid, 'contacts'),
    where('company_id', '==', lastSwipe.company.id),
    where('source', '==', 'icp_auto_discovery')
  );
  const autoContactDocs = await getDocs(autoContactsQuery);
  for (const contactDoc of autoContactDocs.docs) {
    await deleteDoc(contactDoc.ref);
  }
}
```

This ensures a clean undo — no orphaned contacts, no stale titles.

**API credit consideration:**
- `searchPeople` costs 1 PEOPLE_SEARCH + up to 10 PEOPLE_MATCH = **11 Apollo credits per company**
- With 25 saves/day limit: **max 275 credits/day/user**
- This is the same cost as the user manually searching — it just happens earlier
- Can be gated behind a feature flag or user setting if credit budget is a concern

**What the user sees:**
- Swipe right → moves to next company (no delay — search is non-blocking)
- Later opens the company → contacts are already there with "Suggested" status
- User reviews and approves the ones they want

---

### Phase 3: Display Suggested Contacts in CompanyDetail

**Goal:** Show auto-discovered contacts distinctly from manually-searched contacts.

**File:** `src/pages/Scout/CompanyDetail.jsx`

**Changes:**

1. **Modify `loadApprovedContacts()` (line 77-97)** to also load `status: 'suggested'` contacts:

```javascript
// Load both approved AND suggested contacts
const contactsQuery = query(
  collection(db, 'users', userId, 'contacts'),
  where('company_id', '==', companyId)
);
const contactDocs = await getDocs(contactsQuery);

const allContacts = contactDocs.docs.map(d => ({ id: d.id, ...d.data() }));
const approved = allContacts.filter(c => c.status !== 'suggested');
const suggested = allContacts.filter(c => c.status === 'suggested');

setApprovedContacts(approved);
setSuggestedContacts(suggested);  // New state variable
```

2. **Add a "Suggested Contacts" section** in the JSX, above the manual search section. This shows contacts found by ICP auto-discovery with a distinct visual treatment (e.g., "Auto-discovered from your ICP" badge).

3. **Add bulk approve action** for suggested contacts — user can approve all or pick individually. On approve, update `status` from `'suggested'` to `'pending_enrichment'` and trigger `enrichContact()`.

**What this preserves:**
- Existing "Saved Contacts" section (line 844-916) unchanged
- Existing "Available Contacts" from manual search (line 1099-1296) unchanged
- Decision makers section (line 919-1017) unchanged
- Manual title search still works independently

**Required: Fix Contact Count in SavedCompanies.jsx**

The `enrichWithContactCounts` function (line 251-267) currently counts ALL contacts for a company with no status filter. If we add `suggested` contacts, the count inflates misleadingly.

**File:** `src/pages/Scout/SavedCompanies.jsx`

**Change:** Add a status filter to the contact count query:

```javascript
// Current (no filter):
const contactsQuery = query(
  collection(db, 'users', userId, 'contacts'),
  where('company_id', '==', company.id)
);

// Fixed (exclude suggested):
const contactsQuery = query(
  collection(db, 'users', userId, 'contacts'),
  where('company_id', '==', company.id),
  where('status', 'not-in', ['suggested'])
);
```

This ensures the company card badge only shows contacts the user has actually approved, while suggested contacts are counted separately.

---

### Phase 4: ICP-Aligned Decision Makers (Optional Enhancement)

**Goal:** Use the user's `targetTitles` to inform decision maker search, not just hardcoded seniority/department.

**File:** `netlify/functions/enrichCompany.js`

**Change:** Accept optional `targetTitles` parameter and merge with existing seniority filters:

```javascript
// Current (line 91-96):
const searchBody = {
  organization_ids: [orgId],
  person_seniority: ['director', 'vp', 'c_suite', 'founder', 'owner'],
  person_departments: ['sales', 'marketing', 'operations', 'finance'],
  page: 1,
  per_page: 3
};

// Enhanced: if targetTitles provided, add them
if (targetTitles && targetTitles.length > 0) {
  searchBody.person_titles = targetTitles.slice(0, 5); // Cap at 5 to keep results focused
  searchBody.per_page = 5;  // Get a few more since we're being more specific
}
```

**What this preserves:**
- Existing seniority/department filters remain — they're additive with title filters
- If no targetTitles passed, behavior is identical to today
- Cached results still work (14-day TTL)
- CompanyDetailModal passes `targetTitles` only if available

**Why this is optional:** Phases 1-3 solve the core problem. Phase 4 improves relevance of the decision maker section but isn't blocking.

---

## Non-Breaking Validation Checklist

| Existing Feature | Impact | Validated |
|---|---|---|
| Swipe right saves company as `accepted` | No change — we add to the save, not replace it | Yes |
| Swipe left rejects company | No change — Phase 1 only runs on `direction === 'right'` | Yes |
| Daily swipe limit (25) | No change — limit check happens before our code | Yes |
| Undo swipe | **Requires cleanup** — must clear `selected_titles` and delete `icp_auto_discovery` contacts on undo | Yes (with fix) |
| ContactTitleSetup modal (first swipe) | No change — still fires independently; writes to `contactScoring`, not `selected_titles` | Yes |
| TitleSelectionModal (manual title selection) | No change — user can still override `selected_titles` at any time | Yes |
| CompanyDetail auto-search | **Improved** — now triggers automatically because `selected_titles` exists | Yes |
| Manual contact search in CompanyDetail | No change — still works; re-searches with current titles | Yes |
| Decision makers in CompanyDetailModal | No change (unless Phase 4 is implemented, which is additive) | Yes |
| Contact approval flow | No change — suggested contacts must still be approved by user | Yes |
| Contact enrichment flow | No change — enrichContact still runs on approval | Yes |
| SavedCompanies list and navigation | **Requires fix** — `enrichWithContactCounts` must exclude `suggested` contacts to avoid inflating metrics | Yes (with fix) |
| Archive/restore companies | No change — operates on `status` field only | Yes |
| Daily leads refresh (scheduled) | No change — `search-companies.js` is unmodified | Yes |

---

## File Change Summary

| File | Phase | Type of Change |
|---|---|---|
| `src/pages/Scout/DailyLeads.jsx` | 1, 2 | Add ~40 lines inside `handleSwipe()` + undo cleanup in `handleUndo()` |
| `src/pages/Scout/CompanyDetail.jsx` | 3 | Modify `loadApprovedContacts()` + add suggested contacts section |
| `src/pages/Scout/SavedCompanies.jsx` | 3 | Fix `enrichWithContactCounts` to exclude `suggested` status |
| `netlify/functions/enrichCompany.js` | 4 | Optional: accept `targetTitles` param |
| `src/components/scout/CompanyDetailModal.jsx` | 4 | Optional: pass `targetTitles` to enrichCompany |

**No new files. No new API endpoints. No new Netlify functions. No database migrations.**

---

## Apollo API Credit Budget

| Action | Credits Per Company | When |
|---|---|---|
| Auto search (Phase 2) | 1 search + 10 match = **11** | On save (background) |
| Manual search (existing) | 1 search + 10 match = **11** | On CompanyDetail open |
| Enrichment (existing) | 1 org enrich + 1 search + 3 match = **5** | On CompanyDetailModal open |

**Phase 2 does NOT add new cost if the user would have searched anyway.** It just moves the search earlier. If the user saves a company but never opens it, Phase 2 does spend 11 credits that wouldn't have been spent. This is bounded by the 25/day swipe limit = **max 275 credits/day/user**.

**Mitigation options:**
- Only auto-search for the first 10 saved companies per day (most impactful)
- Only auto-search if user has opened >50% of previously saved companies (engaged users)
- Add a user setting: "Auto-discover contacts for saved companies" (default on)
- Skip Phase 2 entirely — Phase 1 alone still means contacts load on first CompanyDetail visit

---

## Recommended Implementation Order

1. **Phase 1** — Ship alone, immediately valuable. Zero API cost increase. When users open saved companies, contacts appear automatically.
2. **Phase 3** — Add the "Suggested" UI treatment if Phase 2 is planned.
3. **Phase 2** — Background search. Only if API credit budget allows. Can be feature-flagged.
4. **Phase 4** — Optional polish. Improves decision maker relevance.

**Phase 1 alone solves 80% of the problem with 0% additional API cost.**

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| User has no targetTitles in ICP | Medium | None — code short-circuits, no change | Guard clause on targetTitles |
| Apollo rate limit on bulk saves | Low | Background search fails silently | Non-blocking fetch with catch |
| User undoes a save, orphaned contacts | **High** | Contacts from first swipe persist after undo and reappear later | **Required fix:** `handleUndo` must delete contacts where `source === 'icp_auto_discovery'` and clear `selected_titles` on the company doc |
| Contact count inflation in SavedCompanies | **Moderate** | `enrichWithContactCounts` counts ALL contacts including suggested | **Required fix:** add `where('status', '!=', 'suggested')` filter to count query |
| Duplicate contacts (auto + manual) | Medium | Minor confusion | Use consistent contactId format (`companyId_personId`) — setDoc is idempotent |
| API credits spike | Low | Budget impact | Phase 2 is optional; Phase 1 has zero API cost |

---

## Code Validation Report

The following was verified by reading every line of code in the affected files:

### Verified Safe
1. **ICP profile read** — `companyProfile/current` is already read on DailyLeads.jsx:227-228. Reuse that read. Guard clause on `targetTitles?.length > 0` handles missing ICP gracefully.
2. **`loadApprovedContacts` query** (CompanyDetail.jsx:81-84) — currently loads ALL contacts for a company with no status filter. `suggested` contacts will appear automatically. This is the desired behavior.
3. **Search results filtering** (CompanyDetail.jsx:1207-1208) — filters `contacts` by checking `approvedContacts[].apollo_person_id`. Auto-discovered contacts saved with `apollo_person_id` will be correctly excluded from "Available Contacts". No double-display risk.
4. **`mapApolloToScoutContact`** (scoutContactContract.js:105-140) — uses spread operator `...apolloPerson` preserving all fields. Field names (`id`, `name`, `email`, `phone_numbers`, `linkedin_url`, `photo_url`) match what CompanyDetail.jsx expects. Safe to use in Phase 2.
5. **Source field `'icp_auto_discovery'`** — ContactDetailModal.jsx:179 falls back to Apollo badge for unknown sources (`badges[contact.source] || badges.apollo`). No existing queries filter by `source`. Safe to add.
6. **`deleteDoc` import** — DailyLeads.jsx:4 does NOT currently import `deleteDoc`. Must be added for undo cleanup.

### Issues Found and Fixed in Plan
1. **HIGH: Undo orphans contacts** — `handleUndo` resets company to `pending` but doesn't delete auto-discovered contacts. Fix: delete contacts with `source === 'icp_auto_discovery'` during undo. Added to Phase 2.
2. **MODERATE: Contact count inflation** — `enrichWithContactCounts` in SavedCompanies.jsx counts all contacts without status filter. Fix: exclude `suggested` status. Added to Phase 3.

### No Issues Found
- Phase 1 (auto-set titles) has zero risk — it writes a field that already exists in the schema
- Phase 4 (ICP decision makers) is additive — existing filters remain, new ones are optional
- No Firestore security rules need updating (writes stay within `users/{uid}/` path)
- No new imports needed in backend functions
