import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { X, User, Mail, Phone, Building2, Briefcase, Linkedin, Save, Loader, AlertCircle, Edit3, CheckCircle, MapPin, Award, Target, Globe, Twitter, Sparkles, Smartphone, ArrowLeft, Send } from 'lucide-react';
import { downloadVCard } from '../../utils/vcard';
import FindContact from './FindContact';
import './ContactDetailModal.css';

export default function ContactDetailModal({ contact, onClose, onUpdate }) {
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isEnrichmentMode, setIsEnrichmentMode] = useState(false);
  const [error, setError] = useState(null);
  const [enrichSuccess, setEnrichSuccess] = useState(false);
  const [formData, setFormData] = useState({
    name: contact.name || '',
    email: contact.email || '',
    phone: contact.phone || '',
    company: contact.company_name || contact.company || '',
    title: contact.title || '',
    linkedin_url: contact.linkedin_url || '',
    event_name: contact.networking_context?.event_name || '',
    date_met: contact.networking_context?.date_met || ''
  });

  // Scroll detection states
  const [isScrolled, setIsScrolled] = useState(false);
  const [hasScroll, setHasScroll] = useState(false);
  const contentRef = useRef(null);
  const headerRef = useRef(null);

  const isManualOrNetworking = contact.source === 'manual' || contact.source === 'networking';

  // Scroll detection effect
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) return;

    const handleScroll = () => {
      const scrollTop = contentElement.scrollTop;
      const scrollHeight = contentElement.scrollHeight;
      const clientHeight = contentElement.clientHeight;

      // Add 'scrolled' class to header when scrolled down
      setIsScrolled(scrollTop > 10);

      // Show scroll gradient if there's more content below
      setHasScroll(scrollHeight > clientHeight && scrollTop < scrollHeight - clientHeight - 20);
    };

    // Initial check
    handleScroll();

    // Add scroll listener
    contentElement.addEventListener('scroll', handleScroll);

    // Recheck on content changes
    const observer = new ResizeObserver(handleScroll);
    observer.observe(contentElement);

    return () => {
      contentElement.removeEventListener('scroll', handleScroll);
      observer.disconnect();
    };
  }, [contact, isEditing]);

  function handleChange(e) {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  }

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);

      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');

      // Validate required fields
      if (!formData.name.trim()) {
        setError('Name is required');
        setSaving(false);
        return;
      }

      // Validate email format if provided
      if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
        setError('Invalid email format');
        setSaving(false);
        return;
      }

      // Validate LinkedIn URL format if provided
      if (formData.linkedin_url && !formData.linkedin_url.includes('linkedin.com')) {
        setError('Invalid LinkedIn URL');
        setSaving(false);
        return;
      }

      // Update contact in Firestore
      const contactRef = doc(db, 'users', user.uid, 'contacts', contact.id);

      const updateData = {
        name: formData.name.trim(),
        email: formData.email.trim() || null,
        phone: formData.phone.trim() || null,
        title: formData.title.trim() || null,
        linkedin_url: formData.linkedin_url.trim() || null,
        updated_at: new Date().toISOString()
      };

      // Update company if it's a manual/networking contact
      if (isManualOrNetworking) {
        updateData.company_name = formData.company.trim() || null;
      }

      // Update networking context if it's a networking contact
      if (contact.source === 'networking') {
        updateData.networking_context = {
          event_name: formData.event_name.trim() || null,
          date_met: formData.date_met || null
        };
      }

      await updateDoc(contactRef, updateData);

      console.log('✅ Contact updated successfully');

      // Notify parent component
      if (onUpdate) {
        onUpdate({ ...contact, ...updateData });
      }

      setIsEditing(false);
      setSaving(false);

    } catch (err) {
      console.error('Error updating contact:', err);
      setError('Failed to update contact. Please try again.');
      setSaving(false);
    }
  }

  function handleEnrichContact() {
    // Enter enrichment mode to show Find Contact flow
    setIsEnrichmentMode(true);
    setError(null);
  }

  function handleEnrichmentComplete(contacts) {
    // Contact was enriched via Find Contact
    if (contacts && contacts.length > 0) {
      setEnrichSuccess(true);
      setTimeout(() => setEnrichSuccess(false), 3000);

      // Notify parent and exit enrichment mode
      if (onUpdate) {
        onUpdate(contacts[0]);
      }
      setIsEnrichmentMode(false);
    }
  }

  function handleCancelEnrichment() {
    setIsEnrichmentMode(false);
    setError(null);
  }

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

  // Check if contact is NOT enriched (missing key fields)
  function isContactNotEnriched() {
    const hasWorkEmail = !!(contact.work_email || contact.email);
    const hasPhone = !!(contact.phone || contact.phone_mobile || contact.phone_direct || contact.phone_work);
    const hasLinkedIn = !!contact.linkedin_url;
    const hasCompany = !!(contact.company_name || contact.company);

    // Contact is NOT enriched if ANY of these fields are missing
    return !hasWorkEmail || !hasPhone || !hasLinkedIn || !hasCompany;
  }

  return (
    <div className="contact-detail-overlay" onClick={onClose}>
      <div className="contact-detail-container" onClick={(e) => e.stopPropagation()}>
        {/* Close Button - Absolute positioned over header */}
        <button className="close-button-absolute" onClick={onClose}>
          <X className="w-6 h-6" />
        </button>

        {/* Hero Photo Header */}
        {!isEnrichmentMode && (
          <div
            className="contact-hero-header"
            style={{
              backgroundImage: `url(${contact.photo_url || '/barry.png'})`,
            }}
          >
            {/* Gradient Overlay */}
            <div className="contact-hero-overlay">
              {/* Back button for enrichment mode */}
              {isEnrichmentMode && (
                <button
                  onClick={handleCancelEnrichment}
                  className="back-button-hero"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              )}

              {/* Contact Info Overlay */}
              <div className="contact-hero-content">
                {/* Source Badge */}
                <div className="hero-source-badge">
                  {getSourceBadge()}
                </div>

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
        )}

        {/* Enrichment Mode Header (Simple) */}
        {isEnrichmentMode && (
          <div ref={headerRef} className="contact-detail-header-simple">
            <div className="header-content">
              <button
                onClick={handleCancelEnrichment}
                className="back-button"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="header-text">
                <h2 className="contact-detail-name">Enrich Contact</h2>
                <p className="contact-detail-title">Search for updated contact information</p>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        {isEnrichmentMode ? (
          <div style={{ padding: '1.5rem' }}>
            <FindContact
              onContactAdded={handleEnrichmentComplete}
              onCancel={handleCancelEnrichment}
              initialSearchParams={{
                name: contact.name || '',
                company_name: contact.company_name || contact.company || ''
              }}
            />
          </div>
        ) : (
          <div ref={contentRef} className={`contact-detail-content ${hasScroll ? 'has-scroll' : ''}`}>
          {/* Quick Actions Bar */}
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
            {!isEditing && isContactNotEnriched() && (
              <button
                className="action-button action-button-enrich"
                onClick={handleEnrichContact}
              >
                <Sparkles className="w-5 h-5" />
                <span>Enrich</span>
              </button>
            )}
            {!isEditing && isManualOrNetworking && (
              <button
                className="action-button action-button-outline"
                onClick={() => setIsEditing(true)}
              >
                <Edit3 className="w-5 h-5" />
                <span>Edit</span>
              </button>
            )}
          </div>

          {error && (
            <div className="error-banner">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Banner */}
          {enrichSuccess && (
            <div className="success-banner">
              <CheckCircle className="w-5 h-5" />
              <span>Contact enriched successfully! Email and phone updated.</span>
            </div>
          )}

          {/* Editable Contact Information */}
          <div className="detail-section">
            <h3 className="section-title">Contact Information</h3>

            <div className="contact-info-grid">
              {/* Name */}
              <div className="info-field">
                <label className="info-label">
                  <User className="w-4 h-4" />
                  <span>Full Name</span>
                </label>
                {isEditing ? (
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    className="info-input"
                    placeholder="Enter full name"
                    required
                  />
                ) : (
                  <p className="info-value">{contact.name || 'Not provided'}</p>
                )}
              </div>

              {/* Email */}
              <div className="info-field">
                <label className="info-label">
                  <Mail className="w-4 h-4" />
                  <span>Email</span>
                </label>
                {isEditing ? (
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    className="info-input"
                    placeholder="email@example.com"
                  />
                ) : (
                  <p className="info-value">{contact.email || 'Not provided'}</p>
                )}
              </div>

              {/* Phone */}
              <div className="info-field">
                <label className="info-label">
                  <Phone className="w-4 h-4" />
                  <span>Phone</span>
                </label>
                {isEditing ? (
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    className="info-input"
                    placeholder="+1 (555) 123-4567"
                  />
                ) : (
                  <p className="info-value">{contact.phone || 'Not provided'}</p>
                )}
              </div>

              {/* Company */}
              <div className="info-field">
                <label className="info-label">
                  <Building2 className="w-4 h-4" />
                  <span>Company</span>
                </label>
                {isEditing && isManualOrNetworking ? (
                  <input
                    type="text"
                    name="company"
                    value={formData.company}
                    onChange={handleChange}
                    className="info-input"
                    placeholder="Company name"
                  />
                ) : (
                  <p className="info-value">{contact.company_name || contact.company || 'Not provided'}</p>
                )}
              </div>

              {/* Title */}
              <div className="info-field">
                <label className="info-label">
                  <Briefcase className="w-4 h-4" />
                  <span>Job Title</span>
                </label>
                {isEditing ? (
                  <input
                    type="text"
                    name="title"
                    value={formData.title}
                    onChange={handleChange}
                    className="info-input"
                    placeholder="e.g. Director of Sales"
                  />
                ) : (
                  <p className="info-value">{contact.title || 'Not provided'}</p>
                )}
              </div>

              {/* LinkedIn */}
              <div className="info-field">
                <label className="info-label">
                  <Linkedin className="w-4 h-4" />
                  <span>LinkedIn</span>
                </label>
                {isEditing ? (
                  <input
                    type="url"
                    name="linkedin_url"
                    value={formData.linkedin_url}
                    onChange={handleChange}
                    className="info-input"
                    placeholder="https://linkedin.com/in/username"
                  />
                ) : contact.linkedin_url ? (
                  <a
                    href={contact.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="info-link"
                  >
                    View Profile
                  </a>
                ) : (
                  <p className="info-value">Not provided</p>
                )}
              </div>
            </div>
          </div>

          {/* Professional Snapshot (Apollo contacts only) */}
          {contact.source === 'apollo' && contact.department && (
            <div className="detail-section professional-snapshot-section">
              <div className="section-header-with-icon">
                <Building2 className="section-icon" />
                <h3 className="section-title">Professional Snapshot</h3>
              </div>
              <div className="snapshot-grid-contact">
                <div className="snapshot-item-contact">
                  <Briefcase className="snapshot-icon" />
                  <div>
                    <p className="snapshot-label">Current Role</p>
                    <p className="snapshot-value">{contact.title || 'Not available'}</p>
                  </div>
                </div>

                {contact.department && (
                  <div className="snapshot-item-contact">
                    <Building2 className="snapshot-icon" />
                    <div>
                      <p className="snapshot-label">Department</p>
                      <p className="snapshot-value">{contact.department}</p>
                    </div>
                  </div>
                )}

                {contact.seniority && (
                  <div className="snapshot-item-contact">
                    <Award className="snapshot-icon" />
                    <div>
                      <p className="snapshot-label">Seniority Level</p>
                      <p className="snapshot-value">{contact.seniority}</p>
                    </div>
                  </div>
                )}

                {contact.location && (
                  <div className="snapshot-item-contact">
                    <MapPin className="snapshot-icon" />
                    <div>
                      <p className="snapshot-label">Location</p>
                      <p className="snapshot-value">{contact.location}</p>
                    </div>
                  </div>
                )}

                <div className="snapshot-item-contact">
                  <Building2 className="snapshot-icon" />
                  <div>
                    <p className="snapshot-label">Company</p>
                    <p className="snapshot-value">{contact.company_name || 'Not available'}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Decision-Making Context (Apollo contacts only) */}
          {contact.source === 'apollo' && (
            <div className="detail-section decision-context-section">
              <div className="section-header-with-icon">
                <Target className="section-icon" />
                <h3 className="section-title">Decision-Making Context</h3>
              </div>
              <div className="decision-likelihood-container">
                <div className="decision-likelihood-label">
                  <Award className="w-4 h-4" />
                  <span>Decision Maker Likelihood</span>
                </div>
                <div className={`decision-likelihood-badge ${(contact.seniority || 'entry').toLowerCase()}`}>
                  {contact.seniority === 'c_suite' ? 'High / Decision Maker' :
                   contact.seniority === 'senior' ? 'Medium / Influencer' :
                   'Low / Influencer'}
                </div>
              </div>
            </div>
          )}

          {/* Public Presence Signals (Apollo contacts only) */}
          {contact.source === 'apollo' && (
            <div className="detail-section public-presence-section">
              <div className="section-header-with-icon">
                <Globe className="section-icon" />
                <h3 className="section-title">Public Presence Signals</h3>
                <span className="ai-badge">AI</span>
              </div>
              <div className="presence-signals-list">
                {contact.linkedin_url && (
                  <div className="presence-signal-item">
                    <Linkedin className="presence-icon linkedin" />
                    <span className="presence-text">LinkedIn: Profile Found</span>
                  </div>
                )}
                <div className="presence-signal-item">
                  <Twitter className="presence-icon twitter" />
                  <span className="presence-text">Twitter/X: Analyzing...</span>
                </div>
                <div className="presence-signal-item">
                  <Globe className="presence-icon globe" />
                  <span className="presence-text">Thought Leadership: Analyzing...</span>
                </div>
              </div>
            </div>
          )}

          {/* Networking Context (if applicable) */}
          {contact.source === 'networking' && (
            <div className="detail-section">
              <h3 className="section-title">Networking Context</h3>
              <div className="contact-info-grid">
                <div className="info-field">
                  <label className="info-label">
                    <span>Event Name</span>
                  </label>
                  {isEditing ? (
                    <input
                      type="text"
                      name="event_name"
                      value={formData.event_name}
                      onChange={handleChange}
                      className="info-input"
                      placeholder="e.g. Tech Conference 2026"
                    />
                  ) : (
                    <p className="info-value">{contact.networking_context?.event_name || 'Not provided'}</p>
                  )}
                </div>

                <div className="info-field">
                  <label className="info-label">
                    <span>Date Met</span>
                  </label>
                  {isEditing ? (
                    <input
                      type="date"
                      name="date_met"
                      value={formData.date_met}
                      onChange={handleChange}
                      className="info-input"
                    />
                  ) : (
                    <p className="info-value">
                      {contact.networking_context?.date_met
                        ? new Date(contact.networking_context.date_met).toLocaleDateString()
                        : 'Not provided'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="detail-section metadata-section">
            <h3 className="section-title">Details</h3>
            <div className="metadata-grid">
              <div className="metadata-item">
                <span className="metadata-label">Source</span>
                <span className="metadata-value">{contact.source || 'Unknown'}</span>
              </div>
              <div className="metadata-item">
                <span className="metadata-label">Added</span>
                <span className="metadata-value">
                  {contact.addedAt || contact.saved_at
                    ? new Date(contact.addedAt || contact.saved_at).toLocaleDateString()
                    : 'Unknown'}
                </span>
              </div>
              {contact.updated_at && (
                <div className="metadata-item">
                  <span className="metadata-label">Last Updated</span>
                  <span className="metadata-value">
                    {new Date(contact.updated_at).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          {isEditing && (
            <div className="contact-actions">
              <button
                className="btn-cancel"
                onClick={() => {
                  setIsEditing(false);
                  setError(null);
                  // Reset form data
                  setFormData({
                    name: contact.name || '',
                    email: contact.email || '',
                    phone: contact.phone || '',
                    company: contact.company_name || contact.company || '',
                    title: contact.title || '',
                    linkedin_url: contact.linkedin_url || '',
                    event_name: contact.networking_context?.event_name || '',
                    date_met: contact.networking_context?.date_met || ''
                  });
                }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="btn-save"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <Loader className="w-5 h-5 spinner" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-5 h-5" />
                    <span>Save Changes</span>
                  </>
                )}
              </button>
            </div>
          )}
          </div>
        )}
      </div>
    </div>
  );
}
