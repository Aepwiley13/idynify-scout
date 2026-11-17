/* global process, WebSocket, fetch */
/**
 * Screenshots of the My Card fixture (scripts/visual/my-card/index.html), in
 * the light and the dark theme, at desktop, tablet and phone sizes.
 *
 * Drives Chrome over its remote-debugging port (needs Node 22, which has a
 * global WebSocket). Every request the page makes is intercepted: the local
 * fixture and Google Fonts (the app's own font) go through, the sample photo is
 * answered here, and anything else is refused and listed at the end, so the
 * run provably contacted nothing else.
 *
 *   ~/.nvm/versions/node/v22.23.4/bin/node scripts/visual/my-card/capture.mjs <output folder>
 *
 * Start the fixture first:
 *   npx vite --config scripts/visual/my-card/vite.config.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2];
// 'editor' (the default): the editor and preview components. 'page': the whole My Card page, with sample data.
const MODE = process.argv[3] ?? 'editor';
if (!OUT || !['editor', 'page'].includes(MODE)) { console.error('usage: capture.mjs <output folder> [editor|page]'); process.exit(2); }
const BASE = `http://127.0.0.1:5199/scripts/visual/my-card/${MODE === 'page' ? 'page.html' : 'index.html'}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const ALLOWED = [/^http:\/\/127\.0\.0\.1:5199\//, /^https:\/\/fonts\.googleapis\.com\//, /^https:\/\/fonts\.gstatic\.com\//];
const PHOTO_HOST = 'images.fixture.test';

// A stand-in portrait: no real person, no real image host.
const PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c6bd6"/><stop offset="1" stop-color="#e8197d"/></linearGradient></defs>
  <rect width="400" height="400" fill="url(#g)"/>
  <circle cx="200" cy="158" r="74" fill="#f4d9c6"/>
  <path d="M60 400c0-86 62-146 140-146s140 60 140 146z" fill="#2b2146"/>
  <path d="M126 150c0-52 34-84 74-84s74 32 74 84c-18-30-44-44-74-44s-56 14-74 44z" fill="#3b2a24"/>
</svg>`;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const profile = mkdtempSync(join(tmpdir(), 'mycard-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--hide-scrollbars',
  '--force-color-profile=srgb', 'about:blank',
], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill('SIGKILL'); } catch { /* already gone */ } rmSync(profile, { recursive: true, force: true }); };
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
    if (message.error) reject?.(new Error(`${message.error.message}`)); else resolve?.(message.result);
  } else {
    for (const listener of listeners) listener(message);
  }
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

const blocked = new Set();
const served = new Set();
listeners.push(({ method, params }) => {
  if (method !== 'Fetch.requestPaused') return;
  const { requestId } = params;
  const { url } = params.request;
  if (url.startsWith(`https://${PHOTO_HOST}/`)) {
    served.add(url);
    send('Fetch.fulfillRequest', {
      requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'image/svg+xml' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
      body: Buffer.from(PHOTO_SVG).toString('base64'),
    }).catch(() => {});
  } else if (ALLOWED.some((pattern) => pattern.test(url))) {
    send('Fetch.continueRequest', { requestId }).catch(() => {});
  } else {
    blocked.add(url);
    send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
  }
});
const consoleProblems = [];
listeners.push(({ method, params }) => {
  if (method === 'Runtime.exceptionThrown') consoleProblems.push(params.exceptionDetails.text + ' ' + (params.exceptionDetails.exception?.description ?? ''));
  if (method === 'Log.entryAdded' && params.entry.level === 'error' && !/BlockedByClient|ERR_BLOCKED/.test(params.entry.text + (params.entry.url ?? ''))) {
    consoleProblems.push(`${params.entry.text} ${params.entry.url ?? ''}`);
  }
});

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });

async function open({ theme, scenario, view, width, height, dpr, mobile, state, steps }) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
  const query = MODE === 'page'
    ? `theme=${theme}&state=${state}${steps ? `&do=${encodeURIComponent(steps)}` : ''}`
    : `theme=${theme}&scenario=${scenario}${view ? `&view=${view}` : ''}`;
  await send('Page.navigate', { url: `${BASE}?${query}&t=${Date.now()}` });
  for (let i = 0; i < 80; i += 1) {
    const ready = await evaluate('document.readyState === "complete" && Boolean(document.querySelector(".mycard"))').catch(() => false);
    if (ready) break;
    await wait(250);
  }
  if (MODE === 'page') {
    // The page's own scripted steps (typing, pressing buttons) have to have finished.
    for (let i = 0; i < 120; i += 1) {
      if (await evaluate('document.documentElement.dataset.ready === "1"').catch(() => false)) break;
      await wait(250);
    }
    const problem = await evaluate('document.documentElement.dataset.scriptError ?? ""');
    if (problem) console.log(`  ! scripted step failed: ${problem}`);
  }
  await evaluate('document.fonts.ready.then(() => true)');
  // Images: the sample photo, or the failure of a broken one, has to have settled.
  await evaluate('Promise.all([...document.images].map((i) => i.complete ? 1 : new Promise((r) => { i.onload = r; i.onerror = r; })))');
  await wait(350);
}

