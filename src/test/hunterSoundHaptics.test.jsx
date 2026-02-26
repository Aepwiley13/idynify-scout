/**
 * HUNTER SOUND & HAPTICS — QA Unit Tests (Sprint 2)
 *
 * Tests the pure logic and guard conditions.
 * Actual audio synthesis (Web Audio API) and haptics (Vibration API)
 * are browser APIs — those are in the manual QA checklist.
 *
 * What we can and should unit-test:
 *   1. hunterAudioContext: isAudioAvailable() reflects window state
 *   2. hunterAudioContext: preloadAudio() is safe to call when AudioContext unavailable
 *   3. hunterHaptics: triggerEngageHaptic() calls navigator.vibrate(50)
 *   4. hunterHaptics: triggerEngageHaptic() is silent when vibrate unavailable
 *   5. hunterHaptics: isHapticsAvailable() reflects navigator state
 *   6. hunterHaptics: NO archive haptic function exists (confirmed absent)
 *   7. hunterHaptics: engage haptic is exactly 50ms (not a pattern, not >100ms)
 *   8. UserSettings: renders "Mission sounds" label (exact spec wording)
 *   9. UserSettings: toggle renders with role="switch"
 *  10. UserSettings: toggle is ON by default
 *  11. UserSettings: clicking toggle changes aria-checked state
 *  12. UserSettings: does NOT use the label "Sound effects"
 *
 * Sprint 2 QA notes on what's manual:
 *   - Engage sound fires simultaneously with Phase 1 shake
 *   - Engage character: low thump + whoosh, not cartoonish
 *   - Archive sound noticeably quieter than engage
 *   - iOS unlock: no delay after first tap
 *   - No audio overlap on rapid engage (5 cards fast)
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Static imports for pure-logic utilities (functions read window/navigator at call time)
import { isAudioAvailable, preloadAudio } from '../utils/hunterAudioContext';
import { triggerEngageHaptic, isHapticsAvailable } from '../utils/hunterHaptics';

// ── Top-level mocks (Vitest hoists these before imports) ──────────────────────

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'test-uid', getIdToken: vi.fn().mockResolvedValue('tok') } },
  db: {}
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
  updateDoc: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => vi.fn() };
});

// ── hunterAudioContext ──────────────────────────────────────────────────────

describe('hunterAudioContext — availability and singleton', () => {

  // Capture the original window audio properties so we can restore them
  const originalAudioContext = window.AudioContext;
  const originalWebkitAudioContext = window.webkitAudioContext;

  afterEach(() => {
    // Restore window state after each test
    if (originalAudioContext) {
      window.AudioContext = originalAudioContext;
    } else {
      delete window.AudioContext;
    }
    if (originalWebkitAudioContext) {
      window.webkitAudioContext = originalWebkitAudioContext;
    } else {
      delete window.webkitAudioContext;
    }
  });

  it('isAudioAvailable() returns false when AudioContext is not in window', () => {
    delete window.AudioContext;
    delete window.webkitAudioContext;
    expect(isAudioAvailable()).toBe(false);
  });

  it('isAudioAvailable() returns true when AudioContext is in window', () => {
    // jsdom doesn't have AudioContext — mock it for this test
    window.AudioContext = function () {
      return {
        state: 'running',
        currentTime: 0,
        sampleRate: 44100,
        destination: {},
        createOscillator: vi.fn(() => ({
          type: '',
          frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(), start: vi.fn(), stop: vi.fn()
        })),
        createGain: vi.fn(() => ({
          gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn()
        })),
        createBuffer: vi.fn(() => ({ getChannelData: vi.fn(() => new Float32Array(100)) })),
        createBufferSource: vi.fn(() => ({ buffer: null, connect: vi.fn(), start: vi.fn() })),
        createBiquadFilter: vi.fn(() => ({
          type: '', frequency: { setValueAtTime: vi.fn() }, Q: { value: 0 }, connect: vi.fn()
        })),
        resume: vi.fn()
      };
    };
    expect(isAudioAvailable()).toBe(true);
  });

  it('preloadAudio() does not throw when AudioContext is unavailable', () => {
    delete window.AudioContext;
    delete window.webkitAudioContext;
    // preloadAudio() has an internal try/catch — must not propagate
    expect(() => preloadAudio()).not.toThrow();
  });
});

// ── hunterHaptics ─────────────────────────────────────────────────────────

describe('hunterHaptics — vibration spec', () => {

  afterEach(() => vi.unstubAllGlobals());

  it('triggerEngageHaptic() calls navigator.vibrate(50) — single firm 50ms pulse', () => {
    const vibrateSpy = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, vibrate: vibrateSpy });

    triggerEngageHaptic();

    expect(vibrateSpy).toHaveBeenCalledWith(50);
    expect(vibrateSpy).toHaveBeenCalledTimes(1);
  });

  it('triggerEngageHaptic() does not throw when navigator.vibrate is unavailable (desktop)', () => {
    vi.stubGlobal('navigator', { ...navigator, vibrate: undefined });
    expect(() => triggerEngageHaptic()).not.toThrow();
  });

  it('isHapticsAvailable() returns true when navigator.vibrate exists', () => {
    vi.stubGlobal('navigator', { ...navigator, vibrate: vi.fn() });
    expect(isHapticsAvailable()).toBe(true);
  });

  it('isHapticsAvailable() returns false when navigator.vibrate is absent', () => {
    // Replace navigator with a plain object that has no vibrate property
    vi.stubGlobal('navigator', { userAgent: navigator.userAgent });
    expect(isHapticsAvailable()).toBe(false);
  });

  it('ARCHIVE has no haptic function — absence confirmed', async () => {
    // The spec is explicit: no haptic on archive.
    // This test confirms there is no triggerArchiveHaptic export.
    const haptics = await import('../utils/hunterHaptics');
    expect(haptics.triggerArchiveHaptic).toBeUndefined();
  });

  it('engage haptic is 50ms, not a buzz (not >100ms, not a pattern)', () => {
    const vibrateSpy = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, vibrate: vibrateSpy });

    triggerEngageHaptic();

    const callArg = vibrateSpy.mock.calls[0][0];
    // Must be a single number (not an array pattern, not >100ms)
    expect(typeof callArg).toBe('number');
    expect(callArg).toBeLessThanOrEqual(100);
    expect(callArg).toBeGreaterThan(0);
  });
});

// ── UserSettings toggle ───────────────────────────────────────────────────

describe('UserSettings — Mission sounds toggle', () => {

  it('renders the Mission sounds label (exact spec wording)', async () => {
    const UserSettings = (await import('../pages/UserSettings')).default;
    render(<UserSettings />);
    expect(screen.getByText('Mission sounds')).toBeInTheDocument();
  });

  it('renders a toggle switch with role="switch"', async () => {
    const UserSettings = (await import('../pages/UserSettings?v=2')).default;
    render(<UserSettings />);
    expect(screen.getByRole('switch', { name: /mission sounds/i })).toBeInTheDocument();
  });

  it('toggle is ON by default', async () => {
    const UserSettings = (await import('../pages/UserSettings?v=3')).default;
    render(<UserSettings />);
    const toggle = screen.getByRole('switch', { name: /mission sounds/i });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('clicking toggle changes aria-checked state', async () => {
    const UserSettings = (await import('../pages/UserSettings?v=4')).default;
    render(<UserSettings />);
    const toggle = screen.getByRole('switch', { name: /mission sounds/i });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('does NOT use the label "Sound effects" — spec requires "Mission sounds"', async () => {
    const UserSettings = (await import('../pages/UserSettings?v=5')).default;
    render(<UserSettings />);
    expect(screen.queryByText('Sound effects')).not.toBeInTheDocument();
    expect(screen.getByText('Mission sounds')).toBeInTheDocument();
  });
});
