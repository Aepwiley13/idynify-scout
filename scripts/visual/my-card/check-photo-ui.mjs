/* global process, WebSocket, fetch, Buffer */
/**
 * Upload photo and the crop dialog, driven in REAL headless Chrome by real
 * input: the mouse for dragging and clicking, the keyboard, touch (a drag and a
 * two-finger pinch on a phone-sized screen), and the browser's own file chooser
 * (intercepted, and answered with a file on disk). The picture is SYNTHETIC
 * (four coloured quadrants), so what the crop kept can be read back by colour.
 * The real MyCardPage, form, crop dialog and photo utility (canvas and JPEG
 * encoder) run; only Firebase, the card service and impersonation are stand-ins.
 * Every request is intercepted: only the local fixture is let through.
 *
 *   npx vite --config scripts/visual/my-card/vite.config.mjs        (the fixture server)
 *   ~/.nvm/versions/node/v22.23.4/bin/node scripts/visual/my-card/check-photo-ui.mjs
 *
 * Exits 1 if any check fails.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://127.0.0.1:5199/scripts/visual/my-card/page.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9335;
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const profile = mkdtempSync(join(tmpdir(), 'photoui-chrome-'));
const scratch = mkdtempSync(join(tmpdir(), 'photoui-files-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', 'about:blank',
], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill('SIGKILL'); } catch { /* gone */ } rmSync(profile, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); };
process.on('exit', cleanup);

async function pageSocket() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
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
  const message = JSON.parse(event.data);
  if (message.id !== undefined) {
    const { resolve, reject } = pending.get(message.id) ?? {};
    pending.delete(message.id);
    if (message.error) reject?.(new Error(message.error.message)); else resolve?.(message.result);
  } else for (const listener of listeners) listener(message);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  nextId += 1;
  pending.set(nextId, { resolve, reject });
  socket.send(JSON.stringify({ id: nextId, method, params }));
});
const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
};

// ── Nothing leaves the page ──────────────────────────────────────────────────
const blocked = new Set();
listeners.push(({ method, params }) => {
  if (method !== 'Fetch.requestPaused') return;
  const { requestId, request } = params;
  if (/^(?:http:\/\/127\.0\.0\.1:5199\/|blob:|data:|https:\/\/fonts\.(?:googleapis|gstatic)\.com\/)/.test(request.url)) send('Fetch.continueRequest', { requestId }).catch(() => {});
  else if (request.url.startsWith('https://images.fixture.test/')) {
    send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/svg+xml' }], body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#888"/></svg>').toString('base64') }).catch(() => {});
  } else { blocked.add(request.url); send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {}); }
});
const problems = [];
listeners.push(({ method, params }) => {
  if (method === 'Runtime.exceptionThrown') problems.push(params.exceptionDetails.text + ' ' + (params.exceptionDetails.exception?.description ?? ''));
});
// The page warns before it is left with unsaved changes (on purpose). Real input makes Chrome honour that, so
// the warning is seen, counted, and accepted (it is the person choosing to leave).
const leavePrompts = [];
listeners.push(({ method, params }) => {
  if (method === 'Page.javascriptDialogOpening') { leavePrompts.push(params.type); send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); }
});
let chooser = null;
listeners.push(({ method, params }) => { if (method === 'Page.fileChooserOpened') chooser = params; });

