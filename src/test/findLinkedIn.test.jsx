/**
 * Find LinkedIn, the screen after Add Person (src/components/capture/FindLinkedIn.jsx).
 *
 * Pins that it is offered only for a saved person with no LinkedIn (anyone
 * else goes straight to their profile), that Skip opens the profile, that the
 * search uses the saved contact's own details, that each likely profile shows
 * who it is and why it matched, that "none found" and errors leave the person
 * saved and the way to their profile open, that nothing is attached until the
 * user taps "This is Kristin" (or pastes a link), what the screen says after,
 * and that the screen itself writes nothing directly and logs nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'uid_admin_7g5g', getIdToken: async () => 'tok_admin' } },
  db: {},
}));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => ({ uid: 'uid_admin_7g5g' }) }));

import FindLinkedIn from '../components/capture/FindLinkedIn.jsx';
import { searchPersonFrom, matchExplanation } from '../components/capture/findLinkedInView.js';
import { findLinkedInProfiles } from '../components/capture/captureLabApi.js';

const T = { cardBg: '#fff', border: '#ddd', text: '#111', textMuted: '#555', textFaint: '#888' };
const KRISTIN = {
  id: 'cap_x_p1', name: 'Kristin Sokol', title: 'Instructional Matchmaker', company_name: 'Bright Path Learning',
  email: 'kristin@brightpathlearning.com', website: 'www.brightpathlearning.com',
};
const CANDIDATES = [
  {
    linkedinUrl: 'https://www.linkedin.com/in/kristin-sokol', name: 'Kristin Sokol', headline: 'Instructional Matchmaker at Bright Path Learning',
    company: 'Bright Path Learning', location: 'Salt Lake City, Utah', photoUrl: 'https://apollo.example/photo.jpg',
    sources: ['apollo', 'search'], strength: 'strong', reasons: ['name', 'company', 'title'],
  },
  {
    linkedinUrl: 'https://www.linkedin.com/in/kristin-sokol-2', name: 'Kristin Sokol', headline: 'Instructional Designer',
    company: null, location: 'Utah', photoUrl: null, sources: ['search'], strength: 'good', reasons: ['name', 'location'],
  },
];
const CARD_VALUES = ['Kristin', 'Sokol', 'Bright Path', 'brightpath', 'Matchmaker', 'linkedin.com/in'];

let logs;
beforeEach(() => {
  logs = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) vi.spyOn(console, level).mockImplementation((...a) => logs.push(format(...a)));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const LINKED = Object.freeze({ status: 'linked', profileStatus: 'found', filled: ['headline', 'location', 'photo_url'], suggestions: [] });

function renderFind({
  contact = KRISTIN,
  search = vi.fn(async () => ({ status: 200, body: { candidates: CANDIDATES } })),
  confirm = vi.fn(async () => LINKED),
  accept = vi.fn(async () => {}),
} = {}) {
  const onDone = vi.fn();
  const loadContact = vi.fn(async () => contact);
  render(<FindLinkedIn contactId="cap_x_p1" onDone={onDone} T={T} loadContact={loadContact} search={search} confirm={confirm} accept={accept} />);
  return { onDone, loadContact, search, confirm, accept };
}

async function showResults(options) {
  const rendered = renderFind(options);
  fireEvent.click(await screen.findByRole('button', { name: /Find LinkedIn/ }));
  await screen.findAllByTestId('linkedin-candidate');
  return rendered;
}

describe('offered after a save, never in the way', () => {
  it('a saved person without LinkedIn: "added", and Find LinkedIn or Skip', async () => {
    const { onDone } = renderFind();
    expect(await screen.findByText('Kristin Sokol added')).toBeTruthy();
    expect(screen.getByText('Find their LinkedIn and complete the profile?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onDone).toHaveBeenCalledWith('cap_x_p1');
  });

  it('someone who already has a LinkedIn goes straight to their profile', async () => {
    const { onDone, search } = renderFind({ contact: { ...KRISTIN, linkedin_url: 'https://www.linkedin.com/in/kristin-sokol' } });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('cap_x_p1'));
    expect(search).not.toHaveBeenCalled();
    expect(screen.queryByText(/Find their LinkedIn/)).toBeNull();
  });

  it('a contact that cannot be read: straight to the profile, nothing searched', async () => {
    const onDone = vi.fn();
    const search = vi.fn();
    render(<FindLinkedIn contactId="cap_x_p1" onDone={onDone} T={T} loadContact={async () => { throw new Error('offline'); }} search={search} />);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('cap_x_p1'));
    expect(search).not.toHaveBeenCalled();
  });
});

describe('the likely profiles', () => {
  it('searches with the saved contact\'s details and shows each profile with why it matched', async () => {
    const { search } = renderFind();
    fireEvent.click(await screen.findByRole('button', { name: /Find LinkedIn/ }));
    const cards = await screen.findAllByTestId('linkedin-candidate');
    expect(search).toHaveBeenCalledWith({
      name: 'Kristin Sokol', company: 'Bright Path Learning', title: 'Instructional Matchmaker',
      domain: 'brightpathlearning.com', email: 'kristin@brightpathlearning.com', location: null,
    });
    expect(cards).toHaveLength(2);
    const first = within(cards[0]);
    expect(first.getByText('Instructional Matchmaker at Bright Path Learning')).toBeTruthy();
    expect(first.getByText('Bright Path Learning')).toBeTruthy();
    expect(first.getByText('Salt Lake City, Utah')).toBeTruthy();
    expect(first.getByText(/Strong match: name \+ company \+ title/)).toBeTruthy();
    expect(first.getByText(/found by Apollo and Google/)).toBeTruthy();
    expect(first.getByRole('link').getAttribute('href')).toBe('https://www.linkedin.com/in/kristin-sokol');
    expect(first.getByRole('link').getAttribute('rel')).toBe('noopener noreferrer');
    expect(cards[0].querySelector('img').getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(within(cards[1]).getByText(/Good match: name \+ location/)).toBeTruthy();
    expect(within(cards[1]).getByText('KS')).toBeTruthy();                       // no photo: initials
  });

  it('nothing is attached by showing them; None of these opens the profile', async () => {
    const { onDone, confirm } = await showResults();
    expect(screen.getAllByRole('button', { name: 'This is Kristin' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /None of these/ }));
    expect(onDone).toHaveBeenCalledWith('cap_x_p1');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('none found: says so, and opens the profile', async () => {
    const { onDone } = renderFind({ search: vi.fn(async () => ({ status: 200, body: { candidates: [] } })) });
    fireEvent.click(await screen.findByRole('button', { name: /Find LinkedIn/ }));
    expect(await screen.findByText('No likely LinkedIn profile found for Kristin Sokol.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('a failed search can be tried again or skipped; a disabled account is told so', async () => {
    const search = vi.fn()
      .mockResolvedValueOnce({ status: 503, body: { error: 'unavailable', reason: 'sources_failed' } })
      .mockResolvedValueOnce({ status: 200, body: { candidates: CANDIDATES } });
    renderFind({ search });
    fireEvent.click(await screen.findByRole('button', { name: /Find LinkedIn/ }));
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't search LinkedIn right now.");
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findAllByTestId('linkedin-candidate')).toHaveLength(2);
  });

  it('capture off for this account: no retry, just the profile', async () => {
    renderFind({ search: vi.fn(async () => ({ status: 404, body: { error: 'capture_disabled' } })) });
    fireEvent.click(await screen.findByRole('button', { name: /Find LinkedIn/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('LinkedIn search is not available for this account.');
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
  });

  it('logs nothing', async () => {
    renderFind();
    fireEvent.click(await screen.findByRole('button', { name: /Find LinkedIn/ }));
    await screen.findAllByTestId('linkedin-candidate');
    expect(logs.filter(line => CARD_VALUES.some(v => line.includes(v)))).toEqual([]);
  });
});

describe('"This is Kristin"', () => {
  it('attaches the profile the user picked, then says what LinkedIn added', async () => {
    const { confirm, onDone } = await showResults();
    fireEvent.click(within(screen.getAllByTestId('linkedin-candidate')[1]).getByRole('button', { name: 'This is Kristin' }));
    expect(confirm).toHaveBeenCalledWith('cap_x_p1', 'https://www.linkedin.com/in/kristin-sokol-2');
    expect((await screen.findByText(/LinkedIn added to Kristin/))).toBeTruthy();
    expect(screen.getByText('Added from LinkedIn: headline, location and photo.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));
    expect(onDone).toHaveBeenCalledWith('cap_x_p1');
  });

  it('a different title is offered, kept unless the user takes it; a different company is only shown', async () => {
    const suggestions = [
      { field: 'title', current: 'Instructional Matchmaker', suggested: 'Director of Matching', actionable: true },
      { field: 'company', current: 'Bright Path Learning', suggested: 'Bright Path', actionable: false },
    ];
    const { accept } = await showResults({ confirm: vi.fn(async () => ({ ...LINKED, filled: [], suggestions })) });
    fireEvent.click(screen.getAllByRole('button', { name: 'This is Kristin' })[0]);
    expect(await screen.findByText('Nothing new to add: the contact already has what LinkedIn shows.')).toBeTruthy();
    const title = screen.getByTestId('linkedin-title-suggestion');
    expect(title.textContent).toContain('Director of Matching');
    expect(title.textContent).toContain('Instructional Matchmaker');
    const company = screen.getByTestId('linkedin-company-difference');
    expect(company.textContent).toContain('Bright Path Learning');
    expect(within(company).queryByRole('button')).toBeNull();
    expect(accept).not.toHaveBeenCalled();

    fireEvent.click(within(title).getByRole('button', { name: "Use LinkedIn's title" }));
    expect(accept).toHaveBeenCalledWith('cap_x_p1', suggestions[0]);
    expect(await within(title).findByText('Title updated')).toBeTruthy();
  });

  it('taking the title can fail and be tried again', async () => {
    const accept = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce();
    const suggestions = [{ field: 'title', current: 'A', suggested: 'B', actionable: true }];
    await showResults({ confirm: vi.fn(async () => ({ ...LINKED, suggestions })), accept });
    fireEvent.click(screen.getAllByRole('button', { name: 'This is Kristin' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: "Use LinkedIn's title" }));
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't update the title. Try again.");
    fireEvent.click(screen.getByRole('button', { name: "Use LinkedIn's title" }));
    expect(await screen.findByText('Title updated')).toBeTruthy();
  });

  it('linked without details: says why nothing was added', async () => {
    for (const [profileStatus, text] of [['not_found', 'No more details were available for this profile.'], ['failed', "Couldn't load more details from LinkedIn right now."]]) {
      const view = await showResults({ confirm: vi.fn(async () => ({ ...LINKED, profileStatus, filled: [] })) });
      fireEvent.click(screen.getAllByRole('button', { name: 'This is Kristin' })[0]);
      expect(await screen.findByText(text)).toBeTruthy();
      expect(view.onDone).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('already on another contact: nothing changed, and either person can be opened', async () => {
    const { onDone } = await showResults({ confirm: vi.fn(async () => ({ status: 'taken', by: { contactId: 'c_other', name: 'Kris Sokol', count: 1 } })) });
    fireEvent.click(screen.getAllByRole('button', { name: 'This is Kristin' })[0]);
    expect((await screen.findByRole('alert')).textContent).toMatch(/already on Kris Sokol.*Nothing was changed/);
    fireEvent.click(screen.getByRole('button', { name: 'Open Kris' }));
    expect(onDone).toHaveBeenCalledWith('c_other');
    fireEvent.click(screen.getByRole('button', { name: 'Choose another' }));
    expect(screen.getAllByTestId('linkedin-candidate')).toHaveLength(2);
  });

  it('the contact got a different LinkedIn meanwhile: nothing changed', async () => {
    await showResults({ confirm: vi.fn(async () => ({ status: 'has_other' })) });
    fireEvent.click(screen.getAllByRole('button', { name: 'This is Kristin' })[0]);
    expect((await screen.findByRole('alert')).textContent).toBe('Kristin Sokol already has a different LinkedIn profile. Nothing was changed.');
  });

  it('a failed save can be tried again with the same profile, or skipped', async () => {
    const confirm = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(LINKED);
    await showResults({ confirm });
    fireEvent.click(screen.getAllByRole('button', { name: 'This is Kristin' })[0]);
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't add the LinkedIn profile.");
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByText(/LinkedIn added to Kristin/)).toBeTruthy();
    expect(confirm.mock.calls).toEqual([['cap_x_p1', CANDIDATES[0].linkedinUrl], ['cap_x_p1', CANDIDATES[0].linkedinUrl]]);
  });

  it('none found: a pasted profile link is used, in its one form; anything else is refused', async () => {
    const { confirm } = renderFind({ search: vi.fn(async () => ({ status: 200, body: { candidates: [] } })) });
    fireEvent.click(await screen.findByRole('button', { name: /Find LinkedIn/ }));
    const input = await screen.findByLabelText('Or paste their LinkedIn link');
    fireEvent.change(input, { target: { value: 'https://www.linkedin.com/company/bright-path' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add this profile' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/isn't a LinkedIn profile link/);
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: ' uk.linkedin.com/in/Kristin-Sokol/?trk=card ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add this profile' }));
    expect(confirm).toHaveBeenCalledWith('cap_x_p1', 'https://www.linkedin.com/in/kristin-sokol');
    expect(await screen.findByText(/LinkedIn added to Kristin/)).toBeTruthy();
  });

  it('logs nothing on the way', async () => {
    await showResults();
    fireEvent.click(screen.getAllByRole('button', { name: 'This is Kristin' })[0]);
    await screen.findByText(/LinkedIn added to Kristin/);
    expect(logs.filter(line => CARD_VALUES.some(v => line.includes(v)))).toEqual([]);
  });
});

describe('what is searched with', () => {
  it('the contact\'s own details; a domain from the website, else a work email, never a free-mail one', () => {
    expect(searchPersonFrom({ name: ' Ann Lee ', company: 'Acme', email: 'ann@acme.io', city: 'Provo', state: 'UT' }))
      .toEqual({ name: 'Ann Lee', company: 'Acme', title: null, domain: 'acme.io', email: 'ann@acme.io', location: 'Provo, UT' });
    expect(searchPersonFrom({ name: 'Ann Lee', email: 'ann.lee@gmail.com' }).domain).toBeNull();
    expect(searchPersonFrom({ name: 'Ann Lee', website: 'https://www.acme.com/about', email: 'ann@other.com' }).domain).toBe('acme.com');
  });

  it('explains a match in words', () => {
    expect(matchExplanation({ strength: 'strong', reasons: ['name', 'domain'] })).toBe('Strong match: name + company website');
    expect(matchExplanation({ strength: 'possible', reasons: ['name'] })).toBe('Possible match: name');
  });

  it('the request: captureLinkedIn, as the signed-in user, with the person and nothing else', async () => {
    const calls = [];
    vi.stubGlobal('fetch', async (url, init) => {
      calls.push({ url, init });
      return { status: 200, json: async () => ({ candidates: [] }) };
    });
    await findLinkedInProfiles({ name: 'Kristin Sokol' });
    expect(calls[0].url).toBe('/.netlify/functions/captureLinkedIn');
    expect(calls[0].init.headers.Authorization).toBe('Bearer tok_admin');
    expect(JSON.parse(calls[0].init.body)).toEqual({ userId: 'uid_admin_7g5g', person: { name: 'Kristin Sokol' } });
  });
});

describe('where the writes are', () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const read = path => readFileSync(resolve(repo, path), 'utf8');
  const importsOf = path => [...read(path).matchAll(/(?:from\s+|^import\s+)['"]([^'"]+)['"]/gm)].map(m => m[1]);

  it('the screen reads one contact and writes only through linkedinConfirm; it logs nothing', () => {
    expect(read('src/components/capture/FindLinkedIn.jsx')).not.toMatch(/setDoc|updateDoc|addDoc|deleteDoc|runTransaction|writeBatch|console\./);
    expect(importsOf('src/components/capture/FindLinkedIn.jsx').sort()).toEqual([
      '../../context/ImpersonationContext', '../../firebase/config', './captureLabApi.js', './findLinkedInView.js',
      './linkedinConfirm.js', './linkedinEnrichment.js', 'firebase/firestore', 'lucide-react', 'react',
    ]);
  });

  it('linkedinConfirm updates one contact, and only that way; nothing there logs', () => {
    const src = read('src/components/capture/linkedinConfirm.js');
    expect(src).not.toMatch(/setDoc|addDoc|deleteDoc|runTransaction|writeBatch|console\./);
    expect(src.match(/updateDoc\(/g)).toHaveLength(2);                 // the confirm, and a taken suggestion
    expect(read('src/components/capture/linkedinEnrichment.js')).not.toMatch(/firebase|fetch\(|console\./);
  });
});
