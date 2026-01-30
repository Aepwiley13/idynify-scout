import { useState, useEffect } from 'react';
import {
  isMfaEnrolled,
  getEnrolledFactors,
  startTotpEnrollment,
  completeTotpEnrollment,
  unenrollFactor
} from '../utils/mfa';

/**
 * MFA Setup Component
 *
 * Allows users (especially admins) to enroll in TOTP-based MFA.
 * Displays enrollment status, QR code for setup, and verification flow.
 */
export default function MfaSetup() {
  const [enrolled, setEnrolled] = useState(false);
  const [factors, setFactors] = useState([]);
  const [enrolling, setEnrolling] = useState(false);
  const [totpSecret, setTotpSecret] = useState(null);
  const [totpUri, setTotpUri] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    refreshStatus();
  }, []);

  const refreshStatus = () => {
    setEnrolled(isMfaEnrolled());
    setFactors(getEnrolledFactors());
  };

  const handleStartEnrollment = async () => {
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const result = await startTotpEnrollment();
      setTotpSecret(result.secret);
      setTotpUri(result.totpUri);
      setSecretKey(result.secretKey);
      setEnrolling(true);
    } catch (err) {
      if (err.code === 'auth/requires-recent-login') {
        setError('Please log out and log back in before enabling MFA.');
      } else {
        setError(err.message || 'Failed to start MFA enrollment.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndComplete = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await completeTotpEnrollment(totpSecret, verificationCode);
      setSuccess('MFA enabled successfully. Your account is now more secure.');
      setEnrolling(false);
      setTotpSecret(null);
      setTotpUri('');
      setSecretKey('');
      setVerificationCode('');
      refreshStatus();
    } catch (err) {
      if (err.code === 'auth/invalid-verification-code') {
        setError('Invalid verification code. Please try again.');
      } else {
        setError(err.message || 'Failed to complete MFA enrollment.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDisableMfa = async () => {
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      await unenrollFactor(0);
      setSuccess('MFA has been disabled.');
      refreshStatus();
    } catch (err) {
      if (err.code === 'auth/requires-recent-login') {
        setError('Please log out and log back in before disabling MFA.');
      } else {
        setError(err.message || 'Failed to disable MFA.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      background: '#111827',
      border: '1px solid rgba(6, 182, 212, 0.3)',
      borderRadius: '12px',
      padding: '24px',
      maxWidth: '500px'
    }}>
      <h3 style={{
        color: '#06b6d4',
        fontSize: '18px',
        fontWeight: '700',
        marginBottom: '16px',
        fontFamily: 'monospace'
      }}>
        Multi-Factor Authentication (MFA)
      </h3>

      {/* Status indicator */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '16px',
        padding: '8px 12px',
        background: enrolled ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
        border: `1px solid ${enrolled ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
        borderRadius: '8px'
      }}>
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: enrolled ? '#22c55e' : '#ef4444'
        }} />
        <span style={{ color: enrolled ? '#86efac' : '#fca5a5', fontSize: '14px' }}>
          {enrolled ? `MFA Enabled (${factors.length} factor${factors.length !== 1 ? 's' : ''})` : 'MFA Not Enabled'}
        </span>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div style={{
          padding: '8px 12px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.5)',
          borderRadius: '8px',
          marginBottom: '16px'
        }}>
          <p style={{ color: '#fca5a5', fontSize: '13px', margin: 0 }}>{error}</p>
        </div>
      )}
      {success && (
        <div style={{
          padding: '8px 12px',
          background: 'rgba(34, 197, 94, 0.1)',
          border: '1px solid rgba(34, 197, 94, 0.5)',
          borderRadius: '8px',
          marginBottom: '16px'
        }}>
          <p style={{ color: '#86efac', fontSize: '13px', margin: 0 }}>{success}</p>
        </div>
      )}

      {/* Enrollment flow */}
      {!enrolled && !enrolling && (
        <div>
          <p style={{ color: '#9ca3af', fontSize: '14px', marginBottom: '16px' }}>
            Protect your account with a TOTP authenticator app (e.g., Google Authenticator, Authy).
          </p>
          <button
            onClick={handleStartEnrollment}
            disabled={loading}
            style={{
              padding: '10px 20px',
              background: 'linear-gradient(to right, #06b6d4, #8b5cf6)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontWeight: '700',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.5 : 1
            }}
          >
            {loading ? 'Setting up...' : 'Enable MFA'}
          </button>
        </div>
      )}

      {/* QR Code and verification */}
      {enrolling && (
        <div>
          <p style={{ color: '#9ca3af', fontSize: '14px', marginBottom: '12px' }}>
            1. Scan this QR code with your authenticator app:
          </p>

          {/* QR Code display via image API */}
          <div style={{
            background: 'white',
            padding: '12px',
            borderRadius: '8px',
            display: 'inline-block',
            marginBottom: '16px'
          }}>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpUri)}`}
              alt="MFA QR Code"
              width="200"
              height="200"
            />
          </div>

          <p style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '8px' }}>
            Or enter this key manually:
          </p>
          <code style={{
            display: 'block',
            padding: '8px 12px',
            background: '#1f2937',
            borderRadius: '6px',
            color: '#06b6d4',
            fontSize: '13px',
            wordBreak: 'break-all',
            marginBottom: '16px'
          }}>
            {secretKey}
          </code>

          <p style={{ color: '#9ca3af', fontSize: '14px', marginBottom: '8px' }}>
            2. Enter the 6-digit code from your app:
          </p>
          <form onSubmit={handleVerifyAndComplete}>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
              style={{
                width: '100%',
                padding: '12px',
                background: '#1f2937',
                border: '2px solid rgba(6, 182, 212, 0.3)',
                borderRadius: '8px',
                color: 'white',
                fontSize: '24px',
                textAlign: 'center',
                letterSpacing: '8px',
                fontFamily: 'monospace',
                marginBottom: '12px',
                outline: 'none'
              }}
              required
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="submit"
                disabled={loading || verificationCode.length !== 6}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: 'linear-gradient(to right, #06b6d4, #8b5cf6)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: '700',
                  cursor: loading || verificationCode.length !== 6 ? 'not-allowed' : 'pointer',
                  opacity: loading || verificationCode.length !== 6 ? 0.5 : 1
                }}
              >
                {loading ? 'Verifying...' : 'Verify & Enable'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEnrolling(false);
                  setTotpSecret(null);
                  setTotpUri('');
                  setSecretKey('');
                  setVerificationCode('');
                }}
                style={{
                  padding: '10px 16px',
                  background: 'transparent',
                  color: '#9ca3af',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Already enrolled - show disable option */}
      {enrolled && !enrolling && (
        <div>
          <p style={{ color: '#9ca3af', fontSize: '14px', marginBottom: '16px' }}>
            Your account is protected with TOTP multi-factor authentication.
          </p>
          <button
            onClick={handleDisableMfa}
            disabled={loading}
            style={{
              padding: '10px 20px',
              background: 'transparent',
              color: '#ef4444',
              border: '1px solid rgba(239, 68, 68, 0.5)',
              borderRadius: '8px',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.5 : 1
            }}
          >
            {loading ? 'Disabling...' : 'Disable MFA'}
          </button>
        </div>
      )}
    </div>
  );
}
