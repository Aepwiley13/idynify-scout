/**
 * OpportunitiesSection — Barry-detected referral + introduction opportunities.
 * Shows who in the user's network can introduce them to high-value leads,
 * and which two contacts should meet each other.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lightbulb, ArrowRight, Users, Building2, MapPin, Tag, RefreshCw } from 'lucide-react';
import { useT } from '../../../theme/ThemeContext';
import { useActiveUser } from '../../../context/ImpersonationContext';
import { auth } from '../../../firebase/config';
import { detectReferralOpportunities } from '../../../services/referralIntelligenceService';

const ACCENT = '#f59e0b';

function OpportunityCard({ opp, T, navigate }) {
  const isMutual = opp.type === 'mutual_intro';

  return (
    <div style={{
      background: T.cardBg, border: `1px solid ${T.border2}`,
      borderRadius: 14, padding: '16px 20px',
      transition: 'all 0.15s', animation: 'fadeUp 0.2s ease',
    }}>
      {/* Badge */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 10px', borderRadius: 20,
        background: isMutual ? '#8b5cf620' : `${ACCENT}15`,
        border: `1px solid ${isMutual ? '#8b5cf640' : ACCENT + '30'}`,
        fontSize: 10, fontWeight: 600,
        color: isMutual ? '#8b5cf6' : ACCENT,
        marginBottom: 12,
      }}>
        {isMutual ? 'Mutual Introduction' : 'Referral Ask'}
      </div>

      {/* Connection visualization */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{
          flex: 1, background: T.surface, borderRadius: 10, padding: '10px 12px',
          border: `1px solid ${T.border}`,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
            {isMutual ? opp.contact_a_name : opp.introducer_name}
          </div>
          <div style={{ fontSize: 10, color: T.textFaint }}>
            {isMutual ? 'Your contact' : 'Can introduce you'}
          </div>
        </div>

        <ArrowRight size={16} color={T.textFaint} style={{ flexShrink: 0 }} />

        <div style={{
          flex: 1, background: T.surface, borderRadius: 10, padding: '10px 12px',
          border: `1px solid ${T.border}`,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
            {isMutual ? opp.contact_b_name : opp.lead_name}
          </div>
          <div style={{ fontSize: 10, color: T.textFaint }}>
            {isMutual ? 'Your contact' : (opp.lead_company || 'Target lead')}
          </div>
        </div>
      </div>

      {/* Reasoning */}
      <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5, marginBottom: 12 }}>
        {opp.reasoning}
      </div>

      {/* Overlap reasons */}
      {opp.overlap_reasons && opp.overlap_reasons.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {opp.overlap_reasons.map((reason, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '3px 8px', borderRadius: 6,
              background: T.surface, border: `1px solid ${T.border}`,
              fontSize: 10, color: T.textMuted,
            }}>
              <Tag size={9} />
              {reason}
            </div>
          ))}
        </div>
      )}

      {/* Match score */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 10, color: T.textFaint }}>
          Match score: {opp.overlap_score}
        </div>
        <div
          onClick={() => {
            const contactId = isMutual ? opp.contact_a_id : opp.introducer_id;
            if (contactId) navigate(`/scout/contact/${contactId}`);
          }}
          style={{
            fontSize: 11, fontWeight: 500, color: ACCENT,
            cursor: 'pointer', padding: '4px 10px', borderRadius: 6,
            background: `${ACCENT}10`, transition: 'all 0.12s',
          }}
        >
          View profile
        </div>
      </div>
    </div>
  );
}

export default function OpportunitiesSection() {
  const T = useT();
  const navigate = useNavigate();
  const activeUser = useActiveUser();
  const userId = activeUser?.uid || activeUser?.id || auth.currentUser?.uid;

  const [loading, setLoading] = useState(true);
  const [opportunities, setOpportunities] = useState([]);
  const [filter, setFilter] = useState('all'); // 'all' | 'intro' | 'mutual'

  useEffect(() => {
    if (!userId) return;
    detectReferralOpportunities(userId)
      .then(opps => setOpportunities(opps))
      .catch(err => console.error('[Reinforcements] Opportunities load failed:', err))
      .finally(() => setLoading(false));
  }, [userId]);

  const filtered = filter === 'all'
    ? opportunities
    : filter === 'mutual'
      ? opportunities.filter(o => o.type === 'mutual_intro')
      : opportunities.filter(o => o.type === 'intro_via_network');

  if (loading) {
    return (
      <div style={{ padding: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <div style={{ fontSize: 13, color: T.textFaint }}>Scanning for referral opportunities...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 800, animation: 'fadeUp 0.2s ease' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>Referral Opportunities</div>
          <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
            Barry found {opportunities.length} potential introduction{opportunities.length !== 1 ? 's' : ''} in your network
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, marginTop: 14 }}>
        {[
          { id: 'all', label: 'All' },
          { id: 'intro', label: 'Referral asks' },
          { id: 'mutual', label: 'Mutual intros' },
        ].map(f => (
          <div
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 500,
              cursor: 'pointer', transition: 'all 0.12s',
              background: filter === f.id ? `${ACCENT}18` : T.surface,
              border: `1px solid ${filter === f.id ? ACCENT + '40' : T.border}`,
              color: filter === f.id ? ACCENT : T.textMuted,
            }}
          >
            {f.label}
          </div>
        ))}
      </div>

      {/* Opportunity cards */}
      {filtered.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map((opp, i) => (
            <OpportunityCard key={i} opp={opp} T={T} navigate={navigate} />
          ))}
        </div>
      ) : (
        <div style={{
          background: T.cardBg, border: `1px solid ${T.border2}`,
          borderRadius: 14, padding: '40px 28px', textAlign: 'center',
        }}>
          <Lightbulb size={32} color={T.textFaint} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: T.textMuted, marginBottom: 6 }}>
            No opportunities detected yet
          </div>
          <div style={{ fontSize: 12, color: T.textFaint, lineHeight: 1.5 }}>
            Barry scans your network for referral opportunities based on shared industry,
            location, title, and tags. Tag your contacts and mark referral sources to unlock this.
          </div>
        </div>
      )}

      <style>{`@keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
