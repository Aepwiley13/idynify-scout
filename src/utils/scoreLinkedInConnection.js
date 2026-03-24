/**
 * scoreLinkedInConnection.js
 *
 * Scores a LinkedIn connection row for ICP fit using available signals.
 *
 * LinkedIn CSVs only export: First Name, Last Name, Company, Position, Connected On.
 * Industry, revenue, size, and location are unavailable — so calculateICPScore()
 * from icpScoring.js cannot be meaningfully applied here.
 *
 * This helper uses two available signals instead:
 *
 *   1. Title seniority (0–40 pts)
 *      Decision-makers and founders score highest. Mid-level management
 *      scores partially. Non-management gets minimal credit.
 *
 *   2. Company name match against user's ICP target companies (0–60 pts)
 *      Reserved for Phase 3 when ICP target companies are stored in the system.
 *      Currently returns 0 — total score is title-seniority-only until then.
 *
 * Tiers:
 *   hot      ≥ 85
 *   warm     ≥ 65
 *   unscored < 65
 *
 * Usage:
 *   import { scoreLinkedInConnection } from '../utils/scoreLinkedInConnection';
 *   const { icp_match_score, icp_tier } = scoreLinkedInConnection({ title: 'CEO', company: 'Acme' });
 */

// Title keywords by seniority tier (checked in order — first match wins)
const SENIOR_TITLES = [
  'ceo', 'cto', 'coo', 'cfo', 'cmo', 'cpo', 'ciso',
  'founder', 'co-founder', 'cofounder',
  'president', 'owner', 'principal',
  'managing director', 'managing partner',
  'executive director',
];

const MID_TITLES = [
  'vice president', 'vp of', 'vp,', ' vp ',
  'svp', 'evp',
  'director of', 'director,', ' director',
  'head of', 'head,',
  'chief ',          // "Chief Revenue Officer" etc. not already caught above
];

const JUNIOR_TITLES = [
  'manager', 'lead ', 'senior ', 'sr.', 'sr ',
  'team lead', 'team leader',
];

/**
 * Compute ICP match score and tier for a single LinkedIn connection row.
 *
 * @param {{ title?: string, company?: string }} row
 * @param {{ targetCompanies?: string[] }} [options]
 *   targetCompanies — user's ICP target company names (optional, Phase 3+)
 * @returns {{ icp_match_score: number, icp_tier: 'hot'|'warm'|'unscored' }}
 */
export function scoreLinkedInConnection(row, options = {}) {
  let score = 0;
  const titleLower   = (row.title   || '').toLowerCase();
  const companyLower = (row.company || '').toLowerCase();

  // ── Signal 1: Title seniority (max 40 pts) ──────────────────
  if (SENIOR_TITLES.some(t => titleLower.includes(t))) {
    score += 40;
  } else if (MID_TITLES.some(t => titleLower.includes(t))) {
    score += 25;
  } else if (JUNIOR_TITLES.some(t => titleLower.includes(t))) {
    score += 10;
  }

  // ── Signal 2: Company name match (max 60 pts) ────────────────
  // Requires targetCompanies list from user's ICP profile.
  // Phase 3 addition — currently returns 0 if no list provided.
  const { targetCompanies = [] } = options;
  if (targetCompanies.length > 0 && companyLower) {
    const matched = targetCompanies.some(tc =>
      companyLower.includes(tc.toLowerCase()) ||
      tc.toLowerCase().includes(companyLower)
    );
    if (matched) score += 60;
  }

  const icp_match_score = Math.min(score, 100);
  const icp_tier =
    icp_match_score >= 85 ? 'hot' :
    icp_match_score >= 65 ? 'warm' :
    'unscored';

  return { icp_match_score, icp_tier };
}
