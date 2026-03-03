/**
 * UserSettings — Enterprise-grade tabbed settings page.
 *
 * Tabs: Account · Security · Billing · Integrations · Hunter
 *
 * Surfaces capabilities that already exist in the backend:
 *  - Account: profile email, password reset
 *  - Security: MFA (TOTP, via existing mfa.js utils)
 *  - Billing: plan, credits, billing dates (from Firestore)
 *  - Integrations: Gmail (live) + coming-soon gallery
 *  - Hunter: mission sounds + coming-soon sequence settings
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { sendPasswordResetEmail } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import {
  ArrowLeft, User, Shield, CreditCard, Plug, Settings2,
  Volume2, VolumeX, Mail, CheckCircle, AlertTriangle,
  Loader, LogOut, Lock, Smartphone, BarChart3, Calendar,
  Key, Zap, ChevronRight, Clock, ExternalLink, Layers,
  RefreshCw, Star, Database, MessageSquare, Share2
} from 'lucide-react';
import { db, auth } from '../firebase/config';
import { useMissionSounds } from '../hooks/useMissionSounds';
import {
  isMfaEnrolled,
  getEnrolledFactors,
  startTotpEnrollment,
  completeTotpEnrollment,
  unenrollFactor
} from '../utils/mfa';
import './UserSettings.css';

/* ─── constants ─── */
const TABS = [
  { id: 'account',      label: 'Account',      icon: User },
  { id: 'security',     label: 'Security',      icon: Shield },
  { id: 'billing',      label: 'Billing',       icon: CreditCard },
  { id: 'integrations', label: 'Integrations',  icon: Plug },
  { id: 'hunter',       label: 'Hunter',        icon: Settings2 },
];

const PLAN_LABELS = { starter: 'Starter', pro: 'Pro' };
const PLAN_PRICES = { starter: '$20 / mo', pro: '$50 / mo' };
const PLAN_CREDITS = { starter: 400, pro: 1250 };

/* ─── coming-soon integrations gallery ─── */
const INTEGRATION_STUBS = [
  { id: 'apollo',     name: 'Apollo.io',   desc: 'Sync prospect data and enrichment',     color: '#6366f1', icon: Database },
  { id: 'hubspot',    name: 'HubSpot',     desc: 'Two-way CRM sync for contacts & deals', color: '#f97316', icon: Layers },
  { id: 'salesforce', name: 'Salesforce',  desc: 'Enterprise CRM pipeline integration',   color: '#38bdf8', icon: Star },
  { id: 'slack',      name: 'Slack',       desc: 'Mission alerts and team notifications',  color: '#a78bfa', icon: MessageSquare },
  { id: 'zapier',     name: 'Zapier',      desc: 'Connect 5000+ apps via automation',     color: '#f59e0b', icon: Zap },
  { id: 'linkedin',   name: 'LinkedIn',    desc: 'Export contacts and track engagement',   color: '#0ea5e9', icon: Share2 },
];

/* ─── coming-soon Hunter settings ─── */
const HUNTER_STUBS = [
  { label: 'Sequence timing',      desc: 'Set default days between follow-up steps' },
  { label: 'Follow-up limit',      desc: 'Maximum steps per contact before archiving' },
  { label: 'Barry AI tone',        desc: 'Formal, direct, or conversational messaging style' },
  { label: 'Auto-archive',         desc: 'Automatically archive contacts after final step' },
];

