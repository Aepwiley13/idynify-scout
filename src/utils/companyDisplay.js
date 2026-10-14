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
 *   - getDisplayIndustry(company) → canonical industry name for display
 *   - getDisplayName(company) → { label, hint, derived } (name provenance)
 *   - isMissingValue(value)  → true for null/empty/"null"/"unknown"/"n/a"
 *   - getDisplayBarryIntel(company) → Barry text safe to show as evidence
 *
 * Presentation only — no data fetching, no scoring, no side effects.
 */
import { STATUS } from '../theme/tokens';
import { normalizeIndustry } from './normalizeTargeting.js';
import { isMissingValue } from './missingValue.js';
// The sentinel and the domain read both come from the identity module rather
// than being restated here. Re-deriving either in a second place is the exact
// drift companyIdentityService exists to prevent — a presentational copy that
// disagreed about which names are guesses would be just as wrong as a second
// dedup query.
import { NAME_SOURCE, enrichmentSignals } from '../services/companyIdentityService';

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

export { isMissingValue };

export const VERIFICATION_NEEDED_MESSAGE =
  'Potential match based on discovery criteria. Company details still need verification.';

// Discovery used to append "Matches your ICP criteria: …" built from the ICP's
// own settings (always as the last sentence), and to call an industry-less
// company "a this sector company".
// Neither was evidence about the company. Those records are still stored, so
// the claim is removed when shown rather than presented as fact.
const LEGACY_ICP_CLAIM = /\s*Matches your ICP criteria:[\s\S]*$/i;
const LEGACY_SECTOR_FILLER = / is a this sector company/i;

export function getDisplayBarryIntel(company) {
  if (!company) return null;
  const raw = company.barry_intel || company.barry_context || company.barryIntel;
  if (isMissingValue(raw) || typeof raw !== 'string') return null;
  if (!LEGACY_ICP_CLAIM.test(raw) && !LEGACY_SECTOR_FILLER.test(raw)) return raw;
  const cleaned = raw.replace(LEGACY_ICP_CLAIM, '').replace(LEGACY_SECTOR_FILLER, '').trim();
  if (cleaned.includes(VERIFICATION_NEEDED_MESSAGE)) return cleaned;
  return cleaned ? `${cleaned} ${VERIFICATION_NEEDED_MESSAGE}` : VERIFICATION_NEEDED_MESSAGE;
}

// Industry display name — resolves non-canonical values (e.g. "saas") to
// Apollo canonical names (e.g. "Computer Software") via the alias map.
// Falls through to the raw value when no mapping exists.
export function getDisplayIndustry(company, fallback = 'N/A') {
  if (!company) return fallback;
  const raw = [
    company.apolloEnrichment?.snapshot?.industry,
    company.industry,
    company.primary_industry,
    company.company_industry,
  ].find(v => typeof v === 'string' && !isMissingValue(v));
  if (!raw) return fallback;
  const result = normalizeIndustry(raw);
  return result.status === 'matched' ? result.value : raw;
}

/**
 * How a company's name should be presented, given where the name came from.
 *
 * A company created by `ensureCompanyForContact` from a work-email domain alone
 * carries `name_source: 'email_domain'` and a name that is a GUESS:
 * `rd-advantage.com` becomes "Rd Advantage" where the organization writes
 * itself "R&D Advantage", and `blackdesertresort.com` becomes
 * "Blackdesertresort". Enrichment corrects those names, but only once someone
 * opens that company — so until then the guess sits in Saved Companies looking
 * exactly as authoritative as a name Apollo confirmed.
 *
 * This surfaces the distinction instead of hiding it: the DOMAIN leads, because
 * the domain is the part that is actually known, and the guess trails it muted.
 * A name from Apollo or typed by a user is returned unchanged.
 *
 * A company with no `name_source` at all is treated as authoritative. Every
 * company written before the field existed lacks it, and muting all of them
 * would be far worse than leaving a handful of guesses unmarked.
 *
 * `fallback` is the caller's own empty-state wording — SharedCompaniesView says
 * "Unnamed Company" where the Scout surfaces say "Unknown", and this must not
 * quietly reword either.
 *
 * @returns {{label: string, hint: string|null, derived: boolean}}
 *   label   — what to render as the company's name
 *   hint    — the unconfirmed guess, to render muted beside it (null if none)
 *   derived — whether the stored name is an unconfirmed guess
 */
export function getDisplayName(company, fallback = 'Unknown') {
  const name = (company && (company.name || company.company_name)) || fallback;
  if (!company || company.name_source !== NAME_SOURCE.EMAIL_DOMAIN) {
    return { label: name, hint: null, derived: false };
  }

  // Derived, but nothing better to lead with — Apollo may simply not have this
  // domain. Still flagged so the caller can mark it as unconfirmed.
  const { domain } = enrichmentSignals(company);
  if (!domain || domain === name) return { label: name, hint: null, derived: true };

  return { label: domain, hint: name, derived: true };
}
