/**
 * validationInvoker — the refusals, and the exclusion.
 *
 * This is the only component in Gate 3 that can reach a real message-processing
 * path on demand, so what matters is not that it works but that it declines
 * everywhere it should. Each gate is tested alone, because a mechanism whose
 * safety depends on six checks passing together is one edit away from
 * depending on five.
 *
 * The previous draft was audited and not cleared. Four findings are pinned here
 * so they cannot come back: the mode gate that was documented but never
 * implemented, the denylist that let unlisted bulk fields through, the
 * non-constant-time token compare, and the audit log that would have written
 * the token it was supposed to be evidence about.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  authorizeValidationRequest,
  logInvocation,
  REFUSAL,
  ALLOWED_REQUEST_KEYS,
  LOGGABLE_FIELDS,
} from '../../netlify/functions/utils/validationInvoker.js';
import {
  shouldStage,
  VALIDATION_SITE_FLAG,
  isStageable,
  STAGED_FILE_PREFIX,
  GITIGNORE_PATTERN,
} from '../../scripts/stageValidationFunction.mjs';
import { readdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(here, rel), 'utf8');

const TOKEN = 'token_fixture_secret_value';
const TENANT = 'validation_tenant_synthetic';
const REAL_TENANT = 'peqhaq8Cw1UUPeaYhaSLwZ0iCRk2'; // a real workspace — must never pass

/** The fully provisioned validation environment: token, allowlist, live mode. */
const ENV = {
  VALIDATION_INVOKER_TOKEN: TOKEN,
  VALIDATION_ALLOWED_TENANTS: TENANT,
  GMAIL_IDENTITY_MODE: 'live',
};

const validBody = { token: TOKEN, idynifyUserId: TENANT, gmailMessageId: 'msg_fixture' };

describe('valid single-message request', () => {
  it('accepts a fully specified request in a live validation environment', () => {
    expect(authorizeValidationRequest(validBody, ENV))
      .toEqual({ ok: true, userId: TENANT, gmailMessageId: 'msg_fixture' });
  });

  it('accepts only the three enumerated keys', () => {
    expect([...ALLOWED_REQUEST_KEYS].sort())
      .toEqual(['gmailMessageId', 'idynifyUserId', 'token']);
  });
});

describe('request shape refuses instead of throwing', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['array', []],
    ['string', 'token=abc'],
    ['number', 42],
    ['boolean', true],
  ])('refuses a %s body without raising', (_label, body) => {
    let verdict;
    expect(() => { verdict = authorizeValidationRequest(body, ENV); }).not.toThrow();
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe(REFUSAL.BAD_BODY);
  });

  it('refuses an empty object on its token, not by crashing', () => {
    expect(authorizeValidationRequest({}, ENV).reason).toBe(REFUSAL.BAD_TOKEN);
  });
});

describe('strict allowlist — unexpected keys are refused, never ignored', () => {
  it.each(['range', 'limit', 'all', 'cursor', 'batch', 'tenants', 'after', 'query', 'count'])(
    'refuses an unexpected "%s" key', (field) => {
      const result = authorizeValidationRequest({ ...validBody, [field]: 'x' }, ENV);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(REFUSAL.UNEXPECTED_KEY);
    });

  it('names the offending keys so the refusal is diagnosable', () => {
    const result = authorizeValidationRequest({ ...validBody, range: 1, batch: 2 }, ENV);
    expect(result.detail).toContain('range');
    expect(result.detail).toContain('batch');
  });

  it('refuses unexpected keys before checking the token', () => {
    // Ordering matters: a caller must not learn whether a token is valid by
    // varying an unrelated field.
    const result = authorizeValidationRequest(
      { ...validBody, token: 'wrong', range: 'all' }, ENV
    );
    expect(result.reason).toBe(REFUSAL.UNEXPECTED_KEY);
  });
});

