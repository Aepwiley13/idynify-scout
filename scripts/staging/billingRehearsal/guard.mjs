/**
 * BILLING REHEARSAL — the safety checks. Pure: no I/O, no network, nothing printed.
 *
 * The rehearsal drives the real stripe-webhook handler and the real manual-recovery
 * transaction against a Firestore that is NOT production, with a Stripe client that is a
 * local fixture. Everything here exists to make the two ways that could go wrong impossible
 * rather than unlikely:
 *
 *   1. The wrong Firestore. There are exactly two acceptable targets:
 *        - 'emulator': FIRESTORE_EMULATOR_HOST names a loopback address. The project id is
 *          then only a namespace inside the emulator; it must be a "demo-" project (which
 *          Firebase guarantees cannot reach a real backend) or the staging project's name.
 *        - 'staging': the one project pinned in STAGING_PROJECT below, reached with a
 *          credential that belongs to that same project.
 *      Any other project id is refused. This is an allowlist of one, not a denylist: the
 *      production project is refused because it is not the pinned name, and additionally
 *      because PRODUCTION_FIREBASE_PROJECT_ID must be set and must differ.
 *
 *   2. A real Stripe account. The handler's Stripe client is replaced by a fixture
 *      (fixtures.mjs), and the only key and webhook secret the rehearsal accepts are the two
 *      constants below, which are not credentials for anything. A live-mode key anywhere in
 *      the environment is refused outright, even though nothing would use it.
 *
 * STAGING_PROJECT is the single place this repository pins a project name in code. It is not
 * a fallback and nothing connects with it: it is the value every candidate target is refused
 * against. scripts/checkNoHardcodedProjectId.mjs lists this file as an exception for that
 * reason.
 */
export const STAGING_PROJECT = 'idynify-staging';

/** Not credentials. The fixture Stripe client refuses to be constructed with anything else. */
export const FIXTURE_STRIPE_KEY = 'sk_test_rehearsal_fixture_not_a_real_key';
export const FIXTURE_WEBHOOK_SECRET = 'whsec_rehearsal_fixture_not_a_real_secret';
export const FIXTURE_PRICES = Object.freeze({
  STRIPE_PRICE_STARTER: 'price_rehearsal_starter',
  STRIPE_PRICE_PRO: 'price_rehearsal_pro',
  STRIPE_PRICE_SCOUT_STARTER_FREE: 'price_rehearsal_free',
});

/** The emulator namespace used when nothing else names one. "demo-" cannot reach a real backend. */
export const EMULATOR_PROJECT = 'demo-billing-rehearsal';

export const REPORT_VARIABLE = 'BILLING_REHEARSAL_REPORT';
export const MODE_VARIABLE = 'BILLING_REHEARSAL_MODE';
export const CONFIRM_VARIABLE = 'BILLING_REHEARSAL_CONFIRM_PROJECT';
export const RUN_ID_VARIABLE = 'BILLING_REHEARSAL_RUN_ID';
export const KEEP_VARIABLE = 'BILLING_REHEARSAL_KEEP_DATA';

/** Every variable that can name a Google project to a client library. */
export const PROJECT_VARIABLES = Object.freeze([
  'FIREBASE_PROJECT_ID', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'VITE_FIREBASE_PROJECT_ID',
]);

export class RehearsalRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = 'RehearsalRefusal';
  }
}

const set = (v) => typeof v === 'string' && v.trim() !== '';

/** host[:port] where host is localhost, 127.0.0.1 or [::1]. Nothing else is "the emulator". */
export function isLoopbackHost(hostPort) {
  if (!set(hostPort)) return false;
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/.test(hostPort.trim());
}

const RUN_ID = /^[a-z0-9]{6,24}$/;

export function assertRunId(runId) {
  if (!set(runId) || !RUN_ID.test(runId)) {
    throw new RehearsalRefusal('The run id must be 6 to 24 lowercase letters or digits.');
  }
  return runId;
}

/** A run id nobody has used: UTC time to the second plus four random characters. */
export function newRunId(now = new Date(), random = Math.random) {
  const stamp = now.toISOString().replace(/[^0-9]/g, '').slice(2, 14);
  const tail = Math.floor(random() * 36 ** 4).toString(36).padStart(4, '0');
  return `${stamp}${tail}`;
}

