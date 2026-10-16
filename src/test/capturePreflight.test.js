/**
 * Photo quality checks (architecture section 17): blur, glare and darkness on
 * a ~512 px-wide RGBA copy. Pure functions over pixel arrays, so these run
 * without a canvas. The output must be exactly card-image/v1's preflight.
 */
import { describe, it, expect } from 'vitest';
import {
  THRESHOLDS, ANALYSIS_WIDTH_PX, lumaOf, toLuma, laplacianVariance, lumaStats, glareStats, assessQuality,
} from '../components/capture/preflight.js';
import { validatePreflight } from '../capture/preparedImage.js';

const W = 512;
const H = 300;

/** An RGBA image from a luma function of (x, y). */
function image(fn, width = W, height = H) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = fn(x, y);
      const p = (y * width + x) * 4;
      data[p] = v; data[p + 1] = v; data[p + 2] = v; data[p + 3] = 255;
    }
  }
  return { width, height, data };
}

// A sharp, well-lit card: fine text-like detail on a light background, nothing near white.
const sharpCard = (x, y) => ((Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 40 : 200);
const inCentralSquare = (x, y, share) => {
  const side = Math.sqrt(share * (W * 0.8) * (H * 0.8));
  return Math.abs(x - W / 2) < side / 2 && Math.abs(y - H / 2) < side / 2;
};

describe('thresholds', () => {
  it('are the architecture starting values', () => {
    expect(ANALYSIS_WIDTH_PX).toBe(512);
    expect(THRESHOLDS).toEqual({
      blurBelow: 60, darkMeanBelow: 60, lowContrastStdBelow: 20,
      glareLuma: 250, glareRatioAtLeast: 0.03, glareRegionAtLeast: 0.01, centralMargin: 0.1,
    });
  });
});

describe('measurements', () => {
  it('luma is Rec. 601', () => {
    expect(lumaOf(255, 255, 255)).toBeCloseTo(255);
    expect(lumaOf(255, 0, 0)).toBeCloseTo(76.245);
    expect(toLuma(image(() => 100, 4, 4)).luma.every(v => Math.abs(v - 100) < 1e-3)).toBe(true);
  });

  it('a sharp image has a high Laplacian variance, a flat one none', () => {
    expect(laplacianVariance(toLuma(image(sharpCard)))).toBeGreaterThan(1000);
    expect(laplacianVariance(toLuma(image(() => 128)))).toBe(0);
    expect(laplacianVariance(toLuma(image(x => x / 2)))).toBeLessThan(1);
  });

  it('mean and spread of luma', () => {
    const { mean, std } = lumaStats(toLuma(image(sharpCard)));
    expect(mean).toBeCloseTo(120, 0);
    expect(std).toBeCloseTo(80, 0);
  });

  it('glare counts only the central 80%, and finds the largest connected bright region', () => {
    const edgeBand = image((x, y) => (y < H * 0.08 ? 255 : sharpCard(x, y)));
    expect(glareStats(toLuma(edgeBand))).toEqual({ ratio: 0, largestRegion: 0 });
    const patch = glareStats(toLuma(image((x, y) => (inCentralSquare(x, y, 0.05) ? 255 : sharpCard(x, y)))));
    expect(patch.ratio).toBeCloseTo(0.05, 2);
    expect(patch.largestRegion).toBeCloseTo(0.05, 2);
  });
});

describe('assessQuality', () => {
  it('a good photo has no warnings', () => {
    const result = assessQuality(image(sharpCard));
    expect(result.warnings).toEqual([]);
    expect(result.userOverrode).toBe(false);
  });

  it('blurry: a smooth gradient with good contrast and no white', () => {
    expect(assessQuality(image(x => 40 + (x * 200) / (W - 1))).warnings).toEqual(['blurry']);
  });

  it('glare from one bright patch over 3% of the centre', () => {
    expect(assessQuality(image((x, y) => (inCentralSquare(x, y, 0.05) ? 255 : sharpCard(x, y)))).warnings).toEqual(['glare']);
  });

  it('no glare from scattered bright specks, even over 3%', () => {
    // Every 25th pixel is white and isolated: about 4% bright, no region over a pixel.
    const specks = assessQuality(image((x, y) => ((x * 7 + y * 13) % 25 === 0 ? 255 : sharpCard(x, y))));
    expect(specks.glareRatio).toBeGreaterThan(0.03);
    expect(specks.warnings).toEqual([]);
  });

  it('no glare from a bright patch under 3%', () => {
    expect(assessQuality(image((x, y) => (inCentralSquare(x, y, 0.02) ? 255 : sharpCard(x, y)))).warnings).toEqual([]);
  });

  it('dark from a low mean', () => {
    expect(assessQuality(image((x, y) => sharpCard(x, y) / 5)).warnings).toEqual(['dark']);
  });

  it('dark from low contrast', () => {
    expect(assessQuality(image((x, y) => 120 + ((Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 0 : 30))).warnings).toEqual(['dark']);
  });

  it('several warnings come in display order: blurry, glare, dark', () => {
    const veryDarkFlat = assessQuality(image(() => 20));
    expect(veryDarkFlat.warnings).toEqual(['blurry', 'dark']);
    // A soft glare spot (white core about 4% of the centre, a 60 px ramp) on a dark, flat card.
    const softSpot = (x, y) => {
      const d = Math.hypot(x - W / 2, y - H / 2);
      return d < 35 ? 255 : d < 95 ? 255 - ((d - 35) * 230) / 60 : 25;
    };
    expect(assessQuality(image(softSpot)).warnings).toEqual(['blurry', 'glare', 'dark']);
  });

  it('always produces a valid card-image/v1 preflight', () => {
    for (const fn of [sharpCard, () => 0, () => 255, x => x % 256, (x, y) => (x + y) % 2 ? 255 : 0]) {
      const result = assessQuality(image(fn));
      expect(validatePreflight(result)).toEqual({ ok: true });
      expect(Object.keys(result)).toEqual(['blur', 'brightness', 'glareRatio', 'warnings', 'userOverrode']);
    }
  });

  it('handles a portrait copy and tiny inputs without throwing', () => {
    expect(validatePreflight(assessQuality(image(sharpCard, 512, 683)))).toEqual({ ok: true });
    expect(validatePreflight(assessQuality(image(() => 128, 2, 2)))).toEqual({ ok: true });
  });
});
