/**
 * barryContextStack.js — Client-side context loader for Barry Mission Control.
 *
 * Loads the full data payload that Barry needs for every chat call:
 *   - Active contacts (from Hunter deck + active missions)
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
import { db } from '../firebase/config';
import { calculateReconConfidence } from './reconConfidence';

async function getActiveContacts(userId) {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'users', userId, 'contacts'),
        where('hunter_status', 'in', ['deck', 'active_mission', 'engaged_pending']),
        limit(60)
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
        hunter_status: c.hunter_status || 'deck',
        active_mission_id: c.active_mission_id || null
      };
    });
  } catch (err) {
    console.warn('[barryContextStack] Failed to load contacts:', err.message);
    return [];
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
      const currentStep = (m.steps || []).find(s => s.status === 'current');
      const completedSteps = (m.steps || []).filter(s => s.status === 'completed');
      const lastCompleted = completedSteps[completedSteps.length - 1];

      return {
        id: d.id,
        contactId: m.contactId,
        outcome_goal: m.outcome_goal,
        status: m.status,
        current_step: currentStep?.stepNumber || 1,
        steps_total: (m.steps || []).length,
        last_outcome: lastCompleted?.outcome || null,
        barry_reasoning: m.barry_reasoning || null
      };
    });
  } catch (err) {
    console.warn('[barryContextStack] Failed to load missions:', err.message);
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

/**
 * Build the full context stack for Barry.
 * @param {string} userId
 * @returns {Promise<Object>} contextStack
 */
export async function buildContextStack(userId) {
  if (!userId) return emptyStack();

  try {
    const [contacts, missions, dashboardDoc] = await Promise.all([
      getActiveContacts(userId),
      getActiveMissions(userId),
      getDoc(doc(db, 'dashboards', userId))
    ]);

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

    return {
      contacts,
      missions,
      recon,
      user_style: dashboardData?.communicationStyle || null,
      timestamp: new Date().toISOString()
    };
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
    timestamp: new Date().toISOString()
  };
}
