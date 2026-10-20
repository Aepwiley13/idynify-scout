/**
 * readClaudeText — the one way the Sonnet call sites read a reply (#699, step 1).
 *
 * The call sites used to take response.content[0].text. On Sonnet 5.5 a
 * `thinking` block can come first, which makes that undefined, and nothing
 * checked stop_reason, so a refusal or a reply cut off at max_tokens passed as
 * a finished answer. These cases pin the helper's contract on every response
 * shape the call sites can receive.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readClaudeText, ClaudeResponseError, findClaudeResponseError, claudeErrorCode } from '../../netlify/functions/utils/claudeResponse.js';

const here = dirname(fileURLToPath(import.meta.url));

const text = (t) => ({ type: 'text', text: t });
const thinking = (t = '') => ({ type: 'thinking', thinking: t, signature: 'sig' });
const reply = (content, stop_reason = 'end_turn', extra = {}) => ({ content, stop_reason, ...extra });

/** Run fn and return the ClaudeResponseError it throws. */
function failure(fn) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ClaudeResponseError);
    return err;
  }
  throw new Error('expected readClaudeText to throw');
}

describe('readClaudeText', () => {
  it('normal text-only response: returns the text exactly as content[0].text did', () => {
    const body = '  {"ok": true}\n';
    expect(readClaudeText(reply([text(body)]))).toBe(body);
  });

  it('thinking block before text: skips the thinking and returns the text', () => {
    expect(readClaudeText(reply([thinking('weighing options'), text('{"ok": true}')]))).toBe('{"ok": true}');
    // Thinking text is empty by default on newer models; still ignored
    expect(readClaudeText(reply([thinking(''), text('Hi Jane,')]))).toBe('Hi Jane,');
  });

  it('multiple text blocks: joins them in order with nothing added', () => {
    expect(readClaudeText(reply([text('{"a": '), text('1}')]))).toBe('{"a": 1}');
  });

  it('thinking + multiple text blocks: keeps only the text, in order', () => {
    const content = [thinking('first'), text('SUBJECT: Hi\n'), thinking('second'), text('BODY:\nHello')];
    expect(readClaudeText(reply(content))).toBe('SUBJECT: Hi\nBODY:\nHello');
  });

  it('refusal: throws, with the category when the API gives one', () => {
    const err = failure(() => readClaudeText(reply([text('I can’t help with that.')], 'refusal', {
      stop_details: { type: 'refusal', category: 'cyber', explanation: '…' },
    })));
    expect(err.reason).toBe('refusal');
    expect(err.category).toBe('cyber');
    expect(err.message).toMatch(/declined/);

    // stop_details may be null
    expect(failure(() => readClaudeText(reply([], 'refusal', { stop_details: null }))).category).toBeNull();
  });

  it('truncated response: throws on max_tokens even when partial text is present', () => {
    const err = failure(() => readClaudeText(reply([text('{"steps": [{"day": 1, "bo')], 'max_tokens')));
    expect(err.reason).toBe('truncated');
    expect(err.stopReason).toBe('max_tokens');
  });

  it('a paused turn is incomplete too', () => {
    expect(failure(() => readClaudeText(reply([text('partial')], 'pause_turn'))).reason).toBe('truncated');
  });

  it('empty response: throws when there is no usable text', () => {
    for (const content of [[], [thinking('only thinking')], [text('')], [text('   \n')]]) {
      expect(failure(() => readClaudeText(reply(content))).reason).toBe('empty');
    }
  });

  it('malformed response: throws instead of crashing on a bad shape', () => {
    for (const bad of [null, undefined, {}, { content: null }, { content: 'text' }, { content: {} }]) {
      expect(failure(() => readClaudeText(bad)).reason).toBe('malformed');
    }
    // Blocks that aren't well-formed text are skipped, not read
    expect(readClaudeText(reply([null, { type: 'text' }, { type: 'text', text: 42 }, text('ok')]))).toBe('ok');
  });

  it('other completed stop reasons read normally', () => {
    expect(readClaudeText(reply([text('done')], 'stop_sequence'))).toBe('done');
    expect(readClaudeText({ content: [text('no stop_reason field')] })).toBe('no stop_reason field');
  });
});

describe('claudeErrorCode: the reason a failed reply is logged under', () => {
  const thrown = (response) => {
    try { readClaudeText(response); } catch (err) { return err; }
    throw new Error('expected readClaudeText to throw');
  };

  it('names each readClaudeText failure', () => {
    expect(claudeErrorCode(thrown(reply([text('{"a"')], 'max_tokens')))).toBe('claude_truncated:max_tokens');
    expect(claudeErrorCode(thrown(reply([], 'refusal', { stop_details: { category: 'cyber' } })))).toBe('claude_refusal:cyber');
    expect(claudeErrorCode(thrown(reply([], 'refusal', { stop_details: null })))).toBe('claude_refusal');
    expect(claudeErrorCode(thrown(null))).toBe('claude_malformed');
    expect(claudeErrorCode(thrown(reply([thinking()])))).toBe('claude_empty:end_turn');
  });

  it('finds the reason through a user-facing wrapper', () => {
    const inner = thrown(reply([text('{')], 'max_tokens'));
    const wrapped = new Error('Failed to generate valid mission sequence', { cause: inner });
    expect(findClaudeResponseError(wrapped)).toBe(inner);
    expect(claudeErrorCode(wrapped)).toBe('claude_truncated:max_tokens');
  });

  it('recognizes a copy of the class from another module instance', () => {
    const copy = Object.assign(new Error('incomplete'), { name: 'ClaudeResponseError', reason: 'truncated', stopReason: 'max_tokens' });
    expect(claudeErrorCode(copy)).toBe('claude_truncated:max_tokens');
  });

  it('keeps any other error as its message, with what it wraps', () => {
    expect(claudeErrorCode(new Error('API key not configured'))).toBe('API key not configured');
    const parse = new SyntaxError('Unexpected end of JSON input');
    expect(claudeErrorCode(new Error('Failed to generate valid context', { cause: parse })))
      .toBe('Failed to generate valid context: Unexpected end of JSON input');
    expect(claudeErrorCode('plain string')).toBe('plain string');
  });
});

describe('every Sonnet 4.5 call site reads through readClaudeText', () => {
  // The 11 calls in #699, in the 8 files that make them. barryMissionChat reaches
  // Sonnet only through barryICPConversation; its own reads are Haiku calls.
  const SITES = {
    'barryGenerateMissionSequence.js': 1,
    'barryICPConversation.js': 4,
    'barryGenerateContext.js': 1,
    'barryGenerateSequenceStep.js': 1,
    'barryValidateContact.js': 1,
    'generate-campaign-messages.js': 1,
    'generate-followup.js': 1,
    'generate-engagement-message.js': 1,
  };

  it.each(Object.entries(SITES))('%s: %i call(s), none reading content[0] directly', (file, calls) => {
    const src = readFileSync(resolve(here, `../../netlify/functions/${file}`), 'utf8');
    expect(src).toMatch(/['"]\.\/utils\/claudeResponse\.js['"]/);
    expect(src).not.toMatch(/\.content\[0\]/);
    expect(src.match(/readClaudeText\(/g)).toHaveLength(calls);
  });
});
