/**
 * AuthLayout — the shell for the three pre-auth screens.
 *
 *   variant="full"   signup: gradient panel with Barry and his card
 *   variant="quiet"  sign in / forgot password: the same gradient, no Barry
 *
 * One layout rather than three hand-matched pages is what makes "one coherent
 * IDYNIFY authentication experience" true by construction instead of by
 * vigilance. The old surface was three files that happened to agree.
 *
 * TOKENS
 * ──────
 * Every colour is written as a CSS custom property here, from tokens.js, and
 * the stylesheet only ever reads var(--auth-*). That is deliberate: the audit's
 * central finding was that the entire pre-auth surface imported zero tokens and
 * hardcoded its palette. A stylesheet with literal hex values would reproduce
 * exactly that, one sprint later. This way the CSS gets media queries and
 * pseudo-classes, and tokens.js stays the single source of truth.
 *
 * MOBILE
 * ──────
 * Below 1024px the panels stack and Barry moves BELOW the form, not above it.
 * The brief is explicit that Barry must never push the CTA off screen, and the
 * old page's failure mode was precisely that: ~1,000px of imagery and copy
 * before the first input, with the submit button around y=1223 on a 390px
 * phone. Account creation leads; Barry follows.
 */

import { useEffect } from 'react';
import { BRAND, THEMES, AUTH_ASSETS } from '../../theme/tokens';
import './AuthLayout.css';

const W = THEMES.workspace;

/** Token-derived custom properties. The stylesheet reads only these. */
const VARS = {
  '--auth-indigo':  BRAND.indigo,
  '--auth-purple':  BRAND.purple,
  '--auth-navy':    BRAND.navy,
  '--auth-pink':    BRAND.pink,
  '--auth-panel':   W.cardBg,
  '--auth-text':    W.text,
  '--auth-muted':   W.textMuted,
  '--auth-faint':   W.textFaint,
  '--auth-border':  W.border,
  '--auth-border2': W.border2,
  '--auth-input':   W.cardBg,
  '--auth-surface': W.cardBg2,
  '--auth-error':   '#dc2626',
  '--auth-success': '#10b981',
};

/**
 * Publishes how much of the layout viewport the on-screen keyboard is covering,
 * as `--auth-kb-inset`. The sticky CTA adds it to its offset so it lands above
 * the keyboard rather than behind it.
 *
 * This is NOT keyboard detection by heuristic — no user-agent sniffing, no
 * height thresholds, no focus/blur guessing. `window.visualViewport` is the
 * standard API whose entire purpose is reporting the region actually visible,
 * and the keyboard is the main thing that shrinks it. Reading one number from
 * it is the least fragile option available, and it is the only one that works
 * on iOS at all.
 *
 * Why it is needed on iOS and not Android: Android Chrome shrinks the LAYOUT
 * viewport when the keyboard opens, so `bottom: 0` is already above the
 * keyboard and this returns ~0. iOS Safari leaves the layout viewport at full
 * height, so `bottom: 0` is behind the keyboard and this returns its height.
 * Same CSS, correct on both.
 *
 * Degrades to nothing: no `visualViewport`, no listener, inset stays 0, and the
 * sticky CTA behaves exactly as it does on Android.
 */
function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;
    const update = () => {
      // What the layout viewport has that the visual viewport does not, below
      // the fold. Clamped at 0 so pinch-zoom never produces a negative inset.
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--auth-kb-inset', `${Math.round(inset)}px`);
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--auth-kb-inset');
    };
  }, []);
}

/**
 * Barry and his card. Frozen copy — the positioning brief specifies this
 * wording exactly and forbids the mockup's "AI SDR / sales engine" language.
 */
function BarryPanel() {
  const b = AUTH_ASSETS.barry;
  return (
    <div className="auth-hero">
      <div className="auth-speech">
        <p className="auth-speech-hi">Hi! I&apos;m Barry <span aria-hidden="true">👋</span></p>
        <p className="auth-speech-body">
          I&apos;m the intelligence inside IDYNIFY. I&apos;ll help you know who matters,
          why they matter, and what to do next.
        </p>
        <p className="auth-speech-cta">Let&apos;s get started.</p>
      </div>

      <picture className="auth-barry">
        <source srcSet={b.avif} type="image/avif" />
        <source srcSet={b.webp} type="image/webp" />
        <img
          src={b.png}
          alt={b.alt}
          width={b.width}
          height={b.height}
          decoding="async"
          /* Lowercase deliberately: React 18 does not recognise the camelCase
             spelling and logs a warning instead of forwarding it. */
          fetchpriority="low"
        />
      </picture>
    </div>
  );
}

export default function AuthLayout({ variant = 'quiet', children, below }) {
  const full = variant === 'full';
  useKeyboardInset();

  return (
    <div className={`auth-root ${full ? 'full' : 'quiet'}`} style={VARS}>
      <div className="auth-split">
        <main className="auth-panel-left">
          <div className="auth-panel-inner">{children}</div>
        </main>

        <aside className="auth-panel-right" aria-hidden={!full}>
          {full && <BarryPanel />}
        </aside>
      </div>

      {below}
    </div>
  );
}
