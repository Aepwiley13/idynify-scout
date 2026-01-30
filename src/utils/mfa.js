/**
 * Multi-Factor Authentication (MFA) Utilities
 *
 * Provides TOTP-based MFA enrollment and verification using Firebase Auth.
 * Firebase Auth supports multi-factor authentication with TOTP (Time-based One-Time Password).
 */

import { multiFactor, TotpMultiFactorGenerator, TotpSecret, getMultiFactorResolver } from 'firebase/auth';
import { auth } from '../firebase/config';

/**
 * Check if the current user has MFA enrolled
 * @returns {boolean} True if user has at least one MFA factor enrolled
 */
export function isMfaEnrolled() {
  const user = auth.currentUser;
  if (!user) return false;
  const enrolledFactors = multiFactor(user).enrolledFactors;
  return enrolledFactors.length > 0;
}

/**
 * Get enrolled MFA factors for the current user
 * @returns {Array} List of enrolled factors
 */
export function getEnrolledFactors() {
  const user = auth.currentUser;
  if (!user) return [];
  return multiFactor(user).enrolledFactors;
}

/**
 * Start TOTP MFA enrollment
 * Returns a TOTP secret that can be displayed as a QR code.
 *
 * @returns {Promise<{secret: TotpSecret, totpUri: string, secretKey: string}>}
 */
export async function startTotpEnrollment() {
  const user = auth.currentUser;
  if (!user) throw new Error('User must be signed in to enroll MFA');

  const multiFactorSession = await multiFactor(user).getSession();
  const totpSecret = await TotpMultiFactorGenerator.generateSecret(multiFactorSession);

  // Generate the otpauth:// URI for QR code generation
  const totpUri = totpSecret.generateQrCodeUrl(user.email, 'Idynify Scout');

  return {
    secret: totpSecret,
    totpUri,
    secretKey: totpSecret.secretKey
  };
}

/**
 * Complete TOTP MFA enrollment by verifying the first code
 *
 * @param {TotpSecret} totpSecret - The TOTP secret from startTotpEnrollment
 * @param {string} verificationCode - The 6-digit TOTP code from the authenticator app
 * @param {string} displayName - Optional display name for this factor (default: 'Authenticator App')
 * @returns {Promise<void>}
 */
export async function completeTotpEnrollment(totpSecret, verificationCode, displayName = 'Authenticator App') {
  const user = auth.currentUser;
  if (!user) throw new Error('User must be signed in to enroll MFA');

  const multiFactorAssertion = TotpMultiFactorGenerator.assertionForEnrollment(
    totpSecret,
    verificationCode
  );

  await multiFactor(user).enroll(multiFactorAssertion, displayName);
}

/**
 * Unenroll an MFA factor
 *
 * @param {number} factorIndex - Index of the factor to remove (from getEnrolledFactors)
 * @returns {Promise<void>}
 */
export async function unenrollFactor(factorIndex = 0) {
  const user = auth.currentUser;
  if (!user) throw new Error('User must be signed in to unenroll MFA');

  const factors = multiFactor(user).enrolledFactors;
  if (factorIndex >= factors.length) {
    throw new Error('Invalid factor index');
  }

  await multiFactor(user).unenroll(factors[factorIndex]);
}

/**
 * Handle MFA challenge during sign-in.
 * Call this when signInWithEmailAndPassword throws a MultiFactorError.
 *
 * @param {object} error - The MultiFactorError from Firebase Auth
 * @param {string} verificationCode - The 6-digit TOTP code
 * @returns {Promise<object>} The UserCredential after successful MFA verification
 */
export async function resolveMfaSignIn(error, verificationCode) {
  const resolver = getMultiFactorResolver(auth, error);

  // Find the TOTP factor (first one)
  const totpFactor = resolver.hints.find(
    hint => hint.factorId === TotpMultiFactorGenerator.FACTOR_ID
  );

  if (!totpFactor) {
    throw new Error('No TOTP factor found. Please contact support.');
  }

  const multiFactorAssertion = TotpMultiFactorGenerator.assertionForSignIn(
    totpFactor.uid,
    verificationCode
  );

  return await resolver.resolveSignIn(multiFactorAssertion);
}
