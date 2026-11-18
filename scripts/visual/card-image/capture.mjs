/* global process, WebSocket, fetch, Buffer */
/**
 * Renders the card image in real Chrome, in the light and the dark theme, and
 * saves each PNG plus a screenshot of every scene beside the live preview.
 * Every request the page makes is intercepted: the local fixture and the page's
 * own font are let through, anything else is refused and listed, so the run
 * provably contacted nothing else. Synthetic data only.
 *
 *   npx vite --config scripts/visual/my-card/vite.config.mjs        (the fixture server)
 *   ~/.nvm/versions/node/v22.23.4/bin/node scripts/visual/card-image/capture.mjs <output folder>
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: capture.mjs <output folder>'); process.exit(2); }
const BASE = 'http://127.0.0.1:5199/scripts/visual/card-image/page.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9335;
const ALLOWED = [/^http:\/\/127\.0\.0\.1:5199\//, /^blob:/, /^data:/, /^https:\/\/fonts\.googleapis\.com\//, /^https:\/\/fonts\.gstatic\.com\//];
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const profile = mkdtempSync(join(tmpdir(), 'cardimage-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill('SIGKILL'); } catch { /* gone */ } rmSync(profile, { recursive: true, force: true }); };
process.on('exit', cleanup);

async function pageSocket() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page');
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
    if (ALLOWED.some((re) => re.test(request.url))) send('Fetch.continueRequest', { requestId }).catch(() => {});
    else { blocked.add(request.url); send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {}); }
  }
  if (method === 'Runtime.exceptionThrown') problems.push(params.exceptionDetails.text);
});
await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });

let failed = 0;
for (const [folder, theme] of [['light', 'workspace'], ['dark', 'mission']]) {
  mkdirSync(join(OUT, folder), { recursive: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1200, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${BASE}?theme=${theme}&t=${Date.now()}` });
  let ready = false;
  for (let i = 0; i < 120 && !ready; i += 1) { ready = await evaluate('document.documentElement.dataset.ready === "1"').catch(() => false); if (!ready) await wait(500); }
  if (!ready) { console.error(`${theme}: the page did not finish`); failed += 1; continue; }
  await wait(500);
  const images = await evaluate('window.__images');
  for (const image of images) {
    if (image.error) { console.log(`  ✗ ${folder}/${image.id}: ${image.error}`); failed += 1; continue; }
    const png = Buffer.from(image.dataUrl.split(',')[1], 'base64');
    const signature = png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const ok = signature && width === 1080 && height === image.height;
    if (!ok) failed += 1;
    writeFileSync(join(OUT, folder, `${image.id}.png`), png);
    console.log(`  ${ok ? '✓' : '✗'} ${folder}/${image.id}.png  ${width}×${height}  ${(png.length / 1024).toFixed(0)} KB  ${image.fileName}${image.usedPhoto ? '  (photo)' : ''}`);
    const box = await evaluate(`(() => { const r = document.querySelector('[data-scene="${image.id}"]').getBoundingClientRect(); return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height }; })()`);
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: 900, height: box.h + 16, scale: 1 }, captureBeyondViewport: true });
    writeFileSync(join(OUT, folder, `compare-${image.id}.png`), Buffer.from(shot.data, 'base64'));
  }
}
console.log(`\nrequests refused (nothing else was contacted): ${[...blocked].join(', ') || 'none'}`);
console.log(`page errors: ${problems.length ? problems.join(' | ') : 'none'}`);
socket.close();
cleanup();
process.exit(failed ? 1 : 0);
