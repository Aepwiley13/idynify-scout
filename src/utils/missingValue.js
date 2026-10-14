/**
 * Whether a stored company value is a stand-in for "we don't know".
 *
 * Discovery once stored a missing industry as the literal string "null", and
 * other sources write "Unknown", "N/A" or a blank. None of them is a fact about
 * the company, so displays must not show them and enrichment must be free to
 * replace them. Shared by companyDisplay and companyIdentityService, which
 * cannot import each other.
 */
const PLACEHOLDER_VALUES = new Set(['null', 'undefined', 'unknown', 'unknown industry', 'n/a', 'na', 'none', '-', '—']);

export function isMissingValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number') return !Number.isFinite(value);
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return !trimmed || PLACEHOLDER_VALUES.has(trimmed.toLowerCase());
}
