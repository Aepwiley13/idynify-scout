/**
 * Contact matching types for the inbound message waterfall.
 *
 * @typedef {"exact_primary_email" | "exact_secondary_email" | "thread_linked_contact" |
 *           "communication_record_linked" | "alias_match" |
 *           "name_company_suggestion" | "unmatched"} MatchMethod
 *
 * @typedef {"HIGH" | "MEDIUM" | "LOW" | "NONE"} MatchConfidence
 *
 * @typedef {Object} ContactMatchResult
 * @property {string|null} contactId
 * @property {string|null} companyId
 * @property {MatchMethod} matchMethod
 * @property {MatchConfidence} matchConfidence
 * @property {boolean} matchedAutomatically
 * @property {boolean} requiresReview
 * @property {string|null} reviewReason
 * @property {string[]} candidateContactIds
 * @property {string} matchedAt - ISO 8601
 */

export const MATCH_METHODS = {
  EXACT_PRIMARY_EMAIL: 'exact_primary_email',
  EXACT_SECONDARY_EMAIL: 'exact_secondary_email',
  THREAD_LINKED_CONTACT: 'thread_linked_contact',
  COMMUNICATION_RECORD_LINKED: 'communication_record_linked',
  ALIAS_MATCH: 'alias_match',
  NAME_COMPANY_SUGGESTION: 'name_company_suggestion',
  UNMATCHED: 'unmatched',
};

export const MATCH_CONFIDENCE = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  NONE: 'NONE',
};

export function createMatchResult(overrides = {}) {
  return {
    contactId: null,
    companyId: null,
    matchMethod: MATCH_METHODS.UNMATCHED,
    matchConfidence: MATCH_CONFIDENCE.NONE,
    matchedAutomatically: false,
    requiresReview: true,
    reviewReason: null,
    candidateContactIds: [],
    matchedAt: new Date().toISOString(),
    ...overrides,
  };
}