/**
 * Refuses unless the only Stripe values in the environment are the fixtures.
 * `strict` (the default, used inside the run) requires them to be present and exact.
 * Non-strict (the launcher, before it builds the child environment) only refuses live keys.
 */
export function assertStripeFixturesOnly(env, { strict = true } = {}) {
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== 'string') continue;
    if (/(^|[^a-z])(sk|rk)_live_/i.test(value)) {
      throw new RehearsalRefusal(`${name} holds a Stripe live-mode key. The rehearsal never runs with one in its environment.`);
    }
  }
  if (!strict) return;
  if (env.STRIPE_SECRET_KEY !== FIXTURE_STRIPE_KEY) {
    throw new RehearsalRefusal('STRIPE_SECRET_KEY is not the rehearsal fixture. No real Stripe key, test or live, is used.');
  }
  if (env.STRIPE_WEBHOOK_SECRET !== FIXTURE_WEBHOOK_SECRET) {
    throw new RehearsalRefusal('STRIPE_WEBHOOK_SECRET is not the rehearsal fixture.');
  }
  for (const [name, value] of Object.entries(FIXTURE_PRICES)) {
    if (env[name] !== value) throw new RehearsalRefusal(`${name} is not the rehearsal fixture price.`);
  }
}

/**
 * Where would this environment send Firestore traffic, and is that allowed?
 * Returns { mode: 'emulator' | 'staging', projectId } or throws RehearsalRefusal.
 *
 * `credential` is what stagingCredentials.readStagingCredential() returned (or null).
 */
export function resolveTarget(env, { credential = null } = {}) {
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!set(projectId)) throw new RehearsalRefusal('FIREBASE_PROJECT_ID is not set. The rehearsal does not guess a project.');

  const production = env.PRODUCTION_FIREBASE_PROJECT_ID;
  if (set(production) && production === projectId) throw new RehearsalRefusal('That is the production project.');
  if (set(production) && production === STAGING_PROJECT) {
    throw new RehearsalRefusal('PRODUCTION_FIREBASE_PROJECT_ID names the staging project. One of the two is wrong; refusing.');
  }

  const emulatorHost = env.FIRESTORE_EMULATOR_HOST;
  if (set(emulatorHost)) {
    if (!isLoopbackHost(emulatorHost)) {
      throw new RehearsalRefusal('FIRESTORE_EMULATOR_HOST is set but is not a loopback address. Refusing to treat a remote host as the emulator.');
    }
    for (const name of PROJECT_VARIABLES) {
      const value = env[name];
      if (set(value) && !(value.startsWith('demo-') || value === STAGING_PROJECT)) {
        throw new RehearsalRefusal(`${name} is neither a "demo-" project nor the staging project.`);
      }
    }
    return { mode: 'emulator', projectId };
  }

  if (projectId !== STAGING_PROJECT) {
    throw new RehearsalRefusal('The project is not the staging project. The rehearsal runs against the emulator or the one pinned staging project, nothing else.');
  }
  for (const name of PROJECT_VARIABLES) {
    const value = env[name];
    if (set(value) && value !== STAGING_PROJECT) throw new RehearsalRefusal(`${name} names a different project than FIREBASE_PROJECT_ID.`);
  }
  if (!set(production)) {
    throw new RehearsalRefusal('Set PRODUCTION_FIREBASE_PROJECT_ID so the production project can be ruled out by name as well.');
  }
  if (env[CONFIRM_VARIABLE] !== STAGING_PROJECT) {
    throw new RehearsalRefusal('Writing to staging needs the explicit confirmation: --apply --confirm-project=<the staging project id>.');
  }
  if (!credential) {
    throw new RehearsalRefusal('A credential for the staging project is required (GOOGLE_APPLICATION_CREDENTIALS or STAGING_SERVICE_ACCOUNT_KEY).');
  }
  if (credential.projectId !== STAGING_PROJECT) {
    throw new RehearsalRefusal('The credential belongs to a different project than the staging project.');
  }
  return { mode: 'staging', projectId };
}

