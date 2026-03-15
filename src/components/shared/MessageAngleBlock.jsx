/**
 * MessageAngleBlock — 4-angle message selector inside a Barry chat bubble.
 *
 * Props:
 *   angles      — Array of { id, label, subject, message, recommended }
 *   contactId   — Firestore contact ID (for Load into Hunter)
 *   userId      — Firebase UID (for Load into Hunter)
 *   onLoaded    — Optional callback when Load into Hunter succeeds
 *
 * Behaviour:
 *   - Tabs: value_add / direct_ask / soft_reconnect / pattern_interrupt
 *   - ★ star on recommended angle tab
 *   - Editable subject input + message textarea (per-angle state)
 *   - Copy button: copies "Subject: ...\n\n..." to clipboard
 *   - Load into Hunter: calls loadIntoHunter utility, shows inline feedback
 *   - If contactId missing: Load into Hunter button is hidden
 */

import { useState } from 'react';
import { loadIntoHunter } from '../../utils/loadIntoHunter';
import './MessageAngleBlock.css';

export default function MessageAngleBlock({ angles, contactId, userId, onLoaded }) {
  const defaultId = angles?.find(a => a.recommended)?.id || angles?.[0]?.id || null;

  const [selected, setSelected] = useState(defaultId);
  const [editedSubjects, setEditedSubjects] = useState(
    () => Object.fromEntries((angles || []).map(a => [a.id, a.subject || '']))
  );
  const [editedMessages, setEditedMessages] = useState(
    () => Object.fromEntries((angles || []).map(a => [a.id, a.message || '']))
  );
  const [copied, setCopied] = useState(false);
  const [loadingHunter, setLoadingHunter] = useState(false);
  const [hunterResult, setHunterResult] = useState(null);

  if (!angles || angles.length === 0) return null;

  const currentAngle = angles.find(a => a.id === selected) || angles[0];
  const currentSubject = editedSubjects[selected] || '';
  const currentMessage = editedMessages[selected] || '';

  const handleTabClick = (id) => {
    setSelected(id);
    setHunterResult(null);
  };

  const handleCopy = () => {
    const text = currentSubject
      ? `Subject: ${currentSubject}\n\n${currentMessage}`
      : currentMessage;
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLoadIntoHunter = async () => {
    if (!contactId || !userId || loadingHunter) return;
    setLoadingHunter(true);
    setHunterResult(null);

    const result = await loadIntoHunter({
      contactId,
      subject: currentSubject,
      message: currentMessage,
      angleId: selected,
      userId
    });

    setHunterResult(result);
    setLoadingHunter(false);
    if (result.success && onLoaded) onLoaded(result);
  };

  const hunterFeedback = () => {
    if (!hunterResult) return null;
    if (hunterResult.success) {
      return (
        <div className="mab-feedback mab-feedback--success">
          ✓ Saved to {hunterResult.contactName}&apos;s profile.
        </div>
      );
    }
    return (
      <div className="mab-feedback mab-feedback--error">
        Could not save — {hunterResult.error || 'try again'}.
      </div>
    );
  };

  return (
    <div className="mab">
      {/* Angle tabs */}
      <div className="mab-tabs" role="tablist">
        {angles.map(angle => (
          <button
            key={angle.id}
            role="tab"
            aria-selected={selected === angle.id}
            className={`mab-tab ${selected === angle.id ? 'mab-tab--active' : ''}`}
            onClick={() => handleTabClick(angle.id)}
          >
            {angle.recommended && <span className="mab-star" aria-label="Recommended">★</span>}
            {angle.label}
          </button>
        ))}
      </div>

      {/* Editor */}
      <div className="mab-editor" role="tabpanel">
        {currentAngle.subject !== undefined && (
          <div className="mab-field">
            <label className="mab-field-label">Subject</label>
            <input
              type="text"
              className="mab-subject-input"
              value={currentSubject}
              onChange={e =>
                setEditedSubjects(prev => ({ ...prev, [selected]: e.target.value }))
              }
              placeholder="Subject line..."
            />
          </div>
        )}
        <div className="mab-field">
          <label className="mab-field-label">Message</label>
          <textarea
            className="mab-message-textarea"
            value={currentMessage}
            onChange={e =>
              setEditedMessages(prev => ({ ...prev, [selected]: e.target.value }))
            }
            rows={6}
            placeholder="Message body..."
          />
        </div>
      </div>

      {/* Actions */}
      <div className="mab-actions">
        <button className="mab-copy-btn" onClick={handleCopy}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>

        {contactId && (
          <button
            className="mab-hunter-btn"
            onClick={handleLoadIntoHunter}
            disabled={loadingHunter || hunterResult?.success}
          >
            {loadingHunter ? 'Saving...' : hunterResult?.success ? '✓ Saved' : '→ Save to Profile'}
          </button>
        )}
      </div>

      {/* Inline Hunter feedback */}
      {hunterFeedback()}
    </div>
  );
}
