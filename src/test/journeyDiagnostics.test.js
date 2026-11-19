/**
 * W6 journey diagnostics (scripts/staging/e2e/diagnostics.mjs): when a step that expects the Scout
 * contact page fails, the report says which of four causes it was (redirect, loading failure,
 * rendering error, selector issue), with the evidence, and masks tokens. Test automation only.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { classifyPageFailure, captureDiagnostics, redact } from '../../scripts/staging/e2e/diagnostics.mjs';
import { contactPageUrlPattern } from '../../scripts/staging/e2e/journey.mjs';

const BASE = 'http://localhost:8888';
const ID = 'abc123';
const on = (path, extra = {}) => classifyPageFailure({ base: BASE, url: `${BASE}${path}`, contactId: ID, ...extra });

describe('classifyPageFailure: which of the four causes', () => {
  it('redirects: Contact Hub (paid gate saw Free), the Scout panel, /scout (not found), checkout, elsewhere, off the app', () => {
    expect(on('/contact-hub/person/abc123')).toMatchObject({ category: 'redirect', kind: 'sent-to-contact-hub' });
    expect(on('/scout/contact/abc123')).toMatchObject({ category: 'redirect', kind: 'scout-panel' });
    expect(on('/scout')).toMatchObject({ category: 'redirect', kind: 'sent-to-scout' });
    expect(on('/checkout/success')).toMatchObject({ category: 'redirect', kind: 'still-at-checkout' });
    expect(on('/settings')).toMatchObject({ category: 'redirect', kind: 'elsewhere' });
    expect(classifyPageFailure({ base: BASE, url: 'https://checkout.stripe.com/c/pay/cs_test_1', contactId: ID })).toMatchObject({ category: 'redirect', kind: 'left-the-app' });
  });

  it('on the right page: still loading, not found, or the upgrade screen', () => {
    expect(on('/contact/abc123', { text: 'Loading contact profile...' })).toMatchObject({ category: 'loading failure', kind: 'still-loading' });
    expect(on('/contact/abc123', { text: 'Contact Not Found The contact you are looking for' })).toMatchObject({ category: 'loading failure', kind: 'not-found' });
    expect(on('/contact/abc123', { text: 'This is part of Scout' })).toMatchObject({ category: 'redirect', kind: 'upgrade-screen' });
  });

  it('a Firestore internal assertion is named as the reason a load never finished, and kept as a signal', () => {
    const d = on('/contact/abc123', { text: 'Loading contact profile...', consoleTexts: ['@firebase/firestore: Firestore (12.6.0): INTERNAL ASSERTION FAILED: Unexpected state (ID: ca9)'] });
    expect(d.kind).toBe('still-loading');
    expect(d.reason).toContain('internal assertion');
    expect(d.signals).toContain('firestore-internal-assertion');
  });

  it('rendering errors: the crash screen, or the profile without a button', () => {
    expect(on('/contact/abc123', { text: 'Something went wrong Reloading usually fixes it. Reload' })).toMatchObject({ category: 'rendering error', kind: 'app-crashed' });
    expect(on('/contact/abc123', { text: 'Avery Quinn Executive Director' })).toMatchObject({ category: 'rendering error', kind: 'no-button' });
  });

  it('a selector issue only when an Enrich button is actually in the DOM', () => {
    expect(on('/contact/abc123', { text: 'Avery Quinn', enrichInDom: 1 })).toMatchObject({ category: 'selector issue', kind: 'button-not-matched' });
  });

  it('records the other signals: missing indexes, permission errors, the Barry brief not being served', () => {
    const d = on('/scout', { consoleTexts: ['FirebaseError: The query requires an index.', 'FirebaseError: Missing or insufficient permissions.', 'POST /.netlify/functions/barryOrientationBrief 404'] });
    expect(d.signals).toEqual(['firestore-missing-index', 'firestore-permission-denied', 'barry-brief-not-served']);
  });
});

describe('redact', () => {
  it('masks ID tokens, access and refresh tokens, Stripe keys and webhook secrets; leaves the rest', () => {
    const s = 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1In0.c2ln ya29.a0Af token 1//0gRefresh sk_test_abc rk_live_xyz whsec_123 user abc123';
    const out = redact(s);
    expect(out).toBe('Bearer [redacted] [redacted] token [redacted] [redacted] [redacted] [redacted] user abc123');
  });
});

describe('captureDiagnostics', () => {
  const fakePage = ({ url = `${BASE}/contact/abc123`, text = 'Loading contact profile...', buttons = 0, fail = {} } = {}) => {
    const shots = [];
    return {
      shots,
      url: () => { if (fail.url) throw new Error('closed'); return url; },
      screenshot: async (o) => { if (fail.screenshot) throw new Error('no'); shots.push(o); },
      locator: (sel) => ({
        innerText: async () => { if (fail.text) throw new Error('no body'); return `  ${text}\n\n `; },
        count: async () => (sel.includes('Enrich') ? buttons : 0),
      }),
    };
  };

  it('screenshot next to the report, URL, visible text, the console and HTTP tail, and the cause', async () => {
    const page = fakePage();
    const consoleLog = [{ type: 'error', phase: 'upgrade', text: 'INTERNAL ASSERTION FAILED token eyJa.eyJb.c' }];
    const d = await captureDiagnostics(page, {
      out: '/tmp/idynify-e2e-1.json', stepName: '7. Back on the same person in Scout, with Scout unlocked',
      consoleLog, httpErrors: [{ phase: 'upgrade', status: 404, host: 'localhost:8888', path: '/.netlify/functions/barryOrientationBrief' }],
      base: BASE, contactId: ID, classify: true,
    });
    expect(page.shots[0]).toMatchObject({ path: '/tmp/idynify-e2e-1-7-back-on-the-same-person-in-scout-with-scout-un.png', fullPage: true });
    expect(d).toMatchObject({ url: `${BASE}/contact/abc123`, visibleText: 'Loading contact profile...', enrichInDom: 0 });
    expect(d.diagnosis).toMatchObject({ category: 'loading failure', kind: 'still-loading' });
    expect(d.console[0].text).toBe('INTERNAL ASSERTION FAILED token [redacted]');
    expect(d.httpErrors).toHaveLength(1);
  });

  it('gives no cause for a step that does not expect the contact page, but still the evidence', async () => {
    const d = await captureDiagnostics(fakePage({ url: `${BASE}/contact-hub` }), { out: '/tmp/r.json', stepName: '3. Import', classify: false });
    expect(d.diagnosis).toBeNull();
    expect(d.url).toBe(`${BASE}/contact-hub`);
  });

  it('never throws when the page cannot be read: the step keeps its own error', async () => {
    const d = await captureDiagnostics(fakePage({ fail: { url: true, screenshot: true, text: true } }), { out: '/tmp/r.json', stepName: 'x', classify: true, base: BASE, contactId: ID });
    expect(d).toMatchObject({ url: '', screenshot: null, visibleText: '' });
    expect(d.diagnosis.category).toBe('redirect');
  });
});

describe('step 7 waits for the full contact page only', () => {
  it('accepts /contact/<id> on the app; rejects the Scout panel, other hosts and other ids', () => {
    const re = contactPageUrlPattern(BASE, ID);
    expect(re.test(`${BASE}/contact/abc123`)).toBe(true);
    expect(re.test(`${BASE}/contact/abc123?from=checkout`)).toBe(true);
    expect(re.test(`${BASE}/scout/contact/abc123`)).toBe(false);
    expect(re.test(`${BASE}/contact/abc1234`)).toBe(false);
    expect(re.test('http://elsewhere.test/contact/abc123')).toBe(false);
  });

  it('the journey uses it, and diagnoses steps 7, 7b and 8 against the contact page', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/staging/e2e/freeToScout.mjs'), 'utf8');
    expect(source).toContain('page.waitForURL(contactPageUrlPattern(args.base, contactId)');
    expect(source.match(/\{ contactPage: true \}\);/g)).toHaveLength(3);
    expect(source).toContain("page.on('console'");
    expect(source).toContain("page.on('pageerror'");
    expect(source).toContain('What the browser showed when');
  });
});
