/**
 * Photo quality checks for a business card (architecture section 17).
 *
 * Pure functions over a plain { width, height, data } RGBA image, the shape
 * of a canvas ImageData, so they run in tests without a canvas. The caller
 * passes a copy about 512 px wide; the numbers below are tuned for that size.
 *
 *   blurry  variance of the Laplacian below 60
 *   glare   at least 3% of the central 80% at luma >= 250, with one connected
 *           bright region of at least 1% of that area
 *   dark    mean luma below 60, or luma standard deviation below 20
 *
 * Starting values from the architecture; the golden set tunes them so at most
 * 5% of good photos warn. Warnings are reported in display order: blurry,
 * glare, dark. "Too small" is not here: it is a hard stop in imagePrep.
 *
 * The result is exactly card-image/v1's preflight object
 * (src/capture/preparedImage.js), with userOverrode false until the user
 * chooses "Use anyway".
 */
import { PREFLIGHT_WARNINGS } from '../../capture/preparedImage.js';

export const ANALYSIS_WIDTH_PX = 512;

export const THRESHOLDS = Object.freeze({
  blurBelow: 60,
  darkMeanBelow: 60,
  lowContrastStdBelow: 20,
  glareLuma: 250,
  glareRatioAtLeast: 0.03,
  glareRegionAtLeast: 0.01,
  centralMargin: 0.1,
});

/** Rec. 601 luma, as the architecture specifies. */
export function lumaOf(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Grayscale copy: one luma value per pixel. */
export function toLuma({ width, height, data }) {
  const luma = new Float32Array(width * height);
  for (let i = 0, p = 0; i < luma.length; i += 1, p += 4) luma[i] = lumaOf(data[p], data[p + 1], data[p + 2]);
  return { width, height, luma };
}

/** Variance of the 4-neighbour Laplacian over interior pixels. Higher is sharper. */
export function laplacianVariance({ width, height, luma }) {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const v = luma[i - width] + luma[i + width] + luma[i - 1] + luma[i + 1] - 4 * luma[i];
      sum += v;
      sumSq += v * v;
      n += 1;
    }
  }
  const mean = sum / n;
  return Math.max(0, sumSq / n - mean * mean);
}

/** Mean and standard deviation of luma. */
export function lumaStats({ luma }) {
  let sum = 0;
  let sumSq = 0;
  for (const v of luma) { sum += v; sumSq += v * v; }
  const mean = luma.length ? sum / luma.length : 0;
  const variance = luma.length ? Math.max(0, sumSq / luma.length - mean * mean) : 0;
  return { mean, std: Math.sqrt(variance) };
}

/**
 * Glare in the central 80%: the share of near-white pixels, and the largest
 * 4-connected near-white region as a share of the same area.
 */
export function glareStats({ width, height, luma }, { glareLuma, centralMargin } = THRESHOLDS) {
  const x0 = Math.floor(width * centralMargin);
  const y0 = Math.floor(height * centralMargin);
  const w = width - 2 * x0;
  const h = height - 2 * y0;
  const area = w * h;
  if (area <= 0) return { ratio: 0, largestRegion: 0 };

  const bright = new Uint8Array(area);
  let count = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (luma[(y + y0) * width + (x + x0)] >= glareLuma) { bright[y * w + x] = 1; count += 1; }
    }
  }

  let largest = 0;
  const stack = [];
  for (let start = 0; start < area; start += 1) {
    if (bright[start] !== 1) continue;
    bright[start] = 2;
    stack.push(start);
    let size = 0;
    while (stack.length) {
      const i = stack.pop();
      size += 1;
      const x = i % w;
      const neighbours = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const j of neighbours) {
        if (j >= 0 && j < area && bright[j] === 1) { bright[j] = 2; stack.push(j); }
      }
    }
    if (size > largest) largest = size;
  }
  return { ratio: count / area, largestRegion: largest / area };
}

const round = (v, places) => Math.round(v * 10 ** places) / 10 ** places;

/**
 * Assess a ~512 px-wide RGBA copy of the prepared photo. Returns the
 * card-image/v1 preflight object with userOverrode false.
 */
export function assessQuality(image, thresholds = THRESHOLDS) {
  const gray = toLuma(image);
  const blur = laplacianVariance(gray);
  const { mean, std } = lumaStats(gray);
  const glare = glareStats(gray, thresholds);

  const found = new Set();
  if (blur < thresholds.blurBelow) found.add('blurry');
  if (glare.ratio >= thresholds.glareRatioAtLeast && glare.largestRegion >= thresholds.glareRegionAtLeast) found.add('glare');
  if (mean < thresholds.darkMeanBelow || std < thresholds.lowContrastStdBelow) found.add('dark');

  return {
    blur: round(blur, 2),
    brightness: round(Math.min(255, Math.max(0, mean)), 2),
    glareRatio: round(Math.min(1, Math.max(0, glare.ratio)), 4),
    warnings: PREFLIGHT_WARNINGS.filter(w => found.has(w)),
    userOverrode: false,
  };
}
