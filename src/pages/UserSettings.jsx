/**
 * UserSettings — Self-contained settings shell.
 *
 * Architecture matches RECON / HUNTER:
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  Icon Rail (60px)  │  Sub-Nav (190px)  │  Main Content  │
 *  └─────────────────────────────────────────────────────────┘
 *
 * Accent color: Orange (#faaa20) — Settings identity.
 * Route: /settings — no withLayout={true} needed.
 */

import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { sendPasswordResetEmail } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import {
  ArrowLeft, User, Shield, CreditCard, Plug, Settings2,
  Volume2, VolumeX, Mail, CheckCircle, AlertTriangle,
  Loader, LogOut, Lock, Smartphone, BarChart3, Calendar,
  Key, Zap, ExternalLink, Layers,
  RefreshCw, Star, Database, MessageSquare, Share2,
  Radar, Crosshair, Eye, Target,
  Palette, Check, ChevronLeft, ChevronRight, Home, Settings as SettingsIcon, Clock,
} from 'lucide-react';
import { db, auth } from '../firebase/config';
import { useMissionSounds } from '../hooks/useMissionSounds';
import {
  isMfaEnrolled,
  getEnrolledFactors,
  startTotpEnrollment,
  completeTotpEnrollment,
  unenrollFactor,
} from '../utils/mfa';
import { useT, useThemeCtx } from '../theme/ThemeContext';
import { BRAND, THEMES, ASSETS } from '../theme/tokens';
import './UserSettings.css';

/* ─── accent ─────────────────────────────────────────────────────────────── */
const SETTINGS_ORANGE  = '#faaa20';
const SETTINGS_ORANGE2 = '#f59e0b';

/* ─── constants ─────────────────────────────────────────────────────────── */
const TABS = [
  { id: 'account',      label: 'Account',      icon: User      },
  { id: 'security',     label: 'Security',      icon: Shield    },
  { id: 'billing',      label: 'Billing',       icon: CreditCard },
  { id: 'integrations', label: 'Integrations',  icon: Plug      },
  { id: 'hunter',       label: 'Hunter',        icon: Settings2 },
];

const PLAN_LABELS  = { starter: 'Starter', pro: 'Pro' };
const PLAN_PRICES  = { starter: '$20 / mo', pro: '$50 / mo' };
const PLAN_CREDITS = { starter: 400, pro: 1250 };

const INTEGRATION_STUBS = [
  { id: 'apollo',     name: 'Apollo.io',   desc: 'Sync prospect data and enrichment',     color: '#6366f1', icon: Database    },
  { id: 'hubspot',    name: 'HubSpot',     desc: 'Two-way CRM sync for contacts & deals', color: '#f97316', icon: Layers      },
  { id: 'salesforce', name: 'Salesforce',  desc: 'Enterprise CRM pipeline integration',   color: '#38bdf8', icon: Star        },
  { id: 'slack',      name: 'Slack',       desc: 'Mission alerts and team notifications',  color: '#a78bfa', icon: MessageSquare },
  { id: 'zapier',     name: 'Zapier',      desc: 'Connect 5000+ apps via automation',     color: '#f59e0b', icon: Zap         },
  { id: 'linkedin',   name: 'LinkedIn',    desc: 'Export contacts and track engagement',   color: '#0ea5e9', icon: Share2      },
];

const HUNTER_STUBS = [
  { label: 'Sequence timing',  desc: 'Set default days between follow-up steps'           },
  { label: 'Follow-up limit',  desc: 'Maximum steps per contact before archiving'          },
  { label: 'Barry AI tone',    desc: 'Formal, direct, or conversational messaging style'   },
  { label: 'Auto-archive',     desc: 'Automatically archive contacts after final step'     },
];

/* ─── Particles ──────────────────────────────────────────────────────────── */
const PARTICLE_STARS = Array.from({ length: 55 }, () => ({
  x: Math.random() * 100, y: Math.random() * 100,
  size: Math.random() * 1.8 + 0.4, op: Math.random() * 0.4 + 0.08,
  dur: Math.random() * 4 + 3, delay: Math.random() * 5,
}));

