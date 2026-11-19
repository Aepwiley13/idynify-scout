/* global process, WebSocket, fetch, Buffer */
/**
 * Screenshots and layout checks of the PersonHeader fixture (page.jsx), in real
 * Chrome: the light and the dark theme, at desktop, tablet and phone sizes.
 *
 * Every request the page makes is intercepted: the local fixture and the page's
 * font go through, the stand-in portraits are answered here, and anything else
 * is refused and listed, so the run provably contacted nothing else.
 *
 *   npx vite --config scripts/visual/my-card/vite.config.mjs        (the fixture server, port 5199)
 *   ~/.nvm/versions/node/v22.23.4/bin/node scripts/visual/person-header/capture.mjs <output folder>
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: capture.mjs <output folder>'); process.exit(2); }
const BASE = 'http://127.0.0.1:5199/scripts/visual/person-header/page.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9340;
const ALLOWED = [/^http:\/\/127\.0\.0\.1:5199\//, /^https:\/\/fonts\.googleapis\.com\//, /^https:\/\/fonts\.gstatic\.com\//];
const PHOTO_HOST = 'images.fixture.test';
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const portrait = (bg1, bg2, shirt) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="200" cy="158" r="74" fill="#f0cdb4"/><path d="M60 400c0-86 62-146 140-146s140 60 140 146z" fill="${shirt}"/><path d="M126 150c0-52 34-84 74-84s74 32 74 84c-18-30-44-44-74-44s-56 14-74 44z" fill="#3a2a24"/></svg>`;
const PORTRAITS = { '/jordan.svg': portrait('#7c6bd6', '#e8a33d', '#2b2146'), '/avery.svg': portrait('#2f7f86', '#c1578a', '#1d3557') };

const profile = mkdtempSync(join(tmpdir(), 'personheader-chrome-'));
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
  { id: 'tablet', width: 820, height: 1180, dpr: 1, mobile: true },
  { id: 'phone', width: 390, height: 844, dpr: 2, mobile: true },
];
const THEMES = [['light', 'workspace'], ['dark', 'mission']];

// What the page reports about itself, per scene: overflow, target sizes, and how it is laid out.
const MEASURE = `(() => {
  const vw = document.documentElement.clientWidth;
  const out = { pageOverflow: document.documentElement.scrollWidth > vw + 1, scenes: {} };
  for (const scene of document.querySelectorAll('[data-scene]')) {
    const id = scene.dataset.scene;
    const card = scene.querySelector('.ph-card');
    const box = card.getBoundingClientRect();
    const over = [...card.querySelectorAll('*')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1); }).map((el) => el.className || el.tagName).slice(0, 3);
    const targets = [...card.querySelectorAll('a')].map((a) => { const r = a.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width) }; });
    const name = card.querySelector('.ph-name');
    const avatar = card.querySelector('.ph-avatar').getBoundingClientRect();
    const identity = card.querySelector('.ph-identity').getBoundingClientRect();
    const sub = card.querySelector('.ph-subtitle');
    const nameBox = name.getBoundingClientRect();
    const stickers = card.querySelector('.ph-stickers');
    const contacts = card.querySelector('.ph-contacts');
    out.scenes[id] = {
      cardWidth: Math.round(box.width), avatar: Math.round(avatar.width), nameSize: parseFloat(getComputedStyle(name).fontSize),
      nameLines: Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight)),
      escapes: over, smallestTarget: targets.length ? Math.min(...targets.map((t) => Math.min(t.h, t.w))) : null, targets: targets.length,
      identityBesideAvatar: identity.left >= avatar.right - 1 && Math.abs(identity.top - avatar.top) < 40,
      contactsBelowIdentity: contacts ? contacts.getBoundingClientRect().top >= identity.bottom - 1 : null,
      stickersRight: stickers ? stickers.getBoundingClientRect().left > identity.right - 2 : null,
      stickersBelow: stickers ? stickers.getBoundingClientRect().top >= Math.max(identity.bottom, contacts ? contacts.getBoundingClientRect().bottom : 0) - 1 : null,
      nameGap: sub ? Math.round((sub.getBoundingClientRect().top - nameBox.bottom) * 10) / 10 : null,
      cardHeight: Math.round(box.height),
      buttons: card.querySelectorAll('button').length,
    };
  }
  return out;
})()`;

const checks = [];
const check = (name, pass, detail = '') => { checks.push({ name, pass }); if (!pass) console.log(`  ✗ ${name}${detail ? `  [${detail}]` : ''}`); };
const report = {};

for (const [folder, theme] of THEMES) {
  for (const vp of VIEWPORTS) {
    const dir = join(OUT, folder, vp.id);
    mkdirSync(dir, { recursive: true });
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile });
    await send('Page.navigate', { url: `${BASE}?theme=${theme}&t=${Date.now()}` });
    for (let i = 0; i < 120; i += 1) { if (await evaluate('document.documentElement.dataset.ready === "1"').catch(() => false)) break; await wait(250); }
    await evaluate('Promise.all([...document.images].map((i) => i.complete ? 1 : new Promise((r) => { i.onload = r; i.onerror = r; })))');
    await wait(400);
    const m = await evaluate(MEASURE);
    report[`${folder}/${vp.id}`] = m;
    const tag = `${folder}/${vp.id}`;
    check(`${tag}: no sideways scrolling`, !m.pageOverflow);
    for (const [id, s] of Object.entries(m.scenes)) {
      check(`${tag}/${id}: nothing escapes the card`, s.escapes.length === 0, s.escapes.join(','));
      check(`${tag}/${id}: every link is at least 44px each way`, s.smallestTarget === null || s.smallestTarget >= 44, String(s.smallestTarget));
      check(`${tag}/${id}: no control without an action (no buttons)`, s.buttons === 0);
      check(`${tag}/${id}: the name stays within three lines`, s.nameLines <= 3, String(s.nameLines));
    }
    const full = m.scenes.full;
    const wantGap = { desktop: 10, tablet: 8, phone: 4 }[vp.id];
    check(`${tag}: the name sits ${wantGap}px above the subtitle`, full.nameGap === wantGap, String(full.nameGap));
    if (vp.id === 'desktop') {
      check(`${tag}: avatar 112px, name 32px, identity beside the photo, stickers on the right`, full.avatar === 112 && full.nameSize === 32 && full.identityBesideAvatar && full.stickersRight === true, JSON.stringify(full));
    } else if (vp.id === 'tablet') {
      check(`${tag}: avatar 96px, identity beside it, contacts under the identity, stickers on a row of their own`, full.avatar === 96 && full.identityBesideAvatar && full.contactsBelowIdentity === true && full.stickersRight === false && full.stickersBelow === true, JSON.stringify(full));
    } else {
      check(`${tag}: avatar beside the name, contacts and stickers below`, full.avatar === 76 && full.identityBesideAvatar && full.contactsBelowIdentity === true && full.stickersBelow === true, JSON.stringify(full));
    }
    // One screenshot per scene.
    const ids = Object.keys(m.scenes);
    for (const id of ids) {
      const box = await evaluate(`(() => { const e = document.querySelector('[data-scene="${id}"]'); const r = e.getBoundingClientRect(); return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height }; })()`);
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 6), width: Math.min(vp.width, box.w + 16), height: box.h + 12, scale: 1 }, captureBeyondViewport: true });
      writeFileSync(join(dir, `${id}.png`), Buffer.from(shot.data, 'base64'));
    }
    // Keyboard focus: Tab to the first link of the first card, and look at the ring.
    if (vp.id !== 'tablet') {
      await evaluate('window.scrollTo(0, 0); document.activeElement && document.activeElement.blur()');
      for (let i = 0; i < 2; i += 1) {
        for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
      }
      const ring = await evaluate(`(() => { const a = document.activeElement; const cs = a && getComputedStyle(a); return a && a.matches('a.ph-pill, a.ph-social') ? { outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle, offset: cs.outlineOffset, name: a.getAttribute('aria-label') } : null; })()`);
      check(`${tag}: a link takes keyboard focus and shows a ring`, Boolean(ring) && ring.outlineStyle !== 'none' && parseFloat(ring.outlineWidth) >= 2, JSON.stringify(ring));
      const fbox = await evaluate(`(() => { const e = document.querySelector('[data-scene="full"]'); const r = e.getBoundingClientRect(); return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height }; })()`);
      const fshot = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, fbox.x - 8), y: Math.max(0, fbox.y - 6), width: Math.min(vp.width, fbox.w + 16), height: fbox.h + 12, scale: 1 }, captureBeyondViewport: true });
      writeFileSync(join(dir, 'full-keyboard-focus.png'), Buffer.from(fshot.data, 'base64'));
    }
    // And the whole page at this size.
    const total = await evaluate('document.documentElement.scrollHeight');
    const full2 = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: vp.width, height: total, scale: 1 }, captureBeyondViewport: true });
    writeFileSync(join(dir, '_all.png'), Buffer.from(full2.data, 'base64'));
    console.log(`  captured ${tag}: ${ids.length} scenes`);
  }
}
writeFileSync(join(OUT, 'measurements.json'), JSON.stringify(report, null, 2));
const failed = checks.filter((c) => !c.pass).length;
console.log(`\n${checks.length - failed} passed, ${failed} failed`);
console.log(`requests refused (nothing else was contacted): ${[...blocked].join(', ') || 'none'}`);
console.log(`page errors: ${problems.length ? [...new Set(problems)].join(' | ') : 'none'}`);
socket.close();
cleanup();
process.exit(failed ? 1 : 0);
