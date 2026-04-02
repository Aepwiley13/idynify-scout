/**
 * barryContextStack.js — Client-side context loader for Barry Mission Control.
 *
 * Loads the full data payload that Barry needs for every chat call:
 *   - All contacts (up to 500, regardless of mode/stage)
 *   - Active missions (status, steps, last outcome)
 *   - RECON data (confidence score + key sections)
 *
 * Called once on mount in BarryChatPanel, then refreshed when missions change.
 * The returned object is sent to barryMissionChat on every message send.
 *
 * RECON sections are trimmed to 300 chars each to stay within prompt limits.
 */

import {
  collection, query, where, limit,
  getDocs, doc, getDoc
} from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { calculateReconConfidence } from './reconConfidence';

async function getAllContacts(userId) {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'users', userId, 'contacts'),
        limit(500)
      )
    );

    return snap.docs.map(d => {
      const c = d.data();
      return {
        id: d.id,
        name: c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim(),
        first_name: c.first_name || null,
        title: c.title || null,
        company: c.company_name || null,
        relationship_state: c.relationship_state || 'unaware',
        strategic_value: c.strategic_value || null,
        last_interaction: c.last_interaction_at || null,
        last_outcome: c.last_outcome || null,
        hunter_status: c.hunter_status || null,
        contact_status: c.contact_status || null,
        person_type: c.person_type || 'lead',
        stage: c.stage || 'scout',
        email: c.email || null,
        active_mission_id: c.active_mission_id || null
      };
    });
  } catch (err) {
    console.warn('[barryContextStack] Failed to load contacts:', err.message);
    return [];
  }
}

async function getIcpProfile(userId) {
  try {
    const profileDoc = await getDoc(doc(db, 'users', userId, 'companyProfile', 'current'));
    return profileDoc.exists() ? profileDoc.data() : null;
  } catch (err) {
    console.warn('[barryContextStack] Failed to load ICP profile:', err.message);
    return null;
  }
}

async function getActiveMissions(userId) {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'users', userId, 'missions'),
        where('status', '==', 'active'),
        limit(20)
      )
    );

    return snap.docs.map(d => {
      const m = d.data();
      const stepsArr = Array.isArray(m.steps) ? m.steps : [];
      const currentStep = stepsArr.find(s => s.status === 'current');
      const completedSteps = stepsArr.filter(s => s.status === 'completed');
      const lastCompleted = completedSteps[completedSteps.length - 1];

      return {
        id: d.id,
        contactId: m.contactId,
        outcome_goal: m.outcome_goal,
        status: m.status,
        current_step: currentStep?.stepNumber || 1,
        steps_total: stepsArr.length,
        last_outcome: lastCompleted?.outcome || null,
        barry_reasoning: m.barry_reasoning || null
      };
    });
  } catch (err) {
    console.warn('[barryContextStack] Failed to load missions:', err.message);
    return [];
  }
}

/**
 * Check if a Google Calendar integration is connected for this user.
 * Returns a lightweight calendar summary: upcoming meetings with Hunter contacts.
 * Non-blocking — returns empty array on any failure.
 */
async function getCalendarContext(userId, contacts) {
  try {
    // Check if calendar is connected
    const calSnap = await getDoc(doc(db, 'users', userId, 'integrations', 'googleCalendar'));
    if (!calSnap.exists() || calSnap.data().status !== 'connected') return [];

    const user = auth.currentUser;
    if (!user) return [];
    const authToken = await user.getIdToken();

    // Fetch upcoming 30-day calendar events
    const res = await fetch('/.netlify/functions/calendar-list-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, authToken, maxResults: 30 }),
    });
    if (!res.ok) return [];

    const data = await res.json();
    const events = data.events || [];
    if (events.length === 0) return [];

    // Match calendar events to Hunter contacts by email
    const hunterContactEmails = new Set(
      contacts
        .filter(c => c.hunter_status && c.last_interaction !== undefined)
        .map(c => c.email?.toLowerCase())
        .filter(Boolean)
    );

    // Also build a name-based lookup for fuzzy matching
    const hunterContactNames = contacts
      .filter(c => c.hunter_status)
      .map(c => ({ id: c.id, name: c.name?.toLowerCase(), email: c.email?.toLowerCase() }))
      .filter(c => c.name);

    return events
      .filter(ev => {
        const attendeeEmails = (ev.attendees || []).map(a => a.email?.toLowerCase());
        // Direct email match
        if (attendeeEmails.some(e => hunterContactEmails.has(e))) return true;
        // Name in title
        if (ev.title && hunterContactNames.some(c => ev.title.toLowerCase().includes(c.name))) return true;
        return false;
      })
      .slice(0, 10)
      .map(ev => {
        // Find the matched contact
        const attendeeEmails = (ev.attendees || []).map(a => a.email?.toLowerCase());
        const matched = contacts.find(c =>
          attendeeEmails.includes(c.email?.toLowerCase()) ||
          (ev.title && c.name && ev.title.toLowerCase().includes(c.name.toLowerCase()))
        );
        return {
          eventId: ev.id,
          title: ev.title,
          startDateTime: ev.startDateTime,
          contactId: matched?.id || null,
          contactName: matched?.name || null,
        };
      });
  } catch (err) {
    console.warn('[barryContextStack] Calendar context load failed (non-fatal):', err.message);
    return [];
  }
}

