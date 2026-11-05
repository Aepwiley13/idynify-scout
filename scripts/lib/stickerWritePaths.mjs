/**
 * Who may touch sticker data (ADR-007), checked from source.
 *
 * One module writes stickers and sticker membership:
 *   src/services/stickers/stickerCore.js
 * Everything else reads stickers through it (stickerService.js,
 * contactStickers.js) and reads a contact's `sticker_ids` as a plain property.
 *
 * A violation is any other file, under src/ (tests excluded) or
 * netlify/functions/, that
 *   - names a membership field as an object key or a field path
 *     (`sticker_ids`, `sticker_assignments`, `sticker_change`,
 *     `sticker_assignments.<id>`), which is how a write is spelled; or
 *   - addresses the `stickers` collection directly
 *     (doc(..., 'stickers', ...), collection(..., 'stickers'),
 *     .collection('stickers')).
 * Reading `contact.sticker_ids` is a member expression, not a key, and is
 * allowed everywhere.
 *
 * Used by src/test/stickerWritePaths.test.js (CI) and by
 * scripts/verifyWritePaths.mjs (the manual write-path report).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parse } from '@babel/parser';

export const STICKER_WRITER = 'src/services/stickers/stickerCore.js';
export const MEMBERSHIP_FIELDS = Object.freeze(['sticker_ids', 'sticker_assignments', 'sticker_change']);

/**
 * Files allowed to touch sticker data besides the writer, each with a reason.
 * Empty in this release: Barry's read (S10) will need an entry.
 */
export const STICKER_EXEMPT = Object.freeze([]);

const isMembershipKey = (name) => typeof name === 'string'
  && (MEMBERSHIP_FIELDS.includes(name) || name.startsWith('sticker_assignments.'));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'test' || entry === '__tests__' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx|mjs)$/.test(entry) && !/\.test\.(js|jsx|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

function* nodes(node) {
  if (!node || typeof node !== 'object') return;
  yield node;
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    const child = node[key];
    if (Array.isArray(child)) for (const c of child) yield* nodes(c);
    else if (child && typeof child.type === 'string') yield* nodes(child);
  }
}

function keyName(key, computed) {
  if (!key) return null;
  if (key.type === 'Identifier' && !computed) return key.name;
  if (key.type === 'StringLiteral') return key.value;
  if (key.type === 'TemplateLiteral') return key.quasis.map((q) => q.value.cooked).join('${}');
  return null;
}

const calleeName = (callee) => {
  if (callee?.type === 'Identifier') return callee.name;
  if (callee?.type === 'MemberExpression' && callee.property?.type === 'Identifier') return callee.property.name;
  return null;
};

/** Violations in one file's source. */
export function scanSource(source, file) {
  let ast;
  try {
    ast = parse(source, { sourceType: 'module', plugins: ['jsx'], errorRecovery: true });
  } catch {
    return [{ file, line: 0, rule: 'sticker-scan', detail: 'could not be parsed, so it could not be checked.' }];
  }
  const found = [];
  for (const n of nodes(ast)) {
    if ((n.type === 'ObjectProperty' || n.type === 'ObjectMethod') && isMembershipKey(keyName(n.key, n.computed))) {
      found.push({ file, line: n.loc.start.line, rule: 'sticker-membership', detail: `names "${keyName(n.key, n.computed)}" as a key: only ${STICKER_WRITER} writes sticker membership.` });
    }
    if (n.type === 'CallExpression' && ['doc', 'collection'].includes(calleeName(n.callee))
        && n.arguments.some((a) => a.type === 'StringLiteral' && a.value === 'stickers')) {
      found.push({ file, line: n.loc.start.line, rule: 'sticker-registry', detail: `addresses the stickers collection: go through ${STICKER_WRITER}.` });
    }
  }
  return found;
}

/** Every violation under the given roots (default: src and netlify/functions). */
export function findStickerWriteViolations(repoRoot, roots = ['src', join('netlify', 'functions')]) {
  const violations = [];
  for (const root of roots) {
    for (const full of walk(join(repoRoot, root))) {
      const file = relative(repoRoot, full).split(sep).join('/');
      if (file === STICKER_WRITER || STICKER_EXEMPT.some((e) => e.file === file)) continue;
      violations.push(...scanSource(readFileSync(full, 'utf8'), file));
    }
  }
  return violations;
}
