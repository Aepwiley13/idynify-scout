/**
 * ONE DISCOVERY, ONE SCREEN — the Daily Discoveries card on a phone.
 *
 * On a real iPhone the card was taller than the space between the tabs and the
 * bottom navigation (a 606px card in a ~436px column), so judging a discovery
 * meant scrolling the page to reach the buttons. A vertical scroll could also
 * drift sideways into a swipe, and the queue button floated over the Match
 * button and the bottom nav.
 *
 * Below 1024px (`fit`) the card is now the stage's height, which is the
 * column's remaining height: its header and the decision buttons stay put,
 * and only the middle (ICP match, factors, Barry Intel, and the Details) scrolls,
 * vertically, inside the card. A press is read once as horizontal (a swipe)
 * or vertical (that scroll), and a vertical one never moves or decides the card.
 *
 * Desktop (`wide`, no `fit`) is unchanged; dailyDiscoveryCardNoNestedScroll
 * holds its rules. jsdom does no layout: these pin the structure, and the PR
 * records the measured sizes at 375–430px.
 */

import { render, fireEvent, act, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { vi, describe, it, beforeEach, afterEach, expect } from 'vitest';

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
  id: 'co1',
  name: 'Sokol Studio',
  industry: 'Information Technology & Services',
  headquarters_city: 'Salt Lake City',
  headquarters_state: 'Utah',
  employee_count: 1250,
  revenue: '$50M-$100M',
  founded_year: 2004,
  fit_score: 82,
  website_url: 'https://sokol.example',
  linkedin_url: 'https://www.linkedin.com/company/sokol-example',
  barry_intel: 'A long-established enterprise software consultancy.',
};
const PERSON = { id: 'p1', name: 'Kristin Sokol', title: 'Senior Vice President, Strategic Partnerships', linkedin_url: 'https://www.linkedin.com/in/k' };

const SCROLLING = ['auto', 'scroll', 'overlay'];
const renderCompany = (props = {}) => render(
  <CompanySwipeCard company={COMPANY} onAccept={() => {}} onReject={() => {}} onSkip={() => {}} fit {...props} />,
);
const renderPerson = (props = {}) => render(
  <PersonSwipeCard person={PERSON} company={COMPANY} matchText="Matches your SVP target" onAccept={() => {}} onReject={() => {}} onSkip={() => {}} fit {...props} />,
);
const parts = (container) => {
  const root = container.firstChild;
  const surface = [...root.children].reverse().find(el => el.style.borderRadius === '22px');
  const body = container.querySelectorAll('[data-card-body]');
  return { root, surface, body: body[0], bodies: body.length };
};
const button = (container, re) => [...container.querySelectorAll('button')].find(b => re.test(b.textContent));

describe.each([['company', renderCompany], ['person', renderPerson]])('on a phone the %s card is the screen', (_, renderCard) => {
  it('fills the stage instead of setting a height of its own', () => {
    const { root, surface } = parts(renderCard().container);
    for (const [name, el] of [['swipe root', root], ['card surface', surface]]) {
      expect(el.style.flex, `${name} does not fill`).toBe('1 1 0%');
      expect(el.style.minHeight, `${name} cannot shrink below its content`).toBe('0px');
      expect(el.style.flexDirection).toBe('column');
      expect(el.style.height, `${name} pins a height`).toBe('');
      expect(el.style.maxHeight, `${name} caps its height`).toBe('');
      expect(SCROLLING).not.toContain(el.style.overflowY);
    }
    expect(surface.style.overflow, 'the surface only clips its corners').toBe('hidden');
    expect(root.style.touchAction, 'vertical touch must stay with the browser').toBe('pan-y');
  });

  it('scrolls one part only, vertically, without passing the scroll on to the page', () => {
    const { body, bodies } = parts(renderCard().container);
    expect(bodies).toBe(1);
    expect(body.style.overflowY).toBe('auto');
    expect(body.style.overflowX, 'the body must never scroll sideways').toBe('');
    expect(body.style.overscrollBehavior, 'reaching the end would scroll or bounce the page').toBe('contain');
    expect(body.style.flex).toBe('1 1 0%');
    expect(body.style.minHeight).toBe('0px');
  });

  it('keeps Not a Match and This is a Match outside the scrolling part, so they are always in view', () => {
    const { container } = renderCard();
    const { body } = parts(container);
    for (const re of [/Not a Match/, /This is a Match/]) {
      const b = button(container, re);
      expect(b, `${re} is missing`).toBeTruthy();
      expect(body.contains(b), `${re} scrolls away with the body`).toBe(false);
    }
  });
});

