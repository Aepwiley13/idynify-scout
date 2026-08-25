/**
 * GATE 1 (G1-03/G1-04) — timeline contract.
 * The static-scan test is the anti-drift mechanism: it fails the build if any
 * type emitted anywhere in src/ is missing from the single allowlist, which is
 * exactly how the two previous lists diverged unnoticed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { TIMELINE_EVENT_TYPES, ACTORS, isValidTimelineEvent } from '../constants/timelineEvents.js';

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(p)) out.push(p);
  }
  return out;
}

describe('canonical timeline allowlist', () => {
  it('restores the four event types that were emitted and discarded', () => {
    for (const t of ['reply_received', 'outreach_logged', 'mission_debrief', 'referral_ask_sent']) {
      expect(TIMELINE_EVENT_TYPES, `${t} must be accepted`).toContain(t);
    }
  });

  it('accepts the server-written types that used to bypass validation', () => {
    for (const t of ['message_received', 'meeting_scheduled', 'email_opened', 'reply_sent']) {
      expect(TIMELINE_EVENT_TYPES).toContain(t);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(TIMELINE_EVENT_TYPES).size).toBe(TIMELINE_EVENT_TYPES.length);
  });

  it('rejects an unknown type', () => {
    expect(isValidTimelineEvent('definitely_not_a_real_event')).toBe(false);
  });

  it('exposes the contact actor used by inbound reply writers', () => {
    expect(ACTORS.CONTACT).toBe('contact');
  });

  // ANTI-DRIFT: every literal `type: 'x'` next to a logTimelineEvent call must be listed.
  it('every event type emitted in src/ is in the allowlist', () => {
    const offenders = [];
    for (const file of walk('src')) {
      if (file.includes('constants/timelineEvents')) continue;
      const src = readFileSync(file, 'utf8');
      if (!src.includes('logTimelineEvent')) continue;
      const re = /logTimelineEvent\s*\(\s*\{[\s\S]{0,600}?type:\s*'([a-z_]+)'/g;
      let m;
      while ((m = re.exec(src))) {
        if (!TIMELINE_EVENT_TYPES.includes(m[1])) offenders.push(`${file}: ${m[1]}`);
      }
    }
    expect(offenders, `unlisted types:\n${offenders.join('\n')}`).toEqual([]);
  });
});
