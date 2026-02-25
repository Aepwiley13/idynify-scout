/**
 * AttentionCarousel — Horizontal row of action cards fed by recommendations[].
 *
 * Reads the same `recommendations` array that Barry already builds at
 * barryMissionChat.js load time. No additional Firestore reads for the
 * card content — actions (re-engage, snooze) write directly to Firestore.
 *
 * Props:
 *   recommendations — array from loadRecommendations() in MissionControlDashboardV2
 *   userId          — Firebase user ID
 *   loading         — boolean, shows skeleton while recommendations load
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  doc, updateDoc, setDoc, collection, Timestamp
} from 'firebase/firestore';
import { db } from '../../firebase/config';

export default function AttentionCarousel({ recommendations = [], userId, loading }) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(new Set());

  // Filter out dismissed items
  const visible = recommendations.filter(r => !dismissed.has(r.contactId || r.missionId || r.type));

  const dismiss = (key) => setDismissed(prev => new Set([...prev, key]));

  // ── Handlers ──────────────────────────────────────────────────────

  const handleReEngage = async (rec) => {
    if (!userId || !rec.contactId) return;
    try {
      await updateDoc(doc(db, 'users', userId, 'contacts', rec.contactId), {
        re_engage: true
      });
      await setDoc(
        doc(collection(db, 'users', userId, 'barryQueue')),
        { contactId: rec.contactId, reason: 're_engage', createdAt: Timestamp.now() }
      );
      dismiss(rec.contactId);
    } catch (err) {
      console.error('[AttentionCarousel] Re-engage failed:', err);
    }
  };

  const handleSnooze = async (rec) => {
    if (!userId || !rec.contactId) return;
    try {
      const snoozeUntil = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await updateDoc(doc(db, 'users', userId, 'contacts', rec.contactId), {
        snoozed_until: snoozeUntil
      });
      dismiss(rec.contactId);
    } catch (err) {
      console.error('[AttentionCarousel] Snooze failed:', err);
    }
  };

  const handleDraftIntro = (rec, openBarry) => {
    // Pre-fill Barry with a draft request — dispatched via custom event
    // BarryChatPanel listens for 'barry:prefill' on window
    const prompt = `Draft an intro message for ${rec.contactName}${rec.companyName ? ` at ${rec.companyName}` : ''}`;
    window.dispatchEvent(new CustomEvent('barry:prefill', { detail: { prompt } }));
    // Scroll Barry panel into view
    document.querySelector('[aria-label="Barry Mission Co-pilot"]')?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleAddToMission = (rec) => {
    navigate(`/hunter?contactId=${rec.contactId}`);
  };

  // ── Empty state ───────────────────────────────────────────────────

  if (!loading && visible.length === 0) {
    return (
      <section className="mb-16" aria-label="Attention required">
        <SectionHeader count={0} />
        <div className="max-w-2xl mx-auto">
          <div
            className="rounded-2xl p-8 border-2 border-emerald-500/40 text-center"
            style={{ background: 'rgba(0,0,0,0.4)', boxShadow: '0 0 24px rgba(16,185,129,0.1)' }}
          >
            <div className="text-3xl mb-3">✅</div>
            <p className="font-mono text-emerald-400 text-sm leading-relaxed">
              All clear, Agent. Pipeline is clean.<br />
              Time to Scout new targets.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // ── Loading skeleton ──────────────────────────────────────────────

  if (loading) {
    return (
      <section className="mb-16" aria-label="Attention required">
        <SectionHeader count={null} />
        <div
          className="flex gap-4 overflow-x-auto pb-3 snap-x snap-mandatory scroll-smooth [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className="flex-shrink-0 w-72 rounded-2xl bg-white/5 border border-white/10 p-5 animate-pulse snap-start"
            >
              <div className="h-3 bg-white/10 rounded-full w-1/2 mb-3"></div>
              <div className="h-5 bg-white/10 rounded-full w-3/4 mb-2"></div>
              <div className="h-3 bg-white/10 rounded-full w-full mb-6"></div>
              <div className="h-8 bg-white/10 rounded-xl w-full"></div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="mb-16" aria-label="Attention required">
      <SectionHeader count={visible.length} />

      <div
        className="flex gap-4 overflow-x-auto pb-3 snap-x snap-mandatory scroll-smooth [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {visible.map((rec, i) => {
          const key = rec.contactId || rec.missionId || `${rec.type}-${i}`;

          if (rec.type === 'high_value_no_mission' || rec.type === 'high_value_no_engagement') {
            return (
              <HighValueCard
                key={key}
                rec={rec}
                onDraftIntro={() => handleDraftIntro(rec)}
                onAddToMission={() => handleAddToMission(rec)}
              />
            );
          }

          if (rec.type === 'stalled_awaiting_reply') {
            return (
              <GoneColdCard
                key={key}
                rec={rec}
                onReEngage={() => handleReEngage(rec)}
                onSnooze={() => handleSnooze(rec)}
              />
            );
          }

          if (rec.type === 'follow_up_due') {
            return <FollowUpCard key={key} rec={rec} />;
          }

          // Unknown signal type — render a generic card
          return (
            <GenericCard key={key} rec={rec} />
          );
        })}
      </div>
    </section>
  );
}

// ── Section header ────────────────────────────────────────────────────

function SectionHeader({ count }) {
  return (
    <div className="flex items-center justify-center gap-3 mb-6">
      <div className="h-px w-24 bg-gradient-to-r from-transparent to-amber-500/70"></div>
      <div className="flex items-center gap-2">
        <span className="text-lg">⚠</span>
        <h3 className="text-lg font-mono text-white tracking-wider">ATTENTION REQUIRED</h3>
        {count != null && count > 0 && (
          <span className="bg-amber-500 text-black text-xs font-mono font-bold px-2 py-0.5 rounded-full">
            {count}
          </span>
        )}
      </div>
      <div className="h-px w-24 bg-gradient-to-l from-transparent to-amber-500/70"></div>
    </div>
  );
}

// ── HIGH VALUE card ───────────────────────────────────────────────────

function HighValueCard({ rec, onDraftIntro, onAddToMission }) {
  return (
    <div
      className="flex-shrink-0 w-72 snap-start rounded-2xl p-5 border-2 border-cyan-500/40 flex flex-col gap-3"
      style={{ background: 'rgba(0,0,0,0.5)', boxShadow: '0 0 20px rgba(6,182,212,0.1)' }}
    >
      {/* Type label */}
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
        <span className="text-xs font-mono text-cyan-400 font-bold tracking-wider">HIGH VALUE</span>
      </div>

      {/* Contact */}
      <div>
        <div className="font-bold text-white text-base leading-snug">{rec.contactName}</div>
        {rec.companyName && (
          <div className="text-xs text-gray-400">{rec.companyName}</div>
        )}
        {rec.fitScore != null && (
          <div className="text-xs text-cyan-300 mt-1">Fit score: {rec.fitScore}</div>
        )}
      </div>

      {/* Barry note */}
      <p className="text-xs text-gray-400 italic leading-relaxed flex-1">
        🐻 High-value contact with no active mission. Start outreach before they go cold.
      </p>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onDraftIntro}
          className="flex-1 py-2 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-mono text-xs font-bold hover:bg-cyan-500/30 transition-all"
        >
          Draft Intro
        </button>
        <button
          onClick={onAddToMission}
          className="flex-1 py-2 rounded-xl bg-white/5 border border-white/10 text-gray-300 font-mono text-xs font-bold hover:bg-white/10 transition-all"
        >
          + Mission
        </button>
      </div>
    </div>
  );
}

