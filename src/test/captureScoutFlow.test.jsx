/**
 * Scout+ → Scan Business Card: the internal capture flow, up to review.
 *
 * Pins who can open it (only when captureConfig says capture is on for the
 * signed-in user, and never while an admin is viewing as someone else; anyone
 * else keeps the "Coming soon" card, which is not a control), the flow
 * (photo → prepared on the device → quality warning → read → review), the
 * exact read request (the user's own id, one cap_ scan per photo, a retry on
 * the same scan only when the endpoint allows it), that review is a list of
 * people with every detail and every phone type editable, and that this step
 * calls nothing but captureConfig and captureExtract, imports nothing that
 * writes, and logs nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';

const T = { appBg: '#fff', navBg: '#fff', cardBg: '#fff', surface: '#fafafa', statBg: '#eee', border: '#ddd', text: '#111', textMuted: '#555', textFaint: '#888', input: '#fff', isDark: false };
const viewer = { impersonating: false };

vi.mock('../theme/ThemeContext', () => ({ useT: () => T }));
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => (viewer.impersonating
    ? { uid: 'uid_customer_9', _isImpersonated: true }
    : { uid: 'uid_admin_7g5g' }),
}));
vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'uid_admin_7g5g', getIdToken: async () => 'tok_SECRET_admin' }, onAuthStateChanged: () => () => {} },
  db: {},
}));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(() => ({})), getDocs: vi.fn() }));
vi.mock('../components/scout/ManualContactForm', () => ({ default: () => <div>manual</div> }));
vi.mock('../components/scout/CSVUpload', () => ({ default: () => <div>csv</div> }));
vi.mock('../components/scout/LinkedInLinkSearch', () => ({ default: () => <div>linkedin</div> }));
vi.mock('../pages/Scout/CompanySearch', () => ({ default: () => <div>company search</div> }));
vi.mock('../components/cadences/CadencePickerModal', () => ({ default: () => null }));

import ScoutPlus from '../pages/Scout/ScoutPlus';
import CaptureFlow from '../components/capture/CaptureFlow.jsx';
import { encodeBase64 } from '../capture/preparedImage.js';
import { runExtraction } from '../../netlify/functions/utils/capture/orchestrator.js';
import { createFakeExtractor } from '../../netlify/functions/utils/capture/fakeExtractor.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OPERATION_ID = /^cap_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CARD_VALUES = ['Avery', 'Quinn', 'avery.quinn', 'example.com', '555-01', 'Robotics', 'Partnerships'];

const seg = (m, p) => [0xFF, m, (p.length + 2) >> 8, (p.length + 2) & 0xFF, ...p];
const JPEG = new Uint8Array([0xFF, 0xD8, ...seg(0xE0, [74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), ...seg(0xC0, [8, 0x04, 0x77, 0x07, 0xD0, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]), ...seg(0xDA, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]), 0x5A, 0xFF, 0xD9]);
const preparedImage = (warnings = []) => ({
  version: 'card-image/v1', mimeType: 'image/jpeg', data: encodeBase64(JPEG), bytes: JPEG.length, widthPx: 2000, heightPx: 1143,
  preflight: { blur: 142.5, brightness: 131.2, glareRatio: 0.004, warnings, userOverrode: false },
});

async function extractionFor(scenario) {
  const result = await runExtraction({
    extractor: createFakeExtractor(scenario ? { CAPTURE_FAKE_SCENARIO: scenario } : {}),
    image: preparedImage(), operationId: 'cap_3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90', startedAt: Date.now(),
  });
  return result.extraction;
}

/** captureConfig answers `config`; captureExtract answers each of `extracts` in turn. */
function network({ config = { status: 200, body: { enabled: true, stage: 'internal', witnessEnabled: false, reportEnabled: false } }, extracts = [] } = {}) {
  const calls = [];
  vi.stubGlobal('fetch', async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    if (url.endsWith('/captureConfig')) {
      if (config instanceof Error) throw config;
      return { status: config.status, json: async () => config.body };
    }
    const n = calls.filter(c => c.url.endsWith('/captureExtract')).length - 1;
    const reply = extracts[Math.min(n, extracts.length - 1)];
    return { status: reply.status, json: async () => reply.body };
  });
  return calls;
}

const renderScoutPlus = () => render(
  <MemoryRouter initialEntries={['/scout?tab=scout-plus']}>
    <Routes><Route path="/scout" element={<ScoutPlus />} /></Routes>
  </MemoryRouter>,
);

const renderFlow = (prepare = async () => ({ image: preparedImage(), prepMs: 300 })) => render(<CaptureFlow prepare={prepare} />);
const photo = (testId = 'capture-take-photo') => fireEvent.change(screen.getByTestId(testId), { target: { files: [new File(['x'], 'IMG_0042.HEIC', { type: 'image/heic' })] } });
const extractCalls = calls => calls.filter(c => c.url.endsWith('/captureExtract'));
const field = name => screen.getByLabelText(name, { selector: 'input' });

