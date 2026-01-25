import { useState } from 'react';
import { ChevronDown, ChevronUp, Mail, Phone, Linkedin, MapPin, Building2, Calendar } from 'lucide-react';
import StickyNotes from './StickyNotes';
import ActivityHistory from './ActivityHistory';
import './DetailDrawer.css';

export default function DetailDrawer({ contact, onUpdate }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="detail-drawer">
      {/* Subtle toggle control */}
      <button
        className="drawer-toggle"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <span className="drawer-toggle-text">
          {isOpen ? 'Hide details' : 'View details'}
        </span>
        {isOpen ? (
          <ChevronUp className="drawer-toggle-icon" />
        ) : (
          <ChevronDown className="drawer-toggle-icon" />
        )}
      </button>

      {/* Drawer content - only visible when open */}
      {isOpen && (
        <div className="drawer-content">
          {/* Full Contact Information */}
          <div className="drawer-section">
            <h3 className="drawer-section-title">Contact Information</h3>
            <div className="drawer-contact-grid">
              {contact.email && (
                <div className="drawer-item">
                  <Mail className="drawer-icon" />
                  <div>
                    <p className="drawer-label">Email</p>
                    <a href={`mailto:${contact.email}`} className="drawer-value">
                      {contact.email}
                    </a>
                    {contact.email_status && (
                      <span className={`email-status-badge ${contact.email_status}`}>
                        {contact.email_status === 'verified' && '✓ Verified'}
                        {contact.email_status === 'likely' && '~ Likely'}
                        {contact.email_status === 'unverified' && 'Unverified'}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {contact.phone && (
                <div className="drawer-item">
                  <Phone className="drawer-icon" />
                  <div>
                    <p className="drawer-label">Phone</p>
                    <a href={`tel:${contact.phone}`} className="drawer-value">
                      {contact.phone}
                    </a>
                  </div>
                </div>
              )}

              {contact.linkedin_url && (
                <div className="drawer-item">
                  <Linkedin className="drawer-icon" />
                  <div>
                    <p className="drawer-label">LinkedIn</p>
                    <a
                      href={contact.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="drawer-value"
                    >
                      View Profile →
                    </a>
                  </div>
                </div>
              )}

              {contact.location && (
                <div className="drawer-item">
                  <MapPin className="drawer-icon" />
                  <div>
                    <p className="drawer-label">Location</p>
                    <p className="drawer-value">{contact.location}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Company Context */}
          {contact.company_name && (
            <div className="drawer-section">
              <h3 className="drawer-section-title">Company Context</h3>
              <div className="drawer-item">
                <Building2 className="drawer-icon" />
                <div>
                  <p className="drawer-label">Company</p>
                  <p className="drawer-value">{contact.company_name}</p>
                  {contact.company_industry && (
                    <p className="drawer-sublabel">{contact.company_industry}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Sticky Notes */}
          <div className="drawer-section">
            <StickyNotes contact={contact} onUpdate={onUpdate} />
          </div>

          {/* Activity History */}
          <div className="drawer-section">
            <ActivityHistory contact={contact} />
          </div>

          {/* Metadata */}
          {(contact.source || contact.addedAt || contact.updated_at || contact.apollo_person_id) && (
            <div className="drawer-section">
              <h3 className="drawer-section-title">Metadata</h3>
              <div className="drawer-metadata">
                {contact.source && (
                  <div className="metadata-item">
                    <span className="metadata-label">Source</span>
                    <span className="metadata-value">{contact.source}</span>
                  </div>
                )}
                {contact.apollo_person_id && (
                  <div className="metadata-item">
                    <span className="metadata-label">Barry Contact ID</span>
                    <span className="metadata-value">{contact.apollo_person_id}</span>
                  </div>
                )}
                {(contact.addedAt || contact.saved_at) && (
                  <div className="metadata-item">
                    <span className="metadata-label">Added</span>
                    <span className="metadata-value">
                      {new Date(contact.addedAt || contact.saved_at).toLocaleDateString()}
                    </span>
                  </div>
                )}
                {contact.updated_at && (
                  <div className="metadata-item">
                    <span className="metadata-label">Last updated</span>
                    <span className="metadata-value">
                      {new Date(contact.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
