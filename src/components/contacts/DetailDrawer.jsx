import { useState } from 'react';
import { ChevronDown, ChevronUp, Mail, Phone, Linkedin, MapPin, Building2, Calendar, StickyNote, FileText } from 'lucide-react';
import ContactInfo from './ContactInfo';
import './DetailDrawer.css';

export default function DetailDrawer({ contact }) {
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

          {/* Notes Placeholder */}
          <div className="drawer-section">
            <h3 className="drawer-section-title">Notes</h3>
            <div className="drawer-placeholder">
              <StickyNote className="placeholder-icon" />
              <p className="placeholder-text">No notes yet</p>
            </div>
          </div>

          {/* Events Placeholder */}
          <div className="drawer-section">
            <h3 className="drawer-section-title">Events</h3>
            <div className="drawer-placeholder">
              <Calendar className="placeholder-icon" />
              <p className="placeholder-text">No events tracked</p>
            </div>
          </div>

          {/* History Placeholder */}
          <div className="drawer-section">
            <h3 className="drawer-section-title">History</h3>
            <div className="drawer-placeholder">
              <FileText className="placeholder-icon" />
              <p className="placeholder-text">No activity history</p>
            </div>
          </div>

          {/* Metadata */}
          {(contact.source || contact.addedAt || contact.updated_at) && (
            <div className="drawer-section">
              <h3 className="drawer-section-title">Metadata</h3>
              <div className="drawer-metadata">
                {contact.source && (
                  <div className="metadata-item">
                    <span className="metadata-label">Source</span>
                    <span className="metadata-value">{contact.source}</span>
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
