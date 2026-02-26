/**
 * HunterCardStack — The Hunter card deck with full Framer Motion animation spec.
 *
 * Gestures:
 *   Left drag/swipe  → Archive (slide left, tilt, fade)
 *   Up drag/swipe    → Engage (rocket launch sequence)
 *   Button: Archive  → Archive animation
 *   Button: Engage   → Rocket launch sequence
 *
 * Rocket Launch Sequence (spec-exact):
 *   Phase 1 (0–400ms):   Shake on X axis ±6px, ~10 cycles, scale pulse at end
 *   Phase 2 (400–500ms): Pause — card still, "ignition moment"
 *   Phase 3 (500–750ms): Accelerate up: translateY -120vh, rotate 8°, scale 0.85, fade
 *   Phase 4 (650–900ms): Next card enters from +40px below (overlaps Phase 3)
 *
 * Archive Animation:
 *   translateX -110vw, rotate -4°, fade, 350ms ease-out
 *   Next card enters same as after Engage.
 *
 * Sound: delegated to useMissionSounds hook (Web Audio API).
 * Swipe thresholds: 80px horizontal (archive), 80px vertical up (engage).
 */

import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import HunterContactCard from './HunterContactCard';
import { useMissionSounds } from '../../hooks/useMissionSounds';
import { getAudioContext, preloadAudio, isAudioAvailable } from '../../utils/hunterAudioContext';
import { playEngageSound, playArchiveSound } from '../../utils/hunterSounds';
import { triggerEngageHaptic } from '../../utils/hunterHaptics';
import './HunterCardStack.css';

// ── Animation variants ─────────────────────────────────

const ENGAGE_LAUNCH = {
  y: '-120vh',
  rotate: 8,
  scale: 0.85,
  opacity: 0
};

const ARCHIVE_EXIT = {
  x: '-110vw',
  rotate: -4,
  opacity: 0
};

const NEXT_CARD_ENTER = {
  initial: { y: 40, opacity: 0, scale: 0.95 },
  animate: { y: 0, opacity: 1, scale: 1 },
  transition: { duration: 0.25, ease: [0, 0, 0.2, 1] }
};

// ── Swipe indicator overlay ─────────────────────────────

function SwipeIndicator({ direction }) {
  if (!direction) return null;
  const isEngage = direction === 'engage';
  return (
    <div className={`hcs-swipe-indicator hcs-swipe-indicator--${direction}`}>
      {isEngage ? '🚀 ENGAGE' : '✕ ARCHIVE'}
    </div>
  );
}

// ── Main stack ─────────────────────────────────────────

