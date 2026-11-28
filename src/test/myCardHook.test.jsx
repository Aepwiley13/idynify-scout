/**
 * useMyCard, as the My Card screen will use it: load, keep the draft safe,
 * save, and settle a conflict. The service and the tab's storage are
 * stand-ins; the rules themselves (state, storage, diff) have their own tests,
 * so this is about how they are connected: that the right thing happens, in
 * the right order, for the right account, and that nothing is saved or kept
 * that should not be.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMyCard } from '../pages/ContactHub/myCard/state/useMyCard';
import { clearAllMyCardDrafts, draftKey, readDraft, saveDraft } from '../pages/ContactHub/myCard/state/myCardDraftStorage';
import { DRAFT_MAX_AGE_MS, DRAFT_PHOTO_KEY_PREFIX } from '../pages/ContactHub/myCard/state/myCardDraftStorage';
import { fingerprintOf, photoDataUrl } from './helpers/photoFixtures';
import { CONFLICT_CHOICE } from '../pages/ContactHub/myCard/state/myCardState';
import { DEFAULT_SHARE, DEFAULT_LINK_SHARE, newCard, normalizeCard } from '../utils/myCardRules';
import { FakeSessionStorage } from './helpers/fakeSessionStorage';

const NOW = 1_800_000_000_000;
const DEBOUNCE = 500;

const savedCard = (extra = {}) => ({ ...newCard(), firstName: 'Ada', lastName: 'Lovelace', title: 'Analyst', ...extra });
const okResult = (revision = 3, extra = {}) => ({ status: 'ok', card: savedCard(extra), revision });
const missingResult = () => ({ status: 'missing', card: newCard(), revision: null });
const NOT_BODY = { status: 'error', code: 'unavailable', message: 'Offline.', retryable: true };

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

/** A service that behaves like the real one: a save is against a revision, and returns the card as stored. */
function makeService(overrides = {}) {
  return {
    loadMyCard: vi.fn(async () => okResult(3)),
    loadCardSuggestions: vi.fn(async () => ({ suggestions: {}, unavailable: [] })),
    saveMyCard: vi.fn(async (card, { expectedRevision }) => ({
      status: 'saved', card: { ...normalizeCard(card).card, sharingEnabled: false }, revision: (expectedRevision ?? 0) + 1,
    })),
    ...overrides,
  };
}

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

/** Mounts the hook as a signed-in account, and waits for the load to finish. */
async function mount({ service = makeService(), storage = new FakeSessionStorage(), uid = 'U', impersonating = false, wait = true } = {}) {
  const auth = { uid };
  const hook = renderHook(
    (props) => useMyCard({ service, storage, now: () => NOW, debounceMs: DEBOUNCE, currentUid: () => auth.uid, ...props }),
    { initialProps: { uid, impersonating } },
  );
  if (wait) { await settle(); await settle(); }
  return { hook, service, storage, auth, now: () => hook.result.current, draft: () => hook.result.current.draft, state: () => hook.result.current.state };
}

const edit = (t, field, value) => act(() => { t.draft().edit(field, value); });
const stored = (storage, uid = 'U') => readDraft(uid, { storage, now: NOW });

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('loading', () => {
  it('loads a saved card, with nothing to save and nothing kept', async () => {
    const t = await mount();
    expect(t.state().load).toBe('ready');
    expect(t.draft().card).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace', title: 'Analyst' });
    expect(t.state().revision).toBe(3);
    expect(t.now().status).toBe('saved');
    expect(t.now().availability).toEqual({ enabled: false, reason: 'nothing-to-save' });
    expect(t.service.saveMyCard).not.toHaveBeenCalled();
    expect(t.storage.map.size).toBe(0);
  });

  it('reads the card and the suggestions together, for the signed-in account', async () => {
    const t = await mount();
    expect(t.service.loadMyCard).toHaveBeenCalledTimes(1);
    expect(t.service.loadCardSuggestions).toHaveBeenCalledTimes(1);
  });

  it('starts a card that was never saved as a new one, pre-filled in memory, and saves nothing by itself', async () => {
    const service = makeService({
      loadMyCard: vi.fn(async () => missingResult()),
      loadCardSuggestions: vi.fn(async () => ({
        suggestions: { firstName: { value: 'Ada', source: 'settings' }, lastName: { value: 'Lovelace', source: 'settings' }, email: { value: 'ada@example.com', source: 'account' } },
        unavailable: ['linkedin'],
      })),
    });
    const t = await mount({ service });
    expect(t.draft().card).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', sharingEnabled: false });
    expect(t.draft().card.share).toEqual({ ...DEFAULT_SHARE, ...DEFAULT_LINK_SHARE });
    expect(t.state()).toMatchObject({ isNew: true, revision: null, unavailable: ['linkedin'] });
    expect(t.now().status).toBe('new');
    // Untouched, it is not unsaved work; but it can be saved as it is.
    expect(t.draft().dirty).toBe(false);
    expect(t.now().availability.enabled).toBe(true);
    await advance(5000);
    expect(t.service.saveMyCard).not.toHaveBeenCalled();
    expect(t.storage.map.size).toBe(0);
  });

  it('still loads when the suggestions could not be read', async () => {
    const service = makeService({ loadCardSuggestions: vi.fn(async () => ({ suggestions: {}, unavailable: ['account', 'linkedin'] })) });
    const t = await mount({ service });
    expect(t.state().load).toBe('ready');
    expect(t.state().unavailable).toEqual(['account', 'linkedin']);
  });

  it('is an error, never an empty card, when the card cannot be read, and Save is not offered', async () => {
    const service = makeService({ loadMyCard: vi.fn(async () => NOT_BODY) });
    const t = await mount({ service });
    expect(t.state()).toMatchObject({ load: 'error', loadError: { code: 'unavailable', retryable: true } });
    expect(t.now().status).toBe('load-error');
    expect(t.now().availability).toEqual({ enabled: false, reason: 'load-error' });
    expect(await t.now().actions.save()).toEqual({ status: 'blocked' });
    expect(service.saveMyCard).not.toHaveBeenCalled();
  });

  it('can be retried, and then loads', async () => {
    const loadMyCard = vi.fn().mockResolvedValueOnce(NOT_BODY).mockResolvedValue(okResult(4));
    const t = await mount({ service: makeService({ loadMyCard }) });
    expect(t.state().load).toBe('error');
    act(() => t.now().actions.retryLoad());
    await settle(); await settle();
    expect(t.state()).toMatchObject({ load: 'ready', revision: 4, loadError: null });
    expect(loadMyCard).toHaveBeenCalledTimes(2);
  });

  it('treats a service that throws as a failed load', async () => {
    const t = await mount({ service: makeService({ loadMyCard: vi.fn(async () => { throw new Error('boom'); }) }) });
    expect(t.state()).toMatchObject({ load: 'error', loadError: { retryable: true } });
  });

  it('shows what had to be repaired in a damaged saved card', async () => {
    const service = makeService({ loadMyCard: vi.fn(async () => ({ status: 'repaired', card: savedCard(), revision: 2, errors: { email: 'x' }, repairs: ['email'] })) });
    const t = await mount({ service });
    expect(t.state().repaired).toEqual({ errors: { email: 'x' }, repairs: ['email'] });
  });

  it('makes no state change after the page has gone', async () => {
    const slow = deferred();
    const service = makeService({ loadMyCard: vi.fn(() => slow.promise) });
    const t = await mount({ service });
    t.hook.unmount();
    await act(async () => { slow.resolve(okResult(9)); await vi.advanceTimersByTimeAsync(0); });
    expect(t.storage.map.size).toBe(0);
  });
});

