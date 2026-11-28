/**
 * The My Card page as a person uses it: loading, editing, saving, a draft that
 * comes back, a newer saved version, Download contact, and being an admin
 * viewing as someone else. The real page, hook, editor, storage and download
 * run; only the signed-in account (Firebase auth), the card service and the
 * impersonation context are stand-ins.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => {
  const auth = { currentUser: { uid: 'U' }, listeners: new Set() };
  auth.onAuthStateChanged = (callback) => {
    auth.listeners.add(callback);
    callback(auth.currentUser);
    return () => auth.listeners.delete(callback);
  };
  return { auth, service: {}, impersonation: { isImpersonating: false } };
});
vi.mock('../firebase/config', () => ({ db: {}, auth: mocks.auth }));
vi.mock('../services/myCardService', () => ({ myCardService: mocks.service }));
vi.mock('../context/ImpersonationContext', () => ({ useImpersonation: () => mocks.impersonation }));
// Only the photo-making is stood in for (jsdom has no canvas); the crop dialog, form, draft and save are the real ones.
vi.mock('../utils/photoPrep', async (importOriginal) => ({ ...(await importOriginal()), prepareProfilePhoto: vi.fn() }));

import MyCardPage from '../pages/ContactHub/MyCardPage';
import { saveDraft, readDraft, draftKey } from '../pages/ContactHub/myCard/state/myCardDraftStorage';
import { DEFAULT_SHARE, DEFAULT_LINK_SHARE, newCard, normalizeCard } from '../utils/myCardRules';
import { fingerprintOf, photoDataUrl } from './helpers/photoFixtures';
import { prepareProfilePhoto } from '../utils/photoPrep';

const savedCard = (extra = {}) => ({ ...newCard(), firstName: 'Ada', lastName: 'Lovelace', title: 'Analyst', ...extra });
const okResult = (revision = 3, extra = {}) => ({ status: 'ok', card: savedCard(extra), revision });
const missingResult = () => ({ status: 'missing', card: newCard(), revision: null });
const OFFLINE = { status: 'error', code: 'unavailable', message: 'Couldn\'t reach IDYNIFY. Check your connection and try again.', retryable: true };
const DENIED = { status: 'error', code: 'permission-denied', message: 'You don\'t have access to this card.', retryable: false };

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

/** Installs the card service for a test: a real-feeling one unless told otherwise. */
function installService({ load = okResult(3), suggestions = { suggestions: {}, unavailable: [] }, save } = {}) {
  mocks.service.loadMyCard = vi.fn(async () => load);
  mocks.service.loadCardSuggestions = vi.fn(async () => suggestions);
  mocks.service.saveMyCard = vi.fn(save ?? (async (card, { expectedRevision }) => ({
    status: 'saved', card: { ...normalizeCard(card).card, sharingEnabled: false }, revision: (expectedRevision ?? 0) + 1,
  })));
  return mocks.service;
}

const page = () => (<MemoryRouter><MyCardPage /></MemoryRouter>);
const finishSave = async (name = 'Ada Lovelace') => {
  const editButton = await screen.findByRole('button', { name: 'Edit Card' });
  expect(document.querySelector('.mycard')).toHaveAttribute('data-view', 'preview');
  expect(screen.getByRole('article', { name: `Card for ${name}` })).toBeInTheDocument();
  return editButton;
};
const ensureEditing = async () => {
  if (!screen.queryByRole('form', { name: 'Edit your card' })) {
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Card' }));
    await screen.findByRole('form', { name: 'Edit your card' });
  }
};
const open = async (options) => {
  const service = installService(options);
  const view = render(page());
  await screen.findByRole('button', { name: 'Edit Card' });
  await userEvent.click(screen.getByRole('button', { name: 'Edit Card' }));
  await screen.findByRole('form', { name: 'Edit your card' });
  return { service, view };
};
const field = (label) => screen.getByLabelText(label);
const typeInto = async (user, label, text) => { await ensureEditing(); await user.clear(field(label)); if (text) await user.type(field(label), text); };
const saveButton = () => screen.getByRole('button', { name: /^Save$|^Saving…$/ });
const toggle = (label) => screen.getByRole('switch', { name: `${label} on your card` });

/** A browser that can download, with a way to read what it was given. */
function stubDownloads({ failClick = false } = {}) {
  const seen = { blob: null, clicks: [] };
  window.URL.createObjectURL = vi.fn((blob) => { seen.blob = blob; return 'blob:test'; });
  window.URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
    if (failClick) throw new Error('blocked');
    seen.clicks.push(this.download);
  });
  seen.text = () => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(seen.blob);
  });
  return seen;
}

beforeEach(() => {
  globalThis.sessionStorage.clear();
  mocks.auth.currentUser = { uid: 'U' };
  mocks.auth.listeners.clear();
  mocks.impersonation.isImpersonating = false;
});
afterEach(() => {
  vi.restoreAllMocks();
  globalThis.sessionStorage.clear();
});

