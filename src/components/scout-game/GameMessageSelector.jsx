import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/**
 * GameMessageSelector — 3-strategy message picker.
 *
 * Displays Barry's 3 message strategies as tappable cards.
 * Strategy order: always direct → warm → value.
 * First card (direct) is visually emphasized as default.
 *
 * G9: Each strategy card is a full-width touch target (>44px height).
 */
export default function GameMessageSelector({ messages, selectedStrategy, onSelect }) {
  const [expandedIdx, setExpandedIdx] = useState(null);

  if (!messages || messages.length === 0) return null;

  return (
    <div className="game-message-selector">
      <p className="game-message-selector-label">Pick a strategy</p>
      <div className="game-message-list">
        {messages.slice(0, 3).map((msg, i) => {
          const isSelected = selectedStrategy === i;
          const isExpanded = expandedIdx === i;
          const strategy = msg.label || msg.strategy || `Strategy ${i + 1}`;

          return (
            <button
              key={i}
              className={`game-message-option ${isSelected ? 'selected' : ''} ${i === 0 && selectedStrategy === null ? 'default-highlight' : ''}`}
              onClick={() => onSelect(i)}
            >
              <div className="game-message-option-header">
                <span className="game-message-strategy">{strategy}</span>
                <span className="game-message-subject">{msg.subject}</span>
                <button
                  className="game-message-expand-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedIdx(isExpanded ? null : i);
                  }}
                >
                  {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </div>

              {isExpanded && (
                <div className="game-message-option-body">
                  <p className="game-message-preview">
                    {msg.message?.split('\n').slice(0, 3).join('\n')}
                    {msg.message?.split('\n').length > 3 ? '...' : ''}
                  </p>
                  {msg.reasoning && (
                    <p className="game-message-reasoning">{msg.reasoning}</p>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
