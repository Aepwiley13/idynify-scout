/**
 * targetingProposal.js — Barry showing his work before he searches.
 *
 * The old confirmation surface was a field list: Industries, Company Size,
 * Location, Target Contacts, each with "Not specified" beside it. That is a
 * form wearing a conversation's clothes — it asks the user to audit Barry's
 * data model rather than to agree with his reasoning.
 *
 * A proposal says, in ordinary language: here's what I think you're after,
 * here's who I'd go looking for, here's what I picked up along the way, here's
 * where I'm unsure, and here's exactly what I'll do if you say go. The user
 * confirms a plan, not a schema.
 *
 * ── The authority boundary is unchanged ─────────────────────────────────────
 * Nothing here creates, activates or projects an ICP, and nothing here
 * searches. A proposal is a sentence until the user confirms it; confirmation
 * remains the single event at which proposed targeting becomes authoritative,
 * and it still runs the Phase-1B sequence:
 *
 *   resolve → authoritative write/create → activate → projection → D7 gate → attributed search
 */

/**
 * The fields that demonstrably narrow an Apollo company search.
 *
 * This is the single source of the rule. `BarryOnboarding.handleConfirm` used
 * to carry its own copy inline; two copies of a quality floor drift, and the
 * copy that drifts is the one that lets an unfiltered search wear an ICP label.
 *
 * Deliberately absent:
 *   targetTitles   — a person filter; `mixed_companies/search` never sees it.
 *   revenueRanges  — not sent to Apollo by the query builder.
 *   lookalikeSeed  — the builder receives it and logs it, but never turns it
 *                    into a query parameter. Counting it would let a definition
 *                    whose only targeting is a seed company pass this gate and
 *                    then run a completely unfiltered search.
 */
export const SUPPORTED_CONSTRAINTS = [
  'industries',
  'companyKeywords',
  'companySizes',
  'locations',
  'isNationwide',
  'foundedAgeRange',
];

/** Which supported constraints this definition actually carries. */
export function retrievalConstraints(profile) {
  if (!profile) return [];
  const present = [];
  if (profile.industries?.length > 0) present.push('industries');
  if (profile.companyKeywords?.length > 0) present.push('companyKeywords');
  if (profile.companySizes?.length > 0) present.push('companySizes');
  if (Array.isArray(profile.locations) ? profile.locations.length > 0 : profile.locations === 'nationwide') {
    present.push(profile.locations === 'nationwide' ? 'isNationwide' : 'locations');
  }
  if (profile.isNationwide) { if (!present.includes('isNationwide')) present.push('isNationwide'); }
  if (profile.foundedAgeRange) present.push('foundedAgeRange');
  return present;
}

/**
 * The quality floor, as locked: **one** supported constraint is enough.
 *
 * No count, percentage or completeness rule. A single constraint produces a
 * broad but genuinely filtered search, and Barry says it is broad rather than
 * demanding more before he will start.
 */
export function hasRetrievalConstraint(profile) {
  return retrievalConstraints(profile).length > 0;
}

/** The one question, when Barry has nothing to go on. Not a form. */
export const CLARIFY_QUESTION =
  "What kind of companies are you trying to reach? Even a rough direction helps.";

function list(values, max = 3) {
  const items = (values || []).filter(Boolean);
  if (items.length === 0) return null;
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  const joined = shown.length === 1
    ? shown[0]
    : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  return rest > 0 ? `${joined} and ${rest} more` : joined;
}

/** "roofing contractors in Texas with 11-50 employees" — one readable phrase. */
function describeTarget(icp) {
  const kind = list(icp.companyKeywords, 2) || list(icp.industries, 2) || 'companies';

  const where = icp.locations === 'nationwide' || icp.isNationwide
    ? 'across the US'
    : Array.isArray(icp.locations) && icp.locations.length
      ? `in ${list(icp.locations, 3)}`
      : null;

  const size = icp.companySizes?.length
    ? `with ${list(icp.companySizes, 2)} employees`
    : null;

  const age = icp.foundedAgeRange
    ? agePhrase(icp.foundedAgeRange)
    : null;

  return [kind, where, size, age].filter(Boolean).join(' ');
}

