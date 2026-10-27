// @vitest-environment node
/**
 * scripts/captureBenchmark.mjs `report`: what a run's per-card results say
 * beyond the gate, read after the fact.
 *
 * Pins confidence levels by field and the accuracy within each, warning codes,
 * role swaps by pair, phone-country resolution, and that the report agrees
 * with the gate's own scoring. End to end: it runs on a run made by the
 * unchanged `run` command, calls no API, leaves summary.json and results.jsonl
 * as they were, writes aggregates only, and refuses a folder git would track.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  levelOutcomes, swapPairs, cardWarnings, phoneCountry, buildReport, scoreCard, parseArgs, main,
  LABEL_VERSION, SWAP_PAIRS, REPORT_FIELDS, REPORT_LEVELS,
} from '../../scripts/captureBenchmark.mjs';
import { runExtraction } from '../../netlify/functions/utils/capture/orchestrator.js';
import { createFakeExtractor } from '../../netlify/functions/utils/capture/fakeExtractor.js';
import { validatePhone } from '../../src/capture/validators.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Anything that would be a card value in this suite. Reports must never contain one.
// The sample phone's 555 counts only as its own token (not inside a commit hash
// like 3555426, which reports record), or as the whole number in digit form.
const VALUES = /Avery|Quinn|avery|example|(?<![0-9A-Za-z])555(?![0-9A-Za-z])|4155550\d{3}|Robotics|Partnerships|Director|Northwind|card-00/;

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
const withPerson = over => truth({ person: { ...truth().person, ...over } });

/** card: everything read (name and company confirmed, the rest likely). low_confidence: possible, with an email and the company read but left unknown. */
async function fakeExtraction(scenario = 'card') {
  const result = await runExtraction({
    extractor: createFakeExtractor({ CAPTURE_FAKE_SCENARIO: scenario }),
    image: { version: 'card-image/v1', mimeType: 'image/jpeg', data: 'AAAA', bytes: 3, widthPx: 2000, heightPx: 1143, preflight: { blur: 1, brightness: 1, glareRatio: 0, warnings: [], userOverrode: false } },
    operationId: 'cap_3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90',
    startedAt: Date.now(),
  });
  return result.extraction;
}

/** [field, level, right] tuples of one card, as "field level right|wrong" strings for readable assertions. */
const outcomeText = (label, extraction) => levelOutcomes(label, extraction).outcomes.map(([f, l, r]) => `${f} ${l} ${r ? 'right' : 'wrong'}`);

const temp = mkdtempSync(join(tmpdir(), 'capture-bench-report-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe('the card-value matcher', () => {
  it('finds the sample phone however it is written, but not inside a commit hash', () => {
    for (const leak of ['+1 (415) 555-0142', '555', '4155550142', '14155550100']) expect(leak).toMatch(VALUES);
    for (const hash of ['3555426', 'a555b12', '"commit":"3555426"']) expect(hash).not.toMatch(VALUES);
  });
});

// ─── Levels and the accuracy within them ────────────────────────────────────

