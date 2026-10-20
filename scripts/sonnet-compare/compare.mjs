#!/usr/bin/env node
/**
 * Sonnet 4.5 vs Sonnet 5.5 on the Barry endpoints (#699) — validation only.
 *
 *   node scripts/sonnet-compare/compare.mjs            # dry run: capture + plan + cost estimate, sends nothing
 *   node scripts/sonnet-compare/compare.mjs --run      # send the requests, write the report
 *
 * It changes nothing in production and reads nothing from it. See README.md.
 */
import './register.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import Anthropic from '@anthropic-ai/sdk';
import { captureRequests } from './capture.mjs';
import { CHECKS, MESSAGE_WRITERS } from './checks.mjs';
import { readClaudeText, ClaudeResponseError } from '../../netlify/functions/utils/claudeResponse.js';
import { SONNET_4_5, SONNET_5_5, SONNET_4_6, barrySonnetOptions } from '../../netlify/functions/utils/models.js';

// ─── What is compared ───────────────────────────────────────────────────────

/**
 * Each variant is the captured request with these fields replaced. A variant
 * with `perSite` also gets that call site's own Sonnet 5.5 setting from
 * models.js, which is exactly what production sends on that model.
 */
const VARIANTS = {
  'sonnet-4.5': { model: SONNET_4_5 },
  // What production sends once BARRY_MODEL_SONNET is claude-sonnet-5-5.
  'sonnet-5.5-barry': { model: SONNET_5_5, perSite: true },
  // Thinking off: Sonnet 5.5's replacement for {type: 'disabled'}. Effort stays at its default (high).
  'sonnet-5.5-between-tools': { model: SONNET_5_5, thinking: { type: 'between_tools' } },
  // Adaptive thinking (the default) held down by effort.
  'sonnet-5.5-low': { model: SONNET_5_5, output_config: { effort: 'low' } },
  // Not run by default: a plain model swap, the shape #699 warns against.
  'sonnet-5.5-default': { model: SONNET_5_5 },
  // The fallback named in models.js, and the rollback target after 4.5 retires.
  'sonnet-4.6': { model: SONNET_4_6 },
};
const DEFAULT_VARIANTS = ['sonnet-4.5', 'sonnet-5.5-barry', 'sonnet-4.6'];

/** The fields a variant decides. A captured request may carry them if capture ran with BARRY_MODEL_SONNET set. */
const MODEL_SETTINGS = ['thinking', 'output_config'];

function variantRequest(request, variant, site) {
  const params = { ...request };
  for (const field of MODEL_SETTINGS) delete params[field];
  const { perSite, ...fields } = VARIANTS[variant];
  return { ...params, ...fields, ...(perSite ? barrySonnetOptions(site, fields.model) : {}) };
}

/** List prices per million tokens [input, output], from #699 and the pricing docs (2026-10). Re-check before relying on totals. */
const PRICES = { [SONNET_4_5]: [3, 15], [SONNET_4_6]: [3, 15], [SONNET_5_5]: [2, 10] };

