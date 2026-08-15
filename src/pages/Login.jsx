import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase/config';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, ArrowRight } from 'lucide-react';
import { resolveMfaSignIn } from '../utils/mfa';
import AuthLayout from '../components/auth/AuthLayout';
import AuthField from '../components/auth/AuthField';
import PasswordField from '../components/auth/PasswordField';
import BrandMark from '../components/auth/BrandMark';

/**
 * Sign in — the quiet variant of the authentication experience.
 *
 * The MFA branch below is UNCHANGED LOGIC, re-skinned. `resolveMfaSignIn`,
 * the `auth/multi-factor-auth-required` catch, and the order of operations are
 * exactly as they were; only the markup around them is new. Anyone with MFA
 * enrolled is a paying user who can be locked out of the product by a mistake
 * in this file, which is why it is the one place in the sprint where the rule
 * is "re-skin, do not restructure".
 */
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaError, setMfaError] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate('/mission-control-v2');
    } catch (error) {
      if (error.code === 'auth/multi-factor-auth-required') {
        // MFA is enrolled — prompt for TOTP code
        setMfaRequired(true);
        setMfaError(error);
      } else {
        setError('Invalid credentials. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMfaVerify = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);

    try {
      await resolveMfaSignIn(mfaError, mfaCode);
      navigate('/mission-control-v2');
    } catch {
      setError('Invalid verification code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout variant="full">
      <BrandMark />

      <div className="auth-head">
        <h1 className="auth-title">
          {mfaRequired ? <>Verify it&apos;s<br /><em>you</em></> : <>Welcome<br />back</>}
        </h1>
        <p className="auth-sub">
          {mfaRequired
            ? 'Enter the 6-digit code from your authenticator app.'
            : 'Know who matters, why they matter, and what to do next.'}
        </p>
      </div>

      {mfaRequired ? (
        <form className="auth-form" onSubmit={handleMfaVerify} noValidate>
          <AuthField
            label="Verification code"
            name="one-time-code"
            type="text"
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoComplete="one-time-code"
            placeholder="000000"
            inputMode="numeric"
            autoFocus
          />

          {error && (
            <div className="auth-alert" role="alert" aria-live="polite">
              <span>{error}</span>
            </div>
          )}

          <div className="auth-cta-dock">
            <button type="submit" className="auth-cta" disabled={loading || mfaCode.length !== 6}>
              {loading ? (
                <>
                  <span className="auth-spinner" aria-hidden="true" />
                  Verifying...
                </>
              ) : (
                <>
                  Verify and continue
                  <ArrowRight className="auth-cta-arrow" size={19} aria-hidden="true" />
                </>
              )}
            </button>
          </div>

          <button
            type="button"
            className="auth-link"
            style={{ background: 'none', border: 0, alignSelf: 'center', cursor: 'pointer' }}
            onClick={() => {
              setMfaRequired(false);
              setMfaError(null);
              setMfaCode('');
              setError('');
            }}
          >
            Back to sign in
          </button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={handleLogin} noValidate>
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
          />

          <PasswordField
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="Enter your password"
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
                  Signing in...
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="auth-cta-arrow" size={19} aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {!mfaRequired && (
        <p className="auth-foot">
          New to IDYNIFY? <Link className="auth-link" to="/signup">Create an account</Link>
          <br />
          <Link className="auth-link" to="/forgot-password">Forgot your password?</Link>
        </p>
      )}
    </AuthLayout>
  );
}
