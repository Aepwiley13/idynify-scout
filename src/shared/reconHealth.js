/**
 * computeReconHealth — pure function, no Firestore reads.
 *
 * Callers load dashboards/{userId} and users/{userId}/companyProfile/current,
 * then pass both in. The result is the full ReconHealthComputed object used
 * by ReconOverview, the Knowledge Map, and Barry function context assembly.
 *
 * @param {Object} dashboardData     - Firestore dashboards/{userId} document
 * @param {Object} currentIcpProfile - Firestore users/{userId}/companyProfile/current (may be null)
 * @returns {ReconHealthComputed}
 */

import {
  SECTION_WEIGHTS,
  CRITICAL_SECTIONS,
  CRITICAL_GAP_FLAGS,
  STALENESS_DAYS,
  TRAINING_DIMENSIONS,
} from './reconHealthConstants.js';

export function computeReconHealth(dashboardData, currentIcpProfile) {
  const sections =
    dashboardData?.modules?.find((m) => m.id === 'recon')?.sections || [];
  const storedHealth = dashboardData?.reconHealth || {};

  // ─── Weighted score ───────────────────────────────────────────────────────
  // Sections with quality: 'weak' count 40% of their weight.
  // Sections without a quality tag (coaching not yet run) count as full weight
  // if completed — optimistic default so score doesn't appear deflated.

  let weightedScore = 0;
  const completedSectionIds = [];

  for (const [sid, weight] of Object.entries(SECTION_WEIGHTS)) {
    const id = parseInt(sid);
    const s = sections.find((x) => x.sectionId === id);
    if (s?.status === 'completed') {
      completedSectionIds.push(id);
      const quality = s.quality; // written by barry-coach-section endpoint
      const multiplier = quality === 'weak' ? 0.4 : 1.0;
      weightedScore += weight * multiplier;
    }
  }
  weightedScore = Math.round(Math.min(100, Math.max(0, weightedScore)));

  // ─── Unweighted completion % ─────────────────────────────────────────────
  const total = sections.length || 10;
  const completionPct = Math.round((completedSectionIds.length / total) * 100);

  // ─── Staleness flags ──────────────────────────────────────────────────────
  const stalenessFlags = sections
    .filter((s) => s.completedAt)
    .map((s) => {
      const daysSince =
        (Date.now() - new Date(s.completedAt).getTime()) /
        (1000 * 60 * 60 * 24);
      return {
        sectionId: s.sectionId,
        completedAt: s.completedAt,
        daysSinceUpdate: Math.round(daysSince),
        isStale: daysSince > STALENESS_DAYS,
      };
    });

  // ─── Critical gap flags ───────────────────────────────────────────────────
  const criticalGapFlags = CRITICAL_SECTIONS.filter((id) => {
    const s = sections.find((x) => x.sectionId === id);
    return !s || s.status !== 'completed';
  }).map((id) => CRITICAL_GAP_FLAGS[id]);

  // ─── Scout ICP drift detection ────────────────────────────────────────────
  const scoutConflictFlags = [];
  const snapshot = storedHealth.icpSnapshotAtLastReconSave;

  if (snapshot && currentIcpProfile) {
    const hasOverlap = (a, b) =>
      Array.isArray(a) && Array.isArray(b) && a.some((x) => b.includes(x));

    if (
      snapshot.industries?.length > 0 &&
      currentIcpProfile.industries?.length > 0 &&
      !hasOverlap(currentIcpProfile.industries, snapshot.industries)
    ) {
      scoutConflictFlags.push('ICP_INDUSTRY_DRIFT');
    }

    if (
      snapshot.companySizes?.length > 0 &&
      currentIcpProfile.companySizes?.length > 0 &&
      !hasOverlap(currentIcpProfile.companySizes, snapshot.companySizes)
    ) {
      scoutConflictFlags.push('ICP_SIZE_DRIFT');
    }

    const locationDrift =
      snapshot.isNationwide !== currentIcpProfile.isNationwide ||
      (snapshot.locations?.length > 0 &&
        currentIcpProfile.locations?.length > 0 &&
        !hasOverlap(currentIcpProfile.locations, snapshot.locations));

    if (locationDrift) {
      scoutConflictFlags.push('ICP_LOCATION_DRIFT');
    }
  }

  // ─── User-requested review ────────────────────────────────────────────────
  const hasUnreviewedSections = storedHealth.userRequestedReviewAt
    ? sections.some(
        (s) =>
          s.completedAt &&
          s.completedAt < storedHealth.userRequestedReviewAt
      )
    : false;

  // ─── Per-dimension tile state (used by Knowledge Map) ────────────────────
  // Priority: conflict > stale > weak > empty. strong only if none apply.
  const dimensionStates = {};

  for (const dim of TRAINING_DIMENSIONS) {
    const dimSections = dim.sections.map((id) =>
      sections.find((s) => s.sectionId === id)
    );
    const allCompleted = dimSections.every((s) => s?.status === 'completed');
    const anyCompleted = dimSections.some((s) => s?.status === 'completed');

    // conflict — icp dimension only, zero-overlap ICP drift detected
    if (dim.id === 'icp' && scoutConflictFlags.length > 0) {
      dimensionStates[dim.id] = 'conflict';
      continue;
    }

    // stale — any completed section > 90 days old
    const isStale = dimSections.some((s) => {
      if (!s?.completedAt) return false;
      const days =
        (Date.now() - new Date(s.completedAt).getTime()) /
        (1000 * 60 * 60 * 24);
      return days > STALENESS_DAYS;
    });
    if (isStale) {
      dimensionStates[dim.id] = 'stale';
      continue;
    }

    // weak — all completed but at least one quality: weak
    if (allCompleted) {
      const hasWeak = dimSections.some((s) => s?.quality === 'weak');
      dimensionStates[dim.id] = hasWeak ? 'weak' : 'strong';
      continue;
    }

    // empty (none or partially completed without quality data)
    dimensionStates[dim.id] = 'empty';
  }

  return {
    weightedScore,
    completionPct,
    completedSectionIds,
    stalenessFlags,
    hasAnyStaleness: stalenessFlags.some((f) => f.isStale),
    criticalGapFlags,
    hasCriticalGaps: criticalGapFlags.length > 0,
    scoutConflictFlags,
    hasScoutConflict: scoutConflictFlags.length > 0,
    hasUnreviewedSections,
    dimensionStates, // { identity: 'strong', icp: 'weak', ... }
  };
}

