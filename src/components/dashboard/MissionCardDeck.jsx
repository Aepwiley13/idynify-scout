/**
 * MissionCardDeck — Inline swipeable card deck for Scout, Hunter, and RECON modules.
 *
 * Renders below the QuickLaunchStrip carousel when a module tile is tapped.
 * Uses swipe-gesture pattern from DailyLeads.jsx (CompanySwipeCard).
 *
 * Props:
 *   module  — 'hunter' | 'recon'
 *   userId  — Firebase user ID
 *   onClose — () => void  (called when user closes the deck)
 */

import { useState, useEffect, useRef } from 'react';
import {
  collection, getDocs,
  doc, updateDoc, setDoc, Timestamp
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getStaleContacts } from '../../utils/contactUtils';
import {
  getDashboardState, getSectionData, startSection,
  completeSection, saveSectionData
} from '../../utils/dashboardUtils';

// ── RECON section components (same mapping as ReconSectionEditor) ──
import Section1Foundation from '../recon/Section1Foundation';
import Section2ProductDeepDive from '../recon/Section2ProductDeepDive';
import Section3TargetMarketFirmographics from '../recon/Section3TargetMarketFirmographics';
import Section4IdealCustomerPsychographics from '../recon/Section4IdealCustomerPsychographics';
import Section5PainPointsMotivations from '../recon/Section5PainPointsMotivations';
import Section6BuyingBehaviorTriggers from '../recon/Section6BuyingBehaviorTriggers';
import Section7DecisionProcess from '../recon/Section7DecisionProcess';
import Section8CompetitiveLandscape from '../recon/Section8CompetitiveLandscape';
import Section9Messaging from '../recon/Section9Messaging';
import Section10BehavioralSignals from '../recon/Section10BehavioralSignals';

const RECON_SECTION_COMPONENTS = {
  1: Section1Foundation,
  2: Section2ProductDeepDive,
  3: Section3TargetMarketFirmographics,
  4: Section4IdealCustomerPsychographics,
  5: Section5PainPointsMotivations,
  6: Section6BuyingBehaviorTriggers,
  7: Section7DecisionProcess,
  8: Section8CompetitiveLandscape,
  9: Section9Messaging,
  10: Section10BehavioralSignals
};

// ── Shared swipe-card geometry ────────────────────────────────────────

function SwipeCard({ card, onAccept, onReject, acceptLabel = '✓ SAVE', rejectLabel = '✗ PASS' }) {
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [gone, setGone] = useState(null);
  const start = useRef(null);

  const xy = (e) => e.touches
    ? [e.touches[0].clientX, e.touches[0].clientY]
    : [e.clientX, e.clientY];

  const handleDown = (e) => { start.current = xy(e); };
  const handleMove = (e) => {
    if (!start.current) return;
    const [cx, cy] = xy(e);
    setDx(cx - start.current[0]);
    setDy(cy - start.current[1]);
  };
  const handleUp = () => {
    if (dx > 100) { setGone('r'); setTimeout(onAccept, 280); }
    else if (dx < -100) { setGone('l'); setTimeout(onReject, 280); }
    else { setDx(0); setDy(0); }
    start.current = null;
  };

  const tx = gone === 'r' ? 700 : gone === 'l' ? -700 : dx;

  return (
    <div
      onMouseDown={handleDown} onMouseMove={handleMove}
      onMouseUp={handleUp} onMouseLeave={handleUp}
      onTouchStart={handleDown} onTouchMove={handleMove} onTouchEnd={handleUp}
      style={{
        position: 'absolute',
        width: '100%', maxWidth: 480,
        left: '50%', marginLeft: -240,
        top: 0,
        transform: `translateX(${tx}px) translateY(${dy}px) rotate(${dx * 0.04}deg)`,
        transition: gone || Math.abs(dx) < 5 ? 'all 0.28s ease' : 'none',
        opacity: gone ? 0 : 1,
        cursor: 'grab',
        userSelect: 'none',
        zIndex: 2
      }}
    >
      {/* Swipe indicators */}
      {dx > 30 && (
        <div style={{
          position: 'absolute', top: 20, left: 16, zIndex: 10,
          padding: '5px 14px', borderRadius: 8,
          border: '3px solid #10b981', color: '#10b981',
          fontSize: 13, fontWeight: 700, transform: 'rotate(-10deg)',
          background: 'rgba(16,185,129,0.1)',
        }}>{acceptLabel}</div>
      )}
      {dx < -30 && (
        <div style={{
          position: 'absolute', top: 20, right: 16, zIndex: 10,
          padding: '5px 14px', borderRadius: 8,
          border: '3px solid #ef4444', color: '#ef4444',
          fontSize: 13, fontWeight: 700, transform: 'rotate(10deg)',
          background: 'rgba(239,68,68,0.1)',
        }}>{rejectLabel}</div>
      )}
      {card}
    </div>
  );
}

