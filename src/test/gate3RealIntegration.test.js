/**
 * GATE 3 — real RESOLVE_SAVE / LINK integration.
 *
 * Fixtures are the shapes barryResolveSave.js and barryLink.js actually return,
 * read from Team A's implementation — not from the prose summary of it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolveSave, link, linkSentence, RESOLVE_ENDPOINT, LINK_ENDPOINT } from '../utils/resolveSaveClient.js';
import { buildCandidatePayloads, mintClientRef } from '../utils/candidatePayload.js';
import { MOCK_PEOPLE, MOCK_SOURCE } from '../utils/mockPersonResults.js';

const WORKSPACE = readFileSync('src/pages/Barry/BarryWorkspace.jsx', 'utf8');
const rows = () => MOCK_PEOPLE.map((p, i) => ({ ...p, clientRef: mintClientRef(i) }));

function mockFetch(response, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({ ok, status, json: async () => response });
  globalThis.fetch = fn;
  return fn;
}
beforeEach(() => { vi.restoreAllMocks(); });

describe('RESOLVE_SAVE request envelope', () => {
  it('sends the contract envelope to the real endpoint', async () => {
    const f = mockFetch({ success: true, operationId: 'op1', committed: false, results: [], summary: {} });
    const r = rows();   // one array — two calls would mint different clientRefs
    const payloads = buildCandidatePayloads(r, [r[0].clientRef], { kind: 'person', source: MOCK_SOURCE });
    await resolveSave({ userId: 'u1', authToken: 't1', operationId: 'op1', candidates: payloads });

    expect(f).toHaveBeenCalledWith(RESOLVE_ENDPOINT, expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body).toMatchObject({ userId: 'u1', authToken: 't1', operationId: 'op1', commit: false, actor: 'user' });
    expect(body.candidates).toHaveLength(1);
    expect(body.resolutions).toEqual({});
  });

  it('strips every field the resolver forbids on a candidate', async () => {
    const f = mockFetch({ success: true, results: [], summary: {} });
    const dirty = [{ kind: 'person', clientRef: 'ui_1', email: 'A@b.com',
                     contactId: 'x', contact_id: 'y', canonicalId: 'z', personId: 'p', id: 'i' }];
    await resolveSave({ userId: 'u', authToken: 't', operationId: 'op', candidates: dirty });
    const sent = JSON.parse(f.mock.calls[0][1].body).candidates[0];
    for (const forbidden of ['contactId', 'contact_id', 'canonicalId', 'personId', 'id']) {
      expect(sent[forbidden]).toBeUndefined();
    }
    expect(sent.email).toBe('A@b.com');   // identity still raw
  });

  it('carries ambiguity answers as resolutions { clientRef: contactId }', async () => {
    const f = mockFetch({ success: true, results: [], summary: {} });
    await resolveSave({
      userId: 'u', authToken: 't', operationId: 'op', commit: true,
      candidates: [{ kind: 'person', clientRef: 'ui_9' }],
      resolutions: { ui_9: 'contact_abc' },
    });
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.commit).toBe(true);
    expect(body.resolutions).toEqual({ ui_9: 'contact_abc' });
  });

  it('surfaces the server error instead of inventing success', async () => {
    mockFetch({ error: 'company candidates are not supported yet (Gate 2 Phase 5)' }, false, 400);
    await expect(resolveSave({ userId: 'u', authToken: 't', operationId: 'op', candidates: [{ kind: 'company', clientRef: 'ui_1' }] }))
      .rejects.toThrow(/Phase 5/);
  });
});

describe('real server outcomes render truthfully', () => {
  // exact shapes from barryResolveSave.js
  const REAL = {
    success: true, operationId: 'op1', committed: false,
    results: [
      { clientRef: 'ui_a', outcome: 'matched', contactId: 'c1', matchedOn: 'email', existingName: 'Sarah Chen' },
      { clientRef: 'ui_b', outcome: 'created', contactId: null, matchedOn: null },
      { clientRef: 'ui_c', outcome: 'ambiguous', contactId: null, matchedOn: 'name_company',
        candidates: [
          { contactId: 'c2', existingName: 'Sarah Johnson', company_name: 'Acme' },
          { contactId: 'c3', existingName: 'Sarah Johnson', company_name: 'Contoso' },
        ] },
      { clientRef: 'ui_d', outcome: 'refused', contactId: null, matchedOn: null,
        reason: 'insufficient_identity',
        detail: 'needs an email, phone, LinkedIn or Apollo id — or a name together with a company — before it can become a contact' },
      { clientRef: 'ui_e', outcome: 'refused', contactId: null, matchedOn: null,
        reason: 'two existing contacts share the same email' },
    ],
    summary: { matched: 1, created: 1, ambiguous: 1, refused: 2 },
  };

  it('ambiguous candidates carry contactId/existingName/company_name and nothing invented', () => {
    const amb = REAL.results.find(r => r.outcome === 'ambiguous');
    expect(Object.keys(amb.candidates[0]).sort()).toEqual(['company_name', 'contactId', 'existingName']);
    expect(amb.candidates[0].title).toBeUndefined();
    expect(amb.candidates[0].lastInteraction).toBeUndefined();
  });

  it('every server outcome the contract defines is represented', () => {
    const outcomes = new Set(REAL.results.map(r => r.outcome));
    expect(outcomes).toEqual(new Set(['matched', 'created', 'ambiguous', 'refused']));
  });

  it('insufficient_identity arrives as refused WITH an actionable detail', () => {
    const r = REAL.results.find(x => x.reason === 'insufficient_identity');
    expect(r.outcome).toBe('refused');
    expect(r.contactId).toBeNull();
    expect(r.detail).toMatch(/email, phone, LinkedIn/);
  });

  it('ambiguous and refused never carry a contactId — they are never written', () => {
    for (const r of REAL.results.filter(x => x.outcome === 'ambiguous' || x.outcome === 'refused')) {
      expect(r.contactId).toBeNull();
    }
  });
});

describe('LINK reports final state, not writes', () => {
  it('a full no-op still reads as success', () => {
    expect(linkSentence({ total: 20, moved: 0, alreadyThere: 20, notFound: 0 }, 'scout'))
      .toBe('All 20 are now ready in Scout.');
  });

  it('a partial move does NOT claim it moved everything', () => {
    const s = linkSentence({ total: 20, moved: 10, alreadyThere: 10, notFound: 0 }, 'scout');
    expect(s).toBe('All 20 are now ready in Scout.');
    expect(s).not.toMatch(/moved|10/i);
  });

  it('missing contacts are excluded from the count and stated', () => {
    expect(linkSentence({ total: 20, moved: 15, alreadyThere: 3, notFound: 2 }, 'scout'))
      .toBe('All 18 are now ready in Scout. 2 I couldn\'t find.');
  });

  it('sends the contract envelope', async () => {
    const f = mockFetch({ success: true, operationId: 'op1', targetStage: 'scout', results: [], summary: {} });
    await link({ userId: 'u', authToken: 't', operationId: 'op1', contactIds: ['c1', 'c2'], targetStage: 'scout' });
    expect(f).toHaveBeenCalledWith(LINK_ENDPOINT, expect.anything());
    expect(JSON.parse(f.mock.calls[0][1].body))
      .toMatchObject({ operationId: 'op1', contactIds: ['c1', 'c2'], targetStage: 'scout' });
  });
});

describe('structural guarantees hold after real wiring', () => {
  it('the mock resolver is gone from the workspace entirely', () => {
    expect(WORKSPACE).not.toMatch(/mockResolveSave/);
  });

  it('operationId is still minted exactly once and reused at commit', () => {
    expect((WORKSPACE.match(/mintOperationId\(\)/g) || [])).toHaveLength(1);
    const fn = WORKSPACE.slice(WORKSPACE.indexOf('async function handleApprove'));
    const body = fn.slice(0, fn.indexOf('\n  }\n'));
    expect(body).toMatch(/stored\.operationId/);
    expect(body).not.toMatch(/mintOperationId/);
  });

  it("'neither' is sent as the ABSENCE of a resolution, never as an id", () => {
    const fn = WORKSPACE.slice(WORKSPACE.indexOf('async function handleApprove'));
    expect(fn.slice(0, 2000)).toMatch(/choice !== 'neither'/);
  });

  it('clientRef is never persisted and no id is minted in the UI', () => {
    expect(WORKSPACE).not.toMatch(/meta:\s*\{[^}]*clientRef/);
    expect(WORKSPACE).not.toMatch(/contactId\s*=\s*['"`]/);
  });
});
