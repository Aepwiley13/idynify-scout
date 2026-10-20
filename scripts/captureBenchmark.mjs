#!/usr/bin/env node
/**
 * captureBenchmark — the real-card pilot, run on your own machine.
 *
 *   node --env-file=.env scripts/captureBenchmark.mjs <command> [options]
 *
 *   draft-labels   read every photo that has no label yet and write a draft
 *                  label from what was extracted, for you to correct
 *   check-labels   validate every label; list drafts still to check
 *   run            read every finished label's photo with each --config and
 *                  score it: accuracy, invented values, latency, cost, gate
 *   compare        the aggregate summaries of earlier runs, side by side
 *   report         for runs that already exist: confidence levels and the
 *                  accuracy within each, warning codes, role swaps by pair and
 *                  phone-country resolution. Reads results.jsonl, calls no API,
 *                  writes report.json (aggregates only) beside summary.json
 *
 *   --dir <path>           the pilot folder (default ./capture-pilot)
 *   --config <m[:effort]>  model and effort, repeatable or comma-separated
 *                          (default claude-opus-5-5:low)
 *   --extractor <id>       claude-vision (default) or fake
 *   --scenario <name>      a fake scenario (with --extractor fake)
 *   --concurrency <n>      cards read at once (default 2)
 *   --limit <n>            only the first n cards
 *
 * The same path as the endpoint, minus Firebase: photo preparation as in
 * captureTry, the extractor registry, the orchestrator and the assembler. A
 * different prompt version is a different commit: run each, then `compare`.
 *
 * LOCAL ONLY. Photos, labels and per-card results stay in the pilot folder,
 * which must be git-ignored (./capture-pilot is): the script refuses to write
 * anywhere git would track. Each run also writes summary.json, aggregates only
 * — counts, rates, timings, cost, versions — which is safe to share or commit.
 * Nothing is logged anywhere else.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve, basename, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { preparePhoto, estimateCost, extractorEnv } from './captureTry.mjs';
import { resolveExtractor } from '../netlify/functions/utils/capture/extractors.js';
import { runExtraction } from '../netlify/functions/utils/capture/orchestrator.js';
import { CHECKS, validateEmail, validateLinkedInPerson, domainKey, personNameKey } from '../src/capture/validators.js';
import { KNOWN_CHECKS } from '../src/capture/contract.js';
import { nameKey, normalizeCapturePhone } from '../src/utils/identityNormalization.js';

export const LABEL_VERSION = 'capture-label/v1';
export const DEFAULT_CONFIG = 'claude-opus-5-5:low';
const PHOTO = /\.(jpe?g|png|heic|heif)$/i;

/**
 * The pilot gate (approved 2026-10-15). Device prep time (≤ 700 ms) is
 * measured in the Capture Lab on real phones, not here; latency here is the
 * extraction only, without the endpoint's network and Firestore time.
 */
export const PILOT_GATE = Object.freeze([
  { id: 'invented_emails', label: 'Invented emails', target: '0', test: m => m.invented.emails === 0, value: m => m.invented.emails },
  { id: 'invented_phones', label: 'Invented phones', target: '0', test: m => m.invented.phones === 0, value: m => m.invented.phones },
  { id: 'name', label: 'Name accuracy', target: '≥ 95%', test: m => m.accuracy.name !== null && m.accuracy.name >= 0.95, value: m => m.accuracy.name },
  { id: 'email', label: 'Email accuracy', target: '≥ 97%', test: m => m.accuracy.email === null || m.accuracy.email >= 0.97, value: m => m.accuracy.email },
  { id: 'phone', label: 'Phone accuracy', target: '≥ 93%', test: m => m.accuracy.phone === null || m.accuracy.phone >= 0.93, value: m => m.accuracy.phone },
  { id: 'company', label: 'Company accuracy', target: '≥ 90%', test: m => m.accuracy.company === null || m.accuracy.company >= 0.90, value: m => m.accuracy.company },
  { id: 'title', label: 'Title accuracy', target: '≥ 85%', test: m => m.accuracy.title === null || m.accuracy.title >= 0.85, value: m => m.accuracy.title },
  { id: 'confirmed', label: 'Confirmed fields correct', target: '≥ 99%', test: m => m.confirmedCorrect === null || m.confirmedCorrect >= 0.99, value: m => m.confirmedCorrect },
  { id: 'role_swap', label: 'Role swaps', target: '≤ 2%', test: m => m.roleSwapRate <= 0.02, value: m => m.roleSwapRate },
  { id: 'latency', label: 'p95 extraction latency', target: '≤ 8 s', test: m => m.latencyMs.p95 !== null && m.latencyMs.p95 <= 8000, value: m => m.latencyMs.p95 },
  { id: 'cost', label: 'Cost per scan', target: '≤ $0.05', test: m => m.costUsd.perScan === null || m.costUsd.perScan <= 0.05, value: m => m.costUsd.perScan },
]);

// ─── Arguments ──────────────────────────────────────────────────────────────