describe('the phone company card: what is always there, and what waits behind Details', () => {
  it('logo, name, confidence and key facts head the card; ICP match and Barry Intel open the body', () => {
    const { container, getByTestId } = renderCompany();
    const { body } = parts(container);
    expect(body.contains(getByTestId('logo'))).toBe(false);
    const header = container.querySelector('[title="Sokol Studio"]');
    expect(body.contains(header), 'the name scrolls away').toBe(false);
    expect(container.textContent).toMatch(/confidence/);
    expect(container.querySelector('[title="1,250 employees · $50M-$100M"]'), 'key facts line').toBeTruthy();
    expect(body.textContent).toMatch(/ICP MATCH SCORE/i);
    expect(body.textContent).toMatch(/BARRY INTEL/i);
  });

  it('the stats and links are one tap away, inside the same scrolling body', () => {
    const { container } = renderCompany();
    const { body } = parts(container);
    expect(body.textContent, 'details showing before they were asked for').not.toMatch(/FOUNDED/);
    fireEvent.click(within(body).getByText('Details'));
    expect(body.textContent).toMatch(/FOUNDED/);
    expect(body.querySelector('a[href="https://sokol.example"]'), 'website link').toBeTruthy();
    fireEvent.click(within(body).getByText('Details'));
    expect(body.textContent).not.toMatch(/FOUNDED/);
  });

  it('without `fit` the card is the desktop card it was: everything in one column, no scrolling body', () => {
    const { container } = render(
      <CompanySwipeCard company={COMPANY} onAccept={() => {}} onReject={() => {}} onSkip={() => {}} wide />,
    );
    expect(container.querySelector('[data-card-body]')).toBeNull();
    expect(container.textContent).toMatch(/FOUNDED/);
    expect(container.firstChild.style.flex).toBe('');
  });
});

describe('the phone person card keeps who it is in view', () => {
  it('name, title, company and the target match sit in the header, above the scrolling facts', () => {
    const { container } = renderPerson();
    const { body } = parts(container);
    for (const title of ['Kristin Sokol', PERSON.title, 'Sokol Studio', 'Matches your SVP target']) {
      const el = container.querySelector(`[title="${title}"]`);
      expect(el, `${title} is missing`).toBeTruthy();
      expect(body.contains(el), `${title} scrolls away`).toBe(false);
    }
    expect(body.textContent).toMatch(/COMPANY/);
  });
});

// ── Horizontal is a swipe, vertical is a scroll ─────────────────────────────
// A press is read once, after it has moved AXIS_LOCK_PX. A vertical scroll
// that drifts sideways past the decision threshold used to decide the card.
const touch = (el, type, x, y) => fireEvent[type](el, { touches: type === 'touchEnd' ? [] : [{ clientX: x, clientY: y }] });
const settle = () => act(() => { vi.advanceTimersByTime(600); });

