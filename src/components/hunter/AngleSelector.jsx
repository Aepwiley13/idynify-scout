/**
 * AngleSelector — 4-angle tab selector for message drafts.
 *
 * Angles: Value Add, Direct Ask, Soft Reconnect, Pattern Interrupt.
 * Selecting an angle fires onSelect(angleId) so the parent loads
 * the angle's subject + message into EditableMessageField.
 *
 * The recommended angle (Barry's pick) is highlighted with a star.
 */

export default function AngleSelector({ angles, selectedAngle, recommendedAngle, onSelect }) {
  if (!angles || angles.length === 0) return null;

  return (
    <div className="as-tabs">
      {angles.map(angle => {
        const isSelected = selectedAngle === angle.id;
        const isRecommended = recommendedAngle === angle.id;

        return (
          <button
            key={angle.id}
            className={`as-tab ${isSelected ? 'as-tab--selected' : ''} ${isRecommended ? 'as-tab--recommended' : ''}`}
            onClick={() => onSelect(angle.id)}
            title={isRecommended ? "Barry's recommended angle" : undefined}
          >
            {isRecommended && <span className="as-star">★</span>}
            {angle.label}
          </button>
        );
      })}
    </div>
  );
}
