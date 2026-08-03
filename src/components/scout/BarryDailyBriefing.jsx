import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { Brain, Check, X, ChevronDown, ChevronUp, Undo2 } from 'lucide-react';

function BriefingSection({ title, icon, color, items, userId, onUndo, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  if (!items || items.length === 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0'
        }}
      >
        {icon}
        <span style={{ color, fontWeight: 600, fontSize: 13 }}>{title}</span>
        <span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 4 }}>({items.length})</span>
        {open ? <ChevronUp size={14} color="#6b7280" /> : <ChevronDown size={14} color="#6b7280" />}
      </button>

      {open && (
        <div style={{ paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map(item => (
            <div key={item.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 12px'
            }}>
              <div>
                <span style={{ color: '#e5e7eb', fontSize: 13, fontWeight: 500 }}>{item.name}</span>
                <span style={{ color: '#6b7280', fontSize: 11, marginLeft: 8 }}>Score: {item.score}</span>
              </div>
              {onUndo && (
                <button
                  onClick={() => onUndo(item.id)}
                  style={{
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 4, color: '#9ca3af', fontSize: 11
                  }}
                >
                  <Undo2 size={12} /> Undo
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BarryDailyBriefing({ briefing, userId }) {
  const [undone, setUndone] = useState(new Set());

  if (!briefing) return null;

  async function handleUndo(companyId) {
    try {
      await updateDoc(doc(db, 'users', userId, 'companies', companyId), {
        status: 'pending',
        barryAutoApproved: false,
        barryAutoRejected: false
      });
      setUndone(prev => new Set(prev).add(companyId));
    } catch (err) {
      console.error('Undo failed:', err);
    }
  }

  const autoApproved = (briefing.autoApproved || []).filter(c => !undone.has(c.id));
  const autoRejected = (briefing.autoRejected || []).filter(c => !undone.has(c.id));
  const needsReview = briefing.needsReview || [];

  const hasContent = autoApproved.length > 0 || autoRejected.length > 0 || needsReview.length > 0;
  if (!hasContent) return null;

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(124,58,237,0.08), rgba(0,196,204,0.08))',
      border: '1px solid rgba(124,58,237,0.25)',
      borderRadius: 16,
      padding: 16,
      marginBottom: 16
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Brain size={18} color="#a78bfa" />
        <span style={{ color: '#e5e7eb', fontWeight: 600, fontSize: 14 }}>Barry's Daily Briefing</span>
      </div>

      {briefing.summary && (
        <p style={{ color: '#9ca3af', fontSize: 12, marginBottom: 12, fontStyle: 'italic' }}>
          {briefing.summary}
        </p>
      )}

      <BriefingSection
        title="Auto-Approved"
        icon={<Check size={14} color="#10b981" />}
        color="#10b981"
        items={autoApproved}
        userId={userId}
        onUndo={handleUndo}
      />

      <BriefingSection
        title="Auto-Rejected"
        icon={<X size={14} color="#dc2626" />}
        color="#dc2626"
        items={autoRejected}
        userId={userId}
        onUndo={handleUndo}
      />

      <BriefingSection
        title="Needs Your Review"
        icon={<Brain size={14} color="#f59e0b" />}
        color="#f59e0b"
        items={needsReview}
        userId={userId}
        defaultOpen={true}
      />
    </div>
  );
}
