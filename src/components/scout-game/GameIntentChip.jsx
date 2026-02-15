import { useState } from 'react';
import { ChevronDown, ChevronUp, Check } from 'lucide-react';
import { SESSION_MODES, SESSION_MODE_LIST } from '../../utils/buildAutoIntent';

/**
 * GameIntentChip — Displays auto-intent as a compact chip. Tappable for override.
 *
 * Default: compact chip showing session mode label.
 * Expanded: editable text + quick session mode swap buttons.
 *
 * Per G4: Override is optional, never required. Auto-intent fires without this.
 */
export default function GameIntentChip({ intent, sessionMode, onOverride }) {
  const [expanded, setExpanded] = useState(false);
  const [editText, setEditText] = useState('');

  const mode = SESSION_MODES[sessionMode];
  const modeLabel = mode?.label || 'Custom';

  const handleExpand = () => {
    setExpanded(true);
    setEditText(intent);
  };

  const handleCollapse = () => {
    setExpanded(false);
  };

  const handleApply = () => {
    if (editText.trim()) {
      onOverride(editText.trim());
    }
    setExpanded(false);
  };

  const handleModeSwap = (newModeId) => {
    // Quick-swap to a different session mode's intent template
    // The parent will reconstruct the full intent with card data
    onOverride(newModeId);
    setExpanded(false);
  };

  if (!expanded) {
    return (
      <button className="game-intent-chip" onClick={handleExpand}>
        <span className="intent-chip-label">{modeLabel}</span>
        <ChevronDown className="w-3 h-3" />
      </button>
    );
  }

  return (
    <div className="game-intent-expanded">
      <div className="intent-expanded-header">
        <span>Override Intent</span>
        <button className="intent-collapse-btn" onClick={handleCollapse}>
          <ChevronUp className="w-4 h-4" />
        </button>
      </div>

      <textarea
        className="intent-edit-input"
        value={editText}
        onChange={(e) => setEditText(e.target.value)}
        rows={2}
        placeholder="Describe what you want to accomplish..."
      />

      <div className="intent-mode-swaps">
        {SESSION_MODE_LIST.map((m) => (
          <button
            key={m.id}
            className={`intent-mode-swap-btn ${m.id === sessionMode ? 'active' : ''}`}
            onClick={() => handleModeSwap(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <button className="intent-apply-btn" onClick={handleApply}>
        <Check className="w-4 h-4" />
        Apply
      </button>
    </div>
  );
}
