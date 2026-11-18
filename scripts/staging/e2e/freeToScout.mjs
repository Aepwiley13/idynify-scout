#!/usr/bin/env node
/**
 * STAGING ONLY: the Free → Scout journey, end to end, in a real browser.
 *
 *   sign up Free (no card) → My Card → add and import people → stickers and a note →
 *   the Scout preview on a person → Upgrade to Scout → Stripe Checkout (test mode, 4242…) →
 *   back on the same person in Scout → enrich them (mocked Apollo) → credits charged once →
 *   nothing the customer made is lost or changed → (optional) Starter → Pro.
 *
 * It runs against the local app started by
 *   node scripts/staging/stagingDev.mjs --env=<staging env file> --billing --apollo-mock
 * with, in the env file, VITE_CONTACT_HUB=on, VITE_FREE_PLAN=on, VITE_STRIPE_ENABLED=true and
 * CREDIT_METERING=on, plus `stripe listen` forwarding to the local webhook
 * (docs/billing/CHECKOUT_TEST_MODE_VALIDATION.md §2). Apollo is the local stand-in: no real
 * Apollo request is made, and the test checks that.
 *
 * Every check that reads data does so read-only, through the same staging-only guard as
 * billingAccountSnapshot.mjs (staging project, test-mode Stripe key, never production).
 *
 *   PRODUCTION_FIREBASE_PROJECT_ID=<production id> STRIPE_SECRET_KEY=<rk_test_… from the env file> \
 *     node scripts/staging/e2e/freeToScout.mjs [--headed] [--with-pro] [--skip-my-card]
 *
 * Exit code 0 only if every step passed; 2 if any failed; 3 if all ran but some were pending.
 */
import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseE2eArgs, JourneyRefusal, FIVE_PEOPLE_CSV, FOCUS_PERSON, isPaidRequest, compareAccount, summarize } from './journey.mjs';
import { planSnapshot, readFirestore, readStripe, summarizeAccount, SnapshotRefusal } from '../billingAccountSnapshot.mjs';
import { readStagingCredential, CredentialRefusal } from '../stagingCredentials.mjs';
import { RehearsalRefusal, assertClientProject, readClientProject } from '../billingRehearsal/guard.mjs';
import { DEFAULT_APOLLO_MOCK_PORT } from '../apolloMock.mjs';

const MOCK = `http://127.0.0.1:${DEFAULT_APOLLO_MOCK_PORT}`;
const STEP_TIMEOUT = 30_000;

async function readTree(db, uid) {
  const out = {};
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  out[''] = userSnap.exists ? userSnap.data() : null;
  async function walk(ref, prefix, depth) {
    for (const coll of await ref.listCollections()) {
      for (const doc of (await coll.get()).docs) {
        const path = `${prefix}${coll.id}/${doc.id}`;
        out[path] = doc.data();
        if (depth < 3) await walk(doc.ref, `${path}/`, depth + 1);
      }
    }
  }
  await walk(userRef, '', 1);
  return out;
}

async function mockCalls() {
  const res = await fetch(`${MOCK}/__calls`);
  return (await res.json()).calls;
}

