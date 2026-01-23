import { Building2 } from 'lucide-react';
import './HeroHeader.css';

export default function HeroHeader({ contact, size = 'compact' }) {
  function getSourceBadge() {
    const badges = {
      manual: { icon: '✍️', text: 'Manual', color: '#1e40af', bg: '#eff6ff' },
      networking: { icon: '🤝', text: 'Networking', color: '#7e22ce', bg: '#faf5ff' },
      apollo: { icon: '🔍', text: 'Search', color: '#15803d', bg: '#f0fdf4' }
    };

    const badge = badges[contact.source] || badges.apollo;

    return (
      <div
        className="source-badge"
        style={{
          backgroundColor: badge.bg,
          color: badge.color,
          padding: '0.5rem 1rem',
          borderRadius: '999px',
          fontSize: '0.875rem',
          fontWeight: 600,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.375rem'
        }}
      >
        <span>{badge.icon}</span>
        <span>{badge.text}</span>
      </div>
    );
  }

  return (
    <div
      className={`contact-hero-header ${size}`}
      style={{
        backgroundImage: `url(${contact.photo_url || '/barry.png'})`,
      }}
    >
      {/* Source Badge - Absolutely Positioned */}
      <div className="hero-source-badge">
        {getSourceBadge()}
      </div>

      {/* Gradient Overlay */}
      <div className="contact-hero-overlay">
        {/* Contact Info Overlay */}
        <div className="contact-hero-content">
          {/* Name and Title */}
          <h2 className="contact-hero-name">
            {contact.name || 'Unknown Contact'}
          </h2>
          <p className="contact-hero-title">
            {contact.title || 'No title specified'}
          </p>
          {contact.company_name && (
            <p className="contact-hero-company">
              <Building2 className="w-4 h-4" />
              {contact.company_name}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
