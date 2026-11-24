/* global process */
/**
 * How App.jsx uses the My Card sign-out clearing, tested against App.jsx
 * itself. Nothing here renders App (that would mean mocking every page in the
 * product). Instead the one line App.jsx declares is read out of the file and
 * RUN, against a fake auth listener and a tab's real sessionStorage: if the
 * wrapper is removed or changed, this fails.
 *
 * The wrapper's own behaviour (every case of who signs in and out) is in
 * myCardSignOutClear.test.js.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withMyCardDraftClear } from '../pages/ContactHub/myCard/state/clearDraftsOnSignOut';
import { draftKey, readDraft, saveDraft } from '../pages/ContactHub/myCard/state/myCardDraftStorage';
import { newCard } from '../utils/myCardRules';

const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8');
const NOW = 1_800_000_000_000;

/** The statement App.jsx declares, exactly as written, up to its closing semicolon. */
const declaration = app.match(/^const watchSignIn = [^;]*;$/m)?.[0];

/** A stand-in for firebase/auth's onAuthStateChanged: events are pushed through `emit`. */
function fakeFirebaseAuth() {
  const listeners = [];
  const onAuthStateChanged = vi.fn((auth, callback) => { listeners.push(callback); return () => {}; });
  return { onAuthStateChanged, emit: (user) => listeners.forEach((listener) => listener(user)), listeners };
}

/** Runs App.jsx's own declaration with fakes for what it refers to. */
function realWatchSignIn(firebase) {
  return new Function('onAuthStateChanged', 'auth', 'withMyCardDraftClear', `${declaration}\nreturn watchSignIn;`)(
    firebase.onAuthStateChanged, { fake: 'auth' }, withMyCardDraftClear,
  );
}

const keep = (uid, title) => saveDraft({ uid, card: { ...newCard(), firstName: 'Ada', title }, baseRevision: 3 }, { now: NOW });

beforeEach(() => { globalThis.sessionStorage.clear(); });

describe('what App.jsx declares', () => {
  it('has the one declaration, and it wraps the real listener with the My Card clearing', () => {
    expect(declaration).toBeDefined();
    expect(declaration).toBe('const watchSignIn = withMyCardDraftClear((callback) => onAuthStateChanged(auth, callback));');
  });

  it('imports the wrapper from My Card\'s state folder, and nothing else of My Card', () => {
    expect(app).toMatch(/^import \{ withMyCardDraftClear \} from '\.\/pages\/ContactHub\/myCard\/state\/clearDraftsOnSignOut';$/m);
    const imports = app.split('\n').filter((line) => /^import .*myCard/i.test(line));
    expect(imports).toHaveLength(1);
  });

  it('still hands the account hook this same listener, and listens to auth in no other place', () => {
    expect(app).toMatch(/onAuthChange: watchSignIn,/);
    expect(app.match(/onAuthStateChanged\(/g)).toHaveLength(1);
    // (The other mention of the name is its import.)
    expect(app.match(/\bonAuthStateChanged\b/g)).toHaveLength(2);
  });

  it('does not change how signing out is done: the same handler, the same call', () => {
    expect(app).toMatch(/const handleSignOut = useCallback\(\(\) => \{\s*signOut\(auth\)\.catch\(\(error\) => console\.error\('\[account\] Sign out failed:', error\)\);\s*\}, \[\]\);/);
  });
});

describe('what App.jsx\'s own line does, run for real', () => {
  it('subscribes once through the real firebase listener, with the auth object, and passes the callback through', () => {
    const firebase = fakeFirebaseAuth();
    const callback = vi.fn();
    realWatchSignIn(firebase)(callback);
    expect(firebase.onAuthStateChanged).toHaveBeenCalledTimes(1);
    expect(firebase.onAuthStateChanged.mock.calls[0][0]).toEqual({ fake: 'auth' });
    const user = { uid: 'A', email: 'a@example.com' };
    firebase.emit(user);
    expect(callback).toHaveBeenCalledWith(user);
  });

  it('on sign-out, clears every My Card draft in the tab, whoever\'s, and leaves the rest', () => {
    keep('A', 'A\'s unsaved');
    keep('B', 'B\'s unsaved');
    globalThis.sessionStorage.setItem('idynify_theme', 'mission');
    const firebase = fakeFirebaseAuth();
    const callback = vi.fn();
    realWatchSignIn(firebase)(callback);
    firebase.emit({ uid: 'A' });
    expect(globalThis.sessionStorage.getItem(draftKey('A'))).not.toBeNull();
    firebase.emit(null);
    expect(globalThis.sessionStorage.getItem(draftKey('A'))).toBeNull();
    expect(globalThis.sessionStorage.getItem(draftKey('B'))).toBeNull();
    expect(globalThis.sessionStorage.getItem('idynify_theme')).toBe('mission');
    // And the app was told of the sign-out as it always was.
    expect(callback).toHaveBeenLastCalledWith(null);
  });

  it('cannot expose a draft to the next account: B finds nothing of A\'s after A signs out', () => {
    keep('A', 'A\'s private unsaved');
    const firebase = fakeFirebaseAuth();
    realWatchSignIn(firebase)(() => {});
    firebase.emit({ uid: 'A' });
    firebase.emit(null);
    firebase.emit({ uid: 'B' });
    expect(readDraft('A', { now: NOW })).toEqual({ status: 'none' });
    expect(readDraft('B', { now: NOW })).toEqual({ status: 'none' });
    expect(globalThis.sessionStorage.length).toBe(0);
  });

  it('clears when one account replaces another with no sign-out between', () => {
    keep('A', 'A\'s private unsaved');
    const firebase = fakeFirebaseAuth();
    realWatchSignIn(firebase)(() => {});
    firebase.emit({ uid: 'A' });
    firebase.emit({ uid: 'B' });
    expect(globalThis.sessionStorage.length).toBe(0);
  });

  it('keeps a draft across a refresh, which restores the same account', () => {
    keep('A', 'A\'s unsaved');
    const firebase = fakeFirebaseAuth();
    realWatchSignIn(firebase)(() => {});
    firebase.emit({ uid: 'A' });
    expect(readDraft('A', { now: NOW }).status).toBe('ok');
  });

  it('clears when the app starts with nobody signed in, so nothing lingers from a session that ended', () => {
    keep('A', 'left behind');
    const firebase = fakeFirebaseAuth();
    realWatchSignIn(firebase)(() => {});
    firebase.emit(null);
    expect(globalThis.sessionStorage.length).toBe(0);
  });

  it('works when My Card was never opened: there is simply nothing to clear', () => {
    const firebase = fakeFirebaseAuth();
    const callback = vi.fn();
    realWatchSignIn(firebase)(callback);
    expect(() => firebase.emit(null)).not.toThrow();
    expect(callback).toHaveBeenCalledWith(null);
  });
});
