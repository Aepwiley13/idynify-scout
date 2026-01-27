import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, addDoc } from 'firebase/firestore';
import { db, auth } from '../../../firebase/config';
import { Users, Target, Sparkles, FileText, Send, Loader } from 'lucide-react';
import EngagementIntentSelector from '../../../components/hunter/EngagementIntentSelector';
import TemplateLibrary from '../../../components/hunter/TemplateLibrary';
import './EmailWeapon.css';

/**
 * HUNTER WEAPON - Email Builder
 *
 * Purpose: Build intro or follow-up emails with confidence
 * Philosophy: Step-by-step, clear, non-intimidating
 *
 * Flow:
 * 1. Choose email type (Intro / Follow-up)
 * 2. Select who (contacts)
 * 3. Set intent (Cold/Warm/Hot/Follow-up)
 * 4. Build message (Template OR AI)
 * 5. Review & Launch
 */

export default function EmailWeapon({ onBack }) {
  const navigate = useNavigate();
  const [emailType, setEmailType] = useState('intro'); // intro or followup
  const [allContacts, setAllContacts] = useState([]);
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const [engagementIntent, setEngagementIntent] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [buildMethod, setBuildMethod] = useState(null); // 'template' or 'ai'
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reconUsed, setReconUsed] = useState(false);
  const [reconSectionsUsed, setReconSectionsUsed] = useState({});

  // Current step in builder
  const [currentStep, setCurrentStep] = useState(1);

  useEffect(() => {
    loadContacts();
  }, []);

  async function loadContacts() {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const contactsSnapshot = await getDocs(collection(db, 'users', user.uid, 'contacts'));
      const contactsList = contactsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
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

  async function handleGenerateWithAI() {
    setLoading(true);
    setBuildMethod('ai');

    try {
      const user = auth.currentUser;
      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/generate-campaign-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          contactIds: selectedContactIds,
          campaignName: campaignName || `${emailType === 'intro' ? 'Intro' : 'Follow-up'} Email Campaign`,
          engagementIntent
        })
      });

      if (!response.ok) throw new Error('Failed to generate messages');

      const data = await response.json();
      setMessages(data.messages);
      setReconUsed(data.reconUsed);
      setReconSectionsUsed(data.reconSectionsUsed || {});
      setCurrentStep(5); // Go to review
    } catch (error) {
      console.error('Error generating messages:', error);
      alert('Failed to generate messages. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleSelectTemplate(template) {
    setBuildMethod('template');

    const selectedContacts = allContacts.filter(c => selectedContactIds.includes(c.id));
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
    setReconUsed(false);
    setReconSectionsUsed({});
    setCurrentStep(5); // Go to review
  }

  async function handleLaunchCampaign() {
    setLoading(true);

    try {
      const user = auth.currentUser;

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
        name: campaignName || `${emailType === 'intro' ? 'Intro' : 'Follow-up'} Email Campaign`,
        engagementIntent: engagementIntent,
        weapon: 'email',
        emailType: emailType,
        userId: user.uid,
        contacts: contacts,
        status: 'draft',
        reconUsed: reconUsed,
        reconSectionsUsed: reconSectionsUsed,
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

  function updateMessage(index, field, value) {
    const updated = [...messages];
    updated[index][field] = value;
    setMessages(updated);
  }

  const selectedContacts = allContacts.filter(c => selectedContactIds.includes(c.id));
  const canProceedToStep3 = selectedContactIds.length > 0;
  const canProceedToStep4 = engagementIntent !== '';
  const canLaunch = messages.length > 0;

  return (
    <div className="email-weapon">
      {/* Header with Back */}
      <div className="weapon-header">
        <button className="btn-back-weapon" onClick={onBack}>
          ← Back to Weapons
        </button>
        <div className="weapon-progress">
          <span className="progress-step {currentStep >= 1 ? 'active' : ''}">1</span>
          <div className="progress-line {currentStep > 1 ? 'active' : ''}"></div>
          <span className="progress-step {currentStep >= 2 ? 'active' : ''}">2</span>
          <div className="progress-line {currentStep > 2 ? 'active' : ''}"></div>
          <span className="progress-step {currentStep >= 3 ? 'active' : ''}">3</span>
          <div className="progress-line {currentStep > 3 ? 'active' : ''}"></div>
          <span className="progress-step {currentStep >= 4 ? 'active' : ''}">4</span>
          <div className="progress-line {currentStep > 4 ? 'active' : ''}"></div>
          <span className="progress-step {currentStep >= 5 ? 'active' : ''}">5</span>
        </div>
      </div>

      {/* Step 1: Email Type */}
      {currentStep === 1 && (
        <div className="weapon-step">
          <div className="step-header">
            <h2 className="step-title">What type of email are you sending?</h2>
            <p className="step-description">Choose whether this is a first touch or a follow-up</p>
          </div>

          <div className="email-type-options">
            <div
              className={`email-type-card ${emailType === 'intro' ? 'selected' : ''}`}
              onClick={() => setEmailType('intro')}
            >
              <div className="email-type-icon">✉️</div>
              <h3>Intro Email</h3>
              <p>First outreach to a new contact</p>
            </div>

            <div
              className={`email-type-card ${emailType === 'followup' ? 'selected' : ''}`}
              onClick={() => setEmailType('followup')}
            >
              <div className="email-type-icon">🔁</div>
              <h3>Follow-Up Email</h3>
              <p>Continuing a previous conversation</p>
            </div>
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
            <h2 className="step-title">Who are you sending to?</h2>
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
                    {contact.title && `${contact.title} • `}
                    {contact.company_name}
                    {contact.email && ` • ${contact.email}`}
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

      {/* Step 4: Build Method (Template or AI) */}
      {currentStep === 4 && (
        <div className="weapon-step">
          <div className="step-header">
            <h2 className="step-title">How do you want to build your message?</h2>
            <p className="step-description">Choose a template or generate with AI + RECON</p>
          </div>

          <div className="build-method-section">
            {/* Template Option */}
            <div className="build-method-option">
              <div className="build-method-header">
                <FileText className="w-5 h-5" />
                <h3>Use a Template</h3>
              </div>
              <p>Start with a proven message structure</p>
              <TemplateLibrary
                onSelectTemplate={handleSelectTemplate}
                selectedIntent={engagementIntent}
              />
            </div>

            {/* OR Divider */}
            <div className="build-method-divider">
              <div className="divider-line"></div>
              <span className="divider-text">OR</span>
              <div className="divider-line"></div>
            </div>

            {/* AI Option */}
            <div className="build-method-option">
              <div className="build-method-header">
                <Sparkles className="w-5 h-5" />
                <h3>Generate with AI + RECON</h3>
              </div>
              <p>Personalized messages using intelligence from RECON</p>

              <div className="campaign-name-input">
                <label>Campaign Name (Optional)</label>
                <input
                  type="text"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="e.g., Q1 Enterprise Outreach"
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
              Edit any message before launching • {reconUsed ? 'Using RECON intelligence' : `Using ${buildMethod} method`}
            </p>
          </div>

          <div className="messages-review">
            {messages.map((message, index) => (
              <div key={index} className="message-review-card">
                <div className="message-review-header">
                  <div className="message-contact">
                    <span className="message-contact-name">{message.contactName}</span>
                    <span className="message-contact-email">{message.contactEmail}</span>
                  </div>
                </div>

                <div className="message-review-fields">
                  <div className="form-group">
                    <label>Subject</label>
                    <input
                      type="text"
                      value={message.subject}
                      onChange={(e) => updateMessage(index, 'subject', e.target.value)}
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label>Message</label>
                    <textarea
                      value={message.body}
                      onChange={(e) => updateMessage(index, 'body', e.target.value)}
                      rows={8}
                      className="form-textarea"
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
