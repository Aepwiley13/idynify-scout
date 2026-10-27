// @vitest-environment node
/**
 * scripts/captureBenchmark.mjs: the local real-card pilot.
 *
 * Pins the label format and its checks, draft labels, the per-card scoring
 * (correct, misread, invented, confirmed-but-wrong, role swaps), the
 * aggregates and the pilot gate, that card data can only be written to a
 * git-ignored folder, and that summary.json carries aggregates and no card
 * value. Runs use the fake extractor in a temporary folder: no network.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseArgs, parseConfig, checkLabel, draftLabel, emptyLabel, scoreCard, samePhone, aggregate, evaluateGate, percentile,
  assertLocal, main, LABEL_VERSION, PILOT_GATE,
} from '../../scripts/captureBenchmark.mjs';
import { runExtraction } from '../../netlify/functions/utils/capture/orchestrator.js';
import { createFakeExtractor } from '../../netlify/functions/utils/capture/fakeExtractor.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// A synthetic JPEG the server-side checks accept (the fake extractor ignores pixels).
const seg = (m, p) => [0xFF, m, (p.length + 2) >> 8, (p.length + 2) & 0xFF, ...p];
const sof = (w, h) => seg(0xC0, [8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
const jpeg = () => new Uint8Array([
  0xFF, 0xD8, ...seg(0xE0, [74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), ...seg(0xDB, [0, ...new Array(64).fill(1)]),
  ...sof(2000, 1143), ...seg(0xC4, [0, ...new Array(16).fill(0)]), ...seg(0xDA, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]), 0x5A, 0xFF, 0xD9,
]);

/** The truth for the fake extractor's card. */
const truth = (over = {}) => ({
  label: LABEL_VERSION, photo: 'card-001.jpg', status: 'done', tags: ['standard'],
  person: {
    fullName: 'Avery Quinn', title: 'Director of Partnerships', emails: ['avery.quinn@example.com'],
    phones: ['+1 (415) 555-0142', '+1 (415) 555-0100 x12'], linkedinUrl: 'linkedin.com/in/avery-quinn-example',
  },
  company: { name: 'Example Robotics', website: 'www.example.com' },
  ...over,
});

async function fakeExtraction(scenario = 'card') {
  const result = await runExtraction({
    extractor: createFakeExtractor({ CAPTURE_FAKE_SCENARIO: scenario }),
    image: { version: 'card-image/v1', mimeType: 'image/jpeg', data: 'AAAA', bytes: 3, widthPx: 2000, heightPx: 1143, preflight: { blur: 1, brightness: 1, glareRatio: 0, warnings: [], userOverrode: false } },
    operationId: 'cap_3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90',
    startedAt: Date.now(),
  });
  return result.extraction;
}

