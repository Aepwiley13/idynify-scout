/* global process, WebSocket, fetch */
/**
 * Runs the profile photo processing checks (page.jsx) in headless Chrome and
 * prints each result. Every request the page makes is intercepted: only the
 * local fixture is let through, anything else is refused and listed, so the
 * run provably contacted nothing else. Synthetic pictures only.
 *
 *   npx vite --config scripts/visual/my-card/vite.config.mjs        (the fixture server)
 *   ~/.nvm/versions/node/v22.23.4/bin/node scripts/visual/photo-prep/check.mjs
 *
 * Needs Node 22 (a global WebSocket) and Chrome at the usual macOS path.
 * Exits 1 if any check fails.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_UNDER_TEST = 'http://127.0.0.1:5199/scripts/visual/photo-prep/page.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const profile = mkdtempSync(join(tmpdir(), 'photoprep-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', 'about:blank',
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

const blocked = new Set();
listeners.push(({ method, params }) => {
  if (method !== 'Fetch.requestPaused') return;
  const { requestId, request } = params;
  if (request.url.startsWith('http://127.0.0.1:5199/') || request.url.startsWith('blob:') || request.url.startsWith('data:')) {
    send('Fetch.continueRequest', { requestId }).catch(() => {});
  } else {
    blocked.add(request.url);
    send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
  }
});
const problems = [];
listeners.push(({ method, params }) => {
  if (method === 'Runtime.exceptionThrown') problems.push(params.exceptionDetails.text);
});

await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
await send('Page.navigate', { url: `${URL_UNDER_TEST}?t=${Date.now()}` });

let ready = false;
for (let i = 0; i < 240 && !ready; i += 1) {
  ready = await evaluate('document.documentElement.dataset.ready === "1"').catch(() => false);
  if (!ready) await wait(500);
}
if (!ready) { console.error('the checks did not finish'); process.exit(2); }

const results = await evaluate('window.__photoResults');
const userAgent = await evaluate('navigator.userAgent');
let failed = 0;
for (const r of results) {
  if (!r.pass) failed += 1;
  console.log(`  ${r.pass ? '✓' : '✗'} ${r.name}${r.detail ? `  [${r.detail}]` : ''}`);
}
console.log(`\n${results.length - failed} passed, ${failed} failed`);
console.log(`browser: ${userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? userAgent}`);
console.log(`requests refused (nothing else was contacted): ${[...blocked].join(', ') || 'none'}`);
console.log(`page errors: ${problems.length ? problems.join(' | ') : 'none'}`);
socket.close();
cleanup();
process.exit(failed ? 1 : 0);
