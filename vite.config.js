import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The client Firebase config, which src/firebase/config.js reads from
 * import.meta.env. All six are required: Firebase silently builds a broken app
 * from a partial config rather than complaining, so a missing storageBucket
 * surfaces as a failed upload weeks later rather than as a failed build.
 *
 * None of these is secret — a Firebase web config ships to every browser — so
 * the point of this gate is configuration, not confidentiality.
 */
const REQUIRED_CLIENT_ENV = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

/**
 * Fail the BUILD when the client Firebase config is incomplete.
 *
 * These values were literals in src/firebase/config.js until they were moved
 * to the environment. The risk that move introduces is a build that succeeds
 * with `undefined` in every field and produces an app that white-screens on
 * first Firestore call — the operator sees a green deploy and the user sees
 * nothing. So the check runs here, at build time, where it can still stop the
 * deploy and print the names of what is missing.
 *
 * `apply: 'build'` keeps it out of `vite dev` and out of vitest, neither of
 * which needs a real Firebase project to be useful.
 */
function requireClientFirebaseEnv(mode) {
  return {
    name: 'require-client-firebase-env',
    apply: 'build',
    config() {
      // '' prefix loads every var, not just VITE_-prefixed ones, and picks up
      // process.env — which is how Netlify supplies them, with no .env file.
      const env = loadEnv(mode, process.cwd(), '')
      const missing = REQUIRED_CLIENT_ENV.filter((key) => !env[key] && !process.env[key])

      if (missing.length > 0) {
        throw new Error(
          `\n\nBuild stopped: the client Firebase config is incomplete.\n\n` +
          `Missing: ${missing.join(', ')}\n\n` +
          `Set these in the Netlify site's environment variables (or a local\n` +
          `.env — see .env.example) and rebuild. src/firebase/config.js reads\n` +
          `all six from import.meta.env and no longer falls back to literals,\n` +
          `so building without them produces an app that cannot reach Firebase.\n`
        )
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), requireClientFirebaseEnv(mode)],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },
}))
