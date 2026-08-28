/**
 * Canonical `Element.prototype.scrollIntoView` shim for the test environment.
 *
 * jsdom does not implement it (verified: `typeof el.scrollIntoView` is
 * `undefined` in jsdom 28.1.0), and twenty-four application call sites across
 * twenty files call it — every Barry conversation panel scrolling its thread
 * to the newest turn, every RECON section scrolling its generated output into
 * view. No test stubs it.
 *
 * The usual call shape is `ref.current?.scrollIntoView({ behavior: 'smooth' })`.
 * That optional chain guards the ref being null; it does nothing about the
 * method being absent, so the moment a component mounts with a live ref the
 * call throws `TypeError: ... is not a function`. It throws from inside a
 * passive effect, which vitest reports as an unhandled error — the run exits
 * non-zero while every individual test still reports as passed. That is how
 * this survived: `ReconSectionEditor.test.jsx` died on `matchMedia` before its
 * component mounted far enough to reach the call, and once #586 fixed
 * `matchMedia` the error appeared behind a green-looking pass count in a file
 * CI was configured to skip.
 *
 * A no-op is the whole fix. Scrolling has no observable result in jsdom — no
 * layout, no viewport, nothing a test could assert on — so recording calls or
 * faking scroll positions would be inventing behaviour no test needs. If a
 * test ever needs to assert that a component scrolled, it should spy on this
 * method locally rather than have the shim keep state for everyone.
 *
 * Deliberately not shimmed here: `ResizeObserver` (4 unguarded call sites) and
 * `navigator.clipboard` (13 call sites, several unguarded). Both are real jsdom
 * gaps, but no current test mounts the components that reach them, so a shim
 * today would be a mock with no test behind it. They belong in whichever change
 * first needs them.
 */

/**
 * Install the shim. Idempotent, and it never replaces an existing
 * implementation — a real one, or a test's own spy, still wins.
 */
export function installScrollIntoView() {
  if (typeof Element === 'undefined') return;
  if (typeof Element.prototype.scrollIntoView === 'function') return;
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
