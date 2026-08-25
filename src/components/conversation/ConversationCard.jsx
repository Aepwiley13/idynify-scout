import { BRAND } from '../../theme/tokens';
import './ConversationCard.css';

const KIND_META = {
  angles:   { accent: BRAND.cyan,   label: 'Angles' },
  choice:   { accent: BRAND.purple, label: null },
  proposal: { accent: BRAND.pink,   label: 'Proposal' },
  website:  { accent: BRAND.cyan,   label: 'Website' },
  result:   { accent: BRAND.cyan,   label: 'Results' },
};

export default function ConversationCard({ kind, label, children, className = '' }) {
  const meta = KIND_META[kind] || {};
  const accent = meta.accent || BRAND.cyan;
  const displayLabel = label ?? meta.label;

  return (
    <div
      className={`conversation-card ${className}`}
      style={{ '--card-accent': accent }}
    >
      {displayLabel && (
        <span className="conversation-card-label" style={{ color: accent }}>
          {displayLabel}
        </span>
      )}
      <div className="conversation-card-body">
        {children}
      </div>
    </div>
  );
}
