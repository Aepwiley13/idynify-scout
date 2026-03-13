/**
 * LeaderboardSection — Top referral sources ranked by quality.
 * Shows who sends the best referrals, conversion rates, and reciprocity balance.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Award, TrendingUp, ArrowRightLeft, Star, ChevronRight } from 'lucide-react';
import { useT } from '../../../theme/ThemeContext';
import { useActiveUser } from '../../../context/ImpersonationContext';
import { auth } from '../../../firebase/config';
import { getReferralLeaderboard } from '../../../services/referralIntelligenceService';

const ACCENT = '#f59e0b';

function QualityBadge({ score, T }) {
  let color, label;
  if (score >= 15) { color = '#10b981'; label = 'Elite'; }
  else if (score >= 8) { color = ACCENT; label = 'Strong'; }
  else if (score >= 3) { color = '#3b82f6'; label = 'Active'; }
  else { color = T.textFaint; label = 'New'; }

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 10,
      background: `${color}15`, border: `1px solid ${color}30`,
      fontSize: 10, fontWeight: 600, color,
    }}>
      <Star size={9} /> {label}
    </div>
  );
}

export default function LeaderboardSection() {
  const T = useT();
  const navigate = useNavigate();
  const activeUser = useActiveUser();
  const userId = activeUser?.uid || activeUser?.id || auth.currentUser?.uid;

  const [loading, setLoading] = useState(true);
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    if (!userId) return;
    getReferralLeaderboard(userId)
      .then(board => setLeaderboard(board))
      .catch(err => console.error('[Reinforcements] Leaderboard load failed:', err))
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return (
      <div style={{ padding: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <div style={{ fontSize: 13, color: T.textFaint }}>Loading leaderboard...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 800, animation: 'fadeUp 0.2s ease' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>Referral Leaderboard</div>
        <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
          Your top referral sources, ranked by quality and volume
        </div>
      </div>

      {leaderboard.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {leaderboard.map((source, i) => (
            <div
              key={source.contact_id}
              onClick={() => navigate(`/scout/contact/${source.contact_id}`)}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                background: T.cardBg, border: `1px solid ${T.border2}`,
                borderRadius: 12, padding: '14px 18px',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = `${ACCENT}40`; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.border2; }}
            >
              {/* Rank */}
              <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: i < 3 ? `${ACCENT}15` : T.surface,
                border: `1px solid ${i < 3 ? ACCENT + '30' : T.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700,
                color: i < 3 ? ACCENT : T.textFaint,
                flexShrink: 0,
              }}>
                {i + 1}
              </div>

              {/* Name + stats */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>
                  {source.contact_name || 'Unknown'}
                </div>
                <div style={{ fontSize: 11, color: T.textMuted, marginTop: 3, display: 'flex', gap: 12 }}>
                  <span>{source.total} referral{source.total !== 1 ? 's' : ''}</span>
                  <span>{source.converted} converted</span>
                  <span>{source.conversion_rate}% rate</span>
                </div>
              </div>

              {/* Quality badge */}
              <QualityBadge score={source.quality_score} T={T} />

              <ChevronRight size={14} color={T.textFaint} style={{ flexShrink: 0 }} />
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          background: T.cardBg, border: `1px solid ${T.border2}`,
          borderRadius: 14, padding: '40px 28px', textAlign: 'center',
        }}>
          <Award size={32} color={T.textFaint} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: T.textMuted, marginBottom: 6 }}>
            No referral sources yet
          </div>
          <div style={{ fontSize: 12, color: T.textFaint, lineHeight: 1.5 }}>
            When contacts send you referrals, they'll show up here ranked by quality.
            Start by recording your first received referral.
          </div>
        </div>
      )}

      <style>{`@keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
