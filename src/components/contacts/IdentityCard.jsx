/**
 * IdentityCard — Premium hero card for the contact profile.
 *
 * Layout:
 *   ┌──────────────────────────────────────────┐
 *   │  [brigade-coloured gradient banner]       │
 *   ├──────────────────────────────────────────┤
 *   │  ◉ Avatar (large, overlaps banner)  [✉][☎][in] │
 *   │  Name                                     │
 *   │  Title · Company                          │
 *   │  [Brigade▾] [State▾] [Relationship▾] [Value▾] │
 *   │  ─────────────────────────────────────── │
 *   │  Contact details (email / phone / linkedin)    │
 *   └──────────────────────────────────────────┘
 *
 * All four classification chips live in one row.
 * Each chip opens its own inline popover on click.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mail, Phone, Building2, Pencil,
  Copy, Check, Linkedin, Camera, Link2,
  Loader, ChevronDown, RefreshCw,
} from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { BRIGADES, BRIGADE_MAP } from './BrigadeSelector';
import { onBrigadeChange } from '../../utils/brigadeSystem';
import {
  RELATIONSHIP_STATES,
  RELATIONSHIP_TYPES,
  STRATEGIC_VALUES,
} from '../../constants/structuredFields';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';
import './IdentityCard.css';

// ─── Color maps for classification chips ─────────────────────────────────────

const STATE_COLORS = {
  unaware:          { color: '#6b7280', bg: 'rgba(107,114,128,0.09)', border: 'rgba(107,114,128,0.22)' },
  aware:            { color: '#3b82f6', bg: 'rgba(59,130,246,0.09)',  border: 'rgba(59,130,246,0.22)'  },
  engaged:          { color: '#7c3aed', bg: 'rgba(124,58,237,0.09)', border: 'rgba(124,58,237,0.22)' },
  warm:             { color: '#f59e0b', bg: 'rgba(245,158,11,0.09)', border: 'rgba(245,158,11,0.22)'  },
  trusted:          { color: '#10b981', bg: 'rgba(16,185,129,0.09)', border: 'rgba(16,185,129,0.22)'  },
  advocate:         { color: '#059669', bg: 'rgba(5,150,105,0.09)',  border: 'rgba(5,150,105,0.22)'   },
  dormant:          { color: '#94a3b8', bg: 'rgba(148,163,184,0.09)',border: 'rgba(148,163,184,0.22)' },
  strained:         { color: '#ef4444', bg: 'rgba(239,68,68,0.09)', border: 'rgba(239,68,68,0.22)'   },
  strategic_partner:{ color: '#d97706', bg: 'rgba(217,119,6,0.09)', border: 'rgba(217,119,6,0.22)'   },
};

const TYPE_COLORS = {
  prospect: { color: '#7c3aed', bg: 'rgba(124,58,237,0.09)', border: 'rgba(124,58,237,0.22)' },
  known:    { color: '#3b82f6', bg: 'rgba(59,130,246,0.09)', border: 'rgba(59,130,246,0.22)'  },
  partner:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.09)', border: 'rgba(245,158,11,0.22)'  },
  delegate: { color: '#6b7280', bg: 'rgba(107,114,128,0.09)',border: 'rgba(107,114,128,0.22)' },
};

const VALUE_COLORS = {
  low:      { color: '#6b7280', bg: 'rgba(107,114,128,0.09)',border: 'rgba(107,114,128,0.22)' },
  medium:   { color: '#3b82f6', bg: 'rgba(59,130,246,0.09)', border: 'rgba(59,130,246,0.22)'  },
  high:     { color: '#f59e0b', bg: 'rgba(245,158,11,0.09)', border: 'rgba(245,158,11,0.22)'  },
  critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.09)', border: 'rgba(239,68,68,0.22)'   },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isPlaceholderPhoto(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  return ['ghost-person', 'ghost_person', 'default-avatar', 'no-photo',
    'placeholder', '/static.licdn.com/sc/h/', 'data:image'].some(p => lower.includes(p));
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

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

// ─── Shared mini-popover for any classification chip ─────────────────────────

function FieldChip({ label, value, options, colorMap, onSelect, saving, T }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const current = options.find(o => o.id === value) || null;
  const colors = current ? (colorMap[current.id] || {}) : {};

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  return (
    <div className="idc-chip-wrap" ref={ref}>
      <button
        className="idc-chip"
        onClick={() => setOpen(v => !v)}
        style={current ? {
          background: colors.bg,
          border: `1.5px solid ${colors.border}`,
          color: colors.color,
        } : {
          background: T.surface,
          border: `1.5px dashed ${T.border}`,
          color: T.textFaint,
        }}
      >
        <span>{current ? current.label : `+ ${label}`}</span>
        {saving ? <Loader size={9} className="idc-spin" /> : <ChevronDown size={10} style={{ opacity: 0.6 }} />}
      </button>

      {open && (
        <div
          className="idc-chip-panel"
          style={{
            background: T.cardBg,
            border: `1px solid ${T.border}`,
            boxShadow: `0 8px 32px ${T.isDark ? '#00000080' : '#0000001a'}`,
          }}
        >
          <div className="idc-chip-panel-label" style={{ color: T.textFaint }}>{label}</div>
          {options.map(opt => {
            const c = colorMap[opt.id] || {};
            const isActive = value === opt.id;
            return (
              <button
                key={opt.id}
                className="idc-chip-opt"
                onClick={() => { onSelect(isActive ? null : opt.id); setOpen(false); }}
                title={opt.description}
                style={{
                  background: isActive ? (c.bg || 'transparent') : 'transparent',
                  color: isActive ? (c.color || T.textMuted) : T.textMuted,
                  borderLeft: `3px solid ${isActive ? (c.color || 'transparent') : 'transparent'}`,
                }}
              >
                <span className="idc-chip-opt-label">{opt.label}</span>
                {isActive && <Check size={11} style={{ marginLeft: 'auto', flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── IdentityCard ─────────────────────────────────────────────────────────────

export default function IdentityCard({
  contact,
  onRefreshPhoto,
  photoRefreshLoading,
  photoRefreshError,
  onUpdate,
}) {
  const T = useT();
  const navigate = useNavigate();
  const [imgBroken, setImgBroken] = useState(false);

  // Inline editing
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

  // Brigade chooser
  const [brigadePanelOpen, setBrigadePanelOpen] = useState(false);
  const [brigadeSaving, setBrigadeSaving] = useState(false);
  const brigadeRef = useRef(null);

  // Structured field saving indicator
  const [fieldSaving, setFieldSaving] = useState(false);

  const hasRealPhoto = !!contact.photo_url && !isPlaceholderPhoto(contact.photo_url) && !imgBroken;
  const canSearch = !!contact.linkedin_url || (!!contact.name && !!contact.company_name);
  const currentBrigade = contact.brigade ? BRIGADE_MAP[contact.brigade] : null;
  const email = contact.email || contact.work_email;
  const phone = contact.phone_mobile || contact.phone_direct || contact.phone;
  const emailVerified = contact.email_status === 'verified';
  const emailLikely = contact.email_status === 'likely';

  // Banner uses brigade colour, fallback to pink
  const bannerAccent = currentBrigade?.color || BRAND.pink;
  const bannerGradient = hasRealPhoto
    ? `linear-gradient(160deg, ${bannerAccent}bb 0%, ${bannerAccent}55 60%, transparent 100%)`
    : `linear-gradient(150deg, ${bannerAccent}ee 0%, ${bannerAccent}88 50%, ${bannerAccent}22 100%)`;

  // ── Close-outside handlers ──────────────────────────────────────────────────
  useEffect(() => {
    if (!photoMenuOpen) return;
    const h = (e) => {
      if (photoMenuRef.current && !photoMenuRef.current.contains(e.target)) {
        setPhotoMenuOpen(false);
        setPhotoUrlMode(false);
        setPhotoUrlInput('');
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [photoMenuOpen]);

  useEffect(() => {
    if (!brigadePanelOpen) return;
    const h = (e) => {
      if (brigadeRef.current && !brigadeRef.current.contains(e.target)) setBrigadePanelOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [brigadePanelOpen]);

  useEffect(() => {
    if (photoUrlMode && photoUrlInputRef.current) photoUrlInputRef.current.focus();
  }, [photoUrlMode]);

  useEffect(() => {
    if (editingField && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingField]);

  // ── Editing ─────────────────────────────────────────────────────────────────
  function startEdit(field, val) { setEditingField(field); setEditValue(val || ''); }
  function cancelEdit() { setEditingField(null); setEditValue(''); }

  const saveEdit = useCallback(async () => {
    if (!editingField) return;
    const field = editingField;
    const trimmed = editValue.trim();
    onUpdate?.({ ...contact, [field]: trimmed });
    setEditingField(null);
    setEditValue('');
    setSavedField(field);
    setTimeout(() => setSavedField(null), 2000);
    try {
      const user = auth.currentUser;
      if (!user) return;
      await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
        [field]: trimmed, updated_at: new Date().toISOString(),
      });
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
    try { await navigator.clipboard.writeText(value); } catch {
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
    onUpdate?.({ ...contact, photo_url: url, photo_source: 'manual_url' });
    setPhotoMenuOpen(false);
    setPhotoUrlMode(false);
    setPhotoUrlInput('');
    setImgBroken(false);
    try {
      const user = auth.currentUser;
      if (!user) return;
      await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
        photo_url: url, photo_source: 'manual_url', updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[IdentityCard] Photo URL save failed:', err);
      onUpdate?.(contact);
    }
  }

  // ── Brigade ─────────────────────────────────────────────────────────────────
  async function handleBrigadeSelect(brigadeId) {
    const user = auth.currentUser;
    if (!user || !contact?.id) return;
    const newValue = contact.brigade === brigadeId ? null : brigadeId;
    onUpdate({ ...contact, brigade: newValue });
    setBrigadePanelOpen(false);
    try {
      setBrigadeSaving(true);
      await onBrigadeChange({
        userId: user.uid, contactId: contact.id,
        fromBrigade: contact.brigade || null, toBrigade: newValue,
        contactName: contact.name || null,
      });
    } catch (err) {
      console.error('[IdentityCard] Brigade save failed:', err);
      onUpdate(contact);
    } finally {
      setBrigadeSaving(false);
    }
  }

  // ── Structured field save ────────────────────────────────────────────────────
  async function handleFieldSave(fieldName, value) {
    const user = auth.currentUser;
    if (!user || !contact?.id) return;
    onUpdate({ ...contact, [fieldName]: value });
    try {
      setFieldSaving(true);
      await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
        [fieldName]: value, updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`[IdentityCard] Field save failed (${fieldName}):`, err);
      onUpdate(contact);
    } finally {
      setFieldSaving(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="idc-card" style={{ background: T.cardBg, border: `1px solid ${T.border}` }}>

      {/* ── Banner ── */}
      <div className="idc-banner" style={{ background: bannerGradient }}>
        {hasRealPhoto && (
          <img src={contact.photo_url} alt="" className="idc-banner-blur" />
        )}
      </div>

      {/* ── Avatar row ── */}
      <div className="idc-avatar-row">
        {/* Avatar */}
        <div className="idc-photo-wrap" ref={photoMenuRef}>
          <div
            className={`idc-photo${!hasRealPhoto ? ' idc-photo--click' : ''}`}
            style={{ border: `4px solid ${T.cardBg}` }}
            onClick={() => !hasRealPhoto && !photoRefreshLoading && setPhotoMenuOpen(v => !v)}
          >
            {hasRealPhoto ? (
              <img src={contact.photo_url} alt={contact.name} onError={() => setImgBroken(true)} />
            ) : (
              <>
                <div className="idc-initials" style={{ background: getAvatarColor(contact.name) }}>
                  {getInitials(contact.name)}
                </div>
                <div className="idc-photo-overlay">
                  {photoRefreshLoading
                    ? <Loader size={20} className="idc-spin" />
                    : <Camera size={20} />}
                </div>
              </>
            )}
          </div>

          {/* Photo action menu */}
          {photoMenuOpen && !photoRefreshLoading && (
            <div
              className="idc-photo-menu"
              style={{ background: T.cardBg, border: `1px solid ${T.border}`, boxShadow: `0 8px 28px ${T.isDark ? '#00000070' : '#00000018'}` }}
            >
              {photoUrlMode ? (
                <div className="idc-photo-url-row">
                  <input
                    ref={photoUrlInputRef}
                    value={photoUrlInput}
                    onChange={e => setPhotoUrlInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveManualPhotoUrl();
                      if (e.key === 'Escape') { setPhotoUrlMode(false); setPhotoUrlInput(''); }
                    }}
                    placeholder="https://..."
                    type="url"
                    style={{ background: T.input, border: `1px solid ${T.border}`, color: T.text }}
                  />
                  <button
                    onClick={saveManualPhotoUrl}
                    disabled={!photoUrlInput.trim().startsWith('http')}
                    style={{ background: BRAND.pink, color: '#fff' }}
                  >Save</button>
                </div>
              ) : (
                <>
                  {canSearch && (
                    <button
                      className="idc-photo-menu-item"
                      style={{ color: T.textMuted }}
                      onClick={() => { setPhotoMenuOpen(false); onRefreshPhoto?.(); }}
                    >
                      <RefreshCw size={13} />Search LinkedIn
                    </button>
                  )}
                  <button
                    className="idc-photo-menu-item"
                    style={{ color: T.textMuted }}
                    onClick={() => setPhotoUrlMode(true)}
                  >
                    <Link2 size={13} />Paste photo URL
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Quick action icon buttons — right side of avatar row */}
        <div className="idc-quick-btns">
          {email && (
            <a
              href={`mailto:${email}`}
              className="idc-quick-btn"
              style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.textMuted }}
              title={email}
            >
              <Mail size={15} />
            </a>
          )}
          {phone && (
            <a
              href={`tel:${phone}`}
              className="idc-quick-btn"
              style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.textMuted }}
              title={phone}
            >
              <Phone size={15} />
            </a>
          )}
          {contact.linkedin_url && (
            <a
              href={contact.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="idc-quick-btn idc-quick-btn--li"
              title="LinkedIn"
            >
              <Linkedin size={15} />
            </a>
          )}
        </div>
      </div>

      {/* ── Identity body ── */}
      <div className="idc-body">

        {/* Name */}
        {editingField === 'name' ? (
          <input
            ref={inputRef}
            className="idc-edit-input idc-name-input"
            style={{ background: T.input, border: `1.5px solid ${BRAND.pink}`, color: T.text }}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={handleKeyDown}
            placeholder="Full name"
          />
        ) : (
          <div className="idc-field-row" onClick={() => startEdit('name', contact.name)} title="Click to edit">
            <h1 className="idc-name" style={{ color: T.text }}>{contact.name || 'Unknown Contact'}</h1>
            {savedField === 'name'
              ? <Check size={14} color="#10b981" style={{ flexShrink: 0 }} />
              : <Pencil size={12} className="idc-edit-icon" color={T.textFaint} />}
          </div>
        )}

        {/* Title */}
        {editingField === 'title' ? (
          <input
            ref={inputRef}
            className="idc-edit-input idc-sub-input"
            style={{ background: T.input, border: `1.5px solid ${BRAND.pink}`, color: T.text }}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={handleKeyDown}
            placeholder="Job title"
          />
        ) : (
          <div className="idc-field-row" onClick={() => startEdit('title', contact.title)} title="Click to edit">
            <p className="idc-sub-text" style={{ color: T.textMuted }}>
              {contact.title || <span style={{ color: T.textFaint, fontStyle: 'italic' }}>Add title</span>}
            </p>
            {savedField === 'title'
              ? <Check size={14} color="#10b981" style={{ flexShrink: 0 }} />
              : <Pencil size={12} className="idc-edit-icon" color={T.textFaint} />}
          </div>
        )}

        {/* Company */}
        {editingField === 'company_name' ? (
          <input
            ref={inputRef}
            className="idc-edit-input idc-sub-input"
            style={{ background: T.input, border: `1.5px solid ${BRAND.pink}`, color: T.text }}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={handleKeyDown}
            placeholder="Company"
          />
        ) : (
          <div className="idc-field-row" style={{ cursor: 'default' }}>
            {contact.company_id ? (
              <button
                className="idc-company-link"
                style={{ color: T.textMuted }}
                onClick={() => navigate(`/scout/company/${contact.company_id}`)}
              >
                <Building2 size={13} style={{ flexShrink: 0 }} />
                {contact.company_name || 'View Company'}
              </button>
            ) : contact.company_name ? (
              <span
                className="idc-company-text"
                style={{ color: T.textMuted, cursor: 'pointer' }}
                onClick={() => startEdit('company_name', contact.company_name)}
              >
                <Building2 size={13} style={{ flexShrink: 0 }} />{contact.company_name}
              </span>
            ) : (
              <span
                style={{ color: T.textFaint, fontStyle: 'italic', fontSize: 13, cursor: 'pointer' }}
                onClick={() => startEdit('company_name', '')}
              >
                Add company
              </span>
            )}
            {savedField === 'company_name'
              ? <Check size={14} color="#10b981" style={{ flexShrink: 0 }} />
              : (
                <button className="idc-pencil" onClick={() => startEdit('company_name', contact.company_name)}>
                  <Pencil size={11} color={T.textFaint} />
                </button>
              )}
          </div>
        )}

        {/* ── Classification chips row ── */}
        <div className="idc-chips-row">

          {/* Brigade */}
          <div className="idc-chip-wrap" ref={brigadeRef}>
            <button
              className="idc-chip"
              onClick={() => setBrigadePanelOpen(v => !v)}
              style={currentBrigade ? {
                background: currentBrigade.bgColor,
                border: `1.5px solid ${currentBrigade.borderColor}`,
                color: currentBrigade.color,
              } : {
                background: T.surface,
                border: `1.5px dashed ${T.border}`,
                color: T.textFaint,
              }}
            >
              {currentBrigade
                ? <><currentBrigade.icon size={11} /><span>{currentBrigade.label}</span></>
                : <span>+ Brigade</span>}
              {brigadeSaving
                ? <Loader size={9} className="idc-spin" />
                : <ChevronDown size={10} style={{ opacity: 0.6 }} />}
            </button>

            {brigadePanelOpen && (
              <div
                className="idc-chip-panel"
                style={{
                  background: T.cardBg,
                  border: `1px solid ${T.border}`,
                  boxShadow: `0 8px 32px ${T.isDark ? '#00000080' : '#0000001a'}`,
                }}
              >
                <div className="idc-chip-panel-label" style={{ color: T.textFaint }}>Brigade</div>
                {BRIGADES.map(b => {
                  const BIcon = b.icon;
                  const isActive = contact.brigade === b.id;
                  return (
                    <button
                      key={b.id}
                      className="idc-chip-opt"
                      onClick={() => { handleBrigadeSelect(b.id); setBrigadePanelOpen(false); }}
                      title={b.description}
                      style={{
                        background: isActive ? b.bgColor : 'transparent',
                        color: isActive ? b.color : T.textMuted,
                        borderLeft: `3px solid ${isActive ? b.color : 'transparent'}`,
                      }}
                    >
                      <BIcon size={12} style={{ flexShrink: 0 }} />
                      <span className="idc-chip-opt-label">{b.label}</span>
                      {isActive && <Check size={11} style={{ marginLeft: 'auto', flexShrink: 0 }} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Relationship State */}
          <FieldChip
            label="State"
            value={contact.relationship_state || null}
            options={RELATIONSHIP_STATES}
            colorMap={STATE_COLORS}
            onSelect={val => handleFieldSave('relationship_state', val)}
            saving={fieldSaving}
            T={T}
          />

          {/* Relationship Type */}
          <FieldChip
            label="Relationship"
            value={contact.relationship_type || null}
            options={RELATIONSHIP_TYPES}
            colorMap={TYPE_COLORS}
            onSelect={val => handleFieldSave('relationship_type', val)}
            saving={fieldSaving}
            T={T}
          />

          {/* Strategic Value */}
          <FieldChip
            label="Value"
            value={contact.strategic_value || null}
            options={STRATEGIC_VALUES}
            colorMap={VALUE_COLORS}
            onSelect={val => handleFieldSave('strategic_value', val)}
            saving={fieldSaving}
            T={T}
          />
        </div>

        {/* ── Divider ── */}
        <div className="idc-divider" style={{ background: T.border }} />

        {/* ── Contact details ── */}
        <div className="idc-contact-details">

          {/* Email */}
          {editingField === 'email' ? (
            <div className="idc-edit-row">
              <input
                ref={inputRef}
                className="idc-edit-input idc-contact-input"
                style={{ background: T.input, border: `1.5px solid ${BRAND.pink}`, color: T.text }}
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onBlur={saveEdit}
                onKeyDown={handleKeyDown}
                placeholder="Email address"
                type="email"
              />
              <span className="idc-edit-hint" style={{ color: T.textFaint }}>Enter · Esc</span>
            </div>
          ) : email ? (
            <div className="idc-detail-row">
              <div className="idc-detail-icon" style={{ background: '#3b82f612', color: '#3b82f6' }}>
                <Mail size={13} />
              </div>
              <div className="idc-detail-info">
                <a href={`mailto:${email}`} className="idc-detail-val" style={{ color: T.text }}>{email}</a>
                {emailVerified && <span className="idc-badge idc-badge--ok">✓ Verified</span>}
                {emailLikely && !emailVerified && <span className="idc-badge idc-badge--warn">~ Likely</span>}
              </div>
              <button className="idc-icon-btn" onClick={() => copyToClipboard(email, 'email')} title="Copy">
                {copiedField === 'email' ? <Check size={12} color="#10b981" /> : <Copy size={12} color={T.textFaint} />}
              </button>
              <button className="idc-icon-btn" onClick={() => startEdit('email', email)} title="Edit">
                <Pencil size={11} color={T.textFaint} />
              </button>
            </div>
          ) : (
            <button
              className="idc-add-field"
              style={{ color: T.textFaint, borderColor: T.border }}
              onClick={() => startEdit('email', '')}
            >
              <Mail size={12} /><span>Add email</span>
            </button>
          )}

          {/* Phone */}
          {editingField === 'phone' ? (
            <div className="idc-edit-row">
              <input
                ref={inputRef}
                className="idc-edit-input idc-contact-input"
                style={{ background: T.input, border: `1.5px solid ${BRAND.pink}`, color: T.text }}
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onBlur={saveEdit}
                onKeyDown={handleKeyDown}
                placeholder="Phone number"
                type="tel"
              />
              <span className="idc-edit-hint" style={{ color: T.textFaint }}>Enter · Esc</span>
            </div>
          ) : phone ? (
            <div className="idc-detail-row">
              <div className="idc-detail-icon" style={{ background: '#10b98112', color: '#10b981' }}>
                <Phone size={13} />
              </div>
              <a href={`tel:${phone}`} className="idc-detail-val" style={{ color: T.text, flex: 1 }}>{phone}</a>
              <button className="idc-icon-btn" onClick={() => copyToClipboard(phone, 'phone')} title="Copy">
                {copiedField === 'phone' ? <Check size={12} color="#10b981" /> : <Copy size={12} color={T.textFaint} />}
              </button>
              <button className="idc-icon-btn" onClick={() => startEdit('phone', phone)} title="Edit">
                <Pencil size={11} color={T.textFaint} />
              </button>
            </div>
          ) : (
            <button
              className="idc-add-field"
              style={{ color: T.textFaint, borderColor: T.border }}
              onClick={() => startEdit('phone', '')}
            >
              <Phone size={12} /><span>Add phone</span>
            </button>
          )}

          {/* LinkedIn */}
          {contact.linkedin_url && (
            <div className="idc-detail-row">
              <div className="idc-detail-icon" style={{ background: '#0077b512', color: '#0077b5' }}>
                <Linkedin size={13} />
              </div>
              <a
                href={contact.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="idc-detail-val"
                style={{ color: T.text, flex: 1 }}
              >
                LinkedIn Profile →
              </a>
            </div>
          )}
        </div>

        {photoRefreshError && (
          <p className="idc-photo-err">{photoRefreshError}</p>
        )}

      </div>
    </div>
  );
}
