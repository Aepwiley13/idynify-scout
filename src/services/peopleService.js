/**
 * PEOPLE SERVICE — Team Alpha
 * Operation People First // Universal People View Data Access
 *
 * The People view is the universal index of every person in the system.
 * This service provides the data layer for querying, filtering, and managing
 * people across all contextual lenses (Leads, Customers, Partners, Network, etc.).
 *
 * The individual is the atomic unit. This service treats them that way.
 *
 * Lenses are not different data models — they are filters.
 * Same collection, different queries, different Barry assumptions.
 *
 * Firestore collection: users/{userId}/contacts
 */

import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  addDoc,
  limit,
  startAfter,
  Timestamp
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { PEOPLE_PATHS, createPersonRecord } from '../schemas/peopleSchema';
import { recommendBrigade, BRIGADE_DEFINITIONS } from '../data/brigadeSystem';
import { resolvePersonTypeStatusTrigger, updateContactStatus, STATUS_TRIGGERS } from '../utils/contactStateMachine';
import { logTimelineEvent, logPersonTypeChanged, logBrigadeAssigned, ACTORS } from '../utils/engagementHistoryLogger';

// ── Constants ────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// ── People View Query Config ─────────────────────────────

/**
 * Lens definitions — each lens is a set of Firestore query constraints
 * that filter the universal people collection to a contextual workspace.
 *
 * Lenses do NOT change the data model — they change what Barry sees.
 */
export const PEOPLE_LENSES = {
  all: {
    id: 'all',
    label: 'All People',
    barryContext: 'Showing all contacts across all relationship types.',
    filters: [where('is_archived', '==', false)]
  },

  leads: {
    id: 'leads',
    label: 'Leads',
    barryContext: 'Showing leads — people you are actively working toward a business outcome with.',
    filters: [
      where('person_type', '==', 'lead'),
      where('is_archived', '==', false)
    ]
  },

  customers: {
    id: 'customers',
    label: 'Customers',
    barryContext: 'Showing current customers — focus on retention, satisfaction, and expansion.',
    filters: [
      where('person_type', '==', 'customer'),
      where('is_archived', '==', false)
    ]
  },

  partners: {
    id: 'partners',
    label: 'Partners',
    barryContext: 'Showing partners — collaborators, referral sources, and strategic alliances.',
    filters: [
      where('person_type', 'in', ['partner']),
      where('is_archived', '==', false)
    ]
  },

  network: {
    id: 'network',
    label: 'Network',
    barryContext: 'Showing network contacts — your relationship ecosystem and referral graph.',
    filters: [
      where('person_type', '==', 'network'),
      where('is_archived', '==', false)
    ]
  },

  past_customers: {
    id: 'past_customers',
    label: 'Past Customers',
    barryContext: 'Showing past customers — highest potential for re-engagement and referrals.',
    filters: [
      where('person_type', '==', 'past_customer'),
      where('is_archived', '==', false)
    ]
  },

  // Priority sub-views
  high_priority: {
    id: 'high_priority',
    label: 'High Priority',
    barryContext: 'Showing high and critical priority contacts across all types.',
    filters: [
      where('strategic_value', 'in', ['high', 'critical']),
      where('is_archived', '==', false)
    ]
  },

  needs_attention: {
    id: 'needs_attention',
    label: 'Needs Attention',
    barryContext: 'Showing contacts with pending Next Best Steps that are overdue.',
    filters: [
      where('next_best_step.status', 'in', ['pending', 'confirmed']),
      where('is_archived', '==', false)
    ]
  },

  referral_network: {
    id: 'referral_network',
    label: 'Referral Network',
    barryContext: 'Showing contacts who send referrals — your highest-leverage relationships.',
    filters: [
      where('referral_data.is_referral_source', '==', true),
      where('is_archived', '==', false)
    ]
  }
};

// ─────────────────────────────────────────────────────────────────
// QUERY — Load people by lens
// ─────────────────────────────────────────────────────────────────

