/* global process, WebSocket, fetch, Buffer */
/**
 * "Download card image" on the real My Card page (the fixture's), in real Chrome:
 * pressed with a real mouse event, light and dark, on a computer and at phone size.
 * It checks the file that lands (a PNG, 1080 wide, safely named) or what the
 * share sheet is handed, that "Download contact" still works beside it, and that
 * the renderer made no request of its own. It saves screenshots of the buttons
 * and of the card beside the picture. Every request is intercepted: only the
 * local fixture and the page's font are let through. Synthetic data only.
 *
 *   npx vite --config scripts/visual/my-card/vite.config.mjs        (the fixture server)
 *   ~/.nvm/versions/node/v22.23.4/bin/node scripts/visual/card-image/check-download.mjs <output folder>
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: check-download.mjs <output folder>'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:5199/scripts/visual/my-card/page.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9336;
const PHOTO_HOST = 'images.fixture.test';
const ALLOWED = [/^http:\/\/127\.0\.0\.1:5199\//, /^blob:/, /^data:/, /^https:\/\/fonts\.googleapis\.com\//, /^https:\/\/fonts\.gstatic\.com\//];
const PHOTO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#7c6bd6"/><circle cx="200" cy="158" r="74" fill="#f4d9c6"/><path d="M60 400c0-86 62-146 140-146s140 60 140 146z" fill="#2b2146"/></svg>';
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const profile = mkdtempSync(join(tmpdir(), 'cardimg-dl-'));
const downloads = mkdtempSync(join(tmpdir(), 'cardimg-files-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill('SIGKILL'); } catch { /* gone */ } rmSync(profile, { recursive: true, force: true }); rmSync(downloads, { recursive: true, force: true }); };
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
const photoRequests = [];
const problems = [];
listeners.push(({ method, params }) => {
  if (method === 'Fetch.requestPaused') {
    const { requestId, request } = params;
    if (request.url.startsWith(`https://${PHOTO_HOST}/`)) {
      photoRequests.push(request.url);
      send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/svg+xml' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(PHOTO_SVG).toString('base64') }).catch(() => {});
    } else if (ALLOWED.some((re) => re.test(request.url))) send('Fetch.continueRequest', { requestId }).catch(() => {});
    else { blocked.add(request.url); send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {}); }
  }
  // The page asks before it is left with changes not saved (it should): leaving is what this driver does next.
  if (method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  if (method === 'Runtime.exceptionThrown') problems.push(params.exceptionDetails.text);
});
await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: false });

