import { X, ExternalLink, AlertCircle } from 'lucide-react';
import { useState, useEffect } from 'react';
import './WebsitePreviewModal.css';

export default function WebsitePreviewModal({ url, title, onClose }) {
  // Check if URL is insecure (HTTP instead of HTTPS)
  const isInsecureUrl = url.toLowerCase().startsWith('http://');

  // Start with error state if URL is HTTP (Mixed Content will block it)
  const [iframeError, setIframeError] = useState(isInsecureUrl);

  // Try to upgrade HTTP to HTTPS (but likely won't work due to Mixed Content policy)
  const secureUrl = url.replace(/^http:\/\//i, 'https://');

  const handleOpenInNewTab = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleIframeError = () => {
    setIframeError(true);
  };

  return (
    <div className="preview-modal-overlay" onClick={onClose}>
      <div className="preview-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="preview-modal-header">
          <div className="preview-modal-title">
            <h3>{title}</h3>
            <p className="preview-modal-url">{url}</p>
          </div>
          <div className="preview-modal-actions">
            <button
              className="preview-modal-btn preview-modal-open"
              onClick={handleOpenInNewTab}
              title="Open in new tab"
            >
              <ExternalLink className="w-5 h-5" />
              <span>Open in New Tab</span>
            </button>
            <button
              className="preview-modal-btn preview-modal-close"
              onClick={onClose}
              title="Close preview"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Content - Iframe or Error */}
        <div className="preview-modal-content">
          {iframeError ? (
            <div className="preview-modal-error">
              <AlertCircle className="error-icon" />
              <h3>Unable to Display Preview</h3>
              <p>
                {isInsecureUrl
                  ? "This website uses HTTP (not HTTPS) and cannot be displayed in a secure preview. For your security, browsers block insecure content."
                  : "This website cannot be displayed in a preview due to security restrictions."
                }
              </p>
              <button
                className="error-open-btn"
                onClick={handleOpenInNewTab}
              >
                <ExternalLink className="w-5 h-5" />
                <span>Open in New Tab Instead</span>
              </button>
            </div>
          ) : (
            <iframe
              src={secureUrl}
              title={title}
              className="preview-modal-iframe"
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
              onError={handleIframeError}
            />
          )}
        </div>
      </div>
    </div>
  );
}
