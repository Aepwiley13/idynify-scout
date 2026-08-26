import { useState } from 'react';
import { BRAND } from '../../theme/tokens';

export default function ChoiceChips({
  options = [],
  onSelect,
  allowFreeText = false,
  freeTextPlaceholder = 'Or type your own...',
  disabled = false,
  selected = null,
}) {
  const [freeText, setFreeText] = useState('');

  function handleChipClick(option) {
    if (disabled) return;
    onSelect?.(option.value ?? option.label);
  }

  function handleFreeTextSubmit(e) {
    if (e.key === 'Enter' && freeText.trim() && !disabled) {
      e.preventDefault();
      onSelect?.(freeText.trim());
      setFreeText('');
    }
  }

  return (
    <div className="choice-chips">
      <div className="choice-chips-row">
        {options.map((opt) => {
          const label = typeof opt === 'string' ? opt : opt.label;
          const value = typeof opt === 'string' ? opt : (opt.value ?? opt.label);
          const isSelected = selected === value;

          return (
            <button
              key={value}
              type="button"
              className="choice-chip"
              disabled={disabled}
              aria-pressed={isSelected}
              onClick={() => handleChipClick({ label, value })}
              style={{
                background: isSelected ? `${BRAND.purple}18` : 'transparent',
                borderColor: isSelected ? BRAND.purple : 'var(--chip-border, rgba(0,0,0,0.12))',
                color: isSelected ? BRAND.purple : 'inherit',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      {allowFreeText && (
        <input
          type="text"
          className="choice-chips-free"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          onKeyDown={handleFreeTextSubmit}
          placeholder={freeTextPlaceholder}
          disabled={disabled}
        />
      )}
    </div>
  );
}
