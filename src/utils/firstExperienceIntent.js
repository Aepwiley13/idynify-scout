/**
 * firstExperienceIntent.js — what the user came to get done.
 *
 * Barry's first question used to be "Who are you hunting?", which presumes the
 * user came to prospect. Most did not. This module is the contract for reading
 * intent from a single free-text turn so Barry can route to the thing the user
 * actually asked for.
 *
 * ── Intent is transient (P-5) ────────────────────────────────────────────────
 * Nothing here writes. There is no intent field on any document, no intent
 * collection, no per-user intent history, and no taxonomy document. A
 * classification lives in component state for one session and dies with it.
 * The user's *words* persist in `barryConversations/icp.messages` exactly as
 * they already did — that is a transcript, not an intent record.
 *
 * ── The taxonomy is internal ─────────────────────────────────────────────────
 * Nine categories exist below. The user sees one open question and free text.
 * They are never rendered as nine choices, and their names are never shown.
 *
 * ── Where classification happens ─────────────────────────────────────────────
 * Deliberately NOT in `barryICPConversation`. That endpoint carries an
 * ICP-extraction prompt — 147 canonical Apollo industry names, targeting
 * instructions, and post-validation against three enumerations. Running it to
 * decide routing would spend a model call extracting targeting from "I want to
 * reconnect with old clients", and would drag proto-targeting semantics into
 * journeys that must never touch them. Classification happens first, on the
 * raw turn, and only Prospecting turns ever reach the ICP path.
 */

/** Orientation: what is this thing, where do I stand, what should I do first. */
export const INTENT_EXPLORATION = 'EXPLORATION';
/** Something is waiting in the inbox and needs answering. */
export const INTENT_COMMUNICATION = 'COMMUNICATION';
/** Write to a specific named person. */
export const INTENT_OUTREACH = 'OUTREACH';
/** Where does a deal or a person stand, and what happens next. */
export const INTENT_PIPELINE = 'PIPELINE';
/** Reconnect with someone already known. */
export const INTENT_ENGAGEMENT = 'ENGAGEMENT';
/** Get ready for a specific upcoming meeting or call. */
export const INTENT_PREPARATION = 'PREPARATION';
/** Ask someone known for an introduction to someone else. */
export const INTENT_REFERRAL = 'REFERRAL';
/** Find new companies to sell to. */
export const INTENT_PROSPECTING = 'PROSPECTING';
/** Genuinely cannot tell. Never a synonym for "probably prospecting". */
export const INTENT_UNCLEAR = 'UNCLEAR';

export const INTENTS = [
  INTENT_EXPLORATION,
  INTENT_COMMUNICATION,
  INTENT_OUTREACH,
  INTENT_PIPELINE,
  INTENT_ENGAGEMENT,
  INTENT_PREPARATION,
  INTENT_REFERRAL,
  INTENT_PROSPECTING,
  INTENT_UNCLEAR,
];

/**
 * The one thing Barry asks. Open, not a menu.
 *
 * "Hoping to get done" rather than "want to do" because it invites an outcome
 * ("close the deal with Acme") instead of a feature request ("use the search"),
 * and an outcome is what routes.
 */
export const OPENING_QUESTION = 'What are you hoping to get done?';

/**
 * Ranking used when a turn carries two intents, most actionable first.
 *
 * "Most actionable" is not a preference ordering — it is how close each intent
 * sits to a real outcome on today's capabilities. Prospecting is a multi-turn
 * conversation before anything is produced, so it yields to intents that act on
 * something the user already named. Exploration is last because it is always
 * available and therefore never urgent: it is what the user gets anyway.
 */
const ACTIONABILITY = [
  INTENT_COMMUNICATION,
  INTENT_PIPELINE,
  INTENT_PREPARATION,
  INTENT_OUTREACH,
  INTENT_REFERRAL,
  INTENT_ENGAGEMENT,
  INTENT_PROSPECTING,
  INTENT_EXPLORATION,
  INTENT_UNCLEAR,
];

/**
 * Coerce anything to a known category.
 *
 * Model output is untrusted text. An unrecognised label becomes UNCLEAR, which
 * asks a question — never PROSPECTING, which would start defining an ICP for a
 * user who never asked for one. That asymmetry is the whole point: the cost of
 * a wrong question is one turn, the cost of a wrong ICP is a workspace.
 */
export function normalizeIntent(raw) {
  if (typeof raw !== 'string') return INTENT_UNCLEAR;
  const upper = raw.trim().toUpperCase();
  return INTENTS.includes(upper) ? upper : INTENT_UNCLEAR;
}

/** Trim to a bounded plain string, or null. Model text never reaches state raw. */
function text(value, max = 400) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function confidenceOf(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Below this, Barry restates rather than acts.
 *
 * A confident-sounding wrong route costs the user their first impression. A
 * restatement costs them one sentence, and reading their intent back to them is
 * how Barry demonstrates it listened.
 */
export const CONFIRM_BELOW = 0.6;

/**
 * The classification contract, applied to whatever the endpoint returned.
 *
 * @param {object|null} payload
 * @returns {{
 *   intent: string,
 *   secondaryIntent: string|null,
 *   confidence: number,
 *   needsConfirmation: boolean,
 *   restatement: string|null,
 *   clarifyingQuestion: string|null,
 *   subject: string|null
 * }}
 */
export function normalizeClassification(payload) {
  const intent = normalizeIntent(payload?.intent);

  // A secondary that repeats the primary, or that is itself unreadable, is not
  // a compound intent — it is noise.
  const secondaryRaw = normalizeIntent(payload?.secondaryIntent);
  const secondaryIntent =
    secondaryRaw !== INTENT_UNCLEAR && secondaryRaw !== intent ? secondaryRaw : null;

  const confidence = confidenceOf(payload?.confidence);

  // Whoever or whatever the turn was about — a person, a company, a meeting.
  // Routing uses it for copy only; it is never persisted and never becomes
  // targeting criteria.
  const subject = text(payload?.subject, 120);

  return {
    intent,
    secondaryIntent,
    confidence,
    // UNCLEAR asks its own question and so is not a confirmation case.
    needsConfirmation: intent !== INTENT_UNCLEAR && confidence < CONFIRM_BELOW,
    restatement: text(payload?.restatement),
    clarifyingQuestion: text(payload?.clarifyingQuestion),
    subject,
  };
}

/**
 * What Barry falls back to when classification cannot be obtained at all —
 * network failure, timeout, unparseable response.
 *
 * It asks. A failed classifier must not silently become a decision.
 */
export function unclearClassification(reason = null) {
  return {
    intent: INTENT_UNCLEAR,
    secondaryIntent: null,
    confidence: 0,
    needsConfirmation: false,
    restatement: null,
    clarifyingQuestion: null,
    subject: null,
    failureReason: reason,
  };
}

/**
 * Order two intents so the more actionable one is served first.
 * Compound intent is served one at a time; the other is held in conversation.
 */
export function orderCompound(primary, secondary) {
  if (!secondary) return [primary, null];
  const rank = i => {
    const idx = ACTIONABILITY.indexOf(i);
    return idx === -1 ? ACTIONABILITY.length : idx;
  };
  return rank(secondary) < rank(primary) ? [secondary, primary] : [primary, secondary];
}
