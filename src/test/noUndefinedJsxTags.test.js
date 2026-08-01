/**
 * Guard against the bug class that produced "Illegal constructor" on Basecamp
 * CSM.
 *
 * `BasecampMain.jsx` rendered `<Lock size={28} …/>` without importing `Lock`.
 * That is not a ReferenceError, because `Lock` is a real browser global — the
 * Web Locks API interface object. JSX resolved the tag to `window.Lock`, React
 * called it as a plain function, and a Web IDL constructor invoked without
 * `new` throws `TypeError: Illegal constructor`. The module went black; the
 * message named nothing; it cost days.
 *
 * Nothing in the toolchain catches this. ESLint's `no-undef` is satisfied
 * (browser globals are declared), and the JSX transform does not care what an
 * identifier resolves to. `eslint-plugin-react`'s `jsx-no-undef` would catch
 * it, but the plugin is not installed and adding it is a bigger change than
 * this needs.
 *
 * So: parse every source file and assert that every capitalised JSX tag is
 * actually bound in its module scope. A component that is imported or declared
 * passes. A component that silently falls through to a DOM global fails here
 * instead of at a customer's screen.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default || _traverse;

/**
 * Orphaned files that pre-date this test and contain genuine syntax errors.
 * Nothing imports them, so they are never bundled and never reach a browser.
 * They are listed rather than skipped silently — if one is ever wired up, the
 * parse failure below becomes a real failure.
 */
const UNPARSEABLE_ORPHANS = [
  'src/components/ICPValidationPage.jsx',
  'src/components/Phase5CampaignBuilder2.jsx',
];

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.jsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Capitalised JSX tags with no binding in scope, as `path:line <Tag>`. */
function unboundTags(file) {
  const code = readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parse(code, { sourceType: 'module', plugins: ['jsx'] });
  } catch {
    return UNPARSEABLE_ORPHANS.includes(file) ? [] : [`${file}  (failed to parse)`];
  }

  const found = [];
  traverse(ast, {
    JSXOpeningElement(path) {
      // `<Foo.Bar/>` only needs `Foo` to be bound.
      let name = path.node.name;
      while (name.type === 'JSXMemberExpression') name = name.object;
      if (name.type !== 'JSXIdentifier') return;

      // Lowercase tags are host elements — `div`, `span`, `svg` — not bindings.
      if (!/^[A-Z]/.test(name.name)) return;

      if (!path.scope.hasBinding(name.name)) {
        found.push(`${file}:${path.node.loc.start.line}  <${name.name}>`);
      }
    },
  });
  return found;
}

describe('every capitalised JSX tag resolves to something we imported', () => {
  it('finds no tag falling through to a global', () => {
    const offenders = sourceFiles('src').flatMap(unboundTags);

    // Named in the failure message, not just counted: the whole point is that
    // the next person gets the file and the line instead of a stack trace
    // inside React.
    expect(offenders, `Unbound JSX tags:\n${offenders.join('\n')}`).toEqual([]);
  // This walks and Babel-parses every source file under src/, so its runtime
  // grows with the repo. It sat just under vitest's 5s default and tipped over
  // once Sprint 1 added test files; the explicit budget stops that recurring.
  }, 30_000);
});
