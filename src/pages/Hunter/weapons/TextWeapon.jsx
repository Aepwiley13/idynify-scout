import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, addDoc } from 'firebase/firestore';
import { db, auth } from '../../../firebase/config';
import { Users, Target, Sparkles, FileText, Send, Loader, AlertCircle, Copy, Check } from 'lucide-react';
import EngagementIntentSelector from '../../../components/hunter/EngagementIntentSelector';
import './TextWeapon.css';

/**
 * HUNTER WEAPON - Text Message Builder
 *
 * Purpose: Build intro or follow-up SMS with confidence
 * Philosophy: Short, direct, respectful of SMS medium
 * Sending: Manual (copy-paste workflow, no automated sending)
 *
 * Flow:
 * 1. Choose text type (Intro vs Follow-up)
 * 2. Select contacts (who to send to - must have phone numbers)
 * 3. Set engagement intent (cold/warm/hot/followup)
 * 4. Build message (AI-generated with character limit)
 * 5. Review & Copy (user sends manually via their SMS app)
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
  const [copiedIndex, setCopiedIndex] = useState(null);

  useEffect(() => {
    loadContacts();
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
        .filter(contact => contact.firstName || contact.lastName); // All contacts with a name

      setAllContacts(contactsList);
    } catch (error) {
      console.error('Error loading contacts:', error);
    }
  }

  function toggleContactSelection(contactId) {
    if (selectedContactIds.includes(contactId)) {
      setSelectedContactIds(selectedContactIds.filter(id => id !== contactId));
    } else {
      setSelectedContactIds([...selectedContactIds, contactId]);
    }
  }

  async function copyMessage(index, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      alert('Failed to copy message. Please copy manually.');
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

  async function handleSaveCampaign() {
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

      await addDoc(collection(db, 'users', user.uid, 'campaigns'), campaignData);

      alert('Campaign saved! Copy the messages below and send them via your phone\'s SMS app.');
    } catch (error) {
      console.error('Error saving campaign:', error);
      alert('Failed to save campaign. Please try again.');
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
          <h3 className="hunter-empty-title">No Contacts Found</h3>
          <p className="hunter-empty-text">
            Add contacts in Scout to start sending text messages.
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
                    {contact.phone || 'No phone saved'}
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

      {/* Step 5: Review & Copy Messages */}
      {currentStep === 5 && (
        <div className="weapon-step">
          <div className="step-header">
            <h2 className="step-title">Copy & Send Messages</h2>
            <p className="step-description">
              Copy each message and send via your phone's SMS app
            </p>
          </div>

          <div className="sms-notice" style={{ marginBottom: '1.5rem' }}>
            <AlertCircle className="w-5 h-5" />
            <span>Click the copy button for each message, then paste into your SMS app to send manually.</span>
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
                  <button
                    className="btn-primary-hunter"
                    onClick={() => copyMessage(index, message.body)}
                    style={{ width: '100%' }}
                  >
                    {copiedIndex === index ? (
                      <>
                        <Check className="w-5 h-5" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-5 h-5" />
                        Copy Message
                      </>
                    )}
                  </button>
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
              onClick={handleSaveCampaign}
              disabled={!canLaunch || loading}
            >
              {loading ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <FileText className="w-5 h-5" />
                  Save Campaign
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
