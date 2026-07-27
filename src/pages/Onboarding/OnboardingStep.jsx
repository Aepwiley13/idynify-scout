import { ASSETS, BRAND } from '../../theme/tokens';
import { useT } from '../../theme/ThemeContext';

export default function OnboardingStep({ step, totalSteps = 6, children }) {
  const T = useT();

  return (
    <div style={{
      minHeight: '100vh',
      background: T.appBg,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Progress dots */}
      <div style={{
        position: 'absolute',
        top: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 8,
      }}>
        {Array.from({ length: totalSteps }, (_, i) => (
          <div key={i} style={{
            width: i + 1 === step ? 24 : 8,
            height: 8,
            borderRadius: 4,
            background: i + 1 <= step ? T.accent : T.border2,
            transition: 'all 0.3s ease',
          }} />
        ))}
      </div>

      {/* Barry avatar (matches BarryChat.jsx pattern) */}
      <div style={{
        width: 80,
        height: 80,
        borderRadius: '50%',
        overflow: 'hidden',
        background: `linear-gradient(135deg,${BRAND.pink},${T.cyan || BRAND.cyan})`,
        border: `2px solid ${(T.cyan || BRAND.cyan)}50`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: `0 0 40px ${(T.cyan || BRAND.cyan)}50`,
        marginBottom: 24,
        flexShrink: 0,
      }}>
        <img
          src={ASSETS.barryAvatar}
          alt="Barry"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '🐻'; }}
        />
      </div>

      {/* Step content */}
      <div style={{
        maxWidth: 520,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
      }}>
        {children}
      </div>
    </div>
  );
}
