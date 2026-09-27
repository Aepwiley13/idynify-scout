import { useState } from 'react';
import { auth } from '../../firebase/config';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { DECISION_SURFACE, approveCompany, skipCompany } from '../../services/companyDecision';
import { useT } from '../../theme/ThemeContext';
import { getDisplayIndustry } from '../../utils/companyDisplay';
import './CompanyResultsCard.css';

/**
 * `icpId` is the exact ICP the user confirmed in this conversation — the
 * surface ICP the decisions here are recorded under. Null when no confirmation
 * is in hand, in which case the canonical path records the discovery ICP as
 * provenance only, or nothing — never a guess.
 */
export default function CompanyResultsCard({ companies, totalCount, onAccept, icpId = null }) {
  const T = useT();
  const [decisions, setDecisions] = useState({});

  async function handleAccept(company) {
    const user = getEffectiveUser() || auth.currentUser;
    if (!user) return;
    try {
      const result = await approveCompany({
        user,
        company,
        surface: DECISION_SURFACE.BARRY_FIRST_VALUE,
        surfaceIcpId: icpId,
      });
      // A second tap while the first was writing: that one decision stands.
      if (!result.recorded) return;
      setDecisions(prev => ({ ...prev, [company.id]: 'accepted' }));
      if (onAccept) onAccept(company);
    } catch (err) {
      console.error('[CompanyResultsCard] accept failed:', err.message);
    }
  }

  function handleSkip(company) {
    setDecisions(prev => ({ ...prev, [company.id]: 'skipped' }));
    // Skip is "not now", not a rejection: the canonical skip. The card has
    // already moved on, as it always did; the write follows it.
    const user = getEffectiveUser() || auth.currentUser;
    if (!user) return;
    skipCompany({ userId: user.uid, company, surfaceIcpId: icpId })
      .catch(err => console.error('[CompanyResultsCard] skip failed:', err.message));
  }

  const sizeLabel = (company) => {
    const count = company.employee_count ?? company.estimated_num_employees ?? company.employeeCount;
    const range = company.company_size || company.employee_range;
    if (typeof count === 'number' && count > 0) {
      if (count >= 1000) return `${Math.round(count / 1000)}k employees`;
      return `${count} employees`;
    }
    if (range) return `${range} employees`;
    return null;
  };

  const industryLabel = (company) => getDisplayIndustry(company, null);

  return (
    <div className="crc" style={{ borderColor: T.border, background: T.surface }}>
      <div className="crc-list">
        {companies.map(company => {
          const decided = decisions[company.id];
          const industry = industryLabel(company);
          const size = sizeLabel(company);
          const subtitle = [industry, size].filter(Boolean).join(' · ');

          return (
            <div
              key={company.id}
              className={`crc-row ${decided === 'accepted' ? 'crc-row--accepted' : ''} ${decided === 'skipped' ? 'crc-row--skipped' : ''}`}
              style={{ borderColor: T.border }}
            >
              <div className="crc-row-info">
                <div className="crc-row-name" style={{ color: T.text }}>
                  {company.name || company.company_name || 'Unknown Company'}
                </div>
                {subtitle && (
                  <div className="crc-row-detail" style={{ color: T.textMuted }}>
                    {subtitle}
                  </div>
                )}
              </div>

              {company._fitScore != null && (
                <div className="crc-row-score">{company._fitScore}</div>
              )}

              {!decided && (
                <div className="crc-row-actions">
                  <button
                    className="crc-btn crc-btn--skip"
                    style={{ borderColor: T.border, color: T.text }}
                    onClick={() => handleSkip(company)}
                  >
                    Skip for now
                  </button>
                  <button
                    className="crc-btn crc-btn--accept"
                    onClick={() => handleAccept(company)}
                  >
                    Accept
                  </button>
                </div>
              )}

              {decided === 'accepted' && (
                <div className="crc-row-decided crc-row-decided--accepted">Saved</div>
              )}
              {decided === 'skipped' && (
                <div className="crc-row-decided crc-row-decided--skipped" style={{ color: T.textMuted }}>
                  Skipped
                </div>
              )}
            </div>
          );
        })}
      </div>
      {totalCount > companies.length && (
        <div className="crc-more" style={{ color: T.textMuted, borderColor: T.border }}>
          +{totalCount - companies.length} more available in Scout
        </div>
      )}
    </div>
  );
}
