/**
 * reconConfidence.js — RECON data completeness scoring.
 *
 * Works with the actual Firestore structure:
 *   dashboard.modules = [{ id: 'recon', sections: [{ id, status, data }] }]
 *
 * Returns 0–100. Drives the ReconDot color on the Hunter card and Barry's
 * context warning in Active Missions.
 */

import { SECTION_WEIGHTS } from '../shared/reconHealthConstants';

const TOTAL_WEIGHT = Object.values(SECTION_WEIGHTS).reduce((sum, w) => sum + w, 0);

/**
 * Calculate RECON confidence from the dashboard Firestore doc.
 * Uses section weights so high-impact sections (1, 2, 3, 5) move the score more.
 * @param {Object} dashboardData - Firestore dashboard document data
 * @returns {number} 0–100
 */
export function calculateReconConfidence(dashboardData) {
  if (!dashboardData?.modules) return 0;

  const reconModule = dashboardData.modules.find(m => m.id === 'recon');
  if (!reconModule?.sections || reconModule.sections.length === 0) return 0;

  let completedWeight = 0;
  for (const s of reconModule.sections) {
    const hasData =
      s.status === 'completed' &&
      s.data &&
      (typeof s.data === 'string' ? s.data.trim().length > 50 : Object.keys(s.data).length > 0);
    if (hasData) {
      completedWeight += SECTION_WEIGHTS[s.id] ?? 0;
    }
  }

  return Math.round((completedWeight / TOTAL_WEIGHT) * 100);
}

/**
 * Map a 0–100 confidence score to a color identifier.
 * @param {number} score
 * @returns {'green'|'yellow'|'red'}
 */
export function getConfidenceColor(score) {
  if (score >= 80) return 'green';   // Barry has full context
  if (score >= 40) return 'yellow';  // Barry is working partial
  return 'red';                      // Barry is mostly guessing
}

/**
 * Human-readable label for the confidence score.
 * @param {number} score
 * @returns {string}
 */
export function getConfidenceLabel(score) {
  if (score >= 80) return 'Strong context';
  if (score >= 40) return 'Partial context';
  return 'Limited context';
}
