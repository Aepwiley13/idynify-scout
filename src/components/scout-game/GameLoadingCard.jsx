import { Loader, Building2, User } from 'lucide-react';

/**
 * GameLoadingCard — Skeleton card displayed while Barry generates messages.
 * Shows company and contact info (already available) with a loading indicator
 * for the message area.
 */
export default function GameLoadingCard({ companyName, contactName }) {
  return (
    <div className="game-card game-loading-card">
      <div className="game-card-header">
        <div className="game-card-company-row">
          <Building2 className="w-4 h-4" />
          <span className="game-card-company">{companyName || 'Loading...'}</span>
        </div>
      </div>

      {contactName && (
        <div className="game-card-contact">
          <User className="w-4 h-4" />
          <span className="game-card-contact-name">{contactName}</span>
        </div>
      )}

      <div className="game-loading-card-body">
        <Loader className="w-5 h-5 spin" />
        <span>Barry is preparing messages...</span>
      </div>

      <div className="game-loading-card-skeleton">
        <div className="skeleton-line skeleton-line-long" />
        <div className="skeleton-line skeleton-line-medium" />
        <div className="skeleton-line skeleton-line-short" />
      </div>
    </div>
  );
}
