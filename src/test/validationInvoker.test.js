/**
 * validationInvoker — the refusals.
 *
 * This endpoint is the only thing in Gate 3 that can process a real production
 * message on demand, so what matters is not that it works but that it declines
 * in every case where it should. Each gate is tested on its own, because a
 * mechanism whose safety depends on four checks passing together is one edit
 * away from depending on three.
 *
 * The last group is the one worth reading: a caller who asks for many messages
 * is refused rather than quietly served one. Silently narrowing a broad request
 * is how a validation tool becomes an accidental bulk processor.
 */

import { describe, it, expect } from 'vitest';
import {
  authorizeValidationRequest,
  REFUSAL,
} from '../../netlify/functions/utils/validationInvoker.js';

const TOKEN = 'token_fixture_secret';
const SYNTHETIC_TENANT = 'validation_tenant_synthetic';
const REAL_TENANT = 'peqhaq8Cw1UUPeaYhaSLwZ0iCRk2'; // a real workspace — must never pass

const ENV = {
  VALIDATION_INVOKER_TOKEN: TOKEN,
  VALIDATION_ALLOWED_TENANTS: SYNTHETIC_TENANT,
};

const validBody = {
  token: TOKEN,
  idynifyUserId: SYNTHETIC_TENANT,
  gmailMessageId: 'msg_fixture_validation',
};

describe('gate 1 — the endpoint does not exist without a provisioned token', () => {
  it('refuses when no token is configured, even with a correct request', () => {
    const result = authorizeValidationRequest(validBody, { VALIDATION_ALLOWED_TENANTS: SYNTHETIC_TENANT });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(REFUSAL.DISABLED);
  });

  it('refuses a wrong token', () => {
    const result = authorizeValidationRequest({ ...validBody, token: 'wrong' }, ENV);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(REFUSAL.BAD_TOKEN);
  });

  it('refuses a missing token', () => {
    const { token: _omitted, ...noToken } = validBody;
    const result = authorizeValidationRequest(noToken, ENV);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(REFUSAL.BAD_TOKEN);
  });
});

describe('gate 2 — the tenant allowlist survives a leaked token', () => {
  it('refuses a real customer workspace even with a valid token', () => {
    const result = authorizeValidationRequest(
      { ...validBody, idynifyUserId: REAL_TENANT }, ENV
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(REFUSAL.TENANT_NOT_ALLOWED);
  });

  it('refuses everything when the allowlist is empty', () => {
    const result = authorizeValidationRequest(validBody, { VALIDATION_INVOKER_TOKEN: TOKEN });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(REFUSAL.TENANT_NOT_ALLOWED);
  });

  it('does not treat a prefix or substring as a match', () => {
    const result = authorizeValidationRequest(
      { ...validBody, idynifyUserId: SYNTHETIC_TENANT.slice(0, 8) }, ENV
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(REFUSAL.TENANT_NOT_ALLOWED);
  });
});

describe('gate 3 — exactly one message must be named', () => {
  it.each([
    ['missing tenant', { token: TOKEN, gmailMessageId: 'm' }, REFUSAL.MISSING_TENANT],
    ['empty tenant', { ...validBody, idynifyUserId: '   ' }, REFUSAL.MISSING_TENANT],
    ['non-string tenant', { ...validBody, idynifyUserId: 123 }, REFUSAL.MISSING_TENANT],
    ['missing message id', { token: TOKEN, idynifyUserId: SYNTHETIC_TENANT }, REFUSAL.MISSING_MESSAGE],
    ['empty message id', { ...validBody, gmailMessageId: '' }, REFUSAL.MISSING_MESSAGE],
    ['null message id', { ...validBody, gmailMessageId: null }, REFUSAL.MISSING_MESSAGE],
  ])('refuses %s', (_label, body, reason) => {
    const result = authorizeValidationRequest(body, ENV);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(reason);
  });

  it('accepts a fully specified request', () => {
    const result = authorizeValidationRequest(validBody, ENV);
    expect(result).toEqual({
      ok: true,
      userId: SYNTHETIC_TENANT,
      gmailMessageId: 'msg_fixture_validation',
    });
  });
});

describe('a broad request is refused, never narrowed', () => {
  it.each([
    'all', 'limit', 'maxResults', 'since', 'historyId',
    'cursor', 'gmailMessageIds', 'contactIds', 'batch', 'tenants',
  ])('refuses when "%s" is present', (field) => {
    const result = authorizeValidationRequest({ ...validBody, [field]: 50 }, ENV);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(REFUSAL.BROAD_REQUEST);
  });

  it('names the offending fields so the refusal is diagnosable', () => {
    const result = authorizeValidationRequest(
      { ...validBody, limit: 10, all: true }, ENV
    );
    expect(result.reason).toBe(REFUSAL.BROAD_REQUEST);
    expect(result.detail).toContain('all');
    expect(result.detail).toContain('limit');
  });

  it('refuses a broad request before it ever considers the tenant', () => {
    // Ordering matters: a caller must not be able to learn which tenants are
    // allowlisted by varying a broad field.
    const result = authorizeValidationRequest(
      { ...validBody, idynifyUserId: REAL_TENANT, limit: 100 }, ENV
    );
    expect(result.reason).toBe(REFUSAL.BROAD_REQUEST);
  });
});

describe('the production posture', () => {
  it('is inert in any environment that has not provisioned it', () => {
    // Production has neither variable, which is the intended state. Every
    // request — including a perfectly formed one — is refused there.
    for (const body of [validBody, { ...validBody, idynifyUserId: REAL_TENANT }]) {
      expect(authorizeValidationRequest(body, {}).ok).toBe(false);
      expect(authorizeValidationRequest(body, {}).reason).toBe(REFUSAL.DISABLED);
    }
  });
});
