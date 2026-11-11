#!/usr/bin/env node
/**
 * Production-equivalent function bundle check.
 *
 * Bundles each target Netlify Function with esbuild and actually imports
 * the bundle under plain Node — not Vitest. Vite (and therefore Vitest)
 * injects a working import.meta.env; Netlify's esbuild-bundled runtime does
 * not. A test that "passes under vitest" proves nothing about this failure
 * mode — see src/test/noBrowserImportsInFunctions.test.js's own header for
 * the incident this caught.
 *
 * TWO FORMATS, BOTH TESTED — verified against the real bundler, not assumed:
 * @netlify/zip-it-and-ship-it (the library netlify-cli and Netlify's build
 * actually run) picks the esbuild `format` per function based on its
 * runtimeAPIVersion (dist/runtimes/node/bundlers/esbuild/bundler_target.js,
 * getModuleFormat): only runtimeAPIVersion 2 (the modern Functions runtime,
 * or the zisi_pure_esm* feature flags) gets 'esm'. Everything still in
 * Lambda-compatibility mode — runtimeAPIVersion 1, which per issue #734's
 * own Phase 0 findings is what all three functions this hotfix touches
 * still are — falls through to 'cjs'. So 'cjs' is the format that is
 * ACTUALLY deployed today; 'esm' is what these functions would get AFTER
 * the (separate, not-yet-approved) Phase 1 migration to the modern
 * runtime. Both are tested so this check stays correct across that
 * migration rather than needing to be revisited.
 *
 * esbuild transpiles import.meta references when targeting a non-ESM
 * format — it cannot do otherwise, since `import.meta` is not valid
 * CommonJS syntax at all. Netlify's own bundler source rewrites exactly
 * this case's build warning (its id is literally 'empty-import-meta') to:
 * "import.meta" is not available and will be empty, use __dirname instead.
 * That is: import.meta becomes {} in the bundle, so import.meta.env is
 * undefined, and .VITE_FIREBASE_API_KEY on undefined is the exact crash
 * reported in production — confirmed below in both formats, not assumed
 * from reading the bundler's source alone.
 *
 * Usage:
 *   node scripts/verifyFunctionBundlesInitialize.mjs                  # the known-risky set, both formats
 *   node scripts/verifyFunctionBundlesInitialize.mjs --all            # every function in netlify/functions, both formats
 *   node scripts/verifyFunctionBundlesInitialize.mjs --format=cjs …   # restrict to one format
 *   node scripts/verifyFunctionBundlesInitialize.mjs path/to/fn.js …  # specific files
 *
 * Exit code is non-zero if any target fails to initialize in either format.
 */