await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
await send('Page.setInterceptFileChooserDialog', { enabled: true });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: Boolean(pass), detail: String(detail) });
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? `  [${String(detail).slice(0, 160)}]` : ''}`);
};

// ── Helpers ──────────────────────────────────────────────────────────────────
async function open({ theme = 'workspace', width = 1280, height = 900, mobile = false, state = 'existing' } = {}) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
  await send('Page.navigate', { url: `${BASE}?theme=${theme}&state=${state}&t=${Date.now()}` });
  for (let i = 0; i < 100; i += 1) {
    if (await evaluate('document.documentElement.dataset.ready === "1"').catch(() => false)) break;
    await wait(150);
  }
  await evaluate('document.fonts.ready.then(() => true)');
  // Watch for anything that would send a picture away, from here on.
  await evaluate(`(() => {
    window.__sent = [];
    const note = (what) => window.__sent.push(what);
    const f = window.fetch; window.fetch = (...a) => { note('fetch ' + a[0]); return f.apply(window, a); };
    const o = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (...a) { note('xhr ' + a[1]); return o.apply(this, a); };
    if (navigator.sendBeacon) { const b = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = (...a) => { note('beacon ' + a[0]); return b(...a); }; }
    const W = window.WebSocket; window.WebSocket = function (...a) { note('websocket ' + a[0]); return new W(...a); };
  })()`);
}

/** A synthetic picture as a JPEG file on disk: red top-left, green top-right, blue bottom-left, yellow bottom-right. */
async function writeQuadrantFile(name = 'quadrants.jpg', width = 1600, height = 1200, orientation = null) {
  const base64 = await evaluate(`(async () => {
    const c = document.createElement('canvas'); c.width = ${width}; c.height = ${height}; const x = c.getContext('2d');
    [['#ff0000', 0, 0], ['#00ff00', ${width / 2}, 0], ['#0000ff', 0, ${height / 2}], ['#ffff00', ${width / 2}, ${height / 2}]].forEach(([k, px, py]) => { x.fillStyle = k; x.fillRect(px, py, ${width / 2}, ${height / 2}); });
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
    const bytes = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s);
  })()`);
  const bytes = Buffer.from(base64, 'base64');
  const path = join(scratch, name);
  writeFileSync(path, orientation ? withOrientation(bytes, orientation) : bytes);
  return path;
}
/** The JPEG with an EXIF orientation (and a GPS-looking marker) put in after SOI. */
function withOrientation(bytes, orientation) {
  const text = Buffer.from('PRIVATE-GPS-MARKER-4471\0');
  const tiff = Buffer.concat([Buffer.from('II*\0\x08\0\0\0'), Buffer.from([2, 0]), Buffer.from([0x0E, 0x01, 2, 0, text.length, 0, 0, 0, 38, 0, 0, 0]), Buffer.from([0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0]), Buffer.from([0, 0, 0, 0]), text]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const segment = Buffer.concat([Buffer.from([0xFF, 0xE1, (payload.length + 2) >> 8, (payload.length + 2) & 0xFF]), payload]);
  return Buffer.concat([bytes.subarray(0, 2), segment, bytes.subarray(2)]);
}

/** Opens the real file chooser by activating Upload photo with the keyboard or the mouse, and answers it with a file. */
async function chooseFileWith(path, how = 'keyboard') {
  chooser = null;
  if (how === 'keyboard') {
    await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Upload photo').focus()`);
    await keyDown('Enter', 'Enter', 13);
  } else {
    await clickButton('Upload photo');
  }
  for (let i = 0; i < 40 && !chooser; i += 1) await wait(50);
  if (!chooser) throw new Error('the file chooser did not open');
  await send('DOM.setFileInputFiles', { files: [path], backendNodeId: chooser.backendNodeId });
  for (let i = 0; i < 100; i += 1) {
    const state = await evaluate(`(() => { const d = document.querySelector('.mycard-crop'); if (!d) return 'none'; if (d.querySelector('[role="alert"]')) return 'failed'; const u = [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Use photo'); return u && !u.disabled ? 'ready' : 'waiting'; })()`);
    if (state === 'ready' || state === 'failed') return state;
    await wait(100);
  }
  return 'timeout';
}

