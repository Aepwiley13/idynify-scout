/**
 * normalizeTargeting.js — T-1. Free text in, supported targeting or a question out.
 *
 * Scout accepts enumerations: 147 exact Apollo industry names, eleven employee
 * buckets, fifty state names. People — and website copy — produce free text:
 * "mid-market healthcare and adjacent services", "roughly 50-200 people",
 * "the Southwest". Nothing translated between the two, so website analysis
 * could never become targeting.
 *
 * ── The rule this module exists to enforce ──────────────────────────────────
 * Never invent a match. A guess that reaches a query is worse than no value at
 * all, because the user sees a confident search for something they did not ask
 * for and has no way to tell it apart from one they did. So:
 *
 *   - A value is emitted only on an exact canonical match or a curated alias
 *     that a human wrote down and a test proves is canonical.
 *   - Anything merely *similar* becomes a question with real candidates —
 *     never a silent approximation.
 *   - Anything with no support at all is dropped and named as dropped.
 *
 * A missing field is acceptable. A fabricated field is not.
 *
 * ── What this module is not ─────────────────────────────────────────────────
 * It proposes. It does not create or update authoritative ICP intelligence, it
 * does not write `icpProfiles`, it does not write the compatibility bridge, it
 * does not call `search-companies`, and it does not touch the D7 floor.
 * Explicit user confirmation remains the boundary at which anything proposed
 * here becomes real.
 */

import { APOLLO_INDUSTRIES, COMPANY_SIZE_OPTIONS, US_STATES } from '../constants/targetingCanon.js';

export const MATCHED = 'matched';
export const AMBIGUOUS = 'ambiguous';
export const UNSUPPORTED = 'unsupported';
export const EMPTY = 'empty';

const INDUSTRY_NAMES = APOLLO_INDUSTRIES.map(i => i.name);

