/**
 * REFERRAL HUB
 *
 * Three-direction referral ledger for a contact:
 *   Tab 1 — Referred to Me: people this contact has sent your way
 *   Tab 2 — Referred Out:   people you've introduced to this contact
 *   Tab 3 — Asked For:      intros you've specifically requested
 *
 * Also surfaces Barry's Phase 1 network scan (contacts already in Idynify
 * that match your ICP and connect to this contact via overlap signals).
 *
 * Phase 2 (CSV upload) — LinkedIn import button wired in this sprint.
 * Phase 3 (LinkedIn OAuth) — future sprint.
 */

import { useState, useEffect, useCallback } from 'react';
import { Users, ArrowRight, GitBranch, Plus, ChevronRight, CheckCircle, Clock, XCircle, Zap, Upload } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';
import {
  getContactReferralAnalytics,
  recordReferralReceived,
  recordReferralSent,
  recordReferralAskedFor,
  detectReferralOpportunities
} from '../../services/referralIntelligenceService';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import ReferralHealthPanel from './ReferralHealthPanel';

const TABS = [
  { id: 'referred_to_me', label: 'Referred to me' },
  { id: 'referred_out',   label: 'Referred out'   },
  { id: 'asked_for',      label: 'Asked for'       },
];

const ASKED_VIA_OPTIONS = ['Email', 'LinkedIn', 'Call', 'Text'];

// ── Status helpers ────────────────────────────────────────────────

function ReferralStatusBadge({ status }) {
  const configs = {
    pending:       { label: 'In Pipeline', bg: '#f59e0b18', color: '#f59e0b' },
    contacted:     { label: 'Intro Made',  bg: '#3b82f618', color: '#3b82f6' },
    converted:     { label: 'Converted',   bg: '#22c55e18', color: '#22c55e' },
    not_converted: { label: 'Not converted', bg: '#6b728018', color: '#6b7280' },
  };
  const cfg = configs[status] || configs.pending;
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20,
      background: cfg.bg, color: cfg.color,
    }}>
      {cfg.label}
    </span>
  );
}

function AskStatusBadge({ askStatus }) {
  const configs = {
    pending:     { label: 'Pending',     icon: <Clock size={10} />,       bg: '#f59e0b18', color: '#f59e0b' },
    declined:    { label: 'Declined',    icon: <XCircle size={10} />,     bg: '#dc262618', color: '#dc2626' },
    asked_again: { label: 'Asked Again', icon: <ArrowRight size={10} />,  bg: '#3b82f618', color: '#3b82f6' },
  };
  const cfg = configs[askStatus] || configs.pending;
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20,
      background: cfg.bg, color: cfg.color,
      display: 'inline-flex', alignItems: 'center', gap: 3,
    }}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

function formatRelativeDate(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date)) return null;
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7)  return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// ── Shared form styles ────────────────────────────────────────────

function inputStyle(T) {
  return {
    width: '100%', boxSizing: 'border-box',
    padding: '7px 10px', borderRadius: 8,
    border: `1px solid ${T.border}`, background: T.appBg,
    color: T.text, fontSize: 12, outline: 'none',
    fontFamily: 'inherit',
  };
}

