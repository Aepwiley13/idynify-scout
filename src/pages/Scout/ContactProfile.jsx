import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { doc, getDoc, updateDoc, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
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
  Star,
  Zap,
  Archive,
  Building2,
} from 'lucide-react';
import IdentityCard from '../../components/contacts/IdentityCard';
import MeetSection from '../../components/contacts/MeetSection';
import RecessiveActions from '../../components/contacts/RecessiveActions';
import DetailDrawer from '../../components/contacts/DetailDrawer';
import EngagementTimeline from '../../components/contacts/EngagementTimeline';
import InlineEngagementSection from '../../components/contacts/InlineEngagementSection';
import BarryKnowledgeButton from '../../components/recon/BarryKnowledgeButton';
import BarryInsightPanel from '../../components/contacts/BarryInsightPanel';
import { getContactStatus } from '../../utils/contactStateMachine';
import PersistentEngageBar from '../../components/contacts/PersistentEngageBar';
import StageEngagementPanel from '../../components/contacts/StageEngagementPanel';
import NextBestStep from '../../components/contacts/NextBestStep';
import StageTabBar from '../../components/contacts/StageTabBar';
import EngagementScoreRing from '../../components/contacts/EngagementScoreRing';
import RelationshipArc from '../../components/contacts/RelationshipArc';
import KeyMetricsGrid from '../../components/contacts/KeyMetricsGrid';
import ReferralHub from '../../components/contacts/ReferralHub';
import LinkedInImportModal from '../../components/contacts/LinkedInImportModal';
import EnrichSuggestions from '../../components/contacts/EnrichSuggestions';
import { acceptTitleSuggestion, acceptEmailSuggestion, USER_ACCEPTED } from '../../services/contactSuggestions';
import { writeBarryEnrichment } from '../../services/barryEnrichment';
import FindLinkedIn from '../../components/capture/FindLinkedIn.jsx';
import { searchPersonFrom } from '../../components/capture/findLinkedInView.js';
import ReinforcementsEngagementPanel from '../../components/contacts/ReinforcementsEngagementPanel';
import { STAGE_MAP } from '../../constants/stageSystem';
import { getContactReferralAnalytics } from '../../services/referralIntelligenceService';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';
import { archivePerson } from '../../services/peopleService';
import './ContactProfile.css';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { useShell } from '../../context/ShellContext';
import { MODULES } from '../../constants/navigationModel';
import { openCompany, openContact, ENTRY_POINTS } from '../../utils/navigation';