// ─── CLI ────────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    run: { type: 'boolean', default: false },
    variants: { type: 'string', default: DEFAULT_VARIANTS.join(',') },
    sites: { type: 'string' },
    concurrency: { type: 'string', default: '2' },
    out: { type: 'string' },
    print: { type: 'string', default: 'writers' },
    'fake-api': { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (args.help) {
  console.log(`Usage: node scripts/sonnet-compare/compare.mjs [--run] [options]

  (no --run)          Dry run: capture the requests, print the plan and a cost ceiling. Sends nothing.
  --run               Send every request to every variant and write the report.
  --variants=a,b      Default ${DEFAULT_VARIANTS.join(',')}. Also: ${Object.keys(VARIANTS).filter((v) => !DEFAULT_VARIANTS.includes(v)).join(', ')}
  --sites=a,b         Only these call sites: ${Object.keys(CHECKS).join(', ')}
  --concurrency=N     Requests in flight at once (default 2).
  --out=DIR           Report directory (default .sonnet-compare/<timestamp>, git-ignored).
  --print=writers|all|none   Which replies to print for tone review (default writers).
  --fake-api          Offline self-test of this tool with a fake client. Sends nothing.
  --verbose           Show handler logs during capture.`);
  process.exit(0);
}

const variantNames = args.variants.split(',').map((v) => v.trim()).filter(Boolean);
const unknown = variantNames.filter((v) => !VARIANTS[v]);
if (unknown.length) fail(`unknown variant(s): ${unknown.join(', ')}. Known: ${Object.keys(VARIANTS).join(', ')}`);
const sites = args.sites ? args.sites.split(',').map((s) => s.trim()) : null;
if (sites?.some((s) => !CHECKS[s])) fail(`unknown site. Known: ${Object.keys(CHECKS).join(', ')}`);
const concurrency = Math.max(1, Number.parseInt(args.concurrency, 10) || 2);

function fail(message) {
  console.error(`sonnet-compare: ${message}`);
  process.exit(1);
}

// Checked before capture, which sets placeholder variables of its own for the handlers.
const hasCredentials = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
if (args.run && !args['fake-api'] && !hasCredentials) {
  fail('--run needs ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in your environment. It is read by the SDK and never printed.');
}

// ─── Run ────────────────────────────────────────────────────────────────────

const captured = await captureRequests({ verbose: args.verbose, only: sites });
const jobs = captured.flatMap((c, index) => variantNames.map((variant) => ({ ...c, index, variant })));

printPlan(captured, variantNames);
if (!args.run) {
  console.log('\nDry run: nothing was sent. Add --run to send these requests.');
  process.exit(0);
}

const client = args['fake-api'] ? fakeClient() : new Anthropic({ maxRetries: 0, timeout: 180_000 });
const results = await pool(jobs, concurrency, (job) => runOne(client, job));

const outDir = args.out ?? `.sonnet-compare/${new Date().toISOString().replace(/[:.]/g, '-')}`;
await mkdir(outDir, { recursive: true });
await writeFile(`${outDir}/results.json`, JSON.stringify({ variants: variantNames, fake: args['fake-api'], results }, null, 2));
await writeFile(`${outDir}/report.md`, markdownReport(results, variantNames, args['fake-api']));

printSummary(results, variantNames);
printReplies(results, variantNames, args.print);
console.log(`\nReport: ${outDir}/report.md\nRaw:    ${outDir}/results.json${args['fake-api'] ? '\n(FAKE API: these numbers test the tool, not the models.)' : ''}`);

// ─── One request ────────────────────────────────────────────────────────────

async function runOne(client, job) {
  const params = variantRequest(job.request, job.variant, job.site);
  const row = {
    site: job.site, label: job.label, index: job.index, variant: job.variant,
    modelRequested: params.model, modelAnswered: null, maxTokens: params.max_tokens,
    latencyMs: null, stopReason: null, inputTokens: null, outputTokens: null,
    outcome: null, note: '', text: null,
  };
  const started = performance.now();
  let response;
  try {
    // The fake client is told the site so it can answer in that endpoint's shape; the real SDK gets params only.
    response = client.fake ? await client.messages.create(params, job.site) : await client.messages.create(params);
  } catch (error) {
    row.latencyMs = Math.round(performance.now() - started);
    row.outcome = 'api_error';
    // Status and error type only: an API error body is not copied into the report.
    row.note = error instanceof Anthropic.APIError ? `HTTP ${error.status ?? '?'} ${error.error?.error?.type ?? ''}`.trim() : (error?.name ?? 'error');
    return row;
  }
  row.latencyMs = Math.round(performance.now() - started);
  row.modelAnswered = response.model ?? null;
  row.stopReason = response.stop_reason ?? null;
  row.inputTokens = response.usage?.input_tokens ?? null;
  row.outputTokens = response.usage?.output_tokens ?? null;

  try {
    row.text = readClaudeText(response);
  } catch (error) {
    if (!(error instanceof ClaudeResponseError)) throw error;
    row.outcome = error.reason; // refusal | truncated | empty | malformed
    row.note = error.reason === 'refusal' ? `category: ${error.category ?? 'none'}` : `stop_reason: ${error.stopReason ?? 'none'}`;
    return row;
  }
  const check = CHECKS[job.site](row.text, job.request);
  row.outcome = check.ok ? 'ok' : 'check_failed';
  row.note = check.note;
  return row;
}

async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  const tick = () => {
    done += 1;
    if (process.stderr.isTTY) process.stderr.write(`\r  ${done}/${items.length} requests`);
    else if (done % 10 === 0 || done === items.length) process.stderr.write(`  ${done}/${items.length} requests\n`);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
      tick();
    }
  }));
  if (process.stderr.isTTY) process.stderr.write('\n');
  return results;
}

