/**
 * Guard against the bug class that made contacts unsearchable.
 *
 * Every Scout write path built its contact document by hand, and every one of
 * them independently omitted `is_archived`. Firestore does not error on a
 * missing field — `where('is_archived','==',false)` simply stops matching the
 * document. So contacts appeared in Today's Priorities, in the lenses, in the
 * pipeline, everywhere except the one query that filtered on the field. It
 * took a staging review to catch, and the fix was invisible in code review
 * because the omission looks exactly like nothing.
 *
 * Nothing else catches this. There is no schema enforcement at the Firestore
 * boundary, `createPersonRecord` sets the field but no write path calls it,
 * and a reviewer reading a 30-key object literal has no way to notice the one
 * key that isn't there.
 *
 * So: parse every source file, find the writes that create contact and company
 * documents, and assert the required field is present in the payload. A new
 * write path that forgets it fails here instead of six months later when
 * someone notices their contacts are missing from search.
 *
 * Required fields, and why:
 *   contacts  → is_archived  (eight read paths filter on it)
 *   companies → status       (SavedCompanies, Mission Control, Barry, admin
 *                             counts all query it; a missing value is invisible
 *                             to every one of them)
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { parse } from '@babel/parser';
import { createCompanyRecord, COMPANY_STATUS } from '../schemas/companySchema';

// Relative to the repo root — vitest runs from there, same as
// noUndefinedJsxTags.test.js.
const SRC = 'src';

/**
 * Writes that update an existing document rather than creating one, so the
 * required field is already on the record and re-asserting it would be wrong.
 * Listed explicitly — an unexplained entry here is a bug waiting to happen.
 */
const PARTIAL_UPDATE_ALLOWLIST = [
  // People-mode skip: defers a person to a later day. Writes status and
  // skipped_date only. Deliberately does NOT set is_archived — a skip is not
  // an archive, and AllLeads treating it as one is a separate question.
  { file: 'src/pages/Scout/DailyLeads.jsx', contains: 'people_mode_skipped' },
];

function walkFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'test' || entry === '__tests__') continue;
      walkFiles(full, out);
    } else if (/\.jsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function parseFile(source) {
  return parse(source, {
    sourceType: 'module',
    plugins: ['jsx', 'optionalChaining', 'nullishCoalescingOperator', 'classProperties'],
    errorRecovery: true,
  });
}

/** Every node in the tree, depth-first. */
function* nodes(node) {
  if (!node || typeof node !== 'object') return;
  yield node;
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) yield* nodes(c);
    } else if (child && typeof child.type === 'string') {
      yield* nodes(child);
    }
  }
}

/** Does this subtree mention the given string literal? */
function mentions(node, literal) {
  for (const n of nodes(node)) {
    if (n.type === 'StringLiteral' && n.value === literal) return true;
  }
  return false;
}

/**
 * The collection a doc()/collection() path points at — the LAST string literal
 * in it.
 *
 * Path segments alternate collection/document, so `users/{uid}/contacts/{id}`
 * ends in the collection we care about, while
 * `users/{uid}/contacts/{id}/timeline` ends in a subcollection and is a
 * timeline event, not a contact. Matching "does this path mention 'contacts'"
 * conflates the two — it flagged the timeline loggers on the first run.
 */
function terminalCollection(node) {
  let last = null;
  for (const n of nodes(node)) {
    if (n.type === 'StringLiteral') last = n.value;
  }
  return last;
}

/** Top-level object literals assigned to a variable, by name. */
function objectsByVariable(ast) {
  const map = new Map();
  for (const n of nodes(ast)) {
    if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && n.init) {
      map.set(n.id.name, n.init);
    }
  }
  return map;
}

/** Property keys on an object literal, including those from spreads we can see. */
function propertyNames(node) {
  if (!node || node.type !== 'ObjectExpression') return null;
  return node.properties
    .filter(p => p.type === 'ObjectProperty')
    .map(p => (p.key.type === 'Identifier' ? p.key.name : p.key.value));
}

/**
 * Resolve the document payload of a write call to an object literal, following
 * one level of variable indirection (`const contactData = {…}` → `setDoc(ref,
 * contactData)`), and unwrapping a schema factory call if there is one.
 */
function resolvePayload(arg, varMap) {
  let node = arg;
  if (node?.type === 'Identifier' && varMap.has(node.name)) {
    node = varMap.get(node.name);
  }
  // createCompanyRecord({...}) / createPersonRecord({...}) — the guarantee is
  // the factory's job, so unwrap to whatever it was handed.
  if (node?.type === 'CallExpression' && node.callee.type === 'Identifier' && /^create\w*Record$/.test(node.callee.name)) {
    return { node: node.arguments[0], viaFactory: node.callee.name };
  }
  return { node, viaFactory: null };
}

