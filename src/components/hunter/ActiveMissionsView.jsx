/**
 * ActiveMissionsView — Active missions tab content.
 *
 * Replaces the simple contact list in HunterDashboard's active tab.
 * Shows a MissionCard for each active contact with:
 *   - Immediate contact info (always visible)
 *   - Barry loading state while draft generates
 *   - Full draft UI when ready (4 angles + editable field)
 *   - Intake badge count in the tab header (via intakePendingCount)
 *   - Error state with retry + manual write option
 *
 * Contacts passed here have hunter_status 'active_mission' or 'engaged_pending'.
 * Both states are shown — engaged_pending shows the loading state.
 */

import MissionCard from './MissionCard';
import './ActiveMissionsView.css';

export default function ActiveMissionsView({ contacts, reconConfidencePct, onGoToDeck, onViewProfile, onMissionComplete }) {
  if (!contacts || contacts.length === 0) {
    return (
      <div className="amv-empty">
        <div className="amv-empty-icon">🎯</div>
        <p className="amv-empty-title">No active missions yet.</p>
        <p className="amv-empty-sub">Engage contacts from your deck to start missions.</p>
        {onGoToDeck && (
          <button className="amv-empty-cta" onClick={onGoToDeck}>
            Go to deck
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="amv-list">
      {contacts.map(contact => (
        <div key={contact.id} style={{ position: 'relative' }}>
          <MissionCard
            contact={contact}
            reconConfidencePct={reconConfidencePct ?? null}
            onMissionComplete={(outcome) => onMissionComplete && onMissionComplete(contact, outcome)}
          />
          {onViewProfile && (
            <button
              onClick={() => onViewProfile(contact.id)}
              style={{
                position: 'absolute', top: 14, right: 14,
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 11px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                background: 'rgba(232,25,125,0.09)', border: '1px solid rgba(232,25,125,0.22)',
                color: '#e8197d', cursor: 'pointer', zIndex: 5,
              }}
            >
              Engage →
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
