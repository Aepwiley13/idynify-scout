/**
 * ICP Scoring Utility
 * Calculates weighted fit scores for companies based on the user's active ICP.
 *
 * Scoring model (fixes the "every company is 0 or 50" bug):
 *   - Reads the field names companies actually carry, with fallbacks, and
 *     accepts employee size as either a numeric count or a range string.
 *   - Each dimension resolves to 100 (match), 50 (partial / unknown data), or
 *     0 (definite miss).
 *   - The weighted average is normalized over the dimensions the ICP actually
 *     configures, so an unconfigured dimension never drags every company down
 *     to a uniform default. A company matching every configured criterion
 *     scores ~100; a partial match lands in the 60-80 band; a weak match falls
 *     below 50.
 *
 * Per-dimension `match` values are intentionally kept in {0, 50, 100} so the
 * existing score-breakdown tooltips (MissionControl, DailyLeads) keep working.
 */

/**
 * Default ICP scoring weights (must total 100%)
 */
export const DEFAULT_WEIGHTS = {
  industry: 50,
  location: 25,
  employeeSize: 15,
  revenue: 10
};

// Neutral score for a configured dimension we simply have no company data for.
// Not a miss (0) and not a confirmed match (100) — genuine uncertainty.
const UNKNOWN = 50;

/**
 * Company size ranges for matching
 */
const COMPANY_SIZE_RANGES = [
  "1-10", "11-20", "21-50", "51-100", "101-200", "201-500",
  "501-1,000", "1,001-2,000", "2,001-5,000", "5,001-10,000", "10,001+"
];

/**
 * Revenue ranges for matching
 */
const REVENUE_RANGES = [
  "Less than $1M", "$1M-$2M", "$2M-$5M", "$5M-$10M", "$10M-$20M",
  "$20M-$50M", "$50M-$100M", "$100M-$200M", "$200M-$500M", "$500M-$1B", "$1B+"
];

// ─── Field resolution helpers ───────────────────────────────────────────────
// Company docs are written by several paths (Apollo discovery, enrichment,
// LinkedIn import) with inconsistent field names. Resolve each dimension from
// whatever is present rather than assuming one canonical name.

/** Company's industry, across the known field names. */
function resolveIndustry(company) {
  const v = company.industry || company.primary_industry || company.company_industry;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Company's state/location, across the known field names. */
function resolveState(company) {
  const raw =
    company.state ||
    company.location ||
    company.headquarters_location ||
    company.hq_location ||
    null;
  return extractStateFromLocation(raw);
}

/** Company's employee count as a number, from a numeric field or a range string. */
function resolveEmployeeCount(company) {
  const numeric =
    company.employee_count ??
    company.estimated_num_employees ??
    company.employeeCount ??
    company.num_employees;
  if (typeof numeric === 'number' && numeric > 0) return numeric;
  if (typeof numeric === 'string' && /^\d+$/.test(numeric.trim())) {
    return parseInt(numeric.trim(), 10);
  }

  // Fall back to a range string ("101-200 employees", "51-100", "10,001+").
  const rangeStr = company.company_size || company.employee_range || company.size;
  const parsed = parseSizeRange(rangeStr);
  if (!parsed) return null;
  return parsed.max === Infinity ? parsed.min : Math.round((parsed.min + parsed.max) / 2);
}

/** Company's revenue value, across the known field names. */
function resolveRevenue(company) {
  const v = company.revenue_range || company.revenue || company.annual_revenue;
  return v != null && v !== '' ? v : null;
}

/**
 * Parse a size range label into { min, max } (max = Infinity for "N+").
 * Tolerates commas and a trailing " employees".
 */
function parseSizeRange(rangeStr) {
  if (rangeStr == null) return null;
  const cleaned = String(rangeStr).replace(/employees/i, '').replace(/,/g, '').trim();
  if (!cleaned) return null;

  if (cleaned.includes('+')) {
    const min = parseInt(cleaned, 10);
    return Number.isNaN(min) ? null : { min, max: Infinity };
  }

  const [minStr, maxStr] = cleaned.split('-');
  const min = parseInt(minStr, 10);
  if (Number.isNaN(min)) return null;
  const max = maxStr != null ? parseInt(maxStr, 10) : min;
  return { min, max: Number.isNaN(max) ? min : max };
}

/** Which COMPANY_SIZE_RANGES bucket a raw employee count falls into (-1 if none). */
function bucketIndexForCount(count) {
  return COMPANY_SIZE_RANGES.findIndex((range) => {
    const parsed = parseSizeRange(range);
    return parsed && count >= parsed.min && count <= parsed.max;
  });
}

/**
 * Extract a state/region token from a location string.
 * "Austin, TX" → "TX"; "TX, USA" → "TX"; "California" → "California".
 */
export function extractStateFromLocation(location) {
  if (!location) return null;
  if (typeof location === 'object') {
    return location.state || location.region || location.city || null;
  }
  if (typeof location !== 'string' || !location.trim()) return null;

  const parts = location.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    if (/^(usa|united states|us)$/i.test(parts[parts.length - 1])) {
      return parts[parts.length - 2];
    }
    return parts[1];
  }
  return parts[0] || null;
}

