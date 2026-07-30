/**
 * MobileCompanyCard — presentational stacked-card view of a Mission Control
 * company, shown in place of the desktop table below the mobile breakpoint.
 *
 * Same data (a scored company from the dashboard's `pageCompanies` array) and
 * the same approval handler (onSelect → setSelectedCompany → CompanyDetailPanel).
 * This component owns presentation ONLY: no data fetching, no scoring, no
 * filtering, no pagination. Colors come from T.* tokens and STATUS.* constants.
 */
import { Check } from 'lucide-react';
import { STATUS } from '../../theme/tokens';
import { getFitTier, getCompanyName, getMatchReasons } from '../../utils/companyDisplay';

export default function MobileCompanyCard({ company, onSelect, T }) {
  const name = getCompanyName(company);
  const score = Math.round(company.fit_score || 0);
  const tier = getFitTier(score);
  const reasons = getMatchReasons(company).slice(0, 2);
  const contact = company.recommendedContact;

  return (
    <div
      className="mc2-mobile-card"
      style={{ background: T.cardBg, border: `1px solid ${T.border}` }}
    >
      {/* Company name — large, bold */}
      <div style={{
        fontSize: 18, fontWeight: 700, color: T.text,
        lineHeight: 1.3, wordBreak: 'break-word',
      }}>
        {name}
      </div>

      {/* Fit score + tier label on one line: "83 · Strong Fit" */}
      <div style={{ fontSize: 14, fontWeight: 700, color: tier.color, marginTop: 6 }}>
        {score} · {tier.label}
      </div>

      {/* Top 2 match reasons, each prefixed with a check */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
        {(reasons.length > 0 ? reasons : ['Matches your ICP profile']).map((r, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            fontSize: 13, color: T.text, lineHeight: 1.4,
          }}>
            <Check size={14} color={STATUS.green} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{r}</span>
          </div>
        ))}
      </div>

      {/* Recommended contact — "{name} · {title}", muted */}
      {contact && (contact.name || contact.title) && (
        <div style={{ fontSize: 12, color: T.textMuted, marginTop: 12 }}>
          {[contact.name, contact.title].filter(Boolean).join(' · ')}
        </div>
      )}

      {/* View & Approve — full width, ≥48px; opens the same CompanyDetailPanel */}
      <button
        className="mc2-mobile-card-action"
        onClick={() => onSelect(company)}
        style={{
          background: `${T.accent}15`,
          border: `1px solid ${T.accent}30`,
          color: T.accent,
        }}
      >
        View &amp; Approve
      </button>
    </div>
  );
}
