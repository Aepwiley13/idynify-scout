/**
 * PR 1 (Email Reliability & Sender Identity), Review & Send screen:
 *   - "Display the complete To address in Review & Send."
 *   - "Apply appropriate recipient validation to To as well as CC."
 *
 * HunterContactDrawer.jsx is one of the components too large/Firebase-heavy
 * to mount cleanly in a unit test (800-1900 lines; see
 * engagedSemanticsSourceContract.test.js, which establishes this exact
 * pattern for this exact file). This is the source-text contract proving the
 * JSX actually renders the recipient address and the Send button is
 * actually gated by the same format check gmail-send-quick.js applies
 * server-side to `toEmail` — not a behavioral/rendered assertion.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const file = readFileSync(resolve(here, '..', 'components/hunter/HunterContactDrawer.jsx'), 'utf8');

const EMAIL_FORMAT_SOURCE = '/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/';

describe('HunterContactDrawer.jsx: Review & Send recipient display and validation', () => {
  it('hasValidEmailFormat uses the identical regex gmail-send-quick.js applies server-side to toEmail', () => {
    expect(file).toContain(`const hasValidEmailFormat = hasEmail && ${EMAIL_FORMAT_SOURCE}.test(contact.email.trim());`);

    const serverFile = readFileSync(resolve(here, '..', '..', 'netlify/functions/gmail-send-quick.js'), 'utf8');
    expect(serverFile).toContain(`const EMAIL_FORMAT = ${EMAIL_FORMAT_SOURCE};`);
  });

  it('the review view renders the full recipient address for the email weapon, with a warning when the format is invalid', () => {
    const reviewStart = file.indexOf("activeView === 'review'");
    expect(reviewStart).toBeGreaterThan(-1);
    const reviewBlock = file.slice(reviewStart, reviewStart + 2000);

    expect(reviewBlock).toMatch(/selectedWeapon === 'email' && \(/);
    expect(reviewBlock).toContain('className="view-recipient-email"');
    expect(reviewBlock).toMatch(/To:\s*\{hasEmail \? contact\.email : 'No email on file'\}/);
    expect(reviewBlock).toMatch(/hasEmail && !hasValidEmailFormat/);
    expect(reviewBlock).toContain('className="recipient-email-warning"');
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