/** Parse a dollar figure ("$5M", "$1.2B", "5000000") into a number, or null. */
function parseRevenueToNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const m = value.replace(/[$,\s]/g, '').match(/([\d.]+)\s*([kmb])?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  const unit = (m[2] || '').toLowerCase();
  const mult = unit === 'b' ? 1e9 : unit === 'm' ? 1e6 : unit === 'k' ? 1e3 : 1;
  return n * mult;
}

// ─── Per-dimension evaluation ───────────────────────────────────────────────
// Each returns { active, match, value, matchedCriterion }:
//   active  = the ICP configures this dimension (participates in the score)
//   match   = 100 | 50 | 0  (50 = partial or unknown data)
//   value   = the company's value, for display in reasons
//   matchedCriterion = the ICP label that matched, for nicely-cased reasons

function evalIndustry(company, icp) {
  const icpIndustries = icp.industries || [];
  if (icpIndustries.length === 0) return { active: false, match: 0 };

  const industry = resolveIndustry(company);
  if (!industry) return { active: true, match: UNKNOWN, unknown: true };

  const norm = industry.toLowerCase().trim();

  // Exact (case-insensitive) match.
  const exact = icpIndustries.find((i) => i.toLowerCase().trim() === norm);
  if (exact) return { active: true, match: 100, value: industry, matchedCriterion: exact };

  // Partial: token overlap in either direction ("Credit Unions" vs "Banking & Credit Unions").
  const related = icpIndustries.find((i) => {
    const other = i.toLowerCase().trim();
    return other.includes(norm) || norm.includes(other) || shareSignificantToken(norm, other);
  });
  if (related) return { active: true, match: 50, value: industry, matchedCriterion: related };

  return { active: true, match: 0, value: industry };
}

function evalLocation(company, icp) {
  const configured = icp.isNationwide || (icp.locations || []).length > 0;
  if (!configured) return { active: false, match: 0 };

  if (icp.isNationwide) return { active: true, match: 100, value: 'Nationwide', nationwide: true };

  const state = resolveState(company);
  if (!state) return { active: true, match: UNKNOWN, unknown: true };

  const norm = String(state).toLowerCase().trim();
  const hit = (icp.locations || []).some((l) => String(l).toLowerCase().trim() === norm);
  return hit
    ? { active: true, match: 100, value: state }
    : { active: true, match: 0, value: state };
}

function evalEmployeeSize(company, icp) {
  const icpSizes = icp.companySizes || [];
  if (icpSizes.length === 0) return { active: false, match: 0 };

  const count = resolveEmployeeCount(company);
  if (count == null) return { active: true, match: UNKNOWN, unknown: true };

  const companyBucket = bucketIndexForCount(count);
  const icpBuckets = icpSizes
    .map((s) => COMPANY_SIZE_RANGES.findIndex((r) => r === s))
    .filter((i) => i !== -1);

  const label = companyBucket !== -1 ? COMPANY_SIZE_RANGES[companyBucket] : String(count);

  if (companyBucket === -1 || icpBuckets.length === 0) {
    return { active: true, match: UNKNOWN, unknown: true, value: label };
  }
  if (icpBuckets.includes(companyBucket)) {
    return { active: true, match: 100, value: label };
  }
  // Adjacent bucket = partial.
  if (icpBuckets.some((i) => Math.abs(i - companyBucket) === 1)) {
    return { active: true, match: 50, value: label };
  }
  return { active: true, match: 0, value: label };
}