// Stage peek card — shown in Action column when user previews a non-active stage.
// Defined at module scope to avoid React remount on every render.
function StagePeekCard({ stageId, activeStageId, onBack, T }) {
  const stage = STAGE_MAP[stageId];
  const activeStage = STAGE_MAP[activeStageId];
  if (!stage) return null;
  return (
    <div style={{
      borderRadius: 12,
      border: `1px solid ${stage.color}40`,
      background: `${stage.color}08`,
      padding: '20px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: stage.color, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: stage.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {stage.label} — Preview
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: T.textMuted, lineHeight: 1.5 }}>
        {stage.description}
      </p>
      <p style={{ margin: 0, fontSize: 11, color: T.textFaint, fontStyle: 'italic' }}>
        This contact is in <strong style={{ color: T.textMuted }}>{activeStage?.label || activeStageId}</strong>.
        Click below to return, or use the stage tab to switch previews.
      </p>
      <button
        onClick={onBack}
        style={{
          padding: '9px 16px', borderRadius: 9, border: `1px solid ${stage.color}40`,
          background: `${stage.color}14`, color: stage.color,
          fontSize: 12, fontWeight: 700, cursor: 'pointer',
          alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
        ← Back to {activeStage?.label || 'Active'} Stage
      </button>
    </div>
  );
}

/**
 * @param {object}   props
 * @param {string}   [props.contactId]     Overrides the route param (panel/embedded use).
 * @param {Function} [props.onClose]       Present ⇒ PANEL mode. See ContactProfilePanel.
 * @param {string}   [props.returnTo]      Where Back goes in PAGE mode. Ephemeral —
 *                                          comes from navigation intent, never from the record.
 * @param {string}   [props.returnLabel]   Label for the Back button.
 * @param {Node|Function} [props.banner]   Rendered above the page's own banners. A
 *                                          function receives { triggerEngage } so an
 *                                          arrival banner's recommended action can drive
 *                                          the same engagement flow every other entry
 *                                          point uses, rather than a second one.
 */
export default function ContactProfile({
  contactId: propContactId,
  onClose,
  autoEngage,
  autoEngageContext = null,
  onReadyForHunter = null,
  returnTo = null,
  returnLabel = 'Back to People',
  banner = null,
} = {}) {
  const { contactId: paramContactId } = useParams();
  const contactId = propContactId || paramContactId;
  const navigate = useNavigate();
  const location = useLocation();
  const T = useT();
  // Safe outside the shell too — useShell() returns a no-op object for routes
  // that have not been migrated yet, so the embedded panel usages in AllLeads,
  // CompanyProfileView and MissionControl keep working unchanged.
  const shell = useShell();
  const isPanelMode = !!onClose;
  const [contact, setContact] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [enrichSuccess, setEnrichSuccess] = useState(false);
  const [enrichError, setEnrichError] = useState(null);
  const [barryContext, setBarryContext] = useState(null);
  const [generatingContext, setGeneratingContext] = useState(false);
  const [reconStatus, setReconStatus] = useState({ progress: 0, loaded: false });
  const engagementSectionRef = useRef(null);
  const [staleDismissed, setStaleDismissed] = useState(false);
  const [engageBarCollapsed, setEngageBarCollapsed] = useState(false);
  const [insightPanelCollapsed, setInsightPanelCollapsed] = useState(false);
  // LinkedIn profiles Barry found for a contact with none: confirmed through
  // Find LinkedIn, never attached by Barry ([] shows the paste box).
  const [barryLinkedIn, setBarryLinkedIn] = useState(null);
  // Title/company differences Enrich found; offered, never written (contactProtection).
  const [enrichSuggestions, setEnrichSuggestions] = useState([]);
  const [photoRefreshLoading, setPhotoRefreshLoading] = useState(false);
  const [photoRefreshError, setPhotoRefreshError] = useState(null);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showLinkedInImport, setShowLinkedInImport] = useState(false);
  const [archiveReason, setArchiveReason] = useState('other');
  const [archiving, setArchiving] = useState(false);
  // Stage tab bar — which tab is previewed (null = show active stage)
  const [previewStage, setPreviewStage] = useState(null);
  // Referral data for KeyMetricsGrid (loaded once when contact loads)
  const [referralData, setReferralData] = useState(null);

  useEffect(() => {
    loadContactProfile();
  }, [contactId]);

  // Auto-trigger engage when navigated here with autoEngage:true state.
  // Clears the flag from history so back-navigation doesn't re-trigger.
  useEffect(() => {
    if (!loading && contact && location?.state?.autoEngage) {
      triggerInlineEngagement();
      window.history.replaceState(
        { ...window.history.state, usr: { ...location.state, autoEngage: false } },
        ''
      );
    }
  }, [loading, contact]);

  // Referral analytics are now loaded inside loadContactProfile() via Promise.all.
  // This comment is kept to document the intentional removal of the separate useEffect.

  // Auto-trigger engage when the panel opens with autoEngage prop set by AllLeads.
  // A ref guards against re-firing if loading/contact re-evaluates after first trigger.
  const autoEngageConsumedRef = useRef(false);
  useEffect(() => {
    if (!loading && contact && autoEngage && !autoEngageConsumedRef.current) {
      autoEngageConsumedRef.current = true;
      triggerInlineEngagement();
    }
  }, [loading, contact, autoEngage]);

  // Auto-start with First Touch context when handed off from FirstTouchModal.
  const autoEngageContextConsumedRef = useRef(false);
  useEffect(() => {
    if (!loading && contact && autoEngageContext && !autoEngageContextConsumedRef.current) {
      autoEngageContextConsumedRef.current = true;
      const { userIntent, toneContext, engagementIntent } = autoEngageContext;
      const intentText = toneContext
        ? `${userIntent}. [Preferred tone: ${toneContext}]`
        : userIntent;
      const el = document.getElementById('engagement-section');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        engagementSectionRef.current?.startWithIntent(intentText, engagementIntent);
      }));
    }
  }, [loading, contact, autoEngageContext]);

  async function loadContactProfile() {
    try {
      const user = getEffectiveUser();
      if (!user) {
        if (isPanelMode) { onClose(); return; }
        navigate('/login');
        return;
      }

      const userId = user.uid;

      // Load contact + referral analytics + timeline in one coordinated fetch.
      // This ensures all three columns read from the same snapshot — no stale metrics.
      const timelineRef = collection(db, 'users', userId, 'contacts', contactId, 'timeline');
      const [contactDoc, referralAnalytics, timelineSnap] = await Promise.all([
        getDoc(doc(db, 'users', userId, 'contacts', contactId)),
        getContactReferralAnalytics(userId, contactId).catch(() => null),
        // G1-05: ordered by createdAt, not timestamp. Production audit: createdAt has
        // 100% coverage (2196/2196) and is always a real Timestamp; `timestamp` was
        // missing on 256 docs and stored as an ISO STRING on 39, which sorted them
        // above every real event. Ordering here needs no backfill and loses nothing.
        getDocs(query(timelineRef, orderBy('createdAt', 'desc'), limit(30))).catch(() => null),
      ]);

      if (!contactDoc.exists()) {
        console.error('❌ Contact not found');
        if (isPanelMode) { setLoading(false); return; }
        navigate('/scout', { state: { activeTab: 'all-leads' } });
        return;
      }

      const contactData = { ...contactDoc.data(), id: contactDoc.id };

      // Backfill total_messages_sent from timeline if not yet populated in Firestore.
      // Covers contacts that existed before the write-path fix was deployed.
      if (!contactData.engagement_summary?.total_messages_sent && timelineSnap) {
        const msgCount = timelineSnap.docs.filter(d => d.data().type === 'message_sent').length;
        if (msgCount > 0) {
          contactData.engagement_summary = {
            ...contactData.engagement_summary,
            total_messages_sent: msgCount,
          };
        }
      }

      setContact(contactData);
      if (referralAnalytics) setReferralData(referralAnalytics);
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
        barryContext:           result.barryContext,
        barryContextUpdatedAt:  new Date().toISOString(),
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

  /**
   * Leave this contact.
   *
   * Three destinations, in priority order, and the order is the whole point:
   *
   *   panel mode   → close the panel; Scout's list is still mounted behind it
   *   returnTo     → the screen the user was on when they opened this contact
   *   fallback     → Scout's people list
   *
   * The fallback used to be the ONLY behaviour. That is why clicking a
   * priority in Mission Control and pressing Back landed the user in Scout:
   * the page had no idea where they had come from, so it guessed, and it
   * guessed the same thing every time.
   */
  function goBack() {
    if (isPanelMode) { onClose(); return; }
    if (returnTo) { navigate(returnTo); return; }
    navigate('/scout', { state: { activeTab: 'all-leads' } });
  }

  /** Open this contact's company on the canonical, module-agnostic route. */
  function openCompanyRecord() {
    if (!contact?.company_id) return;
    openCompany({
      navigate,
      companyId: contact.company_id,
      entryPoint: ENTRY_POINTS.COMPANY,
      returnTo: location.pathname + (location.search || ''),
    });
  }

  function triggerInlineEngagement() {
    // Scroll the inline engagement section into view, then trigger the flow.
    // Double rAF ensures the browser has committed layout before we expand —
    // avoids the 350ms magic-number that was unreliable on slow connections.
    const el = document.getElementById('engagement-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (engagementSectionRef.current?.triggerFlow) {
          engagementSectionRef.current.triggerFlow();
        }
      }));
    } else if (engagementSectionRef.current?.triggerFlow) {
      engagementSectionRef.current.triggerFlow();
    }
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
      setEnrichSuggestions([]);
      setBarryLinkedIn(null);

      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');

      // Enrichment works with any contact (LinkedIn URL, Apollo ID, or name+company)
      if (!contact.apollo_person_id && !contact.linkedin_url && !contact.name) {
        setEnrichError('This contact needs at least a name, LinkedIn URL, or Apollo ID to enrich.');
        setEnriching(false);
        return;
      }

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
          },
          // Who to look for on LinkedIn: the same details Find LinkedIn searches with.
          person: searchPersonFrom(contact),
          // The server writes the result onto this contact as it is stored
          // when the run ends, in one transaction (#738).
          contactId: contact.id,
          save: true
        })
      });

      if (!response.ok) {
        throw new Error('Enrichment request failed');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Enrichment failed');
      }

      // Already written by the server, by the shared rules (fill only what is
      // empty) against the latest contact; an empty company is linked here
      // through the company resolver. Never a LinkedIn URL.
      const written = await writeBarryEnrichment(user.uid, contact, result);

      // Update local state
      const updatedContact = { ...contact, ...written };
      setContact(updatedContact);
      setEnrichSuggestions(result.suggestions || []);
      // No LinkedIn yet: the profiles Barry found, or the paste box, through Find LinkedIn's confirm.
      if (!contact.linkedin_url) setBarryLinkedIn(Array.isArray(result.linkedinCandidates) ? result.linkedinCandidates : []);

      // Regenerate Barry context after enrichment (more data = better context)
      generateBarryContext(updatedContact, user);

      setEnrichSuccess(true);
      setTimeout(() => setEnrichSuccess(false), 5000);
      setEnriching(false);

    } catch (err) {
      console.error('Error in enrichment:', err?.message);
      setEnrichError(err.message || 'Failed to enrich contact. Please try again.');
      setEnriching(false);
    }
  }

  /**
   * Find LinkedIn (from Barry's result) finished: show what its confirm wrote,
   * or open the contact that already has the profile.
   */
  async function handleLinkedInDone(doneContactId) {
    if (doneContactId && doneContactId !== contact.id) {
      openContact({ navigate, contactId: doneContactId });
      return;
    }
    setBarryLinkedIn(null);
    const user = getEffectiveUser();
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, 'users', user.uid, 'contacts', contact.id));
      if (snap.exists()) setContact(prev => ({ ...prev, ...snap.data(), id: snap.id }));
    } catch {
      // The profile shows what it had; the next load shows the rest.
    }
  }

  // Taking an email Enrich found on the company website: only while the contact has none.
  async function handleAcceptEnrichEmail(suggestion) {
    const user = getEffectiveUser();
    if (!user) throw new Error('Not authenticated');
    const { email } = await acceptEmailSuggestion(user.uid, contact.id, suggestion);
    setContact(prev => ({
      ...prev,
      email,
      enrichment_provenance: { ...(prev.enrichment_provenance || {}), email: USER_ACCEPTED },
    }));
  }

  // Taking Enrich's title is the user's choice, recorded as theirs.
  async function handleAcceptEnrichTitle(suggestion) {
    const user = getEffectiveUser();
    if (!user) throw new Error('Not authenticated');
    const { title } = await acceptTitleSuggestion(user.uid, contact.id, suggestion);
    setContact(prev => ({
      ...prev,
      title,
      enrichment_provenance: { ...(prev.enrichment_provenance || {}), title: USER_ACCEPTED },
    }));
  }

  async function handleRefreshPhoto() {
    if (photoRefreshLoading) return;

    // Need linkedin_url OR name+company to search
    if (!contact?.linkedin_url && !contact?.name) return;

    try {
      setPhotoRefreshLoading(true);
      setPhotoRefreshError(null);

      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');

      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/retryLinkedInPhoto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          contactId: contact.id,
          linkedinUrl: contact.linkedin_url || null,
          contactName: contact.name || '',
          currentPhotoUrl: contact.photo_url || null,
          companyName: contact.company_name || '',
          title: contact.title || ''
        })
      });

      const result = await response.json();

      if (response.status === 429) {
        setPhotoRefreshError('Retry limit exceeded. Please try again later.');
        setPhotoRefreshLoading(false);
        return;
      }

      if (!response.ok) {
        throw new Error(result.error || 'Photo refresh failed');
      }

      if (result.success && result.photo_url) {
        const contactRef = doc(db, 'users', user.uid, 'contacts', contact.id);
        const updateData = { photo_url: result.photo_url };

        // If backend discovered a LinkedIn URL, save that too
        if (result.linkedin_url && !contact.linkedin_url) {
          updateData.linkedin_url = result.linkedin_url;
        }

        await updateDoc(contactRef, updateData);

        // Update local state immediately — no page refresh needed
        setContact(prev => ({
          ...prev,
          photo_url: result.photo_url,
          ...(result.linkedin_url && !prev.linkedin_url ? { linkedin_url: result.linkedin_url } : {})
        }));
        console.log('✅ Photo refreshed successfully');
      } else {
        setPhotoRefreshError(result.message || 'Photo unavailable. Try again.');
        setTimeout(() => setPhotoRefreshError(null), 5000);
      }

      setPhotoRefreshLoading(false);
    } catch (err) {
      console.error('Error refreshing photo:', err);
      setPhotoRefreshError('Photo unavailable. Try again.');
      setTimeout(() => setPhotoRefreshError(null), 5000);
      setPhotoRefreshLoading(false);
    }
  }

  /**
   * A contact changed pipeline stage.
   *
   * This is the moment the navigation audit called the worst in the product:
   * the old handler did exactly one thing — set local state — so the user
   * performed the highest-value action available to them and the application
   * said nothing. Same URL, same header, and a back button still pointing at
   * the stage they had just left.
   *
   * Now the shell states what happened, offers the destination, and offers a
   * way back. Barry is told too: the contract's current_pipeline_stage updates
   * because the entity's stage changed, so his next answer is about a contact
   * in the new stage without the thread restarting.
   */
  function handleStageMoved({ stageTo }) {
    const stageFrom = contact?.stage || 'scout';
    setContact(prev => ({ ...prev, stage: stageTo, stage_source: 'manual_override' }));

    const destination = MODULES.find(m => m.id === stageTo);
    const who = contact?.name
      || [contact?.firstName, contact?.lastName].filter(Boolean).join(' ').trim()
      || 'Contact';

    shell.announce({
      message: `${who} moved to ${destination?.label || stageTo}.`,
      detail: destination?.description || null,
      actionLabel: destination ? `Open ${destination.label}` : null,
      actionPath: destination?.path || null,
      // Undo restores the previous stage rather than assuming Scout: this
      // handler fires for every stage transition, not just Scout → Hunter.
      undo: async () => {
        const user = getEffectiveUser();
        if (!user) return;
        await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
          stage: stageFrom,
          stage_source: 'manual_override',
          stage_entered_at: new Date().toISOString(),
        });
        setContact(prev => ({ ...prev, stage: stageFrom }));
      },
    });
  }

  async function handleArchiveContact() {
    try {
      setArchiving(true);
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');

      await archivePerson(user.uid, contact.id, archiveReason);

      setShowArchiveModal(false);
      goBack();
    } catch (err) {
      console.error('Failed to archive contact:', err);
      setArchiving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, minHeight: isPanelMode ? 200 : '100vh', background: T.appBg, color: T.textMuted }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: `2px solid ${BRAND.pink}`, borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
        <p style={{ fontSize: 13, margin: 0 }}>Loading contact profile...</p>
        <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
      </div>
    );
  }

  if (!contact) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, gap: 16, minHeight: isPanelMode ? 200 : '100vh', background: T.appBg, color: T.textMuted }}>
        <AlertCircle size={48} color={T.textFaint} />
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.text }}>Contact Not Found</h3>
        <p style={{ margin: 0, fontSize: 13, color: T.textFaint }}>The contact you're looking for doesn't exist or has been removed.</p>
        <button
          onClick={goBack}
          style={{ padding: '8px 18px', borderRadius: 9, background: T.surface, border: `1px solid ${T.border2}`, color: T.textMuted, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}
        >
          <ArrowLeft size={14} /><span>{returnLabel}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="contact-profile-page" style={{ background: T.appBg, minHeight: isPanelMode ? 'unset' : '100vh' }}>
      {/* Header Navigation — hidden in panel mode */}
      {!isPanelMode && (
        <div
          className="profile-nav"
          style={{ borderBottom: `1px solid ${T.border}`, background: T.navBg }}
        >
          <div className="profile-nav-inner">
            <button
              onClick={goBack}
              aria-label={returnLabel}
              style={{ background: T.surface, border: `1px solid ${T.border2}`, borderRadius: 8, padding: '7px 14px', color: T.textMuted, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <ArrowLeft size={13} />{returnLabel}
            </button>
            <div className="profile-nav-actions" style={{ display: 'flex', gap: 9 }}>
              <button
                onClick={handleEnrichContact}
                disabled={enriching}
                aria-label={enriching ? 'Enriching contact' : 'Enrich contact'}
                title={enriching ? 'Enriching contact' : 'Enrich contact'}
                style={{ background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, color: '#fff', border: 'none', borderRadius: 9, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: enriching ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: enriching ? 0.7 : 1 }}
              >
                {enriching ? <><Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /><span>Enriching...</span></> : <><Star size={13} /><span>Enrich Contact</span></>}
              </button>
              <button
                onClick={() => setShowArchiveModal(true)}
                aria-label="Archive contact"
                title="Archive contact"
                style={{ background: T.surface, border: `1px solid ${T.border2}`, borderRadius: 9, padding: '8px 14px', fontSize: 13, color: T.textMuted, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Archive size={13} /><span>Archive</span>
              </button>
              <BarryKnowledgeButton variant="compact" />
            </div>
          </div>
        </div>
      )}

      {/* Profile wrapper — full-width, contains banners + 3-col grid */}
      <div className="contact-profile-wrapper">

        {/* Arrival banner — why this screen opened. Supplied by the canonical
            page from ephemeral navigation intent; absent for a bookmark, a
            refresh, or the Scout panel, all of which are arrivals with no
            reason to explain. */}
        {typeof banner === 'function' ? banner({ triggerEngage: triggerInlineEngagement }) : banner}

        {/* ── Banners ── */}
        {enrichSuccess && (
          <div className="enrich-success-banner">
            <CheckCircle className="w-5 h-5" />
            <span>Contact enriched successfully.</span>
          </div>
        )}
        {enrichSuggestions.length > 0 && (
          <EnrichSuggestions
            suggestions={enrichSuggestions}
            onAcceptTitle={handleAcceptEnrichTitle}
            onAcceptEmail={handleAcceptEnrichEmail}
            onDismiss={() => setEnrichSuggestions([])}
          />
        )}
        {enrichError && (
          <div className="enrich-error-banner">
            <AlertCircle className="w-5 h-5" />
            <span>{enrichError}</span>
          </div>
        )}
        {barryLinkedIn && contact && !contact.linkedin_url && (
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 14, padding: 16, background: T.cardBg, marginBottom: '1.5rem', minWidth: 0 }}>
            <FindLinkedIn contactId={contact.id} found={barryLinkedIn} context="profile" onDone={handleLinkedInDone} T={T} />
          </div>
        )}
        {reconStatus.loaded && reconStatus.progress < 40 && !staleDismissed && (
          <div className="stale-intel-warning">
            <div className="stale-intel-content">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <div className="stale-intel-text">
                <span className="stale-intel-title">Limited Intelligence</span>
                <span className="stale-intel-desc">Barry's training is only {reconStatus.progress}% complete. Context generation may be generic.</span>
              </div>
            </div>
            <div className="stale-intel-actions">
              <button className="stale-intel-train-btn" onClick={() => navigate('/recon')}>
                <Brain className="w-4 h-4" /><span>Add context</span><ArrowRight className="w-3 h-3" />
              </button>
              <button className="stale-intel-dismiss-btn" onClick={() => setStaleDismissed(true)}>Dismiss</button>
            </div>
          </div>
        )}

        {/* ── Stage Tab Bar (full width) ── */}
        <div className="stage-bar-row">
          <StageTabBar
            contact={contact}
            previewStage={previewStage}
            onPreviewChange={setPreviewStage}
          />
        </div>

        {/* ── Three-column grid ── */}
        <div className="contact-profile-three-col">

          {/* LEFT — Intel Column */}
          <div className="intel-column">
            {contact.company_id && (
              <div
                className="contact-company-context-card"
                onClick={openCompanyRecord}
                role="button"
                tabIndex={0}
                aria-label={`Open company ${contact.company_name || ''}`.trim()}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCompanyRecord(); } }}
              >
                <Building2 size={14} className="contact-company-icon" />
                <span className="contact-company-name">{contact.company_name || 'View Company'}</span>
                <ArrowRight size={12} className="contact-company-arrow" />
              </div>
            )}
            <IdentityCard
              key={contact.photo_url || 'no-photo'}
              contact={contact}
              onRefreshPhoto={handleRefreshPhoto}
              photoRefreshLoading={photoRefreshLoading}
              photoRefreshError={photoRefreshError}
              onUpdate={handleContactUpdate}
            />
            <RecessiveActions contact={contact} />
            {barryContext ? (
              <MeetSection
                barryContext={barryContext}
                contact={contact}
                onStarterDraft={(starter, intentId) => {
                  const el = document.getElementById('engagement-section');
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  requestAnimationFrame(() => requestAnimationFrame(() => {
                    const ref = engagementSectionRef.current;
                    if (ref?.startWithIntent) ref.startWithIntent(starter, intentId);
                    else if (ref?.triggerFlow) ref.triggerFlow();
                  }));
                }}
              />
            ) : generatingContext ? (
              <div className="barry-loading-state">
                <Loader className="loading-icon" />
                <p>Barry is analyzing this contact...</p>
              </div>
            ) : null}
            <DetailDrawer contact={contact} onUpdate={handleContactUpdate} />
          </div>

          {/* CENTER — Action Column */}
          <div className="action-column">
            <PersistentEngageBar
              contact={contact}
              onEngageClick={triggerInlineEngagement}
              collapsed={engageBarCollapsed}
              onToggleCollapse={() => setEngageBarCollapsed(v => !v)}
            />

            {/* Stage peek (preview mode) vs live action panels */}
            {previewStage && previewStage !== contact.stage ? (
              <StagePeekCard
                stageId={previewStage}
                activeStageId={contact.stage}
                onBack={() => setPreviewStage(null)}
                T={T}
              />
            ) : (
              <>
                {/* Reinforcements → show playbooks; other stages → standard panels */}
                {contact.stage === 'reinforcements' ? (
                  <ReinforcementsEngagementPanel
                    contact={contact}
                    onPrefillCompose={(text) => {
                      const el = document.getElementById('engagement-section');
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      requestAnimationFrame(() => requestAnimationFrame(() => {
                        const ref = engagementSectionRef.current;
                        if (ref?.startWithIntent) ref.startWithIntent(text, 'warm');
                        else if (ref?.triggerFlow) ref.triggerFlow();
                      }));
                    }}
                  />
                ) : (
                  <StageEngagementPanel
                    contact={contact}
                    onMoved={handleStageMoved}
                  />
                )}
                <BarryInsightPanel
                  contactId={contact.id}
                  collapsed={insightPanelCollapsed}
                  onToggleCollapse={() => setInsightPanelCollapsed(v => !v)}
                  onAction={(rec) => {
                    if (['re_engage', 'start_mission', 'approve_next_step', 'switch_channel', 'accelerate_sequence'].includes(rec.action.type)) {
                      triggerInlineEngagement();
                    }
                  }}
                />
                <NextBestStep
                  contact={contact}
                  onEngageClick={triggerInlineEngagement}
                  onStepConfirmed={(step) => { console.log('[ContactProfile] Next step confirmed:', step); }}
                />
                <InlineEngagementSection
                  ref={engagementSectionRef}
                  contact={contact}
                  onContactUpdate={handleContactUpdate}
                  onReadyForHunter={onReadyForHunter}
                />
              </>
            )}
          </div>

          {/* RIGHT — History Column */}
          <div className="history-column">
            <EngagementScoreRing contact={contact} />
            <KeyMetricsGrid contact={contact} referralData={referralData} />
            <RelationshipArc contact={contact} />
            <EngagementTimeline contactId={contact.id} />
          </div>
        </div>

        {/* ── Referral Hub (full width, below three-col grid) ── */}
        <div className="referral-hub-row">
          <ReferralHub
            contact={contact}
            onOpenLinkedInImport={() => setShowLinkedInImport(true)}
          />
        </div>

      </div>

      {/* LinkedIn Import Modal */}
      <LinkedInImportModal
        isOpen={showLinkedInImport}
        onClose={() => setShowLinkedInImport(false)}
        onImportComplete={() => setShowLinkedInImport(false)}
      />

      {/* Archive Confirmation Modal */}
      {showArchiveModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowArchiveModal(false); }}
        >
          <div style={{ background: T.cardBg || T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 28, maxWidth: 420, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Archive size={18} color={T.textMuted} />
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>Archive {contact.name || 'this contact'}?</h3>
            </div>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: T.textMuted, lineHeight: 1.5 }}>
              This contact will be hidden from all views. You can unarchive them later.
            </p>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reason</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { value: 'not_relevant', label: 'Not relevant' },
                  { value: 'duplicate', label: 'Duplicate contact' },
                  { value: 'spam', label: 'Spam or invalid' },
                  { value: 'other', label: 'Other' },
                ].map(opt => (
                  <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: T.text }}>
                    <input
                      type="radio"
                      name="archive-reason"
                      value={opt.value}
                      checked={archiveReason === opt.value}
                      onChange={() => setArchiveReason(opt.value)}
                      style={{ accentColor: BRAND.pink }}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowArchiveModal(false)}
                disabled={archiving}
                style={{ padding: '8px 18px', borderRadius: 9, background: T.surface, border: `1px solid ${T.border2}`, color: T.textMuted, fontSize: 13, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleArchiveContact}
                disabled={archiving}
                style={{ padding: '8px 18px', borderRadius: 9, background: '#dc2626', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: archiving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: archiving ? 0.7 : 1 }}
              >
                {archiving ? <><Loader size={13} style={{ animation: 'spin 1s linear infinite' }} />Archiving...</> : <><Archive size={13} />Archive Contact</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}