const checks = [];
const check = (name, pass, detail = '') => { checks.push({ name, pass }); console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? `  [${detail}]` : ''}`); };

async function realClick(label) {
  const box = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await wait(150);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
}
const filesNow = () => readdirSync(downloads).filter((f) => !f.endsWith('.crdownload'));
async function waitForFile(match) {
  for (let i = 0; i < 80; i += 1) { const f = filesNow().find(match); if (f) return f; await wait(150); }
  return null;
}
const png = (buffer) => ({ signature: buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) });

async function scenario({ id, theme, phone, share, steps }) {
  console.log(`  … ${id}`);
  for (const f of filesNow()) rmSync(join(downloads, f));
  await send('Emulation.setDeviceMetricsOverride', phone ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setTouchEmulationEnabled', { enabled: Boolean(phone) });
  // A phone's browser either has a share sheet that takes files (recorded here) or it does not.
  const stub = share
    ? 'window.__shared = []; Object.defineProperty(navigator, "canShare", { configurable: true, value: (d) => Boolean(d && d.files && d.files.length) }); Object.defineProperty(navigator, "share", { configurable: true, value: async (d) => { const f = d.files[0]; const bytes = new Uint8Array(await f.arrayBuffer()); window.__shared.push({ keys: Object.keys(d), name: f.name, type: f.type, size: f.size, head: Array.from(bytes.slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join(""), w: new DataView(bytes.buffer).getUint32(16), h: new DataView(bytes.buffer).getUint32(20), b64: btoa(String.fromCharCode(...bytes.slice(0, 0))) }); window.__sharedBytes = bytes; } });'
    : 'try { delete Navigator.prototype.share; delete Navigator.prototype.canShare; } catch (e) {}';
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: stub });
  console.log('    (script added)');
  await send('Page.navigate', { url: `${BASE}?theme=${theme}&state=existing&do=${encodeURIComponent(phone ? `${steps}|click:Preview` : steps)}&t=${Date.now()}` });
  for (let i = 0; i < 120; i += 1) { if (await evaluate('document.documentElement.dataset.ready === "1"').catch(() => false)) break; await wait(250); }
  console.log('    (ready loop done)');
  await evaluate('document.fonts.ready.then(() => true)');
  console.log('    (fonts ready)');
  await wait(500);
  const problem = await evaluate('document.documentElement.dataset.scriptError ?? ""');
  check(`${id}: the page's scripted steps ran`, problem === '', problem);

  const buttons = await evaluate('[...document.querySelectorAll(".mycard-download button")].map((b) => b.textContent.trim())');
  check(`${id}: Download contact and Download card image sit together`, buttons.join('|') === 'Download contact|Download card image', buttons.join('|'));
  const layout = await evaluate(`(() => { const [a, b] = [...document.querySelectorAll('.mycard-download-actions button')].map((x) => x.getBoundingClientRect()); const s = document.querySelector('.mycard-download').getBoundingClientRect(); return { sameRow: Math.abs(a.top - b.top) < 2, inside: a.left >= s.left && b.right <= s.right + 1, noScroll: document.documentElement.scrollWidth <= window.innerWidth, h: Math.round(b.height) }; })()`);
  check(`${id}: the buttons fit inside their box, no sideways scrolling`, layout.inside && layout.noScroll, JSON.stringify(layout));
  check(`${id}: the button is a comfortable target (44px or more)`, layout.h >= 44, `${layout.h}px`);
  await wait(300);

  const photoBefore = photoRequests.length;
  await realClick('Download card image');
  let result = '';
  let bytes = null;
  if (share) {
    for (let i = 0; i < 80 && !(await evaluate('Boolean(window.__shared && window.__shared.length)')); i += 1) await wait(150);
    const shared = await evaluate('window.__shared && window.__shared[0]');
    check(`${id}: the share sheet is handed one PNG file and nothing else`, Boolean(shared) && shared.keys.join() === 'files' && shared.type === 'image/png' && /_card\.png$/.test(shared.name) && shared.head === '89504e470d0a1a0a' && shared.w === 1080, shared ? `${shared.name} ${shared.w}x${shared.h} ${shared.size}B keys=${shared.keys}` : 'nothing shared');
    check(`${id}: nothing was also downloaded`, filesNow().length === 0);
    if (shared) bytes = Buffer.from(await evaluate('Array.from(window.__sharedBytes)'));
    result = shared?.name ?? '';
  } else {
    const file = await waitForFile((f) => f.endsWith('.png'));
    check(`${id}: a PNG lands in the downloads`, Boolean(file), file ?? 'none');
    if (file) {
      bytes = readFileSync(join(downloads, file));
      const p = png(bytes);
      check(`${id}: it is a real PNG, 1080 wide, named safely`, p.signature && p.width === 1080 && /^[\p{L}\p{N}_]+_card\.png$/u.test(file), `${file} ${p.width}x${p.height} ${(bytes.length / 1024).toFixed(0)} KB`);
      result = file;
    }
  }
  await wait(400);
  const message = await evaluate('(document.querySelector(".mycard-download-feedback") || {}).textContent || ""');
  check(`${id}: the person is told what happened`, /Card image (downloaded|shared)\./.test(message), message);
  check(`${id}: the renderer asked for no photo address (the preview's own picture is the only one)`, photoRequests.length - photoBefore === 0, `${photoRequests.length - photoBefore} new`);
  const status = await evaluate('document.querySelector(".mycard-savestatus")?.textContent ?? ""');
  check(`${id}: downloading did not save the card`, status === 'You have unsaved changes', status);

  // Download contact, still on its own.
  for (const f of filesNow()) rmSync(join(downloads, f));
  await realClick('Download contact');
  const vcf = await waitForFile((f) => f.endsWith('.vcf'));
  check(`${id}: Download contact still works beside it`, Boolean(vcf), vcf ?? 'none');

  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  return { bytes, name: result };
}

async function shoot(file, selector, pad = 12) {
  const box = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height }; })()`);
  await wait(200);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.w + pad * 2, height: box.h + pad * 2, scale: 1 }, captureBeyondViewport: true });
  writeFileSync(join(OUT, file), Buffer.from(shot.data, 'base64'));
}

const UPLOAD = 'upload:photo|click:Use photo|toggle:Email';
for (const [theme, folder] of [['workspace', 'light'], ['mission', 'dark']]) {
  console.log(`\n${folder}, a computer (a download)`);
  const d = await scenario({ id: `${folder}/desktop`, theme, phone: false, share: false, steps: UPLOAD });
  if (d.bytes) writeFileSync(join(OUT, `${folder}-desktop-downloaded.png`), d.bytes);
  await shoot(`${folder}-desktop-card-and-buttons.png`, '.mycard-pane--preview', 8).catch(() => {});

  console.log(`\n${folder}, a phone with a share sheet`);
  const p = await scenario({ id: `${folder}/phone-share`, theme, phone: true, share: true, steps: UPLOAD });
  if (p.bytes) writeFileSync(join(OUT, `${folder}-phone-shared.png`), p.bytes);
  await evaluate('document.querySelector(".mycard-download").scrollIntoView({ block: "center" })');
  await wait(200);
  const shotPhone = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${folder}-phone-buttons.png`), Buffer.from(shotPhone.data, 'base64'));

  console.log(`\n${folder}, a phone without one (a download), the card with a linked photo`);
  const q = await scenario({ id: `${folder}/phone-download`, theme, phone: true, share: false, steps: 'toggle:Email' });
  if (q.bytes) writeFileSync(join(OUT, `${folder}-phone-linked-photo-downloaded.png`), q.bytes);
}

const failed = checks.filter((c) => !c.pass).length;
console.log(`\n${checks.length - failed} passed, ${failed} failed`);
console.log(`requests refused (nothing else was contacted): ${[...blocked].join(', ') || 'none'}`);
console.log(`page errors: ${problems.length ? problems.join(' | ') : 'none'}`);
void existsSync;
socket.close();
cleanup();
process.exit(failed ? 1 : 0);
