/**
 * How big the Functions environment is in each deploy context
 * (#734, Phase 0, question 6).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  READ-ONLY. Reads the variables through the Netlify CLI you are logged   ║
 * ║  in with, measures them in memory, and prints variable names, counts     ║
 * ║  and byte sizes. A value is never printed, logged or written anywhere.   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * WHAT IS COUNTED: the site's and the team's variables that have the
 * Functions scope, for production, deploy-preview and branch-deploy, each
 * with the value that context gets (a site variable overrides a team one, as
 * in the Netlify CLI). Variables in netlify.toml reach builds, not functions,
 * and are not counted. Netlify adds its own variables at runtime (a few
 * hundred bytes); the API does not list them, so they are not counted either.
 *
 * BYTES: key + value + 2 per variable, as #734 and FIRESTORE_DATA_ARCHITECTURE.md
 * measure it, against AWS Lambda's 4,096.
 *
 * SECRETS: Netlify masks a value flagged "Contains secret values" everywhere
 * outside its own servers, so the size measured here for one is the mask's,
 * not the real value's. Those variables are marked and counted separately.
 *
 * USAGE
 *   node scripts/measureFunctionEnv.mjs --site <site id> [--json]
 *   (or set NETLIFY_SITE_ID, or run in a checkout linked with `netlify link`)
 *
 * EXIT CODES: 0 completed; 1 did not complete (bad arguments or the Netlify CLI).
 */
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { NetlifyCliError, netlifyApi } from './netlifyCli.mjs';

export const LIMIT = 4096;
export const CONTEXTS = Object.freeze(['production', 'deploy-preview', 'branch-deploy']);
/** The only Netlify API methods this script calls. Both read. */
export const API_METHODS = Object.freeze(['getSite', 'getEnvVars']);

const USAGE = `
Usage:
  node scripts/measureFunctionEnv.mjs --site <site id> [--json]
  (or set NETLIFY_SITE_ID, or run in a checkout linked with \`netlify link\`)
`;

class UsageError extends Error {}

/** The value a context gets: its own, else the one for all contexts. Branch-specific values are left out. */
export function valueFor(values, context) {
  const list = Array.isArray(values) ? values : [];
  return list.find(v => v?.context === context && !v.context_parameter) ?? list.find(v => v?.context === 'all') ?? null;
}

const bytes = text => Buffer.byteLength(typeof text === 'string' ? text : '', 'utf8');

/** One context's Functions environment: [{ key, bytes, secret, source }], values already dropped. */
export function functionEnvironment({ teamItems = [], siteItems = [] }, context) {
  const variables = new Map();
  for (const [source, items] of [['team', teamItems], ['site', siteItems]]) {
    for (const item of Array.isArray(items) ? items : []) {
      if (typeof item?.key !== 'string' || !Array.isArray(item.scopes) || !item.scopes.includes('functions')) continue;
      const value = valueFor(item.values, context);
      if (!value) continue;
      variables.set(item.key, { key: item.key, bytes: bytes(item.key) + bytes(value.value) + 2, secret: item.is_secret === true, source });
    }
  }
  return [...variables.values()].sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key));
}

export function summarize(items) {
  const contexts = Object.fromEntries(CONTEXTS.map(context => {
    const variables = functionEnvironment(items, context);
    const total = variables.reduce((sum, v) => sum + v.bytes, 0);
    const secret = variables.filter(v => v.secret);
    return [context, {
      variables: variables.length,
      bytes: total,
      percentOfLimit: Math.round((total / LIMIT) * 1000) / 10,
      headroom: LIMIT - total,
      secretVariables: secret.length,
      secretBytesAsMeasured: secret.reduce((sum, v) => sum + v.bytes, 0),
      sizes: Object.fromEntries(variables.map(v => [v.key, v.bytes])),
      secretKeys: secret.map(v => v.key),
    }];
  }));
  return { readOnly: true, limit: LIMIT, formula: 'key + value + 2 bytes per variable', teamVariablesRead: items.teamReadable !== false, contexts };
}

