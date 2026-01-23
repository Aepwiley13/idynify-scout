import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import {
  ArrowLeft,
  User,
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
  Loader
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
  const [barryContext, setBarryContext] = useState(null);
  const [generatingContext, setGeneratingContext] = useState(false);

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

      // Load Barry context if available
      if (contactData.barryContext) {
        setBarryContext(contactData.barryContext);
        console.log('✅ Barry context loaded from cache');
      } else {
        // Generate Barry context if missing
        console.log('🐻 No Barry context found, generating...');
        generateBarryContext(contactData, user);
      }

      setLoading(false);
    } catch (error) {
      console.error('❌ Failed to load contact:', error);
      setLoading(false);
    }
  }

  async function generateBarryContext(contactData, user) {
    try {
      setGeneratingContext(true);

      // Get auth token
      const authToken = await user.getIdToken();

      console.log('🐻 Calling Barry to generate context...');

      // Call barryGenerateContext Netlify function
      const response = await fetch('/.netlify/functions/barryGenerateContext', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: user.uid,
          authToken: authToken,
          contact: contactData,
          companyData: null // TODO: Load company data if needed
        })
      });

      if (!response.ok) {
        throw new Error('Context generation failed');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to generate context');
      }

      console.log('✅ Barry context generated successfully');

      // Update contact in Firestore with Barry context
      const contactRef = doc(db, 'users', user.uid, 'contacts', contactData.id);
      await updateDoc(contactRef, {
        barryContext: result.barryContext
      });

      // Update local state
      setBarryContext(result.barryContext);
      setGeneratingContext(false);

    } catch (err) {
      console.error('❌ Error generating Barry context:', err);
      setGeneratingContext(false);
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
        setEnrichError('This contact cannot be automatically enriched. Use Find Contact to update manually.');
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
      const updatedContact = { ...contact, ...result.enrichedData };
      setContact(updatedContact);

      // Regenerate Barry context after enrichment
      console.log('🐻 Regenerating Barry context after enrichment...');
      generateBarryContext(updatedContact, user);

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
          <span>Contact enriched successfully! Email and phone updated.</span>
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
          {contact.apollo_person_id && (
            <button
              className="quick-action-btn enrich"
              onClick={handleEnrichContact}
              disabled={enriching}
            >
              {enriching ? (
                <>
                  <Loader className="w-4 h-4 spinner" />
                  <span>Enriching...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Enrich Contact</span>
                </>
              )}
            </button>
          )}
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

      <div className="profile-content">

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

          {/* Context by Barry */}
          {barryContext && (
            <div className="info-card barry-context-card">
              <div className="card-header">
                <h3>Context by Barry</h3>
                <div className="barry-source-badge">
                  <span>Source: Barry</span>
                </div>
              </div>

              <div className="barry-context-content">
                {/* 1. Who You're Meeting */}
                <div className="barry-section">
                  <h4 className="barry-section-title">Who You're Meeting</h4>
                  <p className="barry-intro-text">{barryContext.whoYoureMeeting}</p>
                </div>

                {/* 2. What This Role Usually Cares About */}
                <div className="barry-section">
                  <h4 className="barry-section-title">What This Role Usually Cares About</h4>
                  <ul className="barry-bullet-list">
                    {barryContext.whatRoleCaresAbout.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>

                {/* 3. What This Company Appears Focused On Right Now */}
                <div className="barry-section">
                  <h4 className="barry-section-title">What This Company Appears Focused On Right Now</h4>
                  <ul className="barry-bullet-list">
                    {barryContext.whatCompanyFocusedOn.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>

                {/* 4. Ways a Conversation Could Naturally Begin */}
                <div className="barry-section">
                  <h4 className="barry-section-title">Ways a Conversation Could Naturally Begin</h4>
                  <ul className="barry-conversation-starters">
                    {barryContext.conversationStarters.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>

                {/* 5. Calm Reframe */}
                <div className="barry-section barry-reframe">
                  <p className="barry-reframe-text">{barryContext.calmReframe}</p>
                </div>
              </div>
            </div>
          )}

          {/* Loading State for Barry Context */}
          {generatingContext && !barryContext && (
            <div className="info-card barry-loading-card">
              <div className="card-header">
                <h3>Context by Barry</h3>
                <div className="barry-source-badge">
                  <span>Source: Barry</span>
                </div>
              </div>
              <div className="barry-loading">
                <Loader className="w-8 h-8 spinner" />
                <p>Barry is preparing contextual intelligence...</p>
              </div>
            </div>
          )}

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