describe('token handling', () => {
  it('refuses when no token is provisioned, however good the request', () => {
    const { VALIDATION_INVOKER_TOKEN: _omit, ...noToken } = ENV;
    expect(authorizeValidationRequest(validBody, noToken).reason).toBe(REFUSAL.DISABLED);
  });

  it.each([
    ['wrong value', 'nope'],
    ['empty string', ''],
    ['a prefix of the real token', TOKEN.slice(0, 8)],
    ['the real token plus a suffix', `${TOKEN}x`],
    ['a number', 12345],
    ['an array', [TOKEN]],
    ['an object', { toString: () => TOKEN }],
  ])('refuses %s', (_label, token) => {
    expect(authorizeValidationRequest({ ...validBody, token }, ENV).reason)
      .toBe(REFUSAL.BAD_TOKEN);
  });

  it('compares in constant time rather than with ===', () => {
    const src = read('../../netlify/functions/utils/validationInvoker.js');
    expect(src).toContain('timingSafeEqual');
    expect(src).not.toMatch(/body\.token\s*!==\s*expectedToken/);
  });

  /**
   * Finding A — the hash the comment promised.
   *
   * timingSafeEqual throws on differing buffer lengths, so comparing raw token
   * bytes forces a length branch, and that branch leaks the secret's length —
   * the very thing the function is meant to hide. Hashing both sides first
   * makes every comparison 32 bytes against 32 bytes.
   */
  describe('fixed-width hashing before comparison', () => {
    it('hashes both sides rather than comparing raw bytes', () => {
      const src = read('../../netlify/functions/utils/validationInvoker.js');
      expect(src).toContain("createHash('sha256')");
      // The old length shortcut must be gone — it was the observable branch.
      expect(src).not.toMatch(/if\s*\(a\.length\s*!==\s*b\.length\)/);
    });

    it('accepts equal tokens', () => {
      expect(authorizeValidationRequest(validBody, ENV).ok).toBe(true);
    });

    it('refuses unequal tokens of the SAME length', () => {
      const same = 'X'.repeat(TOKEN.length);
      expect(same.length).toBe(TOKEN.length);
      expect(authorizeValidationRequest({ ...validBody, token: same }, ENV).reason)
        .toBe(REFUSAL.BAD_TOKEN);
    });

    it.each([
      ['much shorter', 'x'],
      ['one char short', TOKEN.slice(0, -1)],
      ['one char long', `${TOKEN}x`],
      ['much longer', TOKEN.repeat(4)],
    ])('refuses an unequal token of different length (%s)', (_label, token) => {
      expect(authorizeValidationRequest({ ...validBody, token }, ENV).reason)
        .toBe(REFUSAL.BAD_TOKEN);
    });

    it.each([
      ['empty presented', ''],
      ['null', null],
      ['undefined', undefined],
      ['number', 1234],
      ['array', [TOKEN]],
      ['object', {}],
      ['boolean', true],
    ])('refuses %s without throwing', (_label, token) => {
      let verdict;
      expect(() => { verdict = authorizeValidationRequest({ ...validBody, token }, ENV); })
        .not.toThrow();
      expect(verdict.ok).toBe(false);
    });

    it('refuses when the configured secret is empty', () => {
      expect(authorizeValidationRequest(validBody, { ...ENV, VALIDATION_INVOKER_TOKEN: '' }).reason)
        .toBe(REFUSAL.DISABLED);
    });

    it('leaks neither the presented nor the expected token on any path', () => {
      for (const token of ['', 'x', TOKEN.slice(0, -1), `${TOKEN}x`, 'X'.repeat(TOKEN.length)]) {
        const verdict = authorizeValidationRequest({ ...validBody, token }, ENV);
        const serialized = JSON.stringify(verdict);
        expect(serialized).not.toContain(TOKEN);
        if (token) expect(serialized).not.toContain(token);
      }
    });
  });

  it('never returns the presented or expected token in its verdict', () => {
    const result = authorizeValidationRequest({ ...validBody, token: 'wrong' }, ENV);
    expect(JSON.stringify(result)).not.toContain('wrong');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});

describe('mode gate — enforced here, not merely documented', () => {
  it('accepts only the literal string "live"', () => {
    expect(authorizeValidationRequest(validBody, { ...ENV, GMAIL_IDENTITY_MODE: 'live' }).ok)
      .toBe(true);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['dry_run', 'dry_run'],
    ['LIVE', 'LIVE'],
    ['liv', 'liv'],
    ['live ', 'live '],
    ['true', 'true'],
  ])('refuses mode %s', (_label, mode) => {
    const env = { ...ENV, GMAIL_IDENTITY_MODE: mode };
    if (mode === undefined) delete env.GMAIL_IDENTITY_MODE;
    expect(authorizeValidationRequest(validBody, env).reason).toBe(REFUSAL.MODE_NOT_LIVE);
  });

  it('is genuinely implemented, not just described in a comment', () => {
    // The audited defect: GMAIL_IDENTITY_MODE appeared once, in prose.
    const src = read('../../netlify/functions/utils/validationInvoker.js');
    const codeOccurrences = src
      .split('\n')
      .filter(l => l.includes('GMAIL_IDENTITY_MODE') && !l.trim().startsWith('*'));
    expect(codeOccurrences.length).toBeGreaterThan(0);
  });
});

describe('tenant allowlist is mandatory', () => {
  it('refuses a real customer workspace even with a valid token and live mode', () => {
    expect(authorizeValidationRequest({ ...validBody, idynifyUserId: REAL_TENANT }, ENV).reason)
      .toBe(REFUSAL.TENANT_NOT_ALLOWED);
  });

  it('refuses everything when the allowlist is absent', () => {
    const { VALIDATION_ALLOWED_TENANTS: _omit, ...noList } = ENV;
    expect(authorizeValidationRequest(validBody, noList).reason)
      .toBe(REFUSAL.TENANT_NOT_ALLOWED);
  });

  it('does not accept a prefix or substring of an allowlisted tenant', () => {
    expect(authorizeValidationRequest({ ...validBody, idynifyUserId: TENANT.slice(0, 6) }, ENV).reason)
      .toBe(REFUSAL.TENANT_NOT_ALLOWED);
  });
});

describe('required identifiers', () => {
  it.each([
    ['missing tenant', { token: TOKEN, gmailMessageId: 'm' }, REFUSAL.MISSING_TENANT],
    ['blank tenant', { ...validBody, idynifyUserId: '   ' }, REFUSAL.MISSING_TENANT],
    ['non-string tenant', { ...validBody, idynifyUserId: 7 }, REFUSAL.MISSING_TENANT],
    ['missing message', { token: TOKEN, idynifyUserId: TENANT }, REFUSAL.MISSING_MESSAGE],
    ['blank message', { ...validBody, gmailMessageId: '' }, REFUSAL.MISSING_MESSAGE],
    ['null message', { ...validBody, gmailMessageId: null }, REFUSAL.MISSING_MESSAGE],
  ])('refuses %s', (_label, body, reason) => {
    expect(authorizeValidationRequest(body, ENV).reason).toBe(reason);
  });
});

describe('audit logging owns redaction', () => {
  function fakeDb() {
    const written = [];
    return { written, collection: () => ({ add: async (d) => { written.push(d); return { id: 'x' }; } }) };
  }

  it('drops the token even when the caller passes the whole request body', async () => {
    const db = fakeDb();
    const safe = await logInvocation(db, {
      ...validBody, invocationId: 'i1', outcome: 'refused', reason: REFUSAL.BAD_TOKEN,
    });
    const serialized = JSON.stringify(db.written[0]);
    expect(serialized).not.toContain(TOKEN);
    expect(safe.token).toBeUndefined();
  });

  it.each([
    ['token', TOKEN],
    ['accessToken', 'ya29.secret'],
    ['refreshToken', '1//refresh'],
    ['privateKey', '-----BEGIN PRIVATE KEY-----'],
    ['apiKey', 'sk-ant-secret'],
    ['authorization', 'Bearer abc'],
    ['body', '{"token":"leak"}'],
  ])('never writes a %s field', async (field, value) => {
    const db = fakeDb();
    await logInvocation(db, { invocationId: 'i2', outcome: 'refused', [field]: value });
    expect(JSON.stringify(db.written[0])).not.toContain(String(value));
  });

  it('keeps the fields an audit record needs', async () => {
    const db = fakeDb();
    await logInvocation(db, {
      invocationId: 'i3', outcome: 'processed',
      idynifyUserId: TENANT, gmailMessageId: 'msg_fixture',
      messageRecordId: 'rec1', processingStatus: 'success',
    });
    const row = db.written[0];
    expect(row.idynifyUserId).toBe(TENANT);
    expect(row.gmailMessageId).toBe('msg_fixture');
    expect(row.processingStatus).toBe('success');
  });

  it('truncates caller-supplied detail', async () => {
    const db = fakeDb();
    await logInvocation(db, { invocationId: 'i4', detail: 'x'.repeat(5000) });
    expect(db.written[0].detail.length).toBe(200);
  });

  it('enumerates what may be logged rather than what must be hidden', () => {
    expect(LOGGABLE_FIELDS).not.toContain('token');
    expect(LOGGABLE_FIELDS.length).toBeLessThanOrEqual(12);
  });
});

/**
 * Strip comments before asserting about code.
 *
 * These checks are about what the module DOES, and the entrypoint's header
 * deliberately names the things it avoids — `messages.list`, `lastHistoryId`,
 * the send endpoints — so a reader can see the guarantee stated. Scanning raw
 * source would fail on that prose and, worse, would pressure the next author to
 * delete the documentation to make the test pass.
 */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/^\s*\/\/.*$/gm, '');      // line comments
}

