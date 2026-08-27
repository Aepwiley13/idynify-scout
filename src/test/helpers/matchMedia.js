/**
 * Canonical `window.matchMedia` shim for the test environment.
 *
 * jsdom does not implement `matchMedia` (still true as of jsdom 28), and
 * eleven application modules call it unguarded — every module shell reads
 * `window.matchMedia('(max-width: 768px)')` during render, and
 * ReconSectionEditor reads `'(max-width: 900px)'`. A component that touches
 * one of them throws `window.matchMedia is not a function` before it renders
 * a single node.
 *
 * Six test files had each hand-rolled their own copy of this stub. Two of
 * them carry comments recording the same discovery twice over: specs that
 * looked green while only ever asserting that the component crashed. This is
 * that stub, once, behaving like the real API instead of returning a frozen
 * `false`.
 *
 * `matches` is a live getter over `window.innerWidth` (jsdom defaults to
 * 1024 — desktop, which is the arrangement with the locked nav order), so a
 * test that never mentions the viewport gets the same desktop answer the
 * hand-rolled stubs gave. A test that wants the other arrangement calls
 * `setViewportWidth(375)` and the registered `change` listeners fire, the way
 * a real resize would.
 */

const WIDTH_QUERY = /\(\s*(max|min)-width:\s*(\d+(?:\.\d+)?)px\s*\)/i;

/** Live MediaQueryList objects, so a viewport change can notify them. */
const live = new Set();

/**
 * Evaluate the subset of media queries this codebase actually writes:
 * `(max-width: Npx)` and `(min-width: Npx)`. Anything else reports `false`
 * rather than guessing — a wrong `true` is far harder to debug than a
 * conservative `false`.
 */
function evaluate(query) {
  const match = WIDTH_QUERY.exec(String(query));
  if (!match) return false;
  const width = window.innerWidth;
  const bound = parseFloat(match[2]);
  return match[1].toLowerCase() === 'max' ? width <= bound : width >= bound;
}

function createMediaQueryList(query) {
  const media = String(query);
  const listeners = new Set();

  const mql = {
    media,
    onchange: null,
    get matches() {
      return evaluate(media);
    },
    addEventListener(type, listener) {
      if (type === 'change' && listener) listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'change') listeners.delete(listener);
    },
    // Deprecated in the browser but still what some libraries reach for.
    addListener(listener) {
      if (listener) listeners.add(listener);
    },
    removeListener(listener) {
      listeners.delete(listener);
    },
    dispatchEvent(event) {
      mql._notify(event?.matches ?? mql.matches);
      return true;
    },
    _notify(matches) {
      const event = { matches, media, type: 'change' };
      if (typeof mql.onchange === 'function') mql.onchange(event);
      for (const listener of listeners) {
        if (typeof listener === 'function') listener(event);
        else if (typeof listener?.handleEvent === 'function') listener.handleEvent(event);
      }
    },
  };

  return mql;
}

/**
 * Install the shim. Idempotent, and it never overwrites a `matchMedia` that
 * something else has already provided — a test file that assigns its own stub
 * still wins, which is what keeps the existing local stubs working untouched.
 */
export function installMatchMedia() {
  if (typeof window === 'undefined' || typeof window.matchMedia === 'function') return;
  live.clear();
  window.matchMedia = (query) => {
    const mql = createMediaQueryList(query);
    live.add(mql);
    return mql;
  };
}

/**
 * Move the viewport and fire `change` on every live query whose answer moved.
 * Use this instead of reassigning `window.matchMedia` in new tests.
 */
export function setViewportWidth(width) {
  const before = new Map();
  for (const mql of live) before.set(mql, mql.matches);

  window.innerWidth = width;

  for (const mql of live) {
    const now = mql.matches;
    if (before.get(mql) !== now) mql._notify(now);
  }
}
