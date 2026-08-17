/**
 * UserSettings — Settings module content.
 *
 * MIGRATED INTO THE GLOBAL SHELL. This was the last screen in the product
 * still carrying its own application chrome: a 60px icon rail listing every
 * module, a hand-built 190px sub-nav, a theme picker, a user footer and its
 * own BarryChat instance. Opening Settings from anywhere replaced the whole
 * shell — the wide sidebar vanished and the old compact rail took its place,
 * which is exactly the swap the shell migration existed to end.
 *
 * Settings now owns only what is Settings':
 *
 *   Global navigation  → MainLayout        (moves the user across Idynify)
 *   Module navigation  → ModuleSubNav      (changes the working view here)
 *
 * A NOTE ON THE SUB-NAV. The brief says Settings "does not need a sub-nav
 * panel — it is a single destination". It is a single destination, and it has
 * always had a 190px sub-nav panel with seven sections in it: Account,
 * Security, Billing, Integrations, Your Services, Hunter, Appearance. The
 * brief also says the existing sections stay exactly as they are, so the panel
 * stays and renders through the shared component like every other module's.
 * Deleting it would have removed seven sections; hand-keeping it would have
 * left the one panel in the product that does not match the others.
 *
 * Mobile keeps its original self-contained layout, the same as every migrated
 * module.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { sendPasswordResetEmail } from 'firebase/auth';
import { doc, getDoc, updateDoc, collection, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';
import {
  ArrowLeft, User, Users, Shield, CreditCard, Plug, Settings2,
  Volume2, VolumeX, Mail, CheckCircle, AlertTriangle,
  Loader, LogOut, Lock, Smartphone, BarChart3, Calendar,
  Key, Zap, ExternalLink, Layers, Briefcase, Plus, Star as StarIcon,
  RefreshCw, Star, MessageSquare, Share2,
  Palette, Check, Clock,
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
import ModuleSubNav from '../components/layout/ModuleSubNav';
import { displayNameFor } from '../utils/userIdentity';
import { useShell } from '../context/ShellContext';
import ServiceProfileSetup from '../components/serviceProfiles/ServiceProfileSetup';
import './UserSettings.css';

/* ─── accent ─────────────────────────────────────────────────────────────── */
const SETTINGS_ORANGE  = '#faaa20';
const SETTINGS_ORANGE2 = '#f59e0b';

/* ─── constants ─────────────────────────────────────────────────────────── */
const TABS = [
  { id: 'account',      label: 'Account',       icon: User      },
  { id: 'security',     label: 'Security',       icon: Shield    },
  { id: 'billing',      label: 'Billing',        icon: CreditCard },
  { id: 'integrations', label: 'Integrations',   icon: Plug      },
  { id: 'services',     label: 'Your Services',  icon: Briefcase },
  { id: 'hunter',       label: 'Hunter',         icon: Settings2 },
  { id: 'appearance',   label: 'Appearance',     icon: Palette   },
];

/**
 * The same seven sections, in the shape ModuleSubNav takes.
 *
 * The old panel showed labels only — every other module's panel shows a short
 * description under each one, so the sections gained them here rather than
 * Settings being the one panel that reads differently. TABS itself is
 * unchanged, because the mobile tab strip renders from it.
 */
const SETTINGS_SECTIONS = [
  { id: 'account',      label: 'Account',      Icon: User,       desc: 'Profile and booking link' },
  { id: 'security',     label: 'Security',     Icon: Shield,     desc: 'Password and two-factor' },
  { id: 'billing',      label: 'Billing',      Icon: CreditCard, desc: 'Plan and credits' },
  { id: 'integrations', label: 'Integrations', Icon: Plug,       desc: 'Gmail, calendar and CRM' },
  { id: 'services',     label: 'Your Services', Icon: Briefcase, desc: 'What you sell' },
  { id: 'hunter',       label: 'Hunter',       Icon: Settings2,  desc: 'Outreach defaults' },
  { id: 'appearance',   label: 'Appearance',   Icon: Palette,    desc: 'Themes and mission sounds' },
];

const PLAN_LABELS  = { starter: 'Starter', pro: 'Pro' };
const PLAN_PRICES  = { starter: '$20 / mo', pro: '$50 / mo' };
const PLAN_CREDITS = { starter: 400, pro: 1250 };

