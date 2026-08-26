/**
 * GATE 3 — C1 (operationId continuity) and C2 (structural production isolation).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { mintOperationId, OUTCOME, summarise, previewSentence } from '../utils/resolutionContract.js';
import { mockResolveSaveDryRun } from '../utils/mockResolveSave.js';
import { buildCandidatePayloads, mintClientRef } from '../utils/candidatePayload.js';
import { MOCK_PEOPLE, MOCK_SOURCE } from '../utils/mockPersonResults.js';

const WORKSPACE = readFileSync('src/pages/Barry/BarryWorkspace.jsx', 'utf8');
const PREVIEW = readFileSync('src/components/barry/BarryResolutionPreview.jsx', 'utf8');
const CONTRACT = readFileSync('src/utils/resolutionContract.js', 'utf8');

const rows = () => MOCK_PEOPLE.map((p, i) => ({ ...p, clientRef: mintClientRef(i) }));

describe('C1 — one operationId spans preview → approval', () => {
  it('the dry-run echoes back the operationId it was given', async () => {
    const op = mintOperationId();
    const payloads = buildCandidatePayloads(rows(), rows().map(r => r.clientRef), { kind: 'person', source: MOCK_SOURCE });
    const res = await mockResolveSaveDryRun(payloads, { latencyMs: 0, operationId: op });
    expect(res.operationId).toBe(op);
  });

  it('mints one when none is supplied, and it is stable within the response', async () => {
    const payloads = buildCandidatePayloads(rows(), [rows()[0].clientRef], { kind: 'person', source: MOCK_SOURCE });
    const res = await mockResolveSaveDryRun(payloads, { latencyMs: 0 });
    expect(res.operationId).toBeTruthy();
  });

  it('ids are unique per operation', () => {
    expect(new Set(Array.from({ length: 50 }, mintOperationId)).size).toBe(50);
  });

  // The regression that matters: a second mint at approval would make the
  // commit a different operation from the preview the user approved.
  it('BarryWorkspace mints an operationId exactly once', () => {
    const mints = WORKSPACE.match(/mintOperationId\(\)/g) || [];
    expect(mints).toHaveLength(1);
  });

  it('handleApprove reads the stored operationId instead of minting', () => {
    const fn = WORKSPACE.slice(WORKSPACE.indexOf('async function handleApprove'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    expect(body).toMatch(/getResultSet\(sessionRef\)\?\.operationId/);
    expect(body).not.toMatch(/mintOperationId/);
  });

  it('operationId is never written into turn meta — it identifies a write, not a conversation', () => {
    expect(WORKSPACE).not.toMatch(/meta:\s*\{[^}]*operationId/);
  });
});

describe('C2 — the mock cannot reach production by construction', () => {
  it('BarryWorkspace has NO static import of the mock resolver or fake people', () => {
    const statics = WORKSPACE.split('\n').filter(l => /^import .*from/.test(l));
    expect(statics.join('\n')).not.toMatch(/mockResolveSave|mockPersonResults/);
  });

  it('every mock import is dynamic AND inside a DEV guard', () => {
    for (const mod of ['mockResolveSave', 'mockPersonResults']) {
      const idx = WORKSPACE.indexOf(`import('../../utils/${mod}')`);
      expect(idx, `${mod} must be dynamically imported`).toBeGreaterThan(-1);
      // the nearest preceding DEV guard must be within the same function body
      const before = WORKSPACE.slice(Math.max(0, idx - 400), idx);
      expect(before, `${mod} import must sit behind import.meta.env.DEV`).toMatch(/import\.meta\.env\.DEV/);
    }
  });

  it('production fails CLOSED — no resolver, no fabricated verdicts', () => {
    const fn = WORKSPACE.slice(WORKSPACE.indexOf('async function runResolutionDryRun'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    expect(body).toMatch(/if \(!import\.meta\.env\.DEV\)/);
    expect(body).toMatch(/return null/);
  });

  it('the real preview component does NOT import the mock', () => {
    expect(PREVIEW).not.toMatch(/mockResolveSave/);
    expect(PREVIEW).toMatch(/resolutionContract/);
  });

  it('the contract module imports no mock (comments may mention one)', () => {
    const imports = CONTRACT.split('\n').filter(l => /^import .*from/.test(l));
    expect(imports.join('\n')).not.toMatch(/mock/i);
  });

  it('every mocked-flow turn is local-only, so fabricated statements never reach Firestore', () => {
    // seed, preview, approval and cancel must all carry persist:false
    const persistFalse = (WORKSPACE.match(/persist:\s*false/g) || []).length;
    expect(persistFalse).toBeGreaterThanOrEqual(4);
  });

  it('appendStructuredTurn skips the Firestore write when persist is false', () => {
    const fn = WORKSPACE.slice(WORKSPACE.indexOf('async function appendStructuredTurn'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    expect(body).toMatch(/if \(!persist\) return;/);
    // and the skip must come BEFORE the write
    expect(body.indexOf('if (!persist) return;')).toBeLessThan(body.indexOf('appendTurn(db'));
  });

  it('seedMockResultSet is unreachable in production', () => {
    const fn = WORKSPACE.slice(WORKSPACE.indexOf('async function seedMockResultSet'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    expect(body).toMatch(/if \(!import\.meta\.env\.DEV\) return;/);
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
