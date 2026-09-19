/**
 * requireProjectId — the server half of "no silent fallback to production".
 *
 * Twenty-two call sites read the Firebase project as
 *
 *     process.env.FIREBASE_PROJECT_ID || 'idynify-scout-dev'
 *
 * which meant an environment with no FIREBASE_PROJECT_ID did not fail. It
 * quietly connected to the one project that serves real customers, and did so
 * from branch deploys and previews as readily as from production. The literal
 * was the whole safety net and it was pointed the wrong way.
 *
 * There is no fallback now. A missing variable throws, and because the
 * admin-init blocks that call this run at module scope, it throws at COLD
 * START — before a handler can touch anybody's data, and visibly in the
 * function log rather than as a wrong-database write nobody notices.
 *
 * On the name: the project is called `idynify-scout-dev` and it IS production.
 * That is history, not environment (ADR-006). Nothing here should be read as
 * suggesting a separate dev project exists.
 */

/**
 * The Firebase project this function must talk to.
 *
 * @throws {Error} when FIREBASE_PROJECT_ID is unset or empty.
 * @returns {string}
 */
export function requireProjectId() {
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (!projectId) {
    throw new Error(
      'FIREBASE_PROJECT_ID is not set. This function will not guess: it used ' +
      'to default to the production project, which is how a misconfigured ' +
      'deploy reached real customer data without anyone noticing. Set ' +
      'FIREBASE_PROJECT_ID in the Netlify environment for this context.'
    );
  }

  return projectId;
}
