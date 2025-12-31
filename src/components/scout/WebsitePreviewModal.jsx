import { X, ExternalLink } from 'lucide-react';
import './WebsitePreviewModal.css';

export default function WebsitePreviewModal({ url, title, onClose }) {
  // Convert HTTP to HTTPS to prevent mixed content errors
  const ensureHttps = (inputUrl) => {
    if (!inputUrl) return '';

    // If URL starts with http:// (not https://), convert it to https://
    if (inputUrl.startsWith('http://')) {
      return inputUrl.replace('http://', 'https://');
    }

    // If no protocol specified, add https://
    if (!inputUrl.startsWith('http://') && !inputUrl.startsWith('https://')) {
      return `https://${inputUrl}`;
    }

    return inputUrl;
  };

  const secureUrl = ensureHttps(url);

  const handleOpenInNewTab = () => {
    window.open(secureUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="preview-modal-overlay" onClick={onClose}>
      <div className="preview-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="preview-modal-header">
          <div className="preview-modal-title">
            <h3>{title}</h3>
            <p className="preview-modal-url">{secureUrl}</p>
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

        {/* Modal Content - Iframe */}
        <div className="preview-modal-content">
          <iframe
            src={secureUrl}
            title={title}
            className="preview-modal-iframe"
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
          />
        </div>
      </div>
    </div>
  );
}
