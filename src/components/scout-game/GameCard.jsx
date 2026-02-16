import { useState } from 'react';
import { Building2, User, Briefcase, Loader, AlertCircle } from 'lucide-react';
import { buildAutoIntent } from '../../utils/buildAutoIntent';
import GameIntentChip from './GameIntentChip';

/**
 * GameCard — Individual game card displaying CONTACT as primary entity.
 *
 * PIVOTED LAYOUT (contact-centric, top to bottom):
 *   1. Contact photo (if available) + name + title
 *   2. Company name
 *   3. Intent chip (tappable for override)
 *   4. Message preview area (loading / error / 3 strategies)
 *   5. Defer button (secondary action)
 *
 * Fallbacks:
 *   - Missing name: use firstName + lastName, then "Contact"
 *   - Missing title: omit title line
 *   - Missing company: "Unknown Company"
 *   - No messages (loading): show spinner
 *   - No messages (error): show retry
 */
export default function GameCard({
  card,
  messages,
  sessionMode,
  isBackground = false,
  onDefer,
  onIntentOverride
}) {
  const { company, contact } = card;
  const [intentOverride, setIntentOverride] = useState(null);

  const companyName = company?.name || contact?.company_name || contact?.current_company_name || 'Unknown Company';
  const contactName = contact?.name
    || `${contact?.firstName || ''} ${contact?.lastName || ''}`.trim()
    || 'Unknown Contact';
  const contactTitle = contact?.title || contact?.current_position_title || null;
  const industry = company?.industry || contact?.company_industry || contact?.industry || null;
  const photoUrl = contact?.photo_url || null;
  const autoIntent = buildAutoIntent(contact || {}, company || {}, sessionMode);
  const displayIntent = intentOverride || autoIntent;

  const handleIntentOverride = (newIntent) => {
    setIntentOverride(newIntent);
    if (onIntentOverride) {
      onIntentOverride(card.id, newIntent);
    }
  };

  // Background cards just show a preview
  if (isBackground) {
    return (
      <div className="game-card game-card-bg">
        <div className="game-card-header">
          <User className="w-4 h-4" />
          <span className="game-card-company">{contactName}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="game-card">
      {/* Contact — Primary entity */}
      <div className="game-card-contact-hero">
        {photoUrl ? (
          <img src={photoUrl} alt={contactName} className="game-card-photo" />
        ) : (
          <div className="game-card-photo-placeholder">
            <User className="w-6 h-6" />
          </div>
        )}
        <div className="game-card-contact-info">
          <span className="game-card-contact-name">{contactName}</span>
          {contactTitle && (
            <span className="game-card-contact-title">{contactTitle}</span>
          )}
        </div>
      </div>

      {/* Company info */}
      <div className="game-card-company-row">
        <Building2 className="w-4 h-4" />
        <span className="game-card-company">{companyName}</span>
        {industry && <span className="game-card-industry">{industry}</span>}
      </div>

      {/* Intent chip */}
      <GameIntentChip
        intent={displayIntent}
        sessionMode={sessionMode}
        onOverride={handleIntentOverride}
      />

      {/* Message area */}
      <div className="game-card-messages">
        {messages === null && (
          <div className="game-card-loading">
            <Loader className="w-5 h-5 spin" />
            <span>Barry is preparing messages...</span>
          </div>
        )}

        {messages?.error && (
          <div className="game-card-error">
            <AlertCircle className="w-5 h-5" />
            <span>Failed to generate messages</span>
            <button className="game-card-retry-btn" onClick={messages.onRetry}>
              Retry
            </button>
          </div>
        )}

        {messages?.messages && (
          <div className="game-card-strategies">
            {messages.messages.slice(0, 3).map((msg, i) => (
              <div key={i} className="game-card-strategy-preview">
                <span className="strategy-label">{msg.label || msg.strategy}</span>
                <span className="strategy-subject">{msg.subject}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Defer action */}
      {onDefer && (
        <button className="game-card-defer-btn" onClick={onDefer}>
          Save for later
        </button>
      )}
    </div>
  );
}
