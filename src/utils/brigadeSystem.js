/**
 * BRIGADE SYSTEM
 * Operation People First — Brigade Intelligence Decision Tree
 *
 * This is the decision engine that fires when a contact's brigade changes.
 * It does three things:
 *   1. Returns the Barry behavior contract for the new brigade
 *   2. Logs the transition to the timeline (permanent record)
 *   3. Returns a recommendation string Barry should surface at next open
 *
 * Called by: BrigadeSelector on every brigade change
 * Read by:   HunterContactDrawer (engagementIntent), NextBestStep (step bias)
 *
 * Do not put UI logic here. This is pure decision + persistence logic.
 * BrigadeSelector owns the UI. brigadeSystem owns what happens after the click.
 */

import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { logTimelineEvent, ACTORS } from './timelineLogger';

// ── Brigade → Barry contract ─────────────────────────────
// Mirrors BRIGADE_BARRY_CONTRACT in src/schemas/engagementSchema.js
// Source of truth is the schema; this is the runtime implementation.

export const BRIGADE_CONTRACTS = {
  leads: {
    engagementIntent: 'prospect',
    tone: 'Direct and outcome-focused. Clear ask. No fluff.',
    nextStepBias: 'follow_up',
    barryMode: 'acquisition',
    label: 'Lead',
    transitionMessage: (name) =>
      `${name || 'This contact'} is now a Lead. Barry will focus on direct, outcome-driven outreach with a clear ask.`
  },
  customers: {
    engagementIntent: 'customer',
    tone: 'Value delivery first. Look for expansion signals. Protect the relationship.',
    nextStepBias: 'schedule_meeting',
    barryMode: 'retention',
    label: 'Customer',
    transitionMessage: (name) =>
      `${name || 'This contact'} is now a Customer. Barry shifts to value delivery and expansion — protect this relationship.`
  },
  partners: {
    engagementIntent: 'partner',
    tone: 'Mutual value framing. Reciprocity. Co-creation language.',
    nextStepBias: 'referral_opportunity',
    barryMode: 'partnership',
    label: 'Partner',
    transitionMessage: (name) =>
      `${name || 'This contact'} is now a Partner. Barry will emphasize mutual value and reciprocity in every message.`
  },
  referrals: {
    engagementIntent: 'warm',
    tone: 'Warm and appreciative. Reference the referral relationship explicitly.',
    nextStepBias: 'referral_opportunity',
    barryMode: 'referral',
    label: 'Referral',
    transitionMessage: (name) =>
      `${name || 'This contact'} is flagged as a Referral source. Barry will track and surface referral opportunities proactively.`
  },
  network: {
    engagementIntent: 'warm',
    tone: 'Stay warm. Low pressure. Surface overlaps and shared context.',
    nextStepBias: 'low_touch',
    barryMode: 'nurture',
    label: 'Network',
    transitionMessage: (name) =>
      `${name || 'This contact'} joins your Network. Barry switches to low-touch nurture — staying visible without pressure.`
  },
  past_customers: {
    engagementIntent: 'warm',
    tone: 'Re-engagement tone. Reference shared history. Find the comeback moment.',
    nextStepBias: 'follow_up',
    barryMode: 're_engagement',
    label: 'Past Customer',
    transitionMessage: (name) =>
      `${name || 'This contact'} is a Past Customer. Barry will look for the right re-engagement moment using shared history.`
  }
};

// ── Decision tree ────────────────────────────────────────

/**
 * Get the Barry behavior contract for a brigade.
 * Pure function — no side effects.
 *
 * @param {string} brigadeId - One of the BRIGADE_CONTRACTS keys
 * @returns {Object} The contract, or leads contract as fallback
 */
export function getBrigadeContract(brigadeId) {
  return BRIGADE_CONTRACTS[brigadeId] || BRIGADE_CONTRACTS.leads;
}

