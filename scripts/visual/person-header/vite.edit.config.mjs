/**
 * A local page for looking at the person header's INLINE EDITING: the real PersonHeader, the real
 * useContactIdentityEdit hook, the real saveContactFields and the app's own theme variables, with synthetic contacts.
 * Firebase is replaced by stand-ins (editStubs/), so no Firebase code is loaded and nothing can reach any project,
 * production or staging. No .env file is read.
 *
 *   npx vite --config scripts/visual/person-header/vite.edit.config.mjs        (a private port, 5311)
 *   ~/.nvm/versions/node/v22.23.4/bin/node scripts/visual/person-header/captureEdit.mjs <output folder>
 *
 * ?theme=workspace|mission   light or dark          ?latency=3500   how long a save takes (ms)
 * ?fail=1                    every save fails       ?readonly=1     an impersonated session (no edit controls)
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const stub = (name) => fileURLToPath(new URL(`./editStubs/${name}`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  envDir: fileURLToPath(new URL('./', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: [
      { find: 'firebase/firestore', replacement: stub('firestore.js') },
      { find: /^(?:\.\.?\/)+firebase\/config$/, replacement: stub('firebaseConfig.js') },
      { find: /^(?:\.\.?\/)+context\/ImpersonationContext$/, replacement: stub('impersonation.js') },
    ],
  },
  optimizeDeps: { entries: ['scripts/visual/person-header/edit.html'] },
  server: { host: '127.0.0.1', port: 5311, strictPort: true, open: false },
});
