/**
 * Capture Lab: the admin-only, read-only test surface.
 *
 * Pins the flow (photo → prepared image → quality warning → extract → fields
 * and confidence), the exact request it sends (the user's own id, a fresh
 * cap_ operation per photo, the card-image/v1 untouched), retry on the same
 * scan only when the endpoint says so, that it calls nothing but captureConfig
 * and captureExtract, imports nothing that can write, logs nothing, and that
 * its copied diagnostics carry no card value.
 *
 * Preparation is passed in (the real one needs a browser canvas); the
 * extraction shown is a real CardExtraction from the fake extractor.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'uid_admin_7g5g', getIdToken: async () => 'tok_SECRET_admin' }, onAuthStateChanged: () => () => {} },
  db: {},
}));

import CaptureLab from '../components/capture/CaptureLab.jsx';
import { diagnostics } from '../components/capture/captureLabView.js';
import { PrepareImageError } from '../components/capture/imagePrep.js';
import { encodeBase64, validatePreparedImage } from '../capture/preparedImage.js';
import { runExtraction } from '../../netlify/functions/utils/capture/orchestrator.js';
import { createFakeExtractor } from '../../netlify/functions/utils/capture/fakeExtractor.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OPERATION_ID = /^cap_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CARD_VALUES = ['Avery', 'Quinn', 'avery.quinn', 'example.com', '555-01', 'Robotics', 'Partnerships', 'Example Way'];

const seg = (m, p) => [0xFF, m, (p.length + 2) >> 8, (p.length + 2) & 0xFF, ...p];
const JPEG = new Uint8Array([0xFF, 0xD8, ...seg(0xE0, [74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), ...seg(0xC0, [8, 0x04, 0x77, 0x07, 0xD0, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]), ...seg(0xDA, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]), 0x5A, 0xFF, 0xD9]);

function preparedImage(warnings = []) {
  return {
    version: 'card-image/v1', mimeType: 'image/jpeg', data: encodeBase64(JPEG), bytes: JPEG.length, widthPx: 2000, heightPx: 1143,
    preflight: { blur: 142.5, brightness: 131.2, glareRatio: 0.004, warnings, userOverrode: false },
  };
}

let extraction;
beforeEach(async () => {
  const result = await runExtraction({
    extractor: createFakeExtractor({}), image: preparedImage(), operationId: 'cap_3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90', startedAt: Date.now(),
  });
  extraction = result.extraction;
});

/** The network: captureConfig answers `config`; captureExtract answers each of `extracts` in turn. */
function network({ config = { status: 200, body: { enabled: true, stage: 'internal', witnessEnabled: false, reportEnabled: false } }, extracts = [] } = {}) {
  const calls = [];
  vi.stubGlobal('fetch', async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    const reply = url.endsWith('/captureConfig') ? config : extracts[Math.min(calls.filter(c => c.url.endsWith('/captureExtract')).length - 1, extracts.length - 1)];
    return { status: reply.status, json: async () => reply.body };
  });
  return calls;
}

const ok = () => ({ status: 200, body: { operationId: 'x', extraction } });
let logs;

function renderLab(prepare = async () => ({ image: preparedImage(), prepMs: 312 })) {
  render(<MemoryRouter><CaptureLab prepare={prepare} /></MemoryRouter>);
}

const photo = () => fireEvent.change(screen.getByTestId('take-photo'), { target: { files: [new File(['x'], 'IMG_0042.HEIC', { type: 'image/heic' })] } });
const extractButton = () => screen.getByRole('button', { name: /extract/i });
const extractCalls = calls => calls.filter(c => c.url.endsWith('/captureExtract'));

