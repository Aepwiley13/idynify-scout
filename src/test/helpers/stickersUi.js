/**
 * Shared fakes for the sticker UI tests (S5–S7).
 *
 * The services are replaced at the module boundary with plain delegating
 * functions (not vi.fn with a rejecting implementation, which Vitest 4
 * reports as a failure even when the code under test catches it). Each fake
 * records its calls in `calls`.
 */
export const sid = (name) => `S${name.replace(/[^A-Za-z0-9]/g, '')}`.padEnd(20, '0').slice(0, 20);

export const sticker = (name, extra = {}) => ({
  id: sid(name), name, color: 'teal', emoji: null, description: null, status: 'active', ...extra,
});

export const config = (body = { enabled: true, mode: 'beta', readOnly: false }) => ({ status: 200, body });

/** A controllable sticker backend for one test. */
export function createFakeStickers() {
  const state = {
    calls: [],
    registry: [],
    config: config(),
    subscriptions: 0,
    unsubscribed: 0,
    listeners: new Set(),
    configFetches: 0,
    impl: {
      add: async () => ({ status: 'added' }),
      remove: async () => ({ status: 'removed' }),
      create: async (_uid, { name }) => ({ id: sid(name) }),
      update: async () => {},
      archive: async () => {},
      restore: async () => {},
      bulk: async (_uid, ids) => ({ added: ids, already: [], failed: [] }),
    },
  };
  const record = (name, args) => state.calls.push([name, ...args]);
  const services = {
    fetchStickersConfig: async () => { state.configFetches += 1; return state.config; },
    subscribeStickers: (uid, onNext, onError) => {
      state.subscriptions += 1;
      const listener = { onNext, onError };
      state.listeners.add(listener);
      Promise.resolve().then(() => { if (state.listeners.has(listener)) onNext(state.registry); });
      return () => { state.unsubscribed += 1; state.listeners.delete(listener); };
    },
    addSticker: (...args) => { record('addSticker', args); return state.impl.add(...args); },
    removeSticker: (...args) => { record('removeSticker', args); return state.impl.remove(...args); },
    addStickerToContacts: (...args) => { record('addStickerToContacts', args); return state.impl.bulk(...args); },
    // Like onSnapshot with a local write: a created sticker reaches open listeners at once.
    createSticker: async (...args) => {
      record('createSticker', args);
      const created = await state.impl.create(...args);
      const [, { name, color = 'gray', emoji = null, description = null } = {}] = args;
      const next = [...state.registry, { id: created.id, name, color, emoji, description, status: 'active' }];
      state.registry = next;
      for (const l of state.listeners) l.onNext(next);
      return created;
    },
    updateSticker: (...args) => { record('updateSticker', args); return state.impl.update(...args); },
    archiveSticker: (...args) => { record('archiveSticker', args); return state.impl.archive(...args); },
    restoreSticker: (...args) => { record('restoreSticker', args); return state.impl.restore(...args); },
  };
  /** Push a new registry to every live subscription, as onSnapshot would. */
  const publish = (registry) => {
    state.registry = registry;
    for (const l of state.listeners) l.onNext(registry);
  };
  const callsOf = (name) => state.calls.filter(([n]) => n === name).map(([, ...args]) => args);
  return { state, services, publish, callsOf };
}

/** A StickerError-shaped rejection. */
export const stickerError = (code, reason = null) => Object.assign(new Error(code), { name: 'StickerError', code, reason });
