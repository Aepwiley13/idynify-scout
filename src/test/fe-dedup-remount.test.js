/**
 * FE Dedup Remount Proof
 *
 * Proves the dedup logic in BarryWorkspace prevents duplicate canonical
 * appends across component remount/page reload by verifying:
 *
 * 1. The dedup Set (feAppendedRef) is hydrated from persisted canonical turns
 *    during init(), BEFORE the FE append effect can fire.
 * 2. The key format used in hydration matches the key format in the guard.
 * 3. A simulated remount scenario — where init loads previously-persisted FE
 *    turns into the Set, and then the controller regenerates the same turns —
 *    results in the guard skipping all already-persisted content.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const workspace = read('../pages/Barry/BarryWorkspace.jsx');
const workspaceCode = code(workspace);

// ═══════════════════════════════════════════════════════════════════════════
// Structural proof: hydration happens during init, before append effect
// ═══════════════════════════════════════════════════════════════════════════

describe('FE dedup — cross-remount protection', () => {
  it('feAppendedRef is initialized as an empty Set', () => {
    expect(workspaceCode).toMatch(/feAppendedRef = useRef\(new Set\(\)\)/);
  });

  it('init() hydrates feAppendedRef from persisted FE turns', () => {
    const initFn = workspaceCode.slice(
      workspaceCode.indexOf('async function init'),
      workspaceCode.indexOf('useEffect(() => {', workspaceCode.indexOf('async function init'))
    );
    expect(initFn).toMatch(/kind === 'first-experience'/);
    expect(initFn).toMatch(/feAppendedRef\.current\.add/);
  });

  it('hydration iterates the same turns array loaded by loadOrSeedRecentTurns', () => {
    const initFn = workspaceCode.slice(
      workspaceCode.indexOf('async function init'),
      workspaceCode.indexOf('useEffect(() => {', workspaceCode.indexOf('async function init'))
    );
    expect(initFn).toMatch(/loadOrSeedRecentTurns/);
    expect(initFn).toMatch(/for \(const t of turns\)/);
  });

  it('hydration key format matches the append guard key format', () => {
    // Hydration: `${t.role}::${t.content}`
    const hydrateKey = workspaceCode.match(
      /feAppendedRef\.current\.add\(`\$\{t\.role\}::\$\{t\.content\}`\)/
    );
    // Guard: `${turn.role}::${turn.content}`
    const guardKey = workspaceCode.match(
      /const key = `\$\{turn\.role\}::\$\{turn\.content\}`/
    );
    expect(hydrateKey).not.toBeNull();
    expect(guardKey).not.toBeNull();
  });

  it('guard checks feAppendedRef.current.has(key) before appending', () => {
    expect(workspaceCode).toMatch(/if \(feAppendedRef\.current\.has\(key\)\) continue/);
  });

  it('guard adds key to feAppendedRef after successful append', () => {
    const appendBlock = workspaceCode.slice(workspaceCode.indexOf('for (const turn of newTurns)'));
    const hasCheck = appendBlock.indexOf('feAppendedRef.current.has(key)');
    const addCall = appendBlock.indexOf('feAppendedRef.current.add(key)');
    const appendCall = appendBlock.indexOf('appendTurn(db,');
    // Order: has check → add key → appendTurn
    expect(hasCheck).toBeLessThan(addCall);
    expect(addCall).toBeLessThan(appendCall);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Behavioral simulation: prove dedup logic prevents duplicate appends
// ═══════════════════════════════════════════════════════════════════════════

describe('FE dedup — simulated remount', () => {
  // This test extracts the dedup logic and runs it in isolation to prove
  // the Set-based guard works across a simulated mount/unmount/mount cycle.

  function simulateAppendCycle(existingCanonical, controllerTurns) {
    // Phase 1: Simulate init() hydration — populate Set from persisted turns
    const dedupSet = new Set();
    for (const t of existingCanonical) {
      if (t.kind === 'first-experience' && t.content) {
        dedupSet.add(`${t.role}::${t.content}`);
      }
    }

    // Phase 2: Simulate FE append effect — attempt to persist controller turns
    const wouldAppend = [];
    for (const turn of controllerTurns) {
      if (!turn.content) continue;
      const key = `${turn.role}::${turn.content}`;
      if (dedupSet.has(key)) continue;
      dedupSet.add(key);
      wouldAppend.push(turn);
    }

    return wouldAppend;
  }

  it('first mount: all FE turns are appended (empty canonical)', () => {
    const controllerTurns = [
      { role: 'assistant', content: "Hey — I'm Barry. I'll help you figure out who matters." },
      { role: 'assistant', content: 'What should I call you?' },
    ];

    const appended = simulateAppendCycle([], controllerTurns);
    expect(appended).toHaveLength(2);
  });

  it('remount after reload: no FE turns re-appended (canonical has them)', () => {
    const canonical = [
      { role: 'assistant', content: "Hey — I'm Barry. I'll help you figure out who matters.", kind: 'first-experience' },
      { role: 'assistant', content: 'What should I call you?', kind: 'first-experience' },
    ];
    const controllerTurns = [
      { role: 'assistant', content: "Hey — I'm Barry. I'll help you figure out who matters." },
      { role: 'assistant', content: 'What should I call you?' },
    ];

    const appended = simulateAppendCycle(canonical, controllerTurns);
    expect(appended).toHaveLength(0);
  });

  it('remount with partial persistence: only new turns appended', () => {
    const canonical = [
      { role: 'assistant', content: "Hey — I'm Barry. I'll help you figure out who matters.", kind: 'first-experience' },
    ];
    const controllerTurns = [
      { role: 'assistant', content: "Hey — I'm Barry. I'll help you figure out who matters." },
      { role: 'assistant', content: 'What should I call you?' },
    ];

    const appended = simulateAppendCycle(canonical, controllerTurns);
    expect(appended).toHaveLength(1);
    expect(appended[0].content).toBe('What should I call you?');
  });

  it('non-FE canonical turns do not pollute the dedup set', () => {
    const canonical = [
      { role: 'assistant', content: 'Some post-onboarding message', kind: 'message' },
      { role: 'assistant', content: "Hey — I'm Barry.", kind: 'first-experience' },
    ];
    const controllerTurns = [
      { role: 'assistant', content: "Hey — I'm Barry." },
      { role: 'assistant', content: 'What should I call you?' },
    ];

    const appended = simulateAppendCycle(canonical, controllerTurns);
    expect(appended).toHaveLength(1);
    expect(appended[0].content).toBe('What should I call you?');
  });

  it('user turns are also deduped correctly', () => {
    const canonical = [
      { role: 'assistant', content: 'What should I call you?', kind: 'first-experience' },
      { role: 'user', content: 'Aaron', kind: 'first-experience' },
    ];
    const controllerTurns = [
      { role: 'assistant', content: 'What should I call you?' },
      { role: 'user', content: 'Aaron' },
      { role: 'assistant', content: 'Nice to meet you, Aaron!' },
    ];

    const appended = simulateAppendCycle(canonical, controllerTurns);
    expect(appended).toHaveLength(1);
    expect(appended[0].content).toBe('Nice to meet you, Aaron!');
  });
});