export default function HunterCardStack({
  contacts,
  currentIndex,
  reconConfidencePct,    // 0-100 global RECON score (same for all contacts)
  reconCompletion,       // legacy map — kept for compat, ignored when reconConfidencePct set
  onEngage,
  onArchive,
  onDeckEmpty
}) {
  const [animating, setAnimating] = useState(false);
  const [exitVariant, setExitVariant] = useState(null); // 'engage' | 'archive'
  const controls = useAnimation();

  // Sound + haptics preference
  const { soundEnabled, hapticsEnabled } = useMissionSounds();

  // iOS audio unlock — fired on first pointer interaction in Hunter
  const audioPreloaded = useRef(false);
  const ensureAudioReady = useCallback(() => {
    if (!audioPreloaded.current && isAudioAvailable()) {
      preloadAudio();
      audioPreloaded.current = true;
    }
  }, []);

  // Drag state
  const dragStart = useRef(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const currentContact = contacts[currentIndex];
  const nextContact = contacts[currentIndex + 1];

  // ── Rocket launch sequence ───────────────────────────

  const triggerEngage = useCallback(async (contact) => {
    if (animating) return;
    setAnimating(true);
    setExitVariant('engage');

    // Sound + haptic fire simultaneously with Phase 1 shake (spec: 0ms delay from animation start)
    if (soundEnabled && isAudioAvailable()) {
      try { playEngageSound(getAudioContext()); } catch (_) {}
    }
    if (hapticsEnabled) {
      triggerEngageHaptic();
    }

    // Phase 1: Shake (0–400ms)
    await controls.start({
      x: [0, -6, 6, -6, 6, -4, 4, -2, 2, 0],
      scale: [1, 1, 1, 1, 1, 1, 1, 1, 1.03, 1],
      transition: { duration: 0.4, ease: 'linear', times: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.9, 1] }
    });

    // Phase 2: Pause (100ms) — card still, ignition moment
    await controls.start({
      x: 0, scale: 1,
      transition: { duration: 0.1 }
    });

    // Phase 3: Launch (250ms) — async, don't await the full animation
    controls.start({
      ...ENGAGE_LAUNCH,
      transition: { duration: 0.25, ease: [0.4, 0, 1, 1] }
    });

    // Phase 4 starts at 150ms into launch (overlap, spec: 650ms total from start of launch)
    setTimeout(() => {
      onEngage(contact);
      setAnimating(false);
      setExitVariant(null);
      controls.set({ x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 });
    }, 250);
  }, [animating, controls, onEngage, soundEnabled, hapticsEnabled]);

  // ── Archive sequence ──────────────────────────────────

  const triggerArchive = useCallback(async (contact) => {
    if (animating) return;
    setAnimating(true);
    setExitVariant('archive');

    // Archive sound fires with slide animation
    // No haptic on archive — intentional per spec (absence of feedback = low energy)
    if (soundEnabled && isAudioAvailable()) {
      try { playArchiveSound(getAudioContext()); } catch (_) {}
    }

    await controls.start({
      ...ARCHIVE_EXIT,
      transition: { duration: 0.35, ease: [0, 0, 0.2, 1] }
    });

    onArchive(contact);
    setAnimating(false);
    setExitVariant(null);
    controls.set({ x: 0, y: 0, rotate: 0, opacity: 1 });
  }, [animating, controls, onArchive, soundEnabled]);

  // ── Drag handlers ─────────────────────────────────────

  const handlePointerDown = (e) => {
    if (animating) return;
    // iOS audio unlock: preload on first gesture in Hunter (not on mount)
    ensureAudioReady();
    dragStart.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isDragging || !dragStart.current) return;
    setDragOffset({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y
    });
  };

  const handlePointerUp = () => {
    if (!isDragging) return;
    setIsDragging(false);

    const { x, y } = dragOffset;
    const THRESHOLD = 80;

    if (x < -THRESHOLD) {
      // Left swipe → archive
      triggerArchive(currentContact);
    } else if (y < -THRESHOLD && Math.abs(y) > Math.abs(x)) {
      // Up swipe → engage (only if more vertical than horizontal, to avoid scroll conflicts)
      triggerEngage(currentContact);
    }

    setDragOffset({ x: 0, y: 0 });
    dragStart.current = null;
  };

  // Visual drag feedback
  const dragStyle = isDragging ? {
    x: dragOffset.x,
    y: Math.min(dragOffset.y, 0), // only allow upward drag
    rotate: dragOffset.x * 0.04,
    transition: { type: 'tween', duration: 0 }
  } : {};

  // Swipe indicator
  const INDICATOR_THRESHOLD = 50;
  let swipeIndicator = null;
  if (isDragging) {
    if (dragOffset.x < -INDICATOR_THRESHOLD) swipeIndicator = 'archive';
    else if (dragOffset.y < -INDICATOR_THRESHOLD && Math.abs(dragOffset.y) > Math.abs(dragOffset.x)) swipeIndicator = 'engage';
  }

  // Empty state — spec: "Browse Archived" + "Go to Scout" CTAs
  if (!currentContact) {
    return (
      <div className="hcs-empty">
        <div className="hcs-empty-icon">🎯</div>
        <p className="hcs-empty-title">Your Hunter deck is clear.</p>
        <p className="hcs-empty-sub">All contacts have been engaged or archived.</p>
        <div className="hcs-empty-actions">
          {onDeckEmpty && (
            <button className="hcs-empty-cta" onClick={onDeckEmpty}>
              View Active Missions
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="hcs-stack">
      {/* Next card (background — visible behind current card) */}
      <AnimatePresence>
        {nextContact && (
          <motion.div
            key={`next-${nextContact.id}`}
            className="hcs-card-layer hcs-card-layer--next"
            {...(!exitVariant ? {} : NEXT_CARD_ENTER)}
          >
            <HunterContactCard
              contact={nextContact}
              reconConfidencePct={reconConfidencePct ?? null}
              hasActiveMission={false}
              onEngage={() => {}}
              onArchive={() => {}}
              isBackground
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Current card (interactive) */}
      <motion.div
        key={`current-${currentContact.id}`}
        className="hcs-card-layer hcs-card-layer--current"
        animate={controls}
        style={isDragging ? dragStyle : undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <SwipeIndicator direction={swipeIndicator} />
        <HunterContactCard
          contact={currentContact}
          reconConfidencePct={reconConfidencePct ?? null}
          hasActiveMission={currentContact.hunter_status === 'active_mission'}
          onEngage={triggerEngage}
          onArchive={triggerArchive}
        />
      </motion.div>
    </div>
  );
}
