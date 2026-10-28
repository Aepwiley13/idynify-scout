/**
 * ONE DISCOVERY, ONE CARD — Daily Discoveries on a phone.
 *
 * Below 1024px (`fit`) a discovery is one screen-sized card, like a dating
 * profile: the company's logo or the person's photo first, then who or what
 * it is and why it might fit, then Not a Match / Match. The card never
 * scrolls. Everything deeper — the full ICP breakdown, Barry Intel, the
 * company facts, Website and LinkedIn — is in a Details sheet over the same
 * card, opened from Details or by swiping up, with the decision at its foot.
 *
 * The gesture model this pins: a press is read once as horizontal (a swipe,
 * which decides past the threshold and otherwise snaps back) or vertical
 * (which never moves or decides the card; far enough up, it opens Details).
 * The sheet owns every touch inside it.
 *
 * Desktop (`wide`, no `fit`) is unchanged; dailyDiscoveryCardNoNestedScroll
 * holds its rules. jsdom does no layout: these pin the structure and the
 * behaviour, and the PR records the measured sizes at 375–430px.
 */

import { createRef } from 'react';
import { render, fireEvent, act, within, screen } from '@testing-library/react';
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
// The card's reasons come from the ICP breakdown. A fixed one lets these tests
// say exactly which reasons show, in what order.
const breakdown = vi.hoisted(() => ({ current: null }));
vi.mock('../utils/icpScoring', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getScoreBreakdown: (...args) => breakdown.current ?? actual.getScoreBreakdown(...args) };
});

import { CompanySwipeCard, PersonSwipeCard } from '../pages/Scout/DailyLeads.jsx';

const row = (match, extra = {}) => ({ match, active: true, unknown: false, contribution: match, weight: 25, value: null, ...extra });
const NOT_MEASURED = { match: 0, active: true, unknown: true, contribution: null, weight: 10, value: null };

const COMPANY = {
  id: 'co1',
  name: 'Sokol Studio',
  industry: 'Information Technology & Services',
  headquarters_city: 'Salt Lake City',
  headquarters_state: 'Utah',
  employee_count: 1250,
  revenue: '$50M–$100M',
  founded_year: 2004,
  ceo_name: 'Dana Reyes',
  fit_score: 82,
  website_url: 'https://sokol.example',
  linkedin_url: 'https://www.linkedin.com/company/sokol-example',
  barry_intel: 'A long-established enterprise software consultancy with deep ties to regional healthcare systems.',
};
const PERSON = {
  id: 'p1', name: 'Kristin Sokol', title: 'Senior Vice President, Sales',
  seniority: 'vp', departments: ['master_sales'], city: 'Salt Lake City', state: 'Utah',
  photo_url: 'https://media.licdn.com/dms/image/kristin-sokol.jpg',
  linkedin_url: 'https://www.linkedin.com/in/kristin-sokol-example',
};
const ICP = { industries: ['Information Technology & Services'] };

const SCROLLING = ['auto', 'scroll', 'overlay'];
const noop = () => {};
const renderCompany = (props = {}) => render(
  <CompanySwipeCard company={COMPANY} onAccept={noop} onReject={noop} onSkip={noop} fit icpProfile={ICP} {...props} />,
);
const renderPerson = (props = {}) => render(
  <PersonSwipeCard person={PERSON} company={COMPANY} matchText="Matches your Senior Vice President target" onAccept={noop} onReject={noop} onSkip={noop} fit {...props} />,
);
const parts = (container) => {
  const root = container.firstChild;
  const surface = [...root.children].reverse().find(el => el.style.borderRadius === '22px');
  return { root, surface };
};
const button = (scope, name) => within(scope).getByRole('button', { name });
const sheet = () => document.querySelector('[data-details-sheet]');
const settle = () => act(() => { vi.advanceTimersByTime(600); });
const touch = (el, type, x, y) => fireEvent[type](el, { touches: type === 'touchEnd' ? [] : [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x ?? 0, clientY: y ?? 0 }] });

beforeEach(() => { breakdown.current = null; });