// ── GONE COLD card ────────────────────────────────────────────────────

function GoneColdCard({ rec, onReEngage, onSnooze }) {
  const [acting, setActing] = useState(false);

  const act = async (fn) => {
    if (acting) return;
    setActing(true);
    await fn();
    // acting stays true — card gets dismissed from parent
  };

  return (
    <div
      className="flex-shrink-0 w-72 snap-start rounded-2xl p-5 border-2 border-amber-500/40 flex flex-col gap-3"
      style={{ background: 'rgba(0,0,0,0.5)', boxShadow: '0 0 20px rgba(245,158,11,0.1)' }}
    >
      {/* Type label */}
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
        <span className="text-xs font-mono text-amber-400 font-bold tracking-wider">GONE COLD</span>
      </div>

      {/* Contact */}
      <div>
        <div className="font-bold text-white text-base leading-snug">{rec.contactName}</div>
        {rec.companyName && (
          <div className="text-xs text-gray-400">{rec.companyName}</div>
        )}
      </div>

      {/* Days silent */}
      <div className="flex items-center gap-2">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-1.5 text-center">
          <div className="text-red-400 font-mono font-bold text-lg">{rec.daysSinceContact}d</div>
          <div className="text-gray-500 text-xs">silent</div>
        </div>
        <div className="text-xs text-gray-400">
          Last status: <span className="text-gray-300">{rec.lastStatus || 'Awaiting Reply'}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mt-auto">
        <button
          onClick={() => act(onReEngage)}
          disabled={acting}
          className="flex-1 py-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono text-xs font-bold hover:bg-amber-500/30 transition-all disabled:opacity-50"
        >
          Re-Engage
        </button>
        <button
          onClick={() => act(onSnooze)}
          disabled={acting}
          className="flex-1 py-2 rounded-xl bg-white/5 border border-white/10 text-gray-300 font-mono text-xs font-bold hover:bg-white/10 transition-all disabled:opacity-50"
        >
          Snooze 7d
        </button>
      </div>
    </div>
  );
}

// ── FOLLOW-UP card (future-ready placeholder) ─────────────────────────

function FollowUpCard({ rec }) {
  return (
    <div
      className="flex-shrink-0 w-72 snap-start rounded-2xl p-5 border-2 border-gray-600/30 flex flex-col gap-3 opacity-60"
      style={{ background: 'rgba(0,0,0,0.4)' }}
    >
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-gray-500"></span>
        <span className="text-xs font-mono text-gray-400 font-bold tracking-wider">FOLLOW-UP</span>
      </div>
      <div className="font-bold text-white text-base">{rec.contactName || 'Follow-up reminder'}</div>
      <p className="text-xs text-gray-500 italic flex-1">
        Follow-up reminders coming soon. Barry's [FOLLOW-UP] blocks will populate here.
      </p>
    </div>
  );
}

// ── Generic card (catch-all for unknown signal types) ─────────────────

function GenericCard({ rec }) {
  return (
    <div
      className="flex-shrink-0 w-72 snap-start rounded-2xl p-5 border border-white/10 flex flex-col gap-2"
      style={{ background: 'rgba(0,0,0,0.4)' }}
    >
      <span className="text-xs font-mono text-gray-400 tracking-wider uppercase">
        {rec.type?.replace(/_/g, ' ') || 'Signal'}
      </span>
      <div className="font-bold text-white">{rec.contactName || rec.missionName || 'Unknown'}</div>
    </div>
  );
}
