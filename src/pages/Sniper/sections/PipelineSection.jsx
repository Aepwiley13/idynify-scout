/**
 * PipelineSection.jsx — Conversion pipeline for SNIPER.
 *
 * Kanban-style board showing all post-demo contacts by conversion stage.
 * Stages: Demo Done → Proposal Sent → Negotiating → Closing → Won
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection, getDocs, query, orderBy,
  doc, updateDoc, addDoc, serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '../../../firebase/config';
import {
  Crosshair, Plus, ChevronRight, Clock, User,
  Building2, ArrowRight, Trophy, AlertCircle, Sparkles
} from 'lucide-react';
import { useT } from '../../../theme/ThemeContext';
import { BRAND } from '../../../theme/tokens';

const SNIPER_TEAL = '#14b8a6';

const STAGES = [
  { id: 'demo_done',      label: 'Demo Done',      color: '#3b82f6', desc: 'Had the meeting' },
  { id: 'proposal_sent',  label: 'Proposal Sent',  color: '#8b5cf6', desc: 'Waiting on review' },
  { id: 'negotiating',    label: 'Negotiating',    color: '#f59e0b', desc: 'Active back-and-forth' },
  { id: 'closing',        label: 'Closing',        color: SNIPER_TEAL, desc: 'Near the finish line' },
  { id: 'won',            label: 'Won',            color: '#10b981', desc: 'Converted to customer' },
];

function daysSince(ts) {
  if (!ts) return null;
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function ContactCard({ contact, onMove, onOpen }) {
  const T = useT();
  const stage = STAGES.find(s => s.id === contact.stage) || STAGES[0];
  const days = daysSince(contact.lastTouchAt);

  return (
    <div
      onClick={() => onOpen(contact)}
      style={{
        background: T.cardBg,
        border: `1px solid ${T.border2}`,
        borderRadius: 10,
        padding: '11px 13px',
        marginBottom: 7,
        cursor: 'pointer',
        transition: 'all 0.12s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = `${SNIPER_TEAL}50`; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = T.border2; e.currentTarget.style.transform = 'none'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
        <div style={{
          width: 26, height: 26, borderRadius: '50%',
          background: `${SNIPER_TEAL}20`, border: `1.5px solid ${SNIPER_TEAL}50`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: SNIPER_TEAL, flexShrink: 0,
        }}>
          {(contact.firstName?.[0] || contact.name?.[0] || '?').toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {contact.firstName && contact.lastName
              ? `${contact.firstName} ${contact.lastName}`
              : contact.name || 'Unknown'}
          </div>
          <div style={{ fontSize: 10, color: T.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {contact.title || contact.jobTitle || ''}{contact.company ? ` · ${contact.company}` : ''}
          </div>
        </div>
      </div>

      {days !== null && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 9, color: days > 14 ? '#f59e0b' : T.textFaint,
        }}>
          <Clock size={9} />
          {days === 0 ? 'Today' : `${days}d since last touch`}
          {days > 14 && <AlertCircle size={9} color="#f59e0b" />}
        </div>
      )}

      {contact.nextTouchLabel && (
        <div style={{
          marginTop: 5, fontSize: 9, color: SNIPER_TEAL,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <ArrowRight size={9} />
          {contact.nextTouchLabel}
        </div>
      )}
    </div>
  );
}

function AddContactModal({ onClose, onAdd }) {
  const T = useT();
  const [form, setForm] = useState({ firstName: '', lastName: '', title: '', company: '', stage: 'demo_done', notes: '' });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.firstName.trim()) return;
    onAdd(form);
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: T.cardBg, border: `1px solid ${T.border2}`,
        borderRadius: 16, padding: 28, width: 420, maxWidth: '90vw',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 18 }}>
          Add to SNIPER Pipeline
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            {[['firstName', 'First Name *'], ['lastName', 'Last Name']].map(([key, label]) => (
              <div key={key}>
                <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 4 }}>{label}</div>
                <input
                  value={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  style={{
                    width: '100%', padding: '8px 10px', borderRadius: 8,
                    background: T.surface, border: `1px solid ${T.border2}`,
                    color: T.text, fontSize: 13, outline: 'none',
                  }}
                />
              </div>
            ))}
          </div>
          {[['title', 'Job Title'], ['company', 'Company']].map(([key, label]) => (
            <div key={key} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 4 }}>{label}</div>
              <input
                value={form[key]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                style={{
                  width: '100%', padding: '8px 10px', borderRadius: 8,
                  background: T.surface, border: `1px solid ${T.border2}`,
                  color: T.text, fontSize: 13, outline: 'none',
                }}
              />
            </div>
          ))}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 4 }}>Pipeline Stage</div>
            <select
              value={form.stage}
              onChange={e => setForm(f => ({ ...f, stage: e.target.value }))}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 8,
                background: T.surface, border: `1px solid ${T.border2}`,
                color: T.text, fontSize: 13, outline: 'none',
              }}
            >
              {STAGES.filter(s => s.id !== 'won').map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{
              padding: '8px 16px', borderRadius: 8, border: `1px solid ${T.border2}`,
              background: 'transparent', color: T.textMuted, fontSize: 13, cursor: 'pointer',
            }}>Cancel</button>
            <button type="submit" style={{
              padding: '8px 18px', borderRadius: 8, border: 'none',
              background: SNIPER_TEAL, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>Add to Pipeline</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ContactDetailModal({ contact, onClose, onStageChange }) {
  const T = useT();
  const stage = STAGES.find(s => s.id === contact.stage) || STAGES[0];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: T.cardBg, border: `1px solid ${T.border2}`,
        borderRadius: 16, padding: 28, width: 480, maxWidth: '90vw',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{
            width: 42, height: 42, borderRadius: '50%',
            background: `${SNIPER_TEAL}20`, border: `2px solid ${SNIPER_TEAL}50`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 700, color: SNIPER_TEAL,
          }}>
            {(contact.firstName?.[0] || contact.name?.[0] || '?').toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>
              {contact.firstName && contact.lastName
                ? `${contact.firstName} ${contact.lastName}`
                : contact.name || 'Unknown'}
            </div>
            <div style={{ fontSize: 12, color: T.textFaint }}>
              {contact.title || contact.jobTitle || ''}{contact.company ? ` · ${contact.company}` : ''}
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 8 }}>MOVE TO STAGE</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {STAGES.map(s => (
              <div
                key={s.id}
                onClick={() => { onStageChange(contact.id, s.id); onClose(); }}
                style={{
                  padding: '5px 11px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  background: contact.stage === s.id ? `${s.color}25` : T.surface,
                  border: `1px solid ${contact.stage === s.id ? s.color : T.border2}`,
                  color: contact.stage === s.id ? s.color : T.textMuted,
                  cursor: 'pointer', transition: 'all 0.12s',
                }}
              >
                {s.label}
              </div>
            ))}
          </div>
        </div>

        {contact.notes && (
          <div style={{
            padding: '10px 13px', borderRadius: 9,
            background: T.surface, border: `1px solid ${T.border2}`,
            fontSize: 12, color: T.textMuted, marginBottom: 16,
          }}>
            {contact.notes}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '8px 16px', borderRadius: 8, border: `1px solid ${T.border2}`,
            background: 'transparent', color: T.textMuted, fontSize: 13, cursor: 'pointer',
          }}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default function PipelineSection() {
  const T = useT();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);

  const loadContacts = async () => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const snap = await getDocs(query(
        collection(db, 'users', user.uid, 'sniper_contacts'),
        orderBy('createdAt', 'desc')
      ));
      setContacts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Error loading SNIPER contacts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadContacts(); }, []);

  const handleAdd = async (form) => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const docRef = await addDoc(collection(db, 'users', user.uid, 'sniper_contacts'), {
        ...form,
        createdAt: serverTimestamp(),
        lastTouchAt: serverTimestamp(),
      });
      setContacts(prev => [{ id: docRef.id, ...form, createdAt: new Date(), lastTouchAt: new Date() }, ...prev]);
    } catch (err) {
      console.error('Error adding SNIPER contact:', err);
    }
  };

  const handleStageChange = async (contactId, newStage) => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'sniper_contacts', contactId), { stage: newStage });
      setContacts(prev => prev.map(c => c.id === contactId ? { ...c, stage: newStage } : c));
    } catch (err) {
      console.error('Error updating stage:', err);
    }
  };

  const getByStage = (stageId) => contacts.filter(c => (c.stage || 'demo_done') === stageId);

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ textAlign: 'center', color: T.textFaint }}>
          <Crosshair size={28} color={SNIPER_TEAL} style={{ marginBottom: 10, opacity: 0.6 }} />
          <div style={{ fontSize: 12 }}>Loading pipeline...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 22px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Conversion Pipeline</div>
          <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>
            {contacts.length} contact{contacts.length !== 1 ? 's' : ''} in pipeline
          </div>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 8, border: 'none',
            background: SNIPER_TEAL, color: '#fff', fontSize: 12, fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Plus size={13} />
          Add Contact
        </button>
      </div>

      {contacts.length === 0 ? (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 12, color: T.textFaint,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: `${SNIPER_TEAL}12`, border: `2px solid ${SNIPER_TEAL}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Crosshair size={24} color={SNIPER_TEAL} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.textMuted, marginBottom: 4 }}>Pipeline is empty</div>
            <div style={{ fontSize: 12, maxWidth: 280, lineHeight: 1.5 }}>
              Add contacts who've had a demo — SNIPER will help you convert them.
            </div>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            style={{
              padding: '8px 18px', borderRadius: 8, border: `1px solid ${SNIPER_TEAL}`,
              background: `${SNIPER_TEAL}15`, color: SNIPER_TEAL,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Add Your First Target
          </button>
        </div>
      ) : (
        /* Kanban columns */
        <div style={{
          flex: 1, display: 'flex', gap: 12, overflowX: 'auto', overflowY: 'hidden',
          paddingBottom: 8,
        }}>
          {STAGES.map(stage => {
            const stageContacts = getByStage(stage.id);
            return (
              <div key={stage.id} style={{
                minWidth: 220, width: 220, flexShrink: 0,
                display: 'flex', flexDirection: 'column',
              }}>
                {/* Column header */}
                <div style={{
                  padding: '8px 11px', borderRadius: '8px 8px 0 0',
                  background: `${stage.color}12`,
                  border: `1px solid ${stage.color}30`,
                  borderBottom: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  flexShrink: 0,
                }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: stage.color }}>
                      {stage.id === 'won' && <Trophy size={10} style={{ marginRight: 4, display: 'inline' }} />}
                      {stage.label}
                    </div>
                    <div style={{ fontSize: 9, color: T.textFaint }}>{stage.desc}</div>
                  </div>
                  <div style={{
                    minWidth: 18, height: 18, borderRadius: 9,
                    background: `${stage.color}25`, color: stage.color,
                    fontSize: 9, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px',
                  }}>
                    {stageContacts.length}
                  </div>
                </div>

                {/* Column body */}
                <div style={{
                  flex: 1, overflowY: 'auto', padding: '8px 8px',
                  background: `${stage.color}06`,
                  border: `1px solid ${stage.color}20`,
                  borderTop: 'none', borderRadius: '0 0 8px 8px',
                  minHeight: 120,
                }}>
                  {stageContacts.map(contact => (
                    <ContactCard
                      key={contact.id}
                      contact={contact}
                      onMove={handleStageChange}
                      onOpen={setSelectedContact}
                    />
                  ))}
                  {stageContacts.length === 0 && (
                    <div style={{ padding: '16px 8px', textAlign: 'center', fontSize: 10, color: T.textFaint }}>
                      No contacts here
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd && <AddContactModal onClose={() => setShowAdd(false)} onAdd={handleAdd} />}
      {selectedContact && (
        <ContactDetailModal
          contact={selectedContact}
          onClose={() => setSelectedContact(null)}
          onStageChange={handleStageChange}
        />
      )}
    </div>
  );
}
