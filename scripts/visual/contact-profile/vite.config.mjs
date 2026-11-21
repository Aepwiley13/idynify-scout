/**
 * The redesigned CONTACT PROFILE, working, in a local browser page. Real components: ConnectedPersonHeader (identity
 * editing, photo viewing and changing, the shared sticker behaviour, the real picker and photo viewer), IdentityCard
 * variant="details" (the existing email, phone and social editors), the real StickersProvider and ThemeProvider.
 *
 * Only PERSISTENCE is a stand-in (stubs/): Firestore, the sticker services and the account are replaced, so no
 * Firebase code is loaded and nothing can reach any project, production or staging. No .env file is read. Edits
 * live in the page's memory (a reload resets them) and every write is listed at the bottom of the page.
 *
 *   npx vite --config scripts/visual/contact-profile/vite.config.mjs
 *   open http://127.0.0.1:5311/scripts/visual/contact-profile/profile.html
 *
 * It uses a PRIVATE port (5311). Ports 8888 and 5199 belong to other teams.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.VITE_CONTACT_HUB = 'on';
process.env.VITE_CONTACT_HUB_GMAIL = 'on';
const stub = (name) => fileURLToPath(new URL(`./stubs/${name}`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  envDir: fileURLToPath(new URL('./', import.meta.url)),
  cacheDir: join(tmpdir(), 'idynify-contact-profile-vite'),
  plugins: [react()],
  resolve: {
    alias: [
      { find: 'firebase/firestore', replacement: stub('firestore.js') },
      { find: /^(?:\.\.?\/)+firebase\/config$/, replacement: stub('firebaseConfig.js') },
      { find: /^(?:\.\.?\/)+context\/ImpersonationContext$/, replacement: stub('impersonation.js') },
      { find: /^(?:\.\.?\/)+services\/contactStickers$/, replacement: stub('contactStickers.js') },
      { find: /^(?:\.\.?\/)+services\/stickerService$/, replacement: stub('stickerService.js') },
      { find: /^\.\/stickersApi\.js$/, replacement: stub('stickersApi.js') },
      { find: /^(?:\.\.?\/)+utils\/brigadeSystem$/, replacement: stub('brigadeSystem.js') },
      { find: /^(?:\.\.?\/)+services\/peopleService$/, replacement: stub('peopleService.js') },
      { find: /^(?:\.\.?\/)+scout\/CompanyDetailModal$/, replacement: stub('CompanyDetailModal.jsx') },
    ],
  },
  optimizeDeps: { entries: ['scripts/visual/contact-profile/profile.html'] },
  server: { host: '127.0.0.1', port: 5311, strictPort: true, open: false },
});
