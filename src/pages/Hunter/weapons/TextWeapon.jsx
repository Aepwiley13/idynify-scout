import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, addDoc } from 'firebase/firestore';
import { db, auth } from '../../../firebase/config';
import { Users, Target, Sparkles, FileText, Send, Loader, AlertCircle } from 'lucide-react';
import EngagementIntentSelector from '../../../components/hunter/EngagementIntentSelector';
import './TextWeapon.css';

/**
 * HUNTER WEAPON - Text Message Builder
 *
 * Purpose: Build intro or follow-up SMS with confidence
 * Philosophy: Short, direct, respectful of SMS medium
 *
 * Flow:
 * 1. Choose text type (Intro vs Follow-up)
 * 2. Select contacts (who to send to - must have phone numbers)
 * 3. Set engagement intent (cold/warm/hot/followup)
 * 4. Build message (AI-generated with character limit)
 * 5. Review & Launch
 *
 * SMS Rules:
 * - 160 characters = 1 SMS
 * - 306 characters = 2 SMS (concatenated)
 * - Keep it concise and actionable
 */

export default function TextWeapon({ onBack }) {
  const navigate = useNavigate();
  const [textType, setTextType] = useState('intro'); // intro or followup
  const [allContacts, setAllContacts] = useState([]);
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const [engagementIntent, setEngagementIntent] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [twilioSetup, setTwilioSetup] = useState(false);

  useEffect(() => {
    loadContacts();
    checkTwilioSetup();
  }, []);

  async function loadContacts() {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const contactsSnapshot = await getDocs(collection(db, 'users', user.uid, 'contacts'));
      const contactsList = contactsSnapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        .filter(contact => contact.phone); // Only contacts with phone numbers

      setAllContacts(contactsList);
    } catch (error) {
      console.error('Error loading contacts:', error);
    }
  }

  async function checkTwilioSetup() {
    try {
      const user = auth.currentUser;
      if (!user) return;

      // Check if Twilio is configured for this user
      const authToken = await user.getIdToken();
      const response = await fetch('/.netlify/functions/check-twilio-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: authToken })
      });

      if (response.ok) {
        const data = await response.json();
        setTwilioSetup(data.isSetup);
      }
    } catch (error) {
      console.error('Error checking Twilio setup:', error);
      setTwilioSetup(false);
    }
  }

  function toggleContactSelection(contactId) {
    if (selectedContactIds.includes(contactId)) {
      setSelectedContactIds(selectedContactIds.filter(id => id !== contactId));
    } else {
      setSelectedContactIds([...selectedContactIds, contactId]);
    }
  }

  async function handleGenerateWithAI() {
    setLoading(true);

    try {
      const user = auth.currentUser;
      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/generate-text-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          contactIds: selectedContactIds,
          campaignName: campaignName || `${textType === 'intro' ? 'Intro' : 'Follow-up'} Text Campaign`,
          engagementIntent,
          textType
        })
      });

      if (!response.ok) throw new Error('Failed to generate messages');

      const data = await response.json();
      setMessages(data.messages);
      setCurrentStep(5); // Go to review
    } catch (error) {
      console.error('Error generating messages:', error);
      alert('Failed to generate messages. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleLaunchCampaign() {
    setLoading(true);

    try {
      const user = auth.currentUser;

      const contacts = messages.map(msg => ({
        contactId: msg.contactId,
        name: msg.contactName,
        phone: msg.contactPhone,
        message: msg.body,
        status: 'pending',
        sentAt: null,
        outcome: null,
        outcomeMarkedAt: null,
        outcomeLocked: false,
        outcomeLockedAt: null
      }));

      const campaignData = {
        name: campaignName || `${textType === 'intro' ? 'Intro' : 'Follow-up'} Text Campaign`,
        engagementIntent: engagementIntent,
        weapon: 'text',
        textType: textType,
        userId: user.uid,
        contacts: contacts,
        status: 'draft',
        reconUsed: false,
        reconSectionsUsed: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null
      };

      const docRef = await addDoc(collection(db, 'users', user.uid, 'campaigns'), campaignData);

      // Navigate to campaign detail
      navigate(`/hunter/campaign/${docRef.id}`);
    } catch (error) {
      console.error('Error launching campaign:', error);
      alert('Failed to launch campaign. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function updateMessage(index, value) {
    const updated = [...messages];
    updated[index].body = value;
    setMessages(updated);
  }

  function getCharacterCount(text) {
    const length = text.length;
    if (length <= 160) return `${length}/160 (1 SMS)`;
    if (length <= 306) return `${length}/306 (2 SMS)`;
    return `${length} characters (${Math.ceil(length / 153)} SMS)`;
  }

  const selectedContacts = allContacts.filter(c => selectedContactIds.includes(c.id));
  const canProceedToStep3 = selectedContactIds.length > 0;
  const canProceedToStep4 = engagementIntent !== '';
  const canLaunch = messages.length > 0;

  // Check if Twilio is not setup
  if (!twilioSetup && currentStep === 1) {
    return (
      <div className="text-weapon">
        <div className="weapon-header">
          <button className="btn-back-weapon" onClick={onBack}>
            ← Back to Weapons
          </button>
        </div>

        <div className="twilio-setup-required">
          <div className="setup-icon">
            <AlertCircle className="w-12 h-12 text-yellow-400" />
          </div>
          <h2>SMS Setup Required</h2>
          <p>
            To send text messages, you need to connect a Twilio account. Twilio is an SMS provider that enables programmatic text messaging.
          </p>
          <div className="setup-steps">
            <h3>What you'll need:</h3>
            <ol>
              <li>Twilio Account (free tier available)</li>
              <li>Twilio Phone Number</li>
              <li>Account SID & Auth Token</li>
            </ol>
          </div>
          <div className="setup-actions">
            <button className="btn-secondary" onClick={onBack}>
              Back to Weapons
            </button>
            <button
              className="btn-primary-hunter"
              onClick={() => window.open('https://www.twilio.com/try-twilio', '_blank')}
            >
              Get Twilio Account →
            </button>
          </div>
          <p className="setup-note">
            Once you have Twilio credentials, contact support to complete integration.
          </p>
        </div>
      </div>
    );
  }

  if (allContacts.length === 0 && currentStep === 1) {
    return (
      <div className="text-weapon">
        <div className="weapon-header">
          <button className="btn-back-weapon" onClick={onBack}>
            ← Back to Weapons
          </button>
        </div>

        <div className="hunter-empty-state">
          <div className="hunter-empty-icon">
            <Users className="w-10 h-10 text-purple-400" />
          </div>
          <h3 className="hunter-empty-title">No Contacts with Phone Numbers</h3>
          <p className="hunter-empty-text">
            Add phone numbers to your contacts in Scout before sending text messages.
          </p>
          <button className="btn-primary-hunter" onClick={() => navigate('/scout')}>
            Go to Scout
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="text-weapon">
      {/* Header with Back */}
      <div className="weapon-header">
        <button className="btn-back-weapon" onClick={onBack}>
          ← Back to Weapons
        </button>
        <div className="weapon-progress">
          <span className={`progress-step ${currentStep >= 1 ? 'active' : ''}`}>1</span>
          <div className={`progress-line ${currentStep > 1 ? 'active' : ''}`}></div>
          <span className={`progress-step ${currentStep >= 2 ? 'active' : ''}`}>2</span>
          <div className={`progress-line ${currentStep > 2 ? 'active' : ''}`}></div>
          <span className={`progress-step ${currentStep >= 3 ? 'active' : ''}`}>3</span>
          <div className={`progress-line ${currentStep > 3 ? 'active' : ''}`}></div>
          <span className={`progress-step ${currentStep >= 4 ? 'active' : ''}`}>4</span>
          <div className={`progress-line ${currentStep > 4 ? 'active' : ''}`}></div>
          <span className={`progress-step ${currentStep >= 5 ? 'active' : ''}`}>5</span>
        </div>
      </div>

      {/* Step 1: Text Type */}
      {currentStep === 1 && (
        <div className="weapon-step">
          <div className="step-header">
            <h2 className="step-title">What type of text are you sending?</h2>
            <p className="step-description">Choose whether this is a first touch or a follow-up</p>
          </div>

          <div className="text-type-options">
            <div
              className={`text-type-card ${textType === 'intro' ? 'selected' : ''}`}
              onClick={() => setTextType('intro')}
            >
              <div className="text-type-icon">📱</div>
              <h3>Intro Text</h3>
              <p>First outreach to a new contact</p>
            </div>

            <div
              className={`text-type-card ${textType === 'followup' ? 'selected' : ''}`}
              onClick={() => setTextType('followup')}
            >
              <div className="text-type-icon">🔁</div>
              <h3>Follow-Up Text</h3>
              <p>Continuing a previous conversation</p>
            </div>
          </div>

          <div className="sms-notice">
            <AlertCircle className="w-5 h-5" />
            <span>SMS is best for short, direct messages. Keep it under 160 characters for 1 text.</span>
          </div>

          <div className="step-actions">
            <button
              className="btn-primary-hunter"
              onClick={() => setCurrentStep(2)}
            >
              Next: Select Contacts →
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Select Contacts */}
      {currentStep === 2 && (
        <div className="weapon-step">
          <div className="step-header">
            <h2 className="step-title">Who are you texting?</h2>
            <p className="step-description">
              Selected: {selectedContactIds.length} contact{selectedContactIds.length !== 1 ? 's' : ''}
            </p>
          </div>

          <div className="contacts-list">
            {allContacts.map(contact => (
              <div
                key={contact.id}
                className={`contact-item ${selectedContactIds.includes(contact.id) ? 'selected' : ''}`}
                onClick={() => toggleContactSelection(contact.id)}
              >
                <input
                  type="checkbox"
                  checked={selectedContactIds.includes(contact.id)}
                  onChange={() => {}}
                  className="contact-checkbox"
                />
                <div className="contact-info">
                  <div className="contact-name">{contact.firstName} {contact.lastName}</div>
                  <div className="contact-meta">
                    {contact.phone}
                    {contact.title && ` • ${contact.title}`}
                    {contact.company_name && ` • ${contact.company_name}`}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="step-actions">
            <button className="btn-secondary" onClick={() => setCurrentStep(1)}>
              ← Back
            </button>
            <button
              className="btn-primary-hunter"
              onClick={() => setCurrentStep(3)}
              disabled={!canProceedToStep3}
            >
              Next: Set Intent →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Engagement Intent */}
      {currentStep === 3 && (
        <div className="weapon-step">
          <div className="step-header">
            <h2 className="step-title">What's your relationship with {selectedContactIds.length === 1 ? 'this person' : 'these people'}?</h2>
            <p className="step-description">This helps us match the right tone</p>
          </div>

          <EngagementIntentSelector
            selectedIntent={engagementIntent}
            onSelectIntent={setEngagementIntent}
          />

          <div className="step-actions">
            <button className="btn-secondary" onClick={() => setCurrentStep(2)}>
              ← Back
            </button>
            <button
              className="btn-primary-hunter"
              onClick={() => setCurrentStep(4)}
              disabled={!canProceedToStep4}
            >
              Next: Build Message →
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Generate Message with AI */}
      {currentStep === 4 && (
        <div className="weapon-step">
          <div className="step-header">
            <h2 className="step-title">Generate Text Messages</h2>
            <p className="step-description">AI will create concise SMS messages optimized for mobile</p>
          </div>

          <div className="build-method-section">
            <div className="build-method-option">
              <div className="build-method-header">
                <Sparkles className="w-5 h-5" />
                <h3>AI-Generated SMS</h3>
              </div>
              <p>Short, actionable messages that respect the SMS medium</p>

              <div className="campaign-name-input">
                <label>Campaign Name (Optional)</label>
                <input
                  type="text"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="e.g., Q1 Mobile Outreach"
                  className="form-input"
                />
              </div>

              <button
                className="btn-generate-ai"
                onClick={handleGenerateWithAI}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader className="w-5 h-5 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Generate {selectedContactIds.length} Message{selectedContactIds.length !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="step-actions">
            <button className="btn-secondary" onClick={() => setCurrentStep(3)}>
              ← Back
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Review & Launch */}
      {currentStep === 5 && (
        <div className="weapon-step">
          <div className="step-header">
            <h2 className="step-title">Review & Launch</h2>
            <p className="step-description">
              Edit any message before launching
            </p>
          </div>

          <div className="messages-review">
            {messages.map((message, index) => (
              <div key={index} className="message-review-card">
                <div className="message-review-header">
                  <div className="message-contact">
                    <span className="message-contact-name">{message.contactName}</span>
                    <span className="message-contact-phone">{message.contactPhone}</span>
                  </div>
                </div>

                <div className="message-review-fields">
                  <div className="form-group">
                    <div className="form-label-row">
                      <label>Message</label>
                      <span className="character-count">{getCharacterCount(message.body)}</span>
                    </div>
                    <textarea
                      value={message.body}
                      onChange={(e) => updateMessage(index, e.target.value)}
                      rows={4}
                      className="form-textarea"
                      maxLength={500}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="step-actions">
            <button className="btn-secondary" onClick={() => setCurrentStep(4)}>
              ← Back
            </button>
            <button
              className="btn-primary-hunter"
              onClick={handleLaunchCampaign}
              disabled={!canLaunch || loading}
            >
              {loading ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Launching...
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  Launch Campaign
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