import { build } from 'esbuild';
import { readdirSync, mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const functionsDir = resolve(repoRoot, 'netlify/functions');

const DEFAULT_TARGETS = [
  'netlify/functions/gmail-poll-replies.js',
  'netlify/functions/gmail-reply-sync-worker.js',
  'netlify/functions/process-scheduled-engagements.js',
];

// cjs first — it's the format actually deployed today for these
// runtimeAPIVersion-1 functions; esm is what they'd get post-migration.
const FORMATS = ['cjs', 'esm'];

function allFunctionFiles() {
  return readdirSync(functionsDir)
    .filter((f) => extname(f) === '.js')
    .map((f) => `netlify/functions/${f}`);
}

function externalPackages() {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
}

/**
 * Fake-but-well-formed values — never real secrets, never reused anywhere
 * else — just enough for firebase-admin's cert()/initializeApp() to parse
 * without throwing on malformed ASN.1. No network call happens at
 * module-load time, only at actual later Firestore use, which this script
 * never reaches. Generated locally and thrown away:
 *   openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt
 */
const FAKE_ENV = {
  FIREBASE_PROJECT_ID: 'verify-bundle-fake-project',
  FIREBASE_CLIENT_EMAIL: 'fake@verify-bundle-fake-project.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY:
    '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCesMHHL+toibls\neCAdC2v8K4CbZD2wF3klqE95TQJvFVXSX0AhbAE/dFGrFtiJlhxf+rAin+mqZq/T\nB9KpH02J/XRRj3xvt4DicyvTllDoXoTy5Km7KQOHgRJjV7r+rSaP7v6TGfnHXmAR\nYaxru75LcYlfmGf6K4RpsU4XURg5JoU2IUWWG418GjYVJTnkGSC4HiAZ7pu1ihJD\naU2V4MHCybjAfxhRHbAc/95ZJwl+nHzwJp+yH2ozvgwfBj532ECEJQay48ubsfWk\n/nI8zSt5e3ea4IrihQ4OSzKBEet6II85Z9orKPY1iucwOhkedzBK2PPQFqki/2gR\nVApBPgsfAgMBAAECggEADKHjexi8c6DrCtBxNf6vxO4tmbEcHAVyVmYUlYJk3DTl\nlQ6SC1cOrl9zFNyHtkQl1BofpVH3huIPwwvPYDkmsgJkHQ4ACOChuOUUKw6/OBA2\nIyPCwyxbpJDIxvG36AgelryetVUPBijkGt4cnKLgXh8WoW5/cHHAY62CmuaQuBPR\n0FTP0aylmW+FYrqln3W6PL+ZZS7X9DRslkdgmzjVd201WzJ3wgNS2h30He8q+2tv\n+LSersOALH/ehEHuKg8DqhZHoltyw+pdsxQsB9ghU9zuQJ8MnS6HE2fmsq6+c8fD\nmhheNruze0mGI41StTj8C/g2Xh1uAo0zV+yHjYsm4QKBgQDRHwXbYPjXaoZIKq9H\noURqDZ0uAJkjJJCFpxkYfhDdrEK8HoCko827fsbWHZefDdzug7T9WA329uELDZPj\nGPWddvELvTVYRdRos/4eiB1WDm6uAJp2d6YXvaGWxprk8n3mb7QwaHUaBwIDefDV\n4Hv5/5pTQ+bwCg34zbPucZ14EQKBgQDCQ6HcOSLxcJJ3TPF8+kmpvLeBP3Mm3J9q\n0NIBDI2pSfgOOqkSWM8nCm60Ia+oux5Kv6NfWhu1e5K1+/sk88GHLLV9mk70IJGP\nOdP2Rmr6wtL6Gyqv3Gmr4O40HLstd0jK8qDBgXF1Feaw66bs2f2zkqEYQ2A/WtWR\nXKhUPQUALwKBgCD7I5FV2ekfg84d7Ub+yCtxujhnH7/LJH/vuqWCPGa5pEzHAsL0\nkp3fgLyELkWHijCT1Refq5Qnm5aCrbBDX3lWKO4RCTjCyp04xftKvFW2MP6AWdwV\nQry7y6Bb8lHpbLHLLD/2OYHBWS/zK2iP3v2uskgvjVyOOWXkC1yvzoYBAoGAKYQ2\ntU/ordy3EJP7EBCVaZcRSKf8vhNsZnGWT+8U31cVkkTrGSatrtRF8G06kz7aLHNk\nQN6LCXANXKMreyw08eSWLO+ra/UB5rAfIoTOHCVC3Xys1MSwOLFrduuk/QR/JBBS\nVsiJLNKvaKQUGo5D7/qoPv03NpL9DYHV35ri1LUCgYEArQXpFCY5AnX1Wtq51/RP\nA+prgD/EV2QLA/9gL9QfIXYpQx3gX2XxPB3nTmsD40J6y2d1NHhIz5rbwt3udxRN\natwHTu+YQ3sna1++KClwi1W6WpU/h2srUEisCkgwgTdT/LTcXxGqbLojkBGtESEe\nc+ja9pkDu+JC9yJYf0GVADA=\n-----END PRIVATE KEY-----\n',
};

/**
 * CJS output under this repo's own package.json ("type": "module") would
 * be misparsed by Node unless forced unambiguous by extension. .cjs and
 * .mjs are both extension-forced regardless of any package.json "type",
 * so this never depends on — or risks disturbing — the repo's own module
 * type.
 */
function outputExtensionFor(format) {
  return format === 'esm' ? '.mjs' : '.cjs';
}

async function verifyOne(relPath, format) {
  const entry = resolve(repoRoot, relPath);
  // Must live under repoRoot, not the system tmpdir — Node resolves the
  // externalized bare imports (googleapis, @netlify/functions, …) by
  // walking UP from the importing file looking for node_modules, and only
  // repoRoot/node_modules actually has them installed.
  const verifyRoot = resolve(repoRoot, '.verify-bundle-tmp');
  mkdirSync(verifyRoot, { recursive: true });
  const outdir = mkdtempSync(join(verifyRoot, 'bundle-'));
  const outfile = join(outdir, `bundle${outputExtensionFor(format)}`);

  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format,
    outfile,
    external: externalPackages(),
    logLevel: 'silent',
  });

  const prevEnv = { ...process.env };
  Object.assign(process.env, FAKE_ENV);
  try {
    await import(`file://${outfile}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  } finally {
    process.env = prevEnv;
    rmSync(outdir, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const formatArg = args.find((a) => a.startsWith('--format='));
  const formats = formatArg ? [formatArg.split('=')[1]] : FORMATS;
  const positional = args.filter((a) => !a.startsWith('--'));

  let targets;
  if (args.includes('--all')) {
    targets = allFunctionFiles();
  } else if (positional.length > 0) {
    targets = positional;
  } else {
    targets = DEFAULT_TARGETS;
  }

  console.log(
    `Verifying ${targets.length} function bundle(s) x ${formats.length} format(s) ` +
    `(${formats.join(', ')}) initialize under plain Node...\n`
  );

  let failed = 0;
  let total = 0;
  for (const format of formats) {
    console.log(`--- format: ${format} ---`);
    for (const t of targets) {
      total++;
      process.stdout.write(`  ${t} ... `);
      try {
        const result = await verifyOne(t, format);
        if (result.ok) {
          console.log('OK');
        } else {
          failed++;
          console.log('FAILED');
          console.log(`    ${result.error.constructor.name}: ${result.error.message}`);
        }
      } catch (buildErr) {
        failed++;
        console.log('BUNDLE ERROR');
        console.log(`    ${buildErr.message}`);
      }
    }
  }

  console.log(`\n${total - failed}/${total} initialized successfully.`);
  if (failed > 0) {
    console.error(`${failed} function bundle(s) FAILED to initialize.`);
    process.exit(1);
  }
}

main();