const COMMANDS = ['draft-labels', 'check-labels', 'run', 'compare', 'report'];

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) throw new Error(`the first argument is the command: ${COMMANDS.join(', ')}`);
  const options = { command, dir: 'capture-pilot', configs: [], extractor: 'claude-vision', concurrency: 2, limit: null, runs: [] };
  const value = (i, flag) => {
    if (i + 1 >= rest.length) throw new Error(`${flag} needs a value`);
    return rest[i + 1];
  };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--dir') options.dir = value(i++, arg);
    else if (arg === '--config') options.configs.push(...value(i++, arg).split(',').filter(Boolean));
    else if (arg === '--extractor') options.extractor = value(i++, arg);
    else if (arg === '--scenario') options.scenario = value(i++, arg);
    else if (arg === '--concurrency' || arg === '--limit') {
      const n = Number(value(i++, arg));
      if (!Number.isInteger(n) || n < 1) throw new Error(`${arg} needs a whole number of at least 1`);
      options[arg.slice(2)] = n;
    } else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else if (command === 'compare' || command === 'report') options.runs.push(arg);
    else throw new Error(`unexpected argument ${arg}`);
  }
  if (!options.configs.length) options.configs.push(options.extractor === 'fake' ? 'fake' : DEFAULT_CONFIG);
  return options;
}

/** "claude-sonnet-5-5:medium" → { model, effort, name }. */
export function parseConfig(text, extractor) {
  if (extractor === 'fake') return { model: undefined, effort: undefined, name: 'fake' };
  const [model, effort] = text.split(':');
  return { model, effort: effort || undefined, name: effort ? `${model}-${effort}` : model };
}

// ─── The pilot folder ───────────────────────────────────────────────────────

/** Throws unless `dir` is outside git or git-ignored: card data never becomes trackable. */
export function assertLocal(dir) {
  // A path inside the folder: an ignore rule for a folder ("/capture-pilot/")
  // matches what is in it even before the folder exists.
  const check = spawnSync('git', ['check-ignore', '-q', join(resolve(dir), 'photos', 'probe.jpg')], { encoding: 'utf8' });
  if (check.status === 1) {
    throw new Error(`${dir} is not git-ignored; card photos, labels and results must never be committable. Use ./capture-pilot or another ignored folder`);
  }
}

export function pilotPaths(dir) {
  return { photos: join(dir, 'photos'), labels: join(dir, 'labels'), runs: join(dir, 'runs') };
}

/** Every photo, sorted, with its label path and label (or null). */
export function listCards(dir) {
  const paths = pilotPaths(dir);
  if (!existsSync(paths.photos)) throw new Error(`no photos folder: put the card photos in ${paths.photos}`);
  return readdirSync(paths.photos).filter(name => PHOTO.test(name)).sort().map((name) => {
    const labelPath = join(paths.labels, `${basename(name, extname(name))}.json`);
    let label = null;
    let labelError = null;
    if (existsSync(labelPath)) {
      try {
        label = JSON.parse(readFileSync(labelPath, 'utf8'));
      } catch {
        labelError = 'not valid JSON';
      }
    }
    return { name, photoPath: join(paths.photos, name), labelPath, label, labelError };
  });
}

// ─── Labels ─────────────────────────────────────────────────────────────────

const LABEL_SHAPE = {
  person: { fullName: 'text', title: 'text', emails: 'list', phones: 'list', linkedinUrl: 'text' },
  company: { name: 'text', website: 'text' },
};

/** Problems with a label, by path; [] when it is well-formed. */
export function checkLabel(label, photo) {
  const errors = [];
  const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObject(label)) return ['not a JSON object'];
  for (const key of Object.keys(label)) if (!['label', 'photo', 'status', 'tags', 'notes', 'person', 'company'].includes(key)) errors.push(`${key}: unknown key`);
  if (label.label !== LABEL_VERSION) errors.push(`label: must be "${LABEL_VERSION}"`);
  if (label.photo !== photo) errors.push(`photo: must be "${photo}"`);
  if (!['draft', 'done'].includes(label.status)) errors.push('status: "draft" or "done"');
  if (label.tags !== undefined && !(Array.isArray(label.tags) && label.tags.every(t => typeof t === 'string'))) errors.push('tags: a list of words');
  if (label.notes !== undefined && typeof label.notes !== 'string') errors.push('notes: text');
  for (const [section, fields] of Object.entries(LABEL_SHAPE)) {
    if (!isObject(label[section])) { errors.push(`${section}: missing`); continue; }
    for (const key of Object.keys(label[section])) if (!(key in fields)) errors.push(`${section}.${key}: unknown key`);
    for (const [key, kind] of Object.entries(fields)) {
      const v = label[section][key];
      if (kind === 'text' && !(v === null || (typeof v === 'string' && v.trim()))) errors.push(`${section}.${key}: text as printed, or null`);
      if (kind === 'list' && !(Array.isArray(v) && v.every(x => typeof x === 'string' && x.trim()))) errors.push(`${section}.${key}: a list of texts as printed ([] if none)`);
    }
  }
  return errors;
}

/** A draft label from an extraction: every value read, for a person to check against the card. */
export function draftLabel(photo, extraction) {
  const value = f => (f && f.value !== null ? f.value : null);
  const { person, company } = extraction;
  return {
    label: LABEL_VERSION,
    photo,
    status: 'draft',
    tags: [],
    person: {
      fullName: value(person.fullName),
      title: value(person.title),
      emails: person.emails.map(value).filter(Boolean),
      phones: person.phones.map(p => (p.value === null ? null : p.extension ? `${p.value} x${p.extension}` : p.value)).filter(Boolean),
      linkedinUrl: value(person.linkedinUrl),
    },
    company: { name: value(company.name), website: value(company.website) },
  };
}