async function press(key, code, keyCode) {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  }
}

/** Press "Change photo link", as a person would. */
async function revealPhotoLink() {
  await evaluate('[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Change photo link").click()');
  await wait(200);
}

const DESKTOP = { width: 1440, height: 900, dpr: 1, mobile: false };
const TABLET = { width: 820, height: 1180, dpr: 1, mobile: true };
const PHONE = { width: 390, height: 844, dpr: 2, mobile: true };
const PHONE_TALL = { width: 390, height: 2400, dpr: 2, mobile: true };

const SHOTS = [
  ['d01-new-card-prefilled', { ...DESKTOP, scenario: 'new' }],
  ['d02-saved-card-default-switches', { ...DESKTOP, scenario: 'full' }],
  ['d03-everything-shared', { ...DESKTOP, scenario: 'shared' }],
  ['d04-validation-messages', { ...DESKTOP, scenario: 'errors' }],
  ['d05-long-text', { ...DESKTOP, scenario: 'long' }],
  ['d06-empty-with-suggestions', { ...DESKTOP, scenario: 'empty' }],
  ['d07-keyboard-focus', { ...DESKTOP, scenario: 'full' }, async () => {
    await press('Tab', 'Tab', 9);
    await evaluate('document.querySelector(\'[role="switch"][aria-label="Email on your card"]\').focus()');
    await wait(100);
  }],
  ['d08-photo-does-not-load', { ...DESKTOP, scenario: 'brokenphoto' }],
  ['d09-accents-and-cjk', { ...DESKTOP, scenario: 'cjk' }],
  ['d10-photo-linkedin-offered', { ...DESKTOP, scenario: 'photooffer' }],
  ['d11-no-photo-nothing-offered', { ...DESKTOP, scenario: 'nophoto' }],
  ['d12-photo-link-revealed', { ...DESKTOP, scenario: 'full' }, revealPhotoLink],
  ['t01-tablet', { ...TABLET, scenario: 'new' }],
  ['p01-phone-edit-top', { ...PHONE, scenario: 'new' }],
  ['p02-phone-edit-scrolled', { ...PHONE, scenario: 'new' }, async () => {
    await evaluate('document.querySelector(".mycard").scrollTop = 620');
    await wait(150);
  }],
  ['p03-phone-edit-full-length', { ...PHONE_TALL, scenario: 'new' }],
  ['p04-phone-preview', { ...PHONE, scenario: 'new', view: 'preview' }],
  ['p05-phone-validation-full-length', { ...PHONE_TALL, scenario: 'errors' }],
  ['p06-phone-empty-suggestions-full-length', { ...PHONE_TALL, scenario: 'empty' }],
  ['p07-phone-long-text-preview', { ...PHONE, scenario: 'long', view: 'preview' }],
  ['p08-phone-cjk-preview', { ...PHONE, scenario: 'cjk', view: 'preview' }],
  ['p09-phone-photo-does-not-load-preview', { ...PHONE, scenario: 'brokenphoto', view: 'preview' }],
  ['p10-phone-photo-linkedin-offered', { ...PHONE, scenario: 'photooffer' }],
  ['p11-phone-no-photo-nothing-offered', { ...PHONE, scenario: 'nophoto' }],
  ['p12-phone-no-photo-preview', { ...PHONE, scenario: 'nophoto', view: 'preview' }],
  ['p13-phone-photo-link-revealed', { ...PHONE, scenario: 'full' }, revealPhotoLink],
];
// The whole My Card page, one state at a time: what a person sees, and what they do next.
const PAGE_SHOTS = [
  ['d01-saved-card', { ...DESKTOP, state: 'existing' }],
  ['d02-new-card-prefilled', { ...DESKTOP, state: 'new' }],
  ['d03-unsaved-changes', { ...DESKTOP, state: 'existing', steps: 'edit:Title=Director of Mathematics' }],
  ['d04-just-saved', { ...DESKTOP, state: 'existing', steps: 'edit:Title=Director of Mathematics,click:Save' }],
  ['d05-fix-before-saving', { ...DESKTOP, state: 'existing', steps: 'edit:Email=ada@,edit:Phone=call me,click:Save' }],
  ['d06-failed-save', { ...DESKTOP, state: 'saveerror', steps: 'edit:Title=Director of Mathematics,click:Save' }],
  ['d07-draft-restored', { ...DESKTOP, state: 'restored' }],
  ['d08-discard-asks-first', { ...DESKTOP, state: 'restored', steps: 'click:Discard changes' }],
  ['d09-newer-version-saved', { ...DESKTOP, state: 'saveconflict', steps: 'edit:Title=Director of Mathematics,click:Save' }],
  ['d10-overwrite-asks-first', { ...DESKTOP, state: 'saveconflict', steps: 'edit:Title=Director of Mathematics,click:Save,click:Save my version over it' }],
  ['d11-load-latest-asks-first', { ...DESKTOP, state: 'saveconflict', steps: 'edit:Title=Director of Mathematics,click:Save,click:Load latest saved version' }],
  ['d12-draft-older-than-saved', { ...DESKTOP, state: 'olddraft' }],
  ['d13-download-left-something-out', { ...DESKTOP, state: 'existing', steps: 'toggle:Email,edit:Email=ada@,click:Download contact' }],
  ['d14-could-not-load', { ...DESKTOP, state: 'loaderror' }],
  ['d15-viewing-as-someone-else', { ...DESKTOP, state: 'impersonating' }],
  ['t01-tablet-newer-version-saved', { ...TABLET, state: 'saveconflict', steps: 'edit:Title=Director of Mathematics,click:Save' }],
  ['p01-phone-saved-card', { ...PHONE, state: 'existing' }],
  ['p02-phone-unsaved-changes', { ...PHONE, state: 'existing', steps: 'edit:Title=Director of Mathematics' }],
  ['p03-phone-fix-before-saving', { ...PHONE, state: 'existing', steps: 'edit:Email=ada@,click:Save' }],
  ['p04-phone-failed-save', { ...PHONE, state: 'saveerror', steps: 'edit:Title=Director of Mathematics,click:Save' }],
  ['p05-phone-draft-restored', { ...PHONE, state: 'restored' }],
  ['p06-phone-newer-version-saved', { ...PHONE, state: 'saveconflict', steps: 'edit:Title=Director of Mathematics,click:Save' }],
  ['p07-phone-overwrite-asks-first', { ...PHONE, state: 'saveconflict', steps: 'edit:Title=Director of Mathematics,click:Save,click:Save my version over it' }],
  ['p08-phone-preview-with-download', { ...PHONE, state: 'existing', steps: 'click:Preview' }],
  ['p09-phone-download-left-something-out', { ...PHONE, state: 'existing', steps: 'toggle:Email,edit:Email=ada@,click:Preview,click:Download contact' }],
  ['p10-phone-could-not-load', { ...PHONE, state: 'loaderror' }],
  ['p11-phone-viewing-as-someone-else', { ...PHONE, state: 'impersonating' }],
];
const SHOT_LIST = MODE === 'page' ? PAGE_SHOTS : SHOTS;
const THEMES = [['light', 'workspace'], ['dark', 'mission']];

