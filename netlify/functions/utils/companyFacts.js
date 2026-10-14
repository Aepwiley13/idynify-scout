/**
 * Company facts — what we actually know about a company, from Apollo, and the
 * Barry text that states it. Shared by discovery (search-companies) and
 * enrichment (enrichCompany) so both build company data by the same rules:
 * only values Apollo returned, never placeholders, never the ICP's criteria.
 */

// Strings that stand in for a missing value. Apollo, and older writes of ours,
// produce them; none of them is a fact about the company.
const PLACEHOLDER_VALUES = new Set(['null', 'undefined', 'unknown', 'unknown industry', 'n/a', 'na', 'none', '-', '—']);

export function realString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || PLACEHOLDER_VALUES.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

/**
 * Revenue as a display string. Search returns organization_revenue[_printed];
 * organizations/enrich returns annual_revenue[_printed].
 */
export function realRevenue(company) {
  const printed = realString(company.organization_revenue_printed) || realString(company.annual_revenue_printed);
  if (printed) return printed;
  const amount = company.organization_revenue || company.annual_revenue;
  return typeof amount === 'number' && amount > 0 ? `$${(amount / 1000000).toFixed(1)}M` : null;
}

export function realCount(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const n = parseInt(value.trim(), 10);
    return n > 0 ? n : null;
  }
  return null;
}

/**
 * The company attributes Apollo actually returned for this organization —
 * industry, employee count, HQ — and nothing else. A field Apollo did not
 * send is absent from the result, never filled in. In particular nothing here
 * reads the ICP: the ICP is what the user is looking for, not evidence of
 * what this company is.
 */
export function extractVerifiedCompanyFields(company) {
  const fields = {};

  const industry = realString(company.industry) || realString(company.primary_industry);
  if (industry) fields.industry = industry;

  const employeeCount = realCount(company.estimated_num_employees);
  if (employeeCount) fields.employee_count = employeeCount;

  const city = realString(company.city) || realString(company.primary_location?.city);
  const state = realString(company.state) || realString(company.primary_location?.state);
  const country = realString(company.country) || realString(company.primary_location?.country);
  if (state) fields.state = state;
  const hq = [city, state, country].filter(Boolean).join(', ');
  if (hq) fields.hq_location = hq;

  return fields;
}

export const VERIFICATION_NEEDED_MESSAGE =
  'Potential match based on discovery criteria. Company details still need verification.';

/**
 * A factual Barry intel summary built only from what Apollo returned for this
 * company. Rule-based, so it runs inline without latency cost.
 *
 * It states facts and never claims a match: a company reaches Scout because it
 * satisfied the search, which is not evidence that it matches the ICP. Match
 * claims belong to the scorer, which only makes them from company data. When
 * industry, size or HQ is unknown it says so rather than assuming.
 */
export function buildBarryIntel(company) {
  const name = realString(company.name) || 'This company';
  const verified = extractVerifiedCompanyFields(company);

  const facts = [];
  if (verified.employee_count) facts.push(`about ${verified.employee_count.toLocaleString('en-US')} employees`);
  if (verified.hq_location) facts.push(`headquartered in ${verified.hq_location}`);
  if (company.founded_year) {
    const age = new Date().getFullYear() - company.founded_year;
    facts.push(`founded in ${company.founded_year} (${age}y old)`);
  }
  const revenue = realRevenue(company);
  if (revenue) facts.push(`${revenue} in revenue`);

  let summary = verified.industry ? `${name} is a ${verified.industry} company` : name;
  if (facts.length > 0) summary += `${verified.industry ? ',' : ':'} ${facts.join(', ')}`;
  summary += '.';
  if (!verified.industry && facts.length === 0) summary = '';

  const complete = verified.industry && verified.employee_count && verified.hq_location;
  if (!complete) summary = summary ? `${summary} ${VERIFICATION_NEEDED_MESSAGE}` : VERIFICATION_NEEDED_MESSAGE;

  return summary;
}

/**
 * The top-level company fields enrichment may fill, from an Apollo
 * organization. Only values Apollo returned; an absent value is absent here.
 * `location` mirrors `hq_location` because older readers (and scoring's state
 * lookup) read `location`.
 */
export function canonicalCompanyFields(org) {
  const fields = { ...extractVerifiedCompanyFields(org) };
  if (fields.hq_location) fields.location = fields.hq_location;

  const domain = realString(org.primary_domain);
  if (domain) fields.domain = domain;
  const website = realString(org.website_url) || (domain ? `https://${domain}` : null);
  if (website) fields.website_url = website;
  const linkedin = realString(org.linkedin_url);
  if (linkedin) fields.linkedin_url = linkedin;
  const logo = realString(org.logo_url);
  if (logo) fields.logo_url = logo;
  const founded = realCount(org.founded_year);
  if (founded) fields.founded_year = founded;
  const revenue = realRevenue(org);
  if (revenue) fields.revenue = revenue;

  return fields;
}
