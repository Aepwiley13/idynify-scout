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
 *
 * The one thing the stage may set is a min-height — a measured floor, so the
 * deck does not resize under the queue on every swipe. A floor cannot clip and
 * cannot scroll: a card taller than it still sets its own height.
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

// The longest values the card realistically receives: a full HQ string and a
// CEO with a compound title. Both are `white-space: nowrap`, which is what used
// to widen the stats grid's right column past the card.
const LONG_VALUES = {
  id: 'long',
  name: 'Meridian Consumer Brands Holdings International',
  industry: 'Apparel & Fashion',
  headquarters_city: 'Rancho Santa Margarita',
  headquarters_state: 'California',
  ceo_name: 'Priyadarshini Raghunathan-Winterbottom · Chief Executive Officer & Co-Founder',
  employee_count: 22,
  revenue: '$20M-$50M',
  founded_year: 2008,
  fit_score: 100,
};

/** The six stats cells, as [labelEl, valueEl] pairs. */
const statCells = (container) => {
  const grid = [...container.querySelectorAll('div')]
    .find(d => d.style.display === 'grid' && d.style.gridTemplateColumns === '1fr 1fr'
      && /INDUSTRY/.test(d.textContent || ''));
  return { grid, cells: [...(grid?.children || [])].map(c => [c, c.lastElementChild]) };
};

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

describe('Daily Discovery card — the stats grid stays inside the card', () => {
  // The card clips both axes now, so anything wider than the card is cut rather
  // than scrolled sideways. A grid item's automatic minimum size is its content,
  // and each value line is `white-space: nowrap`, so a long CEO name used to
  // push the right column ~4px past the card at 360px wide.
  //
  // jsdom lays nothing out, so this asserts the three declarations that hold the
  // columns to half the card each, with a fixture whose values overflow. The
  // geometry itself is verified in Chromium: at 360x640 the card is 324px wide
  // and both columns measure 161px, with no cell crossing the card's edge.
  const renderLong = (wide) => render(
    <CompanySwipeCard company={LONG_VALUES} onAccept={() => {}} onReject={() => {}} onSkip={() => {}} wide={wide} />,
  );

  for (const wide of [true, false]) {
    const at = wide ? 'desktop' : 'mobile';

    it(`[${at}] the grid splits the card in two equal columns`, () => {
      const { grid, cells } = statCells(renderLong(wide).container);
      expect(grid, 'the stats grid is gone or no longer 1fr 1fr').toBeTruthy();
      expect(cells).toHaveLength(6);
    });

    it(`[${at}] every cell may shrink below its content`, () => {
      // Without this the column tracks grow to fit an unbreakable value and the
      // grid outgrows the card. This is the declaration that keeps it inside.
      for (const [cell] of statCells(renderLong(wide).container).cells) {
        expect(cell.style.minWidth, `${cell.textContent.slice(0, 12)} can outgrow its column`).toBe('0px');
      }
    });

    it(`[${at}] every value line ellipsizes rather than overflowing`, () => {
      for (const [, value] of statCells(renderLong(wide).container).cells) {
        expect(value.style.overflow).toBe('hidden');
        expect(value.style.textOverflow).toBe('ellipsis');
        expect(value.style.whiteSpace).toBe('nowrap');
      }
    });
  }

  it('a truncated value keeps its full text on hover', () => {
    const { cells } = statCells(renderLong(false).container);
    const byLabel = Object.fromEntries(cells.map(([cell, value]) => [cell.firstElementChild.textContent, value]));
    expect(byLabel.HQ.getAttribute('title')).toBe('Rancho Santa Margarita, California');
    expect(byLabel.CEO.getAttribute('title')).toBe(LONG_VALUES.ceo_name);
    expect(byLabel.INDUSTRY.getAttribute('title')).toBe('Apparel & Fashion');
  });

  it('a placeholder carries no tooltip — there is nothing withheld', () => {
    const { cells } = statCells(render(
      <CompanySwipeCard company={COMPANY} onAccept={() => {}} onReject={() => {}} onSkip={() => {}} wide />,
    ).container);
    const byLabel = Object.fromEntries(cells.map(([cell, value]) => [cell.firstElementChild.textContent, value]));
    expect(byLabel.HQ.textContent, 'fixture should have no HQ').toBe('—');
    expect(byLabel.HQ.getAttribute('title')).toBeNull();
    expect(byLabel.EMPLOYEES.getAttribute('title')).toBeNull();
  });

  it('the header lines that ellipsize keep their full text too', () => {
    const { container } = renderLong(false);
    const name = [...container.querySelectorAll('div')].find(d => d.textContent === LONG_VALUES.name);
    expect(name.style.textOverflow, 'the name line no longer ellipsizes').toBe('ellipsis');
    expect(name.getAttribute('title')).toBe(LONG_VALUES.name);
  });
});

describe('Daily Discovery card — the stage constrains nothing, and floors only', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, '../pages/Scout/DailyLeads.jsx'), 'utf8');

  // jsdom computes no layout, so the stage's own declarations are read from
  // source. Both the Companies and the People tab render one.
  const stages = src.match(/<div style=\{\{ position: 'relative', width: '100%', maxWidth: isDesktop \? 560 : 440[^}]*\}\}>/g) || [];

  it('both tabs render a card stage', () => {
    expect(stages).toHaveLength(2);
  });

  it('no stage sets a height, a max-height or an overflow', () => {
    for (const stage of stages) {
      expect(stage, 'stage pins a height').not.toMatch(/[^a-zA-Z]height:/);
      expect(stage, 'stage caps its height').not.toMatch(/maxHeight/);
      expect(stage, 'stage clips or scrolls').not.toMatch(/overflow/i);
    }
  });

  it('each stage carries a min-height floor and refuses to be shrunk below it', () => {
    // The floor keeps the deck from resizing under the queue: card height
    // follows content, and content is uneven. It is a floor, so a taller card
    // still sets its own height — but an explicit min-height replaces a flex
    // item's automatic minimum size, so `flexShrink: 0` has to travel with it
    // or the column squeezes a tall card back down onto what follows.
    for (const [stage, floor] of stages.map((s, i) => [s, ['COMPANY_STAGE_MIN_H', 'PERSON_STAGE_MIN_H'][i]])) {
      expect(stage, `${floor} is missing`).toMatch(new RegExp(`minHeight: ${floor}`));
      expect(stage, `${floor} without flexShrink: 0`).toMatch(/flexShrink: 0/);
    }
    for (const floor of ['COMPANY_STAGE_MIN_H', 'PERSON_STAGE_MIN_H']) {
      expect(src, `${floor} is not a measured per-breakpoint constant`)
        .toMatch(new RegExp(`const ${floor} = isDesktop \\? \\d+ : \\d+;`));
    }
  });

  it('nothing reintroduces a viewport-derived card height', () => {
    expect(src, 'a calc(100vh …) card height is back').not.toMatch(/const CARD_H/);
    expect(src, 'a viewport clamp is driving card height again')
      .not.toMatch(/clamp\([^)]*100vh[^)]*\)/);
  });
});