/**
 * Returns the recommended next dimension to train based on spec priority rules.
 * Returns { dimension, reason, path } or null if fully trained.
 */
export function getTrainNextRecommendation(health, dimensions) {
  const { dimensionStates, stalenessFlags } = health;

  // 1. Conflict — icp only
  const conflictDim = dimensions.find(
    (d) => dimensionStates[d.id] === 'conflict'
  );
  if (conflictDim) {
    return {
      dimension: conflictDim,
      reason: 'ICP Conflict — your Scout ICP settings have changed since this was trained. Barry\'s targeting and your ICP no longer match.',
      state: 'conflict',
    };
  }

  // 2. Critical tile empty or incomplete
  const criticalDims = dimensions.filter((d) =>
    d.sections.some((s) => [1, 2, 3, 5].includes(s))
  );
  const emptyCritical = criticalDims.find(
    (d) => dimensionStates[d.id] === 'empty'
  );
  if (emptyCritical) {
    return {
      dimension: emptyCritical,
      reason: emptyCritical.impactWhenMissing,
      state: 'empty',
    };
  }

  // 3. Critical tile weak
  const weakCritical = criticalDims.find(
    (d) => dimensionStates[d.id] === 'weak'
  );
  if (weakCritical) {
    return {
      dimension: weakCritical,
      reason: 'Thin data — Barry\'s current assumption: "' + weakCritical.fallbackAssumption + '"',
      state: 'weak',
    };
  }

  // 4. Any tile stale — recommend stalest
  const staleDims = dimensions
    .filter((d) => dimensionStates[d.id] === 'stale')
    .map((d) => {
      const oldest = d.sections.reduce((min, sId) => {
        const flag = stalenessFlags.find((f) => f.sectionId === sId);
        return flag && flag.daysSinceUpdate > min ? flag.daysSinceUpdate : min;
      }, 0);
      return { dim: d, daysSince: oldest };
    })
    .sort((a, b) => b.daysSince - a.daysSince);

  if (staleDims.length > 0) {
    const { dim, daysSince } = staleDims[0];
    return {
      dimension: dim,
      reason: `Outdated — last trained ${daysSince} days ago. Barry may be using context that no longer matches your business.`,
      state: 'stale',
    };
  }

  // 5. Any non-critical tile weak
  const weakAny = dimensions.find((d) => dimensionStates[d.id] === 'weak');
  if (weakAny) {
    return {
      dimension: weakAny,
      reason: 'Thin data — Barry\'s current assumption: "' + weakAny.fallbackAssumption + '"',
      state: 'weak',
    };
  }

  // 6. All strong
  return null;
}
