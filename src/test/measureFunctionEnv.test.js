/**
 * #734 Phase 0, question 6: scripts/measureFunctionEnv.mjs and the Netlify CLI
 * runner it shares with measureFunctionDurations.
 *
 * Pins what is counted (Functions scope, the value each context gets, a site
 * variable over a team one, no branch-only values), the byte formula, the
 * secret-flagged marking, that only the two read methods are called, and that
 * no value reaches the output or an error message.
 */
import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  valueFor, functionEnvironment, summarize, formatText, parseArgs, resolveSiteId, main, API_METHODS,
} from '../../scripts/measureFunctionEnv.mjs';
import { runNetlify, netlifyApi, NetlifyCliError } from '../../scripts/netlifyCli.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7secretmaterial\n-----END PRIVATE KEY-----\n';
const VALUES = ['sk_live_51Hsecretvalue', 'sk_test_51Hpreviewvalue', 'BEGIN PRIVATE KEY', 'secretmaterial', 'team-shared-value', 'branch-only-value', 'build-only-value', '********'];

const SITE_ITEMS = [
  { key: 'FIREBASE_PRIVATE_KEY', scopes: ['functions'], is_secret: true, values: [{ context: 'all', value: PRIVATE_KEY }] },
  { key: 'STRIPE_SECRET_KEY', scopes: ['builds', 'functions'], is_secret: false, values: [
    { context: 'production', value: 'sk_live_51Hsecretvalue' },
    { context: 'deploy-preview', value: 'sk_test_51Hpreviewvalue' },
    { context: 'branch', context_parameter: 'staging', value: 'branch-only-value' },
  ] },
  { key: 'VITE_FIREBASE_APP_ID', scopes: ['builds'], values: [{ context: 'all', value: 'build-only-value' }] },
  { key: 'SHARED_FLAG', scopes: ['functions'], values: [{ context: 'production', value: 'on' }] },
];
const TEAM_ITEMS = [
  { key: 'SHARED_FLAG', scopes: ['functions'], values: [{ context: 'all', value: 'team-shared-value' }] },
  { key: 'TEAM_ONLY', scopes: ['functions', 'runtime'], is_secret: true, values: [{ context: 'all', value: '********' }] },
];

function fakeApi({ team = TEAM_ITEMS, site = SITE_ITEMS, teamFails = false } = {}) {
  const calls = [];
  const api = async (method, data) => {
    calls.push([method, data]);
    if (method === 'getSite') return { id: data.site_id, account_slug: 'acme-team', name: 'site-name' };
    if (method === 'getEnvVars' && data.site_id) return site;
    if (method === 'getEnvVars') {
      if (teamFails) throw new NetlifyCliError('`netlify api` failed (exit 1)');
      return team;
    }
    throw new Error(`unexpected ${method}`);
  };
  return { api, calls };
}

describe('what is counted', () => {
  it('the context\'s own value, else the all-contexts one; never a branch-only value', () => {
    const values = SITE_ITEMS[1].values;
    expect(valueFor(values, 'production').value).toBe('sk_live_51Hsecretvalue');
    expect(valueFor(values, 'deploy-preview').value).toBe('sk_test_51Hpreviewvalue');
    expect(valueFor(values, 'branch-deploy')).toBeNull();
    expect(valueFor([{ context: 'all', value: 'x' }], 'branch-deploy').value).toBe('x');
    expect(valueFor(undefined, 'production')).toBeNull();
  });

  it('Functions scope only, the site over the team, key + value + 2 bytes, secrets marked', () => {
    const production = functionEnvironment({ teamItems: TEAM_ITEMS, siteItems: SITE_ITEMS }, 'production');
    expect(production.map(v => v.key)).toEqual(['FIREBASE_PRIVATE_KEY', 'STRIPE_SECRET_KEY', 'TEAM_ONLY', 'SHARED_FLAG']);
    const byKey = Object.fromEntries(production.map(v => [v.key, v]));
    expect(byKey.STRIPE_SECRET_KEY.bytes).toBe('STRIPE_SECRET_KEY'.length + 'sk_live_51Hsecretvalue'.length + 2);
    expect(byKey.SHARED_FLAG).toMatchObject({ bytes: 'SHARED_FLAG'.length + 2 + 2, source: 'site' });
    expect(byKey.FIREBASE_PRIVATE_KEY).toMatchObject({ secret: true, bytes: 'FIREBASE_PRIVATE_KEY'.length + Buffer.byteLength(PRIVATE_KEY) + 2 });
    expect(production.every(v => !('value' in v))).toBe(true);

    const preview = functionEnvironment({ teamItems: TEAM_ITEMS, siteItems: SITE_ITEMS }, 'deploy-preview');
    expect(Object.fromEntries(preview.map(v => [v.key, v.source])).SHARED_FLAG).toBe('team');
    const branch = functionEnvironment({ teamItems: TEAM_ITEMS, siteItems: SITE_ITEMS }, 'branch-deploy');
    expect(branch.map(v => v.key)).not.toContain('STRIPE_SECRET_KEY');
  });

  it('totals per context, against 4,096', () => {
    const report = summarize({ teamItems: TEAM_ITEMS, siteItems: SITE_ITEMS });
    const production = report.contexts.production;
    expect(production.variables).toBe(4);
    expect(production.bytes).toBe(Object.values(production.sizes).reduce((a, b) => a + b, 0));
    expect(production.headroom).toBe(4096 - production.bytes);
    expect(production).toMatchObject({ secretVariables: 2, secretKeys: ['FIREBASE_PRIVATE_KEY', 'TEAM_ONLY'] });
    expect(report.contexts['branch-deploy'].variables).toBe(3);
  });
});

