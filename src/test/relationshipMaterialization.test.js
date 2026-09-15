/**
 * ADR-006 backfill regression fixture — permanent, sanitized.
 *
 * ─── THE CONDITION THIS ENCODES ─────────────────────────────────────────────
 *
 * The Gate 2 production audit found a contact whose relationship state had been
 * repaired by hand — someone clicked "Sync Replies" — days after the reply
 * itself arrived. That made the legacy field NEWER than the Gmail event a
 * backfill was about to replay, and a naive backfill would have dragged current
 * state backwards onto the older timestamp.
 *
 * The record itself is a real person in a customer's workspace, so nothing
 * identifying it appears here: no name, no address, no document id, no real
 * timestamp. The fixture reproduces the *shape* of the condition from synthetic
 * data at relative offsets, which is the only part that needs to outlive the
 * migration.
 *
 * ─── WHY IT IS PERMANENT RATHER THAN A MIGRATION CHECK ──────────────────────
 *
 * Monotonicity is a live write-path invariant, not a one-time precaution. Every
 * out-of-order Gmail delivery exercises it, and the sync worker replays its
 * batch after any failure by design — so the "older event arrives after newer
 * state" case is ordinary traffic, not a migration artifact. The fixture keeps
 * passing long after the backfill is history, and fails the moment someone
 * makes materialization unconditional.
 *
 * Pure-logic scope: `materialize()` and `applyEvent()` own the RULES. Storage,
 * transactions and exactly-once creation belong to the writer, which does not
 * exist yet — Gate 3 owns it. `seenKeys` stands in for Firestore document-id
 * uniqueness, which is the same decision made on the same key.
 */

import { describe, it, expect } from 'vitest';
import {
  applyEvent,
  materialize,
  eventKey,
  createEmptyState,
  EVENT_TYPES,
  RELATIONSHIP_STATES,
} from '../utils/relationshipMaterialization';

// ── Synthetic fixture data — no production identifiers ──────────────────────

const USER = 'user_fixture_0001';
const CONTACT = 'contact_fixture_0001';

/** Relative offsets. T is arbitrary; only the 8-day gap is meaningful. */
const T = '2020-01-01T00:00:00.000Z';
const T_PLUS_8D = '2020-01-09T00:00:00.000Z';

const OLDER_MESSAGE_ID = 'msg_fixture_older';
const NEWER_MESSAGE_ID = 'msg_fixture_newer';

function inboundReply({ messageId, occurredAt, source = 'gmail_sync' }) {
  return {
    idynifyUserId: USER,
    contactId: CONTACT,
    gmailMessageId: messageId,
    gmailThreadId: 'thread_fixture_0001',
    eventType: EVENT_TYPES.INBOUND_REPLY,
    occurredAt,
    source,
    identity: { signal: 'email', outcome: 'MATCHED' },
  };
}

const NEWER_EVENT = inboundReply({ messageId: NEWER_MESSAGE_ID, occurredAt: T_PLUS_8D });
const OLDER_EVENT = inboundReply({
  messageId: OLDER_MESSAGE_ID,
  occurredAt: T,
  source: 'backfill',
});

