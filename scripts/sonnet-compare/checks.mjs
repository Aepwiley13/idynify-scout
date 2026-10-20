/**
 * Per-endpoint acceptance: would this reply text have worked in the handler?
 *
 * Each check repeats exactly what its handler does with the text that
 * readClaudeText returns, so "ok" here means the endpoint would have used the
 * reply rather than falling back or returning an error. If a handler's parsing
 * changes, change its check here too.
 *
 * The four message writers also get the outbound-copy rules below: their text
 * is sent as is, so a placeholder, a signature as Barry, or an invented claim
 * fails the check even though the handler would have accepted it.
 *
 * Every check returns { ok, note }. `note` names what failed, quoting at most
 * the few words that failed.
 */

import { OUTBOUND_COPY_RULES } from '../../netlify/functions/utils/outboundCopyRules.js';

/** The `\{[\s\S]*\}` + JSON.parse step most JSON endpoints use. */
function jsonObject(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { error: 'no JSON object in reply' };
  try {
    return { value: JSON.parse(match[0]) };
  } catch {
    return { error: 'JSON.parse failed' };
  }
}

function requireJson(text, validate = () => null) {
  const { value, error } = jsonObject(text);
  if (error) return { ok: false, note: error };
  const problem = validate(value);
  return problem ? { ok: false, note: problem } : { ok: true, note: '' };
}

export const CHECKS = {
  // barryGenerateMissionSequence.js: parse, then sequenceRationale + steps[] or "Failed to generate valid mission sequence"
  'mission-sequence': (text) => requireJson(text, (v) =>
    (!v.sequenceRationale || !Array.isArray(v.steps) ? 'missing sequenceRationale or steps[]' : null)),

  // barryICPConversation.js: each action throws "Failed to parse Barry … response" without a JSON object
  'icp-initial': (text) => requireJson(text),
  'icp-followup': (text) => requireJson(text),
  'icp-example-company': (text) => requireJson(text),
  'icp-summary': (text) => requireJson(text),

  // barryGenerateContext.js: parse, then five required keys or "Failed to generate valid context"
  context: (text) => requireJson(text, (v) => {
    const missing = ['whoYoureMeeting', 'whatRoleCaresAbout', 'whatCompanyFocusedOn', 'conversationStarters', 'calmReframe'].filter((k) => !v[k]);
    return missing.length ? `missing ${missing.join(', ')}` : null;
  }),

  // barryGenerateSequenceStep.js: parse, then body or "Failed to generate step content".
  // The subject and body are what the user sends, so they get the outbound-copy rules.
  'sequence-step': (text, request) => requireJson(text, (v) => {
    if (!v.body) return 'missing body';
    return firstProblem([v.subject, v.body], request);
  }),

  // barryValidateContact.js: an unparseable reply silently falls back to the top match
  'validate-contact': (text) => {
    const result = requireJson(text);
    return result.ok ? result : { ok: false, note: `${result.note} (handler falls back to the top match)` };
  },

  // generate-engagement-message.js: strip control chars + match + parse, else a ```json fence; then messages[] of 3+.
  // Every message and subject is a draft the user sends.
  'engagement-message': (text, request) => {
    let value;
    const sanitized = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
    const match = sanitized.match(/\{[\s\S]*\}/);
    try {
      if (!match) throw new Error();
      value = JSON.parse(match[0]);
    } catch {
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      try {
        if (!fence) throw new Error();
        value = JSON.parse(fence[1].trim());
      } catch {
        return { ok: false, note: 'both parse stages failed' };
      }
    }
    if (!Array.isArray(value.messages) || value.messages.length < 3) return { ok: false, note: 'fewer than 3 messages' };
    const problem = firstProblem(value.messages.flatMap((m) => [m?.subject, m?.message]), request);
    return problem ? { ok: false, note: problem } : { ok: true, note: '' };
  },

  // generate-campaign-messages.js: SUBJECT:/BODY: lines; without them it saves "Quick question" / the raw text
  'campaign-message': (text, request) => {
    const subject = /SUBJECT:\s*(.+)/.test(text);
    const body = /BODY:\s*([\s\S]+)/.test(text);
    if (!subject || !body) {
      return { ok: false, note: `missing ${[!subject && 'SUBJECT:', !body && 'BODY:'].filter(Boolean).join(' and ')} (handler falls back to defaults)` };
    }
    const problem = firstProblem([text.match(/SUBJECT:\s*(.+)/)[1], text.match(/BODY:\s*([\s\S]+)/)[1]], request);
    return problem ? { ok: false, note: problem } : { ok: true, note: '' };
  },

  // generate-followup.js: any text becomes the draft body.
  followup: (text, request) => {
    const problem = firstProblem([text], request);
    return problem ? { ok: false, note: problem } : { ok: true, note: '' };
  },
};