/** Lowercase, collapse whitespace, and treat "&" and "/" as "and". */
function key(text) {
  if (typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/[&/]/g, ' and ')
    .replace(/[^a-z0-9+,\-. ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const INDUSTRY_BY_KEY = new Map(INDUSTRY_NAMES.map(n => [key(n), n]));
const STATE_BY_KEY = new Map(US_STATES.map(s => [key(s), s]));

/**
 * Hand-verified aliases. Each one maps a phrase people actually write onto
 * exactly one canonical name, and a property test asserts every value here is
 * in the canonical set.
 *
 * Entries are deliberately absent where the taxonomy is genuinely ambiguous.
 * "manufacturing" has no general home in Apollo's list; "technology" could be
 * Computer Software or Information Technology and Services; "education" splits
 * three ways. Those become questions, not guesses.
 */
const INDUSTRY_ALIASES = {
  'healthcare': 'Hospital and Health Care',
  'health care': 'Hospital and Health Care',
  'hospitals': 'Hospital and Health Care',
  'software': 'Computer Software',
  'saas': 'Computer Software',
  'software as a service': 'Computer Software',
  'it services': 'Information Technology and Services',
  'managed services': 'Information Technology and Services',
  'msp': 'Information Technology and Services',
  'marketing': 'Marketing and Advertising',
  'advertising': 'Marketing and Advertising',
  'ad agency': 'Marketing and Advertising',
  'marketing agency': 'Marketing and Advertising',
  'digital agency': 'Marketing and Advertising',
  'finance': 'Financial Services',
  'financial services': 'Financial Services',
  'logistics': 'Logistics and Supply Chain',
  'supply chain': 'Logistics and Supply Chain',
  'freight': 'Logistics and Supply Chain',
  'contractors': 'Construction',
  'general contractors': 'Construction',
  'construction': 'Construction',
  'law firms': 'Legal Services',
  'law firm': 'Legal Services',
  'legal': 'Legal Services',
  'attorneys': 'Legal Services',
  'staffing': 'Staffing and Recruiting',
  'recruiting': 'Staffing and Recruiting',
  'recruitment': 'Staffing and Recruiting',
  'consulting': 'Management Consulting',
  'consultancies': 'Management Consulting',
  'accountants': 'Accounting',
  'accounting firms': 'Accounting',
  'cpa firms': 'Accounting',
  'restaurants': 'Restaurants',
  'hotels': 'Hospitality',
  'property management': 'Real Estate',
  'dental practices': 'Medical Practice',
  'medical practices': 'Medical Practice',
  'clinics': 'Medical Practice',
  'trucking': 'Transportation/Trucking/Railroad',
  'car dealerships': 'Automotive',
  'auto dealers': 'Automotive',
  'banks': 'Banking',
  'credit unions': 'Banking',
  'hr': 'Human Resources',
  'facilities management': 'Facilities Services',
  'janitorial': 'Facilities Services',
  'architects': 'Architecture and Planning',
  'engineering firms': 'Civil Engineering',
};

/** Canonical names that merely *contain* the phrase, as whole words. */
function similarIndustries(k) {
  if (!k) return [];
  const pattern = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
  return INDUSTRY_NAMES.filter(n => pattern.test(key(n)));
}

/**
 * One industry phrase.
 *
 * A unique near-match is deliberately NOT accepted. "manufacturing" contains
 * exactly one canonical name — "Electrical/Electronic Manufacturing" — and a
 * user who says "manufacturing" almost never means that. Uniqueness is not
 * evidence of correctness, so near-matches always ask.
 */
export function normalizeIndustry(text) {
  const k = key(text);
  if (!k) return { status: EMPTY, input: text ?? '', value: null, candidates: [] };

  const exact = INDUSTRY_BY_KEY.get(k);
  if (exact) return { status: MATCHED, input: text, value: exact, candidates: [] };

  const alias = INDUSTRY_ALIASES[k];
  if (alias) {
    // Aliases are written against canonical names; if one ever stops being
    // canonical it must fail closed rather than emit an unsupported value.
    const canonical = INDUSTRY_BY_KEY.get(key(alias));
    if (canonical) return { status: MATCHED, input: text, value: canonical, candidates: [] };
  }

  const near = similarIndustries(k);
  if (near.length > 0) {
    return { status: AMBIGUOUS, input: text, value: null, candidates: near.slice(0, 5) };
  }

  return { status: UNSUPPORTED, input: text, value: null, candidates: [] };
}

/** "501-1,000" → [501, 1000]; "10,001+" → [10001, Infinity]. */
function bucketBounds(bucket) {
  const digits = bucket.replace(/,/g, '');
  if (digits.endsWith('+')) return [Number(digits.slice(0, -1)), Infinity];
  const [lo, hi] = digits.split('-').map(Number);
  return [lo, hi];
}

/**
 * One company-size phrase.
 *
 * A stated employee range maps to every bucket it overlaps — arithmetic, not
 * judgment, and every emitted value is canonical. Vague market language does
 * not: "mid-market" has no defensible employee count, so it asks. That case is
 * the common one for website copy, and answering it with a guess would put a
 * fabricated size filter on a real search.
 */
export function normalizeCompanySize(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return { status: EMPTY, input: raw, values: [], candidates: [] };

  const exact = COMPANY_SIZE_OPTIONS.find(b => key(b) === key(raw));
  if (exact) return { status: MATCHED, input: raw, values: [exact], candidates: [] };

  const numbers = raw.replace(/,/g, '').match(/\d+/g)?.map(Number) || [];
  const openEnded = /\+|over|more than|at least/i.test(raw);
  const upTo = /under|less than|fewer than|up to|below/i.test(raw);

  if (numbers.length > 0) {
    let lo = numbers[0];
    let hi = numbers.length > 1 ? numbers[1] : (openEnded ? Infinity : (upTo ? numbers[0] : numbers[0]));
    if (upTo && numbers.length === 1) { hi = numbers[0]; lo = 1; }
    if (lo > hi) [lo, hi] = [hi, lo];

    const values = COMPANY_SIZE_OPTIONS.filter(b => {
      const [blo, bhi] = bucketBounds(b);
      return blo <= hi && bhi >= lo;
    });
    if (values.length > 0) return { status: MATCHED, input: raw, values, candidates: [] };
  }

  // "SMB", "mid-market", "enterprise", "small businesses" — real phrases with
  // no defensible employee count. Offer the vocabulary; do not pick from it.
  if (/\b(smb|sme|mid.?market|enterprise|small|medium|large|startups?|smaller|larger)\b/i.test(raw)) {
    return { status: AMBIGUOUS, input: raw, values: [], candidates: [...COMPANY_SIZE_OPTIONS] };
  }

  return { status: UNSUPPORTED, input: raw, values: [], candidates: [] };
}

/** Two-letter postal codes are an exact, reversible mapping — not a guess. */
const STATE_BY_ABBR = {
  al: 'Alabama', ak: 'Alaska', az: 'Arizona', ar: 'Arkansas', ca: 'California',
  co: 'Colorado', ct: 'Connecticut', de: 'Delaware', fl: 'Florida', ga: 'Georgia',
  hi: 'Hawaii', id: 'Idaho', il: 'Illinois', in: 'Indiana', ia: 'Iowa',
  ks: 'Kansas', ky: 'Kentucky', la: 'Louisiana', me: 'Maine', md: 'Maryland',
  ma: 'Massachusetts', mi: 'Michigan', mn: 'Minnesota', ms: 'Mississippi',
  mo: 'Missouri', mt: 'Montana', ne: 'Nebraska', nv: 'Nevada', nh: 'New Hampshire',
  nj: 'New Jersey', nm: 'New Mexico', ny: 'New York', nc: 'North Carolina',
  nd: 'North Dakota', oh: 'Ohio', ok: 'Oklahoma', or: 'Oregon', pa: 'Pennsylvania',
  ri: 'Rhode Island', sc: 'South Carolina', sd: 'South Dakota', tn: 'Tennessee',
  tx: 'Texas', ut: 'Utah', vt: 'Vermont', va: 'Virginia', wa: 'Washington',
  wv: 'West Virginia', wi: 'Wisconsin', wy: 'Wyoming',
};

const NATIONWIDE = /^(nationwide|national|nationally|all of the us|the us|usa|united states|us wide|across the us|everywhere|anywhere in the us)$/;

/**
 * One location phrase.
 *
 * States and nationwide are supported. Cities, metros and regions are not:
 * there is no city vocabulary in the query, and turning "the Southwest" into a
 * list of states would be Barry deciding which states the user meant.
 */
export function normalizeLocation(text) {
  const k = key(text);
  if (!k) return { status: EMPTY, input: text ?? '', value: null, nationwide: false, candidates: [] };

  if (NATIONWIDE.test(k)) {
    return { status: MATCHED, input: text, value: null, nationwide: true, candidates: [] };
  }

  const exact = STATE_BY_KEY.get(k);
  if (exact) return { status: MATCHED, input: text, value: exact, nationwide: false, candidates: [] };

  const abbr = STATE_BY_ABBR[k];
  if (abbr) return { status: MATCHED, input: text, value: abbr, nationwide: false, candidates: [] };

  // A city or metro often names its state — "Austin, Texas" — and people put
  // modifiers in front of one — "mostly Texas", "the state of Texas". Both are
  // resolved by finding an exact state name inside the phrase; anything else in
  // the phrase is dropped and the caller is told. Nothing is guessed: if no
  // exact state name is in there, this returns unsupported.
  for (const part of k.split(',').map(s => s.trim()).reverse()) {
    const hit = STATE_BY_KEY.get(part) || STATE_BY_ABBR[part];
    if (hit) return { status: MATCHED, input: text, value: hit, nationwide: false, candidates: [], dropped: k };
  }
  for (const part of k.split(',').map(s => s.trim()).reverse()) {
    const words = part.split(' ');
    for (let i = 1; i < words.length; i++) {
      const tail = words.slice(i).join(' ');
      const hit = STATE_BY_KEY.get(tail);
      if (hit) return { status: MATCHED, input: text, value: hit, nationwide: false, candidates: [], dropped: k };
    }
  }

  return { status: UNSUPPORTED, input: text, value: null, nationwide: false, candidates: [] };
}

/** "healthcare and adjacent services, logistics" → ["healthcare and adjacent services", "logistics"] */
function fragments(text) {
  return (typeof text === 'string' ? text : '')
    .split(/,|;|\band\b|\bor\b|\/|&|\n/i)
    .map(s => s.trim())
    .filter(s => s.length > 1);
}

/**
 * Normalize a whole free-text description into proposed targeting.
 *
 * @param {{industry?: string, companySize?: string, location?: string}} input
 * @returns {{
 *   proposed: {industries: string[], companySizes: string[], locations: string[], isNationwide: boolean},
 *   questions: Array<{field: string, input: string, candidates: string[]}>,
 *   dropped: Array<{field: string, input: string}>
 * }}
 */
export function normalizeTargetingText({ industry = '', companySize = '', location = '' } = {}) {
  const proposed = { industries: [], companySizes: [], locations: [], isNationwide: false };
  const questions = [];
  const dropped = [];

  for (const fragment of fragments(industry)) {
    const r = normalizeIndustry(fragment);
    if (r.status === MATCHED) {
      if (!proposed.industries.includes(r.value)) proposed.industries.push(r.value);
    } else if (r.status === AMBIGUOUS) {
      questions.push({ field: 'industry', input: fragment, candidates: r.candidates });
    } else if (r.status === UNSUPPORTED) {
      dropped.push({ field: 'industry', input: fragment });
    }
  }

  // A whole phrase can be ambiguous while a fragment of it matched. Only ask
  // when nothing at all landed — otherwise Barry has something to propose and
  // asking would be the questionnaire again.
  if (proposed.industries.length > 0) {
    for (let i = questions.length - 1; i >= 0; i--) {
      if (questions[i].field === 'industry') questions.splice(i, 1);
    }
  }

  const size = normalizeCompanySize(companySize);
  if (size.status === MATCHED) proposed.companySizes = size.values;
  else if (size.status === AMBIGUOUS) questions.push({ field: 'companySize', input: size.input, candidates: size.candidates });
  else if (size.status === UNSUPPORTED) dropped.push({ field: 'companySize', input: size.input });

  for (const fragment of fragments(location)) {
    const r = normalizeLocation(fragment);
    if (r.status === MATCHED) {
      if (r.nationwide) proposed.isNationwide = true;
      else if (r.value && !proposed.locations.includes(r.value)) proposed.locations.push(r.value);
    } else if (r.status === UNSUPPORTED) {
      dropped.push({ field: 'location', input: fragment });
    }
  }

  // Naming a state and "nationwide" together is a contradiction; the specific
  // one wins, because it is the one the user could only have meant on purpose.
  if (proposed.locations.length > 0) proposed.isNationwide = false;

  return { proposed, questions, dropped };
}
