import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, RefreshCw, Loader, Mail, Phone, Building2, Pencil } from 'lucide-react';
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
  const [saving, setSaving] = useState(false);
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

  async function saveEdit() {
    if (!editingField) return;
    const trimmed = editValue.trim();
    const updated = { ...contact, [editingField]: trimmed };

    // Optimistic update
    onUpdate?.(updated);
    setEditingField(null);
    setEditValue('');

    try {
      setSaving(true);
      const user = auth.currentUser;
      if (!user) return;
      const ref = doc(db, 'users', user.uid, 'contacts', contact.id);
      await updateDoc(ref, { [editingField]: trimmed, updated_at: new Date().toISOString() });
    } catch (err) {
      console.error('[IdentityCard] Save failed:', err);
      onUpdate?.(contact); // revert
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
    if (e.key === 'Escape') cancelEdit();
  }

  return (
    <div className="identity-card">
      <div className="identity-photo-wrapper">
        <div className="identity-photo">
          {contact.photo_url && !isPlaceholderPhoto(contact.photo_url) && !imgBroken ? (
            <img
              src={contact.photo_url}
              alt={contact.name}
              onError={() => setImgBroken(true)}
            />
          ) : (
            <div className="photo-fallback">
              <User className="w-8 h-8" />
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
            <Pencil className="identity-edit-icon" />
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
            <Pencil className="identity-edit-icon" />
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
            <button
              className="identity-pencil-btn"
              onClick={() => startEdit('company_name', contact.company_name)}
              title="Edit company name"
            >
              <Pencil className="identity-edit-icon identity-edit-icon--btn" />
            </button>
          </div>
        )}

        {/* Email — pencil edits; email text is a mailto link */}
        {editingField === 'email' ? (
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
        ) : contact.email ? (
          <div className="identity-field-wrapper">
            <a href={`mailto:${contact.email}`} className="identity-contact-row">
              <Mail className="identity-contact-icon" />
              <span>{contact.email}</span>
            </a>
            <button
              className="identity-pencil-btn"
              onClick={() => startEdit('email', contact.email)}
              title="Edit email"
            >
              <Pencil className="identity-edit-icon identity-edit-icon--btn" />
            </button>
          </div>
        ) : (
          <button className="identity-add-field" onClick={() => startEdit('email', '')}>
            <Mail className="identity-contact-icon" />
            <span>Add email</span>
          </button>
        )}

        {/* Phone — pencil edits; phone text is a tel link */}
        {editingField === 'phone' ? (
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
        ) : contact.phone ? (
          <div className="identity-field-wrapper">
            <a href={`tel:${contact.phone}`} className="identity-contact-row">
              <Phone className="identity-contact-icon" />
              <span>{contact.phone}</span>
            </a>
            <button
              className="identity-pencil-btn"
              onClick={() => startEdit('phone', contact.phone)}
              title="Edit phone"
            >
              <Pencil className="identity-edit-icon identity-edit-icon--btn" />
            </button>
          </div>
        ) : (
          <button className="identity-add-field" onClick={() => startEdit('phone', '')}>
            <Phone className="identity-contact-icon" />
            <span>Add phone</span>
          </button>
        )}

        {photoRefreshError && (
          <p className="photo-refresh-error">{photoRefreshError}</p>
        )}
      </div>
    </div>
  );
}
