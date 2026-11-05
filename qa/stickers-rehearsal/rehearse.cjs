// End-to-end rehearsal of the native Contact Hub (stickers) on local emulators.
// Real UI (People, Contact Profile), real stickersConfig, real firestore.rules,
// Auth emulator sign-ins, synthetic contacts. Project: demo-contact-hub.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const PW = process.env.PW_PATH;
const { chromium, devices } = require(PW);
const { readFileSync, writeFileSync } = require('node:fs');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
initializeApp({ projectId: 'demo-contact-hub' });
const db = getFirestore();

const OUT = process.argv[2];
const RULES = process.argv[3];
const BASE = 'http://localhost:5299/';
const results = [];
const check = (id, name, ok, detail = '') => {
  results.push({ id, name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(6)} ${name}${detail ? `  (${detail})` : ''}`);
};
const step = async (id, name, fn) => {
  try { await fn(); } catch (err) { check(id, name, false, `error: ${String(err.message ?? err).split('\n')[0]}`); }
};

const setMode = (mode) => (mode === null ? db.doc('feature_flags/stickers').delete() : db.doc('feature_flags/stickers').set({ mode }));
const contactOf = async (uid, id) => (await db.doc(`users/${uid}/contacts/${id}`).get()).data();
const contactsOf = async (uid) => (await db.collection(`users/${uid}/contacts`).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const stickersOf = async (uid) => (await db.collection(`users/${uid}/stickers`).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const byName = async (uid, name) => (await stickersOf(uid)).find((s) => s.name === name);
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 200)); } return v; };
const putRules = async (content) => {
  const r = await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-contact-hub:securityRules', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
  });
  if (!r.ok) throw new Error(`rules PUT ${r.status}`);
};
const idToken = async (uid) => {
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${uid}@example.test`, password: 'Staging-QA-2026!', returnSecureToken: true }),
  });
  return (await r.json()).idToken;
};
const askConfig = async (asUid, forUid) => {
  const r = await fetch(`${BASE}.netlify/functions/stickersConfig`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await idToken(asUid)}` }, body: JSON.stringify({ userId: forUid }) });
  return { status: r.status, body: await r.json() };
};

const FIRST_NAME = { 'qa-admin': 'Adele Admin', 'qa-beta': 'Avery Quinn', 'qa-user': 'Uma User', 'qa-other': 'Olive Other' };

async function open(browser, as, { s = 'people', id, phone = false, theme = 'workspace', viewAs, viewAsDelay, query = '' } = {}) {
  const ctx = await browser.newContext(phone ? { ...devices['iPhone 13'] } : { viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((t) => localStorage.setItem('idynify_theme', t), theme);
  const page = await ctx.newPage();
  const errors = [];
  const configCalls = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', async (r) => { if (r.url().includes('/stickersConfig')) configCalls.push(await r.json().catch(() => null)); });
  const params = new URLSearchParams({ as, s });
  if (id) params.set('id', id);
  if (viewAs) params.set('viewAs', viewAs);
  if (viewAsDelay) params.set('viewAsDelay', String(viewAsDelay));
  await page.goto(`${BASE}?${params}${query}`);
  await page.getByTestId('who').waitFor({ timeout: 20000 });
  if (s === 'profile') await page.locator('.idc-tags-section').first().waitFor({ timeout: 20000 });
  else await page.getByText(FIRST_NAME[viewAs && !viewAsDelay ? as : as] ?? 'zzz', { exact: true }).first().waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return { ctx, page, errors, configCalls };
}
const hasPeopleStickers = async (page) => (await page.getByRole('button', { name: /Filter by sticker|Sticker filter:/ }).count()) > 0;
const hasProfileRow = async (page) => (await page.getByTestId('contact-stickers').count()) > 0;
const card = (page, name) => page.locator('div')
  .filter({ has: page.getByText(name, { exact: true }) })
  .filter({ has: page.getByRole('button', { name: 'Engage', exact: true }) }).last();
const listedNames = async (page, names) => {
  const out = [];
  for (const n of names) if (await page.getByText(n, { exact: true }).count()) out.push(n);
  return out;
};

(async () => {
  // Always start from the live rules: a failed lockdown step must never leak into the next run.
  await putRules(readFileSync(RULES, 'utf8'));
  const browser = await chromium.launch();
  const csvNames = readFileSync(process.argv[4], 'utf8').trim().split('\n').slice(1).map((l) => l.split(',').slice(0, 2).join(' '));
  // Pages need a few contacts for admin and user too.
  await db.doc('users/qa-admin/contacts/a01').set({ name: 'Adele Admin', email: 'a1@example.test', is_archived: false, tags: [], addedAt: '2026-10-05T00:00:00Z', barryContext: { summary: 'synthetic' } });
  await db.doc('users/qa-user/contacts/u01').set({ name: 'Uma User', email: 'u1@example.test', is_archived: false, tags: [], addedAt: '2026-10-05T00:00:00Z', barryContext: { summary: 'synthetic' } });
  const seededTags = Object.fromEntries((await contactsOf('qa-beta')).map((c) => [c.id, c.tags]));

  // ── A. Access matrix: every mode × admin / enrolled / plain ────────────────
  const expect = { none: [], off: [], internal: ['qa-admin'], beta: ['qa-admin', 'qa-beta'], on: ['qa-admin', 'qa-beta', 'qa-user'] };
  for (const [label, mode] of [['none', null], ['off', 'off'], ['internal', 'internal'], ['beta', 'beta'], ['on', 'on']]) {
    await setMode(mode);
    for (const who of ['qa-admin', 'qa-beta', 'qa-user']) {
      await step(`A.${label}.${who.slice(3)}`, `mode ${label}: ${who}`, async () => {
        const { ctx, page, configCalls } = await open(browser, who);
        const shows = await hasPeopleStickers(page);
        const want = expect[label].includes(who);
        check(`A.${label}.${who.slice(3)}`, `mode ${label}: ${who} ${want ? 'sees' : 'does not see'} stickers`, shows === want && configCalls[0]?.enabled === want, `ui=${shows} server enabled=${configCalls[0]?.enabled}`);
        await ctx.close();
      });
    }
  }
  await setMode('beta');

  // ── B. Contact Profile (QA-Beta, mode beta) ───────────────────────────────
  await step('B', 'Contact Profile flows', async () => {
    const { ctx, page, errors } = await open(browser, 'qa-beta', { s: 'profile', id: 'c01' });
    check('B1', 'Stickers row sits directly above Tags', (await page.locator('[data-testid="contact-stickers"] + .idc-tags-section').count()) === 1);
    for (const name of ['Board', 'Donor']) {
      await page.getByRole('button', { name: 'Add sticker' }).click();
      await page.getByRole('combobox', { name: 'Add a sticker' }).fill(name);
      await page.getByRole('option', { name: `Create sticker “${name}”` }).click();
      await page.locator('.stk-chip:not([aria-busy])', { hasText: name }).waitFor();
    }
    const c01 = await contactOf('qa-beta', 'c01');
    const stk = await stickersOf('qa-beta');
    check('B2', 'create inline x2: stored as 2 active stickers owned by QA-Beta, both on the contact with assignments',
      stk.length === 2 && stk.every((s) => s.status === 'active' && s.created_by === 'qa-beta') && c01.sticker_ids.length === 2 && Object.keys(c01.sticker_assignments).length === 2,
      `stickers=${stk.length} ids=${c01.sticker_ids.length}`);
    await page.screenshot({ path: `${OUT}/b-profile-desktop.png`, fullPage: false });
    await page.getByRole('button', { name: 'Add sticker' }).click();
    await page.getByRole('combobox').fill('board');
    const reuse = await page.getByRole('option', { name: '“Board” already exists — use it' }).count();
    const create = await page.getByRole('option', { name: /Create sticker/ }).count();
    check('B3', 'typing an existing name in other case never offers a duplicate', reuse === 0 /* already on contact: not offered */ && create === 0, `reuse=${reuse} create=${create}`);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Remove sticker Donor' }).click();
    await page.getByRole('status').getByText('Removed Donor').waitFor();
    const afterRemove = await contactOf('qa-beta', 'c01');
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.locator('.stk-chip:not([aria-busy])', { hasText: 'Donor' }).waitFor();
    const afterUndo = await contactOf('qa-beta', 'c01');
    check('B4', 'remove then Undo: stored list drops it, then has it again', afterRemove.sticker_ids.length === 1 && afterUndo.sticker_ids.length === 2);
    await page.getByRole('button', { name: 'Add sticker' }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.type('Volunteer');
    await page.keyboard.press('Enter');
    await page.locator('.stk-chip:not([aria-busy])', { hasText: 'Volunteer' }).waitFor();
    const focusBack = await page.getByRole('button', { name: 'Add sticker' }).evaluate((el) => el === document.activeElement);
    check('B5', 'keyboard only: open, type, Enter creates and adds; focus returns', focusBack && (await contactOf('qa-beta', 'c01')).sticker_ids.length === 3);
    check('B6', 'tags untouched on the contact', JSON.stringify((await contactOf('qa-beta', 'c01')).tags) === JSON.stringify(seededTags.c01));
    check('B7', 'no page errors (desktop profile)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  });
  await step('B8', 'phone profile', async () => {
    const { ctx, page } = await open(browser, 'qa-beta', { s: 'profile', id: 'c02', phone: true });
    await page.getByRole('button', { name: 'Add sticker' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add a sticker' });
    await sheet.waitFor();
    const box = await sheet.boundingBox();
    await page.screenshot({ path: `${OUT}/b-profile-phone-sheet.png` });
    await sheet.getByRole('option', { name: 'Board' }).click();
    await page.locator('.stk-chip:not([aria-busy])', { hasText: 'Board' }).waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check('B8', 'phone: bottom sheet across the screen; tap adds; no sideways scroll', Math.round(box.width) === 390 && overflow <= 0 && (await contactOf('qa-beta', 'c02')).sticker_ids.length === 1, `sheet=${Math.round(box.width)} overflow=${overflow}`);
    await ctx.close();
  });

  // ── C. People (QA-Beta) ────────────────────────────────────────────────────
  const board = await byName('qa-beta', 'Board');
  const volunteer = await byName('qa-beta', 'Volunteer');
  await step('C', 'People flows', async () => {
    const { ctx, page, errors } = await open(browser, 'qa-beta');
    await page.getByRole('button', { name: /Start Cadence/ }).click();
    const pick = csvNames.slice(0, 25);
    for (const n of pick) await card(page, n).click();
    await page.getByRole('button', { name: 'Add sticker' }).click();
    await page.screenshot({ path: `${OUT}/c-people-bulk-picker.png` });
    await page.getByRole('option', { name: 'Board' }).click();
    const region = page.getByRole('region', { name: 'Sticker results' });
    await region.waitFor({ timeout: 30000 });
    const summary = await region.textContent();
    const withBoard = (await contactsOf('qa-beta')).filter((c) => (c.sticker_ids ?? []).includes(board.id));
    check('C1', 'bulk add to 25: one result line; every selected contact holds it (c01, c02 already had it)', /Board: Added to 23 · 2 already had it/.test(summary) && withBoard.length === 25, `${summary.replace(/Details|Retry/g, '')} | stored=${withBoard.length}`);
    await page.screenshot({ path: `${OUT}/c-people-bulk-summary.png` });
    await page.getByRole('button', { name: 'Close results' }).click();
    await page.getByRole('button', { name: /Selecting/ }).click();
    await page.getByRole('button', { name: 'Filter by sticker' }).click();
    const boardBtn = page.getByRole('group', { name: 'Filter by sticker' }).getByRole('button').filter({ hasText: /^Board\d/ });
    const boardOpt = await boardBtn.textContent();
    const visibleBoard = withBoard.filter((c) => !c.is_archived).length;
    check('C2', 'filter count matches stored non-archived holders', boardOpt.includes(`${visibleBoard} people`), `${boardOpt.trim()} vs ${visibleBoard}`);
    await page.screenshot({ path: `${OUT}/c-people-filter.png` });
    await boardBtn.click();
    await page.waitForTimeout(400);
    const url = new URL(page.url());
    const shown = await listedNames(page, csvNames);
    check('C3', 'choosing Board: ?sticker= set, only holders listed', url.searchParams.get('sticker') === board.id && shown.length === visibleBoard, `listed=${shown.length}`);
    await page.reload();
    await page.getByRole('button', { name: 'Sticker filter: Board' }).waitFor({ timeout: 20000 });
    check('C4', 'reload keeps the filter from the link', (await listedNames(page, csvNames)).length === visibleBoard);
    await page.getByRole('button', { name: 'Clear sticker filter' }).click();
    check('C5', 'clear removes ?sticker=', !new URL(page.url()).searchParams.has('sticker'));
    const search = page.getByPlaceholder(/search/i);
    await search.fill('volunteer');
    await page.waitForTimeout(400);
    // Three synthetic contacts have the title "Volunteer Lead", so they match by title; Avery (c01) matches only by sticker.
    const byTitle = readFileSync(process.argv[4], 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')).filter((r) => /volunteer/i.test(r.slice(4, 6).join(' '))).map((r) => `${r[0]} ${r[1]}`);
    const found = await listedNames(page, csvNames);
    check('C6', 'search by sticker name finds its holder (plus title matches)', found.includes(csvNames[0]) && JSON.stringify([...found].sort()) === JSON.stringify([csvNames[0], ...byTitle].sort()), `found=${found.join('; ')}`);
    await search.fill('');
    // Side panel: add Donor to Jordan Ellis (c02) in the panel; the card updates without reload.
    const jordan = csvNames[1];
    await card(page, jordan).getByRole('button', { name: 'Engage', exact: true }).click();
    const panelRow = page.getByTestId('contact-stickers');
    await panelRow.waitFor({ timeout: 20000 });
    await panelRow.getByRole('button', { name: 'Add sticker' }).click();
    await page.getByRole('option', { name: 'Donor' }).click();
    await page.waitForTimeout(800);
    const cardHasDonor = await card(page, jordan).getByTestId('card-stickers').filter({ hasText: 'Donor' }).count();
    check('C7', 'side panel: sticker added in the profile shows on the People card without reload', cardHasDonor === 1);
    await page.screenshot({ path: `${OUT}/c-people-sidepanel.png` });
    check('C8', 'no page errors (People)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  });
  await step('C9', 'bulk add racing an archive', async () => {
    const { ctx, page } = await open(browser, 'qa-beta');
    await page.getByRole('button', { name: /Start Cadence/ }).click();
    for (const n of csvNames.slice(3, 23)) await card(page, n).click();
    await page.getByRole('button', { name: 'Add sticker' }).click();
    await page.getByRole('option', { name: 'Volunteer' }).click();
    await db.doc(`users/qa-beta/stickers/${volunteer.id}`).update({ status: 'archived', archived_at: Timestamp.now(), updated_at: Timestamp.now() });
    const region = page.getByRole('region', { name: 'Sticker results' });
    await region.waitFor({ timeout: 30000 });
    const text = await region.textContent();
    const holders = (await contactsOf('qa-beta')).filter((c) => (c.sticker_ids ?? []).includes(volunteer.id));
    const consistent = holders.every((c) => c.sticker_assignments?.[volunteer.id]?.assigned_at);
    check('C9', 'archive mid-bulk: every stored add is complete (id + assignment); late ones reported, not half-written', consistent, `${text.replace(/Details|Retry/g, '').trim()} | holders=${holders.length}`);
    await db.doc(`users/qa-beta/stickers/${volunteer.id}`).update({ status: 'active', archived_at: null, updated_at: Timestamp.now() });
    await ctx.close();
  });
  await step('C10', 'phone People', async () => {
    const { ctx, page } = await open(browser, 'qa-beta', { phone: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    await page.getByRole('button', { name: 'Filter by sticker' }).click();
    const heights = await page.getByRole('group', { name: 'Filter by sticker' }).getByRole('button').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    await page.screenshot({ path: `${OUT}/c-people-phone-filter.png` });
    check('C10', 'phone: no sideways scroll; filter options ≥ 44px', overflow <= 0 && heights.every((h) => h >= 44), `overflow=${overflow} heights=${heights.join(',')}`);
    await ctx.close();
  });

  // ── D. Stickers view ───────────────────────────────────────────────────────
  await step('D', 'Stickers view flows', async () => {
    const { ctx, page, errors } = await open(browser, 'qa-beta');
    await page.getByRole('button', { name: /◈ Stickers/ }).click();
    const wall = page.getByTestId('stickers-wall');
    await wall.waitFor();
    const all = await contactsOf('qa-beta');
    const boardCount = all.filter((c) => !c.is_archived && (c.sticker_ids ?? []).includes(board.id)).length;
    check('D1', 'tile counts match stored data', (await wall.getByRole('button', { name: `Board, ${boardCount} people` }).count()) === 1, `board=${boardCount}`);
    await wall.getByRole('button', { name: /New sticker/ }).click();
    let dialog = page.getByRole('dialog', { name: 'New sticker' });
    await dialog.getByLabel('Name').fill('Press');
    await dialog.getByText('Coral').click();
    await dialog.getByLabel(/Emoji/).fill('📰');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await wall.getByRole('button', { name: 'Press, 0 people' }).waitFor();
    const press = await until(() => byName('qa-beta', 'Press'));
    check('D2', 'create from the wall: stored with color and emoji', press?.color === 'coral' && press?.emoji === '📰');
    await wall.getByRole('button', { name: 'Press options' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    dialog = page.getByRole('dialog', { name: 'Edit “Press”' });
    await dialog.getByText('Purple').click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(600);
    check('D3', 'edit color: only the color changes', (await byName('qa-beta', 'Press')).color === 'purple' && (await byName('qa-beta', 'Press')).name === 'Press');
    await page.screenshot({ path: `${OUT}/d-wall-desktop.png` });
    await wall.getByRole('button', { name: 'Board options' }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await page.screenshot({ path: `${OUT}/d-wall-archive-confirm.png` });
    await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
    await wall.getByRole('button', { name: /^Archived \(/ }).waitFor();
    const archived = await byName('qa-beta', 'Board');
    const stillHeld = (await contactsOf('qa-beta')).filter((c) => (c.sticker_ids ?? []).includes(board.id)).length;
    check('D4', 'archive: status archived, never deleted; every membership kept', archived.status === 'archived' && archived.archived_at && stillHeld === 25, `held=${stillHeld}`);
    await wall.getByRole('button', { name: /^Archived \(/ }).click();
    await wall.getByRole('button', { name: 'Restore Board' }).click();
    await wall.getByRole('button', { name: `Board, ${boardCount} people` }).waitFor();
    check('D5', 'restore: active again with every member', (await byName('qa-beta', 'Board')).status === 'active');
    await wall.getByRole('button', { name: `Board, ${boardCount} people` }).click();
    await page.getByRole('button', { name: 'Sticker filter: Board' }).waitFor();
    check('D6', 'tile opens Cards filtered by it', (await page.getByTestId('stickers-wall').count()) === 0);
    check('D7', 'no page errors (Stickers view)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  });
  await step('D8', 'phone wall', async () => {
    const { ctx, page } = await open(browser, 'qa-beta', { phone: true });
    await page.getByRole('button', { name: /◈ Stickers/ }).click();
    await page.getByTestId('stickers-wall').waitFor();
    const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.stk-wall-grid')).gridTemplateColumns.split(' ').length);
    await page.getByTestId('stickers-wall').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/d-wall-phone.png` });
    check('D8', 'phone: two columns', cols === 2, `cols=${cols}`);
    await ctx.close();
  });

  // ── G. Revocation mid-session ──────────────────────────────────────────────
  await step('G1', 'revocation', async () => {
    const { ctx, page } = await open(browser, 'qa-beta', { s: 'profile', id: 'c03' });
    const before = (await contactOf('qa-beta', 'c03')).sticker_ids ?? [];
    await db.doc('sticker_enrollment/qa-beta').delete();
    await page.getByRole('button', { name: 'Add sticker' }).click();
    await page.getByRole('option', { name: 'Press' }).click();
    try {
      await page.getByTestId('contact-stickers').waitFor({ state: 'detached', timeout: 15000 });
      const messageVisible = await page.getByText("Stickers can't be changed right now.").isVisible();
      const after = (await contactOf('qa-beta', 'c03')).sticker_ids ?? [];
      await page.screenshot({ path: `${OUT}/g-revoked.png` });
      check('G1', 'unenrolled mid-session: refused; row disappears; the message stays visible; nothing written', messageVisible && JSON.stringify(before) === JSON.stringify(after), `message visible=${messageVisible}`);
    } finally {
      await db.doc('sticker_enrollment/qa-beta').set({ stage: 'beta' });
      await ctx.close();
    }
  });

  // ── F. View as (impersonation) ─────────────────────────────────────────────
  await step('F1', 'view as', async () => {
    const { ctx, page, configCalls } = await open(browser, 'qa-admin', { viewAs: 'qa-beta' });
    check('F1', 'admin viewing as QA-Beta (session known at mount): no sticker surfaces, server never asked', !(await hasPeopleStickers(page)) && configCalls.length === 0, `calls=${configCalls.length}`);
    await ctx.close();
  });
  await step('F2', 'view as, session arrives late', async () => {
    const { ctx, page, configCalls } = await open(browser, 'qa-admin', { viewAs: 'qa-beta', viewAsDelay: 3000 });
    const before = await hasPeopleStickers(page);
    await page.waitForTimeout(4000);
    const after = await hasPeopleStickers(page);
    check('F2', 'session arriving after the page mounts (reload while viewing as): surfaces end hidden', after === false, `before session=${before} after=${after} config calls=${configCalls.length}`);
    await ctx.close();
  });
  await step('F3', 'server read-only for an impersonating admin', async () => {
    await db.collection('impersonationSessions').add({ adminUserId: 'qa-admin', targetUserId: 'qa-beta', status: 'active', startedAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 30 * 60000) });
    const asAdmin = await askConfig('qa-admin', 'qa-beta');
    const asOther = await askConfig('qa-other', 'qa-beta');
    check('F3', 'stickersConfig: impersonating admin gets readOnly:true; another user gets 403', asAdmin.status === 200 && asAdmin.body.readOnly === true && asOther.status === 403, `admin=${JSON.stringify(asAdmin.body)} other=${asOther.status}`);
  });

  // ── H. Rollback ────────────────────────────────────────────────────────────
  await step('H1', 'mode off', async () => {
    const countBefore = (await stickersOf('qa-beta')).length;
    await setMode('off');
    const { ctx, page } = await open(browser, 'qa-beta');
    const hidden = !(await hasPeopleStickers(page)) && (await page.getByTestId('card-stickers').count()) === 0;
    const listed = (await listedNames(page, csvNames)).length;
    await page.screenshot({ path: `${OUT}/h-mode-off.png` });
    check('H1', 'mode off: every sticker surface gone; contacts still listed; stored stickers intact', hidden && listed === 29 && (await stickersOf('qa-beta')).length === countBefore, `listed=${listed}`);
    await ctx.close();
    await setMode('beta');
    const again = await open(browser, 'qa-beta');
    check('H2', 'mode back to beta: the same stickers come back', await hasPeopleStickers(again.page));
    await again.ctx.close();
  });
  await step('H3', 'lockdown rules', async () => {
    const live = readFileSync(RULES, 'utf8');
    const lockdown = live.replace(/function stickerRulesEnabled\(\) \{\s*return true;\s*\}/, 'function stickerRulesEnabled() {\n      return false;\n    }');
    if (lockdown === live) throw new Error('could not build the lockdown variant');
    await putRules(lockdown);
    let before;
    try {
    const { ctx, page } = await open(browser, 'qa-beta', { s: 'profile', id: 'c04' });
    before = (await contactOf('qa-beta', 'c04')).sticker_ids ?? [];
    await page.getByRole('button', { name: 'Add sticker' }).click();
    await page.getByRole('option', { name: 'Press' }).click();
    await page.getByText("Stickers can't be changed right now.").waitFor({ timeout: 15000 });
    const after = (await contactOf('qa-beta', 'c04')).sticker_ids ?? [];
    // A non-sticker edit through the real UI still works: add a tag.
    await page.getByRole('button', { name: 'Add tag' }).click();
    await page.locator('.idc-tag-input').fill('lockdown-ok');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    const tags = (await contactOf('qa-beta', 'c04')).tags ?? [];
    check('H3', 'lockdown rules: sticker add refused; a tag edit on the same contact still saves', JSON.stringify(before) === JSON.stringify(after) && tags.includes('lockdown-ok'), `tags=${tags.join(',')}`);
    await ctx.close();
    } finally {
      await putRules(live);
    }
    const back = await open(browser, 'qa-beta', { s: 'profile', id: 'c04' });
    await back.page.getByRole('button', { name: 'Add sticker' }).click();
    await back.page.getByRole('option', { name: 'Press' }).click();
    await back.page.locator('.stk-chip:not([aria-busy])', { hasText: 'Press' }).waitFor({ timeout: 15000 });
    check('H4', 'live rules restored: the same add works', ((await contactOf('qa-beta', 'c04')).sticker_ids ?? []).length === before.length + 1);
    await back.ctx.close();
  });

  // ── I. Regression ──────────────────────────────────────────────────────────
  await step('I1', 'tags untouched', async () => {
    const now = await contactsOf('qa-beta');
    const changed = now.filter((c) => c.id !== 'c04' && JSON.stringify(c.tags ?? []) !== JSON.stringify(seededTags[c.id] ?? []));
    check('I1', 'no sticker flow changed any contact’s tags (c04 has the deliberate lockdown tag)', changed.length === 0, `changed=${changed.map((c) => c.id).join(',')}`);
  });
  await step('I2', 'scout mode', async () => {
    const { ctx, page, configCalls } = await open(browser, 'qa-beta', { s: 'scout' });
    await page.waitForTimeout(1500);
    check('I2', 'Scout list (same component, other module): no sticker surfaces, no config call', !(await hasPeopleStickers(page)) && configCalls.length === 0, `calls=${configCalls.length}`);
    await ctx.close();
  });

  await browser.close();
  writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