describe('keeping the draft', () => {
  it('keeps it after a pause once there are unsaved changes, against the revision it started from', async () => {
    const t = await mount();
    await edit(t, 'title', 'Director');
    expect(t.storage.map.size).toBe(0);
    await advance(DEBOUNCE - 1);
    expect(t.storage.map.size).toBe(0);
    await advance(1);
    const kept = stored(t.storage);
    expect(kept.status).toBe('ok');
    expect(kept.draft).toMatchObject({ baseRevision: 3 });
    expect(kept.draft.card.title).toBe('Director');
  });

  it('waits again for each change, so typing is not written a key at a time', async () => {
    const t = await mount();
    await edit(t, 'title', 'D');
    await advance(DEBOUNCE - 100);
    await edit(t, 'title', 'Di');
    await advance(DEBOUNCE - 100);
    expect(t.storage.calls('setItem')).toBe(0);
    await advance(100);
    expect(t.storage.calls('setItem')).toBe(1);
    expect(stored(t.storage).draft.card.title).toBe('Di');
  });

  it('keeps nothing for a draft that is clean, and forgets one that becomes clean again', async () => {
    const t = await mount();
    await advance(DEBOUNCE * 3);
    expect(t.storage.calls('setItem')).toBe(0);
    await edit(t, 'title', 'Director');
    await advance(DEBOUNCE);
    expect(t.storage.map.size).toBe(1);
    await edit(t, 'title', 'Analyst');
    await settle();
    expect(t.storage.map.size).toBe(0);
  });

  it('keeps the switches, and only what a draft may hold', async () => {
    const t = await mount();
    act(() => t.draft().setShare('email', true));
    await advance(DEBOUNCE);
    const { draft } = stored(t.storage);
    expect(draft.card.share.email).toBe(true);
    const raw = t.storage.getItem(draftKey('U'));
    expect(raw).not.toMatch(/sharingEnabled|suggest|token/);
  });

  it('keeps it at once when the page is hidden or closed', async () => {
    const t = await mount();
    await edit(t, 'title', 'Director');
    window.dispatchEvent(new Event('pagehide'));
    expect(stored(t.storage).draft.card.title).toBe('Director');
    await edit(t, 'title', 'Manager');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expect(stored(t.storage).draft.card.title).toBe('Manager');
  });

  it('keeps it when the page is left inside the app: unmounting is the navigation', async () => {
    const t = await mount();
    await edit(t, 'title', 'Director');
    expect(t.storage.map.size).toBe(0);
    t.hook.unmount();
    expect(stored(t.storage).draft.card.title).toBe('Director');
  });

  it('keeps nothing on leaving when there is nothing unsaved', async () => {
    const t = await mount();
    t.hook.unmount();
    expect(t.storage.map.size).toBe(0);
  });

  it('survives a storage that refuses: the page carries on', async () => {
    const storage = new FakeSessionStorage({ failOn: ['setItem'] });
    const t = await mount({ storage });
    await edit(t, 'title', 'Director');
    await advance(DEBOUNCE);
    expect(t.draft().card.title).toBe('Director');
    expect(t.draft().dirty).toBe(true);
    expect(t.now().status).toBe('unsaved');
  });
});

describe('leaving the page: the browser warning', () => {
  const beforeUnload = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it('warns only while there are unsaved changes', async () => {
    const t = await mount();
    expect(beforeUnload()).toBe(false);
    await edit(t, 'title', 'Director');
    expect(beforeUnload()).toBe(true);
    await edit(t, 'title', 'Analyst');
    expect(beforeUnload()).toBe(false);
  });

  it('stops warning once the changes are saved, and on unmount', async () => {
    const t = await mount();
    await edit(t, 'title', 'Director');
    expect(beforeUnload()).toBe(true);
    await act(async () => { await t.now().actions.save(); });
    expect(beforeUnload()).toBe(false);
    await edit(t, 'title', 'Again');
    expect(beforeUnload()).toBe(true);
    t.hook.unmount();
    expect(beforeUnload()).toBe(false);
  });

  it('does not warn about a card that is only pre-filled', async () => {
    const service = makeService({ loadMyCard: vi.fn(async () => missingResult()), loadCardSuggestions: vi.fn(async () => ({ suggestions: { firstName: { value: 'Ada', source: 'settings' } }, unavailable: [] })) });
    await mount({ service });
    expect(beforeUnload()).toBe(false);
  });
});

