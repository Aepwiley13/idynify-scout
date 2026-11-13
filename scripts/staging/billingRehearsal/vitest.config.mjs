/**
 * Vitest configuration for a STAGING rehearsal run only (scripts/staging/billingRehearsal.mjs
 * --apply). Plain Node, no jsdom and no browser test setup: the run talks to Firestore with
 * Google's client libraries, which must see a Node environment, not a simulated browser.
 * The repository's own configuration (vite.config.js) is untouched and still runs this spec
 * in the emulator job.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  // Load NO .env files. Vitest otherwise reads the repository's .env.test and copies its
  // VITE_* values into process.env, which put a unit-test project name
  // (VITE_FIREBASE_PROJECT_ID) into a staging run. The launcher builds this run's whole
  // environment explicitly; nothing may be added to it from a file.
  envDir: false,
  test: {
    // Second layer of fail-fast (the spec halts itself too): stop at the first failed step.
    bail: 1,
    environment: 'node',
    include: ['src/test/stripeWebhookStagingRehearsal.test.js'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
