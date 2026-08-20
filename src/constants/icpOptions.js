// Module 4: ICP Builder - Predefined Options
// Required Assets: Industries, Company Sizes, Titles, Territories

export const INDUSTRIES = [
  'SaaS',
  'Financial Services',
  'Healthcare',
  'E-commerce',
  'Manufacturing',
  'Retail',
  'Technology',
  'Professional Services',
  'Education',
  'Real Estate',
  'Marketing & Advertising',
  'Telecommunications',
  'Transportation & Logistics',
  'Energy & Utilities',
  'Media & Entertainment',
  'Insurance',
  'Hospitality',
  'Construction',
  'Pharmaceuticals',
  'Automotive',
  'Agriculture',
  'Legal Services',
  'Non-Profit',
  'Government',
  'Other'
];

/**
 * DATA-1 — one targeting-size vocabulary for new writes.
 *
 * This used to be its own coarse set — '11-50', '51-200', '201-1000', '1000+' —
 * none of which Apollo accepts as an employee range. The conversational path
 * validated against the canonical eleven buckets and would have rejected every
 * one of them, so the same user could produce a targeting value in the editor
 * that Barry would have refused in conversation.
 *
 * It now re-exports the canonical vocabulary. Newly created or edited targeting
 * definitions therefore speak the same language as D7, T-1 and the Apollo query.
 *
 * Values already stored under the coarse set are NOT migrated and NOT
 * reinterpreted on read — see DATA-1 in the debt register. Nothing in this
 * repository converts them, and this change does not begin to.
 */
export { COMPANY_SIZE_OPTIONS as COMPANY_SIZES } from './targetingCanon.js';

export const TARGET_TITLES = [
  'CEO',
  'Founder',
  'Co-Founder',
  'President',
  'VP Sales',
  'VP Marketing',
  'VP Operations',
  'VP Finance',
  'Chief Revenue Officer',
  'Chief Marketing Officer',
  'Chief Operating Officer',
  'Chief Financial Officer',
  'Director of Sales',
  'Director of Marketing',
  'Director of Operations',
  'Sales Manager',
  'Marketing Manager',
  'Business Development Manager',
  'Account Executive',
  'Head of Growth',
  'Head of Business Development',
  'Partner',
  'Owner',
  'General Manager',
  'Other'
];

export const TERRITORIES = [
  'United States',
  'Canada',
  'United Kingdom',
  'European Union',
  'Germany',
  'France',
  'Australia',
  'New Zealand',
  'Japan',
  'Singapore',
  'India',
  'Mexico',
  'Brazil',
  'South Africa',
  'Global'
];
