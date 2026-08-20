/**
 * targetingCanon.js — the supported targeting vocabulary, in one place.
 *
 * Three enumerations decide whether a targeting value can reach a company
 * search: Apollo's 147 industry names, the eleven employee-count buckets, and
 * the fifty US state names. Before this module they existed in more than one
 * copy — the industries and states inline in `barryICPConversation` as well as
 * in `src/constants`, and the size buckets only inside that function — so a
 * normalizer written anywhere else had to duplicate them a third time.
 *
 * Duplicated enumerations drift, and the copy that drifts is the one that lets
 * an unsupported value through to a query. Everything that validates or
 * normalizes targeting reads from here.
 *
 * Note on `COMPANY_SIZES` in icpOptions.js: that is a different, coarser set
 * ('1-10' … '1000+') used by the manual ICP editors. It is NOT the same
 * vocabulary and is deliberately not unified here — see the Gate C report.
 */

export { APOLLO_INDUSTRIES } from './apolloIndustries.js';
export { US_STATES } from './usStates.js';

/**
 * Apollo's employee-count buckets, exactly as `organization_num_employees_ranges`
 * expects them. The comma in "501-1,000" is part of the value.
 */
export const COMPANY_SIZE_OPTIONS = [
  '1-10', '11-20', '21-50', '51-100', '101-200', '201-500',
  '501-1,000', '1,001-2,000', '2,001-5,000', '5,001-10,000', '10,001+',
];
