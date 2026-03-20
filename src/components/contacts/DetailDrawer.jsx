import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Mail, Phone, Linkedin, MapPin, Building2, Calendar, GitBranch, Users, ArrowRight } from 'lucide-react';
import { auth } from '../../firebase/config';
import { getContactReferralAnalytics } from '../../services/referralIntelligenceService';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import StickyNotes from './StickyNotes';
import './DetailDrawer.css';

export default function DetailDrawer({ contact, onUpdate }) {
  const [isOpen, setIsOpen] = useState(false);
  const [referralData, setReferralData] = useState(null);
  const [referralLoading, setReferralLoading] = useState(false);

  // Load referral analytics when drawer opens
  useEffect(() => {
    if (!isOpen || !contact?.id) return;
    const user = getEffectiveUser();
    if (!user) return;

    let cancelled = false;
    setReferralLoading(true);
    getContactReferralAnalytics(user.uid, contact.id).then(data => {
      if (!cancelled) {
        setReferralData(data);
        setReferralLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setReferralLoading(false);
    });
    return () => { cancelled = true; };
  }, [isOpen, contact?.id]);

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

          {/* Referral Intelligence */}
          <ReferralSection
            referralData={referralData}
            loading={referralLoading}
            contact={contact}
          />

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

// ─── Referral Intelligence Section ───────────────────────────────────────
function ReferralSection({ referralData, loading, contact }) {
  const hasReferralActivity = referralData && (
    referralData.referrals_sent_to_you > 0 ||
    referralData.referrals_you_sent_them > 0 ||
    (contact.referral_data?.referred_by_ids?.length > 0)
  );

  if (loading) {
    return (
      <div className="drawer-section">
        <h3 className="drawer-section-title">Referral Intelligence</h3>
        <p className="placeholder-text">Loading referral data...</p>
      </div>
    );
  }

  if (!hasReferralActivity) return null;

  const quality = referralData?.referral_quality;
  const qualityLabel = quality === 'high' ? 'Elite' : quality === 'medium' ? 'Strong' : quality === 'low' ? 'Active' : null;
  const qualityColor = quality === 'high' ? '#10b981' : quality === 'medium' ? '#f59e0b' : '#6b7280';

  return (
    <div className="drawer-section">
      <h3 className="drawer-section-title">Referral Intelligence</h3>

      {/* Referred By badge */}
      {contact.referral_data?.referred_by_ids?.length > 0 && (
        <div className="referral-badge referral-badge--referred-by">
          <GitBranch size={14} />
          <span>Referred by {contact.referral_data.referred_by_ids.length} contact{contact.referral_data.referred_by_ids.length > 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Referral Source stats */}
      {referralData?.is_referral_source && (
        <div className="referral-source-card">
          <div className="referral-source-header">
            <Users size={14} />
            <span>Referral Source</span>
            {qualityLabel && (
              <span className="referral-quality-badge" style={{ background: `${qualityColor}18`, color: qualityColor, border: `1px solid ${qualityColor}40` }}>
                {qualityLabel}
              </span>
            )}
          </div>
          <div className="referral-stats-grid">
            <div className="referral-stat">
              <span className="referral-stat-value">{referralData.referrals_sent_to_you}</span>
              <span className="referral-stat-label">Sent to you</span>
            </div>
            <div className="referral-stat">
              <span className="referral-stat-value">{referralData.referrals_converted}</span>
              <span className="referral-stat-label">Converted</span>
            </div>
            {referralData.conversion_rate !== null && (
              <div className="referral-stat">
                <span className="referral-stat-value">{referralData.conversion_rate}%</span>
                <span className="referral-stat-label">Conversion</span>
              </div>
            )}
            <div className="referral-stat">
              <span className="referral-stat-value">{referralData.referrals_you_sent_them}</span>
              <span className="referral-stat-label">You sent them</span>
            </div>
          </div>
          {referralData.reciprocal_balance > 0 && (
            <p className="referral-reciprocal-note">
              You owe {referralData.reciprocal_balance} referral{referralData.reciprocal_balance > 1 ? 's' : ''} back
            </p>
          )}
        </div>
      )}

      {/* Recent referrals list */}
      {referralData?.all_referrals?.length > 0 && (
        <div className="referral-history">
          <p className="drawer-label">Recent Referrals</p>
          {referralData.all_referrals.slice(0, 5).map(r => (
            <div key={r.id} className="referral-history-item">
              <ArrowRight size={12} className="referral-history-arrow" />
              <div>
                <span className="referral-history-name">
                  {r.type === 'received' ? r.to_contact_name : r.from_contact_name}
                </span>
                <span className="referral-history-meta">
                  {r.type === 'received' ? ' referred to you' : ' you referred'}
                  {r.status === 'converted' && ' — converted'}
                  {r.referral_date && ` · ${new Date(r.referral_date).toLocaleDateString()}`}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
