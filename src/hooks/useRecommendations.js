/**
 * useRecommendations — Sprint 2A shared recommendations hook.
 *
 * Thin React wrapper over the EXISTING client-side recommendation engine
 * (src/utils/recommendationEngine.js). It does NOT re-rank, does NOT add a
 * second prioritization pipeline, and does NOT move the engine server-side.
 * It only:
 *   1. calls generateDashboardRecommendations(userId) (already sorted, capped at 5),
 *   2. normalizes each item to the locked Sprint 2A data contract.
 *
 * Locked contract (per item):
 *   { id, type, title, reason, urgency, actionLabel, route, entityId, entityType }
 *
 * EXTENDED for the canonical navigation sprint (additive — nothing above
 * changed shape):
 *   { reasonCode, recommendedAction, priorityId, taskId }
 *
 * These exist because a priority click now has to carry WHY. `reason` is prose
 * for the card; `reasonCode` is the engine's machine type, which is what the
 * arrival banner and Barry key off. Both are needed: the card shows a
 * sentence, and the destination needs something it can switch on.
 *
 * Field provenance (see PR notes):
 *   id, type        → passed through from the engine unchanged
 *   actionLabel     → REMAPPED from the engine's nested `action.label`
 *   title           → DERIVED by formatRecommendationTitle (src/utils/recommendationCopy.js)
 *   reason          → DERIVED: reasoning.observed (falls back to whyItMatters)
 *   urgency         → DERIVED from priorityWeight (0/1→high, 2→medium, 3→low)
 *   route           → DERIVED from entity id using real app routes
 *   entityId        → DERIVED: contactId ?? missionId ?? campaignId
 *   entityType      → DERIVED: 'contact' | 'mission' | 'campaign'
 *                     NOTE: the engine never emits 'company' or 'cadence', and
 *                     emits 'campaign' which is outside the contract's enum.
 */

import { useState, useEffect } from 'react';
import { generateDashboardRecommendations } from '../utils/recommendationEngine';
import { formatRecommendationTitle } from '../utils/recommendationCopy';
import { contactPath } from '../utils/navigation';

// priorityWeight → urgency. Weights come from PRIORITY_WEIGHTS in the engine:
//   0 = critical_contact, 1 = approaching_deadline, 2 = stalled_high_value, 3 = general_gap
function urgencyFromWeight(weight) {
  if (weight === 0 || weight === 1) return 'high';
  if (weight === 2) return 'medium';
  return 'low';
}

// Resolve the single entity a recommendation points at. The engine attaches at
// most one of contactId / missionId / campaignId per item.
function resolveEntity(rec) {
  if (rec.contactId) return { id: rec.contactId, type: 'contact', name: rec.contactName };
  if (rec.missionId) return { id: rec.missionId, type: 'mission', name: rec.missionName };
  if (rec.campaignId) return { id: rec.campaignId, type: 'campaign', name: rec.campaignName };
  return { id: null, type: null, name: null };
}

// Real routes in App.jsx — NOT the brief's illustrative '/contacts/:id'.
//   contact  → /contact/:contactId  (canonical, module-agnostic)
//   mission  → /hunter/mission/:missionId
//   campaign → /hunter (no id param)
function routeFromEntity(entity) {
  if (entity.type === 'contact' && entity.id) return contactPath(entity.id);
  if (entity.type === 'mission' && entity.id) return `/hunter/mission/${entity.id}`;
  if (entity.type === 'campaign') return '/hunter';
  return null;
}

/**
 * Map a raw engine recommendation to the locked Sprint 2A contract.
 * Every derived field has a safe default so the shape is always complete.
 */
export function normalizeRecommendation(rec) {
  const entity = resolveEntity(rec);
  const actionLabel = rec.action?.label || 'View';
  const reason = rec.reasoning?.observed || rec.reasoning?.whyItMatters || '';
  const id = rec.id ?? (entity.id ? `${rec.type}_${entity.id}` : rec.type);

  return {
    id,
    type: rec.type ?? null,
    title: formatRecommendationTitle(rec),
    reason,
    urgency: urgencyFromWeight(rec.priorityWeight),
    actionLabel,
    route: routeFromEntity(entity),
    entityId: entity.id,
    entityType: entity.type,

    // Navigation intent. Carried on the item so the card can hand it to
    // openContact() without reaching back into the raw engine object — the
    // normalized contract stays the only shape Mission Control ever sees.
    reasonCode: rec.type ?? null,
    recommendedAction: rec.action?.type ?? null,
    priorityId: id,
    // The engine does not currently emit a task id. Read defensively rather
    // than omitted, so the field starts flowing the moment it does without a
    // second change here.
    taskId: rec.taskId ?? rec.stepId ?? rec.next_step_id ?? null,
  };
}

export function useRecommendations(userId) {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    generateDashboardRecommendations(userId)
      .then((results) => {
        if (cancelled) return;
        const normalized = (results || []).slice(0, 5).map(normalizeRecommendation);
        setRecommendations(normalized);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [userId, retryCount]);

  const retry = () => setRetryCount(c => c + 1);

  return { recommendations, loading, error, retry };
}

export default useRecommendations;
