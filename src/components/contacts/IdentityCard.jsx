import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, RefreshCw, Loader, Mail, Phone, Building2 } from 'lucide-react';
import './IdentityCard.css';

/**
 * Check if a photo URL is a placeholder/default image (not a real profile photo).
 * Mirrors the backend isValidLinkedInPhoto logic.
 */
function isPlaceholderPhoto(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  const placeholders = [
    'ghost-person', 'ghost_person', 'default-avatar',
    'no-photo', 'placeholder', '/static.licdn.com/sc/h/', 'data:image'
  ];
  return placeholders.some(p => lower.includes(p));
}

export default function IdentityCard({
  contact,
  onRefreshPhoto,
  photoRefreshLoading,
  photoRefreshError
}) {
  const [imgBroken, setImgBroken] = useState(false);
  const navigate = useNavigate();

  const hasLinkedIn = !!contact.linkedin_url;
  const hasNameAndCompany = !!contact.name && !!contact.company_name;
  const hasRealPhoto = !!contact.photo_url && !isPlaceholderPhoto(contact.photo_url) && !imgBroken;
  const hasCustomUpload = !!contact.photo_source && contact.photo_source === 'user_upload';

  // Show refresh button when:
  //   - Photo is missing/broken/placeholder
  //   - AND we have enough data to search (linkedin_url OR name+company)
  //   - AND no custom user-uploaded photo
  //   - AND not currently loading
  const canSearch = hasLinkedIn || hasNameAndCompany;
  const showRefreshButton = canSearch && !hasRealPhoto && !hasCustomUpload && !photoRefreshLoading;
  const showSpinner = photoRefreshLoading;

  return (
    <div className="identity-card">
      <div className="identity-photo-wrapper">
        <div className="identity-photo">
          {contact.photo_url && !isPlaceholderPhoto(contact.photo_url) && !imgBroken ? (
            <img
              src={contact.photo_url}
              alt={contact.name}
              onError={() => setImgBroken(true)}
            />
          ) : (
            <div className="photo-fallback">
              <User className="w-8 h-8" />
            </div>
          )}
        </div>
        {showRefreshButton && (
          <button
            className="refresh-photo-btn"
            onClick={onRefreshPhoto}
            title="Retry LinkedIn Photo"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
        {showSpinner && (
          <button className="refresh-photo-btn refreshing" disabled>
            <Loader className="w-3.5 h-3.5 refresh-spinner" />
          </button>
        )}
      </div>
      <div className="identity-info">
        <h1 className="identity-name">{contact.name || 'Unknown Contact'}</h1>
        <p className="identity-title">{contact.title || 'No title specified'}</p>
        {contact.company_id ? (
          <button
            className="identity-company identity-company-link"
            onClick={() => navigate(`/scout/company/${contact.company_id}`)}
          >
            <Building2 className="identity-contact-icon" />
            {contact.company_name || 'No company'}
          </button>
        ) : (
          <p className="identity-company">
            {contact.company_name && <Building2 className="identity-contact-icon" />}
            {contact.company_name || 'No company'}
          </p>
        )}
        {contact.email && (
          <a href={`mailto:${contact.email}`} className="identity-contact-row">
            <Mail className="identity-contact-icon" />
            <span>{contact.email}</span>
          </a>
        )}
        {contact.phone && (
          <a href={`tel:${contact.phone}`} className="identity-contact-row">
            <Phone className="identity-contact-icon" />
            <span>{contact.phone}</span>
          </a>
        )}
        {photoRefreshError && (
          <p className="photo-refresh-error">{photoRefreshError}</p>
        )}
      </div>
    </div>
  );
}