function extractSection(dashboardData, sectionId) {
  if (!dashboardData?.modules) return null;
  const reconModule = dashboardData.modules.find(m => m.id === 'recon');
  if (!reconModule?.sections) return null;
  const section = reconModule.sections.find(s => s.id === sectionId);
  if (!section?.data || section.status !== 'completed') return null;

  if (typeof section.data === 'string') return section.data.slice(0, 300);
  if (typeof section.data === 'object') return JSON.stringify(section.data).slice(0, 300);
  return null;
}

const CONTEXT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Per-user cache key prevents cross-user cache collisions (e.g. impersonation)
function getCacheKey(userId) {
  return `barry_context_cache_${userId}`;
}

/**
 * Build the full context stack for Barry.
 * Returns a cached version if available and fresh (< 5 min old).
 * @param {string} userId
 * @returns {Promise<Object>} contextStack
 */
export async function buildContextStack(userId) {
  if (!userId) return emptyStack();

  // Check sessionStorage cache first for instant repeat loads
  try {
    const cached = sessionStorage.getItem(getCacheKey(userId));
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.cachedAt < CONTEXT_CACHE_TTL) {
        return parsed.stack;
      }
    }
  } catch (_) { /* cache miss — proceed to fresh load */ }

  try {
    const [contacts, missions, dashboardDoc, icpProfile] = await Promise.all([
      getAllContacts(userId),
      getActiveMissions(userId),
      getDoc(doc(db, 'dashboards', userId)),
      getIcpProfile(userId)
    ]);

    // Load calendar context after contacts are resolved (needs contact list for matching)
    const calendarEvents = await getCalendarContext(userId, contacts);

    const dashboardData = dashboardDoc.exists() ? dashboardDoc.data() : null;
    const reconConfidence = calculateReconConfidence(dashboardData);

    const recon = dashboardData ? {
      confidence: reconConfidence,
      enhanced: reconConfidence >= 40,
      pain_points: extractSection(dashboardData, 'painPoints'),
      icp: extractSection(dashboardData, 'icp'),
      value_proposition: extractSection(dashboardData, 'valueProposition'),
      outreach_context: extractSection(dashboardData, 'outreachContext')
    } : { confidence: 0, enhanced: false };

    const stack = {
      contacts,
      missions,
      recon,
      icpProfile: icpProfile || null,
      calendarEvents,
      user_style: dashboardData?.communicationStyle || null,
      timestamp: new Date().toISOString()
    };

    // Cache in sessionStorage for instant repeat loads
    try {
      sessionStorage.setItem(getCacheKey(userId), JSON.stringify({
        cachedAt: Date.now(),
        stack
      }));
    } catch (_) { /* storage full or unavailable — non-fatal */ }

    return stack;
  } catch (err) {
    console.warn('[barryContextStack] Build failed (non-fatal):', err.message);
    return emptyStack();
  }
}

function emptyStack() {
  return {
    contacts: [],
    missions: [],
    recon: { confidence: 0, enhanced: false },
    icpProfile: null,
    calendarEvents: [],
    timestamp: new Date().toISOString()
  };
}
