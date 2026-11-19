/**
 * STAGING ONLY: a browser for the staging checks, and the check that the app really loads.
 *
 * launchChromium: Playwright's own Chromium if it is installed, otherwise the installed Google
 * Chrome (channel 'chrome'), so nothing has to be downloaded on a machine that has Chrome.
 *
 * browserCheck: opens the app through the local proxy in a fresh profile (no service worker,
 * no cache, no cookies from earlier runs), waits for the signup form to render, and fails on any
 * 5xx or failed request to the app. GET / answering 200 is not enough: it does not run the app.
 */

export async function launchChromium({ headless = true, importPlaywright = () => import('playwright') } = {}) {
  let chromium;
  try {
    ({ chromium } = await importPlaywright());
  } catch {
    throw new Error('Playwright is not installed in this checkout: run `npm ci` (it is a dev dependency).');
  }
  try {
    return await chromium.launch({ headless });
  } catch (err) {
    if (!/Executable doesn't exist|playwright install/i.test(err?.message ?? '')) throw err;
  }
  try {
    return await chromium.launch({ headless, channel: 'chrome' });
  } catch {
    throw new Error("No browser for the checks: Playwright's Chromium is not installed and Google Chrome was not found (`npx playwright install chromium` installs one).");
  }
}

const pathOf = (url, base) => (url.startsWith(base) ? url.slice(base.length) || '/' : url);

/**
 * { ok, ms, problems }. `ready` is what must be on the page: by default the signup form's email
 * field, which only exists once React has rendered the app.
 */
export async function browserCheck({
  base = 'http://localhost:8888', path = '/signup', timeoutMs = 90_000, launch = launchChromium,
  ready = (page) => page.locator('input[type="email"]').first().waitFor({ state: 'visible', timeout: timeoutMs }),
  now = Date.now,
} = {}) {
  const started = now();
  let browser;
  try {
    browser = await launch();
  } catch (err) {
    return { ok: false, ms: now() - started, problems: [`browser check could not run: ${err.message}`] };
  }
  const problems = [];
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('response', (r) => { if (r.url().startsWith(base) && r.status() >= 500) problems.push(`${r.status()} for ${pathOf(r.url(), base)}`); });
    page.on('requestfailed', (r) => {
      const why = r.failure()?.errorText ?? '';
      if (r.url().startsWith(base) && !/ERR_ABORTED/.test(why)) problems.push(`${pathOf(r.url(), base)} failed (${why})`);
    });
    const response = await page.goto(`${base}${path}`, { waitUntil: 'load', timeout: timeoutMs });
    if (!response || response.status() !== 200) problems.push(`${path} answered ${response?.status() ?? 'nothing'}`);
    else await ready(page);
  } catch (err) {
    problems.push(`${path} did not render: ${(err?.message ?? String(err)).split('\n')[0]}`);
  } finally {
    await browser.close().catch(() => {});
  }
  return { ok: problems.length === 0, ms: now() - started, problems: [...new Set(problems)] };
}
