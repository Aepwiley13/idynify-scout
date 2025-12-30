import { useState, useRef } from 'react';
import { Building2, TrendingUp, Calendar, DollarSign, Globe, Linkedin, Phone, Award, CheckCircle, XCircle } from 'lucide-react';

export default function CompanyCard({ company, onSwipe }) {
  const [dragStart, setDragStart] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
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
            {/* Logo Placeholder */}
            <div className="company-logo-placeholder">
              <Building2 className="w-8 h-8 text-gray-400" />
            </div>

            {/* Company Name & Domain */}
            <div className="company-info">
              <h2 className="company-name">
                {company.name}
              </h2>
              {company.domain && (
                <a
                  href={`https://${company.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="company-domain"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Globe className="w-4 h-4" />
                  {company.domain}
                </a>
              )}
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

            {company.phone && (
              <div className="stat-item">
                <div className="stat-icon">
                  <Phone className="w-5 h-5 text-gray-500" />
                </div>
                <div className="stat-content">
                  <p className="stat-label">Phone</p>
                  <p className="stat-value">{company.phone}</p>
                </div>
              </div>
            )}
          </div>

          {/* Quick Links */}
          <div className="quick-links">
            {company.website_url && (
              <a
                href={company.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="quick-link website"
                onClick={(e) => e.stopPropagation()}
              >
                <Globe className="w-4 h-4" />
                <span>Visit Website</span>
              </a>
            )}
            {company.linkedin_url && (
              <a
                href={company.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="quick-link linkedin"
                onClick={(e) => e.stopPropagation()}
              >
                <Linkedin className="w-4 h-4" />
                <span>LinkedIn</span>
              </a>
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
    </div>
  );
}
