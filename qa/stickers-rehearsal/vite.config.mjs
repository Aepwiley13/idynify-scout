// End-to-end rehearsal: the real People and Contact Profile pages, the real
// stickersConfig function, the real firestore.rules, on local emulators.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import process from 'node:process';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = 'demo-contact-hub';
const REPO = process.env.REPO;
const here = (p) => resolve(import.meta.dirname, p);
function functions() {
  return {
    name: 'netlify-functions',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const m = /^\/\.netlify\/functions\/(stickersConfig)$/.exec(req.url.split('?')[0]);
        if (!m) return next();
        let body = '';
        for await (const chunk of req) body += chunk;
        const mod = await server.ssrLoadModule(resolve(REPO, `netlify/functions/${m[1]}.js`));
        const out = await mod.handler({ httpMethod: req.method, headers: req.headers, body });
        res.statusCode = out.statusCode;
        for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v);
        res.end(out.body);
      });
    },
  };
}
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), functions()],
  resolve: {
    alias: [
      { find: /^.*\/firebase\/config(\.js)?$/, replacement: here('client/firebaseConfig.js') },
      { find: /^\.\.?\/firebase-admin\.js$/, replacement: here('server/firebaseAdmin.js') },
      { find: '@repo', replacement: resolve(REPO, 'src') },
    ],
  },
  server: { port: 5299, strictPort: true, fs: { allow: [import.meta.dirname, REPO, '/home/user/idynify-scout/node_modules'] } },
});
