import { useState, useEffect } from 'react';
import { generateOpeningMessage, copyToClipboard } from '../../services/outreachService';

export default function OutreachConsole({ company, icpProfile, onClose }) {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchMessage();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on ESC
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function fetchMessage() {
    setLoading(true);
    setError(null);
    const result = await generateOpeningMessage(
      company,
      icpProfile,
      company.signals || []
    );
    setLoading(false);
    if (result.message) {
      setMessage(result.message);
    } else {
      setError(result.error || 'Generation failed');
    }
  }

  function handleCopy() {
    const result = copyToClipboard(message);
    if (result.success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div className="mc-modal-overlay" onClick={handleOverlayClick}>
      <div className="mc-modal mc-outreach-modal">
        {/* Header */}
        <div className="mc-modal-header">
          <div className="mc-modal-header-text">
            <div className="mc-modal-eyebrow">SECURE COMMS CHANNEL</div>
            <div className="mc-modal-title">OUTREACH CONSOLE</div>
            <div className="mc-modal-subtitle">
              {(company.name || 'UNKNOWN').toUpperCase()}
            </div>
          </div>
          <button className="mc-modal-close" onClick={onClose} title="Close (ESC)">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="mc-modal-body">
          {loading ? (
            <div className="mc-modal-generating">
              <div className="mc-modal-spinner" />
              <span>BARRY GENERATING...</span>
            </div>
          ) : error ? (
            <div className="mc-modal-error-state">
              <div className="mc-modal-error-text">Barry is offline — try again</div>
              <button className="mc-modal-retry-btn" onClick={fetchMessage}>
                RETRY
              </button>
            </div>
          ) : (
            <>
              <div className="mc-outreach-barry-badge">
                <span className="mc-outreach-barry-dot" />
                BARRY GENERATED
              </div>
              <textarea
                className="mc-outreach-textarea"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                spellCheck
              />
              <div className="mc-outreach-char-count">{message.length} chars</div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="mc-modal-footer">
          <div className="mc-modal-footer-actions">
            <button
              className={`mc-modal-primary-btn${copied ? ' copied' : ''}`}
              onClick={handleCopy}
              disabled={loading || !!error || !message}
            >
              {copied ? 'COPIED ✓' : 'COPY MESSAGE'}
            </button>
            <button className="mc-modal-abort-btn" onClick={onClose}>
              CLOSE
            </button>
          </div>
          {!loading && !error && (
            <div className="mc-modal-disclaimer">
              Review and personalize before sending
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
