/**
 * companyDisplay.js — shared presentation helpers for company records.
 *
 * Single source of truth for logic that would otherwise be duplicated between
 * the Mission Control desktop table and the mobile card view, so the two
 * presentations can never diverge on thresholds or field fallbacks:
 *
 *   - getFitTier(score)      → { label, color }  (fit-score → tier)
 *   - getCompanyName(company)→ display name       (fallback chain)
 *   - getMatchReasons(company) → reasons array     (fallback chain)
 *
 * Presentation only — no data fetching, no scoring, no side effects.
 */
import { STATUS } from '../theme/tokens';

// Fit-tier thresholds — carried over verbatim from the desktop table's FitBadge
// (≥75 green, ≥50 amber, else grey). The grey '#888' is preserved exactly so
// FitBadge's rendered output stays byte-identical; STATUS has no grey token.
export function getFitTier(score) {
  const s = Math.round(score || 0);
  if (s >= 75) return { label: 'Strong Fit', color: STATUS.green };
  if (s >= 50) return { label: 'Good Fit', color: STATUS.amber };
  return { label: 'Low Fit', color: '#888' };
}

// Company display name — the same fallback chain the desktop table uses inline.
export function getCompanyName(company) {
  return (company && (company.name || company.company_name)) || 'Unknown';
}

// Match reasons — the same fallback chain the desktop table uses inline.
export function getMatchReasons(company) {
  if (!company) return [];
  return company.fit_reasons || company.matchReasons || company.match_reasons || [];
}
