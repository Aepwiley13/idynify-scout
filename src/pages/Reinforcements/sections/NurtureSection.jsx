/**
 * NurtureSection — Overdue referral sources that need attention.
 * Shows contacts who send referrals but haven't been engaged recently.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart, Clock, ArrowRightLeft, MessageSquare, ChevronRight } from 'lucide-react';
import { useT } from '../../../theme/ThemeContext';
import { useActiveUser } from '../../../context/ImpersonationContext';
import { auth } from '../../../firebase/config';
import { detectOverdueReferralSources } from '../../../services/referralIntelligenceService';

const ACCENT = '#f59e0b';

function UrgencyIndicator({ days, T }) {
  let color, label;
  if (days >= 60) { color = '#dc2626'; label = 'Critical'; }
  else if (days >= 30) { color = ACCENT; label = 'Overdue'; }
  else { color = '#3b82f6'; label = 'Due soon'; }

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 10,
      background: `${color}15`, border: `1px solid ${color}30`,
      fontSize: 10, fontWeight: 600, color,
    }}>
      <Clock size={9} /> {label}
    </div>
  );
}

export default function NurtureSection() {
  const T = useT();
  const navigate = useNavigate();
  const activeUser = useActiveUser();
  const userId = activeUser?.uid || activeUser?.id || auth.currentUser?.uid;

  const [loading, setLoading] = useState(true);
  const [overdue, setOverdue] = useState([]);

  useEffect(() => {
    if (!userId) return;
    detectOverdueReferralSources(userId)
      .then(sources => setOverdue(sources))
      .catch(err => console.error('[Reinforcements] Nurture load failed:', err))
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return (
      <div style={{ padding: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <div style={{ fontSize: 13, color: T.textFaint }}>Checking referral source health...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 800, animation: 'fadeUp 0.2s ease' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>Nurture Alerts</div>
        <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
          Referral sources that haven't heard from you in a while
        </div>
      </div>

      {overdue.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {overdue.map((source, i) => (
            <div
              key={source.contact_id}
              onClick={() => navigate(`/scout/contact/${source.contact_id}`)}
              style={{
                background: T.cardBg, border: `1px solid ${T.border2}`,
                borderRadius: 12, padding: '16px 20px',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = `${ACCENT}40`; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.border2; }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>
                    {source.contact_name}
                  </div>
                  <div style={{ fontSize: 11, color: T.textMuted, marginTop: 3 }}>
                    {source.referrals_sent} referral{source.referrals_sent !== 1 ? 's' : ''} sent
                    {source.referrals_converted > 0 && ` (${source.referrals_converted} converted)`}
                  </div>
                </div>
                <UrgencyIndicator days={source.days_since_contact} T={T} />
              </div>

              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Clock size={11} color={T.textFaint} />
                  <span style={{ fontSize: 11, color: T.textFaint }}>
                    {source.days_since_contact === Infinity
                      ? 'Never contacted'
                      : `${source.days_since_contact} days since last contact`}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <MessageSquare size={11} color={ACCENT} />
                  <span style={{ fontSize: 11, color: ACCENT, fontWeight: 500 }}>
                    {source.suggested_action}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          background: T.cardBg, border: `1px solid ${T.border2}`,
          borderRadius: 14, padding: '40px 28px', textAlign: 'center',
        }}>
          <Heart size={32} color="#10b981" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: '#10b981', marginBottom: 6 }}>
            All referral sources are nurtured
          </div>
          <div style={{ fontSize: 12, color: T.textFaint, lineHeight: 1.5 }}>
            No one is overdue for a check-in. Barry will alert you when someone needs attention.
          </div>
        </div>
      )}

      <style>{`@keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