describe('report: confidence levels by field', () => {
  it('a perfect read: each field at its level, all right', async () => {
    expect(outcomeText(truth(), await fakeExtraction())).toEqual([
      'name confirmed right', 'title likely right', 'linkedin likely right', 'company confirmed right', 'website likely right',
      'email likely right', 'phone likely right', 'phone likely right',
    ]);
    expect(levelOutcomes(truth(), await fakeExtraction()).notRead).toEqual({ email: 0, phone: 0 });
  });

  it('a shown value is right only when it is what is printed', async () => {
    const label = truth({ company: { name: 'Northwind', website: 'www.example.com' }, person: { ...truth().person, title: null } });
    const text = outcomeText(label, await fakeExtraction());
    expect(text).toContain('company confirmed wrong');                   // a confirmed misread
    expect(text).toContain('title likely wrong');                        // read where nothing is printed
  });

  it('unknown is right when nothing is printed, and wrong when something is', async () => {
    const extraction = await fakeExtraction('partial');                  // no name, title, LinkedIn, email or phone read
    const printed = outcomeText(truth(), extraction);
    expect(printed).toContain('name unknown wrong');
    expect(printed).toContain('title unknown wrong');
    const blank = outcomeText(withPerson({ fullName: null, title: null, linkedinUrl: null, emails: [], phones: [] }), extraction);
    expect(blank).toEqual(expect.arrayContaining(['name unknown right', 'title unknown right', 'linkedin unknown right']));
  });

  it('a value read but left unknown counts at unknown: wrong if it is printed, and is not also "not read"', async () => {
    const extraction = await fakeExtraction('low_confidence');           // email read, left unknown; company read, left unknown
    const { outcomes, notRead } = levelOutcomes(truth(), extraction);
    expect(outcomes.filter(([f]) => f === 'email')).toEqual([['email', 'unknown', false]]);
    expect(outcomes.filter(([f]) => f === 'company')).toEqual([['company', 'unknown', false]]);
    expect(notRead.email).toBe(0);
    // Nothing printed there: the same unknown email is right.
    expect(levelOutcomes(withPerson({ emails: [] }), extraction).outcomes.filter(([f]) => f === 'email')).toEqual([['email', 'unknown', true]]);
  });

  it('a printed email or phone with no read value at all is "not read"', async () => {
    const label = withPerson({ emails: ['avery.quinn@example.com', 'aq@example.com'], phones: [...truth().person.phones, '+1 (415) 555-0199'] });
    expect(levelOutcomes(label, await fakeExtraction()).notRead).toEqual({ email: 1, phone: 1 });
  });

  it('agrees with the gate: a shown value is right exactly when scoreCard counts it correct', async () => {
    const card = await fakeExtraction();
    const low = await fakeExtraction('low_confidence');
    const labels = [
      truth(), withPerson({ title: null }), withPerson({ emails: ['avery@example.com'] }), withPerson({ phones: ['+1 (415) 555-0142'] }),
      truth({ company: { name: 'Northwind', website: null } }), withPerson({ fullName: 'Avery Q. Quinn', linkedinUrl: null }),
    ];
    for (const extraction of [card, low]) {
      for (const label of labels) {
        const score = scoreCard(label, extraction);
        const shownRight = field => levelOutcomes(label, extraction).outcomes.filter(([f, l, r]) => f === field && l !== 'unknown' && r).length;
        for (const field of ['name', 'title', 'linkedin', 'company', 'website']) expect(shownRight(field), field).toBe(score.fields[field].correct ? 1 : 0);
        expect(shownRight('email')).toBe(score.emails.correct);
        expect(shownRight('phone')).toBe(score.phones.correct);
      }
    }
  });
});

// ─── Warnings ───────────────────────────────────────────────────────────────

describe('report: warning codes', () => {
  it('passing checks are not warnings', async () => {
    expect(cardWarnings(await fakeExtraction())).toEqual([]);           // email_syntax_ok, phone_ok, url_ok … only
  });

  it('WEAK_COMPANY_TEXT on the company name and in the company safeguards', async () => {
    expect(cardWarnings(await fakeExtraction('low_confidence'))).toEqual([
      ['WEAK_COMPANY_TEXT', 'company.name'], ['WEAK_COMPANY_TEXT', 'company.safeguards'],
    ]);
  });

  it('phone_country_unresolved on a phone, and a code outside the contract only as "other"', async () => {
    const extraction = await fakeExtraction();
    extraction.person.phones[0].extraction.checks = validatePhone('(415) 555-0142').checks;
    extraction.person.title.extraction.checks = ['Director of Partnerships'];
    expect(cardWarnings(extraction)).toEqual([['other', 'person.title'], ['phone_country_unresolved', 'person.phones']]);
  });
});

// ─── Role swaps by pair ─────────────────────────────────────────────────────

