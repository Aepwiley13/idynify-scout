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
 * Phase 2 (CSV upload) and Phase 3 (LinkedIn OAuth) are future sprints.
 */

import { useState, useEffect } from 'react';
import { Users, ArrowRight, GitBranch, Plus, ChevronRight, CheckCircle, Clock, XCircle, Zap } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';
import {
  getContactReferralAnalytics,
  recordReferralAskedFor,
  detectReferralOpportunities
} from '../../services/referralIntelligenceService';
import { getEffectiveUser } from '../../context/ImpersonationContext';

const TABS = [
  { id: 'referred_to_me', label: 'Referred to me' },
  { id: 'referred_out',   label: 'Referred out'   },
  { id: 'asked_for',      label: 'Asked for'       },
];

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

function NetworkScanSection({ contact, T }) {
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

export default function ReferralHub({ contact }) {
  const T = useT();
  const [activeTab, setActiveTab] = useState('referred_to_me');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

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

  const tabCounts = {
    referred_to_me: data?.referred_to_me_records?.length ?? 0,
    referred_out:   data?.referred_out_records?.length   ?? 0,
    asked_for:      data?.asked_for_records?.length      ?? 0,
  };

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

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2 }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
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
              <ReferredToMeTab records={data?.referred_to_me_records} T={T} />
            )}
            {activeTab === 'referred_out' && (
              <ReferredOutTab records={data?.referred_out_records} T={T} />
            )}
            {activeTab === 'asked_for' && (
              <AskedForTab records={data?.asked_for_records} T={T} />
            )}

            {/* Network scan — shown on all tabs but most relevant in asked_for */}
            {activeTab === 'asked_for' && (
              <NetworkScanSection contact={contact} T={T} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
