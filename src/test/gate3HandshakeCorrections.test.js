/**
 * GATE 3 — C1 (operationId continuity) and C2 (structural production isolation).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { mintOperationId, OUTCOME, summarise, previewSentence } from '../utils/resolutionContract.js';
import { buildCandidatePayloads, mintClientRef } from '../utils/candidatePayload.js';
import { MOCK_PEOPLE, MOCK_SOURCE } from '../utils/mockPersonResults.js';

const WORKSPACE = readFileSync('src/pages/Barry/BarryWorkspace.jsx', 'utf8');
const PREVIEW = readFileSync('src/components/barry/BarryResolutionPreview.jsx', 'utf8');
const CONTRACT = readFileSync('src/utils/resolutionContract.js', 'utf8');

const rows = () => MOCK_PEOPLE.map((p, i) => ({ ...p, clientRef: mintClientRef(i) }));

describe('C1 — one operationId spans preview → approval', () => {
  it('ids are unique per operation', () => {
    expect(new Set(Array.from({ length: 50 }, mintOperationId)).size).toBe(50);
  });

  // The regression that matters: a second mint at approval would make the
  // commit a different operation from the preview the user approved.
  it('BarryWorkspace mints an operationId exactly once', () => {
    const mints = WORKSPACE.match(/mintOperationId\(\)/g) || [];
    expect(mints).toHaveLength(1);
  });

  it('handleApprove reuses the stored operationId instead of minting', () => {
    const fn = WORKSPACE.slice(WORKSPACE.indexOf('async function handleApprove'));
    const body = fn.slice(0, fn.indexOf('\n  async function'));
    expect(body).toMatch(/stored\.operationId/);
    expect(body).not.toMatch(/mintOperationId/);
  });

  it('operationId is never written into turn meta — it identifies a write, not a conversation', () => {
    expect(WORKSPACE).not.toMatch(/meta:\s*\{[^}]*operationId/);
  });
});

describe('C2 — no fake resolver exists anywhere any more', () => {
  it('the mock resolver module has been DELETED, not merely gated', () => {
    // Checked on disk, not via import(): Vite resolves dynamic imports at
    // transform time, so importing a deleted module fails the whole file.
    expect(existsSync('src/utils/mockResolveSave.js')).toBe(false);
  });

  it('no app code references a mock resolver', () => {
    expect(WORKSPACE).not.toMatch(/mockResolveSave/);
    expect(PREVIEW).not.toMatch(/mockResolveSave/);
  });

  it('the only remaining mock is the dev result-set seed, dynamically imported behind DEV', () => {
    const statics = WORKSPACE.split('\n').filter(l => /^import .*from/.test(l));
    expect(statics.join('\n')).not.toMatch(/mockPersonResults/);
    const idx = WORKSPACE.indexOf("import('../../utils/mockPersonResults')");
    expect(idx).toBeGreaterThan(-1);
    expect(WORKSPACE.slice(Math.max(0, idx - 400), idx)).toMatch(/import\.meta\.env\.DEV/);
  });

  it('fabricated seed people still never reach the canonical conversation', () => {
    const fn = WORKSPACE.slice(WORKSPACE.indexOf('async function seedMockResultSet'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    expect(body).toMatch(/if \(!import\.meta\.env\.DEV\) return;/);
    expect(body).toMatch(/persist: false/);
  });

  it('REAL resolution turns DO persist — they record something that happened', () => {
    const fn = WORKSPACE.slice(WORKSPACE.indexOf('async function handleSelectionConfirmed'));
    const body = fn.slice(0, fn.indexOf('\n  /**'));
    expect(body).toMatch(/kind: 'resolution_preview'/);
    expect(body).not.toMatch(/persist: false/);
  });

  it('appendStructuredTurn still skips the write before it happens when persist is false', () => {
    const fn = WORKSPACE.slice(WORKSPACE.indexOf('async function appendStructuredTurn'));
    const body = fn.slice(0, fn.indexOf('\n  /**'));
    expect(body.indexOf('if (!persist) return;')).toBeLessThan(body.indexOf('appendTurn(db'));
  });
});

describe('contract vocabulary survives the split', () => {
  it('outcomes are unchanged', () => {
    expect(Object.values(OUTCOME).sort()).toEqual(['ambiguous', 'created', 'matched', 'refused']);
  });
  it('summary keys are unchanged', () => {
    const s = summarise([{ outcome: 'matched' }, { outcome: 'created' }]);
    expect(s).toEqual({ total: 2, matched: 1, created: 1, ambiguous: 0, refused: 0 });
  });
  it('previewSentence still reports only what is true', () => {
    expect(previewSentence(summarise([{ outcome: 'matched' }]))).not.toMatch(/need your help/);
  });
});
