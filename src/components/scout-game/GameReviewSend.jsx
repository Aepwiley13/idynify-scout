import { useState } from 'react';
import { ArrowLeft, Send, ExternalLink, Check, Loader } from 'lucide-react';

/**
 * GameReviewSend — Final review before sending.
 *
 * Shows complete message + channel. Editable fields for subject and body.
 * Mirrors HunterContactDrawer.jsx:827-890 review view.
 *
 * Send button: disabled={!message || loading} — mirrors line 890.
 * G8: Send calls executeSendAction() — identical pipeline.
 */
export default function GameReviewSend({
  message,
  subject,
  weapon,
  contact,
  gmailConnected,
  loading,
  onMessageChange,
  onSubjectChange,
  onSend,
  onBack
}) {
  const contactName = `${contact?.firstName || ''} ${contact?.lastName || ''}`.trim();
  const isNativeHandoff = weapon !== 'email' || !gmailConnected;

  // Button label mirrors HunterContactDrawer getSendButtonLabel()
  const getSendLabel = () => {
    if (weapon === 'email' && gmailConnected) return 'Send Email';
    if (weapon === 'email') return 'Open Email Draft';
    if (weapon === 'text') return 'Open Text Message';
    if (weapon === 'call') return 'Call Contact';
    if (weapon === 'linkedin') return 'Open LinkedIn';
    return 'Send';
  };

  return (
    <div className="game-review-send">
      <div className="game-review-header">
        <button className="game-review-back-btn" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <h3 className="game-review-title">
          Review & {isNativeHandoff ? 'Open' : 'Send'}
        </h3>
      </div>

      <p className="game-review-description">
        {isNativeHandoff ? 'Opening' : 'Sending'} via {weapon} to {contactName}
      </p>

      {/* Native handoff notice — mirrors HunterContactDrawer:840-850 */}
      {isNativeHandoff && (
        <div className="game-review-handoff-notice">
          <ExternalLink className="w-4 h-4" />
          <span>
            {weapon === 'email' && !gmailConnected && 'Opens your email app. Connect Gmail for direct sending.'}
            {weapon === 'text' && 'Opens your SMS app to send manually.'}
            {weapon === 'call' && 'Opens your phone dialer.'}
            {weapon === 'linkedin' && 'Opens LinkedIn. Message copied to clipboard.'}
          </span>
        </div>
      )}

      {/* Gmail connected indicator */}
      {weapon === 'email' && gmailConnected && (
        <div className="game-review-gmail-notice">
          <Check className="w-4 h-4" />
          <span>Gmail connected — email will be sent directly</span>
        </div>
      )}

      {/* Editable fields — mirrors HunterContactDrawer:764-779 */}
      <div className="game-review-message">
        {weapon === 'email' && (
          <>
            <label className="game-review-label">Subject</label>
            <input
              type="text"
              className="game-review-subject-input"
              value={subject || ''}
              onChange={(e) => onSubjectChange(e.target.value)}
            />
          </>
        )}
        <label className="game-review-label">Message</label>
        <textarea
          className="game-review-message-input"
          value={message || ''}
          onChange={(e) => onMessageChange(e.target.value)}
          rows={6}
        />
      </div>

      {/* Send button — disabled={!message || loading} per HunterContactDrawer:890 */}
      <button
        className="game-review-send-btn"
        onClick={onSend}
        disabled={!message || loading}
      >
        {loading ? (
          <>
            <Loader className="w-4 h-4 spin" />
            Sending...
          </>
        ) : (
          <>
            <Send className="w-4 h-4" />
            {getSendLabel()}
          </>
        )}
      </button>
    </div>
  );
}
