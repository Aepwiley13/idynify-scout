import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { Brain, Check, X, Edit3, Mail, User } from 'lucide-react';

export default function BarryHandoffReview({ drafts, userId, onUpdate }) {
  const [editingId, setEditingId] = useState(null);
  const [editBody, setEditBody] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [rejectionNote, setRejectionNote] = useState('');
  const [showReject, setShowReject] = useState(null);

  if (!drafts || drafts.length === 0) return null;

  async function handleApprove(draftId) {
    await updateDoc(doc(db, 'users', userId, 'barryDrafts', draftId), {
      status: 'approved',
      approvedAt: new Date().toISOString()
    });
    if (onUpdate) onUpdate();
  }

  async function handleApproveAll() {
    for (const d of drafts.filter(d => d.status === 'pending_review')) {
      await updateDoc(doc(db, 'users', userId, 'barryDrafts', d.id), {
        status: 'approved',
        approvedAt: new Date().toISOString()
      });
    }
    if (onUpdate) onUpdate();
  }

  function startEdit(draft) {
    setEditingId(draft.id);
    setEditSubject(draft.subject);
    setEditBody(draft.body);
  }

  async function saveEdit(draftId, originalBody) {
    const distance = Math.abs(editBody.length - originalBody.length) +
      editBody.split(' ').filter((w, i) => w !== originalBody.split(' ')[i]).length;

    await updateDoc(doc(db, 'users', userId, 'barryDrafts', draftId), {
      subject: editSubject,
      body: editBody,
      status: 'edited_and_approved',
      editDistance: distance,
      approvedAt: new Date().toISOString()
    });
    setEditingId(null);
    if (onUpdate) onUpdate();
  }

  async function handleReject(draftId) {
    await updateDoc(doc(db, 'users', userId, 'barryDrafts', draftId), {
      status: 'rejected',
      rejectionReason: rejectionNote
    });
    setShowReject(null);
    setRejectionNote('');
    if (onUpdate) onUpdate();
  }

  const pending = drafts.filter(d => d.status === 'pending_review');

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(124,58,237,0.06), rgba(0,196,204,0.06))',
      border: '1px solid rgba(124,58,237,0.2)',
      borderRadius: 16, padding: 16, marginBottom: 16
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Mail size={16} color="#a78bfa" />
          <span style={{ color: '#e5e7eb', fontWeight: 600, fontSize: 14 }}>Ready to Send</span>
          <span style={{ color: '#6b7280', fontSize: 12 }}>({drafts.length} drafts)</span>
        </div>
        {pending.length > 1 && (
          <button onClick={handleApproveAll} style={{
            background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)',
            borderRadius: 8, padding: '4px 12px', color: '#10b981', fontSize: 12,
            fontWeight: 600, cursor: 'pointer'
          }}>
            Approve All ({pending.length})
          </button>
        )}
      </div>

      {drafts.map(draft => (
        <div key={draft.id} style={{
          background: 'rgba(255,255,255,0.03)', borderRadius: 12,
          padding: 14, marginBottom: 8, border: '1px solid rgba(255,255,255,0.06)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <User size={14} color="#9ca3af" />
            <span style={{ color: '#e5e7eb', fontSize: 13, fontWeight: 500 }}>{draft.contactName}</span>
            <span style={{ color: '#6b7280', fontSize: 11 }}>at {draft.companyName}</span>
            {draft.contactEmail && (
              <span style={{ color: '#6b7280', fontSize: 11, marginLeft: 'auto' }}>{draft.contactEmail}</span>
            )}
          </div>

          {editingId === draft.id ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                value={editSubject}
                onChange={e => setEditSubject(e.target.value)}
                style={{
                  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,196,204,0.3)',
                  borderRadius: 8, padding: '6px 10px', color: '#e5e7eb', fontSize: 12
                }}
              />
              <textarea
                value={editBody}
                onChange={e => setEditBody(e.target.value)}
                rows={6}
                style={{
                  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,196,204,0.3)',
                  borderRadius: 8, padding: '8px 10px', color: '#e5e7eb', fontSize: 12,
                  resize: 'vertical'
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => saveEdit(draft.id, draft.originalBody)} style={{
                  flex: 1, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)',
                  borderRadius: 8, padding: '6px 0', color: '#10b981', fontSize: 12, fontWeight: 600, cursor: 'pointer'
                }}>Save & Approve</button>
                <button onClick={() => setEditingId(null)} style={{
                  padding: '6px 12px', background: 'none', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8, color: '#9ca3af', fontSize: 12, cursor: 'pointer'
                }}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <p style={{ color: '#d1d5db', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Subject: {draft.subject}
              </p>
              <p style={{ color: '#9ca3af', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {draft.body?.slice(0, 200)}{draft.body?.length > 200 ? '...' : ''}
              </p>

              {showReject === draft.id ? (
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <input
                    value={rejectionNote}
                    onChange={e => setRejectionNote(e.target.value)}
                    placeholder="Why? (optional)"
                    style={{
                      flex: 1, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(220,38,38,0.3)',
                      borderRadius: 8, padding: '6px 10px', color: '#e5e7eb', fontSize: 12
                    }}
                  />
                  <button onClick={() => handleReject(draft.id)} style={{
                    background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.3)',
                    borderRadius: 8, padding: '6px 12px', color: '#dc2626', fontSize: 12, cursor: 'pointer'
                  }}>Confirm</button>
                  <button onClick={() => setShowReject(null)} style={{
                    background: 'none', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8, padding: '6px 12px', color: '#9ca3af', fontSize: 12, cursor: 'pointer'
                  }}>Cancel</button>
                </div>
              ) : (
                draft.status === 'pending_review' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={() => handleApprove(draft.id)} style={{
                      display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(16,185,129,0.15)',
                      border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, padding: '4px 10px',
                      color: '#10b981', fontSize: 11, fontWeight: 600, cursor: 'pointer'
                    }}><Check size={12} /> Approve</button>
                    <button onClick={() => startEdit(draft)} style={{
                      display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(0,196,204,0.1)',
                      border: '1px solid rgba(0,196,204,0.3)', borderRadius: 8, padding: '4px 10px',
                      color: '#00c4cc', fontSize: 11, fontWeight: 600, cursor: 'pointer'
                    }}><Edit3 size={12} /> Edit</button>
                    <button onClick={() => setShowReject(draft.id)} style={{
                      display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(220,38,38,0.1)',
                      border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, padding: '4px 10px',
                      color: '#dc2626', fontSize: 11, fontWeight: 600, cursor: 'pointer'
                    }}><X size={12} /> Reject</button>
                  </div>
                )
              )}

              {draft.status !== 'pending_review' && (
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 7, marginTop: 8,
                  display: 'inline-block',
                  background: draft.status === 'approved' ? 'rgba(16,185,129,0.15)' : draft.status === 'edited_and_approved' ? 'rgba(0,196,204,0.15)' : 'rgba(220,38,38,0.15)',
                  color: draft.status === 'approved' ? '#10b981' : draft.status === 'edited_and_approved' ? '#00c4cc' : '#dc2626',
                  border: `1px solid ${draft.status === 'approved' ? 'rgba(16,185,129,0.3)' : draft.status === 'edited_and_approved' ? 'rgba(0,196,204,0.3)' : 'rgba(220,38,38,0.3)'}`,
                }}>
                  {draft.status === 'approved' ? 'Approved' : draft.status === 'edited_and_approved' ? 'Edited & Approved' : 'Rejected'}
                </span>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
