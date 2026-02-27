import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Loader, Mail, Phone, Building2, Pencil, Copy, Check, Linkedin } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import './IdentityCard.css';

/**
 * Check if a photo URL is a placeholder/default image (not a real profile photo).
 * Mirrors the backend isValidLinkedInPhoto logic.
 */
function isPlaceholderPhoto(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  const placeholders = [
    'ghost-person', 'ghost_person', 'default-avatar',
    'no-photo', 'placeholder', '/static.licdn.com/sc/h/', 'data:image'
  ];
  return placeholders.some(p => lower.includes(p));
}

/** Generate initials from a full name (up to 2 chars). */
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Pick a consistent avatar bg color from the contact name. */
const AVATAR_COLORS = [
  '#e85d7a', '#7c3aed', '#0ea5e9', '#10b981',
  '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4',
];
function getAvatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function IdentityCard({
  contact,
  onRefreshPhoto,
  photoRefreshLoading,
  photoRefreshError,
  onUpdate
}) {
  const [imgBroken, setImgBroken] = useState(false);
  const navigate = useNavigate();
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [savedField, setSavedField] = useState(null); // field name that just saved
  const [copiedField, setCopiedField] = useState(null); // 'email' | 'phone'
  const inputRef = useRef(null);

  const hasLinkedIn = !!contact.linkedin_url;
  const hasNameAndCompany = !!contact.name && !!contact.company_name;
  const hasRealPhoto = !!contact.photo_url && !isPlaceholderPhoto(contact.photo_url) && !imgBroken;
  const hasCustomUpload = !!contact.photo_source && contact.photo_source === 'user_upload';

  const canSearch = hasLinkedIn || hasNameAndCompany;
  const showRefreshButton = canSearch && !hasRealPhoto && !hasCustomUpload && !photoRefreshLoading;
  const showSpinner = photoRefreshLoading;

  // Focus + select input when a field enters edit mode
  useEffect(() => {
    if (editingField && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingField]);

  function startEdit(field, currentValue) {
    setEditingField(field);
    setEditValue(currentValue || '');
  }

  function cancelEdit() {
    setEditingField(null);
    setEditValue('');
  }

  const saveEdit = useCallback(async () => {
    if (!editingField) return;
    const field = editingField;
    const trimmed = editValue.trim();
    const updated = { ...contact, [field]: trimmed };

    // Optimistic update + flash confirmation
    onUpdate?.(updated);
    setEditingField(null);
    setEditValue('');
    setSavedField(field);
    setTimeout(() => setSavedField(null), 2000);

    try {
      const user = auth.currentUser;
      if (!user) return;
      const ref = doc(db, 'users', user.uid, 'contacts', contact.id);
      await updateDoc(ref, { [field]: trimmed, updated_at: new Date().toISOString() });
    } catch (err) {
      console.error('[IdentityCard] Save failed:', err);
      onUpdate?.(contact); // revert
      setSavedField(null);
    }
  }, [editingField, editValue, contact, onUpdate]);

  function handleKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
    if (e.key === 'Escape') cancelEdit();
  }

  async function copyToClipboard(value, field) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // fallback: select + execCommand for older browsers
      const el = document.createElement('textarea');
      el.value = value;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  }

  // Email verification badge
  function EmailBadge() {
    if (!contact.email_status) return null;
    const map = {
      verified:   { label: '✓ Verified',   cls: 'badge-verified' },
      likely:     { label: '~ Likely',      cls: 'badge-likely' },
      unverified: { label: 'Unverified',    cls: 'badge-unverified' },
    };
    const b = map[contact.email_status];
    if (!b) return null;
    return <span className={`identity-email-badge ${b.cls}`}>{b.label}</span>;
  }

  return (
    <div className="identity-card">
      <div className="identity-photo-wrapper">
        <div className="identity-photo">
          {hasRealPhoto ? (
            <img
              src={contact.photo_url}
              alt={contact.name}
              onError={() => setImgBroken(true)}
            />
          ) : (
            <div
              className="photo-initials"
              style={{ background: getAvatarColor(contact.name) }}
            >
              {getInitials(contact.name)}
            </div>
          )}
        </div>
        {showRefreshButton && (
          <button
            className="refresh-photo-btn"
            onClick={onRefreshPhoto}
            title="Retry LinkedIn Photo"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
        {showSpinner && (
          <button className="refresh-photo-btn refreshing" disabled>
            <Loader className="w-3.5 h-3.5 refresh-spinner" />
          </button>
        )}
      </div>

      <div className="identity-info">

        {/* Name — click anywhere to edit */}
        {editingField === 'name' ? (
          <input
            ref={inputRef}
            className="identity-edit-input identity-name-input"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={handleKeyDown}
            placeholder="Full name"
          />
        ) : (
          <div
            className="identity-field-wrapper"
            onClick={() => startEdit('name', contact.name)}
            title="Click to edit name"
          >
            <h1 className="identity-name">{contact.name || 'Unknown Contact'}</h1>
            {savedField === 'name'
              ? <Check className="identity-saved-icon" />
              : <Pencil className="identity-edit-icon" />}
          </div>
        )}

        {/* Title — click anywhere to edit */}
        {editingField === 'title' ? (
          <input
            ref={inputRef}
            className="identity-edit-input identity-title-input"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={handleKeyDown}
            placeholder="Job title"
          />
        ) : (
          <div
            className="identity-field-wrapper"
            onClick={() => startEdit('title', contact.title)}
            title="Click to edit title"
          >
            <p className="identity-title">
              {contact.title || <span className="identity-placeholder">Add title</span>}
            </p>
            {savedField === 'title'
              ? <Check className="identity-saved-icon" />
              : <Pencil className="identity-edit-icon" />}
          </div>
        )}

        {/* Company — pencil edits the name; company text links to profile */}
        {editingField === 'company_name' ? (
          <input
            ref={inputRef}
            className="identity-edit-input identity-company-input"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={handleKeyDown}
            placeholder="Company name"
          />
        ) : (
          <div className="identity-field-wrapper">
            {contact.company_id ? (
              <button
                className="identity-company identity-company-link"
                onClick={() => navigate(`/scout/company/${contact.company_id}`)}
              >
                <Building2 className="identity-contact-icon" />
                {contact.company_name || 'No company'}
              </button>
            ) : (
              <p className="identity-company">
                {contact.company_name && <Building2 className="identity-contact-icon" />}
                {contact.company_name || <span className="identity-placeholder">Add company</span>}
              </p>
            )}
            {savedField === 'company_name' ? (
              <Check className="identity-saved-icon identity-saved-icon--visible" />
            ) : (
              <button
                className="identity-pencil-btn"
                onClick={() => startEdit('company_name', contact.company_name)}
                title="Edit company name"
              >
                <Pencil className="identity-edit-icon identity-edit-icon--btn" />
              </button>
            )}
          </div>
        )}

        {/* Email — pencil edits; copy button; verification badge */}
        {editingField === 'email' ? (
          <div className="identity-edit-row">
            <input
              ref={inputRef}
              className="identity-edit-input identity-contact-input"
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onBlur={saveEdit}
              onKeyDown={handleKeyDown}
              placeholder="Email address"
              type="email"
            />
            <span className="identity-edit-hint">Enter to save · Esc to cancel</span>
          </div>
        ) : contact.email ? (
          <div className="identity-field-wrapper">
            <a href={`mailto:${contact.email}`} className="identity-contact-row">
              <Mail className="identity-contact-icon" />
              <span>{contact.email}</span>
            </a>
            <EmailBadge />
            {savedField === 'email' ? (
              <Check className="identity-saved-icon identity-saved-icon--visible" />
            ) : (
              <div className="identity-field-actions">
                <button
                  className="identity-icon-btn"
                  onClick={() => copyToClipboard(contact.email, 'email')}
                  title="Copy email"
                >
                  {copiedField === 'email'
                    ? <Check className="identity-action-icon identity-action-icon--copied" />
                    : <Copy className="identity-action-icon" />}
                </button>
                <button
                  className="identity-pencil-btn"
                  onClick={() => startEdit('email', contact.email)}
                  title="Edit email"
                >
                  <Pencil className="identity-edit-icon identity-edit-icon--btn" />
                </button>
              </div>
            )}
          </div>
        ) : (
          <button className="identity-add-field" onClick={() => startEdit('email', '')}>
            <Mail className="identity-contact-icon" />
            <span>Add email</span>
          </button>
        )}

        {/* Phone — pencil edits; copy button */}
        {editingField === 'phone' ? (
          <div className="identity-edit-row">
            <input
              ref={inputRef}
              className="identity-edit-input identity-contact-input"
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onBlur={saveEdit}
              onKeyDown={handleKeyDown}
              placeholder="Phone number"
              type="tel"
            />
            <span className="identity-edit-hint">Enter to save · Esc to cancel</span>
          </div>
        ) : contact.phone ? (
          <div className="identity-field-wrapper">
            <a href={`tel:${contact.phone}`} className="identity-contact-row">
              <Phone className="identity-contact-icon" />
              <span>{contact.phone}</span>
            </a>
            {savedField === 'phone' ? (
              <Check className="identity-saved-icon identity-saved-icon--visible" />
            ) : (
              <div className="identity-field-actions">
                <button
                  className="identity-icon-btn"
                  onClick={() => copyToClipboard(contact.phone, 'phone')}
                  title="Copy phone"
                >
                  {copiedField === 'phone'
                    ? <Check className="identity-action-icon identity-action-icon--copied" />
                    : <Copy className="identity-action-icon" />}
                </button>
                <button
                  className="identity-pencil-btn"
                  onClick={() => startEdit('phone', contact.phone)}
                  title="Edit phone"
                >
                  <Pencil className="identity-edit-icon identity-edit-icon--btn" />
                </button>
              </div>
            )}
          </div>
        ) : (
          <button className="identity-add-field" onClick={() => startEdit('phone', '')}>
            <Phone className="identity-contact-icon" />
            <span>Add phone</span>
          </button>
        )}

        {/* LinkedIn quick-link */}
        {contact.linkedin_url && (
          <a
            href={contact.linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            className="identity-linkedin-link"
          >
            <Linkedin className="identity-contact-icon" />
            <span>LinkedIn</span>
          </a>
        )}

        {photoRefreshError && (
          <p className="photo-refresh-error">{photoRefreshError}</p>
        )}
      </div>
    </div>
  );
}
