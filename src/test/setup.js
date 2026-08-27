import '@testing-library/jest-dom';
import { installMatchMedia } from './helpers/matchMedia';

// jsdom ships no `matchMedia`, and eleven application modules call it during
// render. Installed here rather than per-file because the gap is the
// environment's, not any one test's. See ./helpers/matchMedia.js.
installMatchMedia();
