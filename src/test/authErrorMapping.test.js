import { describe, it, expect } from 'vitest';
import { describeAuthError } from '../utils/authErrors';

const auth = {
  app: { options: { projectId: 'idynify-scout-dev', apiKey: 'AIzaSyFAKEfakeFAKEfakeFAKEfakeAb3xQ' } },
};

describe('describeAuthError — the regression that caused the 2026-09-22 lockout', () => {
  it('does not give a deployment fault and a wrong password the same message', () => {
    const credential = describeAuthError({ code: 'auth/invalid-credential' }, auth);
    const config = describeAuthError({ code: 'auth/invalid-api-key' }, auth);

    expect(credential.message).not.toBe(config.message);
    expect(credential.isConfigFault).toBe(false);
    expect(config.isConfigFault).toBe(true);
  });

  it('tells the user plainly when no password of theirs could have worked', () => {
    for (const code of ['auth/invalid-api-key', 'auth/configuration-not-found', 'auth/operation-not-allowed']) {
      const { message, isConfigFault } = describeAuthError({ code }, auth);
      expect(isConfigFault).toBe(true);
      expect(message).toMatch(/not your password/i);
    }
  });

  it('carries the API key fingerprint, because Auth routes by key and not by projectId', () => {
    // The whole incident: projectId read correctly while the key belonged to
    // another project. The projectId alone cannot catch that; the key can.
    const { technical } = describeAuthError({ code: 'auth/invalid-credential' }, auth);
    expect(technical).toContain('auth/invalid-credential');
    expect(technical).toContain('idynify-scout-dev');
    expect(technical).toContain('Ab3xQ');
  });

  it('distinguishes two projects that share a projectId but differ by key', () => {
    const other = { app: { options: { projectId: 'idynify-scout-dev', apiKey: 'AIzaSyOTHERotherOTHERotherOTHERzZ9q' } } };
    const a = describeAuthError({ code: 'auth/invalid-credential' }, auth);
    const b = describeAuthError({ code: 'auth/invalid-credential' }, other);
    expect(a.technical).not.toBe(b.technical);
  });
});

describe('describeAuthError — enumeration protection is preserved', () => {
  it('never reveals whether the address exists', () => {
    const messages = ['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password']
      .map((code) => describeAuthError({ code }, auth).message);

    expect(new Set(messages).size).toBe(1);
    for (const m of messages) {
      expect(m).not.toMatch(/no account|not found|doesn't exist|unregistered/i);
    }
  });
});

describe('describeAuthError — degrades safely', () => {
  it('handles an unrecognised code without throwing or going blank', () => {
    const { message, technical, isConfigFault } = describeAuthError({ code: 'auth/some-future-code' }, auth);
    expect(message).toMatch(/something went wrong/i);
    expect(technical).toContain('auth/some-future-code');
    expect(isConfigFault).toBe(false);
  });

  it('handles a null error and a missing auth instance', () => {
    expect(describeAuthError(null, auth).technical).toContain('unknown-error');
    expect(describeAuthError({ code: 'auth/invalid-credential' }, null).technical)
      .toContain('no-project-id');
    expect(describeAuthError({ code: 'auth/invalid-credential' }, null).technical)
      .toContain('key ?');
  });

  it('maps each user-fixable code to its own distinct sentence', () => {
    const distinct = ['auth/invalid-email', 'auth/too-many-requests', 'auth/network-request-failed', 'auth/user-disabled']
      .map((code) => describeAuthError({ code }, auth).message);
    expect(new Set(distinct).size).toBe(4);
  });
});
