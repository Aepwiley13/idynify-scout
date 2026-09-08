import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Linkedin, X, CheckCircle, UserPlus, ExternalLink } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { STATUS } from '../../theme/tokens';
import { openContact, ENTRY_POINTS, DISPLAY_MODES } from '../../utils/navigation';
import LinkedInLinkSearch from './LinkedInLinkSearch';

export default function LinkedInQuickAdd({ isOpen, onClose }) {
  const T = useT();
  const navigate = useNavigate();
  const [savedContact, setSavedContact] = useState(null);
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      setSavedContact(null);
      return;
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // Focus trap
  useEffect(() => {
    if (!isOpen || !dialogRef.current) return;
    const host = dialogRef.current;
    const selector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () =>
      Array.from(host.querySelectorAll(selector)).filter(el => el.offsetParent !== null);
    const first = getFocusable()[0];
    if (first) first.focus();

    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      const items = getFocusable();
      if (items.length === 0) { e.preventDefault(); return; }
      const f = items[0];
      const l = items[items.length - 1];
      if (e.shiftKey && document.activeElement === f) {
        e.preventDefault();
        l.focus();
      } else if (!e.shiftKey && document.activeElement === l) {
        e.preventDefault();
        f.focus();
      }
    };
    host.addEventListener('keydown', onKeyDown);
    return () => host.removeEventListener('keydown', onKeyDown);
  }, [isOpen, savedContact]);

  const handleContactAdded = useCallback((items) => {
    if (items.length === 1 && items[0]) {
      setSavedContact({
        id: items[0].id,
        name: items[0].name || 'Contact',
      });
    }
  }, []);

  const handleAddAnother = useCallback(() => {
    setSavedContact(null);
  }, []);

  const handleViewProfile = useCallback(() => {
    if (!savedContact?.id) return;
    onClose();
    openContact({
      navigate,
      contactId: savedContact.id,
      entryPoint: ENTRY_POINTS.SCOUT,
      returnTo: window.location.pathname + window.location.search,
      displayMode: DISPLAY_MODES.PAGE,
    });
  }, [savedContact, navigate, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="linkedin-quick-add-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="linkedin-quick-add-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Add from LinkedIn"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="linkedin-quick-add-header">
          <div className="linkedin-quick-add-title-row">
            <Linkedin size={18} color="#0077b5" />
            <span className="linkedin-quick-add-title">Add from LinkedIn</span>
          </div>
          <button
            ref={closeButtonRef}
            className="linkedin-quick-add-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        {savedContact ? (
          <div className="linkedin-quick-add-success">
            <div className="linkedin-quick-add-success-banner">
              <CheckCircle size={16} color={STATUS.green} />
              <span>{savedContact.name} added to Scout</span>
            </div>
            <div className="linkedin-quick-add-success-actions">
              <button
                className="linkedin-quick-add-btn-primary"
                onClick={handleAddAnother}
                autoFocus
              >
                <UserPlus size={14} />
                Add Another
              </button>
              <button
                className="linkedin-quick-add-btn-secondary"
                onClick={handleViewProfile}
              >
                <ExternalLink size={13} />
                View Profile
              </button>
            </div>
          </div>
        ) : (
          <LinkedInLinkSearch
            onContactAdded={handleContactAdded}
            onCancel={onClose}
          />
        )}
      </div>
    </div>
  );
}
