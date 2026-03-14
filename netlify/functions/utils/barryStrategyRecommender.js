/**
 * BARRY STRATEGY RECOMMENDER — Sprint 4: Intelligence Upgrade
 *
 * Pre-generation intelligence: before Barry generates messages, this module
 * analyzes outcome attribution data to recommend which strategy and channel
 * are most likely to succeed for this contact.
 *
 * Two levels of recommendation:
 *   1. Contact-level: what has worked/failed with THIS person
 *   2. User-level: aggregate stats across all contacts (strategy_stats)
 *
 * Returns a recommendation object that:
 *   - Injects strategy guidance into the Claude prompt
 *   - Tags generated messages with confidence scores
 *   - Flags strategies the user should avoid
 *
 * No AI calls — pure rule-based analysis from structured data.
 */

// ── Recommendation Engine ───────────────────────────────────────────────────

/**
 * Generate strategy recommendation based on outcome attribution data.
 *
 * @param {Object} params
 * @param {Object} params.contact - Full contact document
 * @param {string} params.engagementIntent - 'prospect' | 'warm' | 'customer' | 'partner'
 * @param {Object|null} params.strategyStats - User-level strategy_stats from barry_memory
 * @param {Object|null} params.barryMemory - Per-contact barry_memory
 * @returns {Object} { recommendation, promptGuidance, strategyScores }
 */