describe.each([
  ['company', CompanySwipeCard, { company: COMPANY }],
  ['person', PersonSwipeCard, { person: PERSON, company: COMPANY }],
])('the %s card reads a press as a swipe or a scroll, once', (_, Card, props) => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const setup = () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const { container } = render(<Card {...props} onAccept={onAccept} onReject={onReject} onSkip={() => {}} fit />);
    return { el: container.firstChild, onAccept, onReject };
  };

  it('a vertical scroll that drifts far sideways neither moves nor decides the card', () => {
    const { el, onAccept, onReject } = setup();
    touch(el, 'touchStart', 100, 300);
    touch(el, 'touchMove', 102, 280);   // vertical: the press is a scroll from here on
    touch(el, 'touchMove', 260, 120);   // 160px sideways — past the threshold
    expect(el.style.transform, 'the card followed a vertical scroll').toMatch(/translateX\(0px\)/);
    touch(el, 'touchEnd');
    settle();
    expect(onAccept).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  it('a jitter below the lock distance is neither', () => {
    const { el, onAccept } = setup();
    touch(el, 'touchStart', 100, 300);
    touch(el, 'touchMove', 105, 303);
    expect(el.style.transform).toMatch(/translateX\(0px\)/);
    touch(el, 'touchEnd');
    settle();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('a horizontal swipe follows the finger and decides exactly once, even if it then turns vertical', () => {
    const { el, onAccept, onReject } = setup();
    touch(el, 'touchStart', 100, 300);
    touch(el, 'touchMove', 120, 302);   // horizontal: the press is a swipe from here on
    touch(el, 'touchMove', 160, 340);
    expect(el.style.transform, 'the card does not follow the finger').toMatch(/translateX\(60px\)/);
    touch(el, 'touchMove', 230, 400);
    touch(el, 'touchEnd');
    fireEvent.mouseUp(el);              // the compatibility events a touch release brings
    fireEvent.mouseLeave(el);
    settle();
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
  });

  it('a swipe released short of the threshold snaps back and decides nothing', () => {
    const { el, onAccept, onReject } = setup();
    touch(el, 'touchStart', 300, 300);
    touch(el, 'touchMove', 280, 300);
    touch(el, 'touchMove', 210, 305);
    touch(el, 'touchEnd');
    settle();
    expect(el.style.transform).toMatch(/translateX\(0px\)/);
    expect(onAccept).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  it('left past the threshold is Not a Match, once', () => {
    const { el, onAccept, onReject } = setup();
    touch(el, 'touchStart', 300, 300);
    touch(el, 'touchMove', 280, 300);
    touch(el, 'touchMove', 150, 310);
    touch(el, 'touchEnd');
    touch(el, 'touchStart', 300, 300);  // a second flick on the card already leaving
    touch(el, 'touchMove', 280, 300);
    touch(el, 'touchMove', 150, 310);
    touch(el, 'touchEnd');
    settle();
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });
});

describe('the page gives a phone card the screen', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, '../pages/Scout/DailyLeads.jsx'), 'utf8');

  it('below 1024px each stage takes the column\'s remaining height; desktop gets nothing new', () => {
    expect(src).toMatch(/const PHONE_STAGE = isDesktop \? null : \{ flex: '1 1 0%', minHeight: 0, display: 'flex', flexDirection: 'column' \};/);
    const stages = src.match(/<div style=\{\{ position: 'relative', width: '100%', maxWidth: isDesktop \? CARD_MAX_W \+ 20 : 440[^}]*\}\}>/g) || [];
    expect(stages).toHaveLength(2);
    // Spread last, so on a phone it overrides the desktop floor's flexShrink: 0.
    for (const stage of stages) expect(stage).toMatch(/\.\.\.PHONE_STAGE \}\}>$/);
  });

  it('both cards are told to fit on a phone, and only there', () => {
    expect(src.match(/fit=\{!isDesktop\}/g)).toHaveLength(2);
  });

  it('nothing floats over the card or the bottom nav: the queue is in the header at every width, the key hint is desktop-only', () => {
    expect(src, 'the floating queue button is back').not.toMatch(/\{!isDesktop && [^\n]*\(\s*<button\s+onClick=\{\(\) => setQueueListOpen/);
    expect(src, 'the header queue button is hidden at some width again').toMatch(/\{\(\s*<button\s+onClick=\{toggleQueueList\}\s+data-queue-trigger/);
    expect(src).toMatch(/showKeyHint && isDesktop/);
  });

  it('the save confirmation floats over the tabs on a phone instead of pushing the card down', () => {
    expect(src).toMatch(/\.\.\.\(isDesktop \? null : \{ position: 'absolute', left: 26, right: 26, zIndex: 20, pointerEvents: 'none'/);
  });
});
