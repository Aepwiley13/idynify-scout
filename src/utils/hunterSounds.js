/**
 * HUNTER SOUNDS — Synthesized audio via Web Audio API.
 *
 * No audio files. No loading time. No hosting cost.
 * One function per sound, fully portable.
 *
 * Two sounds, intentionally contrasted:
 *   Engage: confident rocket burst — low thump + filtered noise sweep
 *   Archive: barely audible air dismiss — high-pass noise, ~12% of engage volume
 *
 * Both use the shared AudioContext from hunterAudioContext.js.
 * Never create AudioContext inside these functions.
 */

/**
 * playEngageSound — "Rocket Burst"
 * Layer 1: Low frequency thump (the thrust) — sine 80→40Hz, 400ms
 * Layer 2: Mid whoosh (the movement) — bandpass filtered noise, 500ms
 * Character: confident, not cartoonish. Satisfying at 30% device volume.
 *
 * @param {AudioContext} audioContext
 */
export function playEngageSound(audioContext) {
  const now = audioContext.currentTime;

  // Layer 1 — Low frequency thump (the "thrust")
  const osc1 = audioContext.createOscillator();
  const gain1 = audioContext.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(80, now);
  osc1.frequency.exponentialRampToValueAtTime(40, now + 0.3);
  gain1.gain.setValueAtTime(0.6, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  osc1.connect(gain1);
  gain1.connect(audioContext.destination);
  osc1.start(now);
  osc1.stop(now + 0.4);

  // Layer 2 — Mid whoosh (the "movement")
  const bufferSize = audioContext.sampleRate * 0.5;
  const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
  }
  const noise = audioContext.createBufferSource();
  const noiseGain = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(400, now);
  filter.frequency.exponentialRampToValueAtTime(200, now + 0.5);
  filter.Q.value = 0.8;
  noise.buffer = buffer;
  noiseGain.gain.setValueAtTime(0.3, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(audioContext.destination);
  noise.start(now);
}

/**
 * playArchiveSound — "Air Dismiss"
 * High-pass filtered noise — barely audible, 250ms.
 * Gain: 0.08 (contrast with engage's 0.6 on Layer 1).
 * Character: air moving, nothing more. The quiet is the point.
 *
 * @param {AudioContext} audioContext
 */
export function playArchiveSound(audioContext) {
  const now = audioContext.currentTime;

  const bufferSize = audioContext.sampleRate * 0.25;
  const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 3);
  }
  const noise = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 2000;
  noise.buffer = buffer;
  gain.gain.setValueAtTime(0.08, now); // Very quiet — contrast with engage
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(audioContext.destination);
  noise.start(now);
}
