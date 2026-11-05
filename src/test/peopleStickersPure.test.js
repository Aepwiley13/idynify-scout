/**
 * S6 pure rules: the ?sticker= link, which filter applies, counts in one
 * pass, search by active sticker name, and the bulk summary line.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  readUrlSticker, writeUrlSticker, resolveStickerFilter, hasSticker, countStickers, matchesStickerName, bulkSummaryText,
} from '../components/stickers/peopleStickers';
import { sticker, sid } from './helpers/stickersUi';

const BOARD = sticker('Board');
const DONOR = sticker('Donor');
const OLD = sticker('Old', { status: 'archived' });
const byId = new Map([BOARD, DONOR, OLD].map((s) => [s.id, s]));

afterEach(() => window.history.replaceState(null, '', '/'));

describe('the ?sticker= link', () => {
  it('reads the id, or null', () => {
    expect(readUrlSticker(`?tab=people&sticker=${BOARD.id}`)).toBe(BOARD.id);
    expect(readUrlSticker('?tab=people')).toBeNull();
    expect(readUrlSticker('?sticker=')).toBeNull();
  });

  it('writes without navigating, keeping every other parameter and the hash', () => {
    window.history.replaceState({ idx: 3 }, '', '/command-center?tab=people&tag=Gala#top');
    const before = window.history.length;
    writeUrlSticker(BOARD.id);
    expect(window.location.search).toBe(`?tab=people&tag=Gala&sticker=${BOARD.id}`);
    expect(window.location.hash).toBe('#top');
    expect(window.history.state).toEqual({ idx: 3 });
    expect(window.history.length).toBe(before);
    writeUrlSticker(null);
    expect(window.location.search).toBe('?tab=people&tag=Gala');
  });
});

describe('which filter applies', () => {
  it('a known active sticker applies; archived, unknown or none does not', () => {
    expect(resolveStickerFilter(BOARD.id, byId)).toEqual({ sticker: BOARD, notice: false });
    expect(resolveStickerFilter(OLD.id, byId)).toEqual({ sticker: null, notice: true });
    expect(resolveStickerFilter(sid('Someone else'), byId)).toEqual({ sticker: null, notice: true });
    expect(resolveStickerFilter(null, byId)).toEqual({ sticker: null, notice: false });
  });
});

describe('counts and search', () => {
  const contacts = [
    { id: 'a', sticker_ids: [BOARD.id, DONOR.id] },
    { id: 'b', sticker_ids: [BOARD.id, BOARD.id, OLD.id] },
    { id: 'c' },
    { id: 'd', sticker_ids: 'not a list' },
  ];

  it('counts each active sticker once per contact', () => {
    expect([...countStickers(contacts, [BOARD, DONOR])]).toEqual([[BOARD.id, 2], [DONOR.id, 1]]);
    expect(hasSticker(contacts[1], BOARD.id)).toBe(true);
    expect(hasSticker(contacts[2], BOARD.id)).toBe(false);
  });

  it('counts 1,000 contacts quickly, in one pass', () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ id: `k${i}`, sticker_ids: [BOARD.id, DONOR.id, sid(`x${i % 5}`)].slice(0, i % 4) }));
    const t0 = performance.now();
    const counts = countStickers(many, [BOARD, DONOR]);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(counts.get(BOARD.id)).toBe(750);
  });

  it('search matches active sticker names only', () => {
    expect(matchesStickerName(contacts[0], byId, 'boa')).toBe(true);
    expect(matchesStickerName(contacts[1], byId, 'old')).toBe(false);
    expect(matchesStickerName(contacts[2], byId, 'boa')).toBe(false);
    expect(matchesStickerName(contacts[0], byId, '')).toBe(false);
  });
});

describe('bulk summary', () => {
  it('reads like the spec', () => {
    expect(bulkSummaryText({ added: Array(37), already: Array(2), failed: Array(1) })).toBe('Added to 37 · 2 already had it · 1 not changed');
    expect(bulkSummaryText({ added: Array(3), already: [], failed: [] })).toBe('Added to 3');
  });
});
