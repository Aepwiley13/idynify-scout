/**
 * Capture confidence — how sure are we the card says this?
 *
 * Part of the Relationship Capture foundation (PR 2). Pure, and NOT IMPORTED
 * BY THE APP YET. Nothing here calls a provider; this module only defines how
 * a field's extraction level is decided once there is something to decide on.
 *
 * Extraction confidence is about READING: did we read the card correctly? It
 * is not identity confidence ("is this that existing record?"), which is
 * categorical and lives with the resolvers. The two are never combined into
 * one number. A correctly read sarah@gmail.com is a confirmed email even
 * though its domain is useless as company evidence; that second fact is a
 * safeguard on the company, not a doubt about the reading.
 *
 * THE STEPS, IN ORDER — and what each one may do
 * ─────────────────────────────────────────────
 *
 *   step         raise  lower  cap          force unknown       sends to review
 *   ───────────  ─────  ─────  ───────────  ──────────────────  ───────────────
 *   1 score      sets the starting level from the provider's 0–1 score:
 *                ≥ 0.95 confirmed · ≥ 0.80 likely · ≥ 0.50 possible · else unknown
 *   2 validation  no     yes    possible     a failing check     via the cap
 *                              (doubt:      (malformed email,
 *                              ocr_suspected) URL, LinkedIn, phone)
 *   3 safeguards  no     yes    possible     WEBSITE_FROM_EMAIL  via the cap
 *                              (title/person
 *                              as company, too short, weak text,
 *                              invalid domain, OCR)
 *   4 witness     YES    yes    agree → raise to confirmed (never past a cap);
 *                              minor_mismatch / contradicted → cap possible;
 *                              absent / skipped / not run → cap likely
 *                              (identifier fields only: emails, phones,
 *                              website, domain, LinkedIn)
 *   5 image       no     yes    likely (a photo kept through "Use anyway")
 *   6 inference   no     yes    possible (source: 'inferred')
 *   7 user        YES    no     an edit or a Confirm tap sets confirmed — over
 *                              any cap, but never over a forced unknown (an
 *                              edited value that fails validation stays unknown)
 *
 * Only steps 4 and 7 can raise. Caps are sticky: once a step caps the level,
 * no later step except the user can lift it. A field that ends at `possible`
 * needs review (a Confirm chip; left out of the save until confirmed or
 * edited). `unknown` is shown empty and not saved.
 */

import { FAILING_CHECKS, DOUBT_CHECKS } from './validators.js';
import { SAFEGUARDS } from './safeguards.js';

/** Weakest first. */
export const LEVEL_ORDER = Object.freeze(['unknown', 'possible', 'likely', 'confirmed']);

export const SCORE_BANDS = Object.freeze({ confirmed: 0.95, likely: 0.80, possible: 0.50 });

export const STEPS = Object.freeze(['score', 'validation', 'safeguards', 'witness', 'image', 'inference', 'user']);

/** Safeguards that mean the READING is doubtful, not just that the company is unsafe. */
export const SAFEGUARD_FIELD_CAPS = Object.freeze({
  [SAFEGUARDS.WEBSITE_FROM_EMAIL]: 'unknown',
  [SAFEGUARDS.TITLE_AS_COMPANY]: 'possible',
  [SAFEGUARDS.PERSON_NAME_AS_COMPANY]: 'possible',
  [SAFEGUARDS.COMPANY_NAME_TOO_SHORT]: 'possible',
  [SAFEGUARDS.WEAK_COMPANY_TEXT]: 'possible',
  [SAFEGUARDS.INVALID_DOMAIN]: 'possible',
  [SAFEGUARDS.OCR_SUSPECTED]: 'possible',
});

const rank = level => LEVEL_ORDER.indexOf(level);
const lower = (a, b) => (rank(a) <= rank(b) ? a : b);

export function levelFromScore(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'unknown';
  if (score >= SCORE_BANDS.confirmed) return 'confirmed';
  if (score >= SCORE_BANDS.likely) return 'likely';
  if (score >= SCORE_BANDS.possible) return 'possible';
  return 'unknown';
}

/**
 * Decide one field's extraction level.
 *
 * @param {object}   input
 * @param {number}   input.score            provider score, 0..1
 * @param {string[]} [input.checks]         validator codes (validators.CHECKS)
 * @param {string[]} [input.safeguards]     safeguard codes for this field
 * @param {boolean}  [input.witnessed]      is this an identifier the witness checks?
 * @param {string|null} [input.witness]     agree | minor_mismatch | contradicted | absent | skipped | null
 * @param {boolean}  [input.imageOverridden] preflight warning kept through "Use anyway"
 * @param {boolean}  [input.inferred]       source === 'inferred'
 * @param {boolean}  [input.userEdited]
 * @param {boolean}  [input.userConfirmed]
 * @returns {{ level: string, requiresReview: boolean,
 *   trace: Array<{ step: string, effect: string, level: string }> }}
 */
export function computeExtractionLevel({
  score,
  checks = [],
  safeguards = [],
  witnessed = false,
  witness = null,
  imageOverridden = false,
  inferred = false,
  userEdited = false,
  userConfirmed = false,
} = {}) {
  const trace = [];
  let level = levelFromScore(score);
  let ceiling = 'confirmed';
  let forcedUnknown = false;
  trace.push({ step: 'score', effect: 'set', level });

  const cap = (step, to) => {
    ceiling = lower(ceiling, to);
    const next = lower(level, ceiling);
    trace.push({ step, effect: next === level ? 'cap_noop' : 'cap', level: next });
    level = next;
  };
  const forceUnknown = (step) => {
    forcedUnknown = true;
    ceiling = 'unknown';
    level = 'unknown';
    trace.push({ step, effect: 'force_unknown', level });
  };

  // 2 — validation: only lowers.
  if (checks.some(check => FAILING_CHECKS.has(check))) forceUnknown('validation');
  else if (checks.some(check => DOUBT_CHECKS.has(check))) cap('validation', 'possible');

  // 3 — safeguards that doubt the reading: only lower.
  const safeguardCaps = safeguards.map(code => SAFEGUARD_FIELD_CAPS[code]).filter(Boolean);
  if (safeguardCaps.includes('unknown')) forceUnknown('safeguards');
  else if (safeguardCaps.length) cap('safeguards', 'possible');

  // 4 — witness: the only automated step that can raise.
  if (witnessed) {
    if (witness === 'agree') {
      const next = lower('confirmed', ceiling);
      trace.push({ step: 'witness', effect: rank(next) > rank(level) ? 'raise' : 'raise_noop', level: next });
      level = next;
    } else if (witness === 'minor_mismatch' || witness === 'contradicted') {
      cap('witness', 'possible');
    } else {
      cap('witness', 'likely');
    }
  }

  // 5 — image quality.
  if (imageOverridden) cap('image', 'likely');

  // 6 — inference.
  if (inferred) cap('inference', 'possible');

  // 7 — the user: over any cap, never over a forced unknown.
  if ((userEdited || userConfirmed) && !forcedUnknown) {
    level = 'confirmed';
    trace.push({ step: 'user', effect: 'set', level });
  }

  return { level, requiresReview: level === 'possible', trace };
}