const temp = mkdtempSync(join(tmpdir(), 'capture-bench-test-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

// ─── Arguments and labels ───────────────────────────────────────────────────

describe('captureBenchmark: arguments', () => {
  it('reads a command and options', () => {
    expect(parseArgs(['run', '--config', 'claude-opus-5-5:low,claude-sonnet-5-5:medium', '--limit', '10'])).toMatchObject({
      command: 'run', dir: 'capture-pilot', configs: ['claude-opus-5-5:low', 'claude-sonnet-5-5:medium'], limit: 10, concurrency: 2,
    });
    expect(parseArgs(['run']).configs).toEqual(['claude-opus-5-5:low']);
    expect(parseArgs(['run', '--extractor', 'fake']).configs).toEqual(['fake']);
    expect(parseArgs(['compare', 'a', 'b']).runs).toEqual(['a', 'b']);
    expect(parseConfig('claude-haiku-5-5:medium', 'claude-vision')).toEqual({ model: 'claude-haiku-5-5', effort: 'medium', name: 'claude-haiku-5-5-medium' });
  });

  it.each([[[]], [['score']], [['run', '--limit', '0']], [['run', '--config']], [['run', 'extra']], [['run', '--verbose']]])('refuses %o', (argv) => {
    expect(() => parseArgs(argv)).toThrow();
  });
});

describe('captureBenchmark: labels', () => {
  it('accepts a finished label and an empty draft', () => {
    expect(checkLabel(truth(), 'card-001.jpg')).toEqual([]);
    expect(checkLabel(emptyLabel('card-002.jpg'), 'card-002.jpg')).toEqual([]);
  });

  it.each([
    ['the wrong photo', l => ({ ...l, photo: 'card-999.jpg' }), 'photo'],
    ['an unknown status', l => ({ ...l, status: 'checked' }), 'status'],
    ['an empty string instead of null', l => ({ ...l, person: { ...l.person, title: '' } }), 'person.title'],
    ['a single email instead of a list', l => ({ ...l, person: { ...l.person, emails: 'a@example.com' } }), 'person.emails'],
    ['an unknown field', l => ({ ...l, company: { ...l.company, phone: '555' } }), 'company.phone'],
    ['a missing section', l => { const { company, ...rest } = l; void company; return rest; }, 'company'],
  ])('reports %s by path', (_, mutate, path) => {
    expect(checkLabel(mutate(truth()), 'card-001.jpg').join(' ')).toContain(path);
  });

  it('drafts a label from everything that was read', async () => {
    expect(draftLabel('card-001.jpg', await fakeExtraction())).toEqual({ ...truth(), status: 'draft', tags: [] });
  });
});

// ─── Scoring ────────────────────────────────────────────────────────────────

describe('captureBenchmark: scoring one card', () => {
  it('a perfect read', async () => {
    const score = scoreCard(truth(), await fakeExtraction());
    expect(Object.fromEntries(Object.entries(score.fields).map(([k, f]) => [k, f.correct]))).toEqual({ name: true, title: true, linkedin: true, company: true, website: true });
    expect(score.emails).toEqual({ truth: 1, correct: 1, misread: 0, invented: 0 });
    expect(score.phones).toEqual({ truth: 2, correct: 2, misread: 0, invented: 0 });
    expect(score.confirmed).toEqual({ total: 2, correct: 2 });                          // name and company
    expect(score.roleSwap).toBe(false);
  });

  it('keeps misreadings apart from inventions', async () => {
    const extraction = await fakeExtraction();
    const label = truth({ person: { ...truth().person, emails: ['avery@example.com'], phones: ['+1 (415) 555-0142'] } });
    const score = scoreCard(label, extraction);
    expect(score.emails).toEqual({ truth: 1, correct: 0, misread: 1, invented: 0 });
    expect(score.phones).toEqual({ truth: 1, correct: 1, misread: 0, invented: 1 });
  });

  it('a value read where nothing is printed is invented; a printed one not read is a miss', async () => {
    const label = truth({ company: { name: null, website: 'www.example.com' }, person: { ...truth().person, title: null } });
    const score = scoreCard(label, await fakeExtraction());
    expect(score.fields.company).toMatchObject({ truth: false, extracted: true, invented: true, correct: false });
    expect(score.fields.title.invented).toBe(true);
    // A confirmed company that is not on the card is a confirmed field that is wrong.
    expect(score.confirmed).toEqual({ total: 2, correct: 1 });
  });

  it('a role swap: the title read as the company', async () => {
    const extraction = await fakeExtraction();
    const label = truth({ company: { name: 'Northwind', website: 'www.example.com' }, person: { ...truth().person, title: 'Example Robotics' } });
    expect(scoreCard(label, extraction).roleSwap).toBe(true);
  });

  it('a failed read scores as nothing read', () => {
    const score = scoreCard(truth(), null);
    expect(score.fields.name).toMatchObject({ truth: true, extracted: false, correct: false });
    expect(score.emails).toEqual({ truth: 1, correct: 0, misread: 0, invented: 0 });
    expect(score.roleSwap).toBe(false);
  });

  it('a phone matches with or without its country code, never on a short tail', () => {
    expect(samePhone('14155550142', '4155550142')).toBe(true);
    expect(samePhone('4155550142', '4155550142')).toBe(true);
    expect(samePhone('14155550142', '14155550143')).toBe(false);
    expect(samePhone('4155550142', '50142')).toBe(false);
    expect(samePhone('', '4155550142')).toBe(false);
  });

  it('a score holds booleans and counts only', async () => {
    expect(JSON.stringify(scoreCard(truth(), await fakeExtraction()))).not.toMatch(/Avery|Quinn|example|(?<![0-9A-Za-z])555(?![0-9A-Za-z])|4155550\d{3}|Robotics|Director/);
  });
});

// ─── Aggregates and the gate ────────────────────────────────────────────────

describe('captureBenchmark: aggregates and the gate', () => {
  const row = async (over = {}) => ({
    ok: true, code: null, status: 'ok', ms: 4000, cost: 0.03, usage: { inputTokens: 3800, outputTokens: 700 }, attempts: 1,
    modelId: 'claude-opus-5-5', tags: ['standard'], score: scoreCard(truth(), await fakeExtraction()), ...over,
  });

  it('pins the gate', () => {
    expect(PILOT_GATE.map(r => `${r.label} ${r.target}`)).toEqual([
      'Invented emails 0', 'Invented phones 0', 'Name accuracy ≥ 95%', 'Email accuracy ≥ 97%', 'Phone accuracy ≥ 93%',
      'Company accuracy ≥ 90%', 'Title accuracy ≥ 85%', 'Confirmed fields correct ≥ 99%', 'Role swaps ≤ 2%',
      'p95 extraction latency ≤ 8 s', 'Cost per scan ≤ $0.05',
    ]);
  });

  it('fifty clean reads pass', async () => {
    const rows = await Promise.all(Array.from({ length: 50 }, () => row()));
    const metrics = aggregate(rows);
    expect(metrics).toMatchObject({
      cards: 50, extracted: 50, accuracy: { name: 1, email: 1, phone: 1, company: 1, title: 1 },
      invented: { emails: 0, phones: 0 }, confirmedCorrect: 1, roleSwapRate: 0, latencyMs: { p50: 4000, p95: 4000 },
      servedBy: { 'claude-opus-5-5': 50 }, byTag: { standard: { cards: 50, name: 1 } },
    });
    expect(metrics.costUsd.perScan).toBeCloseTo(0.03, 6);
    expect(evaluateGate(metrics).pass).toBe(true);
  });

  it('one invented phone, slow tail or high cost each fail it', async () => {
    const base = await Promise.all(Array.from({ length: 49 }, () => row()));
    const invented = await row();
    invented.score = { ...invented.score, phones: { ...invented.score.phones, invented: 1 } };
    const failed = r => evaluateGate(aggregate(r)).results.filter(x => !x.pass).map(x => x.id);
    expect(failed([...base, invented])).toEqual(['invented_phones']);
    expect(failed([...base.slice(0, 45), ...await Promise.all(Array.from({ length: 5 }, () => row({ ms: 9500 })))])).toEqual(['latency']);
    expect(failed(await Promise.all(Array.from({ length: 50 }, () => row({ cost: 0.07 }))))).toEqual(['cost']);
  });

  it('failed reads count against accuracy', async () => {
    const rows = [...await Promise.all(Array.from({ length: 9 }, () => row())), { ...await row(), ok: false, code: 'timeout', status: null, score: scoreCard(truth(), null) }];
    const metrics = aggregate(rows);
    expect(metrics.accuracy.name).toBeCloseTo(0.9, 6);
    expect(metrics.failures).toEqual({ timeout: 1 });
  });

  it('percentiles', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
    expect(percentile([], 0.5)).toBeNull();
  });
});

// ─── Local-only data ────────────────────────────────────────────────────────

describe('captureBenchmark: card data stays local', () => {
  it('./capture-pilot is git-ignored, and a tracked folder is refused', () => {
    const cwd = process.cwd();
    process.chdir(repo);
    try {
      expect(() => assertLocal('capture-pilot')).not.toThrow();
      expect(() => assertLocal('docs/capture-pilot')).toThrow(/not git-ignored/);
    } finally {
      process.chdir(cwd);
    }
    expect(() => assertLocal(temp)).not.toThrow();
  });
});

// ─── A whole pilot, with the fake extractor ─────────────────────────────────

describe('captureBenchmark: a pilot end to end', () => {
  const dir = join(temp, 'pilot');
  const lines = [];
  const run = argv => main([...argv, '--dir', dir], { out: line => lines.push(line), env: {} });

  it('draft → check → correct → run → compare', async () => {
    mkdirSync(join(dir, 'photos'), { recursive: true });
    for (const n of ['001', '002', '003']) writeFileSync(join(dir, 'photos', `card-${n}.jpg`), jpeg());
    writeFileSync(join(dir, 'photos', 'notes.txt'), 'not a photo');

    expect(await run(['run', '--extractor', 'fake'])).toBe(1);                       // nothing labelled yet
    expect(await run(['draft-labels', '--extractor', 'fake'])).toBe(0);
    expect(readdirSync(join(dir, 'labels')).sort()).toEqual(['card-001.json', 'card-002.json', 'card-003.json']);
    expect(JSON.parse(readFileSync(join(dir, 'labels', 'card-001.json'), 'utf8')).status).toBe('draft');

    lines.length = 0;
    expect(await run(['check-labels'])).toBe(0);
    expect(lines.at(-1)).toBe('3 photos · 0 done · 3 draft · 0 without a label · 0 invalid');

    // "Correct" the drafts: two as read, one where the card's title differs.
    for (const n of ['001', '002', '003']) {
      const path = join(dir, 'labels', `card-${n}.json`);
      const label = JSON.parse(readFileSync(path, 'utf8'));
      label.status = 'done';
      if (n === '003') label.person.title = 'VP Partnerships';
      writeFileSync(path, JSON.stringify(label));
    }

    lines.length = 0;
    const code = await run(['run', '--extractor', 'fake', '--concurrency', '3']);
    expect(code).toBe(3);                                                              // title accuracy 2/3 < 85%
    const runs = readdirSync(join(dir, 'runs'));
    expect(runs).toHaveLength(1);
    const summary = JSON.parse(readFileSync(join(dir, 'runs', runs[0], 'summary.json'), 'utf8'));
    expect(summary).toMatchObject({
      summary: 'capture-benchmark/v1', config: 'fake',
      extractor: { id: 'fake', promptVersion: 'fake-v1' },
      metrics: { cards: 3, extracted: 3, accuracy: { name: 1, email: 1, phone: 1, company: 1 } },
    });
    expect(summary.metrics.accuracy.title).toBeCloseTo(2 / 3, 6);
    expect(summary.gate.results.find(r => r.id === 'title').pass).toBe(false);
    // 555 only as its own token or the whole sample number: the summary records
    // the commit, and a hash like 3555426 is not card data.
    expect(JSON.stringify(summary)).not.toMatch(/Avery|Quinn|avery|example\.com|(?<![0-9A-Za-z])555(?![0-9A-Za-z])|4155550\d{3}|Robotics|Partnerships|card-00/);

    const perCard = readFileSync(join(dir, 'runs', runs[0], 'results.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(perCard.map(r => r.photo).sort()).toEqual(['card-001.jpg', 'card-002.jpg', 'card-003.jpg']);
    expect(perCard[0].extraction.person.fullName.value).toBe('Avery Quinn');            // local per-card detail

    expect(lines.join('\n')).toMatch(/gate {6}NOT YET/);
    expect(lines.join('\n')).toMatch(/✗ Title accuracy/);

    lines.length = 0;
    expect(await run(['compare'])).toBe(0);
    expect(lines[0]).toMatch(/^run\s+prompt\s+cards\s+name/);
    expect(lines[1]).toMatch(/fake\s+fake-v1\s+3\s+100\.0%/);
  });

  it('with Claude and no key it says where to set one, and writes nothing', async () => {
    const other = join(temp, 'pilot-no-key');
    mkdirSync(join(other, 'photos'), { recursive: true });
    writeFileSync(join(other, 'photos', 'card-001.jpg'), jpeg());
    const output = [];
    expect(await main(['draft-labels', '--dir', other], { out: l => output.push(l), env: {} })).toBe(1);
    expect(output).toEqual(['captureBenchmark: ANTHROPIC_API_KEY is not set in this environment (try --env-file=.env)']);
    expect(existsSync(join(other, 'labels'))).toBe(false);
  });
});
