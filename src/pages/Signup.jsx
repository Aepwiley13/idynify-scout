import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Mail, ArrowRight } from 'lucide-react';
import AuthLayout from '../components/auth/AuthLayout';
import AuthField from '../components/auth/AuthField';
import PasswordField from '../components/auth/PasswordField';
import PasswordRequirements from '../components/auth/PasswordRequirements';
import BrandMark from '../components/auth/BrandMark';
import {
  SIGNUP_EVENTS,
  beginSignupSession,
  bufferSignupEvent,
  bufferSignupEventOnce,
  flushSignupEvents,
} from '../services/signupAnalytics';

const WhyIdynify = lazy(() => import('../components/auth/WhyIdynify'));

/**
 * Firebase error code → what the person reading it should do about it.
 * `email-already-in-use` is handled separately because its message carries a
 * link, and a link is not a string.
 */
const ERROR_COPY = {
  'auth/invalid-email':           'Enter a valid email address.',
  'auth/weak-password':           'Choose a stronger password.',
  'auth/network-request-failed':  'Connection issue — check your internet and try again.',
  'auth/too-many-requests':       'Too many attempts. Please try again in a few minutes.',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [formError, setFormError] = useState(null);   // { code, message }
  const [submitting, setSubmitting] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  /**
   * The tier is invisible on this page by design — the brief removes all
   * pricing and plan language from signup. It still decides what the account
   * is created with, so it is read and forwarded exactly as before.
   *
   * This is the single most important thing not to lose in a visual rewrite:
   * nothing on screen would look wrong if it stopped flowing, and a customer
   * who chose Pro would quietly become Starter. Tests 10 and 11 pin it.
   */
  const tier = searchParams.get('tier') || 'starter';

  useEffect(() => {
    beginSignupSession();
    bufferSignupEvent(SIGNUP_EVENTS.VIEWED, { tier });
  }, [tier]);

  const onEmailChange = (e) => {
    bufferSignupEventOnce(SIGNUP_EVENTS.EMAIL_STARTED);
    const next = e.target.value;
    setEmail(next);
    // Re-validate as they type only once they have already left the field —
    // correcting a mistake should clear the error immediately, but a partly
    // typed address is not a mistake yet.
    if (emailTouched) setEmailError(EMAIL_RE.test(next) ? '' : 'Enter a valid email address.');
  };

  const onEmailBlur = () => {
    // Deliberately not on first blur through an empty field: tabbing past
    // something you have not filled in yet is not an error worth shouting at.
    if (!email) return;
    setEmailTouched(true);
    setEmailError(EMAIL_RE.test(email) ? '' : 'Enter a valid email address.');
  };

  const onPasswordChange = (e) => {
    bufferSignupEventOnce(SIGNUP_EVENTS.PASSWORD_STARTED);
    setPassword(e.target.value);
  };

  // Identity so PasswordRequirements' effect does not re-run every render.
  const noopValidity = useCallback(() => {}, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // The disabled attribute is the visible guard; this is the real one. A
    // double-tap can land two submits before React re-renders the button, and
    // the second would try to create the account again.
    if (submitting) return;

    if (!EMAIL_RE.test(email)) {
      setEmailTouched(true);
      setEmailError('Enter a valid email address.');
      return;
    }

    setFormError(null);
    setSubmitting(true);
    bufferSignupEvent(SIGNUP_EVENTS.SUBMITTED, { tier });
    bufferSignupEvent(SIGNUP_EVENTS.METHOD_SELECTED, { method: 'email' });

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);

      // ── UNCHANGED FROM THE PREVIOUS IMPLEMENTATION ──────────────────────
      // Same keys, same order, same types. `credits` is a number here and is
      // later replaced by an object in CheckoutPage — a known inconsistency
      // that this sprint documents rather than fixes, so the shape written at
      // signup must stay exactly what production writes today. Test 12 asserts
      // this payload field by field.
      const initialCredits = tier === 'pro' ? 1250 : 400;

      await setDoc(doc(db, 'users', userCredential.user.uid), {
        email: email,
        createdAt: new Date(),
        selectedTier: tier,
        subscriptionTier: tier,
        status: 'pending_payment',
        hasCompletedPayment: false,
        credits: initialCredits,
        monthlyCredits: initialCredits
      });
      // ────────────────────────────────────────────────────────────────────

      // Genuinely fire-and-forget now. The previous code awaited this despite
      // a comment promising it did not, so a slow Resend call sat between the
      // user pressing the button and reaching checkout. Failures still surface
      // in logs; they just no longer cost the user time.
      fetch('/.netlify/functions/send-welcome-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, userId: userCredential.user.uid }),
      }).catch((emailError) => {
        console.error('[signup] welcome email failed to send', emailError);
      });

      // A uid exists from here on, so the buffered funnel can be written.
      flushSignupEvents(SIGNUP_EVENTS.SUCCEEDED, { tier });

      navigate(`/checkout?tier=${tier}`);
    } catch (error) {
      // Error type only — never the email, never the password.
      bufferSignupEvent(SIGNUP_EVENTS.FAILED, { code: error?.code || 'unknown' });

      setFormError({
        code: error?.code,
        message: ERROR_COPY[error?.code] || 'Something went wrong. Please try again.',
      });
      // Form values are deliberately left intact — retyping an email because
      // the password was wrong is its own small insult.
      setSubmitting(false);
    }
  };

  const duplicate = formError?.code === 'auth/email-already-in-use';

  return (
    <AuthLayout
      variant="full"
      below={
        <Suspense fallback={null}>
          <WhyIdynify />
        </Suspense>
      }
    >
      <BrandMark />

      <div className="auth-head">
        <h1 className="auth-title">
          Create your<br /><em>IDYNIFY</em> account
        </h1>
        <p className="auth-sub">
          Know who matters, why they matter, and what to do next.
        </p>
      </div>

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <AuthField
          label="Email"
          name="email"
          type="email"
          value={email}
          onChange={onEmailChange}
          onBlur={onEmailBlur}
          autoComplete="email"
          placeholder="you@company.com"
          icon={Mail}
          error={emailError}
          inputMode="email"
        />

        <div>
          <PasswordField
            name="password"
            value={password}
            onChange={onPasswordChange}
            autoComplete="new-password"
            placeholder="Create a strong password"
          />
          <PasswordRequirements password={password} onValidityChange={noopValidity} />
        </div>

        {formError && (
          <div className="auth-alert" role="alert" aria-live="polite">
            <span>
              {duplicate ? (
                <>
                  An account already exists with this email.{' '}
                  <Link className="auth-link-inline" to="/login">Sign in instead</Link>
                </>
              ) : (
                formError.message
              )}
            </span>
          </div>
        )}

        <div className="auth-cta-dock">
          <button type="submit" className="auth-cta" disabled={submitting}>
            {submitting ? (
              <>
                <span className="auth-spinner" aria-hidden="true" />
                Creating your account...
              </>
            ) : (
              <>
                Create account
                <ArrowRight className="auth-cta-arrow" size={19} aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </form>

      <p className="auth-foot">
        Already have an account?{' '}
        <Link
          className="auth-link"
          to="/login"
          onClick={() => bufferSignupEvent(SIGNUP_EVENTS.SIGNIN_CLICKED)}
        >
          Sign in
        </Link>
      </p>

      {/* LEGAL-001 — Terms and Privacy are deferred (D2). The slot is held open
          so reinstating the line later is a render, not a layout change. */}
      <div className="auth-legal-slot" />
    </AuthLayout>
  );
}
