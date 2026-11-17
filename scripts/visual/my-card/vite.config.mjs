/**
 * A local page for looking at My Card's editor and preview: the real
 * components, the real stylesheet and the app's own theme variables, with
 * sample data. It imports nothing from Firebase, so it cannot reach any
 * project, production or staging, and it loads no .env file.
 *
 *   npx vite --config scripts/visual/my-card/vite.config.mjs
 *   http://127.0.0.1:5199/scripts/visual/my-card/index.html?scenario=new&theme=mission
 *   http://127.0.0.1:5199/scripts/visual/my-card/page.html?state=existing&theme=mission   (the whole page)
 *
 * scripts/visual/my-card/capture.mjs takes the review screenshots from it.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Where the stand-ins live, and what they stand in for (the page imports these by relative path).
const stub = (name) => fileURLToPath(new URL(`./stubs/${name}`, import.meta.url));

export default defineConfig({
  // The repository root, so the app's own postcss and tailwind setup applies.
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  // This folder has no env files: nothing from the repository's environment is read.
  envDir: fileURLToPath(new URL('./', import.meta.url)),
  plugins: [react()],
  resolve: {
    // The My Card page is looked at with sample data: Firebase auth, the card service and the
    // impersonation context are replaced, so no Firebase code is loaded at all.
    alias: [
      { find: /^(?:\.\.?\/)+firebase\/config$/, replacement: stub('firebaseConfig.js') },
      { find: /^(?:\.\.?\/)+services\/myCardService$/, replacement: stub('myCardService.js') },
      { find: /^(?:\.\.?\/)+context\/ImpersonationContext$/, replacement: stub('impersonation.js') },
    ],
  },
  server: { host: '127.0.0.1', port: 5199, strictPort: true, open: false },
});