/**
 * Load people for a given lens with optional sort and pagination.
 *
 * @param {string} userId
 * @param {string} lensId     - One of PEOPLE_LENSES keys
 * @param {Object} [options]
 * @param {string} [options.sortBy]         - Field to sort by (default: 'updatedAt')
 * @param {string} [options.sortDir]        - 'asc' | 'desc' (default: 'desc')
 * @param {number} [options.pageSize]       - Results per page (default: 50, max: 200)
 * @param {Object} [options.lastDoc]        - Last document for cursor pagination
 * @param {string} [options.brigadeFilter]  - Filter by brigade ID
 * @param {string} [options.statusFilter]   - Filter by contact_status
 * @param {string} [options.searchQuery]    - Text search (client-side, post-query)
 *
 * @returns {Promise<{ people: Array, hasMore: boolean, total: number }>}
 */
export async function loadPeopleForLens(userId, lensId, options = {}) {
  try {
    const lens = PEOPLE_LENSES[lensId];
    if (!lens) {
      console.error('[PeopleService] Unknown lens:', lensId);
      return { people: [], hasMore: false, total: 0 };
    }

    const {
      sortBy = 'updatedAt',
      sortDir = 'desc',
      pageSize = DEFAULT_PAGE_SIZE,
      lastDoc = null,
      brigadeFilter = null,
      statusFilter = null,
      searchQuery = null
    } = options;

    const effectivePageSize = Math.min(pageSize, MAX_PAGE_SIZE);
    const peopleRef = collection(db, PEOPLE_PATHS.allPeople(userId));

    // Build query constraints
    const constraints = [...lens.filters];

    if (brigadeFilter) {
      constraints.push(where('brigade', '==', brigadeFilter));
    }

    if (statusFilter) {
      constraints.push(where('contact_status', '==', statusFilter));
    }

    constraints.push(orderBy(sortBy, sortDir));
    constraints.push(limit(effectivePageSize + 1)); // +1 to detect hasMore

    if (lastDoc) {
      constraints.push(startAfter(lastDoc));
    }

    const q = query(peopleRef, ...constraints);
    const snap = await getDocs(q);

    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const hasMore = docs.length > effectivePageSize;
    const people = hasMore ? docs.slice(0, effectivePageSize) : docs;

    // Client-side text search (Firestore doesn't support full-text)
    const filtered = searchQuery
      ? people.filter(p => matchesSearch(p, searchQuery))
      : people;

    return {
      people: filtered,
      hasMore,
      lastDoc: snap.docs[effectivePageSize - 1] || null,
      lensContext: lens.barryContext
    };
  } catch (error) {
    console.error('[PeopleService] Failed to load people for lens:', error);
    return { people: [], hasMore: false, total: 0 };
  }
}

/**
 * Load a single person by ID.
 * Returns null if not found.
 *
 * @param {string} userId
 * @param {string} contactId
 * @returns {Promise<Object|null>}
 */
