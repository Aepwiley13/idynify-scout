import { Calendar } from 'lucide-react';

/**
 * NumericRangeFilter — reusable dual-input range component for ICP post-fetch filters.
 * First use: company age (foundedAgeRange). Future use: any numeric ICP attribute.
 *
 * Props:
 *   label        — section heading (e.g. "Company Age")
 *   unit         — value unit label (e.g. "years")
 *   minValue     — current min (e.g. minAge), or null/undefined if not set
 *   maxValue     — current max (e.g. maxAge), or null/undefined if not set
 *   helperText   — function(minValue, maxValue) => string, shown below inputs
 *   presets      — array of { label, minValue, maxValue } quick-select buttons
 *   onChange     — function(minValue, maxValue) called on any change; null clears a bound
 *   onClear      — function() called when the user clears the entire filter
 */
export default function NumericRangeFilter({
  label,
  unit,
  minValue,
  maxValue,
  helperText,
  presets = [],
  onChange,
  onClear
}) {
  const hasValue = (minValue !== null && minValue !== undefined) ||
                   (maxValue !== null && maxValue !== undefined);

  function handleMinChange(e) {
    const raw = e.target.value;
    const parsed = raw === '' ? null : parseInt(raw, 10);
    if (raw !== '' && (isNaN(parsed) || parsed < 0)) return;
    onChange(parsed, maxValue ?? null);
  }

  function handleMaxChange(e) {
    const raw = e.target.value;
    const parsed = raw === '' ? null : parseInt(raw, 10);
    if (raw !== '' && (isNaN(parsed) || parsed < 0)) return;
    onChange(minValue ?? null, parsed);
  }

  function handlePreset(preset) {
    onChange(preset.minValue ?? null, preset.maxValue ?? null);
  }

  const helper = helperText ? helperText(minValue, maxValue) : null;

  return (
    <div className="setting-section numeric-range-filter">
      <div className="section-header">
        <div className="section-title-group">
          <Calendar className="section-icon" />
          <h3>{label}</h3>
        </div>
        {hasValue && (
          <button onClick={onClear} className="clear-filter-btn" type="button">
            Clear
          </button>
        )}
      </div>
      <p className="section-description">
        Filter companies by {label.toLowerCase()}. Leave blank to include all.
      </p>

      {presets.length > 0 && (
        <div className="range-presets">
          {presets.map(preset => {
            const active =
              (preset.minValue ?? null) === (minValue ?? null) &&
              (preset.maxValue ?? null) === (maxValue ?? null);
            return (
              <button
                key={preset.label}
                type="button"
                className={`range-preset-btn ${active ? 'active' : ''}`}
                onClick={() => handlePreset(preset)}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="range-inputs">
        <div className="range-input-group">
          <label className="range-label">Min {unit}</label>
          <input
            type="number"
            min="0"
            placeholder="Any"
            value={minValue ?? ''}
            onChange={handleMinChange}
            className="range-input"
          />
        </div>
        <span className="range-separator">—</span>
        <div className="range-input-group">
          <label className="range-label">Max {unit}</label>
          <input
            type="number"
            min="0"
            placeholder="Any"
            value={maxValue ?? ''}
            onChange={handleMaxChange}
            className="range-input"
          />
        </div>
      </div>

      {helper && hasValue && (
        <p className="range-helper-text">{helper}</p>
      )}
    </div>
  );
}
