import { useNavigate } from 'react-router-dom';
import { Send, Smartphone, Sparkles } from 'lucide-react';
import { downloadVCard } from '../../utils/vcard';
import './QuickActions.css';

export default function QuickActions({ contact, onEnrich }) {
  const navigate = useNavigate();

  // Check if contact needs enrichment
  function isContactNotEnriched() {
    const hasWorkEmail = !!(contact.work_email || contact.email);
    const hasPhone = !!(contact.phone || contact.phone_mobile || contact.phone_direct || contact.phone_work);
    const hasLinkedIn = !!contact.linkedin_url;
    const hasCompany = !!(contact.company_name || contact.company);

    return !hasWorkEmail || !hasPhone || !hasLinkedIn || !hasCompany;
  }

  return (
    <div className="quick-actions-bar">
      <button
        className="action-button action-button-primary"
        onClick={() => navigate(`/hunter/campaign/new?contactIds=${contact.id}`)}
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
      {isContactNotEnriched() && onEnrich && (
        <button
          className="action-button action-button-enrich"
          onClick={onEnrich}
          title="Enrich Contact"
        >
          <Sparkles className="w-5 h-5" />
          <span>Enrich</span>
        </button>
      )}
    </div>
  );
}
