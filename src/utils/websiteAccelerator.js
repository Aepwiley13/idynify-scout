/**
 * websiteAccelerator.js — Barry reads the website so the user doesn't have to type.
 *
 * An accelerator, never a requirement. Everything it produces is reachable by
 * conversation instead, nothing downstream is gated on it, and skipping it
 * costs the user nothing but a sentence.
 *
 * ── Only what the source actually produces ──────────────────────────────────
 * `analyze-website` returns eight free-text fields and a self-reported
 * confidence, under an explicit instruction not to invent facts. It does NOT
 * produce the user's own location, the user's own headcount, competitive
 * landscape, role, or team — and it does not produce Apollo-ready structured
 * targeting. Two of its fields read like targeting and are still free text:
 * `targetIndustry` ("healthcare and adjacent services") and
 * `targetCompanySize` ("Mid-market").
 *
 * So those two go through T-1, which either finds an exact supported value or
 * refuses. Where it refuses, the field is simply absent and Barry asks a short
 * question — he does not approximate, and he does not present the gap as an
 * unfinished form.
 *
 * ── The user never learns that translation happened ─────────────────────────
 * What they hear is "I looked at your website — it looks like you help X with
 * Y. Is that still right?" Whether a phrase survived normalization is Barry's
 * problem, not theirs.
 *
 * ── Nothing here is authoritative ───────────────────────────────────────────
 * Website-derived targeting is a proposal like any other. It becomes real at
 * the same confirmation event and nowhere else.
 */

import { normalizeTargetingText } from './normalizeTargeting.js';

/**
 * Exactly the fields `analyze-website` returns. Listed so that reading anything
 * else from its payload is a visible mistake rather than a plausible one.
 */
export const WEBSITE_FIELDS = [
  'companyName',
  'description',
  'whatTheySell',
  'whoTheyServeTo',
  'targetIndustry',
  'targetCompanySize',
  'valueProposition',
  'icpSummary',
];

/** Fields the source does not produce, and that Barry must never claim to know. */
export const NOT_PRODUCED = [
  'the user\'s own location',
  'the user\'s own headcount',
  'competitive landscape',
  'role',
  'team',
];

function clean(value, max = 200) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * "It looks like you help contractors win commercial work."
 *
 * Built only from what the page said. If the analysis is too thin to say
 * anything specific, this returns null and Barry says nothing rather than
 * saying something generic — a vague recognition line is worse than none,
 * because it reads as a machine pretending to have understood.
 */
function recognitionLine(data) {
  const who = clean(data.whoTheyServeTo, 120);
  const what = clean(data.whatTheySell, 120);

  if (who && what) return `It looks like you help ${lowerFirst(who)} with ${lowerFirst(what)}.`;
  if (who) return `It looks like you work with ${lowerFirst(who)}.`;
  if (what) return `It looks like you sell ${lowerFirst(what)}.`;
  return null;
}

function lowerFirst(text) {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/**
 * Turn one website analysis into proposed targeting plus whatever Barry still
 * needs to ask.
 *
 * @param {object|null} payload - the `analyze-website` response
 * @returns {{
 *   ok: boolean,
 *   message: string|null,
 *   recognition: string|null,
 *   companyName: string|null,
 *   summary: string|null,
 *   proposed: {industries: string[], companySizes: string[], locations: string[], isNationwide: boolean},
 *   questions: Array<{field: string, input: string, candidates: string[]}>,
 *   dropped: Array<{field: string, input: string}>,
 *   lowConfidence: boolean
 * }}
 */
export function readWebsite(payload) {
  const empty = {
    ok: false,
    message: null,
    recognition: null,
    companyName: null,
    summary: null,
    proposed: { industries: [], companySizes: [], locations: [], isNationwide: false },
    questions: [],
    dropped: [],
    lowConfidence: false,
  };

  if (!payload || payload.success === false || !payload.data) {
    // A site that blocks robots or renders in JavaScript is a normal outcome,
    // not an error the user has to resolve. The function already writes a
    // friendly sentence for each case; Barry says that and moves on.
    return { ...empty, message: clean(payload?.message, 400) };
  }

  const data = payload.data;

  // Only `targetIndustry` and `targetCompanySize` describe who the user sells
  // to. Location is deliberately absent: the source does not produce it, and
  // inferring the user's market from their own address would be a fabrication.
  const { proposed, questions, dropped } = normalizeTargetingText({
    industry: data.targetIndustry || '',
    companySize: data.targetCompanySize || '',
  });

  const confidence = typeof data.confidence === 'number' ? data.confidence : 0;

  return {
    ok: true,
    message: null,
    recognition: recognitionLine(data),
    companyName: clean(data.companyName, 80),
    // Used as one line of "what I picked up" in the proposal. The site's own
    // framing, quoted back, never restated as fact Barry established.
    summary: clean(data.icpSummary, 240) || clean(data.valueProposition, 240),
    proposed,
    questions,
    dropped,
    lowConfidence: confidence > 0 && confidence < 50,
  };
}

/**
 * The one short question, when the site gave Barry something he could not use.
 *
 * Deliberately not a list of unmapped fields. "Mid-market" failing to become an
 * employee bucket is Barry's problem; what the user hears is a question about
 * their business.
 */
export function acceleratorQuestion(reading) {
  if (!reading?.questions?.length) return null;
  const first = reading.questions[0];

  if (first.field === 'companySize') {
    return `Roughly how big are the companies you sell to? A rough headcount is enough.`;
  }
  return `What kind of companies are those, in your own words?`;
}