// ─── Plan and cost ceiling ──────────────────────────────────────────────────

function printPlan(captured, variants) {
  const perSite = {};
  for (const c of captured) perSite[c.site] = (perSite[c.site] ?? 0) + 1;
  console.log(`\nCaptured ${captured.length} requests from the real handlers (synthetic fixtures, no network):`);
  for (const [site, n] of Object.entries(perSite)) {
    const r = captured.find((c) => c.site === site).request;
    console.log(`  ${site.padEnd(20)} ${String(n).padStart(2)} case(s)   max_tokens ${r.max_tokens}`);
  }
  let ceiling = 0;
  for (const c of captured) {
    // ~3.5 characters per token on the 4.x tokenizer; Sonnet 5.x uses ~30% more tokens for the same text.
    const baseInput = JSON.stringify(c.request.messages).length / 3.5;
    for (const v of variants) {
      const model = VARIANTS[v].model;
      const [inPrice, outPrice] = PRICES[model] ?? [3, 15];
      const input = model === SONNET_5_5 ? baseInput * 1.3 : baseInput;
      ceiling += (input * inPrice + c.request.max_tokens * outPrice) / 1e6;
    }
  }
  console.log(`\nVariants: ${variants.join(', ')}`);
  console.log(`Calls:    ${captured.length} × ${variants.length} = ${captured.length * variants.length}`);
  console.log(`Cost ceiling: about $${ceiling.toFixed(2)} (every reply at max_tokens; real spend is usually far lower)`);
}

// ─── Summary ────────────────────────────────────────────────────────────────

/** Nearest-rank percentile of an ascending list. */
function pct(sorted, p) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : null;
}

