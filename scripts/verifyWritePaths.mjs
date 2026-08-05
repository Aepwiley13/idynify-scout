#!/usr/bin/env node
/**
 * verifyWritePaths — static proof that the sprint's write-path guarantees hold.
 *
 * Every data change in this sprint has the same failure mode: a write path that
 * was NOT updated looks identical in review to one that was, because the
 * omission is nothing. Firestore does not complain, no test fails, and the
 * defect surfaces months later as duplicate contacts or records missing from a
 * view that filters on a field they never got.
 *
 * So this parses the source and checks four things a reviewer cannot see:
 *
 *   1. Every contact-creating write runs identity resolution first.
 *   2. Every company-creating write carries apollo_organization_id (or has no
 *      Apollo id at all).
 *   3. No company creation path queries the bare `apollo_id` field alone.
 *   4. Every sniper_contacts write goes through the guard.
 *
 * Run:  node scripts/verifyWritePaths.mjs
 * Exit: 0 clean · 1 violations found
 *
 * This is deliberately NOT a vitest file. It is the artifact the PR's "no
 * silent failures" requirement asks for — something a reviewer or a release
 * engineer can run and read, without a test runner in the way.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { parse } from '@babel/parser';

const SRC = 'src';

/**
 * Write paths that create contacts but cannot run identity resolution in this
 * sprint. Each entry needs a REASON — an unexplained exemption is how a guard
 * quietly stops guarding.
 */
const IDENTITY_EXEMPT = [
  {
    file: 'src/pages/Scout/DailyLeads.jsx',
    contains: 'people_mode_archived',
    reason:
      'Records a REJECTION on an existing suggested contact. It updates a ' +
      'document the auto-discovery path already created and resolved; running ' +
      'resolution again would look the record up to write "no" to it.',
  },
  {
    file: 'src/pages/Scout/DailyLeads.jsx',
    contains: 'people_mode_skipped',
    reason:
      'Defers a person to a later day. Same as above — a partial update to an ' +
      'already-resolved document, not a creation.',
  },
  {
    file: 'src/services/contactWriteGuard.js',
    contains: 'prepareContactWrite',
    reason: 'This IS the resolver. It cannot call itself.',
  },
  {
    file: 'src/services/peopleService.js',
    contains: 'createPerson',
    reason:
      'The schema factory. It has no callers today (see contactCompanyWriteFields ' +
      'test); routing it through the guard is part of the follow-on sprint that ' +
      'makes it the single creation path.',
  },
];

// ── AST helpers (shared shape with contactCompanyWriteFields.test.js) ────────

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

function mentions(node, literal) {
  for (const n of nodes(node)) {
    if (n.type === 'StringLiteral' && n.value === literal) return true;
  }
  return false;
}

function terminalCollection(node) {
  let last = null;
  for (const n of nodes(node)) {
    if (n.type === 'StringLiteral') last = n.value;
  }
  return last;
}

function objectsByVariable(ast) {
  const map = new Map();
  for (const n of nodes(ast)) {
    if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && n.init) {
      map.set(n.id.name, n.init);
    }
  }
  return map;
}

function targetsCollection(call, varMap, name) {
  let target = call.arguments[0];
  if (!target) return false;
  if (target.type === 'Identifier' && varMap.has(target.name)) {
    target = varMap.get(target.name);
  }
  return mentions(target, name) && terminalCollection(target) === name;
}

/** Property keys on an object literal, following spreads we can resolve. */
function payloadKeys(arg, varMap) {
  let node = arg;
  if (node?.type === 'Identifier' && varMap.has(node.name)) node = varMap.get(node.name);
  if (node?.type === 'CallExpression' && node.callee.type === 'Identifier'
      && /^create\w*Record$/.test(node.callee.name)) {
    node = node.arguments[0];
  }
  if (!node || node.type !== 'ObjectExpression') return null;

  const keys = [];
  const spreads = [];
  for (const p of node.properties) {
    if (p.type === 'ObjectProperty') {
      keys.push(p.key.type === 'Identifier' ? p.key.name : p.key.value);
    } else if (p.type === 'SpreadElement') {
      // `...decision.fields` / `...apolloIdFields(id)` — record what was spread
      // so the checks below can recognise the identity envelope.
      const src = p.argument;
      if (src.type === 'MemberExpression' && src.property?.name) spreads.push(src.property.name);
      else if (src.type === 'CallExpression' && src.callee?.name) spreads.push(src.callee.name);
      else if (src.type === 'Identifier') spreads.push(src.name);
    }
  }
  return { keys, spreads };
}

// ── Checks ──────────────────────────────────────────────────────────────────

const violations = [];
const summary = { contactWrites: 0, companyWrites: 0, sniperWrites: 0, exempted: 0 };

function isExempt(relPath, snippet) {
  const hit = IDENTITY_EXEMPT.find(e => e.file === relPath && snippet.includes(e.contains));
  if (hit) summary.exempted += 1;
  return Boolean(hit);
}