function agePhrase({ minAge, maxAge }) {
  if (minAge != null && maxAge != null) return `founded ${minAge}–${maxAge} years ago`;
  if (maxAge != null) return `founded in the last ${maxAge} years`;
  if (minAge != null) return `at least ${minAge} years old`;
  return null;
}

/**
 * Turn everything Barry has into a proposal he can say out loud.
 *
 * @param {object} params
 * @param {object} params.icp            - the extracted, already-validated targeting
 * @param {string|null} params.goal      - Barry's restatement of what the user wants, from the intent turn
 * @param {string|null} params.name      - what to call the user, if known
 * @param {object|null} params.website   - normalized website-derived intelligence, if any
 * @returns {{
 *   canPropose: boolean, constraints: string[], goal: string|null, target: string|null,
 *   learned: string[], uncertain: string[], plan: string|null, question: string|null, broad: boolean
 * }}
 */
export function buildProposal({ icp, goal = null, name = null, website = null } = {}) {
  const constraints = retrievalConstraints(icp);
  const canPropose = constraints.length > 0;

  // Nothing defensible to propose. One question, not a questionnaire — and
  // deliberately not a list of the fields Barry is missing, which is the same
  // form in a different costume.
  if (!canPropose) {
    return {
      canPropose: false,
      constraints: [],
      goal: goal || null,
      target: null,
      learned: [],
      uncertain: [],
      plan: null,
      question: CLARIFY_QUESTION,
      broad: false,
      greeting: name ? `I'm not there yet, ${name}.` : `I'm not quite there yet.`,
    };
  }

  const target = describeTarget(icp);

  // What Barry picked up that the user did not have to spell out. Each line is
  // something he can point at — never a restatement of a field the user typed.
  const learned = [];
  if (icp.lookalikeSeed?.name) {
    learned.push(
      `You pointed at ${icp.lookalikeSeed.name} as the kind of company you want more of, so I'll prioritize companies that actually look like it rather than everything in the category.`
    );
  }
  if (icp.companyKeywords?.length && icp.industries?.length) {
    learned.push(
      `"${icp.companyKeywords[0]}" is narrower than ${icp.industries[0]}, so I'll lead with it and use the broader category as a backstop.`
    );
  }
  if (icp.targetTitles?.length) {
    learned.push(
      `You're selling to ${list(icp.targetTitles, 3)} — that doesn't change which companies I look for, but it's who I'll go after once I've found them.`
    );
  }
  if (website?.summary) {
    learned.push(website.summary);
  }

  // Where Barry is guessing. Saying so is what makes the rest trustworthy.
  const uncertain = [];
  if (typeof icp.confidenceScore === 'number' && icp.confidenceScore < 0.6) {
    uncertain.push(`I'm working from fairly little, so treat this as a first pass.`);
  }
  if (website?.uncertain?.length) {
    uncertain.push(...website.uncertain);
  }
  if (!icp.companySizes?.length && !icp.foundedAgeRange) {
    uncertain.push(`I don't know what size of company works best for you, so I'm not filtering on it yet.`);
  }
  if (!icp.locations?.length && !icp.isNationwide && icp.locations !== 'nationwide') {
    uncertain.push(`You didn't mention where, so I'm looking everywhere in the US.`);
  }
  if (!icp.targetTitles?.length) {
    // Titles never held up the search — they are a person filter, and the
    // company search never sees them. They matter later, so Barry says he will
    // ask later rather than asking now.
    uncertain.push(`I don't know yet who you'd want to talk to inside these companies. I'll ask once I've found some.`);
  }

  // One constraint is enough to start, and Barry says the result will be wide
  // rather than refusing to start.
  const broad = constraints.length === 1;

  return {
    canPropose: true,
    constraints,
    goal: goal || null,
    target,
    learned,
    uncertain,
    plan: `I'll go find ${target} and put them in Scout for you to work through.`,
    question: null,
    broad,
    greeting: name ? `Here's what I've got, ${name}.` : `Here's what I've got.`,
  };
}
