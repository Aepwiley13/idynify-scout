import { useNavigate } from 'react-router-dom';
import { Send, Smartphone } from 'lucide-react';
import { downloadVCard } from '../../utils/vcard';
import './QuickActions.css';

export default function QuickActions({ contact, onHunter }) {
  const navigate = useNavigate();

  return (
    <div className="quick-actions-bar">
      <button
        className="action-button action-button-primary"
        onClick={() => {
          if (onHunter) {
            onHunter();
          } else {
            navigate(`/hunter/create-mission?contactId=${contact.id}`);
          }
        }}
        title="Start Campaign"
      >
        <Send className="w-5 h-5" />
        <span>Start Campaign</span>
      </button>
      <button
        className="action-button action-button-secondary"
        onClick={() => downloadVCard(contact)}
        title="Save to Phone"
      >
        <Smartphone className="w-5 h-5" />
        <span>Save to Phone</span>
      </button>
    </div>
  );
}