beforeEach(() => {
  logs = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) vi.spyOn(console, level).mockImplementation((...a) => logs.push(format(...a)));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Capture Lab', () => {
  it('says whether capture is on for this account', async () => {
    network();
    renderLab();
    expect(await screen.findByText('Capture is on for you (internal).')).toBeTruthy();
  });

  it('photo → prepared image with its diagnostics → extract → every field with its confidence', async () => {
    const calls = network({ extracts: [ok()] });
    renderLab();
    photo();
    expect(await screen.findByText('2000 × 1143')).toBeTruthy();
    expect(screen.getByTestId('prep-ms').textContent).toMatch(/^312 ms/);
    expect(screen.getByText('none')).toBeTruthy();                               // no quality warnings

    fireEvent.click(extractButton());
    expect(await screen.findByText('3. Extracted')).toBeTruthy();
    const rows = screen.getAllByTestId('field-row');
    const fullName = rows.find(r => within(r).queryByText('Full name'));
    expect(within(fullName).getByText('Avery Quinn')).toBeTruthy();
    expect(within(fullName).getByText('confirmed')).toBeTruthy();
    const email = rows.find(r => within(r).queryByText('Email 1'));
    expect(within(email).getByText('likely')).toBeTruthy();
    expect(screen.getByText(/fake · model fake-v1 · prompt fake-v1 · adapter 1/)).toBeTruthy();
    expect(screen.getByTestId('latency').textContent).toMatch(/round trip · extractor/);
    expect(extractButton().disabled).toBe(true);                                  // a read scan needs a new photo

    // The exact request: the user's own id, a cap_ operation, the prepared image untouched.
    const [request] = extractCalls(calls);
    expect(request.url).toBe('/.netlify/functions/captureExtract');
    expect(request.headers.Authorization).toBe('Bearer tok_SECRET_admin');
    expect(Object.keys(request.body).sort()).toEqual(['image', 'operationId', 'userId']);
    expect(request.body.userId).toBe('uid_admin_7g5g');
    expect(request.body.operationId).toMatch(OPERATION_ID);
    expect(request.body.image).toEqual(preparedImage());
    expect(validatePreparedImage(request.body.image)).toEqual({ ok: true });
  });

  it('a quality warning must be kept through "Use anyway" before extracting', async () => {
    const calls = network({ extracts: [ok()] });
    renderLab(async () => ({ image: preparedImage(['blurry', 'glare']), prepMs: 400 }));
    photo();
    expect(await screen.findByText(/This photo looks blurry\. There's glare on the card\./)).toBeTruthy();
    expect(extractButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Use anyway' }));
    expect(extractButton().disabled).toBe(false);
    fireEvent.click(extractButton());
    await screen.findByText('3. Extracted');
    expect(extractCalls(calls)[0].body.image.preflight).toMatchObject({ warnings: ['blurry', 'glare'], userOverrode: true });
  });

  it('a photo that cannot be prepared says why and sends nothing', async () => {
    const calls = network();
    renderLab(async () => { throw new PrepareImageError('unsupported_format'); });
    photo();
    expect(await screen.findByText(/This photo format isn't supported/)).toBeTruthy();
    expect(screen.getByText('unsupported_format')).toBeTruthy();
    expect(extractCalls(calls)).toEqual([]);
  });

  it('a retryable failure retries the same scan; a final one needs a new photo', async () => {
    const calls = network({ extracts: [{ status: 503, body: { error: 'unavailable', operationId: 'x', retryable: true } }, ok()] });
    renderLab();
    photo();
    await screen.findByText('2000 × 1143');
    fireEvent.click(extractButton());
    expect(await screen.findByText(/The extractor is unavailable\. Retry\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry this scan/i }));
    await screen.findByText('3. Extracted');
    const [first, second] = extractCalls(calls);
    expect(second.body.operationId).toBe(first.body.operationId);
  });

  it('no_text is final: no retry, and the scan cannot be resent', async () => {
    network({ extracts: [{ status: 422, body: { error: 'no_text', operationId: 'x' } }] });
    renderLab();
    photo();
    await screen.findByText('2000 × 1143');
    fireEvent.click(extractButton());
    expect(await screen.findByText(/No text could be read on this photo/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /retry this scan/i })).toBeNull();
    expect(extractButton().disabled).toBe(true);
  });

  it('each new photo is a new scan', async () => {
    const calls = network({ extracts: [ok(), ok()] });
    renderLab();
    photo();
    await screen.findByText('2000 × 1143');
    fireEvent.click(extractButton());
    await screen.findByText('3. Extracted');
    photo();
    await waitFor(() => expect(extractButton().disabled).toBe(false));
    fireEvent.click(extractButton());
    await waitFor(() => expect(extractCalls(calls)).toHaveLength(2));
    expect(extractCalls(calls)[1].body.operationId).not.toBe(extractCalls(calls)[0].body.operationId);
  });

  it('with capture off it still prepares, but will not extract', async () => {
    const calls = network({ config: { status: 200, body: { enabled: false, stage: null, witnessEnabled: false, reportEnabled: false } } });
    renderLab();
    expect(await screen.findByText(/Capture is off for this account on this deploy/)).toBeTruthy();
    photo();
    await screen.findByText('2000 × 1143');
    expect(extractButton().disabled).toBe(true);
    expect(extractCalls(calls)).toEqual([]);
  });

  it('copies diagnostics without a single card value', async () => {
    network({ extracts: [ok()] });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText }, userAgent: 'TestPhone/1.0' });
    renderLab();
    photo();
    await screen.findByText('2000 × 1143');
    fireEvent.click(extractButton());
    await screen.findByText('3. Extracted');
    fireEvent.click(screen.getByRole('button', { name: /copy diagnostics/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = JSON.parse(writeText.mock.calls[0][0]);
    expect(copied).toMatchObject({
      device: 'TestPhone/1.0',
      original: { type: 'image/heic', bytes: 1 },
      prepared: { widthPx: 2000, heightPx: 1143, prepMs: 312, warnings: [], userOverrode: false },
      extraction: { httpStatus: 200, status: 'ok', provider: { id: 'fake', modelId: 'fake-v1' }, counts: { fields: 12 } },
    });
    for (const value of CARD_VALUES) expect(writeText.mock.calls[0][0]).not.toContain(value);
    expect(writeText.mock.calls[0][0]).not.toContain(preparedImage().data);
  });

  it('logs nothing, and calls nothing but captureConfig and captureExtract', async () => {
    const calls = network({ extracts: [{ status: 503, body: { error: 'unavailable', retryable: true } }, ok()] });
    renderLab();
    photo();
    await screen.findByText('2000 × 1143');
    fireEvent.click(extractButton());
    fireEvent.click(await screen.findByRole('button', { name: /retry this scan/i }));
    await screen.findByText('3. Extracted');
    expect(logs).toEqual([]);
    expect([...new Set(calls.map(c => c.url))].sort()).toEqual(['/.netlify/functions/captureConfig', '/.netlify/functions/captureExtract']);
  });

  it('diagnostics of nothing are empty', () => {
    expect(diagnostics({})).toEqual({ device: null, original: null, prepared: null, extraction: null });
  });
});

describe('Capture Lab: what it may touch', () => {
  const files = ['src/components/capture/CaptureLab.jsx', 'src/components/capture/captureLabApi.js', 'src/components/capture/captureLabView.js'];
  const imports = path => [...readFileSync(resolve(repo, path), 'utf8').matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)].map(m => m[1]);

  it('imports nothing that can write: no Firestore, no contact, company or relationship code', () => {
    expect([...new Set(files.flatMap(imports))].sort()).toEqual([
      '../../firebase/config', './captureLabApi.js', './captureLabView.js', './imagePrep.js', 'lucide-react', 'react', 'react-router-dom',
    ]);
  });

  it('is an admin-only route', () => {
    const app = readFileSync(resolve(repo, 'src/App.jsx'), 'utf8');
    expect(app).toMatch(/path="\/admin\/capture-lab"\s*element=\{\s*<ProtectedAdminRoute>\s*<CaptureLab \/>\s*<\/ProtectedAdminRoute>/);
    expect(app.match(/<CaptureLab\b/g)).toHaveLength(1);
  });
});
