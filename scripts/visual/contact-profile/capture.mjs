/* global process, WebSocket, fetch, Buffer */
/**
 * End-to-end check of the working Contact Profile demo (profile.jsx) in real Chrome: light and dark, desktop and phone.
 * It drives the page with real key and pointer events through every flow: viewing, editing and saving identity fields,
 * failure and retry, the photo viewer, adding, replacing and removing a photo, the email, phone and social details,
 * adding and removing stickers with Undo and Retry, switching contact with a save in flight, read-only and
 * stickers-unavailable sessions, and the contacts that stress the layout. It saves screenshots and measures targets,
 * overflow and focus.
 *
 * Every request the page makes is intercepted: the local fixture and the page's font go through, the stand-in photo
 * host is answered here, anything else is refused and listed, so the run provably contacted nothing else.
 *
 *   npx vite --config scripts/visual/contact-profile/vite.config.mjs        (the fixture server, a private port: 5311)
 *   ~/.nvm/versions/node/v22.23.4/bin/node scripts/visual/contact-profile/capture.mjs <output folder>
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: captureEdit.mjs <output folder>'); process.exit(2); }
const BASE = 'http://127.0.0.1:5311/scripts/visual/contact-profile/profile.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = process.argv.includes('--action') ? 9363 : 9362;
const ALLOWED = [/^http:\/\/127\.0\.0\.1:5311\//, /^https:\/\/fonts\.googleapis\.com\//, /^https:\/\/fonts\.gstatic\.com\//];
const PHOTO_HOST = 'images.fixture.test';
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const portrait = (bg1, bg2, shirt) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="200" cy="158" r="74" fill="#f0cdb4"/><path d="M60 400c0-86 62-146 140-146s140 60 140 146z" fill="${shirt}"/><path d="M126 150c0-52 34-84 74-84s74 32 74 84c-18-30-44-44-74-44s-56 14-74 44z" fill="#3a2a24"/></svg>`;
const PORTRAITS = { '/jordan.svg': portrait('#7c6bd6', '#e8a33d', '#2b2146'), '/avery.svg': portrait('#2f7f86', '#c1578a', '#1d3557') };

const profile = mkdtempSync(join(tmpdir(), 'contactprofile-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill('SIGKILL'); } catch { /* gone */ } rmSync(profile, { recursive: true, force: true }); };
process.on('exit', cleanup);

async function pageSocket() {
  for (let i = 0; i < 60; i += 1) {
    try { const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); if (page) return page.webSocketDebuggerUrl; } catch { /* not up */ }
    await wait(250);
  }
  throw new Error('Chrome did not start');
}
const socket = new WebSocket(await pageSocket());
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map();
const listeners = [];
socket.onmessage = (event) => {
  const m = JSON.parse(event.data);
  if (m.id !== undefined) { const { resolve, reject } = pending.get(m.id) ?? {}; pending.delete(m.id); if (m.error) reject?.(new Error(m.error.message)); else resolve?.(m.result); } else for (const l of listeners) l(m);
};
const send = (method, params = {}) => new Promise((resolve, reject) => { nextId += 1; pending.set(nextId, { resolve, reject }); socket.send(JSON.stringify({ id: nextId, method, params })); });
const evaluate = async (expression) => {
  // An element (or anything that is not plain data) comes back as true: callers only ask whether it exists.
  const wrapped = `(async () => { const __v = await (${expression}); return __v instanceof Node ? true : __v; })()`;
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression: wrapped, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
};

const blocked = new Set();
const problems = [];
listeners.push(({ method, params }) => {
  if (method === 'Fetch.requestPaused') {
    const { requestId, request } = params;
    const url = new URL(request.url);
    if (url.hostname === PHOTO_HOST) {
      send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/svg+xml' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(PORTRAITS[url.pathname] ?? portrait('#999', '#666', '#333')).toString('base64') }).catch(() => {});
    } else if (ALLOWED.some((re) => re.test(request.url))) send('Fetch.continueRequest', { requestId }).catch(() => {});
    else { blocked.add(request.url); send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {}); }
  }
  if (method === 'Runtime.exceptionThrown') problems.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
});
await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });



const VIEWPORTS = [
  { id: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false },
  { id: 'phone', width: 390, height: 844, dpr: 2, mobile: true },
];
const THEMES = [['light', 'light'], ['dark', 'dark']];

const KEYS = { Enter: [13, 'Enter', '\r'], Escape: [27, 'Escape'], Backspace: [8, 'Backspace'], Tab: [9, 'Tab'] };
const key = async (name) => {
  const [code, k, text] = KEYS[name];
  await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, text });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  await wait(160);
};
const typeText = async (text) => { for (const ch of text) { await send('Input.dispatchKeyEvent', { type: 'char', text: ch, key: ch }); await wait(20); } await wait(120); };
const centerOf = (expr) => evaluate(`(() => { const e = ${expr}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const click = async (expr) => {
  await wait(60);
  const p = await centerOf(expr);
  if (!p) throw new Error(`nothing to click: ${expr}`);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await wait(260);
};
const byLabel = (label) => `document.querySelector('[aria-label=${JSON.stringify(label)}]')`;
const byText = (text, scope = 'document') => `[...${scope}.querySelectorAll('button, a, [role=option]')].find((e) => e.textContent.trim() === ${JSON.stringify(text)} || e.getAttribute('aria-label') === ${JSON.stringify(text)})`;
const pickerOption = (name) => `[...document.querySelectorAll('.stk-picker [role=option]')].find((e) => e.textContent.includes(${JSON.stringify(name)}))`;
const demoBtn = (text) => `[...document.querySelectorAll('.demo-btn')].find((e) => e.textContent.trim() === ${JSON.stringify(text)})`;
const selectAllActive = () => evaluate('document.activeElement.select && document.activeElement.select()');
const replaceText = async (text) => { await selectAllActive(); await typeText(text); };
const until = async (cond, ms = 9000) => { const end = Date.now() + ms; let v = await evaluate(cond).catch(() => false); while (!v && Date.now() < end) { await wait(150); v = await evaluate(cond).catch(() => false); } return v; };
const shot = async (file) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(file, Buffer.from(data, 'base64'));
};
const writeRows = () => evaluate('window.__writes.map((w) => ({ kind: w.kind, path: w.path, fields: w.fields }))');
const resetWrites = () => evaluate('window.__writes.length = 0');
const active = () => evaluate(`(() => { const e = document.activeElement; return e ? e.tagName.toLowerCase() + ':' + (e.getAttribute('aria-label') || e.id || (e.textContent || '').trim().slice(0, 30)) : null; })()`);
const pills = () => evaluate("[...document.querySelectorAll('.ph-sticker-name')].map((n) => n.textContent + (n.closest('li').getAttribute('aria-busy') === 'true' ? '*' : ''))");
const bodyText = () => evaluate('document.body.innerText');
const holdStickerWrite = () => evaluate(`(() => {
  window.__fixture.stickerWriteGate = new Promise((resolve) => { window.__fixture.finishStickerWrite = resolve; });
})()`);
const settleStickerWrite = () => evaluate(`(() => {
  window.__fixture.finishStickerWrite();
  delete window.__fixture.stickerWriteGate;
})()`);

// What the page reports about itself: overflow, escaping, and whether every header control is big enough to hit.
const MEASURE = `(() => {
  const vw = document.documentElement.clientWidth;
  const card = document.querySelector('.ph-card');
  const box = card.getBoundingClientRect();
  const escapes = [...card.querySelectorAll('*')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && !el.closest('.stk-picker, .ph-photo-panel') && (r.right > box.right + 1 || r.left < box.left - 1); }).length;
  // A control is "big enough" if a press 22px from its centre, each way, still lands on it (the touch area, ::after included).
  const hit = (el) => { el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); const cx = r.x + r.width / 2; const cy = r.y + r.height / 2; return [[cx - 21, cy], [cx + 21, cy], [cx, cy - 21], [cx, cy + 21]].every(([x, y]) => { const t = document.elementFromPoint(x, y); return t && (t === el || el.contains(t)); }); };
  const controls = [...document.querySelectorAll('.ph-edit, .ph-add-field, .ph-photo-edit, .ph-sticker-remove, .ph-add-sticker, .ph-pill, .ph-social')].filter((el) => el.getBoundingClientRect().width > 0);
  const why = (el) => { el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); const cx = r.x + r.width / 2; const cy = r.y + r.height / 2; return [['left', cx - 21, cy], ['right', cx + 21, cy], ['up', cx, cy - 21], ['down', cx, cy + 21]].filter(([, x, y]) => { const t = document.elementFromPoint(x, y); return !(t && (t === el || el.contains(t))); }).map(([side, x, y]) => side + '→' + (document.elementFromPoint(x, y)?.className?.toString().split(' ')[0] || 'none')).join('/'); };
  const small = controls.filter((el) => !hit(el)).map((el) => el.className.split(' ')[0] + ':' + (el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20)) + '[' + why(el) + ']');
  const avatar = document.querySelector('.ph-avatar-btn')?.getBoundingClientRect();
  window.scrollTo(0, 0);
  return { avatarSize: avatar ? Math.round(Math.min(avatar.width, avatar.height)) : null, pageOverflow: document.documentElement.scrollWidth > vw + 1, escapes, controls: controls.length, small, cardHeight: Math.round(box.height) };
})()`;

const checks = [];
const check = (name, pass, detail = '') => { checks.push({ name, pass }); if (!pass) console.log(`  ✗ ${name}${detail ? `  [${detail}]` : ''}`); };
const report = {};
const load = async (query) => {
  await send('Page.navigate', { url: `${BASE}?${query}&t=${Date.now()}` });
  for (let i = 0; i < 120; i += 1) { if (await evaluate('document.documentElement.dataset.ready === "1" && document.querySelectorAll(".ph-card").length === 1').catch(() => false)) break; await wait(250); }
  await evaluate('Promise.all([...document.images].map((i) => i.complete ? 1 : new Promise((r) => { i.onload = r; i.onerror = r; })))');
  await wait(500);
};
const pickContact = async (id) => { await click(demoBtn(id)); await until(`document.querySelector('.demo-btn[aria-pressed="true"]').textContent === ${JSON.stringify(id)}`); await wait(500); };

if (process.argv.includes('--action')) {
  const button = (label) => byText(label, "document.querySelector('.ac')");
  const input = () => byLabel('What would you like to remember or do?');
  const enteredText = async (value) => {
    await click(input());
    await typeText(value);
  };
  const waitForText = (text) => until(`document.querySelector('.ac').innerText.includes(${JSON.stringify(text)})`);
  for (const vp of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile });
    await load('action=1&latency=300');
    check(`${vp.id}: Free defaults to Action Center with local Barry and no Emails`, Boolean(await evaluate(input())) &&
      !(await evaluate(button('Emails'))) && !(await evaluate(button('Open Barry'))));
    check(`${vp.id}: responsive layout has no horizontal overflow`, await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'));
    await enteredText('Bring volunteer sign-up sheets');
    await click(button('Set reminder'));
    await evaluate(`(() => {
      const date = document.querySelector('.ac input[type=date]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(date, '2027-07-10');
      date.dispatchEvent(new Event('input', { bubbles: true }));
      date.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await click(button('Save reminder'));
    check(`${vp.id}: reminder saved with due date and Done`, (await waitForText('Reminder saved.')) && Boolean(await evaluate(button('Done'))));
    await enteredText('Jordan confirmed the event date');
    await click(button('Log update'));
    await click(button('Save update'));
    check(`${vp.id}: logged call appears in Recent Activity`, await waitForText('Jordan confirmed the event date'));
    await enteredText('Prefers to coordinate on Mondays');
    await click(button('Add note'));
    check(`${vp.id}: saved note appears in Recent Activity`, await waitForText('Prefers to coordinate on Mondays'));
    await evaluate(`(() => {
      document.querySelector('.demo-banner').hidden = true;
      document.querySelector('.demo-controls').style.display = 'none';
      document.querySelector('.demo-log').hidden = true;
      window.scrollTo(0, 0);
    })()`);
    const { cssContentSize: { width, height } } = await send('Page.getLayoutMetrics');
    const { data } = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    writeFileSync(join(OUT, `action-center-${vp.id}.png`), Buffer.from(data, 'base64'));
    await evaluate(`(() => {
      document.querySelector('.demo-banner').hidden = false;
      document.querySelector('.demo-controls').style.display = '';
      document.querySelector('.demo-log').hidden = false;
    })()`);
    await click(button('View activity'));
    check(`${vp.id}: the Activity tab shows the same saved history once`, await evaluate(`document.querySelector('.ac [role=tabpanel]').innerText.split('Prefers to coordinate on Mondays').length === 2`));
    await click(button('Action Center'));
    await click(button('Done'));
    check(`${vp.id}: Done clears Up Next and records completion`, (await waitForText('Reminder completed.')) && (await waitForText('No reminder set.')));
    await pickContact('avery');
    check(`${vp.id}: switching contact resets the composer and history`, (await waitForText('Notes and logged interactions will appear here.')) && !(await evaluate(`${input()}.value`)));
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await load('action=1&scout=1');
  await click(button('Emails'));
  check('Scout: Emails shows email history', await waitForText('Shared the volunteer sign-up link.'));
  await click(button('Action Center'));
  await click(button('Open Barry'));
  check('Scout: Barry opens on explicit action', await until(`Boolean(document.querySelector('[aria-label="Barry fixture"]'))`));
  await load('action=1&readonly=1');
  check('Read-only: capture controls and Scout Emails are absent', (await waitForText('This profile is read-only.')) && !(await evaluate(input())) && !(await evaluate(button('Emails'))));
  await click(button('Details'));
  check('Read-only: existing details stay visible and editing controls are absent', await evaluate(`Boolean(document.querySelector('.idc-contact-details')) && !document.querySelector('.idc-add-entry')`));
  await load('action=1&contact=morgan');
  check('Legacy reminder: visible and protected from overwrite', (await waitForText('Send Morgan the community calendar')) &&
    await evaluate(`${button('Set reminder')}?.disabled === true`));
  const failed = checks.filter((entry) => !entry.pass);
  writeFileSync(join(OUT, 'action-center-report.json'), JSON.stringify({ checks, blocked: [...blocked], problems }, null, 2));
  console.log(`${checks.length - failed.length}/${checks.length} Action Center checks passed. ${blocked.size} refused requests. ${problems.length} page errors.`);
  socket.close(); cleanup(); process.exit(failed.length || blocked.size || problems.length ? 1 : 0);
}

for (const [folder, theme] of THEMES) {
  for (const vp of VIEWPORTS) {
    const tag = `${folder}/${vp.id}`;
    const dir = join(OUT, folder, vp.id);
    mkdirSync(dir, { recursive: true });
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile });
    const out = {};

    // ── 1. Viewing a contact ────────────────────────────────────────────────
    await load(`theme=${theme}&latency=300`);
    let m = await evaluate(MEASURE);
    out.viewing = m;
    check(`${tag}: viewing: no sideways scrolling, nothing escapes the card`, !m.pageOverflow && m.escapes === 0, JSON.stringify(m));
    check(`${tag}: viewing: every header control can be hit 44px each way (touch area included)`, m.small.length === 0, m.small.join(', '));
    check(`${tag}: viewing: name is the page heading; photo, edit, sticker and detail controls are there`, (await evaluate("document.querySelector('h1')?.textContent")) === 'Jordan Lee' && (await evaluate(`Boolean(${byLabel('View photo of Jordan Lee')}) && Boolean(${byLabel('Change photo')}) && Boolean(${byLabel('Add sticker')}) && Boolean(${byLabel('Edit name')})`)));
    check(`${tag}: viewing: the email, phone and social details are shown from the existing card`, /jordan@communityslc\.org/.test(await bodyText()) && /\(801\) 555-0199/.test(await bodyText()) && Boolean(await evaluate("document.querySelector('.idc-contact-details a[href*=\"linkedin\"]')")));
    await shot(join(dir, '01-viewing.png'));

    // ── 2. Editing and saving an identity field ─────────────────────────────
    await resetWrites();
    await click(byLabel('Edit title'));
    check(`${tag}: edit title: the box opens focused with the current title`, (await evaluate("document.activeElement.value")) === 'Community Partner');
    await replaceText('Chief of Staff');
    await key('Enter');
    check(`${tag}: edit title: Enter saves once to the contact's own document with only that field, the new title shows, focus returns to Edit title`,
      (await writeRows()).length === 1 && (await writeRows())[0].path === 'users/u1/contacts/jordan' && (await writeRows())[0].fields === 'title' && /Chief of Staff/.test(await bodyText()) && (await active()) === 'button:Edit title', JSON.stringify(await writeRows()));
    await wait(100);
    await shot(join(dir, '02-saving.png'));
    await wait(500);

    // ── 3. A blank name is refused, and Cancel closes it ────────────────────
    await resetWrites();
    await click(byLabel('Edit name'));
    await selectAllActive(); await key('Backspace'); await key('Enter');
    check(`${tag}: blank name: kept open with "Name can't be empty." and nothing written`, /Name can't be empty\./.test(await bodyText()) && (await evaluate("document.activeElement.tagName")) === 'INPUT' && (await writeRows()).length === 0);
    await shot(join(dir, '03-blank-name.png'));
    await click(`document.querySelector('.ph-editor-cancel')`);
    check(`${tag}: blank name: Cancel closes it, the name is unchanged, focus is on Edit name`, (await evaluate("document.querySelector('h1')?.textContent")) === 'Jordan Lee' && (await active()) === 'button:Edit name');

    // ── 4. A failed save, and Try again ─────────────────────────────────────
    await resetWrites();
    await click(demoBtn('next save'));
    await click(byLabel('Edit organization'));
    await replaceText('Will Not Save At First');
    await key('Enter');
    await until(`Boolean(document.querySelector('.ph-editor-msg')) && document.activeElement.tagName === 'INPUT'`);
    check(`${tag}: failed save: the box comes back with the typed text, focused, a clear message, Try again and Cancel`,
      (await evaluate("document.activeElement.value")) === 'Will Not Save At First' && /Couldn't save the organization/.test(await bodyText()) && Boolean(await evaluate(byText('Try again'))) && Boolean(await evaluate(`document.querySelector('.ph-editor-cancel')`)));
    check(`${tag}: failed save: the old organization is back on the page`, !/Will Not Save/.test(await evaluate("document.querySelector('.ph-subtitle')?.innerText ?? ''")));
    await shot(join(dir, '04-failed-save.png'));
    await click(byText('Try again'));
    await until(`!document.querySelector('.ph-input')`);
    check(`${tag}: failed save: Try again writes it again and it sticks`, (await writeRows()).length === 2 && /Will Not Save At First/.test(await evaluate("document.querySelector('.ph-subtitle')?.innerText ?? ''")), JSON.stringify(await writeRows()));
    await wait(700);

    // ── 5. The photo viewer ─────────────────────────────────────────────────
    await click(byLabel('View photo of Jordan Lee'));
    check(`${tag}: photo: the existing viewer opens`, Boolean(await until(`Boolean(document.querySelector('[role=dialog]'))`)));
    await shot(join(dir, '05-photo-viewer.png'));
    await key('Escape');
    await until(`!document.querySelector('[role=dialog]')`);
    check(`${tag}: photo: Escape closes it and focus returns to the photo button`, (await active()) === 'button:View photo of Jordan Lee', await active());

    // ── 6. Replace the photo ────────────────────────────────────────────────
    await resetWrites();
    await click(byLabel('Change photo'));
    check(`${tag}: photo: Change photo opens a panel with the box focused`, Boolean(await evaluate("document.querySelector('.ph-photo-panel')")) && (await evaluate("document.activeElement.type")) === 'url');
    await shot(join(dir, '06-change-photo.png'));
    await typeText('http://images.fixture.test/avery.svg');
    await click(byText('Replace photo'));
    check(`${tag}: photo: a link that is not https is refused with a message, nothing written`, /Use a link that starts with https/.test(await bodyText()) && (await writeRows()).length === 0);
    await shot(join(dir, '07-photo-refused.png'));
    await replaceText('https://images.fixture.test/avery.svg');
    await key('Enter');
    check(`${tag}: photo: a good link is written (photo_url, photo_source) and the panel shows it is saving`, (await writeRows()).length === 1 && (await writeRows())[0].fields === 'photo_url, photo_source', JSON.stringify(await writeRows()));
    await until(`!document.querySelector('.ph-photo-panel')`);
    await evaluate('Promise.all([...document.images].map((i) => i.complete ? 1 : new Promise((r) => { i.onload = r; i.onerror = r; })))');
    check(`${tag}: photo: the panel closes and the new photo shows`, /images\.fixture\.test\/avery\.svg/.test(await evaluate("document.querySelector('.ph-avatar-img')?.src ?? ''")));
    await shot(join(dir, '08-photo-replaced.png'));

    // ── 7. Remove the photo ─────────────────────────────────────────────────
    await resetWrites();
    await click(byLabel('Change photo'));
    await click(byText('Remove photo'));
    check(`${tag}: photo: Remove asks once more and writes nothing yet`, /Remove this photo\?/.test(await bodyText()) && (await writeRows()).length === 0);
    await shot(join(dir, '09-remove-confirm.png'));
    await click(byText('Yes, remove'));
    await until(`!document.querySelector('.ph-photo-panel')`);
    check(`${tag}: photo: removal writes an empty photo_url only and the initials show, with an Add photo control`, (await writeRows())[0]?.fields === 'photo_url' && !(await evaluate("document.querySelector('.ph-avatar-img')")) && Boolean(await evaluate(byLabel('Add photo for Jordan Lee'))));
    await shot(join(dir, '10-photo-removed.png'));
    // …and a photo can be added again from the initials.
    await click(byLabel('Add photo for Jordan Lee'));
    await typeText('https://images.fixture.test/jordan.svg');
    await key('Enter');
    await until(`!document.querySelector('.ph-photo-panel')`);
    check(`${tag}: photo: adding one back works from the initials`, Boolean(await evaluate(byLabel('View photo of Jordan Lee'))));

    // ── 8. Phone, email and social: the existing editors ────────────────────
    await resetWrites();
    await click(`[...document.querySelectorAll('.idc-add-entry')].find((e) => /add email/.test(e.textContent))`);
    await until(`document.activeElement.matches('.idc-entry-input[type=email]')`);
    await typeText('second@communityslc.org');
    await key('Enter');
    await wait(500);
    check(`${tag}: details: the existing email editor saves to the contact's own document`, (await writeRows()).some((w) => /emails/.test(w.fields) && w.path === 'users/u1/contacts/jordan'), JSON.stringify(await writeRows()));
    check(`${tag}: details: the new email shows under Email`, /second@communityslc\.org/.test(await evaluate("document.querySelector('.idc-contact-details')?.innerText ?? ''")));
    await shot(join(dir, '11-details-email.png'));

    // ── 9. Adding a sticker through the picker ──────────────────────────────
    await resetWrites();
    await click(byLabel('Add sticker'));
    await until(`Boolean(document.querySelector('.stk-picker'))`);
    const pk = await evaluate(`(() => { const p = document.querySelector('.stk-picker'); const r = p.getBoundingClientRect(); const add = document.querySelector('.ph-add-sticker'); return { sheet: p.classList.contains('stk-picker--sheet'), parentIsItem: p.parentElement === add.parentElement, inside: r.top >= 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, focused: document.activeElement.getAttribute('role') === 'combobox', rightAligned: Math.abs(r.right - add.getBoundingClientRect().right) < 2 }; })()`);
    out.picker = pk;
    check(`${tag}: picker: opens with focus in its search box and fully inside the screen`, pk.focused && pk.inside, JSON.stringify(pk));
    check(`${tag}: picker: ${vp.mobile ? 'is a bottom sheet' : 'is a popover beside the chip'}`, vp.mobile ? pk.sheet : (!pk.sheet && pk.parentIsItem), JSON.stringify(pk));
    await shot(join(dir, '12-picker.png'));
    await holdStickerWrite();
    await click(pickerOption('Mentor'));
    check(`${tag}: picker: a pick writes once and the pill is pending, then focus is back on Add sticker`, (await writeRows()).filter((w) => w.kind === 'sticker').length === 1 && (await pills()).includes('Mentor*') && (await active()) === 'button:Add sticker', `${JSON.stringify(await pills())} ${await active()}`);
    await settleStickerWrite();
    await until(`!document.querySelector('.ph-sticker[aria-busy="true"]')`);
    check(`${tag}: picker: the sticker is added`, (await pills()).includes('Mentor'));
    await shot(join(dir, '13-sticker-added.png'));

    // ── 10. Remove a sticker, Undo ──────────────────────────────────────────
    await resetWrites();
    await click(byLabel('Remove sticker Community'));
    await until(`/Removed Community/.test(document.body.innerText)`);
    check(`${tag}: sticker: removal shows "Removed Community" with Undo and the pill is gone`, /Removed Community/.test(await bodyText()) && !(await pills()).some((p) => p.startsWith('Community')));
    await shot(join(dir, '14-removed-undo.png'));
    await click(byText('Undo'));
    await until(`[...document.querySelectorAll('.ph-sticker-name')].some((n) => n.textContent === 'Community')`);
    check(`${tag}: sticker: Undo puts it back`, (await pills()).some((p) => p.startsWith('Community')));
    await until(`!document.querySelector('.ph-sticker[aria-busy="true"]')`);

    // ── 11. A failed sticker change, Retry ──────────────────────────────────
    await click(demoBtn('next sticker change'));
    await click(byLabel('Add sticker'));
    await until(`Boolean(document.querySelector('.stk-picker'))`);
    await click(pickerOption('Volunteer'));
    await until(`/Couldn't save/.test(document.body.innerText)`);
    { const t = await bodyText(); const retry = Boolean(await evaluate(byText('Retry'))); const gone = !(await pills()).some((p) => p.startsWith('Volunteer')); check(`${tag}: sticker: a failed add says so with Retry, and no pill is left behind`, /Couldn't save/.test(t) && retry && gone, `text=${/Couldn.t save/.test(t)} retry=${retry} gone=${gone} pills=${JSON.stringify(await pills())}`); }
    await shot(join(dir, '15-sticker-retry.png'));
    await click(byText('Retry'));
    await until(`[...document.querySelectorAll('.ph-sticker-name')].some((n) => n.textContent === 'Volunteer')`);
    check(`${tag}: sticker: Retry adds it`, (await pills()).some((p) => p.startsWith('Volunteer')));
    m = await evaluate(MEASURE);
    check(`${tag}: stickers: after all that, nothing overflows and every control can still be hit`, !m.pageOverflow && m.escapes === 0 && m.small.length === 0, JSON.stringify(m));

    // ── 12. Other contacts ──────────────────────────────────────────────────
    for (const [id, file] of [['avery', '16-no-photo-no-stickers.png'], ['morgan', '17-csv-contact.png'], ['lee', '18-linked-company.png'], ['long', '19-long-values.png']]) {
      await pickContact(id);
      m = await evaluate(MEASURE);
      check(`${tag}: ${id}: no sideways scrolling, nothing escapes, controls can be hit`, !m.pageOverflow && m.escapes === 0 && m.small.length === 0, JSON.stringify(m));
      await shot(join(dir, file));
    }
    await pickContact('morgan');
    await click(byLabel('Edit name'));
    check(`${tag}: csv: the name box opens with "Morgan Ellis"`, (await evaluate("document.activeElement.value")) === 'Morgan Ellis');
    await key('Escape');
    await pickContact('lee');
    check(`${tag}: linked company: no Edit organization control, the name is shown`, !(await evaluate(byLabel('Edit organization'))) && /Initech/.test(await evaluate("document.querySelector('.ph-subtitle')?.innerText ?? ''")));
    await pickContact('avery');
    check(`${tag}: no photo: Add photo control, and Add title/Add organization where empty`, Boolean(await evaluate(byLabel('Add photo for Avery Quinn'))) && Boolean(await evaluate(byLabel('Add organization'))));

    // ── 13. Keep an add pending while leaving and returning to its contact ──
    await load(`theme=${theme}`);
    await resetWrites();
    await holdStickerWrite();
    await click(byLabel('Add sticker'));
    await until(`Boolean(document.querySelector('.stk-picker'))`);
    await click(pickerOption('Donor'));
    await pickContact('avery');
    check(`${tag}: switching: the next contact shows nothing pending`, !(await pills()).some((p) => p.endsWith('*')));
    await pickContact('jordan');
    check(`${tag}: switching: returning shows the original add still pending`, (await pills()).includes('Donor*'));
    await click(byLabel('Add sticker'));
    await until(`Boolean(document.querySelector('.stk-picker'))`);
    check(`${tag}: switching: the pending sticker is disabled in the picker`, await evaluate(`${pickerOption('Donor')}?.getAttribute('aria-disabled') === 'true'`));
    await click(pickerOption('Donor'));
    await settleStickerWrite();
    await until(`!document.querySelector('.ph-sticker[aria-busy="true"]')`);
    const writes = (await writeRows()).filter((w) => w.kind === 'sticker');
    check(`${tag}: switching: the add writes exactly once, to the original contact`, writes.length === 1 && writes[0].path.endsWith('/jordan'), JSON.stringify(writes));
    check(`${tag}: switching: the original contact shows the confirmed sticker`, (await pills()).includes('Donor'));
    await wait(300);

    report[tag] = out;
  }
}

// ── 14. A read-only session and a session with stickers unavailable (once, on desktop, in both themes) ──
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setTouchEmulationEnabled', { enabled: false });
for (const [folder, theme] of THEMES) {
  const dir = join(OUT, folder, 'desktop');
  await load(`theme=${theme}&readonly=1`);
  check(`${folder}: read-only session: no edit, add, change or sticker control at all`, !(await evaluate("document.querySelector('.ph-edit, .ph-add-field, .ph-photo-edit, .ph-add-sticker, .ph-sticker-remove, .ph-stickers')")));
  await click(byLabel('View photo of Jordan Lee'));
  check(`${folder}: read-only session: the photo can still be viewed`, Boolean(await until(`Boolean(document.querySelector('[role=dialog]'))`)));
  await key('Escape');
  await shot(join(dir, '20-read-only.png'));
  await load(`theme=${theme}&stickers=off`);
  check(`${folder}: stickers not available: no sticker area or control, identity editing still there`, !(await evaluate("document.querySelector('.ph-stickers, .ph-add-sticker')")) && Boolean(await evaluate(byLabel('Edit title'))));
  await shot(join(dir, '21-stickers-unavailable.png'));
  await load(`theme=${theme}&stickers=readonly`);
  check(`${folder}: stickers read-only: no sticker area or control`, !(await evaluate("document.querySelector('.ph-stickers, .ph-add-sticker')")));
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
console.log(`requests refused: ${[...blocked].join(', ') || 'none'}`);
console.log(`page errors: ${problems.length ? [...new Set(problems)].join(' | ') : 'none'}`);
socket.close(); cleanup(); process.exit(failed.length ? 1 : 0);
