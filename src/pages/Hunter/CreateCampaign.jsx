import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { collection, getDocs, addDoc, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { useActiveUserId, useImpersonation } from '../../context/ImpersonationContext';
import { ArrowLeft, Mail, Users, Sparkles, Loader, AlertCircle, CheckCircle, ChevronRight } from 'lucide-react';
import MissionSetup from '../../components/hunter/MissionSetup';
import TemplateLibrary from '../../components/hunter/TemplateLibrary';
import { logTimelineEvent, ACTORS } from '../../utils/timelineLogger';
import { updateContactStatus, STATUS_TRIGGERS } from '../../utils/contactStateMachine';

export default function CreateCampaign() {
  const navigate = useNavigate();
  const location = useLocation();
  const impersonatedUserId = useActiveUserId();
  const { isImpersonating } = useImpersonation();
  const getEffectiveUser = () => {
    const realUser = auth.currentUser;
    if (!realUser) return null;
    if (isImpersonating && impersonatedUserId) {
      return { uid: impersonatedUserId, getIdToken: () => realUser.getIdToken() };
    }
    return realUser;
  };
  const [step, setStep] = useState(1);
  const [campaignName, setCampaignName] = useState('');
  const [engagementIntent, setEngagementIntent] = useState(''); // NEW: Engagement intent
  const [allContacts, setAllContacts] = useState([]);
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [reconUsed, setReconUsed] = useState(false);
  const [reconSectionsUsed, setReconSectionsUsed] = useState({}); // NEW: Track which sections were actually used

  useEffect(() => {
    // Pre-fill from MeetSection navigation state
    if (location.state?.contactIds) {
      setSelectedContactIds(location.state.contactIds);
    }
    if (location.state?.engagementIntent) {
      setEngagementIntent(location.state.engagementIntent);
    }
    checkGmailAndLoadContacts();
  }, []);

  async function checkGmailAndLoadContacts() {
    try {
      const user = getEffectiveUser();
      if (!user) {
        navigate('/login');
        return;
      }

      // Check Gmail connection
      const gmailDoc = await getDoc(doc(db, 'users', user.uid, 'integrations', 'gmail'));
      if (!gmailDoc.exists() || gmailDoc.data().status !== 'connected') {
        setGmailConnected(false);
        setError('Gmail not connected. Please connect Gmail first.');
        return;
      }
      setGmailConnected(true);

      // Load all contacts
      const contactsSnapshot = await getDocs(collection(db, 'users', user.uid, 'contacts'));
      const contactsList = contactsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setAllContacts(contactsList);

      // Check for pre-selected contacts from Scout
      const params = new URLSearchParams(location.search);
      const contactIdsParam = params.get('contactIds');
      if (contactIdsParam) {
        const preSelectedIds = contactIdsParam.split(',');
        setSelectedContactIds(preSelectedIds);
      }
    } catch (err) {
      console.error('Error loading data:', err);
      setError('Failed to load contacts');
    }
  }

  async function handleGenerateMessages() {
    if (selectedContactIds.length === 0) {
      setError('Please select at least one contact');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const user = getEffectiveUser();
      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/generate-campaign-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          contactIds: selectedContactIds,
          campaignName,
          engagementIntent // NEW: Pass engagement intent to backend
        })
      });

      if (!response.ok) {
        throw new Error('Failed to generate messages');
      }

      const data = await response.json();
      setMessages(data.messages);
      setReconUsed(data.reconUsed);
      setReconSectionsUsed(data.reconSectionsUsed || {}); // NEW: Store which sections were used
      setStep(5); // NEW: Step 5 instead of 4 (added Mission Setup step)
    } catch (err) {
      console.error('Error generating messages:', err);
      setError('Failed to generate messages. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveCampaign() {
    setLoading(true);
    setError(null);

    try {
      const user = getEffectiveUser();

      // Transform messages into contacts array with outcome tracking fields
      const contacts = messages.map(msg => ({
        contactId: msg.contactId,
        name: msg.contactName,
        email: msg.contactEmail,
        company_name: msg.companyName || '',
        title: msg.title || '',
        subject: msg.subject,
        body: msg.body,
        status: 'pending',
        sentAt: null,
        outcome: null,
        outcomeMarkedAt: null,
        outcomeLocked: false,
        outcomeLockedAt: null
      }));

      const campaignData = {
        name: campaignName,
        engagementIntent: engagementIntent, // NEW
        weapon: 'email', // NEW
        userId: user.uid,
        contacts: contacts, // NEW: Store contacts with messages inline
        status: 'draft',
        reconUsed: reconUsed,
        reconSectionsUsed: reconSectionsUsed, // NEW: Store exactly which sections were used
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null
      };

      const docRef = await addDoc(collection(db, 'users', user.uid, 'campaigns'), campaignData);

      // Log timeline event: campaign_assigned for each contact
      contacts.forEach(c => {
        logTimelineEvent({
          userId: user.uid,
          contactId: c.contactId,
          type: 'campaign_assigned',
          actor: ACTORS.USER,
          preview: campaignName,
          metadata: {
            campaignId: docRef.id,
            campaignName
          }
        });

        // State Machine: Campaign assigned → In Campaign
        updateContactStatus({
          userId: user.uid,
          contactId: c.contactId,
          trigger: STATUS_TRIGGERS.CAMPAIGN_ASSIGNED
        });

        // Step 7: Denormalize campaignId onto contact document for read-time recommendation queries
        updateDoc(doc(db, 'users', user.uid, 'contacts', c.contactId), {
          campaignId: docRef.id,
          campaignName: campaignName
        }).catch(err => console.error('[CreateCampaign] Failed to denormalize campaignId:', err));
      });

      // Navigate to campaign detail
      navigate(`/hunter/campaign/${docRef.id}`);
    } catch (err) {
      console.error('Error saving campaign:', err);
      setError('Failed to save campaign. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function updateMessage(index, field, value) {
    const updated = [...messages];
    updated[index][field] = value;
    setMessages(updated);
  }

  function toggleContactSelection(contactId) {
    if (selectedContactIds.includes(contactId)) {
      setSelectedContactIds(selectedContactIds.filter(id => id !== contactId));
    } else {
      setSelectedContactIds([...selectedContactIds, contactId]);
    }
  }

  // PHASE 2: Handle template selection (pre-fills messages from template)
  function handleSelectTemplate(template) {
    const templatedMessages = selectedContacts.map(contact => ({
      contactId: contact.id,
      contactName: `${contact.firstName} ${contact.lastName}`,
      contactEmail: contact.email,
      companyName: contact.company_name || '',
      title: contact.title || '',
      subject: template.subject,
      body: template.body.replace(/\[FirstName\]/g, contact.firstName || 'there')
    }));

    setMessages(templatedMessages);
    setReconUsed(false); // Templates don't use RECON
    setReconSectionsUsed({});
    setStep(5); // Go to review
  }

  const selectedContacts = allContacts.filter(c => selectedContactIds.includes(c.id));

  if (!gmailConnected && error) {
    return (
      <div className="min-h-screen bg-white text-gray-900 flex items-center justify-center">
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 max-w-md">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-center mb-2">Gmail Not Connected</h2>
          <p className="text-gray-500 text-center mb-6">{error}</p>
          <button
            onClick={() => navigate('/hunter')}
            className="w-full px-6 py-3 bg-blue-500 hover:bg-blue-600 rounded-lg font-bold transition-colors"
          >
            Go to Hunter Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <div className="border-b border-gray-200 bg-gray-50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/hunter')}
                className="text-gray-500 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h1 className="text-xl font-bold">Create Campaign</h1>
            </div>

            {/* Step Indicator */}
            <div className="flex items-center gap-2 text-sm">
              <div className={`px-3 py-1 rounded-full ${step >= 1 ? 'bg-purple-500/20 text-purple-400' : 'bg-gray-200 text-gray-400'}`}>
                1. Details
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
              <div className={`px-3 py-1 rounded-full ${step >= 2 ? 'bg-purple-500/20 text-purple-400' : 'bg-gray-200 text-gray-400'}`}>
                2. Mission
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
              <div className={`px-3 py-1 rounded-full ${step >= 3 ? 'bg-purple-500/20 text-purple-400' : 'bg-gray-200 text-gray-400'}`}>
                3. Contacts
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
              <div className={`px-3 py-1 rounded-full ${step >= 4 ? 'bg-purple-500/20 text-purple-400' : 'bg-gray-200 text-gray-400'}`}>
                4. Generate
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
              <div className={`px-3 py-1 rounded-full ${step >= 5 ? 'bg-purple-500/20 text-purple-400' : 'bg-gray-200 text-gray-400'}`}>
                5. Review
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 bg-red-500/20 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <span className="text-red-400">{error}</span>
          </div>
        )}

        {/* Step 1: Campaign Details */}
        {step === 1 && (
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8">
            <h2 className="text-2xl font-bold mb-6">Campaign Details</h2>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-2">Campaign Name</label>
                <input
                  type="text"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="e.g., Q1 Enterprise Outreach"
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 transition-colors"
                />
              </div>

              <button
                onClick={() => setStep(2)}
                disabled={!campaignName.trim()}
                className={`w-full px-6 py-3 rounded-lg font-bold transition-all ${
                  campaignName.trim()
                    ? 'bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                Next: Mission Setup
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Mission Setup (Engagement Intent) */}
        {step === 2 && (
          <MissionSetup
            intent={engagementIntent}
            onIntentChange={setEngagementIntent}
            contacts={selectedContacts}
          />
        )}

        {step === 2 && (
          <div className="mt-6 flex gap-4 max-w-5xl mx-auto">
            <button
              onClick={() => setStep(1)}
              className="flex-1 px-6 py-3 bg-gray-200 hover:bg-gray-100 rounded-lg font-bold transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!engagementIntent}
              className={`flex-1 px-6 py-3 rounded-lg font-bold transition-all ${
                engagementIntent
                  ? 'bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              Next: Select Contacts
            </button>
          </div>
        )}

        {/* Step 3: Select Contacts */}
        {step === 3 && (
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8">
            <h2 className="text-2xl font-bold mb-2">Select Contacts</h2>
            <p className="text-gray-500 mb-6">{selectedContactIds.length} contacts selected</p>

            {selectedContactIds.length > 25 && (
              <div className="mb-6 bg-yellow-500/20 border border-yellow-500/30 rounded-lg p-4 flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-400" />
                <span className="text-yellow-400 text-sm">Gmail limits apply (~500 emails/day)</span>
              </div>
            )}

            <div className="space-y-3 max-h-96 overflow-y-auto mb-6">
              {allContacts.map(contact => (
                <div
                  key={contact.id}
                  onClick={() => toggleContactSelection(contact.id)}
                  className={`p-4 border rounded-lg cursor-pointer transition-all ${
                    selectedContactIds.includes(contact.id)
                      ? 'bg-purple-500/20 border-purple-500/50'
                      : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedContactIds.includes(contact.id)}
                      onChange={() => {}}
                      className="w-5 h-5"
                    />
                    <div className="flex-1">
                      <div className="font-medium">{contact.name}</div>
                      <div className="text-sm text-gray-500">
                        {contact.title && `${contact.title} • `}
                        {contact.company_name}
                        {contact.email && ` • ${contact.email}`}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setStep(2)}
                className="flex-1 px-6 py-3 bg-gray-200 hover:bg-gray-100 rounded-lg font-bold transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => setStep(4)}
                disabled={selectedContactIds.length === 0}
                className={`flex-1 px-6 py-3 rounded-lg font-bold transition-all ${
                  selectedContactIds.length > 0
                    ? 'bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                Next: Generate Messages
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Generate Messages */}
        {step === 4 && (
          <div className="space-y-6">
            {/* PHASE 2: Template Library (optional) */}
            <TemplateLibrary
              onSelectTemplate={handleSelectTemplate}
              selectedIntent={engagementIntent}
            />

            {/* OR divider */}
            <div className="flex items-center gap-4">
              <div className="flex-1 h-px bg-gray-200"></div>
              <span className="text-sm text-gray-400">OR</span>
              <div className="flex-1 h-px bg-gray-200"></div>
            </div>

            {/* AI Generation */}
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 text-center">
              <h2 className="text-2xl font-bold mb-6">Generate Personalized Messages</h2>

              <div className="mb-8">
                <div className="w-16 h-16 rounded-full bg-purple-500/20 flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="w-8 h-8 text-purple-400" />
                </div>
                <p className="text-gray-700 mb-2">Ready to generate {selectedContactIds.length} personalized emails</p>
                <p className="text-sm text-gray-500">Using AI + RECON intelligence</p>
              </div>

              {loading ? (
                <div>
                  <Loader className="w-8 h-8 text-purple-400 animate-spin mx-auto mb-4" />
                  <p className="text-gray-500">Generating personalized messages...</p>
                </div>
              ) : (
                <div className="flex gap-4">
                  <button
                    onClick={() => setStep(3)}
                    className="flex-1 px-6 py-3 bg-gray-200 hover:bg-gray-100 rounded-lg font-bold transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleGenerateMessages}
                    className="flex-1 px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white rounded-lg font-bold transition-all flex items-center justify-center gap-2"
                  >
                    <Sparkles className="w-5 h-5" />
                    Generate Messages
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 5: Review & Edit Messages */}
        {step === 5 && (
          <div>
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6 mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold mb-2">Review Messages</h2>
                  <p className="text-gray-500">Edit any message before saving</p>
                </div>
                {reconUsed && (
                  <div className="flex items-center gap-2 px-4 py-2 bg-purple-500/20 border border-purple-500/30 rounded-lg">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    <span className="text-sm text-purple-400">Using your RECON insights</span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-6 mb-6">
              {messages.map((message, index) => (
                <div key={index} className="bg-gray-50 border border-gray-200 rounded-xl p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                      <Mail className="w-5 h-5 text-purple-400" />
                    </div>
                    <div>
                      <div className="font-medium">{message.contactName}</div>
                      <div className="text-sm text-gray-500">{message.contactEmail}</div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Subject</label>
                      <input
                        type="text"
                        value={message.subject}
                        onChange={(e) => updateMessage(index, 'subject', e.target.value)}
                        className="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 transition-colors"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2">Message</label>
                      <textarea
                        value={message.body}
                        onChange={(e) => updateMessage(index, 'body', e.target.value)}
                        rows={8}
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 transition-colors font-mono text-sm"
                      />
                      <div className="text-xs text-gray-400 mt-1">{message.body.length} characters</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setStep(4)}
                className="flex-1 px-6 py-3 bg-gray-200 hover:bg-gray-100 rounded-lg font-bold transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleSaveCampaign}
                disabled={loading}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white rounded-lg font-bold transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader className="w-5 h-5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    Save Campaign
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
