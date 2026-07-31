import { useEffect, useState } from 'react';

/** The one breakpoint. Matches `@media (max-width: 768px)` across the shell. */
export const MOBILE_QUERY = '(max-width: 768px)';

/**
 * Is the viewport phone-sized?
 *
 * Every module already had its own copy of this six-line block. It is a hook
 * here because the sidebar now needs it for a reason CSS cannot serve: it
 * renders the module list in two arrangements — flat on desktop, grouped in
 * the mobile drawer — and hiding one with `display: none` would leave two
 * `<nav aria-label="Global navigation">` landmarks in the DOM. That is one
 * stylesheet failure away from showing both, and it makes every query in a
 * test ambiguous. Only one is built.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    // Guard for non-browser environments and for jsdom setups that have not
    // stubbed matchMedia — falling back to desktop is the safer default,
    // since desktop is the arrangement with the locked order.
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(MOBILE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = (e) => setIsMobile(e.matches);

    // No re-read on mount: the initialiser above already read the same
    // `matches`, and setting state in the effect body only to arrive at the
    // value already held costs a second render on every mount.
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