describe.each([['company', renderCompany], ['person', renderPerson]])('on a phone the %s card is one screen and never scrolls', (_, renderCard) => {
  it('fills the stage instead of carrying a height of its own', () => {
    const { root, surface } = parts(renderCard().container);
    for (const [name, el] of [['swipe root', root], ['card surface', surface]]) {
      expect(el.style.flex, `${name} does not fill`).toBe('1 1 0%');
      expect(el.style.minHeight).toBe('0px');
      expect(el.style.height, `${name} pins a height`).toBe('');
      expect(el.style.maxHeight, `${name} caps its height`).toBe('');
    }
    expect(surface.style.overflow, 'the surface only clips its corners').toBe('hidden');
    expect(root.style.touchAction, 'vertical touch must stay with the browser').toBe('pan-y');
  });

  it('has nothing inside it that scrolls', () => {
    const { container } = renderCard();
    const scrollers = [...container.querySelectorAll('*')]
      .filter(el => SCROLLING.includes(el.style.overflowY) || SCROLLING.includes(el.style.overflow));
    expect(scrollers).toEqual([]);
  });

  it('decides with Not a Match and Match on the card; Skip lives below it', () => {
    const { container } = renderCard();
    expect(button(container, /Not a Match/)).toBeTruthy();
    expect(button(container, /^Match$/)).toBeTruthy();
    expect(within(container).queryByRole('button', { name: /Skip/ }), 'Skip is on the card again').toBeNull();
  });

  it('Details opens a sheet over the card that owns its own scrolling, with the decision at its foot; ✕ closes it', () => {
    const { container } = renderCard();
    expect(sheet()).toBeNull();
    fireEvent.click(button(container, 'Details'));
    const dialog = screen.getByRole('dialog');
    expect(sheet().parentElement, 'the sheet covers the page, not just the card').toBe(document.body);
    const body = dialog.querySelector('[data-sheet-body]');
    expect(body.style.overflowY).toBe('auto');
    expect(body.style.overscrollBehavior).toBe('contain');
    expect(button(dialog, /Not a Match/)).toBeTruthy();
    expect(button(dialog, /^Match$/)).toBeTruthy();
    fireEvent.click(button(dialog, 'Close details'));
    expect(sheet()).toBeNull();
    expect(container.firstChild.style.transform).toMatch(/translateX\(0px\)/);
  });
});

