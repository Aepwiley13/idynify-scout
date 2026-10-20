/**
 * Per-endpoint acceptance: would this reply text have worked in the handler?
 *
 * Each check repeats exactly what its handler does with the text that
 * readClaudeText returns, so "ok" here means the endpoint would have used the
 * reply rather than falling back or returning an error. If a handler's parsing
 * changes, change its check here too.
 *
 * Every check returns { ok, note }. `note` names what failed, never the text.
 */

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

  // barryGenerateSequenceStep.js: parse, then body or "Failed to generate step content"
  'sequence-step': (text) => requireJson(text, (v) => (!v.body ? 'missing body' : null)),

  // barryValidateContact.js: an unparseable reply silently falls back to the top match
  'validate-contact': (text) => {
    const result = requireJson(text);
    return result.ok ? result : { ok: false, note: `${result.note} (handler falls back to the top match)` };
  },

  // generate-engagement-message.js: strip control chars + match + parse, else a ```json fence; then messages[] of 3+
  'engagement-message': (text) => {
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
    return { ok: true, note: '' };
  },

  // generate-campaign-messages.js: SUBJECT:/BODY: lines; without them it saves "Quick question" / the raw text
  'campaign-message': (text) => {
    const subject = /SUBJECT:\s*(.+)/.test(text);
    const body = /BODY:\s*([\s\S]+)/.test(text);
    if (subject && body) return { ok: true, note: '' };
    return { ok: false, note: `missing ${[!subject && 'SUBJECT:', !body && 'BODY:'].filter(Boolean).join(' and ')} (handler falls back to defaults)` };
  },

  // generate-followup.js: any text becomes the draft body, so this checks what
  // the user would see: the email and nothing else (#699).
  followup: (text) => {
    const problem = FOLLOWUP_META.find(([pattern]) => pattern.test(text));
    return problem ? { ok: false, note: `draft is not just the email: ${problem[1]}` } : { ok: true, note: '' };
  },
};

/** What, seen in a follow-up draft, means the model wrote about the email instead of only writing it. */
export const FOLLOWUP_META = [
  [/\[[^\]\n]{1,80}\]/, 'bracketed placeholder'],
  [/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/m, 'separator before extra text'],
  [/^\s*\**\s*(?:note|version|option|alternative)\b[^:\n]{0,60}:/im, 'note or alternative version'],
  [/\bI (?:can(?:'|’)t|cannot|can not) write\b/i, 'says it cannot write the email'],
  [/\b(?:don(?:'|’)t|do not|didn(?:'|’)t|did not) have (?:access to )?[\w'’ ]{0,30}\b(?:reply|response)\b/i, 'says the reply is missing'],
  [/\b(?:their|his|her|the) (?:actual )?(?:reply|response) (?:isn(?:'|’)t|is not|wasn(?:'|’)t|was not) (?:included|provided|available|shared)\b/i, 'says the reply is missing'],
  [/\b(?:paste|send me|share) (?:his|her|their|the) (?:actual )?(?:reply|response)\b/i, 'asks for the reply'],
];

/** Endpoints whose output a person reads; their replies are printed for tone review. */
export const MESSAGE_WRITERS = ['sequence-step', 'campaign-message', 'followup', 'engagement-message'];
