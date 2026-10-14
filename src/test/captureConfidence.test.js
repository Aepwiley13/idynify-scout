/**
 * Capture confidence: the steps run in a fixed order, and each may only do
 * what the module header says it may.
 */
import { describe, it, expect } from 'vitest';
import { computeExtractionLevel, levelFromScore, STEPS, SAFEGUARD_FIELD_CAPS } from '../capture/confidence.js';
import { CHECKS } from '../capture/validators.js';
import { SAFEGUARDS } from '../capture/safeguards.js';

const level = input => computeExtractionLevel(input).level;

describe('1 — score bands', () => {
  it.each([[0.99, 'confirmed'], [0.95, 'confirmed'], [0.9, 'likely'], [0.8, 'likely'], [0.6, 'possible'], [0.5, 'possible'], [0.49, 'unknown'], [NaN, 'unknown'], [undefined, 'unknown']])(
    '%j → %j', (score, expected) => { expect(levelFromScore(score)).toBe(expected); },
  );

  it('runs the steps in the documented order', () => {
    expect(STEPS).toEqual(['score', 'validation', 'safeguards', 'witness', 'image', 'inference', 'user']);
  });
});

describe('2 — validation only lowers', () => {
  it('a failing check forces unknown, however high the score', () => {
    expect(level({ score: 0.99, checks: [CHECKS.EMAIL_SYNTAX_INVALID] })).toBe('unknown');
  });

  it('a doubt (OCR) caps at possible and sends to review', () => {
    expect(computeExtractionLevel({ score: 0.99, checks: [CHECKS.OCR_SUSPECTED] })).toMatchObject({ level: 'possible', requiresReview: true });
  });

  it('a passing check changes nothing', () => {
    expect(level({ score: 0.9, checks: [CHECKS.EMAIL_SYNTAX_OK] })).toBe('likely');
  });

  it('an unresolved phone country is informational only', () => {
    expect(level({ score: 0.9, checks: [CHECKS.PHONE_OK, CHECKS.PHONE_COUNTRY_UNRESOLVED] })).toBe('likely');
  });
});

describe('3 — safeguards only lower, and only when the reading is in doubt', () => {
  it.each(Object.entries(SAFEGUARD_FIELD_CAPS))('%s caps at %s', (code, cap) => {
    expect(level({ score: 0.99, safeguards: [code] })).toBe(cap);
  });

  it.each([SAFEGUARDS.FREE_EMAIL_DOMAIN, SAFEGUARDS.ISP_EMAIL_DOMAIN, SAFEGUARDS.ROLE_EMAIL, SAFEGUARDS.SHARED_HOST_DOMAIN, SAFEGUARDS.GENERIC_COMPANY_NAME, SAFEGUARDS.MISSING_DOMAIN])(
    '%s says nothing about the reading: the level is untouched',
    (code) => { expect(level({ score: 0.99, safeguards: [code] })).toBe('confirmed'); },
  );
});

describe('4 — the witness is the only automated step that can raise', () => {
  it('agree raises to confirmed', () => {
    expect(level({ score: 0.85, witnessed: true, witness: 'agree' })).toBe('confirmed');
  });

  it('agree never lifts a cap from validation or safeguards', () => {
    expect(level({ score: 0.99, checks: [CHECKS.OCR_SUSPECTED], witnessed: true, witness: 'agree' })).toBe('possible');
    expect(level({ score: 0.99, checks: [CHECKS.URL_INVALID], witnessed: true, witness: 'agree' })).toBe('unknown');
  });

  it.each(['minor_mismatch', 'contradicted'])('%s caps at possible', (witness) => {
    expect(level({ score: 0.99, witnessed: true, witness })).toBe('possible');
  });

  it.each(['absent', 'skipped', null])('%j caps an identifier at likely', (witness) => {
    expect(level({ score: 0.99, witnessed: true, witness })).toBe('likely');
  });

  it('fields the witness does not check are unaffected', () => {
    expect(level({ score: 0.99, witnessed: false, witness: null })).toBe('confirmed');
  });
});

describe('5 and 6 — image and inference caps', () => {
  it('a photo kept through "Use anyway" caps at likely', () => {
    expect(level({ score: 0.99, imageOverridden: true })).toBe('likely');
  });

  it('an inferred value never exceeds possible, even with witness agreement', () => {
    expect(level({ score: 0.99, inferred: true })).toBe('possible');
    expect(level({ score: 0.99, witnessed: true, witness: 'agree', inferred: true })).toBe('possible');
  });

  it('caps are sticky: a later step cannot lift an earlier one', () => {
    expect(level({ score: 0.99, witnessed: true, witness: 'agree', imageOverridden: true })).toBe('likely');
  });
});

describe('7 — the user', () => {
  it('an edit or a Confirm tap sets confirmed over any cap', () => {
    expect(level({ score: 0.6, checks: [CHECKS.OCR_SUSPECTED], userConfirmed: true })).toBe('confirmed');
    expect(level({ score: 0.2, inferred: true, userEdited: true })).toBe('confirmed');
  });

  it('but never over a forced unknown: an edited value that fails validation stays unknown', () => {
    expect(computeExtractionLevel({ score: 1, checks: [CHECKS.EMAIL_SYNTAX_INVALID], userEdited: true })).toMatchObject({
      level: 'unknown', requiresReview: false,
    });
  });
});

describe('the trace explains every change', () => {
  it('records each effect in order', () => {
    const { trace } = computeExtractionLevel({
      score: 0.97, checks: [CHECKS.OCR_SUSPECTED], witnessed: true, witness: 'agree', inferred: true,
    });
    expect(trace).toEqual([
      { step: 'score', effect: 'set', level: 'confirmed' },
      { step: 'validation', effect: 'cap', level: 'possible' },
      { step: 'witness', effect: 'raise_noop', level: 'possible' },
      { step: 'inference', effect: 'cap_noop', level: 'possible' },
    ]);
  });

  it('is deterministic: the same input gives the same output', () => {
    const input = { score: 0.82, checks: [CHECKS.EMAIL_SYNTAX_OK], witnessed: true, witness: 'skipped', imageOverridden: true };
    expect(computeExtractionLevel(input)).toEqual(computeExtractionLevel(input));
  });
});
