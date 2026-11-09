/**
 * PR 1 review item: Aaron's production smoke test actually exercised the
 * Contact Profile's inline engagement flow (InlineEngagementSection.jsx),
 * not HunterContactDrawer.jsx — a separate component with its own Review &
 * Send step ("STEP 6" in this file). The original PR 1 diff only touched
 * HunterContactDrawer.jsx; this extends the same two fixes here:
 *   - "Display the complete To address in Review & Send."
 *   - "Apply appropriate recipient validation to To as well as CC."
 *
 * InlineEngagementSection.jsx is 1800+ lines with the same heavy
 * Firebase/Barry dependency surface as HunterContactDrawer.jsx — too large
 * to mount cleanly in RTL (see engagedSemanticsSourceContract.test.js, which
 * already uses this exact source-contract pattern for this exact file, for
 * a different correction). This is the source-text contract proving the
 * JSX actually renders the recipient address and the Send button is
 * actually gated by the same format check gmail-send-quick.js applies
 * server-side to `toEmail` (confirmed: executeSendAction's email path posts
 * to gmail-send-quick.js with toEmail: contact.email, same as the Hunter
 * drawer — the server-side validation already covers this flow; only the
 * client UI was missing it).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const file = readFileSync(resolve(here, '..', 'components/contacts/InlineEngagementSection.jsx'), 'utf8');

const EMAIL_FORMAT_SOURCE = '/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/';

describe('InlineEngagementSection.jsx: Review & Send recipient display and validation', () => {
  it('hasValidEmailFormat uses the identical regex gmail-send-quick.js applies server-side to toEmail', () => {
    expect(file).toContain(`const hasValidEmailFormat = hasEmail && ${EMAIL_FORMAT_SOURCE}.test(contact.email.trim());`);

    const serverFile = readFileSync(resolve(here, '..', '..', 'netlify/functions/gmail-send-quick.js'), 'utf8');
    expect(serverFile).toContain(`const EMAIL_FORMAT = ${EMAIL_FORMAT_SOURCE};`);
  });

  it('sendEmailViaGmail posts toEmail: contact.email to gmail-send-quick.js — the same server-side validation already protects this flow', () => {
    const resolverFile = readFileSync(resolve(here, '..', 'utils/sendActionResolver.js'), 'utf8');
    expect(resolverFile).toContain("fetch('/.netlify/functions/gmail-send-quick'");
    expect(resolverFile).toContain('toEmail: contact.email,');
  });

  it('STEP 6 (Review & Send) renders the full recipient address for the email weapon, with a warning when the format is invalid', () => {
    const reviewStart = file.indexOf('STEP 6: Review & Send');
    expect(reviewStart).toBeGreaterThan(-1);
    const reviewBlock = file.slice(reviewStart, reviewStart + 2000);

    expect(reviewBlock).toMatch(/selectedWeapon === 'email' && \(/);
    expect(reviewBlock).toContain('className="ies-review-recipient"');
    expect(reviewBlock).toMatch(/To:\s*\{hasEmail \? contact\.email : 'No email on file'\}/);
    expect(reviewBlock).toMatch(/hasEmail && !hasValidEmailFormat/);
    expect(reviewBlock).toContain('className="ies-recipient-warning"');
  });

  it('the Send button is disabled for an email send with an invalid/missing address, but not for other channels or native handoff', () => {
    const disabledIdx = file.indexOf('disabled={!message || loading ||');
    expect(disabledIdx).toBeGreaterThan(-1);
    const disabledLine = file.slice(disabledIdx, file.indexOf('}', file.indexOf(')', disabledIdx)) + 1);

    expect(disabledLine).toContain("selectedWeapon === 'email'");
    expect(disabledLine).toContain('!isNativeHandoff()');
    expect(disabledLine).toContain('!hasValidEmailFormat');
  });
});
