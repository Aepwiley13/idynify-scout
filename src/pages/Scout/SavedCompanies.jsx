import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { useNavigate } from 'react-router-dom';
import './SavedCompanies.css';

export default function SavedCompanies() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSavedCompanies();
  }, []);

  async function loadSavedCompanies() {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      // Get all accepted companies
      const companiesQuery = query(
        collection(db, 'users', user.uid, 'companies'),
        where('status', '==', 'accepted')
      );
      const companiesSnapshot = await getDocs(companiesQuery);

      // For each company, count contacts (if contacts exist)
      const companiesList = await Promise.all(
        companiesSnapshot.docs.map(async (companyDoc) => {
          const company = { id: companyDoc.id, ...companyDoc.data() };

          // Try to count contacts for this company
          try {
            const contactsQuery = query(
              collection(db, 'users', user.uid, 'contacts'),
              where('company_id', '==', company.id)
            );
            const contactsSnapshot = await getDocs(contactsQuery);

            return {
              ...company,
              contact_count: contactsSnapshot.size
            };
          } catch (error) {
            // Contacts collection might not exist yet
            return {
              ...company,
              contact_count: 0
            };
          }
        })
      );

      // Filter to only show companies WITH contacts (for now, show all accepted)
      // TODO: Change this filter when contact selection is implemented
      // const companiesWithContacts = companiesList.filter(c => c.contact_count > 0);

      setCompanies(companiesList);
      setLoading(false);
    } catch (error) {
      console.error('Failed to load saved companies:', error);
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="saved-companies-loading">
        <div className="loading-spinner"></div>
        <p className="loading-text">[LOADING SAVED COMPANIES...]</p>
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🏢</div>
        <h2>No Saved Companies Yet</h2>
        <p>Companies you're interested in will appear here</p>
        <p className="empty-hint">Go to Daily Leads and swipe right on companies you want to target!</p>
      </div>
    );
  }

  return (
    <div className="saved-companies">
      <div className="section-header">
        <h2>Saved Companies</h2>
        <p className="section-subtitle">{companies.length} companies you're interested in</p>
      </div>

      <div className="companies-grid">
        {companies.map(company => (
          <div
            key={company.id}
            className="company-tile"
            onClick={() => {
              // TODO: Navigate to company detail page when implemented
              console.log('Navigate to company detail:', company.id);
            }}
          >
            <div className="company-logo">
              {company.name ? company.name.charAt(0).toUpperCase() : '?'}
            </div>

            <div className="company-info">
              <h3>{company.name || 'Unknown Company'}</h3>
              <p className="industry">{company.industry || 'Industry not specified'}</p>

              <div className="company-details">
                {company.revenue && (
                  <span className="detail-item">💰 {company.revenue}</span>
                )}
                {company.founded_year && (
                  <span className="detail-item">📅 {company.founded_year}</span>
                )}
              </div>

              <div className="company-links">
                {company.website_url && (
                  <a
                    href={company.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="company-link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    🌐 Website
                  </a>
                )}
                {company.linkedin_url && (
                  <a
                    href={company.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="company-link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    💼 LinkedIn
                  </a>
                )}
              </div>
            </div>

            {company.contact_count > 0 && (
              <div className="contact-badge">
                ✓ {company.contact_count} contact{company.contact_count !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