describe('report: role swaps by pair', () => {
  it('names the six pairs, printed → read as', () => {
    expect(SWAP_PAIRS).toEqual(['name → title', 'name → company', 'title → name', 'title → company', 'company → name', 'company → title']);
  });

  const PRINTED = { name: 'Avery Quinn', title: 'Director of Partnerships', company: 'Example Robotics' };
  const READ_INTO = { name: x => x.person.fullName, title: x => x.person.title, company: x => x.company.name };

  it.each(SWAP_PAIRS)('%s', async (pair) => {
    const [printed, into] = pair.split(' → ');
    const extraction = await fakeExtraction();
    READ_INTO[into](extraction).value = PRINTED[printed];
    expect(swapPairs(truth(), extraction)).toEqual([pair]);
    expect(scoreCard(truth(), extraction).roleSwap).toBe(true);         // the gate counts the same card
  });

  it('none on a clean read, and none for a plain misread', async () => {
    expect(swapPairs(truth(), await fakeExtraction())).toEqual([]);
    const misread = await fakeExtraction();
    misread.company.name.value = 'Example Robotix';
    expect(swapPairs(truth(), misread)).toEqual([]);
    expect(scoreCard(truth(), misread).roleSwap).toBe(false);
  });
});

// ─── Phone country ──────────────────────────────────────────────────────────

describe('report: phone-country resolution', () => {
  it('resolved with a printed +, unresolved without, invalid when not a number', async () => {
    const extraction = await fakeExtraction();
    expect(phoneCountry(extraction)).toEqual({ resolved: 2, unresolved: 0, invalid: 0 });
    extraction.person.phones[0].extraction.checks = validatePhone('(415) 555-0142').checks;
    extraction.person.phones[1].extraction.checks = validatePhone('555').checks;
    expect(phoneCountry(extraction)).toEqual({ resolved: 0, unresolved: 1, invalid: 1 });
  });
});

// ─── A run's report ─────────────────────────────────────────────────────────

describe('report: aggregates over a run', () => {
  const ok = (extraction, label) => ({ ok: true, extraction, score: scoreCard(label, extraction) });

  it('counts by field and level, warnings, swaps and phones; failed reads and unfinished labels apart', async () => {
    const card = await fakeExtraction();
    const low = await fakeExtraction('low_confidence');
    const swapped = await fakeExtraction();
    swapped.company.name.value = 'Director of Partnerships';
    const report = buildReport([
      { label: truth(), result: ok(card, truth()) },
      { label: truth(), result: ok(card, truth()) },
      { label: truth(), result: ok(low, truth()) },
      { label: truth(), result: ok(swapped, truth()) },
      { label: truth(), result: { ok: false, code: 'timeout', extraction: null } },
      { label: null, result: ok(card, truth()) },
    ]);

    expect(report.cards).toEqual({ inRun: 6, scored: 4, failedReads: 1, withoutFinishedLabel: 1, scoredDifferentlyNow: 0 });
    expect(Object.keys(report.levels)).toEqual(REPORT_FIELDS);
    expect(Object.keys(report.levels.name)).toEqual(REPORT_LEVELS);
    expect(report.levels.name).toMatchObject({ confirmed: { count: 3, right: 3, accuracy: 1 }, possible: { count: 1, right: 1 } });
    expect(report.levels.company).toMatchObject({ confirmed: { count: 3, right: 2 }, unknown: { count: 1, right: 0, accuracy: 0 } });
    expect(report.levels.company.confirmed.accuracy).toBeCloseTo(2 / 3, 6);
    expect(report.levels.email).toMatchObject({ likely: { count: 3, right: 3 }, unknown: { count: 1, right: 0 } });
    expect(report.levels.phone.likely).toEqual({ count: 6, right: 6, accuracy: 1 });
    expect(report.levels.title.confirmed).toEqual({ count: 0, right: 0, accuracy: null });
    expect(report.warnings).toEqual({ WEAK_COMPANY_TEXT: { fields: 1, cards: 1, where: { 'company.name': 1, 'company.safeguards': 1 } } });
    expect(report.roleSwaps).toEqual({ cards: 1, pairs: { ...Object.fromEntries(SWAP_PAIRS.map(p => [p, 0])), 'title → company': 1 } });
    expect(report.phoneCountry).toEqual({ resolved: 8, unresolved: 0, invalid: 0 });
    expect(JSON.stringify(report)).not.toMatch(VALUES);
  });

  it('notices a label corrected since the run, and scores against today\'s', async () => {
    const card = await fakeExtraction();
    const corrected = withPerson({ title: 'VP Partnerships' });
    const report = buildReport([{ label: corrected, result: ok(card, truth()) }]);
    expect(report.cards.scoredDifferentlyNow).toBe(1);
    expect(report.levels.title.likely).toEqual({ count: 1, right: 0, accuracy: 0 });
  });
});

