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
mkdirSync(OUT, { recursive: true });
const mergeReview = process.argv.includes('--merge');
const duplicateReview = process.argv.includes('--duplicates') || mergeReview;
const workspaceReview = process.argv.includes('--workspace');
const gmailReview = process.argv.includes('--gmail');
const origin = `http://127.0.0.1:${process.env.CONTACT_HUB_FIXTURE_PORT || (duplicateReview ? 5317 : gmailReview ? 5312 : 5311)}`;
const BASE = `${origin}/scripts/visual/contact-profile/profile.html`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const defaultDebugPort = duplicateReview ? 9371 : workspaceReview ? 9365 : gmailReview ? 9364 : process.argv.includes('--action') ? 9363 : 9362;
const PORT = Number(process.env.CONTACT_HUB_CHROME_PORT || defaultDebugPort);
const FONT_HOSTS = [/^https:\/\/fonts\.googleapis\.com\//, /^https:\/\/fonts\.gstatic\.com\//];
const PHOTO_HOST = 'images.fixture.test';
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const portrait = (bg1, bg2, shirt) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="200" cy="158" r="74" fill="#f0cdb4"/><path d="M60 400c0-86 62-146 140-146s140 60 140 146z" fill="${shirt}"/><path d="M126 150c0-52 34-84 74-84s74 32 74 84c-18-30-44-44-74-44s-56 14-74 44z" fill="#3a2a24"/></svg>`;
const PORTRAITS = { '/jordan.svg': portrait('#7c6bd6', '#e8a33d', '#2b2146'), '/avery.svg': portrait('#2f7f86', '#c1578a', '#1d3557') };

const profile = mkdtempSync(join(tmpdir(), 'contactprofile-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => {
  try { chrome.kill('SIGKILL'); } catch { /* gone */ }
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Chrome may still be flushing its disposable profile. */ }
};
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
    } else if (url.origin === origin || (!gmailReview && !workspaceReview && FONT_HOSTS.some((re) => re.test(request.url)))) send('Fetch.continueRequest', { requestId }).catch(() => {});
    else { blocked.add(request.url); send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {}); }
  }
  if (method === 'Runtime.exceptionThrown') problems.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
});
await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });



const VIEWPORTS = [
  { id: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false },
  { id: 'laptop', width: 1024, height: 768, dpr: 1, mobile: false },
  { id: 'phone320', width: 320, height: 780, dpr: 2, mobile: true },
  { id: 'phone390', width: 390, height: 844, dpr: 2, mobile: true },
  { id: 'phone430', width: 430, height: 932, dpr: 2, mobile: true },
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

if (mergeReview) {
  const dialog = "document.querySelector('.hub-duplicate-dialog[open]')";
  for (const view of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', { width: view.width, height: view.height, deviceScaleFactor: view.dpr, mobile: view.mobile });
    const navigation = await send('Page.navigate', { url: `${BASE}?duplicates=1&merge_demo=1${view.mobile ? '&scout=1&theme=dark' : ''}` });
    if (navigation.errorText) throw new Error(`Fixture navigation failed: ${navigation.errorText}`);
    if (!await until("document.querySelector('.hub-duplicate-trigger')", 25_000)) throw new Error(`My People trigger missing: ${String(await evaluate('document.body.innerText')).slice(0, 1200)}; errors=${problems.join(' | ')}; blocked=${[...blocked].join(' | ')}`);
    await click("document.querySelector('.hub-duplicate-trigger')");
    await click(`(${dialog}).querySelector('.hub-merge-survivor input[value="jordan"]').closest('label')`);
    await click(byText('Continue', dialog));
    await until(`(${dialog}).querySelector('input[name^="conflict-"]')`);
    await evaluate(`document.querySelectorAll('.hub-duplicate-dialog input[name^="conflict-"][value="1"]').forEach((input) => input.closest('label').click())`);
    await click(byText('Review combined contact', dialog));
    check(view.id + ' verified before confirmation', await until(byText('Merge contacts', dialog)));
    check(view.id + ' merge footer stays reachable while content scrolls', await evaluate(`(() => {
      const d = ${dialog}; const content = d?.querySelector('.hub-duplicate-content'); const footer = d?.querySelector('.hub-merge-footer');
      if (!d || !content || !footer) return false;
      content.scrollTop = content.scrollHeight;
      const dr = d.getBoundingClientRect(); const fr = footer.getBoundingClientRect();
      const buttons = [...footer.querySelectorAll('button')].filter((button) => !button.disabled);
      const okay = dr.left >= -1 && dr.right <= innerWidth + 1 && fr.bottom <= innerHeight + 1
        && buttons.every((button) => button.getBoundingClientRect().height >= 44);
      content.scrollTop = 0;
      return okay;
    })()`));
    await shot(join(OUT, `trusted-merge-${view.id}-preview.png`));
    await click(byText('Merge contacts', dialog));
    check(view.id + ' merge receipt shown', await until(`(${dialog})?.innerText.includes('Contacts merged')`));
    check(view.id + ' committed survivor retains additive facts', await evaluate(`(() => {
      const survivor = window.__mergeFixtureState?.survivor;
      return survivor?.emails?.length === 2 && survivor?.phones?.length === 2 && survivor?.sticker_ids?.length === 4
        && survivor?.notes?.length >= 2 && survivor?.contact_affiliations?.length === 2
        && survivor.title === 'Director' && survivor.company_name === 'T-Mobile' && survivor.company_id === 'tmobile-example'
        && survivor.identity_sources?.includes('community_import') && Object.keys(survivor.sticker_assignments ?? {}).length === 4;
    })()`));
    await click(byText('Check recovery options', dialog));
    await click(byText('Confirm recovery', dialog));
    check(view.id + ' shows verified rollback outcome', await until(`(${dialog})?.innerText.includes('Merge rolled back')`));
    check(view.id + ' rollback restores both contacts and source history', await evaluate(`Boolean(window.__mergeFixtureState?.rolledBack && window.__mergeFixtureState.source?.contact_hub_lifecycle == null && window.__mergeFixtureState.survivor?.contact_affiliations?.length === 1)`));
    check(view.id + ' did not call cloud fixture writes', (await writeRows()).length === 0);
  }
  await send('Page.navigate', { url: `${BASE}?duplicates=1&merge_demo=1` });
  if (!await until("document.querySelector('.hub-duplicate-trigger')", 25_000)) throw new Error(`My People trigger missing: ${String(await evaluate('document.body.innerText')).slice(0, 1200)}`);
  await click("document.querySelector('.hub-duplicate-trigger')");
  await until(`!(${byText('Not a duplicate', dialog)})?.disabled`);
  await click(byText('Not a duplicate', dialog));
  check('dismissal updates count', await until(`(${dialog})?.innerText.includes('Possible match 1 of 1')`));
  await send('Page.reload');
  check('dismissal survives reload', await until("document.querySelector('.hub-duplicate-trigger')", 25_000));
  await click("document.querySelector('.hub-duplicate-trigger')");
  await click(byText('Restore dismissed matches', dialog));
  check('restoring a dismissal recovers the pair', await until(`(${dialog})?.innerText.includes('Possible match 1 of 2')`));
  await key('Escape');
  check('Escape closes duplicate review without starting a merge', !(await evaluate(dialog)) && (await writeRows()).length === 0);
  check('no browser exceptions', problems.length === 0);
  check('no remote API requests', [...blocked].every((url) => FONT_HOSTS.some((re) => re.test(url))));
  writeFileSync(join(OUT, 'trusted-merge-report.json'), JSON.stringify({ checks, blocked: [...blocked], problems }, null, 2));
  console.log(`Trusted merge browser smoke: ${checks.filter(({ pass }) => pass).length}/${checks.length} passed`);
  process.exit(checks.some(({ pass }) => !pass) ? 1 : 0);
}

if (duplicateReview) {
  const dialog = "document.querySelector('.hub-duplicate-dialog[open]')";
  for (const view of VIEWPORTS) {
    for (const [theme, value] of THEMES) {
      const label = `${view.id}-${theme}`;
      await send('Emulation.setDeviceMetricsOverride', {
        width: view.width, height: view.height, deviceScaleFactor: view.dpr, mobile: view.mobile,
      });
      await send('Page.navigate', { url: `${BASE}?duplicates=1&theme=${value}${view.mobile ? '&scout=1' : ''}` });
      const ready = await until(byText('Review possible duplicates 2'), 25_000);
      check(label + ' finds two pairs', ready);
      if (!ready) throw new Error(JSON.stringify({ body: await bodyText(), blocked: [...blocked], problems }));
      await click(byText('Review possible duplicates 2'));
      check(label + ' compares both records', await until(`(${dialog})?.querySelectorAll('th[scope="col"]').length === 3`));
      check(label + ' shows evidence', await evaluate(`(${dialog})?.innerText.includes('Same LinkedIn profile')`));
      check(label + ' fits width', await evaluate(`(${dialog}).scrollWidth <= (${dialog}).clientWidth + 1`));
      check(label + ' dismiss, compare actions and modal content remain accessible', await evaluate(`(() => {
        const d = ${dialog}; const close = d?.querySelector('.hub-duplicate-close'); const content = d?.querySelector('.hub-duplicate-content');
        const footer = d?.querySelector('.hub-duplicate-footer'); if (!d || !close || !content || !footer) return false;
        const dr = d.getBoundingClientRect(); const closeRect = close.getBoundingClientRect();
        content.scrollTop = content.scrollHeight;
        const scrollWorks = content.scrollHeight <= content.clientHeight || content.scrollTop > 0;
        const buttons = [...footer.querySelectorAll('button')].filter((button) => !button.disabled);
        const okay = dr.left >= -1 && dr.right <= innerWidth + 1 && closeRect.width >= 44 && closeRect.height >= 44
          && buttons.every((button) => button.getBoundingClientRect().height >= 44) && scrollWorks;
        content.scrollTop = 0; return okay;
      })()`));
      await shot(join(OUT, `duplicates-${label}.png`));
      await click(byText('Not a duplicate', dialog));
      check(label + ' moves to remaining pair', await until(`(${dialog})?.innerText.includes('Possible match 1 of 1')`));
      check(label + ' did not write', (await writeRows()).length === 0);
    }
  }
  await send('Page.navigate', { url: `${BASE}?duplicates=1&readonly=1` });
  await until(byText('Review possible duplicates 2'));
  await click(byText('Review possible duplicates 2'));
  check('read-only can compare', await until(`(${dialog})?.querySelector('table')`));
  check('read-only has no dismissal', !await evaluate(byText('Not a duplicate', dialog)));
  check('no browser exceptions', problems.length === 0);
  check('no remote API requests', [...blocked].every((url) => FONT_HOSTS.some((re) => re.test(url))));
  writeFileSync(join(OUT, 'duplicates-report.json'), JSON.stringify({ checks, blocked: [...blocked], problems }, null, 2));
  console.log(`Duplicate review browser smoke: ${checks.filter(({ pass }) => pass).length}/${checks.length} passed`);
  process.exit(checks.some(({ pass }) => !pass) ? 1 : 0);
}

if (workspaceReview) {
  const nav = (text) => byText(text, byLabel("Fixture navigation"));
  const tab = (name) => `[...document.querySelectorAll('[role=tab]')].find((item) => item.textContent.trim() === ${JSON.stringify(name)})`;
  const person = `document.querySelector('a[href="/contact-hub/person/jordan"]')`;
  const sessions = [['free', ''], ['scout', '&scout=1'], ['read-only', '&readonly=1']]
    .filter(([session]) => !process.env.CONTACT_HUB_REVIEW_SESSION || session === process.env.CONTACT_HUB_REVIEW_SESSION);
  const viewports = VIEWPORTS.filter((view) => !process.env.CONTACT_HUB_REVIEW_VIEWPORT || view.id === process.env.CONTACT_HUB_REVIEW_VIEWPORT);
  const themes = THEMES.filter(([theme]) => !process.env.CONTACT_HUB_REVIEW_THEME || theme === process.env.CONTACT_HUB_REVIEW_THEME);
  for (const [session, query] of sessions) {
    for (const vp of viewports) for (const [theme] of themes) {
      const label = `${session}-${vp.id}-${theme}`;
      await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
      await send('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile });
      await send('Page.navigate', { url: `${BASE}?workspace=1${query}&theme=${theme}` });
      check(label + ' My People loaded', await until(person));
      check(label + ' defaults to Table View', await evaluate("document.querySelector('[role=table][aria-label=\"My People\"]') && document.querySelector('[role=group][aria-label=\"View\"] button[aria-pressed=\"true\"]')?.textContent.includes('Table')"));
      check(label + ' avoids horizontal overflow', await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'));
      const peopleActionAudit = await evaluate(`(() => {
        const root = document.querySelector('.hub-people');
        const controls = [...(root?.querySelectorAll('button, a[href]') ?? [])].filter((node) => node.getClientRects().length);
        const unnamed = controls.filter((node) => !(node.getAttribute('aria-label') || node.innerText || '').trim())
          .map((node) => ({ tag: node.tagName, className: node.className, text: node.innerText, title: node.title, disabled: node.disabled, html: node.outerHTML.slice(0, 240) }));
        const untabbable = controls.filter((node) => node.tabIndex < 0)
          .map((node) => ({ tag: node.tagName, className: node.className, text: node.innerText?.trim().slice(0, 30), label: node.getAttribute('aria-label'), disabled: node.disabled }));
        const named = unnamed.length === 0 && untabbable.length === 0;
        const touch = !${vp.mobile} || [...(root?.querySelectorAll('.hub-view-btn, .hub-primary-btn, .hub-secondary-btn, .hub-row-actions a, .hub-td-link') ?? [])]
          .filter((node) => node.getClientRects().length).every((node) => node.getBoundingClientRect().height >= 44);
        const actionRow = root?.querySelector('.hub-tools-actions'); const view = root?.querySelector('.hub-view');
        const visibleFit = !${vp.mobile} || Boolean(actionRow && view && actionRow.scrollWidth <= actionRow.clientWidth + 1
          && [...view.querySelectorAll('button')].every((node) => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }));
        return { pass: named && touch && visibleFit, unnamed, untabbable, touch, visibleFit };
      })()`);
      check(label + ' My People controls have names, keyboard access and suitable touch targets', peopleActionAudit.pass, JSON.stringify(peopleActionAudit));
      check(label + ' My People content can be vertically reached without clipping', await evaluate(`(() => {
        const scroller = document.scrollingElement; if (!scroller) return false;
        const old = scroller.scrollTop; scroller.scrollTop = scroller.scrollHeight;
        const reached = scroller.scrollHeight <= scroller.clientHeight || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
        scroller.scrollTop = old; return reached;
      })()`));
      if (session !== 'read-only') {
        check(label + ' Import visible', await evaluate(byLabel('Import Contacts')));
        await shot(join(OUT, `my-people-table-${label}.png`));
        await click(byText('Cards', "document.querySelector('[role=group][aria-label=\\\"View\\\"]')"));
        check(label + ' Cards View remains available', await until("document.querySelector('ul.hub-list[aria-label=\\\"My People\\\"]')"));
        await shot(join(OUT, `my-people-cards-${label}.png`));
        await click(byText('Table', "document.querySelector('[role=group][aria-label=\\\"View\\\"]')"));
        await click(nav('Sticker Wall'));
        check(label + ' navigates to Sticker Wall', await until("document.querySelector('#hub-people-heading')?.textContent.trim() === 'Sticker Wall'"));
        await click(nav('My Card'));
        check(label + ' My Card opens finished card first', await until("document.querySelector('.mycard-card') && !document.querySelector('.mycard-editor') && document.querySelector('button.mycard-edit-card')"));
        check(label + ' finished card shows synthetic identity, photo and contact links', await evaluate(`(() => {
          const card = document.querySelector('.mycard-card'); const text = card?.innerText ?? '';
          return text.includes('Jordan Lee') && text.includes('Community Partnerships Director')
            && text.includes('Community Partners of Salt Lake') && text.includes('jordan.lee@example.org')
            && text.includes('+1 (801) 555-0199') && text.includes('linkedin.com/in/jordan-lee-example')
            && text.includes('@jordan.lee') && Boolean(card.querySelector('img[src*="images.fixture.test/jordan.svg"]'));
        })()`));
        check(label + ' My Card actions are accessible and fit the viewport', await evaluate(`(() => {
          const root = document.querySelector('.mycard'); const controls = [...(root?.querySelectorAll('button, a[href]') ?? [])].filter((node) => node.getClientRects().length);
          return document.documentElement.scrollWidth <= innerWidth + 1
            && controls.every((node) => (node.getAttribute('aria-label') || node.innerText || '').trim().length > 0 && node.tabIndex >= 0);
        })()`));
        await shot(join(OUT, `my-card-finished-${label}.png`));
        await click(byText('Edit Card'));
        check(label + ' Edit Card opens existing editor', await until("document.querySelector('.mycard-editor')"));
        check(label + ' editor scrolling keeps Save and Cancel reachable', await evaluate(`(() => {
          const root = document.querySelector('.mycard'); const actions = root?.querySelector('.mycard-actions');
          if (!root || !actions) return false;
          root.scrollTop = root.scrollHeight;
          const rr = root.getBoundingClientRect(); const ar = actions.getBoundingClientRect();
          const buttons = [...actions.querySelectorAll('button')];
          const okay = ar.top >= rr.top - 1 && ar.bottom <= rr.bottom + 1 && buttons.length >= 2
            && buttons.every((button) => button.getBoundingClientRect().height >= 44 && (button.innerText || button.getAttribute('aria-label')));
          root.scrollTop = 0; return okay;
        })()`));
        await click(byText('Cancel'));
        check(label + ' Cancel returns to finished card', await until("document.querySelector('.mycard-card') && !document.querySelector('.mycard-editor')"));
        await click(nav('My People'));
        await until(person);
      }
      await click(person);
      check(label + ' person defaults to Action Center', await until(`(${tab('Action Center')})?.getAttribute('aria-selected') === 'true'`));
      check(label + ' Emails access', Boolean(await evaluate(tab('Emails'))) === (session === 'scout'));
      check(label + ' capture access', Boolean(await evaluate(byLabel('What would you like to remember or do?'))) === (session !== 'read-only'));
      check(label + ' no photo persistence fixture request', await evaluate("!window.__writes.some((entry) => entry.kind === 'photo override')"));
      await shot(join(OUT, `workspace-${label}.png`));
    }
  }
  check('no browser exceptions', problems.length === 0);
  check('no remote API requests', [...blocked].every((url) => FONT_HOSTS.some((re) => re.test(url))));
  writeFileSync(join(OUT, 'workspace-report.json'), JSON.stringify({ checks, blocked: [...blocked], problems }, null, 2));
  console.log(`Workspace browser smoke: ${checks.filter(({ pass }) => pass).length}/${checks.length} passed`);
  process.exit(checks.some(({ pass }) => !pass) ? 1 : 0);
}

if (gmailReview) {
  const dialog = "document.querySelector('.hub-gmail-dialog[open]')";
  const option = (text) => byText(text, dialog);
  const status = (text) => until(`(${dialog})?.querySelector('[role=status]')?.textContent.includes(${JSON.stringify(text)})`, 20_000);
  const outcome = (value) => evaluate(`(() => {
    const select = document.querySelector('[aria-label="Next simulated send"]');
    select.value = ${JSON.stringify(value)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const draft = async (subject) => {
    await click(`(${dialog}).querySelector('input')`);
    await typeText(subject);
    await click(`(${dialog}).querySelector('textarea')`);
    await typeText('Thanks for your time today.');
  };
  const draftMatches = (subject) => evaluate(`(${dialog}).querySelector('input').value === ${JSON.stringify(subject)} && (${dialog}).querySelector('textarea').value === 'Thanks for your time today.'`);
  const viewportShot = async (file) => {
    await evaluate("document.querySelector('.demo-profile').scrollIntoView({ block: 'start' })");
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(OUT, file + '.png'), Buffer.from(data, 'base64'));
  };
  for (const { id, width, height, dpr, mobile } of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
    for (const [theme] of THEMES) {
      const label = `${id}-${theme}`;
      const query = `action=1&gmail_demo=1&theme=${theme}`;
      await load(query);
      await evaluate('sessionStorage.clear()');
      const open = () => click(byLabel('Email jordan@example.org'));
      await open();
      check(label + ' disconnected', await until(option('Connect Gmail')));
      await viewportShot(label + '-disconnected');
      await click(option('Connect Gmail'));
      check(label + ' returns to Jordan connected', await until(`location.search.includes('contact=jordan') && document.querySelector('.ph-card').textContent.includes('Jordan Lee') && (${dialog})?.textContent.includes('From review-sender@example.org')`));
      check(label + ' first saved address only', await evaluate(`(${dialog}).textContent.includes('To jordan@example.org') && !(${dialog}).textContent.includes('personal') && !(${dialog}).textContent.includes('imported')`));
      check(label + ' fits viewport', await evaluate(`(() => {
        const bounds = (${dialog}).getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= innerWidth + 1 && bounds.top >= 0 && bounds.bottom <= innerHeight + 1;
      })()`));
      await click(option('Cancel'));
      await outcome('retry');
      await open();
      await until(`(${dialog})?.querySelector('input')`);
      await draft('Thanks for meeting');
      await viewportShot(label + '-composer');
      await click(option('Send email'));
      check(label + ' failure with draft', await status('Gmail declined') && await draftMatches('Thanks for meeting'));
      await viewportShot(label + '-retry');
      await click(option('Send email'));
      check(label + ' retry confirms send', await status('Email sent.'));
      await viewportShot(label + '-sent');
      await click(option('Close'));
      await click(byText('Activity'));
      check(label + ' confirmed send appears once in Activity', await until("[...document.querySelectorAll('.ac-card li')].filter((item) => item.innerText.includes('Thanks for meeting')).length === 1"));
      await viewportShot(label + '-activity');

      for (const [kind, message] of [['quota', 'Contact Hub sending limit'], ['gmailQuota', 'Gmail’s sending limit'], ['unknown', 'Check your Sent folder']]) {
        await outcome(kind);
        await open();
        await until(`(${dialog})?.querySelector('input')`);
        await draft('Another check');
        await click(option('Send email'));
        check(label + ' ' + kind, await status(message) && await draftMatches('Another check'));
        if (kind === 'unknown') {
          check(label + ' uncertain cannot resend', await evaluate(`!(${option('Send email')}) && !!(${option('I checked Gmail Sent')})`));
          await viewportShot(label + '-uncertain');
        } else if (kind === 'quota') await viewportShot(label + '-rate-limit');
        await click(option('Cancel'));
      }
      await open();
      check(label + ' uncertain persists after reopening', await status('Check your Sent folder'));
      await click(option('I checked Gmail Sent'));
      await draft('Jordan only');
      await load(query + '&contact=avery');
      await click(byLabel('Email avery@example.org'));
      check(label + ' navigation clears draft and keeps Avery scoped', await until(`(${dialog})?.textContent.includes('To avery@example.org') && (${dialog}).querySelector('input').value === '' && (${dialog}).querySelector('textarea').value === '' && window.__writes.length === 0`));
      await load(query + '&readonly=1&compose=email');
      check(label + ' read-only cannot open returned composer', await evaluate(`!(${dialog}) && !!document.querySelector('a[href="mailto:jordan@example.org"]')`));
    }
  }
  const unexpected = [...blocked].filter((url) => !/^https:\/\/fonts\.(gstatic|googleapis)\.com\//.test(url));
  check('no external service requests', unexpected.length === 0);
  check('no browser exceptions', problems.length === 0);
  writeFileSync(join(OUT, 'gmail-report.json'), JSON.stringify({ checks, blocked: [...blocked], problems }, null, 2));
  console.log(`Gmail browser review: ${checks.filter(({ pass }) => pass).length}/${checks.length} checks passed`);
  process.exit(checks.some(({ pass }) => !pass) ? 1 : 0);
}

if (process.argv.includes('--photo')) {
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  const photoShot = async (filename) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(OUT, filename), Buffer.from(data, 'base64'));
  };
  async function pickFile(label, filename) {
    let opened;
    const chooser = new Promise((resolve) => { opened = resolve; });
    const onChooser = ({ method, params }) => { if (method === 'Page.fileChooserOpened') opened(params); };
    listeners.push(onChooser);
    try {
      await click(byText(label));
      const { backendNodeId } = await Promise.race([chooser, wait(3000).then(() => { throw new Error('File chooser did not open'); })]);
      await send('DOM.setFileInputFiles', { backendNodeId, files: [join(process.cwd(), 'public', filename)] });
    } finally {
      listeners.splice(listeners.indexOf(onChooser), 1);
    }
  }
  async function openPhoto(mobile, hasPhoto = true, name = 'Jordan Lee') {
    if (mobile && hasPhoto) {
      await click(byLabel('Edit profile'));
      await click(byText('Change photo'));
    } else await click(byLabel(hasPhoto ? 'Change photo' : `Add photo for ${name}`));
  }
  for (const [folder, theme] of THEMES) for (const vp of VIEWPORTS) {
    const tag = `${folder}-${vp.id}`;
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile });
    await load(`action=1&photo=1&theme=${theme}&latency=300&scout=${folder === 'dark' ? 1 : 0}`);
    const original = await evaluate("document.querySelector('.ph-avatar-img').src");
    await openPhoto(vp.mobile);
    check(`${tag}: editor is a modal in the expected position`, await evaluate(`(() => {
      const rect = document.querySelector('.cp-photo-editor:modal').getBoundingClientRect();
      return ${vp.mobile} ? Math.abs(rect.bottom - innerHeight) < 3 : Math.abs((rect.left + rect.right) / 2 - innerWidth / 2) < 3;
    })()`));
    check(`${tag}: camera and library have separate native inputs`, await evaluate(`document.querySelector('[aria-label="Camera photo"]').getAttribute('capture') === 'environment' &&
      !document.querySelector('[aria-label="Device photo"]').hasAttribute('capture')`));
    await photoShot(`photo-options-${tag}.png`);
    await pickFile(vp.mobile ? 'Take a photo' : 'Choose a photo', 'barry-bear.jpg');
    check(`${tag}: real local file opens the existing crop dialog`, await until(`Boolean(document.querySelector('.mycard-crop-viewport img'))`));
    await until(`[...document.querySelectorAll('.mycard-crop button')].some(b => b.textContent.trim() === 'Use photo' && !b.disabled)`);
    await click(byLabel('Zoom in'));
    check(`${tag}: crop zoom changes framing`, await evaluate(`Number(document.querySelector('.mycard-crop-slider').value) > 1`));
    await photoShot(`photo-crop-${tag}.png`);
    await click(byText('Use photo'));
    check(`${tag}: processed preview waits for Save`, await until(`document.querySelector('.cp-photo-preview img')?.src.startsWith('data:image/jpeg;base64,') &&
      document.querySelector('.cp-photo-preview img').src.length <= 65536 && window.__writes.length === 0`));
    await photoShot(`photo-preview-${tag}.png`);
    await evaluate('window.__fixture.failNext = true');
    await click(byText('Save photo'));
    check(`${tag}: failure restores the original and keeps the staged preview`, await until(`Boolean(document.querySelector('.cp-photo-editor [role=alert]')) &&
      document.querySelector('.ph-avatar-img').src === ${JSON.stringify(original)} &&
      document.querySelector('.cp-photo-preview img').src.startsWith('data:image/jpeg')`));
    await click(byText('Save photo'));
    check(`${tag}: retry shows the saved upload`, await until(`!document.querySelector('.cp-photo-editor') && document.querySelector('.ph-avatar-img').src.startsWith('data:image/jpeg')`));
    await click(byLabel('View photo of Jordan Lee'));
    check(`${tag}: uploaded photo opens in the existing viewer`, await until(`Boolean(document.querySelector('.civ-backdrop img[src^="data:image/jpeg"]'))`));
    await key('Escape');
    await openPhoto(vp.mobile);
    await click(byText('Remove photo'));
    await click(byText('Save photo'));
    check(`${tag}: removal shows initials and keeps the original hidden`, await until(`!document.querySelector('.cp-photo-editor') && Boolean(${byLabel('Add photo for Jordan Lee')})`));
    await pickContact('avery');
    await pickContact('jordan');
    check(`${tag}: hidden state survives leaving the contact`, Boolean(await evaluate(byLabel('Add photo for Jordan Lee'))));
    await openPhoto(vp.mobile, false);
    await click(byText('Restore original photo'));
    await click(byText('Save photo'));
    check(`${tag}: restore displays exactly the original URL`, await until(`!document.querySelector('.cp-photo-editor') && document.querySelector('.ph-avatar-img')?.src === ${JSON.stringify(original)}`));
    await pickContact('avery');
    await openPhoto(vp.mobile, false, 'Avery Quinn');
    await click(byText('Use a photo URL'));
    await click(`document.querySelector('.cp-photo-editor input[type=text]')`);
    await typeText('http://images.fixture.test/avery.svg');
    const before = (await writeRows()).length;
    await click(byText('Save photo'));
    check(`${tag}: invalid URL makes no write`, (await writeRows()).length === before && await evaluate(`Boolean(document.querySelector('.cp-photo-editor [role=alert]'))`));
    await click(`document.querySelector('.cp-photo-editor input[type=text]')`);
    await replaceText('https://images.fixture.test/avery.svg');
    check(`${tag}: typing a URL does not fetch a preview`, !(await evaluate(`Boolean(document.querySelector('.cp-photo-preview img'))`)));
    await click(byText('Preview link'));
    await until(`document.querySelector('.cp-photo-preview img')?.naturalWidth > 0`);
    await click(byText('Save photo'));
    check(`${tag}: a contact without a photo can save a URL`, await until(`!document.querySelector('.cp-photo-editor') &&
      document.querySelector('.ph-avatar-img')?.src === 'https://images.fixture.test/avery.svg'`));
    await load(`action=1&photo=1&theme=${theme}&readonly=1`);
    check(`${tag}: read-only can view but has no photo edit action`, await evaluate(`Boolean(${byLabel('View photo of Jordan Lee')}) &&
      !document.querySelector('.ph-photo-edit, .ph-profile-menu-trigger, .cp-photo-editor')`));
  }
  const failed = checks.filter((entry) => !entry.pass);
  writeFileSync(join(OUT, 'photo-report.json'), JSON.stringify({ checks, blocked: [...blocked], problems }, null, 2));
  console.log(`${checks.length - failed.length}/${checks.length} photo checks passed. ${blocked.size} refused requests. ${problems.length} page errors.`);
  socket.close(); cleanup(); process.exit(failed.length || blocked.size || problems.length ? 1 : 0);
}

