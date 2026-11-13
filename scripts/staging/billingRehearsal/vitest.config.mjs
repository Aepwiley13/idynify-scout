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
  test: {
    environment: 'node',
    include: ['src/test/stripeWebhookStagingRehearsal.test.js'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
