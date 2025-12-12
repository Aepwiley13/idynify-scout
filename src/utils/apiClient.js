// Module 3: Environment & API Setup
// API Client Helper Utilities

/**
 * Call a Netlify serverless function
 *
 * @param {string} functionName - Name of the Netlify function (without .js extension)
 * @param {Object} data - Data to send to the function
 * @param {string} method - HTTP method (default: 'POST')
 * @returns {Promise<Object>} - Response data from the function
 * @throws {Error} - Throws error if request fails
 */
export async function callNetlifyFunction(functionName, data = {}, method = 'POST') {
  try {
    const response = await fetch(`/.netlify/functions/${functionName}`, {
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: method !== 'GET' ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message ||
        errorData.error ||
        `Function ${functionName} failed with status ${response.status}`
      );
    }

    return await response.json();
  } catch (error) {
    console.error(`Error calling Netlify function ${functionName}:`, error);
    throw error;
  }
}

/**
 * Handle API errors consistently across the application
 *
 * @param {Error} error - The error object
 * @param {string} context - Context where the error occurred (for logging)
 * @returns {Object} - Formatted error object for UI display
 */
export function handleAPIError(error, context = 'API call') {
  console.error(`${context} error:`, error);

  // Check for specific error types
  if (error.message?.includes('quota_exceeded')) {
    return {
      type: 'quota_exceeded',
      message: 'You have reached your enrichment quota. Please upgrade to continue.',
      userMessage: 'Quota exceeded',
    };
  }

  if (error.message?.includes('unauthorized')) {
    return {
      type: 'unauthorized',
      message: 'You are not authorized to perform this action.',
      userMessage: 'Unauthorized',
    };
  }

  if (error.message?.includes('not found')) {
    return {
      type: 'not_found',
      message: 'The requested resource was not found.',
      userMessage: 'Not found',
    };
  }

  // Generic error
  return {
    type: 'generic',
    message: error.message || 'An unexpected error occurred. Please try again.',
    userMessage: 'Error',
  };
}

/**
 * Retry a function call with exponential backoff
 *
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @param {number} baseDelay - Base delay in ms (default: 1000)
 * @returns {Promise<any>} - Result of the function call
 */
export async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on client errors (4xx)
      if (error.message?.includes('status 4')) {
        throw error;
      }

      if (i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        console.log(`Retry attempt ${i + 1}/${maxRetries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