if (process.argv.includes('--action')) {
  const button = (label) => byText(label, "document.querySelector('.ac')");
  const input = () => byLabel('What would you like to remember or do?');
  const enteredText = async (value) => {
    await click(input());
    await typeText(value);
  };
  const waitForText = (text) => until(`document.querySelector('.ac').innerText.includes(${JSON.stringify(text)})`);
  const captureAction = async (filename) => {
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
    writeFileSync(join(OUT, filename), Buffer.from(data, 'base64'));
    await evaluate(`(() => {
      document.querySelector('.demo-banner').hidden = false;
      document.querySelector('.demo-controls').style.display = '';
      document.querySelector('.demo-log').hidden = false;
    })()`);
  };
  for (const [folder, theme] of THEMES) for (const vp of VIEWPORTS) {
    const tag = `${folder}-${vp.id}`;
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile });
    await load(`action=1&latency=300&theme=${theme}`);
    check(`${tag}: Free defaults to Action Center with local Barry and no Emails`, Boolean(await evaluate(input())) &&
      !(await evaluate(button('Emails'))) && !(await evaluate(button('Open Barry'))));
    check(`${tag}: responsive layout has no horizontal overflow`, await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'));
    check(`${tag}: colorful stickers and Add sticker are visible`, await evaluate(`Boolean(
      document.querySelector('${vp.mobile ? '.ph-sticker-strip' : '.ph-stickers'} .ph-sticker-emoji')?.getClientRects().length &&
      document.querySelector('.ph-add-sticker')?.getClientRects().length)`));
    if (!vp.mobile) check(`${tag}: desktop stickers occupy the upper-right header column`, await evaluate(`(() => {
      const stickers = document.querySelector('.ph-stickers').getBoundingClientRect();
      const name = document.querySelector('.ph-name').getBoundingClientRect();
      return stickers.left > name.right && Math.abs(stickers.top - name.top) < 40;
    })()`));
    await enteredText('Bring volunteer sign-up sheets');
    await click(button('Set reminder'));
    await evaluate(`(() => {
      const date = document.querySelector('.ac input[type=date]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(date, '2027-07-10');
      date.dispatchEvent(new Event('input', { bubbles: true }));
      date.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await click(button('Save reminder'));
    check(`${tag}: reminder saved with due date and Done`, (await waitForText('Reminder saved.')) && Boolean(await evaluate(button('Done'))));
    await enteredText('Jordan confirmed the event date');
    await click(button('Log update'));
    check(`${tag}: interaction sheet opens with the draft and editable date`, await evaluate(`Boolean(document.querySelector('.ac-sheet[open] input[type=date]').value) && document.querySelector('.ac-sheet textarea').value === 'Jordan confirmed the event date'`));
    if (vp.mobile && folder === 'light') await shot(join(OUT, 'log-interaction-mobile.png'));
    await click(button('Save update'));
    check(`${tag}: logged call appears in Recent Activity`, await waitForText('Jordan confirmed the event date'));
    await enteredText('Prefers to coordinate on Mondays');
    await click(button('Add note'));
    check(`${tag}: saved note appears in Recent Activity`, await waitForText('Prefers to coordinate on Mondays'));
    await captureAction(`action-center-${tag}.png`);
    await click(button('View all'));
    check(`${tag}: the Activity tab shows the same saved history once`, await evaluate(`document.querySelector('.ac [role=tabpanel]').innerText.split('Prefers to coordinate on Mondays').length === 2`));
    await click(button('Action Center'));
    if (vp.mobile && folder === 'light') {
      await click(byLabel('Note actions'));
      await captureAction('recent-activity-menu-mobile.png');
      await click(button('Edit note'));
      await click(button('Cancel'));
      await click(button('Details'));
      await captureAction('details-mobile.png');
      await click(button('Edit location'));
      await click(`document.querySelector('.ac-details input')`);
      await replaceText('Ogden, UT');
      await click(button('Save location'));
      check('mobile: editing location updates the same profile', await until(`document.querySelector('.ph-location-text').textContent === 'Ogden, UT'`));
      await click(button('Stickers'));
      check('mobile: sticker management remains available under Stickers', await evaluate(`Boolean(document.querySelector('.ac [aria-label="Add sticker"]')?.getClientRects().length)`));
      await captureAction('stickers-mobile.png');
      await click(button('Action Center'));
    }
    await click(button('Done'));
    check(`${tag}: Done clears Up Next and records completion`, (await waitForText('Reminder completed.')) && (await waitForText('No reminder set.')));
    await pickContact('avery');
    check(`${tag}: switching contact resets the composer and history`, (await waitForText('Notes and logged interactions will appear here.')) && !(await evaluate(`${input()}.value`)));
    if (vp.mobile && folder === 'light') {
      check('mobile: empty contact still offers Add sticker', await evaluate(`Boolean(document.querySelector('.ph-sticker-strip .ph-add-sticker')) &&
        !document.querySelector('.ph-sticker-scroll')`));
      await click(byLabel('Add sticker'));
      await until(`Boolean(document.querySelector('.stk-picker--sheet'))`);
      await holdStickerWrite();
      await click(pickerOption('Donor'));
      check('mobile: pending sticker is visible in the compact row', await evaluate(`document.querySelector('.ph-sticker-scroll [aria-busy=true]')?.title === 'Donor'`));
      await settleStickerWrite();
      await until(`!document.querySelector('.ph-sticker-scroll [aria-busy=true]')`);
      await pickContact('long');
      check('mobile: chips stay on one scrollable row and the Add sticker target stays fixed', await evaluate(`(() => {
        const row = document.querySelector('.ph-sticker-scroll');
        const add = document.querySelector('.ph-add-sticker');
        const before = add.getBoundingClientRect();
        const chipRows = new Set([...row.children].map((chip) => chip.getBoundingClientRect().top));
        row.scrollLeft = row.scrollWidth;
        const after = add.getBoundingClientRect();
        return row.scrollLeft > 0 && chipRows.size === 1 && Math.abs(after.x - before.x) < 1 && after.height >= 44 && after.width >= 44;
      })()`));
      await captureAction('stickers-overflow-mobile.png');
      await click(byLabel('Add sticker'));
      check('mobile: pinned Add sticker opens an unclipped sheet after scrolling', await until(`Boolean(document.querySelector('.stk-picker--sheet'))`));
      await load('action=1&stickers=off');
      check('mobile: unavailable stickers keep their existing visibility gate', !(await evaluate(`Boolean(document.querySelector('.ph-sticker-strip'))`)));
    }
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
