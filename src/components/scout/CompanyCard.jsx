import { useState, useRef } from 'react';
import { Building2, TrendingUp, Calendar, DollarSign, Globe, Linkedin, Phone, Award, CheckCircle, XCircle, Users } from 'lucide-react';
import WebsitePreviewModal from './WebsitePreviewModal';
import CompanyLogo from './CompanyLogo';

export default function CompanyCard({ company, onSwipe }) {
  const [dragStart, setDragStart] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewTitle, setPreviewTitle] = useState('');
  const cardRef = useRef(null);

  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e) => {
    if (!isDragging || !dragStart) return;

    const deltaX = e.clientX - dragStart.x;
    const deltaY = e.clientY - dragStart.y;
    setDragOffset({ x: deltaX, y: deltaY });
  };

  const handleMouseUp = () => {
    if (!isDragging) return;

    // If dragged far enough (>150px), trigger swipe
    if (Math.abs(dragOffset.x) > 150) {
      const direction = dragOffset.x > 0 ? 'right' : 'left';
      onSwipe(direction);
    }

    // Reset
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
    const deltaX = touch.clientX - dragStart.x;
    const deltaY = touch.clientY - dragStart.y;
    setDragOffset({ x: deltaX, y: deltaY });
  };

  const handleTouchEnd = () => {
    handleMouseUp();
  };

  const handleOpenPreview = (url, title) => {
    // Check if mobile device
    const isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|Windows Phone/i.test(navigator.userAgent);

    // On mobile, always open in new tab for better UX
    // Use anchor element approach which is more reliable on mobile
    if (isMobile) {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      return;
    }

    // If URL is HTTP (not HTTPS), open directly in new tab
    // because browsers block HTTP iframes in HTTPS pages
    if (url.toLowerCase().startsWith('http://')) {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      return;
    }

    // For HTTPS URLs on desktop, show preview modal
    setPreviewUrl(url);
    setPreviewTitle(title);
    setShowPreview(true);
  };

  const handleClosePreview = () => {
    setShowPreview(false);
    setPreviewUrl('');
    setPreviewTitle('');
  };

  const rotation = dragOffset.x * 0.05; // Subtle tilt effect
  const opacity = 1 - Math.abs(dragOffset.x) / 400;

  // Calculate lead score badge
  const leadScore = company.fit_score || 0;
  const getScoreBadge = (score) => {
    if (score >= 80) return { label: 'High Priority', color: 'green' };
    if (score >= 50) return { label: 'Good Match', color: 'blue' };
    return { label: 'Needs Review', color: 'gray' };
  };

  const scoreBadge = getScoreBadge(leadScore);

  return (
    <div className="relative">
      {/* Swipe Indicators (Behind Card) */}
      <div className="absolute inset-0 flex items-center justify-between px-8 pointer-events-none z-0">
        <div
          className={`transition-all duration-200 ${
            dragOffset.x < -50 ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
          }`}
        >
          <div className="bg-red-500 text-white rounded-full p-6 shadow-2xl">
            <XCircle className="w-16 h-16" strokeWidth={2.5} />
          </div>
        </div>
        <div
          className={`transition-all duration-200 ${
            dragOffset.x > 50 ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
          }`}
        >
          <div className="bg-green-500 text-white rounded-full p-6 shadow-2xl">
            <CheckCircle className="w-16 h-16" strokeWidth={2.5} />
          </div>
        </div>
      </div>

      {/* Company Card */}
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
        {/* Card Content */}
        <div className="card-content">
          {/* Company Header */}
          <div className="company-header">
            {/* Company Logo - Robust multi-source fallback */}
            <CompanyLogo company={company} size="default" />

            {/* Company Name */}
            <div className="company-info">
              <h2 className="company-name">
                {company.name}
              </h2>
            </div>
          </div>

          {/* Company Stats Grid */}
          <div className="stats-grid">
            <div className="stat-item">
              <div className="stat-icon">
                <Building2 className="w-5 h-5 text-gray-500" />
              </div>
              <div className="stat-content">
                <p className="stat-label">Industry</p>
                <p className="stat-value">{company.industry || 'Not specified'}</p>
              </div>
            </div>

            <div className="stat-item">
              <div className="stat-icon">
                <Users className="w-5 h-5 text-gray-500" />
              </div>
              <div className="stat-content">
                <p className="stat-label">Employees</p>
                <p className="stat-value">{company.employee_count || company.company_size || 'Not available'}</p>
              </div>
            </div>

            <div className="stat-item">
              <div className="stat-icon">
                <DollarSign className="w-5 h-5 text-gray-500" />
              </div>
              <div className="stat-content">
                <p className="stat-label">Revenue</p>
                <p className="stat-value">{company.revenue || 'Not available'}</p>
              </div>
            </div>

            <div className="stat-item">
              <div className="stat-icon">
                <Calendar className="w-5 h-5 text-gray-500" />
              </div>
              <div className="stat-content">
                <p className="stat-label">Founded</p>
                <p className="stat-value">{company.founded_year || 'Not available'}</p>
              </div>
            </div>
          </div>

          {/* Quick Links */}
          <div className="quick-links">
            {company.website_url && (
              <button
                className="quick-link website"
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenPreview(company.website_url, `${company.name} - Website`);
                }}
              >
                <Globe className="w-4 h-4" />
                <span>Visit Website</span>
              </button>
            )}
            {company.linkedin_url && (
              <button
                className="quick-link linkedin"
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenPreview(company.linkedin_url, `${company.name} - LinkedIn`);
                }}
              >
                <Linkedin className="w-4 h-4" />
                <span>LinkedIn</span>
              </button>
            )}
          </div>

          {/* Action Buttons */}
          <div className="action-buttons">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSwipe('left');
              }}
              className="action-btn reject"
            >
              <XCircle className="w-5 h-5" />
              <span>Not a Match</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSwipe('right');
              }}
              className="action-btn accept"
            >
              <CheckCircle className="w-5 h-5" />
              <span>This is a Match</span>
            </button>
          </div>
        </div>

        {/* Status Section - Bottom */}
        <div className="card-status-section">
          <div className="status-score-section">
            <Award className="w-5 h-5" style={{ color: scoreBadge.color === 'green' ? '#10b981' : scoreBadge.color === 'blue' ? '#3b82f6' : '#6b7280' }} />
            <div>
              <p className="status-label">Lead Score</p>
              <p className="status-score">
                {leadScore} <span className="status-score-max">/ 100</span>
              </p>
            </div>
          </div>

          <div className={`status-badge status-badge-${scoreBadge.color}`}>
            {scoreBadge.label}
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

      {/* Website Preview Modal */}
      {showPreview && (
        <WebsitePreviewModal
          url={previewUrl}
          title={previewTitle}
          onClose={handleClosePreview}
        />
      )}
    </div>
  );
}