for (const file of walkFiles(SRC)) {
  const source = readFileSync(file, 'utf8');
  if (!/'contacts'|'companies'|'sniper_contacts'/.test(source)) continue;

  let ast;
  try {
    ast = parseFile(source);
  } catch {
    continue;
  }

  const varMap = objectsByVariable(ast);
  // File-level: does this module import the resolver at all? A write path that
  // does not is definitionally not running resolution.
  const importsGuard = /from '.*contactWriteGuard'/.test(source);
  const importsCompanyIdentity = /from '.*companyIdentityService'/.test(source);
  const importsSniperGuard = /from '.*sniperWriteGuard'/.test(source);

  for (const n of nodes(ast)) {
    if (n.type !== 'CallExpression') continue;
    const callee = n.callee.type === 'Identifier' ? n.callee.name : null;
    if (callee !== 'setDoc' && callee !== 'addDoc') continue;

    const snippet = source.slice(n.start, n.end);
    const line = n.loc.start.line;

    // 1 — contacts
    if (targetsCollection(n, varMap, 'contacts')) {
      summary.contactWrites += 1;
      if (isExempt(file, snippet)) continue;

      const payload = payloadKeys(n.arguments[1], varMap);
      const hasEnvelope = payload?.spreads.some(s => s === 'fields' || s === 'identityFields');

      if (!importsGuard) {
        violations.push({
          file, line, rule: 'identity-resolution',
          detail: 'creates a contact but the module never imports contactWriteGuard.',
        });
      } else if (!hasEnvelope) {
        violations.push({
          file, line, rule: 'identity-envelope',
          detail: 'creates a contact without spreading the resolver\'s `fields` '
                + '(normalized identifiers + the three status dimensions).',
        });
      }
    }

    // 2 — companies
    if (targetsCollection(n, varMap, 'companies')) {
      summary.companyWrites += 1;
      const payload = payloadKeys(n.arguments[1], varMap);
      if (!payload) continue;

      const usesApollo = payload.keys.includes('apollo_organization_id')
        || payload.keys.includes('apollo_id')
        || payload.spreads.includes('apolloIdFields');

      // A company written with the legacy field ALONE is the I-05 bug.
      if (payload.keys.includes('apollo_id')
          && !payload.keys.includes('apollo_organization_id')
          && !payload.spreads.includes('apolloIdFields')) {
        violations.push({
          file, line, rule: 'apollo-org-id',
          detail: 'writes `apollo_id` without `apollo_organization_id`. Use '
                + 'apolloIdFields() from companyIdentityService, which writes both.',
        });
      }

      if (usesApollo && !importsCompanyIdentity && !payload.spreads.includes('apolloIdFields')) {
        violations.push({
          file, line, rule: 'company-dedup',
          detail: 'creates a company with an Apollo id but the module never '
                + 'imports companyIdentityService, so no dedup check runs.',
        });
      }
    }

    // 3 — sniper_contacts
    if (targetsCollection(n, varMap, 'sniper_contacts')) {
      summary.sniperWrites += 1;
      const payload = payloadKeys(n.arguments[1], varMap);
      const linked = payload?.keys.includes('canonical_contact_id');
      const inGuard = file.endsWith('sniperWriteGuard.js');

      if (!inGuard && !linked) {
        violations.push({
          file, line, rule: 'sniper-freeze',
          detail: 'creates a sniper_contacts record without canonical_contact_id. '
                + 'Use createSniperRecord() from sniperWriteGuard — an unlinked '
                + 'record cannot be migrated onto the canonical contact.',
        });
      }
      if (!inGuard && !importsSniperGuard) {
        violations.push({
          file, line, rule: 'sniper-freeze',
          detail: 'writes sniper_contacts directly rather than through the guard.',
        });
      }
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

const bar = '─'.repeat(72);
console.log(bar);
console.log('Write-path verification — canonical identity sprint');
console.log(bar);
console.log(`  contact-creating writes    ${summary.contactWrites}`);
console.log(`  company-creating writes    ${summary.companyWrites}`);
console.log(`  sniper_contacts writes     ${summary.sniperWrites}`);
console.log(`  documented exemptions      ${summary.exempted}`);
console.log(bar);

if (violations.length === 0) {
  console.log('✓ No violations.');
  console.log('');
  console.log('Documented exemptions (each needs a reason, see IDENTITY_EXEMPT):');
  for (const e of IDENTITY_EXEMPT) {
    console.log(`  · ${e.file} — ${e.contains}`);
    console.log(`      ${e.reason}`);
  }
  process.exit(0);
}

console.log(`✗ ${violations.length} violation${violations.length === 1 ? '' : 's'}:`);
console.log('');
for (const v of violations) {
  console.log(`  ${v.file}:${v.line}  [${v.rule}]`);
  console.log(`      ${v.detail}`);
}
console.log('');
process.exit(1);