let logs;
beforeEach(() => {
  viewer.impersonating = false;
  logs = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) vi.spyOn(console, level).mockImplementation((...a) => logs.push(format(...a)));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Who can open it ────────────────────────────────────────────────────────

describe('the Scout+ card opens capture only when capture is on for this account', () => {
  it('on (internal admin): the card is a control, says Internal, and opens the flow', async () => {
    const calls = network();
    renderScoutPlus();
    const card = await screen.findByRole('button', { name: /Scan Business Card/ });
    expect(screen.queryByText('COMING SOON')).toBeNull();
    expect(within(card).getByText('INTERNAL')).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/.netlify/functions/captureConfig');
    expect(calls[0].body).toEqual({ userId: 'uid_admin_7g5g' });

    fireEvent.click(card);
    expect(screen.getByRole('heading', { level: 2, name: 'Scan Business Card' })).toBeTruthy();
    expect(screen.getByTestId('capture-flow')).toBeTruthy();
    expect(screen.getByText(/Take photo/)).toBeTruthy();
    expect(screen.getByText(/Upload photo/)).toBeTruthy();
  });

  it.each([
    ['off for this account', { status: 200, body: { enabled: false, stage: null } }],
    ['refused', { status: 403, body: { error: 'forbidden' } }],
    ['unreachable', new Error('offline')],
  ])('%s: "Coming soon", not a control', async (_, config) => {
    const calls = network({ config });
    renderScoutPlus();
    await waitFor(() => expect(calls).toHaveLength(1));
    await new Promise(r => setTimeout(r, 0));
    const title = screen.getByText('Scan Business Card');
    expect(screen.getByText('COMING SOON')).toBeTruthy();
    expect(title.closest('button, a, [role="button"]')).toBeNull();
    expect(screen.queryByTestId('capture-flow')).toBeNull();
  });

  it('while still checking, the card stays "Coming soon"', () => {
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    renderScoutPlus();
    expect(screen.getByText('COMING SOON')).toBeTruthy();
    expect(screen.getByText('Scan Business Card').closest('button')).toBeNull();
  });

  it('an admin viewing as someone else: "Coming soon", and capture is not even asked', async () => {
    viewer.impersonating = true;
    const calls = network();
    renderScoutPlus();
    await new Promise(r => setTimeout(r, 0));
    expect(screen.getByText('COMING SOON')).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('the flow is not deep-linkable: a navigation asking for it lands on the menu', async () => {
    const calls = network();
    render(
      <MemoryRouter initialEntries={[{ pathname: '/scout', state: { initialView: 'capture' } }]}>
        <Routes><Route path="/scout" element={<ScoutPlus />} /></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Scout+' })).toBeTruthy();
    expect(screen.queryByTestId('capture-flow')).toBeNull();
    await screen.findByRole('button', { name: /Scan Business Card/ });
    expect(calls).toHaveLength(1);
    expect(screen.queryByTestId('capture-flow')).toBeNull();
  });
});

// ─── The flow ───────────────────────────────────────────────────────────────

describe('photo → read → review', () => {
  it('a photo is prepared, read as the signed-in user, and every detail is shown to review', async () => {
    const calls = network({ extracts: [{ status: 200, body: { extraction: await extractionFor() } }] });
    renderFlow();
    photo();

    expect(await screen.findByText(/Check each detail against the card/)).toBeTruthy();
    expect(field('Name').value).toBe('Avery Quinn');
    expect(field('Title').value).toBe('Director of Partnerships');
    expect(field('Company').value).toBe('Example Robotics');
    expect(field('Email').value).toBe('avery.quinn@example.com');
    expect(field('LinkedIn').value).toBe('linkedin.com/in/avery-quinn-example');
    expect(field('Website').value).toBe('www.example.com');

    // Every number with its type: the printed "T:" is not a type, so it is not guessed.
    const pills = screen.getAllByRole('button', { name: /^Phone type:/ });
    expect(pills.map(p => p.textContent)).toEqual(['Mobile', 'Type not set']);
    expect(screen.getByText('+1 (415) 555-0100 ext. 12')).toBeTruthy();
    expect(screen.getByAltText('The card you photographed')).toBeTruthy();
    expect(screen.getByText(/not switched on yet/)).toBeTruthy();

    const [request] = extractCalls(calls);
    expect(request.url).toBe('/.netlify/functions/captureExtract');
    expect(request.headers.Authorization).toBe('Bearer tok_SECRET_admin');
    expect(Object.keys(request.body).sort()).toEqual(['image', 'operationId', 'userId']);
    expect(request.body.userId).toBe('uid_admin_7g5g');
    expect(request.body.operationId).toMatch(OPERATION_ID);
    expect(request.body.image).toEqual(preparedImage());
  });

  it('every detail and every phone type can be corrected', async () => {
    network({ extracts: [{ status: 200, body: { extraction: await extractionFor() } }] });
    const user = userEvent.setup();
    renderFlow();
    photo();
    await screen.findByText(/Check each detail against the card/);

    await user.clear(field('Title'));
    await user.type(field('Title'), 'VP Partnerships');
    expect(field('Title').value).toBe('VP Partnerships');

    await user.click(screen.getByRole('button', { name: /^Phone type: Type not set/ }));
    await user.click(within(screen.getByRole('listbox', { name: 'Phone type' })).getByRole('option', { name: 'Main' }));
    expect(screen.getAllByRole('button', { name: /^Phone type:/ }).map(p => p.textContent)).toEqual(['Mobile', 'Main']);

    await user.click(screen.getByRole('button', { name: 'add phone' }));
    await user.type(screen.getByRole('textbox', { name: 'Phone number' }), '415-555-0199{Enter}');
    expect(screen.getAllByRole('button', { name: /^Phone type:/ }).map(p => p.textContent)).toEqual(['Mobile', 'Main', 'Type not set']);
  });

  it('a quality warning is kept through "Use anyway" before the card is read', async () => {
    const calls = network({ extracts: [{ status: 200, body: { extraction: await extractionFor() } }] });
    renderFlow(async () => ({ image: preparedImage(['blurry']), prepMs: 300 }));
    photo();
    expect(await screen.findByText(/This photo looks blurry\./)).toBeTruthy();
    expect(extractCalls(calls)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Use anyway' }));
    await screen.findByText(/Check each detail against the card/);
    expect(extractCalls(calls)[0].body.image.preflight.userOverrode).toBe(true);
  });

  it('a retryable failure is retried as the same scan; a new photo is a new scan', async () => {
    const calls = network({ extracts: [
      { status: 504, body: { error: 'timeout', operationId: 'x', retryable: true } },
      { status: 200, body: { extraction: await extractionFor() } },
    ] });
    renderFlow();
    photo();
    expect(await screen.findByText('Reading the card took too long. Try again.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await screen.findByText(/Check each detail against the card/);
    const [first, second] = extractCalls(calls);
    expect(second.body.operationId).toBe(first.body.operationId);

    fireEvent.click(screen.getByRole('button', { name: /Start over/ }));
    photo();
    await screen.findByText(/Check each detail against the card/);
    expect(extractCalls(calls)[2].body.operationId).not.toBe(first.body.operationId);
  });

  it('nothing readable: no retry of that scan; the details can be entered by hand', async () => {
    network({ extracts: [{ status: 422, body: { error: 'no_text', operationId: 'x' } }] });
    renderFlow();
    photo();
    expect(await screen.findByText(/No text could be read on this photo/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Enter details/ }));
    expect(field('Name').value).toBe('');
    expect(screen.queryAllByRole('button', { name: /^Phone type:/ })).toEqual([]);
  });

  it('text read but nothing usable: an empty person to fill in, and it says so', async () => {
    network({ extracts: [{ status: 200, body: { extraction: await extractionFor('unreadable') } }] });
    renderFlow();
    photo();
    expect(await screen.findByText(/Nothing usable could be read from this card/)).toBeTruthy();
    expect(field('Name').value).toBe('');
  });

  it('logs nothing at all, so no card value can reach a log', async () => {
    network({ extracts: [{ status: 200, body: { extraction: await extractionFor() } }] });
    renderFlow();
    photo();
    await screen.findByText(/Check each detail against the card/);
    const leaked = logs.filter(line => CARD_VALUES.some(v => line.includes(v)));
    expect(leaked).toEqual([]);
    expect(logs).toEqual([]);
  });
});

// ─── It saves nothing ───────────────────────────────────────────────────────

describe('this step cannot write', () => {
  const read = path => readFileSync(resolve(repo, path), 'utf8');
  const importsOf = src => [...src.matchAll(/(?:from\s+|import\s*\(\s*|^import\s+)['"]([^'"]+)['"]/gm)].map(m => m[1]);

  it('the capture flow files import only the Capture Lab parts, the phone and social helpers and the profile phone editor', () => {
    const files = {
      'src/components/capture/CaptureFlow.jsx': ['react', 'lucide-react', './imagePrep.js', './captureLabApi.js', './captureDraft.js', './CaptureReview.jsx', '../../theme/ThemeContext'],
      'src/components/capture/CaptureReview.jsx': ['lucide-react', '../contacts/ContactPhones', '../contacts/IdentityCard.css', './CaptureReview.css', './captureDraft.js', '../../utils/socialProfiles'],
      'src/components/capture/captureDraft.js': ['../../utils/phoneLabels', '../../utils/contactPhones', '../../utils/socialProfiles'],
      'src/components/capture/captureAvailability.js': ['react', '../../context/ImpersonationContext', './captureLabApi.js'],
    };
    for (const [path, allowed] of Object.entries(files)) {
      expect(importsOf(read(path)).sort(), path).toEqual([...allowed].sort());
    }
  });

  it('the profile phone editor it reuses touches no Firestore either', () => {
    const src = read('src/components/contacts/ContactPhones.jsx');
    expect(importsOf(src).some(spec => /firebase|services\//.test(spec))).toBe(false);
  });
});
