/**
 * HUNTER AUDIO CONTEXT — Singleton Web Audio API context.
 *
 * One shared AudioContext for the entire Hunter session.
 * Never create a new one per sound — browsers have a per-page limit.
 *
 * iOS Safari critical path:
 *   AudioContext is suspended until a user gesture occurs.
 *   Call preloadAudio() on the first tap anywhere in Hunter (not on mount).
 *   The first card tap is fine — do not try to call this on component mount.
 */

let audioContext = null;

/**
 * getAudioContext — Returns the shared AudioContext, creating it if needed.
 * Resumes automatically if the browser suspended it (common on first load).
 */
export function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume if suspended (browsers suspend on load until user gesture)
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

/**
 * preloadAudio — Warms up the AudioContext so the first real sound has zero delay.
 * Also unlocks audio on iOS Safari by playing a silent 1-sample buffer.
 *
 * Call on the first tap/click in Hunter — not on mount.
 * Safe to call multiple times (no-op after first call warms the context).
 */
export function preloadAudio() {
  try {
    const ctx = getAudioContext();
    // Play a silent buffer to unlock audio on iOS
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch (err) {
    // Non-fatal — Web Audio API may not be available in all environments
    console.warn('[Hunter] Audio preload failed (non-fatal):', err.message);
  }
}

/**
 * isAudioAvailable — Returns true if Web Audio API is supported.
 * Used to guard sound calls without try/catch at every call site.
 */
export function isAudioAvailable() {
  return typeof window !== 'undefined' &&
    !!(window.AudioContext || window.webkitAudioContext);
}
