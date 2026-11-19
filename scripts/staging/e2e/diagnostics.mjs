/**
 * STAGING ONLY, test automation: what the browser showed when a journey step failed.
 *
 * captureDiagnostics takes a full-page screenshot next to the report and records the page URL,
 * the visible text, the last console errors and failed requests, and whether an Enrich button
 * exists in the DOM at all. classifyPageFailure turns that into one of four causes for a step that
 * expected the Scout contact page (/contact/<id>) with its Enrich button:
 *   redirect          the page is somewhere else (Contact Hub, /scout, checkout, the Scout panel)
 *   loading failure   still "Loading contact profile...", or "Contact Not Found"
 *   rendering error   the app's crash screen, or the profile rendered without the button
 *   selector issue    an Enrich button is in the DOM but the step's selector did not match it
 * plus the signals seen either way (a Firestore internal assertion, missing-index errors).
 * Nothing here is sent anywhere; tokens are masked before anything is written.
 */

const TOKEN = /\b(eyJ[\w-]+\.[\w-]+\.[\w-]+|ya29\.[\w.-]+|1\/\/[\w.-]+|(?:sk|rk)_(?:test|live)_[\w]+|whsec_[\w]+)\b/g;

/** Masks tokens and keys in a string. Pure. */
export function redact(value) {
  return String(value ?? '').replace(TOKEN, '[redacted]');
}

const has = (texts, re) => texts.some((t) => re.test(t));

/**
 * The likely cause for a step that expected the contact page with its Enrich button. Pure.
 * @returns {{ category, kind, reason, signals: string[] }}
 */
export function classifyPageFailure({ base, url, text = '', consoleTexts = [], enrichInDom = 0, contactId = null }) {
  const signals = [];
  if (has(consoleTexts, /INTERNAL ASSERTION FAILED/i)) signals.push('firestore-internal-assertion');
  if (has(consoleTexts, /requires an index|FAILED_PRECONDITION/i)) signals.push('firestore-missing-index');
  if (has(consoleTexts, /permission-denied|Missing or insufficient permissions/i)) signals.push('firestore-permission-denied');
  if (has(consoleTexts, /barryOrientationBrief/)) signals.push('barry-brief-not-served');

  let path = null;
  try {
    const u = new URL(url);
    if (!base || u.origin === new URL(base).origin) path = u.pathname;
  } catch { /* not a URL */ }
  const expected = contactId ? `/contact/${encodeURIComponent(contactId)}` : null;
  const result = (category, kind, reason) => ({ category, kind, reason, signals });

  if (/Something went wrong/.test(text) && /Reload/.test(text)) return result('rendering error', 'app-crashed', "The app's crash screen is showing.");
  if (path === null) return result('redirect', 'left-the-app', `The browser is not on the app (${redact(url)}).`);
  if (expected && path !== expected && path !== `${expected}/`) {
    if (path.startsWith('/contact-hub/person/')) return result('redirect', 'sent-to-contact-hub', 'Sent to the Contact Hub person page: the paid gate treated the account as Free.');
    if (path.startsWith('/scout/contact/')) return result('redirect', 'scout-panel', 'On the Scout side panel (/scout/contact/…), which has no Enrich button in its header; the journey expects the full page /contact/<id>.');
    if (path === '/scout' || path === '/scout/') return result('redirect', 'sent-to-scout', 'Sent to /scout: the contact page redirects there when the contact is not found.');
    if (path.startsWith('/checkout')) return result('redirect', 'still-at-checkout', 'Still on the checkout pages: the account was not seen as paid in time.');
    return result('redirect', 'elsewhere', `On ${path}, not ${expected}.`);
  }
  if (/Loading contact profile/i.test(text)) {
    return result('loading failure', 'still-loading', signals.includes('firestore-internal-assertion')
      ? 'The contact never finished loading, and the Firestore client reported an internal assertion: it stops serving reads until a reload.'
      : 'The contact never finished loading.');
  }
  if (/Contact Not Found/i.test(text)) return result('loading failure', 'not-found', 'The page says the contact was not found.');
  if (/This is part of Scout/i.test(text)) return result('redirect', 'upgrade-screen', "The upgrade screen is showing on the contact URL: the paid gate did not see the account as paid.");
  if (enrichInDom > 0) return result('selector issue', 'button-not-matched', "An Enrich button is in the DOM, but the step's selector did not find it (hidden, disabled or named differently).");
  return result('rendering error', 'no-button', 'The contact page rendered without an Enrich button.');
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

/**
 * Captures what the page showed. Never throws: a diagnostic that fails must not hide the step's
 * own error. `consoleLog` and `httpErrors` are the arrays the journey fills from page events.
 */
export async function captureDiagnostics(page, { out, stepName, consoleLog = [], httpErrors = [], base = null, contactId = null, classify = false }) {
  const at = new Date().toISOString();
  let url = null;
  let screenshot = null;
  let text = '';
  let enrichInDom = -1;
  try { url = page.url(); } catch { /* closed */ }
  try {
    screenshot = `${String(out).replace(/\.json$/, '')}-${slug(stepName)}.png`;
    await page.screenshot({ path: screenshot, fullPage: true, timeout: 10_000 });
  } catch { screenshot = null; }
  try { text = (await page.locator('body').innerText({ timeout: 5_000 })).replace(/\s+/g, ' ').trim(); } catch { /* no body */ }
  try { enrichInDom = await page.locator('[aria-label="Enrich contact"], [aria-label="Enriching contact"]').count(); } catch { /* ignore */ }
  const consoleTail = consoleLog.slice(-25).map((c) => ({ ...c, text: redact(c.text) }));
  const httpTail = httpErrors.slice(-25);
  // Only a step that expects the contact page gets a cause; any other step gets the evidence.
  const diagnosis = classify ? classifyPageFailure({ base, url, text, consoleTexts: consoleTail.map((c) => c.text), enrichInDom, contactId }) : null;
  return { at, url: redact(url), screenshot, visibleText: redact(text.slice(0, 2_000)), enrichInDom, diagnosis, console: consoleTail, httpErrors: httpTail };
}