function labelStyle(T) {
  return { fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' };
}

// ── Tab content components ────────────────────────────────────────

function ReferredToMeTab({ records, T }) {
  if (!records || records.length === 0) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center', color: T.textFaint, fontSize: 12 }}>
        No referrals logged yet. When this contact sends someone your way, log it here.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {records.map(r => (
        <div key={r.id} style={{
          padding: '12px 14px', borderRadius: 10,
          background: T.surface, border: `1px solid ${T.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
                {r.to_contact_name || 'Unnamed contact'}
              </div>
              {r.context && (
                <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{r.context}</div>
              )}
              {r.referral_value && (
                <div style={{ fontSize: 11, color: BRAND.pink, marginTop: 3, fontWeight: 600 }}>
                  {r.referral_value}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
              <ReferralStatusBadge status={r.status} />
              <span style={{ fontSize: 10, color: T.textFaint }}>
                {formatRelativeDate(r.referral_date || r.created_at)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReferredOutTab({ records, T }) {
  if (!records || records.length === 0) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center', color: T.textFaint, fontSize: 12 }}>
        No outbound referrals logged. When you intro someone to this contact, log it here.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {records.map(r => (
        <div key={r.id} style={{
          padding: '12px 14px', borderRadius: 10,
          background: T.surface, border: `1px solid ${T.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
                {r.to_contact_name || 'Unnamed contact'}
              </div>
              {r.context && (
                <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{r.context}</div>
              )}
              {r.referral_value && (
                <div style={{ fontSize: 11, color: BRAND.pink, marginTop: 3, fontWeight: 600 }}>
                  {r.referral_value}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
              <ReferralStatusBadge status={r.status} />
              <span style={{ fontSize: 10, color: T.textFaint }}>
                {formatRelativeDate(r.referral_date || r.created_at)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AskedForTab({ records, T }) {
  if (!records || records.length === 0) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center', color: T.textFaint, fontSize: 12 }}>
        No intro requests logged yet. When you ask this contact for an introduction, log it here.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {records.map(r => (
        <div key={r.id} style={{
          padding: '12px 14px', borderRadius: 10,
          background: T.surface, border: `1px solid ${T.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
                {r.ask_target_name || 'Unnamed target'}
              </div>
              {(r.ask_target_title || r.ask_target_company) && (
                <div style={{ fontSize: 11, color: T.textMuted, marginTop: 1 }}>
                  {[r.ask_target_title, r.ask_target_company].filter(Boolean).join(' · ')}
                </div>
              )}
              {r.context && (
                <div style={{ fontSize: 11, color: T.textFaint, marginTop: 3, fontStyle: 'italic' }}>
                  "{r.context}"
                </div>
              )}
              {r.decline_reason && (
                <div style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>
                  Declined: {r.decline_reason}
                </div>
              )}
              {r.referral_value && (
                <div style={{ fontSize: 11, color: BRAND.pink, marginTop: 3, fontWeight: 600 }}>
                  {r.referral_value}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
              <AskStatusBadge askStatus={r.ask_status} />
              {r.icp_match_score != null && (
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  color: r.icp_match_score >= 85 ? '#22c55e' : '#f59e0b',
                }}>
                  {r.icp_match_score >= 85 ? `Hot · ${r.icp_match_score}%` : `Warm · ${r.icp_match_score}%`}
                </span>
              )}
              <span style={{ fontSize: 10, color: T.textFaint }}>
                {formatRelativeDate(r.asked_at || r.created_at)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── ICP Network Scan (Phase 1) ────────────────────────────────────

function NetworkScanSection({ contact, T, onOpenLinkedInImport }) {
  const [opportunities, setOpportunities] = useState(null);
  const [loading, setLoading] = useState(false);

  async function runScan() {
    const user = getEffectiveUser();
    if (!user) return;
    setLoading(true);
    try {
      const opps = await detectReferralOpportunities(user.uid);
      // Filter to opportunities where this contact is the introducer
      const relevant = opps.filter(o => o.introducer_id === contact.id);
      setOpportunities(relevant);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      marginTop: 16,
      padding: '14px 16px',
      background: `${BRAND.pink}08`,
      border: `1px solid ${BRAND.pink}25`,
      borderRadius: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Zap size={13} color={BRAND.pink} />
          <span style={{ fontSize: 12, fontWeight: 700, color: BRAND.pink }}>Barry · Network Scan</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {/* Phase 2: LinkedIn CSV import */}
          <button
            onClick={onOpenLinkedInImport}
            style={{
              fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 7,
              background: 'transparent', border: `1px solid ${BRAND.pink}40`,
              color: BRAND.pink, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <Upload size={10} /> Import LinkedIn
          </button>
          {opportunities === null && (
            <button
              onClick={runScan}
              disabled={loading}
              style={{
                fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 7,
                background: BRAND.pink, border: 'none', color: '#fff',
                cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Scanning...' : 'Scan Network →'}
            </button>
          )}
        </div>
      </div>

      {opportunities === null ? (
        <p style={{ fontSize: 11, color: '#e8197d99', margin: 0 }}>
          Barry will scan your contacts for ICP matches that {contact.first_name || contact.name?.split(' ')[0] || 'this contact'} could introduce you to.
        </p>
      ) : opportunities.length === 0 ? (
        <p style={{ fontSize: 11, color: '#e8197d99', margin: 0 }}>
          No ICP matches found in your current contacts. More matches surface as your network grows.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {opportunities.slice(0, 3).map((opp, i) => (
            <div key={i} style={{
              padding: '10px 12px', borderRadius: 9,
              background: '#fff1', border: `1px solid ${BRAND.pink}20`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text, #f0f0f0)' }}>
                  {opp.lead_name}
                </div>
                {opp.lead_company && (
                  <div style={{ fontSize: 10, color: '#9999aa', marginTop: 1 }}>{opp.lead_company}</div>
                )}
                {opp.overlap_reasons?.[0] && (
                  <div style={{ fontSize: 10, color: '#e8197d99', marginTop: 2 }}>
                    {opp.overlap_reasons[0]}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flex: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                  background: opp.overlap_score >= 5 ? '#22c55e18' : '#f59e0b18',
                  color: opp.overlap_score >= 5 ? '#22c55e' : '#f59e0b',
                }}>
                  {opp.overlap_score >= 5 ? 'Hot' : 'Warm'} · {opp.overlap_score * 10}%
                </span>
                <button style={{
                  fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
                  background: `${BRAND.pink}18`, border: `1px solid ${BRAND.pink}30`,
                  color: BRAND.pink, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 3,
                }}>
                  Ask <ChevronRight size={9} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────

export default function ReferralHub({ contact, onOpenLinkedInImport }) {
  const T = useT();
  const [activeTab, setActiveTab] = useState('referred_to_me');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Log form state
  const [logFormTab, setLogFormTab] = useState(null); // null | tab id
  const [logForm, setLogForm] = useState({
    // Referred to Me fields
    toContactName: '',
    // Referred Out fields
    referredToName: '',
    // Asked For fields
    targetName: '',
    targetCompany: '',
    targetTitle: '',
    askedVia: 'Email',
    // Shared
    context: '',
    referral_value: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const refreshData = useCallback(async () => {
    if (!contact?.id) return;
    const user = getEffectiveUser();
    if (!user) return;
    const d = await getContactReferralAnalytics(user.uid, contact.id).catch(() => null);
    if (d) setData(d);
  }, [contact?.id]);

  useEffect(() => {
    if (!contact?.id) return;
    const user = getEffectiveUser();
    if (!user) { setLoading(false); return; }

    let cancelled = false;
    setLoading(true);
    getContactReferralAnalytics(user.uid, contact.id)
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [contact?.id]);

  function openLogForm(tabId) {
    setLogFormTab(tabId);
    setLogForm({ toContactName: '', referredToName: '', targetName: '', targetCompany: '', targetTitle: '', askedVia: 'Email', context: '', referral_value: '' });
  }

  function closeLogForm() {
    setLogFormTab(null);
  }

  async function handleLogSubmit() {
    const user = getEffectiveUser();
    if (!user || !contact?.id || submitting) return;
    setSubmitting(true);

    try {
      if (logFormTab === 'referred_to_me') {
        await recordReferralReceived(user.uid, {
          fromContactId:   contact.id,
          fromContactName: contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
          toContactId:     null,
          toContactName:   logForm.toContactName.trim(),
          context:         logForm.context.trim() || null,
          referral_value:  logForm.referral_value.trim() || null,
        });
      } else if (logFormTab === 'referred_out') {
        await recordReferralSent(user.uid, {
          fromContactId:   contact.id,
          fromContactName: contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
          toContactId:     null,
          toContactName:   logForm.referredToName.trim(),
          context:         logForm.context.trim() || null,
          referral_value:  logForm.referral_value.trim() || null,
        });
      } else if (logFormTab === 'asked_for') {
        await recordReferralAskedFor(user.uid, {
          fromContactId:   contact.id,
          fromContactName: contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
          targetName:      logForm.targetName.trim(),
          targetCompany:   logForm.targetCompany.trim() || null,
          targetTitle:     logForm.targetTitle.trim() || null,
          askedVia:        logForm.askedVia,
          context:         logForm.context.trim() || null,
          referral_value:  logForm.referral_value.trim() || null,
        });
      }

      closeLogForm();
      await refreshData();
    } catch (err) {
      console.error('[ReferralHub] Log submit failed:', err);
    } finally {
      setSubmitting(false);
    }
  }

  function isSubmitDisabled() {
    if (submitting) return true;
    if (logFormTab === 'referred_to_me') return !logForm.toContactName.trim();
    if (logFormTab === 'referred_out')   return !logForm.referredToName.trim();
    if (logFormTab === 'asked_for')      return !logForm.targetName.trim();
    return false;
  }

  const tabCounts = {
    referred_to_me: data?.referred_to_me_records?.length ?? 0,
    referred_out:   data?.referred_out_records?.length   ?? 0,
    asked_for:      data?.asked_for_records?.length      ?? 0,
  };

  // ── Inline log forms ──────────────────────────────────────────

  function LogFormWrapper({ children }) {
    return (
      <div style={{
        marginTop: 14, padding: '14px 16px', borderRadius: 10,
        border: `1px solid ${BRAND.pink}30`, background: `${BRAND.pink}06`,
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {children}
        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          <button
            onClick={handleLogSubmit}
            disabled={isSubmitDisabled()}
            style={{
              flex: 1, padding: '7px 0', borderRadius: 8, border: 'none',
              background: isSubmitDisabled() ? `${BRAND.pink}50` : BRAND.pink,
              color: '#fff', fontSize: 12, fontWeight: 700,
              cursor: isSubmitDisabled() ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Logging...' : 'Log it'}
          </button>
          <button
            onClick={closeLogForm}
            style={{
              padding: '7px 14px', borderRadius: 8,
              border: `1px solid ${T.border}`, background: 'transparent',
              color: T.textMuted, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  function ReferredToMeForm() {
    return (
      <LogFormWrapper>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle(T)}>Who were you referred to? *</span>
          <input
            style={inputStyle(T)}
            placeholder="Their name"
            value={logForm.toContactName}
            onChange={e => setLogForm(f => ({ ...f, toContactName: e.target.value }))}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle(T)}>Context (optional)</span>
          <textarea
            style={{ ...inputStyle(T), resize: 'vertical', minHeight: 52 }}
            placeholder="Why did they send them your way?"
            value={logForm.context}
            onChange={e => setLogForm(f => ({ ...f, context: e.target.value }))}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle(T)}>Deal value (optional)</span>
          <input
            style={inputStyle(T)}
            placeholder="e.g. $4.8k/yr, $500 one-time, TBD"
            value={logForm.referral_value}
            onChange={e => setLogForm(f => ({ ...f, referral_value: e.target.value }))}
          />
        </div>
      </LogFormWrapper>
    );
  }

  function ReferredOutForm() {
    return (
      <LogFormWrapper>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle(T)}>Who did you refer them to? *</span>
          <input
            style={inputStyle(T)}
            placeholder="Recipient's name"
            value={logForm.referredToName}
            onChange={e => setLogForm(f => ({ ...f, referredToName: e.target.value }))}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle(T)}>Context (optional)</span>
          <textarea
            style={{ ...inputStyle(T), resize: 'vertical', minHeight: 52 }}
            placeholder="Why did you make this intro?"
            value={logForm.context}
            onChange={e => setLogForm(f => ({ ...f, context: e.target.value }))}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle(T)}>Deal value (optional)</span>
          <input
            style={inputStyle(T)}
            placeholder="e.g. $4.8k/yr, $500 one-time, TBD"
            value={logForm.referral_value}
            onChange={e => setLogForm(f => ({ ...f, referral_value: e.target.value }))}
          />
        </div>
      </LogFormWrapper>
    );
  }

  function AskedForForm() {
    return (
      <LogFormWrapper>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={labelStyle(T)}>Who do you want to meet? *</span>
            <input
              style={inputStyle(T)}
              placeholder="Their name"
              value={logForm.targetName}
              onChange={e => setLogForm(f => ({ ...f, targetName: e.target.value }))}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={labelStyle(T)}>Their company</span>
            <input
              style={inputStyle(T)}
              placeholder="Company"
              value={logForm.targetCompany}
              onChange={e => setLogForm(f => ({ ...f, targetCompany: e.target.value }))}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={labelStyle(T)}>Their title</span>
            <input
              style={inputStyle(T)}
              placeholder="Title"
              value={logForm.targetTitle}
              onChange={e => setLogForm(f => ({ ...f, targetTitle: e.target.value }))}
            />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={labelStyle(T)}>How did you ask?</span>
            <select
              style={{ ...inputStyle(T), appearance: 'none' }}
              value={logForm.askedVia}
              onChange={e => setLogForm(f => ({ ...f, askedVia: e.target.value }))}
            >
              {ASKED_VIA_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={labelStyle(T)}>Deal value (optional)</span>
            <input
              style={inputStyle(T)}
              placeholder="$4.8k/yr, TBD…"
              value={logForm.referral_value}
              onChange={e => setLogForm(f => ({ ...f, referral_value: e.target.value }))}
            />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle(T)}>Context (optional)</span>
          <textarea
            style={{ ...inputStyle(T), resize: 'vertical', minHeight: 52 }}
            placeholder="Why do you want this intro?"
            value={logForm.context}
            onChange={e => setLogForm(f => ({ ...f, context: e.target.value }))}
          />
        </div>
      </LogFormWrapper>
    );
  }

  // ── Log button ────────────────────────────────────────────────

  function LogButton({ tabId, label }) {
    if (logFormTab === tabId) return null;
    return (
      <button
        onClick={() => openLogForm(tabId)}
        style={{
          marginTop: 12, width: '100%', padding: '8px 0', borderRadius: 9,
          border: `1px dashed ${T.border}`, background: 'transparent',
          color: T.textMuted, fontSize: 11, fontWeight: 600,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          transition: 'border-color 0.15s, color 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = BRAND.pink; e.currentTarget.style.color = BRAND.pink; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textMuted; }}
      >
        <Plus size={11} /> {label}
      </button>
    );
  }

  return (
    <div style={{
      border: `1px solid ${T.border}`,
      borderRadius: 14,
      background: T.cardBg || T.surface,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px 0',
        borderBottom: `1px solid ${T.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <GitBranch size={14} color={T.textMuted} />
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Referral Hub</span>
          {loading && (
            <span style={{ fontSize: 10, color: T.textFaint }}>Loading...</span>
          )}
        </div>

        {/* Health metrics — shown once data is loaded */}
        {!loading && data && <ReferralHealthPanel data={data} />}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2 }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); closeLogForm(); }}
              style={{
                padding: '7px 12px',
                borderRadius: '8px 8px 0 0',
                border: 'none',
                background: activeTab === tab.id ? T.appBg : 'transparent',
                color: activeTab === tab.id ? T.text : T.textMuted,
                fontSize: 12,
                fontWeight: activeTab === tab.id ? 700 : 500,
                cursor: 'pointer',
                borderBottom: activeTab === tab.id ? `2px solid ${BRAND.pink}` : '2px solid transparent',
                transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              {tab.label}
              {tabCounts[tab.id] > 0 && (
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 20,
                  background: BRAND.pink, color: '#fff', lineHeight: 1.4,
                }}>
                  {tabCounts[tab.id]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ padding: '16px 18px' }}>
        {loading ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: T.textFaint, fontSize: 12 }}>
            Loading referral data...
          </div>
        ) : (
          <>
            {activeTab === 'referred_to_me' && (
              <>
                <ReferredToMeTab records={data?.referred_to_me_records} T={T} />
                <LogButton tabId="referred_to_me" label="Log referral received" />
                {logFormTab === 'referred_to_me' && <ReferredToMeForm />}
              </>
            )}
            {activeTab === 'referred_out' && (
              <>
                <ReferredOutTab records={data?.referred_out_records} T={T} />
                <LogButton tabId="referred_out" label="Log referral sent" />
                {logFormTab === 'referred_out' && <ReferredOutForm />}
              </>
            )}
            {activeTab === 'asked_for' && (
              <>
                <AskedForTab records={data?.asked_for_records} T={T} />
                <LogButton tabId="asked_for" label="Log intro request" />
                {logFormTab === 'asked_for' && <AskedForForm />}
              </>
            )}

            {/* Network scan — shown on asked_for tab */}
            {activeTab === 'asked_for' && (
              <NetworkScanSection
                contact={contact}
                T={T}
                onOpenLinkedInImport={onOpenLinkedInImport}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
