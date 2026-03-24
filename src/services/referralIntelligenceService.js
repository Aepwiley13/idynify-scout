/**
 * REFERRAL INTELLIGENCE ENGINE — Team Alpha
 * Operation People First // Network as Leverage
 *
 * The Network is not a drip list. It is a referral engine.
 *
 * This service answers three questions Barry needs to answer:
 *
 *   1. Who in my network can I ask for a referral to [target]?
 *      → "I know 10 accountants — want an introduction?"
 *
 *   2. Who should I be proactively offering referrals to?
 *      → "You have two contacts that should know each other — want to make the intro?"
 *
 *   3. Who are my best referral sources, and how do I nurture them?
 *      → Track who sends great referrals, who converts, reciprocity balance
 *
 * Data model:
 *   - Referral relationships stored in users/{userId}/referrals/{referralId}
 *   - Referral data denormalized on each contact (referral_data field)
 *   - Overlap detection is read-time inference (no background jobs)
 *
 * Design principles:
 *   - Barry surfaces opportunities, never executes them
 *   - Referral asks are always user-confirmed
 *   - The system tracks reciprocity so the user knows what they owe
 *   - Referral quality improves over time as conversion data accumulates
 */

import {
  doc,
  getDoc,
  updateDoc,
  addDoc,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { PEOPLE_PATHS } from '../schemas/peopleSchema';
import { logTimelineEvent } from '../utils/engagementHistoryLogger';
import { deriveReferralNbs, deriveIntroNbs, saveNextBestStep } from './nextBestStepService';
import { createRelationshipNotification, NOTIFICATION_TYPES } from './notificationService';

// ── Constants ────────────────────────────────────────────

// How many contacts to scan for referral opportunities (performance cap)
const SCAN_CAP = 100;

// Minimum shared attributes to flag as a potential introduction match
const INTRO_MATCH_THRESHOLD = 2;

// Days since a referral source was last engaged before flagging for touch
const REFERRAL_SOURCE_TOUCH_THRESHOLD = 21;

// ── Referral Record Schema ───────────────────────────────

/**
 * @typedef {Object} ReferralRecord
 * Stored in: users/{userId}/referrals/{referralId}
 *
 * @property {string}   id                  - Firestore document ID
 * @property {string}   type                - 'sent' | 'received'
 *                                             'sent'     = user referred someone to a contact
 *                                             'received' = contact referred someone to the user
 *
 * @property {string}   from_contact_id     - Who the referral came from (if received)
 * @property {string}   from_contact_name   - Display name (denormalized)
 * @property {string}   to_contact_id       - Who was referred (if received — the new contact)
 * @property {string}   to_contact_name     - Display name (denormalized)
 *
 * @property {string}   referral_date       - ISO timestamp when referral happened
 * @property {string}   context             - Natural language description of the referral
 *
 * @property {string}   status              - 'pending' | 'contacted' | 'converted' | 'not_converted'
 * @property {string}   converted_at        - ISO timestamp if converted
 * @property {string}   outcome_note        - What happened
 *
 * @property {boolean}  reciprocal_made     - Did user return the favor?
 * @property {string}   reciprocal_at       - ISO timestamp of reciprocal referral (if made)
 *
 * @property {string}   created_at          - ISO timestamp
 * @property {string}   updated_at          - ISO timestamp
 */

// ─────────────────────────────────────────────────────────────────
// RECORDING REFERRALS
// ─────────────────────────────────────────────────────────────────

/**
 * Record a referral received from a network contact.
 * Updates referral_data on the referring contact.
 * Creates a referral record in the referrals subcollection.
 *
 * @param {string} userId
 * @param {Object} params
 * @param {string} params.fromContactId   - Contact who sent the referral
 * @param {string} params.fromContactName - Their name
 * @param {string} params.toContactId     - The new contact they referred (if already in system)
 * @param {string} params.toContactName   - Name of referred person
 * @param {string} params.context         - Brief description of the referral
 * @returns {Promise<string>} Referral record ID
 */
export async function recordReferralReceived(userId, {
  fromContactId,
  fromContactName,
  toContactId,
  toContactName,
  context,
  referral_value
}) {
  try {
    const now = new Date().toISOString();

    // Create referral record
    const referralData = {
      type: 'received',
      from_contact_id: fromContactId,
      from_contact_name: fromContactName,
      to_contact_id: toContactId || null,
      to_contact_name: toContactName,
      referral_date: now,
      context: context || null,
      referral_value: referral_value || null,
      status: 'pending',
      converted_at: null,
      outcome_note: null,
      reciprocal_made: false,
      reciprocal_at: null,
      created_at: now,
      updated_at: now
    };

    const referralsRef = collection(db, PEOPLE_PATHS.referrals(userId));
    const docRef = await addDoc(referralsRef, referralData);

    // Update the referring contact's referral_data
    if (fromContactId) {
      await updateReferralSourceData(userId, fromContactId, {
        referralAdded: true,
        referralRecordId: docRef.id
      });

      // Log timeline event on referring contact
      await logTimelineEvent({
        userId,
        contactId: fromContactId,
        type: 'referral_received',
        actor: 'user',
        preview: `Referred ${toContactName} to you`,
        metadata: {
          referral_id: docRef.id,
          referred_contact_name: toContactName,
          context
        }
      });
    }

    // If referred person is already in system, link the referral on their record too
    if (toContactId) {
      const toRef = doc(db, PEOPLE_PATHS.person(userId, toContactId));
      const toSnap = await getDoc(toRef);
      if (toSnap.exists()) {
        const toContact = toSnap.data();
        const referredByIds = [...(toContact.referral_data?.referred_by_ids || [])];
        if (!referredByIds.includes(fromContactId)) {
          referredByIds.push(fromContactId);
        }
        await updateDoc(toRef, {
          'referral_data.referred_by_ids': referredByIds,
          updatedAt: now
        });
      }
    }

    // Create relationship notification
    await createRelationshipNotification(userId, {
      type: NOTIFICATION_TYPES.REFERRAL_RECEIVED,
      contactId: fromContactId,
      contactName: fromContactName,
      relatedContactId: toContactId,
      relatedContactName: toContactName,
      message: context || `${fromContactName} referred ${toContactName} to you`,
    });

    return docRef.id;
  } catch (error) {
    console.error('[ReferralIntelligence] Failed to record referral received:', error);
    return null;
  }
}

/**
 * Record a referral you sent (you referred one of your contacts to another contact).
 *
 * @param {string} userId
 * @param {Object} params
 * @param {string} params.fromContactId   - Contact you referred someone to
 * @param {string} params.fromContactName
 * @param {string} params.toContactId     - Contact you sent as a referral
 * @param {string} params.toContactName
 * @param {string} params.context
 * @returns {Promise<string>} Referral record ID
 */
export async function recordReferralSent(userId, {
  fromContactId,
  fromContactName,
  toContactId,
  toContactName,
  context,
  referral_value
}) {
  try {
    const now = new Date().toISOString();

    const referralData = {
      type: 'sent',
      from_contact_id: fromContactId,
      from_contact_name: fromContactName,
      to_contact_id: toContactId || null,
      to_contact_name: toContactName,
      referral_date: now,
      context: context || null,
      referral_value: referral_value || null,
      status: 'pending',
      converted_at: null,
      outcome_note: null,
      reciprocal_made: false,
      reciprocal_at: null,
      created_at: now,
      updated_at: now
    };

    const referralsRef = collection(db, PEOPLE_PATHS.referrals(userId));
    const docRef = await addDoc(referralsRef, referralData);

    // Log timeline event on the receiving contact
    if (fromContactId) {
      await logTimelineEvent({
        userId,
        contactId: fromContactId,
        type: 'referral_sent',
        actor: 'user',
        preview: `You referred ${toContactName} to them`,
        metadata: {
          referral_id: docRef.id,
          referred_contact_name: toContactName,
          context
        }
      });
    }

    return docRef.id;
  } catch (error) {
    console.error('[ReferralIntelligence] Failed to record referral sent:', error);
    return null;
  }
}

/**
 * Update the outcome of a referral (did it convert?).
 *
 * @param {string} userId
 * @param {string} referralId
 * @param {string} status - 'contacted' | 'converted' | 'not_converted'
 * @param {string} [outcomeNote]
 */
export async function updateReferralOutcome(userId, referralId, status, outcomeNote) {
  try {
    const referralRef = doc(db, PEOPLE_PATHS.referral(userId, referralId));
    const snap = await getDoc(referralRef);
    if (!snap.exists()) return;

    const now = new Date().toISOString();
    const updates = {
      status,
      outcome_note: outcomeNote || null,
      updated_at: now
    };

    if (status === 'converted') {
      updates.converted_at = now;
    }

    await updateDoc(referralRef, updates);

    // If converted, update referral quality on the source contact
    if (status === 'converted') {
      const referral = snap.data();
      if (referral.from_contact_id && referral.type === 'received') {
        await updateReferralSourceData(userId, referral.from_contact_id, {
          conversionRecorded: true
        });

        // Create conversion notification
        await createRelationshipNotification(userId, {
          type: NOTIFICATION_TYPES.REFERRAL_CONVERTED,
          contactId: referral.from_contact_id,
          contactName: referral.from_contact_name,
          relatedContactId: referral.to_contact_id,
          relatedContactName: referral.to_contact_name,
          message: outcomeNote || `${referral.to_contact_name} converted — referred by ${referral.from_contact_name}`,
        });
      }
    }
  } catch (error) {
    console.error('[ReferralIntelligence] Failed to update referral outcome:', error);
  }
}

// ─────────────────────────────────────────────────────────────────
// OPPORTUNITY DETECTION — Where Barry earns his keep
// ─────────────────────────────────────────────────────────────────

/**
 * Detect referral opportunities in the user's network.
 *
 * Scans contacts marked as referral targets and looks for potential
 * introducers in the network. Returns a list of opportunities with
 * suggested Next Best Steps.
 *
 * @param {string} userId
 * @returns {Promise<Array>} Array of referral opportunities
 */
export async function detectReferralOpportunities(userId) {
  try {
    const opportunities = [];

    // Load all active leads that might benefit from a referral
    const leadsQuery = query(
      collection(db, PEOPLE_PATHS.allPeople(userId)),
      where('person_type', '==', 'lead'),
      where('strategic_value', 'in', ['high', 'critical']),
      where('is_archived', '==', false),
      limit(SCAN_CAP)
    );

    const leadsSnap = await getDocs(leadsQuery);
    const leads = leadsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Load network contacts who are good referral sources
    const networkQuery = query(
      collection(db, PEOPLE_PATHS.allPeople(userId)),
      where('person_type', 'in', ['network', 'customer', 'partner']),
      where('referral_data.is_referral_source', '==', true),
      where('is_archived', '==', false),
      limit(SCAN_CAP)
    );

    const networkSnap = await getDocs(networkQuery);
    const networkContacts = networkSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // For each high-value lead, find network contacts who could introduce them
    for (const lead of leads) {
      // Skip leads who already have engagement history (they don't need an intro)
      const stats = lead.engagement_summary || {};
      if (stats.total_messages_sent > 0) continue;

      for (const networkContact of networkContacts) {
        const overlapScore = computeOverlapScore(lead, networkContact);

        if (overlapScore >= INTRO_MATCH_THRESHOLD) {
          opportunities.push({
            type: 'intro_via_network',
            lead_id: lead.id,
            lead_name: lead.name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
            lead_company: lead.company,
            introducer_id: networkContact.id,
            introducer_name: networkContact.name || `${networkContact.first_name || ''} ${networkContact.last_name || ''}`.trim(),
            overlap_score: overlapScore,
            overlap_reasons: computeOverlapReasons(lead, networkContact),
            reasoning: `${networkContact.name || 'This contact'} is in your network and shares ${computeOverlapReasons(lead, networkContact).join(' and ')} with ${lead.name || 'this lead'}. They could make a warm introduction.`,
            suggested_nbs: deriveReferralNbs({
              contactName: networkContact.name || 'this contact',
              referralOpportunity: `Ask them to introduce you to ${lead.name || 'this lead'} — ${computeOverlapReasons(lead, networkContact)[0] || 'shared industry'}`,
              networkContactName: lead.name
            })
          });
        }
      }
    }

    // Detect two-way introduction opportunities (two contacts who should meet each other)
    const introOpps = await detectMutualIntroOpportunities(userId, networkContacts);
    opportunities.push(...introOpps);

    // Sort by overlap score descending
    return opportunities.sort((a, b) => (b.overlap_score || 0) - (a.overlap_score || 0)).slice(0, 10);
  } catch (error) {
    console.error('[ReferralIntelligence] Failed to detect referral opportunities:', error);
    return [];
  }
}

/**
 * Detect network contacts who are overdue for engagement (referral source nurture).
 *
 * Partners and network contacts who send referrals need regular attention.
 * If they haven't heard from you in a while, Barry surfaces them for a check-in.
 *
 * @param {string} userId
 * @returns {Promise<Array>} Array of overdue referral source contacts
 */
export async function detectOverdueReferralSources(userId) {
  try {
    const q = query(
      collection(db, PEOPLE_PATHS.allPeople(userId)),
      where('referral_data.is_referral_source', '==', true),
      where('person_type', 'in', ['network', 'partner']),
      where('is_archived', '==', false),
      limit(SCAN_CAP)
    );

    const snap = await getDocs(q);
    const contacts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const overdue = contacts.filter(c => {
      const lastContact = c.engagement_summary?.last_contact_at;
      return daysSince(lastContact) >= REFERRAL_SOURCE_TOUCH_THRESHOLD;
    });

    return overdue.map(c => ({
      contact_id: c.id,
      contact_name: c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim(),
      referrals_sent: c.referral_data?.referrals_sent || 0,
      referrals_converted: c.referral_data?.referrals_converted || 0,
      days_since_contact: daysSince(c.engagement_summary?.last_contact_at),
      reciprocal_balance: computeReciprocalBalance(userId, c.id),
      suggested_action: c.referral_data?.referrals_sent > 0
        ? `Thank them for their referral${c.referral_data.referrals_sent > 1 ? 's' : ''} and stay connected`
        : 'Check in and keep the relationship warm'
    }));
  } catch (error) {
    console.error('[ReferralIntelligence] Failed to detect overdue referral sources:', error);
    return [];
  }
}

/**
 * Get full referral analytics for a specific contact.
 * Used in the contact profile right rail.
 *
 * @param {string} userId
 * @param {string} contactId
 * @returns {Promise<Object>} Referral analytics for this contact
 */
export async function getContactReferralAnalytics(userId, contactId) {
  try {
    // Load all referrals involving this contact
    const receivedQuery = query(
      collection(db, PEOPLE_PATHS.referrals(userId)),
      where('from_contact_id', '==', contactId)
    );

    const sentQuery = query(
      collection(db, PEOPLE_PATHS.referrals(userId)),
      where('from_contact_id', '==', contactId),
      where('type', '==', 'sent')
    );

    const [receivedSnap, contactSnap] = await Promise.all([
      getDocs(receivedQuery),
      getDoc(doc(db, PEOPLE_PATHS.person(userId, contactId)))
    ]);

    const allReferrals = receivedSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const referralsFromContact = allReferrals.filter(r => r.type === 'received');
    const referralsToContact   = allReferrals.filter(r => r.type === 'sent');
    const askedForRecords      = allReferrals.filter(r => r.type === 'asked_for');
    const convertedFromContact = referralsFromContact.filter(r => r.status === 'converted');

    const contactData = contactSnap.exists() ? contactSnap.data() : {};
    const referralData = contactData.referral_data || {};

    return {
      is_referral_source: referralData.is_referral_source || referralsFromContact.length > 0,
      referrals_sent_to_you: referralsFromContact.length,
      referrals_converted: convertedFromContact.length,
      conversion_rate: referralsFromContact.length > 0
        ? Math.round((convertedFromContact.length / referralsFromContact.length) * 100)
        : null,
      last_referral_at: referralData.last_referral_at,
      referrals_you_sent_them: referralsToContact.length,
      reciprocal_balance: referralsFromContact.length - referralsToContact.length,
      referral_quality: computeReferralQuality(referralsFromContact),
      // Three-direction record arrays (for ReferralHub three-tab UI)
      referred_to_me_records: referralsFromContact.sort((a, b) =>
        new Date(b.referral_date || b.created_at) - new Date(a.referral_date || a.created_at)
      ),
      referred_out_records: referralsToContact.sort((a, b) =>
        new Date(b.referral_date || b.created_at) - new Date(a.referral_date || a.created_at)
      ),
      asked_for_records: askedForRecords.sort((a, b) =>
        new Date(b.asked_at || b.created_at) - new Date(a.asked_at || a.created_at)
      ),
      all_referrals: allReferrals.sort((a, b) =>
        new Date(b.referral_date || b.asked_at) - new Date(a.referral_date || a.asked_at)
      ).slice(0, 10)
    };
  } catch (error) {
    console.error('[ReferralIntelligence] Failed to get contact referral analytics:', error);
    return null;
  }
}

/**
 * Get network referral leaderboard — who sends the best referrals?
 *
 * @param {string} userId
 * @returns {Promise<Array>} Top referral sources ranked by quality
 */
export async function getReferralLeaderboard(userId) {
  try {
    const q = query(
      collection(db, PEOPLE_PATHS.referrals(userId)),
      where('type', '==', 'received'),
      orderBy('referral_date', 'desc'),
      limit(200)
    );

    const snap = await getDocs(q);
    const referrals = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Aggregate by source contact
    const bySource = {};
    referrals.forEach(r => {
      if (!r.from_contact_id) return;
      if (!bySource[r.from_contact_id]) {
        bySource[r.from_contact_id] = {
          contact_id: r.from_contact_id,
          contact_name: r.from_contact_name,
          total: 0,
          converted: 0,
          last_referral_at: null
        };
      }
      bySource[r.from_contact_id].total += 1;
      if (r.status === 'converted') bySource[r.from_contact_id].converted += 1;
      if (!bySource[r.from_contact_id].last_referral_at ||
          r.referral_date > bySource[r.from_contact_id].last_referral_at) {
        bySource[r.from_contact_id].last_referral_at = r.referral_date;
      }
    });

    // Compute score and sort
    return Object.values(bySource)
      .map(s => ({
        ...s,
        conversion_rate: s.total > 0 ? Math.round((s.converted / s.total) * 100) : 0,
        quality_score: s.total * 2 + s.converted * 5  // Simple quality score
      }))
      .sort((a, b) => b.quality_score - a.quality_score)
      .slice(0, 20);
  } catch (error) {
    console.error('[ReferralIntelligence] Failed to get referral leaderboard:', error);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────
// PROACTIVE INTELLIGENCE — Barry surfaces opportunities without being asked
// ─────────────────────────────────────────────────────────────────

/**
 * Run the full referral intelligence sweep for a user.
 * Detects opportunities and generates NBS suggestions for Barry to surface.
 *
 * Called:
 *   - On app open (background, non-blocking)
 *   - After a referral is recorded
 *   - After an engagement outcome is recorded
 *
 * @param {string} userId
 * @returns {Promise<{ opportunities: Array, overdueNurture: Array }>}
 */
export async function runReferralIntelligenceSweep(userId) {
  try {
    const [opportunities, overdueNurture] = await Promise.all([
      detectReferralOpportunities(userId),
      detectOverdueReferralSources(userId)
    ]);

    return { opportunities, overdueNurture };
  } catch (error) {
    console.error('[ReferralIntelligence] Sweep failed:', error);
    return { opportunities: [], overdueNurture: [] };
  }
}

// ── Private Helpers ──────────────────────────────────────

/**
 * Compute overlap score between a lead and a network contact.
 * Higher score = better potential introduction match.
 */
function computeOverlapScore(lead, networkContact) {
  let score = 0;

  // Same industry
  if (lead.industry && networkContact.industry &&
      lead.industry.toLowerCase() === networkContact.industry.toLowerCase()) {
    score += 3;
  }

  // Same company (uncommon but relevant)
  if (lead.company && networkContact.company &&
      lead.company.toLowerCase() === networkContact.company.toLowerCase()) {
    score += 2;
  }

  // Same location
  if (lead.location && networkContact.location) {
    const leadLoc = lead.location.toLowerCase();
    const netLoc = networkContact.location.toLowerCase();
    if (leadLoc === netLoc || leadLoc.includes(netLoc) || netLoc.includes(leadLoc)) {
      score += 2;
    }
  }

  // Similar title level (both C-suite, both VP, etc.)
  if (lead.title && networkContact.title) {
    const titleKeywords = ['ceo', 'cto', 'coo', 'cfo', 'vp', 'director', 'head of', 'founder', 'owner'];
    const leadTitle = lead.title.toLowerCase();
    const netTitle = networkContact.title.toLowerCase();
    const sharedLevel = titleKeywords.some(k => leadTitle.includes(k) && netTitle.includes(k));
    if (sharedLevel) score += 1;
  }

  // Shared tags
  const leadTags = new Set(lead.tags || []);
  const netTags = new Set(networkContact.tags || []);
  const sharedTags = [...leadTags].filter(t => netTags.has(t));
  score += sharedTags.length;

  return score;
}

/**
 * Return human-readable reasons why two contacts are a potential match.
 */
function computeOverlapReasons(lead, networkContact) {
  const reasons = [];

  if (lead.industry && networkContact.industry &&
      lead.industry.toLowerCase() === networkContact.industry.toLowerCase()) {
    reasons.push(`same industry (${lead.industry})`);
  }

  if (lead.location && networkContact.location) {
    const leadLoc = lead.location.toLowerCase();
    const netLoc = networkContact.location.toLowerCase();
    if (leadLoc === netLoc || leadLoc.includes(netLoc) || netLoc.includes(leadLoc)) {
      reasons.push(`same location (${lead.location})`);
    }
  }

  if (lead.company && networkContact.company &&
      lead.company.toLowerCase() === networkContact.company.toLowerCase()) {
    reasons.push(`same company (${lead.company})`);
  }

  const leadTags = new Set(lead.tags || []);
  const netTags = new Set(networkContact.tags || []);
  const sharedTags = [...leadTags].filter(t => netTags.has(t));
  if (sharedTags.length > 0) {
    reasons.push(`shared interests: ${sharedTags.slice(0, 2).join(', ')}`);
  }

  return reasons.length > 0 ? reasons : ['overlapping professional profiles'];
}

/**
 * Detect mutual introduction opportunities (two contacts who should meet).
 */
async function detectMutualIntroOpportunities(userId, networkContacts) {
  const opportunities = [];

  // Compare all pairs of network contacts for strong overlap
  for (let i = 0; i < networkContacts.length; i++) {
    for (let j = i + 1; j < networkContacts.length; j++) {
      const a = networkContacts[i];
      const b = networkContacts[j];

      // Skip if they're already connected (in each other's has_referred_ids)
      const aReferredB = (a.referral_data?.has_referred_ids || []).includes(b.id);
      const bReferredA = (b.referral_data?.has_referred_ids || []).includes(a.id);
      if (aReferredB || bReferredA) continue;

      const overlapScore = computeOverlapScore(a, b);
      if (overlapScore >= INTRO_MATCH_THRESHOLD + 1) {  // Higher bar for mutual intros
        const reasons = computeOverlapReasons(a, b);
        const aName = a.name || `${a.first_name || ''} ${a.last_name || ''}`.trim();
        const bName = b.name || `${b.first_name || ''} ${b.last_name || ''}`.trim();

        opportunities.push({
          type: 'mutual_intro',
          contact_a_id: a.id,
          contact_a_name: aName,
          contact_b_id: b.id,
          contact_b_name: bName,
          overlap_score: overlapScore,
          overlap_reasons: reasons,
          reasoning: `${aName} and ${bName} share ${reasons.join(' and ')}. Making this introduction could benefit both — and positions you as a well-connected resource.`,
          suggested_nbs: deriveIntroNbs({
            contactName: aName,
            introTargetName: bName,
            introRationale: `Both are in your network and share ${reasons[0] || 'common ground'}`
          })
        });
      }
    }
  }

  return opportunities;
}

/**
 * Update referral source data on a contact when a referral is recorded.
 */
async function updateReferralSourceData(userId, contactId, update) {
  try {
    const contactRef = doc(db, PEOPLE_PATHS.person(userId, contactId));
    const snap = await getDoc(contactRef);
    if (!snap.exists()) return;

    const contact = snap.data();
    const existing = contact.referral_data || {};
    const now = new Date().toISOString();

    const updated = { ...existing };

    if (update.referralAdded) {
      updated.is_referral_source = true;
      updated.referrals_sent = (updated.referrals_sent || 0) + 1;
      updated.last_referral_at = now;
    }

    if (update.conversionRecorded) {
      updated.referrals_converted = (updated.referrals_converted || 0) + 1;
      updated.referral_quality = computeReferralQuality([
        ...Array(updated.referrals_converted).fill({ status: 'converted' }),
        ...Array(Math.max(0, updated.referrals_sent - updated.referrals_converted)).fill({ status: 'not_converted' })
      ]);
    }

    await updateDoc(contactRef, {
      referral_data: updated,
      updatedAt: now
    });
  } catch (error) {
    console.error('[ReferralIntelligence] Failed to update referral source data:', error);
  }
}

function computeReferralQuality(referrals) {
  if (!referrals || referrals.length === 0) return null;
  const converted = referrals.filter(r => r.status === 'converted').length;
  const rate = converted / referrals.length;
  if (rate >= 0.5) return 'high';
  if (rate >= 0.25) return 'medium';
  return 'low';
}

async function computeReciprocalBalance(userId, contactId) {
  // Simplified — returns positive if we owe them more referrals, negative if they owe us
  // Full implementation would query the referrals collection for exact counts
  return 0;
}

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const date = typeof dateStr === 'object' && dateStr.toDate
    ? dateStr.toDate()
    : new Date(dateStr);
  if (isNaN(date.getTime())) return Infinity;
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

// ─────────────────────────────────────────────────────────────────
// "ASKED FOR" DIRECTION — Intro requests logged against a contact
// ─────────────────────────────────────────────────────────────────

/**
 * Record an intro ask on a contact — "I asked [contact] to introduce me to [target]."
 *
 * @param {string} userId
 * @param {Object} params
 * @param {string} params.fromContactId       - Contact you're asking to make the intro
 * @param {string} params.fromContactName     - Their display name
 * @param {string} params.targetName          - Who you want to meet
 * @param {string} [params.targetTitle]       - Their title
 * @param {string} [params.targetCompany]     - Their company
 * @param {string} [params.targetContactId]   - Contact ID if already in system
 * @param {number} [params.icpMatchScore]     - ICP match score (0–100)
 * @param {string} [params.askedVia]          - Channel used for the ask
 * @param {string} [params.context]           - Why you want the intro
 * @param {string} [params.referralValue]     - Free-form deal value string
 * @returns {Promise<string>} Referral record ID
 */
export async function recordReferralAskedFor(userId, {
  fromContactId,
  fromContactName,
  targetName,
  targetTitle,
  targetCompany,
  targetContactId,
  icpMatchScore,
  askedVia,
  context,
  referralValue
}) {
  try {
    const now = new Date().toISOString();

    const referralData = {
      type: 'asked_for',
      from_contact_id: fromContactId,
      from_contact_name: fromContactName,
      // Target (the person you want to be introduced to)
      ask_target_contact_id: targetContactId || null,
      ask_target_name: targetName,
      ask_target_title: targetTitle || null,
      ask_target_company: targetCompany || null,
      icp_match_score: icpMatchScore ?? null,
      // Ask metadata
      ask_status: 'pending',
      response_status: 'no_response',
      decline_reason: null,
      asked_via: askedVia || null,
      asked_at: now,
      context: context || null,
      referral_value: referralValue || null,
      created_at: now,
      updated_at: now
    };

    const referralsRef = collection(db, PEOPLE_PATHS.referrals(userId));
    const docRef = await addDoc(referralsRef, referralData);

    // Log timeline event on the contact you asked
    if (fromContactId) {
      await logTimelineEvent({
        userId,
        contactId: fromContactId,
        type: 'referral_ask_sent',
        actor: 'user',
        preview: `Asked for intro to ${targetName}`,
        metadata: {
          referral_id: docRef.id,
          target_name: targetName,
          target_company: targetCompany,
          icp_match_score: icpMatchScore,
          context
        }
      });
    }

    return docRef.id;
  } catch (error) {
    console.error('[ReferralIntelligence] Failed to record asked-for referral:', error);
    return null;
  }
}

/**
 * Update the status of an "asked for" intro request.
 *
 * @param {string} userId
 * @param {string} referralId
 * @param {Object} params
 * @param {string} params.askStatus       - 'pending' | 'declined' | 'asked_again'
 * @param {string} params.responseStatus  - 'no_response' | 'declined' | 'accepted'
 * @param {string} [params.declineReason] - Why they declined (free text)
 */
export async function updateAskedForStatus(userId, referralId, {
  askStatus,
  responseStatus,
  declineReason
}) {
  try {
    const referralRef = doc(db, PEOPLE_PATHS.referral(userId, referralId));
    await updateDoc(referralRef, {
      ask_status: askStatus,
      response_status: responseStatus,
      ...(declineReason ? { decline_reason: declineReason } : {}),
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('[ReferralIntelligence] Failed to update asked-for status:', error);
  }
}