export default function UserSettings() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('account');

  /* ── account ── */
  const user = auth.currentUser;
  const [pwResetSent, setPwResetSent]   = useState(false);
  const [pwResetLoading, setPwResetLoading] = useState(false);
  const [pwResetError, setPwResetError] = useState(null);

  /* ── billing ── */
  const [billing, setBilling]           = useState(null);
  const [billingLoading, setBillingLoading] = useState(true);

  /* ── gmail ── */
  const [gmailStatus, setGmailStatus]   = useState(null);
  const [gmailEmail, setGmailEmail]     = useState('');
  const [gmailLoading, setGmailLoading] = useState(true);
  const [gmailAction, setGmailAction]   = useState(null);
  const [gmailError, setGmailError]     = useState(null);

  /* ── sounds ── */
  const { soundEnabled, setSoundEnabled } = useMissionSounds();

  /* ── MFA ── */
  const [mfaEnrolled, setMfaEnrolled]   = useState(false);
  const [mfaFactors, setMfaFactors]     = useState([]);
  const [mfaEnrolling, setMfaEnrolling] = useState(false);
  const [mfaTotpSecret, setMfaTotpSecret] = useState(null);
  const [mfaTotpUri, setMfaTotpUri]     = useState('');
  const [mfaSecretKey, setMfaSecretKey] = useState('');
  const [mfaCode, setMfaCode]           = useState('');
  const [mfaLoading, setMfaLoading]     = useState(false);
  const [mfaError, setMfaError]         = useState('');
  const [mfaSuccess, setMfaSuccess]     = useState('');

  /* ── load on mount ── */
  useEffect(() => {
    loadGmailStatus();
    loadBilling();
    refreshMfaStatus();
  }, []);

  async function loadBilling() {
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        const d = snap.data();
        setBilling({
          tier:           d.subscriptionTier  || 'starter',
          creditsTotal:   d.monthlyCredits    || PLAN_CREDITS[d.subscriptionTier] || 400,
          creditsUsed:    (d.credits?.used)   ?? (PLAN_CREDITS[d.subscriptionTier] || 400) - (d.credits?.remaining ?? d.credits ?? 0),
          creditsRemaining: (d.credits?.remaining) ?? (d.credits || 0),
          billingDate:    d.billingDate        || null,
          nextBillingDate: d.nextBillingDate   || null,
          stripeCustomerId: d.stripeCustomerId || null,
        });
      }
    } catch (err) {
      console.error('[UserSettings] loadBilling error:', err);
    } finally {
      setBillingLoading(false);
    }
  }

  async function loadGmailStatus() {
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, 'users', user.uid, 'integrations', 'gmail'));
      if (snap.exists()) {
        const d = snap.data();
        setGmailStatus(d.status === 'connected' ? 'connected' : 'disconnected');
        setGmailEmail(d.email || '');
      } else {
        setGmailStatus('disconnected');
      }
    } catch (err) {
      console.error('[UserSettings] loadGmailStatus error:', err);
      setGmailStatus('disconnected');
    } finally {
      setGmailLoading(false);
    }
  }

  function refreshMfaStatus() {
    setMfaEnrolled(isMfaEnrolled());
    setMfaFactors(getEnrolledFactors());
  }

  /* ── account handlers ── */
  async function handlePasswordReset() {
    if (!user?.email) return;
    setPwResetLoading(true);
    setPwResetError(null);
    try {
      await sendPasswordResetEmail(auth, user.email);
      setPwResetSent(true);
    } catch (err) {
      setPwResetError(err.message || 'Failed to send reset email.');
    } finally {
      setPwResetLoading(false);
    }
  }

  /* ── gmail handlers ── */
  async function handleConnectGmail() {
    setGmailAction('connecting');
    setGmailError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/.netlify/functions/gmail-oauth-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, authToken: token }),
      });
      if (!res.ok) throw new Error('Failed to initialize Gmail OAuth');
      const data = await res.json();
      window.location.href = data.authUrl;
    } catch (err) {
      setGmailError(err.message);
      setGmailAction(null);
    }
  }

  async function handleDisconnectGmail() {
    setGmailAction('disconnecting');
    setGmailError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/.netlify/functions/gmail-disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, authToken: token }),
      });
      if (!res.ok) throw new Error('Failed to disconnect Gmail');
      setGmailStatus('disconnected');
      setGmailEmail('');
    } catch (err) {
      setGmailError(err.message);
    } finally {
      setGmailAction(null);
    }
  }

  /* ── MFA handlers ── */
  async function handleStartMfaEnrollment() {
    setMfaError('');
    setMfaSuccess('');
    setMfaLoading(true);
    try {
      const result = await startTotpEnrollment();
      setMfaTotpSecret(result.secret);
      setMfaTotpUri(result.totpUri);
      setMfaSecretKey(result.secretKey);
      setMfaEnrolling(true);
    } catch (err) {
      setMfaError(
        err.code === 'auth/requires-recent-login'
          ? 'Please log out and log back in before enabling MFA.'
          : err.message || 'Failed to start MFA enrollment.'
      );
    } finally {
      setMfaLoading(false);
    }
  }

  async function handleVerifyMfa(e) {
    e.preventDefault();
    setMfaError('');
    setMfaLoading(true);
    try {
      await completeTotpEnrollment(mfaTotpSecret, mfaCode);
      setMfaSuccess('MFA enabled. Your account is now more secure.');
      setMfaEnrolling(false);
      setMfaTotpSecret(null);
      setMfaTotpUri('');
      setMfaSecretKey('');
      setMfaCode('');
      refreshMfaStatus();
    } catch (err) {
      setMfaError(
        err.code === 'auth/invalid-verification-code'
          ? 'Invalid code — please try again.'
          : err.message || 'Failed to verify code.'
      );
    } finally {
      setMfaLoading(false);
    }
  }

  async function handleDisableMfa() {
    setMfaError('');
    setMfaSuccess('');
    setMfaLoading(true);
    try {
      await unenrollFactor(0);
      setMfaSuccess('MFA has been disabled.');
      refreshMfaStatus();
    } catch (err) {
      setMfaError(
        err.code === 'auth/requires-recent-login'
          ? 'Please log out and log back in before disabling MFA.'
          : err.message || 'Failed to disable MFA.'
      );
    } finally {
      setMfaLoading(false);
    }
  }

  /* ─────────────────────────────────── render ─── */
  return (
    <div className="us-page">
      {/* ── header ── */}
      <div className="us-header">
        <button className="us-back-btn" onClick={() => navigate(-1)} aria-label="Go back">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="us-title">Settings</h1>
      </div>

      {/* ── tab bar ── */}
      <div className="us-tabs" role="tablist">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={activeTab === id}
            className={`us-tab ${activeTab === id ? 'us-tab--active' : ''}`}
            onClick={() => setActiveTab(id)}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── panels ── */}
      <div className="us-panel">

        {/* ══ ACCOUNT ══ */}
        {activeTab === 'account' && (
          <div className="us-section-stack">
            <section className="us-section">
              <h2 className="us-section-title">Profile</h2>

              <div className="us-card">
                <div className="us-card-icon" style={{ background: 'rgba(139,92,246,0.12)', borderColor: 'rgba(139,92,246,0.2)', color: '#c4b5fd' }}>
                  <User className="w-4 h-4" />
                </div>
                <div className="us-card-body">
                  <span className="us-card-label">Email address</span>
                  <span className="us-card-value">{user?.email || '—'}</span>
                </div>
              </div>
            </section>

            <section className="us-section">
              <h2 className="us-section-title">Password</h2>

              <div className="us-card us-card--action">
                <div className="us-card-icon" style={{ background: 'rgba(236,72,153,0.1)', borderColor: 'rgba(236,72,153,0.18)', color: '#f9a8d4' }}>
                  <Lock className="w-4 h-4" />
                </div>
                <div className="us-card-body">
                  <span className="us-card-label">Change password</span>
                  <span className="us-card-value us-card-value--muted">
                    {pwResetSent
                      ? 'Reset link sent — check your inbox'
                      : 'We\'ll email you a secure link to reset your password'}
                  </span>
                  {pwResetError && (
                    <span className="us-inline-error">
                      <AlertTriangle className="w-3 h-3" />{pwResetError}
                    </span>
                  )}
                </div>
                <button
                  className={`us-action-btn ${pwResetSent ? 'us-action-btn--done' : ''}`}
                  onClick={handlePasswordReset}
                  disabled={pwResetLoading || pwResetSent}
                >
                  {pwResetLoading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : pwResetSent ? <CheckCircle className="w-3.5 h-3.5" /> : null}
                  {pwResetSent ? 'Sent' : 'Send reset link'}
                </button>
              </div>
            </section>

            <section className="us-section">
              <h2 className="us-section-title">Danger zone</h2>
              <div className="us-card us-card--muted">
                <div className="us-card-icon" style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.15)', color: '#f87171' }}>
                  <LogOut className="w-4 h-4" />
                </div>
                <div className="us-card-body">
                  <span className="us-card-label">Sign out of all sessions</span>
                  <span className="us-card-value us-card-value--muted">
                    Firebase manages session tokens — log in again on each device to refresh access
                  </span>
                </div>
                <span className="us-coming-chip">Coming soon</span>
              </div>
            </section>
          </div>
        )}

        {/* ══ SECURITY ══ */}
        {activeTab === 'security' && (
          <div className="us-section-stack">
            <section className="us-section">
              <div className="us-section-header">
                <h2 className="us-section-title">Two-factor authentication</h2>
                <span className={`us-status-chip ${mfaEnrolled ? 'us-status-chip--green' : 'us-status-chip--gray'}`}>
                  {mfaEnrolled ? <><CheckCircle className="w-3 h-3" /> Enabled</> : 'Not enabled'}
                </span>
              </div>

              {/* MFA feedback */}
              {mfaError && (
                <div className="us-feedback us-feedback--error">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  {mfaError}
                </div>
              )}
              {mfaSuccess && (
                <div className="us-feedback us-feedback--success">
                  <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  {mfaSuccess}
                </div>
              )}

              {/* Not enrolled, not in setup flow */}
              {!mfaEnrolled && !mfaEnrolling && (
                <div className="us-card us-card--action">
                  <div className="us-card-icon" style={{ background: 'rgba(6,182,212,0.1)', borderColor: 'rgba(6,182,212,0.2)', color: '#67e8f9' }}>
                    <Smartphone className="w-4 h-4" />
                  </div>
                  <div className="us-card-body">
                    <span className="us-card-label">Authenticator app (TOTP)</span>
                    <span className="us-card-value us-card-value--muted">
                      Use Google Authenticator, Authy, or any TOTP app to generate login codes
                    </span>
                  </div>
                  <button
                    className="us-action-btn us-action-btn--primary"
                    onClick={handleStartMfaEnrollment}
                    disabled={mfaLoading}
                  >
                    {mfaLoading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
                    Enable MFA
                  </button>
                </div>
              )}

              {/* Enrollment flow */}
              {mfaEnrolling && (
                <div className="us-mfa-setup">
                  <p className="us-mfa-step">Step 1 — Scan this QR code with your authenticator app</p>
                  <div className="us-mfa-qr">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(mfaTotpUri)}`}
                      alt="MFA QR Code"
                      width="180"
                      height="180"
                    />
                  </div>
                  <p className="us-mfa-step">Or enter this key manually</p>
                  <code className="us-mfa-secret">{mfaSecretKey}</code>

                  <p className="us-mfa-step" style={{ marginTop: '1.25rem' }}>Step 2 — Enter the 6-digit code</p>
                  <form onSubmit={handleVerifyMfa} className="us-mfa-form">
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      placeholder="000 000"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                      className="us-mfa-input"
                      required
                      autoFocus
                    />
                    <div className="us-mfa-actions">
                      <button
                        type="submit"
                        className="us-action-btn us-action-btn--primary"
                        disabled={mfaLoading || mfaCode.length !== 6}
                      >
                        {mfaLoading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : null}
                        Verify & enable
                      </button>
                      <button
                        type="button"
                        className="us-action-btn"
                        onClick={() => { setMfaEnrolling(false); setMfaTotpSecret(null); setMfaCode(''); }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Already enrolled */}
              {mfaEnrolled && !mfaEnrolling && (
                <div className="us-card us-card--action">
                  <div className="us-card-icon" style={{ background: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.2)', color: '#86efac' }}>
                    <Smartphone className="w-4 h-4" />
                  </div>
                  <div className="us-card-body">
                    <span className="us-card-label">Authenticator app (TOTP)</span>
                    <span className="us-card-value us-card-value--muted">
                      {mfaFactors.length} factor{mfaFactors.length !== 1 ? 's' : ''} enrolled · Active
                    </span>
                  </div>
                  <button
                    className="us-action-btn us-action-btn--danger"
                    onClick={handleDisableMfa}
                    disabled={mfaLoading}
                  >
                    {mfaLoading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : null}
                    Disable
                  </button>
                </div>
              )}
            </section>

            <section className="us-section">
              <h2 className="us-section-title">SSO / SAML</h2>
              <div className="us-card us-card--muted">
                <div className="us-card-icon" style={{ background: 'rgba(139,92,246,0.1)', borderColor: 'rgba(139,92,246,0.18)', color: '#c4b5fd' }}>
                  <Shield className="w-4 h-4" />
                </div>
                <div className="us-card-body">
                  <span className="us-card-label">Single Sign-On</span>
                  <span className="us-card-value us-card-value--muted">
                    Connect your identity provider (Okta, Azure AD, Google Workspace) for workspace-wide SSO
                  </span>
                </div>
                <span className="us-coming-chip">Enterprise</span>
              </div>
            </section>

            <section className="us-section">
              <h2 className="us-section-title">Active sessions</h2>
              <div className="us-card us-card--muted">
                <div className="us-card-icon" style={{ background: 'rgba(251,191,36,0.1)', borderColor: 'rgba(251,191,36,0.18)', color: '#fde68a' }}>
                  <Clock className="w-4 h-4" />
                </div>
                <div className="us-card-body">
                  <span className="us-card-label">Session management</span>
                  <span className="us-card-value us-card-value--muted">
                    View and revoke active sessions across devices
                  </span>
                </div>
                <span className="us-coming-chip">Coming soon</span>
              </div>
            </section>
          </div>
        )}

        {/* ══ BILLING ══ */}
        {activeTab === 'billing' && (
          <div className="us-section-stack">
            {billingLoading ? (
              <div className="us-loading-state">
                <Loader className="w-5 h-5 animate-spin" />
                Loading billing info…
              </div>
            ) : (
              <>
                <section className="us-section">
                  <h2 className="us-section-title">Current plan</h2>
                  <div className="us-billing-plan-card">
                    <div className="us-billing-plan-left">
                      <div className="us-billing-plan-badge">
                        {PLAN_LABELS[billing?.tier] || 'Starter'}
                      </div>
                      <span className="us-billing-plan-price">
                        {PLAN_PRICES[billing?.tier] || '$20 / mo'}
                      </span>
                    </div>
                    <a href="/checkout" className="us-action-btn us-action-btn--primary">
                      <ExternalLink className="w-3.5 h-3.5" />
                      {billing?.tier === 'pro' ? 'Manage plan' : 'Upgrade to Pro'}
                    </a>
                  </div>
                </section>

                <section className="us-section">
                  <h2 className="us-section-title">Credit usage</h2>
                  <div className="us-credit-card">
                    <div className="us-credit-header">
                      <div>
                        <span className="us-credit-remaining">{(billing?.creditsRemaining ?? 0).toLocaleString()}</span>
                        <span className="us-credit-of"> / {(billing?.creditsTotal ?? 400).toLocaleString()} credits remaining</span>
                      </div>
                      <span className="us-credit-pct">
                        {billing?.creditsTotal
                          ? Math.round(((billing.creditsRemaining ?? 0) / billing.creditsTotal) * 100)
                          : 0}%
                      </span>
                    </div>
                    <div className="us-credit-bar-track">
                      <div
                        className="us-credit-bar-fill"
                        style={{
                          width: billing?.creditsTotal
                            ? `${Math.max(0, Math.min(100, ((billing.creditsRemaining ?? 0) / billing.creditsTotal) * 100))}%`
                            : '0%',
                        }}
                      />
                    </div>
                    <div className="us-credit-meta">
                      <div className="us-credit-row">
                        <span className="us-credit-meta-label">Used this cycle</span>
                        <span className="us-credit-meta-value">{(billing?.creditsUsed ?? 0).toLocaleString()} credits</span>
                      </div>
                      <div className="us-credit-row">
                        <span className="us-credit-meta-label">Enrichments remaining</span>
                        <span className="us-credit-meta-value">{Math.floor((billing?.creditsRemaining ?? 0) / 10)} companies</span>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="us-section">
                  <h2 className="us-section-title">Billing dates</h2>
                  <div className="us-card">
                    <div className="us-card-icon" style={{ background: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.18)', color: '#86efac' }}>
                      <Calendar className="w-4 h-4" />
                    </div>
                    <div className="us-card-body">
                      <span className="us-card-label">Current period started</span>
                      <span className="us-card-value us-card-value--muted">
                        {billing?.billingDate
                          ? new Date(billing.billingDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                          : '—'}
                      </span>
                    </div>
                  </div>
                  <div className="us-card" style={{ marginTop: '0.5rem' }}>
                    <div className="us-card-icon" style={{ background: 'rgba(251,191,36,0.1)', borderColor: 'rgba(251,191,36,0.18)', color: '#fde68a' }}>
                      <RefreshCw className="w-4 h-4" />
                    </div>
                    <div className="us-card-body">
                      <span className="us-card-label">Next renewal & credit reset</span>
                      <span className="us-card-value us-card-value--muted">
                        {billing?.nextBillingDate
                          ? new Date(billing.nextBillingDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                          : '—'}
                      </span>
                    </div>
                  </div>
                </section>

                <section className="us-section">
                  <h2 className="us-section-title">Invoice history</h2>
                  <div className="us-card us-card--muted">
                    <div className="us-card-icon" style={{ background: 'rgba(99,102,241,0.1)', borderColor: 'rgba(99,102,241,0.18)', color: '#a5b4fc' }}>
                      <BarChart3 className="w-4 h-4" />
                    </div>
                    <div className="us-card-body">
                      <span className="us-card-label">Download past invoices</span>
                      <span className="us-card-value us-card-value--muted">
                        Self-serve invoice history via the Stripe customer portal
                      </span>
                    </div>
                    <span className="us-coming-chip">Coming soon</span>
                  </div>
                </section>
              </>
            )}
          </div>
        )}

        {/* ══ INTEGRATIONS ══ */}
        {activeTab === 'integrations' && (
          <div className="us-section-stack">
            <section className="us-section">
              <h2 className="us-section-title">Connected</h2>

              {/* Gmail — live */}
              <div className={`us-card ${gmailStatus === 'connected' ? '' : 'us-card--action'}`}>
                <div className="us-card-icon" style={{ background: 'rgba(59,130,246,0.1)', borderColor: 'rgba(59,130,246,0.2)', color: '#93c5fd' }}>
                  <Mail className="w-4 h-4" />
                </div>
                <div className="us-card-body">
                  <div className="us-card-label-row">
                    <span className="us-card-label">Gmail</span>
                    {!gmailLoading && gmailStatus === 'connected' && (
                      <span className="us-status-chip us-status-chip--green">
                        <CheckCircle className="w-3 h-3" /> Connected
                      </span>
                    )}
                    {!gmailLoading && gmailStatus === 'disconnected' && (
                      <span className="us-status-chip us-status-chip--gray">Not connected</span>
                    )}
                  </div>
                  <span className="us-card-value us-card-value--muted">
                    {gmailLoading
                      ? 'Loading…'
                      : gmailStatus === 'connected' && gmailEmail
                      ? gmailEmail
                      : 'Send outreach directly from your Gmail account'}
                  </span>
                  {gmailError && (
                    <span className="us-inline-error">
                      <AlertTriangle className="w-3 h-3" />{gmailError}
                    </span>
                  )}
                </div>

                <div className="us-gmail-actions">
                  {gmailLoading ? (
                    <Loader className="w-4 h-4 animate-spin" style={{ color: '#6b7280' }} />
                  ) : gmailStatus === 'connected' ? (
                    <>
                      <button
                        className="us-action-btn"
                        onClick={handleConnectGmail}
                        disabled={gmailAction !== null}
                        title="Re-authorize Gmail"
                      >
                        {gmailAction === 'connecting' ? <Loader className="w-3.5 h-3.5 animate-spin" /> : null}
                        Reconnect
                      </button>
                      <button
                        className="us-action-btn us-action-btn--danger-icon"
                        onClick={handleDisconnectGmail}
                        disabled={gmailAction !== null}
                        title="Disconnect Gmail"
                      >
                        {gmailAction === 'disconnecting' ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                      </button>
                    </>
                  ) : (
                    <button
                      className="us-action-btn us-action-btn--primary"
                      onClick={handleConnectGmail}
                      disabled={gmailAction !== null}
                    >
                      {gmailAction === 'connecting' ? (
                        <><Loader className="w-3.5 h-3.5 animate-spin" /> Connecting…</>
                      ) : (
                        'Connect'
                      )}
                    </button>
                  )}
                </div>
              </div>
            </section>

            <section className="us-section">
              <h2 className="us-section-title">Available integrations</h2>
              <div className="us-integration-grid">
                {INTEGRATION_STUBS.map(({ id, name, desc, color, icon: Icon }) => (
                  <div key={id} className="us-integration-tile">
                    <div className="us-integration-icon" style={{ background: `${color}18`, borderColor: `${color}30`, color }}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="us-integration-info">
                      <span className="us-integration-name">{name}</span>
                      <span className="us-integration-desc">{desc}</span>
                    </div>
                    <span className="us-coming-chip">Coming soon</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ══ HUNTER ══ */}
        {activeTab === 'hunter' && (
          <div className="us-section-stack">
            <section className="us-section">
              <h2 className="us-section-title">Preferences</h2>

              <div className="us-card us-card--toggle">
                <div className="us-card-icon" style={{ background: 'rgba(236,72,153,0.1)', borderColor: 'rgba(236,72,153,0.18)', color: '#f9a8d4' }}>
                  {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                </div>
                <div className="us-card-body">
                  <span className="us-card-label">Mission sounds</span>
                  <span className="us-card-value us-card-value--muted">
                    Play audio feedback when engaging or archiving contacts in the Hunter deck
                  </span>
                </div>
                <button
                  role="switch"
                  aria-checked={soundEnabled}
                  aria-label="Mission sounds"
                  className={`us-toggle ${soundEnabled ? 'us-toggle--on' : 'us-toggle--off'}`}
                  onClick={() => setSoundEnabled(!soundEnabled)}
                >
                  <span className="us-toggle-thumb" />
                </button>
              </div>
            </section>

            <section className="us-section">
              <h2 className="us-section-title">Sequence & Barry configuration</h2>
              <div className="us-section-note">
                Per-user sequence settings and Barry AI tone controls are on the roadmap.
                These will let you tune follow-up cadence and messaging style without touching campaign defaults.
              </div>
              <div className="us-stub-list">
                {HUNTER_STUBS.map(({ label, desc }) => (
                  <div key={label} className="us-card us-card--muted">
                    <div className="us-card-icon" style={{ background: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}>
                      <Settings2 className="w-4 h-4" />
                    </div>
                    <div className="us-card-body">
                      <span className="us-card-label">{label}</span>
                      <span className="us-card-value us-card-value--muted">{desc}</span>
                    </div>
                    <span className="us-coming-chip">Coming soon</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

      </div>
    </div>
  );
}
