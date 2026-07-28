import { useNavigate } from 'react-router-dom';
import { BRAND } from '../../theme/tokens';
import { Zap } from 'lucide-react';

export default function HunterReadinessBanner({
  acceptedCompanies,
  totalReplies,
  cadencesSent,
  subscriptionTier,
  T,
}) {
  const navigate = useNavigate();

  const hasEnoughCompanies = (acceptedCompanies || 0) >= 10;
  const hasEngagement = (totalReplies || 0) >= 1 || (cadencesSent || 0) >= 1;
  const isNotHunter = subscriptionTier !== 'hunter';

  if (!hasEnoughCompanies || !hasEngagement || !isNotHunter) return null;

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 32px 24px' }}>
      <div style={{
        padding: '20px 24px', borderRadius: 14,
        background: `linear-gradient(135deg, ${BRAND.pink}15, ${BRAND.purple}15)`,
        border: `1px solid ${BRAND.pink}30`,
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: `${BRAND.pink}20`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Zap size={20} color={BRAND.pink} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 4 }}>
            Barry's Recommendation
          </div>
          <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.5 }}>
            {totalReplies >= 1
              ? `You've found ${acceptedCompanies} ${acceptedCompanies === 1 ? 'company' : 'companies'} and ${totalReplies} ${totalReplies === 1 ? 'reply is' : 'replies are'} coming in. Hunter can manage follow-up so conversations don't slip through.`
              : `You've found ${acceptedCompanies} ${acceptedCompanies === 1 ? 'company' : 'companies'} and outreach is underway. Hunter can help organize conversations as they begin.`}
          </div>
        </div>
        <button
          onClick={() => navigate('/hunter')}
          style={{
            padding: '10px 20px', borderRadius: 10,
            background: `linear-gradient(135deg, ${BRAND.pink}, ${BRAND.purple})`,
            color: '#fff', border: 'none', fontSize: 13, fontWeight: 700,
            cursor: 'pointer', flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <Zap size={14} /> Explore Hunter
        </button>
      </div>
    </div>
  );
}