// ─── Outbound copy: what a drafted message may not contain (#699) ───────────
//
// The four message writers produce text the user sends. Nothing fills in a
// placeholder or checks a claim before it goes out, so a draft fails if it
// contains any of the below. Some rules compare the draft with the prompt it
// was written from: a time, an attachment, a number or a past conversation
// is fine when the prompt supplied it, and invented when it did not.

/**
 * The context a captured request gave the model: its prompt text, without the
 * output rules themselves, which name attachments and achieved results only
 * to forbid them.
 */
export function promptText(request) {
  return (request?.messages ?? [])
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n')
    .replace(OUTBOUND_COPY_RULES, '');
}

/** The draft talks about the message instead of being it. */
const META = [
  [/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/m, 'separator before extra text'],
  [/^\s*\**\s*(?:note|version|option|alternative)\b[^:\n]{0,60}:/im, 'note or alternative version'],
  [/\bI (?:can(?:'|’)t|cannot|can not) write\b/i, 'says it cannot write the message'],
  [/\b(?:don(?:'|’)t|do not|didn(?:'|’)t|did not) have (?:access to )?[\w'’ ]{0,30}\b(?:reply|response)\b/i, 'says the reply is missing'],
  [/\b(?:their|his|her|the) (?:actual )?(?:reply|response) (?:isn(?:'|’)t|is not|wasn(?:'|’)t|was not) (?:included|provided|available|shared)\b/i, 'says the reply is missing'],
  [/\b(?:paste|send me|share) (?:his|her|their|the) (?:actual )?(?:reply|response)\b/i, 'asks for the reply'],
];

const SIGN_OFF = /^(?:best|best regards|kind regards|warm regards|regards|thanks|thank you|many thanks|cheers|sincerely|warmly|all the best)[,.!]?$/i;

/** Signed or introduced as Barry, the assistant, rather than the user. */
function signsAsBarry(draft) {
  const lines = draft.split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines.at(-1) ?? '';
  if (/^[-–—]?\s*Barry\b/i.test(last)) return true;
  if (/\b(?:Best|Thanks|Cheers|Regards|Sincerely|Warmly)[,.!]?\s+Barry\s*$/i.test(last)) return true;
  return /\b(?:I(?:'|’)m|I am|this is|it(?:'|’)s) Barry\b/i.test(draft);
}

/** A name after the sign-off: none of these endpoints is given the sender's name. */
function signsWithName(draft) {
  const lines = draft.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length >= 2 && SIGN_OFF.test(lines.at(-2)) && !SIGN_OFF.test(lines.at(-1)) && lines.at(-1).split(/\s+/).length <= 4;
}

const CLOCK_TIME = /\b\d{1,2}(?::\d{2})?\s?(?:a\.?m\.?|p\.?m\.?)(?![a-z])/gi;
const WEEKDAY = /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)s?\b/gi;
const CALENDAR_DATE = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.? \d{1,2}(?:st|nd|rd|th)?\b/g;
const ATTACHMENT = /\b(?:attached|attachment|enclosed|I(?:'|’)ve included (?:a|the) (?:pdf|deck|file|one-pager|summary))\b/i;

/** Wording that says the two people have already spoken, met or corresponded beyond the outreach itself. */
const PRIOR_CONVERSATION = [
  /\b(?:following|follow) up on (?:our|the) (?:earlier |last |recent |previous )?(?:conversation|call|chat|meeting|discussion|talk)\b/i,
  /\bour (?:earlier|last|recent|previous) (?:conversation|call|chat|meeting|discussion|talk)\b/i,
  /\bwhere we left off\b/i,
  /\bas (?:we )?discussed\b/i,
  /\b(?:great|good|nice) (?:to )?(?:speaking|talking|chatting|meeting|catching up|connect(?:ing)?)\b/i,
  /\bthanks?(?: you)?(?: again)? for (?:the|our) (?:call|chat|conversation|meeting|time on (?:the|our) call)\b/i,
  /\bwhen we (?:spoke|talked|met|chatted)\b/i,
  /\bsince we(?:(?:'|’)ve| have)? (?:been in touch|spoke|talked|met)\b/i,
  /\b(?:something|what) (?:that )?came up\b/i,
  /\byou (?:mentioned|told me|walked me through)\b/i,
];

/** Signs in the prompt that the two have actually been in contact beyond a cold note. */
const PRIOR_CONTACT_SUPPLIED = /\breplied (?:positively|negatively)\b|\bOutcome: replied\b|\bwe met\b|\bmet (?:briefly|at)\b|\btrade show\b|\bour (?:call|conversation|meeting)\b|\bcheck-in call\b|\bconversation (?:with|about)\b/i;

/** A result stated as achieved, as opposed to a goal. */
const ACHIEVED_CLAIM = /\b(?:have|has|had)\s+(?:\w+\s+){0,2}(?:cut|halved|reduced|lowered|dropped|seen)\b|\b(?:customers?|clients?|chains?|grocers?|co-ops?|retailers?|teams?|stores?)\b[^.!?\n]{0,60}\b(?:cut|halved|halve|reduced|lowered)\b[^.!?\n]{0,60}\b(?:within|in)\s+(?:\w+\s+){0,2}(?:quarters?|months?|weeks?)\b/i;
const RESULT_SIZE = /\bhalf\b|\bhalved?\b|\d+(?:\.\d+)?\s?%/i;
const GOAL_WORDS = /\b(?:goal|aim|aims|aiming|target|hope|could|can|would|might|realistic|plan|want|wants|like to|(?:'|’)d like|working toward|set out)\b/i;

/** Numbers the draft states as facts: percentages, money, and counts of customers, stores or time. */
const STATED_NUMBER = /(\$\s?\d[\d,.]*\s?[kKmM]?|\b\d[\d,.]*\s?%|\b\d[\d,]*\+?\s(?:regional\s)?(?:customers?|clients?|chains?|grocers?|stores?|locations?|retailers?|companies|co-ops?|weeks?|days?|months?)\b)/gi;

/**
 * Everything wrong with a drafted message, given the prompt it was written from.
 *
 * @param {string} draft   one user-facing piece of text (a subject or a body)
 * @param {string} prompt  the prompt the draft was written from
 * @returns {string[]}     problems found; empty when the draft is clean
 */
export function outboundCopyProblems(draft, prompt = '') {
  if (typeof draft !== 'string' || !draft.trim()) return [];
  prompt = prompt.replace(OUTBOUND_COPY_RULES, '');
  const problems = [];
  const supplied = (token) => prompt.toLowerCase().includes(token.toLowerCase().replace(/\s+/g, ' '));

  const placeholder = draft.match(/\[[^\]\n]{1,80}\]/);
  if (placeholder) problems.push(`bracketed placeholder ${placeholder[0]}`);
  for (const [pattern, what] of META) if (pattern.test(draft)) problems.push(what);
  if (signsAsBarry(draft)) problems.push('signed or introduced as Barry');
  else if (signsWithName(draft)) problems.push('signs with a name it was not given');

  for (const pattern of [CLOCK_TIME, WEEKDAY, CALENDAR_DATE]) {
    for (const m of draft.match(pattern) ?? []) if (!supplied(m)) problems.push(`invented date or time "${m}"`);
  }
  if (ATTACHMENT.test(draft) && !/\battach/i.test(prompt)) problems.push('mentions an attachment');

  if (!PRIOR_CONTACT_SUPPLIED.test(prompt)) {
    const hit = PRIOR_CONVERSATION.map((p) => draft.match(p)).find(Boolean);
    if (hit) problems.push(`implies a prior conversation ("${hit[0]}")`);
  }

  for (const m of draft.match(STATED_NUMBER) ?? []) {
    const number = m.match(/\d[\d,.]*/)[0].replace(/[.,]$/, '');
    if (!new RegExp(`(?<![\\d.])${number.replace(/[.,]/g, '\\$&')}(?![\\d])`).test(prompt)) problems.push(`unsupported number "${m.trim()}"`);
  }

  for (const sentence of draft.split(/(?<=[.!?])\s+|\n+/)) {
    if (ACHIEVED_CLAIM.test(sentence) && RESULT_SIZE.test(sentence) && !GOAL_WORDS.test(sentence)
        && !/\bachieved\b|\bhave (?:cut|halved|reduced)\b/i.test(prompt)) {
      problems.push(`states a goal as an achieved result ("${sentence.trim().slice(0, 80)}")`);
    }
  }
  return [...new Set(problems)];
}

/** The first problem across several pieces of one draft, as a check note, or null. */
function firstProblem(pieces, request) {
  const prompt = promptText(request);
  for (const piece of pieces) {
    const [problem] = outboundCopyProblems(piece, prompt);
    if (problem) return `draft is not ready to send: ${problem}`;
  }
  return null;
}

/** Endpoints whose output a person reads and sends; their replies are printed for tone review. */
export const MESSAGE_WRITERS = ['sequence-step', 'campaign-message', 'followup', 'engagement-message'];
