import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Loader, Mail, Phone, Building2, Pencil, Copy, Check, Linkedin, Camera, Link2 } from 'lucide-react';
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

  // Field editing
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [savedField, setSavedField] = useState(null);
  const [copiedField, setCopiedField] = useState(null);
  const inputRef = useRef(null);

  // Photo menu
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
  const [photoUrlMode, setPhotoUrlMode] = useState(false);
  const [photoUrlInput, setPhotoUrlInput] = useState('');
  const photoMenuRef = useRef(null);
  const photoUrlInputRef = useRef(null);

  const hasLinkedIn = !!contact.linkedin_url;
  const hasNameAndCompany = !!contact.name && !!contact.company_name;
  const hasRealPhoto = !!contact.photo_url && !isPlaceholderPhoto(contact.photo_url) && !imgBroken;
  const canSearch = hasLinkedIn || hasNameAndCompany;

  // Close photo menu when clicking outside
  useEffect(() => {
    if (!photoMenuOpen) return;
    function handleOutsideClick(e) {
      if (photoMenuRef.current && !photoMenuRef.current.contains(e.target)) {
        setPhotoMenuOpen(false);
        setPhotoUrlMode(false);
        setPhotoUrlInput('');
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [photoMenuOpen]);

  // Focus URL input when URL mode opens
  useEffect(() => {
    if (photoUrlMode && photoUrlInputRef.current) {
      photoUrlInputRef.current.focus();
    }
  }, [photoUrlMode]);

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
      onUpdate?.(contact);
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
    } catch {
      const el = document.createElement('textarea');
      el.value = value;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  async function saveManualPhotoUrl() {
    const url = photoUrlInput.trim();
    if (!url.startsWith('http')) return;

    const updated = { ...contact, photo_url: url, photo_source: 'manual_url' };
    onUpdate?.(updated);
    setPhotoMenuOpen(false);
    setPhotoUrlMode(false);
    setPhotoUrlInput('');
    setImgBroken(false);

    try {
      const user = auth.currentUser;
      if (!user) return;
      const ref = doc(db, 'users', user.uid, 'contacts', contact.id);
      await updateDoc(ref, {
        photo_url: url,
        photo_source: 'manual_url',
        updated_at: new Date().toISOString()
      });
    } catch (err) {
      console.error('[IdentityCard] Photo URL save failed:', err);
      onUpdate?.(contact);
    }
  }

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

      {/* ── Photo ── */}
      <div className="identity-photo-wrapper" ref={photoMenuRef}>
        <div
          className={`identity-photo${!hasRealPhoto ? ' identity-photo--clickable' : ''}`}
          onClick={() => !hasRealPhoto && !photoRefreshLoading && setPhotoMenuOpen(v => !v)}
        >
          {hasRealPhoto ? (
            <img
              src={contact.photo_url}
              alt={contact.name}
              onError={() => setImgBroken(true)}
            />
          ) : (
            <>
              <div
                className="photo-initials"
                style={{ background: getAvatarColor(contact.name) }}
              >
                {getInitials(contact.name)}
              </div>
              <div className="photo-change-overlay">
                {photoRefreshLoading
                  ? <Loader className="w-4 h-4 photo-overlay-spinner" />
                  : <Camera className="w-4 h-4" />}
              </div>
            </>
          )}
        </div>

        {/* Photo action menu */}
        {photoMenuOpen && !photoRefreshLoading && (
          <div className="photo-menu">
            {photoUrlMode ? (
              <div className="photo-url-row">
                <input
                  ref={photoUrlInputRef}
                  className="photo-url-input"
                  value={photoUrlInput}
                  onChange={e => setPhotoUrlInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveManualPhotoUrl();
                    if (e.key === 'Escape') { setPhotoUrlMode(false); setPhotoUrlInput(''); }
                  }}
                  placeholder="https://..."
                  type="url"
                />
                <button
                  className="photo-url-save-btn"
                  onClick={saveManualPhotoUrl}
                  disabled={!photoUrlInput.trim().startsWith('http')}
                >
                  Save
                </button>
              </div>
            ) : (
              <>
                {canSearch && (
                  <button
                    className="photo-menu-item"
                    onClick={() => { setPhotoMenuOpen(false); onRefreshPhoto?.(); }}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Search LinkedIn</span>
                  </button>
                )}
                <button
                  className="photo-menu-item"
                  onClick={() => setPhotoUrlMode(true)}
                >
                  <Link2 className="w-3.5 h-3.5" />
                  <span>Paste photo URL</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Info ── */}
      <div className="identity-info">

        {/* Name */}
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

        {/* Title */}
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

        {/* Company */}
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

        {/* Email */}
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

        {/* Phone */}
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
