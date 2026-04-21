/**
 * reconCapability.js — Server-side RECON completeness + capability block builder.
 *
 * Mirrors the client-side calculateReconConfidence() logic (src/utils/reconConfidence.js)
 * but lives here so Netlify functions can use it without importing from src/.
 *
 * The capability block replaces the binary "Not configured" ICP evaluation so Barry
 * communicates his actual knowledge state rather than guessing from filter fields.
 */

const SECTION_WEIGHTS = {
  1: 25, 2: 20, 3: 15, 5: 15, 9: 10,
  4: 5,  6: 3,  7: 3,  8: 3,  10: 1,
};

// Shared sections only — section 9 (Messaging) is per-ICP, excluded from missing check
const SHARED_SECTION_NAMES = {
  1: 'Business Foundation',
  2: 'Product Deep Dive',
  3: 'Target Market',
  4: 'Ideal Customer Psychographics',
  5: 'Pain Points & Motivations',
  6: 'Buying Behavior',
  7: 'Decision Process',
  8: 'Competitive Intel',
  10: 'Behavioral Signals',
};

const TOTAL_WEIGHT = Object.values(SECTION_WEIGHTS).reduce((s, w) => s + w, 0);
const SHARED_COUNT = Object.keys(SHARED_SECTION_NAMES).length;

/**
 * Compute weighted RECON score and missing section names from dashboard data.
 * @param {Object|null} dashboardData
 * @returns {{ score: number, completedIds: number[], missingNames: string[] }}
 */
export function computeReconState(dashboardData) {
  if (!dashboardData?.modules) {
    return { score: 0, completedIds: [], missingNames: Object.values(SHARED_SECTION_NAMES) };
  }

  const reconModule = dashboardData.modules.find(m => m.id === 'recon');
  if (!reconModule?.sections) {
    return { score: 0, completedIds: [], missingNames: Object.values(SHARED_SECTION_NAMES) };
  }

  let completedWeight = 0;
  const completedIds = new Set();

  for (const s of reconModule.sections) {
    const hasData =
      s.status === 'completed' &&
      s.data &&
      (typeof s.data === 'string' ? s.data.trim().length > 50 : Object.keys(s.data).length > 0);
    if (hasData) {
      completedWeight += SECTION_WEIGHTS[s.sectionId] ?? 0;
      completedIds.add(s.sectionId);
    }
  }

  const score = Math.round((completedWeight / TOTAL_WEIGHT) * 100);
  const missingNames = Object.entries(SHARED_SECTION_NAMES)
    .filter(([id]) => !completedIds.has(Number(id)))
    .map(([, name]) => name);

  return { score, completedIds: [...completedIds], missingNames };
}

/**
 * Build the structured capability block injected into Barry's system prompt.
 * Replaces the binary "Not configured" ICP evaluation with an honest state summary.
 *
 * @param {Object|null} dashboardData - Firestore dashboards/{uid} document data
 * @param {Object|null} icpProfile - Active ICP profile (formal targeting filters)
 * @param {number} serviceProfileCount - Number of configured service profiles
 * @returns {string} Formatted capability block ready for prompt injection
 */
export function buildCapabilityBlock(dashboardData, icpProfile, serviceProfileCount = 0) {
  const { score, completedIds, missingNames } = computeReconState(dashboardData);
  const sharedCompleted = completedIds.filter(id => id !== 9).length;

  // Summarise what formal ICP filter fields have been saved
  const filterParts = [];
  if (icpProfile) {
    if (icpProfile.industries?.length) filterParts.push(`${icpProfile.industries.length} industr${icpProfile.industries.length === 1 ? 'y' : 'ies'}`);
    if (icpProfile.isNationwide) filterParts.push('Nationwide');
    else if (icpProfile.locations?.length) filterParts.push(`${icpProfile.locations.length} location${icpProfile.locations.length !== 1 ? 's' : ''}`);
    if (icpProfile.companySizes?.length) filterParts.push(`${icpProfile.companySizes.length} company size${icpProfile.companySizes.length !== 1 ? 's' : ''}`);
    if (icpProfile.targetTitles?.length) filterParts.push(`${icpProfile.targetTitles.length} target title${icpProfile.targetTitles.length !== 1 ? 's' : ''}`);
    if (icpProfile.companyKeywords?.length) filterParts.push(`${icpProfile.companyKeywords.length} keyword${icpProfile.companyKeywords.length !== 1 ? 's' : ''}`);
  }

  const hasFormalFilters = filterParts.length > 0;
  const formalFiltersStatus = hasFormalFilters
    ? `Saved (${filterParts.join(', ')})`
    : score >= 60
    ? 'Not formally saved — using RECON intelligence as targeting context'
    : 'Not configured';

  const profileName = icpProfile?.name || icpProfile?.profileName || null;

  const lines = [
    `━━━ BARRY'S CURRENT CAPABILITY STATE ━━━`,
    `RECON completion: ${score}% (${sharedCompleted} of ${SHARED_COUNT} shared sections complete)`,
    `Missing sections: ${missingNames.length === 0 ? 'None — fully trained' : missingNames.join(', ')}`,
    `ICP targeting filters (formal): ${formalFiltersStatus}`,
    `Service profiles: ${serviceProfileCount > 0 ? `${serviceProfileCount} configured` : 'None configured yet'}`,
  ];

  if (profileName) lines.push(`Active ICP profile: ${profileName}`);
  lines.push('');

  if (!hasFormalFilters && score >= 60) {
    lines.push(
      'IMPORTANT: The user has not filled in the formal ICP targeting filter form (industries, locations, company sizes, etc.).',
      'However, RECON training is rich — use the RECON training data above as your ICP context.',
      'Do NOT tell the user their ICP is "not configured" or "incomplete". You have trained intelligence.',
      'When asked about their ICP, describe what you know from RECON (who they sell to, pain points, market) instead of asking them to configure filters.',
      ''
    );
  }

  return lines.join('\n');
}