describe('coming back: recovering a draft', () => {
  const keep = (storage, card, baseRevision = 3, at = NOW - 60_000, uid = 'U') => saveDraft({ uid, card, baseRevision }, { storage, now: at });

  it('restores a draft that began from the saved revision, with a notice, unsaved, and ready to save', async () => {
    const storage = new FakeSessionStorage();
    keep(storage, savedCard({ title: 'Recovered', share: { ...DEFAULT_SHARE, email: true } }), 3);
    const t = await mount({ storage });
    expect(t.draft().card.title).toBe('Recovered');
    expect(t.draft().card.share.email).toBe(true);
    expect(t.draft().dirty).toBe(true);
    expect(t.state().recovered).toMatchObject({ baseRevision: 3 });
    expect(t.state().conflict).toBeNull();
    expect(t.now().status).toBe('unsaved');
    expect(t.now().availability.enabled).toBe(true);
    // Restoring saves nothing: only a person's Save does.
    expect(t.service.saveMyCard).not.toHaveBeenCalled();
  });

  it('survives a refresh: the draft kept on the way out is the draft restored on the way in', async () => {
    const storage = new FakeSessionStorage();
    const first = await mount({ storage });
    await edit(first, 'title', 'Typed before the refresh');
    window.dispatchEvent(new Event('pagehide'));
    first.hook.unmount();
    const second = await mount({ storage });
    expect(second.draft().card.title).toBe('Typed before the refresh');
    expect(second.draft().dirty).toBe(true);
    expect(second.state().recovered).not.toBeNull();
  });

  it('survives leaving and coming back inside the app', async () => {
    const storage = new FakeSessionStorage();
    const first = await mount({ storage });
    await edit(first, 'phone', '+1 555 010 2000');
    first.hook.unmount();
    const second = await mount({ storage });
    expect(second.draft().card.phone).toBe('+1 555 010 2000');
  });

  it('forgets a draft that says what is saved, silently', async () => {
    const storage = new FakeSessionStorage();
    keep(storage, savedCard(), 3);
    const t = await mount({ storage });
    expect(t.state().recovered).toBeNull();
    expect(t.draft().dirty).toBe(false);
    expect(storage.map.size).toBe(0);
  });

  it('forgets an expired draft, and does not restore it', async () => {
    const storage = new FakeSessionStorage();
    keep(storage, savedCard({ title: 'Stale' }), 3, NOW - DRAFT_MAX_AGE_MS - 1000);
    const t = await mount({ storage });
    expect(t.draft().card.title).toBe('Analyst');
    expect(t.state().recovered).toBeNull();
    expect(t.draft().dirty).toBe(false);
    expect(storage.map.size).toBe(0);
  });

  it('forgets a draft that is damaged or not what is written, and does not restore it', async () => {
    const storage = new FakeSessionStorage();
    storage.setItem(draftKey('U'), JSON.stringify({ v: 1, uid: 'U', savedAt: NOW, baseRevision: 3, fields: { title: 'x' }, share: {} }));
    const t = await mount({ storage });
    expect(t.draft().card.title).toBe('Analyst');
    expect(t.state().recovered).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it('never shows another account\'s draft, and forgets it when this account opens the page', async () => {
    const storage = new FakeSessionStorage();
    keep(storage, savedCard({ title: 'Somebody else\'s' }), 3, NOW - 1000, 'OTHER');
    const t = await mount({ storage });
    expect(t.draft().card.title).toBe('Analyst');
    expect(t.state().recovered).toBeNull();
    expect([...storage.map.keys()]).toEqual([]);
  });

  it('restores a draft for a card that was never saved, against "no card yet"', async () => {
    const storage = new FakeSessionStorage();
    keep(storage, savedCard({ title: 'Typed' }), null);
    const service = makeService({ loadMyCard: vi.fn(async () => missingResult()) });
    const t = await mount({ service, storage });
    expect(t.draft().card.title).toBe('Typed');
    expect(t.state()).toMatchObject({ isNew: true, revision: null });
    expect(t.state().conflict).toBeNull();
    expect(service.saveMyCard).not.toHaveBeenCalled();
  });

  it('on Discard changes, goes back to the saved card and forgets the draft', async () => {
    const storage = new FakeSessionStorage();
    keep(storage, savedCard({ title: 'Recovered' }), 3);
    const t = await mount({ storage });
    let discarded;
    act(() => { discarded = t.now().actions.discardRecovered(); });
    expect(discarded).toBe(true);
    expect(t.draft().card.title).toBe('Analyst');
    expect(t.draft().dirty).toBe(false);
    expect(t.state().recovered).toBeNull();
    await advance(DEBOUNCE * 2);
    expect(storage.map.size).toBe(0);
  });

  it('can dismiss the notice and keep the draft', async () => {
    const storage = new FakeSessionStorage();
    keep(storage, savedCard({ title: 'Recovered' }), 3);
    const t = await mount({ storage });
    act(() => t.now().actions.dismissRecovered());
    expect(t.state().recovered).toBeNull();
    expect(t.draft().card.title).toBe('Recovered');
    expect(t.draft().dirty).toBe(true);
  });

  it('does not forget a restored draft before it is seen: the restore and the clean-up do not race', async () => {
    const storage = new FakeSessionStorage();
    keep(storage, savedCard({ title: 'Recovered' }), 3);
    const t = await mount({ storage });
    await advance(DEBOUNCE * 4);
    expect(stored(storage).status).toBe('ok');
    expect(t.draft().card.title).toBe('Recovered');
  });

  it('has nothing to discard when nothing was restored', async () => {
    const t = await mount();
    expect(t.now().actions.discardRecovered()).toBe(false);
  });
});

describe('saving', () => {
  it('sends the draft against the revision it started from, and moves on to the new one', async () => {
    const t = await mount();
    await edit(t, 'title', 'Director');
    let result;
    await act(async () => { result = await t.now().actions.save(); });
    expect(result).toEqual({ status: 'saved', hasUnsavedChanges: false, revision: expect.any(Number) });
    expect(t.service.saveMyCard).toHaveBeenCalledTimes(1);
    const [sent, options] = t.service.saveMyCard.mock.calls[0];
    expect(sent.title).toBe('Director');
    expect(options).toEqual({ expectedRevision: 3 });
    expect(t.state()).toMatchObject({ revision: 4, save: 'saved' });
    expect(t.draft().dirty).toBe(false);
    expect(t.now().status).toBe('saved');
    // The next save is against the revision just made.
    await edit(t, 'title', 'Manager');
    await act(async () => { await t.now().actions.save(); });
    expect(t.service.saveMyCard.mock.calls[1][1]).toEqual({ expectedRevision: 4 });
  });

  it('never sends the sharing setting as on', async () => {
    const t = await mount();
    await edit(t, 'title', 'Director');
    await act(async () => { await t.now().actions.save(); });
    expect(t.service.saveMyCard.mock.calls[0][0].sharingEnabled).toBe(false);
  });

  it('forgets the kept draft once it is saved, and does not write it back', async () => {
    const t = await mount();
    await edit(t, 'title', 'Director');
    await advance(DEBOUNCE);
    expect(t.storage.map.size).toBe(1);
    await act(async () => { await t.now().actions.save(); });
    await advance(DEBOUNCE * 3);
    expect(t.storage.map.size).toBe(0);
  });

  it('saves a new card untouched, against "no card yet", and then against its first revision', async () => {
    const service = makeService({ loadMyCard: vi.fn(async () => missingResult()), loadCardSuggestions: vi.fn(async () => ({ suggestions: { firstName: { value: 'Ada', source: 'settings' } }, unavailable: [] })) });
    const t = await mount({ service });
    await act(async () => { await t.now().actions.save(); });
    expect(service.saveMyCard.mock.calls[0][1]).toEqual({ expectedRevision: null });
    expect(t.state()).toMatchObject({ revision: 1, isNew: false });
    expect(t.now().status).toBe('saved');
  });

  it('does not send a card that is not valid, and shows what is wrong', async () => {
    const t = await mount();
    await edit(t, 'email', 'not-an-email');
    let result;
    await act(async () => { result = await t.now().actions.save(); });
    expect(result).toEqual({ status: 'invalid' });
    expect(t.service.saveMyCard).not.toHaveBeenCalled();
    expect(t.draft().errors.email).toMatch(/email/i);
    expect(t.state().save).toBe('idle');
  });

  it('does not save when there is nothing to save', async () => {
    const t = await mount();
    let result;
    await act(async () => { result = await t.now().actions.save(); });
    expect(result).toEqual({ status: 'blocked' });
    expect(t.service.saveMyCard).not.toHaveBeenCalled();
  });

  it('does not start a second save while one is on its way', async () => {
    const slow = deferred();
    const service = makeService({ saveMyCard: vi.fn(() => slow.promise) });
    const t = await mount({ service });
    await edit(t, 'title', 'Director');
    let first;
    act(() => { first = t.now().actions.save(); });
    await settle();
    expect(t.now().status).toBe('saving');
    let second;
    await act(async () => { second = await t.now().actions.save(); });
    expect(second).toEqual({ status: 'blocked' });
    expect(service.saveMyCard).toHaveBeenCalledTimes(1);
    await act(async () => { slow.resolve({ status: 'saved', card: savedCard({ title: 'Director' }), revision: 4 }); await first; });
    expect(t.state().revision).toBe(4);
  });

  it('keeps what was typed while it was saving, as unsaved changes on top of what was saved', async () => {
    const slow = deferred();
    const service = makeService({ saveMyCard: vi.fn(() => slow.promise) });
    const t = await mount({ service });
    await edit(t, 'title', 'Director');
    let pending;
    act(() => { pending = t.now().actions.save(); });
    await settle();
    await edit(t, 'phone', '+1 555 010 2000');
    await act(async () => { slow.resolve({ status: 'saved', card: savedCard({ title: 'Director' }), revision: 4 }); await pending; });
    expect(t.state().revision).toBe(4);
    expect(t.draft().card.phone).toBe('+1 555 010 2000');
    expect(t.draft().card.title).toBe('Director');
    expect(t.draft().dirty).toBe(true);
    expect(t.now().status).toBe('unsaved');
    await advance(DEBOUNCE);
    expect(stored(t.storage).draft).toMatchObject({ baseRevision: 4 });
  });

  describe('when a save fails', () => {
    it('keeps the draft and the revision, says what happened, and can be tried again', async () => {
      const saveMyCard = vi.fn().mockResolvedValueOnce(NOT_BODY).mockImplementation(async (card, { expectedRevision }) => ({ status: 'saved', card: normalizeCard(card).card, revision: expectedRevision + 1 }));
      const t = await mount({ service: makeService({ saveMyCard }) });
      await edit(t, 'title', 'Director');
      await act(async () => { await t.now().actions.save(); });
      expect(t.state()).toMatchObject({ save: 'error', revision: 3, saveError: { code: 'unavailable', retryable: true } });
      expect(t.now().status).toBe('save-error');
      expect(t.draft().card.title).toBe('Director');
      expect(t.draft().dirty).toBe(true);
      // Retrying is the same save, against the same revision.
      await act(async () => { await t.now().actions.save(); });
      expect(saveMyCard.mock.calls[1][1]).toEqual({ expectedRevision: 3 });
      expect(t.state()).toMatchObject({ save: 'saved', revision: 4, saveError: null });
    });

    it('keeps the draft kept, so a failed save and a refresh lose nothing', async () => {
      const t = await mount({ service: makeService({ saveMyCard: vi.fn(async () => NOT_BODY) }) });
      await edit(t, 'title', 'Director');
      await act(async () => { await t.now().actions.save(); });
      window.dispatchEvent(new Event('pagehide'));
      expect(stored(t.storage).draft.card.title).toBe('Director');
    });

    it('treats a service that throws as a failed save', async () => {
      const t = await mount({ service: makeService({ saveMyCard: vi.fn(async () => { throw new Error('boom'); }) }) });
      await edit(t, 'title', 'Director');
      await act(async () => { await t.now().actions.save(); });
      expect(t.state()).toMatchObject({ save: 'error', saveError: { retryable: true } });
      expect(t.draft().card.title).toBe('Director');
    });

    it('shows the messages when the service itself says the card is not valid', async () => {
      const t = await mount({ service: makeService({ saveMyCard: vi.fn(async () => ({ status: 'invalid', errors: { website: 'x' } })) }) });
      await edit(t, 'title', 'Director');
      await act(async () => { await t.now().actions.save(); });
      expect(t.state().save).toBe('error');
      expect(t.state().saveError.code).toBe('invalid');
    });

    it('reports a permission refusal as it is, and does not move the revision', async () => {
      const refusal = { status: 'error', code: 'permission-denied', message: 'No access.', retryable: false };
      const t = await mount({ service: makeService({ saveMyCard: vi.fn(async () => refusal) }) });
      await edit(t, 'title', 'Director');
      await act(async () => { await t.now().actions.save(); });
      expect(t.state()).toMatchObject({ save: 'error', revision: 3, saveError: { code: 'permission-denied', retryable: false } });
    });
  });
});

describe('a conflict: another version has been saved', () => {
  /** The saved card changed under this tab's feet, to revision 5. */
  const conflicting = (current = okResult(5, { title: 'Newer elsewhere' })) => makeService({
    saveMyCard: vi.fn()
      .mockResolvedValueOnce({ status: 'conflict', current })
      // Any later save is made against the revision it names, as the real service does.
      .mockImplementation(async (card, { expectedRevision }) => ({ status: 'saved', card: { ...normalizeCard(card).card, sharingEnabled: false }, revision: (expectedRevision ?? 0) + 1 })),
  });

  async function inConflict(service = conflicting()) {
    const t = await mount({ service });
    await edit(t, 'title', 'My version');
    await act(async () => { await t.now().actions.save(); });
    return t;
  }

  it('never touches the draft, and names what differs', async () => {
    const t = await inConflict();
    expect(t.state().conflict).toMatchObject({ confirm: null, renewed: false });
    expect(t.state().conflict.changes.map((change) => change.field)).toEqual(['title']);
    expect(t.draft().card.title).toBe('My version');
    expect(t.draft().dirty).toBe(true);
    expect(t.state().revision).toBe(3);
    expect(t.now().status).toBe('conflict');
    expect(t.now().choices).toEqual({ canLoadLatest: true, canSaveOver: true });
  });

  it('blocks saving while it stands', async () => {
    const t = await inConflict();
    expect(t.now().availability).toEqual({ enabled: false, reason: 'conflict' });
    let result;
    await act(async () => { result = await t.now().actions.save(); });
    expect(result).toEqual({ status: 'blocked' });
    expect(t.service.saveMyCard).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft safe in the tab while it stands', async () => {
    const t = await inConflict();
    window.dispatchEvent(new Event('pagehide'));
    expect(stored(t.storage).draft.card.title).toBe('My version');
  });

  describe('Load latest saved version', () => {
    it('does nothing until it is chosen, and nothing more until it is confirmed', async () => {
      const t = await inConflict();
      let done;
      act(() => { done = t.now().actions.confirmLoadLatest(); });
      expect(done).toBe(false);
      expect(t.draft().card.title).toBe('My version');
      act(() => t.now().actions.chooseConflict(CONFLICT_CHOICE.LOAD_LATEST));
      expect(t.state().conflict.confirm).toBe('load-latest');
      // Choosing is not doing: the draft is still the person's.
      expect(t.draft().card.title).toBe('My version');
      expect(t.draft().dirty).toBe(true);
    });

    it('replaces the draft with the saved card, on the confirmation, and forgets the kept draft', async () => {
      const t = await inConflict();
      act(() => t.now().actions.chooseConflict(CONFLICT_CHOICE.LOAD_LATEST));
      let done;
      act(() => { done = t.now().actions.confirmLoadLatest(); });
      expect(done).toBe(true);
      expect(t.draft().card.title).toBe('Newer elsewhere');
      expect(t.draft().dirty).toBe(false);
      expect(t.state()).toMatchObject({ revision: 5, conflict: null });
      await advance(DEBOUNCE * 2);
      expect(t.storage.map.size).toBe(0);
      expect(t.now().status).toBe('saved');
    });

    it('can be changed of mind: cancelling leaves the draft, and the conflict, as they were', async () => {
      const t = await inConflict();
      act(() => t.now().actions.chooseConflict(CONFLICT_CHOICE.LOAD_LATEST));
      act(() => t.now().actions.cancelConflict());
      expect(t.state().conflict.confirm).toBeNull();
      let done;
      act(() => { done = t.now().actions.confirmLoadLatest(); });
      expect(done).toBe(false);
      expect(t.draft().card.title).toBe('My version');
    });

    it('goes back to a new card when the saved card has been deleted, pre-filled again', async () => {
      const service = makeService({
        loadCardSuggestions: vi.fn(async () => ({ suggestions: { firstName: { value: 'Grace', source: 'settings' } }, unavailable: [] })),
        saveMyCard: vi.fn().mockResolvedValueOnce({ status: 'conflict', current: missingResult() }),
      });
      const t = await inConflict(service);
      act(() => t.now().actions.chooseConflict(CONFLICT_CHOICE.LOAD_LATEST));
      act(() => { t.now().actions.confirmLoadLatest(); });
      expect(t.state()).toMatchObject({ revision: null, isNew: true });
      expect(t.draft().card.firstName).toBe('Grace');
    });
  });

  describe('Save my version over it', () => {
    it('does nothing until it is chosen: no save is sent', async () => {
      const t = await inConflict();
      let result;
      await act(async () => { result = await t.now().actions.confirmSaveOver(); });
      expect(result).toEqual({ status: 'blocked' });
      expect(t.service.saveMyCard).toHaveBeenCalledTimes(1);
    });

    it('saves against the revision that was just seen, and ends the conflict when it succeeds', async () => {
      const t = await inConflict();
      act(() => t.now().actions.chooseConflict(CONFLICT_CHOICE.SAVE_OVER));
      await act(async () => { await t.now().actions.confirmSaveOver(); });
      expect(t.service.saveMyCard).toHaveBeenCalledTimes(2);
      const [sent, options] = t.service.saveMyCard.mock.calls[1];
      expect(sent.title).toBe('My version');
      // Not 3, the revision the draft began from: 5, the one just seen.
      expect(options).toEqual({ expectedRevision: 5 });
      expect(t.state()).toMatchObject({ save: 'saved', revision: 6, conflict: null });
      expect(t.draft().dirty).toBe(false);
      expect(t.draft().card.title).toBe('My version');
    });

    it('if the card changed again, stops and asks again: nothing is overwritten and nothing is retried by itself', async () => {
      const service = makeService({
        saveMyCard: vi.fn()
          .mockResolvedValueOnce({ status: 'conflict', current: okResult(5, { title: 'Newer elsewhere' }) })
          .mockResolvedValueOnce({ status: 'conflict', current: okResult(8, { title: 'Newer still' }) }),
      });
      const t = await inConflict(service);
      act(() => t.now().actions.chooseConflict(CONFLICT_CHOICE.SAVE_OVER));
      await act(async () => { await t.now().actions.confirmSaveOver(); });
      expect(t.state().conflict).toMatchObject({ confirm: null, renewed: true });
      expect(t.state().conflict.current.revision).toBe(8);
      expect(t.draft().card.title).toBe('My version');
      await advance(DEBOUNCE * 10);
      expect(service.saveMyCard).toHaveBeenCalledTimes(2);
      // It needs a fresh choice, and then it is against revision 8.
      let result;
      await act(async () => { result = await t.now().actions.confirmSaveOver(); });
      expect(result).toEqual({ status: 'blocked' });
      act(() => t.now().actions.chooseConflict(CONFLICT_CHOICE.SAVE_OVER));
      await act(async () => { await t.now().actions.confirmSaveOver(); });
      expect(service.saveMyCard.mock.calls[2][1]).toEqual({ expectedRevision: 8 });
    });

    it('if the save fails for another reason, it is not remembered as confirmed', async () => {
      const service = makeService({
        saveMyCard: vi.fn()
          .mockResolvedValueOnce({ status: 'conflict', current: okResult(5) })
          .mockResolvedValueOnce(NOT_BODY),
      });
      const t = await inConflict(service);
      act(() => t.now().actions.chooseConflict(CONFLICT_CHOICE.SAVE_OVER));
      await act(async () => { await t.now().actions.confirmSaveOver(); });
      expect(t.state()).toMatchObject({ save: 'error', saveError: { code: 'unavailable' } });
      expect(t.state().conflict.confirm).toBeNull();
      expect(t.draft().card.title).toBe('My version');
      let result;
      await act(async () => { result = await t.now().actions.confirmSaveOver(); });
      expect(result).toEqual({ status: 'blocked' });
    });

    it('is not offered when the saved card was written by a newer version', async () => {
      const t = await inConflict(conflicting({ status: 'error', code: 'newer-version', message: 'Newer.', retryable: false }));
      expect(t.now().choices).toEqual({ canLoadLatest: false, canSaveOver: false });
      act(() => t.now().actions.chooseConflict(CONFLICT_CHOICE.SAVE_OVER));
      expect(t.state().conflict.confirm).toBeNull();
    });
  });

  describe('found on coming back, from a draft that began from an older revision', () => {
    const keepOld = (storage) => saveDraft({ uid: 'U', card: savedCard({ title: 'Old draft', share: { ...DEFAULT_SHARE, email: true } }), baseRevision: 2 }, { storage, now: NOW - 1000 });
    const newerSaved = () => makeService({ loadMyCard: vi.fn(async () => okResult(5, { title: 'Saved since' })) });

    it('keeps the draft as it was, raises the conflict, and lists what differs', async () => {
      const storage = new FakeSessionStorage();
      keepOld(storage);
      const t = await mount({ service: newerSaved(), storage });
      expect(t.draft().card.title).toBe('Old draft');
      expect(t.draft().dirty).toBe(true);
      expect(t.state().recovered).not.toBeNull();
      expect(t.state().conflict).toMatchObject({ confirm: null, renewed: false });
      expect(t.state().conflict.changes.map((change) => `${change.kind}:${change.field}`)).toEqual(['value:title', 'switch:email']);
      expect(t.now().availability.reason).toBe('conflict');
      expect(t.service.saveMyCard).not.toHaveBeenCalled();
    });

    it('is settled the same two ways: Load latest replaces the draft, only on confirmation', async () => {
      const storage = new FakeSessionStorage();
      keepOld(storage);
      const t = await mount({ service: newerSaved(), storage });
      act(() => t.now().actions.chooseConflict(CONFLICT_CHOICE.LOAD_LATEST));
      expect(t.draft().card.title).toBe('Old draft');
      act(() => { t.now().actions.confirmLoadLatest(); });
      expect(t.draft().card.title).toBe('Saved since');
      expect(t.state()).toMatchObject({ revision: 5, conflict: null, recovered: null });
      expect(storage.map.size).toBe(0);
    });

    it('and Discard changes is the same as loading the latest', async () => {
      const storage = new FakeSessionStorage();
      keepOld(storage);
      const t = await mount({ service: newerSaved(), storage });
      act(() => { t.now().actions.discardRecovered(); });
      expect(t.draft().card.title).toBe('Saved since');
      expect(t.state()).toMatchObject({ revision: 5, conflict: null, recovered: null });
      expect(storage.map.size).toBe(0);
    });

    it('and Save my version over it saves against the revision just loaded', async () => {
      const storage = new FakeSessionStorage();
      keepOld(storage);
      const t = await mount({ service: newerSaved(), storage });
      act(() => t.now().actions.chooseConflict(CONFLICT_CHOICE.SAVE_OVER));
      await act(async () => { await t.now().actions.confirmSaveOver(); });
      expect(t.service.saveMyCard.mock.calls[0][1]).toEqual({ expectedRevision: 5 });
      expect(t.state()).toMatchObject({ revision: 6, conflict: null });
    });
  });
});

describe('switching account', () => {
  it('shows nothing of the first account while the second loads, and ignores the first\'s late answers', async () => {
    const auth = { uid: 'A' };
    const lateLoad = deferred();
    const lateSave = deferred();
    const service = makeService({
      loadMyCard: vi.fn(() => (auth.uid === 'A' ? Promise.resolve(okResult(3, { firstName: 'Alice' })) : lateLoad.promise)),
      saveMyCard: vi.fn(() => lateSave.promise),
    });
    const storage = new FakeSessionStorage();
    const hook = renderHook((props) => useMyCard({ service, storage, now: () => NOW, debounceMs: DEBOUNCE, currentUid: () => auth.uid, ...props }), { initialProps: { uid: 'A' } });
    await settle(); await settle();
    act(() => hook.result.current.draft.edit('title', 'Alice\'s unsaved title'));
    let pending;
    act(() => { pending = hook.result.current.actions.save(); });
    await settle();
    expect(hook.result.current.state.save).toBe('saving');

    // The account changes while A's save is still on its way.
    auth.uid = 'B';
    hook.rerender({ uid: 'B' });
    await settle();
    expect(hook.result.current.state).toMatchObject({ uid: 'B', load: 'loading', save: 'idle' });
    expect(hook.result.current.draft.card.firstName).toBe('');
    expect(hook.result.current.draft.card.title).toBe('');

    // A's save answers, late: it lands nowhere.
    await act(async () => { lateSave.resolve({ status: 'saved', card: savedCard({ firstName: 'Alice' }), revision: 4 }); await pending; });
    expect(hook.result.current.state).toMatchObject({ uid: 'B', load: 'loading', revision: null });
    expect(hook.result.current.draft.card.firstName).toBe('');

    await act(async () => { lateLoad.resolve(okResult(11, { firstName: 'Bob' })); await vi.advanceTimersByTimeAsync(0); });
    expect(hook.result.current.state).toMatchObject({ uid: 'B', load: 'ready', revision: 11 });
    expect(hook.result.current.draft.card.firstName).toBe('Bob');
  });

  it('ignores a first account\'s load that answers after the second has loaded', async () => {
    const lateFirst = deferred();
    const loads = [lateFirst.promise, Promise.resolve(okResult(11, { firstName: 'Bob' }))];
    const service = makeService({ loadMyCard: vi.fn(() => loads.shift()) });
    const storage = new FakeSessionStorage();
    const hook = renderHook((props) => useMyCard({ service, storage, now: () => NOW, debounceMs: DEBOUNCE, ...props }), { initialProps: { uid: 'A' } });
    await settle();
    hook.rerender({ uid: 'B' });
    await settle(); await settle();
    expect(hook.result.current.draft.card.firstName).toBe('Bob');
    await act(async () => { lateFirst.resolve(okResult(3, { firstName: 'Alice' })); await vi.advanceTimersByTimeAsync(0); });
    expect(hook.result.current.draft.card.firstName).toBe('Bob');
    expect(hook.result.current.state).toMatchObject({ uid: 'B', revision: 11 });
  });

  it('ignores a first account\'s save that answers after the second has loaded: nothing of it reaches the second', async () => {
    const auth = { uid: 'A' };
    const lateSave = deferred();
    const service = makeService({
      loadMyCard: vi.fn(async () => (auth.uid === 'A' ? okResult(3, { firstName: 'Alice' }) : okResult(11, { firstName: 'Bob', title: 'Bob saved' }))),
      saveMyCard: vi.fn(() => lateSave.promise),
    });
    const storage = new FakeSessionStorage();
    const hook = renderHook((props) => useMyCard({ service, storage, now: () => NOW, debounceMs: DEBOUNCE, currentUid: () => auth.uid, ...props }), { initialProps: { uid: 'A' } });
    await settle(); await settle();
    act(() => hook.result.current.draft.edit('title', 'Alice\'s unsaved title'));
    let pending;
    act(() => { pending = hook.result.current.actions.save(); });
    await settle();

    auth.uid = 'B';
    hook.rerender({ uid: 'B' });
    await settle(); await settle();
    expect(hook.result.current.state).toMatchObject({ uid: 'B', load: 'ready', revision: 11 });
    expect(hook.result.current.draft.dirty).toBe(false);

    // A's save answers now, with B on screen.
    await act(async () => { lateSave.resolve({ status: 'saved', card: savedCard({ firstName: 'Alice', title: 'Alice saved' }), revision: 4 }); await pending; });
    expect(hook.result.current.state).toMatchObject({ uid: 'B', revision: 11, save: 'idle' });
    expect(hook.result.current.draft.card).toMatchObject({ firstName: 'Bob', title: 'Bob saved' });
    // B's draft is still measured from B's own card, not from Alice's.
    expect(hook.result.current.draft.dirty).toBe(false);
    await advance(DEBOUNCE * 3);
    expect(storage.map.size).toBe(0);
  });

  it('keeps each account\'s kept draft apart, and the new account sees only its own', async () => {
    const storage = new FakeSessionStorage();
    saveDraft({ uid: 'A', card: savedCard({ title: 'A\'s unsaved' }), baseRevision: 3 }, { storage, now: NOW - 1000 });
    const auth = { uid: 'B' };
    const service = makeService({ loadMyCard: vi.fn(async () => okResult(3, { firstName: 'Bob', title: 'Bob\'s saved' })) });
    const hook = renderHook((props) => useMyCard({ service, storage, now: () => NOW, debounceMs: DEBOUNCE, currentUid: () => auth.uid, ...props }), { initialProps: { uid: 'B' } });
    await settle(); await settle();
    expect(hook.result.current.draft.card.title).toBe('Bob\'s saved');
    expect(hook.result.current.state.recovered).toBeNull();
    expect(readDraft('A', { storage, now: NOW }).status).toBe('none');
  });
});

describe('impersonation: read-only, and nothing touches storage', () => {
  it('reads nothing, saves nothing and does not touch the tab\'s storage at all', async () => {
    const t = await mount({ impersonating: true });
    expect(t.state()).toMatchObject({ load: 'blocked', blocked: 'impersonating' });
    expect(t.now().status).toBe('read-only');
    expect(t.service.loadMyCard).not.toHaveBeenCalled();
    expect(t.service.loadCardSuggestions).not.toHaveBeenCalled();
    expect(t.storage.calls()).toBe(0);
    expect(await t.now().actions.save()).toEqual({ status: 'blocked' });
    expect(t.service.saveMyCard).not.toHaveBeenCalled();
  });

  it('keeps nothing and warns about nothing, even if something is typed', async () => {
    const t = await mount({ impersonating: true });
    await edit(t, 'title', 'Typed anyway');
    await advance(DEBOUNCE * 4);
    window.dispatchEvent(new Event('pagehide'));
    t.hook.unmount();
    expect(t.storage.calls()).toBe(0);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('on starting to view as someone else, drops the real account\'s text from memory and keeps nothing from then on', async () => {
    const t = await mount();
    await edit(t, 'title', 'Admin\'s own unsaved text');
    await advance(DEBOUNCE);
    const callsBefore = t.storage.calls();
    t.hook.rerender({ uid: 'U', impersonating: true });
    await settle();
    expect(t.state().load).toBe('blocked');
    expect(t.draft().card.title).toBe('');
    await edit(t, 'title', 'Typed while impersonating');
    await advance(DEBOUNCE * 4);
    expect(t.storage.calls()).toBe(callsBefore);
    expect(t.service.saveMyCard).not.toHaveBeenCalled();
    // And on stopping, the real account's own card loads again.
    t.hook.rerender({ uid: 'U', impersonating: false });
    await settle(); await settle();
    expect(t.state()).toMatchObject({ load: 'ready', revision: 3 });
  });

  it('does not show or restore the admin\'s own draft while impersonating', async () => {
    const storage = new FakeSessionStorage();
    saveDraft({ uid: 'U', card: savedCard({ title: 'Admin\'s own unsaved' }), baseRevision: 3 }, { storage, now: NOW - 1000 });
    const before = storage.calls();
    const t = await mount({ storage, impersonating: true });
    expect(t.draft().card.title).toBe('');
    expect(storage.calls()).toBe(before);
  });
});

describe('signing out', () => {
  it('goes read-only, drops the text from memory, and loads nothing', async () => {
    const t = await mount();
    await edit(t, 'title', 'Unsaved');
    t.auth.uid = null;
    t.hook.rerender({ uid: null, impersonating: false });
    await settle();
    expect(t.state()).toMatchObject({ load: 'blocked', blocked: 'signed-out' });
    expect(t.draft().card.title).toBe('');
  });

  it('does not write a draft back after sign-out has cleared them, even when the page closes afterwards', async () => {
    const t = await mount();
    await edit(t, 'title', 'Unsaved');
    await advance(DEBOUNCE);
    expect(t.storage.map.size).toBe(1);
    // Sign-out: the account is gone, and the app clears every My Card draft.
    t.auth.uid = null;
    clearAllMyCardDrafts({ storage: t.storage });
    expect(t.storage.map.size).toBe(0);
    // Now the page goes away, as it does when the shell leaves for the login screen.
    window.dispatchEvent(new Event('pagehide'));
    t.hook.unmount();
    await advance(DEBOUNCE * 4);
    expect(t.storage.map.size).toBe(0);
  });

  it('does not write a draft for an account that is no longer the signed-in one, from a timer already waiting', async () => {
    const t = await mount();
    await edit(t, 'title', 'Unsaved');
    t.auth.uid = null;
    await advance(DEBOUNCE * 2);
    expect(t.storage.map.size).toBe(0);
  });
});

describe('nothing is saved that was not asked for', () => {
  it('only a person\'s Save ever reaches the service: not a load, a restore, a switch, a timer or a close', async () => {
    const storage = new FakeSessionStorage();
    saveDraft({ uid: 'U', card: savedCard({ title: 'Recovered' }), baseRevision: 3 }, { storage, now: NOW - 1000 });
    const t = await mount({ storage });
    await edit(t, 'phone', '+1 555 010 2000');
    await advance(DEBOUNCE * 5);
    window.dispatchEvent(new Event('pagehide'));
    act(() => t.now().actions.discardRecovered());
    t.hook.rerender({ uid: 'U2', impersonating: false });
    await settle(); await settle();
    t.hook.unmount();
    expect(t.service.saveMyCard).not.toHaveBeenCalled();
  });
});

describe('an uploaded photo', () => {
  const photo = photoDataUrl(320, 36_000, { tag: 1 });
  const other = photoDataUrl(320, 24_000, { tag: 2 });
  const savedWithPhoto = (picture) => makeService({ loadMyCard: vi.fn(async () => okResult(3, { photoUrl: picture })) });
  const photoKeyOf = (uid = 'U') => `${DRAFT_PHOTO_KEY_PREFIX}${uid}`;
  const pageHide = () => window.dispatchEvent(new Event('pagehide'));
  const hasKeys = (storage) => [...storage.map.keys()].sort();

  it('is kept as part of the draft, apart from it, after the usual pause', async () => {
    const t = await mount();
    await edit(t, 'photoUrl', photo);
    expect(t.draft().dirty).toBe(true);
    expect(t.now().status).toBe('unsaved');
    expect(t.storage.map.size).toBe(0);
    await advance(DEBOUNCE);
    expect(hasKeys(t.storage)).toEqual([draftKey('U'), photoKeyOf()]);
    const kept = stored(t.storage);
    expect(kept.draft.card.photoUrl).toBe(photo);
    expect(kept.draft).toMatchObject({ baseRevision: 3, photoLost: false });
    expect(t.state().photoKept).toBe(true);
    expect(t.service.saveMyCard).not.toHaveBeenCalled();
  });

  it('survives a refresh, and leaving and coming back: restored exactly, with the notice, unsaved', async () => {
    const storage = new FakeSessionStorage();
    const first = await mount({ storage });
    await edit(first, 'photoUrl', photo);
    pageHide();
    first.hook.unmount();
    const second = await mount({ storage });
    expect(second.draft().card.photoUrl).toBe(photo);
    expect(second.draft().dirty).toBe(true);
    expect(second.state().recovered).toMatchObject({ baseRevision: 3 });
    expect(second.state().recovered.photoLost).toBeUndefined();
    expect(second.now().availability.enabled).toBe(true);
    expect(second.service.saveMyCard).not.toHaveBeenCalled();
  });

  it('is sent with a Save, as the card\'s photo, and the draft and its picture are forgotten once it is saved', async () => {
    const t = await mount();
    await edit(t, 'photoUrl', photo);
    await advance(DEBOUNCE);
    expect(hasKeys(t.storage)).toHaveLength(2);
    await act(async () => { await t.now().actions.save(); });
    expect(t.service.saveMyCard).toHaveBeenCalledTimes(1);
    expect(t.service.saveMyCard.mock.calls[0][0].photoUrl).toBe(photo);
    expect(t.service.saveMyCard.mock.calls[0][1]).toEqual({ expectedRevision: 3 });
    expect(t.state()).toMatchObject({ revision: 4, save: 'saved', photoKept: true });
    expect(t.draft().dirty).toBe(false);
    await advance(5000);
    expect(t.storage.map.size).toBe(0);
  });

  it('survives a save that fails: still in the form, still kept, and sent again on a retry', async () => {
    const service = makeService({
      saveMyCard: vi.fn()
        .mockResolvedValueOnce({ ...NOT_BODY })
        .mockImplementation(async (card, { expectedRevision }) => ({ status: 'saved', card: normalizeCard(card).card, revision: (expectedRevision ?? 0) + 1 })),
    });
    const t = await mount({ service });
    await edit(t, 'photoUrl', photo);
    await act(async () => { await t.now().actions.save(); });
    expect(t.state()).toMatchObject({ save: 'error' });
    expect(t.draft().card.photoUrl).toBe(photo);
    expect(t.draft().dirty).toBe(true);
    pageHide();
    expect(stored(t.storage).draft.card.photoUrl).toBe(photo);
    await act(async () => { await t.now().actions.save(); });
    expect(t.service.saveMyCard.mock.calls[1][0].photoUrl).toBe(photo);
    expect(t.state()).toMatchObject({ save: 'saved', revision: 4 });
  });

  describe('and a conflict', () => {
    const conflicting = () => makeService({
      saveMyCard: vi.fn()
        .mockResolvedValueOnce({ status: 'conflict', current: okResult(5, { photoUrl: other, title: 'Newer elsewhere' }) })
        .mockImplementation(async (card, { expectedRevision }) => ({ status: 'saved', card: normalizeCard(card).card, revision: (expectedRevision ?? 0) + 1 })),
    });
    async function inConflict() {
      const t = await mount({ service: conflicting() });
      await edit(t, 'photoUrl', photo);
      await act(async () => { await t.now().actions.save(); });
      return t;
    }

    it('keeps the photo edit, in the form and in the tab, and names the photo as one of the differences', async () => {
      const t = await inConflict();
      expect(t.state().conflict).toBeTruthy();
      expect(t.state().conflict.changes.map((c) => c.field)).toContain('photoUrl');
      expect(t.draft().card.photoUrl).toBe(photo);
      pageHide();
      expect(stored(t.storage).draft.card.photoUrl).toBe(photo);
      expect(hasKeys(t.storage)).toHaveLength(2);
    });

    it('sends the photo when the person chooses to save over the newer version, against the revision just seen', async () => {
      const t = await inConflict();
      act(() => t.now().actions.chooseConflict(CONFLICT_CHOICE.SAVE_OVER));
      await act(async () => { await t.now().actions.confirmSaveOver(); });
      expect(t.service.saveMyCard).toHaveBeenCalledTimes(2);
      expect(t.service.saveMyCard.mock.calls[1][0].photoUrl).toBe(photo);
      expect(t.service.saveMyCard.mock.calls[1][1]).toEqual({ expectedRevision: 5 });
      await advance(5000);
      expect(t.storage.map.size).toBe(0);
    });

    it('replaces the photo with the saved one, and forgets the kept picture, only when the person chooses to load the latest', async () => {
      const t = await inConflict();
      act(() => t.now().actions.chooseConflict(CONFLICT_CHOICE.LOAD_LATEST));
      expect(t.draft().card.photoUrl).toBe(photo);
      act(() => { t.now().actions.confirmLoadLatest(); });
      expect(t.draft().card.photoUrl).toBe(other);
      expect(t.draft().dirty).toBe(false);
      await advance(5000);
      expect(t.storage.map.size).toBe(0);
    });

    it('is restored with the conflict when it is found after another version was saved', async () => {
      const storage = new FakeSessionStorage();
      saveDraft({ uid: 'U', card: savedCard({ photoUrl: photo, title: 'Mine' }), baseRevision: 2 }, { storage, now: NOW - 60_000 });
      const t = await mount({ storage });
      expect(t.draft().card.photoUrl).toBe(photo);
      expect(t.state().conflict.changes.map((c) => c.field)).toContain('photoUrl');
      expect(t.state().recovered).not.toBeNull();
    });
  });

  it('can be replaced by another photo, a link, or nothing, and what is kept follows', async () => {
    const t = await mount({ service: savedWithPhoto(photo) });
    expect(t.draft().card.photoUrl).toBe(photo);
    expect(t.draft().dirty).toBe(false);

    await edit(t, 'photoUrl', other);
    await advance(DEBOUNCE);
    expect(stored(t.storage).draft.card.photoUrl).toBe(other);

    await edit(t, 'photoUrl', 'https://media.example.com/ada.jpg');
    await advance(DEBOUNCE);
    expect(hasKeys(t.storage)).toEqual([draftKey('U')]);
    expect(stored(t.storage).draft.card.photoUrl).toBe('https://media.example.com/ada.jpg');

    await edit(t, 'photoUrl', '');
    await advance(DEBOUNCE);
    expect(hasKeys(t.storage)).toEqual([draftKey('U')]);
    expect(stored(t.storage).draft.card.photoUrl).toBe('');
    expect(t.draft().dirty).toBe(true);

    // Back to what is saved: nothing to keep, and nothing is.
    await edit(t, 'photoUrl', photo);
    await advance(DEBOUNCE);
    expect(t.draft().dirty).toBe(false);
    expect(t.storage.map.size).toBe(0);
  });

  it('can be removed, saved as removed, and the next save is against the revision made', async () => {
    const t = await mount({ service: savedWithPhoto(photo) });
    await edit(t, 'photoUrl', '');
    await act(async () => { await t.now().actions.save(); });
    expect(t.service.saveMyCard.mock.calls[0][0].photoUrl).toBe('');
    expect(t.draft().card.photoUrl).toBe('');
    expect(t.state().revision).toBe(4);
  });

  it('says so, as it happens, when the tab will not keep it, and stops saying so once it is gone or kept', async () => {
    const storage = new FakeSessionStorage();
    const refuse = vi.spyOn(storage, 'setItem').mockImplementation((key, value) => {
      if (key.startsWith(DRAFT_PHOTO_KEY_PREFIX)) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
      storage.map.set(key, String(value));
    });
    const t = await mount({ storage });
    expect(t.state().photoKept).toBe(true);
    await edit(t, 'photoUrl', photo);
    await advance(DEBOUNCE);
    expect(t.state().photoKept).toBe(false);
    // The photo is still in the form: only the safety net is missing, and the draft is kept without it.
    expect(t.draft().card.photoUrl).toBe(photo);
    expect(stored(storage).draft).toMatchObject({ photoLost: true, card: { photoUrl: '' } });
    // Removing it, the warning goes.
    await edit(t, 'photoUrl', '');
    await edit(t, 'title', 'Director');
    await advance(DEBOUNCE);
    expect(t.state().photoKept).toBe(true);
    refuse.mockRestore();
  });

  it('says so too when there is no storage at all, and saves still work', async () => {
    const t = await mount({ storage: new FakeSessionStorage({ failOn: ['setItem'] }) });
    await edit(t, 'photoUrl', photo);
    await advance(DEBOUNCE);
    expect(t.state().photoKept).toBe(false);
    await act(async () => { await t.now().actions.save(); });
    expect(t.service.saveMyCard.mock.calls[0][0].photoUrl).toBe(photo);
    expect(t.state()).toMatchObject({ save: 'saved', photoKept: true });
  });

  it('is announced as not restored, never silently dropped, when its kept picture is gone', async () => {
    const storage = new FakeSessionStorage();
    const first = await mount({ storage });
    await edit(first, 'title', 'Director');
    await edit(first, 'photoUrl', photo);
    pageHide();
    first.hook.unmount();
    storage.removeItem(photoKeyOf());
    const second = await mount({ storage });
    expect(second.draft().card.title).toBe('Director');
    expect(second.draft().card.photoUrl).toBe('');
    expect(second.state().recovered).toMatchObject({ photoLost: true });
  });

  it('is announced as not restored even when it was the only thing in the draft', async () => {
    const storage = new FakeSessionStorage();
    saveDraft({ uid: 'U', card: savedCard({ photoUrl: photo }), baseRevision: 3 }, { storage, now: NOW - 60_000 });
    storage.removeItem(photoKeyOf());
    const t = await mount({ storage });
    expect(t.draft().card.photoUrl).toBe('');
    expect(t.draft().dirty).toBe(false);
    expect(t.state().recovered).toMatchObject({ photoLost: true });
  });

  it('forgets a draft with no photo trouble and nothing else different, silently, as before', async () => {
    const storage = new FakeSessionStorage();
    saveDraft({ uid: 'U', card: savedCard(), baseRevision: 3 }, { storage, now: NOW - 60_000 });
    const t = await mount({ storage });
    expect(t.state().recovered).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it('keeps each account\'s picture apart: the second account sees none, and the first\'s is forgotten when it opens', async () => {
    const storage = new FakeSessionStorage();
    saveDraft({ uid: 'A', card: savedCard({ photoUrl: photo }), baseRevision: 3 }, { storage, now: NOW - 60_000 });
    const t = await mount({ storage, uid: 'B' });
    expect(t.draft().card.photoUrl).toBe('');
    expect(t.state().recovered).toBeNull();
    expect(hasKeys(storage)).toEqual([]);
  });

  it('is forgotten with every draft at sign-out', async () => {
    const t = await mount();
    await edit(t, 'photoUrl', photo);
    await advance(DEBOUNCE);
    expect(hasKeys(t.storage)).toHaveLength(2);
    clearAllMyCardDrafts({ storage: t.storage });
    expect(t.storage.map.size).toBe(0);
  });

  it('is neither read nor kept, nor are the keys touched, while viewing as someone else', async () => {
    const storage = new FakeSessionStorage();
    saveDraft({ uid: 'U', card: savedCard({ photoUrl: photo }), baseRevision: 3 }, { storage, now: NOW - 60_000 });
    const before = [...storage.map.entries()];
    storage.log.length = 0;
    const t = await mount({ storage, impersonating: true });
    expect(t.state().load).toBe('blocked');
    expect(t.draft().card.photoUrl).toBe('');
    expect(storage.log).toEqual([]);
    expect([...storage.map.entries()]).toEqual(before);
  });

  it('never reaches the console: not when kept, restored, lost or saved', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    const storage = new FakeSessionStorage({ failOn: ['setItem'] });
    const t = await mount({ storage });
    await edit(t, 'photoUrl', photo);
    await advance(DEBOUNCE);
    await act(async () => { await t.now().actions.save(); });
    for (const spy of spies) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(fingerprintOf(photo));
    }
    spies.forEach((spy) => spy.mockRestore());
  });
});
