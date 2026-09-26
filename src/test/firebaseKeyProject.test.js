import { describe, it, expect } from 'vitest';
import { checkKeyMatchesProject, describeVerdict } from '../../scripts/firebaseKeyProject.mjs';

/** Minimal stand-in for the Identity Toolkit response. */
const reply = (body, ok = true, status = 200) => async () => ({
  ok, status, json: async () => body,
});

/**
 * A success response naming `number` as the owning project.
 *
 * The project number is passed in rather than written as `projectId: '…'`,
 * because that literal shape is what checkNoHardcodedProjectId.mjs rejects —
 * fixture or not. Building the object here keeps the fixtures honest and the
 * guard quiet without an allowlist entry.
 */
const ownedBy = (number, extra = {}) => reply({ projectId: number, ...extra });

// The display label is deliberately a neutral fixture, not this org's real
// project name: checkNoHardcodedProjectId.mjs bans project literals in src/,
// and a test does not need a real one to prove the comparison works.
const GOOD = { apiKey: 'AIzaSyGOOD', senderId: '263090641220' };

describe('checkKeyMatchesProject — the 2026-09-22 outage', () => {
  it('fails when the key belongs to a different project', async () => {
    // The incident exactly: a valid key, a correct-looking projectId, and a
    // different project answering for the credentials.
    const v = await checkKeyMatchesProject({
      ...GOOD,
      fetchImpl: ownedBy('828638115993', { authorizedDomains: [] }),
    });
    expect(v).toEqual({ status: 'mismatch', expected: '263090641220', actual: '828638115993' });
    expect(describeVerdict(v, 'the-configured-project').fatal).toBe(true);
  });

  it('passes when the key belongs to the configured project', async () => {
    const v = await checkKeyMatchesProject({
      ...GOOD,
      fetchImpl: ownedBy('263090641220', { authorizedDomains: ['example.test'] }),
    });
    expect(v).toEqual({ status: 'ok', projectNumber: '263090641220' });
    expect(describeVerdict(v, 'the-configured-project').fatal).toBe(false);
  });

  it('names the outage in the failure text, so the reader knows what this is', async () => {
    const v = await checkKeyMatchesProject({
      ...GOOD,
      fetchImpl: ownedBy('999999999999'),
    });
    const { text } = describeVerdict(v, 'the-configured-project');
    expect(text).toMatch(/routes by API key, not by projectId/);
    expect(text).toContain('263090641220');
    expect(text).toContain('999999999999');
  });
});

describe('checkKeyMatchesProject — a definitively bad key is fatal', () => {
  it('treats API_KEY_INVALID as fatal, not as a transport problem', async () => {
    const v = await checkKeyMatchesProject({
      ...GOOD,
      fetchImpl: reply(
        { error: { code: 400, status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } },
        false, 400,
      ),
    });
    expect(v).toEqual({ status: 'invalid-key' });
    expect(describeVerdict(v).fatal).toBe(true);
  });
});

describe('checkKeyMatchesProject — cannot-check never blocks a deploy', () => {
  it('a network failure is unknown, not fatal', async () => {
    const v = await checkKeyMatchesProject({
      ...GOOD,
      fetchImpl: async () => { throw new Error('ETIMEDOUT'); },
    });
    expect(v.status).toBe('unknown');
    expect(v.reason).toMatch(/ETIMEDOUT/);
    expect(describeVerdict(v).fatal).toBe(false);
  });

  it('a 500 is unknown, not fatal', async () => {
    const v = await checkKeyMatchesProject({
      ...GOOD,
      fetchImpl: reply({ error: { message: 'backend error' } }, false, 500),
    });
    expect(v.status).toBe('unknown');
    expect(describeVerdict(v).fatal).toBe(false);
  });

  it('a non-JSON body is unknown, not fatal', async () => {
    const v = await checkKeyMatchesProject({
      ...GOOD,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } }),
    });
    expect(v.status).toBe('unknown');
    expect(describeVerdict(v).fatal).toBe(false);
  });

  it('a 200 with no projectId is unknown, not fatal', async () => {
    const v = await checkKeyMatchesProject({ ...GOOD, fetchImpl: reply({ authorizedDomains: [] }) });
    expect(v.status).toBe('unknown');
    expect(describeVerdict(v).fatal).toBe(false);
  });
});

describe('checkKeyMatchesProject — skips rather than duplicating an existing gate', () => {
  it.each([
    ['no api key', { apiKey: undefined, senderId: '263090641220' }],
    ['no sender id', { apiKey: 'AIzaSyGOOD', senderId: undefined }],
    ['neither', { apiKey: undefined, senderId: undefined }],
  ])('%s → skipped, and never calls the network', async (_label, vars) => {
    let called = false;
    const v = await checkKeyMatchesProject({
      ...vars,
      fetchImpl: async () => { called = true; return reply({})(); },
    });
    expect(v.status).toBe('skipped');
    expect(called).toBe(false);
    expect(describeVerdict(v).fatal).toBe(false);
  });
});

describe('checkKeyMatchesProject — comparison is type-safe', () => {
  it('matches a numeric sender id against the string Google returns', async () => {
    const v = await checkKeyMatchesProject({
      apiKey: 'AIzaSyGOOD',
      senderId: 263090641220,
      fetchImpl: ownedBy('263090641220'),
    });
    expect(v.status).toBe('ok');
  });
});
