/**
 * WithTheForce — Floating quick-access theme switcher.
 *
 * Fixed bottom-right on every page. Opens a compact panel showing all
 * themes. Clicking one applies it instantly. Closes on outside click.
 * Keyboard: Escape closes the panel.
 */
import { useState, useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { useT, useThemeCtx } from '../theme/ThemeContext';
import { THEMES } from '../theme/tokens';

export default function WithTheForce() {
  const T = useT();
  const { themeId, setThemeId } = useThemeCtx();
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const btnRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (
        panelRef.current && !panelRef.current.contains(e.target) &&
        btnRef.current && !btnRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const allThemes = Object.values(THEMES);
  const coreThemes = allThemes.filter(t => !t.starWars);
  const swThemes = allThemes.filter(t => t.starWars);

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      right: 24,
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: 10,
      pointerEvents: 'none',
    }}>
      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          style={{
            pointerEvents: 'all',
            width: 260,
            background: T.cardBg,
            border: `1px solid ${T.border2}`,
            borderRadius: 16,
            padding: '14px 14px 12px',
            boxShadow: T.isDark
              ? '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)'
              : '0 20px 60px rgba(0,0,0,0.18)',
            animation: 'fadeUp 0.18s ease',
          }}
        >
          {/* Header */}
          <div style={{
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: 2.5,
            color: '#00c4d4',
            marginBottom: 12,
            fontFamily: 'Orbitron, sans-serif',
            textTransform: 'uppercase',
          }}>
            Choose Your Theme
          </div>

          {/* Core themes */}
          <div style={{ marginBottom: 10 }}>
            <div style={{
              fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
              color: T.textFaint, marginBottom: 6, textTransform: 'uppercase',
            }}>
              Standard
            </div>
            {coreThemes.map(theme => (
              <ThemeRow
                key={theme.id}
                theme={theme}
                active={themeId === theme.id}
                onSelect={() => { setThemeId(theme.id); setOpen(false); }}
                T={T}
              />
            ))}
          </div>

          {/* Star Wars themes */}
          <div>
            <div style={{
              fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
              color: '#00c4d4',
              marginBottom: 6,
              display: 'flex', alignItems: 'center', gap: 5,
              fontFamily: 'Orbitron, sans-serif',
            }}>
              ⚡ STAR WARS
            </div>
            {swThemes.map(theme => (
              <ThemeRow
                key={theme.id}
                theme={theme}
                active={themeId === theme.id}
                onSelect={() => { setThemeId(theme.id); setOpen(false); }}
                T={T}
                starWars
              />
            ))}
          </div>

          {/* Footer link to Settings */}
          <div style={{
            marginTop: 12, paddingTop: 10,
            borderTop: `1px solid ${T.border}`,
            fontSize: 10, color: T.textFaint, textAlign: 'center',
          }}>
            Full theme management in{' '}
            <a
              href="/settings"
              onClick={() => setOpen(false)}
              style={{ color: '#00c4d4', textDecoration: 'none', fontWeight: 600 }}
            >
              Settings → Appearance
            </a>
          </div>
        </div>
      )}

      {/* Trigger button */}
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        aria-label="Theme switcher — With The Force"
        style={{
          pointerEvents: 'all',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '10px 16px',
          borderRadius: 40,
          border: '1px solid rgba(0, 196, 212, 0.5)',
          background: open
            ? 'linear-gradient(135deg,#020b18,#051225)'
            : 'linear-gradient(135deg,#020b18ee,#051225ee)',
          backdropFilter: 'blur(12px)',
          cursor: 'pointer',
          animation: open ? 'none' : 'forceGlow 2.5s ease-in-out infinite',
          transition: 'transform 0.15s, background 0.2s',
          transform: open ? 'scale(0.97)' : 'scale(1)',
        }}
      >
        <span style={{ fontSize: 14 }}>⚡</span>
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 1.5,
          color: '#00c4d4',
          fontFamily: 'Orbitron, sans-serif',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}>
          With The Force
        </span>
      </button>
    </div>
  );
}

function ThemeRow({ theme, active, onSelect, T, starWars = false }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 8px',
        borderRadius: 9,
        cursor: 'pointer',
        background: active
          ? (starWars ? 'rgba(0,196,212,0.10)' : 'rgba(250,170,32,0.10)')
          : hovered ? T.surface : 'transparent',
        border: `1px solid ${
          active
            ? (starWars ? 'rgba(0,196,212,0.35)' : 'rgba(250,170,32,0.35)')
            : 'transparent'
        }`,
        marginBottom: 3,
        transition: 'background 0.12s, border-color 0.12s',
      }}
    >
      {/* Swatch */}
      <div style={{
        width: 30,
        height: 20,
        borderRadius: 5,
        background: theme.swatchBg,
        border: `1px solid ${T.border2}`,
        flexShrink: 0,
      }} />
      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12,
          fontWeight: 600,
          color: active
            ? (starWars ? '#00c4d4' : '#faaa20')
            : T.text,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {theme.icon} {theme.label}
        </div>
      </div>
      {/* Active indicator */}
      {active && (
        <Check
          size={13}
          color={starWars ? '#00c4d4' : '#faaa20'}
          style={{ flexShrink: 0 }}
        />
      )}
    </div>
  );
}
