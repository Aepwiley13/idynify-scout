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

export default function ActiveMissionsView({ contacts, onGoToDeck, onMissionComplete }) {
  if (!contacts || contacts.length === 0) {
    return (
      <div className="amv-empty">
        <div className="amv-empty-icon">🎯</div>
        <p className="amv-empty-title">No active missions yet.</p>
        <p className="amv-empty-sub">Engage contacts from the deck to launch missions.</p>
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
        <MissionCard
          key={contact.id}
          contact={contact}
          onMissionComplete={(outcome) => onMissionComplete && onMissionComplete(contact, outcome)}
        />
      ))}
    </div>
  );
}
