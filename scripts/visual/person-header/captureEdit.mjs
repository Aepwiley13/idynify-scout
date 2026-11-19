/* global process, WebSocket, fetch, Buffer */
/**
 * Screenshots and keyboard/focus checks of the person header's INLINE EDITING (edit.jsx), in real Chrome: the light and
 * the dark theme, at desktop and phone sizes. It drives the page with real key and pointer events.
 *
 * Every request the page makes is intercepted: the local fixture and the page's font go through, anything else is
 * refused and listed, so the run provably contacted nothing else. The fixture holds synthetic contacts only and
 * stand-ins for Firebase (scripts/visual/person-header/editStubs), so nothing can reach a project.
 *
 *   npx vite --config scripts/visual/person-header/vite.edit.config.mjs        (the fixture server, a private port: 5311)
 *   ~/.nvm/versions/node/v22.23.4/bin/node scripts/visual/person-header/captureEdit.mjs <output folder>
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: captureEdit.mjs <output folder>'); process.exit(2); }
const BASE = 'http://127.0.0.1:5311/scripts/visual/person-header/edit.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9361;
const ALLOWED = [/^http:\/\/127\.0\.0\.1:5311\//, /^https:\/\/fonts\.googleapis\.com\//, /^https:\/\/fonts\.gstatic\.com\//];
const PHOTO_HOST = 'images.fixture.test';
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const portrait = (bg1, bg2, shirt) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="200" cy="158" r="74" fill="#f0cdb4"/><path d="M60 400c0-86 62-146 140-146s140 60 140 146z" fill="${shirt}"/><path d="M126 150c0-52 34-84 74-84s74 32 74 84c-18-30-44-44-74-44s-56 14-74 44z" fill="#3a2a24"/></svg>`;
const PORTRAITS = { '/jordan.svg': portrait('#7c6bd6', '#e8a33d', '#2b2146'), '/avery.svg': portrait('#2f7f86', '#c1578a', '#1d3557') };

const profile = mkdtempSync(join(tmpdir(), 'personheader-edit-chrome-'));
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
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
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
const THEMES = [['light', 'workspace'], ['dark', 'mission']];

const KEYS = { Enter: [13, 'Enter', '\r'], Escape: [27, 'Escape'], Backspace: [8, 'Backspace'] };
const key = async (name) => {
  const [code, k, text] = KEYS[name];
  await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, text });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  await wait(140);
};
const typeText = async (text) => { for (const ch of text) { await send('Input.dispatchKeyEvent', { type: 'char', text: ch, key: ch }); await wait(25); } await wait(120); };
const sceneSel = (scene, sel) => `[data-scene="${scene}"] ${sel}`;
const center = (selector) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const click = async (selector) => {
  await wait(60);
  const p = await center(selector);
  if (!p) throw new Error(`nothing to click: ${selector}`);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await wait(220);
};
const selectAll = (scene) => evaluate(`document.querySelector(${JSON.stringify(sceneSel(scene, '[data-edit-input]'))}).select()`);
const clearBox = async (scene) => { await selectAll(scene); await key('Backspace'); };
const replaceText = async (scene, text) => { await selectAll(scene); await typeText(text); };
const shot = async (file, scene) => {
  const rect = await evaluate(`(() => { const e = document.querySelector('[data-scene="${scene}"]'); e.scrollIntoView({ block: 'start' }); const r = e.getBoundingClientRect(); return { x: r.x + window.scrollX - 8, y: r.y + window.scrollY - 8, width: r.width + 16, height: r.height + 16 }; })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...rect, scale: 1 } });
  writeFileSync(file, Buffer.from(data, 'base64'));
};
const writes = () => evaluate('window.__writes.length');

const PROBE = (scene) => `(() => {
  const root = document.querySelector('[data-scene="${scene}"]');
  const card = root.querySelector('.ph-card');
  const box = card.getBoundingClientRect();
  const ae = document.activeElement;
  const describe = (e) => (e ? (e.tagName.toLowerCase() + ':' + (e.getAttribute('aria-label') || e.id || (e.textContent || '').trim().slice(0, 24))) : null);
  const input = root.querySelector('[data-edit-input]');
  const controls = [...root.querySelectorAll('.ph-edit, .ph-add-field, .ph-editor-btn, .ph-input')].map((el) => { const r = el.getBoundingClientRect(); return { cls: el.className.split(' ')[0], w: Math.round(r.width), h: Math.round(r.height) }; });
  const escapes = [...card.querySelectorAll('*')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1); }).length;
  const name = root.querySelector('.ph-name');
  return {
    cardHeight: Math.round(box.height),
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    escapes,
    input: input ? { value: input.value, invalid: input.getAttribute('aria-invalid'), describedby: input.getAttribute('aria-describedby'), focused: ae === input, label: input.getAttribute('aria-label'), fontSize: parseFloat(getComputedStyle(input).fontSize) } : null,
    msg: root.querySelector('.ph-editor-msg')?.textContent ?? null,
    msgId: root.querySelector('.ph-editor-msg')?.id ?? null,
    fieldMsg: root.querySelector('.ph-field-msg')?.textContent ?? null,
    live: root.querySelector('[role=status]')?.textContent ?? null,
    active: describe(ae),
    triggers: [...root.querySelectorAll('[data-edit-trigger]')].map((b) => ({ field: b.dataset.editTrigger, busy: b.getAttribute('aria-busy'), label: b.getAttribute('aria-label') })),
    buttons: [...root.querySelectorAll('button')].map((b) => b.textContent.trim() || b.getAttribute('aria-label')),
    controls,
    name: name ? name.textContent : null,
    subtitle: root.querySelector('.ph-subtitle')?.textContent ?? null,
    nameClipped: name ? name.scrollHeight > name.clientHeight + 1 && getComputedStyle(name).webkitLineClamp === 'none' : false,
  };
})()`;
const probe = (scene) => evaluate(PROBE(scene));
/** Poll until a condition on the probe holds (timers in a headless page are not exact), up to ms. */
const until = async (scene, ok, ms = 8000) => { const end = Date.now() + ms; let p = await probe(scene); while (!ok(p) && Date.now() < end) { await wait(150); p = await probe(scene); } return p; };