// ── Briefing Card ─────────────────────────────────────────────────────

function BriefingCard({ title, body, cta, accentColor, onStart }) {
  return (
    <div
      className="bg-black/60 backdrop-blur-xl rounded-2xl p-8 border-2 text-center"
      style={{ borderColor: `${accentColor}60`, boxShadow: `0 0 30px ${accentColor}20` }}
    >
      <h3 className="text-2xl font-mono font-bold text-white mb-3">{title}</h3>
      <p className="text-gray-300 text-sm mb-6 leading-relaxed">{body}</p>
      <button
        onClick={onStart}
        className="px-8 py-3 rounded-xl text-white font-mono font-bold text-sm transition-all"
        style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}99)` }}
      >
        {cta}
      </button>
    </div>
  );
}

// ── Completion Card ───────────────────────────────────────────────────

function CompletionCard({ count, label, accentColor, onClose }) {
  return (
    <div
      className="bg-black/60 backdrop-blur-xl rounded-2xl p-8 border-2 text-center"
      style={{ borderColor: `${accentColor}60`, boxShadow: `0 0 30px ${accentColor}20` }}
    >
      <div className="text-5xl mb-4">✅</div>
      <h3 className="text-2xl font-mono font-bold text-white mb-2">All Done</h3>
      <p className="text-gray-300 text-sm mb-6">
        {count} {label} reviewed.
      </p>
      <button
        onClick={onClose}
        className="px-8 py-3 rounded-xl text-white font-mono font-bold text-sm transition-all"
        style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}99)` }}
      >
        Close
      </button>
    </div>
  );
}

// ── Hunter Deck ───────────────────────────────────────────────────────