export const emptyLabel = photo => ({
  label: LABEL_VERSION, photo, status: 'draft', tags: [],
  person: { fullName: null, title: null, emails: [], phones: [], linkedinUrl: null },
  company: { name: null, website: null },
});

// ─── Scoring one card ───────────────────────────────────────────────────────

/** What the app would show: a value that is not unknown. */
const shown = f => Boolean(f) && f.value !== null && f.extraction?.level !== 'unknown';
const present = v => typeof v === 'string' && v.trim() !== '';

const KEYS = {
  name: v => personNameKey(v),
  title: v => personNameKey(v),
  company: v => nameKey(v) ?? personNameKey(v),
  website: v => domainKey(v),
  linkedin: v => validateLinkedInPerson(v).normalized ?? String(v).trim().toLowerCase(),
  email: v => validateEmail(v).normalized ?? String(v).trim().toLowerCase(),
  phone: v => (normalizeCapturePhone(v).normalized ?? String(v)).replace(/\D/g, ''),
};

/** Two phone digit strings are the same number, allowing a country code on one side only. */
export function samePhone(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.length >= 7 && long.length - short.length <= 3 && long.endsWith(short);
}

function scoreSingle(truth, field, key) {
  const hasTruth = present(truth);
  const extracted = shown(field);
  const correct = hasTruth && extracted && key(truth) !== null && key(truth) === key(field.value);
  return { truth: hasTruth, extracted, correct, invented: !hasTruth && extracted, level: extracted ? field.extraction.level : null };
}

function scoreList(truths, fields, key, same = (a, b) => a === b) {
  const remaining = truths.filter(present).map(key);
  const levels = [];
  let correct = 0;
  let unmatched = 0;
  for (const field of fields.filter(shown)) {
    const k = key(field.value);
    const i = remaining.findIndex(t => same(t, k));
    if (i >= 0) {
      remaining.splice(i, 1);
      correct += 1;
      levels.push([field.extraction.level, true]);
    } else {
      unmatched += 1;
      levels.push([field.extraction.level, false]);
    }
  }
  // An extra value pairs with a printed one it failed to match (a misreading)
  // before it counts as invented (nothing like it is printed).
  const misread = Math.min(unmatched, remaining.length);
  return { truth: truths.filter(present).length, correct, misread, invented: unmatched - misread, levels };
}

/** Did a value land in another role's field (a title read as the company, say)? */
function roleSwap(label, extraction) {
  const k = personNameKey;
  const truth = { name: k(label.person.fullName ?? ''), title: k(label.person.title ?? ''), company: k(label.company.name ?? '') };
  const got = {
    name: shown(extraction.person.fullName) ? k(extraction.person.fullName.value) : null,
    title: shown(extraction.person.title) ? k(extraction.person.title.value) : null,
    company: shown(extraction.company.name) ? k(extraction.company.name.value) : null,
  };
  return Object.entries(got).some(([role, value]) => value && value !== truth[role]
    && Object.entries(truth).some(([other, t]) => other !== role && t && t === value));
}

/**
 * One card's score: booleans and counts only, never a value. A failed
 * extraction scores as nothing read.
 */
export function scoreCard(label, extraction) {
  const { person, company } = extraction ?? { person: {}, company: {} };
  const fields = {
    name: scoreSingle(label.person.fullName, person.fullName, KEYS.name),
    title: scoreSingle(label.person.title, person.title, KEYS.title),
    linkedin: scoreSingle(label.person.linkedinUrl, person.linkedinUrl, KEYS.linkedin),
    company: scoreSingle(label.company.name, company.name, KEYS.company),
    website: scoreSingle(label.company.website, company.website, KEYS.website),
  };
  const emails = scoreList(label.person.emails, person.emails ?? [], KEYS.email);
  const phones = scoreList(label.person.phones, person.phones ?? [], KEYS.phone, samePhone);
  const confirmed = [
    ...Object.values(fields).filter(f => f.extracted).map(f => [f.level, f.correct]),
    ...emails.levels, ...phones.levels,
  ].filter(([level]) => level === 'confirmed');
  return {
    fields,
    emails: { truth: emails.truth, correct: emails.correct, misread: emails.misread, invented: emails.invented },
    phones: { truth: phones.truth, correct: phones.correct, misread: phones.misread, invented: phones.invented },
    confirmed: { total: confirmed.length, correct: confirmed.filter(([, ok]) => ok).length },
    roleSwap: extraction ? roleSwap(label, extraction) : false,
  };
}

// ─── Aggregates ─────────────────────────────────────────────────────────────

