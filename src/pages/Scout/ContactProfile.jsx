import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import './ContactProfile.css';

export default function ContactProfile() {
  const { contactId } = useParams();
  const navigate = useNavigate();
  const [contact, setContact] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadContactProfile();
  }, [contactId]);

  async function loadContactProfile() {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      const userId = user.uid;

      // Load contact document
      const contactDoc = await getDoc(doc(db, 'users', userId, 'contacts', contactId));

      if (!contactDoc.exists()) {
        console.error('❌ Contact not found');
        navigate('/scout', { state: { activeTab: 'all-leads' } });
        return;
      }

      const contactData = { id: contactDoc.id, ...contactDoc.data() };
      setContact(contactData);
      console.log('✅ Contact profile loaded:', contactData.name);
      setLoading(false);
    } catch (error) {
      console.error('❌ Failed to load contact:', error);
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="profile-loading">
        <div className="loading-spinner"></div>
        <p>[LOADING CONTACT PROFILE...]</p>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="profile-error">
        <p>Contact not found</p>
        <button onClick={() => navigate('/scout', { state: { activeTab: 'all-leads' } })}>
          ← Back to All Leads
        </button>
      </div>
    );
  }

  const hasEnrichmentFailed = contact.status === 'enrichment_failed';

  return (
    <div className="contact-profile">
      {/* Back Navigation */}
      <div className="profile-nav">
        <button onClick={() => navigate('/scout', { state: { activeTab: 'all-leads' } })}>
          ← Back to All Leads
        </button>
        {contact.company_id && (
          <button onClick={() => navigate(`/scout/company/${contact.company_id}`)}>
            View Company →
          </button>
        )}
      </div>

      {/* Contact Header */}
      <div className="profile-header">
        <div className="profile-avatar">
          {contact.name.charAt(0).toUpperCase()}
        </div>

        <div className="profile-header-info">
          <h1>{contact.name}</h1>
          <p className="profile-title">
            {contact.title}
            {contact.company_name && <span> @ {contact.company_name}</span>}
          </p>

          {hasEnrichmentFailed && (
            <div className="enrichment-warning">
              ⚠️ Some data may be incomplete. Contact saved with basic information.
            </div>
          )}
        </div>
      </div>

      {/* Contact Information Section */}
      <div className="profile-section">
        <h2>📧 Contact Information</h2>
        <div className="info-grid">
          {contact.email ? (
            <div className="info-item">
              <span className="info-label">Email</span>
              <a href={`mailto:${contact.email}`} className="info-value">
                {contact.email}
              </a>
            </div>
          ) : (
            <div className="info-item">
              <span className="info-label">Email</span>
              <span className="info-value unavailable">Not available</span>
            </div>
          )}

          {contact.phone ? (
            <div className="info-item">
              <span className="info-label">Phone</span>
              <a href={`tel:${contact.phone}`} className="info-value">
                {contact.phone}
              </a>
            </div>
          ) : (
            <div className="info-item">
              <span className="info-label">Phone</span>
              <span className="info-value unavailable">Not available</span>
            </div>
          )}

          {contact.linkedin_url && (
            <div className="info-item">
              <span className="info-label">LinkedIn</span>
              <a
                href={contact.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="info-value link"
              >
                View Profile →
              </a>
            </div>
          )}

          {contact.twitter_url && (
            <div className="info-item">
              <span className="info-label">Twitter</span>
              <a
                href={contact.twitter_url}
                target="_blank"
                rel="noopener noreferrer"
                className="info-value link"
              >
                View Profile →
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Company Information Section */}
      {contact.company_name && (
        <div className="profile-section">
          <h2>🏢 Company Information</h2>
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Company</span>
              <span className="info-value">{contact.company_name}</span>
            </div>

            {contact.company_industry && (
              <div className="info-item">
                <span className="info-label">Industry</span>
                <span className="info-value">{contact.company_industry}</span>
              </div>
            )}

            {contact.city && (
              <div className="info-item">
                <span className="info-label">Location</span>
                <span className="info-value">
                  {contact.city}
                  {contact.state && `, ${contact.state}`}
                  {contact.country && `, ${contact.country}`}
                </span>
              </div>
            )}

            {contact.company_id && (
              <div className="info-item">
                <span className="info-label">Actions</span>
                <button
                  className="view-company-btn"
                  onClick={() => navigate(`/scout/company/${contact.company_id}`)}
                >
                  View Company Profile →
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Professional Background Section */}
      {(contact.seniority || contact.departments?.length > 0 || contact.functions?.length > 0) && (
        <div className="profile-section">
          <h2>💼 Professional Background</h2>
          <div className="info-grid">
            {contact.seniority && (
              <div className="info-item">
                <span className="info-label">Seniority</span>
                <span className="info-value">{contact.seniority}</span>
              </div>
            )}

            {contact.departments && contact.departments.length > 0 && (
              <div className="info-item">
                <span className="info-label">Departments</span>
                <div className="tags">
                  {contact.departments.map((dept, idx) => (
                    <span key={idx} className="tag">
                      {dept}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {contact.functions && contact.functions.length > 0 && (
              <div className="info-item">
                <span className="info-label">Functions</span>
                <div className="tags">
                  {contact.functions.map((func, idx) => (
                    <span key={idx} className="tag">
                      {func}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Employment History */}
          {contact.employment_history && contact.employment_history.length > 0 && (
            <div className="employment-section">
              <h3>Employment History</h3>
              <div className="timeline">
                {contact.employment_history.slice(0, 5).map((job, idx) => (
                  <div key={idx} className="timeline-item">
                    <div className="timeline-marker"></div>
                    <div className="timeline-content">
                      <h4>{job.title || 'Position'}</h4>
                      <p className="timeline-company">{job.organization_name || 'Company'}</p>
                      <p className="timeline-dates">
                        {job.start_date || 'Start'} - {job.end_date || job.current ? 'Present' : 'End'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Education */}
          {contact.education && contact.education.length > 0 && (
            <div className="education-section">
              <h3>Education</h3>
              <div className="timeline">
                {contact.education.slice(0, 3).map((edu, idx) => (
                  <div key={idx} className="timeline-item">
                    <div className="timeline-marker education-marker"></div>
                    <div className="timeline-content">
                      <h4>{edu.degree || 'Degree'}</h4>
                      <p className="timeline-company">{edu.school_name || 'School'}</p>
                      {edu.field_of_study && <p className="timeline-field">{edu.field_of_study}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Engagement Section */}
      <div className="profile-section">
        <h2>📊 Engagement</h2>
        <div className="info-grid">
          <div className="info-item">
            <span className="info-label">Status</span>
            <span className={`status-badge ${contact.status}`}>
              {contact.status === 'active' && '✓ Active'}
              {contact.status === 'pending_enrichment' && '⏳ Pending'}
              {contact.status === 'enrichment_failed' && '⚠️ Partial Data'}
            </span>
          </div>

          {contact.saved_at && (
            <div className="info-item">
              <span className="info-label">Added</span>
              <span className="info-value">{new Date(contact.saved_at).toLocaleDateString()}</span>
            </div>
          )}

          {contact.enriched_at && (
            <div className="info-item">
              <span className="info-label">Last Updated</span>
              <span className="info-value">{new Date(contact.enriched_at).toLocaleDateString()}</span>
            </div>
          )}

          {contact.source && (
            <div className="info-item">
              <span className="info-label">Source</span>
              <span className="info-value">{contact.source.replace(/_/g, ' ')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="profile-actions">
        <button className="action-btn primary">
          📥 Export to CSV
        </button>
        {contact.email && (
          <a href={`mailto:${contact.email}`} className="action-btn secondary">
            ✉️ Send Email
          </a>
        )}
      </div>
    </div>
  );
}
