import { Mail, Phone, Linkedin, MapPin, Building2, Briefcase, Globe } from 'lucide-react';
import './ContactInfo.css';

const LABEL_PILL_COLORS = {
  work:     { color: '#3b82f6', bg: 'rgba(59,130,246,0.10)' },
  personal: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.10)' },
  mobile:   { color: '#10b981', bg: 'rgba(16,185,129,0.10)' },
  home:     { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)'  },
  other:    { color: '#6b7280', bg: 'rgba(107,114,128,0.10)' },
};

function LabelPill({ label }) {
  const c = LABEL_PILL_COLORS[label] || LABEL_PILL_COLORS.other;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '1px 7px', borderRadius: 20,
      fontSize: 10, fontWeight: 600,
      color: c.color, background: c.bg,
      textTransform: 'capitalize', flexShrink: 0,
    }}>{label}</span>
  );
}

export default function ContactInfo({ contact, mode = 'compact' }) {
  // Build email entries from multi-field array or primary field
  const emailEntries = (contact.emails && contact.emails.length > 0)
    ? contact.emails
    : (contact.email || contact.work_email)
      ? [{ value: contact.email || contact.work_email, label: 'work' }]
      : [];

  // Build phone entries from multi-field array or primary field
  const phoneEntries = (contact.phones && contact.phones.length > 0)
    ? contact.phones
    : (contact.phone || contact.phone_mobile || contact.phone_direct)
      ? [{ value: contact.phone || contact.phone_mobile || contact.phone_direct, label: 'mobile' }]
      : [];

  function getEmailStatusBadge() {
    if (!contact.email_status) return null;

    const badges = {
      verified: { text: '✓ Verified', className: 'verified' },
      likely: { text: '~ Likely', className: 'likely' },
      unverified: { text: 'Unverified', className: 'unverified' }
    };

    const badge = badges[contact.email_status];
    if (!badge) return null;

    return <span className={`email-status ${badge.className}`}>{badge.text}</span>;
  }

  // For compact mode - used in snapshot
  if (mode === 'compact') {
    return (
      <div className="contact-info-compact">
        <h3 className="info-section-title">Contact Information</h3>

        <div className="info-items-compact">
          {/* Emails */}
          <div className="info-item-compact">
            <Mail className="info-icon-compact" />
            <div className="info-content-compact" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
              {emailEntries.length > 0 ? emailEntries.map((e, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <LabelPill label={e.label} />
                  <a href={`mailto:${e.value}`} className="info-value-link">{e.value}</a>
                  {i === 0 && getEmailStatusBadge()}
                </div>
              )) : (
                <span className="info-value-unavailable">Email not available</span>
              )}
            </div>
          </div>

          {/* Phones */}
          <div className="info-item-compact">
            <Phone className="info-icon-compact" />
            <div className="info-content-compact" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
              {phoneEntries.length > 0 ? phoneEntries.map((p, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <LabelPill label={p.label} />
                  <a href={`tel:${p.value}`} className="info-value-link">{p.value}</a>
                </div>
              )) : (
                <span className="info-value-unavailable">Phone not available</span>
              )}
            </div>
          </div>

          {/* LinkedIn */}
          {contact.linkedin_url && (
            <div className="info-item-compact">
              <Linkedin className="info-icon-compact" />
              <div className="info-content-compact">
                <a
                  href={contact.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="info-value-link"
                >
                  View LinkedIn Profile →
                </a>
              </div>
            </div>
          )}

          {/* Address */}
          {contact.address && (
            <div className="info-item-compact">
              <MapPin className="info-icon-compact" />
              <div className="info-content-compact">
                <span className="info-value">{contact.address}</span>
              </div>
            </div>
          )}

          {/* Website */}
          {contact.website && (
            <div className="info-item-compact">
              <Globe className="info-icon-compact" />
              <div className="info-content-compact">
                <a
                  href={contact.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="info-value-link"
                >
                  {contact.website}
                </a>
              </div>
            </div>
          )}

          {/* Location */}
          {contact.location && (
            <div className="info-item-compact">
              <MapPin className="info-icon-compact" />
              <div className="info-content-compact">
                <span className="info-value">{contact.location}</span>
              </div>
            </div>
          )}

          {/* Department/Seniority (Apollo contacts) */}
          {contact.department && (
            <div className="info-item-compact">
              <Briefcase className="info-icon-compact" />
              <div className="info-content-compact">
                <span className="info-value">
                  {contact.department}
                  {contact.seniority && ` • ${contact.seniority}`}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Networking Context (if applicable) */}
        {contact.source === 'networking' && (contact.networking_context?.event_name || contact.networking_context?.date_met) && (
          <div className="networking-context-compact">
            <h4 className="networking-title">Networking Context</h4>
            {contact.networking_context.event_name && (
              <p className="networking-detail">
                <strong>Event:</strong> {contact.networking_context.event_name}
              </p>
            )}
            {contact.networking_context.date_met && (
              <p className="networking-detail">
                <strong>Date Met:</strong> {new Date(contact.networking_context.date_met).toLocaleDateString()}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // For expanded mode - used in full profile
  return (
    <div className="contact-info-expanded">
      <h3 className="info-section-title">Contact Information</h3>

      <div className="info-items-expanded">
        {/* Emails */}
        <div className="info-item-expanded">
          <div className="info-icon-wrapper">
            <Mail className="info-icon-expanded" />
          </div>
          <div className="info-content-expanded">
            <span className="info-label">Email</span>
            {emailEntries.length > 0 ? emailEntries.map((e, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <LabelPill label={e.label} />
                <a href={`mailto:${e.value}`} className="info-value-link">{e.value}</a>
                {i === 0 && getEmailStatusBadge()}
              </div>
            )) : (
              <span className="info-value-unavailable">Not available</span>
            )}
          </div>
        </div>

        {/* Phones */}
        <div className="info-item-expanded">
          <div className="info-icon-wrapper">
            <Phone className="info-icon-expanded" />
          </div>
          <div className="info-content-expanded">
            <span className="info-label">Phone</span>
            {phoneEntries.length > 0 ? phoneEntries.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <LabelPill label={p.label} />
                <a href={`tel:${p.value}`} className="info-value-link">{p.value}</a>
              </div>
            )) : (
              <span className="info-value-unavailable">Not available</span>
            )}
          </div>
        </div>

        {/* LinkedIn */}
        <div className="info-item-expanded">
          <div className="info-icon-wrapper">
            <Linkedin className="info-icon-expanded" />
          </div>
          <div className="info-content-expanded">
            <span className="info-label">LinkedIn</span>
            {contact.linkedin_url ? (
              <a
                href={contact.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="info-value-link"
              >
                View Profile →
              </a>
            ) : (
              <span className="info-value-unavailable">Not available</span>
            )}
          </div>
        </div>

        {/* Address */}
        <div className="info-item-expanded">
          <div className="info-icon-wrapper">
            <MapPin className="info-icon-expanded" />
          </div>
          <div className="info-content-expanded">
            <span className="info-label">Address</span>
            {contact.address ? (
              <span className="info-value">{contact.address}</span>
            ) : (
              <span className="info-value-unavailable">Not available</span>
            )}
          </div>
        </div>

        {/* Website */}
        <div className="info-item-expanded">
          <div className="info-icon-wrapper">
            <Globe className="info-icon-expanded" />
          </div>
          <div className="info-content-expanded">
            <span className="info-label">Website</span>
            {contact.website ? (
              <a
                href={contact.website}
                target="_blank"
                rel="noopener noreferrer"
                className="info-value-link"
              >
                {contact.website}
              </a>
            ) : (
              <span className="info-value-unavailable">Not available</span>
            )}
          </div>
        </div>

        {/* Location */}
        {contact.location && (
          <div className="info-item-expanded">
            <div className="info-icon-wrapper">
              <MapPin className="info-icon-expanded" />
            </div>
            <div className="info-content-expanded">
              <span className="info-label">Location</span>
              <span className="info-value">{contact.location}</span>
            </div>
          </div>
        )}
      </div>

      {/* Networking Context (expanded) */}
      {contact.source === 'networking' && (contact.networking_context?.event_name || contact.networking_context?.date_met) && (
        <div className="networking-context-expanded">
          <h4 className="networking-title-expanded">Networking Context</h4>
          <div className="networking-details-expanded">
            {contact.networking_context.event_name && (
              <div className="networking-item-expanded">
                <span className="networking-label">Event Name</span>
                <span className="networking-value">{contact.networking_context.event_name}</span>
              </div>
            )}
            {contact.networking_context.date_met && (
              <div className="networking-item-expanded">
                <span className="networking-label">Date Met</span>
                <span className="networking-value">
                  {new Date(contact.networking_context.date_met).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
