/**
 * The reply-sync pipeline (gmail-poll-replies.js / gmail-reply-sync-worker.js
 * / replyPolling.js) must never merge with the identity-resolution pipeline
 * gated behind GMAIL_IDENTITY_MODE (gmail-sync-worker.js's own call into
 * messageProcessor.js). That gate exists because of a known, currently
 * unresolved cursor-wedge defect (ADR-006) — reply sync does not need
 * identity resolution at all (the contact is already known; "not from me"
 * is sufficient), so it must have no path that could ever touch, enable,
 * or depend on that gate.
 *
 * Source-text contract, not a behavioral test — proving an import never
 * exists is naturally a source check, the same shape this codebase already
 * uses for comparable boundaries (see engagedSemanticsSourceContract.test.js).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (relPath) => readFileSync(resolve(here, '..', '..', relPath), 'utf8');

// Only real import/usage sites are forbidden — a comment explaining WHY
// this boundary exists is expected to name these files, and does (see
// replyPolling.js's own file header). So this checks actual import/call
// syntax, not bare string containment.
const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+['"][^'"]*messageProcessor\.js['"]/,
  /from\s+['"][^'"]*relationshipEventWriter\.js['"]/,
  /from\s+['"][^'"]*identityResolution\.js['"]/,
  /\bprocessNormalizedMessage\s*\(/,
  /process\.env\.GMAIL_IDENTITY_MODE/,
];

describe('Reply-sync pipeline never references the gated identity-resolution path', () => {
  it.each([
    'netlify/functions/utils/replyPolling.js',
    'netlify/functions/gmail-reply-sync-worker.js',
    'netlify/functions/gmail-poll-replies.js',
  ])('%s imports/calls none of messageProcessor.js, relationshipEventWriter.js, identityResolution.js, or GMAIL_IDENTITY_MODE', (path) => {
    const file = src(path);
    for (const forbidden of FORBIDDEN_IMPORT_PATTERNS) {
      expect(file).not.toMatch(forbidden);
    }
  });

  it('gmail-reply-sync-worker.js reuses gmail-sync-worker.js\'s findConnectedGmailUsers and gmailMessageService.js\'s getOAuthClient, rather than reimplementing either', () => {
    const file = src('netlify/functions/gmail-reply-sync-worker.js');
    expect(file).toContain("import { findConnectedGmailUsers } from './gmail-sync-worker.js'");
    expect(file).toContain("import { getOAuthClient } from './utils/gmailMessageService.js'");
  });

  it('calls findConnectedGmailUsers with its own independent rotation field, not the identity-sync worker\'s lastSuccessfulSyncAt', () => {
    const file = src('netlify/functions/gmail-reply-sync-worker.js');
    expect(file).toMatch(/findConnectedGmailUsers\(db,\s*undefined,\s*REPLY_SYNC_ROTATION_FIELD\)/);
    expect(file).not.toMatch(/findConnectedGmailUsers\(db\)/); // the bare call would silently fall back to the default field
  });

  it('gmail-reply-sync-worker.js is schedule()-wrapped, the same form gmail-sync-worker.js uses', () => {
    const file = src('netlify/functions/gmail-reply-sync-worker.js');
    expect(file).toMatch(/export const handler = schedule\(/);
  });

  it('gmail-poll-replies.js (the manual handler) and the scheduled worker both call the same shared pollRepliesForUser — not two implementations', () => {
    const manual = src('netlify/functions/gmail-poll-replies.js');
    const worker = src('netlify/functions/gmail-reply-sync-worker.js');
    expect(manual).toContain("import { pollRepliesForUser } from './utils/replyPolling.js'");
    expect(worker).toContain("import { pollRepliesForUser } from './utils/replyPolling.js'");
  });
});
