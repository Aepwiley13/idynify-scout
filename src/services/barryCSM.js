/**
 * barryCSM.js — Barry's CSM-specific read generation and expansion signals.
 *
 * Spec ref: v1.2 Section 7 — Barry CSM Intelligence
 *
 * This service builds CSM-context prompts for Barry, generates customer
 * health reads, and identifies expansion/churn signals.
 *
 * Key responsibilities:
 *   1. Build CSM context object for Barry prompt injection
 *   2. Generate health reads (natural language summaries)
 *   3. Detect expansion signals (upsell/cross-sell opportunities)
 *   4. Detect churn signals (risk indicators)
 *   5. Suggest interventions based on health bucket
 *
 * NOTE: This does NOT call the LLM directly — it builds structured context
 * that BarryChat.jsx sends to the barryMissionChat Netlify function.
 * A dedicated CSM Barry function (claude-sonnet-4-6) should be created
 * in Sprint 3 for deeper analysis.
 */

import { computeHealthScore, HEALTH_BUCKETS } from './healthScore';
import { isContactSnoozed } from './snoozeManager';

// ─── Context Builder ──────────────────────────────────────────────────────────

/**
 * Build a CSM-specific context object for Barry prompt injection.
 * This is passed to BarryChat via the barryContextStore.
 *
 * @param {Object} params
 * @param {Array} params.customers — array of customer contact documents
 * @param {Object} [params.successPlan] — success plan config (from Firestore)
 * @returns {Object} — context object for Barry
 */
export function buildCSMContext({ customers = [], successPlan = null }) {
  const healthResults = customers.map(c => ({
    id: c.id,
    name: c.name,
    company: c.company_name,
    ...computeHealthScore(c),
    snoozed: isContactSnoozed(c).snoozed,
  }));

  const atRisk = healthResults.filter(h => h.bucket === 'at_risk' && !h.snoozed);
  const neutral = healthResults.filter(h => h.bucket === 'neutral' && !h.snoozed);
  const healthy = healthResults.filter(h => h.bucket === 'healthy' && !h.snoozed);

  const expansionSignals = customers.flatMap(c => detectExpansionSignals(c));
  const churnSignals = customers.flatMap(c => detectChurnSignals(c));

  return {
    module: 'basecamp',
    mode: 'csm',
    portfolio: {
      total: customers.length,
      at_risk: atRisk.length,
      neutral: neutral.length,
      healthy: healthy.length,
      avg_score: healthResults.length > 0
        ? Math.round(healthResults.reduce((s, h) => s + h.score, 0) / healthResults.length)
        : 0,
    },
    attention_needed: atRisk.map(h => ({
      name: h.name,
      company: h.company,
      score: h.score,
      top_signal: getTopSignal(h.signals),
    })),
    expansion_signals: expansionSignals.slice(0, 5),
    churn_signals: churnSignals.slice(0, 5),
    cadence: successPlan?.cadence || 'biweekly',
    milestone_templates: successPlan?.milestone_templates || [],
  };
}

// ─── Health Read Generator ────────────────────────────────────────────────────

/**
 * Generate a natural-language health read for a specific contact.
 * This is a structured summary Barry can use in conversation.
 *
 * @param {Object} contact — Firestore contact document
 * @returns {Object} — { summary, signals, recommendation }
 */
export function generateHealthRead(contact) {
  const health = computeHealthScore(contact);
  const signals = health.signals;
  const snooze = isContactSnoozed(contact);

  // Build signal descriptions
  const signalDescriptions = [];

  if (signals.recency < 30) {
    const lastAt = contact.engagement_summary?.last_contact_at;
    const days = lastAt ? Math.floor((Date.now() - new Date(lastAt).getTime()) / 86400_000) : null;
    signalDescriptions.push(
      days ? `Last contacted ${days} days ago — engagement has gone cold` : 'No contact history recorded'
    );
  }

  if (signals.replyRatio < 30) {
    signalDescriptions.push('Low reply rate — messages may not be resonating');
  }

  if (signals.nbsCompletionRate < 30) {
    signalDescriptions.push('Many next steps dismissed — may need a different approach');
  }

  if (signals.engagementTrend < 30) {
    signalDescriptions.push('Multiple consecutive no-replies — relationship may be stalling');
  }

  if (signals.milestoneProgress < 30 && contact.milestones?.length > 0) {
    const done = contact.milestones.filter(m => m.completed).length;
    signalDescriptions.push(`Only ${done}/${contact.milestones.length} milestones complete — adoption lagging`);
  }

  if (signals.sentiment < 30) {
    signalDescriptions.push('Last interaction had negative sentiment');
  }

  // Positive signals
  if (signals.recency >= 80) signalDescriptions.push('Recently contacted — relationship is warm');
  if (signals.replyRatio >= 80) signalDescriptions.push('High reply rate — strong engagement');
  if (signals.milestoneProgress >= 80) signalDescriptions.push('Most milestones hit — customer is thriving');

  // Recommendation
  let recommendation;
  if (health.bucket === 'at_risk') {
    recommendation = 'Schedule an immediate check-in. Consider a direct call rather than email. Review whether the current approach is working.';
  } else if (health.bucket === 'neutral') {
    recommendation = 'A proactive check-in would help keep momentum. Share a relevant update or ask about their current priorities.';
  } else {
    recommendation = 'This customer is healthy. Consider exploring expansion opportunities or asking for a referral.';
  }

  if (snooze.snoozed) {
    recommendation = `Currently snoozed (${snooze.daysRemaining} days remaining, reason: ${snooze.reason}). ${recommendation}`;
  }

  return {
    summary: `${contact.name} (${contact.company_name || 'Unknown company'}) — Health: ${health.label} (${health.score}/100)`,
    score: health.score,
    bucket: health.bucket,
    label: health.label,
    color: health.color,
    signals: signalDescriptions,
    recommendation,
    snoozed: snooze.snoozed,
  };
}

