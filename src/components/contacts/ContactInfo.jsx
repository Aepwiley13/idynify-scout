import { Mail, Phone, Linkedin, MapPin, Building2, Briefcase } from 'lucide-react';
import './ContactInfo.css';

export default function ContactInfo({ contact, mode = 'compact' }) {
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
          {/* Email */}
          <div className="info-item-compact">
            <Mail className="info-icon-compact" />
            <div className="info-content-compact">
              {contact.email ? (
                <>
                  <a href={`mailto:${contact.email}`} className="info-value-link">
                    {contact.email}
                  </a>
                  {getEmailStatusBadge()}
                </>
              ) : (
                <span className="info-value-unavailable">Email not available</span>
              )}
            </div>
          </div>

          {/* Phone */}
          <div className="info-item-compact">
            <Phone className="info-icon-compact" />
            <div className="info-content-compact">
              {contact.phone ? (
                <a href={`tel:${contact.phone}`} className="info-value-link">
                  {contact.phone}
                </a>
              ) : (
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
        {/* Email */}
        <div className="info-item-expanded">
          <div className="info-icon-wrapper">
            <Mail className="info-icon-expanded" />
          </div>
          <div className="info-content-expanded">
            <span className="info-label">Email</span>
            {contact.email ? (
              <>
                <a href={`mailto:${contact.email}`} className="info-value-link">
                  {contact.email}
                </a>
                {getEmailStatusBadge()}
              </>
            ) : (
              <span className="info-value-unavailable">Not available</span>
            )}
          </div>
        </div>

        {/* Phone */}
        <div className="info-item-expanded">
          <div className="info-icon-wrapper">
            <Phone className="info-icon-expanded" />
          </div>
          <div className="info-content-expanded">
            <span className="info-label">Phone</span>
            {contact.phone ? (
              <a href={`tel:${contact.phone}`} className="info-value-link">
                {contact.phone}
              </a>
            ) : (
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