/**
 * The second check, made once the Admin SDK exists and before the first read or write: what
 * project do the SDK's own objects say they are bound to? `appProjectId` is the initialized
 * app's option, `firestoreProjectId` the Firestore client's. FAIL CLOSED: a value that is
 * missing or could not be read is a refusal, not a pass, and the two must agree.
 */
export function assertClientProject(target, { appProjectId, firestoreProjectId }) {
  const acceptable = (id) => id === STAGING_PROJECT || (target?.mode === 'emulator' && typeof id === 'string' && id.startsWith('demo-'));
  if (target?.mode !== 'staging' && target?.mode !== 'emulator') throw new RehearsalRefusal('No checked target to compare the client against.');
  for (const [label, id] of [['Admin app', appProjectId], ['Firestore client', firestoreProjectId]]) {
    if (!set(id)) throw new RehearsalRefusal(`The ${label}'s project id could not be resolved. Refusing rather than assuming it is the checked one.`);
    if (!acceptable(id)) throw new RehearsalRefusal(`The ${label} is bound to a different project than the one that was checked.`);
  }
  if (appProjectId !== firestoreProjectId) throw new RehearsalRefusal('The Admin app and the Firestore client name different projects.');
  if (target.mode === 'staging' && firestoreProjectId !== target.projectId) {
    throw new RehearsalRefusal('The Firestore client is bound to a different project than the one that was checked.');
  }
  return firestoreProjectId;
}

/** Reads both ids from the live SDK objects; anything unreadable comes back null (and is then refused). */
export function readClientProject(db, app) {
  const safe = (fn) => {
    try {
      return fn() ?? null;
    } catch {
      return null;
    }
  };
  return { appProjectId: safe(() => app.options.projectId), firestoreProjectId: safe(() => db.projectId) };
}

// ── Rehearsal data: what a rehearsal may create, and therefore what it may delete ────────────

/** The only collections a rehearsal document may live in. */
export const REHEARSAL_COLLECTIONS = Object.freeze([
  'users', 'billingAllocations', 'billingAmbiguousAccounts', 'stripeWebhookEvents', 'stripeWebhookPendingEvents',
]);

/** The run's marker as it appears in a Firebase uid and in a Stripe-shaped id. */
export const uidPrefix = (runId) => `rehearsal-${assertRunId(runId)}-`;
export const stripeIdInfix = (runId) => `_rehearsal_${assertRunId(runId)}_`;

export function isRehearsalUid(value, runId) {
  return typeof value === 'string' && value.startsWith(uidPrefix(runId)) && value.length > uidPrefix(runId).length;
}

export function isRehearsalStripeId(value, runId) {
  return typeof value === 'string' && /^(cus|sub|cs|evt|in)_rehearsal_/.test(value) && value.includes(stripeIdInfix(runId));
}

/**
 * Throws unless `path` is a document this run created and may therefore delete:
 * a known collection, and an id carrying this run's marker. billingAmbiguousAccounts
 * documents have random ids, so for those the record's own `uid` is what must carry it.
 */
export function assertRehearsalDocPath(path, runId, { data = undefined } = {}) {
  const parts = String(path ?? '').split('/');
  const [collection, id] = parts;
  if (!REHEARSAL_COLLECTIONS.includes(collection) || !id) {
    throw new RehearsalRefusal(`Refusing to touch ${path}: not a rehearsal collection.`);
  }
  if (collection === 'users') {
    if (parts.length !== 2 || !isRehearsalUid(id, runId)) throw new RehearsalRefusal(`Refusing to touch ${path}: not this run's user.`);
    return path;
  }
  if (collection === 'billingAmbiguousAccounts') {
    if (parts.length !== 2 || !isRehearsalUid(data?.uid, runId)) {
      throw new RehearsalRefusal(`Refusing to touch ${path}: the record's uid is not this run's.`);
    }
    return path;
  }
  if (collection === 'stripeWebhookPendingEvents') {
    const ok = parts.length === 4 && parts[2] === 'events' && isRehearsalStripeId(id, runId) && isRehearsalStripeId(parts[3], runId);
    if (!ok) throw new RehearsalRefusal(`Refusing to touch ${path}: not this run's parked event.`);
    return path;
  }
  if (parts.length !== 2 || !isRehearsalStripeId(id, runId)) throw new RehearsalRefusal(`Refusing to touch ${path}: not this run's document.`);
  return path;
}