const INTEGRATION_STUBS = [
  { id: 'hubspot',    name: 'HubSpot',     desc: 'Two-way CRM sync for contacts & deals', color: '#f97316', icon: Layers      },
  { id: 'salesforce', name: 'Salesforce',  desc: 'Enterprise CRM pipeline integration',   color: '#38bdf8', icon: Star        },
  { id: 'slack',      name: 'Slack',       desc: 'Mission alerts and team notifications',  color: '#a78bfa', icon: MessageSquare },
  { id: 'zapier',     name: 'Zapier',      desc: 'Connect 5000+ apps via automation',     color: '#f59e0b', icon: Zap         },
  { id: 'linkedin',   name: 'LinkedIn',    desc: 'Export contacts and track engagement',   color: '#0ea5e9', icon: Share2      },
];

const HUNTER_STUBS = [
  { label: 'Sequence timing',  desc: 'Set default days between follow-up steps'           },
  { label: 'Follow-up limit',  desc: 'Maximum steps per contact before archiving'          },
  { label: "Barry's tone",     desc: 'Formal, direct, or conversational messaging style'   },
  { label: 'Auto-archive',     desc: 'Automatically archive contacts after final step'     },
];

/* ─── ThemePicker ─────────────────────────────────────────────────────────
   Mobile only. The desktop copy went with the rest of the rail — on desktop
   the theme lives in the top bar's user menu (one click, light ⇄ dark) and in
   the Appearance section below (the full set). */
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

