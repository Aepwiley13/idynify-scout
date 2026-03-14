/**
 * barryContextStore — Lightweight module-level Barry context store.
 *
 * Each module page calls setBarryContext() on mount with whatever is
 * relevant to that view (active contact, company, ICP section, etc.).
 * BarryTrigger reads from the store so the context prop is always populated.
 *
 * No external dependencies — plain JS pub/sub singleton.
 */

import { useState, useEffect } from 'react';

let _ctx = {};
const _listeners = new Set();

/** Called by module pages on mount to register the current view's context. */
export function setBarryContext(ctx) {
  _ctx = { ..._ctx, ...ctx };
  _listeners.forEach(fn => fn(_ctx));
}

/** Called by module pages on unmount to clear stale context. */
export function clearBarryContext() {
  _ctx = {};
  _listeners.forEach(fn => fn({}));
}

/** React hook — returns live context, re-renders on change. */
export function useBarryContext() {
  const [ctx, setCtx] = useState(_ctx);
  useEffect(() => {
    _listeners.add(setCtx);
    return () => _listeners.delete(setCtx);
  }, []);
  return ctx;
}