describe('ADR-006 — an older event never regresses newer relationship state', () => {
  /** Records the newer event, then the previously unseen older one. */
  function recordNewerThenOlder() {
    const seenKeys = new Set();
    let state = createEmptyState();

    const newer = applyEvent(state, NEWER_EVENT, seenKeys);
    state = newer.state;

    const older = applyEvent(state, OLDER_EVENT, seenKeys);
    state = older.state;

    return { state, seenKeys, newer, older };
  }

  it('records both canonical events', () => {
    const { seenKeys, newer, older } = recordNewerThenOlder();

    expect(newer.created).toBe(true);
    expect(older.created).toBe(true);
    expect(seenKeys.has(eventKey(NEWER_EVENT))).toBe(true);
    expect(seenKeys.has(eventKey(OLDER_EVENT))).toBe(true);
    expect(seenKeys.size).toBe(2);
  });

  it('counts the older event even though it arrived late', () => {
    const { state } = recordNewerThenOlder();
    expect(state.reply_count).toBe(2);
  });

  it('leaves last_inbound_at at the newer timestamp', () => {
    const { state } = recordNewerThenOlder();
    expect(state.last_inbound_at).toBe(T_PLUS_8D);
  });

  it('leaves last_inbound_message_id pointing at the newer message', () => {
    const { state } = recordNewerThenOlder();
    expect(state.last_inbound_message_id).toBe(NEWER_MESSAGE_ID);
  });

  it('does not regress current relationship state or its source', () => {
    const { state } = recordNewerThenOlder();
    expect(state.state).toBe(RELATIONSHIP_STATES.IN_CONVERSATION);
    // `source` belongs to the event holding last_inbound_at — the backfilled
    // older event must not claim it.
    expect(state.source).toBe('gmail_sync');
  });
});

describe('ADR-006 — replay of an already-recorded event is inert', () => {
  function recordThenReplayOlder() {
    const seenKeys = new Set();
    let state = createEmptyState();

    state = applyEvent(state, NEWER_EVENT, seenKeys).state;
    state = applyEvent(state, OLDER_EVENT, seenKeys).state;

    const before = { ...state };
    const replay = applyEvent(state, OLDER_EVENT, seenKeys);

    return { before, replay, seenKeys };
  }

  it('creates no duplicate event', () => {
    const { replay, seenKeys } = recordThenReplayOlder();
    expect(replay.created).toBe(false);
    expect(seenKeys.size).toBe(2);
  });

  it('does not increment reply_count again', () => {
    const { before, replay } = recordThenReplayOlder();
    expect(replay.state.reply_count).toBe(2);
    expect(replay.state.reply_count).toBe(before.reply_count);
  });

  it('triggers no downstream effects', () => {
    const { replay } = recordThenReplayOlder();
    expect(replay.effects).toEqual([]);
  });

  it('leaves every materialized field untouched', () => {
    const { before, replay } = recordThenReplayOlder();
    expect(replay.state).toEqual(before);
  });

  it('decides replay on the event key alone, not on current state', () => {
    // The guarantee that separates the two layers: state points at the NEWER
    // message while the replayed message is the OLDER one. If dedup consulted
    // last_inbound_message_id, this would wrongly read as unseen.
    const { replay } = recordThenReplayOlder();
    expect(replay.state.last_inbound_message_id).toBe(NEWER_MESSAGE_ID);
    expect(eventKey(OLDER_EVENT)).not.toBe(eventKey(NEWER_EVENT));
    expect(replay.created).toBe(false);
  });
});

describe('ADR-006 — state stays derived, never sovereign', () => {
  it('recomputes identically to the incrementally-maintained cache', () => {
    const seenKeys = new Set();
    let incremental = createEmptyState();
    incremental = applyEvent(incremental, NEWER_EVENT, seenKeys).state;
    incremental = applyEvent(incremental, OLDER_EVENT, seenKeys).state;

    const recomputed = materialize([NEWER_EVENT, OLDER_EVENT]);

    expect(recomputed).toEqual(incremental);
  });

  it('is independent of the order events are supplied in', () => {
    expect(materialize([OLDER_EVENT, NEWER_EVENT]))
      .toEqual(materialize([NEWER_EVENT, OLDER_EVENT]));
  });

  it('collapses duplicates on the event key during a full recompute', () => {
    const withDuplicates = materialize([
      NEWER_EVENT, OLDER_EVENT, OLDER_EVENT, NEWER_EVENT, OLDER_EVENT,
    ]);
    expect(withDuplicates).toEqual(materialize([NEWER_EVENT, OLDER_EVENT]));
    expect(withDuplicates.reply_count).toBe(2);
  });
});
