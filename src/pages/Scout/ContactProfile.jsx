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
  ArrowRight
} from 'lucide-react';
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

      setEnrichSuccess(true);
      setTimeout(() => setEnrichSuccess(false), 5000);
      setEnriching(false);

    } catch (err) {
      console.error('Error in enrichment:', err);
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