const rectOf = (selector) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);
const buttonRect = (name) => evaluate(`(() => { const e = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(name)} || b.getAttribute('aria-label') === ${JSON.stringify(name)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
async function clickAt(x, y) { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await wait(120); }
async function clickButton(name) { const r = await buttonRect(name); if (!r) throw new Error(`no button ${name}`); await clickAt(r.cx, r.cy); }
async function dragBy(dx, dy, steps = 8) {
  const r = await rectOf('.mycard-crop-viewport');
  await mouse('mouseMoved', r.cx, r.cy); await mouse('mousePressed', r.cx, r.cy);
  for (let i = 1; i <= steps; i += 1) await mouse('mouseMoved', r.cx + (dx * i) / steps, r.cy + (dy * i) / steps, { buttons: 1 });
  await mouse('mouseReleased', r.cx + dx, r.cy + dy); await wait(150);
}
const keyDown = async (key, code, vk, modifiers = 0) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers, text: key.length === 1 ? key : (key === 'Enter' ? '\r' : undefined) }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers }); await wait(60); };
const touch = (type, points) => send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })) });

/** What the card's photo is now: its size, whether it is a JPEG with no metadata, and the colours near its corners. */
const photoNow = () => evaluate(`(async () => {
  const img = document.querySelector('.mycard-photo-row img');
  if (!img) return null;
  const src = img.getAttribute('src');
  const text = src.startsWith('data:image/jpeg;base64,') ? atob(src.slice(23)) : '';
  const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
  let metadata = false; for (let i = 2; i + 3 < bytes.length && !(bytes[i] === 0xFF && bytes[i + 1] === 0xDA); ) { const m = bytes[i + 1]; if ((m >= 0xE1 && m <= 0xED) || m === 0xFE || m === 0xEF) metadata = true; i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]); }
  const im = new Image(); im.src = src; await im.decode();
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
  const at = (fx, fy) => Array.from(x.getImageData(Math.floor(fx * (c.width - 1)), Math.floor(fy * (c.height - 1)), 1, 1).data);
  const name = ([r, g, b]) => (r > 150 && g < 110 && b < 110 ? 'R' : g > 150 && r < 110 && b < 110 ? 'G' : b > 150 && r < 110 && g < 110 ? 'B' : r > 150 && g > 150 && b < 110 ? 'Y' : '?');
  return { isData: src.startsWith('data:image/jpeg;base64,'), width: c.width, height: c.height, chars: src.length, metadata, hasExif: text.includes('Exif') || text.includes('PRIVATE-GPS-MARKER'),
    corners: [[.15, .15], [.85, .15], [.15, .85], [.85, .85]].map(([fx, fy]) => name(at(fx, fy))).join(''), src };
})()`);
const previewSrc = () => evaluate(`document.querySelector('.mycard-pane--preview article img')?.getAttribute('src') ?? null`);
const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? null`);
const focusedName = () => evaluate(`(() => { const e = document.activeElement; return e ? (e.getAttribute('aria-label') || e.textContent.trim().slice(0, 30) || e.tagName) : null; })()`);
const dialogOpen = () => evaluate(`Boolean(document.querySelector('.mycard-crop'))`);
const sliderValue = () => evaluate(`Number(document.querySelector('.mycard-crop-slider')?.value ?? NaN)`);
const sent = () => evaluate('window.__sent');

// ═══ 1. Desktop: the real file chooser, a real mouse drag, and the keyboard ═══
await open();
check('Upload photo is the first action in the photo section, and the link is not on screen', (await evaluate(`(() => { const b = [...document.querySelectorAll('.mycard-field--photoUrl button:not([role="switch"])')].map((x) => x.textContent.trim()); return b[0] === 'Upload photo' && !document.querySelector('input[type=text][id$="-link"]') ? 'yes' : JSON.stringify(b); })()`)) === 'yes');
const quadrants = await writeQuadrantFile();
check('the keyboard opens the real file chooser (Enter on Upload photo), and the crop dialog opens for the file chosen', (await chooseFileWith(quadrants, 'keyboard')) === 'ready');
check('the dialog is modal, named, and the picture area has focus', (await evaluate(`(() => { const d = document.querySelector('.mycard-crop'); return d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true' && d.getAttribute('aria-labelledby') && document.activeElement === document.querySelector('.mycard-crop-viewport'); })()`)));
const viewport = await rectOf('.mycard-crop-viewport');
check('the picture area is square', Math.abs(viewport.w - viewport.h) < 1.5, `${viewport.w.toFixed(1)} x ${viewport.h.toFixed(1)}`);
const controlSizes = await evaluate(`[...document.querySelectorAll('.mycard-crop button, .mycard-crop input[type=range]')].map((e) => { const r = e.getBoundingClientRect(); return [e.getAttribute('aria-label') || e.textContent.trim(), Math.round(r.width), Math.round(r.height)]; })`);
check('every dialog control is at least 44px to hit', controlSizes.every(([, w, h]) => h >= 44 && (w >= 44 || w === 0)), JSON.stringify(controlSizes));
check('the dialog is inside the screen, scrolls the page behind it no more', (await evaluate(`(() => { const r = document.querySelector('.mycard-crop').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && document.body.style.overflow === 'hidden'; })()`)));

