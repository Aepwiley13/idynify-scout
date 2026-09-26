/**
 * Does VITE_FIREBASE_API_KEY belong to VITE_FIREBASE_PROJECT_ID?
 *
 * On 2026-09-22 the answer was no, and nothing noticed. The Netlify
 * environment held one project's id alongside another project's API key, and
 * every sign-in in production was checked against the second project's user
 * database — where the accounts did not exist — while every screen displayed
 * the first project's name. Sign-in returned auth/invalid-credential, password
 * resets silently sent nothing, and the outage lasted hours.
 *
 * Nothing in the codebase could have caught it. vite.config.js checks that all
 * six client variables are PRESENT; it cannot check that they describe the
 * same project. checkNoHardcodedProjectId.mjs bans literals in source, and
 * these were not literals — they were correct-looking values in an env var.
 * The failure lived in the gap between "configured" and "coherent".
 *
 * HOW THE ANSWER IS OBTAINED. Identity Toolkit will name the project that owns
 * an API key, without authentication:
 *
 *     GET identitytoolkit.googleapis.com/v1/projects?key=<API_KEY>
 *     → { "projectId": "263090641220", "authorizedDomains": [ … ] }
 *
 * `projectId` there is the project NUMBER, not the string id — and the project
 * number is exactly what VITE_FIREBASE_MESSAGING_SENDER_ID already holds. So
 * the two values we need are both to hand, and comparing them answers the
 * question the deployment could not.
 *
 * WHAT FAILS THE BUILD, AND WHAT DOES NOT. Only a definitive answer stops a
 * deploy: the key names a different project, or Google rejects the key
 * outright. Anything else — a timeout, a 500, an unrecognised body — returns
 * `unknown` and warns, because a check that cannot reach Google must not be
 * able to take deploys down with it. The failure mode this guards against is
 * silent and lasts hours; the failure mode of an over-eager guard is loud and
 * blocks every release. Prefer the loud one to be impossible.
 */

/** Endpoint that names the project owning an API key. */
const ENDPOINT = 'https://identitytoolkit.googleapis.com/v1/projects';

/** A hung request must never hold a deploy open. */
const TIMEOUT_MS = 8000;

/**
 * @typedef {{status: 'ok', projectNumber: string}
 *          |{status: 'mismatch', expected: string, actual: string}
 *          |{status: 'invalid-key'}
 *          |{status: 'unknown', reason: string}
 *          |{status: 'skipped', reason: string}} Verdict
 */

/**
 * @param {object}   opts
 * @param {string=}  opts.apiKey    VITE_FIREBASE_API_KEY
 * @param {string=}  opts.senderId  VITE_FIREBASE_MESSAGING_SENDER_ID (the project number)
 * @param {Function=} opts.fetchImpl  injected for tests
 * @returns {Promise<Verdict>}
 */
export async function checkKeyMatchesProject({ apiKey, senderId, fetchImpl = fetch }) {
  if (!apiKey || !senderId) {
    // vite.config.js already fails the build when either is missing. Saying it
    // twice, in a different voice, would only make the real message harder to
    // find in the log.
    return { status: 'skipped', reason: 'VITE_FIREBASE_API_KEY or VITE_FIREBASE_MESSAGING_SENDER_ID is unset' };
  }

  let response;
  try {
    response = await fetchImpl(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { status: 'unknown', reason: `request failed: ${err?.message || err}` };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return { status: 'unknown', reason: `response was not JSON (HTTP ${response.status})` };
  }

  // A rejected key is a definitive answer, not a transport problem.
  if (body?.error?.details?.some?.((d) => d?.reason === 'API_KEY_INVALID') ||
      body?.error?.status === 'INVALID_ARGUMENT') {
    return { status: 'invalid-key' };
  }

  if (!response.ok) {
    return { status: 'unknown', reason: `HTTP ${response.status}: ${body?.error?.message || 'no message'}` };
  }

  const actual = body?.projectId;
  if (typeof actual !== 'string' || actual === '') {
    return { status: 'unknown', reason: 'response contained no projectId' };
  }

  return String(actual) === String(senderId)
    ? { status: 'ok', projectNumber: String(actual) }
    : { status: 'mismatch', expected: String(senderId), actual: String(actual) };
}

/**
 * Render a verdict, and say whether it should stop the build.
 *
 * @param {Verdict} verdict
 * @param {string=} projectId  VITE_FIREBASE_PROJECT_ID, for the message only
 * @returns {{fatal: boolean, text: string}}
 */
export function describeVerdict(verdict, projectId = '(unset)') {
  switch (verdict.status) {
    case 'ok':
      return { fatal: false, text: `✓ VITE_FIREBASE_API_KEY belongs to ${projectId} (project ${verdict.projectNumber})` };

    case 'skipped':
      return { fatal: false, text: `· Firebase key/project check skipped — ${verdict.reason}` };

    case 'unknown':
      return { fatal: false, text: `! Firebase key/project check could not complete — ${verdict.reason}\n  Not failing the build: unreachable is not the same as wrong.` };

    case 'invalid-key':
      return {
        fatal: true,
        text:
          '\n✗ VITE_FIREBASE_API_KEY was rejected by Google as invalid.\n\n' +
          '  Every sign-in on this build would fail. Copy the key from\n' +
          '  Firebase Console → Project settings → General → Web API Key.\n',
      };

    case 'mismatch':
      return {
        fatal: true,
        text:
          '\n✗ VITE_FIREBASE_API_KEY belongs to a DIFFERENT Firebase project.\n\n' +
          `    configured project  ${projectId} (number ${verdict.expected})\n` +
          `    the key's project   number ${verdict.actual}\n\n` +
          '  Firebase Auth routes by API key, not by projectId, so this build\n' +
          '  would check credentials against the wrong project\'s user database\n' +
          '  while displaying the configured name everywhere. Sign-in would\n' +
          '  return auth/invalid-credential for everyone and password resets\n' +
          '  would silently send nothing. This is the 2026-09-22 outage.\n\n' +
          '  Fix: Firebase Console → Project settings → General → Web API Key,\n' +
          '  for the project above, into VITE_FIREBASE_API_KEY.\n',
      };

    default:
      return { fatal: false, text: `! unrecognised verdict: ${JSON.stringify(verdict)}` };
  }
}
