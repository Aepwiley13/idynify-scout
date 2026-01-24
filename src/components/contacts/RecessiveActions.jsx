import { Mail, Linkedin, Phone } from 'lucide-react';
import './RecessiveActions.css';

export default function RecessiveActions({ contact }) {
  return (
    <div className="recessive-actions">
      {contact.email && (
        <a href={`mailto:${contact.email}`} className="recessive-action">
          <Mail className="action-icon" />
          <span className="action-label">Email</span>
        </a>
      )}

      {contact.linkedin_url && (
        <a
          href={contact.linkedin_url}
          target="_blank"
          rel="noopener noreferrer"
          className="recessive-action"
        >
          <Linkedin className="action-icon" />
          <span className="action-label">LinkedIn</span>
        </a>
      )}

      {contact.phone && (
        <a href={`tel:${contact.phone}`} className="recessive-action">
          <Phone className="action-icon" />
          <span className="action-label">Call</span>
        </a>
      )}
    </div>
  );
}