describe('loading', () => {
  it('says it is loading, then shows the saved card', async () => {
    const service = installService();
    render(page());
    expect(screen.getByText('Loading your card…')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Edit your card' })).toBeNull();
    await screen.findByRole('article', { name: 'Card for Ada Lovelace' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit Card' }));
    await screen.findByRole('form', { name: 'Edit your card' });
    expect(screen.queryByText('Loading your card…')).toBeNull();
    expect(service.loadMyCard).toHaveBeenCalledTimes(1);
    expect(service.loadCardSuggestions).toHaveBeenCalledTimes(1);
  });

  it('has a heading, and a way back to My People', async () => {
    await open();
    expect(screen.getByRole('heading', { level: 1, name: 'My Card' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My People' })).toHaveAttribute('href', '/contact-hub');
  });

  it('shows the saved card first, and opens the editor only when requested', async () => {
    installService();
    render(page());
    await screen.findByRole('article', { name: 'Card for Ada Lovelace' });
    expect(screen.queryByRole('form', { name: 'Edit your card' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Card' }));
    await screen.findByRole('form', { name: 'Edit your card' });
    expect(field('First name')).toHaveValue('Ada');
    expect(field('Title')).toHaveValue('Analyst');
    expect(within(screen.getByRole('article', { name: 'Card for Ada Lovelace' })).getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download contact' })).toBeEnabled();
  });

  it('labels the live card preview when editing has made unsaved changes', async () => {
    await open();
    expect(screen.queryByText('Preview includes unsaved changes')).toBeNull();
    await typeInto(userEvent.setup(), 'Title', 'Community Director');
    expect(screen.getByText('Preview includes unsaved changes')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('article', { name: 'Card for Ada Lovelace' })).toHaveTextContent('Community Director');
  });

  it('starts a card that was never saved as a new one, filled in from what the account knows, and saves nothing', async () => {
    const { service } = await open({
      load: missingResult(),
      suggestions: {
        suggestions: { firstName: { value: 'Grace', source: 'settings' }, lastName: { value: 'Hopper', source: 'settings' }, title: { value: 'Rear Admiral', source: 'recon' } },
        unavailable: [],
      },
    });
    expect(field('First name')).toHaveValue('Grace');
    expect(field('Title')).toHaveValue('Rear Admiral');
    expect(screen.getByText('Not saved yet')).toBeInTheDocument();
    // Nothing to change yet, but it can be saved as it is.
    expect(saveButton()).toBeEnabled();
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 700); }); });
    expect(service.saveMyCard).not.toHaveBeenCalled();
    expect(globalThis.sessionStorage.length).toBe(0);
  });

  it('offers what the account knows, for an empty field, and fills nothing by itself', async () => {
    await open({ load: okResult(3, { title: '' }), suggestions: { suggestions: { title: { value: 'Founder', source: 'recon' } }, unavailable: [] } });
    expect(field('Title')).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Use “Founder” from your Recon answers' }));
    expect(field('Title')).toHaveValue('Founder');
    expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
  });

  it('is an error, never an empty card, when the card cannot be loaded; and Try again loads it', async () => {
    const service = installService({ load: OFFLINE });
    render(page());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn\'t load your card');
    expect(alert).toHaveTextContent(OFFLINE.message);
    expect(screen.queryByRole('form', { name: 'Edit your card' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download contact' })).toBeNull();
    service.loadMyCard.mockResolvedValue(okResult(4));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('button', { name: 'Edit Card' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit Card' }));
    await screen.findByRole('form', { name: 'Edit your card' });
    expect(field('Title')).toHaveValue('Analyst');
    expect(service.loadMyCard).toHaveBeenCalledTimes(2);
  });

  it('does not offer to try again when trying again cannot help', async () => {
    installService({ load: DENIED });
    render(page());
    expect(await screen.findByRole('alert')).toHaveTextContent(DENIED.message);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('treats a service that throws as a failed load', async () => {
    installService();
    mocks.service.loadMyCard = vi.fn(async () => { throw new Error('boom'); });
    render(page());
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn\'t load your card');
  });

  it('says what had to be tidied in a saved card, and that sharing choices were reset', async () => {
    await open({ load: { status: 'repaired', card: savedCard(), revision: 2, errors: { email: 'x', website: 'x' }, repairs: ['email', 'website', 'sharingEnabled', 'share'] } });
    expect(screen.getByText('Your saved card needed tidying')).toBeInTheDocument();
    expect(screen.getByText(/left empty: Email, Website/)).toBeInTheDocument();
    expect(screen.getByText('Your Shared / Private choices were reset to the defaults.')).toBeInTheDocument();
  });
});

describe('saving', () => {
  it('sends the draft against the revision it was loaded at, says it is saving, then that it is saved', async () => {
    const slow = deferred();
    const { service } = await open({ save: () => slow.promise });
    const user = userEvent.setup();
    await typeInto(user, 'Title', 'Director');
    expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
    await user.click(saveButton());
    expect(service.saveMyCard).toHaveBeenCalledTimes(1);
    const [sent, options] = service.saveMyCard.mock.calls[0];
    expect(sent.title).toBe('Director');
    expect(options).toEqual({ expectedRevision: 3 });
    expect(await screen.findByText('Saving…', { selector: 'p' })).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveAttribute('aria-busy', 'true');
    await act(async () => { slow.resolve({ status: 'saved', card: savedCard({ title: 'Director' }), revision: 4 }); });
    await finishSave();
    expect(within(screen.getByRole('article', { name: 'Card for Ada Lovelace' })).getByText('Director')).toBeInTheDocument();
  });

  it('saves again against the revision just made', async () => {
    const { service } = await open();
    const user = userEvent.setup();
    await typeInto(user, 'Title', 'Director');
    await user.click(saveButton());
    await finishSave();
    await typeInto(user, 'Title', 'Manager');
    await user.click(saveButton());
    await finishSave();
    expect(service.saveMyCard.mock.calls.map(([, options]) => options.expectedRevision)).toEqual([3, 4]);
  });

  it('saves a new card as it is, against "no card yet"', async () => {
    const { service } = await open({ load: missingResult(), suggestions: { suggestions: { firstName: { value: 'Grace', source: 'settings' } }, unavailable: [] } });
    await userEvent.click(saveButton());
    await finishSave('Grace');
    expect(service.saveMyCard.mock.calls[0][1]).toEqual({ expectedRevision: null });
  });

  it('does not send a card that is not valid, says what to fix, and takes the person to it', async () => {
    const { service } = await open();
    const user = userEvent.setup();
    await typeInto(user, 'Email', 'not-an-email');
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());
    expect(service.saveMyCard).not.toHaveBeenCalled();
    expect(screen.getByText(/email address like name@example.com/)).toBeInTheDocument();
    expect(screen.getByText('Fix the field marked in red, then save.')).toBeInTheDocument();
    expect(field('Email')).toHaveFocus();
    // Fixing it lets it save.
    await typeInto(user, 'Email', 'ada@example.com');
    await user.click(saveButton());
    await finishSave();
    expect(service.saveMyCard).toHaveBeenCalledTimes(1);
  });

  it('counts the fields when there is more than one to fix', async () => {
    await open();
    const user = userEvent.setup();
    await typeInto(user, 'Email', 'nope');
    await typeInto(user, 'Phone', 'call me');
    await user.click(saveButton());
    expect(screen.getByText('Fix 2 fields marked in red, then save.')).toBeInTheDocument();
  });

  it('asks for a name when there is none, and does not send', async () => {
    const { service } = await open();
    const user = userEvent.setup();
    await typeInto(user, 'First name', '');
    await typeInto(user, 'Last name', '');
    await user.click(saveButton());
    expect(service.saveMyCard).not.toHaveBeenCalled();
    // Said in more than one place (the field, the preview, the download), and the field's is the alert.
    expect(screen.getByRole('alert')).toHaveTextContent('Add your name');
    expect(field('First name')).toHaveAttribute('aria-invalid', 'true');
    expect(field('First name')).toHaveFocus();
  });

  it('saves when Enter is pressed in a field, and does nothing when there is nothing to save', async () => {
    const { service } = await open();
    const user = userEvent.setup();
    await user.click(field('Title'));
    await user.keyboard('{Enter}');
    expect(service.saveMyCard).not.toHaveBeenCalled();
    await user.type(field('Title'), ' Lead{Enter}');
    await finishSave();
    expect(service.saveMyCard).toHaveBeenCalledTimes(1);
    expect(service.saveMyCard.mock.calls[0][0].title).toBe('Analyst Lead');
  });

  it('can be reached and used with the keyboard', async () => {
    const { service } = await open();
    const user = userEvent.setup();
    await user.type(field('Title'), ' Lead');
    saveButton().focus();
    expect(saveButton()).toHaveFocus();
    await user.keyboard('{Enter}');
    await finishSave();
    expect(service.saveMyCard).toHaveBeenCalledTimes(1);
  });

  describe('when a save fails', () => {
    it('keeps the changes, says what happened, and Try again saves them', async () => {
      const save = vi.fn()
        .mockResolvedValueOnce(OFFLINE)
        .mockImplementation(async (card, { expectedRevision }) => ({ status: 'saved', card: normalizeCard(card).card, revision: expectedRevision + 1 }));
      const { service } = await open({ save });
      const user = userEvent.setup();
      await typeInto(user, 'Title', 'Director');
      await user.click(saveButton());
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Couldn\'t save your changes');
      expect(alert).toHaveTextContent(OFFLINE.message);
      expect(alert).toHaveTextContent('Your changes are still here');
      expect(within(screen.getByRole('article', { name: 'Card for Ada Lovelace' })).getByText('Director')).toBeInTheDocument();
      expect(screen.getByText('Couldn\'t save your changes', { selector: 'p' })).toBeInTheDocument();
      await user.click(within(alert).getByRole('button', { name: 'Try again' }));
      await finishSave();
      expect(screen.queryByRole('alert')).toBeNull();
      // The retry is the same save, against the same revision.
      expect(service.saveMyCard.mock.calls.map(([, options]) => options.expectedRevision)).toEqual([3, 3]);
    });

    it('can also be tried again with the Save button itself', async () => {
      const save = vi.fn().mockResolvedValueOnce(OFFLINE).mockResolvedValue({ status: 'saved', card: savedCard({ title: 'Director' }), revision: 4 });
      await open({ save });
      const user = userEvent.setup();
      await typeInto(user, 'Title', 'Director');
      await user.click(saveButton());
      await screen.findByRole('alert');
      expect(saveButton()).toBeEnabled();
      await user.click(saveButton());
      await finishSave();
    });

    it('does not offer Try again when trying again cannot help', async () => {
      await open({ save: async () => DENIED });
      const user = userEvent.setup();
      await typeInto(user, 'Title', 'Director');
      await user.click(saveButton());
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(DENIED.message);
      expect(within(alert).queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it('treats a service that throws as a failed save, and keeps the changes', async () => {
      await open({ save: async () => { throw new Error('boom'); } });
      const user = userEvent.setup();
      await typeInto(user, 'Title', 'Director');
      await user.click(saveButton());
      expect(await screen.findByRole('alert')).toHaveTextContent('Couldn\'t save your changes');
      expect(field('Title')).toHaveValue('Director');
    });

    it('keeps the draft kept, so a failed save and a refresh lose nothing', async () => {
      await open({ save: async () => OFFLINE });
      const user = userEvent.setup();
      await typeInto(user, 'Title', 'Director');
      await user.click(saveButton());
      await screen.findByRole('alert');
      window.dispatchEvent(new Event('pagehide'));
      expect(readDraft('U').draft.card.title).toBe('Director');
    });
  });

  it('keeps what is typed while a save is on its way', async () => {
    const slow = deferred();
    await open({ save: () => slow.promise });
    const user = userEvent.setup();
    await typeInto(user, 'Title', 'Director');
    await user.click(saveButton());
    await user.type(field('Phone'), '+1 555 010 2000');
    await act(async () => { slow.resolve({ status: 'saved', card: savedCard({ title: 'Director' }), revision: 4 }); });
    expect(field('Phone')).toHaveValue('+1 555 010 2000');
    expect(await screen.findByText('You have unsaved changes')).toBeInTheDocument();
  });
});

describe('Shared / Private and sharing', () => {
  it('saves the switches as they were set, and keeps them after saving', async () => {
    const { service } = await open();
    const user = userEvent.setup();
    expect(toggle('Email')).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle('Email'));
    await user.click(saveButton());
    await finishSave();
    expect(service.saveMyCard.mock.calls[0][0].share).toEqual({ ...DEFAULT_SHARE, ...DEFAULT_LINK_SHARE, email: true });
    await ensureEditing();
    expect(toggle('Email')).toHaveAttribute('aria-checked', 'true');
  });

  it('never sends sharing as on, and has no control to turn sharing on', async () => {
    const { service } = await open();
    const user = userEvent.setup();
    await typeInto(user, 'Title', 'Director');
    await user.click(saveButton());
    await finishSave();
    expect(service.saveMyCard.mock.calls[0][0].sharingEnabled).toBe(false);
    await ensureEditing();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    // The only switches are the eight per-field ones, each about what a shared card WILL show.
    const names = screen.getAllByRole('switch').map((control) => control.getAttribute('aria-label'));
    expect(names).toHaveLength(8);
    for (const name of names) expect(name).toMatch(/ on your card$/);
    expect(screen.queryByRole('button', { name: /share (my|your) card|publish|make public|turn on sharing|enable sharing/i })).toBeNull();
    expect(screen.getByText(/Sharing isn.t turned on yet/)).toBeInTheDocument();
  });

  it('keeps a private field out of the preview and in the form', async () => {
    await open({ load: okResult(3, { email: 'ada@example.com' }) });
    expect(field('Email')).toHaveValue('ada@example.com');
    const card = screen.getByRole('article', { name: 'Card for Ada Lovelace' });
    expect(within(card).queryByText('ada@example.com')).toBeNull();
    expect(screen.getByText(/Kept private: Email/)).toBeInTheDocument();
  });
});

describe('a draft that comes back', () => {
  const keep = (card, baseRevision = 3, at = Date.now() - 60_000, uid = 'U') => saveDraft({ uid, card, baseRevision }, { now: at });

  it('is restored, with a notice, and is unsaved until Save', async () => {
    keep(savedCard({ title: 'Recovered title' }));
    const { service } = await open();
    expect(field('Title')).toHaveValue('Recovered title');
    expect(screen.getByRole('status', { name: 'We restored the changes you hadn\'t saved' })).toBeInTheDocument();
    expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
    expect(service.saveMyCard).not.toHaveBeenCalled();
  });

  it('is there after leaving the page and coming back', async () => {
    const { view } = await open();
    const user = userEvent.setup();
    await typeInto(user, 'Title', 'Typed before leaving');
    view.unmount();
    expect(readDraft('U').status).toBe('ok');
    render(page());
    await screen.findByRole('button', { name: 'Edit Card' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit Card' }));
    await screen.findByRole('form', { name: 'Edit your card' });
    expect(field('Title')).toHaveValue('Typed before leaving');
    expect(screen.getByText('We restored the changes you hadn\'t saved')).toBeInTheDocument();
  });

  it('survives a refresh: kept when the page is closed, restored when it opens', async () => {
    const first = await open();
    const user = userEvent.setup();
    await typeInto(user, 'Phone', '+1 555 010 2000');
    window.dispatchEvent(new Event('pagehide'));
    first.view.unmount();
    render(page());
    await screen.findByRole('button', { name: 'Edit Card' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit Card' }));
    await screen.findByRole('form', { name: 'Edit your card' });
    expect(field('Phone')).toHaveValue('+1 555 010 2000');
  });

  it('can be discarded, after being asked, and the card goes back to what is saved', async () => {
    keep(savedCard({ title: 'Recovered title' }));
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByText('Discard these changes?')).toBeInTheDocument();
    // Asking is not doing.
    expect(field('Title')).toHaveValue('Recovered title');
    await user.click(screen.getByRole('button', { name: 'Yes, discard' }));
    expect(field('Title')).toHaveValue('Analyst');
    expect(screen.queryByText('We restored the changes you hadn\'t saved')).toBeNull();
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(globalThis.sessionStorage.getItem(draftKey('U'))).toBeNull();
  });

  it('can be kept after all: "Keep them" leaves the draft and the notice as they were', async () => {
    keep(savedCard({ title: 'Recovered title' }));
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await user.click(screen.getByRole('button', { name: 'Keep them' }));
    expect(field('Title')).toHaveValue('Recovered title');
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeInTheDocument();
  });

  it('can have its notice dismissed, keeping the draft', async () => {
    keep(savedCard({ title: 'Recovered title' }));
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByText('We restored the changes you hadn\'t saved')).toBeNull();
    expect(field('Title')).toHaveValue('Recovered title');
    expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
  });

  it('is not restored when it is too old, or when it says what is saved', async () => {
    keep(savedCard({ title: 'Too old' }), 3, Date.now() - 13 * 60 * 60 * 1000);
    await open();
    expect(field('Title')).toHaveValue('Analyst');
    expect(screen.queryByText('We restored the changes you hadn\'t saved')).toBeNull();
    expect(globalThis.sessionStorage.length).toBe(0);
  });

  it('is never another account\'s, and theirs is forgotten', async () => {
    keep(savedCard({ title: 'Somebody else\'s' }), 3, Date.now() - 1000, 'OTHER');
    await open();
    expect(field('Title')).toHaveValue('Analyst');
    expect(screen.queryByText('We restored the changes you hadn\'t saved')).toBeNull();
    expect(globalThis.sessionStorage.getItem(draftKey('OTHER'))).toBeNull();
  });

  it('is forgotten once it is saved', async () => {
    keep(savedCard({ title: 'Recovered title' }));
    await open();
    await userEvent.click(saveButton());
    await finishSave();
    expect(screen.queryByText('We restored the changes you hadn\'t saved')).toBeNull();
    expect(globalThis.sessionStorage.getItem(draftKey('U'))).toBeNull();
  });
});

describe('a newer saved version: the conflict', () => {
  const newer = () => okResult(5, { title: 'Newer elsewhere' });
  const conflicting = (current = newer()) => vi.fn()
    .mockResolvedValueOnce({ status: 'conflict', current })
    .mockImplementation(async (card, { expectedRevision }) => ({ status: 'saved', card: normalizeCard(card).card, revision: expectedRevision + 1 }));

  async function intoConflict(options = {}) {
    const opened = await open({ save: conflicting(options.current), ...options });
    const user = userEvent.setup();
    await typeInto(user, 'Title', 'My version');
    await user.click(saveButton());
    await screen.findByRole('alert');
    return { ...opened, user };
  }

  it('is a notice that names what differs, and leaves the edits exactly as they are', async () => {
    await intoConflict();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('A newer version of your card was saved');
    expect(alert).toHaveTextContent('These differ from your version: Title.');
    expect(alert).toHaveTextContent('Your edits are untouched');
    expect(field('Title')).toHaveValue('My version');
    expect(screen.getByText('A newer version is saved', { selector: 'p' })).toBeInTheDocument();
  });

  it('puts Save on hold, but lets the person keep editing', async () => {
    const { user } = await intoConflict();
    expect(saveButton()).toBeDisabled();
    await user.type(field('Phone'), '+1 555 010 2000');
    expect(field('Phone')).toHaveValue('+1 555 010 2000');
    expect(saveButton()).toBeDisabled();
  });

  it('keeps the draft kept while it stands', async () => {
    await intoConflict();
    window.dispatchEvent(new Event('pagehide'));
    expect(readDraft('U').draft.card.title).toBe('My version');
  });

  describe('Load latest saved version', () => {
    it('only asks first, saying what it will do, and changes nothing', async () => {
      const { user, service } = await intoConflict();
      await user.click(screen.getByRole('button', { name: 'Load latest saved version' }));
      expect(screen.getByText('This replaces your unsaved edits')).toBeInTheDocument();
      expect(field('Title')).toHaveValue('My version');
      expect(service.saveMyCard).toHaveBeenCalledTimes(1);
      // Choosing the other way is not on offer while this is being confirmed.
      expect(screen.queryByRole('button', { name: 'Save my version over it' })).toBeNull();
    });

    it('can be cancelled, which brings the choices back and keeps the edits', async () => {
      const { user } = await intoConflict();
      await user.click(screen.getByRole('button', { name: 'Load latest saved version' }));
      await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Cancel' }));
      expect(screen.getByRole('button', { name: 'Load latest saved version' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save my version over it' })).toBeInTheDocument();
      expect(field('Title')).toHaveValue('My version');
    });

    it('replaces the edits with the saved card only when confirmed, and forgets the kept draft', async () => {
      const { user } = await intoConflict();
      await user.click(screen.getByRole('button', { name: 'Load latest saved version' }));
      await user.click(screen.getByRole('button', { name: 'Replace my edits' }));
      expect(field('Title')).toHaveValue('Newer elsewhere');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByText('All changes saved')).toBeInTheDocument();
      expect(globalThis.sessionStorage.getItem(draftKey('U'))).toBeNull();
    });

    it('moves focus to the safe choice, Cancel, when asking', async () => {
      const { user } = await intoConflict();
      await user.click(screen.getByRole('button', { name: 'Load latest saved version' }));
      expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });
  });

  describe('Save my version over it', () => {
    it('only asks first, saying what will be lost, and saves nothing', async () => {
      const { user, service } = await intoConflict();
      await user.click(screen.getByRole('button', { name: 'Save my version over it' }));
      expect(screen.getByText('This overwrites the newer saved version')).toBeInTheDocument();
      expect(screen.getByText(/will be lost/)).toBeInTheDocument();
      expect(service.saveMyCard).toHaveBeenCalledTimes(1);
    });

    it('saves against the revision that was just seen, when confirmed, and the notice goes', async () => {
      const { user, service } = await intoConflict();
      await user.click(screen.getByRole('button', { name: 'Save my version over it' }));
      await user.click(screen.getByRole('button', { name: 'Overwrite with my version' }));
      await finishSave();
      expect(service.saveMyCard).toHaveBeenCalledTimes(2);
      const [sent, options] = service.saveMyCard.mock.calls[1];
      expect(sent.title).toBe('My version');
      expect(options).toEqual({ expectedRevision: 5 });
      expect(screen.queryByRole('alert')).toBeNull();
      expect(within(screen.getByRole('article', { name: 'Card for Ada Lovelace' })).getByText('My version')).toBeInTheDocument();
    });

    it('can be cancelled without saving anything', async () => {
      const { user, service } = await intoConflict();
      await user.click(screen.getByRole('button', { name: 'Save my version over it' }));
      await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Cancel' }));
      expect(service.saveMyCard).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Load latest saved version' })).toBeInTheDocument();
    });

    it('if the card changed again, stops and asks again: nothing is overwritten', async () => {
      const save = vi.fn()
        .mockResolvedValueOnce({ status: 'conflict', current: newer() })
        .mockResolvedValueOnce({ status: 'conflict', current: okResult(8, { title: 'Newer still' }) });
      const { user, service } = await intoConflict({ save });
      await user.click(screen.getByRole('button', { name: 'Save my version over it' }));
      await user.click(screen.getByRole('button', { name: 'Overwrite with my version' }));
      expect(await screen.findByText(/It changed again while you were deciding/)).toBeInTheDocument();
      expect(service.saveMyCard).toHaveBeenCalledTimes(2);
      // It has to be chosen and confirmed all over again; nothing is retried by itself.
      expect(screen.queryByRole('button', { name: 'Overwrite with my version' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Save my version over it' })).toBeEnabled();
      expect(field('Title')).toHaveValue('My version');
    });

    it('if the overwrite fails for another reason, it asks again and says what happened', async () => {
      const save = vi.fn().mockResolvedValueOnce({ status: 'conflict', current: newer() }).mockResolvedValueOnce(OFFLINE);
      const { user, service } = await intoConflict({ save });
      await user.click(screen.getByRole('button', { name: 'Save my version over it' }));
      await user.click(screen.getByRole('button', { name: 'Overwrite with my version' }));
      expect(await screen.findByText(OFFLINE.message, { exact: false })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Overwrite with my version' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Save my version over it' })).toBeInTheDocument();
      expect(service.saveMyCard).toHaveBeenCalledTimes(2);
    });
  });

  it('offers no choice when the saved card was written by a newer version of IDYNIFY', async () => {
    await intoConflict({ current: { status: 'error', code: 'newer-version', message: 'This card was saved by a newer version of IDYNIFY. Refresh the page to edit it.', retryable: false } });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('newer version of IDYNIFY');
    expect(within(alert).queryByRole('button')).toBeNull();
    expect(field('Title')).toHaveValue('My version');
  });

  it('is found on coming back, from a draft that began from an older revision: restored, with the conflict', async () => {
    saveDraft({ uid: 'U', card: savedCard({ title: 'Old draft', share: { ...DEFAULT_SHARE, email: true } }), baseRevision: 2 }, { now: Date.now() - 1000 });
    const { service } = await open({ load: okResult(5, { title: 'Saved since' }) });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('A newer version of your card was saved');
    expect(alert).toHaveTextContent('Title, Email switch');
    expect(field('Title')).toHaveValue('Old draft');
    expect(screen.getByText('We restored the changes you hadn\'t saved.')).toBeInTheDocument();
    // The choices are in the conflict; the restored note does not offer a second way out.
    expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull();
    expect(service.saveMyCard).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Load latest saved version' }));
    await user.click(screen.getByRole('button', { name: 'Replace my edits' }));
    expect(field('Title')).toHaveValue('Saved since');
  });

  it('keeps the conflict notice with the editor and the card preview in the responsive layout', async () => {
    const { view } = await intoConflict();
    const root = view.container.querySelector('.mycard');
    const notice = screen.getByRole('alert');
    expect(root).toHaveAttribute('data-view', 'edit');
    expect(root).toContainElement(notice);
    expect(root).toContainElement(screen.getByRole('form', { name: 'Edit your card' }));
    expect(root).toContainElement(screen.getByRole('article', { name: 'Card for Ada Lovelace' }));
  });
});

describe('Download contact', () => {
  it('is on the page with its explanation, always, and it is the card shown in the preview', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Download contact' })).toBeInTheDocument();
    expect(screen.getByText('Downloads the card shown in the preview. This does not save your changes to IDYNIFY.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download contact' })).toHaveAccessibleDescription(/does not save your changes to IDYNIFY/);
  });

  it('downloads the draft as it is now, unsaved, and only what is Shared, and saves nothing', async () => {
    const downloads = stubDownloads();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { service } = await open({ load: okResult(3, { email: 'ada@example.com', phone: '+1 555 010 2000' }) });
    const user = userEvent.setup();
    await typeInto(user, 'Title', 'Typed, not saved');
    await user.click(screen.getByRole('button', { name: 'Download contact' }));
    expect(downloads.clicks).toEqual(['Ada_Lovelace.vcf']);
    const text = await downloads.text();
    expect(text).toContain('FN:Ada Lovelace');
    expect(text).toContain('TITLE:Typed\\, not saved');
    // Email and phone are private: not in the file, though they are in the form.
    expect(text).not.toContain('ada@example.com');
    expect(text).not.toContain('555');
    expect(await screen.findByText('Contact file downloaded.')).toBeInTheDocument();
    // Downloading is not saving: nothing was sent anywhere, and the page still says so.
    expect(service.saveMyCard).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('follows the Shared / Private switches', async () => {
    const downloads = stubDownloads();
    await open({ load: okResult(3, { email: 'ada@example.com' }) });
    const user = userEvent.setup();
    await user.click(toggle('Email'));
    await user.click(screen.getByRole('button', { name: 'Download contact' }));
    expect(await downloads.text()).toContain('ada@example.com');
    await user.click(toggle('Email'));
    await user.click(screen.getByRole('button', { name: 'Download contact' }));
    expect(await downloads.text()).not.toContain('ada@example.com');
  });

  it('says what was left out because it is not valid yet', async () => {
    const downloads = stubDownloads();
    await open();
    const user = userEvent.setup();
    await user.click(toggle('Email'));
    await typeInto(user, 'Email', 'ada@');
    await user.click(screen.getByRole('button', { name: 'Download contact' }));
    expect(await screen.findByText(/Not included, because it isn.t valid yet: Email\./)).toBeInTheDocument();
    expect(await downloads.text()).not.toContain('ada@');
  });

  it('tells the person, in words, when the browser refuses, and can be tried again', async () => {
    stubDownloads({ failClick: true });
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Download contact' }));
    expect(await screen.findByText('Your browser couldn\'t start the download. Try again.')).toBeInTheDocument();
    vi.restoreAllMocks();
    const downloads = stubDownloads();
    await user.click(screen.getByRole('button', { name: 'Download contact' }));
    expect(await screen.findByText('Contact file downloaded.')).toBeInTheDocument();
    expect(downloads.clicks).toHaveLength(1);
  });

  it('is off, with the reason, while there is no name', async () => {
    await open();
    const user = userEvent.setup();
    await typeInto(user, 'First name', '');
    await typeInto(user, 'Last name', '');
    const button = screen.getByRole('button', { name: 'Download contact' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/Add your name to download your contact/);
    expect(screen.getByText('Add your name to download your contact.')).toBeVisible();
  });

  it('forgets its message once the card is changed', async () => {
    stubDownloads();
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Download contact' }));
    expect(await screen.findByText('Contact file downloaded.')).toBeInTheDocument();
    await user.type(field('Title'), '!');
    expect(screen.queryByText('Contact file downloaded.')).toBeNull();
  });

  it('works while a conflict is on screen: it is a file on the device, not a save', async () => {
    const downloads = stubDownloads();
    await open({ save: async () => ({ status: 'conflict', current: okResult(5, { title: 'Newer' }) }) });
    const user = userEvent.setup();
    await typeInto(user, 'Title', 'My version');
    await user.click(saveButton());
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Download contact' }));
    expect(await downloads.text()).toContain('My version');
  });
});

describe('an admin viewing as someone else', () => {
  beforeEach(() => { mocks.impersonation.isImpersonating = true; });

  it('shows a notice and no card: nothing to edit, save or download', async () => {
    const service = installService();
    render(page());
    expect(await screen.findByText('You\'re viewing as someone else')).toBeInTheDocument();
    expect(screen.getByText(/can.t be shown or changed while you view as someone else/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Edit your card' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download contact' })).toBeNull();
    expect(service.loadMyCard).not.toHaveBeenCalled();
    expect(service.loadCardSuggestions).not.toHaveBeenCalled();
    expect(service.saveMyCard).not.toHaveBeenCalled();
  });

  it('does not touch the tab\'s storage at all, and leaves the admin\'s own draft alone', async () => {
    saveDraft({ uid: 'U', card: savedCard({ title: 'Admin\'s own unsaved' }), baseRevision: 3 }, { now: Date.now() - 1000 });
    const spies = ['getItem', 'setItem', 'removeItem', 'key'].map((name) => vi.spyOn(Storage.prototype, name));
    installService();
    render(page());
    await screen.findByText('You\'re viewing as someone else');
    window.dispatchEvent(new Event('pagehide'));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    spies.forEach((spy) => spy.mockRestore());
    expect(globalThis.sessionStorage.getItem(draftKey('U'))).not.toBeNull();
  });

  it('keeps the way back to My People', async () => {
    installService();
    render(page());
    expect(await screen.findByRole('link', { name: 'My People' })).toHaveAttribute('href', '/contact-hub');
  });

  it('shows the card again when viewing as someone else stops', async () => {
    const service = installService();
    const view = render(page());
    await screen.findByText('You\'re viewing as someone else');
    mocks.impersonation.isImpersonating = false;
    view.rerender(page());
    await screen.findByRole('button', { name: 'Edit Card' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit Card' }));
    await screen.findByRole('form', { name: 'Edit your card' });
    expect(service.loadMyCard).toHaveBeenCalledTimes(1);
    expect(field('Title')).toHaveValue('Analyst');
  });

  it('drops the card from the screen when viewing as someone else starts', async () => {
    mocks.impersonation.isImpersonating = false;
    installService();
    const view = render(page());
    await screen.findByRole('button', { name: 'Edit Card' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit Card' }));
    await screen.findByRole('form', { name: 'Edit your card' });
    mocks.impersonation.isImpersonating = true;
    view.rerender(page());
    await screen.findByText('You\'re viewing as someone else');
    expect(screen.queryByDisplayValue('Analyst')).toBeNull();
  });
});

describe('signed out, and switching account', () => {
  it('asks to sign in, and reads nothing, when nobody is signed in', async () => {
    mocks.auth.currentUser = null;
    const service = installService();
    render(page());
    expect(await screen.findByText('Sign in to see your card')).toBeInTheDocument();
    expect(service.loadMyCard).not.toHaveBeenCalled();
    expect(screen.queryByRole('form', { name: 'Edit your card' })).toBeNull();
  });

  it('takes the card off the screen when the account signs out', async () => {
    await open();
    const user = userEvent.setup();
    await typeInto(user, 'Title', 'Unsaved and private');
    act(() => { mocks.auth.currentUser = null; mocks.auth.listeners.forEach((listener) => listener(null)); });
    expect(await screen.findByText('Sign in to see your card')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Unsaved and private')).toBeNull();
    expect(screen.queryByDisplayValue('Ada')).toBeNull();
  });

  it('shows nothing of the first account when another signs in, and loads the second\'s card', async () => {
    const { service } = await open();
    service.loadMyCard.mockImplementation(async () => okResult(9, { firstName: 'Bob', lastName: 'Builder', title: 'Foreman' }));
    act(() => { mocks.auth.currentUser = { uid: 'V' }; mocks.auth.listeners.forEach((listener) => listener({ uid: 'V' })); });
    await screen.findByRole('article', { name: 'Card for Bob Builder' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit Card' }));
    expect(field('Title')).toHaveValue('Foreman');
    expect(screen.queryByRole('article', { name: 'Card for Ada Lovelace' })).toBeNull();
    expect(service.loadMyCard).toHaveBeenCalledTimes(2);
  });
});

describe('what is out of view is brought into view', () => {
  // The Save bar is all that is in view when a save goes wrong at the bottom of a long form.
  const spyScroll = () => vi.spyOn(window.HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});

  it('scrolls a conflict into view as it appears, once, and not again for what is typed after', async () => {
    const scroll = spyScroll();
    await open({ save: async () => ({ status: 'conflict', current: okResult(5, { title: 'Newer' }) }) });
    const user = userEvent.setup();
    await typeInto(user, 'Title', 'My version');
    scroll.mockClear();
    await user.click(saveButton());
    const alert = await screen.findByRole('alert');
    const callers = scroll.mock.instances;
    expect(callers).toContain(alert);
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    const calls = scroll.mock.calls.length;
    await user.type(field('Phone'), '555');
    expect(scroll.mock.calls.length).toBe(calls);
  });

  it('scrolls a failed save into view as it appears', async () => {
    const scroll = spyScroll();
    await open({ save: async () => OFFLINE });
    const user = userEvent.setup();
    await typeInto(user, 'Title', 'Director');
    scroll.mockClear();
    await user.click(saveButton());
    const alert = await screen.findByRole('alert');
    expect(scroll.mock.instances).toContain(alert);
  });

  it('scrolls the answer to Download contact into view', async () => {
    stubDownloads();
    const scroll = spyScroll();
    await open();
    scroll.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Download contact' }));
    const answer = await screen.findByText('Contact file downloaded.');
    expect(scroll.mock.instances).toContain(answer);
  });

  it('does not scroll for a notice that was there when the page opened being re-rendered', async () => {
    saveDraft({ uid: 'U', card: savedCard({ title: 'Recovered' }), baseRevision: 3 }, { now: Date.now() - 1000 });
    const scroll = spyScroll();
    await open();
    const user = userEvent.setup();
    scroll.mockClear();
    await user.type(field('Phone'), '555');
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe('leaving, and being usable', () => {
  const beforeUnload = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it('warns before leaving while there are unsaved changes, and not otherwise', async () => {
    await open();
    expect(beforeUnload()).toBe(false);
    const user = userEvent.setup();
    await typeInto(user, 'Title', 'Director');
    expect(beforeUnload()).toBe(true);
    await user.click(saveButton());
    await finishSave();
    expect(beforeUnload()).toBe(false);
  });

  it('has a name for every button and every field a person can reach', async () => {
    await open();
    for (const button of screen.getAllByRole('button')) expect(button).toHaveAccessibleName();
    for (const input of screen.getAllByRole('textbox')) expect(input).toHaveAccessibleName();
  });

  it('announces where the card stands, and what went wrong, to a screen reader', async () => {
    await open({ save: async () => OFFLINE });
    const user = userEvent.setup();
    await typeInto(user, 'Title', 'Director');
    await user.click(saveButton());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const status = screen.getAllByRole('status').find((node) => node.classList.contains('mycard-savestatus'));
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Couldn\'t save your changes');
  });

  it('is one page with one main heading, and a heading for each notice', async () => {
    await open({ save: async () => OFFLINE });
    const user = userEvent.setup();
    await typeInto(user, 'Title', 'Director');
    await user.click(saveButton());
    await screen.findByRole('alert');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveAccessibleName('Couldn\'t save your changes');
  });

  it('opens on the finished card and returns there after canceling edits', async () => {
    installService();
    render(page());
    await screen.findByRole('article', { name: 'Card for Ada Lovelace' });
    expect(screen.queryByRole('form', { name: 'Edit your card' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Card' }));
    const user = userEvent.setup();
    await user.type(field('Title'), ' Lead');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Edit Card' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Edit your card' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit Card' }));
    await user.clear(field('Title'));
    await user.type(field('Title'), 'Lead');
    await user.click(saveButton());
    expect(await screen.findByRole('button', { name: 'Edit Card' })).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'Card for Ada Lovelace' })).getByText('Lead')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Edit your card' })).toBeNull();
  });
});

describe('an uploaded photo', () => {
  const photo = photoDataUrl(320, 36_000, { tag: 1 });
  const newer = photoDataUrl(320, 28_000, { tag: 2 });
  const withPicture = (picture = photo, extra = {}) => okResult(3, { photoUrl: picture, ...extra });
  /** Everything a person or a screen reader could be given as text, apart from an image's own source. */
  const textual = () => [
    document.body.textContent,
    ...[...document.querySelectorAll('input, textarea')].map((node) => node.value),
    ...[...document.querySelectorAll('*')].flatMap((node) => [...node.attributes]
      .filter((attribute) => !(node.tagName === 'IMG' && attribute.name === 'src'))
      .map((attribute) => attribute.value)),
  ];
  const leaks = () => textual().some((text) => text.includes(fingerprintOf(photo)) || /data:image\/jpeg;base64/.test(text));
  const unfolded = (text) => text.replace(/\r\n /g, '');

  it('is shown as the photo and never as text, anywhere on the page', async () => {
    await open({ load: withPicture() });
    expect(document.querySelector('.mycard-photo-row img')).toHaveAttribute('src', photo);
    expect(within(screen.getByRole('article', { name: 'Card for Ada Lovelace' })).getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(leaks()).toBe(false);
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
  });

  it('stays out of every notice and message: a conflict, a failed save, and an invalid card', async () => {
    const { service } = await open({ load: withPicture() });
    const user = userEvent.setup();
    service.saveMyCard.mockResolvedValueOnce({ status: 'conflict', current: okResult(5, { photoUrl: newer, title: 'Newer' }) });
    await typeInto(user, 'Title', 'Mine');
    await user.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/A newer version of your card was saved/);
    expect(screen.getByRole('alert')).toHaveTextContent(/Title/);
    expect(leaks()).toBe(false);
    expect(textual().some((text) => text.includes(fingerprintOf(newer)))).toBe(false);
  });

  it('is in the contact file, embedded, when the Photo switch is on, and not when it is off', async () => {
    const downloads = stubDownloads();
    await open({ load: withPicture(photo, { share: { ...DEFAULT_SHARE, photoUrl: true } }) });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Download contact' }));
    const text = unfolded(await downloads.text());
    expect(text).toContain(`PHOTO;ENCODING=b;TYPE=JPEG:${photo.slice('data:image/jpeg;base64,'.length)}\r\n`);
    expect(text).not.toContain('data:image');

    await user.click(screen.getByRole('switch', { name: 'Photo on your card' }));
    await user.click(screen.getByRole('button', { name: 'Download contact' }));
    const second = unfolded(await downloads.text());
    expect(second).not.toContain('PHOTO');
    expect(second).not.toContain(fingerprintOf(photo));
    expect(second).toContain('FN:Ada Lovelace');
  });

  it('is gone from what people would see, in the preview, the moment the switch is off', async () => {
    await open({ load: withPicture(photo, { share: { ...DEFAULT_SHARE, photoUrl: true } }) });
    const card = () => screen.getByRole('article', { name: 'Card for Ada Lovelace' });
    expect(card().querySelector('img')).toHaveAttribute('src', photo);
    await userEvent.click(screen.getByRole('switch', { name: 'Photo on your card' }));
    expect(card().querySelector('img')).toBeNull();
    expect(card().innerHTML).not.toContain(fingerprintOf(photo));
  });

  it('is saved as removed when removed, and the card goes on from the revision made', async () => {
    const { service } = await open({ load: withPicture() });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remove photo' }));
    await user.click(screen.getByRole('button', { name: 'Yes, remove it' }));
    await user.click(saveButton());
    await finishSave();
    expect(service.saveMyCard.mock.calls[0][0].photoUrl).toBe('');
    expect(service.saveMyCard.mock.calls[0][1]).toEqual({ expectedRevision: 3 });
  });

  it('comes back after a refresh with the draft that held it, noticed, unsaved, and not shown as text', async () => {
    saveDraft({ uid: 'U', card: savedCard({ photoUrl: photo, title: 'Recovered' }), baseRevision: 3 }, { now: Date.now() - 1000 });
    await open();
    expect(document.querySelector('.mycard-photo-row img')).toHaveAttribute('src', photo);
    expect(field('Title')).toHaveValue('Recovered');
    expect(screen.getByText('We restored the changes you hadn\'t saved')).toBeInTheDocument();
    expect(screen.queryByText(/couldn't be restored/)).toBeNull();
    expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
    expect(leaks()).toBe(false);
  });

  it('says plainly that it could not be restored when its kept picture is gone, and the rest of the draft is back', async () => {
    saveDraft({ uid: 'U', card: savedCard({ photoUrl: photo, title: 'Recovered' }), baseRevision: 3 }, { now: Date.now() - 1000 });
    globalThis.sessionStorage.removeItem('idynify.myCardDraftPhoto.v1:U');
    await open();
    expect(field('Title')).toHaveValue('Recovered');
    expect(screen.getByText('Your uploaded photo couldn\'t be restored. Choose it again.')).toBeInTheDocument();
    expect(document.querySelector('.mycard-photo-row img')).toBeNull();
  });

  it('says so, with nothing else, when the photo was the only thing in the draft and it could not be restored', async () => {
    saveDraft({ uid: 'U', card: savedCard({ photoUrl: photo }), baseRevision: 3 }, { now: Date.now() - 1000 });
    globalThis.sessionStorage.removeItem('idynify.myCardDraftPhoto.v1:U');
    await open();
    expect(screen.getByText('Your uploaded photo couldn\'t be restored. Choose it again.')).toBeInTheDocument();
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
  });

  it('is never written to the console, whatever happens', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    const { service } = await open({ load: withPicture() });
    const user = userEvent.setup();
    service.saveMyCard.mockResolvedValueOnce(OFFLINE);
    await typeInto(user, 'Title', 'Director');
    await user.click(saveButton());
    await screen.findByRole('alert');
    for (const spy of spies) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(fingerprintOf(photo));
    spies.forEach((spy) => spy.mockRestore());
  });

  it('is not read, kept or shown while viewing as someone else, even if a draft with one is waiting', async () => {
    saveDraft({ uid: 'U', card: savedCard({ photoUrl: photo }), baseRevision: 3 }, { now: Date.now() - 1000 });
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    mocks.impersonation.isImpersonating = true;
    installService();
    render(page());
    expect(await screen.findByText('You\'re viewing as someone else')).toBeInTheDocument();
    expect(getItem).not.toHaveBeenCalled();
    expect(leaks()).toBe(false);
    expect(globalThis.sessionStorage.getItem('idynify.myCardDraftPhoto.v1:U')).not.toBeNull();
  });
});

describe('adding a photo with Upload photo', () => {
  const made = photoDataUrl(320, 30_000, { tag: 11 });
  const madeAgain = photoDataUrl(320, 24_000, { tag: 12 });
  const makes = (...urls) => {
    let n = 0;
    prepareProfilePhoto.mockReset();
    prepareProfilePhoto.mockImplementation(async (_file, options) => ({ dataUrl: urls[Math.min(n++, urls.length - 1)], widthPx: 320, heightPx: 320, bytes: 30_000, chars: 40_000, crop: options?.crop, attempts: 1 }));
  };
  const picture = () => new File(['synthetic'], 'me.jpg', { type: 'image/jpeg' });
  const dialog = () => screen.getByRole('dialog', { name: 'Crop your photo' });
  const photoUseButton = () => within(dialog()).getByRole('button', { name: 'Use photo' });
  const card = () => screen.getByRole('article', { name: 'Card for Ada Lovelace' });
  const kept = (storage = globalThis.sessionStorage) => [...Array(storage.length).keys()].map((i) => storage.key(i)).sort();
  const settle = (ms = 700) => act(async () => { await new Promise((resolve) => { setTimeout(resolve, ms); }); });

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:synthetic');
    URL.revokeObjectURL = vi.fn();
  });

  /** Picks a picture, lets the dialog load it, and uses it. */
  async function upload(user, { move = false } = {}) {
    await user.upload(screen.getByLabelText('Choose a photo from your device'), picture(), { applyAccept: false });
    const img = dialog().querySelector('.mycard-crop-img');
    Object.defineProperty(img, 'naturalWidth', { value: 4000, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 3000, configurable: true });
    fireEvent.load(img);
    await waitFor(() => expect(photoUseButton()).toBeEnabled());
    if (move) fireEvent.change(within(dialog()).getByRole('slider', { name: 'Zoom' }), { target: { value: '2' } });
    await user.click(photoUseButton());
  }

  it('makes the photo the card\'s at once, as an unsaved edit: in the preview, and the page says so', async () => {
    makes(made);
    await open();
    const user = userEvent.setup();
    expect(card().querySelector('img')).toBeNull();
    await upload(user);
    expect(card().querySelector('img')).toHaveAttribute('src', made);
    expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is saved with Save, against the revision the card was loaded at, and then the card is as saved', async () => {
    makes(made);
    const { service } = await open();
    const user = userEvent.setup();
    await upload(user);
    await user.click(saveButton());
    await finishSave();
    expect(service.saveMyCard).toHaveBeenCalledTimes(1);
    expect(service.saveMyCard.mock.calls[0][0].photoUrl).toBe(made);
    expect(service.saveMyCard.mock.calls[0][1]).toEqual({ expectedRevision: 3 });
    expect(card().querySelector('img')).toHaveAttribute('src', made);
  });

  it('is kept in the tab as part of the draft, and is there again when the page is opened again', async () => {
    makes(made);
    const first = await open();
    const user = userEvent.setup();
    await upload(user);
    await settle();
    expect(kept()).toEqual(['idynify.myCardDraft.v1:U', 'idynify.myCardDraftPhoto.v1:U']);
    first.view.unmount();
    await open();
    expect(card().querySelector('img')).toHaveAttribute('src', made);
    expect(screen.getByText('We restored the changes you hadn\'t saved')).toBeInTheDocument();
    expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
  });

  it('is forgotten from the tab once it is saved', async () => {
    makes(made);
    await open();
    const user = userEvent.setup();
    await upload(user);
    await settle();
    expect(kept()).toHaveLength(2);
    await user.click(saveButton());
    await finishSave();
    await settle();
    expect(kept()).toEqual([]);
  });

  it('survives a failed save: still on the card, still kept, and sent again on a retry', async () => {
    makes(made);
    const { service } = await open();
    service.saveMyCard.mockResolvedValueOnce(OFFLINE);
    const user = userEvent.setup();
    await upload(user);
    await user.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn\'t save your changes');
    expect(card().querySelector('img')).toHaveAttribute('src', made);
    await settle();
    expect(kept()).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await finishSave();
    expect(service.saveMyCard.mock.calls[1][0].photoUrl).toBe(made);
  });

  it('survives a conflict: the photo is kept, "Photo" is named as a difference, and it is sent only if the person chooses to', async () => {
    makes(made);
    const { service } = await open();
    service.saveMyCard.mockResolvedValueOnce({ status: 'conflict', current: okResult(5, { photoUrl: madeAgain, title: 'Newer' }) });
    const user = userEvent.setup();
    await upload(user);
    await user.click(saveButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/These differ from your version: .*Photo/);
    expect(alert.textContent).not.toMatch(/Photo link/);
    expect(card().querySelector('img')).toHaveAttribute('src', made);
    expect(service.saveMyCard).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Save my version over it' }));
    await user.click(screen.getByRole('button', { name: 'Overwrite with my version' }));
    await finishSave();
    expect(service.saveMyCard.mock.calls[1][0].photoUrl).toBe(made);
    expect(service.saveMyCard.mock.calls[1][1]).toEqual({ expectedRevision: 5 });
  });

  it('is replaced by the saved photo, and forgotten, if the person chooses the latest saved version', async () => {
    makes(made);
    const { service } = await open();
    service.saveMyCard.mockResolvedValueOnce({ status: 'conflict', current: okResult(5, { photoUrl: madeAgain, title: 'Newer' }) });
    const user = userEvent.setup();
    await upload(user);
    await user.click(saveButton());
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Load latest saved version' }));
    await user.click(screen.getByRole('button', { name: 'Replace my edits' }));
    expect(card().querySelector('img')).toHaveAttribute('src', madeAgain);
    await settle();
    expect(kept()).toEqual([]);
  });

  it('is replaced by another upload, and removed with a confirmation, and each is just another edit to save', async () => {
    makes(made, madeAgain);
    const { service } = await open({ load: okResult(3, { photoUrl: 'https://images.example.com/ada.jpg' }) });
    const user = userEvent.setup();
    await upload(user);
    expect(card().querySelector('img')).toHaveAttribute('src', made);
    await upload(user, { move: true });
    expect(card().querySelector('img')).toHaveAttribute('src', madeAgain);
    await user.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(card().querySelector('img')).toHaveAttribute('src', madeAgain);
    await user.click(screen.getByRole('button', { name: 'Yes, remove it' }));
    expect(card().querySelector('img')).toBeNull();
    await user.click(saveButton());
    await finishSave();
    expect(service.saveMyCard.mock.calls[0][0].photoUrl).toBe('');
  });

  it('is in the contact file, embedded, when the Photo switch is on, and not when it is off; and the page is saying nothing about it', async () => {
    makes(made);
    const downloads = stubDownloads();
    await open();
    const user = userEvent.setup();
    await upload(user);
    await user.click(screen.getByRole('button', { name: 'Download contact' }));
    const text = (await downloads.text()).replace(/\r\n /g, '');
    expect(text).toContain(`PHOTO;ENCODING=b;TYPE=JPEG:${made.slice('data:image/jpeg;base64,'.length)}`);
    await user.click(screen.getByRole('switch', { name: 'Photo on your card' }));
    await user.click(screen.getByRole('button', { name: 'Download contact' }));
    const second = (await downloads.text()).replace(/\r\n /g, '');
    expect(second).not.toContain('PHOTO');
    expect(second).not.toContain(fingerprintOf(made));
  });

  it('is never written to the screen as text, in a message, a notice or a label, at any step', async () => {
    makes(made);
    const { service } = await open();
    service.saveMyCard.mockResolvedValueOnce(OFFLINE);
    const user = userEvent.setup();
    await upload(user);
    await user.click(saveButton());
    await screen.findByRole('alert');
    const everything = [
      document.body.textContent,
      ...[...document.querySelectorAll('input, textarea')].map((node) => node.value),
      ...[...document.querySelectorAll('*')].flatMap((node) => [...node.attributes].filter((a) => !(node.tagName === 'IMG' && a.name === 'src')).map((a) => a.value)),
    ];
    expect(everything.some((text) => text.includes(fingerprintOf(made)) || /data:image\/jpeg;base64/.test(text))).toBe(false);
  });

  it('is not carried to the next account that signs in: the first account\'s draft and picture are forgotten', async () => {
    makes(made);
    await open();
    const user = userEvent.setup();
    await upload(user);
    await settle();
    expect(kept()).toHaveLength(2);
    act(() => { mocks.auth.currentUser = { uid: 'V' }; mocks.auth.listeners.forEach((listener) => listener({ uid: 'V' })); });
    await screen.findByRole('button', { name: 'Edit Card' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit Card' }));
    await screen.findByRole('form', { name: 'Edit your card' });
    expect(card().querySelector('img')).toBeNull();
    expect(screen.queryByText('We restored the changes you hadn\'t saved')).toBeNull();
    await settle(100);
    expect(kept().filter((key) => key.endsWith(':U'))).toEqual([]);
  });

  it('sends nothing to anyone: no network call is made by adding, cropping, using or saving a photo', async () => {
    makes(made);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open');
    try {
      await open();
      const user = userEvent.setup();
      await upload(user, { move: true });
      await user.click(saveButton());
      await finishSave();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(xhr).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('is not offered, and nothing is read or kept, while viewing as someone else', async () => {
    makes(made);
    mocks.impersonation.isImpersonating = true;
    installService();
    render(page());
    expect(await screen.findByText('You\'re viewing as someone else')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload photo' })).toBeNull();
    expect(screen.queryByLabelText('Choose a photo from your device')).toBeNull();
  });
});
