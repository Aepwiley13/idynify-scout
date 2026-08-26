import { useState } from 'react';
import { auth, db } from '../../firebase/config';
import { doc, updateDoc } from 'firebase/firestore';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { useT } from '../../theme/ThemeContext';
import './CompanyResultsCard.css';

export default function CompanyResultsCard({ companies, totalCount, onAccept }) {
  const T = useT();
  const [decisions, setDecisions] = useState({});

  async function handleAccept(company) {
    const user = getEffectiveUser() || auth.currentUser;
    if (!user) return;
    try {
      const companyRef = doc(db, 'users', user.uid, 'companies', company.id);
      await updateDoc(companyRef, {
        status: 'accepted',
        swipedAt: new Date().toISOString(),
        swipeDirection: 'right',
        swipe_source: 'barry_first_value',
      });
      setDecisions(prev => ({ ...prev, [company.id]: 'accepted' }));
      if (onAccept) onAccept(company);
    } catch (err) {
      console.error('[CompanyResultsCard] accept failed:', err.message);
    }
  }

  async function handleSkip(company) {
    const user = getEffectiveUser() || auth.currentUser;
    if (!user) return;
    try {
      const companyRef = doc(db, 'users', user.uid, 'companies', company.id);
      await updateDoc(companyRef, {
        status: 'rejected',
        swipedAt: new Date().toISOString(),
        swipeDirection: 'left',
        swipe_source: 'barry_first_value',
      });
      setDecisions(prev => ({ ...prev, [company.id]: 'skipped' }));
    } catch (err) {
      console.error('[CompanyResultsCard] skip failed:', err.message);
    }
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

  const industryLabel = (company) =>
    company.industry || company.primary_industry || company.company_industry || null;

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
                    Skip
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
    </div>
  );
}
