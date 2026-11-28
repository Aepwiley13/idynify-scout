#!/usr/bin/env node
/**
 * STAGING ONLY: signed-in acceptance run for My Card sharing, with screenshots (desktop and phone
 * size), a recording of Share, Scan, Save, and pass/fail checks. Fictional demo account only.
 *
 *   node scripts/staging/myCardAcceptance.mjs --base=https://my-card-share--idynify-staging.netlify.app --out=<folder>
 * The demo login is read from ~/idynify-staging/mycard-demo.env and never printed. Refuses a base
 * that is not a staging address.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { chromium, devices } from 'playwright';
import { parseEnvFile } from './stagingPreflight.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const base = (arg('base') || '').replace(/\/$/, '');
const out = arg('out');
if (!/^https:\/\/[a-z0-9-]*staging[a-z0-9.-]*\.netlify\.app$/.test(base) || !out) { console.error('Refused: --base must be a staging netlify address, and --out is required.'); process.exit(1); }
mkdirSync(out, { recursive: true });
const login = parseEnvFile(readFileSync(join(homedir(), 'idynify-staging', 'mycard-demo.env'), 'utf8'));
const results = [];
const check = (name, ok, note = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` (${note})` : ''}`); };
const browser = await chromium.launch({ headless: true, channel: 'chrome' });

async function signIn(page) {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').fill(login.MYCARD_DEMO_EMAIL);
  await page.locator('input[type="password"]').fill(login.MYCARD_DEMO_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
}
const open = async (page) => { await page.goto(`${base}/contact-hub/my-card`, { waitUntil: 'domcontentloaded' }); await page.getByText('Your card', { exact: false }).first().waitFor({ timeout: 30000 }).catch(() => {}); };

// ── Desktop ────────────────────────────────────────────────────────────────
const desk = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const dp = await desk.newPage();
await signIn(dp);
check('sign in on staging', true);
await open(dp);
await dp.waitForTimeout(2500);
await dp.screenshot({ path: join(out, '01-desktop-owner-card.png') });
const live = await dp.getByText('Your card is live').first().isVisible().catch(() => false);
check('owner screen shows the card is live', live);
const showQr = dp.getByRole('button', { name: 'Show QR' }).first();
await showQr.click();
await dp.waitForTimeout(1500);
await dp.screenshot({ path: join(out, '02-desktop-qr.png') });
check('full-screen QR opens', await dp.getByText('Point a phone camera at this code.').isVisible().catch(() => false));
const qrSrc = await dp.locator('img[alt*="QR" i]').first().getAttribute('src').catch(() => null);
check('QR code is an image', !!qrSrc);
await dp.keyboard.press('Escape');
await dp.waitForTimeout(500);
if (await dp.getByText('Point a phone camera at this code.').isVisible().catch(() => false)) await dp.getByRole('button', { name: /close|done|back/i }).first().click().catch(() => {});
const link = await dp.getByRole('link', { name: 'View my card' }).first().getAttribute('href').catch(() => null);
check('card link is on the staging address', !!link && link.startsWith(base) && !/idynify\.com/.test(link), link ? new URL(link).origin : 'no link');
await dp.getByRole('button', { name: 'Manage sharing' }).first().click().catch(() => {});
await dp.waitForTimeout(800);
await dp.screenshot({ path: join(out, '03-desktop-manage-sharing.png') });

// ── Public page (no sign-in) ───────────────────────────────────────────────
const anon = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const ap = await anon.newPage();
const pub = link ? await ap.goto(link) : null;
await ap.waitForTimeout(800);
await ap.screenshot({ path: join(out, '04-desktop-public-card.png') });
check('public page opens with no sign-in', pub?.status() === 200);
const html = await ap.content();
check('public page shows only shared fields', /Demo Cardholder/.test(html) && !/users\/|ownerUid|uid/i.test(html));
const vc = link ? await anon.request.get(`${link}/contact.vcf`) : null;
check('Save to Contacts file is a vCard', !!vc && vc.status() === 200 && /BEGIN:VCARD/.test(await vc.text()));

// ── Phone size, recorded: owner -> QR -> scan -> save ──────────────────────
const phone = devices['iPhone 13'];
const mob = await browser.newContext({ ...phone });
let frame = 0;
const snap = async (page, label) => { frame += 1; await page.screenshot({ path: join(out, 'frames', `${String(frame).padStart(2, '0')}-${label}.png`) }); };
mkdirSync(join(out, 'frames'), { recursive: true });
const mp = await mob.newPage();
await signIn(mp);
await open(mp);
await mp.waitForTimeout(2000);
await mp.screenshot({ path: join(out, '05-phone-owner-card.png'), fullPage: false });
await snap(mp, 'owner-card');
await mp.getByRole('button', { name: 'Show QR' }).first().click();
await mp.waitForTimeout(2000);
await mp.screenshot({ path: join(out, '06-phone-qr.png') });
await snap(mp, 'qr');
await mp.keyboard.press('Escape');
const scanner = await browser.newContext({ ...phone });
const sp = await scanner.newPage();
await sp.goto(link);
await sp.waitForTimeout(1200);
await sp.screenshot({ path: join(out, '07-phone-public-card.png') });
await snap(sp, 'scanned-card');
const [download] = await Promise.all([
  sp.waitForEvent('download', { timeout: 15000 }).catch(() => null),
  sp.getByRole('link', { name: /save to contacts/i }).first().click().catch(() => {}),
]);
check('Save to Contacts downloads the contact file', !!download && /\.vcf$/.test(download.suggestedFilename()), download?.suggestedFilename());
await sp.waitForTimeout(800);
await snap(sp, 'saved');
await mob.close(); await scanner.close();

// ── Updates reach the public copy; turning off ends it ─────────────────────
await open(dp);
const title = `Founder ${Date.now() % 10000}`;
await dp.getByRole('button', { name: 'Edit Card' }).first().click();
await dp.getByLabel('Title', { exact: true }).fill(title);
await dp.getByRole('button', { name: /^save/i }).first().click();
await dp.waitForTimeout(3500);
await dp.screenshot({ path: join(out, '08-desktop-edit-saved.png') });
const again = await ap.goto(link);
check('an edit to a live card shows on the same link', again.status() === 200 && (await ap.content()).includes(title), title);
await open(dp);
await dp.locator('summary', { hasText: 'Manage sharing' }).click();
await dp.getByRole('button', { name: 'Turn sharing off' }).first().click();
await dp.waitForTimeout(600);
await dp.screenshot({ path: join(out, '09-desktop-turn-off-confirm.png') });
await dp.getByRole('dialog').getByRole('button', { name: 'Turn sharing off' }).click();
await dp.waitForTimeout(3000);
await dp.screenshot({ path: join(out, '10-desktop-sharing-off.png') });
const off = await ap.goto(link);
check('after turning sharing off the link says it is unavailable', off.status() === 404);
const qrGone = !(await dp.getByRole('button', { name: 'Show QR' }).first().isVisible().catch(() => false));
check('owner screen no longer offers QR or Copy Link while off', qrGone);
// Turn it on again, the same link must work again.
await dp.getByRole('button', { name: 'Turn on sharing' }).first().click();
await dp.getByRole('button', { name: 'Publish my card' }).first().click();
await dp.waitForTimeout(3500);
const back = await ap.goto(link);
check('turning sharing back on restores the SAME link', back.status() === 200);
await browser.close();
console.log(`\n${results.filter((r) => r.ok).length} of ${results.length} checks passed. Files in ${out}`);
process.exit(results.every((r) => r.ok) ? 0 : 2);