// the real keyboard: + five times is zoom 2.25, arrows move the picture
for (let i = 0; i < 5; i += 1) await keyDown('+', 'Equal', 187, 8);
check('the + key zooms in, a quarter at a time', Math.abs((await sliderValue()) - 2.25) < 0.001, await sliderValue());
await keyDown('0', 'Digit0', 48);
check('0 puts the photo back', (await sliderValue()) === 1);

// a real mouse drag at zoom 3: far enough to leave the crop wholly inside the red quadrant
for (let i = 0; i < 8; i += 1) await keyDown('+', 'Equal', 187, 8);
await dragBy(300, 300);
await clickButton('Use photo');
await wait(700);
check('Use photo closes the dialog', !(await dialogOpen()));
let photo = await photoNow();
check('the photo is a JPEG data URL, square, at most 320 px', photo?.isData && photo.width === photo.height && photo.width <= 320 && photo.width >= 64, JSON.stringify({ w: photo?.width, h: photo?.height, chars: photo?.chars }));
check('a mouse drag moved the crop: zoomed 3x and dragged to the top-left, the photo is all red', photo?.corners === 'RRRR', photo?.corners);
check('the photo is within the 65,536-character cap', photo?.chars <= 65_536, photo?.chars);
check('the photo carries no metadata', photo?.metadata === false && photo?.hasExif === false);
check('the preview shows the same photo, as an unsaved edit', (await previewSrc()) === photo?.src && (await text('.mycard-savestatus')) === 'You have unsaved changes', await text('.mycard-savestatus'));
check('focus is back on Upload photo', (await focusedName()) === 'Upload photo', await focusedName());
check('the picture is not written anywhere as text', !(await evaluate(`(() => { const f = document.querySelector('.mycard-photo-row img').getAttribute('src').slice(300, 360); return [document.body.textContent, ...[...document.querySelectorAll('input')].map((i) => i.value), ...[...document.querySelectorAll('*')].flatMap((n) => [...n.attributes].filter((a) => !(n.tagName === 'IMG' && a.name === 'src')).map((a) => a.value))].some((t) => t.includes(f)); })()`)));

// a second upload replaces it, with no question asked; the keyboard moves the picture
check('a second upload (the mouse opens the chooser this time) works', (await chooseFileWith(quadrants, 'mouse')) === 'ready');
await evaluate(`document.querySelector('.mycard-crop-viewport').focus()`);
for (let i = 0; i < 8; i += 1) await keyDown('+', 'Equal', 187, 8);
for (let i = 0; i < 12; i += 1) await keyDown('ArrowLeft', 'ArrowLeft', 37, 8);
for (let i = 0; i < 12; i += 1) await keyDown('ArrowUp', 'ArrowUp', 38, 8);
await keyDown('Tab', 'Tab', 9);
const afterTab = await focusedName();
await evaluate(`[...document.querySelectorAll('.mycard-crop button')].find((b) => b.textContent.trim() === 'Use photo').focus()`);
await keyDown('Enter', 'Enter', 13);
await wait(700);
photo = await photoNow();
check('the arrow keys moved the picture (left and up: the crop is bottom-right, all yellow), and Enter on Use photo used it', photo?.corners === 'YYYY', `${photo?.corners} (Tab went to ${afterTab})`);

