import { useState, useRef } from 'react';
import { Globe, Linkedin, CheckCircle, XCircle, ChevronLeft, ChevronRight, User, Clock } from 'lucide-react';

export default function PersonCard({ person, company, onSwipe, barryText }) {
  const [dragStart, setDragStart] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [photoError, setPhotoError] = useState(false);
  const cardRef = useRef(null);

  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e) => {
    if (!isDragging || !dragStart) return;
    setDragOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => {
    if (!isDragging) return;
    if (Math.abs(dragOffset.x) > 150) {
      onSwipe(dragOffset.x > 0 ? 'right' : 'left');
    }
    setIsDragging(false);
    setDragStart(null);
    setDragOffset({ x: 0, y: 0 });
  };

  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    setIsDragging(true);
    setDragStart({ x: touch.clientX, y: touch.clientY });
  };

  const handleTouchMove = (e) => {
    if (!isDragging || !dragStart) return;
    const touch = e.touches[0];
    setDragOffset({ x: touch.clientX - dragStart.x, y: touch.clientY - dragStart.y });
  };

  const handleTouchEnd = () => {
    handleMouseUp();
  };

  const openLink = (url) => {
    const isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|Windows Phone/i.test(navigator.userAgent);
    if (isMobile || url.toLowerCase().startsWith('http://')) {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const rotation = dragOffset.x * 0.05;
  const opacity = 1 - Math.abs(dragOffset.x) / 400;

  const employeeDisplay = company.employee_count > 0
    ? company.employee_count.toLocaleString()
    : 'N/A';

  const locationDisplay = person.city && person.state
    ? `${person.city}, ${person.state}`
    : person.city || person.state || 'N/A';

  const showPhoto = person.photo_url && !photoError;

  return (
    <div className="relative">
      {/* Swipe Indicators (Behind Card) */}
      <div className="absolute inset-0 flex items-center justify-between px-8 pointer-events-none z-0">
        <div className={`transition-all duration-200 ${dragOffset.x < -50 ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`}>
          <div className="bg-red-500 text-white rounded-full p-6 shadow-2xl">
            <XCircle className="w-16 h-16" strokeWidth={2.5} />
          </div>
        </div>
        <div className={`transition-all duration-200 ${dragOffset.x > 50 ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`}>
          <div className="bg-green-500 text-white rounded-full p-6 shadow-2xl">
            <CheckCircle className="w-16 h-16" strokeWidth={2.5} />
          </div>
        </div>
      </div>

      {/* Person Card */}
      <div
        ref={cardRef}
        className="enterprise-company-card relative z-10"
        style={{
          transform: `translateX(${dragOffset.x}px) translateY(${dragOffset.y * 0.1}px) rotate(${rotation}deg)`,
          opacity: opacity,
          transition: isDragging ? 'none' : 'transform 0.3s ease-out, opacity 0.3s ease-out'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="card-content">
          {/* Photo */}
          <div className="person-photo-container">
            {showPhoto ? (
              <img
                src={person.photo_url}
                alt={person.name}
                className="person-photo"
                onError={() => setPhotoError(true)}
              />
            ) : (
              <div className="person-photo-placeholder">
                <User className="w-10 h-10" />
              </div>
            )}
          </div>

          {/* Barry ICP Validation */}
          {barryText && (
            <p className="barry-validation-text">{barryText}</p>
          )}

          {/* Name + Title */}
          <h2 className="company-name">{person.name}</h2>
          <p className="person-title-text">{person.title || 'No title available'}</p>

          {/* Metadata Grid (2x2) */}
          <div className="company-meta-grid">
            <div className="meta-cell">
              <div className="meta-label">COMPANY</div>
              <div className="meta-value">{company.name}</div>
            </div>
            <div className="meta-cell">
              <div className="meta-label">INDUSTRY</div>
              <div className="meta-value">{company.industry || 'N/A'}</div>
            </div>
            <div className="meta-cell">
              <div className="meta-label">EMPLOYEES</div>
              <div className="meta-value">{employeeDisplay}</div>
            </div>
            <div className="meta-cell">
              <div className="meta-label">LOCATION</div>
              <div className="meta-value">{locationDisplay}</div>
            </div>
          </div>

          {/* Website & LinkedIn Buttons */}
          <div className="company-link-buttons">
            {company.website_url ? (
              <button
                className="link-btn website-btn"
                onClick={(e) => { e.stopPropagation(); openLink(company.website_url); }}
              >
                <Globe className="w-4 h-4" />
                <span>Visit Website</span>
              </button>
            ) : (
              <div className="link-btn website-btn disabled">
                <Globe className="w-4 h-4" />
                <span>No Website</span>
              </div>
            )}
            {person.linkedin_url ? (
              <button
                className="link-btn linkedin-btn"
                onClick={(e) => { e.stopPropagation(); openLink(person.linkedin_url); }}
              >
                <Linkedin className="w-4 h-4" />
                <span>View LinkedIn</span>
              </button>
            ) : (
              <div className="link-btn linkedin-btn disabled">
                <Linkedin className="w-4 h-4" />
                <span>No LinkedIn</span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="action-buttons">
            <button
              onClick={(e) => { e.stopPropagation(); onSwipe('left'); }}
              className="action-btn reject"
            >
              <XCircle className="w-5 h-5" />
              <span>Not a Match</span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onSwipe('right'); }}
              className="action-btn accept"
            >
              <CheckCircle className="w-5 h-5" />
              <span>This is a Match</span>
            </button>
          </div>

          {/* Skip for Today — small, below buttons */}
          <div className="person-skip-container">
            <button
              onClick={(e) => { e.stopPropagation(); onSwipe('skip'); }}
              className="person-skip-btn"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Skip for Today</span>
            </button>
          </div>
        </div>

        {/* Swipe Affordance Arrows */}
        <div className="swipe-affordance-arrows">
          <div className="swipe-arrow swipe-arrow-left">
            <ChevronLeft className="w-6 h-6" strokeWidth={2} />
          </div>
          <div className="swipe-arrow swipe-arrow-right">
            <ChevronRight className="w-6 h-6" strokeWidth={2} />
          </div>
        </div>

        {/* Swipe Hint */}
        <div className="swipe-hint">
          <div className="hint-text">
            <span className="hint-desktop">Drag card left or right, or use the buttons above</span>
            <span className="hint-mobile">Swipe left or right to review</span>
          </div>
        </div>
      </div>
    </div>
  );
}