function evalRevenue(company, icp) {
  const icpRevenues = icp.revenueRanges || [];
  if (icpRevenues.length === 0 || icp.skipRevenue) return { active: false, match: 0 };

  const revenue = resolveRevenue(company);
  if (!revenue) return { active: true, match: UNKNOWN, unknown: true };

  // Exact label match against configured ranges.
  if (icpRevenues.includes(revenue)) return { active: true, match: 100, value: revenue };

  // Adjacent labeled range (by REVENUE_RANGES index).
  const companyIndex = REVENUE_RANGES.findIndex((r) => r === revenue);
  if (companyIndex !== -1) {
    const icpIndexes = icpRevenues.map((r) => REVENUE_RANGES.indexOf(r)).filter((i) => i !== -1);
    if (icpIndexes.includes(companyIndex)) return { active: true, match: 100, value: revenue };
    if (icpIndexes.some((i) => Math.abs(i - companyIndex) === 1)) {
      return { active: true, match: 50, value: revenue };
    }
    return { active: true, match: 0, value: revenue };
  }

  // Company revenue is a raw figure ("$5M") — test numeric containment in any range.
  const amount = parseRevenueToNumber(revenue);
  if (amount != null) {
    for (const label of icpRevenues) {
      const bounds = revenueLabelBounds(label);
      if (bounds && amount >= bounds.min && amount <= bounds.max) {
        return { active: true, match: 100, value: revenue };
      }
    }
    return { active: true, match: 0, value: revenue };
  }

  return { active: true, match: UNKNOWN, unknown: true, value: revenue };
}

/** Numeric bounds for a REVENUE_RANGES label, or null. */
function revenueLabelBounds(label) {
  if (!label) return null;
  if (/less than/i.test(label)) {
    const max = parseRevenueToNumber(label.replace(/less than/i, ''));
    return max != null ? { min: 0, max } : null;
  }
  if (label.includes('+')) {
    const min = parseRevenueToNumber(label);
    return min != null ? { min, max: Infinity } : null;
  }
  const [minStr, maxStr] = label.split('-');
  const min = parseRevenueToNumber(minStr);
  const max = parseRevenueToNumber(maxStr);
  if (min == null || max == null) return null;
  return { min, max };
}

/** Do two industry strings share a meaningful (4+ char, non-stopword) token? */
function shareSignificantToken(a, b) {
  const stop = new Set(['and', 'the', 'for', 'services', 'solutions', 'company', 'group']);
  const tokensA = a.split(/[^a-z0-9]+/i).filter((t) => t.length >= 4 && !stop.has(t));
  const tokensB = new Set(b.split(/[^a-z0-9]+/i).filter((t) => t.length >= 4 && !stop.has(t)));
  return tokensA.some((t) => tokensB.has(t));
}

/**
 * Evaluate all four dimensions for a company against an ICP.
 * @returns {{ industry, location, employeeSize, revenue }} per-dimension results
 */
function evaluateDimensions(company, icpProfile) {
  return {
    industry: evalIndustry(company, icpProfile),
    location: evalLocation(company, icpProfile),
    employeeSize: evalEmployeeSize(company, icpProfile),
    revenue: evalRevenue(company, icpProfile)
  };
}

// ─── Public scoring API ─────────────────────────────────────────────────────

/**
 * Calculate overall ICP fit score for a company.
 * Normalized over the dimensions the ICP actually configures.
 * @param {Object} company - Company data
 * @param {Object} icpProfile - Active ICP profile
 * @param {Object} weights - Scoring weights (default: DEFAULT_WEIGHTS)
 * @returns {number} Fit score 0-100
 */
export function calculateICPScore(company, icpProfile, weights = DEFAULT_WEIGHTS) {
  if (!company || !icpProfile) return 0;

  const dims = evaluateDimensions(company, icpProfile);

  let weightedSum = 0;
  let activeWeight = 0;
  for (const key of ['industry', 'location', 'employeeSize', 'revenue']) {
    const dim = dims[key];
    if (!dim.active) continue;
    weightedSum += dim.match * (weights[key] || 0);
    activeWeight += weights[key] || 0;
  }

  // No configured criteria → nothing to score against; return a neutral 50
  // rather than a misleading 0 so the UI shows "moderate, unscored".
  if (activeWeight === 0) return UNKNOWN;

  return Math.round(weightedSum / activeWeight);
}

/**
 * Build a specific, per-company "why it's a match" reason from the ICP criteria
 * the company actually matches — e.g. "Matches your target industry (Credit
 * Unions) and company size (101-200)."
 * @param {Object} company
 * @param {Object} icpProfile
 * @returns {string}
 */