describe('end to end', () => {
  it('reads with getSite and getEnvVars only, and prints names and sizes, never a value', async () => {
    const { api, calls } = fakeApi();
    let out = '';
    expect(await main(['--site', 'site-123'], { api, write: s => { out += s; } })).toBe(0);
    expect(calls).toEqual([
      ['getSite', { site_id: 'site-123' }],
      ['getEnvVars', { account_id: 'acme-team', site_id: 'site-123' }],
      ['getEnvVars', { account_id: 'acme-team' }],
    ]);
    expect([...new Set(calls.map(([method]) => method))].every(m => API_METHODS.includes(m))).toBe(true);
    expect(out).toMatch(/FIREBASE_PRIVATE_KEY \*/);
    expect(out).toMatch(/variables\s+4\s+4\s+3/);
    expect(VALUES.filter(v => out.includes(v))).toEqual([]);

    let json = '';
    await main(['--json'], { api, env: { NETLIFY_SITE_ID: 'site-123' }, write: s => { json += s; } });
    expect(JSON.parse(json).readOnly).toBe(true);
    expect(VALUES.filter(v => json.includes(v))).toEqual([]);
  });

  it('counts the site\'s variables when team variables cannot be read, and says so', async () => {
    const { api } = fakeApi({ teamFails: true });
    let out = '';
    expect(await main(['--site=site-123'], { api, write: s => { out += s; } })).toBe(0);
    expect(out).toMatch(/Team-level variables could not be read/);
    expect(out).not.toMatch(/TEAM_ONLY/);
  });

  it('finds the site id from --site, NETLIFY_SITE_ID or the linked checkout, else stops', async () => {
    expect(resolveSiteId({ site: 'a' }, { env: { NETLIFY_SITE_ID: 'b' } })).toBe('a');
    expect(resolveSiteId({}, { env: { NETLIFY_SITE_ID: ' b ' } })).toBe('b');
    expect(resolveSiteId({}, { env: {}, readFile: () => '{"siteId":"c"}' })).toBe('c');
    expect(() => resolveSiteId({}, { env: {}, readFile: () => { throw new Error('ENOENT'); } })).toThrow(/netlify link/);
    expect(() => parseArgs(['--site'])).toThrow(/needs a site id/);
    expect(() => parseArgs(['--apply'])).toThrow(/unknown argument/);
    let err = '';
    expect(await main([], { api: fakeApi().api, env: {}, readFile: () => { throw new Error('x'); }, warn: s => { err += s; } })).toBe(1);
    expect(err).toMatch(/no site id/);
  });

  it('an unexpected error is reported without its message', async () => {
    let err = '';
    const api = async () => { throw new Error('response quoted sk_live_51Hsecretvalue'); };
    expect(await main(['--site', 's'], { api, warn: s => { err += s; } })).toBe(1);
    expect(err).not.toMatch(/sk_live/);
  });

  it('formatText marks secret-flagged sizes as the mask\'s', () => {
    const text = formatText(summarize({ teamItems: [], siteItems: SITE_ITEMS }));
    expect(text).toMatch(/secret-flagged: Netlify masks the value/);
  });
});

describe('the Netlify CLI runner', () => {
  it('returns stdout, and never echoes stderr when the CLI fails', async () => {
    const ok = (cmd, args, opts, cb) => cb(null, `${cmd} ${args.join(' ')}`, '');
    expect(await runNetlify(['logs', '--json'], { exec: ok })).toBe('netlify logs --json');
    const failing = (cmd, args, opts, cb) => cb(Object.assign(new Error('boom'), { code: 2 }), '', 'Error: STRIPE_SECRET_KEY=sk_live_51Hsecretvalue');
    await expect(runNetlify(['env:list'], { exec: failing })).rejects.toThrow(/`netlify env:list` failed \(exit 2\)/);
    await expect(runNetlify(['env:list'], { exec: failing })).rejects.not.toThrow(/sk_live/);
    const missing = (cmd, args, opts, cb) => cb(Object.assign(new Error('spawn netlify ENOENT'), { code: 'ENOENT' }));
    await expect(runNetlify(['logs'], { exec: missing })).rejects.toThrow(/npm install -g netlify-cli/);
  });

  it('netlify api: passes the data as JSON and parses the answer', async () => {
    let seen;
    const exec = (cmd, args, opts, cb) => { seen = args; cb(null, '{"id":"s"}'); };
    expect(await netlifyApi('getSite', { site_id: 's' }, { exec })).toEqual({ id: 's' });
    expect(seen).toEqual(['api', 'getSite', '--data', '{"site_id":"s"}']);
    const notJson = (cmd, args, opts, cb) => cb(null, 'Not logged in');
    await expect(netlifyApi('getSite', {}, { exec: notJson })).rejects.toThrow(/did not return JSON/);
  });
});

describe('read-only at the source', () => {
  it('calls only the two read methods, and writes no file', () => {
    const script = readFileSync(resolve(repo, 'scripts/measureFunctionEnv.mjs'), 'utf8');
    const called = [...script.matchAll(/\bapi\(\s*'([A-Za-z]+)'/g)].map(m => m[1]);
    expect([...new Set(called)].sort()).toEqual(['getEnvVars', 'getSite']);
    for (const file of ['scripts/measureFunctionEnv.mjs', 'scripts/netlifyCli.mjs', 'scripts/measureFunctionDurations.mjs']) {
      const source = readFileSync(resolve(repo, file), 'utf8');
      expect(source, file).not.toMatch(/\b(?:writeFile|writeFileSync|appendFile|createWriteStream|console\.(?:log|info|warn|error))\b/);
      expect(source, file).not.toMatch(/env:(?:set|unset|import|clone)|createEnvVars|updateEnvVar|deleteEnvVar|setEnvVarValue/);
    }
  });
});
