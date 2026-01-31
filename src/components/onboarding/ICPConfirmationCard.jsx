import { Building2, Users, MapPin, Briefcase, Check, RefreshCw, AlertTriangle, Target, Tag } from 'lucide-react';
import './ICPConfirmationCard.css';

export default function ICPConfirmationCard({ icp, onConfirm, onRefine }) {
  const hasIndustries = icp?.industries && icp.industries.length > 0;
  const hasSizes = icp?.companySizes && icp.companySizes.length > 0;
  const hasLocations = icp?.locations && (icp.locations === 'nationwide' || icp.locations.length > 0);
  const hasTitles = icp?.targetTitles && icp.targetTitles.length > 0;
  const hasLookalike = icp?.lookalikeSeed?.name;
  const hasKeywords = icp?.companyKeywords && icp.companyKeywords.length > 0;
  const searchStrategy = icp?.searchStrategy || 'industry_only';

  const locationDisplay = icp?.locations === 'nationwide'
    ? 'Nationwide (All US)'
    : Array.isArray(icp?.locations)
      ? icp.locations.slice(0, 5).join(', ') + (icp.locations.length > 5 ? ` +${icp.locations.length - 5} more` : '')
      : 'Not specified';

  const confidencePercent = Math.round((icp?.confidenceScore || 0.8) * 100);
  const isLowConfidence = confidencePercent < 60;
  const isMediumConfidence = confidencePercent >= 60 && confidencePercent < 80;

  // Determine confidence level for styling
  const confidenceLevel = isLowConfidence ? 'low' : isMediumConfidence ? 'medium' : 'high';

  // Determine strategy badge text
  const strategyDisplay = searchStrategy === 'lookalike'
    ? 'Lookalike'
    : searchStrategy === 'hybrid'
      ? 'Hybrid'
      : 'Industry';

  return (
    <div className={`icp-confirmation-card ${isLowConfidence ? 'low-confidence' : ''}`}>
      {/* Low Confidence Warning */}
      {isLowConfidence && (
        <div className="confidence-warning">
          <AlertTriangle className="w-4 h-4" />
          <div className="warning-content">
            <p className="warning-title">I may be missing context</p>
            <p className="warning-text">
              {!hasIndustries
                ? "I couldn't identify a specific industry from your description. Consider refining to help me find better matches."
                : "Some details were unclear. You may want to refine your description for better results."}
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="card-header">
        <h3>Here's what I understood</h3>
        <div className="header-badges">
          {hasLookalike && (
            <div className="strategy-badge strategy-lookalike">
              Strategy: {strategyDisplay}
            </div>
          )}
          <div className={`confidence-badge confidence-${confidenceLevel}`}>
            {confidencePercent}% confident
          </div>
        </div>
      </div>

      {/* ICP Details */}
      <div className="icp-details">
        {/* Lookalike Seed (NEW - shown first when present) */}
        {hasLookalike && (
          <div className="detail-row lookalike-row">
            <div className="detail-icon">
              <Target className="w-4 h-4" />
            </div>
            <div className="detail-content">
              <span className="detail-label">Based on Company</span>
              <span className="detail-value detail-value-highlight">
                {icp.lookalikeSeed.name}
              </span>
              <span className="detail-subtext">
                Finding similar companies in your target market
              </span>
            </div>
          </div>
        )}

        {/* Industries */}
        <div className={`detail-row ${hasIndustries ? '' : 'missing'}`}>
          <div className="detail-icon">
            <Building2 className="w-4 h-4" />
          </div>
          <div className="detail-content">
            <span className="detail-label">Industries</span>
            <span className="detail-value">
              {hasIndustries ? icp.industries.join(', ') : 'Not specified'}
            </span>
          </div>
        </div>

        {/* Company Keywords (if present) */}
        {hasKeywords && (
          <div className="detail-row">
            <div className="detail-icon">
              <Tag className="w-4 h-4" />
            </div>
            <div className="detail-content">
              <span className="detail-label">Company Type</span>
              <span className="detail-value">
                {icp.companyKeywords.join(', ')}
              </span>
            </div>
          </div>
        )}

        {/* Company Size */}
        <div className={`detail-row ${hasSizes ? '' : 'optional'}`}>
          <div className="detail-icon">
            <Users className="w-4 h-4" />
          </div>
          <div className="detail-content">
            <span className="detail-label">Company Size</span>
            <span className="detail-value">
              {hasSizes ? icp.companySizes.join(', ') + ' employees' : 'Any size'}
            </span>
          </div>
        </div>

        {/* Location */}
        <div className={`detail-row ${hasLocations ? '' : 'optional'}`}>
          <div className="detail-icon">
            <MapPin className="w-4 h-4" />
          </div>
          <div className="detail-content">
            <span className="detail-label">Location</span>
            <span className="detail-value">{locationDisplay}</span>
          </div>
        </div>

        {/* Target Titles */}
        <div className={`detail-row ${hasTitles ? '' : 'optional'}`}>
          <div className="detail-icon">
            <Briefcase className="w-4 h-4" />
          </div>
          <div className="detail-content">
            <span className="detail-label">Target Contacts</span>
            <span className="detail-value">
              {hasTitles ? icp.targetTitles.join(', ') : 'Any role'}
            </span>
          </div>
        </div>
      </div>

      {/* Barry's Note */}
      <div className="barry-note">
        <p>
          {hasLookalike
            ? `I'll prioritize companies similar to ${icp.lookalikeSeed.name}. This gets you real ${hasKeywords ? icp.companyKeywords[0] + 's' : 'matches'}, not just any ${hasIndustries ? icp.industries[0].toLowerCase() : 'industry'} company.`
            : "I'll use this to find companies that match your ICP. You can always refine this later from your settings."
          }
        </p>
      </div>

      {/* Actions */}
      <div className="card-actions">
        <button onClick={onRefine} className="refine-btn">
          <RefreshCw className="w-4 h-4" />
          <span>Refine</span>
        </button>
        <button onClick={onConfirm} className="confirm-btn">
          <Check className="w-4 h-4" />
          <span>Looks Good</span>
        </button>
      </div>
    </div>
  );
}
