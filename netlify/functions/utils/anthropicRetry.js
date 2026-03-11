/**
 * Retry wrapper for Anthropic API calls.
 * Handles 529 "overloaded_error" responses with exponential backoff.
 */

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 2000;

/**
 * Calls anthropic.messages.create with automatic retry on 529 overloaded errors.
 * @param {import('@anthropic-ai/sdk').Anthropic} anthropic - Initialized Anthropic client
 * @param {object} params - Parameters passed to anthropic.messages.create
 * @returns {Promise<object>} Claude API response
 */
export async function createMessageWithRetry(anthropic, params) {
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await anthropic.messages.create(params);
    } catch (error) {
      lastError = error;

      const isOverloaded =
        error?.status === 529 ||
        error?.error?.type === 'overloaded_error' ||
        (error?.message && error.message.includes('overloaded_error'));

      if (!isOverloaded || attempt === MAX_RETRIES) {
        throw error;
      }

      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `⚠️ Anthropic API overloaded (attempt ${attempt + 1}/${MAX_RETRIES + 1}). Retrying in ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
