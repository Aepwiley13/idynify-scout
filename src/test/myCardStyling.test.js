/* global process */
/**
 * My Card's stylesheet and its boundaries: the rules that are easy to undo by
 * accident and hard to notice when they are.
 *
 * jsdom has no layout or paint, so this holds the stylesheet in place. The
 * look itself is checked in a browser, in the light and dark themes, at
 * desktop and phone sizes (scripts/visual/my-card).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { BRAND, THEMES as TOKEN_THEMES } from '../theme/tokens';

const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const root = (path) => resolve(process.cwd(), path);
const css = strip(readFileSync(root('src/pages/ContactHub/myCard/MyCard.css'), 'utf8'));
const indexCss = strip(readFileSync(root('src/index.css'), 'utf8'));
const dir = root('src/pages/ContactHub/myCard');
const sources = readdirSync(dir).filter((name) => /\.(jsx?|css)$/.test(name));

/** The rule for a selector: its declarations. */
const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join(';');
};

/** The variables a theme block defines. */
function themeVars(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = indexCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const THEMES = { light: themeVars('html[data-theme="workspace"]'), dark: themeVars('html[data-theme="mission"]') };

/** A colour as [r, g, b, a], from #rgb, #rrggbb, #rrggbbaa or rgba(). */
function parseColour(value) {
  const v = value.trim();
  if (v.startsWith('#')) {
    const hex = v.length === 4 ? [...v.slice(1)].map((c) => c + c).join('') : v.slice(1);
    const n = (i) => parseInt(hex.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), hex.length === 8 ? n(6) / 255 : 1];
  }
  const m = v.match(/rgba?\(([^)]+)\)/);
  const [r, g, b, a = 1] = m[1].split(',').map((x) => parseFloat(x));
  return [r, g, b, a];
}
const over = ([r, g, b, a], [br, bg, bb]) => [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1];
function contrast(foreground, background) {
  const lum = ([r, g, b]) => {
    const [x, y, z] = [r, g, b].map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * x + 0.7152 * y + 0.0722 * z;
  };
  const [hi, lo] = [lum(foreground), lum(background)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

describe('colours come from the theme, and only from the theme', () => {
  it('has no colour of its own: no hex, rgb, hsl or named colour', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/);
    expect(css).not.toMatch(/:\s*(?:white|black|red|blue|green|gray|grey|pink|purple)\b/i);
  });

  it('uses only variables that both the light and the dark theme define, apart from the card\'s brand colours', () => {
    const used = new Set([...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(10);
    const fromThemes = [...used].filter((variable) => !variable.startsWith('--mycard-'));
    for (const [name, vars] of Object.entries(THEMES)) {
      const missing = fromThemes.filter((variable) => !(variable in vars));
      expect(missing, `${name} theme is missing ${missing.join(', ')}`).toEqual([]);
    }
  });

  it('gets the card\'s brand colours from the design tokens, and every one it uses is set', () => {
    const preview = readFileSync(root('src/pages/ContactHub/myCard/MyCardPreview.jsx'), 'utf8');
    const brandVars = [...new Set([...css.matchAll(/var\((--mycard-[\w-]+)\)/g)].map((m) => m[1]))];
    expect(brandVars.length).toBeGreaterThanOrEqual(5);
    for (const variable of brandVars) expect(preview, variable).toContain(`'${variable}'`);
    expect(preview).toMatch(/from '\.\.\/\.\.\/\.\.\/theme\/tokens'/);
    expect(preview).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe('text can be read in both themes', () => {
  const pairs = [
    ['text on the card', '--text-primary', '--bg-card', 4.5],
    ['secondary text on the card', '--text-secondary', '--bg-card', 4.5],
    ['secondary text on the page', '--text-secondary', '--bg-primary', 4.5],
    ['text in a field', '--text-primary', '--input-bg', 4.5],
    ['a placeholder in a field', '--text-secondary', '--input-bg', 4.5],
    ['an error message on the card', '--status-error-text', '--bg-card', 4.5],
  ];
  for (const [themeName, vars] of Object.entries(THEMES)) {
    for (const [what, fg, bg, minimum] of pairs) {
      it(`${what}, ${themeName}: at least ${minimum}:1`, () => {
        const page = parseColour(vars['--bg-card']);
        const background = over(parseColour(vars[bg]), page);
        const ratio = contrast(over(parseColour(vars[fg]), background), background);
        expect(ratio).toBeGreaterThanOrEqual(minimum);
      });
    }

    it(`text on a Shared switch and on the selected Edit / Preview button, ${themeName}: at least 4.5:1`, () => {
      const card = parseColour(vars['--bg-card']);
      const tinted = over(parseColour(vars['--accent-bg']), card);
      expect(contrast(over(parseColour(vars['--text-primary']), tinted), tinted)).toBeGreaterThanOrEqual(4.5);
    });

    it(`secondary text on the note beside the card, ${themeName}: at least 4.5:1`, () => {
      const note = over(parseColour(vars['--bg-card-2']), parseColour(vars['--bg-card']));
      expect(contrast(over(parseColour(vars['--text-secondary']), note), note)).toBeGreaterThanOrEqual(4.5);
    });

    it(`a contact icon on its tinted circle, ${themeName}: at least 3:1`, () => {
      const card = parseColour(vars['--bg-card']);
      const tint = over(parseColour(vars['--accent-bg']), card);
      expect(contrast(parseColour(vars['--accent']), tint)).toBeGreaterThanOrEqual(3);
    });

    it(`the focus ring against the page and the card, ${themeName}: at least 3:1`, () => {
      const ring = parseColour(vars['--accent']);
      for (const bg of ['--bg-primary', '--bg-card']) {
        expect(contrast(ring, parseColour(vars[bg])), bg).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

describe('Upload photo and the crop dialog can be hit, seen and used on a phone', () => {
  const px = (selector, property) => Number(rule(selector).match(new RegExp(`(?:^|[;{\\s])${property}:\\s*(\\d+)px`))?.[1]);

  it('Upload photo, the zoom buttons and the zoom slider are at least 44px to hit', () => {
    expect(px('.mycard-upload', 'min-height')).toBeGreaterThanOrEqual(44);
    expect(px('.mycard-crop-iconbtn', 'width')).toBeGreaterThanOrEqual(44);
    expect(px('.mycard-crop-iconbtn', 'height')).toBeGreaterThanOrEqual(44);
    expect(px('.mycard-crop-slider', 'min-height')).toBeGreaterThanOrEqual(44);
  });

  it('keeps Advanced a quiet link whose touch area is still 44px', () => {
    expect(rule('.mycard-advanced-toggle')).toBeTruthy();
    expect(rule('.mycard-linkbtn')).toMatch(/min-height:\s*32px/);
    expect(rule('.mycard-linkbtn::after')).toMatch(/inset:\s*-6px/);
  });

  it('draws the picture area square, and lets a finger drag it without the page scrolling', () => {
    const viewport = rule('.mycard-crop-viewport');
    expect(viewport).toMatch(/aspect-ratio:\s*1\s*\/\s*1/);
    expect(viewport).toMatch(/touch-action:\s*none/);
    expect(viewport).toMatch(/overflow:\s*hidden/);
    expect(rule('.mycard-crop-img')).toMatch(/position:\s*absolute/);
    expect(rule('.mycard-crop-img')).toMatch(/max-width:\s*none/);
    expect(rule('.mycard-crop-img')).toMatch(/pointer-events:\s*none/);
  });

  it('is a sheet that fits any phone: no wider than the screen, never taller than it, and it scrolls inside if it must', () => {
    const panel = rule('.mycard-crop');
    expect(panel).toMatch(/width:\s*100%/);
    expect(Number(panel.match(/max-width:\s*(\d+)px/)[1])).toBeLessThanOrEqual(480);
    expect(panel).toMatch(/max-height:\s*100dvh/);
    expect(panel).toMatch(/overflow-y:\s*auto/);
    expect(panel).toMatch(/env\(safe-area-inset-bottom\)/);
    expect(css).toMatch(/@media \(min-width:\s*600px\)\s*\{[^}]*\.mycard-crop-backdrop\s*\{[^}]*align-items:\s*center/s);
  });

  it('sits above the page and the Save bar, in the page\'s own colours', () => {
    expect(rule('.mycard-crop-backdrop')).toMatch(/position:\s*fixed/);
    expect(rule('.mycard-crop-backdrop')).toMatch(/inset:\s*0/);
    expect(Number(rule('.mycard-crop-backdrop').match(/z-index:\s*(\d+)/)[1])).toBeGreaterThanOrEqual(1000);
    expect(rule('.mycard-crop')).toMatch(/background:\s*var\(--bg-card\)/);
    expect(rule('.mycard-crop')).toMatch(/color:\s*var\(--text-primary\)/);
  });

  it('shows how the photo will sit on the card: a circle in the brand colour over the square', () => {
    const guide = rule('.mycard-crop-guide');
    expect(guide).toMatch(/border-radius:\s*50%/);
    expect(guide).toMatch(/border:\s*2px solid var\(--accent\)/);
    expect(guide).toMatch(/pointer-events:\s*none/);
  });

  for (const [themeName, vars] of Object.entries(THEMES)) {
    it(`the dialog's words and its quiet text on the card, ${themeName}: at least 4.5:1`, () => {
      const card = parseColour(vars['--bg-card']);
      expect(contrast(parseColour(vars['--text-primary']), card)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parseColour(vars['--text-secondary']), card)).toBeGreaterThanOrEqual(4.5);
    });

    it(`an error in the dialog, ${themeName}: at least 4.5:1 on the card`, () => {
      expect(contrast(parseColour(vars['--status-error-text']), parseColour(vars['--bg-card']))).toBeGreaterThanOrEqual(4.5);
    });

    it(`the brand circle against the card, ${themeName}: at least 3:1`, () => {
      expect(contrast(parseColour(vars['--accent']), parseColour(vars['--bg-card']))).toBeGreaterThanOrEqual(3);
    });
  }
});

describe('the page\'s buttons, bar and notices can be read and hit, in both themes', () => {
  const touchHeight = (selector) => {
    const own = Number(rule(selector).match(/min-height:\s*(\d+)px/)?.[1]);
    const after = rule(`${selector}::after`).match(/inset:\s*(-?\d+)px/)?.[1];
    return own + (after === undefined ? 0 : -2 * Number(after));
  };

  it('every button and the link back are at least 44px to hit', () => {
    for (const selector of ['.mycard-btn', '.mycard-back']) expect(touchHeight(selector), selector).toBeGreaterThanOrEqual(44);
  });

  it('keeps the primary button\'s label large and bold: it is text on the brand colour, which only reads as large text', () => {
    const primary = rule('.mycard-btn--primary');
    expect(Number(primary.match(/font-size:\s*(\d+)px/)[1])).toBeGreaterThanOrEqual(19);
    expect(primary).toMatch(/font-weight:\s*(?:700|800)/);
    expect(primary).toMatch(/color:\s*var\(--bg-card\)/);
  });

  it('has a visible focus ring on its buttons and its link', () => {
    for (const selector of ['.mycard-btn:focus-visible', '.mycard-back:focus-visible']) expect(css).toContain(selector);
  });

  it('makes disabled buttons look disabled, and not clickable', () => {
    expect(rule('.mycard-btn:disabled')).toMatch(/opacity:\s*0\.[3-6]/);
    expect(rule('.mycard-btn:disabled')).toMatch(/cursor:\s*not-allowed/);
  });

  for (const [themeName, vars] of Object.entries(THEMES)) {
    const colour = (name) => parseColour(vars[name]);
    /** A translucent notice colour as it appears over the page, or over the card. */
    const onPage = (name) => over(colour(name), colour('--bg-primary'));
    const onCard = (name) => over(colour(name), colour('--bg-card'));

    it(`the primary button's label on the brand colour, ${themeName}: at least 3:1 (large text)`, () => {
      expect(contrast(colour('--bg-card'), colour('--accent'))).toBeGreaterThanOrEqual(3);
    });

    it(`the Save bar's status words on the bar, ${themeName}: at least 4.5:1`, () => {
      for (const name of ['--text-primary', '--text-secondary', '--status-error-text', '--status-warning-text']) {
        expect(contrast(colour(name), colour('--bg-card')), name).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`text in a conflict and an error notice, over the page or the card, ${themeName}: at least 4.5:1`, () => {
      for (const [notice, background] of [['--status-warning-bg', onPage], ['--status-warning-bg', onCard], ['--status-error-bg', onPage], ['--status-error-bg', onCard]]) {
        const ground = background(notice);
        expect(contrast(colour('--text-primary'), ground), `text on ${notice}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colour('--status-error-text'), ground), `danger button on ${notice}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`text and the danger button in an information notice, ${themeName}: at least 4.5:1`, () => {
      const ground = colour('--bg-card-2');
      expect(contrast(colour('--text-primary'), ground)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colour('--status-error-text'), ground)).toBeGreaterThanOrEqual(4.5);
    });

    it(`the download note and the page's loading line, ${themeName}: at least 4.5:1`, () => {
      expect(contrast(colour('--text-secondary'), colour('--bg-card'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colour('--text-secondary'), colour('--bg-primary'))).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('the card is branded in every theme', () => {
  const white = TOKEN_THEMES.workspace.cardBg;
  const onBrand = [['navy', BRAND.navy], ['indigo', BRAND.indigo], ['purple', BRAND.purple]];
  for (const [name, colour] of onBrand) {
    it(`white text on the brand ${name} (the wordmark, initials): at least 4.5:1`, () => {
      expect(contrast(parseColour(white), parseColour(colour))).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('white initials on the brand pink, which is large text: at least 3:1', () => {
    expect(contrast(parseColour(white), parseColour(BRAND.pink))).toBeGreaterThanOrEqual(3);
  });

  it('puts the wordmark on the dark end of the banner, where white reads best', () => {
    expect(css).toMatch(/\.mycard-card-brand\s*\{[^}]*left:\s*20px/);
    expect(rule('.mycard-card-banner')).toMatch(/linear-gradient\(135deg, var\(--mycard-brand-1\)/);
  });

  it('keeps the organization header off the pink corner, where small white text would be under 4.5:1', () => {
    expect(contrast(parseColour(white), parseColour(BRAND.pink))).toBeLessThan(4.5);
    expect(rule('.mycard-card-brand--org')).toMatch(/max-width:\s*calc\(100% - 96px\)/);
    expect(rule('.mycard-card-brand--org')).not.toMatch(/right:/);
    expect(rule('.mycard-card-brand--org')).toMatch(/-webkit-line-clamp:\s*2/);
  });

  it('keeps the attribution small and quiet, in the card\'s own secondary text', () => {
    const made = rule('.mycard-card-made');
    expect(made).toMatch(/font-size:\s*12px/);
    expect(made).toMatch(/color:\s*var\(--text-secondary\)/);
  });

  it('lifts the photo above the banner it overlaps, so it is never half hidden', () => {
    const avatar = rule('.mycard-card-body .mycard-avatar');
    expect(avatar).toMatch(/margin-top:\s*-56px/);
    expect(avatar).toMatch(/position:\s*relative/);
    expect(avatar).toMatch(/z-index:\s*[1-9]/);
    // The banner is positioned (for the wordmark), which is why the photo needs a layer of its own.
    expect(rule('.mycard-card-banner')).toMatch(/position:\s*relative/);
  });

  it('keeps the photo, name, title and organization large: the focal points', () => {
    expect(rule('.mycard-avatar--xl')).toMatch(/width:\s*112px/);
    expect(rule('.mycard-card-name')).toMatch(/font-size:\s*28px/);
    expect(rule('.mycard-card-title')).toMatch(/font-size:\s*17px/);
  });
});

describe('controls are easy to hit and to see', () => {
  /** The height a thumb gets: the control's own, plus the touch area its ::after adds above and below. */
  const touchHeight = (selector) => {
    const own = Number(rule(selector).match(/min-height:\s*(\d+)px/)?.[1]);
    const after = rule(`${selector}::after`).match(/inset:\s*(-?\d+)px/)?.[1];
    return own + (after === undefined ? 0 : -2 * Number(after));
  };

  it('every control a thumb is meant to hit has at least a 44px touch height', () => {
    expect(rule('.mycard-switch-btn')).toMatch(/min-height:\s*44px/);
    for (const selector of ['.mycard-share', '.mycard-suggest', '.mycard-suggest--primary', '.mycard-linkbtn']) {
      expect(touchHeight(selector), selector).toBeGreaterThanOrEqual(44);
    }
    expect(Number(rule('.mycard-input').match(/min-height:\s*(\d+)px/)[1])).toBeGreaterThanOrEqual(44);
  });

  it('keeps the Shared / Private switch compact to look at: 32px', () => {
    expect(rule('.mycard-share')).toMatch(/min-height:\s*32px/);
  });

  it('never lets two touch areas overlap: each ::after reaches only past its own control', () => {
    for (const selector of ['.mycard-share', '.mycard-suggest', '.mycard-linkbtn']) {
      expect(rule(`${selector}::after`), selector).toMatch(/position:\s*absolute/);
      expect(rule(selector), selector).toMatch(/position:\s*relative/);
    }
  });

  it('inputs are 16px, so a phone does not zoom into them', () => {
    expect(rule('.mycard-input')).toMatch(/font-size:\s*16px/);
  });

  it('has a visible focus ring for every control', () => {
    const focus = css.match(/([^{}]*):focus-visible[^{}]*\{([^}]*)\}/s);
    expect(focus).not.toBeNull();
    for (const selector of ['.mycard-input:focus-visible', '.mycard-share:focus-visible', '.mycard-suggest:focus-visible', '.mycard-linkbtn:focus-visible', '.mycard-switch-btn:focus-visible',
      '.mycard-upload:focus-visible', '.mycard-crop-iconbtn:focus-visible', '.mycard-crop-slider:focus-visible', '.mycard-crop-viewport:focus-visible']) {
      expect(css).toContain(selector);
    }
    expect(css).toMatch(/:focus-visible[^{}]*\{\s*outline:\s*2px solid var\(--accent\)/s);
    expect(css).not.toMatch(/outline:\s*(?:none|0)\b/);
  });

  it('never says Shared or Private by colour alone: the state is in the label and the icon', () => {
    const source = readFileSync(root('src/pages/ContactHub/myCard/ShareToggle.jsx'), 'utf8');
    expect(source).toMatch(/Shared/);
    expect(source).toMatch(/Private/);
    expect(source).toMatch(/<Eye/);
    expect(source).toMatch(/<Lock/);
  });
});

describe('layout', () => {
  it('shows one panel at a time under 900px, and both from 900px', () => {
    expect(css).toMatch(/@media \(max-width: 899px\)\s*\{[^@]*data-view="edit"\][^{]*mycard-pane--preview[^}]*display:\s*none/s);
    expect(css).toMatch(/@media \(min-width: 900px\)\s*\{[^@]*\.mycard-switch\s*\{\s*display:\s*none/s);
    expect(css).toMatch(/@media \(min-width: 900px\)\s*\{[^@]*grid-template-columns:\s*minmax\(0, 1fr\) 400px/s);
  });

  it('keeps the preview in view beside the form on a wide screen', () => {
    expect(css).toMatch(/\.mycard-pane--preview\s*\{[^}]*position:\s*sticky/);
  });

  it('is its own scroll container, the way the shell expects module content to be', () => {
    expect(rule('.mycard')).toMatch(/overflow-y:\s*auto/);
    expect(rule('.mycard')).toMatch(/min-height:\s*0/);
  });

  it('wraps long names and addresses instead of overflowing', () => {
    for (const selector of ['.mycard-card-name', '.mycard-row-value', '.mycard-card-title', '.mycard-card-brand--org']) {
      expect(rule(selector), selector).toMatch(/overflow-wrap:\s*anywhere/);
    }
    expect(rule('.mycard-input')).toMatch(/min-width:\s*0/);
  });

  it('stops what is scrolled to above the Save bar, which stays in view: room for the whole bar', () => {
    const padding = Number(rule('.mycard').match(/scroll-padding-bottom:\s*(\d+)px/)?.[1]);
    // The bar is a 44px button plus its padding on a phone, about 68px; allow for it and a little more.
    expect(padding).toBeGreaterThanOrEqual(80);
  });

  it('keeps the actions bar in view at the bottom of the scrolling page', () => {
    expect(rule('.mycard-actions')).toMatch(/position:\s*sticky/);
    expect(rule('.mycard-actions')).toMatch(/bottom:\s*0/);
  });
});

describe('the state modules stand alone', () => {
  // The pure logic behind the page: a reducer, a diff, and the one module that keeps a draft in the tab.
  const stateDir = resolve(dir, 'state');
  const stateFiles = readdirSync(stateDir).filter((name) => /\.js$/.test(name));
  const stateImports = (name) => [...readFileSync(resolve(stateDir, name), 'utf8').matchAll(/(?:^|\n)\s*import\b[^'"]*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const stateSource = (name) => strip(readFileSync(resolve(stateDir, name), 'utf8'));

  it('is the modules that belong here', () => {
    expect([...stateFiles].sort()).toEqual(['clearDraftsOnSignOut.js', 'myCardDiff.js', 'myCardDraftStorage.js', 'myCardState.js', 'useMyCard.js']);
  });

  it('imports no Firebase, router, service, context or icons: all of it is plain logic, or the hook that joins it', () => {
    for (const name of stateFiles) {
      for (const from of stateImports(name)) {
        expect(from, `${name} imports ${from}`).not.toMatch(/firebase|react-router|\/services\/|\/context\/|ImpersonationContext|axios|lucide/);
      }
    }
  });

  it('keeps React out of everything but the hook, and gives the hook only what it needs', () => {
    for (const name of stateFiles.filter((file) => file !== 'useMyCard.js')) {
      for (const from of stateImports(name)) {
        expect(from, `${name} imports ${from}`).not.toMatch(/react/);
        // photoPrep is the pure, local-only photo utility: the draft storage re-inspects a kept picture with it.
        expect(from, `${name} imports ${from}`).toMatch(/^(?:\.\/my[A-Za-z]+|\.\.\/cardDraft|\.\.\/\.\.\/\.\.\/\.\.\/utils\/(?:myCardRules|photoPrep))$/);
      }
    }
    for (const from of stateImports('useMyCard.js')) {
      expect(from, `useMyCard.js imports ${from}`).toMatch(/^(?:react|\.\/my[A-Za-z]+|\.\.\/useCardDraft|\.\.\/\.\.\/\.\.\/\.\.\/utils\/(?:myCardRules|myCardSuggestions))$/);
    }
  });

  it('gets the service and the tab\'s storage handed in: the hook imports neither', () => {
    const hook = stateSource('useMyCard.js');
    expect(stateImports('useMyCard.js').some((from) => /service|firebase/i.test(from))).toBe(false);
    expect(hook).toMatch(/service\.loadMyCard\(\)/);
    expect(hook).toMatch(/service\.saveMyCard\(/);
    expect(hook).not.toMatch(/sessionStorage|localStorage|globalThis/);
  });

  it('never calls the network or writes to a database', () => {
    for (const name of stateFiles) {
      expect(stateSource(name), name).not.toMatch(/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon|indexedDB|setDoc|addDoc|updateDoc|deleteDoc|runTransaction|getDoc/);
    }
  });

  it('lets exactly one module touch browser storage, and only the tab\'s sessionStorage', () => {
    const touching = stateFiles.filter((name) => /sessionStorage|localStorage/.test(stateSource(name)));
    expect(touching).toEqual(['myCardDraftStorage.js']);
    expect(stateSource('myCardDraftStorage.js')).toMatch(/globalThis\.sessionStorage/);
    expect(stateSource('myCardDraftStorage.js')).not.toMatch(/localStorage/);
  });

  it('keeps the components, which draw the screen, away from storage altogether', () => {
    for (const name of sources.filter((file) => /\.jsx?$/.test(file))) {
      expect(strip(readFileSync(resolve(dir, name), 'utf8')), name).not.toMatch(/sessionStorage|localStorage|myCardDraftStorage/);
    }
  });

  it('never stores or tracks the sharing setting: wherever it is named, it is the literal false', () => {
    for (const name of stateFiles) {
      // Assigned, it is only ever `false` (the draft's own shape says sharing is off), never true and never copied.
      expect(stateSource(name), name).not.toMatch(/sharingEnabled\s*[:=]\s*(?!\s|false\b)/);
    }
    // The storage module names it only to say it is not kept.
    expect(readFileSync(resolve(stateDir, 'myCardDraftStorage.js'), 'utf8')).toMatch(/no sharing setting|no sharing/i);
  });
});

describe('the components stand alone', () => {
  const code = sources.filter((name) => /\.jsx?$/.test(name));
  const imports = (name) => [...readFileSync(resolve(dir, name), 'utf8').matchAll(/(?:^|\n)\s*import\b[^'"]*['"]([^'"]+)['"]/g)].map((m) => m[1]);

  it('import nothing from Firebase, the router, a service or the network', () => {
    expect(code.length).toBeGreaterThanOrEqual(6);
    for (const name of code) {
      for (const from of imports(name)) {
        expect(from, `${name} imports ${from}`).not.toMatch(/firebase|react-router|\/services\/|\/context\/|ImpersonationContext|axios/);
      }
    }
  });

  it('do not call the network or write anywhere', () => {
    for (const name of code) {
      const source = strip(readFileSync(resolve(dir, name), 'utf8'));
      expect(source, name).not.toMatch(/\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|setDoc|addDoc|updateDoc|deleteDoc|runTransaction|navigator\.sendBeacon/);
    }
  });

  it('import only React, icons, the card rules and each other, and for the download alone, the vCard maker', () => {
    for (const name of code) {
      for (const from of imports(name)) {
        // The extras: the file that downloads a contact needs the vCard maker; the photo part draws its dialog on the page
        // (react-dom's portal); the photo files use the photo utility, which is pure and local-only (photoPrep.test.js).
        const allowedHere = name === 'downloadContact.js' && from === '../../../utils/vcard';
        expect(allowedHere || /^(?:react|lucide-react|\.\/[\w.]+|\.\.\/\.\.\/\.\.\/utils\/(?:myCardRules|myCardSuggestions|photoPrep)|\.\.\/\.\.\/\.\.\/theme\/tokens)$/.test(from) || (from === 'react-dom' && name === 'MyCardPhoto.jsx'), `${name} imports ${from}`).toBe(true);
      }
    }
  });
});

describe('Download contact can reach no database and no network', () => {
  const vcardSource = strip(readFileSync(root('src/utils/vcard.js'), 'utf8'));
  const downloadSource = strip(readFileSync(resolve(dir, 'downloadContact.js'), 'utf8'));
  const importsOf = (text) => [...text.matchAll(/(?:^|\n)\s*import\b[^'"]*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const REACHES = /firebase|\/services\/|\/context\/|ImpersonationContext|react-router|axios|myCardService|myCardCore/;
  const CALLS = /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|indexedDB|localStorage|sessionStorage|setDoc|addDoc|updateDoc|deleteDoc|runTransaction|getDoc|getDocs|onSnapshot|\bsaveMyCard\b|\bloadMyCard\b|\bsaveDraft\b|sharingEnabled/;

  it('the download module imports only the vCard maker, the card rules and its neighbours', () => {
    expect(importsOf(downloadSource).sort()).toEqual(['../../../utils/myCardRules', '../../../utils/vcard', './cardDraft']);
    for (const from of importsOf(downloadSource)) expect(from).not.toMatch(REACHES);
  });

  it('the vCard maker imports only the card rules and the photo utility\'s constants', () => {
    // photoPrep is pure and local-only (photoPrep.test.js): the maker needs the data-URL prefix from it, nothing else.
    expect(importsOf(vcardSource)).toEqual(['./myCardRules', './photoPrep']);
  });

  it('the photo utility itself imports only the capture code\'s JPEG helpers, and the card rules only the photo utility', () => {
    const utility = readFileSync(root('src/utils/photoPrep.js'), 'utf8');
    expect(importsOf(utility)).toEqual(['../capture/preparedImage.js']);
    const rules = readFileSync(root('src/utils/myCardRules.js'), 'utf8');
    expect(importsOf(rules)).toEqual(['./photoPrep.js']);
  });

  it('neither makes a call that could read or write anything but a file on the device', () => {
    expect(downloadSource).not.toMatch(CALLS);
    expect(vcardSource).not.toMatch(CALLS);
  });

  it('says in words that it does not save, and never mentions turning sharing on', () => {
    expect(downloadSource).toMatch(/does not save your changes to IDYNIFY/);
    expect(downloadSource).not.toMatch(/sharing\w*\s*[:=]\s*true/i);
  });
});
