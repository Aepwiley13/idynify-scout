/**
 * What the Settings page says for each outcome linkedin-oauth-callback
 * reports in `?linkedin=<outcome>` (OUTCOMES in
 * netlify/functions/utils/linkedinOAuth.js). An unknown outcome shows `error`.
 */
export const LINKEDIN_OUTCOME_MESSAGES = {
  connected: 'LinkedIn connected.',
  denied: 'LinkedIn connection was cancelled. Nothing was changed.',
  missing_code: "LinkedIn didn't return an authorization. Please try again.",
  invalid_state: 'That LinkedIn connection link is not valid or was already used. Please try again.',
  expired_state: 'The LinkedIn connection took too long and expired. Please try again.',
  token_failed: "LinkedIn couldn't complete the connection. Please try again.",
  identity_failed: "We couldn't confirm your LinkedIn identity. Please try again.",
  already_connected: 'This LinkedIn account is already connected to another Idynify user.',
  not_configured: "LinkedIn isn't set up yet. Please contact support.",
  error: 'Something went wrong connecting LinkedIn. Please try again.',
};