// ─── Signal Detection ─────────────────────────────────────────────────────────

/**
 * Detect expansion signals for a customer.
 *
 * @param {Object} contact
 * @returns {Array<{ type, description, contact_name, company }>}
 */
export function detectExpansionSignals(contact) {
  const signals = [];
  const health = computeHealthScore(contact);

  // High health + all milestones complete → expansion ready
  if (health.bucket === 'healthy' && contact.milestones?.every(m => m.completed)) {
    signals.push({
      type: 'milestone_complete',
      description: 'All milestones complete — ready for expansion conversation',
      contact_name: contact.name,
      company: contact.company_name,
    });
  }

  // High reply rate + frequent engagement → strong relationship
  if (health.signals.replyRatio >= 80 && health.signals.recency >= 70) {
    signals.push({
      type: 'strong_engagement',
      description: 'High engagement and reply rate — ideal time for upsell',
      contact_name: contact.name,
      company: contact.company_name,
    });
  }

  // Positive last outcome
  if (contact.engagement_summary?.last_outcome === 'replied_positive' && health.score >= 70) {
    signals.push({
      type: 'positive_momentum',
      description: 'Recent positive reply with high health — warm for expansion',
      contact_name: contact.name,
      company: contact.company_name,
    });
  }

  return signals;
}

/**
 * Detect churn/risk signals for a customer.
 *
 * @param {Object} contact
 * @returns {Array<{ type, severity, description, contact_name, company }>}
 */
export function detectChurnSignals(contact) {
  const signals = [];
  const health = computeHealthScore(contact);

  // No contact in 30+ days
  const lastAt = contact.engagement_summary?.last_contact_at;
  if (lastAt) {
    const daysSince = (Date.now() - new Date(lastAt).getTime()) / 86400_000;
    if (daysSince > 30) {
      signals.push({
        type: 'gone_dark',
        severity: 'high',
        description: `No contact in ${Math.floor(daysSince)} days — relationship may be lost`,
        contact_name: contact.name,
        company: contact.company_name,
      });
    }
  } else {
    signals.push({
      type: 'never_contacted',
      severity: 'high',
      description: 'Customer has never been contacted',
      contact_name: contact.name,
      company: contact.company_name,
    });
  }

  // Multiple consecutive no-replies
  const noReplies = contact.engagement_summary?.consecutive_no_replies || 0;
  if (noReplies >= 3) {
    signals.push({
      type: 'no_reply_streak',
      severity: noReplies >= 5 ? 'high' : 'medium',
      description: `${noReplies} consecutive messages without reply`,
      contact_name: contact.name,
      company: contact.company_name,
    });
  }

  // Negative last outcome
  if (contact.engagement_summary?.last_outcome === 'replied_negative') {
    signals.push({
      type: 'negative_sentiment',
      severity: 'high',
      description: 'Last interaction was negative — needs immediate attention',
      contact_name: contact.name,
      company: contact.company_name,
    });
  }

  // Low milestone progress after expected timeline
  if (contact.milestones?.length > 0 && contact.csm_enrolled_at) {
    const daysSinceEnroll = (Date.now() - new Date(contact.csm_enrolled_at).getTime()) / 86400_000;
    const expectedDone = contact.milestones.filter(m => m.target_days <= daysSinceEnroll).length;
    const actualDone = contact.milestones.filter(m => m.completed && m.target_days <= daysSinceEnroll).length;
    if (expectedDone > 0 && actualDone < expectedDone) {
      signals.push({
        type: 'milestone_behind',
        severity: 'medium',
        description: `${expectedDone - actualDone} milestone(s) overdue — adoption may be stalling`,
        contact_name: contact.name,
        company: contact.company_name,
      });
    }
  }

  return signals;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get the weakest signal name for quick display.
 */
function getTopSignal(signals) {
  if (!signals) return 'unknown';
  let lowest = 100;
  let key = 'unknown';
  for (const [k, v] of Object.entries(signals)) {
    if (v < lowest) { lowest = v; key = k; }
  }
  const labels = {
    recency: 'No recent contact',
    replyRatio: 'Low reply rate',
    nbsCompletionRate: 'Steps not completing',
    engagementTrend: 'Engagement declining',
    milestoneProgress: 'Milestones behind',
    sentiment: 'Negative sentiment',
  };
  return labels[key] || key;
}

/**
 * Build a portfolio summary string for Barry's system prompt.
 *
 * @param {Array} customers
 * @returns {string}
 */
export function buildPortfolioSummary(customers) {
  const results = customers.map(c => ({ ...c, _health: computeHealthScore(c) }));
  const atRisk = results.filter(c => c._health.bucket === 'at_risk');
  const avgScore = results.length > 0
    ? Math.round(results.reduce((s, c) => s + c._health.score, 0) / results.length)
    : 0;

  let summary = `Portfolio: ${results.length} customers, avg health ${avgScore}/100.`;
  if (atRisk.length > 0) {
    summary += ` ${atRisk.length} at risk: ${atRisk.map(c => c.name).join(', ')}.`;
  }
  return summary;
}
