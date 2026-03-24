/**
 * RELATIONSHIP ARC
 *
 * Horizontal progress indicator showing where the contact sits in the
 * relationship journey:  Stranger → Known → Trusted → Advocate
 *
 * Maps from the contact's relationship_state field.
 */

import { useT } from '../../theme/ThemeContext';
import { COLORS } from '../../constants/colors';

const ARC_STEPS = [
  { label: 'Stranger', states: [null, 'unaware']          },
  { label: 'Known',    states: ['aware', 'engaged']        },
  { label: 'Trusted',  states: ['warm', 'trusted']         },
  { label: 'Advocate', states: ['advocate', 'strategic_partner'] },
];

function getArcIndex(relationshipState) {
  if (!relationshipState) return 0;
  const normalized = relationshipState.toLowerCase();
  for (let i = ARC_STEPS.length - 1; i >= 0; i--) {
    if (ARC_STEPS[i].states.includes(normalized)) return i;
  }
  return 0;
}

export default function RelationshipArc({ contact }) {
  const T = useT();
  const currentIdx = getArcIndex(contact?.relationship_state);

  return (
    <div style={{ padding: '12px 0' }}>
      <div style={{
        fontSize: 10,
        fontWeight: 600,
        color: T.textFaint,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: 8,
      }}>
        Relationship arc
      </div>

      {/* Step labels */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {ARC_STEPS.map((step, idx) => {
          const isActive = idx === currentIdx;
          const isPast = idx < currentIdx;
          const isLast = idx === ARC_STEPS.length - 1;

          return (
            <div key={step.label} style={{ display: 'flex', alignItems: 'center', flex: isLast ? 0 : 1 }}>
              {/* Step dot + label */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: (isActive || isPast) ? COLORS.BARRY : COLORS.NEUTRAL,
                  border: isActive ? `2px solid ${COLORS.BARRY}` : 'none',
                  flexShrink: 0,
                  transition: 'background 0.3s',
                }} />
                <span style={{
                  fontSize: 9,
                  fontWeight: isActive ? 700 : 500,
                  color: (isActive || isPast) ? COLORS.BARRY : T.textFaint,
                  whiteSpace: 'nowrap',
                }}>
                  {step.label}
                  {isActive && ' ✓'}
                </span>
              </div>

              {/* Connector line */}
              {!isLast && (
                <div style={{
                  flex: 1,
                  height: 2,
                  background: isPast ? COLORS.BARRY : T.border,
                  margin: '0 4px',
                  marginBottom: 13, // align with dots
                  transition: 'background 0.3s',
                }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
