/**
 * replyPolling.js writes its timeline event directly via a transactional
 * tx.set rather than through timelineWrite.js's writeTimelineEvent — that
 * helper only exposes a non-transactional .add(), which would reopen the
 * exact partial-failure inconsistency this module exists to prevent. The
 * trade-off is that writeTimelineEvent's own TIMELINE_EVENT_TYPES
 * allowlist check is bypassed for this one call site.
 *
 * Since the `type` written there is a hardcoded literal, never a dynamic
 * value, there is nothing for a runtime check to protect against — this
 * pins the literal against the same canonical allowlist instead, so a
 * future rename or removal of 'message_received' from that list is still
 * caught, just at test time rather than at write time.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TIMELINE_EVENT_TYPES } from '../constants/timelineEvents.js';

const here = dirname(fileURLToPath(import.meta.url));
const file = readFileSync(resolve(here, '..', '..', 'netlify/functions/utils/replyPolling.js'), 'utf8');

describe('replyPolling.js timeline event type', () => {
  it('writes the literal "message_received", and that literal is in the canonical allowlist', () => {
    expect(file).toContain("type: 'message_received'");
    expect(TIMELINE_EVENT_TYPES).toContain('message_received');
  });
});