/** Is this write targeting the given subcollection? */
function targetsCollection(call, varMap, name) {
  let target = call.arguments[0];
  if (!target) return false;
  // setDoc(contactRef, …) where contactRef = doc(db, 'users', uid, 'contacts', id)
  if (target.type === 'Identifier' && varMap.has(target.name)) {
    target = varMap.get(target.name);
  }
  return mentions(target, name) && terminalCollection(target) === name;
}

function isPartialUpdate(call, relPath, source) {
  const snippet = source.slice(call.start, call.end);
  return PARTIAL_UPDATE_ALLOWLIST.some(
    entry => entry.file === relPath && snippet.includes(entry.contains)
  );
}

function collectWrites(collectionName) {
  const found = [];
  for (const file of walkFiles(SRC)) {
    const relPath = file;
    const source = readFileSync(file, 'utf8');
    if (!source.includes(`'${collectionName}'`)) continue;

    let ast;
    try {
      ast = parseFile(source);
    } catch {
      continue; // Orphaned unparseable files are covered by noUndefinedJsxTags.
    }
    const varMap = objectsByVariable(ast);

    for (const n of nodes(ast)) {
      if (n.type !== 'CallExpression') continue;
      const callee = n.callee.type === 'Identifier' ? n.callee.name : null;
      if (callee !== 'setDoc' && callee !== 'addDoc') continue;
      if (!targetsCollection(n, varMap, collectionName)) continue;
      if (isPartialUpdate(n, relPath, source)) continue;

      const { node: payload, viaFactory } = resolvePayload(n.arguments[1], varMap);
      const keys = propertyNames(payload);
      if (keys === null) continue; // Not a literal we can inspect.

      found.push({ file: relPath, line: n.loc.start.line, keys, viaFactory });
    }
  }
  return found;
}

describe('contact documents always carry is_archived', () => {
  const writes = collectWrites('contacts');

  it('finds the contact write sites at all', () => {
    // If this drops to zero the guard has silently stopped guarding —
    // a refactor renamed something and every assertion below became vacuous.
    expect(writes.length).toBeGreaterThanOrEqual(9);
  });

  it('every contact-creating write sets is_archived explicitly', () => {
    const missing = writes
      .filter(w => !w.keys.includes('is_archived'))
      .map(w => `${w.file}:${w.line}`);

    expect(missing, [
      'These writes create contact documents without is_archived.',
      'Firestore will not match them in where("is_archived","==",false) —',
      'they will be invisible to search and to every people lens.',
      'Add is_archived: false to the document (explicitly, not via a spread',
      'from an API payload), or add a documented PARTIAL_UPDATE_ALLOWLIST',
      'entry if the write updates an existing record.',
    ].join('\n')).toEqual([]);
  });
});

describe('company documents always carry status', () => {
  const writes = collectWrites('companies');

  it('finds the company write sites at all', () => {
    expect(writes.length).toBeGreaterThanOrEqual(5);
  });

  it('every company-creating write sets status, or routes through the factory', () => {
    const missing = writes
      .filter(w => !w.viaFactory && !w.keys.includes('status'))
      .map(w => `${w.file}:${w.line}`);

    expect(missing, [
      'These writes create company documents without status.',
      'SavedCompanies, Mission Control, Barry and the admin counts all query',
      'status — a document without one is invisible to all of them.',
      'Route the write through createCompanyRecord (src/schemas/companySchema.js).',
    ].join('\n')).toEqual([]);
  });
});

describe('createCompanyRecord', () => {
  it('preserves every field the caller passes', () => {
    // The factory guarantees a field; it does not own the document shape. The
    // six write sites disagree about almost everything else (apollo_id vs
    // apollo_organization_id, saved_at vs found_at, ISO strings vs Dates) and
    // normalising that would be a data-model change, not a guarantee.
    const input = {
      name: 'Acme Corp',
      apollo_id: 'org_1',
      website_url: 'https://acme.com',
      contact_count: 0,
      apolloEnriched: false,
    };
    expect(createCompanyRecord(input)).toEqual({ ...input, status: 'accepted' });
  });

  it('defaults status to accepted when the caller does not set one', () => {
    expect(createCompanyRecord({ name: 'Acme' }).status).toBe(COMPANY_STATUS.ACCEPTED);
  });

  it('keeps a caller-supplied status from the vocabulary', () => {
    // Discovery writes 'pending'; the user accepts or rejects later.
    expect(createCompanyRecord({ name: 'Acme', status: 'pending' }).status).toBe('pending');
    expect(createCompanyRecord({ name: 'Acme', status: 'archived' }).status).toBe('archived');
  });

  it("rejects 'active' — the value that would have shipped from the brief", () => {
    // No read path queries 'active'. A company written with it would vanish
    // from Saved Companies exactly as contacts vanished from search.
    expect(() => createCompanyRecord({ name: 'Acme', status: 'active' }))
      .toThrow(/unknown status "active"/);
  });

  it('rejects a company with no name', () => {
    expect(() => createCompanyRecord({ industry: 'Technology' })).toThrow(/name is required/);
  });
});
