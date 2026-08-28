/**
 * Gate 3 P0 Regression — Conversation History + Name Normalization
 *
 * P0-1   Conversation history restored from canonical FE turns on reload.
 * P0-2   normalizeName strips conversational prefixes.
 * P0-3   Controller uses normalized name for persistence and display.
 * P0-4   Header identity resolves from normalized stored name.
 * P0-5   Raw user message preserved in conversation turns.
 * P0-6   Conversation continuity — controller does not overwrite existing turns.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const controller = read('../hooks/useFirstExperienceController.js');
const resolveWhoSrc = read('../utils/resolveWho.js');
const workspace = read('../pages/Barry/BarryWorkspace.jsx');

const controllerCode = code(controller);
const resolveWhoCode = code(resolveWhoSrc);
const workspaceCode = code(workspace);

// ═══════════════════════════════════════════════════════════════════════════
// P0-1 — Conversation history restored from canonical on reload
// ═══════════════════════════════════════════════════════════════════════════

describe('P0-1 — FE turns restored from canonical on reload', () => {
  it('controller imports loadRecentTurns from barryCanonical', () => {
    expect(controller).toMatch(/import.*loadRecentTurns.*from.*barryCanonical/);
  });

  it('controller loads recent turns during init', () => {
    expect(controllerCode).toMatch(/loadRecentTurns\(db,\s*user\.uid/);
  });

  it('controller filters for first-experience kind', () => {
    expect(controllerCode).toMatch(/kind === 'first-experience'/);
  });

  it('controller restores persisted FE turns when they exist', () => {
    expect(controllerCode).toMatch(/persistedFe\.length > 0/);
    expect(controllerCode).toMatch(/setTurns\(persistedFe\.map/);
  });

  it('only restores when name is already resolved (not during fresh WHO)', () => {
    const initBlock = controllerCode.slice(controllerCode.indexOf('!wantsName'));
    expect(initBlock).toMatch(/loadRecentTurns/);
  });

  it('sets phase to intent after restoration', () => {
    const restorationBlock = controllerCode.slice(
      controllerCode.indexOf('persistedFe.length > 0')
    );
    expect(restorationBlock).toMatch(/setPhase\('intent'\)/);
  });

  it('controller still does not write turns (read-only canonical access)', () => {
    expect(controllerCode).not.toMatch(/appendTurn\(/);
    expect(controllerCode).not.toMatch(/addDoc\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// P0-2 — normalizeName strips conversational prefixes
// ═══════════════════════════════════════════════════════════════════════════

describe('P0-2 — normalizeName function', () => {
  it('is exported from resolveWho', () => {
    expect(resolveWhoSrc).toMatch(/export function normalizeName/);
  });

  it('defines NAME_INTROS patterns array', () => {
    expect(resolveWhoCode).toMatch(/NAME_INTROS/);
  });

  it('strips I\'m prefix', () => {
    expect(resolveWhoSrc).toMatch(/i'm\\s\+/i);
  });

  it('strips Im prefix (no apostrophe)', () => {
    expect(resolveWhoSrc).toMatch(/\^im\\s\+/i);
  });

  it('strips My name is prefix', () => {
    expect(resolveWhoSrc).toMatch(/my name is\\s\+/i);
  });

  it('strips Call me prefix', () => {
    expect(resolveWhoSrc).toMatch(/call me\\s\+/i);
  });

  it('strips You can call me prefix', () => {
    expect(resolveWhoSrc).toMatch(/you can call me\\s\+/i);
  });

  it('strips I go by prefix', () => {
    expect(resolveWhoSrc).toMatch(/i go by\\s\+/i);
  });

  it('strips leading greetings before name intro', () => {
    expect(resolveWhoCode).toMatch(/hi\|hey\|hello\|yo/i);
  });

  it('strips trailing punctuation', () => {
    expect(resolveWhoCode).toMatch(/\[\.!,\]\+\$/);
  });

  it('returns null for non-string input', () => {
    expect(resolveWhoCode).toMatch(/typeof raw !== 'string'/);
  });

  it('returns null when only prefix with no name', () => {
    expect(resolveWhoCode).toMatch(/return name \|\| null/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// P0-3 — Controller uses normalized name
// ═══════════════════════════════════════════════════════════════════════════

describe('P0-3 — Controller uses normalized name', () => {
  it('controller imports normalizeName from resolveWho', () => {
    expect(controller).toMatch(/import.*normalizeName.*from.*resolveWho/);
  });

  it('controller calls normalizeName on raw input', () => {
    expect(controllerCode).toMatch(/normalizeName\(trimmed\)/);
  });

  it('controller derives preferred name with fallback', () => {
    expect(controllerCode).toMatch(/const preferred = normalizeName\(trimmed\) \|\| trimmed/);
  });

  it('controller persists normalized name via rememberName', () => {
    expect(controllerCode).toMatch(/rememberName\(user\.uid,\s*preferred\)/);
  });

  it('controller sets who state with normalized name', () => {
    expect(controllerCode).toMatch(/name:\s*preferred,\s*source:\s*'stored'/);
  });

  it('controller uses normalized name in greeting', () => {
    expect(controllerCode).toMatch(/Right on, \$\{preferred\}/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// P0-4 — Header identity resolves from normalized stored name
// ═══════════════════════════════════════════════════════════════════════════

describe('P0-4 — Header identity uses normalized name', () => {
  it('resolveWho reads firstName from Firestore', () => {
    expect(resolveWhoCode).toMatch(/userData\?\.firstName/);
  });

  it('rememberName writes to firstName field', () => {
    expect(resolveWhoCode).toMatch(/firstName:\s*name/);
  });

  it('workspace resolves who from stored user data', () => {
    expect(workspaceCode).toMatch(/resolveWho\(user,\s*userData\)/);
  });

  it('workspace greeting uses resolved name', () => {
    expect(workspaceCode).toMatch(/who\?\.name/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// P0-5 — Raw user message preserved in conversation
// ═══════════════════════════════════════════════════════════════════════════

describe('P0-5 — Raw message stays in conversation', () => {
  it('user turn content uses raw trimmed text, not normalized', () => {
    const whoBlock = controllerCode.slice(
      controllerCode.indexOf("phase === 'who'"),
      controllerCode.indexOf("phase === 'intent'")
    );
    expect(whoBlock).toMatch(/role: 'user', content: trimmed/);
  });

  it('canonical persistence writes raw content from turns', () => {
    expect(workspaceCode).toMatch(/content:\s*turn\.content/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// P0-6 — Conversation continuity
// ═══════════════════════════════════════════════════════════════════════════

describe('P0-6 — Conversation continuity invariants', () => {
  it('workspace persists FE turns with kind first-experience', () => {
    expect(workspaceCode).toMatch(/kind:\s*'first-experience'/);
  });

  it('workspace hydrates dedup set from persisted FE turns', () => {
    expect(workspaceCode).toMatch(/kind === 'first-experience'/);
    expect(workspaceCode).toMatch(/feAppendedRef\.current\.add/);
  });

  it('controller canonical restoration skips when wantsName is true', () => {
    expect(controllerCode).toMatch(/if \(!wantsName\)/);
  });

  it('controller returns early after restoring persisted turns', () => {
    const restorationBlock = controllerCode.slice(
      controllerCode.indexOf('persistedFe.length > 0')
    );
    const returnPos = restorationBlock.indexOf('return;');
    expect(returnPos).toBeGreaterThan(-1);
    expect(returnPos).toBeLessThan(200);
  });
});
