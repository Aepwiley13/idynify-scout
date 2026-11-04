/**
 * Only src/services/stickers/stickerCore.js writes stickers or sticker
 * membership (ADR-007). This runs the source scan in CI; the same scan is rule
 * 5 of scripts/verifyWritePaths.mjs.
 *
 * Each detector is first shown to fire on a deliberate violation, so a scan
 * that has quietly stopped matching cannot pass as coverage.
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { findStickerWriteViolations, scanSource, STICKER_EXEMPT } from '../../scripts/lib/stickerWritePaths.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('the scan fires on what it is meant to catch', () => {
  it.each([
    ['a sticker_ids key', `updateDoc(ref, { sticker_ids: [] });`],
    ['a sticker_assignments field path', 'updateDoc(ref, { [`sticker_assignments.${id}`]: x });'],
    ['a quoted sticker_change key', `const w = { 'sticker_change': {} };`],
    ['the stickers collection through doc()', `doc(db, 'users', uid, 'stickers', id);`],
    ['the stickers collection through collection()', `collection(db, 'users', uid, 'stickers');`],
    ['the stickers collection through the Admin SDK', `db.collection('users').doc(uid).collection('stickers').add({});`],
  ])('%s', (_label, source) => {
    expect(scanSource(source, 'x.js')).not.toEqual([]);
  });

  it.each([
    ['reading contact.sticker_ids', `const ids = contact.sticker_ids ?? [];`],
    ['a tags write', `updateDoc(ref, { tags: arrayUnion(tag) });`],
    ['a "stickers" word in other calls', `t('stickers'); log('stickers');`],
  ])('does not fire on %s', (_label, source) => {
    expect(scanSource(source, 'x.js')).toEqual([]);
  });
});

describe('the codebase', () => {
  it('no module but stickerCore touches sticker data', () => {
    expect(findStickerWriteViolations(repoRoot)).toEqual([]);
  });

  it('every exemption has a reason', () => {
    for (const exemption of STICKER_EXEMPT) expect(exemption.reason).toMatch(/\w{10,}/);
  });
});