function mean(xs) {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

function summarize(rows) {
  const latencies = rows.map((r) => r.latencyMs).filter((x) => x != null).sort((a, b) => a - b);
  const count = (o) => rows.filter((r) => r.outcome === o).length;
  const spend = rows.reduce((sum, r) => {
    const [i, o] = PRICES[r.modelRequested] ?? [0, 0];
    return sum + ((r.inputTokens ?? 0) * i + (r.outputTokens ?? 0) * o) / 1e6;
  }, 0);
  return {
    n: rows.length, ok: count('ok'), checkFailed: count('check_failed'), refusal: count('refusal'),
    truncated: count('truncated'), empty: count('empty') + count('malformed'), apiError: count('api_error'),
    p50: pct(latencies, 50), p95: pct(latencies, 95),
    inTok: mean(rows.map((r) => r.inputTokens).filter((x) => x != null)),
    outTok: mean(rows.map((r) => r.outputTokens).filter((x) => x != null)),
    spend,
  };
}

function summaryRows(results, variants) {
  const out = [];
  for (const site of [...new Set(results.map((r) => r.site))]) {
    for (const v of variants) out.push({ site, variant: v, ...summarize(results.filter((r) => r.site === site && r.variant === v)) });
  }
  for (const v of variants) out.push({ site: 'ALL', variant: v, ...summarize(results.filter((r) => r.variant === v)) });
  return out;
}

function printSummary(results, variants) {
  const head = ['site', 'variant', 'ok', 'parse✗', 'refuse', 'trunc', 'empty', 'api✗', 'p50 ms', 'p95 ms', 'in tok', 'out tok', '$'];
  const rows = summaryRows(results, variants).map((s) => [
    s.site, s.variant, `${s.ok}/${s.n}`, s.checkFailed, s.refusal, s.truncated, s.empty, s.apiError,
    s.p50 ?? '-', s.p95 ?? '-', s.inTok ?? '-', s.outTok ?? '-', s.spend.toFixed(4),
  ].map(String));
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => cells.map((c, i) => (i < 2 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  console.log(`\n${line(head)}\n${widths.map((w) => '─'.repeat(w)).join('  ')}`);
  let lastSite = null;
  for (const r of rows) {
    if (lastSite && r[0] !== lastSite) console.log('');
    console.log(line(r));
    lastSite = r[0];
  }
}

// ─── Replies for tone review ────────────────────────────────────────────────

function byCase(results) {
  const cases = new Map();
  for (const r of results) {
    if (!cases.has(r.index)) cases.set(r.index, []);
    cases.get(r.index).push(r);
  }
  return [...cases.values()];
}

function printReplies(results, variants, mode) {
  if (mode === 'none') return;
  for (const rows of byCase(results)) {
    const { site, label } = rows[0];
    if (mode !== 'all' && !MESSAGE_WRITERS.includes(site)) continue;
    console.log(`\n${'═'.repeat(78)}\n${site} — ${label}`);
    for (const v of variants) {
      const r = rows.find((x) => x.variant === v);
      console.log(`\n── ${v}  (${r.outcome}${r.note ? `: ${r.note}` : ''}; ${r.latencyMs} ms; ${r.outputTokens ?? '-'} out tok)`);
      console.log(r.text ?? '(no usable text)');
    }
  }
}

function markdownReport(results, variants, fake) {
  const lines = [`# Sonnet comparison (#699)${fake ? ' — FAKE API self-test' : ''}`, '',
    `Variants: ${variants.map((v) => `\`${v}\``).join(', ')}. Inputs are synthetic; see scripts/sonnet-compare/fixtures.mjs.`, '',
    '| site | variant | ok | parse✗ | refusal | truncated | empty | API error | p50 ms | p95 ms | in tok | out tok | $ |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const s of summaryRows(results, variants)) {
    lines.push(`| ${s.site} | ${s.variant} | ${s.ok}/${s.n} | ${s.checkFailed} | ${s.refusal} | ${s.truncated} | ${s.empty} | ${s.apiError} | ${s.p50 ?? '-'} | ${s.p95 ?? '-'} | ${s.inTok ?? '-'} | ${s.outTok ?? '-'} | ${s.spend.toFixed(4)} |`);
  }
  lines.push('', '## Replies, case by case', '');
  for (const rows of byCase(results)) {
    lines.push(`### ${rows[0].site} — ${rows[0].label}`, '');
    for (const v of variants) {
      const r = rows.find((x) => x.variant === v);
      lines.push(`**${v}** · ${r.outcome}${r.note ? ` (${r.note})` : ''} · ${r.latencyMs} ms · ${r.inputTokens ?? '-'} in / ${r.outputTokens ?? '-'} out · stop: ${r.stopReason ?? '-'} · answered by ${r.modelAnswered ?? '-'}`, '');
      lines.push('```', r.text ?? '(no usable text)', '```', '');
    }
  }
  return lines.join('\n');
}

// ─── Offline self-test client ───────────────────────────────────────────────

/** Answers like the API would, without sending anything, to exercise every path of this tool. */
function fakeClient() {
  const SAMPLE = {
    'mission-sequence': '{"sequenceRationale":"Start light, then ask.","steps":[{"stepType":"message"}]}',
    context: '{"whoYoureMeeting":"a","whatRoleCaresAbout":"b","whatCompanyFocusedOn":"c","conversationStarters":["d"],"calmReframe":"e"}',
    'sequence-step': '{"body":"Hi there, following up on spoilage.","channel":"email"}',
    'validate-contact': '{"selected_index":1,"confidence":"high","explanation":"Title and company match."}',
    'engagement-message': '{"messages":[{"body":"one"},{"body":"two"},{"body":"three"}]}',
    'campaign-message': 'SUBJECT: Fewer empty shelves\nBODY:\nHi there, a short note about spoilage.',
    followup: 'Hi there, circling back with one number from a similar chain.',
  };
  let calls = 0;
  return {
    fake: true,
    messages: {
      async create(params, site) {
        calls += 1;
        await new Promise((r) => setTimeout(r, 5));
        const prompt = JSON.stringify(params.messages);
        const text = SAMPLE[site] ?? '{"understood":{"industries":["Supermarkets"]}}';
        const base = { id: `msg_fake_${calls}`, type: 'message', role: 'assistant', model: params.model, usage: { input_tokens: Math.round(prompt.length / 3.5), output_tokens: 120 } };
        if (calls % 13 === 0) return { ...base, content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } };
        if (calls % 11 === 0) return { ...base, content: [{ type: 'text', text: text.slice(0, 10) }], stop_reason: 'max_tokens' };
        if (calls % 17 === 0) return { ...base, content: [{ type: 'text', text: 'Sure! Here is what I found.' }], stop_reason: 'end_turn' };
        // Sonnet 5.5 with adaptive thinking can put a thinking block first.
        const thinking = params.model === SONNET_5_5 && !params.thinking ? [{ type: 'thinking', thinking: '', signature: 'sig' }] : [];
        return { ...base, content: [...thinking, { type: 'text', text }], stop_reason: 'end_turn' };
      },
    },
  };
}