export function recommendStrategy({ contact, engagementIntent, strategyStats, barryMemory, recentAttributions }) {
  const scores = {
    direct: { score: 50, reasons: [], avoid: false },
    warm:   { score: 50, reasons: [], avoid: false },
    value:  { score: 50, reasons: [], avoid: false },
    humor:  { score: 35, reasons: [], avoid: false }   // Lower baseline — humor is situational
  };

  let bestChannel = null;
  const avoidStrategies = [];

  // ── 1. Contact-level signals (highest priority) ───────────────────────

  if (barryMemory) {
    const worked = barryMemory.what_has_worked || [];
    const notWorked = barryMemory.what_has_not_worked || [];

    // Boost strategies that have worked with this contact
    for (const entry of worked) {
      const lower = entry.toLowerCase();
      if (lower.includes('direct')) {
        scores.direct.score += 25;
        scores.direct.reasons.push('Worked with this contact before');
      }
      if (lower.includes('warm') || lower.includes('personal')) {
        scores.warm.score += 25;
        scores.warm.reasons.push('Worked with this contact before');
      }
      if (lower.includes('value')) {
        scores.value.score += 25;
        scores.value.reasons.push('Worked with this contact before');
      }
      if (lower.includes('humor') || lower.includes('funny') || lower.includes('playful')) {
        scores.humor.score += 25;
        scores.humor.reasons.push('Worked with this contact before');
      }
    }

    // Penalize strategies that have failed with this contact
    for (const entry of notWorked) {
      const lower = entry.toLowerCase();
      if (lower.includes('direct')) {
        scores.direct.score -= 20;
        scores.direct.reasons.push('Failed with this contact');
      }
      if (lower.includes('warm') || lower.includes('personal')) {
        scores.warm.score -= 20;
        scores.warm.reasons.push('Failed with this contact');
      }
      if (lower.includes('value')) {
        scores.value.score -= 20;
        scores.value.reasons.push('Failed with this contact');
      }
      if (lower.includes('humor') || lower.includes('funny') || lower.includes('playful')) {
        scores.humor.score -= 20;
        scores.humor.reasons.push('Failed with this contact');
      }
    }
  }

  // ── 1b. Contact-level attribution outcomes (recency-weighted) ────────
  //    Recent outcomes carry more weight than older ones.

  if (recentAttributions && recentAttributions.length > 0) {
    for (let i = 0; i < recentAttributions.length; i++) {
      const attr = recentAttributions[i];
      const strategy = attr.strategy_used;
      if (!strategy) continue;

      const key = mapStrategyKey(strategy);
      if (!key || !scores[key]) continue;

      // Recency weight: most recent = 1.0, each older = 0.7x previous
      const recencyWeight = Math.pow(0.7, i);
      const delta = Math.round(15 * recencyWeight);

      if (attr.outcome_class === 'positive') {
        scores[key].score += delta;
        if (i === 0) scores[key].reasons.push(`Last engagement with this contact was positive (${strategy})`);
      } else if (attr.outcome_class === 'negative') {
        scores[key].score -= delta;
        if (i === 0) scores[key].reasons.push(`Last engagement with this contact was negative (${strategy})`);
      }

      // Guardrail compliance signal: following advice led to positive outcome
      if (attr.followed_advice === true && attr.outcome_class === 'positive' && attr.guardrail_action) {
        const guardrailKey = mapGuardrailToStrategy(attr.guardrail_action);
        if (guardrailKey && scores[guardrailKey]) {
          scores[guardrailKey].score += Math.round(10 * recencyWeight);
          if (i === 0) scores[guardrailKey].reasons.push('Following Barry\'s guardrail advice led to positive outcome');
        }
      }

      // Ignoring advice led to negative outcome — penalize that strategy
      if (attr.followed_advice === false && attr.outcome_class === 'negative' && attr.guardrail_action) {
        const ignoredKey = mapStrategyKey(strategy);
        if (ignoredKey && scores[ignoredKey]) {
          scores[ignoredKey].score -= Math.round(8 * recencyWeight);
        }
      }
    }
  }

  // ── 2. Relationship signals ───────────────────────────────────────────

  const warmth = contact?.warmth_level;
  const relState = contact?.relationship_state;
  const isKnown = contact?.known_contact === true;
  const hasReplied = (contact?.engagement_summary?.replies_received || 0) > 0;
  const consecutiveNoReplies = contact?.engagement_summary?.consecutive_no_replies || 0;

  // Known/warm contacts → boost warm strategy
  if (isKnown || warmth === 'warm' || warmth === 'hot') {
    scores.warm.score += 15;
    scores.warm.reasons.push('Warm relationship detected');
    // Penalize cold approaches for warm contacts
    scores.direct.score -= 5;
  }

  // Cold/new contacts → boost direct and value
  if (engagementIntent === 'prospect' && !isKnown && !hasReplied) {
    scores.direct.score += 10;
    scores.direct.reasons.push('New prospect — direct approach cuts through');
    scores.value.score += 10;
    scores.value.reasons.push('New prospect — value-first builds credibility');
  }

  // Consecutive no-replies → they're not responding to current approach
  if (consecutiveNoReplies >= 2) {
    // Whatever was tried last should be deprioritized
    // Boost the strategies that haven't been tried
    scores.value.score += 10;
    scores.value.reasons.push(`${consecutiveNoReplies} no-replies — try a different angle`);
    // Humor can break through when conventional approaches stall
    scores.humor.score += 15;
    scores.humor.reasons.push(`${consecutiveNoReplies} no-replies — humor can break the pattern`);
  }

  // Engaged or trusted → warm works best, humor is also safe
  if (relState === 'engaged' || relState === 'warm' || relState === 'trusted') {
    scores.warm.score += 10;
    scores.warm.reasons.push('Active relationship — personal touch resonates');
    scores.humor.score += 10;
    scores.humor.reasons.push('Established rapport makes humor safe');
  }

  // Suppress humor for high-value cold prospects (too risky)
  if (engagementIntent === 'prospect' && !isKnown && !hasReplied) {
    if (contact?.strategic_value === 'high' || contact?.strategic_value === 'critical') {
      scores.humor.score -= 15;
      scores.humor.reasons.push('High-value cold prospect — humor is risky');
    }
  }

  // ── 3. User-level aggregate stats ─────────────────────────────────────

  if (strategyStats && strategyStats.total_attributions >= 5) {
    const angleOutcomes = strategyStats.angle_outcomes || {};

    for (const [strategy, data] of Object.entries(angleOutcomes)) {
      if (data.total < 3) continue;
      const rate = (data.positive / data.total) * 100;

      // Map strategy names to our score keys
      const key = mapStrategyKey(strategy);
      if (!key || !scores[key]) continue;

      if (rate >= 60) {
        scores[key].score += 15;
        scores[key].reasons.push(`${Math.round(rate)}% positive rate across contacts`);
      } else if (rate < 20) {
        scores[key].score -= 15;
        scores[key].reasons.push(`Only ${Math.round(rate)}% positive rate — consider alternatives`);
        if (data.total >= 5) {
          scores[key].avoid = true;
          avoidStrategies.push(key);
        }
      }
    }

    // Best channel recommendation
    const channelOutcomes = strategyStats.channel_outcomes || {};
    let bestRate = 0;
    for (const [channel, data] of Object.entries(channelOutcomes)) {
      if (data.total < 3) continue;
      const rate = (data.positive / data.total) * 100;
      if (rate > bestRate) {
        bestRate = rate;
        bestChannel = { name: channel, rate: Math.round(rate), total: data.total };
      }
    }
  }

  // ── 4. Build recommendation ───────────────────────────────────────────

  // Clamp scores to 0-100
  for (const key of Object.keys(scores)) {
    scores[key].score = Math.max(0, Math.min(100, scores[key].score));
  }

  // Find the recommended strategy (highest score)
  const sorted = Object.entries(scores).sort((a, b) => b[1].score - a[1].score);
  const recommended = sorted[0][0];
  const recommendedScore = sorted[0][1].score;

  // Only surface a recommendation if there's meaningful differentiation
  const hasStrongRecommendation = recommendedScore - sorted[1][1].score >= 10;

  const recommendation = {
    strategy: hasStrongRecommendation ? recommended : null,
    confidence: hasStrongRecommendation ? (recommendedScore >= 75 ? 'high' : 'moderate') : 'low',
    bestChannel: bestChannel,
    avoidStrategies,
    reasons: hasStrongRecommendation ? scores[recommended].reasons : []
  };

  // Build prompt guidance for Claude
  const promptGuidance = buildPromptGuidance(recommendation, scores);

  return {
    recommendation,
    promptGuidance,
    strategyScores: scores
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Map various strategy name formats to our canonical keys.
 */
function mapStrategyKey(name) {
  const lower = (name || '').toLowerCase();
  if (lower.includes('direct') || lower === 'direct & short' || lower.includes('direct_ask')) return 'direct';
  if (lower.includes('warm') || lower.includes('personal') || lower.includes('soft_reconnect')) return 'warm';
  if (lower.includes('value') || lower.includes('insight') || lower.includes('value_add') || lower.includes('pattern_interrupt')) return 'value';
  if (lower.includes('humor') || lower.includes('playful') || lower.includes('funny') || lower.includes('humor_driven')) return 'humor';
  return null;
}

/**
 * Map guardrail actions to strategy keys.
 * When a guardrail action leads to a positive outcome, boost that strategy.
 */
function mapGuardrailToStrategy(action) {
  const map = {
    warm_up: 'warm',
    reference_history: 'warm',
    classify_known: 'warm',
    keep_professional: 'direct',
    send_anyway: 'direct',
    start_fresh: 'value',
    skip: null,
    classify_prospect: 'direct',
    cool_down: 'direct',
    actually_know: 'warm'
  };
  return map[action] || null;
}

/**
 * Build prompt guidance string for injection into Claude generation prompts.
 * Only included when there's actionable intelligence.
 */
function buildPromptGuidance(recommendation, scores) {
  const parts = [];

  if (recommendation.strategy) {
    const strategyLabels = {
      direct: 'Direct & Short',
      warm: 'Warm & Personal',
      value: 'Value-Led',
      humor: 'Humor-Driven'
    };
    parts.push(
      `BARRY'S RECOMMENDATION: The "${strategyLabels[recommendation.strategy]}" approach is most likely to succeed` +
      (recommendation.reasons.length > 0 ? ` (${recommendation.reasons[0]})` : '') +
      `. Make this option especially strong.`
    );
  }

  if (recommendation.avoidStrategies.length > 0) {
    const labels = recommendation.avoidStrategies.map(s => {
      const map = { direct: 'Direct & Short', warm: 'Warm & Personal', value: 'Value-Led', humor: 'Humor-Driven' };
      return map[s] || s;
    });
    parts.push(
      `NOTE: The "${labels.join(', ')}" approach has underperformed. Still generate it, but consider a fresh angle rather than repeating what hasn't worked.`
    );
  }

  if (recommendation.bestChannel) {
    parts.push(
      `Best channel for this user: ${recommendation.bestChannel.name} (${recommendation.bestChannel.rate}% positive rate)`
    );
  }

  if (parts.length === 0) return '';
  return '\nSTRATEGY INTELLIGENCE (from Barry\'s outcome tracking):\n' + parts.join('\n') + '\n';
}
