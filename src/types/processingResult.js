/**
 * ProcessingResult — return type of processNormalizedMessage().
 *
 * @typedef {Object} ProcessingResult
 * @property {boolean} success
 * @property {string|null} messageRecordId
 * @property {string|null} timelineEventId
 * @property {import('./contactMatchResult.js').ContactMatchResult|null} contactMatchResult
 * @property {import('./conversationState.js').ConversationState|null} conversationState
 * @property {string|null} relationshipContextId
 * @property {boolean} requiresReview
 * @property {string|null} reviewReason
 * @property {string|null} error
 * @property {number} processingMs
 */

export function createProcessingResult(overrides = {}) {
  return {
    success: false,
    messageRecordId: null,
    timelineEventId: null,
    contactMatchResult: null,
    conversationState: null,
    relationshipContextId: null,
    requiresReview: false,
    reviewReason: null,
    error: null,
    processingMs: 0,
    ...overrides,
  };
}