describe('the phone company card: the company first, then why it might fit', () => {
  it('logo, confidence, name, industry · HQ, ICP match, and one line of size', () => {
    const { container, getByTestId } = renderCompany();
    expect(getByTestId('logo')).toBeTruthy();
    expect(container.textContent).toMatch(/High confidence/i);
    expect(container.querySelector('[title="Sokol Studio"]')).toBeTruthy();
    expect(container.querySelector('[title*="Salt Lake City"]').textContent).toMatch(/·/);
    expect(within(container).getByTestId('icp-match-chip').textContent).toBe('82% ICP match');
    expect(container.textContent).toMatch(/Strong Fit/);
    expect(container.textContent).toMatch(/1,250 employees · \$50M–\$100M revenue/);
  });

  it('keeps the rest for Details: no Barry Intel, stats grid or links on the card', () => {
    const { container } = renderCompany();
    expect(container.textContent).not.toMatch(/BARRY INTEL|FOUNDED/);
    expect(container.querySelector('a')).toBeNull();
  });

  it('shows up to three reasons, strongest first; a factor with no data is not one', () => {
    breakdown.current = {
      industry: row(50), location: row(100, { value: 'Utah' }), employeeSize: row(0), revenue: NOT_MEASURED,
    };
    const { container } = renderCompany();
    const reasons = [...container.querySelectorAll('[data-reason]')];
    expect(reasons.map(r => [r.dataset.reason, r.textContent])).toEqual([
      ['matched', '✓In your target region: Utah'],
      ['partial', '≈Related to your target industry'],
      ['missed', '✗Size outside your range'],
    ]);
  });

  it('never more than three, however many matched', () => {
    breakdown.current = { industry: row(100), location: row(100), employeeSize: row(100), revenue: row(100) };
    expect(renderCompany().container.querySelectorAll('[data-reason]')).toHaveLength(3);
  });

  it('a short screen (an SE) shows two, so the card still fits without scrolling', () => {
    breakdown.current = { industry: row(100), location: row(100), employeeSize: row(100), revenue: row(100) };
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb) { this.cb = cb; }
      observe() { this.cb([{ contentRect: { height: 386 } }]); }
      disconnect() {}
    };
    try {
      expect(renderCompany().container.querySelectorAll('[data-reason]')).toHaveLength(2);
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  it('its sheet holds everything the card left out: the full breakdown, Barry Intel, facts, Website and LinkedIn', () => {
    breakdown.current = { industry: row(100), location: row(100), employeeSize: row(50), revenue: NOT_MEASURED };
    const { container } = renderCompany();
    fireEvent.click(button(container, 'Details'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Sokol Studio details');
    expect(dialog.textContent).toMatch(/ICP MATCH/);
    expect(dialog.textContent).toMatch(/not measured/);
    expect(dialog.textContent).toMatch(/BARRY INTEL/);
    expect(dialog.textContent).toMatch(/FOUNDED/);
    expect(dialog.textContent).toMatch(/Dana Reyes/);
    expect(dialog.querySelector('a[href="https://sokol.example"]')).toBeTruthy();
    expect(dialog.querySelector('a[href="https://www.linkedin.com/company/sokol-example"]')).toBeTruthy();
  });
});

describe('the phone person card: the person first, and no made-up score', () => {
  it('a real Apollo photo fills the picture; name, title @ company and city sit on it', () => {
    const { container } = renderPerson();
    expect(container.querySelector('img').getAttribute('src')).toBe(PERSON.photo_url);
    expect(container.querySelector('[title="Kristin Sokol"]')).toBeTruthy();
    expect(container.querySelector('[title="Senior Vice President, Sales @ Sokol Studio"]')).toBeTruthy();
    expect(container.textContent).toMatch(/Salt Lake City, Utah/);
  });

  it('no photo, a placeholder, or one that fails to load: initials, in the same layout', () => {
    for (const photo_url of [null, 'https://static.licdn.com/sc/h/ghost-person.png']) {
      const { container, unmount } = renderPerson({ person: { ...PERSON, photo_url } });
      expect(container.querySelector('img')).toBeNull();
      expect(container.textContent).toMatch(/KS/);
      unmount();
    }
    const { container } = renderPerson();
    fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toMatch(/KS/);
  });

  it('the target-title statement and the strongest signals; the company\'s ICP match is the only percentage', () => {
    const { container } = renderPerson();
    expect(container.textContent).toMatch(/Matches your Senior Vice President target/);
    expect([...container.querySelectorAll('[data-reason]')].map(r => r.textContent)).toEqual([
      '✓Decision maker · VP level', '•Sales department', '✓Company: 82% ICP match',
    ]);
    expect(container.textContent.match(/\d+%[^\d]{0,10}/g)).toEqual(['82% ICP match']);
  });

  it('a signal we do not have is left out, not guessed', () => {
    const { container } = renderPerson({ person: { ...PERSON, seniority: null, departments: [] }, company: { ...COMPANY, fit_score: undefined } });
    expect(container.querySelectorAll('[data-reason]')).toHaveLength(0);
  });

  it('its sheet: why this person, their company, Barry Intel and the links', () => {
    const { container } = renderPerson();
    fireEvent.click(button(container, 'Details'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Kristin Sokol details');
    expect(dialog.textContent).toMatch(/WHY THIS PERSON/);
    expect(dialog.textContent).toMatch(/Decision maker · VP level/);
    expect(dialog.textContent).toMatch(/THEIR COMPANY/);
    expect(dialog.textContent).toMatch(/82% ICP match/);
    expect(dialog.textContent).toMatch(/BARRY INTEL/);
    expect(dialog.querySelector(`a[href="${PERSON.linkedin_url}"]`)).toBeTruthy();
  });
});

// ── Gestures: horizontal decides, vertical never does ───────────────────────
describe.each([
  ['company', CompanySwipeCard, { company: COMPANY }, 'co1'],
  ['person', PersonSwipeCard, { person: PERSON, company: COMPANY }, 'co1_p1'],
])('the %s card reads a press once', (_, Card, props, subjectId) => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const setup = (extra = {}) => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const onSkip = vi.fn();
    const skipRef = createRef();
    const { container } = render(<Card {...props} onAccept={onAccept} onReject={onReject} onSkip={onSkip} skipRef={skipRef} fit {...extra} />);
    return { el: container.firstChild, container, onAccept, onReject, onSkip, skipRef };
  };
  const press = (el, points) => {
    touch(el, 'touchStart', ...points[0]);
    for (const p of points.slice(1)) touch(el, 'touchMove', ...p);
    touch(el, 'touchEnd', ...points[points.length - 1]);
  };

  it('a vertical press that drifts far sideways neither moves nor decides the card', () => {
    const { el, onAccept, onReject } = setup();
    touch(el, 'touchStart', 100, 300);
    touch(el, 'touchMove', 102, 320);
    touch(el, 'touchMove', 260, 420);
    expect(el.style.transform).toMatch(/translateX\(0px\)/);
    touch(el, 'touchEnd', 260, 420);
    settle();
    expect(onAccept).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
    expect(sheet(), 'a downward press opened Details').toBeNull();
  });

  it('a swipe up opens Details and decides nothing; a short one does neither', () => {
    const { el, onAccept, onReject } = setup();
    press(el, [[100, 300], [101, 290], [102, 270]]);
    expect(sheet(), '30px up opened Details').toBeNull();
    press(el, [[100, 300], [101, 290], [104, 200]]);
    settle();
    expect(sheet()).not.toBeNull();
    expect(onAccept).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  it('nothing inside the sheet can drag or decide the card behind it', () => {
    const { el, container, onAccept, onReject } = setup();
    fireEvent.click(button(container, 'Details'));
    const body = sheet().querySelector('[data-sheet-body]');
    press(body, [[50, 400], [70, 401], [300, 405]]);
    fireEvent.mouseDown(body, { clientX: 50, clientY: 400 });
    fireEvent.mouseMove(body, { clientX: 300, clientY: 400 });
    fireEvent.mouseUp(body, { clientX: 300, clientY: 400 });
    settle();
    expect(el.style.transform).toMatch(/translateX\(0px\)/);
    expect(onAccept).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  it('Match in the sheet closes it and takes the card\'s own path: the feedback face, then one decision', () => {
    const { container, onAccept } = setup();
    fireEvent.click(button(container, 'Details'));
    fireEvent.click(button(screen.getByRole('dialog'), /^Match$/));
    expect(sheet()).toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.click(within(container).getAllByRole('button', { name: /^Skip$/ })[0]);
    settle();
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept.mock.calls[0]).toContain(subjectId);
  });

  it('a horizontal swipe follows the finger and decides exactly once', () => {
    const { el, onAccept, onReject } = setup();
    touch(el, 'touchStart', 100, 300);
    touch(el, 'touchMove', 120, 302);
    touch(el, 'touchMove', 160, 340);
    expect(el.style.transform).toMatch(/translateX\(60px\)/);
    touch(el, 'touchMove', 230, 400);
    touch(el, 'touchEnd', 230, 400);
    fireEvent.mouseUp(el);
    fireEvent.mouseLeave(el);
    settle();
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
  });

  it('a swipe released short of the threshold snaps back and decides nothing', () => {
    const { el, onAccept, onReject } = setup();
    press(el, [[300, 300], [280, 300], [210, 305]]);
    settle();
    expect(el.style.transform).toMatch(/translateX\(0px\)/);
    expect(onAccept).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  it('left past the threshold is Not a Match, once, however fast the second flick', () => {
    const { el, onAccept, onReject } = setup();
    press(el, [[300, 300], [280, 300], [150, 310]]);
    press(el, [[300, 300], [280, 300], [150, 310]]);
    settle();
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('Skip below the card goes through the card\'s latch: once, and never after a decision', () => {
    const first = setup();
    act(() => { first.skipRef.current(); first.skipRef.current(); });
    expect(first.onSkip).toHaveBeenCalledTimes(1);
    expect(first.onSkip).toHaveBeenCalledWith(subjectId);

    const second = setup();
    press(second.el, [[300, 300], [280, 300], [150, 310]]);
    act(() => { second.skipRef.current(); });
    settle();
    expect(second.onSkip).not.toHaveBeenCalled();
    expect(second.onReject).toHaveBeenCalledTimes(1);
  });
});

describe('without `fit` the cards are the desktop cards they were', () => {
  it('no Details sheet, no swipe-up, Skip on the card', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<CompanySwipeCard company={COMPANY} onAccept={noop} onReject={noop} onSkip={noop} wide />);
      expect(within(container).queryByRole('button', { name: 'Details' })).toBeNull();
      expect(within(container).getByRole('button', { name: /Skip for now/ })).toBeTruthy();
      expect(container.textContent).toMatch(/This is a Match/);
      const el = container.firstChild;
      touch(el, 'touchStart', 100, 300);
      touch(el, 'touchMove', 101, 290);
      touch(el, 'touchMove', 104, 150);
      touch(el, 'touchEnd', 104, 150);
      settle();
      expect(sheet()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the page gives a phone card the screen', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, '../pages/Scout/DailyLeads.jsx'), 'utf8');

  it('below 1024px each stage takes the column\'s remaining height; desktop gets nothing new', () => {
    expect(src).toMatch(/const PHONE_STAGE = isDesktop \? null : \{ flex: '1 1 0%', minHeight: 0, display: 'flex', flexDirection: 'column' \};/);
    const stages = src.match(/<div style=\{\{ position: 'relative', width: '100%', maxWidth: isDesktop \? CARD_MAX_W \+ 20 : 440[^}]*\}\}>/g) || [];
    expect(stages).toHaveLength(2);
    for (const stage of stages) expect(stage).toMatch(/\.\.\.PHONE_STAGE \}\}>$/);
  });

  it('both cards are told to fit on a phone, and only there, each with its Skip handle', () => {
    expect(src.match(/fit=\{!isDesktop\}/g)).toHaveLength(2);
    expect(src).toMatch(/skipRef=\{companySkipRef\}/);
    expect(src).toMatch(/skipRef=\{personSkipRef\}/);
  });

  it('on a phone Skip is below the card and goes through the card\'s own handle', () => {
    expect(src).toMatch(/onClick=\{\(\) => companySkipRef\.current\?\.\(\)\}[\s\S]{0,300}Skip for now/);
    expect(src).toMatch(/onClick=\{\(\) => personSkipRef\.current\?\.\(\)\}[\s\S]{0,300}Skip for today/);
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
