/**
 * THE DAILY DISCOVERY CARD DOES NOT SCROLL INSIDE ITSELF.
 *
 * The card rendered with a scrollbar down its right edge on both desktop and
 * mobile, and the content below the fold — Barry Intel, the Website/LinkedIn
 * links, Not a Match / This is a Match / Skip — sat behind it.
 *
 * Two separate constraints produced it:
 *
 *   1. The stage the card sits in carried `height: CARD_H` (a viewport-derived
 *      clamp) together with `overflowX: 'hidden'`. A box cannot clip one axis
 *      and leave the other `visible`, so the browser resolved overflow-y to
 *      `auto` — a scroll container nobody wrote, wrapped around a card that was
 *      taller than the height the stage had been given.
 *   2. Below 1024px the card itself was `height: 100%` with `overflow: auto`,
 *      so it scrolled its own body inside that same fixed stage.
 *
 * The card's height is now its content's height, at every breakpoint, and a
 * card taller than the viewport scrolls the column it sits in. These tests hold
 * that line: no height constraint on the stage or the card, no scrolling
 * overflow on either, and `touch-action: pan-y` still on the swipe root so a
 * vertical drag pans the page instead of being eaten by the gesture handler.
 */

import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { vi, describe, it, expect } from 'vitest';

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'test-user', getIdToken: () => Promise.resolve('t') } },
  db: {},
}));
vi.mock('firebase/firestore', () => new Proxy({}, {
  get: (target, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : vi.fn()),
}));
vi.mock('../components/scout/CompanyLogo', () => ({ default: () => <div data-testid="logo" /> }));
vi.mock('../components/scout/ContactTitleSetup', () => ({ default: () => null }));
vi.mock('../components/scout/BarryICPPanel', () => ({
  default: () => null,
  BarryAvatar: () => null,
}));

import { CompanySwipeCard, PersonSwipeCard } from '../pages/Scout/DailyLeads.jsx';

const COMPANY = {
  id: 'kuru',
  name: 'KURU Footwear',
  industry: 'Apparel & Fashion',
  revenue: '29.6M',
  founded_year: 2008,
  fit_score: 100,
};

const PERSON = { id: 'p1', name: 'Dana Reyes', title: 'CEO / Owner' };

/** The draggable root, and the card surface inside it. */
const parts = (container) => {
  const root = container.firstChild;
  const surface = [...root.children].reverse().find(el => el.style.borderRadius === '22px');
  return { root, surface };
};

const SCROLLING = ['auto', 'scroll', 'overlay'];

describe('Daily Discovery card — content decides its height', () => {
  for (const wide of [true, false]) {
    const at = wide ? 'desktop' : 'mobile';

    it(`[${at}] the company card carries no height of its own`, () => {
      const { container } = render(
        <CompanySwipeCard company={COMPANY} onAccept={() => {}} onReject={() => {}} onSkip={() => {}} wide={wide} />,
      );
      const { root, surface } = parts(container);
      for (const [name, el] of [['swipe root', root], ['card surface', surface]]) {
        expect(el.style.height, `${name} pins a height`).toBe('');
        expect(el.style.maxHeight, `${name} caps its height`).toBe('');
      }
    });

    it(`[${at}] neither the company card nor its surface scrolls`, () => {
      const { container } = render(
        <CompanySwipeCard company={COMPANY} onAccept={() => {}} onReject={() => {}} onSkip={() => {}} wide={wide} />,
      );
      const { root, surface } = parts(container);
      for (const [name, el] of [['swipe root', root], ['card surface', surface]]) {
        for (const prop of ['overflow', 'overflowY']) {
          expect(SCROLLING, `${name} scrolls via ${prop}`).not.toContain(el.style[prop]);
        }
      }
      // `hidden` on one axis alone resolves the other to `auto` — the exact
      // shape of the original bug. Both axes clip together, or neither does.
      expect(surface.style.overflowX, 'card surface clips one axis alone').toBe('');
      expect(surface.style.overflow, 'card surface should clip its corner radius').toBe('hidden');
    });

    it(`[${at}] vertical touch is left to the page`, () => {
      const { container } = render(
        <CompanySwipeCard company={COMPANY} onAccept={() => {}} onReject={() => {}} onSkip={() => {}} wide={wide} />,
      );
      expect(parts(container).root.style.touchAction).toBe('pan-y');
    });

    it(`[${at}] the person card follows the same rules`, () => {
      const { container } = render(
        <PersonSwipeCard person={PERSON} company={COMPANY} onAccept={() => {}} onReject={() => {}} onSkip={() => {}} wide={wide} />,
      );
      const { root, surface } = parts(container);
      expect(root.style.height).toBe('');
      expect(surface.style.height).toBe('');
      expect(SCROLLING).not.toContain(surface.style.overflow);
      expect(root.style.touchAction).toBe('pan-y');
    });
  }

  it('the card is in flow, so the stage it sits in is as tall as the card', () => {
    const { container } = render(
      <CompanySwipeCard company={COMPANY} onAccept={() => {}} onReject={() => {}} onSkip={() => {}} wide />,
    );
    // Absolute positioning takes the card out of flow and leaves the stage to
    // supply a height of its own — which is where the fixed height came from.
    expect(parts(container).root.style.position).toBe('relative');
  });
});

describe('Daily Discovery card — the stage carries no constraint either', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, '../pages/Scout/DailyLeads.jsx'), 'utf8');

  // jsdom computes no layout, so the stage's own declarations are read from
  // source. Both the Companies and the People tab render one.
  const stages = src.match(/<div style=\{\{ position: 'relative', width: '100%', maxWidth: isDesktop \? 560 : 440[^}]*\}\}>/g) || [];

  it('both tabs render a card stage', () => {
    expect(stages).toHaveLength(2);
  });

  it('no stage sets a height or an overflow', () => {
    for (const stage of stages) {
      expect(stage, 'stage pins a height').not.toMatch(/height:/);
      expect(stage, 'stage clips or scrolls').not.toMatch(/overflow/);
    }
  });

  it('nothing reintroduces a viewport-derived card height', () => {
    expect(src, 'a calc(100vh …) card height is back').not.toMatch(/const CARD_H/);
  });
});
