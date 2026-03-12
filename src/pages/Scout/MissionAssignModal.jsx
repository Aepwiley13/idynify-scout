import { useState, useEffect } from 'react';
import { getActiveMissions, assignCompanyToMission } from '../../services/missionService';
import { auth } from '../../firebase/config';
import { getEffectiveUser } from '../context/ImpersonationContext';

export default function MissionAssignModal({ company, onClose, onSuccess }) {
  const [missions, setMissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadMissions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on ESC
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function loadMissions() {
    const user = getEffectiveUser();
    if (!user) return;
    setLoading(true);
    const list = await getActiveMissions(user.uid);
    setMissions(list);
    setLoading(false);
  }

  async function handleAssign() {
    if (!selected) return;
    const user = getEffectiveUser();
    if (!user) return;
    setAssigning(true);
    setError(null);
    const result = await assignCompanyToMission(user.uid, company.id, selected.id);
    setAssigning(false);
    if (result.success) {
      onSuccess(selected.name || selected.goalName || 'Mission');
      onClose();
    } else {
      setError('Assignment failed — try again');
    }
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div className="mc-modal-overlay" onClick={handleOverlayClick}>
      <div className="mc-modal mc-assign-modal">
        {/* Header */}
        <div className="mc-modal-header">
          <div className="mc-modal-header-text">
            <div className="mc-modal-eyebrow">ACTION CONSOLE</div>
            <div className="mc-modal-title">ASSIGN TARGET TO MISSION</div>
            <div className="mc-modal-subtitle mc-modal-subtitle--cyan">
              {(company.name || 'UNKNOWN').toUpperCase()}
            </div>
          </div>
          <button className="mc-modal-close" onClick={onClose} title="Close (ESC)">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="mc-modal-body">
          {loading ? (
            <div className="mc-modal-generating">
              <div className="mc-modal-spinner" />
              <span>LOADING MISSIONS...</span>
            </div>
          ) : missions.length === 0 ? (
            <div className="mc-assign-empty">
              <div className="mc-assign-empty-text">No active missions found</div>
              <a href="/hunter/create-mission" className="mc-assign-create-link">
                CREATE MISSION →
              </a>
            </div>
          ) : (
            <div className="mc-assign-list">
              {missions.map((m) => (
                <button
                  key={m.id}
                  className={`mc-assign-card${selected?.id === m.id ? ' selected' : ''}`}
                  onClick={() => setSelected(m)}
                >
                  <div className="mc-assign-card-name">
                    {m.name || m.goalName || 'Unnamed Mission'}
                  </div>
                  <div className={`mc-assign-card-status mc-assign-status--${m.status}`}>
                    {(m.status || 'active').toUpperCase()}
                  </div>
                </button>
              ))}
            </div>
          )}

          {error && <div className="mc-modal-inline-error">{error}</div>}
        </div>

        {/* Footer */}
        <div className="mc-modal-footer">
          <div className="mc-modal-footer-actions">
            <button
              className="mc-modal-primary-btn"
              onClick={handleAssign}
              disabled={!selected || assigning || missions.length === 0}
            >
              {assigning ? 'ASSIGNING...' : 'ASSIGN TO MISSION'}
            </button>
            <button className="mc-modal-abort-btn" onClick={onClose}>
              ABORT
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