export function formatText(report) {
  const largest = key => Math.max(...CONTEXTS.map(c => report.contexts[c].sizes[key] ?? 0));
  const keys = [...new Set(CONTEXTS.flatMap(c => Object.keys(report.contexts[c].sizes)))]
    .sort((a, b) => largest(b) - largest(a) || a.localeCompare(b));
  const secret = new Set(CONTEXTS.flatMap(c => report.contexts[c].secretKeys));
  const width = Math.max(10, ...keys.map(k => k.length + 2));
  const line = (label, cells) => `  ${label.padEnd(width)}${cells.map(c => String(c).padStart(16)).join('')}`.trimEnd();
  const out = [
    'Functions environment by deploy context (#734 Phase 0, question 6). Read-only; names and byte sizes, never values.',
    `Bytes = ${report.formula}. AWS Lambda limit: ${report.limit}. Netlify adds its own variables on top (not counted).`,
    '',
    line('', CONTEXTS),
    line('variables', CONTEXTS.map(c => report.contexts[c].variables)),
    line('bytes', CONTEXTS.map(c => report.contexts[c].bytes)),
    line('% of 4096', CONTEXTS.map(c => `${report.contexts[c].percentOfLimit}%`)),
    line('headroom', CONTEXTS.map(c => report.contexts[c].headroom)),
    line('secret-flagged', CONTEXTS.map(c => report.contexts[c].secretVariables)),
    '',
    line('variable', CONTEXTS.map(() => 'bytes')),
    ...keys.map(k => line(`${k}${secret.has(k) ? ' *' : ''}`, CONTEXTS.map(c => report.contexts[c].sizes[k] ?? '-'))),
    '',
    '  * secret-flagged: Netlify masks the value outside its servers, so this size is the mask\'s, not the real value\'s.',
  ];
  if (!report.teamVariablesRead) out.push('  Team-level variables could not be read (team permissions); only site variables are counted.');
  return `${out.join('\n')}\n`;
}

export function parseArgs(argv) {
  const options = { site: null, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--site' || arg.startsWith('--site=')) {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[(i += 1)];
      if (!value || value.startsWith('--')) throw new UsageError('--site needs a site id');
      options.site = value;
    } else throw new UsageError(`unknown argument ${arg}`);
  }
  return options;
}

/** --site, else NETLIFY_SITE_ID, else the linked checkout's .netlify/state.json. */
export function resolveSiteId(options, { env = process.env, readFile = path => readFileSync(path, 'utf8') } = {}) {
  if (options.site) return options.site;
  if (typeof env.NETLIFY_SITE_ID === 'string' && env.NETLIFY_SITE_ID.trim()) return env.NETLIFY_SITE_ID.trim();
  try {
    const linked = JSON.parse(readFile('.netlify/state.json'))?.siteId;
    if (typeof linked === 'string' && linked) return linked;
  } catch {
    // not linked
  }
  throw new UsageError('no site id: pass --site <site id>, set NETLIFY_SITE_ID, or run `netlify link` here');
}

/** The team's and the site's variables. Nothing else is fetched. */
export async function collect(siteId, api) {
  const site = await api('getSite', { site_id: siteId });
  const account = site?.account_slug ?? site?.account_id;
  if (!account) throw new UsageError('the site response has no account');
  const siteItems = await api('getEnvVars', { account_id: account, site_id: siteId });
  let teamItems = [];
  let teamReadable = true;
  try {
    teamItems = await api('getEnvVars', { account_id: account });
  } catch {
    // Collaborators cannot read team variables; the Netlify CLI treats this the same way.
    teamReadable = false;
  }
  return { teamItems, siteItems, teamReadable };
}

export async function main(argv = process.argv.slice(2), {
  api = netlifyApi, env = process.env, readFile, write = s => process.stdout.write(s), warn = s => process.stderr.write(s),
} = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    warn(`function environment: ${error.message}\n${USAGE}`);
    return 1;
  }
  if (options.help) {
    write(USAGE);
    return 0;
  }
  try {
    const siteId = resolveSiteId(options, { env, ...(readFile ? { readFile } : {}) });
    const report = summarize(await collect(siteId, api));
    write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatText(report));
    return 0;
  } catch (error) {
    const known = error instanceof UsageError || error instanceof NetlifyCliError;
    // An unexpected error's message is not echoed: it could quote a response.
    warn(`function environment did not complete: ${known ? error.message : (error?.name ?? 'Error')}\n`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().then(code => process.exit(code), () => process.exit(1));
}
