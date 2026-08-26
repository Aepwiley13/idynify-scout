/**
 * BarryResultSet — a `result_set` turn rendered inside the canonical thread.
 *
 * This is a TURN, not a screen. It has no composer, no history of its own, and
 * no route. It sits in the same thread as every other Barry message so the user
 * never leaves the conversation to make a selection.
 *
 * Results shown here are PROPOSALS. Nothing is saved by looking at them or by
 * selecting them — selection is UI state keyed by clientRef and nothing else.
 *
 * When the tab has been reloaded the underlying proposals are gone (they were
 * never persisted), so the turn renders as a plain historical statement rather
 * than pretending to still be actionable.
 */

import { useState } from 'react';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';
import './BarryStructuredTurn.css';

export default function BarryResultSet({ resultSet, onConfirmSelection, disabled = false, settled = null }) {
  const T = useT();
  const [selected, setSelected] = useState(() => new Set());

  // Proposals expired with the tab. Honest, static rendering.
  if (!resultSet) {
    return (
      <p className="bst-expired" style={{ color: T.textFaint }}>
        These results were from an earlier session and are no longer selectable.
        Ask me to search again and I&apos;ll pull a fresh set.
      </p>
    );
  }

  const { results } = resultSet;
  const allRefs = results.map(r => r.clientRef);
  const allSelected = selected.size === allRefs.length && allRefs.length > 0;

  function toggle(clientRef) {
    if (disabled || settled) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(clientRef)) next.delete(clientRef); else next.add(clientRef);
      return next;
    });
  }

  function toggleAll() {
    if (disabled || settled) return;
    setSelected(allSelected ? new Set() : new Set(allRefs));
  }

  if (settled) {
    return (
      <p className="bst-settled" style={{ color: T.textFaint }}>
        You picked {settled.count} of {results.length}.
      </p>
    );
  }

  return (
    <div className="bst">
      <div className="bst-toolbar">
        <button
          type="button"
          className="bst-linkbtn"
          onClick={toggleAll}
          disabled={disabled}
          style={{ color: BRAND.pink }}
        >
          {allSelected ? 'Clear selection' : `Select all ${results.length}`}
        </button>
        <span className="bst-count" style={{ color: T.textFaint }}>
          {selected.size} selected
        </span>
      </div>

      <ul className="bst-list" role="listbox" aria-multiselectable="true">
        {results.map((r) => {
          const isOn = selected.has(r.clientRef);
          return (
            <li key={r.clientRef}>
              <button
                type="button"
                role="option"
                aria-selected={isOn}
                onClick={() => toggle(r.clientRef)}
                disabled={disabled}
                className={`bst-row ${isOn ? 'is-on' : ''}`}
                style={{
                  borderColor: isOn ? BRAND.pink : T.border,
                  background: isOn ? `${BRAND.pink}12` : T.surface,
                  color: T.text,
                }}
              >
                <span className="bst-check" style={{ borderColor: isOn ? BRAND.pink : T.border2, background: isOn ? BRAND.pink : 'transparent' }}>
                  {isOn ? '✓' : ''}
                </span>
                <span className="bst-who">
                  <span className="bst-name">{r.name || 'Unnamed'}</span>
                  <span className="bst-meta" style={{ color: T.textFaint }}>
                    {[r.title, r.company_name].filter(Boolean).join(' · ') || 'No title or company'}
                  </span>
                </span>
                {/* Deliberately NOT showing email/phone: this is a proposal list,
                    and parading contact details before the user has chosen to act
                    on them implies we already own the record. */}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="bst-actions">
        <button
          type="button"
          className="bst-primary"
          disabled={disabled || selected.size === 0}
          onClick={() => onConfirmSelection?.(Array.from(selected))}
          style={{
            background: selected.size === 0 ? T.border : BRAND.pink,
            color: selected.size === 0 ? T.textFaint : '#fff',
            cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {selected.size === 0
            ? 'Pick the ones you want'
            : `Check these ${selected.size} against what I know`}
        </button>
      </div>
    </div>
  );
}
