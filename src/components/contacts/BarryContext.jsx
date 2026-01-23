import { useState } from 'react';
import { ChevronDown, ChevronUp, Loader } from 'lucide-react';
import './BarryContext.css';

export default function BarryContext({
  barryContext,
  mode = 'preview',
  onViewFullProfile,
  loading = false
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Loading state
  if (loading) {
    return (
      <div className="barry-context-card">
        <div className="barry-header">
          <h3 className="barry-title">Context by Barry</h3>
          <div className="barry-source-badge">
            <span>Source: Barry</span>
          </div>
        </div>
        <div className="barry-loading">
          <Loader className="w-8 h-8 spinner" />
          <p>Barry is preparing contextual intelligence...</p>
        </div>
      </div>
    );
  }

  // No context available
  if (!barryContext) {
    return null;
  }

  // Preview mode (for snapshot)
  if (mode === 'preview') {
    return (
      <div className="barry-context-card barry-preview">
        <div className="barry-header">
          <h3 className="barry-title">Context by Barry</h3>
          <button
            className="barry-expand-toggle"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
        </div>

        {isExpanded && (
          <div className="barry-content-preview">
            {/* Who You're Meeting */}
            <div className="barry-section-preview">
              <h4 className="barry-section-title-preview">Who you're meeting</h4>
              <p className="barry-text">{barryContext.whoYoureMeeting}</p>
            </div>

            {/* What Usually Matters (2-3 bullets only) */}
            {barryContext.whatRoleCaresAbout && barryContext.whatRoleCaresAbout.length > 0 && (
              <div className="barry-section-preview">
                <h4 className="barry-section-title-preview">What usually matters</h4>
                <ul className="barry-bullet-list-preview">
                  {barryContext.whatRoleCaresAbout.slice(0, 3).map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* View Full Profile CTA */}
            {onViewFullProfile && (
              <button
                className="barry-view-full-link"
                onClick={onViewFullProfile}
              >
                View Full Context →
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // Full mode (for profile page)
  return (
    <div className="barry-context-card barry-full">
      <div className="barry-header">
        <h3 className="barry-title">Context by Barry</h3>
        <div className="barry-source-badge">
          <span>Source: Barry</span>
        </div>
      </div>

      <div className="barry-content-full">
        {/* 1. Who You're Meeting */}
        <div className="barry-section">
          <h4 className="barry-section-title">Who You're Meeting</h4>
          <p className="barry-intro-text">{barryContext.whoYoureMeeting}</p>
        </div>

        {/* 2. What This Role Usually Cares About */}
        {barryContext.whatRoleCaresAbout && barryContext.whatRoleCaresAbout.length > 0 && (
          <div className="barry-section">
            <h4 className="barry-section-title">What This Role Usually Cares About</h4>
            <ul className="barry-bullet-list">
              {barryContext.whatRoleCaresAbout.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 3. What This Company Appears Focused On Right Now */}
        {barryContext.whatCompanyFocusedOn && barryContext.whatCompanyFocusedOn.length > 0 && (
          <div className="barry-section">
            <h4 className="barry-section-title">What This Company Appears Focused On Right Now</h4>
            <ul className="barry-bullet-list">
              {barryContext.whatCompanyFocusedOn.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 4. Ways a Conversation Could Naturally Begin */}
        {barryContext.conversationStarters && barryContext.conversationStarters.length > 0 && (
          <div className="barry-section">
            <h4 className="barry-section-title">Ways a Conversation Could Naturally Begin</h4>
            <ul className="barry-conversation-starters">
              {barryContext.conversationStarters.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 5. Calm Reframe */}
        {barryContext.calmReframe && (
          <div className="barry-section barry-reframe">
            <p className="barry-reframe-text">{barryContext.calmReframe}</p>
          </div>
        )}
      </div>
    </div>
  );
}
