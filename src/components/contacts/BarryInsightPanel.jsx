/**
 * BARRY INSIGHT PANEL (Step 7)
 *
 * Contextual recommendation surface for the Contact Profile page.
 * When a contact has active recommendations, Barry surfaces them
 * at the top of the engagement area so they are visible at the moment
 * the user is already thinking about that contact.
 *
 * Uses the same BarryRecommendationCard component as the dashboard.
 */

import { useState, useEffect } from 'react';
import { auth } from '../../firebase/config';
import { generateContactRecommendations, dismissRecommendation } from '../../utils/recommendationEngine';
import BarryRecommendationCard from '../hunter/BarryRecommendationCard';
import './BarryInsightPanel.css';

export default function BarryInsightPanel({ contactId, onAction }) {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (contactId) {
      loadRecommendations();
    }
  }, [contactId]);

  async function loadRecommendations() {
    const user = auth.currentUser;
    if (!user || !contactId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const recs = await generateContactRecommendations(user.uid, contactId);
      setRecommendations(recs);
    } catch (error) {
      console.error('[BarryInsightPanel] Failed to load recommendations:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleDismiss(recommendationId, reason) {
    const user = auth.currentUser;
    if (!user) return;
    const success = await dismissRecommendation(user.uid, recommendationId, reason);
    if (success) {
      setRecommendations(prev => prev.filter(r => r.id !== recommendationId));
    }
  }

  function handleAction(recommendation) {
    if (onAction) {
      onAction(recommendation);
    }
  }

  // Don't render anything if no recommendations
  if (!loading && recommendations.length === 0) return null;

  return (
    <div className="barry-insight-panel">
      {loading ? (
        <div className="barry-insight-loading">
          <span className="text-lg">🐻</span>
          <span className="text-xs text-gray-500 font-mono">Barry is checking...</span>
        </div>
      ) : (
        <div className="barry-insight-content">
          <div className="barry-insight-header">
            <span className="text-sm">🐻</span>
            <span className="barry-insight-title">Barry's Insight</span>
          </div>
          <div className="barry-insight-cards">
            {recommendations.map(rec => (
              <BarryRecommendationCard
                key={rec.id}
                recommendation={rec}
                onAction={handleAction}
                onDismiss={handleDismiss}
                compact={true}
                showCategory={false}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