export function generateMatchReason(company, icpProfile) {
  if (!company || !icpProfile) return 'No ICP configured to assess fit.';

  const dims = evaluateDimensions(company, icpProfile);

  const strong = [];
  if (dims.industry.active && dims.industry.match === 100) {
    strong.push(`your target industry (${titleCase(dims.industry.matchedCriterion || dims.industry.value)})`);
  }
  if (dims.employeeSize.active && dims.employeeSize.match === 100) {
    strong.push(`company size (${dims.employeeSize.value})`);
  }
  if (dims.location.active && dims.location.match === 100 && !dims.location.nationwide) {
    strong.push(`location (${dims.location.value})`);
  }
  if (dims.revenue.active && dims.revenue.match === 100) {
    strong.push(`revenue range (${dims.revenue.value})`);
  }
  if (strong.length > 0) {
    return `Matches ${joinWithAnd(strong)}.`;
  }

  // No confirmed matches — describe the strongest partial signal honestly.
  const partial = [];
  if (dims.industry.active && dims.industry.match === 50 && dims.industry.value) {
    partial.push(`a related industry (${titleCase(dims.industry.value)})`);
  }
  if (dims.employeeSize.active && dims.employeeSize.match === 50 && dims.employeeSize.value) {
    partial.push(`a near-fit company size (${dims.employeeSize.value})`);
  }
  if (partial.length > 0) {
    return `Partial ICP fit: ${joinWithAnd(partial)}.`;
  }

  // A clear industry miss is the most useful "why not".
  if (dims.industry.active && dims.industry.match === 0 && dims.industry.value) {
    return `Outside your target industries (${titleCase(dims.industry.value)}) — weak ICP fit.`;
  }

  return 'Limited company data available to assess ICP fit.';
}

/**
 * Convenience: score a company and its reason in one call.
 * @returns {{ score: number, reason: string, breakdown: Object }}
 */
export function scoreCompany(company, icpProfile, weights = DEFAULT_WEIGHTS) {
  return {
    score: calculateICPScore(company, icpProfile, weights),
    reason: generateMatchReason(company, icpProfile),
    breakdown: getScoreBreakdown(company, icpProfile, weights)
  };
}

/**
 * Generic numeric range match — used for any post-fetch numeric ICP filter.
 * Returns 100 (pass) or 0 (fail). Unknown values (null/undefined) always pass through.
 */
export function calculateNumericRangeMatch(value, range) {
  if (!range || (range.min === null && range.max === null)) return 100; // not configured
  if (value === null || value === undefined) return 100; // unknown = pass through
  if (range.min !== null && value < range.min) return 0;
  if (range.max !== null && value > range.max) return 0;
  return 100;
}

/**
 * Gate function: returns true only if the company passes all active post-fetch range filters.
 */
export function passesAllFilters(company, icpProfile) {
  if (!icpProfile) return true;

  if (icpProfile.foundedAgeRange) {
    const currentYear = new Date().getFullYear();
    const { minAge, maxAge } = icpProfile.foundedAgeRange;
    const minYear = maxAge !== null && maxAge !== undefined ? currentYear - maxAge : null;
    const maxYear = minAge !== null && minAge !== undefined ? currentYear - minAge : null;
    if (calculateNumericRangeMatch(company.founded_year, { min: minYear, max: maxYear }) === 0) {
      return false;
    }
  }

  return true;
}

/**
 * Validate that weights total 100%
 */
export function validateWeights(weights) {
  const total = weights.industry + weights.location + weights.employeeSize + weights.revenue;
  return total === 100;
}

/**
 * Get breakdown of score components (for debugging/display).
 * Per-dimension `match` stays in {0, 50, 100} for the tooltip consumers.
 */
export function getScoreBreakdown(company, icpProfile, weights = DEFAULT_WEIGHTS) {
  const dims = (company && icpProfile)
    ? evaluateDimensions(company, icpProfile)
    : { industry: { match: 0 }, location: { match: 0 }, employeeSize: { match: 0 }, revenue: { match: 0 } };

  const row = (key) => ({
    match: dims[key].match,
    weight: weights[key],
    contribution: Math.round(dims[key].match * (weights[key] / 100))
  });

  return {
    industry: row('industry'),
    location: row('location'),
    employeeSize: row('employeeSize'),
    revenue: row('revenue'),
    totalScore: calculateICPScore(company, icpProfile, weights)
  };
}

// ─── Small formatting helpers ───────────────────────────────────────────────

function joinWithAnd(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function titleCase(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}
