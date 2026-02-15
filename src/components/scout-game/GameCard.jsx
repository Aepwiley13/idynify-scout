import { useState } from 'react';
import { Building2, User, Briefcase, Loader, AlertCircle } from 'lucide-react';
import { buildAutoIntent } from '../../utils/buildAutoIntent';
import GameIntentChip from './GameIntentChip';

/**
 * GameCard — Individual game card displaying company + contact + pre-loaded messages.
 *
 * Layout (top to bottom):
 *   1. Company name + ICP score badge
 *   2. Contact name + title
 *   3. Intent chip (tappable for override)
 *   4. Message preview area (loading / error / 3 strategies)
 *   5. Defer button (secondary action)
 *
 * Fallbacks per discovery Section 2B and G3:
 *   - Missing title: "Contact at {company}"
 *   - Missing industry: omit industry line
 *   - Missing score: hide badge
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

  const companyName = company?.name || contact?.company_name || 'Unknown Company';
  const contactName = contact
    ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown Contact'
    : null;
  const contactTitle = contact?.title || contact?.current_position_title || null;
  const industry = company?.industry || contact?.company_industry || null;
  const fitScore = company?.fit_score || null;
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
          <Building2 className="w-4 h-4" />
          <span className="game-card-company">{companyName}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="game-card">
      {/* Header: Company + Score */}
      <div className="game-card-header">
        <div className="game-card-company-row">
          <Building2 className="w-4 h-4" />
          <span className="game-card-company">{companyName}</span>
          {industry && <span className="game-card-industry">{industry}</span>}
        </div>
        {fitScore !== null && (
          <span className={`game-card-score ${fitScore >= 80 ? 'score-high' : fitScore >= 60 ? 'score-mid' : 'score-low'}`}>
            {fitScore}
          </span>
        )}
      </div>

      {/* Contact info */}
      {contact && (
        <div className="game-card-contact">
          <User className="w-4 h-4" />
          <span className="game-card-contact-name">{contactName}</span>
          {contactTitle && (
            <>
              <Briefcase className="w-3 h-3" />
              <span className="game-card-contact-title">{contactTitle}</span>
            </>
          )}
        </div>
      )}

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
