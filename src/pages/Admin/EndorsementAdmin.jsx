import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../firebase/config';
import { Users, ArrowLeft, Search, Trash2, RefreshCw } from 'lucide-react';

export default function EndorsementAdmin() {
  const navigate = useNavigate();
  const [endorsements, setEndorsements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(null); // { id, name }
  const [removalReason, setRemovalReason] = useState('');
  const [removing, setRemoving] = useState(false);
  const [actionMessage, setActionMessage] = useState(null); // { type: 'success'|'error', text }

  useEffect(() => {
    loadEndorsements();
  }, [statusFilter]);

  const loadEndorsements = async () => {
    try {
      setLoading(true);
      setError(null);
      const user = auth.currentUser;
      if (!user) { navigate('/login'); return; }

      const authToken = await user.getIdToken();
      const res = await fetch(
        `/.netlify/functions/adminGetEndorsements?status=${statusFilter}`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      const data = await res.json();

      if (!data.success) throw new Error(data.error || 'Failed to load endorsements');
      setEndorsements(data.endorsements);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    if (!confirmRemove) return;
    try {
      setRemoving(true);
      const user = auth.currentUser;
      const authToken = await user.getIdToken();

      const res = await fetch('/.netlify/functions/adminRemoveEndorsement', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          endorsementId: confirmRemove.id,
          reason: removalReason.trim() || null
        })
      });
      const data = await res.json();

      if (!data.success) throw new Error(data.error || 'Failed to remove endorsement');

      setActionMessage({ type: 'success', text: `"${confirmRemove.name}" has been removed.` });
      setConfirmRemove(null);
      setRemovalReason('');
      loadEndorsements();
    } catch (err) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setRemoving(false);
    }
  };

  const formatDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  };

  const filtered = endorsements.filter(e =>
    e.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.tagline?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.location?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1.5rem', minHeight: '100vh', background: 'var(--bg-secondary)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            onClick={() => navigate('/admin')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            <ArrowLeft size={16} />
            Back to Admin
          </button>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Endorsement Manager
            </h1>
            <p style={{ color: 'var(--text-secondary)', margin: '0.25rem 0 0', fontSize: '0.95rem' }}>
              View and remove campaign endorsements
            </p>
          </div>
        </div>
        <button
          onClick={loadEndorsements}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.2rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '0.5rem', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }}
        >
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>

      {/* Action message */}
      {actionMessage && (
        <div
          style={{
            padding: '0.875rem 1.25rem',
            borderRadius: '0.5rem',
            marginBottom: '1.5rem',
            background: actionMessage.type === 'success' ? '#dcfce7' : '#fee2e2',
            color: actionMessage.type === 'success' ? '#166534' : '#991b1b',
            fontWeight: 500,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span>{actionMessage.text}</span>
          <button
            onClick={() => setActionMessage(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'inherit', lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.5rem 0.75rem', flex: '1', minWidth: 200 }}>
          <Search size={15} style={{ color: '#9ca3af' }} />
          <input
            type="text"
            placeholder="Search by name, title, or location..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{ border: 'none', outline: 'none', fontSize: '0.875rem', width: '100%', background: 'transparent' }}
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: '0.5rem 0.75rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem', fontSize: '0.875rem', background: 'white', cursor: 'pointer' }}
        >
          <option value="all">All Statuses</option>
          <option value="active">Active Only</option>
          <option value="removed">Removed Only</option>
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)' }}>
          Loading endorsements...
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '4rem', color: '#dc2626' }}>
          <p style={{ marginBottom: '1rem' }}>{error}</p>
          <button
            onClick={loadEndorsements}
            style={{ padding: '0.5rem 1rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '0.5rem', cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Showing {filtered.length} of {endorsements.length} endorsements
          </div>
          <div style={{ background: 'white', borderRadius: '0.75rem', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ textAlign: 'left', padding: '0.875rem 1rem', fontSize: '0.8rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Endorser</th>
                  <th style={{ textAlign: 'left', padding: '0.875rem 1rem', fontSize: '0.8rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Location</th>
                  <th style={{ textAlign: 'left', padding: '0.875rem 1rem', fontSize: '0.8rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Added</th>
                  <th style={{ textAlign: 'left', padding: '0.875rem 1rem', fontSize: '0.8rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
                  <th style={{ textAlign: 'right', padding: '0.875rem 1rem', fontSize: '0.8rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af' }}>
                      No endorsements found.
                    </td>
                  </tr>
                ) : filtered.map((e, idx) => (
                  <tr key={e.id} style={{ borderBottom: idx < filtered.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {e.photoUrl ? (
                          <img src={e.photoUrl} alt={e.name} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#1e3a5f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: '0.85rem', flexShrink: 0 }}>
                            {e.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{e.name}</div>
                          {e.tagline && <div style={{ fontSize: '0.8rem', color: '#e05c2a', fontWeight: 500 }}>{e.tagline}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                      {e.location || '—'}
                    </td>
                    <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                      {formatDate(e.createdAt)}
                    </td>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      {e.status === 'removed' ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.25rem 0.6rem', background: '#fee2e2', color: '#991b1b', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
                          Removed
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.25rem 0.6rem', background: '#dcfce7', color: '#166534', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
                          Active
                        </span>
                      )}
                      {e.status === 'removed' && e.removedAt && (
                        <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.2rem' }}>
                          {formatDate(e.removedAt)}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '0.875rem 1rem', textAlign: 'right' }}>
                      {e.status === 'active' && (
                        <button
                          onClick={() => { setConfirmRemove({ id: e.id, name: e.name }); setRemovalReason(''); }}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.8rem', background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '0.375rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                        >
                          <Trash2 size={13} />
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Confirm Remove Modal */}
      {confirmRemove && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) { setConfirmRemove(null); setRemovalReason(''); } }}
        >
          <div style={{ background: 'white', borderRadius: '0.75rem', padding: '2rem', maxWidth: 440, width: '100%', margin: '0 1rem', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 size={18} style={{ color: '#dc2626' }} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontWeight: 700, color: '#111827', fontSize: '1rem' }}>Remove Endorsement</h3>
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#6b7280' }}>This will hide the endorser from the public list.</p>
              </div>
            </div>

            <p style={{ fontSize: '0.9rem', color: '#374151', marginBottom: '1.25rem' }}>
              Are you sure you want to remove <strong>{confirmRemove.name}</strong>? The record will be preserved for audit purposes.
            </p>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#374151', marginBottom: '0.4rem' }}>
                Reason (optional)
              </label>
              <textarea
                value={removalReason}
                onChange={e => setRemovalReason(e.target.value)}
                placeholder="e.g. Duplicate entry, requested by endorser..."
                rows={2}
                style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.875rem', resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setConfirmRemove(null); setRemovalReason(''); }}
                disabled={removing}
                style={{ padding: '0.6rem 1.2rem', background: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: '0.5rem', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleRemove}
                disabled={removing}
                style={{ padding: '0.6rem 1.2rem', background: removing ? '#fca5a5' : '#dc2626', color: 'white', border: 'none', borderRadius: '0.5rem', fontWeight: 600, fontSize: '0.875rem', cursor: removing ? 'not-allowed' : 'pointer' }}
              >
                {removing ? 'Removing...' : 'Yes, Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
