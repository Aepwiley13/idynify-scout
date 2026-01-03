import { useState, useEffect, useRef } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { X, User, Mail, Phone, Building2, Briefcase, Linkedin, Save, Loader, AlertCircle, Edit3, CheckCircle } from 'lucide-react';
import './ContactDetailModal.css';

export default function ContactDetailModal({ contact, onClose, onUpdate }) {
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
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

  function getSourceBadge() {
    const badges = {
      manual: { icon: '✍️', text: 'Manual', color: '#1e40af', bg: '#eff6ff' },
      networking: { icon: '🤝', text: 'Networking', color: '#7e22ce', bg: '#faf5ff' },
      apollo: { icon: '🔍', text: 'Apollo', color: '#15803d', bg: '#f0fdf4' }
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
    <div className="contact-detail-overlay" onClick={onClose}>
      <div className="contact-detail-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div ref={headerRef} className={`contact-detail-header ${isScrolled ? 'scrolled' : ''}`}>
          <div className="header-content">
            <div className="contact-avatar">
              {contact.photo_url ? (
                <img src={contact.photo_url} alt={contact.name} />
              ) : (
                <User className="w-8 h-8 text-gray-400" />
              )}
            </div>
            <div className="header-text">
              <h2 className="contact-detail-name">{contact.name || 'Unknown Contact'}</h2>
              <p className="contact-detail-title">{contact.title || 'No title specified'}</p>
              <div style={{ marginTop: '0.5rem' }}>
                {getSourceBadge()}
              </div>
            </div>
          </div>
          <button className="close-button" onClick={onClose}>
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div ref={contentRef} className={`contact-detail-content ${hasScroll ? 'has-scroll' : ''}`}>
          {error && (
            <div className="error-banner">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          )}

          {/* Editable Contact Information */}
          <div className="detail-section">
            <div className="section-header-with-action">
              <h3 className="section-title">Contact Information</h3>
              {!isEditing && isManualOrNetworking && (
                <button
                  className="edit-button"
                  onClick={() => setIsEditing(true)}
                >
                  <Edit3 className="w-4 h-4" />
                  <span>Edit</span>
                </button>
              )}
            </div>

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
      </div>
    </div>
  );
}
