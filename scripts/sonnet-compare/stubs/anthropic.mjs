/** Stand-in for @anthropic-ai/sdk during capture: records the request, never sends it. */
import { captureState } from './state.mjs';

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
        };
      },
    };
  }
}