// Escape and Cancel change nothing
const before = await previewSrc();
await chooseFileWith(quadrants, 'keyboard');
await keyDown('Escape', 'Escape', 27);
await wait(150);
check('Escape closes the dialog, changes nothing, and puts focus back on Upload photo', !(await dialogOpen()) && (await previewSrc()) === before && (await focusedName()) === 'Upload photo', await focusedName());
await chooseFileWith(quadrants, 'keyboard');
await dragBy(80, 0);
await clickButton('Cancel');
check('Cancel changes nothing, and the same file can be chosen again straight away', !(await dialogOpen()) && (await previewSrc()) === before && (await chooseFileWith(quadrants, 'keyboard')) === 'ready');
// Tab stays inside
await evaluate(`[...document.querySelectorAll('.mycard-crop button')].find((b) => b.textContent.trim() === 'Use photo').focus()`);
await keyDown('Tab', 'Tab', 9);
check('Tab from the last control goes to the first, not out of the dialog', (await evaluate(`document.querySelector('.mycard-crop').contains(document.activeElement)`)) && (await focusedName()) !== 'Upload photo', await focusedName());
await keyDown('Escape', 'Escape', 27);

// replace, then remove with a confirmation
await clickButton('Remove photo');
check('Remove photo asks first, and says what happens', (await text('.mycard-photo-confirm')).includes('Remove your photo?') && (await focusedName()) === 'Keep my photo', await focusedName());
check('nothing is removed until it is confirmed', (await previewSrc()) === before);
await clickButton('Keep my photo');
await wait(100);
check('Keep my photo puts focus back on Remove photo', (await focusedName()) === 'Remove photo', await focusedName());
await clickButton('Remove photo');
await clickButton('Yes, remove it');
await wait(150);
check('Yes, remove it removes the photo: the card shows initials, and focus is on Upload photo', (await previewSrc()) === null && (await text('.mycard-avatar-initials')) === 'AL' && (await focusedName()) === 'Upload photo', await focusedName());

// Advanced
await clickButton('Advanced');
check('Advanced opens the Photo link box, and the box is empty (the photo is not a link)', (await evaluate(`(() => { const i = document.querySelector('input[id$="-link"]'); return Boolean(i) && i.value === ''; })()`)));
check('nothing was sent anywhere: no fetch, XHR, beacon or WebSocket', JSON.stringify(await sent()) === '[]', JSON.stringify(await sent()));
await open();
check('leaving the page with the photo unsaved is warned about (the leave-page prompt was shown)', leavePrompts.includes('beforeunload'), JSON.stringify(leavePrompts));

// ═══ 2. A file that cannot be used ═══
await open();
const notAPicture = join(scratch, 'broken.jpg');
writeFileSync(notAPicture, Buffer.from('this is not a picture '.repeat(50)));
check('a file that cannot be opened is refused before any cropping, in plain words', (await chooseFileWith(notAPicture, 'keyboard')) === 'failed'
  && (await text('.mycard-crop [role="alert"]')).includes("couldn't open that picture") && !(await rectOf('.mycard-crop-viewport')));
check('and offers Choose another photo, which opens the chooser again', await (async () => { chooser = null; await clickButton('Choose another photo'); for (let i = 0; i < 40 && !chooser; i += 1) await wait(50); return Boolean(chooser) && !(await dialogOpen()); })());

// ═══ 3. EXIF orientation and GPS never reach the card ═══
await open();
const rotated = await writeQuadrantFile('rotated.jpg', 1600, 1200, 6);   // stored landscape, shown rotated a quarter turn clockwise
check('a photo with an orientation and GPS-like EXIF is cropped upright', (await chooseFileWith(rotated, 'keyboard')) === 'ready');
await clickButton('Use photo');
await wait(700);
photo = await photoNow();
// Orientation 6 shows the picture a quarter turn clockwise: blue top-left, red top-right, yellow bottom-left, green bottom-right.
check('orientation 6 is applied: the corners are blue, red, yellow, green', photo?.corners === 'BRYG', photo?.corners);
check('and none of the EXIF, or the marker text, is in the photo', photo?.metadata === false && photo?.hasExif === false);

