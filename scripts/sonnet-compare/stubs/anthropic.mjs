/** Stand-in for @anthropic-ai/sdk during capture: records the request, never sends it. */
import { captureState } from './state.mjs';

/**
 * Replies that fail readClaudeText, chosen with SONNET_COMPARE_REPLY, so tests
 * can see what each handler does and logs with them. Unset: a reply every
 * handler can get past.
 */
const FAILURES = {
  truncated: { content: [{ type: 'text', text: '{"steps": [{"stepNumber": 1, "act' }], stop_reason: 'max_tokens' },
  refusal: { content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } },
  malformed: { content: null, stop_reason: 'end_turn' },
  empty: { content: [{ type: 'thinking', thinking: '', signature: 'sig' }], stop_reason: 'end_turn' },
};

export default class Anthropic {
  constructor() {
    this.messages = {
      create: async (params) => {
        captureState().requests.push(structuredClone(params));
        // A reply every handler can get past, so it returns instead of retrying.
        return {
          id: 'msg_capture', type: 'message', role: 'assistant', model: params.model,
          content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn',
          usage: { input_tokens: 0, output_tokens: 0 },
          ...structuredClone(FAILURES[process.env.SONNET_COMPARE_REPLY] ?? {}),
        };
      },
    };
  }
}