/* ─── AppearancePanel ────────────────────────────────────────────────────── */
function AppearancePanel() {
  const T = useT();
  const { themeId, setThemeId } = useThemeCtx();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const allThemes = Object.values(THEMES);
  const coreThemes = allThemes.filter(t => !t.starWars);
  const swThemes = allThemes.filter(t => t.starWars);

  async function handleSave() {
    setSaving(true);
    await setThemeId(themeId); // re-triggers Firestore write
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function ThemeCard({ theme }) {
    const active = themeId === theme.id;
    return (
      <div
        onClick={() => setThemeId(theme.id)}
        style={{
          position: 'relative',
          borderRadius: 14,
          overflow: 'hidden',
          cursor: 'pointer',
          border: `2px solid ${active ? SETTINGS_ORANGE : T.border2}`,
          boxShadow: active
            ? `0 0 0 3px ${SETTINGS_ORANGE}30, 0 4px 20px ${SETTINGS_ORANGE}20`
            : `0 2px 8px ${T.isDark ? '#00000040' : '#00000010'}`,
          transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.15s',
          transform: active ? 'scale(1.02)' : 'scale(1)',
          background: T.cardBg,
        }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = T.border2; }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = T.border2; }}
      >
        {/* Swatch preview */}
        <div style={{
          height: 72, background: theme.swatchBg,
          position: 'relative', overflow: 'hidden',
        }}>
          {/* Mini color dots */}
          <div style={{
            position: 'absolute', bottom: 8, left: 10,
            display: 'flex', gap: 5, alignItems: 'center',
          }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', background: theme.accent, boxShadow: `0 0 6px ${theme.accent}80` }} />
            <div style={{ width: 14, height: 14, borderRadius: '50%', background: theme.cyan,   boxShadow: `0 0 6px ${theme.cyan}60` }} />
            <div style={{ width: 20, height: 8,  borderRadius: 4,     background: theme.text + '60' }} />
          </div>
          {/* Star Wars badge */}
          {theme.starWars && (
            <div style={{
              position: 'absolute', top: 7, right: 7,
              background: 'linear-gradient(135deg,#cc0000,#8b00cc)',
              borderRadius: 6, padding: '2px 7px',
              fontSize: 9, fontWeight: 700, color: '#fff',
              fontFamily: 'Orbitron, sans-serif',
              letterSpacing: 0.5,
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}>
              ⚡ STAR WARS
            </div>
          )}
          {/* Active check */}
          {active && (
            <div style={{
              position: 'absolute', top: 7, left: 7,
              width: 20, height: 20, borderRadius: '50%',
              background: SETTINGS_ORANGE,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 0 8px ${SETTINGS_ORANGE}80`,
            }}>
              <Check size={11} color="#000" />
            </div>
          )}
        </div>

        {/* Card body */}
        <div style={{ padding: '10px 12px 12px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3,
          }}>
            <span style={{ fontSize: 14 }}>{theme.icon}</span>
            <span style={{
              fontSize: 12, fontWeight: 700,
              color: active ? SETTINGS_ORANGE : T.text,
            }}>
              {theme.label}
            </span>
          </div>
          {theme.description && (
            <div style={{ fontSize: 10, color: T.textFaint, lineHeight: 1.4 }}>
              {theme.description}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="us-section-stack">
      {/* Core themes */}
      <section className="us-section">
        <h2 className="us-section-title">Themes</h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
          gap: 12,
          marginTop: 4,
        }}>
          {coreThemes.map(theme => <ThemeCard key={theme.id} theme={theme} />)}
        </div>
      </section>

      {/* Star Wars themes */}
      <section className="us-section">
        <h2 className="us-section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Star Wars Themes</span>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: 1,
            padding: '2px 8px', borderRadius: 5,
            background: 'linear-gradient(135deg,#cc0000,#8b00cc)',
            color: '#fff', fontFamily: 'Orbitron, sans-serif',
          }}>⚡ FORCE</span>
        </h2>
        <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 12 }}>
          May the Force be with your workflow.
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
          gap: 12,
        }}>
          {swThemes.map(theme => <ThemeCard key={theme.id} theme={theme} />)}
        </div>
      </section>

      {/* Save button */}
      <section className="us-section">
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 22px', borderRadius: 10,
            background: saved
              ? `${SETTINGS_ORANGE}20`
              : `linear-gradient(135deg,${SETTINGS_ORANGE},${SETTINGS_ORANGE2})`,
            border: `1px solid ${saved ? SETTINGS_ORANGE : 'transparent'}`,
            color: saved ? SETTINGS_ORANGE : '#000',
            fontWeight: 700, fontSize: 13, cursor: saving ? 'default' : 'pointer',
            transition: 'all 0.2s',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saved
            ? <><CheckCircle size={14} /> Preferences saved</>
            : saving
              ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
              : <><Palette size={14} /> Save Preferences</>
          }
        </button>
        <div style={{ fontSize: 10, color: T.textFaint, marginTop: 7 }}>
          Theme choice is saved to your profile and syncs across all devices.
        </div>
      </section>
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */
export default function UserSettings() {
  const T = useT();
  const { updateDisplayName } = useShell();

  const mql = window.matchMedia('(max-width: 768px)');
  const [isMobile, setIsMobile] = useState(() => mql.matches);
  useEffect(() => {
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  /**
   * The active section comes from the URL, like every other module's.
   *
   * It used to be local state, which was fine while the only way to change it
   * was the sub-nav panel sitting right there. Mobile's bottom bar navigates,
   * so the section has to be addressable — and making it addressable also
   * means a Settings link can now point at a section, refresh keeps you where
   * you were, and Back steps through sections instead of leaving Settings.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab = TABS.some(t => t.id === tabParam) ? tabParam : 'account';

  const setActiveTab = useCallback((id) => {
    setSearchParams(id === 'account' ? {} : { tab: id });
  }, [setSearchParams]);

  /* ── account ── */
  const user = auth.currentUser;
  const [pwResetSent, setPwResetSent]     = useState(false);
  const [pwResetLoading, setPwResetLoading] = useState(false);
  const [pwResetError, setPwResetError]   = useState(null);

  /* ── display name ── */
  const [displayName, setDisplayName]           = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [displayNameSaving, setDisplayNameSaving] = useState(false);
  const [displayNameSaved, setDisplayNameSaved]   = useState(false);

  /* ── booking link ── */
  const [bookingLink, setBookingLink]         = useState('');
  const [bookingLinkInput, setBookingLinkInput] = useState('');
  const [bookingLinkSaving, setBookingLinkSaving] = useState(false);

  /* ── service profiles ── */
  const [serviceProfiles, setServiceProfiles] = useState([]);
  const [serviceProfilesLoading, setServiceProfilesLoading] = useState(false);
  const [showServiceSetup, setShowServiceSetup] = useState(false);
  const [bookingLinkSaved, setBookingLinkSaved]   = useState(false);

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
    loadProfile();
    refreshMfaStatus();
    // Auto-switch to integrations if redirected back from Calendar OAuth.
    const params = new URLSearchParams(window.location.search);
    if (params.get('calendar_connected') === 'true' && !params.get('tab')) {
      setActiveTab('integrations');
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'services') loadServiceProfiles();
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadServiceProfiles() {
    if (!user) return;
    setServiceProfilesLoading(true);
    try {
      const snap = await getDocs(collection(db, 'users', user.uid, 'serviceProfiles'));
      const profiles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      profiles.sort((a, b) => {
        if (a.isDefault) return -1;
        if (b.isDefault) return 1;
        const aT = a.createdAt?.toMillis?.() ?? 0;
        const bT = b.createdAt?.toMillis?.() ?? 0;
        return aT - bT;
      });
      setServiceProfiles(profiles);
    } catch (err) {
      console.warn('[UserSettings] loadServiceProfiles failed:', err.message);
    } finally {
      setServiceProfilesLoading(false);
    }
  }

  async function handleSetServiceDefault(profileId) {
    if (!user) return;
    const batch = writeBatch(db);
    serviceProfiles.forEach(p => {
      batch.update(doc(db, 'users', user.uid, 'serviceProfiles', p.id), {
        isDefault: p.id === profileId,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
    setServiceProfiles(prev => prev.map(p => ({ ...p, isDefault: p.id === profileId })));
  }

  async function handleDeleteServiceProfile(profileId) {
    if (!user) return;
    const { deleteDoc } = await import('firebase/firestore');
    await deleteDoc(doc(db, 'users', user.uid, 'serviceProfiles', profileId));
    setServiceProfiles(prev => prev.filter(p => p.id !== profileId));
  }

  /**
   * Display name and booking link come out of the same user document, so they
   * share one read rather than fetching it twice.
   */
  async function loadProfile() {
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists()) return;
      const data = snap.data();

      const link = data.bookingLink || '';
      setBookingLink(link);
      setBookingLinkInput(link);

      const name = data.displayName || '';
      setDisplayName(name);
      setDisplayNameInput(name);
    } catch { /* non-blocking */ }
  }

  async function handleSaveDisplayName() {
    if (displayNameSaving) return;
    const next = displayNameInput.trim();
    setDisplayNameSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), { displayName: next });
      setDisplayName(next);
      // Tell the shell, so the top bar and drawer update now rather than on
      // the next reload. App reads users/{uid} once, when auth resolves.
      updateDisplayName(next);
      setDisplayNameSaved(true);
      setTimeout(() => setDisplayNameSaved(false), 2500);
    } catch (err) {
      console.error('[UserSettings] Failed to save display name:', err);
    } finally {
      setDisplayNameSaving(false);
    }
  }

  async function handleSaveBookingLink() {
    if (bookingLinkSaving) return;
    setBookingLinkSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), { bookingLink: bookingLinkInput.trim() });
      setBookingLink(bookingLinkInput.trim());
      setBookingLinkSaved(true);
      setTimeout(() => setBookingLinkSaved(false), 2500);
    } catch { /* non-blocking */ }
    finally { setBookingLinkSaving(false); }
  }

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

              {/* Display name. THE canonical name field — the top bar, the
                  mobile drawer and anywhere else that greets the user read
                  users/{uid}.displayName first.

                  Until this existed there was nowhere in the product to set a
                  name, which is why every surface printed the raw email
                  address. Leaving it blank is fine and supported: the name
                  falls back to one derived from the email, which is what
                  everyone sees today. */}
              <div className="us-card">
                <div className="us-card-icon" style={{ background: 'rgba(139,92,246,0.12)', borderColor: 'rgba(139,92,246,0.2)', color: '#c4b5fd' }}>
                  <User className="w-4 h-4" />
                </div>
                <div className="us-card-body" style={{ flex: 1 }}>
                  <label className="us-card-label" htmlFor="us-display-name">Display name</label>
                  <span className="us-card-value us-card-value--muted">
                    How you appear across Idynify. Leave blank to use{' '}
                    {displayNameFor({ email: user?.email }) || 'a name from your email'}.
                  </span>
                  <input
                    id="us-display-name"
                    type="text"
                    maxLength={60}
                    placeholder={displayNameFor({ email: user?.email }) || 'Your name'}
                    value={displayNameInput}
                    onChange={e => setDisplayNameInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveDisplayName(); }}
                    style={{
                      marginTop: '0.5rem',
                      width: '100%',
                      padding: '0.45rem 0.7rem',
                      fontSize: '0.82rem',
                      borderRadius: '8px',
                      border: '1px solid rgba(139,92,246,0.3)',
                      background: 'rgba(139,92,246,0.05)',
                      color: 'inherit',
                      outline: 'none',
                    }}
                  />
                </div>
                <button
                  className={`us-action-btn ${displayNameSaved ? 'us-action-btn--done' : 'us-action-btn--primary'}`}
                  onClick={handleSaveDisplayName}
                  aria-label="Save display name"
                  disabled={displayNameSaving || displayNameInput.trim() === displayName}
                  style={{ alignSelf: 'flex-end', flexShrink: 0 }}
                >
                  {displayNameSaving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : displayNameSaved ? <CheckCircle className="w-3.5 h-3.5" /> : null}
                  {displayNameSaved ? 'Saved' : 'Save'}
                </button>
              </div>

              <div className="us-card">
                <div className="us-card-icon" style={{ background: 'rgba(139,92,246,0.12)', borderColor: 'rgba(139,92,246,0.2)', color: '#c4b5fd' }}>
                  <Mail className="w-4 h-4" />
                </div>
                <div className="us-card-body">
                  <span className="us-card-label">Email address</span>
                  <span className="us-card-value">{user?.email || '—'}</span>
                </div>
              </div>
            </section>

            <section className="us-section">
              <h2 className="us-section-title">Booking Link</h2>
              <div className="us-card">
                <div className="us-card-icon" style={{ background: 'rgba(250,170,32,0.12)', borderColor: 'rgba(250,170,32,0.25)', color: '#faaa20' }}>
                  <Calendar className="w-4 h-4" />
                </div>
                <div className="us-card-body" style={{ flex: 1 }}>
                  <span className="us-card-label">Your scheduling link</span>
                  <span className="us-card-value us-card-value--muted">
                    Calendly, Cal.com, or any booking URL — share it with contacts in one click
                  </span>
                  <input
                    type="url"
                    placeholder="https://calendly.com/yourname"
                    value={bookingLinkInput}
                    onChange={e => setBookingLinkInput(e.target.value)}
                    style={{
                      marginTop: '0.5rem',
                      width: '100%',
                      padding: '0.45rem 0.7rem',
                      fontSize: '0.82rem',
                      borderRadius: '8px',
                      border: '1px solid rgba(250,170,32,0.3)',
                      background: 'rgba(250,170,32,0.05)',
                      color: 'inherit',
                      outline: 'none',
                    }}
                  />
                </div>
                <button
                  className={`us-action-btn ${bookingLinkSaved ? 'us-action-btn--done' : 'us-action-btn--primary'}`}
                  onClick={handleSaveBookingLink}
                  aria-label="Save booking link"
                  disabled={bookingLinkSaving || bookingLinkInput === bookingLink}
                  style={{ alignSelf: 'flex-end', flexShrink: 0 }}
                >
                  {bookingLinkSaving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : bookingLinkSaved ? <CheckCircle className="w-3.5 h-3.5" /> : null}
                  {bookingLinkSaved ? 'Saved' : 'Save'}
                </button>
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

            <section className="us-section">
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

        {/* ══ APPEARANCE ══ */}
        {activeTab === 'appearance' && (
          <AppearancePanel />
        )}

        {/* ══ YOUR SERVICES ══ */}
        {activeTab === 'services' && (
          <div className="us-section-stack">
            <section className="us-section">
              <div className="us-section-header">
                <h2 className="us-section-title">Your Services</h2>
                <button
                  className="us-action-btn us-action-btn--primary"
                  onClick={() => setShowServiceSetup(true)}
                  disabled={serviceProfiles.length >= 5}
                  title={serviceProfiles.length >= 5 ? 'Maximum of 5 service profiles reached' : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
                >
                  <Plus style={{ width: 13, height: 13 }} />
                  Add Service
                </button>
              </div>
              <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0 0 0.75rem', lineHeight: 1.5 }}>
                Barry uses these when crafting first-touch outreach. Each profile has its own value prop, pain points, and positioning so Barry stays relevant for every service you offer.
                {serviceProfiles.length >= 5 && <span style={{ color: '#f59e0b' }}> Maximum of 5 reached.</span>}
              </p>

              {serviceProfilesLoading && (
                <div style={{ color: '#64748b', fontSize: '0.8125rem', padding: '1rem 0' }}>Loading…</div>
              )}

              {!serviceProfilesLoading && serviceProfiles.length === 0 && (
                <div className="us-card us-card--muted" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                    <Briefcase style={{ width: 16, height: 16, color: '#475569' }} />
                    <span className="us-card-label" style={{ color: '#64748b' }}>No service profiles yet</span>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#475569', margin: 0 }}>
                    Add your first service and Barry will use it to craft more relevant outreach. Takes under 10 minutes.
                  </p>
                </div>
              )}

              {serviceProfiles.map(profile => (
                <div key={profile.id} className={`us-card${profile.isDefault ? ' us-service-card--default' : ''}`} style={{ alignItems: 'flex-start', gap: '0.875rem', padding: '0.875rem 1rem' }}>
                  <div className="us-card-icon" style={{ background: profile.isDefault ? 'rgba(250,170,32,0.12)' : 'rgba(99,102,241,0.08)', borderColor: profile.isDefault ? 'rgba(250,170,32,0.3)' : 'rgba(99,102,241,0.15)', color: profile.isDefault ? '#faaa20' : '#a5b4fc', marginTop: '0.125rem' }}>
                    <Briefcase style={{ width: 16, height: 16 }} />
                  </div>
                  <div className="us-card-body" style={{ gap: '0.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="us-card-label">{profile.name || 'Unnamed service'}</span>
                      {profile.isDefault && (
                        <span style={{ fontSize: '0.625rem', fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'rgba(250,170,32,0.15)', color: '#faaa20', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Default</span>
                      )}
                    </div>
                    <span className="us-card-value us-card-value--muted" style={{ WebkitLineClamp: 2, overflow: 'hidden', display: '-webkit-box', WebkitBoxOrient: 'vertical' }}>
                      {profile.description || '—'}
                    </span>
                    {profile.primaryBuyer && (
                      <span style={{ fontSize: '0.6875rem', color: '#475569' }}>Buyer: {profile.primaryBuyer}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', flexShrink: 0 }}>
                    {!profile.isDefault && (
                      <button
                        className="us-action-btn"
                        onClick={() => handleSetServiceDefault(profile.id)}
                        style={{ fontSize: '0.6875rem', whiteSpace: 'nowrap' }}
                      >
                        Set default
                      </button>
                    )}
                    <button
                      className="us-action-btn us-action-btn--danger"
                      onClick={() => handleDeleteServiceProfile(profile.id)}
                      style={{ fontSize: '0.6875rem' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
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
                Per-user sequence settings and Barry's tone controls are on the roadmap.
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

  /* ─── Mobile ────────────────────────────────────────────────────────────
     Content only, like every module. Settings used to render its own top bar
     (logo, back arrow, theme picker) and a horizontal strip of its seven
     sections — the last such strip in the product. The shell's bottom bar
     carries the sections now. */
  if (isMobile) {
    return (
      <div className="module-mobile">
        {renderPanel()}
        {showServiceSetup && (
          <ServiceProfileSetup
            onComplete={() => { setShowServiceSetup(false); loadServiceProfiles(); }}
            onDismiss={() => setShowServiceSetup(false)}
          />
        )}
      </div>
    );
  }

  /* ─── Desktop ──────────────────────────────────────────────────────────
     Layer 1 (the sidebar) is the shell's. Layer 2 — this panel — is
     Settings', and is the same component every module renders. */
  return (
    <div className="module-shell">
      <ModuleSubNav
        title="SETTINGS"
        tagline="Account, security, billing and appearance"
        items={SETTINGS_SECTIONS}
        activeId={activeTab}
        onSelect={setActiveTab}
        storageKey="settings_subnav_collapsed"
      />

      <div className="module-workspace">
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {renderPanel()}
        </div>
      </div>

      {showServiceSetup && (
        <ServiceProfileSetup
          onComplete={() => { setShowServiceSetup(false); loadServiceProfiles(); }}
          onDismiss={() => setShowServiceSetup(false)}
        />
      )}
    </div>
  );
}
