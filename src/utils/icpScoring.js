/**
 * ICP Scoring Utility
 * Calculates weighted fit scores for companies based on ICP criteria
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

/**
 * Calculate industry match percentage
 * @param {string} companyIndustry - Company's industry
 * @param {string[]} icpIndustries - ICP selected industries
 * @returns {number} 0 or 100
 */
function calculateIndustryMatch(companyIndustry, icpIndustries) {
  if (!companyIndustry || !icpIndustries || icpIndustries.length === 0) {
    return 0;
  }

  // Case-insensitive exact match = 100%, else 0
  const normalized = companyIndustry.toLowerCase().trim();
  return icpIndustries.some(i => i.toLowerCase().trim() === normalized) ? 100 : 0;
}

/**
 * Calculate location match percentage
 * @param {string} companyLocation - Company's location/state
 * @param {string[]} icpLocations - ICP selected locations
 * @param {boolean} isNationwide - ICP nationwide setting
 * @returns {number} 0 or 100
 */
function calculateLocationMatch(companyLocation, icpLocations, isNationwide) {
  // If nationwide, all companies match
  if (isNationwide) {
    return 100;
  }

  if (!companyLocation || !icpLocations || icpLocations.length === 0) {
    return 0;
  }

  // Check if company location is in selected states
  return icpLocations.includes(companyLocation) ? 100 : 0;
}

/**
 * Get index of a size/revenue range
 * @param {string} value - Size or revenue range string
 * @param {string[]} ranges - Array of ranges to search
 * @returns {number} Index or -1 if not found
 */
function getRangeIndex(value, ranges) {
  return ranges.findIndex(range => range === value);
}

/**
 * Calculate employee size match percentage
 * @param {string} companySize - Company's employee size range
 * @param {string[]} icpSizes - ICP selected size ranges
 * @returns {number} 0, 50, or 100
 */
function calculateEmployeeSizeMatch(companySize, icpSizes) {
  if (!companySize || !icpSizes || icpSizes.length === 0) {
    return 0;
  }

  // Exact match = 100%
  if (icpSizes.includes(companySize)) {
    return 100;
  }

  // Adjacent range = 50%
  const companyIndex = getRangeIndex(companySize, COMPANY_SIZE_RANGES);
  if (companyIndex === -1) return 0;

  for (const icpSize of icpSizes) {
    const icpIndex = getRangeIndex(icpSize, COMPANY_SIZE_RANGES);
    if (icpIndex === -1) continue;

    // Check if adjacent (difference of 1)
    if (Math.abs(companyIndex - icpIndex) === 1) {
      return 50;
    }
  }

  return 0;
}

/**
 * Calculate revenue match percentage
 * @param {string} companyRevenue - Company's revenue range
 * @param {string[]} icpRevenues - ICP selected revenue ranges
 * @returns {number} 0, 50, or 100
 */
function calculateRevenueMatch(companyRevenue, icpRevenues) {
  if (!companyRevenue || !icpRevenues || icpRevenues.length === 0) {
    return 0;
  }

  // Exact match = 100%
  if (icpRevenues.includes(companyRevenue)) {
    return 100;
  }

  // Adjacent range = 50%
  const companyIndex = getRangeIndex(companyRevenue, REVENUE_RANGES);
  if (companyIndex === -1) return 0;

  for (const icpRevenue of icpRevenues) {
    const icpIndex = getRangeIndex(icpRevenue, REVENUE_RANGES);
    if (icpIndex === -1) continue;

    // Check if adjacent (difference of 1)
    if (Math.abs(companyIndex - icpIndex) === 1) {
      return 50;
    }
  }

  return 0;
}

/**
 * Calculate overall ICP fit score for a company
 * @param {Object} company - Company data
 * @param {Object} icpProfile - ICP profile with criteria
 * @param {Object} weights - Scoring weights (default: DEFAULT_WEIGHTS)
 * @returns {number} Fit score 0-100
 */
