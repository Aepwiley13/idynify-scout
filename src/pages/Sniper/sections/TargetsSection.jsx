/**
 * TargetsSection.jsx — Contact roster for the SNIPER pipeline.
 *
 * Full list view of all post-demo contacts with stage, last touch,
 * next scheduled follow-up, and quick-action buttons.
 */
import { useState, useEffect } from 'react';
import {
  collection, getDocs, query, orderBy,
  doc, updateDoc, addDoc, serverTimestamp, deleteDoc
} from 'firebase/firestore';
import { db, auth } from '../../../firebase/config';
import {
  User, Building2, Clock, ChevronDown, ChevronUp,
  Plus, Crosshair, Mail, Phone, Calendar, CheckCircle,
  XCircle, Filter, Search, Trash2, Edit3
} from 'lucide-react';
import { useT } from '../../../theme/ThemeContext';
import { BRAND } from '../../../theme/tokens';
import { getEffectiveUser } from '../../../context/ImpersonationContext';

const SNIPER_TEAL = '#14b8a6';

const STAGES = [
  { id: 'demo_done',     label: 'Demo Done',     color: '#3b82f6' },
  { id: 'proposal_sent', label: 'Proposal Sent', color: '#8b5cf6' },
  { id: 'negotiating',   label: 'Negotiating',   color: '#f59e0b' },
  { id: 'closing',       label: 'Closing',       color: SNIPER_TEAL },
  { id: 'won',           label: 'Won',           color: '#10b981' },
  { id: 'lost',          label: 'Lost',          color: '#ef4444' },
];

const TOUCH_TYPES = [
  { id: 'email',    label: 'Email' },
  { id: 'call',     label: 'Call' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'meeting',  label: 'Meeting' },
  { id: 'other',    label: 'Other' },
];

