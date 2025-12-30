import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { useNavigate } from 'react-router-dom';
import TitleSelectionModal from '../../components/TitleSelectionModal';
import './SavedCompanies.css';

export default function SavedCompanies() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState(null);

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

      const userId = user.uid;
      console.log('🔍 Loading saved companies for user:', userId);

      // Get all ACCEPTED companies
      const companiesQuery = query(
        collection(db, 'users', userId, 'companies'),
        where('status', '==', 'accepted')
      );
      const companiesSnapshot = await getDocs(companiesQuery);

      console.log('📦 Found accepted companies:', companiesSnapshot.size);

      if (companiesSnapshot.empty) {
        console.log('⚠️ No accepted companies found. User needs to swipe right on companies first.');
        setCompanies([]);
        setLoading(false);
        return;
      }

      // For each company, count contacts
      const companiesList = await Promise.all(
        companiesSnapshot.docs.map(async (companyDoc) => {
          const company = { id: companyDoc.id, ...companyDoc.data() };

          try {
            const contactsQuery = query(
              collection(db, 'users', userId, 'contacts'),
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

      console.log('✅ Loaded companies:', companiesList.length);
      console.log('📊 Companies with contacts:', companiesList.filter(c => c.contact_count > 0).length);

      setCompanies(companiesList);
      setLoading(false);
    } catch (error) {
      console.error('❌ Failed to load saved companies:', error);
      setLoading(false);
    }
  }

  // Handle company click - show title modal or navigate to detail
  function handleCompanyClick(company) {
    // Check if titles already selected for this company
    const hasTitles = company.selected_titles && company.selected_titles.length > 0;

    if (hasTitles) {
      // Already has titles, go straight to company detail
      navigate(`/scout/company/${company.id}`);
    } else {
      // First time, show title selection modal
      setSelectedCompany(company);
      setShowTitleModal(true);
    }
  }

  // Handle titles selected from modal
  function handleTitlesSelected(titles) {
    setShowTitleModal(false);
    // Navigate to company detail page
    navigate(`/scout/company/${selectedCompany.id}`);
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
            onClick={() => handleCompanyClick(company)}
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

      {/* Title Selection Modal */}
      {showTitleModal && selectedCompany && (
        <TitleSelectionModal
          company={selectedCompany}
          onClose={() => setShowTitleModal(false)}
          onConfirm={handleTitlesSelected}
        />
      )}
    </div>
  );
}
