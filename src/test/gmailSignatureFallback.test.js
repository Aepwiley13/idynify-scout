/**
 * buildFallbackSignatureHtml — pure unit tests. Integration with the actual
 * send path (only fires when the real Gmail signature is empty, never
 * doubles up with a real one) is covered in
 * gmailSendQuickRecipientAndSignature.test.js.
 */
import { describe, it, expect } from 'vitest';
import { buildFallbackSignatureHtml } from '../../netlify/functions/utils/gmailSignature.js';

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
