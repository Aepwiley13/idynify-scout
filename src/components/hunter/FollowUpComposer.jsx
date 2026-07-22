import { useState, useEffect, useRef } from 'react';
import { X, Send, Sparkles, Loader } from 'lucide-react';
import { addDoc, collection } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import './FollowUpComposer.css';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { executeSendAction, CHANNELS, SEND_RESULT } from '../../utils/sendActionResolver';

/**
 * HUNTER PHASE 2: Follow-Up Composer
 *
 * Purpose: Manual follow-up message composition with AI assistance
 * Philosophy: User always controls follow-ups. No automation, no sequences.
 *
 * Features:
 * - Manual follow-up trigger (user decides when)
 * - AI-suggested follow-up based on outcome + context
 * - User edits before sending
 * - Creates new Hunter campaign with "followup" intent
 *
 * Non-automation: User reviews and approves every follow-up
 */

export default function FollowUpComposer({
  contact,
  originalCampaign,
  onClose,
  onFollowUpCreated
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const bodyTextareaRef = useRef(null);

  useEffect(() => {
    const el = bodyTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  useEffect(() => {
    // Pre-fill subject with Re: original subject
    if (originalCampaign && contact.subject) {
      const originalSubject = contact.subject;
      setSubject(originalSubject.startsWith('Re: ') ? originalSubject : `Re: ${originalSubject}`);
    }
  }, [originalCampaign, contact]);

  async function handleGenerateSuggestion() {
    setGenerating(true);
    try {
      const user = getEffectiveUser();
      if (!user) return;

      const idToken = await user.getIdToken();
      const response = await fetch('/.netlify/functions/generate-followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          contactId: contact.contactId,
          originalCampaignId: originalCampaign.id,
          outcome: contact.outcome,
          originalMessage: contact.body
        })
      });

      if (response.ok) {
        const data = await response.json();
        setBody(data.followUpBody);
      }
    } catch (error) {
      console.error('Failed to generate follow-up:', error);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSendFollowUp() {
    if (!subject.trim() || !body.trim()) return;

    setSending(true);
    try {
      const user = getEffectiveUser();
      if (!user) return;

      const contactName = contact.name || contact.contactName || '';
      const contactEmail = contact.email || contact.contactEmail || '';
      const contactId = contact.contactId;

      const sendContact = {
        id: contactId,
        email: contactEmail,
        firstName: contactName.split(' ')[0] || '',
        lastName: contactName.split(' ').slice(1).join(' ') || '',
      };

      const result = await executeSendAction({
        channel: CHANNELS.EMAIL,
        userId: user.uid,
        contact: sendContact,
        subject,
        body,
      });

      if (result.result === SEND_RESULT.SENT) {
        const sentAt = new Date();
        const campaignData = {
          name: `Follow-up: ${contactName}`,
          weapon: 'email',
          engagementIntent: 'followup',
          parentCampaignId: originalCampaign.id,
          contacts: [{
            contactId,
            name: contactName,
            email: contactEmail,
            subject,
            body,
            status: 'sent',
            sentAt,
            gmailMessageId: result.gmailMessageId || null,
            outcome: null,
            outcomeMarkedAt: null,
            outcomeLocked: false,
            outcomeLockedAt: null,
          }],
          createdAt: sentAt,
          userId: user.uid,
        };

        const campaignRef = await addDoc(
          collection(db, 'users', user.uid, 'campaigns'),
          campaignData
        );

        if (onFollowUpCreated) {
          onFollowUpCreated({
            campaignId: campaignRef.id,
            gmailMessageId: result.gmailMessageId,
            sentAt: sentAt.toISOString(),
          });
        }
        onClose();
      } else if (result.result === SEND_RESULT.OPENED) {
        alert(result.message || 'Email app opened — complete the send there.');
      } else {
        throw new Error(result.error || result.reason || 'Failed to send follow-up');
      }
    } catch (error) {
      console.error('Failed to send follow-up:', error);
      alert('Failed to send follow-up');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="followup-modal-overlay" onClick={onClose}>
      <div className="followup-modal" onClick={(e) => e.stopPropagation()}>
        <div className="followup-modal-header">
          <div>
            <h3>Follow-Up to {contact.name}</h3>
            <p className="followup-context">
              Original outcome: <span className="outcome-badge">{contact.outcome || 'none'}</span>
            </p>
          </div>
          <button className="btn-close-modal" onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="followup-modal-body">
          {/* AI Suggestion */}
          <div className="followup-ai-section">
            <button
              className="btn-generate-suggestion"
              onClick={handleGenerateSuggestion}
              disabled={generating}
            >
              {generating ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generate AI Suggestion
                </>
              )}
            </button>
            <p className="followup-ai-hint">
              AI will suggest a follow-up based on the outcome and original message
            </p>
          </div>

          {/* Subject Line */}
          <div className="form-group">
            <label>Subject Line</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Re: Original subject"
              className="form-input"
            />
          </div>

          {/* Message Body */}
          <div className="form-group">
            <label>Message</label>
            <textarea
              ref={bodyTextareaRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your follow-up message..."
              className="form-textarea"
            />
          </div>

          {/* Original Message Reference */}
          <div className="original-message-reference">
            <div className="reference-header">Original Message</div>
            <div className="reference-body">
              <div className="reference-subject"><strong>Subject:</strong> {contact.subject}</div>
              <div className="reference-text">{contact.body}</div>
            </div>
          </div>
        </div>

        <div className="followup-modal-footer">
          <button className="btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-send-followup"
            onClick={handleSendFollowUp}
            disabled={sending || !subject.trim() || !body.trim()}
          >
            {sending ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Send Follow-Up
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