export function percentile(values, p) {
  const sorted = values.filter(v => typeof v === 'number').sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

const ratio = (a, b) => (b > 0 ? a / b : null);

/** Aggregates over every card of one configuration. `rows` are { score, ok, code, status, ms, cost, usage, attempts, modelId, tags }. */
export function aggregate(rows) {
  const sum = fn => rows.reduce((n, r) => n + fn(r), 0);
  const single = id => ratio(sum(r => (r.score.fields[id].correct ? 1 : 0)), sum(r => (r.score.fields[id].truth ? 1 : 0)));
  const list = id => ratio(sum(r => r.score[id].correct), sum(r => r.score[id].truth));
  const count = values => values.reduce((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
  const costs = rows.map(r => r.cost).filter(v => typeof v === 'number');
  const tags = [...new Set(rows.flatMap(r => r.tags ?? []))].sort();
  return {
    cards: rows.length,
    extracted: rows.filter(r => r.ok).length,
    failures: count(rows.filter(r => !r.ok).map(r => r.code)),
    status: count(rows.filter(r => r.ok).map(r => r.status)),
    accuracy: {
      name: single('name'), title: single('title'), company: single('company'), website: single('website'),
      linkedin: single('linkedin'), email: list('emails'), phone: list('phones'),
    },
    invented: {
      emails: sum(r => r.score.emails.invented), phones: sum(r => r.score.phones.invented),
      name: sum(r => (r.score.fields.name.invented ? 1 : 0)), title: sum(r => (r.score.fields.title.invented ? 1 : 0)),
      company: sum(r => (r.score.fields.company.invented ? 1 : 0)), website: sum(r => (r.score.fields.website.invented ? 1 : 0)),
    },
    misread: { emails: sum(r => r.score.emails.misread), phones: sum(r => r.score.phones.misread) },
    confirmedCorrect: ratio(sum(r => r.score.confirmed.correct), sum(r => r.score.confirmed.total)),
    confirmedFields: sum(r => r.score.confirmed.total),
    roleSwapRate: ratio(sum(r => (r.score.roleSwap ? 1 : 0)), rows.length) ?? 0,
    latencyMs: { p50: percentile(rows.map(r => r.ms), 0.5), p95: percentile(rows.map(r => r.ms), 0.95), max: percentile(rows.map(r => r.ms), 1) },
    costUsd: { perScan: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null, p95: percentile(costs, 0.95), total: costs.length ? costs.reduce((a, b) => a + b, 0) : null },
    tokens: {
      input: ratio(sum(r => r.usage?.inputTokens ?? 0), rows.filter(r => typeof r.usage?.inputTokens === 'number').length),
      output: ratio(sum(r => r.usage?.outputTokens ?? 0), rows.filter(r => typeof r.usage?.outputTokens === 'number').length),
    },
    attempts: ratio(sum(r => r.attempts ?? 0), rows.length),
    servedBy: count(rows.map(r => r.modelId).filter(Boolean)),
    byTag: Object.fromEntries(tags.map((tag) => {
      const tagged = rows.filter(r => (r.tags ?? []).includes(tag));
      const sub = aggregateNames(tagged);
      return [tag, { cards: tagged.length, ...sub }];
    })),
  };
}

function aggregateNames(rows) {
  const sum = fn => rows.reduce((n, r) => n + fn(r), 0);
  return {
    name: ratio(sum(r => (r.score.fields.name.correct ? 1 : 0)), sum(r => (r.score.fields.name.truth ? 1 : 0))),
    email: ratio(sum(r => r.score.emails.correct), sum(r => r.score.emails.truth)),
    phone: ratio(sum(r => r.score.phones.correct), sum(r => r.score.phones.truth)),
    company: ratio(sum(r => (r.score.fields.company.correct ? 1 : 0)), sum(r => (r.score.fields.company.truth ? 1 : 0))),
  };
}

export function evaluateGate(metrics) {
  const results = PILOT_GATE.map(rule => ({ id: rule.id, label: rule.label, target: rule.target, value: rule.value(metrics), pass: rule.test(metrics) }));
  return { pass: results.every(r => r.pass), results };
}

// ─── Printing ───────────────────────────────────────────────────────────────

const pct = v => (v === null || v === undefined ? '–' : `${(v * 100).toFixed(1)}%`);
const ms = v => (v === null || v === undefined ? '–' : `${(v / 1000).toFixed(1)} s`);
const usd = v => (v === null || v === undefined ? '–' : `$${v.toFixed(4)}`);
const pad = (v, n) => String(v).padEnd(n);

export function formatGateValue(id, value) {
  if (id.startsWith('invented')) return String(value);
  if (id === 'latency') return ms(value);
  if (id === 'cost') return usd(value);
  return pct(value);
}

export function printSummary(summary, out) {
  const m = summary.metrics;
  out(`\n${summary.config} · extractor ${summary.extractor.id} · prompt ${summary.extractor.promptVersion} · ${m.cards} cards (${m.extracted} read)`);
  if (m.cards < 50) out(`  note: ${m.cards} labelled cards; the pilot gate is judged on 50`);
  out(`  accuracy  name ${pct(m.accuracy.name)} · email ${pct(m.accuracy.email)} · phone ${pct(m.accuracy.phone)} · company ${pct(m.accuracy.company)} · title ${pct(m.accuracy.title)} · website ${pct(m.accuracy.website)}`);
  out(`  invented  emails ${m.invented.emails} · phones ${m.invented.phones} · company ${m.invented.company} · name ${m.invented.name} · title ${m.invented.title}   misread emails ${m.misread.emails} · phones ${m.misread.phones}`);
  out(`  confirmed ${pct(m.confirmedCorrect)} correct of ${m.confirmedFields} · role swaps ${pct(m.roleSwapRate)} · status ${JSON.stringify(m.status)}${Object.keys(m.failures).length ? ` · failures ${JSON.stringify(m.failures)}` : ''}`);
  out(`  latency   p50 ${ms(m.latencyMs.p50)} · p95 ${ms(m.latencyMs.p95)} · max ${ms(m.latencyMs.max)} · attempts ${m.attempts?.toFixed(2) ?? '–'}`);
  out(`  cost      ${usd(m.costUsd.perScan)} per scan · p95 ${usd(m.costUsd.p95)} · total ${usd(m.costUsd.total)} · served by ${JSON.stringify(m.servedBy)}`);
  out(`  gate      ${summary.gate.pass ? 'PASS' : 'NOT YET'}`);
  for (const r of summary.gate.results) out(`    ${r.pass ? '✓' : '✗'} ${pad(r.label, 26)} ${pad(formatGateValue(r.id, r.value), 10)} target ${r.target}`);
}

// ─── The report: levels, warnings, swap pairs, phone country ─────────────────
//
// Reporting only. Everything below reads a run's results.jsonl after the fact
// and counts; nothing here reads a photo, builds an extractor or changes how a
// card is scored for the gate. It reuses scoreSingle, KEYS and samePhone so a
// value counts as right exactly when the gate counts it right.

export const REPORT_VERSION = 'capture-benchmark-report/v1';
export const REPORT_LEVELS = Object.freeze(['confirmed', 'likely', 'possible', 'unknown']);
export const REPORT_FIELDS = Object.freeze(['name', 'title', 'company', 'website', 'linkedin', 'email', 'phone']);
const ROLES = ['name', 'title', 'company'];
/** "title → company": the printed title was read into the company field. */
export const SWAP_PAIRS = Object.freeze(ROLES.flatMap(printed => ROLES.filter(f => f !== printed).map(f => `${printed} → ${f}`)));

const SINGLE_FIELDS = {
  name: ['person', 'fullName'], title: ['person', 'title'], linkedin: ['person', 'linkedinUrl'],
  company: ['company', 'name'], website: ['company', 'website'],
};

/** Codes that report a check passing. Every other code a field carries is a warning. */
const PASS_CHECKS = new Set([
  CHECKS.EMAIL_SYNTAX_OK, CHECKS.HOST_OK, CHECKS.URL_OK, CHECKS.LINKEDIN_PERSON_OK, CHECKS.LINKEDIN_COMPANY_OK, CHECKS.PHONE_OK,
]);

/** Only codes from the contract's closed set are reported by name; anything else is "other". */
const codeName = code => (typeof code === 'string' && KNOWN_CHECKS.has(code) ? code : 'other');

const levelOf = f => (f && f.value !== null && REPORT_LEVELS.includes(f.extraction?.level) ? f.extraction.level : 'unknown');

/**
 * Where each printed or read value of one card landed: [field, level, right].
 * For confirmed, likely and possible, right means the value is what is printed.
 * For unknown (shown empty), right means nothing is printed there. `notRead`
 * counts printed emails and phones that no read value matched at all.
 */
export function levelOutcomes(label, extraction) {
  const outcomes = [];
  for (const [field, [section, key]] of Object.entries(SINGLE_FIELDS)) {
    const truth = section === 'person' ? label.person[key] : label.company[key];
    const read = extraction[section]?.[key];
    const level = levelOf(read);
    if (level === 'unknown') outcomes.push([field, level, !present(truth)]);
    else outcomes.push([field, level, scoreSingle(truth, read, KEYS[field]).correct]);
  }
  const notRead = {};
  for (const [field, truths, items, key, same] of [
    ['email', label.person.emails, extraction.person?.emails ?? [], KEYS.email, undefined],
    ['phone', label.person.phones, extraction.person?.phones ?? [], KEYS.phone, samePhone],
  ]) {
    const match = same ?? ((a, b) => a === b);
    const remaining = truths.filter(present).map(key);
    const take = (value) => {
      const k = key(value);
      const i = remaining.findIndex(t => match(t, k));
      if (i < 0) return false;
      remaining.splice(i, 1);
      return true;
    };
    // Shown values first, in order, as scoreList pairs them for the gate.
    for (const item of items.filter(shown)) outcomes.push([field, item.extraction.level, take(item.value)]);
    // A value read but left unknown is wrong when it is one of the printed ones.
    for (const item of items.filter(i => i && !shown(i))) outcomes.push([field, 'unknown', !(typeof item.value === 'string' && take(item.value))]);
    notRead[field] = remaining.length;
  }
  return { outcomes, notRead };
}

/** Which printed role landed in which field, as SWAP_PAIRS names. The same test as the gate's roleSwap. */
export function swapPairs(label, extraction) {
  const k = personNameKey;
  const truth = { name: k(label.person.fullName ?? ''), title: k(label.person.title ?? ''), company: k(label.company.name ?? '') };
  const got = {
    name: shown(extraction.person.fullName) ? k(extraction.person.fullName.value) : null,
    title: shown(extraction.person.title) ? k(extraction.person.title.value) : null,
    company: shown(extraction.company.name) ? k(extraction.company.name.value) : null,
  };
  const pairs = [];
  for (const [field, value] of Object.entries(got)) {
    if (!value || value === truth[field]) continue;
    for (const [printed, t] of Object.entries(truth)) if (printed !== field && t && t === value) pairs.push(`${printed} → ${field}`);
  }
  return pairs;
}

/** Every field of an extraction with a schema path (never a value) for where it sits. */
function* fieldsWithPaths(extraction) {
  const p = extraction.person ?? {};
  const c = extraction.company ?? {};
  for (const key of ['fullName', 'givenName', 'middleName', 'familyName', 'suffix', 'title', 'linkedinUrl']) yield [`person.${key}`, p[key]];
  for (const email of p.emails ?? []) yield ['person.emails', email];
  for (const phone of p.phones ?? []) yield ['person.phones', phone];
  for (const key of ['name', 'domain', 'website', 'address', 'linkedinUrl']) yield [`company.${key}`, c[key]];
}

/** Warning codes on one card: [code, where] for each field carrying one, plus the company's safeguards. */
export function cardWarnings(extraction) {
  const found = [];
  for (const [path, f] of fieldsWithPaths(extraction)) {
    for (const code of f?.extraction?.checks ?? []) if (!PASS_CHECKS.has(code)) found.push([codeName(code), path]);
  }
  for (const code of extraction.company?.safeguards ?? []) found.push([codeName(code), 'company.safeguards']);
  return found;
}

/** Each read phone: resolved (a country is known), unresolved (national digits only) or invalid. */
export function phoneCountry(extraction) {
  const counts = { resolved: 0, unresolved: 0, invalid: 0 };
  for (const phone of extraction.person?.phones ?? []) {
    const checks = phone?.extraction?.checks ?? [];
    if (checks.includes(CHECKS.PHONE_COUNTRY_UNRESOLVED)) counts.unresolved += 1;
    else if (checks.includes(CHECKS.PHONE_OK)) counts.resolved += 1;
    else counts.invalid += 1;
  }
  return counts;
}

/**
 * The report over one run. `entries` are { label, result }: the card's label
 * as it is now (null when missing, a draft or malformed) and its results.jsonl
 * line. Counts only; no value, photo name or label text is kept.
 */
export function buildReport(entries) {
  const cell = () => ({ count: 0, right: 0, accuracy: null });
  const levels = Object.fromEntries(REPORT_FIELDS.map(f => [f, Object.fromEntries(REPORT_LEVELS.map(l => [l, cell()]))]));
  const notRead = { email: 0, phone: 0 };
  const warnings = {};
  const pairs = Object.fromEntries(SWAP_PAIRS.map(p => [p, 0]));
  const phones = { resolved: 0, unresolved: 0, invalid: 0 };
  const cards = { inRun: entries.length, scored: 0, failedReads: 0, withoutFinishedLabel: 0, scoredDifferentlyNow: 0 };
  let swapCards = 0;

  for (const { label, result } of entries) {
    const extraction = result?.ok ? result.extraction : null;
    if (!extraction) { cards.failedReads += 1; continue; }
    if (!label) { cards.withoutFinishedLabel += 1; continue; }
    cards.scored += 1;
    // The run scored this card against its label then; a different score now
    // means the label was corrected since, and this report uses the new one.
    if (result.score && JSON.stringify(scoreCard(label, extraction)) !== JSON.stringify(result.score)) cards.scoredDifferentlyNow += 1;

    const { outcomes, notRead: missing } = levelOutcomes(label, extraction);
    for (const [field, level, right] of outcomes) {
      levels[field][level].count += 1;
      if (right) levels[field][level].right += 1;
    }
    notRead.email += missing.email;
    notRead.phone += missing.phone;

    const seen = new Set();
    for (const [code, where] of cardWarnings(extraction)) {
      warnings[code] ??= { fields: 0, cards: 0, where: {} };
      if (where !== 'company.safeguards') warnings[code].fields += 1;
      warnings[code].where[where] = (warnings[code].where[where] ?? 0) + 1;
      if (!seen.has(code)) { seen.add(code); warnings[code].cards += 1; }
    }

    const cardPairs = swapPairs(label, extraction);
    if (cardPairs.length) swapCards += 1;
    for (const pair of new Set(cardPairs)) pairs[pair] += 1;

    const country = phoneCountry(extraction);
    for (const key of Object.keys(phones)) phones[key] += country[key];
  }

  for (const byLevel of Object.values(levels)) for (const c of Object.values(byLevel)) c.accuracy = ratio(c.right, c.count);
  const sortedWarnings = Object.fromEntries(Object.entries(warnings).sort(([a, x], [b, y]) => y.cards - x.cards || a.localeCompare(b)));
  return {
    report: REPORT_VERSION,
    cards,
    levels,
    notRead,
    warnings: sortedWarnings,
    roleSwaps: { cards: swapCards, pairs },
    phoneCountry: phones,
  };
}

export function printReport(report, out) {
  const r = report;
  out(`\n${r.run} · prompt ${r.promptVersion ?? '–'} · ${r.cards.scored} cards scored`
    + `${r.cards.failedReads ? ` · ${r.cards.failedReads} failed reads` : ''}`
    + `${r.cards.withoutFinishedLabel ? ` · ${r.cards.withoutFinishedLabel} without a finished label` : ''}`);
  if (r.cards.scoredDifferentlyNow) out(`  note: ${r.cards.scoredDifferentlyNow} cards score differently against today's labels than when this run was made; this report uses today's`);
  const cellText = c => (c.count ? `${c.count} · ${pct(c.accuracy)}` : '–');
  out(`  ${pad('levels', 10)} ${REPORT_LEVELS.map(l => pad(l, 15)).join(' ')}  (count · % right)`);
  for (const field of REPORT_FIELDS) {
    const extra = field in r.notRead && r.notRead[field] ? `  not read ${r.notRead[field]}` : '';
    out(`  ${pad(field, 10)} ${REPORT_LEVELS.map(l => pad(cellText(r.levels[field][l]), 15)).join(' ')}${extra}`);
  }
  out('             right = the value is what is printed; for unknown, nothing is printed there');
  const warnings = Object.entries(r.warnings);
  out(`  warnings   ${warnings.length ? '(fields · cards)' : 'none'}`);
  for (const [code, w] of warnings) {
    const where = Object.entries(w.where).map(([path, n]) => `${path} ${n}`).join(' · ');
    out(`    ${pad(code, 26)} ${pad(`${w.fields} · ${w.cards}`, 10)} ${where}`);
  }
  out(`  role swaps ${r.roleSwaps.cards} cards  (printed → read as)`);
  out(`    ${SWAP_PAIRS.map(p => `${p} ${r.roleSwaps.pairs[p]}`).join(' · ')}`);
  out(`  phones     country resolved ${r.phoneCountry.resolved} · unresolved ${r.phoneCountry.unresolved} · invalid ${r.phoneCountry.invalid}`);
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

function buildExtractor(options, configText, env) {
  const config = parseConfig(configText, options.extractor);
  try {
    return { config, extractor: resolveExtractor(extractorEnv({ extractor: options.extractor, model: config.model, effort: config.effort, scenario: options.scenario }, env)) };
  } catch {
    throw new Error(options.extractor === 'claude-vision' && !env.ANTHROPIC_API_KEY
      ? 'ANTHROPIC_API_KEY is not set in this environment (try --env-file=.env)'
      : `the ${options.extractor} extractor could not be built for ${configText}`);
  }
}

async function readCard(extractor, photoPath) {
  const { image } = preparePhoto(photoPath);
  const startedAt = Date.now();
  const result = await runExtraction({ extractor, image, operationId: `cap_${randomUUID()}`, startedAt });
  const elapsed = Date.now() - startedAt;
  const modelId = result.modelId ?? extractor.modelId;
  return { result, ms: elapsed, modelId, cost: estimateCost(modelId, result.usage) };
}

async function draftLabels(options, env, out) {
  const cards = listCards(options.dir).filter(card => !card.label && !card.labelError).slice(0, options.limit ?? Infinity);
  if (!cards.length) { out('every photo already has a label'); return 0; }
  const { extractor } = buildExtractor(options, options.configs[0], env);
  mkdirSync(pilotPaths(options.dir).labels, { recursive: true });
  let failed = 0;
  await pool(cards, options.concurrency, async (card) => {
    let label = emptyLabel(card.name);
    try {
      const { result } = await readCard(extractor, card.photoPath);
      if (result.ok) label = draftLabel(card.name, result.extraction);
      else { failed += 1; label.notes = `extraction failed (${result.code}); fill in by hand`; }
    } catch (error) {
      failed += 1;
      label.notes = `photo could not be prepared (${error.message}); fill in by hand`;
    }
    writeFileSync(card.labelPath, `${JSON.stringify(label, null, 2)}\n`);
  });
  out(`wrote ${cards.length} draft labels to ${pilotPaths(options.dir).labels}${failed ? ` (${failed} empty: read failed, fill those in by hand)` : ''}`);
  out('next: open each label next to its photo, correct every value to exactly what is printed, set "status": "done"');
  return 0;
}

function checkLabels(options, out) {
  const cards = listCards(options.dir);
  const counts = { done: 0, draft: 0, missing: 0, invalid: 0 };
  for (const card of cards) {
    if (card.labelError) { counts.invalid += 1; out(`✗ ${card.name}: label ${card.labelError}`); continue; }
    if (!card.label) { counts.missing += 1; out(`· ${card.name}: no label yet`); continue; }
    const errors = checkLabel(card.label, card.name);
    if (errors.length) { counts.invalid += 1; out(`✗ ${card.name}: ${errors.join('; ')}`); continue; }
    counts[card.label.status] += 1;
    if (card.label.status === 'draft') out(`· ${card.name}: draft, still to check`);
  }
  out(`${cards.length} photos · ${counts.done} done · ${counts.draft} draft · ${counts.missing} without a label · ${counts.invalid} invalid`);
  return counts.invalid ? 1 : 0;
}

function gitCommit() {
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  return head.status === 0 ? head.stdout.trim() : null;
}

async function run(options, env, out) {
  const cards = listCards(options.dir)
    .filter(card => card.label && !checkLabel(card.label, card.name).length && card.label.status === 'done')
    .slice(0, options.limit ?? Infinity);
  if (!cards.length) { out('no finished labels: run draft-labels, correct them, set "status": "done", then run'); return 1; }

  const summaries = [];
  for (const configText of options.configs) {
    const { config, extractor } = buildExtractor(options, configText, env);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    const runDir = join(pilotPaths(options.dir).runs, `${stamp}-${config.name}`.replace(/[^A-Za-z0-9._-]/g, '_'));
    mkdirSync(runDir, { recursive: true });
    out(`reading ${cards.length} cards with ${config.name} …`);
    const rows = await pool(cards, options.concurrency, async (card) => {
      let row;
      try {
        const { result, ms: elapsed, modelId, cost } = await readCard(extractor, card.photoPath);
        row = {
          ok: result.ok, code: result.ok ? null : result.code, status: result.ok ? result.extraction.capture.status : null,
          ms: elapsed, cost, usage: result.usage, attempts: result.attempts, modelId, tags: card.label.tags ?? [],
          score: scoreCard(card.label, result.ok ? result.extraction : null),
        };
        appendFileSync(join(runDir, 'results.jsonl'), `${JSON.stringify({ photo: card.name, ...row, extraction: result.ok ? result.extraction : null })}\n`);
      } catch (error) {
        row = { ok: false, code: 'prepare_failed', status: null, ms: null, cost: null, usage: null, attempts: 0, modelId: null, tags: card.label.tags ?? [], score: scoreCard(card.label, null) };
        appendFileSync(join(runDir, 'results.jsonl'), `${JSON.stringify({ photo: card.name, ...row, error: error.message })}\n`);
      }
      return row;
    });
    const metrics = aggregate(rows);
    const summary = {
      summary: 'capture-benchmark/v1',
      createdAt: new Date().toISOString(),
      commit: gitCommit(),
      config: config.name,
      extractor: { id: extractor.id, adapterVersion: extractor.adapterVersion, modelId: extractor.modelId, promptVersion: extractor.promptVersion, effort: extractor.effort ?? null },
      metrics,
      gate: evaluateGate(metrics),
    };
    writeFileSync(join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    printSummary(summary, out);
    out(`  per-card results (local only): ${join(runDir, 'results.jsonl')}`);
    summaries.push(summary);
  }
  return summaries.every(s => s.gate.pass) ? 0 : 3;
}

function compare(options, out) {
  const runsDir = pilotPaths(options.dir).runs;
  const dirs = options.runs.length ? options.runs : (existsSync(runsDir) ? readdirSync(runsDir).sort().map(d => join(runsDir, d)) : []);
  const summaries = dirs.map(d => (existsSync(join(d, 'summary.json')) ? JSON.parse(readFileSync(join(d, 'summary.json'), 'utf8')) : null)).filter(Boolean);
  if (!summaries.length) { out('no runs yet'); return 1; }
  const columns = [
    ['run', s => `${s.createdAt.slice(0, 16)} ${s.config}`, 38], ['prompt', s => s.extractor.promptVersion, 15], ['cards', s => s.metrics.cards, 6],
    ['name', s => pct(s.metrics.accuracy.name), 7], ['email', s => pct(s.metrics.accuracy.email), 7], ['phone', s => pct(s.metrics.accuracy.phone), 7],
    ['company', s => pct(s.metrics.accuracy.company), 8], ['title', s => pct(s.metrics.accuracy.title), 7],
    ['invented', s => s.metrics.invented.emails + s.metrics.invented.phones, 9], ['confirmed', s => pct(s.metrics.confirmedCorrect), 10],
    ['swaps', s => pct(s.metrics.roleSwapRate), 7], ['p95', s => ms(s.metrics.latencyMs.p95), 7], ['$/scan', s => usd(s.metrics.costUsd.perScan), 9],
    ['gate', s => (s.gate.pass ? 'PASS' : 'no'), 5],
  ];
  out(columns.map(([h, , w]) => pad(h, w)).join(' '));
  for (const s of summaries) out(columns.map(([, f, w]) => pad(f(s), w)).join(' '));
  return 0;
}

/** The card's label as it is now, when it is finished and well-formed; else null. */
function finishedLabel(labelsDir, photo) {
  if (typeof photo !== 'string') return null;
  const path = join(labelsDir, `${basename(photo, extname(photo))}.json`);
  if (!existsSync(path)) return null;
  try {
    const label = JSON.parse(readFileSync(path, 'utf8'));
    return checkLabel(label, photo).length === 0 && label.status === 'done' ? label : null;
  } catch {
    return null;
  }
}

/** report.json for each run that has per-card results. Reads local files only: no API, no photos. */
function report(options, out) {
  const { runs: runsDir, labels: labelsDir } = pilotPaths(options.dir);
  const dirs = options.runs.length ? options.runs : (existsSync(runsDir) ? readdirSync(runsDir).sort().map(d => join(runsDir, d)) : []);
  const withResults = dirs.filter(d => existsSync(join(d, 'results.jsonl')));
  if (!withResults.length) { out('no runs with per-card results yet: run first, then report'); return 1; }
  for (const dir of withResults) {
    assertLocal(dir);
    let unreadableLines = 0;
    const entries = readFileSync(join(dir, 'results.jsonl'), 'utf8').split('\n').filter(Boolean).flatMap((line) => {
      try {
        const result = JSON.parse(line);
        return [{ result, label: finishedLabel(labelsDir, result.photo) }];
      } catch {
        unreadableLines += 1;                                   // an interrupted run's last line
        return [];
      }
    });
    const summaryPath = join(dir, 'summary.json');
    const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null;
    const { report: version, cards, ...counts } = buildReport(entries);
    const built = {
      report: version,
      run: basename(dir),
      config: summary?.config ?? null,
      promptVersion: summary?.extractor?.promptVersion ?? null,
      commit: summary?.commit ?? null,
      createdAt: new Date().toISOString(),
      cards: { ...cards, unreadableLines },
      ...counts,
    };
    writeFileSync(join(dir, 'report.json'), `${JSON.stringify(built, null, 2)}\n`);
    printReport(built, out);
    out(`  written: ${join(dir, 'report.json')}`);
  }
  return 0;
}

export async function main(argv = process.argv.slice(2), { out = console.log, env = process.env } = {}) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.command !== 'compare' && options.command !== 'check-labels') assertLocal(options.dir);
  } catch (error) {
    out(`captureBenchmark: ${error.message}`);
    return 2;
  }
  try {
    if (options.command === 'draft-labels') return await draftLabels(options, env, out);
    if (options.command === 'check-labels') return checkLabels(options, out);
    if (options.command === 'run') return await run(options, env, out);
    if (options.command === 'report') return report(options, out);
    return compare(options, out);
  } catch (error) {
    out(`captureBenchmark: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; });
}
