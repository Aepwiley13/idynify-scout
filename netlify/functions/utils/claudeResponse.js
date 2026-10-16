/**
 * Read the text of a Claude Messages API response (#699, step 1).
 *
 * Every Sonnet call site used to take `response.content[0].text`. That holds on
 * claude-sonnet-4-5, which returns a single text block, but not on its
 * replacement: Sonnet 5.5 thinks by default and can put a `thinking` block
 * first, so content[0].text is undefined and the JSON endpoints throw while the
 * plain-text ones return nothing. It also never looked at stop_reason, so a
 * refusal or a reply cut off at max_tokens was treated as a finished answer.
 *
 * This reads the response the same way on every model: it checks stop_reason
 * first, keeps only `text` blocks (thinking blocks are ignored), and joins them
 * in order. On claude-sonnet-4-5 today that is exactly content[0].text.
 */

export class ClaudeResponseError extends Error {
  /**
   * @param {'malformed'|'refusal'|'truncated'|'empty'} reason
   * @param {string} message
   * @param {{stopReason?: string|null, category?: string|null}} [details]
   */
  constructor(reason, message, { stopReason = null, category = null } = {}) {
    super(message);
    this.name = 'ClaudeResponseError';
    this.reason = reason;
    this.stopReason = stopReason;
    this.category = category;
  }
}

/** Stop reasons that mean the reply did not finish. */
const INCOMPLETE = new Set(['max_tokens', 'pause_turn']);

/**
 * @param {{content?: Array<{type?: string, text?: string}>, stop_reason?: string|null, stop_details?: {category?: string|null}|null}} response
 * @returns {string} the reply's text blocks joined in order, unmodified
 * @throws {ClaudeResponseError}
 */
export function readClaudeText(response) {
  if (!response || !Array.isArray(response.content)) {
    throw new ClaudeResponseError('malformed', 'Claude response has no content array');
  }

  const stopReason = response.stop_reason ?? null;

  if (stopReason === 'refusal') {
    const category = response.stop_details?.category ?? null;
    throw new ClaudeResponseError(
      'refusal',
      `Claude declined the request${category ? ` (${category})` : ''}`,
      { stopReason, category },
    );
  }

  if (INCOMPLETE.has(stopReason)) {
    throw new ClaudeResponseError(
      'truncated',
      `Claude response is incomplete (stop_reason: ${stopReason})`,
      { stopReason },
    );
  }

  // Text blocks are consecutive pieces of one reply (citations split a reply
  // the same way), so they join with no separator.
  const text = response.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');

  if (!text.trim()) {
    throw new ClaudeResponseError('empty', 'Claude response contains no text', { stopReason });
  }

  return text;
}