function daysSince(ts) {
  if (!ts) return null;
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function StageBadge({ stageId }) {
  const stage = STAGES.find(s => s.id === stageId) || STAGES[0];
  return (
    <span style={{
      padding: '3px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600,
      background: `${stage.color}18`, color: stage.color,
      border: `1px solid ${stage.color}35`,
    }}>
      {stage.label}
    </span>
  );
}

function LogTouchModal({ contact, onClose, onLogged }) {
  const T = useT();
  const [type, setType] = useState('email');
  const [notes, setNotes] = useState('');
  const [nextTouchLabel, setNextTouchLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const user = getEffectiveUser();
    if (!user) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'users', user.uid, 'sniper_touches'), {
        contactId: contact.id,
        contactName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.name,
        type,
        notes,
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'users', user.uid, 'sniper_contacts', contact.id), {
        lastTouchAt: serverTimestamp(),
        lastTouchType: type,
        ...(nextTouchLabel ? { nextTouchLabel } : {}),
      });
      onLogged({ lastTouchAt: new Date(), lastTouchType: type, nextTouchLabel });
      onClose();
    } catch (err) {
      console.error('Error logging touch:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: T.cardBg, border: `1px solid ${T.border2}`,
        borderRadius: 16, padding: 26, width: 420, maxWidth: '90vw',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 4 }}>Log a Touch</div>
        <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 18 }}>
          {contact.firstName} {contact.lastName} · {contact.company}
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 6 }}>TOUCH TYPE</div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {TOUCH_TYPES.map(t => (
                <div
                  key={t.id}
                  onClick={() => setType(t.id)}
                  style={{
                    padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    background: type === t.id ? `${SNIPER_TEAL}20` : T.surface,
                    border: `1px solid ${type === t.id ? SNIPER_TEAL : T.border2}`,
                    color: type === t.id ? SNIPER_TEAL : T.textMuted,
                    cursor: 'pointer',
                  }}
                >
                  {t.label}
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 4 }}>NOTES</div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="What happened? What was discussed?"
              rows={3}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 8,
                background: T.surface, border: `1px solid ${T.border2}`,
                color: T.text, fontSize: 12, outline: 'none', resize: 'vertical',
                fontFamily: 'Inter, system-ui, sans-serif',
              }}
            />
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 4 }}>NEXT FOLLOW-UP (optional)</div>
            <input
              value={nextTouchLabel}
              onChange={e => setNextTouchLabel(e.target.value)}
              placeholder="e.g. Follow up in 2 weeks"
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 8,
                background: T.surface, border: `1px solid ${T.border2}`,
                color: T.text, fontSize: 12, outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{
              padding: '8px 16px', borderRadius: 8, border: `1px solid ${T.border2}`,
              background: 'transparent', color: T.textMuted, fontSize: 12, cursor: 'pointer',
            }}>Cancel</button>
            <button type="submit" disabled={saving} style={{
              padding: '8px 18px', borderRadius: 8, border: 'none',
              background: SNIPER_TEAL, color: '#fff', fontSize: 12, fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
            }}>
              {saving ? 'Saving...' : 'Log Touch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function TargetsSection() {
  const T = useT();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [loggingTouchFor, setLoggingTouchFor] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const loadContacts = async () => {
    const user = getEffectiveUser();
    if (!user) return;
    try {
      const snap = await getDocs(query(
        collection(db, 'users', user.uid, 'sniper_contacts'),
        orderBy('createdAt', 'desc')
      ));
      setContacts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Error loading targets:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadContacts(); }, []);

  const handleStageChange = async (contactId, newStage) => {
    const user = getEffectiveUser();
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'sniper_contacts', contactId), { stage: newStage });
      setContacts(prev => prev.map(c => c.id === contactId ? { ...c, stage: newStage } : c));
    } catch (err) {
      console.error('Error updating stage:', err);
    }
  };

  const handleDelete = async (contactId) => {
    if (!window.confirm('Remove this contact from SNIPER?')) return;
    const user = getEffectiveUser();
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'sniper_contacts', contactId));
      setContacts(prev => prev.filter(c => c.id !== contactId));
    } catch (err) {
      console.error('Error deleting contact:', err);
    }
  };

  const filtered = contacts.filter(c => {
    const name = `${c.firstName || ''} ${c.lastName || ''} ${c.name || ''} ${c.company || ''}`.toLowerCase();
    const matchSearch = !search || name.includes(search.toLowerCase());
    const matchStage = stageFilter === 'all' || c.stage === stageFilter || (!c.stage && stageFilter === 'demo_done');
    return matchSearch && matchStage;
  });

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ textAlign: 'center', color: T.textFaint }}>
          <Crosshair size={28} color={SNIPER_TEAL} style={{ marginBottom: 10, opacity: 0.6 }} />
          <div style={{ fontSize: 12 }}>Loading targets...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 22px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexShrink: 0, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Targets</div>
          <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>
            {filtered.length} of {contacts.length} contacts
          </div>
        </div>

        {/* Search */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '7px 11px', borderRadius: 8,
          background: T.surface, border: `1px solid ${T.border2}`,
          minWidth: 180,
        }}>
          <Search size={13} color={T.textFaint} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search contacts..."
            style={{ background: 'transparent', border: 'none', outline: 'none', color: T.text, fontSize: 12, width: '100%' }}
          />
        </div>

        {/* Stage filter */}
        <select
          value={stageFilter}
          onChange={e => setStageFilter(e.target.value)}
          style={{
            padding: '7px 11px', borderRadius: 8,
            background: T.surface, border: `1px solid ${T.border2}`,
            color: T.text, fontSize: 12, outline: 'none',
          }}
        >
          <option value="all">All Stages</option>
          {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, flexDirection: 'column', gap: 12 }}>
            <Crosshair size={32} color={SNIPER_TEAL} style={{ opacity: 0.4 }} />
            <div style={{ fontSize: 13, color: T.textFaint, textAlign: 'center' }}>
              {contacts.length === 0 ? 'No targets yet — add contacts from the Pipeline view.' : 'No contacts match your filter.'}
            </div>
          </div>
        ) : (
          filtered.map(contact => {
            const days = daysSince(contact.lastTouchAt);
            const isExpanded = expandedId === contact.id;
            const urgentTouch = days !== null && days > 14;

            return (
              <div key={contact.id} style={{
                background: T.cardBg,
                border: `1px solid ${urgentTouch ? '#f59e0b30' : T.border2}`,
                borderRadius: 10, marginBottom: 8,
                transition: 'all 0.12s',
              }}>
                {/* Main row */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px', cursor: 'pointer',
                }} onClick={() => setExpandedId(isExpanded ? null : contact.id)}>
                  {/* Avatar */}
                  <div style={{
                    width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                    background: `${SNIPER_TEAL}18`, border: `1.5px solid ${SNIPER_TEAL}40`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, color: SNIPER_TEAL,
                  }}>
                    {(contact.firstName?.[0] || contact.name?.[0] || '?').toUpperCase()}
                  </div>

                  {/* Name + company */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {contact.firstName && contact.lastName
                        ? `${contact.firstName} ${contact.lastName}`
                        : contact.name || 'Unknown'}
                    </div>
                    <div style={{ fontSize: 10, color: T.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {contact.title || contact.jobTitle || ''}{contact.company ? ` · ${contact.company}` : ''}
                    </div>
                  </div>

                  {/* Stage */}
                  <StageBadge stageId={contact.stage || 'demo_done'} />

                  {/* Last touch */}
                  <div style={{ fontSize: 10, color: urgentTouch ? '#f59e0b' : T.textFaint, textAlign: 'right', minWidth: 80 }}>
                    {days === null ? '—' : days === 0 ? 'Today' : `${days}d ago`}
                    {urgentTouch && <div style={{ fontSize: 9, color: '#f59e0b' }}>Overdue</div>}
                  </div>

                  <ChevronDown size={14} color={T.textFaint} style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                </div>

                {/* Expanded row */}
                {isExpanded && (
                  <div style={{
                    padding: '0 14px 14px',
                    borderTop: `1px solid ${T.border}`,
                    paddingTop: 12,
                  }}>
                    {contact.nextTouchLabel && (
                      <div style={{
                        padding: '6px 10px', borderRadius: 7, marginBottom: 12,
                        background: `${SNIPER_TEAL}10`, border: `1px solid ${SNIPER_TEAL}25`,
                        fontSize: 11, color: SNIPER_TEAL,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        <Calendar size={11} />
                        Next: {contact.nextTouchLabel}
                      </div>
                    )}

                    {/* Stage change row */}
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 9, color: T.textFaint, marginBottom: 6 }}>MOVE STAGE</div>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {STAGES.map(s => (
                          <div
                            key={s.id}
                            onClick={() => handleStageChange(contact.id, s.id)}
                            style={{
                              padding: '4px 10px', borderRadius: 12, fontSize: 10, fontWeight: 600,
                              background: (contact.stage || 'demo_done') === s.id ? `${s.color}20` : T.surface,
                              border: `1px solid ${(contact.stage || 'demo_done') === s.id ? s.color : T.border2}`,
                              color: (contact.stage || 'demo_done') === s.id ? s.color : T.textMuted,
                              cursor: 'pointer',
                            }}
                          >
                            {s.label}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => setLoggingTouchFor(contact)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          padding: '6px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                          background: `${SNIPER_TEAL}15`, border: `1px solid ${SNIPER_TEAL}40`,
                          color: SNIPER_TEAL, cursor: 'pointer',
                        }}
                      >
                        <Mail size={11} />
                        Log Touch
                      </button>
                      <button
                        onClick={() => handleDelete(contact.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          padding: '6px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                          background: 'transparent', border: `1px solid ${T.border2}`,
                          color: T.textFaint, cursor: 'pointer',
                        }}
                      >
                        <Trash2 size={11} />
                        Remove
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {loggingTouchFor && (
        <LogTouchModal
          contact={loggingTouchFor}
          onClose={() => setLoggingTouchFor(null)}
          onLogged={(updates) => {
            setContacts(prev => prev.map(c =>
              c.id === loggingTouchFor.id ? { ...c, ...updates } : c
            ));
          }}
        />
      )}
    </div>
  );
}