function HunterDeck({ userId, onClose }) {
  const [contacts, setContacts] = useState([]);
  const [phase, setPhase] = useState('brief'); // 'brief' | 'swiping' | 'done'
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [queued, setQueued] = useState(0);

  const handleStart = async () => {
    setLoading(true);
    try {
      const stale = await getStaleContacts(userId, 14);
      setContacts(stale);
      setIndex(0);
      setQueued(0);
      setPhase('swiping');
    } catch (err) {
      console.error('[HunterDeck] Failed to load stale contacts:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleReEngage = async () => {
    const contact = contacts[index];
    if (!contact) return;
    try {
      await updateDoc(doc(db, 'users', userId, 'contacts', contact.id), {
        re_engage: true
      });
      // Write to Barry's attention queue
      await setDoc(
        doc(collection(db, 'users', userId, 'barryQueue')),
        { contactId: contact.id, reason: 're_engage', createdAt: Timestamp.now(), processed: false }
      );
      setQueued(q => q + 1);
    } catch (err) {
      console.error('[HunterDeck] Re-engage failed:', err);
    }
    advance();
  };

  const handleSnooze = async () => {
    const contact = contacts[index];
    if (!contact) return;
    try {
      const snoozeUntil = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await updateDoc(doc(db, 'users', userId, 'contacts', contact.id), {
        snoozed_until: snoozeUntil
      });
    } catch (err) {
      console.error('[HunterDeck] Snooze failed:', err);
    }
    advance();
  };

  const advance = () => {
    setIndex(i => {
      if (i + 1 >= contacts.length) setPhase('done');
      return i + 1;
    });
  };

  const currentContact = contacts[index];
  const nextContact = contacts[index + 1];

  if (phase === 'brief' || loading) {
    return loading ? (
      <div className="text-center py-12 text-pink-400 font-mono animate-pulse">Scanning pipeline...</div>
    ) : (
      <BriefingCard
        title="Contacts Going Cold"
        body={`${contacts.length > 0 ? contacts.length : '...'} contacts haven't been touched in 14+ days. Review them now before they go dark.`}
        cta="Review Now →"
        accentColor="#ec4899"
        onStart={handleStart}
      />
    );
  }

  if (phase === 'done') {
    return (
      <CompletionCard
        count={queued}
        label="contacts queued for re-engagement"
        accentColor="#ec4899"
        onClose={onClose}
      />
    );
  }

  return (
    <div>
      <div className="text-center text-xs text-gray-500 font-mono mb-4">
        {index + 1} / {contacts.length} · {queued} queued for re-engagement
      </div>

      <div style={{ position: 'relative', height: 320, maxWidth: 480, margin: '0 auto' }}>
        {nextContact && (
          <div style={{
            position: 'absolute', width: '100%', maxWidth: 480,
            left: '50%', marginLeft: -240, top: 8,
            transform: 'scale(0.96)',
            zIndex: 1, opacity: 0.6
          }}>
            <HunterCard contact={nextContact} />
          </div>
        )}
        {currentContact && (
          <SwipeCard
            key={index}
            onAccept={handleReEngage}
            onReject={handleSnooze}
            acceptLabel="✓ RE-ENGAGE"
            rejectLabel="⏸ SNOOZE 7D"
            card={<HunterCard contact={currentContact} />}
          />
        )}
      </div>

      <div className="flex justify-center gap-4 mt-4">
        <button
          onClick={handleSnooze}
          className="px-5 py-2.5 rounded-xl bg-gray-700/40 border border-gray-600 text-gray-300 font-mono text-xs hover:bg-gray-700 transition-all"
        >⏸ Snooze 7 Days</button>
        <button
          onClick={handleReEngage}
          className="px-5 py-2.5 rounded-xl bg-pink-500/20 border border-pink-500/50 text-pink-300 font-mono text-xs hover:bg-pink-500/30 transition-all"
        >✓ Re-Engage</button>
      </div>
    </div>
  );
}

function HunterCard({ contact }) {
  return (
    <div className="bg-black/70 border border-pink-500/30 rounded-2xl p-6"
      style={{ boxShadow: '0 20px 50px rgba(0,0,0,0.6)' }}>
      <div className="flex items-center gap-4 mb-4">
        <div className="w-14 h-14 rounded-xl bg-pink-500/10 border border-pink-500/30 flex items-center justify-center text-2xl">
          👤
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-white text-lg truncate">{contact.name || 'Unknown'}</div>
          <div className="text-xs text-gray-400 truncate">{contact.title || 'Unknown role'} · {contact.company_name || ''}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          <div className="text-red-400 font-mono font-bold text-lg">{contact.daysSince}d</div>
          <div className="text-gray-400 mt-0.5">Days silent</div>
        </div>
        <div className="bg-white/5 rounded-lg p-3">
          <div className="text-gray-300 font-medium truncate">{contact.contact_status || 'Awaiting Reply'}</div>
          <div className="text-gray-500 mt-0.5">Last status</div>
        </div>
      </div>
    </div>
  );
}

// ── RECON Deck ────────────────────────────────────────────────────────

function ReconDeck({ userId, onClose }) {
  const [sections, setSections] = useState([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [phase, setPhase] = useState('brief'); // 'brief' | 'cards' | 'done'
  const [loading, setLoading] = useState(false);
  const [openSection, setOpenSection] = useState(null); // section object for modal

  const loadSections = async () => {
    setLoading(true);
    try {
      const dashboardState = await getDashboardState(userId);
      if (!dashboardState) return;

      const allSections = [];
      let completed = 0;
      for (const mod of (dashboardState.modules || [])) {
        for (const section of (mod.sections || [])) {
          allSections.push({ ...section, moduleId: mod.id });
          if (section.status === 'completed') completed++;
        }
      }
      setTotalCount(allSections.length);
      setCompletedCount(completed);
      // Only show incomplete sections
      setSections(allSections.filter(s => s.status !== 'completed'));
    } catch (err) {
      console.error('[ReconDeck] Failed to load sections:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    await loadSections();
    setPhase('cards');
  };

  const handleSectionComplete = async () => {
    // Close modal, refresh sections
    setOpenSection(null);
    setCompletedCount(c => c + 1);
    await loadSections();
    if (sections.filter(s => s.status !== 'completed').length === 0) {
      setPhase('done');
    }
  };

  if (phase === 'brief') {
    return (
      <BriefingCard
        title="Train Barry"
        body="Your answers make Barry smarter. Complete training cards to improve Scout matches, Hunter outreach, and Barry's recommendations."
        cta="Start Training →"
        accentColor="#a855f7"
        onStart={handleStart}
      />
    );
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-purple-400 font-mono animate-pulse">Loading training data...</div>
    );
  }

  if (phase === 'done' || sections.length === 0) {
    return (
      <CompletionCard
        count={completedCount}
        label="sections complete"
        accentColor="#a855f7"
        onClose={onClose}
      />
    );
  }

  return (
    <div>
      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs font-mono text-gray-400 mb-2">
          <span>RECON COMPLETION</span>
          <span>{completedCount} / {totalCount}</span>
        </div>
        <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-2 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-500"
            style={{ width: totalCount > 0 ? `${(completedCount / totalCount) * 100}%` : '0%' }}
          />
        </div>
      </div>

      {/* Section cards — tap to open, no swipe */}
      <div className="flex flex-col gap-3 max-h-96 overflow-y-auto">
        {sections.map((section) => (
          <button
            key={section.sectionId}
            onClick={() => setOpenSection(section)}
            className="w-full text-left bg-black/50 border border-purple-500/30 rounded-xl p-4 hover:border-purple-400/60 hover:bg-purple-500/5 transition-all group"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono font-bold text-white text-sm group-hover:text-purple-300 transition-colors">
                  Section {section.sectionId}: {section.title}
                </div>
                {section.description && (
                  <div className="text-xs text-gray-500 mt-1 line-clamp-1">{section.description}</div>
                )}
              </div>
              <div className="flex-shrink-0 ml-3">
                <span className={`text-xs px-2 py-1 rounded-full font-mono ${
                  section.status === 'in_progress'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'bg-gray-700 text-gray-400'
                }`}>
                  {section.status === 'in_progress' ? 'IN PROGRESS' : 'START →'}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* RECON Section Modal */}
      {openSection && (
        <ReconSectionModal
          section={openSection}
          userId={userId}
          onClose={() => setOpenSection(null)}
          onComplete={handleSectionComplete}
        />
      )}
    </div>
  );
}

// ── RECON Section Modal ───────────────────────────────────────────────

function ReconSectionModal({ section, userId, onClose, onComplete }) {
  const [formData, setFormData] = useState(section.data || {});
  const [saving, setSaving] = useState(false);
  const SectionComponent = RECON_SECTION_COMPONENTS[section.sectionId];

  // Start section if not already started
  useEffect(() => {
    if (section.status === 'not_started') {
      startSection(userId, section.moduleId || 'recon', section.sectionId).catch(console.warn);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async (data) => {
    setSaving(true);
    try {
      await saveSectionData(userId, section.moduleId || 'recon', section.sectionId, data || formData);
      if (data) setFormData(data);
    } catch (err) {
      console.error('[ReconModal] Save failed:', err);
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async (data) => {
    setSaving(true);
    try {
      await completeSection(userId, section.moduleId || 'recon', section.sectionId, data || formData);
      onComplete();
    } catch (err) {
      console.error('[ReconModal] Complete failed:', err);
      alert(`Failed to complete section: ${err.message}`);
      throw err;
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full sm:max-w-3xl bg-white rounded-t-2xl sm:rounded-2xl overflow-hidden"
        style={{ maxHeight: '92vh', overflowY: 'auto' }}>
        {/* Modal header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <div className="text-xs font-mono text-purple-600 font-bold">RECON · Section {section.sectionId}</div>
            <div className="font-bold text-gray-900">{section.title}</div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-all text-xl"
          >×</button>
        </div>

        {/* Section content */}
        <div className="p-6">
          {saving && (
            <div className="text-center text-purple-600 font-mono text-sm animate-pulse mb-4">Saving...</div>
          )}
          {SectionComponent ? (
            <SectionComponent
              initialData={formData}
              onSave={handleSave}
              onComplete={handleComplete}
            />
          ) : (
            <div className="text-center text-gray-500 py-8">Section component not found</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main MissionCardDeck ──────────────────────────────────────────────

const MODULE_CONFIG = {
  hunter: { label: 'HUNTER', accentColor: '#ec4899', emoji: '🎯' },
  recon:  { label: 'RECON',  accentColor: '#a855f7', emoji: '🧠' }
};

export default function MissionCardDeck({ module, userId, onClose }) {
  const config = MODULE_CONFIG[module] || MODULE_CONFIG.scout;

  return (
    <section
      className="mb-12 mt-2"
      aria-label={`${config.label} card deck`}
    >
      <div
        className="max-w-2xl mx-auto rounded-2xl p-6 border-2 relative"
        style={{
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(20px)',
          borderColor: `${config.accentColor}40`,
          boxShadow: `0 0 30px ${config.accentColor}15`
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <span className="text-xl">{config.emoji}</span>
            <span className="font-mono font-bold text-white text-sm tracking-wider">
              {config.label} DECK
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-all text-lg"
            aria-label="Close deck"
          >×</button>
        </div>

        {/* Deck content by module */}
        {module === 'hunter' && <HunterDeck userId={userId} onClose={onClose} />}
        {module === 'recon' && <ReconDeck userId={userId} onClose={onClose} />}
      </div>
    </section>
  );
}