const written = [];
try {
  for (const [folder, theme] of THEMES) {
    mkdirSync(join(OUT, folder), { recursive: true });
    for (const [name, options, prepare] of SHOT_LIST) {
      await open({ ...options, theme });
      await prepare?.();
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(join(OUT, folder, `${name}.png`), Buffer.from(data, 'base64'));
      written.push(`${folder}/${name}.png`);
      console.log(`  ✓ ${folder}/${name}.png`);
    }
  }
} finally {
  // A page to look at them on, light beside dark.
  const rows = SHOT_LIST.map(([name]) => `<section><h2>${name}</h2><div class="pair"><figure><figcaption>Light</figcaption><img src="light/${name}.png" loading="lazy"></figure><figure><figcaption>Dark</figcaption><img src="dark/${name}.png" loading="lazy"></figure></div></section>`).join('\n');
  writeFileSync(join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>My Card: visual review</title>
<style>body{font:15px/1.4 -apple-system,system-ui,sans-serif;margin:24px;background:#f2f2f4;color:#111}h1{margin:0 0 4px}h2{margin:28px 0 8px;font-size:16px}.pair{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}figure{margin:0}figcaption{font-weight:600;margin-bottom:4px}img{max-width:min(46vw,720px);border:1px solid #bbb;border-radius:6px;background:#fff}</style>
<h1>My Card: visual review (${MODE === 'page' ? '4B-4, the whole page' : '4A, refinement pass'})</h1><p>Sample data. Light is the Workspace theme, dark is the Mission theme.</p>\n${rows}`);
  const lines = [
    `screenshots: ${written.length}`,
    `photo served locally: ${[...served].join(', ') || 'none'}`,
    `requests refused (nothing else was contacted): ${[...blocked].join(', ') || 'none'}`,
    `page errors: ${consoleProblems.length ? consoleProblems.join(' | ') : 'none'}`,
  ];
  console.log(lines.join('\n'));
  writeFileSync(join(OUT, 'capture-report.txt'), `${lines.join('\n')}\n`);
  socket.close();
  cleanup();
}
process.exit(0);
