/**
 * ContactPhones — a person's phone numbers on the contact profile.
 *
 * Each number shows what it is: Mobile, Direct, Main, Work, Home, Fax, Other,
 * or "Type not set" when nothing says which. The type is never guessed: an
 * older record's plain `phone` reads as "Type not set", not "Mobile", and a
 * number added here starts unset until someone picks.
 *
 * The list is read with contactPhones.readContactPhones and every change is
 * handed to `onSave` as the whole new list; the caller writes it with
 * buildPhoneWrite, which also keeps the older single fields in step. Nothing
 * here touches Firestore.
 *
 * Row actions (copy, edit, remove) are buttons that are always in the page,
 * shown on hover with a mouse and always on touch screens (IdentityCard.css).
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import { Phone, Plus, Copy, Check, Pencil, X } from 'lucide-react';
import { BRAND } from '../../theme/tokens';
import { readContactPhones, sortPhonesForDisplay, splitExtension } from '../../utils/contactPhones';
import { normalizePhone } from '../../utils/identityNormalization';

const LABEL_TEXT = {
  mobile: 'Mobile', direct: 'Direct', main: 'Main', work: 'Work', home: 'Home', fax: 'Fax', other: 'Other', unknown: 'Type not set',
};
const PICKER = ['mobile', 'direct', 'main', 'work', 'home', 'fax', 'other', 'unknown'];
const LABEL_COLORS = {
  mobile: { color: '#10b981', bg: 'rgba(16,185,129,0.10)' },
  direct: { color: '#0ea5e9', bg: 'rgba(14,165,233,0.10)' },
  main:   { color: '#6366f1', bg: 'rgba(99,102,241,0.10)' },
  work:   { color: '#3b82f6', bg: 'rgba(59,130,246,0.10)' },
  home:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)' },
  fax:    { color: '#6b7280', bg: 'rgba(107,114,128,0.10)' },
  other:  { color: '#6b7280', bg: 'rgba(107,114,128,0.10)' },
};

const shown = p => (p.extension ? `${p.value} ext. ${p.extension}` : p.value);

/** One number: its type pill, the number (a call link, except a fax), and its actions. */
function PhoneRow({ entry, isNew, onChange, onDelete, T }) {
  const [editing, setEditing] = useState(isNew);
  const [draft, setDraft] = useState(isNew ? '' : shown(entry).replace(' ext. ', ' x'));
  const [error, setError] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef(null);
  const pickerRef = useRef(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    const close = (e) => { if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [pickerOpen]);

  function confirm() {
    const text = draft.trim();
    // An empty new row stays open (the type pill may have taken focus); Escape removes it.
    if (!text) { if (!isNew) { setDraft(shown(entry).replace(' ext. ', ' x')); setEditing(false); setError(null); } return; }
    const { value, extension } = splitExtension(text);
    if (!normalizePhone(value)) { setError('Enter a phone number with at least 7 digits.'); return; }
    setError(null);
    setEditing(false);
    if (isNew || value !== entry.value || extension !== entry.extension) onChange({ ...entry, value, extension });
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); confirm(); }
    if (e.key === 'Escape') {
      if (isNew) onDelete();
      else { setDraft(shown(entry).replace(' ext. ', ' x')); setEditing(false); setError(null); }
    }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(shown(entry)); } catch { /* clipboard unavailable */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const unset = entry.label === 'unknown';
  const colors = LABEL_COLORS[entry.label];
  // The labels are written as they should read ("Type not set"); the shared
  // pill style would capitalise every word.
  const pillStyle = unset
    ? { color: T.textMuted, background: 'transparent', border: `1px dashed ${T.border}`, textTransform: 'none' }
    : { color: colors.color, background: colors.bg, textTransform: 'none' };
  const cardSaid = entry.labelSource === 'card' && entry.observedLabel ? ` · printed on the card as “${entry.observedLabel}”` : '';

  return (
    <div className="idc-field-entry-wrap">
      <div className="idc-field-entry idc-phone-entry">
        <div className="idc-label-wrap" ref={pickerRef}>
          <button
            type="button"
            className="idc-label-btn"
            style={pillStyle}
            onClick={() => setPickerOpen(v => !v)}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            aria-label={`Phone type: ${LABEL_TEXT[entry.label]}. Change`}
            title={`${unset ? 'What is this number? Choose a type' : LABEL_TEXT[entry.label]}${cardSaid}`}
          >
            {LABEL_TEXT[entry.label]}
          </button>
          {pickerOpen && (
            <div
              className="idc-label-panel"
              role="listbox"
              aria-label="Phone type"
              style={{ background: T.cardBg, border: `1px solid ${T.border}`, boxShadow: `0 6px 20px ${T.isDark ? '#00000070' : '#00000015'}` }}
            >
              {PICKER.map(label => {
                const selected = entry.label === label;
                const c = LABEL_COLORS[label];
                return (
                  <button
                    type="button"
                    key={label}
                    role="option"
                    aria-selected={selected}
                    className="idc-label-opt"
                    style={{ color: selected && c ? c.color : T.textMuted, background: selected && c ? c.bg : 'transparent', textTransform: 'none' }}
                    onClick={() => {
                      setPickerOpen(false);
                      if (!selected) onChange({ ...entry, label, labelSource: label === 'unknown' ? null : 'user' });
                    }}
                  >
                    {selected && <Check size={10} style={{ flexShrink: 0 }} />}
                    <span>{LABEL_TEXT[label]}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {editing ? (
          <input
            ref={inputRef}
            className="idc-entry-input"
            style={{ background: T.input, border: `1.5px solid ${error ? '#ef4444' : BRAND.pink}`, color: T.text }}
            value={draft}
            onChange={e => { setDraft(e.target.value); if (error) setError(null); }}
            onBlur={confirm}
            onKeyDown={onKeyDown}
            type="tel"
            inputMode="tel"
            placeholder="Phone number, e.g. 801-555-1234 x12"
            aria-label="Phone number"
            aria-invalid={Boolean(error)}
          />
        ) : entry.label === 'fax' ? (
          <span className="idc-entry-val" style={{ color: T.text }} title="Fax">{shown(entry)}</span>
        ) : (
          <a href={`tel:${entry.value}`} className="idc-entry-val" style={{ color: T.text }} title={`Call ${shown(entry)}`}>
            {shown(entry)}
          </a>
        )}

        {!editing && (
          <div className="idc-entry-actions">
            <button type="button" className="idc-icon-btn" onClick={copy} aria-label="Copy number" title="Copy">
              {copied ? <Check size={12} color="#10b981" /> : <Copy size={12} color={T.textFaint} />}
            </button>
            <button type="button" className="idc-icon-btn" onClick={() => setEditing(true)} aria-label="Edit number" title="Edit">
              <Pencil size={11} color={T.textFaint} />
            </button>
            <button type="button" className="idc-entry-delete" onClick={onDelete} aria-label="Remove number" title="Remove">
              <X size={11} />
            </button>
          </div>
        )}
      </div>
      {error && <p className="idc-entry-error" role="alert">{error}</p>}
    </div>
  );
}

/**
 * The profile's Phone section.
 *
 * @param {object}   props.contact  the contact as stored
 * @param {Function} props.onSave   (list) => void|Promise: the whole new list of canonical entries
 * @param {object}   props.T        theme tokens (useT)
 */
export default function ContactPhones({ contact, onSave, T }) {
  const phones = useMemo(() => sortPhonesForDisplay(readContactPhones(contact)), [contact]);
  const [adding, setAdding] = useState(null);

  const save = list => onSave(list);

  return (
    <div className="idc-multi-section">
      <div className="idc-multi-header">
        <div className="idc-detail-icon" style={{ background: '#10b98112', color: '#10b981' }}>
          <Phone size={13} />
        </div>
        <span className="idc-multi-label" style={{ color: T.textMuted }}>Phone</span>
      </div>
      <div className="idc-multi-entries">
        {phones.map(entry => (
          <PhoneRow
            key={entry.id}
            entry={entry}
            onChange={updated => save(phones.map(p => (p.id === entry.id ? updated : p)))}
            onDelete={() => save(phones.filter(p => p.id !== entry.id))}
            T={T}
          />
        ))}
        {adding && (
          <PhoneRow
            key={adding.id}
            entry={adding}
            isNew
            onChange={(entry) => {
              // A type picked before the number is typed waits with the row.
              if (!entry.value) { setAdding(entry); return; }
              setAdding(null);
              save([...phones, entry]);
            }}
            onDelete={() => setAdding(null)}
            T={T}
          />
        )}
      </div>
      {!adding && (
        <button
          type="button"
          className="idc-add-entry"
          style={{ color: T.textFaint }}
          onClick={() => setAdding({ id: `p${Date.now()}`, value: '', extension: null, label: 'unknown', labelSource: null, observedLabel: null })}
        >
          <Plus size={12} /><span>add phone</span>
        </button>
      )}
    </div>
  );
}