// ═══ 4. A phone: touch drag, a two-finger pinch, and a sheet that fits ═══
await open({ width: 390, height: 844, mobile: true });
const phoneFile = await writeQuadrantFile('phone.jpg');
check('on a phone the file chooser opens from a tap, and the dialog opens', (await chooseFileWith(phoneFile, 'mouse')) === 'ready');
const sheet = await evaluate(`(() => { const r = document.querySelector('.mycard-crop').getBoundingClientRect(); const u = [...document.querySelectorAll('.mycard-crop button')].find((b) => b.textContent.trim() === 'Use photo').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: innerWidth, h: innerHeight, useBottom: u.bottom, scrollW: document.documentElement.scrollWidth }; })()`);
check('the sheet fits the phone: inside the screen, Use photo on screen, no sideways scrolling', sheet.l >= 0 && sheet.r <= sheet.w && sheet.b <= sheet.h + 1 && sheet.useBottom <= sheet.h && sheet.scrollW <= sheet.w, JSON.stringify(sheet));
const phoneSizes = await evaluate(`[...document.querySelectorAll('.mycard-crop button')].map((e) => { const r = e.getBoundingClientRect(); return [e.getAttribute('aria-label') || e.textContent.trim(), Math.round(r.width), Math.round(r.height)]; })`);
check('every control on the phone is at least 44px to hit', phoneSizes.every(([, w, h]) => w >= 44 && h >= 44), JSON.stringify(phoneSizes));
const pv = await rectOf('.mycard-crop-viewport');
const scrollBefore = await evaluate('document.scrollingElement.scrollTop + (document.querySelector(".mycard")?.scrollTop ?? 0)');
// pinch: two fingers apart, then wider
await touch('touchStart', [{ x: pv.cx - 40, y: pv.cy }, { x: pv.cx + 40, y: pv.cy }]);
for (let i = 1; i <= 8; i += 1) await touch('touchMove', [{ x: pv.cx - 40 - i * 12, y: pv.cy }, { x: pv.cx + 40 + i * 12, y: pv.cy }]);
await touch('touchEnd', []);
await wait(150);
const zoomed = await sliderValue();
check('a two-finger pinch zooms in', zoomed > 2, zoomed);
// one-finger drag toward the top-left of the picture
await touch('touchStart', [{ x: pv.cx, y: pv.cy }]);
for (let i = 1; i <= 8; i += 1) await touch('touchMove', [{ x: pv.cx + i * 25, y: pv.cy + i * 25 }]);
await touch('touchEnd', []);
await wait(150);
const scrollAfter = await evaluate('document.scrollingElement.scrollTop + (document.querySelector(".mycard")?.scrollTop ?? 0)');
check('dragging with a finger moves the picture and does not scroll the page', scrollAfter === scrollBefore, `${scrollBefore} -> ${scrollAfter}`);
await clickButton('Use photo');
await wait(800);
photo = await photoNow();
check('the touch crop is used: a zoomed-in crop of the top-left is red', photo?.corners === 'RRRR' || photo?.corners.split('').filter((c) => c === 'R').length >= 3, photo?.corners);
check('nothing was sent anywhere on the phone either', JSON.stringify(await sent()) === '[]', JSON.stringify(await sent()));

// ═══ 5. Dark theme: the same dialog opens and works ═══
await open({ theme: 'mission', width: 390, height: 844, mobile: true });
check('in the dark theme the dialog opens and a photo can be used', (await chooseFileWith(await writeQuadrantFile('dark.jpg'), 'mouse')) === 'ready' && (await (async () => { await clickButton('Use photo'); await wait(700); return (await photoNow())?.isData; })()));

// ═══ Report ═══
let failed = 0;
for (const r of results) if (!r.pass) failed += 1;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
console.log(`requests refused (nothing else was contacted): ${[...blocked].join(', ') || 'none'}`);
console.log(`page errors: ${problems.length ? problems.join(' | ') : 'none'}`);
socket.close();
cleanup();
process.exit(failed ? 1 : 0);