const checks = [];
const check = (name, pass, detail = '') => { checks.push({ name, pass }); if (!pass) console.log(`  ✗ ${name}${detail ? `  [${detail}]` : ''}`); };
const report = {};
const load = async (query, vp) => {
  await send('Page.navigate', { url: `${BASE}?${query}&t=${Date.now()}` });
  for (let i = 0; i < 120; i += 1) { if (await evaluate('document.documentElement.dataset.ready === "1" && document.querySelectorAll(".ph-card").length >= 5').catch(() => false)) break; await wait(250); }
  await wait(400);
};

for (const [folder, theme] of THEMES) {
  for (const vp of VIEWPORTS) {
    const tag = `${folder}/${vp.id}`;
    const dir = join(OUT, folder, vp.id);
    mkdirSync(dir, { recursive: true });
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile });
    const out = {};

    // BEFORE: a read-only session draws what the header drew before editing existed.
    await load(`theme=${theme}&readonly=1`, vp);
    const before = {};
    for (const id of ['full', 'long', 'csv', 'sparse', 'linked']) before[id] = await probe(id);
    await shot(join(dir, '00-before-readonly.png'), 'full');
    check(`${tag}: read-only draws no edit control at all`, Object.values(before).every((s) => s.controls.length === 0 && s.triggers.length === 0 && s.live === null));

    // AFTER: the same scenes, editing available.
    await load(`theme=${theme}&latency=3500`, vp);
    const after = {};
    for (const id of ['full', 'long', 'csv', 'sparse', 'linked']) after[id] = await probe(id);
    await shot(join(dir, '01-after-default.png'), 'full');
    out.layoutChange = Object.fromEntries(Object.keys(after).map((id) => [id, after[id].cardHeight - before[id].cardHeight]));
    check(`${tag}: no sideways scrolling`, !after.full.pageOverflow);
    for (const [id, s] of Object.entries(after)) {
      check(`${tag}/${id}: nothing escapes the card`, s.escapes === 0, String(s.escapes));
      check(`${tag}/${id}: every edit control is at least 44px each way`, s.controls.every((c) => c.w >= 44 && c.h >= 44 || (c.cls !== 'ph-edit' && c.h >= 44)), JSON.stringify(s.controls.filter((c) => c.h < 44 || (c.cls === 'ph-edit' && c.w < 44))));
    }
    check(`${tag}: a full contact has Edit name, Edit title and Edit organization`, ['Edit title', 'Edit organization'].every((l) => after.full.triggers.some((t) => t.label === l)) && after.full.buttons.includes('Edit name'));
    check(`${tag}: a linked company has no organization control`, !after.linked.triggers.some((t) => t.field === 'organization') && after.linked.subtitle.includes('Initech'));
    check(`${tag}: a name-only contact is offered Add title and Add organization`, after.sparse.buttons.includes('Add title') && after.sparse.buttons.includes('Add organization'));

    // Editing a name; a blank name; Escape.
    await click(sceneSel('full', '[data-edit-trigger="name"]'));
    let p = await probe('full');
    out.editingName = p;
    check(`${tag}: opening the name box focuses it, with the current name`, p.input?.focused && p.input.value === 'Jordan Lee' && p.input.label === 'Name');
    check(`${tag}: the box text is 16px or larger`, p.input.fontSize >= 16, String(p.input.fontSize));
    await shot(join(dir, '02-editing-name.png'), 'full');
    await clearBox('full');
    await key('Enter');
    p = await probe('full');
    out.blankName = p;
    check(`${tag}: a blank name keeps the box open, focused, invalid, with the message`, p.input?.focused && p.input.invalid === 'true' && p.msg === "Name can't be empty." && p.input.describedby === p.msgId);
    check(`${tag}: a blank name is announced politely and wrote nothing`, p.live === "Name can't be empty." && (await writes()) === 0);
    check(`${tag}: a refused name offers Cancel, not Try again`, p.buttons.includes('Cancel') && !p.buttons.includes('Try again'));
    await shot(join(dir, '03-blank-name.png'), 'full');
    await replaceText('full', 'Jordan Q. Lee');
    await key('Escape');
    p = await probe('full');
    check(`${tag}: Escape cancels, writes nothing, shows the old name and returns focus to Edit name`, p.input === null && p.name === 'Jordan Lee' && p.active === 'button:Edit name' && (await writes()) === 0, `${p.active} / ${p.name}`);

    // Saving a title with Enter: the value shows at once, a quiet saving state, focus on the button.
    await click(sceneSel('full', '[data-edit-trigger="title"]'));
    await replaceText('full', 'Chief of Staff');
    await key('Enter');
    p = await probe('full');
    out.saving = p;
    check(`${tag}: Enter saves once: the new title shows, the button is busy, focus is back on it`, (await writes()) === 1 && p.subtitle.includes('Chief of Staff') && p.triggers.find((t) => t.field === 'title')?.busy === 'true' && p.active === 'button:Edit title', `${p.active} writes=${await writes()}`);
    check(`${tag}: saving is announced`, p.live === 'Saving title…');
    await shot(join(dir, '04-saving.png'), 'full');
    p = await until('full', (q) => q.triggers.find((t) => t.field === 'title')?.busy === null);
    check(`${tag}: when the save lands the busy state clears and the value stays`, p.triggers.find((t) => t.field === 'title')?.busy === null && p.subtitle.includes('Chief of Staff'));

    // Blur saves and does not take focus.
    await click(sceneSel('full', '[data-edit-trigger="organization"]'));
    await replaceText('full', 'Partners Co');
    await click('#elsewhere');
    p = await probe('full');
    check(`${tag}: leaving the box saves it, and focus stays where the person went`, (await writes()) === 2 && p.input === null && p.active === 'button:elsewhere' && p.subtitle.includes('Partners Co'), `${p.active} writes=${await writes()}`);
    await until('full', (q) => q.triggers.every((t) => t.busy === null));

    // Long values.
    await click(sceneSel('long', '[data-edit-trigger="name"]'));
    p = await probe('long');
    out.longName = p;
    check(`${tag}/long: editing a very long name does not overflow or clip`, !p.pageOverflow && p.escapes === 0);
    await shot(join(dir, '05-long-name-editing.png'), 'long');
    await key('Escape');
    await click(sceneSel('long', '[data-edit-trigger="title"]'));
    p = await probe('long');
    check(`${tag}/long: editing a very long title does not overflow`, !p.pageOverflow && p.escapes === 0);
    await shot(join(dir, '06-long-title-editing.png'), 'long');
    await key('Escape');

    // A CSV import is edited by the name it is shown with.
    await click(sceneSel('csv', '[data-edit-trigger="name"]'));
    p = await probe('csv');
    check(`${tag}/csv: the box opens with the display name`, p.input?.value === 'Morgan Ellis', p.input?.value);
    await key('Escape');

    // A failed save: the text comes back, with the message, in a box that has focus.
    await load(`theme=${theme}&latency=900&fail=1`, vp);
    await click(sceneSel('full', '[data-edit-trigger="title"]'));
    await replaceText('full', 'Will Not Save');
    await key('Enter');
    p = await until('full', (q) => q.input !== null && q.msg !== null);
    out.failed = p;
    check(`${tag}: a failed save reopens the box with the text typed, focused, with the message`, p.input?.value === 'Will Not Save' && p.input.focused && p.input.invalid === 'true' && p.msg === "Couldn't save title. Try again.", JSON.stringify({ v: p.input?.value, m: p.msg }));
    check(`${tag}: the line shows the old title again, and Try again and Cancel are offered`, !p.subtitle.includes('Will Not Save') && p.buttons.includes('Try again') && p.buttons.includes('Cancel'));
    check(`${tag}: the failure is announced`, p.live === "Couldn't save title. Try again.");
    await shot(join(dir, '07-failed-save.png'), 'full');
    await click(sceneSel('full', '.ph-editor-btn:last-child'));
    p = await probe('full');
    check(`${tag}: Cancel closes the box and returns focus to Edit title`, p.input === null && p.active === 'button:Edit title', p.active);
    report[tag] = out;
  }
}

console.log(JSON.stringify(report.__layout ?? Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.layoutChange])), null, 1));
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
console.log(`requests refused: ${[...blocked].join(', ') || 'none'}`);
console.log(`page errors: ${problems.length ? [...new Set(problems)].join(' | ') : 'none'}`);
socket.close(); cleanup(); process.exit(failed.length ? 1 : 0);
