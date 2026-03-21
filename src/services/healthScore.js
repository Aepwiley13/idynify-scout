/**
 * healthScore.js — Customer health score computation.
 *
 * Spec ref: v1.2 Section 6 — Health Score System
 *
 * Computation strategy (per user decision):
 *   - Event-triggered: recomputes on login, ticket, milestone
 *   - 24h fallback: daily job as safety net
 *
 * Score range: 0–100
 * Buckets: healthy (70–100), neutral (40–69), at-risk (0–39)
 *
 * Signals (weighted):
 *   1. Recency of last contact (30%)
 *   2. Reply ratio (20%)
 *   3. NBS completion rate (15%)
 *   4. Engagement frequency trend (15%)
 *   5. Milestone completion (10%)
 *   6. Sentiment from last interaction (10%)
 *
 * Writes to: users/{userId}/contacts/{contactId} → health_score, health_bucket, health_updated_at
 */

import { doc, getDoc, updateDoc, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase/config';

// ─── Constants ────────────────────────────────────────────────────────────────
const WEIGHTS = {
  recency:            0.30,
  replyRatio:         0.20,
  nbsCompletionRate:  0.15,
  engagementTrend:    0.15,
  milestoneProgress:  0.10,
  sentiment:          0.10,
};

const BUCKETS = {
  healthy:  { min: 70, label: 'Healthy',  color: '#22c55e' },
  neutral:  { min: 40, label: 'Neutral',  color: '#f59e0b' },
  at_risk:  { min: 0,  label: 'At Risk',  color: '#dc2626' },
};

const OVERDUE_DAYS = 7;
const STALE_DAYS   = 30; // no contact in 30 days = very stale

// ─── Signal Calculators ───────────────────────────────────────────────────────

/**
 * Recency: how recently was this contact engaged?
 * Full score if contacted within 3 days, 0 if over 30 days.
 */
function scoreRecency(contact) {
  const lastAt = contact.engagement_summary?.last_contact_at;
  if (!lastAt) return 0;
  const daysSince = (Date.now() - new Date(lastAt).getTime()) / 86400_000;
  if (daysSince <= 3)  return 100;
  if (daysSince <= 7)  return 80;
  if (daysSince <= 14) return 55;
  if (daysSince <= 30) return 25;
  return 0;
}

/**
 * Reply ratio: replies received / messages sent.
 */
function scoreReplyRatio(contact) {
  const sent    = contact.engagement_summary?.total_messages_sent || 0;
  const replies = contact.engagement_summary?.replies_received || 0;
  if (sent === 0) return 50; // no outreach yet — neutral
  const ratio = replies / sent;
  return Math.min(100, Math.round(ratio * 200)); // 50% reply rate = 100
}

/**
 * NBS completion rate: completed / (completed + dismissed).
 */
function scoreNbsCompletion(contact) {
  const completed = contact.nbs_stats?.completed || 0;
  const dismissed = contact.nbs_stats?.dismissed || 0;
  const total = completed + dismissed;
  if (total === 0) return 50; // neutral
  return Math.round((completed / total) * 100);
}

/**
 * Engagement frequency trend: compare recent period vs prior period.
 * Positive trend = higher score.
 */
function scoreEngagementTrend(contact) {
  const sessions = contact.engagement_summary?.total_sessions || 0;
  if (sessions <= 1) return 40; // not enough data
  // Use consecutive_no_replies as a negative signal
  const noReplies = contact.engagement_summary?.consecutive_no_replies || 0;
  if (noReplies >= 5) return 10;
  if (noReplies >= 3) return 30;
  if (noReplies >= 1) return 55;
  return 80;
}

/**
 * Milestone progress: what fraction of milestones are complete?
 * Reads from contact.milestones (array of { completed: boolean }).
 */
function scoreMilestoneProgress(contact) {
  const milestones = contact.milestones;
  if (!milestones || !Array.isArray(milestones) || milestones.length === 0) return 50;
  const done = milestones.filter(m => m.completed).length;
  return Math.round((done / milestones.length) * 100);
}

/**
 * Sentiment: based on last outcome.
 */
function scoreSentiment(contact) {
  const outcome = contact.engagement_summary?.last_outcome;
  if (!outcome) return 50;
  switch (outcome) {
    case 'replied_positive': return 100;
    case 'replied_negative': return 20;
    case 'bounced':          return 10;
    case 'no_reply':         return 35;
    default:                 return 50;
  }
}

// ─── Main Computation ─────────────────────────────────────────────────────────

/**
 * Compute the health score for a contact document (no Firestore reads).
 *
 * @param {Object} contact — Firestore contact document with engagement_summary, nbs_stats, milestones
 * @returns {{ score: number, bucket: string, label: string, color: string, signals: Object }}
 */
export function computeHealthScore(contact) {
  const signals = {
    recency:            scoreRecency(contact),
    replyRatio:         scoreReplyRatio(contact),
    nbsCompletionRate:  scoreNbsCompletion(contact),
    engagementTrend:    scoreEngagementTrend(contact),
    milestoneProgress:  scoreMilestoneProgress(contact),
    sentiment:          scoreSentiment(contact),
  };

  const score = Math.round(
    Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + (signals[key] || 0) * weight, 0)
  );

  const bucket = score >= BUCKETS.healthy.min ? 'healthy'
    : score >= BUCKETS.neutral.min ? 'neutral'
    : 'at_risk';

  return {
    score,
    bucket,
    label: BUCKETS[bucket].label,
    color: BUCKETS[bucket].color,
    signals,
  };
}

/**
 * Compute and persist the health score for a specific contact.
 *
 * @param {string} userId
 * @param {string} contactId
 * @returns {Promise<{ score, bucket, label, color, signals }>}
 */
export async function updateContactHealthScore(userId, contactId) {
  const ref = doc(db, 'users', userId, 'contacts', contactId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error(`Contact ${contactId} not found`);

  const contact = { id: snap.id, ...snap.data() };
  const result = computeHealthScore(contact);

  await updateDoc(ref, {
    health_score:      result.score,
    health_bucket:     result.bucket,
    health_updated_at: new Date().toISOString(),
  });

  return result;
}

/**
 * Batch-compute health scores for all contacts of a user.
 * Called on login and by the 24h fallback job.
 *
 * @param {string} userId
 * @returns {Promise<number>} — count of contacts updated
 */
export async function batchUpdateHealthScores(userId) {
  const contactsRef = collection(db, 'users', userId, 'contacts');
  const snap = await getDocs(contactsRef);
  let updated = 0;

  const batch = [];
  snap.docs.forEach(d => {
    const contact = { id: d.id, ...d.data() };
    // Only score customers and active relationships (not archived)
    if (contact.archived) return;
    const brigade = contact.brigade || '';
    if (brigade !== 'customers' && contact.person_type !== 'customer') return;

    const result = computeHealthScore(contact);
    batch.push(
      updateDoc(doc(db, 'users', userId, 'contacts', d.id), {
        health_score:      result.score,
        health_bucket:     result.bucket,
        health_updated_at: new Date().toISOString(),
      })
    );
    updated++;
  });

  await Promise.all(batch);
  return updated;
}

/**
 * Get the bucket config for display.
 */
export function getHealthBucketConfig(bucket) {
  return BUCKETS[bucket] || BUCKETS.neutral;
}

export { BUCKETS as HEALTH_BUCKETS, WEIGHTS as HEALTH_WEIGHTS };