/**
 * Derive the engagementIntent for a contact based on their brigade.
 * Called by HunterContactDrawer before generating messages.
 *
 * @param {Object} contact - Contact document
 * @returns {'prospect'|'warm'|'customer'|'partner'} Intent string for Barry
 */
export function getBrigadeEngagementIntent(contact) {
  if (!contact?.brigade) {
    // Fallback chain: explicit engagementIntent → relationship_type → default
    if (contact?.engagementIntent) return contact.engagementIntent;
    if (contact?.relationship_type === 'partner') return 'partner';
    if (contact?.relationship_type === 'known') return 'warm';
    return 'prospect';
  }
  return getBrigadeContract(contact.brigade).engagementIntent;
}

/**
 * Fire the brigade transition decision tree.
 * Writes to Firestore + timeline. Returns the new contract.
 *
 * Called by BrigadeSelector on every brigade change.
 *
 * @param {Object} params
 * @param {string} params.userId       - Auth user ID
 * @param {string} params.contactId    - Contact doc ID
 * @param {string|null} params.fromBrigade - Previous brigade (null if first assignment)
 * @param {string|null} params.toBrigade   - New brigade (null if removing brigade)
 * @param {string} [params.contactName]   - For transition message personalization
 *
 * @returns {Promise<{ contract: Object|null, transitionMessage: string|null }>}
 */
export async function onBrigadeChange({ userId, contactId, fromBrigade, toBrigade, contactName }) {
  if (!userId || !contactId) {
    console.error('[BrigadeSystem] Missing userId or contactId');
    return { contract: null, transitionMessage: null };
  }

  const contract = toBrigade ? getBrigadeContract(toBrigade) : null;
  const transitionMessage = contract
    ? contract.transitionMessage(contactName)
    : `${contactName || 'This contact'} removed from brigade — Barry returns to default behavior.`;

  try {
    // 1. Update contact document
    const contactRef = doc(db, 'users', userId, 'contacts', contactId);
    await updateDoc(contactRef, {
      brigade: toBrigade,
      // Sync engagementIntent for backward compatibility with HunterContactDrawer
      engagementIntent: contract?.engagementIntent || null,
      // Sync relationship_type for older code paths
      relationship_type: toBrigade === 'leads' ? 'prospect'
        : toBrigade === 'partners' ? 'partner'
        : (toBrigade === 'network' || toBrigade === 'customers' || toBrigade === 'referrals' || toBrigade === 'past_customers') ? 'known'
        : null,
      updated_at: new Date().toISOString()
    });

    // 2. Log to timeline
    await logTimelineEvent({
      userId,
      contactId,
      type: 'brigade_changed',
      actor: ACTORS.USER,
      preview: toBrigade
        ? `Brigade: ${contract?.label || toBrigade}`
        : 'Brigade removed',
      metadata: {
        fromBrigade,
        toBrigade,
        contractSummary: contract
          ? {
              engagementIntent: contract.engagementIntent,
              nextStepBias: contract.nextStepBias,
              barryMode: contract.barryMode
            }
          : null,
        transitionMessage
      }
    });

    return { contract, transitionMessage };

  } catch (error) {
    console.error('[BrigadeSystem] Brigade transition failed:', error);
    return { contract, transitionMessage };
  }
}

/**
 * Validate that a contact's brigade, engagementIntent, and relationship_type
 * are internally consistent. Called during integration verification (Step 5).
 *
 * @param {Object} contact - Contact document from Firestore
 * @returns {{ valid: boolean, issues: string[] }}
 */
export function validateBrigadeConsistency(contact) {
  const issues = [];

  if (!contact.brigade) return { valid: true, issues: [] };

  const contract = getBrigadeContract(contact.brigade);

  if (contact.engagementIntent && contact.engagementIntent !== contract.engagementIntent) {
    issues.push(
      `engagementIntent mismatch: brigade '${contact.brigade}' expects '${contract.engagementIntent}', found '${contact.engagementIntent}'`
    );
  }

  return { valid: issues.length === 0, issues };
}
