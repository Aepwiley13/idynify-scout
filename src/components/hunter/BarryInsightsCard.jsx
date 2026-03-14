/**
 * BARRY INSIGHTS CARD — Sprint 3: Outcome Attribution
 *
 * Displays Barry's learned strategy insights from outcome attribution.
 * Shows what's working, what's not, and best channels — only when
 * there's enough data to be meaningful (5+ tracked outcomes).
 *
 * Renders in the HunterContactDrawer main view, below recommendations.
 * Disappears silently when there's insufficient data.
 */

import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { TrendingUp, TrendingDown, Zap } from 'lucide-react';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import './BarryInsightsCard.css';

const MIN_ATTRIBUTIONS = 5;
const MIN_USES_FOR_INSIGHT = 3;

export default function BarryInsightsCard({ contactId }) {
  const [insights, setInsights] = useState(null);
  const [contactInsights, setContactInsights] = useState(null);

  useEffect(() => {
    loadInsights();
  }, [contactId]);

  async function loadInsights() {
    try {
      const user = getEffectiveUser();
      if (!user) return;

      // Load user-level strategy stats and contact-level attributions in parallel
      const [statsSnap, contactSnap] = await Promise.all([
        getDoc(doc(db, 'users', user.uid, 'barry_memory', 'strategy_stats')),
        contactId
          ? getDoc(doc(db, 'users', user.uid, 'contacts', contactId))
          : Promise.resolve(null)
      ]);

      // User-level insights
      if (statsSnap.exists()) {
        const stats = statsSnap.data();
        if (stats.total_attributions >= MIN_ATTRIBUTIONS) {
          setInsights(buildInsights(stats));
        }
      }

      // Contact-level insights from memory
      if (contactSnap?.exists()) {
        const memory = contactSnap.data()?.barry_memory;
        if (memory) {
          const worked = memory.what_has_worked || [];
          const notWorked = memory.what_has_not_worked || [];
          if (worked.length > 0 || notWorked.length > 0) {
            setContactInsights({ worked, notWorked });
          }
        }
      }
    } catch (error) {
      console.error('[BarryInsightsCard] Load error:', error);
    }
  }

  function buildInsights(stats) {
    const result = { best: null, worst: null, bestChannel: null, total: stats.total_attributions };

    // Best angle
    for (const [key, data] of Object.entries(stats.angle_outcomes || {})) {
      if (data.total < MIN_USES_FOR_INSIGHT) continue;
      const rate = Math.round((data.positive / data.total) * 100);
      if (rate >= 50 && (!result.best || rate > result.best.rate)) {
        result.best = { name: key, rate, total: data.total };
      }
    }

    // Worst angle
    for (const [key, data] of Object.entries(stats.angle_outcomes || {})) {
      if (data.total < MIN_USES_FOR_INSIGHT) continue;
      const rate = Math.round((data.positive / data.total) * 100);
      if (rate < 25 && (!result.worst || rate < result.worst.rate)) {
        result.worst = { name: key, rate, total: data.total };
      }
    }

    // Best channel
    for (const [key, data] of Object.entries(stats.channel_outcomes || {})) {
      if (data.total < MIN_USES_FOR_INSIGHT) continue;
      const rate = Math.round((data.positive / data.total) * 100);
      if (rate >= 40 && (!result.bestChannel || rate > result.bestChannel.rate)) {
        result.bestChannel = { name: key, rate, total: data.total };
      }
    }

    // Only show if we have at least one insight
    if (!result.best && !result.worst && !result.bestChannel) return null;
    return result;
  }

  if (!insights && !contactInsights) return null;

  return (
    <div className="barry-insights-card">
      <div className="barry-insights-header">
        <Zap className="barry-insights-icon" />
        <span className="barry-insights-label">Barry's Playbook</span>
        {insights?.total && (
          <span className="barry-insights-count">{insights.total} outcomes tracked</span>
        )}
      </div>

      <div className="barry-insights-body">
        {/* Contact-specific insights */}
        {contactInsights?.worked?.length > 0 && (
          <div className="barry-insight-row barry-insight--positive">
            <TrendingUp className="barry-insight-row-icon" />
            <span>Worked: {contactInsights.worked[contactInsights.worked.length - 1]}</span>
          </div>
        )}
        {contactInsights?.notWorked?.length > 0 && (
          <div className="barry-insight-row barry-insight--negative">
            <TrendingDown className="barry-insight-row-icon" />
            <span>Didn't work: {contactInsights.notWorked[contactInsights.notWorked.length - 1]}</span>
          </div>
        )}

        {/* User-level insights */}
        {insights?.best && (
          <div className="barry-insight-row barry-insight--positive">
            <TrendingUp className="barry-insight-row-icon" />
            <span>Best strategy: <strong>{insights.best.name}</strong> ({insights.best.rate}% positive)</span>
          </div>
        )}
        {insights?.worst && (
          <div className="barry-insight-row barry-insight--negative">
            <TrendingDown className="barry-insight-row-icon" />
            <span>Avoid: <strong>{insights.worst.name}</strong> ({insights.worst.rate}% positive)</span>
          </div>
        )}
        {insights?.bestChannel && (
          <div className="barry-insight-row barry-insight--channel">
            <Zap className="barry-insight-row-icon" />
            <span>Best channel: <strong>{insights.bestChannel.name}</strong> ({insights.bestChannel.rate}% positive)</span>
          </div>
        )}
      </div>
    </div>
  );
}