function Particles() {
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
      {PARTICLE_STARS.map((s, i) => (
        <div key={i} style={{
          position: 'absolute', left: `${s.x}%`, top: `${s.y}%`,
          width: s.size, height: s.size, borderRadius: '50%', background: '#fff',
          opacity: s.op,
          animation: `twinkle ${s.dur}s ease-in-out infinite`,
          animationDelay: `${s.delay}s`,
        }} />
      ))}
    </div>
  );
}

/* ─── BarryAvatar ────────────────────────────────────────────────────────── */
function BarryAvatar({ size = 28, style = {} }) {
  const glow = `0 0 ${size * 0.5}px ${BRAND.cyan}50`;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg,${BRAND.pink},${BRAND.cyan})`,
      border: `2px solid ${BRAND.cyan}50`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.46, flexShrink: 0, boxShadow: glow, overflow: 'hidden', ...style,
    }}>
      <img
        src={ASSETS.barryAvatar}
        alt="Barry AI"
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '🐻'; }}
      />
    </div>
  );
}

/* ─── ThemePicker ────────────────────────────────────────────────────────── */
function ThemePicker() {
  const T = useT();
  const { themeId, setThemeId } = useThemeCtx();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen(o => !o)}
        title="Change theme"
        style={{
          width: 34, height: 34, borderRadius: 9, background: T.accentBg,
          border: `1px solid ${T.accentBdr}`, display: 'flex', alignItems: 'center',
          justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s',
        }}
      >
        <Palette size={16} color={SETTINGS_ORANGE} />
      </div>
      {open && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute', bottom: 42, left: 0, width: 226,
            background: T.cardBg, border: `1px solid ${T.border2}`,
            borderRadius: 14, padding: 14,
            boxShadow: `0 20px 60px ${T.isDark ? '#00000099' : '#00000020'}`,
            zIndex: 300, animation: 'fadeUp 0.15s ease',
          }}
        >
          <div style={{ fontSize: 10, letterSpacing: 2, color: T.textFaint, marginBottom: 10, fontWeight: 700 }}>
            APPEARANCE
          </div>
          {Object.values(THEMES).map(theme => (
            <div
              key={theme.id}
              onClick={() => { setThemeId(theme.id); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                borderRadius: 9, cursor: 'pointer',
                background: themeId === theme.id ? T.accentBg : 'transparent',
                border: `1px solid ${themeId === theme.id ? T.accentBdr : 'transparent'}`,
                transition: 'all 0.12s', marginBottom: 4,
              }}
              onMouseEnter={e => { if (themeId !== theme.id) e.currentTarget.style.background = T.surface; }}
              onMouseLeave={e => { if (themeId !== theme.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{
                width: 34, height: 22, borderRadius: 6,
                background: theme.swatchBg, border: `1px solid ${T.border2}`, flexShrink: 0,
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: themeId === theme.id ? SETTINGS_ORANGE : T.text }}>
                  {theme.label}
                </div>
                <div style={{ fontSize: 10, color: T.textFaint }}>{theme.icon}</div>
              </div>
              {themeId === theme.id && <Check size={14} color={SETTINGS_ORANGE} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Avatar ─────────────────────────────────────────────────────────────── */
function Av({ initials, size = 24 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `${SETTINGS_ORANGE}20`, border: `1.5px solid ${SETTINGS_ORANGE}50`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.3, fontWeight: 700, color: SETTINGS_ORANGE, flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

/* ─── Module rail ────────────────────────────────────────────────────────── */
const MODULE_RAIL = [
  { id: 'scout',  label: 'SCOUT',  Icon: Radar,     route: '/scout'  },
  { id: 'hunter', label: 'HUNTER', Icon: Crosshair, route: '/hunter' },
  { id: 'recon',  label: 'RECON',  Icon: Eye,       route: '/recon'  },
  { id: 'sniper', label: 'SNIPER', Icon: Target,    route: '/sniper' },
];

/* ─── Main component ─────────────────────────────────────────────────────── */
export default function UserSettings() {
  const T = useT();
  const { themeId } = useThemeCtx();
  const navigate = useNavigate();
  const location = useLocation();

  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const [activeTab, setActiveTab] = useState('account');
  const [subNavOpen, setSubNavOpen] = useState(
    () => localStorage.getItem('settings_subnav_collapsed') !== 'true'
  );

  /* ── account ── */
  const user = auth.currentUser;
  const userInitials = (user?.email || 'SE').slice(0, 2).toUpperCase();
  const [pwResetSent, setPwResetSent]     = useState(false);
  const [pwResetLoading, setPwResetLoading] = useState(false);
  const [pwResetError, setPwResetError]   = useState(null);

  /* ── billing ── */
  const [billing, setBilling]             = useState(null);
  const [billingLoading, setBillingLoading] = useState(true);

  /* ── gmail ── */
  const [gmailStatus, setGmailStatus]     = useState(null);
  const [gmailEmail, setGmailEmail]       = useState('');
  const [gmailLoading, setGmailLoading]   = useState(true);
  const [gmailAction, setGmailAction]     = useState(null);
  const [gmailError, setGmailError]       = useState(null);

  /* ── google calendar ── */
  const [calStatus, setCalStatus]         = useState(null);
  const [calEmail, setCalEmail]           = useState('');
  const [calLoading, setCalLoading]       = useState(true);
  const [calAction, setCalAction]         = useState(null);
  const [calError, setCalError]           = useState(null);

  /* ── sounds ── */
  const { soundEnabled, setSoundEnabled } = useMissionSounds();

  /* ── MFA ── */
  const [mfaEnrolled, setMfaEnrolled]     = useState(false);
  const [mfaFactors, setMfaFactors]       = useState([]);
  const [mfaEnrolling, setMfaEnrolling]   = useState(false);
  const [mfaTotpSecret, setMfaTotpSecret] = useState(null);
  const [mfaTotpUri, setMfaTotpUri]       = useState('');
  const [mfaSecretKey, setMfaSecretKey]   = useState('');
  const [mfaCode, setMfaCode]             = useState('');
  const [mfaLoading, setMfaLoading]       = useState(false);
  const [mfaError, setMfaError]           = useState('');
  const [mfaSuccess, setMfaSuccess]       = useState('');

  useEffect(() => {
    loadGmailStatus();
    loadCalendarStatus();
    loadBilling();
    refreshMfaStatus();
    // Auto-switch to integrations tab if redirected from Calendar OAuth
    const params = new URLSearchParams(window.location.search);
    if (params.get('calendar_connected') === 'true') {
      setActiveTab('integrations');
    }
  }, []);

  async function loadBilling() {
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        const d = snap.data();
        setBilling({
          tier:             d.subscriptionTier  || 'starter',
          creditsTotal:     d.monthlyCredits    || PLAN_CREDITS[d.subscriptionTier] || 400,
          creditsUsed:      (d.credits?.used)   ?? (PLAN_CREDITS[d.subscriptionTier] || 400) - (d.credits?.remaining ?? d.credits ?? 0),
          creditsRemaining: (d.credits?.remaining) ?? (d.credits || 0),
          billingDate:      d.billingDate        || null,
          nextBillingDate:  d.nextBillingDate    || null,
          stripeCustomerId: d.stripeCustomerId   || null,
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

  async function loadCalendarStatus() {
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, 'users', user.uid, 'integrations', 'googleCalendar'));
      if (snap.exists()) {
        const d = snap.data();
        setCalStatus(d.status === 'connected' ? 'connected' : 'disconnected');
        setCalEmail(d.email || '');
      } else {
        setCalStatus('disconnected');
      }
    } catch (err) {
      console.error('[UserSettings] loadCalendarStatus error:', err);
      setCalStatus('disconnected');
    } finally {
      setCalLoading(false);
    }
  }

  async function handleConnectCalendar() {
    setCalAction('connecting');
    setCalError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/.netlify/functions/calendar-oauth-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, authToken: token }),
      });
      if (!res.ok) throw new Error('Failed to initialize Calendar OAuth');
      const data = await res.json();
      window.location.href = data.authUrl;
    } catch (err) {
      setCalError(err.message);
      setCalAction(null);
    }
  }

  async function handleDisconnectCalendar() {
    setCalAction('disconnecting');
    setCalError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/.netlify/functions/calendar-disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, authToken: token }),
      });
      if (!res.ok) throw new Error('Failed to disconnect Google Calendar');
      setCalStatus('disconnected');
      setCalEmail('');
    } catch (err) {
      setCalError(err.message);
    } finally {
      setCalAction(null);
    }
  }

  function refreshMfaStatus() {
    setMfaEnrolled(isMfaEnrolled());
    setMfaFactors(getEnrolledFactors());
  }

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

  /* ─── Panel content ──────────────────────────────────────────────────── */
  function renderPanel() {
    return (
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
                    {pwResetSent ? 'Reset link sent — check your inbox' : 'We\'ll email you a secure link to reset your password'}
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
              {mfaError && (
                <div className="us-feedback us-feedback--error">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{mfaError}
                </div>
              )}
              {mfaSuccess && (
                <div className="us-feedback us-feedback--success">
                  <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />{mfaSuccess}
                </div>
              )}
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
                  <button className="us-action-btn us-action-btn--primary" onClick={handleStartMfaEnrollment} disabled={mfaLoading}>
                    {mfaLoading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
                    Enable MFA
                  </button>
                </div>
              )}
              {mfaEnrolling && (
                <div className="us-mfa-setup">
                  <p className="us-mfa-step">Step 1 — Scan this QR code with your authenticator app</p>
                  <div className="us-mfa-qr">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(mfaTotpUri)}`}
                      alt="MFA QR Code" width="180" height="180"
                    />
                  </div>
                  <p className="us-mfa-step">Or enter this key manually</p>
                  <code className="us-mfa-secret">{mfaSecretKey}</code>
                  <p className="us-mfa-step" style={{ marginTop: '1.25rem' }}>Step 2 — Enter the 6-digit code</p>
                  <form onSubmit={handleVerifyMfa} className="us-mfa-form">
                    <input
                      type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
                      placeholder="000 000" value={mfaCode}
                      onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))}
                      className="us-mfa-input" required autoFocus
                    />
                    <div className="us-mfa-actions">
                      <button type="submit" className="us-action-btn us-action-btn--primary" disabled={mfaLoading || mfaCode.length !== 6}>
                        {mfaLoading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : null}
                        Verify & enable
                      </button>
                      <button type="button" className="us-action-btn" onClick={() => { setMfaEnrolling(false); setMfaTotpSecret(null); setMfaCode(''); }}>
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              )}
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
                  <button className="us-action-btn us-action-btn--danger" onClick={handleDisableMfa} disabled={mfaLoading}>
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
                  <span className="us-card-value us-card-value--muted">View and revoke active sessions across devices</span>
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
              <div className="us-loading-state"><Loader className="w-5 h-5 animate-spin" />Loading billing info…</div>
            ) : (
              <>
                <section className="us-section">
                  <h2 className="us-section-title">Current plan</h2>
                  <div className="us-billing-plan-card">
                    <div className="us-billing-plan-left">
                      <div className="us-billing-plan-badge">{PLAN_LABELS[billing?.tier] || 'Starter'}</div>
                      <span className="us-billing-plan-price">{PLAN_PRICES[billing?.tier] || '$20 / mo'}</span>
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
                        {billing?.creditsTotal ? Math.round(((billing.creditsRemaining ?? 0) / billing.creditsTotal) * 100) : 0}%
                      </span>
                    </div>
                    <div className="us-credit-bar-track">
                      <div className="us-credit-bar-fill" style={{
                        width: billing?.creditsTotal
                          ? `${Math.max(0, Math.min(100, ((billing.creditsRemaining ?? 0) / billing.creditsTotal) * 100))}%`
                          : '0%',
                      }} />
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
                        {billing?.billingDate ? new Date(billing.billingDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}
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
                        {billing?.nextBillingDate ? new Date(billing.nextBillingDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}
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
                      <span className="us-card-value us-card-value--muted">Self-serve invoice history via the Stripe customer portal</span>
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
              <div className={`us-card ${gmailStatus === 'connected' ? '' : 'us-card--action'}`}>
                <div className="us-card-icon" style={{ background: 'rgba(59,130,246,0.1)', borderColor: 'rgba(59,130,246,0.2)', color: '#93c5fd' }}>
                  <Mail className="w-4 h-4" />
                </div>
                <div className="us-card-body">
                  <div className="us-card-label-row">
                    <span className="us-card-label">Gmail</span>
                    {!gmailLoading && gmailStatus === 'connected' && (
                      <span className="us-status-chip us-status-chip--green"><CheckCircle className="w-3 h-3" /> Connected</span>
                    )}
                    {!gmailLoading && gmailStatus === 'disconnected' && (
                      <span className="us-status-chip us-status-chip--gray">Not connected</span>
                    )}
                  </div>
                  <span className="us-card-value us-card-value--muted">
                    {gmailLoading ? 'Loading…' : gmailStatus === 'connected' && gmailEmail ? gmailEmail : 'Send outreach directly from your Gmail account'}
                  </span>
                  {gmailError && (
                    <span className="us-inline-error"><AlertTriangle className="w-3 h-3" />{gmailError}</span>
                  )}
                </div>
                <div className="us-gmail-actions">
                  {gmailLoading ? (
                    <Loader className="w-4 h-4 animate-spin" style={{ color: '#6b7280' }} />
                  ) : gmailStatus === 'connected' ? (
                    <>
                      <button className="us-action-btn" onClick={handleConnectGmail} disabled={gmailAction !== null} title="Re-authorize Gmail">
                        {gmailAction === 'connecting' ? <Loader className="w-3.5 h-3.5 animate-spin" /> : null}
                        Reconnect
                      </button>
                      <button className="us-action-btn us-action-btn--danger-icon" onClick={handleDisconnectGmail} disabled={gmailAction !== null} title="Disconnect Gmail">
                        {gmailAction === 'disconnecting' ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                      </button>
                    </>
                  ) : (
                    <button className="us-action-btn us-action-btn--primary" onClick={handleConnectGmail} disabled={gmailAction !== null}>
                      {gmailAction === 'connecting' ? <><Loader className="w-3.5 h-3.5 animate-spin" /> Connecting…</> : 'Connect'}
                    </button>
                  )}
                </div>
              </div>
            </section>

              {/* Google Calendar card */}
              <div className={`us-card ${calStatus === 'connected' ? '' : 'us-card--action'}`} style={{ marginTop: '12px' }}>
                <div className="us-card-icon" style={{ background: 'rgba(52,211,153,0.1)', borderColor: 'rgba(52,211,153,0.2)', color: '#6ee7b7' }}>
                  <Calendar className="w-4 h-4" />
                </div>
                <div className="us-card-body">
                  <div className="us-card-label-row">
                    <span className="us-card-label">Google Calendar</span>
                    {!calLoading && calStatus === 'connected' && (
                      <span className="us-status-chip us-status-chip--green"><CheckCircle className="w-3 h-3" /> Connected</span>
                    )}
                    {!calLoading && calStatus === 'disconnected' && (
                      <span className="us-status-chip us-status-chip--gray">Not connected</span>
                    )}
                  </div>
                  <span className="us-card-value us-card-value--muted">
                    {calLoading ? 'Loading…' : calStatus === 'connected' && calEmail ? calEmail : 'Schedule meetings and view upcoming events with contacts'}
                  </span>
                  {calError && (
                    <span className="us-inline-error"><AlertTriangle className="w-3 h-3" />{calError}</span>
                  )}
                </div>
                <div className="us-gmail-actions">
                  {calLoading ? (
                    <Loader className="w-4 h-4 animate-spin" style={{ color: '#6b7280' }} />
                  ) : calStatus === 'connected' ? (
                    <>
                      <button className="us-action-btn" onClick={handleConnectCalendar} disabled={calAction !== null} title="Re-authorize Google Calendar">
                        {calAction === 'connecting' ? <Loader className="w-3.5 h-3.5 animate-spin" /> : null}
                        Reconnect
                      </button>
                      <button className="us-action-btn us-action-btn--danger-icon" onClick={handleDisconnectCalendar} disabled={calAction !== null} title="Disconnect Google Calendar">
                        {calAction === 'disconnecting' ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                      </button>
                    </>
                  ) : (
                    <button className="us-action-btn us-action-btn--primary" onClick={handleConnectCalendar} disabled={calAction !== null}>
                      {calAction === 'connecting' ? <><Loader className="w-3.5 h-3.5 animate-spin" /> Connecting…</> : 'Connect'}
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
                  role="switch" aria-checked={soundEnabled} aria-label="Mission sounds"
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
    );
  }

  /* ─── Mobile layout ──────────────────────────────────────────────────── */
  if (isMobile) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        height: '100dvh', width: '100%',
        background: T.appBg, fontFamily: 'Inter, system-ui, sans-serif',
        color: T.text, overflow: 'hidden',
      }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
          * { box-sizing: border-box; }
          button, input { font-family: Inter, system-ui, sans-serif; }
          ::-webkit-scrollbar { width: 3px; height: 3px; }
          ::-webkit-scrollbar-thumb { background: ${T.isDark ? '#333' : '#ccc'}; border-radius: 3px; }
          @keyframes twinkle { 0%,100%{opacity:0.2} 50%{opacity:0.05} }
          @keyframes fadeUp  { from{opacity:0;transform:translateY(6px)}  to{opacity:1;transform:translateY(0)} }
          input::placeholder { color: ${T.textFaint}; }
        `}</style>

        {/* Mobile top bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 14px', borderBottom: `1px solid ${T.border}`,
          background: T.railBg, flexShrink: 0, zIndex: 2,
        }}>
          <div
            onClick={() => navigate('/mission-control-v2')}
            title="Mission Control"
            style={{
              width: 28, height: 28, borderRadius: 7,
              background: `linear-gradient(135deg,${BRAND.pink},${BRAND.cyan})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, overflow: 'hidden', cursor: 'pointer',
              boxShadow: `0 2px 10px ${BRAND.pink}40`,
            }}
          >
            <img src={ASSETS.logoMark} alt="Mission Control"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '✦'; }}
            />
          </div>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: SETTINGS_ORANGE }}>Settings</div>
          <button
            onClick={() => navigate(-1)}
            style={{
              width: 30, height: 30, borderRadius: 8, border: `1px solid ${T.border2}`,
              background: T.surface, display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            <ArrowLeft size={14} color={T.textMuted} />
          </button>
          <ThemePicker />
        </div>

        {/* Mobile horizontal tab nav */}
        <div style={{
          display: 'flex', overflowX: 'auto', flexShrink: 0,
          background: T.navBg, borderBottom: `1px solid ${T.border}`,
          padding: '0 6px',
        }}>
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = activeTab === id;
            return (
              <div
                key={id}
                onClick={() => setActiveTab(id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '9px 12px', flexShrink: 0,
                  borderBottom: `2px solid ${active ? SETTINGS_ORANGE : 'transparent'}`,
                  color: active ? SETTINGS_ORANGE : T.textMuted,
                  fontSize: 12, fontWeight: active ? 600 : 400,
                  cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.12s',
                }}
              >
                <Icon size={12} />
                {label}
              </div>
            );
          })}
        </div>

        {/* Mobile main content */}
        <div style={{ flex: 1, overflowY: 'auto', position: 'relative', zIndex: 1 }}>
          {renderPanel()}
        </div>
      </div>
    );
  }

  /* ─── Desktop layout ─────────────────────────────────────────────────── */
  return (
    <div style={{
      display: 'flex', height: '100vh', width: '100%',
      background: T.appBg, fontFamily: 'Inter, system-ui, sans-serif',
      color: T.text, overflow: 'hidden', position: 'relative',
      transition: 'background 0.25s, color 0.25s',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        * { box-sizing: border-box; }
        button, input { font-family: Inter, system-ui, sans-serif; }
        ::-webkit-scrollbar { width: 3px; height: 3px; }
        ::-webkit-scrollbar-thumb { background: ${T.isDark ? '#333' : '#ccc'}; border-radius: 3px; }
        @keyframes twinkle  { 0%,100%{opacity:0.2} 50%{opacity:0.05} }
        @keyframes slideIn  { from{opacity:0;transform:translateX(10px)} to{opacity:1;transform:translateX(0)} }
        @keyframes slideUp  { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeUp   { from{opacity:0;transform:translateY(6px)}  to{opacity:1;transform:translateY(0)} }
        input::placeholder  { color: ${T.textFaint}; }
      `}</style>

      {T.particles && <Particles />}

      {/* ── ICON RAIL ── */}
      <div style={{
        width: 60, flexShrink: 0, background: T.railBg,
        borderRight: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        paddingTop: 13, paddingBottom: 13, gap: 3,
        position: 'relative', zIndex: 2, transition: 'background 0.25s',
      }}>
        {/* Logo mark → Mission Control */}
        <div
          onClick={() => navigate('/mission-control-v2')}
          title="Mission Control"
          style={{
            width: 34, height: 34, borderRadius: 9,
            background: `linear-gradient(135deg,${BRAND.pink},${BRAND.cyan})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 17, marginBottom: 16,
            boxShadow: `0 4px 18px ${BRAND.pink}50`, flexShrink: 0, overflow: 'hidden',
            cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; e.currentTarget.style.boxShadow = `0 6px 22px ${BRAND.pink}70`; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = `0 4px 18px ${BRAND.pink}50`; }}
        >
          <img src={ASSETS.logoMark} alt="Mission Control"
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '✦'; }}
          />
        </div>

        {/* Module icons */}
        {MODULE_RAIL.map(mod => (
          <div
            key={mod.id}
            onClick={() => { if (!mod.locked && mod.route) navigate(mod.route); }}
            title={mod.label}
            style={{
              width: 40, height: 40, borderRadius: 10,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              cursor: mod.locked ? 'not-allowed' : 'pointer',
              background: 'transparent',
              border: '1px solid transparent',
              gap: 1, transition: 'all 0.15s', marginBottom: 2,
              opacity: mod.locked ? 0.32 : 1,
            }}
            onMouseEnter={e => { if (!mod.locked) e.currentTarget.style.background = T.surface; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <mod.Icon size={14} color={T.textFaint} />
            <span style={{ fontSize: 7, letterSpacing: 0.5, color: T.textFaint, marginTop: 1 }}>
              {mod.label}
            </span>
          </div>
        ))}

        {/* Bottom: MC + Settings (active) + Theme + Barry */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'center' }}>
          <div
            onClick={() => navigate('/mission-control-v2')}
            title="Mission Control"
            style={{
              width: 40, height: 40, borderRadius: 10,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', gap: 1, transition: 'all 0.15s',
              background: 'transparent', border: '1px solid transparent',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = T.surface; e.currentTarget.style.border = `1px solid ${SETTINGS_ORANGE}40`; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.border = '1px solid transparent'; }}
          >
            <Home size={14} color={T.textFaint} />
            <span style={{ fontSize: 7, letterSpacing: 0.5, marginTop: 1, color: T.textFaint }}>MC</span>
          </div>
          {/* Settings — active */}
          <div
            title="SETTINGS"
            style={{
              width: 40, height: 40, borderRadius: 10,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              cursor: 'default', gap: 1,
              background: 'rgba(250,170,32,0.15)',
              border: `1px solid ${SETTINGS_ORANGE}`,
              boxShadow: `0 0 12px rgba(250,170,32,0.4)`,
            }}
          >
            <SettingsIcon size={14} color={SETTINGS_ORANGE} />
            <span style={{ fontSize: 7, letterSpacing: 0.5, marginTop: 1, color: SETTINGS_ORANGE }}>SET</span>
          </div>
          <ThemePicker />
          <div title="Barry AI" style={{ cursor: 'pointer' }}>
            <BarryAvatar size={34} style={{ boxShadow: `0 0 14px ${BRAND.cyan}50` }} />
          </div>
        </div>
      </div>

      {/* ── SUB-NAV (collapsible) ── */}
      <div style={{
        width: subNavOpen ? 190 : 0, flexShrink: 0, background: T.navBg,
        borderRight: subNavOpen ? `1px solid ${T.border}` : 'none',
        display: 'flex', flexDirection: 'column',
        position: 'relative', zIndex: 2,
        transition: 'width 0.2s ease, background 0.25s',
        overflow: 'hidden',
      }}>
        <div style={{ width: 190, display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Sub-nav header */}
          <div style={{
            padding: '13px 13px 9px',
            borderBottom: `1px solid ${T.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <div>
              <div style={{ fontSize: 9, letterSpacing: 2, color: SETTINGS_ORANGE, fontWeight: 700, marginBottom: 1 }}>
                SETTINGS
              </div>
              <div style={{ fontSize: 9, color: T.textFaint }}>{TABS.length} sections</div>
            </div>
            <div
              onClick={() => { setSubNavOpen(false); localStorage.setItem('settings_subnav_collapsed', 'true'); }}
              title="Collapse sidebar"
              style={{
                width: 22, height: 22, borderRadius: 6,
                background: T.surface, border: `1px solid ${T.border2}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              <ChevronLeft size={12} color={T.textFaint} />
            </div>
          </div>

          {/* Tab items */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 7px' }}>
            {TABS.map(({ id, label, icon: Icon }) => {
              const active = activeTab === id;
              return (
                <div
                  key={id}
                  onClick={() => setActiveTab(id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px',
                    borderRadius: 8, cursor: 'pointer', marginBottom: 1,
                    background: active ? `${SETTINGS_ORANGE}12` : 'transparent',
                    borderLeft: `2px solid ${active ? SETTINGS_ORANGE : 'transparent'}`,
                    transition: 'all 0.12s',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surface; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <Icon size={13} color={active ? SETTINGS_ORANGE : T.textFaint} style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, fontWeight: active ? 600 : 400,
                      color: active ? SETTINGS_ORANGE : T.textMuted,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {label}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* User footer */}
          <div style={{
            padding: '9px 11px', borderTop: `1px solid ${T.border}`,
            display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0,
          }}>
            <Av initials={userInitials} size={24} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.email || 'user@idynify.com'}
              </div>
              <div style={{ fontSize: 8, color: T.textFaint }}>
                {THEMES[themeId]?.label || 'Mission Control'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sub-nav expand button */}
      {!subNavOpen && (
        <div
          onClick={() => { setSubNavOpen(true); localStorage.setItem('settings_subnav_collapsed', 'false'); }}
          title="Expand sidebar"
          style={{
            position: 'absolute', left: 60, top: 13, zIndex: 3,
            width: 22, height: 22, borderRadius: '0 6px 6px 0',
            background: T.navBg, border: `1px solid ${T.border}`, borderLeft: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <ChevronRight size={12} color={T.textFaint} />
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        overflow: 'hidden', position: 'relative', zIndex: 1,
        transition: 'background 0.25s',
      }}>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {renderPanel()}
        </div>
      </div>
    </div>
  );
}
