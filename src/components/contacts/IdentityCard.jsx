import { User } from 'lucide-react';
import './IdentityCard.css';

export default function IdentityCard({ contact }) {
  return (
    <div className="identity-card">
      <div className="identity-photo">
        {contact.photo_url ? (
          <img src={contact.photo_url} alt={contact.name} />
        ) : (
          <div className="photo-fallback">
            <User className="w-8 h-8" />
          </div>
        )}
      </div>
      <div className="identity-info">
        <h1 className="identity-name">{contact.name || 'Unknown Contact'}</h1>
        <p className="identity-title">{contact.title || 'No title specified'}</p>
        <p className="identity-company">{contact.company_name || 'No company'}</p>
      </div>
    </div>
  );
}
