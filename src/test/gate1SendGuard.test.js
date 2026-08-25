/** GATE 1 (G1-12) — no send may carry plan/instruction text. */
import { describe, it, expect } from 'vitest';
import { assertSendable, asGeneratedContent, isGeneratedContent, SendGuardError } from '../utils/sendActionResolver.js';

const ok = asGeneratedContent('Hi Jane — saw your Series B, worth a chat?', { generatedBy: 'test' });
const base = { recipient: 'jane@acme.com', subject: 'Quick question', channel: 'email', integration: 'connected', explicitSend: true };
const code = (fn) => { try { fn(); return null; } catch (e) { expect(e).toBeInstanceOf(SendGuardError); return e.code; } };

describe('send guard', () => {
  it('passes a fully valid send', () => {
    expect(assertSendable({ ...base, content: ok })).toBe(true);
  });

  // THE regression: steps[].action is a plan instruction, not customer copy.
  it('rejects raw plan text even though it is a non-empty string', () => {
    const planText = 'Send personalized email introducing value proposition';
    expect(code(() => assertSendable({ ...base, content: planText }))).toBe('content_not_generated');
    expect(isGeneratedContent(planText)).toBe(false);
  });

  it('rejects an untagged object that merely looks like content', () => {
    expect(code(() => assertSendable({ ...base, content: { body: 'hello' } }))).toBe('content_not_generated');
  });

  it.each([
    ['no_recipient', { recipient: '' }],
    ['no_subject', { subject: '  ' }],
    ['no_content', { content: null }],
    ['integration_unavailable', { integration: 'disconnected' }],
    ['not_confirmed', { explicitSend: false }],
  ])('rejects with %s', (expected, override) => {
    expect(code(() => assertSendable({ ...base, content: ok, ...override }))).toBe(expected);
  });

  it('asGeneratedContent refuses empty text', () => {
    expect(asGeneratedContent('   ', { generatedBy: 'x' })).toBeNull();
  });
});
