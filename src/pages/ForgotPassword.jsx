import { useState } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebase/config';
import { Link } from 'react-router-dom';
import { Mail, ArrowRight, MailCheck } from 'lucide-react';
import AuthLayout from '../components/auth/AuthLayout';
import AuthField from '../components/auth/AuthField';
import BrandMark from '../components/auth/BrandMark';

/**
 * Forgot password — quiet variant.
 *
 * The reset link itself is handled by Firebase's hosted page. Building a
 * custom action handler is an authentication architecture change and is out of
 * scope (D7), so this screen ends at "we sent it".
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleReset = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);

    try {
      await sendPasswordResetEmail(auth, email);
      setSuccess(true);
    } catch (err) {
      switch (err.code) {
        case 'auth/user-not-found':
          setError('No account found with this email address.');
          break;
        case 'auth/invalid-email':
          setError('Enter a valid email address.');
          break;
        case 'auth/too-many-requests':
          setError('Too many attempts. Please try again later.');
          break;
        case 'auth/network-request-failed':
          setError('Connection issue — check your internet and try again.');
          break;
        default:
          setError('Failed to send reset email. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout variant="quiet">
      <BrandMark />

      <div className="auth-head">
        <h1 className="auth-title">
          {success ? <>Check your<br /><em>inbox</em></> : <>Reset your<br /><em>password</em></>}
        </h1>
        <p className="auth-sub">
          {success
            ? `If an account exists for ${email}, a reset link is on its way.`
            : "Enter your email and we'll send you a link to set a new password."}
        </p>
      </div>

      {success ? (
        <>
          <div className="auth-alert" style={{
            background: 'rgb(16 185 129 / 0.08)',
            borderColor: 'rgb(16 185 129 / 0.3)',
            color: 'var(--auth-text)',
          }}>
            <MailCheck size={19} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
            <span>The link expires after a short while. If it does not arrive, check your spam folder.</span>
          </div>
          <p className="auth-foot">
            <Link className="auth-link" to="/login">Back to sign in</Link>
          </p>
        </>
      ) : (
        <>
          <form className="auth-form" onSubmit={handleReset} noValidate>
            <AuthField
              label="Email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@company.com"
              icon={Mail}
              inputMode="email"
              autoFocus
            />

            {error && (
              <div className="auth-alert" role="alert" aria-live="polite">
                <span>{error}</span>
              </div>
            )}

            <div className="auth-cta-dock">
              <button type="submit" className="auth-cta" disabled={loading}>
                {loading ? (
                  <>
                    <span className="auth-spinner" aria-hidden="true" />
                    Sending...
                  </>
                ) : (
                  <>
                    Send reset link
                    <ArrowRight className="auth-cta-arrow" size={19} aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
          </form>

          <p className="auth-foot">
            Remembered it? <Link className="auth-link" to="/login">Sign in</Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
}
