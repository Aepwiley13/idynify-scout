/**
 * #005.2 — Barry's answers and "typing" state reach screen-reader users.
 *
 * Each Barry conversation thread is a polite live log, so a new reply is read
 * out when it is added. Each typing indicator carries real text ("Barry is
 * typing…", visually hidden) instead of three silent dots or an aria-label on
 * a plain div, which assistive technology ignores.
 *
 * Out of scope: onboarding's BarryTyping (onboarding team) and the contact
 * profile's Barry panels (Contact Hub).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const src = (p) => readFileSync(resolve(here, '..', p), 'utf8');
const TYPING = '<span className="sr-only">Barry is typing…</span>';

describe.each([
  'pages/Barry/BarryWorkspace.jsx',
  'components/dashboard/BarryChatPanel.jsx',
  'components/recon/BarryReconCoach.jsx',
  'components/scout/BarryICPPanel.jsx',
])('%s', (file) => {
  const s = src(file);
  it('renders its thread as a polite, labelled log', () => {
    expect(s).toMatch(/role="log"[\s\S]{0,80}aria-live="polite"[\s\S]{0,80}aria-label="Conversation with Barry"/);
  });
  it('announces the typing state in words', () => {
    expect(s).toContain(TYPING);
  });
});

describe('typing indicators', () => {
  it('Recon Guide: a status with text', () => {
    expect(src('components/recon/BarryReconGuide.jsx')).toMatch(/role="status"[^>]*>\s*<span className="sr-only">Barry is typing…<\/span>/);
  });
  it('the shell panel no longer relies on aria-label on a plain div', () => {
    expect(src('components/dashboard/BarryChatPanel.jsx')).not.toMatch(/<div className="flex gap-2" aria-label="Barry is typing">/);
  });
  it('decorative dots are hidden from assistive technology', () => {
    expect(src('pages/Barry/BarryWorkspace.jsx').match(/barry-typing-dot" aria-hidden="true"/g)).toHaveLength(3);
  });
});
