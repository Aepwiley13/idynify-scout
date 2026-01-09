import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import {
  ArrowLeft,
  User,
  Users,
  Mail,
  Phone,
  Linkedin,
  MapPin,
  Briefcase,
  Building2,
  Clock,
  TrendingUp,
  Award,
  Target,
  MessageSquare,
  AlertCircle,
  CheckCircle,
  Sparkles,
  Globe,
  Twitter,
  Facebook,
  Loader,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import './ContactProfile.css';

export default function ContactProfile() {
  const { contactId } = useParams();
  const navigate = useNavigate();
  const [contact, setContact] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [enrichSuccess, setEnrichSuccess] = useState(false);
  const [enrichError, setEnrichError] = useState(null);
  const [showSummary, setShowSummary] = useState(true);
  const [showExperience, setShowExperience] = useState(false);
  const [showEducation, setShowEducation] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [showSocial, setShowSocial] = useState(false);
  const [enrichingPublicProfile, setEnrichingPublicProfile] = useState(false);
  
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

  async function handleEnrichContact() {
    try {
      setEnriching(true);
      setEnrichError(null);
      setEnrichSuccess(false);

      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');

      // Check if contact has Apollo person ID
      if (!contact.apollo_person_id) {
        setEnrichError('This contact cannot be enriched (no Apollo ID)');
        setEnriching(false);
        return;
      }

      console.log('🔄 Enriching contact:', contact.name);

      // Get auth token
      const authToken = await user.getIdToken();

      // Call enrichContact Netlify function
      const response = await fetch('/.netlify/functions/enrichContact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: user.uid,
          authToken: authToken,
          contactId: contact.apollo_person_id
        })
      });

      if (!response.ok) {
        throw new Error('Enrichment request failed');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Enrichment failed');
      }

      console.log('✅ Contact enriched successfully');

      // Update contact in Firestore
      const contactRef = doc(db, 'users', user.uid, 'contacts', contact.id);
      await updateDoc(contactRef, {
        ...result.enrichedData,
        last_enriched_at: new Date().toISOString()
      });

      // Update local state
      setContact(prev => ({ ...prev, ...result.enrichedData }));

      // Show success message
      setEnrichSuccess(true);
      setTimeout(() => setEnrichSuccess(false), 5000);

      setEnriching(false);

    } catch (err) {
      console.error('Error enriching contact:', err);
      setEnrichError(err.message || 'Failed to enrich contact. Please try again.');
      setEnriching(false);
    }
  }

  async function handleEnrichPublicProfile() {
    try {
      setEnrichingPublicProfile(true);
      setEnrichError(null);
      setEnrichSuccess(false);

      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');

      console.log('🔍 Enriching public profile for:', contact.name);

      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/enrichPublicProfile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken: authToken,
          contactId: contact.id,
          contactName: contact.name,
          companyName: contact.company_name,
          linkedinUrl: contact.linkedin_url
        })
      });

      if (!response.ok) {
        throw new Error('Profile enrichment request failed');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Enrichment failed');
      }

      console.log('✅ Public profile enriched successfully');

      // Update local state
      setContact(prev => ({ ...prev, publicProfile: result.profileData }));

      setEnrichSuccess(true);
      setTimeout(() => setEnrichSuccess(false), 5000);
      setEnrichingPublicProfile(false);

    } catch (err) {
      console.error('Error enriching public profile:', err);
      setEnrichError(err.message || 'Failed to enrich public profile. Please try again.');
      setEnrichingPublicProfile(false);
    }
  }

  // Helper: Calculate tenure from job start date
  function calculateTenure(startDate) {
    if (!startDate) return null;

    try {
      const start = new Date(startDate);
      const now = new Date();
      const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
      const years = Math.floor(months / 12);
      const remainingMonths = months % 12;

      if (years === 0) {
        return `${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`;
      } else if (remainingMonths === 0) {
        return `${years} year${years !== 1 ? 's' : ''}`;
      } else {
        return `${years} year${years !== 1 ? 's' : ''}, ${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`;
      }
    } catch {
      return null;
    }
  }

  // Helper: Format location
  function formatLocation(contact) {
    const parts = [];
    if (contact.city) parts.push(contact.city);
    if (contact.state) parts.push(contact.state);
    if (contact.country) parts.push(contact.country);
    return parts.join(', ') || 'Not available';
  }

  if (loading) {
    return (
      <div className="profile-loading">
        <div className="loading-spinner"></div>
        <p>Loading contact profile...</p>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="profile-error">
        <AlertCircle className="w-16 h-16" />
        <h3>Contact Not Found</h3>
        <p>The contact you're looking for doesn't exist or has been removed.</p>
        <button
          className="btn-back"
          onClick={() => navigate('/scout', { state: { activeTab: 'all-leads' } })}
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to All Leads</span>
        </button>
      </div>
    );
  }

  const tenure = calculateTenure(contact.job_start_date);
  const hasEnrichedProfile = contact.enrichedProfile;

  return (
    <div className="contact-profile-page">
      {/* Header Navigation */}
      <div className="profile-nav">
        <button
          className="btn-back-nav"
          onClick={() => navigate(`/scout/company/${contact.company_id}`)}
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Company</span>
        </button>
        <button
          className="btn-export"
          onClick={() => alert('Export to CSV feature coming soon')}
        >
          Export Profile
        </button>
      </div>

      {/* Success Banner */}
      {enrichSuccess && (
        <div className="enrich-success-banner">
          <CheckCircle className="w-5 h-5" />
          <span>Profile enriched successfully!</span>
        </div>
      )}

      {/* Error Banner */}
      {enrichError && (
        <div className="enrich-error-banner">
          <AlertCircle className="w-5 h-5" />
          <span>{enrichError}</span>
        </div>
      )}

      {/* Profile Header Card */}
      <div className="profile-header-card">
        <div className="profile-header-content">
          <div className="profile-avatar">
            {contact.photo_url ? (
              <img src={contact.photo_url} alt={contact.name} />
            ) : (
              <div className="avatar-fallback">
                <User className="w-12 h-12" />
              </div>
            )}
          </div>

          <div className="profile-header-info">
            <h1 className="profile-name">{contact.name || 'Unknown Contact'}</h1>
            <p className="profile-title">{contact.title || 'No title specified'}</p>
            {contact.company_name && (
              <div className="profile-company">
                <Building2 className="w-4 h-4" />
                <span>{contact.company_name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Quick Contact Actions */}
        <div className="quick-actions">
          <button
            className="quick-action-btn enrich"
            onClick={handleEnrichPublicProfile}
            disabled={enrichingPublicProfile}
          >
            {enrichingPublicProfile ? (
              <>
                <Loader className="w-4 h-4 spinner" />
                <span>Enriching Profile...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Enrich Public Profile</span>
              </>
            )}
          </button>
          {contact.email && (
            <a href={`mailto:${contact.email}`} className="quick-action-btn email">
              <Mail className="w-4 h-4" />
              <span>Email</span>
            </a>
          )}
          {contact.phone && (
            <a href={`tel:${contact.phone}`} className="quick-action-btn phone">
              <Phone className="w-4 h-4" />
              <span>Call</span>
            </a>
          )}
          {contact.linkedin_url && (
            <a
              href={contact.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="quick-action-btn linkedin"
            >
              <Linkedin className="w-4 h-4" />
              <span>LinkedIn</span>
            </a>
          )}
        </div>
      </div>

      {/* Public Professional Profile Section */}
      {contact.publicProfile && (
        <div className="public-profile-section">
          <div className="section-header-main">
            <h2>Public Professional Profile</h2>
            <div className="ai-badge">
              <Globe className="w-4 h-4" />
              <span>Web Search Enrichment</span>
            </div>
          </div>

          {/* Professional Summary */}
          {contact.publicProfile.professional_summary && (
            <div className="profile-subsection">
              <button 
                className="subsection-toggle"
                onClick={() => setShowSummary(!showSummary)}
              >
                <User className="w-5 h-5" />
                <span>Professional Summary</span>
                {showSummary ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showSummary && (
                <div className="subsection-content">
                  <p>{contact.publicProfile.professional_summary}</p>
                </div>
              )}
            </div>
          )}

          {/* Experience */}
          {contact.publicProfile.experience && contact.publicProfile.experience.length > 0 && (
            <div className="profile-subsection">
              <button 
                className="subsection-toggle"
                onClick={() => setShowExperience(!showExperience)}
              >
                <Briefcase className="w-5 h-5" />
                <span>Experience ({contact.publicProfile.experience.length})</span>
                {showExperience ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showExperience && (
                <div className="subsection-content">
                  {contact.publicProfile.experience.map((exp, idx) => (
                    <div key={idx} className="experience-item">
                      <h4>{exp.title}</h4>
                      <p className="experience-company">{exp.company}</p>
                      {exp.years && <p className="experience-years">{exp.years}</p>}
                      {exp.description && <p className="experience-desc">{exp.description}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Education */}
          {contact.publicProfile.education && contact.publicProfile.education.length > 0 && (
            <div className="profile-subsection">
              <button 
                className="subsection-toggle"
                onClick={() => setShowEducation(!showEducation)}
              >
                <Award className="w-5 h-5" />
                <span>Education ({contact.publicProfile.education.length})</span>
                {showEducation ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showEducation && (
                <div className="subsection-content">
                  {contact.publicProfile.education.map((edu, idx) => (
                    <div key={idx} className="education-item">
                      <h4>{edu.institution}</h4>
                      <p>{edu.degree}</p>
                      {edu.years && <p className="education-years">{edu.years}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Publications & Media */}
          {contact.publicProfile.publications_and_media && contact.publicProfile.publications_and_media.length > 0 && (
            <div className="profile-subsection">
              <button 
                className="subsection-toggle"
                onClick={() => setShowMedia(!showMedia)}
              >
                <Globe className="w-5 h-5" />
                <span>Publications & Media ({contact.publicProfile.publications_and_media.length})</span>
                {showMedia ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showMedia && (
                <div className="subsection-content">
                  {contact.publicProfile.publications_and_media.map((media, idx) => (
                    <div key={idx} className="media-item">
                      <span className="media-type">{media.type}</span>
                      <a href={media.url} target="_blank" rel="noopener noreferrer">
                        {media.title}
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Public Social Profiles */}
          {contact.publicProfile.public_social_profiles && (
            <div className="profile-subsection">
              <button 
                className="subsection-toggle"
                onClick={() => setShowSocial(!showSocial)}
              >
                <Users className="w-5 h-5" />
                <span>Public Social Profiles</span>
                {showSocial ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showSocial && (
                <div className="subsection-content">
                  <div className="social-links">
                    {contact.publicProfile.public_social_profiles.linkedin && (
                      <a href={contact.publicProfile.public_social_profiles.linkedin} target="_blank" rel="noopener noreferrer" className="social-link">
                        <Linkedin className="w-4 h-4" />
                        <span>LinkedIn</span>
                      </a>
                    )}
                    {contact.publicProfile.public_social_profiles.twitter && (
                      <a href={contact.publicProfile.public_social_profiles.twitter} target="_blank" rel="noopener noreferrer" className="social-link">
                        <Twitter className="w-4 h-4" />
                        <span>Twitter/X</span>
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="profile-content">
        {/* Left Column: Main Info */}
        <div className="profile-left-column">
          {/* Section 1: Professional Snapshot */}
          <div className="profile-section">
            <div className="section-header">
              <div className="section-icon">
                <Briefcase className="w-5 h-5" />
              </div>
              <h2>Professional Snapshot</h2>
            </div>

            <div className="snapshot-grid">
              <div className="snapshot-item">
                <span className="snapshot-label">Current Role</span>
                <span className="snapshot-value">{contact.title || 'Not specified'}</span>
              </div>

              <div className="snapshot-item">
                <span className="snapshot-label">Company</span>
                <span className="snapshot-value">{contact.company_name || 'Not available'}</span>
              </div>

              {contact.department && (
                <div className="snapshot-item">
                  <span className="snapshot-label">Department</span>
                  <span className="snapshot-value">{contact.department}</span>
                </div>
              )}

              {contact.seniority && (
                <div className="snapshot-item">
                  <span className="snapshot-label">Seniority Level</span>
                  <span className="snapshot-value">{contact.seniority}</span>
                </div>
              )}

              {tenure && (
                <div className="snapshot-item">
                  <span className="snapshot-label">Tenure in Role</span>
                  <div className="tenure-value">
                    <Clock className="w-4 h-4" />
                    <span>{tenure}</span>
                  </div>
                </div>
              )}

              <div className="snapshot-item">
                <span className="snapshot-label">Location</span>
                <div className="location-value">
                  <MapPin className="w-4 h-4" />
                  <span>{formatLocation(contact)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Decision-Making Context */}
          <div className="profile-section">
            <div className="section-header">
              <div className="section-icon">
                <Target className="w-5 h-5" />
              </div>
              <h2>Decision-Making Context</h2>
            </div>

            <div className="decision-context">
              <div className="context-item">
                <div className="context-header">
                  <Award className="w-5 h-5" />
                  <span className="context-label">Decision Maker Likelihood</span>
                </div>
                <div className={`likelihood-badge ${contact.is_likely_decision_maker ? 'high' : 'low'}`}>
                  {contact.is_likely_decision_maker ? (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      <span>High</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-4 h-4" />
                      <span>Low / Influencer</span>
                    </>
                  )}
                </div>
              </div>

              <div className="context-reasoning">
                <p className="reasoning-label">Reasoning</p>
                <p className="reasoning-text">
                  {contact.is_likely_decision_maker
                    ? `Based on ${contact.seniority || 'seniority level'} and title "${contact.title}", this contact likely holds decision-making authority or significant budget influence within their department.`
                    : `Based on ${contact.seniority || 'role'} and title "${contact.title}", this contact may be an influencer or contributor but likely requires approval from higher authority for major decisions.`
                  }
                </p>
              </div>

              {contact.departments && contact.departments.length > 0 && (
                <div className="context-item">
                  <p className="context-label">Relevant Departments</p>
                  <div className="department-tags">
                    {contact.departments.map((dept, idx) => (
                      <span key={idx} className="dept-tag">{dept}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Section 3: Career Pattern Summary (AI Placeholder) */}
          <div className="profile-section ai-section">
            <div className="section-header">
              <div className="section-icon">
                <TrendingUp className="w-5 h-5" />
              </div>
              <h2>Career Pattern Summary</h2>
              <div className="ai-badge">
                <Sparkles className="w-3 h-3" />
                <span>AI-Powered</span>
              </div>
            </div>

            {hasEnrichedProfile && contact.enrichedProfile.careerPatternSummary ? (
              <div className="career-pattern-content">
                <p>{contact.enrichedProfile.careerPatternSummary}</p>
              </div>
            ) : (
              <div className="ai-placeholder">
                <Sparkles className="w-8 h-8" />
                <p className="placeholder-title">Analyzing career trajectory...</p>
                <p className="placeholder-text">
                  AI analysis of career patterns, stability, and experience will appear here once processed.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Insights */}
        <div className="profile-right-column">
          {/* Contact Information Card */}
          <div className="info-card">
            <h3>Contact Information</h3>

            <div className="info-items">
              {contact.email ? (
                <div className="info-item">
                  <div className="info-icon">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div className="info-content">
                    <span className="info-label">Email</span>
                    <a href={`mailto:${contact.email}`} className="info-value">{contact.email}</a>
                    {contact.email_status && (
                      <span className={`email-status ${contact.email_status}`}>
                        {contact.email_status === 'verified' && '✓ Verified'}
                        {contact.email_status === 'likely' && '~ Likely'}
                        {contact.email_status === 'unverified' && 'Unverified'}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="info-item">
                  <div className="info-icon">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div className="info-content">
                    <span className="info-label">Email</span>
                    <span className="info-value unavailable">Not available</span>
                  </div>
                </div>
              )}

              {contact.phone ? (
                <div className="info-item">
                  <div className="info-icon">
                    <Phone className="w-4 h-4" />
                  </div>
                  <div className="info-content">
                    <span className="info-label">Phone</span>
                    <a href={`tel:${contact.phone}`} className="info-value">{contact.phone}</a>
                  </div>
                </div>
              ) : (
                <div className="info-item">
                  <div className="info-icon">
                    <Phone className="w-4 h-4" />
                  </div>
                  <div className="info-content">
                    <span className="info-label">Phone</span>
                    <span className="info-value unavailable">Not available</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Section 4: Public Presence Signals (AI Placeholder) */}
          <div className="info-card ai-card">
            <div className="card-header">
              <h3>Public Presence Signals</h3>
              <div className="ai-badge-small">
                <Sparkles className="w-3 h-3" />
                <span>AI</span>
              </div>
            </div>

            {hasEnrichedProfile && contact.enrichedProfile.publicPresenceSignals ? (
              <div className="presence-content">
                {/* Show AI-generated presence signals */}
                <p>{JSON.stringify(contact.enrichedProfile.publicPresenceSignals)}</p>
              </div>
            ) : (
              <div className="ai-placeholder-small">
                <div className="presence-items">
                  <div className="presence-item">
                    <Linkedin className="w-4 h-4" />
                    <span>LinkedIn: {contact.linkedin_url ? 'Profile Found' : 'Not Found'}</span>
                  </div>
                  <div className="presence-item analyzing">
                    <Twitter className="w-4 h-4" />
                    <span>Twitter/X: Analyzing...</span>
                  </div>
                  <div className="presence-item analyzing">
                    <Globe className="w-4 h-4" />
                    <span>Thought Leadership: Analyzing...</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 5: Outreach Angle (AI Placeholder) */}
          <div className="info-card ai-card outreach-card">
            <div className="card-header">
              <h3>Suggested Outreach Angle</h3>
              <div className="ai-badge-small">
                <Sparkles className="w-3 h-3" />
                <span>AI</span>
              </div>
            </div>

            {hasEnrichedProfile && contact.enrichedProfile.outreachAngle ? (
              <div className="outreach-content">
                <p>{contact.enrichedProfile.outreachAngle}</p>
              </div>
            ) : (
              <div className="ai-placeholder-small">
                <MessageSquare className="w-8 h-8" />
                <p className="placeholder-title-small">Generating personalized approach...</p>
                <p className="placeholder-text-small">
                  AI will suggest how to approach this contact based on their role, tenure, and public presence.
                </p>
              </div>
            )}
          </div>

          {/* Company Info Card */}
          {contact.company_name && (
            <div className="info-card">
              <h3>Company Context</h3>
              <div className="company-info">
                <div className="company-item">
                  <Building2 className="w-4 h-4" />
                  <span>{contact.company_name}</span>
                </div>
                {contact.company_industry && (
                  <div className="company-item">
                    <Briefcase className="w-4 h-4" />
                    <span>{contact.company_industry}</span>
                  </div>
                )}
                {contact.company_id && (
                  <button
                    className="view-company-link"
                    onClick={() => navigate(`/scout/company/${contact.company_id}`)}
                  >
                    View Full Company Profile →
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
