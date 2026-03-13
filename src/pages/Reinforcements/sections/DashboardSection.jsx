/**
 * DashboardSection — Reinforcements overview dashboard.
 * Shows referral stats, recent activity, and quick actions.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, TrendingUp, Users, ArrowRightLeft, Award, RefreshCw, ChevronRight } from 'lucide-react';
import { useT } from '../../../theme/ThemeContext';
import { useActiveUser } from '../../../context/ImpersonationContext';
import { auth } from '../../../firebase/config';
import {
  getReferralLeaderboard,
  runReferralIntelligenceSweep
} from '../../../services/referralIntelligenceService';

const ACCENT = '#f59e0b'; // amber — Reinforcements identity

function StatCard({ icon: Icon, label, value, sub, color = ACCENT, T }) {
  return (
    <div style={{
      background: T.cardBg, border: `1px solid ${T.border2}`,
      borderRadius: 14, padding: '18px 20px',
      display: 'flex', alignItems: 'center', gap: 14,
      transition: 'all 0.15s',
    }}>
      <div style={{
        width: 42, height: 42, borderRadius: 11,
        background: `${color}15`, border: `1px solid ${color}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon size={18} color={color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: T.text, lineHeight: 1.1 }}>
          {value}
        </div>
        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: T.textFaint, marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

export default function DashboardSection() {
  const T = useT();
  const navigate = useNavigate();
  const activeUser = useActiveUser();
  const userId = activeUser?.uid || activeUser?.id || auth.currentUser?.uid;

  const [loading, setLoading] = useState(true);
  const [sweepData, setSweepData] = useState({ opportunities: [], overdueNurture: [] });
  const [leaderboard, setLeaderboard] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    if (!userId) return;
    try {
      const [sweep, board] = await Promise.all([
        runReferralIntelligenceSweep(userId),
        getReferralLeaderboard(userId),
      ]);
      setSweepData(sweep);
      setLeaderboard(board);
    } catch (err) {
      console.error('[Reinforcements] Dashboard load failed:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadData(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const totalReferrals = leaderboard.reduce((sum, s) => sum + s.total, 0);
  const totalConverted = leaderboard.reduce((sum, s) => sum + s.converted, 0);
  const avgConversion = totalReferrals > 0 ? Math.round((totalConverted / totalReferrals) * 100) : 0;
  const topSource = leaderboard[0];

  if (loading) {
    return (
      <div style={{ padding: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <div style={{ fontSize: 13, color: T.textFaint }}>Loading referral intelligence...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 900, animation: 'fadeUp 0.2s ease' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: T.text }}>Reinforcements</div>
          <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
            Your referral network at a glance
          </div>
        </div>
        <div
          onClick={handleRefresh}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 8,
            background: `${ACCENT}12`, border: `1px solid ${ACCENT}30`,
            cursor: 'pointer', fontSize: 12, fontWeight: 500, color: ACCENT,
            transition: 'all 0.15s',
          }}
        >
          <RefreshCw size={13} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          {refreshing ? 'Scanning...' : 'Scan network'}
        </div>
      </div>

      {/* Stats grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        gap: 12, marginBottom: 28,
      }}>
        <StatCard icon={Users} label="Referral sources" value={leaderboard.length} T={T} />
        <StatCard icon={ArrowRightLeft} label="Total referrals" value={totalReferrals}
          sub={`${totalConverted} converted`} T={T} />
        <StatCard icon={TrendingUp} label="Conversion rate" value={`${avgConversion}%`} T={T}
          color={avgConversion >= 50 ? '#10b981' : avgConversion >= 25 ? ACCENT : T.textFaint} />
        <StatCard icon={Shield} label="Opportunities found" value={sweepData.opportunities.length}
          sub={`${sweepData.overdueNurture.length} need nurture`} T={T} color="#3b82f6" />
      </div>

      {/* Quick insight cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Top referral source */}
        <div style={{
          background: T.cardBg, border: `1px solid ${T.border2}`,
          borderRadius: 14, padding: '18px 20px',
        }}>
          <div style={{ fontSize: 10, letterSpacing: 1.5, color: ACCENT, fontWeight: 700, marginBottom: 10 }}>
            TOP REFERRAL SOURCE
          </div>
          {topSource ? (
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>{topSource.contact_name}</div>
              <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
                {topSource.total} referral{topSource.total !== 1 ? 's' : ''} sent &middot; {topSource.conversion_rate}% conversion
              </div>
              <div style={{ fontSize: 10, color: T.textFaint, marginTop: 2 }}>
                Quality score: {topSource.quality_score}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: T.textFaint }}>
              No referral sources yet. Record your first referral to get started.
            </div>
          )}
        </div>

        {/* Pending opportunities */}
        <div style={{
          background: T.cardBg, border: `1px solid ${T.border2}`,
          borderRadius: 14, padding: '18px 20px',
        }}>
          <div style={{ fontSize: 10, letterSpacing: 1.5, color: '#3b82f6', fontWeight: 700, marginBottom: 10 }}>
            LATEST OPPORTUNITIES
          </div>
          {sweepData.opportunities.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sweepData.opportunities.slice(0, 3).map((opp, i) => (
                <div key={i} style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.4 }}>
                  {opp.type === 'mutual_intro'
                    ? `Introduce ${opp.contact_a_name} to ${opp.contact_b_name}`
                    : `Ask ${opp.introducer_name} to intro you to ${opp.lead_name}`
                  }
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: T.textFaint }}>
              No referral opportunities detected yet. Build your network with tagged contacts.
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
