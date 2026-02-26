/**
 * reconConfidence.js — RECON data completeness scoring.
 *
 * Works with the actual Firestore structure:
 *   dashboard.modules = [{ id: 'recon', sections: [{ id, status, data }] }]
 *
 * Returns 0–100. Drives the ReconDot color on the Hunter card and Barry's
 * context warning in Active Missions.
 */

/**
 * Calculate RECON confidence from the dashboard Firestore doc.
 * @param {Object} dashboardData - Firestore dashboard document data
 * @returns {number} 0–100
 */
export function calculateReconConfidence(dashboardData) {
  if (!dashboardData?.modules) return 0;

  const reconModule = dashboardData.modules.find(m => m.id === 'recon');
  if (!reconModule?.sections || reconModule.sections.length === 0) return 0;

  const sections = reconModule.sections;
  const completed = sections.filter(s => {
    if (s.status !== 'completed' || !s.data) return false;
    if (typeof s.data === 'string') return s.data.trim().length > 50;
    if (typeof s.data === 'object') return Object.keys(s.data).length > 0;
    return false;
  });

  return Math.round((completed.length / sections.length) * 100);
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
