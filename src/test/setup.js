import '@testing-library/jest-dom';
import { installMatchMedia } from './helpers/matchMedia';
import { installScrollIntoView } from './helpers/scrollIntoView';

// jsdom ships no `matchMedia`, and eleven application modules call it during
// render. Installed here rather than per-file because the gap is the
// environment's, not any one test's. See ./helpers/matchMedia.js.
installMatchMedia();

// Same story for `scrollIntoView`: absent from jsdom, called by twenty-four
// sites, and it throws from inside a passive effect — which vitest counts as
// an unhandled error, so the run exits non-zero while every test still reports
// as passed. See ./helpers/scrollIntoView.js.
installScrollIntoView();