// ─── End to end, on a run made by the unchanged `run` ───────────────────────

describe('report: on a run that already exists', () => {
  const dir = join(temp, 'pilot');
  const lines = [];
  const bench = argv => main([...argv, '--dir', dir], { out: line => lines.push(line), env: {} });

  it('calls no API, leaves the run as it was, and writes aggregates only', async () => {
    mkdirSync(join(dir, 'photos'), { recursive: true });
    for (const n of ['001', '002', '003']) writeFileSync(join(dir, 'photos', `card-${n}.jpg`), jpeg());
    expect(await bench(['draft-labels', '--extractor', 'fake'])).toBe(0);
    for (const n of ['001', '002', '003']) {
      const path = join(dir, 'labels', `card-${n}.json`);
      writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), status: 'done' }));
    }
    await bench(['run', '--extractor', 'fake', '--scenario', 'low_confidence']);
    const [runName] = readdirSync(join(dir, 'runs'));
    const runDir = join(dir, 'runs', runName);
    const summaryBefore = readFileSync(join(runDir, 'summary.json'), 'utf8');
    const resultsBefore = readFileSync(join(runDir, 'results.jsonl'), 'utf8');

    const fetch = vi.fn(() => { throw new Error('the report must not call the network'); });
    vi.stubGlobal('fetch', fetch);
    lines.length = 0;
    try {
      expect(await bench(['report'])).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetch).not.toHaveBeenCalled();

    expect(readFileSync(join(runDir, 'summary.json'), 'utf8')).toBe(summaryBefore);   // the gate output is untouched
    expect(readFileSync(join(runDir, 'results.jsonl'), 'utf8')).toBe(resultsBefore);
    expect(readdirSync(runDir).sort()).toEqual(['report.json', 'results.jsonl', 'summary.json']);

    const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
    expect(report).toMatchObject({
      report: 'capture-benchmark-report/v1', run: runName, config: 'fake', promptVersion: 'fake-v1',
      cards: { inRun: 3, scored: 3, failedReads: 0, withoutFinishedLabel: 0, scoredDifferentlyNow: 0, unreadableLines: 0 },
      levels: { company: { unknown: { count: 3, right: 0 } }, name: { possible: { count: 3, right: 3 } } },
      warnings: { WEAK_COMPANY_TEXT: { fields: 3, cards: 3 } },
      phoneCountry: { resolved: 6, unresolved: 0, invalid: 0 },
    });
    expect(readFileSync(join(runDir, 'report.json'), 'utf8')).not.toMatch(VALUES);
    expect(lines.join('\n')).not.toMatch(VALUES);
    expect(lines.join('\n')).toMatch(/WEAK_COMPANY_TEXT\s+3 · 3\s+company\.name 3 · company\.safeguards 3/);
    expect(lines.join('\n')).toMatch(/title → company 0/);

    lines.length = 0;
    expect(await bench(['compare'])).toBe(0);                                           // compare is unchanged
    expect(lines[1]).toMatch(/fake\s+fake-v1\s+3/);
  });

  it('takes run folders by name', () => {
    expect(parseArgs(['report', 'capture-pilot/runs/a', 'capture-pilot/runs/b']).runs).toEqual(['capture-pilot/runs/a', 'capture-pilot/runs/b']);
  });

  it('says so when there is nothing to report', async () => {
    const empty = join(temp, 'empty');
    const output = [];
    expect(await main(['report', '--dir', empty], { out: l => output.push(l), env: {} })).toBe(1);
    expect(output).toEqual(['no runs with per-card results yet: run first, then report']);
  });

  it('refuses to write a report into a folder git would track', async () => {
    const tracked = mkdtempSync(join(repo, '.capture-report-refusal-'));
    try {
      writeFileSync(join(tracked, 'results.jsonl'), '{}\n');
      const output = [];
      expect(await main(['report', tracked, '--dir', join(temp, 'pilot')], { out: l => output.push(l), env: {} })).toBe(1);
      expect(output.join('\n')).toMatch(/not git-ignored/);
      expect(existsSync(join(tracked, 'report.json'))).toBe(false);
    } finally {
      rmSync(tracked, { recursive: true, force: true });
    }
  });
});
