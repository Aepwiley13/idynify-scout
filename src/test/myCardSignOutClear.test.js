/**
 * Clearing My Card's kept drafts when the account goes away: the wrapper
 * around the app's auth listener, with a fake listener and, for the last
 * group, the real clearing against a fake tab storage. (How App.jsx uses it is
 * its own, separate concern: this is the part that can be tested on its own.)
 */
import { describe, it, expect, vi } from 'vitest';
import { withMyCardDraftClear } from '../pages/ContactHub/myCard/state/clearDraftsOnSignOut';
import { clearAllMyCardDrafts, draftKey, readDraft, saveDraft } from '../pages/ContactHub/myCard/state/myCardDraftStorage';
import { newCard } from '../utils/myCardRules';
import { FakeSessionStorage } from './helpers/fakeSessionStorage';

/** A stand-in for onAuthStateChanged: tests push events through `emit`. */
function fakeAuth() {
  const listeners = new Set();
  const unsubscribe = vi.fn();
  const watch = vi.fn((callback) => { listeners.add(callback); return unsubscribe; });
  return { watch, emit: (user) => listeners.forEach((listener) => listener(user)), unsubscribe, listeners };
}

const signedIn = (uid) => ({ uid, email: `${uid}@example.com` });

describe('when it clears', () => {
  it('clears when there is no user: signed out, session ended, or never signed in', () => {
    const auth = fakeAuth();
    const clear = vi.fn();
    withMyCardDraftClear(auth.watch, { clear })(() => {});
    auth.emit(null);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('clears on a sign-out after being signed in', () => {
    const auth = fakeAuth();
    const clear = vi.fn();
    withMyCardDraftClear(auth.watch, { clear })(() => {});
    auth.emit(signedIn('A'));
    expect(clear).not.toHaveBeenCalled();
    auth.emit(null);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('clears when the account changes without a sign-out in between', () => {
    const auth = fakeAuth();
    const clear = vi.fn();
    withMyCardDraftClear(auth.watch, { clear })(() => {});
    auth.emit(signedIn('A'));
    auth.emit(signedIn('B'));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('does not clear for the first sign-in, or for a refresh that restores the same account', () => {
    const auth = fakeAuth();
    const clear = vi.fn();
    withMyCardDraftClear(auth.watch, { clear })(() => {});
    auth.emit(signedIn('A'));
    expect(clear).not.toHaveBeenCalled();
  });

  it('does not clear for more events about the same account', () => {
    const auth = fakeAuth();
    const clear = vi.fn();
    withMyCardDraftClear(auth.watch, { clear })(() => {});
    auth.emit(signedIn('A'));
    auth.emit({ ...signedIn('A'), displayName: 'Changed' });
    auth.emit(signedIn('A'));
    expect(clear).not.toHaveBeenCalled();
  });

  it('does not clear when signing in after a sign-out already did', () => {
    const auth = fakeAuth();
    const clear = vi.fn();
    withMyCardDraftClear(auth.watch, { clear })(() => {});
    auth.emit(signedIn('A'));
    auth.emit(null);
    auth.emit(signedIn('B'));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('clears each time the account goes away: A, out, A again, out', () => {
    const auth = fakeAuth();
    const clear = vi.fn();
    withMyCardDraftClear(auth.watch, { clear })(() => {});
    auth.emit(signedIn('A'));
    auth.emit(null);
    auth.emit(signedIn('A'));
    auth.emit(null);
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it('treats a user with no usable uid as no user', () => {
    for (const odd of [{}, { uid: '' }, { uid: 7 }, { uid: null }, undefined, false, 0, '']) {
      const auth = fakeAuth();
      const clear = vi.fn();
      withMyCardDraftClear(auth.watch, { clear })(() => {});
      auth.emit(odd);
      expect(clear, JSON.stringify(odd)).toHaveBeenCalledTimes(1);
    }
  });

  it('keeps each subscription\'s own memory of who was signed in', () => {
    const clear = vi.fn();
    const first = fakeAuth();
    const second = fakeAuth();
    withMyCardDraftClear(first.watch, { clear })(() => {});
    withMyCardDraftClear(second.watch, { clear })(() => {});
    first.emit(signedIn('A'));
    second.emit(signedIn('B'));
    expect(clear).not.toHaveBeenCalled();
  });
});

describe('what it leaves alone', () => {
  it('passes every event to the callback, unchanged and in order, after any clearing', () => {
    const auth = fakeAuth();
    const order = [];
    const callback = vi.fn((user) => order.push(`callback:${user?.uid ?? 'none'}`));
    withMyCardDraftClear(auth.watch, { clear: () => order.push('clear') })(callback);
    const a = signedIn('A');
    auth.emit(a);
    auth.emit(null);
    auth.emit(signedIn('B'));
    expect(callback.mock.calls.map(([user]) => user)).toEqual([a, null, expect.objectContaining({ uid: 'B' })]);
    expect(callback.mock.calls[0][0]).toBe(a);
    expect(order).toEqual(['callback:A', 'clear', 'callback:none', 'callback:B']);
  });

  it('returns what the watcher returns: the way to unsubscribe', () => {
    const auth = fakeAuth();
    const subscription = withMyCardDraftClear(auth.watch)(() => {});
    expect(subscription).toBe(auth.unsubscribe);
    subscription();
    expect(auth.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('subscribes once, with one listener of its own, and passes nothing else to the watcher', () => {
    const auth = fakeAuth();
    withMyCardDraftClear(auth.watch)(() => {});
    expect(auth.watch).toHaveBeenCalledTimes(1);
    expect(auth.watch.mock.calls[0]).toHaveLength(1);
    expect(auth.listeners.size).toBe(1);
  });

  it('never stops authentication, whatever clearing does', () => {
    const auth = fakeAuth();
    const callback = vi.fn();
    withMyCardDraftClear(auth.watch, { clear: () => { throw new Error('storage refused'); } })(callback);
    expect(() => auth.emit(null)).not.toThrow();
    expect(callback).toHaveBeenCalledWith(null);
  });
});

describe('with the real clearing, against a tab\'s storage', () => {
  const keep = (storage, uid, title) => saveDraft({ uid, card: { ...newCard(), firstName: 'Ada', title }, baseRevision: 3 }, { storage, now: 1_800_000_000_000 });

  it('on sign-out, every account\'s draft is gone, and nothing else in the tab is touched', () => {
    const storage = new FakeSessionStorage();
    keep(storage, 'A', 'A\'s unsaved');
    keep(storage, 'B', 'B\'s unsaved');
    storage.setItem('idynify_theme', 'mission');
    storage.setItem('barry_mission_visited', 'true');
    const auth = fakeAuth();
    withMyCardDraftClear(auth.watch, { clear: () => clearAllMyCardDrafts({ storage }) })(() => {});
    auth.emit(signedIn('A'));
    expect(storage.map.has(draftKey('A'))).toBe(true);
    auth.emit(null);
    expect([...storage.map.keys()].sort()).toEqual(['barry_mission_visited', 'idynify_theme']);
  });

  it('cannot expose one account\'s draft to the next: after A signs out and B signs in, B finds none of A\'s', () => {
    const storage = new FakeSessionStorage();
    keep(storage, 'A', 'A\'s private unsaved');
    const auth = fakeAuth();
    withMyCardDraftClear(auth.watch, { clear: () => clearAllMyCardDrafts({ storage }) })(() => {});
    auth.emit(signedIn('A'));
    auth.emit(null);
    auth.emit(signedIn('B'));
    expect(readDraft('A', { storage, now: 1_800_000_000_000 })).toEqual({ status: 'none' });
    expect(readDraft('B', { storage, now: 1_800_000_000_000 })).toEqual({ status: 'none' });
    expect(storage.map.size).toBe(0);
  });

  it('when one account replaces another with no sign-out between, the first one\'s draft is still cleared', () => {
    const storage = new FakeSessionStorage();
    keep(storage, 'A', 'A\'s private unsaved');
    const auth = fakeAuth();
    withMyCardDraftClear(auth.watch, { clear: () => clearAllMyCardDrafts({ storage }) })(() => {});
    auth.emit(signedIn('A'));
    auth.emit(signedIn('B'));
    expect(storage.map.size).toBe(0);
  });

  it('a refresh that restores the same account keeps its draft', () => {
    const storage = new FakeSessionStorage();
    keep(storage, 'A', 'A\'s unsaved');
    const auth = fakeAuth();
    withMyCardDraftClear(auth.watch, { clear: () => clearAllMyCardDrafts({ storage }) })(() => {});
    auth.emit(signedIn('A'));
    expect(readDraft('A', { storage, now: 1_800_000_000_000 }).status).toBe('ok');
  });

  it('survives a storage that refuses everything', () => {
    const storage = new FakeSessionStorage({ failOn: ['length', 'key', 'removeItem'] });
    const auth = fakeAuth();
    const callback = vi.fn();
    withMyCardDraftClear(auth.watch, { clear: () => clearAllMyCardDrafts({ storage }) })(callback);
    expect(() => auth.emit(null)).not.toThrow();
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