async function run(args) {
  const steps = [];
  const step = async (name, fn) => {
    const started = Date.now();
    try {
      const outcome = (await fn()) ?? {};
      steps.push({ name, status: outcome.pending ? 'pending' : 'pass', detail: outcome.detail ?? '', ms: Date.now() - started });
      return outcome;
    } catch (err) {
      steps.push({ name, status: 'fail', detail: err?.message ?? String(err), ms: Date.now() - started });
      throw err;
    }
  };

  // Read-only access to staging, refused for anything else.
  const plan = planSnapshot(process.env, readStagingCredential(process.env));
  if (!plan.stripeKey) throw new JourneyRefusal('Set STRIPE_SECRET_KEY (the test-mode key from the staging env file) so the test can check Stripe.');
  for (const [name, value] of Object.entries(plan.env)) if (value !== undefined) process.env[name] = value;
  const { db, admin } = await import('../../../netlify/functions/firebase-admin.js');
  const { getApp } = await import('firebase-admin/app');
  assertClientProject(plan.target, readClientProject(db, getApp()));
  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(plan.stripeKey);
  const billing = async (uid) => {
    const firestore = await readFirestore(db, uid);
    return summarizeAccount({ ...firestore, stripe: await readStripe(stripe, firestore.user?.stripeCustomerId ?? null) });
  };

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT);
  const requests = [];
  let phase = 'free';
  page.on('request', (r) => { if (r.url().includes('/.netlify/functions/')) requests.push({ phase, url: r.url(), paid: isPaidRequest(r.url()) }); });

  let uid;
  let personPath;
  let before;
  const report = () => ({ email: args.email, uid, steps, requests });

  try {
    await fetch(`${MOCK}/__reset`, { method: 'POST' }).catch(() => {
      throw new JourneyRefusal(`The Apollo stand-in is not running at ${MOCK}. Start the app with stagingDev.mjs --apollo-mock.`);
    });

    await step('1. Sign up Free, no card', async () => {
      await page.goto(`${args.base}/signup`);
      await page.locator('input[type="email"]').fill(args.email);
      await page.getByPlaceholder('Create a strong password').fill(args.password);
      await page.getByRole('button', { name: /create account/i }).click();
      await page.waitForURL(/\/contact-hub(\/|$)/, { timeout: 60_000 });
      uid = (await admin.auth().getUserByEmail(args.email)).uid;
      const account = (await db.collection('users').doc(uid).get()).data();
      if (account?.hasCompletedPayment || account?.stripeCustomerId) throw new Error('A new Free account already has billing fields.');
      return { detail: `uid ${uid}` };
    });

    await step('2. Create, edit and share My Card', async () => {
      if (args.skipMyCard) return { pending: true, detail: 'skipped (--skip-my-card): My Card is the Contact Hub team\'s work in progress' };
      const entry = page.getByRole('link', { name: /my card/i }).or(page.getByRole('button', { name: /my card/i }));
      if (!(await entry.count())) return { pending: true, detail: 'My Card is not in this build; run on the branch with the Contact Hub team\'s My Card' };
      // The Contact Hub team adds the create/edit/share steps here when My Card is merged.
      return { pending: true, detail: 'My Card found; its steps come with the Contact Hub team\'s branch' };
    });

    await step('3. Import five contacts from a CSV file straight away, then add one person', async () => {
      await page.goto(`${args.base}/contact-hub`);
      // The first-run screen offers both: no one has to be added by hand before importing.
      await page.getByText('Start with one person').waitFor();
      await page.getByRole('button', { name: 'Import Contacts' }).click();
      await page.getByTestId('csv-upload').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(FIVE_PEOPLE_CSV) });
      await page.getByText('Preview: people.csv').waitFor();
      await page.getByRole('button', { name: 'Import 5 contacts' }).click();
      await page.getByText('5 people added.').waitFor();
      await page.getByRole('button', { name: 'Add Person' }).first().click();
      await page.getByPlaceholder('John Doe').fill('Morgan First');
      await page.getByRole('dialog').getByRole('button', { name: 'Add Person' }).click();
      await page.getByText('Morgan First was added to My People.').waitFor();
      const contacts = await db.collection('users').doc(uid).collection('contacts').get();
      if (contacts.size !== 6) throw new Error(`Expected 6 people in users/{uid}/contacts, found ${contacts.size}.`);
      return { detail: '5 imported from the first screen, 1 added; 6 in the canonical contacts collection' };
    });

    await step('4. Organize: a sticker and a note on one person', async () => {
      await page.getByRole('link', { name: FOCUS_PERSON }).first().click();
      await page.waitForURL(/\/contact-hub\/person\//);
      personPath = `contacts/${decodeURIComponent(page.url().split('/person/')[1])}`;
      await page.getByRole('button', { name: /^Add sticker/ }).first().click();
      await page.getByPlaceholder('Search or create…').fill('Friends');
      await page.getByRole('option', { name: /Create sticker .Friends./ }).click();
      await page.getByText('Friends').first().waitFor();
      await page.getByRole('button', { name: '+ Add Note' }).click();
      await page.getByPlaceholder(/Write a quick note/).fill('Met at the E2E gala');
      await page.getByRole('button', { name: 'Save' }).click();
      await page.getByText('Met at the E2E gala').waitFor();
      return { detail: `${FOCUS_PERSON}: sticker "Friends", one note` };
    });

    await step('5. See what Scout could add, with no paid request', async () => {
      await page.getByRole('heading', { name: 'Scout can fill in the rest' }).waitFor();
      const paid = requests.filter((r) => r.paid);
      if (paid.length) throw new Error(`A Free account made paid requests: ${paid.map((r) => r.url).join(', ')}`);
      const apollo = await mockCalls();
      if (apollo.length) throw new Error(`Apollo was called ${apollo.length} time(s) for a Free account.`);
      before = await readTree(db, uid);
      return { detail: `no paid request among ${requests.length} function calls; account snapshot taken (${Object.keys(before).length} documents)` };
    });

    await step('6. Upgrade to Scout and pay with Stripe (test mode)', async () => {
      phase = 'upgrade';
      await page.getByRole('button', { name: 'Upgrade to Scout' }).click();
      await page.getByRole('link', { name: /Scout Starter/ }).click();
      await page.waitForURL(/\/checkout\?tier=starter&returnTo=/);
      await page.getByRole('button', { name: /complete purchase/i }).click();
      await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
      try {
        await page.locator('#cardNumber').fill('4242424242424242', { timeout: 20_000 });
        await page.locator('#cardExpiry').fill('12 / 34');
        await page.locator('#cardCvc').fill('123');
        const name = page.locator('#billingName');
        if (await name.count()) await name.fill('E2E Test');
        const zip = page.locator('#billingPostalCode');
        if (await zip.count() && await zip.isVisible()) await zip.fill('84101');
        await page.locator('button[type="submit"]').first().click();
      } catch (err) {
        if (!args.headed) throw new Error(`Stripe's checkout page did not match the expected fields (${err.message}). Rerun with --headed and pay with 4242 4242 4242 4242 by hand.`);
        console.log('  → Complete the payment in the browser window with 4242 4242 4242 4242 (any future date, any CVC).');
      }
      await page.waitForURL(`${args.base}/checkout/success**`, { timeout: 5 * 60_000 });
      return { detail: 'paid on Stripe\'s test-mode page' };
    });

    await step('7. Back on the same person in Scout, with Scout unlocked', async () => {
      const contactId = personPath.split('/')[1];
      await page.waitForURL(new RegExp(`/contact/${encodeURIComponent(contactId)}(\\?|$)`), { timeout: 90_000 });
      await page.getByRole('button', { name: 'Enrich contact' }).waitFor();
      const summary = await billing(uid);
      const bad = summary.checks.filter((c) => !c.ok);
      if (summary.plan !== 'starter') throw new Error(`Plan is ${summary.plan}, expected starter.`);
      if (bad.length) throw new Error(`Billing checks failed: ${bad.map((c) => c.id).join(', ')}`);
      if ((await admin.auth().getUserByEmail(args.email)).uid !== uid) throw new Error('The account changed.');
      return { detail: 'same uid; one customer, one subscription, 400 credits, one grant' };
    });

    await step('7b. Scout is open with no second signup, import or onboarding', async () => {
      const personUrl = page.url();
      await page.goto(`${args.base}/`);
      await page.waitForURL(/\/contact-hub(\/|$)/, { timeout: 30_000 });
      if (/\/barry|\/onboarding|\/signup|\/checkout/.test(page.url())) throw new Error(`Sent to ${page.url()} after upgrading.`);
      await page.goto(`${args.base}/scout`);
      await page.waitForLoadState('networkidle');
      if (await page.getByRole('heading', { name: 'This is part of Scout' }).count()) throw new Error('Scout still shows the upgrade screen.');
      await page.goto(personUrl);
      await page.getByRole('button', { name: 'Enrich contact' }).waitFor();
      return { detail: 'home is Contact Hub; Scout opens; back on the person' };
    });

    await step(args.expectMetering ? '8. Enrich the person in Scout; credits charged once' : '8. Enrich the person in Scout (metering off: nothing charged)', async () => {
      phase = 'paid';
      const creditsBefore = (await db.collection('users').doc(uid).get()).data().credits.remaining;
      await page.getByRole('button', { name: 'Enrich contact' }).click();
      await page.getByRole('button', { name: 'Enrich contact' }).waitFor({ timeout: 60_000 });
      const calls = await mockCalls();
      if (!calls.length) throw new Error('Enrichment did not reach the Apollo stand-in.');
      if (calls.some((c) => !c.mockKey)) throw new Error('A request reached the stand-in without the mock key.');
      const after = (await db.collection('users').doc(uid).get()).data().credits.remaining;
      const ledger = (await db.collection('users').doc(uid).collection('creditTransactions').get()).docs.map((d) => d.data());
      const charged = creditsBefore - after;
      if (!args.expectMetering) {
        if (charged !== 0 || ledger.length) throw new Error(`Metering is expected off, but credits changed (${creditsBefore} → ${after}) or were logged. Is CREDIT_METERING set in the env file?`);
        return { detail: `enriched with ${calls.length} mocked Apollo call(s); metering off, nothing charged` };
      }
      if (charged <= 0) throw new Error(`Credits did not go down (${creditsBefore} → ${after}). Is CREDIT_METERING=on in the env file?`);
      if (ledger.filter((e) => e.cost > 0).length !== 1) throw new Error(`Expected one charge in the credit log, found ${ledger.length} entries.`);
      // A second press within the retry window replays the answer: no Apollo call, no charge.
      const callsBefore = (await mockCalls()).length;
      await page.getByRole('button', { name: 'Enrich contact' }).click();
      await page.getByRole('button', { name: 'Enrich contact' }).waitFor({ timeout: 60_000 });
      const again = (await db.collection('users').doc(uid).get()).data().credits.remaining;
      if (again !== after) throw new Error(`A repeated enrichment within the retry window charged again (${after} → ${again}).`);
      if ((await mockCalls()).length !== callsBefore) throw new Error('A repeated enrichment within the retry window called Apollo again.');
      return { detail: `${charged} credit(s) charged once; a repeat within the window charged nothing; ${calls.length} mocked Apollo call(s)` };
    });

    await step('9. Nothing the customer made was lost or changed', async () => {
      const afterTree = await readTree(db, uid);
      const problems = compareAccount(before, afterTree, { enrichedContactPath: personPath });
      if (problems.length) throw new Error(problems.map((p) => `${p.path}${p.field ? `.${p.field}` : ''}: ${p.problem}`).join('; '));
      return { detail: `${Object.keys(before).length} documents checked` };
    });

    if (args.withPro) {
      await step('10. Starter → Pro on the same subscription', async () => {
        const subBefore = (await db.collection('users').doc(uid).get()).data().stripeSubscriptionId;
        await page.goto(`${args.base}/settings?tab=billing`);
        await page.getByRole('button', { name: 'Upgrade to Pro' }).click();
        await page.getByRole('button', { name: 'Confirm upgrade' }).click();
        await page.getByText(/You are on Scout Pro/).waitFor({ timeout: 90_000 });
        const summary = await billing(uid);
        const account = (await db.collection('users').doc(uid).get()).data();
        if (account.stripeSubscriptionId !== subBefore) throw new Error('The subscription changed: a second subscription was created.');
        if (summary.checks.some((c) => c.id === 'one-live-subscription' && !c.ok)) throw new Error('More than one live subscription.');
        if (account.subscriptionTier !== 'pro') throw new Error(`Tier is ${account.subscriptionTier}.`);
        return { detail: `same subscription ${subBefore}; Pro; ${account.credits.remaining} credits` };
      });
    }
  } catch (err) {
    if (err instanceof JourneyRefusal) throw err;
    // The failed step is already recorded.
  } finally {
    await browser.close();
  }
  return report();
}

async function main() {
  let args;
  try {
    args = parseE2eArgs(process.argv.slice(2), { tmp: tmpdir() });
  } catch (err) {
    if (err instanceof JourneyRefusal) { console.error(`Refused: ${err.message}`); return 1; }
    throw err;
  }
  let result;
  try {
    result = await run(args);
  } catch (err) {
    if ([JourneyRefusal, SnapshotRefusal, RehearsalRefusal, CredentialRefusal].some((E) => err instanceof E)) {
      console.error(`Refused: ${err.message}`);
      return 1;
    }
    throw err;
  }
  const summary = summarize(result.steps);
  console.log(`Free → Scout journey for ${result.email} (${result.uid ?? 'no account'}) on the staging project:`);
  for (const line of summary.lines) console.log(`  ${line}`);
  writeFileSync(args.out, JSON.stringify({ ...result, summary }, null, 2));
  console.log(`Report: ${args.out}`);
  if (summary.failed) return 2;
  return summary.complete ? 0 : 3;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    console.error(`Failed: ${err?.name ?? 'error'}: ${err?.message ?? ''}`.trim());
    process.exitCode = 1;
  });
}