describe('exactly-one semantics in the entrypoint', () => {
  const entry = codeOnly(read('../../netlify/validation/validation-process-one-message.js'));

  it('calls the production processor exactly once', () => {
    expect(entry.split('processNormalizedMessage(db,').length - 1).toBe(1);
  });

  it('imports the production processor rather than reimplementing it', () => {
    expect(entry).toContain("from '../functions/utils/messageProcessor.js'");
    expect(entry).not.toContain('relationship_events');
    expect(entry).not.toContain('applyEvent');
  });

  it('selects by message id, never by query or listing', () => {
    expect(entry).toContain('fetchMessage(gmail, gmailMessageId)');
    expect(entry).not.toContain('messages.list');
    expect(entry).not.toContain('fetchRecentInbox');
    expect(entry).not.toContain('fetchHistorySince');
  });

  it('contains no loop, cursor or batch construct in the invocation path', () => {
    expect(entry).not.toMatch(/\bfor\s*\(/);
    expect(entry).not.toMatch(/\.forEach\(/);
    expect(entry).not.toMatch(/while\s*\(/);
    expect(entry).not.toContain('lastHistoryId');
    expect(entry).not.toContain('pageToken');
  });

  it('never invokes a send path', () => {
    for (const send of ['gmail-send', 'gmail-send-quick', 'gmail-send-wave',
                        'barry-approve-send', 'users.messages.send', 'sendMessage']) {
      expect(entry).not.toContain(send);
    }
  });

  it('refuses before reaching the processor', () => {
    // The refusal branch returns; the processor call sits after it.
    const refusalIndex = entry.indexOf('if (!auth.ok)');
    const processorIndex = entry.indexOf('processNormalizedMessage(db,');
    expect(refusalIndex).toBeGreaterThan(-1);
    expect(refusalIndex).toBeLessThan(processorIndex);
    expect(entry.slice(refusalIndex, processorIndex)).toContain('return respond(');
  });
});

describe('production exclusion is structural, not a missing secret', () => {
  it('the entrypoint lives outside the deployed functions directory', () => {
    expect(() => read('../../netlify/validation/validation-process-one-message.js')).not.toThrow();
    expect(() => read('../../netlify/functions/validation-process-one-message.js')).toThrow();
  });

  it('stages only when VALIDATION_SITE is exactly "true"', () => {
    expect(shouldStage({ [VALIDATION_SITE_FLAG]: 'true' })).toBe(true);
  });

  it.each([
    ['unset', {}],
    ['empty', { VALIDATION_SITE: '' }],
    ['TRUE', { VALIDATION_SITE: 'TRUE' }],
    ['1', { VALIDATION_SITE: '1' }],
    ['yes', { VALIDATION_SITE: 'yes' }],
    ['false', { VALIDATION_SITE: 'false' }],
  ])('does not stage when VALIDATION_SITE is %s', (_label, env) => {
    expect(shouldStage(env)).toBe(false);
  });

  it('is wired into the shared build command', () => {
    expect(read('../../netlify.toml')).toContain('scripts/stageValidationFunction.mjs');
  });

  it('cannot be committed back into the functions directory', () => {
    expect(read('../../.gitignore')).toContain('netlify/functions/validation-*.js');
  });
});

/**
 * Finding B — the two halves of the exclusion must agree.
 *
 * Staging decides what is copied INTO netlify/functions/; .gitignore decides
 * what may never be committed there. The audit found they disagreed: staging
 * took any `*.js`, the ignore rule covered only `validation-*.js`. A file named
 * `helper.js` would have been staged into the deployed directory and remained
 * git-visible — the exact leak the exclusion exists to prevent.
 */
describe('staging invariant — everything stageable is also ignorable', () => {
  it('accepts only the validation- convention', () => {
    expect(isStageable('validation-process-one-message.js')).toBe(true);
    expect(isStageable('validation-x.js')).toBe(true);
  });

  it.each([
    'helper.js', 'index.js', 'utils.js', 'Validation-x.js',
    'my-validation-thing.js', 'validation.js', 'validation-x.mjs', 'validation-x.js.bak',
  ])('refuses "%s"', (name) => {
    expect(isStageable(name)).toBe(false);
  });

  it('every real file in netlify/validation/ satisfies the convention', () => {
    const dir = resolve(here, '../../netlify/validation');
    const files = readdirSync(dir).filter(f => f.endsWith('.js'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(isStageable(f)).toBe(true);
  });

  it('derives the gitignore pattern from the same constant', () => {
    expect(GITIGNORE_PATTERN).toBe(`netlify/functions/${STAGED_FILE_PREFIX}*.js`);
    // A text file cannot import a constant, so assert the file still carries it.
    expect(read('../../.gitignore')).toContain(GITIGNORE_PATTERN);
  });

  it('every staged filename is covered by the gitignore glob', () => {
    const dir = resolve(here, '../../netlify/validation');
    const globToRe = new RegExp(
      '^' + GITIGNORE_PATTERN.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*') + '$'
    );
    for (const f of readdirSync(dir).filter(x => x.endsWith('.js'))) {
      expect(globToRe.test(`netlify/functions/${f}`)).toBe(true);
    }
  });
});
