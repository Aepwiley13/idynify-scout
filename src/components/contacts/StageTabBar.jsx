/**
 * STAGE TAB BAR
 *
 * Persistent stage navigation across the top of the contact profile.
 * Active stage is highlighted. Completed stages show a green dot.
 * Clicking a non-active stage enters "preview mode" — no Firestore writes,
 * no Barry auto-call. The Action column renders a template with a
 * "Generate Recommendation →" CTA instead of live output.
 */

import { STAGE_MAP } from '../../constants/stageSystem';
import { useT } from '../../theme/ThemeContext';

const PIPELINE_STAGES = ['scout', 'hunter', 'sniper', 'basecamp', 'reinforcements'];

export default function StageTabBar({ contact, previewStage, onPreviewChange }) {
  const T = useT();
  const activeStage = contact?.stage || 'scout';
  const activeIdx = PIPELINE_STAGES.indexOf(activeStage);
  // Which tab is visually "selected" — preview wins if set, otherwise active stage
  const selectedTab = previewStage || activeStage;

  // On a phone the five labels are wider than the screen ("Reinforcements"
  // alone is ~100px). The row scrolls sideways on its own instead of pushing
  // the whole page wider; on wider screens the tabs still share the row.
  return (
    <div data-testid="stage-tab-bar" style={{
      display: 'flex',
      gap: 4,
      padding: '4px',
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 12,
      minWidth: 0,
      overflowX: 'auto',
      scrollbarWidth: 'none',
    }}>
      {PIPELINE_STAGES.map((stageId, idx) => {
        const stage = STAGE_MAP[stageId];
        if (!stage) return null;

        const isSelected = stageId === selectedTab;
        const isCurrentStage = stageId === activeStage;
        const isCompleted = idx < activeIdx;
        const isPreviewing = isSelected && !isCurrentStage;

        return (
          <button
            key={stageId}
            onClick={() => {
              if (stageId === activeStage) {
                onPreviewChange(null); // clicking active stage clears preview
              } else {
                onPreviewChange(stageId === previewStage ? null : stageId);
              }
            }}
            title={isPreviewing ? `Preview mode — click "Generate" to get Barry's take` : stage.description}
            style={{
              flex: '1 0 auto',
              whiteSpace: 'nowrap',
              padding: '8px 6px',
              minHeight: 44,
              borderRadius: 9,
              border: 'none',
              background: isSelected ? `${stage.color}18` : 'transparent',
              color: isSelected ? stage.color : T.textMuted,
              fontSize: 12,
              fontWeight: isSelected ? 700 : 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              transition: 'all 0.15s',
              outline: isSelected ? `1.5px solid ${stage.color}50` : 'none',
              outlineOffset: -1,
            }}
          >
            {/* Completion dot (green) for passed stages */}
            {isCompleted && (
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: '#22c55e',
                flexShrink: 0,
              }} />
            )}
            {/* Active stage dot (stage color) */}
            {isCurrentStage && (
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: stage.color,
                flexShrink: 0,
              }} />
            )}
            {stage.label}
            {/* Preview indicator */}
            {isPreviewing && (
              <span style={{
                fontSize: 9,
                fontWeight: 600,
                color: stage.color,
                background: `${stage.color}18`,
                borderRadius: 4,
                padding: '1px 4px',
                marginLeft: 2,
              }}>
                preview
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
