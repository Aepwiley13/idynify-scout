/**
 * Scan Business Card: the Match → Save screen, and the whole flow from the
 * Scout+ card to the saved contact's profile.
 *
 * The matching and saving themselves are captureSave.js (its own suite runs
 * them against Firestore). Here they are stubbed, to pin what the person sees
 * for each answer (New person / Already in IDYNIFY / Possible match / Needs
 * review; Existing company / Possible match / New company / No company), what
 * they must decide before Save is offered, that an edit after the check asks
 * for a new check, that a moved match is shown rather than saved, and that a
 * save opens the contact's page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';

const T = { appBg: '#fff', navBg: '#fff', cardBg: '#fff', surface: '#fafafa', statBg: '#eee', border: '#ddd', text: '#111', textMuted: '#555', textFaint: '#888', input: '#fff', isDark: false };
const viewer = vi.hoisted(() => ({ impersonating: false }));
const api = vi.hoisted(() => ({ preview: vi.fn(), save: vi.fn() }));
// The real photo preparation needs a browser canvas: the flow is handed a prepared photo.
const prep = vi.hoisted(() => ({ image: null }));
// The contact Find LinkedIn reads after a save.
const savedContacts = vi.hoisted(() => new Map());

vi.mock('../theme/ThemeContext', () => ({ useT: () => T }));
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => (viewer.impersonating ? { uid: 'uid_customer_9', _isImpersonated: true } : { uid: 'uid_admin_7g5g' }),
}));
vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'uid_admin_7g5g', getIdToken: async () => 'tok_admin' }, onAuthStateChanged: () => () => {} },
  db: {},
}));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal()),
  doc: (_db, ...path) => ({ path: path.join('/'), id: path[path.length - 1] }),
  getDoc: async (ref) => ({ id: ref.id, exists: () => savedContacts.has(ref.id), data: () => savedContacts.get(ref.id) }),
}));
vi.mock('../services/analytics', () => ({ logEvent: vi.fn(), EVENTS: new Proxy({}, { get: (_, k) => String(k) }) }));
vi.mock('../components/capture/captureSave.js', () => ({
  previewCapturePerson: (...a) => api.preview(...a),
  saveCapturePerson: (...a) => api.save(...a),
}));
vi.mock('../components/capture/imagePrep.js', async (importOriginal) => ({
  ...(await importOriginal()),
  prepareCardImage: async () => ({ image: prep.image, prepMs: 200 }),
}));
vi.mock('../components/scout/ManualContactForm', () => ({ default: () => <div>manual</div> }));
vi.mock('../components/scout/CSVUpload', () => ({ default: () => <div>csv</div> }));
vi.mock('../components/scout/LinkedInLinkSearch', () => ({ default: () => <div>linkedin</div> }));
vi.mock('../pages/Scout/CompanySearch', () => ({ default: () => <div>company search</div> }));
vi.mock('../components/cadences/CadencePickerModal', () => ({ default: () => null }));

import CaptureSavePanel from '../components/capture/CaptureSavePanel.jsx';
import ScoutPlus from '../pages/Scout/ScoutPlus';
import { makePhone } from '../utils/contactPhones';
import { encodeBase64 } from '../capture/preparedImage.js';
import { runExtraction } from '../../netlify/functions/utils/capture/orchestrator.js';
import { createFakeExtractor } from '../../netlify/functions/utils/capture/fakeExtractor.js';

const OP = 'cap_3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
const draft = (over = {}) => ({
  key: 'person-1', name: 'Avery Quinn', title: 'Director of Partnerships', company: 'Example Robotics',
  email: 'avery.quinn@example.com', otherEmails: [], linkedinUrl: '', website: 'www.example.com',
  phones: [makePhone({ id: 'card-1', value: '415-555-0142', label: 'mobile', labelSource: 'card' })], toCheck: [], ...over,
});

const NEW = { person: { status: 'new' }, company: { status: 'new', name: 'Example Robotics' } };

function renderPanel(people = [draft()]) {
  const onSaved = vi.fn();
  const view = render(<CaptureSavePanel operationId={OP} people={people} onSaved={onSaved} T={T} />);
  return { onSaved, ...view };
}

const cont = () => fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

beforeEach(() => {
  viewer.impersonating = false;
  api.preview.mockReset();
  api.save.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('Match: what the person sees before saving', () => {
  it('Continue needs a name', () => {
    renderPanel([draft({ name: ' ' })]);
    expect(screen.getByRole('button', { name: 'Continue' }).disabled).toBe(true);
    expect(screen.getByText('Add a name to continue.')).toBeTruthy();
  });

  it('a new person at a new company: "Add Person" saves what was shown, then hands back the contact', async () => {
    api.preview.mockResolvedValue(NEW);
    api.save.mockResolvedValue({ status: 'saved', contactId: `${OP}_p1`, companyId: 'co_9', outcome: 'created' });
    const { onSaved } = renderPanel();
    cont();
    expect(await screen.findByText(/New person\./)).toBeTruthy();
    expect(screen.getByTestId('company-match').textContent).toMatch(/New company: Example Robotics, added to Saved Companies/);
    expect(api.preview).toHaveBeenCalledWith('uid_admin_7g5g', { operationId: OP, index: 0, draft: draft() });

    fireEvent.click(screen.getByRole('button', { name: /Add Person/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith([{ contactId: `${OP}_p1`, companyId: 'co_9', outcome: 'created' }]));
    expect(api.save).toHaveBeenCalledWith('uid_admin_7g5g', {
      operationId: OP, index: 0, draft: draft(), shown: { status: 'new' }, choices: { person: null, company: 'link' },
    });
  });

  it('already in IDYNIFY: says who and on what, keeps their company, and offers "Update"', async () => {
    api.preview.mockResolvedValue({
      person: { status: 'existing', contactId: 'c_1', name: 'Avery Q.', company: 'Example Robotics', matchedOn: 'email' },
      company: { status: 'existing', companyId: 'co_1', name: 'Example Robotics' },
    });
    renderPanel();
    cont();
    expect((await screen.findByTestId('person-match')).textContent).toMatch(/Already in IDYNIFY: Avery Q\. · Example Robotics \(same email\)\./);
    expect(screen.getByTestId('company-match').textContent).toMatch(/Company stays Example Robotics\./);
    expect(screen.getByRole('button', { name: /Update Avery Q\./ })).toBeTruthy();
  });

  it('a possible match must be answered before saving; the answer is passed to save', async () => {
    api.preview.mockResolvedValue({
      person: { status: 'review', matchedOn: 'name_company', candidates: [{ contactId: 'c_weak', name: 'Avery Quinn', company: 'Example Robotics' }] },
      company: { status: 'existing', companyId: 'co_1', name: 'Example Robotics' },
    });
    api.save.mockResolvedValue({ status: 'saved', contactId: 'c_weak', companyId: 'co_1', outcome: 'updated' });
    renderPanel();
    cont();
    await screen.findByText(/Possible match\./);
    const save = screen.getByRole('button', { name: /Add Person/ });
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Same person: update Avery Quinn · Example Robotics/));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    expect(api.save.mock.calls[0][1].choices).toEqual({ person: 'c_weak', company: 'link' });
  });

  it('needs review (two contacts share the email): explained, and nothing can be saved', async () => {
    api.preview.mockResolvedValue({ person: { status: 'conflict', matchedOn: 'email', count: 2 }, company: { status: 'none' } });
    renderPanel();
    cont();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Needs review\. 2 contacts in IDYNIFY already share this email/);
    expect(screen.getByRole('button', { name: /Add Person/ }).disabled).toBe(true);
  });

  it('a possible company match is linked by default, or left out when the person says so', async () => {
    api.preview.mockResolvedValue({ person: { status: 'new' }, company: { status: 'possible', companyId: 'co_1', name: 'Example Corp' } });
    api.save.mockResolvedValue({ status: 'saved', contactId: `${OP}_p1`, companyId: null, outcome: 'created' });
    renderPanel();
    cont();
    expect((await screen.findByTestId('company-match')).textContent).toMatch(/Possible company match: Example Corp/);
    expect(screen.getByLabelText('Link to Example Corp').checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Don't link a company"));
    fireEvent.click(screen.getByRole('button', { name: /Add Person/ }));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    expect(api.save.mock.calls[0][1].choices.company).toBe('none');
  });

  it('no company on the card: says so', async () => {
    api.preview.mockResolvedValue({ person: { status: 'new' }, company: { status: 'none' } });
    renderPanel();
    cont();
    expect((await screen.findByTestId('company-match')).textContent).toBe('No company.');
  });

  it('an edit after the check asks for a new check', async () => {
    api.preview.mockResolvedValue(NEW);
    const { rerender, onSaved } = renderPanel();
    cont();
    await screen.findByText(/New person\./);
    rerender(<CaptureSavePanel operationId={OP} people={[draft({ email: 'avery@other.example' })]} onSaved={onSaved} T={T} />);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(screen.queryByText(/New person\./)).toBeNull();
  });

  it('the match moved since it was shown: nothing saved, the new match shown, save again', async () => {
    api.preview.mockResolvedValue(NEW);
    api.save.mockResolvedValueOnce({ status: 'changed', person: { status: 'existing', contactId: 'c_9', name: 'Avery Quinn', company: null, matchedOn: 'email' } });
    const { onSaved } = renderPanel();
    cont();
    fireEvent.click(await screen.findByRole('button', { name: /Add Person/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Something changed in IDYNIFY since you checked/);
    expect(screen.getByTestId('person-match').textContent).toMatch(/Already in IDYNIFY: Avery Quinn/);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('a failed save keeps everything and can be tried again', async () => {
    api.preview.mockResolvedValue(NEW);
    api.save.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ status: 'saved', contactId: `${OP}_p1`, companyId: null, outcome: 'created' });
    const { onSaved } = renderPanel();
    cont();
    fireEvent.click(await screen.findByRole('button', { name: /Add Person/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't save/);
    fireEvent.click(screen.getByRole('button', { name: /Add Person/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.save).toHaveBeenCalledTimes(2);
  });

  it('already saved from this scan: no second save, just open the contact', async () => {
    api.preview.mockResolvedValue({ person: { status: 'saved', contactId: `${OP}_p1`, name: 'Avery Quinn' }, company: { status: 'none' } });
    const { onSaved } = renderPanel();
    cont();
    expect(await screen.findByText(/Already saved from this scan/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add Person/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open contact' }));
    expect(onSaved).toHaveBeenCalledWith([{ contactId: `${OP}_p1`, companyId: null, outcome: 'already_saved' }]);
    expect(api.save).not.toHaveBeenCalled();
  });

  it('never while viewing as another user', () => {
    viewer.impersonating = true;
    renderPanel();
    expect(screen.getByText(/not available while viewing as another user/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });
});

// ─── The whole flow ─────────────────────────────────────────────────────────

const seg = (m, p) => [0xFF, m, (p.length + 2) >> 8, (p.length + 2) & 0xFF, ...p];
const JPEG = new Uint8Array([0xFF, 0xD8, ...seg(0xE0, [74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), ...seg(0xC0, [8, 0x04, 0x77, 0x07, 0xD0, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]), ...seg(0xDA, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]), 0x5A, 0xFF, 0xD9]);
const image = () => ({
  version: 'card-image/v1', mimeType: 'image/jpeg', data: encodeBase64(JPEG), bytes: JPEG.length, widthPx: 2000, heightPx: 1143,
  preflight: { blur: 142.5, brightness: 131.2, glareRatio: 0.004, warnings: [], userOverrode: false },
});

function ContactPage() {
  const { id } = useParams();
  return <div>CONTACT PAGE {id}</div>;
}

describe('Scout+ → Scan Business Card → photo → review → Add Person → Find LinkedIn → the contact', () => {
  it('opens the saved contact\'s page', async () => {
    const { extraction } = await runExtraction({ extractor: createFakeExtractor({}), image: image(), operationId: OP, startedAt: Date.now() });
    vi.stubGlobal('fetch', async (url) => (url.endsWith('/captureConfig')
      ? { status: 200, json: async () => ({ enabled: true, stage: 'internal' }) }
      : { status: 200, json: async () => ({ operationId: OP, extraction }) }));
    prep.image = image();
    api.preview.mockResolvedValue(NEW);
    api.save.mockImplementation(async (_uid, { operationId, draft }) => {
      savedContacts.set(`${operationId}_p1`, { name: draft.name, company_name: draft.company, linkedin_url: null });
      return { status: 'saved', contactId: `${operationId}_p1`, companyId: 'co_9', outcome: 'created' };
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/scout?tab=scout-plus']}>
        <Routes>
          <Route path="/scout" element={<ScoutPlus />} />
          <Route path="/contact/:id" element={<ContactPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: /Scan Business Card/ }));
    fireEvent.change(screen.getByTestId('capture-take-photo'), { target: { files: [new File(['x'], 'IMG_0042.HEIC', { type: 'image/heic' })] } });

    // Review: the card's details, editable.
    expect(await screen.findByText(/Check each detail against the card/)).toBeTruthy();
    expect(screen.getByLabelText('Name', { selector: 'input' }).value).toBe('Avery Quinn');

    // Match, then save.
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/New person\./)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Add Person/ }));

    // Saved, with no LinkedIn: Find LinkedIn is offered, and Skip opens the person.
    expect(await screen.findByText('Avery Quinn added')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Scan Business Card' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    // The contact's own page, for the id this scan gave the person.
    expect(await screen.findByText(/^CONTACT PAGE cap_[0-9a-f-]+_p1$/)).toBeTruthy();
    const [, saved] = api.save.mock.calls[0];
    expect(saved.draft).toMatchObject({ name: 'Avery Quinn', company: 'Example Robotics', email: 'avery.quinn@example.com' });
    expect(saved.draft.phones.map(p => p.label)).toEqual(['mobile', 'unknown']);
  });
});

describe('after Add Person, someone who already has a LinkedIn', () => {
  it('goes straight to their profile', async () => {
    const { extraction } = await runExtraction({ extractor: createFakeExtractor({}), image: image(), operationId: OP, startedAt: Date.now() });
    vi.stubGlobal('fetch', async (url) => (url.endsWith('/captureConfig')
      ? { status: 200, json: async () => ({ enabled: true, stage: 'internal' }) }
      : { status: 200, json: async () => ({ operationId: OP, extraction }) }));
    prep.image = image();
    api.preview.mockResolvedValue({ person: { status: 'existing', contactId: 'c_1', name: 'Avery Quinn', company: 'Example Robotics', matchedOn: 'email' }, company: { status: 'existing', companyId: 'co_1', name: 'Example Robotics' } });
    api.save.mockImplementation(async () => {
      savedContacts.set('c_1', { name: 'Avery Quinn', linkedin_url: 'https://www.linkedin.com/in/avery-quinn-example' });
      return { status: 'saved', contactId: 'c_1', companyId: 'co_1', outcome: 'updated' };
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/scout?tab=scout-plus']}>
        <Routes>
          <Route path="/scout" element={<ScoutPlus />} />
          <Route path="/contact/:id" element={<ContactPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: /Scan Business Card/ }));
    fireEvent.change(screen.getByTestId('capture-take-photo'), { target: { files: [new File(['x'], 'IMG_0042.HEIC', { type: 'image/heic' })] } });
    await screen.findByText(/Check each detail against the card/);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: /Update Avery Quinn/ }));
    expect(await screen.findByText('CONTACT PAGE c_1')).toBeTruthy();
    expect(screen.queryByText(/Find their LinkedIn/)).toBeNull();
  });
});
