/**
 * buildFallbackSignatureHtml and resolveFallbackSignOff — pure unit tests.
 * Integration with the actual send path (only fires when the real Gmail
 * signature is empty, never doubles up with a real one, never duplicates an
 * existing closing already in the body) is covered in
 * gmailSendQuickRecipientAndSignature.test.js.
 */
import { describe, it, expect } from 'vitest';
import { buildFallbackSignatureHtml, resolveFallbackSignOff } from '../../netlify/functions/utils/gmailSignature.js';

describe('buildFallbackSignatureHtml', () => {
  it('renders a deterministic "Best," sign-off with the given name', () => {
    expect(buildFallbackSignatureHtml('Aaron Wiley')).toBe('Best,<br>Aaron Wiley');
  });

  it('trims surrounding whitespace', () => {
    expect(buildFallbackSignatureHtml('  Aaron Wiley  ')).toBe('Best,<br>Aaron Wiley');
  });

  it('returns empty string for an empty, null, or undefined name — no fallback forced', () => {
    expect(buildFallbackSignatureHtml('')).toBe('');
    expect(buildFallbackSignatureHtml('   ')).toBe('');
    expect(buildFallbackSignatureHtml(null)).toBe('');
    expect(buildFallbackSignatureHtml(undefined)).toBe('');
  });

  it('escapes HTML-significant characters in the name', () => {
    expect(buildFallbackSignatureHtml('<script>alert(1)</script>')).toBe(
      'Best,<br>&lt;script&gt;alert(1)&lt;/script&gt;'
    );
    expect(buildFallbackSignatureHtml('Aaron "The Closer" Wiley & Co.')).toBe(
      'Best,<br>Aaron &quot;The Closer&quot; Wiley &amp; Co.'
    );
  });
});

describe('resolveFallbackSignOff', () => {
  it('Barry-generated draft (bare "Best," with no name) — completes it in place, no separate signature block', () => {
    const { bodyText, signatureHtml } = resolveFallbackSignOff(
      'Saw your Series B — worth a chat?\n\nBest,', 'Aaron Wiley'
    );
    expect(bodyText).toBe('Saw your Series B — worth a chat?\n\nBest,\nAaron Wiley');
    expect(signatureHtml).toBe('');
  });

  it('recognizes other common bare valedictions on their own line, with or without a trailing comma', () => {
    for (const valediction of ['Thanks,', 'Thanks', 'Regards,', 'Sincerely', 'Best regards,', 'Cheers', 'Warmly,']) {
      const { bodyText, signatureHtml } = resolveFallbackSignOff(`Quick note.\n\n${valediction}`, 'Aaron Wiley');
      expect(bodyText).toBe(`Quick note.\n\n${valediction}\nAaron Wiley`);
      expect(signatureHtml).toBe('');
    }
  });

  it('does NOT treat a valediction word mid-sentence as a sign-off — only a line consisting of just that word', () => {
    const { bodyText, signatureHtml } = resolveFallbackSignOff(
      "Let's talk soon, thanks for reading", 'Aaron Wiley'
    );
    expect(bodyText).toBe("Let's talk soon, thanks for reading");
    expect(signatureHtml).toBe('Best,<br>Aaron Wiley');
  });

  it('user-edited sign-off already carrying the name ("Best,\\nAaron Wiley") — adds nothing, body untouched', () => {
    const { bodyText, signatureHtml } = resolveFallbackSignOff(
      'Following up on our call.\n\nBest,\nAaron Wiley', 'Aaron Wiley'
    );
    expect(bodyText).toBe('Following up on our call.\n\nBest,\nAaron Wiley');
    expect(signatureHtml).toBe('');
  });

  it('user signed with just their name and no valediction at all — still recognized, adds nothing', () => {
    const { bodyText, signatureHtml } = resolveFallbackSignOff(
      'Following up on our call.\n\nAaron Wiley', 'Aaron Wiley'
    );
    expect(bodyText).toBe('Following up on our call.\n\nAaron Wiley');
    expect(signatureHtml).toBe('');
  });

  it('no sign-off of any kind in the body — adds the full, separate fallback block exactly as before', () => {
    const { bodyText, signatureHtml } = resolveFallbackSignOff(
      'Just checking in, let me know your thoughts.', 'Aaron Wiley'
    );
    expect(bodyText).toBe('Just checking in, let me know your thoughts.');
    expect(signatureHtml).toBe('Best,<br>Aaron Wiley');
  });

  it('empty/missing name — never modifies the body, never produces a signature', () => {
    for (const name of ['', '   ', null, undefined]) {
      const { bodyText, signatureHtml } = resolveFallbackSignOff('Hello there.\n\nBest,', name);
      expect(bodyText).toBe('Hello there.\n\nBest,');
      expect(signatureHtml).toBe('');
    }
  });

  it('never produces a result containing two valedictions back to back, across every branch', () => {
    const cases = [
      'Hi — quick question.\n\nBest,',
      'Hi — quick question.\n\nBest,\nAaron Wiley',
      'Hi — quick question.',
    ];
    for (const body of cases) {
      const { bodyText, signatureHtml } = resolveFallbackSignOff(body, 'Aaron Wiley');
      const combined = bodyText + signatureHtml;
      expect(combined.match(/Best,/g)?.length ?? 0).toBeLessThanOrEqual(1);
    }
  });
});
