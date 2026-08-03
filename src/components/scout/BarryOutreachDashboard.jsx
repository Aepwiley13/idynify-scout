import { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { Brain, Mail, Edit3, Check, X, Loader2 } from 'lucide-react';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import BarryHandoffReview from './BarryHandoffReview';

const STATUS_GROUPS = [
  { key: 'pending_review', label: 'Pending Review', color: '#f59e0b' },
  { key: 'approved', label: 'Approved', color: '#10b981' },
  { key: 'edited_and_approved', label: 'Edited', color: '#00c4cc' },
  { key: 'sent', label: 'Sent', color: '#a78bfa' },
  { key: 'rejected', label: 'Rejected', color: '#dc2626' },
];

export default function BarryOutreachDashboard() {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all');

  useEffect(() => { loadDrafts(); }, []);

  async function loadDrafts() {
    try {
      const user = getEffectiveUser() || auth.currentUser;
      if (!user) return;

      const snap = await getDocs(
        query(collection(db, 'users', user.uid, 'barryDrafts'), orderBy('generatedAt', 'desc'))
      );
      setDrafts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error('Failed to load drafts:', e);
    } finally {
      setLoading(false);
    }
  }

  const filtered = activeFilter === 'all'
    ? drafts
    : drafts.filter(d => d.status === activeFilter);

  const stats = {
    total: drafts.length,
    approvedAsIs: drafts.filter(d => d.status === 'approved').length,
    edited: drafts.filter(d => d.status === 'edited_and_approved').length,
    rejected: drafts.filter(d => d.status === 'rejected').length,
    sent: drafts.filter(d => d.status === 'sent').length,
  };

  const editRate = stats.total > 0
    ? Math.round((stats.edited / Math.max(1, stats.approvedAsIs + stats.edited)) * 100)
    : 0;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
        <Loader2 size={24} className="animate-spin" style={{ color: '#a78bfa' }} />
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Brain size={20} color="#a78bfa" />
        <h2 style={{ color: '#e5e7eb', fontSize: 18, fontWeight: 700, margin: 0 }}>Barry Outreach</h2>
      </div>

      {/* Stats bar */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
        gap: 8, marginBottom: 16
      }}>
        {[
          { label: 'Total Drafts', value: stats.total, icon: <Mail size={14} /> },
          { label: 'Approved', value: stats.approvedAsIs, icon: <Check size={14} /> },
          { label: 'Edited', value: stats.edited, icon: <Edit3 size={14} /> },
          { label: 'Edit Rate', value: `${editRate}%`, icon: <Brain size={14} /> },
          { label: 'Sent', value: stats.sent, icon: <Mail size={14} /> },
        ].map(s => (
          <div key={s.label} style={{
            background: 'rgba(255,255,255,0.03)', borderRadius: 12,
            padding: '10px 12px', border: '1px solid rgba(255,255,255,0.06)',
            textAlign: 'center'
          }}>
            <div style={{ color: '#6b7280', fontSize: 10, marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              {s.icon} {s.label}
            </div>
            <div style={{ color: '#e5e7eb', fontSize: 18, fontWeight: 700 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        <button
          onClick={() => setActiveFilter('all')}
          style={{
            padding: '4px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            background: activeFilter === 'all' ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${activeFilter === 'all' ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.08)'}`,
            color: activeFilter === 'all' ? '#a78bfa' : '#9ca3af'
          }}
        >All ({drafts.length})</button>
        {STATUS_GROUPS.map(g => {
          const count = drafts.filter(d => d.status === g.key).length;
          if (count === 0) return null;
          return (
            <button
              key={g.key}
              onClick={() => setActiveFilter(g.key)}
              style={{
                padding: '4px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: activeFilter === g.key ? `${g.color}20` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${activeFilter === g.key ? `${g.color}40` : 'rgba(255,255,255,0.08)'}`,
                color: activeFilter === g.key ? g.color : '#9ca3af'
              }}
            >{g.label} ({count})</button>
          );
        })}
      </div>

      {/* Draft list */}
      {filtered.length > 0 ? (
        <BarryHandoffReview
          drafts={filtered}
          userId={(getEffectiveUser() || auth.currentUser)?.uid}
          onUpdate={loadDrafts}
        />
      ) : (
        <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>
          <Mail size={32} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
          <p style={{ fontSize: 13 }}>No drafts {activeFilter !== 'all' ? `with status "${activeFilter}"` : 'yet'}</p>
        </div>
      )}
    </div>
  );
}
