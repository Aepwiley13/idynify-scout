/**
 * The sticker rollout decision (src/constants/stickersAccess.js).
 *
 * STICKER_ACCESS_MATRIX is the parity table: this file runs it against
 * decideStickerAccess(), and scripts/rules-check/stickers.mjs runs the same
 * rows against the real Firestore rules in the emulator. If the two ever
 * disagree, the app would show sticker controls the database refuses, or hide
 * ones it allows.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  STICKER_ACCESS_MATRIX,
  STICKER_MODES,
  decideStickerAccess,
  readStickerMode,
} from '../constants/stickersAccess.js';

const here = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(here, '../../firestore.rules'), 'utf8');

describe('decideStickerAccess', () => {
  it.each(STICKER_ACCESS_MATRIX.map((row) => [row]))('%o', (row) => {
    expect(decideStickerAccess({ mode: row.mode ?? undefined, role: row.role ?? undefined, enrollmentStage: row.stage ?? undefined }))
      .toBe(row.allowed);
  });

  it('treats anything but an exact mode as off', () => {
    for (const value of [undefined, null, '', 'ON', ' on', 'true', true, 1, {}]) {
      expect(readStickerMode(value)).toBe(STICKER_MODES.OFF);
      expect(decideStickerAccess({ mode: value, role: 'super_admin', enrollmentStage: 'beta' })).toBe(false);
    }
  });

  it('never grants access from a role or stage that is not exactly a known value', () => {
    for (const role of ['Admin', 'admin ', 'owner', ['admin']]) {
      expect(decideStickerAccess({ mode: 'internal', role })).toBe(false);
    }
    for (const stage of ['Beta', 'beta ', true]) {
      expect(decideStickerAccess({ mode: 'beta', enrollmentStage: stage })).toBe(false);
    }
  });

  it('covers every mode in the parity table, including a missing flag document', () => {
    const modes = new Set(STICKER_ACCESS_MATRIX.map((row) => row.mode));
    for (const mode of [null, ...Object.values(STICKER_MODES)]) expect(modes.has(mode)).toBe(true);
  });
});

describe('the rules use the same inputs', () => {
  it('read the mode from feature_flags/stickers and default to off', () => {
    expect(rules).toMatch(/feature_flags\/stickers;\s*return exists\(flag\) \? get\(flag\)\.data\.get\('mode', 'off'\) : 'off';/);
  });

  it('treat exactly the same roles as admins, from users/{uid}.role', () => {
    expect(rules).toMatch(/get\(me\)\.data\.get\('role', ''\) in \['admin', 'super_admin'\]/);
  });

  it('enroll exactly the same stage', () => {
    expect(rules).toMatch(/get\(row\)\.data\.get\('stage', ''\) == 'beta'/);
  });

  it('keep the rollback switch on, exactly once', () => {
    expect(rules.match(/function stickerRulesEnabled\(\) \{\s*return true;\s*\}/g)).toHaveLength(1);
  });
});

/**
 * A partial revert of the sticker rules would not fail the emulator suite's
 * build step, and would quietly re-open writes: the generic owner rules would
 * cover stickers and membership again. These pin the pieces whose removal
 * broadens permissions.
 */
describe('the pieces whose removal would broaden permissions are present', () => {
  /** The text of one `match ... {` block, from its header to its matching closing brace. */
  const block = (header) => {
    const start = rules.indexOf(header);
    expect(start).toBeGreaterThan(-1);
    let depth = 0;
    for (let i = start + header.length - 1; i < rules.length; i += 1) {
      if (rules[i] === '{') depth += 1;
      if (rules[i] === '}' && --depth === 0) return rules.slice(start, i + 1);
    }
    throw new Error(`unclosed block: ${header}`);
  };

  it('every generic grant under users/{uid} excludes the stickers collection and checks membership', () => {
    const generic = block('match /{coll}/{docId} {');
    const deep = block('match /{coll}/{docId}/{rest=**} {');
    expect(generic.match(/coll != 'stickers'/g)).toHaveLength(2); // create, and update/delete
    expect(generic.match(/contactStickersOk\(coll, userId\)/g)).toHaveLength(2);
    expect(deep.match(/coll != 'stickers'/g)).toHaveLength(1);
    expect(deep.match(/contactStickersOk\(coll, userId\)/g)).toHaveLength(1);
  });

  it('stickers are never deleted, and every write needs the rollout to allow it', () => {
    const stickers = block('match /stickers/{stickerId} {');
    expect(stickers).toMatch(/allow delete: if false;/);
    expect(stickers.match(/stickerWritesAllowed\(\)/g)).toHaveLength(2); // create and update
    expect(rules).toMatch(/return stickerRulesEnabled\(\) && request\.auth != null && \(/);
  });

  it('the rollout documents stay server-only', () => {
    expect(block('match /feature_flags/{flag} {')).toMatch(/allow read, write: if false;/);
    expect(block('match /sticker_enrollment/{userId} {')).toMatch(/allow read, write: if false;/);
  });
});
