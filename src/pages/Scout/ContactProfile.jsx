import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle,
  Loader,
  Target,
  AlertTriangle,
  Brain,
  ArrowRight,
  Linkedin,
  Sparkles
} from 'lucide-react';
import { enrichWithLinkedIn } from '../../utils/contactEnrichment';
import IdentityCard from '../../components/contacts/IdentityCard';
import MeetSection from '../../components/contacts/MeetSection';
import RecessiveActions from '../../components/contacts/RecessiveActions';
import DetailDrawer from '../../components/contacts/DetailDrawer';
import HunterContactDrawer from '../../components/hunter/HunterContactDrawer';
import ContactHunterActivity from '../../components/hunter/ContactHunterActivity';
import BarryKnowledgeButton from '../../components/recon/BarryKnowledgeButton';
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
  const [hunterDrawerOpen, setHunterDrawerOpen] = useState(false);
  const [reconStatus, setReconStatus] = useState({ progress: 0, loaded: false });
  const [staleDismissed, setStaleDismissed] = useState(false);
  const [needsManualLinkedIn, setNeedsManualLinkedIn] = useState(false);
  const [manualLinkedInUrl, setManualLinkedInUrl] = useState('');
  const [enrichmentSummary, setEnrichmentSummary] = useState(null);

  // LinkedIn URL entry state
  const [showLinkedInEntry, setShowLinkedInEntry] = useState(false);
  const [linkedInUrl, setLinkedInUrl] = useState('');
  const [linkedInSaving, setLinkedInSaving] = useState(false);
  const [linkedInError, setLinkedInError] = useState(null);

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

      // Load RECON training status for stale intelligence warning
      loadReconStatus(user.uid);

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

  function handleContactUpdate(updatedContact) {
    setContact(updatedContact);
  }

  async function loadReconStatus(userId) {
    try {
      const dashboardDoc = await getDoc(doc(db, 'dashboards', userId));
      if (dashboardDoc.exists()) {
        const data = dashboardDoc.data();
        const recon = data.modules?.find(m => m.id === 'recon');
        const sections = recon?.sections || [];
        const completed = sections.filter(s => s.status === 'completed').length;
        const total = sections.length || 10;
        const progress = Math.round((completed / total) * 100);
        setReconStatus({ progress, completed, total, loaded: true });
      }
    } catch (error) {
      console.error('Error loading RECON status:', error);
      setReconStatus({ progress: 0, loaded: true });
    }
  }

  async function handleEnrichContact() {
    try {
      setEnriching(true);
      setEnrichError(null);
      setEnrichSuccess(false);

      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');

      // Enrichment works with any contact (LinkedIn URL, Apollo ID, or name+company)
      if (!contact.apollo_person_id && !contact.linkedin_url && !contact.name) {
        setEnrichError('This contact needs at least a name, LinkedIn URL, or Apollo ID to enrich.');
        setEnriching(false);
        return;
      }

      console.log('🔄 Enrichment starting for:', contact.name);

      const authToken = await user.getIdToken();

      // Call barryEnrich - orchestrated tool-based enrichment (no AI)
      const response = await fetch('/.netlify/functions/barryEnrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken: authToken,
          contact: {
            ...contact,
            apollo_person_id: contact.apollo_person_id || null,
            linkedin_url: contact.linkedin_url || null,
            name: contact.name || null,
            company_name: contact.company_name || null,
            title: contact.title || null
          }
        })
      });

      if (!response.ok) {
        throw new Error('Enrichment request failed');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Enrichment failed');
      }

      console.log('✅ Enrichment complete');

      // Check if manual LinkedIn input is needed
      const summary = result.enrichedData?.enrichment_summary || result.summary;
      setEnrichmentSummary(summary);

      if (summary?.needs_manual_linkedin) {
        console.log('⚠️ Enrichment needs manual LinkedIn URL');
        setNeedsManualLinkedIn(true);
        setEnriching(false);
        // Don't save yet - wait for user to provide LinkedIn URL
        return;
      }

      // Update contact in Firestore with enriched data
      const contactRef = doc(db, 'users', user.uid, 'contacts', contact.id);
      await updateDoc(contactRef, {
        ...result.enrichedData,
        last_enriched_at: new Date().toISOString()
      });

      // Update local state
      const updatedContact = { ...contact, ...result.enrichedData };
      setContact(updatedContact);

      // Regenerate Barry context after enrichment (more data = better context)
      console.log('🐻 Regenerating Barry context after enrichment...');
      generateBarryContext(updatedContact, user);

      setNeedsManualLinkedIn(false);
      setEnrichSuccess(true);
      setTimeout(() => setEnrichSuccess(false), 5000);
      setEnriching(false);

    } catch (err) {
      console.error('Error in enrichment:', err);
      setEnrichError(err.message || 'Failed to enrich contact. Please try again.');
      setEnriching(false);
    }
  }

  // Handle manual LinkedIn URL submission and retry enrichment
  async function handleManualLinkedInSubmit() {
    if (!manualLinkedInUrl.trim()) {
      setEnrichError('Please enter a LinkedIn URL');
      return;
    }

    // Validate LinkedIn URL format
    if (!manualLinkedInUrl.includes('linkedin.com/in/')) {
      setEnrichError('Please enter a valid LinkedIn profile URL (e.g., https://linkedin.com/in/username)');
      return;
    }

    try {
      setEnriching(true);
      setEnrichError(null);
      setNeedsManualLinkedIn(false);

      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');

      // First, save the LinkedIn URL to the contact
      const contactRef = doc(db, 'users', user.uid, 'contacts', contact.id);
      await updateDoc(contactRef, {
        linkedin_url: manualLinkedInUrl.trim()
      });

      // Update local state with LinkedIn URL
      const contactWithLinkedIn = { ...contact, linkedin_url: manualLinkedInUrl.trim() };
      setContact(contactWithLinkedIn);

      console.log('🔄 Re-running enrichment with manual LinkedIn URL...');

      const authToken = await user.getIdToken();

      // Re-run enrichment with the LinkedIn URL
      const response = await fetch('/.netlify/functions/barryEnrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken: authToken,
          contact: {
            ...contactWithLinkedIn,
            linkedin_url: manualLinkedInUrl.trim()
          }
        })
      });

      if (!response.ok) {
        throw new Error('Enrichment request failed');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Enrichment failed');
      }

      console.log('✅ Enrichment with LinkedIn URL complete');

      // Update contact in Firestore with enriched data
      await updateDoc(contactRef, {
        ...result.enrichedData,
        last_enriched_at: new Date().toISOString()
      });

      // Update local state
      const updatedContact = { ...contactWithLinkedIn, ...result.enrichedData };
      setContact(updatedContact);

      // Regenerate Barry context
      generateBarryContext(updatedContact, user);

      setManualLinkedInUrl('');
      setEnrichmentSummary(null);
      setEnrichSuccess(true);
      setTimeout(() => setEnrichSuccess(false), 5000);
      setEnriching(false);

    } catch (err) {
      console.error('Error in manual LinkedIn enrichment:', err);
      setEnrichError(err.message || 'Failed to enrich contact. Please try again.');
      setEnriching(false);
    }
  }

  function handleCancelManualLinkedIn() {
    setNeedsManualLinkedIn(false);
    setManualLinkedInUrl('');
    setEnrichmentSummary(null);
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
          onClick={() => navigate('/scout', { state: { activeTab: 'all-leads' } })}
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to All Leads</span>
        </button>
        <button
          className="btn-enrich-nav"
          onClick={handleEnrichContact}
          disabled={enriching}
        >
          {enriching ? (
            <>
              <Loader className="w-4 h-4 spinner" />
              <span>Enriching...</span>
            </>
          ) : (
            <span>Enrich Contact</span>
          )}
        </button>
        {/* Hunter engage button - opens in-context drawer */}
        <button
          className="btn-hunter-engage"
          onClick={() => setHunterDrawerOpen(true)}
        >
          <Target className="w-4 h-4" />
          <span>Engage with Hunter</span>
        </button>
        <BarryKnowledgeButton variant="compact" />
      </div>

      {/* Success Banner */}
      {enrichSuccess && (
        <div className="enrich-success-banner">
          <CheckCircle className="w-5 h-5" />
          <span>Contact enriched successfully.</span>
        </div>
      )}

      {/* Error Banner */}
      {enrichError && (
        <div className="enrich-error-banner">
          <AlertCircle className="w-5 h-5" />
          <span>{enrichError}</span>
        </div>
      )}

      {/* Manual LinkedIn URL Input - Shows when enrichment couldn't find LinkedIn */}
      {needsManualLinkedIn && (
        <div className="manual-linkedin-banner">
          <div className="manual-linkedin-header">
            <Linkedin className="w-5 h-5 text-blue-600" />
            <div className="manual-linkedin-text">
              <span className="manual-linkedin-title">LinkedIn Profile Not Found</span>
              <span className="manual-linkedin-desc">
                Barry couldn't automatically find a LinkedIn profile for this contact.
                Paste the LinkedIn URL below to continue enrichment.
              </span>
            </div>
          </div>
          <div className="manual-linkedin-input-row">
            <div className="manual-linkedin-input-wrapper">
              <Link2 className="w-4 h-4 text-gray-400" />
              <input
                type="url"
                placeholder="https://linkedin.com/in/username"
                value={manualLinkedInUrl}
                onChange={(e) => setManualLinkedInUrl(e.target.value)}
                className="manual-linkedin-input"
                disabled={enriching}
              />
            </div>
            <button
              className="manual-linkedin-submit-btn"
              onClick={handleManualLinkedInSubmit}
              disabled={enriching || !manualLinkedInUrl.trim()}
            >
              {enriching ? (
                <Loader className="w-4 h-4 spinner" />
              ) : (
                <>
                  <span>Enrich with LinkedIn</span>
                </>
              )}
            </button>
            <button
              className="manual-linkedin-cancel-btn"
              onClick={handleCancelManualLinkedIn}
              disabled={enriching}
            >
              Skip
            </button>
          </div>
          {enrichmentSummary && (
            <div className="manual-linkedin-details">
              <span className="detail-label">What Barry tried:</span>
              <ul className="detail-list">
                {enrichmentSummary.sources_used?.map((source, i) => (
                  <li key={i}>{source} search</li>
                ))}
                {enrichmentSummary.sources_used?.length === 0 && (
                  <li>Apollo search (no match found)</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Stale Intelligence Warning - Shows when RECON training is low */}
      {reconStatus.loaded && reconStatus.progress < 40 && !staleDismissed && (
        <div className="stale-intel-warning">
          <div className="stale-intel-content">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
            <div className="stale-intel-text">
              <span className="stale-intel-title">Limited Intelligence</span>
              <span className="stale-intel-desc">
                Barry's training is only {reconStatus.progress}% complete. Context generation may be generic.
              </span>
            </div>
          </div>
          <div className="stale-intel-actions">
            <button
              className="stale-intel-train-btn"
              onClick={() => navigate('/recon')}
            >
              <Brain className="w-4 h-4" />
              <span>Train Barry</span>
              <ArrowRight className="w-3 h-3" />
            </button>
            <button
              className="stale-intel-dismiss-btn"
              onClick={() => setStaleDismissed(true)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* "Meet [FirstName]" Structure */}
      <div className="contact-profile-container">
        {/* 1. IDENTITY CARD - TOP */}
        <IdentityCard contact={contact} />

        {/* 2. MEET [FIRSTNAME] - BARRY'S INTELLIGENCE */}
        {barryContext ? (
          <MeetSection barryContext={barryContext} contact={contact} />
        ) : generatingContext ? (
          <div className="barry-loading-state">
            <Loader className="loading-icon" />
            <p>Barry is analyzing this contact...</p>
          </div>
        ) : null}

        {/* 3. ACTIONS - BELOW BARRY */}
        <RecessiveActions contact={contact} />

        {/* 4. HUNTER ACTIVITY - Shows missions and engagement */}
        <ContactHunterActivity contactId={contact.id} />

        {/* 5. VIEW DETAILS DRAWER - BOTTOM */}
        <DetailDrawer contact={contact} onUpdate={handleContactUpdate} />
      </div>

      {/* Hunter Contact Drawer - In-context engagement */}
      <HunterContactDrawer
        contact={contact}
        isOpen={hunterDrawerOpen}
        onClose={() => setHunterDrawerOpen(false)}
        onContactUpdate={handleContactUpdate}
      />
    </div>
  );
}