export async function loadPerson(userId, contactId) {
  try {
    const snap = await getDoc(doc(db, PEOPLE_PATHS.person(userId, contactId)));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  } catch (error) {
    console.error('[PeopleService] Failed to load person:', error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// WRITE — Create and update people
// ─────────────────────────────────────────────────────────────────

/**
 * Create a new person record in the system.
 * Barry immediately evaluates a brigade recommendation — user confirms on first open.
 *
 * @param {string} userId
 * @param {Object} identity       - Contact identity fields
 * @param {string} personType     - Initial person_type
 * @param {string} [addedFrom]    - Source of the contact
 * @returns {Promise<{ contactId: string, brigadeRecommendation: Object }>}
 */
export async function createPerson(userId, identity, personType = 'lead', addedFrom = 'manual') {
  try {
    const personData = createPersonRecord(identity, personType, addedFrom);
    const now = new Date().toISOString();

    const peopleRef = collection(db, PEOPLE_PATHS.allPeople(userId));
    const docRef = await addDoc(peopleRef, {
      ...personData,
      addedAt: now,
      updatedAt: now
    });

    const contactId = docRef.id;

    // If person_type is not 'lead', set the appropriate contact_status
    const statusTrigger = resolvePersonTypeStatusTrigger(personType);
    if (statusTrigger) {
      await updateContactStatus({
        userId,
        contactId,
        trigger: statusTrigger,
        currentStatus: 'New'
      });
    }

    // Compute Barry's brigade recommendation (do not auto-apply)
    const brigadeRecommendation = recommendBrigade({
      personType,
      relationshipType: identity.relationship_type || null,
      warmthLevel: identity.warmth_level || null,
      priorEngagement: null
    });

    // Log creation event
    await logTimelineEvent({
      userId,
      contactId,
      type: 'contact_status_changed',
      actor: ACTORS.SYSTEM,
      preview: `Person created — ${personType}`,
      metadata: {
        statusFrom: null,
        statusTo: 'New',
        trigger: 'contact_created',
        person_type: personType,
        added_from: addedFrom
      }
    });

    return { contactId, brigadeRecommendation };
  } catch (error) {
    console.error('[PeopleService] Failed to create person:', error);
    return { contactId: null, brigadeRecommendation: null };
  }
}

/**
 * Update core person fields.
 * Only updates the fields explicitly provided — does not overwrite the full document.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {Object} updates - Fields to update
 * @returns {Promise<boolean>}
 */
export async function updatePerson(userId, contactId, updates) {
  try {
    const contactRef = doc(db, PEOPLE_PATHS.person(userId, contactId));
    await updateDoc(contactRef, {
      ...updates,
      updatedAt: new Date().toISOString()
    });
    return true;
  } catch (error) {
    console.error('[PeopleService] Failed to update person:', error);
    return false;
  }
}

/**
 * Change a person's type (lens).
 * Updates person_type, triggers contact_status change, and logs the transition.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {string} newPersonType  - New person_type value
 * @param {string} [reason]       - Why the type is changing
 * @returns {Promise<boolean>}
 */
export async function changePersonType(userId, contactId, newPersonType, reason) {
  try {
    const contactRef = doc(db, PEOPLE_PATHS.person(userId, contactId));
    const snap = await getDoc(contactRef);
    if (!snap.exists()) return false;

    const contact = snap.data();
    const oldPersonType = contact.person_type;
    const now = new Date().toISOString();

    await updateDoc(contactRef, {
      person_type: newPersonType,
      updatedAt: now
    });

    // Trigger appropriate contact_status change
    const statusTrigger = resolvePersonTypeStatusTrigger(newPersonType);
    if (statusTrigger) {
      await updateContactStatus({
        userId,
        contactId,
        trigger: statusTrigger,
        currentStatus: contact.contact_status
      });
    }

    // Log timeline event
    await logPersonTypeChanged(userId, contactId, {
      fromType: oldPersonType,
      toType: newPersonType,
      reason: reason || null
    });

    return true;
  } catch (error) {
    console.error('[PeopleService] Failed to change person type:', error);
    return false;
  }
}

/**
 * Confirm a brigade assignment suggested by Barry.
 * Applies the brigade and logs the assignment.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {string} brigadeId - Brigade ID to assign
 * @param {string} reasoning - Barry's reasoning for the assignment
 * @param {string} confidence - 'high' | 'medium' | 'low'
 */
export async function confirmBrigadeAssignment(userId, contactId, brigadeId, reasoning, confidence) {
  try {
    const contactRef = doc(db, PEOPLE_PATHS.person(userId, contactId));
    const snap = await getDoc(contactRef);
    if (!snap.exists()) return false;

    const now = new Date().toISOString();
    const brigadeDef = BRIGADE_DEFINITIONS[brigadeId];
    if (!brigadeDef) {
      console.error('[PeopleService] Unknown brigade:', brigadeId);
      return false;
    }

    const contact = snap.data();
    const brigadeHistory = Array.isArray(contact.brigade_history)
      ? [...contact.brigade_history]
      : [];

    brigadeHistory.push({
      from: contact.brigade || null,
      to: brigadeId,
      reason: reasoning || 'Initial assignment',
      trigger: 'barry_recommendation_confirmed',
      transitioned_at: now
    });

    await updateDoc(contactRef, {
      brigade: brigadeId,
      brigade_updated_at: now,
      brigade_history: brigadeHistory,
      updatedAt: now
    });

    await logBrigadeAssigned(userId, contactId, {
      brigadeId,
      brigadeLabel: brigadeDef.label,
      reasoning: reasoning || 'Barry recommendation confirmed',
      confidence: confidence || 'medium'
    });

    return true;
  } catch (error) {
    console.error('[PeopleService] Failed to confirm brigade assignment:', error);
    return false;
  }
}

/**
 * Archive a person (soft delete).
 * Person is never hard deleted — set is_archived = true.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {string} reason - 'duplicate' | 'not_relevant' | 'spam' | 'other'
 */
export async function archivePerson(userId, contactId, reason) {
  try {
    await updateDoc(doc(db, PEOPLE_PATHS.person(userId, contactId)), {
      is_archived: true,
      status: 'people_mode_archived',
      archived_at: new Date().toISOString(),
      archived_reason: reason || 'other',
      updatedAt: new Date().toISOString()
    });
    return true;
  } catch (error) {
    console.error('[PeopleService] Failed to archive person:', error);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────
// SEARCH AND FILTER
// ─────────────────────────────────────────────────────────────────

/**
 * Search across all people — used for the universal search bar.
 * Performs a client-side search on names, company, email, and tags.
 *
 * For production scale, this should be replaced with an Algolia or
 * Typesense integration. This implementation works for up to ~1000 contacts.
 *
 * @param {string} userId
 * @param {string} searchTerm
 * @param {string} [lensId] - Optional lens to scope the search
 * @returns {Promise<Array>}
 */
export async function searchPeople(userId, searchTerm, lensId = 'all') {
  try {
    if (!searchTerm || searchTerm.trim().length < 2) return [];

    // Load all non-archived people (up to 500 for search)
    const lens = PEOPLE_LENSES[lensId] || PEOPLE_LENSES.all;
    const peopleRef = collection(db, PEOPLE_PATHS.allPeople(userId));
    const constraints = [...lens.filters, orderBy('name', 'asc'), limit(500)];
    const q = query(peopleRef, ...constraints);
    const snap = await getDocs(q);

    const people = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return people.filter(p => matchesSearch(p, searchTerm));
  } catch (error) {
    console.error('[PeopleService] Search failed:', error);
    return [];
  }
}

/**
 * Get counts for all lenses — used for navigation badges.
 *
 * @param {string} userId
 * @returns {Promise<Object>} { leads: number, customers: number, ... }
 */
export async function getLensCounts(userId) {
  try {
    const counts = {};

    await Promise.all(
      Object.entries(PEOPLE_LENSES).map(async ([lensId, lens]) => {
        if (lensId === 'all') return; // Skip — expensive to count all
        try {
          const peopleRef = collection(db, PEOPLE_PATHS.allPeople(userId));
          const q = query(peopleRef, ...lens.filters, limit(999));
          const snap = await getDocs(q);
          counts[lensId] = snap.size;
        } catch {
          counts[lensId] = 0;
        }
      })
    );

    return counts;
  } catch (error) {
    console.error('[PeopleService] Failed to get lens counts:', error);
    return {};
  }
}

/**
 * Get all unique tags used across a user's contacts.
 * Used for tag autocomplete in the profile editor and tag filter in the list.
 *
 * @param {string} userId
 * @returns {Promise<string[]>} Sorted array of unique tag strings
 */
export async function getUniqueTags(userId) {
  try {
    const peopleRef = collection(db, PEOPLE_PATHS.allPeople(userId));
    const q = query(peopleRef, where('is_archived', '==', false), limit(500));
    const snap = await getDocs(q);
    const tagSet = new Set();
    snap.docs.forEach(d => {
      const tags = d.data().tags;
      if (Array.isArray(tags)) tags.forEach(t => { if (t) tagSet.add(t); });
    });
    return [...tagSet].sort((a, b) => a.localeCompare(b));
  } catch (err) {
    console.error('[PeopleService] Failed to get unique tags:', err);
    return [];
  }
}

// ── Helpers ──────────────────────────────────────────────

function matchesSearch(person, term) {
  const q = term.toLowerCase().trim();
  const name = (person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim()).toLowerCase();
  const company = (person.company || '').toLowerCase();
  const email = (person.email || '').toLowerCase();
  const tags = (person.tags || []).join(' ').toLowerCase();

  return name.includes(q) || company.includes(q) || email.includes(q) || tags.includes(q);
}
