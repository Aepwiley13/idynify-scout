/**
 * Shared state between the stubs and capture.mjs, kept on globalThis because
 * the CommonJS stubs and the ESM stubs are separate module instances.
 */
export function captureState() {
  globalThis.__sonnetCompare ??= { docs: new Map(), requests: [] };
  return globalThis.__sonnetCompare;
}
