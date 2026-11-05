/**
 * The pure pieces of the sticker UI: colors meet contrast in every theme,
 * every failure has its one message, the recent list survives bad storage,
 * and a confirmed change is applied to local state exactly.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { THEMES } from '../theme/tokens';
import { STICKER_COLORS, STICKER_ERRORS, DENIAL_REASONS, withMembershipChange } from '../services/stickers/stickerCore';
import { STICKER_HEX, TINT_ALPHA, stickerStyle, nextStickerColor } from '../components/stickers/stickerPalette';
import { describeStickerError, logStickerFailure, LIMIT_MESSAGE } from '../components/stickers/stickerMessages';
import { readRecentStickerIds, rememberRecentSticker, RECENT_LIMIT } from '../components/stickers/recentStickers';
import { sid } from './helpers/stickersUi';

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = ([r, g, b]) => {
  const c = [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const blend = (fg, alpha, bg) => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));

describe('sticker colors', () => {
  const alpha = parseInt(TINT_ALPHA, 16) / 255;
  for (const [themeName, T] of Object.entries(THEMES)) {
    for (const color of STICKER_COLORS) {
      it(`${color} on ${themeName}: the name meets 4.5:1`, () => {
        const chipBg = blend(rgb(STICKER_HEX[color]), alpha, rgb(T.cardBg));
        expect(contrast(rgb(T.text), chipBg)).toBeGreaterThanOrEqual(4.5);
        expect(stickerStyle(color, T).color).toBe(T.text);
      });
    }
  }

  it('has a hex for every sticker color, and new stickers cycle through them', () => {
    expect(Object.keys(STICKER_HEX).sort()).toEqual([...STICKER_COLORS].sort());
    expect([0, 1, 8, 9].map(nextStickerColor)).toEqual([STICKER_COLORS[0], STICKER_COLORS[1], STICKER_COLORS[0], STICKER_COLORS[1]]);
  });
});

describe('messages (UI spec §4)', () => {
  const err = (code, reason = null) => ({ code, reason });
  it.each([
    [err(STICKER_ERRORS.INVALID_NAME), 'A sticker name needs 1–60 characters.', false, false],
    [err(STICKER_ERRORS.INVALID_COLOR), 'Pick one of the colors.', false, false],
    [err(STICKER_ERRORS.INVALID_EMOJI), 'That emoji is too long.', false, false],
    [err(STICKER_ERRORS.INVALID_DESCRIPTION), 'A description can be up to 280 characters.', false, false],
    [err(STICKER_ERRORS.LIMIT_REACHED), LIMIT_MESSAGE, false, false],
    [err(STICKER_ERRORS.STICKER_ARCHIVED), 'That sticker was archived. Restore it from Stickers to use it.', false, false],
    [err(STICKER_ERRORS.STICKER_NOT_FOUND), 'That sticker no longer exists.', false, false],
    [err(STICKER_ERRORS.CONTACT_NOT_FOUND), 'This contact no longer exists.', false, false],
    [err(STICKER_ERRORS.PERMISSION_DENIED, DENIAL_REASONS.READ_DENIED), "You can't change stickers on this contact.", false, false],
    [err(STICKER_ERRORS.PERMISSION_DENIED, DENIAL_REASONS.WRITE_DENIED), "Stickers can't be changed right now.", false, true],
    [err(STICKER_ERRORS.PERMISSION_DENIED, DENIAL_REASONS.CONTENTION_EXHAUSTED), "Couldn't save. Try again.", true, false],
    [err(STICKER_ERRORS.WRITE_FAILED), "Couldn't save. Try again.", true, false],
    [new Error('raw firebase text'), 'Something went wrong. Try again.', false, false],
  ])('%o', (error, message, retryable, writeDenied) => {
    expect(describeStickerError(error)).toEqual({ message, retryable, writeDenied });
  });

  it('logs codes only', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logStickerFailure('add', { code: 'write_failed', reason: null, message: 'contact Pat' });
    expect(JSON.stringify(spy.mock.calls)).not.toContain('Pat');
    spy.mockRestore();
  });
});

describe('recent stickers', () => {
  afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });

  it('keeps the latest first, at most five, ids only, per user', () => {
    const ids = ['A', 'B', 'C', 'D', 'E', 'F'].map(sid);
    for (const id of ids) rememberRecentSticker('u1', id);
    rememberRecentSticker('u1', ids[2]);
    expect(readRecentStickerIds('u1')).toEqual([ids[2], ids[5], ids[4], ids[3], ids[1]]);
    expect(readRecentStickerIds('u1')).toHaveLength(RECENT_LIMIT);
    expect(readRecentStickerIds('u2')).toEqual([]);
  });

  it('ignores junk, and survives blocked storage', () => {
    window.localStorage.setItem('idynify.stickers.recent.u1', '{not json');
    expect(readRecentStickerIds('u1')).toEqual([]);
    window.localStorage.setItem('idynify.stickers.recent.u1', JSON.stringify(['../x', 42, sid('Ok')]));
    expect(readRecentStickerIds('u1')).toEqual([sid('Ok')]);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readRecentStickerIds('u1')).toEqual([]);
    expect(rememberRecentSticker('u1', sid('Ok'))).toEqual([sid('Ok')]);
  });
});

describe('withMembershipChange', () => {
  const contact = { id: 'c1', tags: ['t'], sticker_ids: ['a1'] };
  it('adds once, removes, and touches nothing else', () => {
    expect(withMembershipChange(contact, 'b2', 'add')).toEqual({ id: 'c1', tags: ['t'], sticker_ids: ['a1', 'b2'] });
    expect(withMembershipChange(contact, 'a1', 'add').sticker_ids).toEqual(['a1']);
    expect(withMembershipChange(contact, 'a1', 'remove')).toEqual({ id: 'c1', tags: ['t'], sticker_ids: [] });
    expect(withMembershipChange({ id: 'c2' }, 'a1', 'add').sticker_ids).toEqual(['a1']);
    expect(contact.sticker_ids).toEqual(['a1']);
  });
});