export function calculateICPScore(company, icpProfile, weights = DEFAULT_WEIGHTS) {
  if (!company || !icpProfile) {
    return 0;
  }

  // Calculate individual match percentages
  const industryMatch = calculateIndustryMatch(
    company.industry,
    icpProfile.industries || []
  );

  const locationMatch = calculateLocationMatch(
    company.location || company.state,
    icpProfile.locations || [],
    icpProfile.isNationwide || false
  );

  const employeeSizeMatch = calculateEmployeeSizeMatch(
    company.employee_count || company.company_size,
    icpProfile.companySizes || []
  );

  const revenueMatch = calculateRevenueMatch(
    company.revenue,
    icpProfile.revenueRanges || []
  );

  // Calculate weighted score
  const weightedScore = (
    (industryMatch * (weights.industry / 100)) +
    (locationMatch * (weights.location / 100)) +
    (employeeSizeMatch * (weights.employeeSize / 100)) +
    (revenueMatch * (weights.revenue / 100))
  );

  return Math.round(weightedScore);
}

/**
 * Generic numeric range match — used for any post-fetch numeric ICP filter.
 * Returns 100 (pass) or 0 (fail). Unknown values (null/undefined) always pass through.
 * @param {number|null} value - The company's value for this field
 * @param {{ min: number|null, max: number|null }|null} range - The configured range
 * @returns {number} 100 = pass, 0 = fail
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
 * This runs BEFORE scoring. Companies that fail never enter the queue.
 * 90% of users have no foundedAgeRange set — this returns true immediately for them.
 * @param {Object} company - Company data (must have founded_year)
 * @param {Object} icpProfile - ICP profile
 * @returns {boolean}
 */
export function passesAllFilters(company, icpProfile) {
  if (!icpProfile) return true;

  // Founded age filter
  if (icpProfile.foundedAgeRange) {
    const currentYear = new Date().getFullYear();
    const { minAge, maxAge } = icpProfile.foundedAgeRange;
    // Convert age to year range: older company = smaller year
    const minYear = maxAge !== null && maxAge !== undefined ? currentYear - maxAge : null;
    const maxYear = minAge !== null && minAge !== undefined ? currentYear - minAge : null;
    if (calculateNumericRangeMatch(company.founded_year, { min: minYear, max: maxYear }) === 0) {
      return false;
    }
  }

  // Future numeric range filters added here — one block each

  return true;
}

/**
 * Validate that weights total 100%
 * @param {Object} weights - Weights object
 * @returns {boolean} True if valid
 */
export function validateWeights(weights) {
  const total = weights.industry + weights.location + weights.employeeSize + weights.revenue;
  return total === 100;
}

/**
 * Get breakdown of score components (for debugging/display)
 * @param {Object} company - Company data
 * @param {Object} icpProfile - ICP profile
 * @param {Object} weights - Scoring weights
 * @returns {Object} Score breakdown
 */
export function getScoreBreakdown(company, icpProfile, weights = DEFAULT_WEIGHTS) {
  const industryMatch = calculateIndustryMatch(company.industry, icpProfile.industries || []);
  const locationMatch = calculateLocationMatch(
    company.location || company.state,
    icpProfile.locations || [],
    icpProfile.isNationwide || false
  );
  const employeeSizeMatch = calculateEmployeeSizeMatch(
    company.employee_count || company.company_size,
    icpProfile.companySizes || []
  );
  const revenueMatch = calculateRevenueMatch(company.revenue, icpProfile.revenueRanges || []);

  return {
    industry: {
      match: industryMatch,
      weight: weights.industry,
      contribution: Math.round(industryMatch * (weights.industry / 100))
    },
    location: {
      match: locationMatch,
      weight: weights.location,
      contribution: Math.round(locationMatch * (weights.location / 100))
    },
    employeeSize: {
      match: employeeSizeMatch,
      weight: weights.employeeSize,
      contribution: Math.round(employeeSizeMatch * (weights.employeeSize / 100))
    },
    revenue: {
      match: revenueMatch,
      weight: weights.revenue,
      contribution: Math.round(revenueMatch * (weights.revenue / 100))
    },
    totalScore: calculateICPScore(company, icpProfile, weights)
  };
}
