/**
 * DailyLeads.jsx — Swipe-triage queue for companies and people.
 *
 * UI: idynify-v5 design with theme tokens.
 * Data: Firebase Firestore + Apollo (all original wiring preserved).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import {
  collection, query, where, getDocs, doc, getDoc,
  setDoc, updateDoc, deleteDoc,
} from 'firebase/firestore';
import { Globe, Linkedin, Check, X, RefreshCw, Loader, Settings, RotateCcw, MessageCircle, ArrowRight, MapPin, User, List, ChevronDown, Flame, Trophy } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND, STATUS, ASSETS } from '../../theme/tokens';
import ScorePip from '../../components/scout/ScorePip';
import { UNSCORED_LABEL } from '../../utils/scoreDisplay';
import { compareByFit, pickTopMatch } from '../../utils/fitRanking';
import CompanyLogo from '../../components/scout/CompanyLogo';
import ContactTitleSetup from '../../components/scout/ContactTitleSetup';
import BarryICPPanel, { BarryAvatar } from '../../components/scout/BarryICPPanel';
import { getScoreBreakdown, DEFAULT_WEIGHTS, calculateICPScore, generateMatchReasons, computeCoverage } from '../../utils/icpScoring';
import { getDisplayIndustry } from '../../utils/companyDisplay';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { prepareContactWrite, applyContactMerge } from '../../services/contactWriteGuard';
import { RECORD_STATUS } from '../../constants/statusModel';
import { calculateReconConfidence } from '../../utils/reconConfidence';
import { ARRIVAL_REVIEW_ICP } from '../../utils/firstExperienceMode';
import { resolveActiveIcp, isResolved, explainUnresolved } from '../../utils/resolveActiveIcp';
import {
  recordDecision, recordSkip,
  recordPersonEncounter, recordPersonDecision, recordPersonSkip,
} from '../../services/icpRelationshipService';

// ─── Initials avatar ─────────────────────────────────────────────────────────
function Av({ initials, color = BRAND.pink, size = 70 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `${color}20`, border: `1.5px solid ${color}50`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.3, fontWeight: 700, color, flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

// The swipe card's width above 1024px, where the column has room to spare.
// Wider is shorter: the same text — Barry Intel above all — reflows over fewer
// lines, which buys vertical space without hiding a word of it. The stage it
// sits in is 20px wider still, which is what the ghost cards' 8px/16px offsets
// need to stay inside. Below 1024px the card stays at 420: there is no spare
// width to trade.
const CARD_MAX_W = 680;

// ─── Match feedback ───────────────────────────────────────────────────────────
const MATCH_REASONS = ['Industry fit', 'Right size', 'Good location', 'Revenue match', 'Strong signals', 'Known brand'];

// ─── Rejection feedback ───────────────────────────────────────────────────────
const REJECTION_REASONS = ['Wrong industry', 'Too large', 'Too small', 'Wrong location', 'Revenue mismatch', 'Already a client', 'Competitor', 'Not the right time'];

function RejectionFeedbackFace({ entityName, reasons, setReasons, note, setNote, onSkip, onSubmit, T, wide }) {
  const toggle = (r) => setReasons(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: wide ? '28px 24px 20px' : '22px 18px 16px', gap: 12, animation: 'feedbackFlipIn 0.25s ease' }}>
      <div style={{ fontSize: 30 }}>🚫</div>
      <div style={{ fontSize: wide ? 16 : 14, fontWeight: 700, color: T.text, textAlign: 'center' }}>What didn't fit?</div>
      <div style={{ fontSize: wide ? 12 : 11, color: T.textMuted, textAlign: 'center', lineHeight: 1.55 }}>
        Why isn't <strong>{entityName}</strong> a match?
        <br />
        <span style={{ fontSize: 10, color: T.textFaint }}>Help Barry send better matches your way.</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', width: '100%' }}>
        {REJECTION_REASONS.map(r => (
          <button
            key={r}
            onClick={e => { e.stopPropagation(); toggle(r); }}
            onMouseDown={e => e.stopPropagation()}
            style={{
              padding: '5px 12px', borderRadius: 20, fontSize: wide ? 11 : 10, fontWeight: 600,
              cursor: 'pointer', border: `1.5px solid`,
              borderColor: reasons.includes(r) ? '#ef4444' : T.border2,
              background: reasons.includes(r) ? '#ef444418' : T.surface,
              color: reasons.includes(r) ? '#ef4444' : T.textMuted,
              transition: 'all 0.15s',
            }}
          >
            {reasons.includes(r) ? '✕ ' : ''}{r}
          </button>
        ))}
      </div>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        placeholder="Tell Barry more... (optional)"
        rows={2}
        style={{
          width: '100%', padding: '8px 10px', borderRadius: 9,
          border: `1.5px solid ${T.border2}`, background: T.surface,
          color: T.text, fontSize: wide ? 12 : 11, resize: 'none',
          fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 8, width: '100%' }}>
        <button
          onClick={e => { e.stopPropagation(); onSkip(); }}
          onMouseDown={e => e.stopPropagation()}
          style={{ flex: 1, padding: wide ? 10 : 8, borderRadius: 10, border: `1.5px solid ${T.border2}`, background: T.surface, color: T.textMuted, fontSize: wide ? 12 : 11, fontWeight: 600, cursor: 'pointer' }}
        >
          Skip
        </button>
        <button
          onClick={e => { e.stopPropagation(); onSubmit(); }}
          onMouseDown={e => e.stopPropagation()}
          style={{ flex: 2, padding: wide ? 10 : 8, borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#ef4444,#dc2626)', color: '#fff', fontSize: wide ? 12 : 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <BarryAvatar size={14} />Tell Barry
        </button>
      </div>
    </div>
  );
}

function FeedbackFace({ entityName, reasons, setReasons, note, setNote, score, setScore, onSkip, onSubmit, T, wide }) {
  const toggle = (r) => setReasons(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
  const scoreColor = (n) => n <= 3 ? '#ef4444' : n <= 6 ? '#f59e0b' : n <= 8 ? '#10b981' : '#e91e8c';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: wide ? '28px 24px 20px' : '22px 18px 16px', gap: 12, animation: 'feedbackFlipIn 0.25s ease' }}>
      <div style={{ fontSize: 30 }}>🎯</div>
      <div style={{ fontSize: wide ? 16 : 14, fontWeight: 700, color: T.text, textAlign: 'center' }}>Great catch!</div>
      <div style={{ fontSize: wide ? 12 : 11, color: T.textMuted, textAlign: 'center', lineHeight: 1.55 }}>
        Why is <strong>{entityName}</strong> a good fit?
        <br />
        <span style={{ fontSize: 10, color: T.textFaint }}>Help Barry find more matches like this.</span>
      </div>

      {/* 1-10 Score Selector */}
      <div style={{ width: '100%' }}>
        <div style={{ fontSize: 10, color: T.textFaint, textAlign: 'center', marginBottom: 7, fontWeight: 600, letterSpacing: '0.06em' }}>
          HOW STRONG IS THIS FIT?
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: wide ? 5 : 4 }}>
          {[1,2,3,4,5,6,7,8,9,10].map(n => {
            const c = scoreColor(n);
            const sel = score === n;
            return (
              <button
                key={n}
                onClick={e => { e.stopPropagation(); setScore(prev => prev === n ? null : n); }}
                onMouseDown={e => e.stopPropagation()}
                style={{
                  width: wide ? 30 : 26, height: wide ? 30 : 26, borderRadius: '50%',
                  border: `1.5px solid ${sel ? c : T.border2}`,
                  background: sel ? `${c}22` : T.surface,
                  color: sel ? c : T.textFaint,
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  transition: 'all 0.12s', flexShrink: 0,
                }}
              >{n}</button>
            );
          })}
        </div>
        {score && (
          <div style={{ textAlign: 'center', marginTop: 5, fontSize: 10, color: scoreColor(score), fontWeight: 600 }}>
            {score <= 3 ? 'Weak fit' : score <= 6 ? 'Decent fit' : score <= 8 ? 'Strong fit' : 'Perfect fit'} — {score}/10
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', width: '100%' }}>
        {MATCH_REASONS.map(r => (
          <button
            key={r}
            onClick={e => { e.stopPropagation(); toggle(r); }}
            onMouseDown={e => e.stopPropagation()}
            style={{
              padding: '5px 12px', borderRadius: 20, fontSize: wide ? 11 : 10, fontWeight: 600,
              cursor: 'pointer', border: `1.5px solid`,
              borderColor: reasons.includes(r) ? '#10b981' : T.border2,
              background: reasons.includes(r) ? '#10b98118' : T.surface,
              color: reasons.includes(r) ? '#10b981' : T.textMuted,
              transition: 'all 0.15s',
            }}
          >
            {reasons.includes(r) ? '✓ ' : ''}{r}
          </button>
        ))}
      </div>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        placeholder="Add a note for Barry... (optional)"
        rows={2}
        style={{
          width: '100%', padding: '8px 10px', borderRadius: 9,
          border: `1.5px solid ${T.border2}`, background: T.surface,
          color: T.text, fontSize: wide ? 12 : 11, resize: 'none',
          fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 8, width: '100%' }}>
        <button
          onClick={e => { e.stopPropagation(); onSkip(); }}
          onMouseDown={e => e.stopPropagation()}
          style={{ flex: 1, padding: wide ? 10 : 8, borderRadius: 10, border: `1.5px solid ${T.border2}`, background: T.surface, color: T.textMuted, fontSize: wide ? 12 : 11, fontWeight: 600, cursor: 'pointer' }}
        >
          Skip
        </button>
        <button
          onClick={e => { e.stopPropagation(); onSubmit(); }}
          onMouseDown={e => e.stopPropagation()}
          style={{ flex: 2, padding: wide ? 10 : 8, borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', fontSize: wide ? 12 : 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <BarryAvatar size={14} />Send to Barry
        </button>
      </div>
    </div>
  );
}

// ─── CompanySwipeCard ─────────────────────────────────────────────────────────
// Exported for the gesture regression test (src/test/swipeSingleDecision.test.jsx),
// which drives the real DOM events a drag release produces. The page still ships
// as the default export; nothing else imports this.
export function CompanySwipeCard({ company, onAccept, onReject, onSkip, wide = false, icpProfile, icpWeights }) {
  const T = useT();
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [gone, setGone] = useState(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackReasons, setFeedbackReasons] = useState([]);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [feedbackScore, setFeedbackScore] = useState(null);
  const [showRejectionFeedback, setShowRejectionFeedback] = useState(false);
  const [rejectionReasons, setRejectionReasons] = useState([]);
  const [rejectionNote, setRejectionNote] = useState('');
  const [isFlipping, setIsFlipping] = useState(false);
  const s = useRef(null);

  // ── One card, one decision ──────────────────────────────────────────────────
  // A card instance may commit AT MOST ONE outcome, ever. This is a latch, not a
  // debounce: there is no window to tune and no timestamp to compare.
  //
  // Why it is needed: a single drag release reaches `up()` more than once. The
  // release fires onMouseUp, and `setGone` then animates the card 700px out from
  // under the cursor, which fires onMouseLeave — bound to the same `up()`. On
  // touch, the browser's compatibility mouse events (mousedown → mouseup) follow
  // touchend and do it again. `dx` is never reset on the way out, so the second
  // call re-passes the `dx > 100` threshold and schedules a SECOND onAccept.
  //
  // Production, workspace peqhaq8Cw1UUPeaYhaSLwZ0iCRk2 on 2026-09-17: two of
  // three company swipes produced two lineage events 88ms and 33ms apart, both
  // stamped swipe_gesture='drag' — i.e. both from this handler, not a drag plus
  // a button press. The legacy write hid it by PATCHing identical values twice.
  //
  // The latch is per MOUNT, and the card is keyed by company id. An undo moves
  // currentIndex back, the key changes, React mounts a fresh card, and the latch
  // starts open again — so "swiped, undid, re-swiped" still commits a second,
  // genuinely distinct decision with its own causeId. That is a different fact
  // from one gesture firing twice, and it stays expressible.
  const decidedRef = useRef(false);
  const commit = (run) => {
    if (decidedRef.current) return;
    decidedRef.current = true;
    run();
  };

  // ── Which card this decision was made ON ────────────────────────────────────
  // Every callback below is deferred 280ms behind the exit animation, and the
  // page does not hold its swipe lock for that window — handleSwipe has not been
  // called yet. Anything that advances the queue in the meantime (a keyboard
  // press, a skip, an undo, a jump) leaves the deferred callback describing a
  // gesture made on a card that is no longer current.
  //
  // So the gesture carries its own subject. The page decides THIS company or it
  // decides nothing; it never falls through to whoever is current at t=280.
  // The card is keyed by company id, so this is fixed for the life of the mount.
  const subjectId = company.id;

  const xy = e => e.touches ? [e.touches[0].clientX, e.touches[0].clientY] : [e.clientX, e.clientY];
  // Post-decision the card is spent; a synthesized compat mousedown must not
  // re-arm the drag it is about to "release".
  const down = e => { if (decidedRef.current) return; s.current = xy(e); };
  const move = e => {
    if (!s.current) return;
    const [cx, cy] = xy(e);
    setDx(cx - s.current[0]);
    setDy(cy - s.current[1]);
  };
  const up = () => {
    // A release only counts if a press started here. `move` has always guarded
    // on this; `up` did not, so onMouseLeave fired a decision with no pointer
    // down at all. Consume the press first, so re-entry finds nothing to release.
    const pressed = s.current;
    s.current = null;
    if (!pressed) return;
    if (dx > 100) commit(() => { setGone('r'); setTimeout(() => onAccept(null, 'drag', subjectId), 280); });
    else if (dx < -100) commit(() => { setGone('l'); setTimeout(() => onReject(null, 'drag', subjectId), 280); });
    else { setDx(0); setDy(0); }
  };

  const handleMatchClick = (e) => {
    e.stopPropagation();
    if (decidedRef.current) return;
    setIsFlipping(true);
    setTimeout(() => { setShowFeedback(true); setIsFlipping(false); }, 140);
  };
  const handleSkipFeedback = () => commit(() => { setGone('r'); setTimeout(() => onAccept(null, 'button', subjectId), 280); });
  const handleSendFeedback = () => commit(() => { setGone('r'); setTimeout(() => onAccept({ reasons: feedbackReasons, note: feedbackNote, score: feedbackScore }, 'button', subjectId), 280); });

  const handleRejectClick = (e) => {
    e.stopPropagation();
    if (decidedRef.current) return;
    setIsFlipping(true);
    setTimeout(() => { setShowRejectionFeedback(true); setIsFlipping(false); }, 140);
  };
  const handleSkipRejectionFeedback = () => commit(() => { setGone('l'); setTimeout(() => onReject(null, 'button', subjectId), 280); });
  const handleSendRejectionFeedback = () => commit(() => { setGone('l'); setTimeout(() => onReject({ reasons: rejectionReasons, note: rejectionNote }, 'button', subjectId), 280); });
  // Not a decision, so it does not animate off to either side — a skip is
  // "not now", and the card simply steps aside. Placement and styling are
  // Sprint 3's to settle; this is parity with the affordance PersonSwipeCard
  // has had all along, so Skip is reachable at all.
  //
  // It still latches: a skip advances the queue, so a skip followed by a stray
  // drag release would decide a company the user has already moved past.
  const handleSkipClick = (e) => { e.stopPropagation(); commit(() => onSkip?.(subjectId)); };

  const tx = gone === 'r' ? 700 : gone === 'l' ? -700 : dx;
  // G1-06: a null score means "configured criteria, but nothing measurable on
  // this company". That is NOT 0 / "Low Fit" — it is an absence of evidence, and
  // labelling it as a poor match is the exact dishonesty Gate 1 removes.
  const rawScore = company.fit_score ?? company.score ?? null;
  const isScored = rawScore !== null && rawScore !== undefined;
  const score = isScored ? rawScore : 0;
  const sc = !isScored ? T.textFaint : score >= 75 ? STATUS.green : score >= 50 ? STATUS.amber : STATUS.red;
  const scoreLabel = !isScored ? 'Not enough data'
    : score >= 75 ? 'Strong Fit' : score >= 50 ? 'Good Match' : 'Low Fit';
  const barryText = company.barry_intel || company.barry_context || company.barryIntel
    || `${company.name} is a ${getDisplayIndustry(company, 'company')} — review their profile to assess fit.`;

  // ICP factor breakdown (calculated live from stored profile)
  const breakdown = (icpProfile && company) ? getScoreBreakdown(company, icpProfile, icpWeights || DEFAULT_WEIGHTS) : null;

  // G1-06: pills are driven by what was ACTUALLY EVALUATED (breakdown.state),
  // not by what the ICP happens to configure. The old version filtered on ICP
  // configuration alone, so a dimension the company had no data for rendered as
  // "0%" — presenting "never measured" as "measured and did not match".
  const factorPills = breakdown ? [
    { key: 'industry', label: 'Industry', data: breakdown.industry },
    { key: 'location', label: 'Location', data: breakdown.location },
    { key: 'employeeSize', label: 'Size', data: breakdown.employeeSize },
    { key: 'revenue', label: 'Revenue', data: breakdown.revenue },
  ].filter(f => f.data && f.data.active) : [];

  // "2 of 4 factors measured" — keeps the score from overstating its own basis.
  const measuredCount = factorPills.filter(f => !f.data.unknown).length;
  const coverageNote = factorPills.length > 0
    ? `${measuredCount} of ${factorPills.length} factor${factorPills.length === 1 ? '' : 's'} measured`
    : null;

  // HQ and CEO — try multiple Apollo field names
  const hqLocation = company.hq_location
    || (company.headquarters_city ? `${company.headquarters_city}${company.headquarters_state ? ', ' + company.headquarters_state : ''}` : null)
    || company.headquarters
    || company.location
    || company.state
    || null;

  const ceoName = company.ceo_name
    || (company.primary_contact?.name ? `${company.primary_contact.name}${company.primary_contact.title ? ' · ' + company.primary_contact.title : ''}` : null)
    || null;

  // Confidence: count meaningful data fields
  const dataFields = [company.industry, company.employee_count || company.company_size,
    company.revenue, hqLocation, ceoName, company.barry_intel || company.barry_context].filter(Boolean);
  const confidence = dataFields.length >= 4 ? 'High' : dataFields.length >= 2 ? 'Medium' : 'Low';
  const confColor = confidence === 'High' ? STATUS.green : confidence === 'Medium' ? STATUS.amber : STATUS.red;

  const swipeProgress = Math.min(Math.abs(dx) / 100, 1);
  const overlayOpacity = Math.min(swipeProgress * 1.5, 0.85);

  return (
    <div
      onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up}
      onTouchStart={down} onTouchMove={move} onTouchEnd={up}
      style={{
        // In flow, not absolute: the card is what gives the stage its height, so
        // the card's own content decides how tall it is. Nothing above it caps
        // that, and a card taller than the viewport scrolls the column it sits
        // in rather than scrolling inside itself.
        position: 'relative', width: '100%', maxWidth: wide ? CARD_MAX_W : 420,
        transform: `translateX(${tx}px) translateY(${dy * 0.1}px) rotate(${dx * 0.04}deg)`,
        transition: gone || Math.abs(dx) < 5 ? 'all 0.28s ease' : 'none',
        opacity: gone ? 0 : 1, cursor: 'grab', userSelect: 'none',
        // Vertical touch belongs to the page; this handler only claims horizontal.
        touchAction: 'pan-y', margin: '0 auto',
      }}
    >
      {/* Swipe overlay labels */}
      {dx > 30 && (
        <div style={{
          position: 'absolute', top: 22, left: 16, zIndex: 10,
          padding: '5px 13px', borderRadius: 8,
          border: `3px solid ${STATUS.green}`, color: STATUS.green,
          fontSize: 13, fontWeight: 700, transform: 'rotate(-11deg)',
          background: `${STATUS.green}10`, opacity: Math.min((dx - 30) / 70, 1),
        }}>✓ IT'S A MATCH</div>
      )}
      {dx < -30 && (
        <div style={{
          position: 'absolute', top: 22, right: 16, zIndex: 10,
          padding: '5px 13px', borderRadius: 8,
          border: `3px solid ${STATUS.red}`, color: STATUS.red,
          fontSize: 13, fontWeight: 700, transform: 'rotate(11deg)',
          background: `${STATUS.red}10`, opacity: Math.min((Math.abs(dx) - 30) / 70, 1),
        }}>✗ NOT A MATCH</div>
      )}

      {/* Card — height comes from its content on every breakpoint. `hidden` here
          only clips the corner radius; there is nothing to scroll past. */}
      <div style={{
        position: 'relative',
        background: T.cardBg, border: `1px solid ${T.border2}`,
        borderRadius: 22, overflow: 'hidden',
        boxShadow: `0 28px 70px ${T.isDark ? '#00000099' : '#00000018'}`,
        transform: isFlipping ? 'scaleX(0)' : 'scaleX(1)',
        transition: 'transform 0.14s ease',
      }}>
        {/* Feedback overlay — appears after "This is a Match" click */}
        {showFeedback && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 30, background: T.cardBg, borderRadius: 22, overflowY: 'auto' }}>
            <FeedbackFace
              entityName={company.name}
              reasons={feedbackReasons} setReasons={setFeedbackReasons}
              note={feedbackNote} setNote={setFeedbackNote}
              score={feedbackScore} setScore={setFeedbackScore}
              onSkip={handleSkipFeedback} onSubmit={handleSendFeedback}
              T={T} wide={wide}
            />
          </div>
        )}
        {/* Rejection feedback overlay — appears after "Not a Match" click */}
        {showRejectionFeedback && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 30, background: T.cardBg, borderRadius: 22, overflowY: 'auto' }}>
            <RejectionFeedbackFace
              entityName={company.name}
              reasons={rejectionReasons} setReasons={setRejectionReasons}
              note={rejectionNote} setNote={setRejectionNote}
              onSkip={handleSkipRejectionFeedback} onSubmit={handleSendRejectionFeedback}
              T={T} wide={wide}
            />
          </div>
        )}
        {/* Full-card swipe color overlay */}
        {dx > 10 && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 5, borderRadius: 22, background: `${STATUS.green}${Math.round(overlayOpacity * 20).toString(16).padStart(2,'0')}`, pointerEvents: 'none' }} />
        )}
        {dx < -10 && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 5, borderRadius: 22, background: `${STATUS.red}${Math.round(overlayOpacity * 20).toString(16).padStart(2,'0')}`, pointerEvents: 'none' }} />
        )}

        {/* Header — horizontal: logo left, info right, confidence pill top-right */}
        <div style={{
          padding: wide ? '18px 24px' : '14px 18px', display: 'flex', alignItems: 'center', gap: wide ? 16 : 12,
          background: T.cardBg2, borderBottom: `1px solid ${T.border}`, position: 'relative',
        }}>
          <CompanyLogo company={company} size="card" />
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Same bargain as the stats cells below: these three lines
                ellipsize, so each keeps its full value on hover. */}
            <div title={company.name} style={{ fontSize: wide ? 20 : 18, fontWeight: 700, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 90 }}>{company.name}</div>
            {getDisplayIndustry(company, '') && getDisplayIndustry(company, '').toLowerCase() !== 'unknown' && (
              <div title={getDisplayIndustry(company, '')} style={{ fontSize: 11, color: T.textMuted, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {getDisplayIndustry(company, '')}
              </div>
            )}
            {hqLocation && hqLocation.toLowerCase() !== 'unknown' && (
              <div title={hqLocation} style={{ fontSize: 10, color: T.textFaint, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <MapPin size={10} style={{ flexShrink: 0 }} />{hqLocation}
              </div>
            )}
          </div>
          <div style={{
            position: 'absolute', top: 12, right: 14, zIndex: 6,
            fontSize: 9, color: confColor, fontWeight: 700, letterSpacing: 1,
            padding: '3px 8px', background: `${confColor}18`, borderRadius: 5,
            border: `1px solid ${confColor}40`,
          }}>
            {confidence} confidence
          </div>
        </div>

        {/* Stats grid — 3 rows: Industry/Employees, Revenue/Founded, HQ/CEO */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: `1px solid ${T.border}` }}>
          {[
            ['INDUSTRY',  getDisplayIndustry(company)],
            ['EMPLOYEES', company.employee_count || company.company_size || 'N/A'],
            ['REVENUE',   company.revenue || 'N/A'],
            ['FOUNDED',   company.founded_year || 'N/A'],
            ['HQ',        hqLocation || '—'],
            ['CEO',       ceoName || '—'],
          ].map(([l, v]) => {
            // A value too long for its cell is cut by the ellipsis on the line
            // below, which says it was cut but not what was cut. The full
            // string stays reachable on hover and to a screen reader; '—' and
            // 'N/A' are already whole, so they carry no tooltip.
            const full = (v === '—' || v === 'N/A' || v == null) ? undefined : String(v);
            return (
              // `minWidth: 0` so that ellipsis governs. A grid item's automatic
              // minimum is its content, and the value line is
              // `white-space: nowrap`, so a long CEO name widened the right
              // column past the card — ~4px at 360px wide, which the card's
              // clipping now cuts instead of scrolling sideways.
              <div key={l} style={{ minWidth: 0, padding: wide ? '10px 18px' : '8px 14px', borderRight: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 9, letterSpacing: 2, color: T.textFaint, marginBottom: 2 }}>{l}</div>
                <div title={full} style={{ fontSize: wide ? 12 : 11, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div>
              </div>
            );
          })}
        </div>

        {/* ICP Score row — clickable to expand breakdown */}
        <div
          onClick={() => breakdown && setShowBreakdown(p => !p)}
          style={{
            padding: wide ? '10px 18px' : '8px 14px', borderBottom: `1px solid ${T.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: breakdown ? 'pointer' : 'default',
            background: showBreakdown ? T.surface : 'transparent',
          }}
        >
          <div>
            <div style={{ fontSize: 9, letterSpacing: 2, color: T.textFaint, marginBottom: 2 }}>ICP MATCH SCORE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: wide ? 20 : 18, fontWeight: 800, color: sc }}>{score}</span>
              <span style={{ fontSize: 10, color: T.textFaint }}>/100</span>
              <span style={{
                fontSize: 9, color: sc, fontWeight: 700,
                padding: '2px 7px', background: `${sc}15`, borderRadius: 5,
                border: `1px solid ${sc}40`,
              }}>{scoreLabel}</span>
            </div>
          </div>
          {breakdown && (
            <div style={{ fontSize: 10, color: T.textFaint, display: 'flex', alignItems: 'center', gap: 3 }}>
              Details
              <ChevronDown size={12} style={{ transform: showBreakdown ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </div>
          )}
        </div>

        {/* ICP Factor Pills — always visible */}
        {factorPills.length > 0 && (
          <div style={{
            padding: wide ? '8px 18px' : '6px 14px',
            borderBottom: `1px solid ${T.border}`,
            display: 'flex', flexWrap: 'wrap', gap: 5,
          }}>
            {factorPills.map(({ key, label, data }) => {
              // G1-06: three visual states. `unknown` is deliberately NOT red —
              // we did not evaluate this dimension, so showing it as a failed
              // match would assert something we never checked.
              const pillColor = data.unknown ? T.textFaint
                : data.match === 100 ? STATUS.green
                : data.match === 50 ? STATUS.amber
                : STATUS.red;
              const symbol = data.unknown ? '–'
                : data.match === 100 ? '✓'
                : data.match === 50 ? '≈'
                : '✗';
              return (
                <span
                  key={key}
                  title={data.unknown
                    ? `${label}: no data available for this company — not included in the score`
                    : `${label}: ${data.match}% match`}
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    padding: '2px 7px',
                    borderRadius: 7,
                    background: data.unknown ? 'transparent' : `${pillColor}18`,
                    border: `1px ${data.unknown ? 'dashed' : 'solid'} ${pillColor}${data.unknown ? '55' : '30'}`,
                    color: pillColor,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label} {symbol}{data.unknown ? ' n/a' : ''}
                </span>
              );
            })}
            {coverageNote && (
              <span style={{ fontSize: 9, color: T.textFaint, alignSelf: 'center', marginLeft: 2 }}>
                {coverageNote}
              </span>
            )}
          </div>
        )}

        {/* Score breakdown — expanded */}
        {showBreakdown && breakdown && (
          <div style={{
            padding: wide ? '10px 18px' : '8px 14px', borderBottom: `1px solid ${T.border}`,
            background: T.surface, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
          }}>
            {[
              ['Industry', breakdown.industry],
              ['Location', breakdown.location],
              ['Size', breakdown.employeeSize],
              ['Revenue', breakdown.revenue],
            ].map(([label, data]) => {
              const matchColor = data.match === 100 ? STATUS.green : data.match === 50 ? STATUS.amber : STATUS.red;
              return (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10 }}>
                  <span style={{ color: matchColor, fontWeight: 700, fontSize: 12, lineHeight: 1 }}>
                    {data.match === 100 ? '✓' : data.match === 50 ? '≈' : '✗'}
                  </span>
                  <span style={{ color: T.textMuted }}>{label}</span>
                  <span style={{ marginLeft: 'auto', color: T.textFaint, fontWeight: 600 }}>{data.contribution}pt</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Barry Intel */}
        <div style={{ padding: wide ? '12px 18px' : '10px 14px', borderBottom: `1px solid ${T.border}`, background: T.accentBg }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
            <BarryAvatar size={18} />
            <span style={{ fontSize: 9, letterSpacing: 2, color: BRAND.pink, fontWeight: 700 }}>BARRY INTEL</span>
          </div>
          <p style={{ margin: 0, fontSize: wide ? 12 : 11, color: T.isDark ? '#d0a0c0' : T.textMuted, lineHeight: 1.6 }}>
            {barryText}
          </p>
        </div>

        {/* Action links */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: wide ? '11px 14px' : '9px 12px', borderBottom: `1px solid ${T.border}` }}>
          <a
            href={company.website_url || undefined}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => { e.stopPropagation(); if (!company.website_url) e.preventDefault(); }}
            style={{ padding: wide ? '9px 10px' : 7, borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#7c5ce4,#6c4fd6)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: company.website_url ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, textDecoration: 'none', opacity: company.website_url ? 1 : 0.5 }}
          ><Globe size={12} />Website</a>
          <a
            href={company.linkedin_url || undefined}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => { e.stopPropagation(); if (!company.linkedin_url) e.preventDefault(); }}
            style={{ padding: wide ? '9px 10px' : 7, borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#0077b5,#005e94)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: company.linkedin_url ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, textDecoration: 'none', opacity: company.linkedin_url ? 1 : 0.5 }}
          ><Linkedin size={12} />LinkedIn</a>
        </div>

        {/* Decision buttons */}
        <div style={{ display: 'flex', gap: 8, padding: wide ? '12px 14px 14px' : '10px 12px 12px' }}>
          <button
            onClick={handleRejectClick}
            style={{ flex: 1, padding: wide ? 12 : 10, borderRadius: 11, border: `1.5px solid ${STATUS.red}40`, background: `${STATUS.red}0c`, color: STATUS.red, fontSize: wide ? 13 : 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          ><X size={14} />Not a Match</button>
          <button
            onClick={handleMatchClick}
            style={{ flex: 1, padding: wide ? 12 : 10, borderRadius: 11, border: `1.5px solid ${STATUS.green}40`, background: `${STATUS.green}0c`, color: STATUS.green, fontSize: wide ? 13 : 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          ><Check size={14} />This is a Match</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', padding: wide ? '6px 16px 8px' : '4px 12px 6px' }}>
          <button
            onClick={handleSkipClick}
            style={{ padding: '6px 14px', borderRadius: 10, border: 'none', background: 'transparent', color: T.textFaint, fontSize: 11, cursor: 'pointer' }}
          >⊙ Skip for now</button>
        </div>
      </div>
    </div>
  );
}

// ─── PersonSwipeCard ──────────────────────────────────────────────────────────
export function PersonSwipeCard({ person, company, matchText, onAccept, onReject, onSkip, wide = false }) {
  const T = useT();
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [gone, setGone] = useState(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackReasons, setFeedbackReasons] = useState([]);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [showRejectionFeedback, setShowRejectionFeedback] = useState(false);
  const [rejectionReasons, setRejectionReasons] = useState([]);
  const [rejectionNote, setRejectionNote] = useState('');
  const [isFlipping, setIsFlipping] = useState(false);
  const s = useRef(null);

  // One card, one decision — same latch, same reason as CompanySwipeCard above.
  // The person path writes its own lineage events (recordPersonDecision), so an
  // unguarded `up()` double-counts people exactly as it double-counted companies.
  const decidedRef = useRef(false);
  const commit = (run) => {
    if (decidedRef.current) return;
    decidedRef.current = true;
    run();
  };

  // ── Which card this decision was made ON ────────────────────────────────────
  // Identical deferral to CompanySwipeCard, identical reason: the callbacks wait
  // out a 280ms exit animation during which the page holds no lock, so a
  // deferred decision must name its own subject rather than trust whoever is
  // current when it finally runs. The id is the contact's composite key, which
  // is also what the card is keyed by — fixed for the life of the mount.
  const subjectId = `${company.id}_${person.id}`;

  const xy = e => e.touches ? [e.touches[0].clientX, e.touches[0].clientY] : [e.clientX, e.clientY];
  const down = e => { if (decidedRef.current) return; s.current = xy(e); };
  const move = e => {
    if (!s.current) return;
    const [cx, cy] = xy(e);
    setDx(cx - s.current[0]);
    setDy(cy - s.current[1]);
  };
  const up = () => {
    const pressed = s.current;
    s.current = null;
    if (!pressed) return;
    if (dx > 100) commit(() => { setGone('r'); setTimeout(() => onAccept(null, subjectId), 280); });
    else if (dx < -100) commit(() => { setGone('l'); setTimeout(() => onReject(null, subjectId), 280); });
    else { setDx(0); setDy(0); }
  };

  const handleMatchClick = (e) => {
    e.stopPropagation();
    if (decidedRef.current) return;
    setIsFlipping(true);
    setTimeout(() => { setShowFeedback(true); setIsFlipping(false); }, 140);
  };
  const handleSkipFeedback = () => commit(() => { setGone('r'); setTimeout(() => onAccept(null, subjectId), 280); });
  const handleSendFeedback = () => commit(() => { setGone('r'); setTimeout(() => onAccept({ reasons: feedbackReasons, note: feedbackNote }, subjectId), 280); });

  const handleRejectClick = (e) => {
    e.stopPropagation();
    if (decidedRef.current) return;
    setIsFlipping(true);
    setTimeout(() => { setShowRejectionFeedback(true); setIsFlipping(false); }, 140);
  };
  const handleSkipRejectionFeedback = () => commit(() => { setGone('l'); setTimeout(() => onReject(null, subjectId), 280); });
  const handleSendRejectionFeedback = () => commit(() => { setGone('l'); setTimeout(() => onReject({ reasons: rejectionReasons, note: rejectionNote }, subjectId), 280); });

  const tx = gone === 'r' ? 700 : gone === 'l' ? -700 : dx;
  const initials = (person.name || person.first_name || '??').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const color = BRAND.pink;

  return (
    <div
      onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up}
      onTouchStart={down} onTouchMove={move} onTouchEnd={up}
      style={{
        // See CompanySwipeCard: in flow so the card's content sets its height.
        position: 'relative', width: '100%', maxWidth: wide ? CARD_MAX_W : 420,
        transform: `translateX(${tx}px) translateY(${dy}px) rotate(${dx * 0.055}deg)`,
        transition: gone || Math.abs(dx) < 5 ? 'all 0.28s ease' : 'none',
        opacity: gone ? 0 : 1, cursor: 'grab', userSelect: 'none',
        touchAction: 'pan-y',
        margin: '0 auto',
      }}
    >
      {dx > 30 && (
        <div style={{ position: 'absolute', top: 22, left: 16, zIndex: 10, padding: '5px 13px', borderRadius: 8, border: `3px solid ${STATUS.green}`, color: STATUS.green, fontSize: 13, fontWeight: 700, transform: 'rotate(-11deg)', background: `${STATUS.green}10` }}>✓ IT'S A MATCH</div>
      )}
      {dx < -30 && (
        <div style={{ position: 'absolute', top: 22, right: 16, zIndex: 10, padding: '5px 13px', borderRadius: 8, border: `3px solid ${STATUS.red}`, color: STATUS.red, fontSize: 13, fontWeight: 700, transform: 'rotate(11deg)', background: `${STATUS.red}10` }}>✗ NOT A MATCH</div>
      )}
      <div style={{ position: 'relative', background: T.cardBg, border: `1px solid ${T.border2}`, borderRadius: 22, overflow: 'hidden', boxShadow: `0 28px 70px ${T.isDark ? '#00000099' : '#00000018'}`, transform: isFlipping ? 'scaleX(0)' : 'scaleX(1)', transition: 'transform 0.14s ease' }}>
        {showFeedback && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 30, background: T.cardBg, borderRadius: 22, overflowY: 'auto' }}>
            <FeedbackFace
              entityName={person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim()}
              reasons={feedbackReasons} setReasons={setFeedbackReasons}
              note={feedbackNote} setNote={setFeedbackNote}
              onSkip={handleSkipFeedback} onSubmit={handleSendFeedback}
              T={T} wide={wide}
            />
          </div>
        )}
        {/* Rejection feedback overlay — appears after "Not a Match" click */}
        {showRejectionFeedback && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 30, background: T.cardBg, borderRadius: 22, overflowY: 'auto' }}>
            <RejectionFeedbackFace
              entityName={person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim()}
              reasons={rejectionReasons} setReasons={setRejectionReasons}
              note={rejectionNote} setNote={setRejectionNote}
              onSkip={handleSkipRejectionFeedback} onSubmit={handleSendRejectionFeedback}
              T={T} wide={wide}
            />
          </div>
        )}
        <div style={{ padding: wide ? '22px 28px 16px' : '18px 22px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', background: T.cardBg2, borderBottom: `1px solid ${T.border}` }}>
          <Av initials={initials} color={color} size={wide ? 80 : 70} />
          {matchText && (
            <div style={{ marginTop: 12, background: `${STATUS.green}15`, border: `1px solid ${STATUS.green}40`, borderRadius: 8, padding: '4px 16px', color: STATUS.green, fontSize: wide ? 12 : 11, fontWeight: 600, marginBottom: 12, width: '88%', textAlign: 'center' }}>
              {matchText}
            </div>
          )}
          <div style={{ fontSize: wide ? 22 : 20, fontWeight: 700, color: T.text }}>{person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim()}</div>
          <div style={{ fontSize: wide ? 14 : 13, color: T.textMuted, marginTop: 3 }}>{person.title}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: `1px solid ${T.border}` }}>
          {[
            ['COMPANY',   company?.name || person.company_name || 'N/A'],
            ['INDUSTRY',  getDisplayIndustry(company) !== 'N/A' ? getDisplayIndustry(company) : (person.industry || 'N/A')],
            ['EMPLOYEES', company?.employee_count || company?.company_size || 'N/A'],
            ['LOCATION',  person.city ? `${person.city}${person.state ? ', ' + person.state : ''}` : 'N/A'],
          ].map(([l, v]) => (
            <div key={l} style={{ padding: wide ? '13px 20px' : '10px 15px', borderRight: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 9, letterSpacing: 2, color: T.textFaint, marginBottom: 2 }}>{l}</div>
              <div style={{ fontSize: wide ? 13 : 11, color: T.textMuted }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: wide ? '13px 16px' : '11px 12px', borderBottom: `1px solid ${T.border}` }}>
          <a
            href={company?.website_url || person.organization?.website_url || undefined}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => { e.stopPropagation(); if (!(company?.website_url || person.organization?.website_url)) e.preventDefault(); }}
            style={{ padding: wide ? '10px 12px' : 8, borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#7c5ce4,#6c4fd6)', color: '#fff', fontSize: wide ? 12 : 11, fontWeight: 600, cursor: (company?.website_url || person.organization?.website_url) ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, textDecoration: 'none', opacity: (company?.website_url || person.organization?.website_url) ? 1 : 0.5 }}
          ><Globe size={13} />Visit Website</a>
          <a
            href={person.linkedin_url || undefined}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => { e.stopPropagation(); if (!person.linkedin_url) e.preventDefault(); }}
            style={{ padding: wide ? '10px 12px' : 8, borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#0077b5,#005e94)', color: '#fff', fontSize: wide ? 12 : 11, fontWeight: 600, cursor: person.linkedin_url ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, textDecoration: 'none', opacity: person.linkedin_url ? 1 : 0.5 }}
          ><Linkedin size={13} />LinkedIn</a>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: wide ? '13px 16px 6px' : '11px 12px 6px' }}>
          <button
            onClick={handleRejectClick}
            style={{ flex: 1, padding: wide ? 13 : 11, borderRadius: 11, border: `1.5px solid ${STATUS.red}40`, background: `${STATUS.red}0c`, color: STATUS.red, fontSize: wide ? 14 : 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
          ><X size={15} />Not a Match</button>
          <button
            onClick={handleMatchClick}
            style={{ flex: 1, padding: wide ? 13 : 11, borderRadius: 11, border: `1.5px solid ${STATUS.green}40`, background: `${STATUS.green}0c`, color: STATUS.green, fontSize: wide ? 14 : 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
          ><Check size={15} />This is a Match</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', padding: wide ? '6px 16px 8px' : '4px 12px 6px' }}>
          <button
            onClick={e => { e.stopPropagation(); commit(() => onSkip(subjectId)); }}
            style={{ padding: '6px 14px', borderRadius: 10, border: 'none', background: 'transparent', color: T.textFaint, fontSize: 11, cursor: 'pointer' }}
          >⊙ Skip for Today</button>
        </div>
        <div style={{ textAlign: 'center', padding: '4px 0 12px', fontSize: 10, color: T.textGhost }}>
          Drag left or right, or use the buttons above
        </div>
      </div>
    </div>
  );
}

// ─── QueueListPanel ───────────────────────────────────────────────────────────
export function QueueListPanel({ companies, currentIndex, rejectedIds, onJumpTo, onClose, mobile = false, returnFocusRef = null }) {
  const T = useT();
  const upcoming = companies.slice(currentIndex);
  const rejected = companies.filter(c => rejectedIds.includes(c.id));

  // ── Dismissal (desktop only) ───────────────────────────────────────────────
  // The mobile sheet already has a backdrop that closes it; the desktop sidebar
  // has none, so outside-interaction and Escape are wired up here.
  const panelRef = useRef(null);
  // Closing runs through a ref so the listeners are attached once per open,
  // not re-bound on every parent re-render (an inline onClose is a new function
  // each time, and a mid-drag re-bind would lose the drag origin below).
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  const pendingCloseRef = useRef(false);

  useEffect(() => {
    if (mobile) return undefined;

    const isInside = (target) => {
      if (!(target instanceof Node)) return false;
      if (panelRef.current?.contains(target)) return true;
      const el = target instanceof Element ? target : target.parentElement;
      // The trigger counts as inside: it owns the toggle, so the document
      // listener must not also fire and turn one click into close-then-reopen.
      // [data-queue-panel] keeps any portalled panel content inside too.
      return !!el?.closest?.('[data-queue-panel],[data-queue-trigger]');
    };

    // pointerdown records where the interaction began; the close decision waits
    // for pointerup so a drag started inside (selecting text) and released
    // outside leaves the panel open.
    const onPointerDown = (e) => { pendingCloseRef.current = !isInside(e.target); };
    const onPointerUp = (e) => {
      const shouldClose = pendingCloseRef.current && !isInside(e.target);
      pendingCloseRef.current = false;
      // No focus is moved here — the outside click already picked its target.
      if (shouldClose) onCloseRef.current?.();
    };
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      onCloseRef.current?.();
      returnFocusRef?.current?.focus?.();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('keydown', onKeyDown);
      pendingCloseRef.current = false;
    };
  }, [mobile, returnFocusRef]);

  if (mobile) {
    // Bottom-sheet overlay for mobile
    return (
      <>
        {/* Backdrop */}
        <div
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 490,
            background: 'rgba(0,0,0,0.45)',
            animation: 'fadeIn 0.18s ease',
          }}
        />
        {/* Sheet */}
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 500,
          background: T.cardBg, borderTop: `1px solid ${T.border}`,
          borderRadius: '16px 16px 0 0',
          display: 'flex', flexDirection: 'column',
          maxHeight: '70vh',
          boxShadow: `0 -8px 32px ${T.isDark ? '#00000060' : '#00000018'}`,
          animation: 'slideUpSheet 0.22s ease',
        }}>
          {/* Drag handle */}
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: T.border2 }} />
          </div>
          {/* Header */}
          <div style={{ padding: '8px 18px 10px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>Queue</div>
              <div style={{ fontSize: 10, color: T.textFaint }}>{upcoming.length} remaining</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, fontSize: 20, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ overflowY: 'auto', flex: 1, paddingBottom: 16 }}>
            <div style={{ padding: '8px 0' }}>
              {upcoming.map((co, i) => (
                <div
                  key={co.id}
                  onClick={() => { onJumpTo(currentIndex + i); onClose(); }}
                  style={{
                    padding: '9px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                    borderBottom: `1px solid ${T.border}`,
                    background: i === 0 ? T.accentBg : 'transparent',
                  }}
                >
                  <CompanyLogo company={co} size="small" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: i === 0 ? 700 : 500, color: i === 0 ? BRAND.pink : T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {i === 0 && '▶ '}{co.name}
                    </div>
                    <div style={{ fontSize: 10, color: T.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getDisplayIndustry(co, '—')}</div>
                  </div>
                  <ScorePip score={co.fit_score ?? co.score ?? null} />
                </div>
              ))}
              {upcoming.length === 0 && (
                <div style={{ padding: '24px 18px', textAlign: 'center', color: T.textFaint, fontSize: 12 }}>Queue is empty</div>
              )}
            </div>
            {rejected.length > 0 && (
              <>
                <div style={{ padding: '8px 18px 4px', fontSize: 9, letterSpacing: 2, color: T.textFaint, fontWeight: 700, borderTop: `1px solid ${T.border}` }}>
                  NOT A MATCH THIS SESSION
                </div>
                {rejected.map(co => (
                  <div
                    key={co.id}
                    onClick={() => { const idx = companies.findIndex(c => c.id === co.id); if (idx >= 0) { onJumpTo(idx); onClose(); } }}
                    style={{ padding: '9px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${T.border}`, opacity: 0.7 }}
                  >
                    <CompanyLogo company={co} size="small" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{co.name}</div>
                      <div style={{ fontSize: 10, color: T.textFaint }}>Re-review</div>
                    </div>
                    <ScorePip score={co.fit_score ?? co.score ?? null} />
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <div ref={panelRef} data-queue-panel style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 320, maxWidth: '100vw', zIndex: 500,
      background: T.cardBg, borderLeft: `1px solid ${T.border}`,
      display: 'flex', flexDirection: 'column',
      boxShadow: `-8px 0 32px ${T.isDark ? '#00000060' : '#00000018'}`,
      animation: 'slideIn 0.2s ease',
    }}>
      {/* Header */}
      <div style={{ padding: '16px 18px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>Queue</div>
          <div style={{ fontSize: 10, color: T.textFaint }}>{upcoming.length} remaining</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, fontSize: 20, lineHeight: 1 }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Upcoming */}
        <div style={{ padding: '10px 0' }}>
          {upcoming.map((co, i) => (
            <div
              key={co.id}
              onClick={() => { onJumpTo(currentIndex + i); onClose(); }}
              style={{
                padding: '9px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                borderBottom: `1px solid ${T.border}`,
                background: i === 0 ? T.accentBg : 'transparent',
              }}
              onMouseEnter={e => { if (i !== 0) e.currentTarget.style.background = T.surface; }}
              onMouseLeave={e => { if (i !== 0) e.currentTarget.style.background = 'transparent'; }}
            >
              <CompanyLogo company={co} size="small" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: i === 0 ? 700 : 500, color: i === 0 ? BRAND.pink : T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {i === 0 && '▶ '}{co.name}
                </div>
                <div style={{ fontSize: 10, color: T.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getDisplayIndustry(co, '—')}</div>
              </div>
              <ScorePip score={co.fit_score ?? co.score ?? null} />
            </div>
          ))}
          {upcoming.length === 0 && (
            <div style={{ padding: '24px 18px', textAlign: 'center', color: T.textFaint, fontSize: 12 }}>Queue is empty</div>
          )}
        </div>

        {/* Rejected */}
        {rejected.length > 0 && (
          <>
            <div style={{ padding: '8px 18px 4px', fontSize: 9, letterSpacing: 2, color: T.textFaint, fontWeight: 700, borderTop: `1px solid ${T.border}` }}>
              NOT A MATCH THIS SESSION
            </div>
            {rejected.map(co => (
              <div
                key={co.id}
                onClick={() => { const idx = companies.findIndex(c => c.id === co.id); if (idx >= 0) { onJumpTo(idx); onClose(); } }}
                style={{
                  padding: '9px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                  borderBottom: `1px solid ${T.border}`, opacity: 0.7,
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = T.surface; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.background = 'transparent'; }}
              >
                <CompanyLogo company={co} size="small" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{co.name}</div>
                  <div style={{ fontSize: 10, color: T.textFaint }}>Re-review</div>
                </div>
                <ScorePip score={co.fit_score ?? co.score ?? null} />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ─── SessionSummaryScreen ─────────────────────────────────────────────────────
function SessionSummaryScreen({ reviewed, saved, rejected, streak, savedCompanies, onViewSaved, onDismiss, onRefresh, isRefreshing }) {
  const T = useT();
  const matchRate = reviewed > 0 ? Math.round((saved / reviewed) * 100) : 0;
  // Only a measured, qualifying score earns the badge. On a queue where nothing
  // was scored there is no best, and pickTopMatch returns null rather than
  // promoting whichever company happened to be first.
  const topMatch = pickTopMatch(savedCompanies);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 24px', maxWidth: 420, width: '100%', animation: 'slideUp 0.3s ease' }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>🎯</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 4 }}>Session Complete</div>
      <div style={{ fontSize: 12, color: T.textFaint, marginBottom: 24 }}>Here's how you did</div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, width: '100%', marginBottom: 20 }}>
        {[
          ['Reviewed', reviewed, T.text, T.surface],
          ['Saved', saved, BRAND.pink, T.accentBg],
          ['Not a match', rejected, T.textMuted, T.surface],
          ['Match Rate', `${matchRate}%`, STATUS.green, `${STATUS.green}10`],
        ].map(([label, value, color, bg]) => (
          <div key={label} style={{ padding: '12px 14px', background: bg, borderRadius: 12, border: `1px solid ${T.border2}`, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
            <div style={{ fontSize: 10, color: T.textFaint, marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Top match */}
      {topMatch && (
        <div style={{ width: '100%', padding: '12px 14px', background: T.surface, borderRadius: 12, border: `1px solid ${T.border2}`, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <CompanyLogo company={topMatch} size="default" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, letterSpacing: 1.5, color: T.textFaint, marginBottom: 2 }}>TOP MATCH</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{topMatch.name}</div>
            <div style={{ fontSize: 10, color: T.textFaint }}>{topMatch.industry || '—'}</div>
          </div>
          {/* pickTopMatch only ever returns a measured, qualifying score, so
              there is no unscored case to render here. */}
          <div style={{ fontSize: 18, fontWeight: 800, color: STATUS.green, flexShrink: 0 }}>{topMatch.fit_score}</div>
        </div>
      )}

      {/* Streak */}
      {streak > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, padding: '8px 16px', background: `${STATUS.amber}18`, borderRadius: 20, border: `1px solid ${STATUS.amber}40` }}>
          <Flame size={16} color={STATUS.amber} />
          <span style={{ fontSize: 12, fontWeight: 700, color: STATUS.amber }}>{streak}-day streak</span>
        </div>
      )}

      {/* CTAs */}
      {saved > 0 && (
        <button
          onClick={onViewSaved}
          style={{ width: '100%', padding: 13, borderRadius: 12, background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, border: 'none', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 }}
        >
          <Trophy size={16} />View {saved} Saved Companies
        </button>
      )}
      <button
        onClick={onRefresh}
        disabled={isRefreshing}
        style={{ width: '100%', padding: 12, borderRadius: 12, background: T.surface, border: `1px solid ${T.border2}`, color: T.textMuted, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}
      >
        {isRefreshing ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />}
        Find More Targets
      </button>
      <button
        onClick={onDismiss}
        style={{ padding: '8px 20px', borderRadius: 10, background: 'transparent', border: 'none', color: T.textFaint, fontSize: 12, cursor: 'pointer' }}
      >
        Come Back Tomorrow
      </button>
    </div>
  );
}

// ─── BarryNudgeCard ───────────────────────────────────────────────────────────
function BarryNudgeCard({ industry, count, onAccept, onDismiss }) {
  const T = useT();
  return (
    <div style={{
      position: 'absolute', bottom: -10, left: '50%', transform: 'translateX(-50%)',
      width: '90%', maxWidth: 400, zIndex: 50,
      background: T.cardBg, border: `1px solid ${BRAND.pink}40`,
      borderRadius: 16, padding: '14px 16px',
      boxShadow: `0 8px 32px ${BRAND.pink}30`,
      animation: 'slideUp 0.3s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <BarryAvatar size={32} style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 4 }}>
            I'm noticing a pattern
          </div>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
            {count} of your recent saves are {industry} companies. Want me to weight that higher in your ICP?
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onAccept}
              style={{ flex: 1, padding: '7px 12px', borderRadius: 8, background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, border: 'none', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
            >
              Update ICP
            </button>
            <button
              onClick={onDismiss}
              style={{ padding: '7px 12px', borderRadius: 8, background: T.surface, border: `1px solid ${T.border2}`, color: T.textMuted, fontSize: 11, cursor: 'pointer' }}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DailyLeads ──────────────────────────────────────────────────────────────
// ─── ICP Reclarification Modal ────────────────────────────────────────────────
function IcpReclarificationModal({ userId, icpId, onClose, onSearchComplete, reconConfidence }) {
  const T = useT();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasEnoughContext, setHasEnoughContext] = useState(false);
  const [icpParams, setIcpParams] = useState(null);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => { sendToBarry('__ICP_RECLARIFICATION__', []); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const sendToBarry = async (msg, history) => {
    setLoading(true);
    try {
      const user = getEffectiveUser();
      if (!user) return;
      const authToken = await user.getIdToken();
      const res = await fetch('/.netlify/functions/barryMissionChat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, authToken, message: msg, conversationHistory: history, icpMode: true }),
      });
      const data = await res.json();
      if (data.success) {
        setMessages(prev => [...prev, { role: 'barry', content: data.response_text }]);
        const newHistory = [
          ...history,
          ...(msg !== '__ICP_RECLARIFICATION__' ? [{ role: 'user', content: msg }] : []),
          { role: 'assistant', content: data.response_text },
        ];
        setConversationHistory(newHistory);
        if (data.has_enough_context) {
          setHasEnoughContext(true);
          setIcpParams(data.icp_params);
        }
      }
    } catch (err) {
      console.error('ICP chat error:', err);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    sendToBarry(userMsg, conversationHistory);
  };

  const handleFindCompanies = async () => {
    if (!icpParams || isSearching) return;
    setIsSearching(true);
    try {
      const user = getEffectiveUser();
      if (!user) { onSearchComplete(); return; }
      // This refines an ICP the user already has. It never creates one, and it
      // never searches without an identity to attribute the results to.
      const resolution = await resolveActiveIcp(user.uid);
      if (!isResolved(resolution)) {
        console.warn(`[IcpReclarificationModal] refinement skipped — ICP unresolved (${resolution.reason})`);
        onSearchComplete();
        return;
      }
      // The modal was opened against the ICP the queue was showing. If the
      // active ICP changed underneath it, write to the resolved one — never to
      // a stale id the user is no longer looking at.
      if (icpId && icpId !== resolution.icpId) {
        console.warn(`[IcpReclarificationModal] active ICP changed ${icpId} → ${resolution.icpId}`);
      }
      const authToken = await user.getIdToken();
      const mergedProfile = {
        ...resolution.profile,
        ...(icpParams.industries?.length > 0 && { industries: icpParams.industries }),
        ...(icpParams.companySizes?.length > 0 && { companySizes: icpParams.companySizes }),
        ...(icpParams.targetTitles?.length > 0 && { targetTitles: icpParams.targetTitles }),
        ...(icpParams.companyKeywords?.length > 0 && { companyKeywords: icpParams.companyKeywords }),
        updatedAt: new Date().toISOString(),
        managedByBarry: true,
      };
      // Authoritative first, then the projection carrying its identity. The
      // refinement used to be written to the bridge only, so the next
      // activation of any ICP silently reverted it.
      await setDoc(doc(db, 'users', user.uid, 'icpProfiles', resolution.icpId), mergedProfile, { merge: true });
      await setDoc(doc(db, 'users', user.uid, 'companyProfile', 'current'), {
        ...mergedProfile,
        icpId: resolution.icpId,
        icpIdSource: 'icp-chat-refinement',
      });
      await fetch('/.netlify/functions/search-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, authToken, companyProfile: mergedProfile, icpId: resolution.icpId, reconConfidence }),
      });
    } catch (err) {
      console.error('ICP search error:', err);
    } finally {
      onSearchComplete();
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.88)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 460,
        background: T.cardBg,
        borderRadius: 20,
        border: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column',
        maxHeight: '82vh',
        overflow: 'hidden',
        boxShadow: `0 24px 64px rgba(0,0,0,0.5)`,
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        }}>
          <BarryAvatar size={36} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.text }}>Barry</div>
            <div style={{ fontSize: 11, color: T.textFaint }}>Let's find the right targets</div>
          </div>
          <button
            onClick={onClose}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, fontSize: 22, lineHeight: 1, padding: 4 }}
          >×</button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 8, alignItems: 'flex-end' }}>
              {msg.role === 'barry' && <BarryAvatar size={26} style={{ flexShrink: 0 }} />}
              <div style={{
                maxWidth: '80%',
                padding: '10px 14px',
                borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: msg.role === 'user' ? `linear-gradient(135deg,${BRAND.pink},#c0146a)` : T.surface,
                color: msg.role === 'user' ? '#fff' : T.text,
                fontSize: 13, lineHeight: 1.55,
                border: msg.role === 'barry' ? `1px solid ${T.border2}` : 'none',
              }}>
                {msg.content}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarryAvatar size={26} style={{ flexShrink: 0 }} />
              <div style={{ padding: '10px 14px', borderRadius: '16px 16px 16px 4px', background: T.surface, border: `1px solid ${T.border2}` }}>
                <Loader size={14} color={BRAND.pink} style={{ animation: 'spin 1s linear infinite' }} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Find Companies CTA */}
        {hasEnoughContext && (
          <div style={{ padding: '0 20px 12px', flexShrink: 0 }}>
            <button
              onClick={handleFindCompanies}
              disabled={isSearching}
              style={{
                width: '100%', padding: '13px',
                borderRadius: 12,
                background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`,
                border: 'none', color: '#fff',
                fontWeight: 700, fontSize: 14,
                cursor: isSearching ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: isSearching ? 0.75 : 1,
              }}
            >
              {isSearching ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <ArrowRight size={16} />}
              {isSearching ? 'Finding your companies...' : 'Find My Companies'}
            </button>
          </div>
        )}

        {/* Input — never disabled while Barry is typing so users can type ahead */}
        <div style={{ padding: hasEnoughContext ? '0 20px 16px' : '12px 20px', borderTop: hasEnoughContext ? 'none' : `1px solid ${T.border}`, display: 'flex', gap: 8, flexShrink: 0 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder={loading ? 'Barry is thinking…' : hasEnoughContext ? 'Anything else to add...' : 'Tell Barry who you\'re targeting...'}
            disabled={isSearching}
            style={{
              flex: 1, padding: '10px 14px',
              borderRadius: 10, border: `1px solid ${T.border2}`,
              background: T.surface, color: T.text,
              fontSize: 13, outline: 'none',
              opacity: isSearching ? 0.5 : 1,
            }}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim() || isSearching}
            style={{
              padding: '10px 14px', borderRadius: 10,
              background: hasEnoughContext ? T.surface : `linear-gradient(135deg,${BRAND.pink},#c0146a)`,
              border: hasEnoughContext ? `1px solid ${T.border2}` : 'none',
              color: hasEnoughContext ? T.textMuted : '#fff',
              cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              opacity: loading || !input.trim() ? 0.5 : 1,
            }}
          >
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function LayoutDebugOverlay({ isDesktop }) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    const measure = () => {
      const r = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return `L${Math.round(b.left)} R${Math.round(b.right)} W${Math.round(b.width)}`;
      };
      setInfo({
        vw: window.innerWidth,
        vh: window.innerHeight,
        dpr: window.devicePixelRatio,
        docW: document.documentElement.scrollWidth,
        isDesktop,
        mql768: window.matchMedia('(max-width: 768px)').matches,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    const id = setInterval(measure, 2000);
    return () => { window.removeEventListener('resize', measure); clearInterval(id); };
  }, [isDesktop]);

  if (!info) return null;
  const lines = [
    `vw:${info.vw} vh:${info.vh} dpr:${info.dpr}`,
    `docW:${info.docW} overflow:${info.overflow}`,
    `isDesktop:${info.isDesktop} mql768:${info.mql768}`,
  ];
  return (
    <div style={{
      position: 'fixed', top: 4, right: 4, zIndex: 9999,
      background: 'rgba(0,0,0,0.85)', color: '#0f0',
      fontFamily: 'monospace', fontSize: 9, lineHeight: 1.4,
      padding: '6px 8px', borderRadius: 6,
      pointerEvents: 'none', maxWidth: 220,
      whiteSpace: 'pre',
    }}>
      {lines.join('\n')}
    </div>
  );
}

export default function DailyLeads({ onNavigate }) {
  const T = useT();
  const navigate = useNavigate();

  // ── Responsive state ────────────────────────────────────────────────────────
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024);
  // The ICP chips ride the title line only where that line has room for them:
  // 1280px, the same width at which the shell's own top bar changes. Between
  // 1024 and 1280 the title alone eats the line, and inlined chips end up a
  // one-chip scroll strip — so there they keep a row of their own.
  const [isWide, setIsWide] = useState(() => window.innerWidth >= 1280);
  useEffect(() => {
    const handler = () => {
      setIsDesktop(window.innerWidth >= 1024);
      setIsWide(window.innerWidth >= 1280);
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // ── Company Mode state ──────────────────────────────────────────────────────
  const [companies, setCompanies] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showTitleSetup, setShowTitleSetup] = useState(false);
  const [hasSeenTitleSetup, setHasSeenTitleSetup] = useState(false);
  const [dailySwipeCount, setDailySwipeCount] = useState(0);
  const [totalAcceptedCompanies, setTotalAcceptedCompanies] = useState(0);
  const [lastSwipeDate, setLastSwipeDate] = useState('');
  const [lastSwipe, setLastSwipe] = useState(null);
  const [showUndo, setShowUndo] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState('');
  const [barrySearching, setBarrySearching] = useState(false);
  const [actionToast, setActionToast] = useState(null); // { message, type: 'success'|'info' }

  // ── ICP profile (for score breakdown) ───────────────────────────────────────
  const [icpProfile, setIcpProfile] = useState(null);
  const [icpWeights, setIcpWeights] = useState(DEFAULT_WEIGHTS);

  // ── Multi-ICP support ────────────────────────────────────────────────────────
  const [icpList, setIcpList] = useState([]);
  const [activeICPId, setActiveICPId] = useState(null);
  const [icpUnresolvedReason, setIcpUnresolvedReason] = useState(null);
  // Store the full company list (unfiltered by ICP) for re-scoring
  const allCompaniesRef = useRef([]);

  // ── Session stats ────────────────────────────────────────────────────────────
  const [sessionReviewed, setSessionReviewed] = useState(0);
  const [sessionSaved, setSessionSaved] = useState(0);
  const [sessionRejected, setSessionRejected] = useState(0);
  const [sessionSavedCompanies, setSessionSavedCompanies] = useState([]);

  // ── Extended undo history (up to 5) ──────────────────────────────────────────
  const [swipeHistory, setSwipeHistory] = useState([]);
  const [rejectedInSession, setRejectedInSession] = useState([]); // company ids rejected this session
  // The discovery run the queue is being served from. A company skipped in THIS
  // cycle stays hidden; a later run reveals it. Null means "unknown", and the
  // filter then hides nothing — failing toward showing a card is recoverable,
  // hiding one forever is not.
  const [currentCycleId, setCurrentCycleId] = useState(null);
  const undoTimerRef = useRef(null);

  // ── Queue list view ──────────────────────────────────────────────────────────
  const [queueListOpen, setQueueListOpen] = useState(false);
  // Remembers which trigger opened the panel so Escape can hand focus back.
  const queueTriggerRef = useRef(null);
  const toggleQueueList = useCallback((e) => {
    queueTriggerRef.current = e?.currentTarget ?? null;
    setQueueListOpen(o => !o);
  }, []);
  const closeQueueList = useCallback(() => setQueueListOpen(false), []);

  // ── Barry side panel ─────────────────────────────────────────────────────────
  const [barryPanelOpen, setBarryPanelOpen] = useState(false);

  // ── Daily streak ─────────────────────────────────────────────────────────────
  const [streakDays, setStreakDays] = useState(0);
  const [showStreakMilestone, setShowStreakMilestone] = useState(null);

  // ── RECON confidence (scales search queue size) ──────────────────────────────
  const [reconConfidence, setReconConfidence] = useState(0);

  // ── Barry nudge between swipes ───────────────────────────────────────────────
  const [nudgeData, setNudgeData] = useState(null);
  const [showNudge, setShowNudge] = useState(false);
  const [barryNudgeContext, setBarryNudgeContext] = useState(null); // { industry, count }

  // ── Today's saved quick preview ──────────────────────────────────────────────
  const [savedTodayOpen, setSavedTodayOpen] = useState(false);

  // ── Session summary ──────────────────────────────────────────────────────────
  const [showSessionSummary, setShowSessionSummary] = useState(false);

  // ── Keyboard hint ────────────────────────────────────────────────────────────
  const [showKeyHint, setShowKeyHint] = useState(false);

  // Refs for keyboard handler (avoid stale closures)
  const handleSwipeRef = useRef(null);
  const handleUndoRef = useRef(null);

  // ── Batch Mode state ─────────────────────────────────────────────────────────
  const BATCH_SIZE = 10;
  const [batchSaves, setBatchSaves] = useState(0);
  const [batchSwipeCount, setBatchSwipeCount] = useState(0);
  const [batchSavedCompanies, setBatchSavedCompanies] = useState([]);
  const [showBatchEnd, setShowBatchEnd] = useState(false);
  const [showICPChat, setShowICPChat] = useState(false);
  const [consecutiveZeroBatches, setConsecutiveZeroBatches] = useState(0);
  const [feedbackImpactMsg, setFeedbackImpactMsg] = useState(null);

  // ── People Mode state ───────────────────────────────────────────────────────
  const [tab, setTab] = useState('companies');
  const [peopleQueue, setPeopleQueue] = useState([]);
  const [currentPersonIdx, setCurrentPersonIdx] = useState(0);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [targetTitles, setTargetTitles] = useState([]);
  const [peopleModeEmpty, setPeopleModeEmpty] = useState(null);

  const companyPoolRef = useRef([]);
  const nextCompanyIdxRef = useRef(0);
  const isFetchingPeopleRef = useRef(false);
  const targetTitlesRef = useRef([]);
  const peopleModeInitRef = useRef(false);
  const todayRef = useRef(new Date().toISOString().split('T')[0]);

  const DAILY_SWIPE_LIMIT = 25;

  useEffect(() => { loadTodayLeads(); }, []);

  // ── Keep refs current so keyboard handler never goes stale ──────────────────
  useEffect(() => { handleSwipeRef.current = handleSwipe; });
  useEffect(() => { handleUndoRef.current = handleUndo; });

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      // Never fire when typing in any input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      // Don't fire when modals/panels are open
      if (showTitleSetup || showICPChat || barryPanelOpen || queueListOpen) return;
      // Held keys autorepeat. One press is one decision — the OS repeating the
      // keydown is not the user deciding again. The card's latch cannot help
      // here: this path calls handleSwipe directly and never touches the card.
      if (e.repeat) return;

      if (tab === 'companies' && !showBatchEnd) {
        if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') { e.preventDefault(); handleSwipeRef.current?.('right', null, 'keyboard'); }
        if (e.key === 'ArrowLeft' || e.key === 'j' || e.key === 'J') { e.preventDefault(); handleSwipeRef.current?.('left', null, 'keyboard'); }
        if ((e.key === 'u' || e.key === 'U') && swipeHistory.length > 0) { e.preventDefault(); handleUndoRef.current?.(); }
      }
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setBarryPanelOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, showBatchEnd, showTitleSetup, showICPChat, barryPanelOpen, queueListOpen, swipeHistory.length]);

  // ── Company Mode ────────────────────────────────────────────────────────────

  const loadTodayLeads = async () => {
    try {
      const user = getEffectiveUser();
      if (!user) { navigate('/login'); return; }

      const userSnap = await getDoc(doc(db, 'users', user.uid));
      const barryState = userSnap.exists() ? userSnap.data().barryState : null;
      setBarrySearching(barryState === 'SEARCHING');

      // Load RECON confidence to scale search queue size
      const dashSnap = await getDoc(doc(db, 'dashboards', user.uid));
      if (dashSnap.exists()) setReconConfidence(calculateReconConfidence(dashSnap.data()));

      // Resolve the active ICP through the canonical contract. The queue is an
      // ICP-dependent surface, so it explains the absence rather than inventing
      // an identity — but zero ICPs is a valid state, not a broken account.
      const resolution = await resolveActiveIcp(user.uid);
      const icps = resolution.candidates;
      setIcpList(icps);
      setIcpUnresolvedReason(isResolved(resolution) ? null : resolution.reason);

      let activeProfile = null;
      if (isResolved(resolution)) {
        setActiveICPId(resolution.icpId);
        activeProfile = resolution.profile;
      } else if (resolution.reason === 'none-active' && icps.length > 0) {
        // Continuity only: shown so the queue keeps rendering. Not promoted,
        // not persisted, and never used as the identity of a search.
        setActiveICPId(null);
        activeProfile = icps[0];
      } else {
        setActiveICPId(null);
      }

      if (activeProfile) {
        setIcpProfile(activeProfile);
        if (activeProfile.scoringWeights) setIcpWeights(activeProfile.scoringWeights);
      } else {
        setIcpProfile(null);
        setCompanies([]);
        setLoading(false);
        return;
      }

      // Which discovery run this queue belongs to. Read before the queue query
      // because the skip filter below needs it.
      const progressSnap = await getDoc(doc(db, 'users', user.uid, 'scoutProgress', 'swipes'))
        .catch(() => null);
      const cycleNow = progressSnap?.exists?.() ? (progressSnap.data().currentCycleId ?? null) : null;
      setCurrentCycleId(cycleNow);

      const companiesRef = collection(db, 'users', user.uid, 'companies');
      const q = query(companiesRef, where('status', '==', 'pending'));
      const snapshot = await getDocs(q);
      const allPendingData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      // Filter to companies for the active ICP. Companies with no icpId are legacy (show for all ICPs).
      const activeId = isResolved(resolution) ? resolution.icpId : null;
      const forActiveIcp = activeId
        ? allPendingData.filter(c => !c.icpId || c.icpId === activeId)
        : allPendingData;

      // ── The skip cycle guard ──────────────────────────────────────────────
      // A skipped company keeps `status: 'pending'` on purpose: `pending`
      // already blocks rediscovery, so skip needs no change to
      // DEDUP_BLOCKING_STATUSES and adds nothing to the overwrite exposure.
      // What makes it disappear is this filter, and what makes it come back is
      // the cycle id moving on.
      const companiesData = cycleNow
        ? forActiveIcp.filter(c => c.skippedInCycle !== cycleNow)
        : forActiveIcp;

      // Score companies against active ICP (reasons from the same shared fn)
      const scoredData = companiesData.map(c => ({
        ...c,
        fit_score: calculateICPScore(c, activeProfile, activeProfile.scoringWeights || DEFAULT_WEIGHTS),
        // % of the configured model that was actually measurable on this company
        fit_confidence: computeCoverage(c, activeProfile).complete ? 100
          : Math.round((computeCoverage(c, activeProfile).observed.length
              / Math.max(1, computeCoverage(c, activeProfile).relevant.length)) * 100),
        fit_reasons: generateMatchReasons(c, activeProfile),
      }));
      // Qualifying matches, then unscored by recency, then everything measured
      // below the bar. The G1-06 confidence tie-break still applies within the
      // measured tiers — see utils/fitRanking.
      scoredData.sort(compareByFit);

      // Save the full unfiltered pool so ICP switching can re-filter without re-fetching
      allCompaniesRef.current = allPendingData;
      setCompanies(scoredData);
      setCurrentIndex(0);

      const acceptedQuery = query(companiesRef, where('status', '==', 'accepted'));
      const acceptedSnapshot = await getDocs(acceptedQuery);
      setTotalAcceptedCompanies(acceptedSnapshot.size);

      // Load today's accepted companies for the quick preview
      const today = new Date().toISOString().split('T')[0];
      const todaySaved = acceptedSnapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => c.swipedAt && c.swipedAt.startsWith(today));
      setSessionSavedCompanies(todaySaved);

      const swipeProgressRef = doc(db, 'users', user.uid, 'scoutProgress', 'swipes');
      const swipeProgressDoc = await getDoc(swipeProgressRef);
      if (swipeProgressDoc.exists()) {
        const data = swipeProgressDoc.data();
        if (data.lastSwipeDate === today) setDailySwipeCount(data.dailySwipeCount || 0);
        else setDailySwipeCount(0);
        setLastSwipeDate(data.lastSwipeDate || '');
        setHasSeenTitleSetup(data.hasSeenTitleSetup || false);
      }

      // Load streak
      const streakRef = doc(db, 'users', user.uid, 'scoutProgress', 'streak');
      const streakDoc = await getDoc(streakRef);
      if (streakDoc.exists()) {
        const sd = streakDoc.data();
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        if (sd.lastActiveDate === today || sd.lastActiveDate === yesterday) {
          setStreakDays(sd.currentStreak || 0);
        } else {
          setStreakDays(0);
        }
      }

      // Show keyboard hint once
      const hintSeen = localStorage.getItem('scout_keyhint_seen');
      if (!hintSeen) { setShowKeyHint(true); localStorage.setItem('scout_keyhint_seen', '1'); }

      setLoading(false);
    } catch (error) {
      console.error('Error loading daily leads:', error);
      setLoading(false);
    }
  };

  /**
   * Which ICP a search launched from this screen belongs to.
   *
   * The tab strip lets a user with several ICPs look at any one of them. A
   * search fired while ICP B is on screen belongs to B — writing it against
   * whichever ICP happens to be globally active would tag the results for A,
   * and the queue filter (`!c.icpId || c.icpId === activeId`) would then hide
   * them from the tab that asked for them.
   *
   * Order, with no implicit step:
   *   1. the ICP the user explicitly selected, when it is a real profile in the
   *      loaded list — an explicit selection, not a fallback;
   *   2. otherwise the canonical active-ICP resolver;
   *   3. otherwise nothing. Never candidates[0], never icps[0], never a default.
   *
   * Selecting a tab does not change which ICP is active — that is a separate,
   * deliberate action in ICP Settings. This only decides where a search lands.
   */
  const resolveSearchIcp = useCallback(async (user) => {
    const selected = activeICPId ? icpList.find(i => i.id === activeICPId) : null;
    if (selected) {
      // `icpList` is loaded once on mount, so it can be behind an edit made
      // without leaving this page (Barry refinement, the reclarification modal).
      // The tab decides WHICH ICP is searched; Firestore decides what that ICP
      // currently says. Sending the in-memory copy would search — and stamp the
      // resulting companies with — criteria the user has already changed.
      try {
        const fresh = await getDoc(doc(db, 'users', user.uid, 'icpProfiles', selected.id));
        if (fresh.exists()) {
          return { icpId: selected.id, profile: { id: selected.id, ...fresh.data() }, source: 'explicit-tab' };
        }
      } catch (err) {
        console.warn('[DailyLeads] could not re-read selected ICP, using loaded copy:', err.message);
      }
      return { icpId: selected.id, profile: selected, source: 'explicit-tab' };
    }

    const resolution = await resolveActiveIcp(user.uid);
    if (isResolved(resolution)) {
      return { icpId: resolution.icpId, profile: resolution.profile, source: 'active-flag' };
    }

    return { icpId: null, profile: null, reason: resolution.reason };
  }, [activeICPId, icpList]);

  const handleManualRefresh = async () => {
    const user = getEffectiveUser();
    if (!user || isRefreshing) return;
    setIsRefreshing(true);
    setRefreshMessage('Barry is finding new targets...');
    try {
      const authToken = await user.getIdToken();

      // An ICP-targeted refresh requires an explicit ICP identity. Without one it
      // does not run — no candidate is silently searched against, and no
      // 'default' is manufactured.
      const searchIcp = await resolveSearchIcp(user);
      if (!searchIcp.icpId) {
        setRefreshMessage(explainUnresolved({ reason: searchIcp.reason }));
        setIsRefreshing(false);
        return;
      }
      const searchProfile = searchIcp.profile;

      // Timeout after 25s — Netlify functions have a 26s limit
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);

      // Show progress update if search takes a while
      const slowTimer = setTimeout(() => setRefreshMessage('Still searching — this can take a moment...'), 8000);

      const response = await fetch('/.netlify/functions/search-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, authToken, companyProfile: searchProfile, icpId: searchIcp.icpId, reconConfidence }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      clearTimeout(slowTimer);

      // Remember which run served this queue. The skip filter compares a
      // company's `skippedInCycle` to it, so a skip lasts exactly one run.
      try {
        const searched = await response.clone().json();
        if (searched?.cycleId) {
          setCurrentCycleId(searched.cycleId);
          await setDoc(
            doc(db, 'users', user.uid, 'scoutProgress', 'swipes'),
            { currentCycleId: searched.cycleId },
            { merge: true },
          );
        }
      } catch { /* the search itself already succeeded; this is bookkeeping */ }

      const data = await response.json();
      if (data.success) {
        if (data.companiesAdded > 0) {
          setRefreshMessage(`Found ${data.companiesAdded} new targets.`);
          setTimeout(() => { setRefreshMessage(''); loadTodayLeads(); }, 1500);
        } else {
          setRefreshMessage(data.currentQueueSize > 0 ? 'Queue is already full.' : 'No new matches found. Try adjusting your ICP.');
          setTimeout(() => setRefreshMessage(''), 4000);
        }
      } else {
        setRefreshMessage(data.error || 'Refresh failed. Try again.');
        setTimeout(() => setRefreshMessage(''), 4000);
      }
    } catch (error) {
      console.error('Error refreshing leads:', error);
      const msg = error.name === 'AbortError'
        ? 'Search timed out. Barry is still working — check back in a minute.'
        : 'Refresh failed. Try again.';
      setRefreshMessage(msg);
      setTimeout(() => setRefreshMessage(''), 5000);
    } finally {
      setIsRefreshing(false);
    }
  };

  // ── ICP Switching ─────────────────────────────────────────────────────────
  const handleICPSwitch = useCallback((icpId) => {
    if (icpId === activeICPId) return;
    const selectedICP = icpList.find(i => i.id === icpId);
    if (!selectedICP) return;

    setActiveICPId(icpId);
    setIcpProfile(selectedICP);
    setIcpWeights(selectedICP.scoringWeights || DEFAULT_WEIGHTS);

    // Filter to companies for the selected ICP (legacy companies with no icpId show for all)
    const base = allCompaniesRef.current.length > 0 ? allCompaniesRef.current : companies;
    const filtered = base.filter(c => !c.icpId || c.icpId === icpId);
    const rescored = filtered.map(c => ({
      ...c,
      fit_score: calculateICPScore(c, selectedICP, selectedICP.scoringWeights || DEFAULT_WEIGHTS),
      fit_confidence: computeCoverage(c, selectedICP).complete ? 100
        : Math.round((computeCoverage(c, selectedICP).observed.length
            / Math.max(1, computeCoverage(c, selectedICP).relevant.length)) * 100),
      fit_reasons: generateMatchReasons(c, selectedICP),
    }));
    rescored.sort(compareByFit);
    setCompanies(rescored);
    setCurrentIndex(0);
  }, [activeICPId, icpList, companies]);

  /**
   * One decision at a time.
   *
   * The card latch stops a gesture producing two callbacks; this stops two
   * callbacks producing two decisions, whatever door they arrived through —
   * keyboard, card, or a future caller. It is the backstop that makes the
   * invariant hold for entry points the card never sees.
   *
   * It matters because the body below reads `companies[currentIndex]` up front
   * and does not advance `currentIndex` until the end of a long await chain.
   * Two calls that overlap that chain both resolve to the SAME company and both
   * write — which is exactly what production shows: two lineage events 88ms
   * apart for one drag.
   *
   * It is NOT sufficient on its own, because the two calls need not overlap.
   * `decidedSubjectsRef` below covers the case where they do not.
   */
  const swipeInFlightRef = useRef(false);

  /**
   * One subject, one live decision.
   *
   * The card commits a decision synchronously but defers the callback 280ms
   * behind its exit animation. handleSwipe has not been called yet, so the lock
   * above is unclaimed for that entire window. A keyboard press inside it runs
   * the full decision — Firestore chain included — and can SETTLE before t=280,
   * releasing the lock. The deferred drag callback then arrives at an open door
   * and decides a second time.
   *
   * It decides the same company, not the next one: the callback closes over the
   * `onAccept` prop from the render the gesture happened in, and that closure
   * still holds the old `currentIndex`. So the queue does not skip anyone — the
   * user makes one gesture-pair and gets two lineage events on one company,
   * stamped with two different gestures ('keyboard' and 'drag'). That is the
   * same defect the card latch closes for one card; this closes it across entry
   * points, which no per-card latch can see.
   *
   * Claimed per subject rather than per call so that the guard outlives the
   * in-flight window. Cleared by `handleUndo`, because an undo makes the company
   * genuinely undecided again — swipe → undo → re-swipe must still produce a
   * second, real decision, and that fact stays expressible. Cleared on the error
   * path too: a decision that failed and told the user to try again must be
   * retryable.
   */
  const decidedSubjectsRef = useRef(new Set());

  const handleSwipe = async (direction, feedback = null, gesture = 'unknown', subjectId = null) => {
    if (swipeInFlightRef.current) return;
    const user = getEffectiveUser();
    if (!user) return;
    const today = new Date().toISOString().split('T')[0];
    if (direction === 'right' && dailySwipeCount >= DAILY_SWIPE_LIMIT && lastSwipeDate === today) {
      alert('Daily hunt limit reached. Review your saved companies to engage with your catches.');
      if (onNavigate) onNavigate('saved');
      else navigate('/scout', { replace: true, state: { activeTab: 'saved-companies' } });
      return;
    }
    const company = companies[currentIndex];
    if (!company) return;
    // A gesture that named its subject decides THAT company or nothing. If the
    // queue moved on while the callback waited out the card's exit animation,
    // this decision has no subject on screen and must not land on whoever is
    // current now. A null subjectId means a caller that cannot name one — the
    // keyboard, which decides the current card by definition.
    if (subjectId && subjectId !== company.id) return;
    // Already decided and not undone, so this is a second delivery of a decision
    // the user made once. See `decidedSubjectsRef` above.
    if (decidedSubjectsRef.current.has(company.id)) return;
    // Claimed here, not at the guard above: everything between the two is
    // synchronous, so nothing can interleave, and the rejected paths above
    // decided nothing and must not hold the lock.
    swipeInFlightRef.current = true;
    decidedSubjectsRef.current.add(company.id);
    try {
      const companyRef = doc(db, 'users', user.uid, 'companies', company.id);
      // Hoisted so the decision has ONE timestamp: the legacy write and the
      // shadow event must describe the same moment, and it doubles as the
      // shadow write's causeId — a retry of this decision lands on the same
      // event id and is recognised as already recorded rather than duplicated.
      const swipedAt = new Date().toISOString();
      await updateDoc(companyRef, {
        status: direction === 'right' ? 'accepted' : 'rejected',
        swipedAt,
        swipeDirection: direction,
        // WHICH gesture produced this decision — keyboard | drag | button.
        // Distinct from `swipe_source`, which names the SURFACE (people_mode,
        // barry_first_value). Recorded because all three reject gestures wrote
        // byte-identical documents, so a rejection's origin was unrecoverable:
        // a keyboard press and a deliberate "Not a Match" were indistinguishable
        // forever. Written, never read — it exists so the question stays
        // answerable later. 'unknown' means a call site forgot to say.
        swipe_gesture: gesture,
        ...(activeICPId ? { swipedForICPId: activeICPId } : {}),
        ...(direction === 'right' && feedback ? { barryFeedback: feedback, feedbackAt: new Date().toISOString() } : {}),
        ...(direction === 'left' && feedback ? { barryRejectionFeedback: feedback, rejectionFeedbackAt: new Date().toISOString() } : {}),
      });

      // ── Shadow write (Sprint 1A) ────────────────────────────────────────
      // Strictly AFTER the legacy write has committed, and strictly fail-soft:
      // the service swallows its own errors, so a shadow failure can never undo
      // or block a decision the user already made. Nothing reads what this
      // writes until the Sprint 3 cutover.
      //
      // The ICP recorded is `activeICPId` — the one the legacy write stamps as
      // swipedForICPId — so the two can never disagree about which ICP the user
      // was deciding under. With no ICP resolved there is nothing to attribute
      // and the shadow write is skipped rather than guessed.
      if (activeICPId) {
        await recordDecision({
          userId: user.uid,
          subjectId: company.id,
          icpId: activeICPId,
          accepted: direction === 'right',
          causeId: swipedAt,
          source: company.source ?? null,
        });
      }

      const isInterested = direction === 'right';
      const newSwipeCount = isInterested
        ? (lastSwipeDate === today ? dailySwipeCount + 1 : 1)
        : dailySwipeCount;
      const swipeProgressRef = doc(db, 'users', user.uid, 'scoutProgress', 'swipes');
      await setDoc(swipeProgressRef, { dailySwipeCount: newSwipeCount, lastSwipeDate: today, hasSeenTitleSetup });
      setDailySwipeCount(newSwipeCount);
      setLastSwipeDate(today);
      if (isInterested) {
        setTotalAcceptedCompanies(totalAcceptedCompanies + 1);
        setActionToast({ message: `${company.name} saved`, type: 'success' });
        setTimeout(() => setActionToast(null), 2500);
      }
      setLastSwipe({ company, direction, index: currentIndex, previousSwipeCount: dailySwipeCount });
      setShowUndo(true);
      // Persona comes from the ICP this company was found under — the same ICP
      // the search was launched from — never from the companyProfile/current
      // bridge. The bridge is a projection of whichever ICP was last made
      // active globally, so reading it here meant a swipe under ICP B searched
      // for ICP A's titles. resolveActiveIcp's own contract already says the
      // bridge "is a projection; it is not an identity source".
      //
      // Fail closed: with no ICP resolved there are no titles, and the block
      // below is skipped rather than falling back to someone else's persona.
      const swipeIcp = await resolveSearchIcp(user);
      const icpTitles = swipeIcp.profile?.targetTitles || [];
      if (direction === 'right' && icpTitles.length > 0) {
        const formattedTitles = icpTitles.map((title, index) => ({ title, rank: index + 1, score: 100 - (index * 10) }));
        await updateDoc(companyRef, { selected_titles: formattedTitles, titles_updated_at: new Date().toISOString(), titles_source: 'icp_auto' });
        if (company.apollo_organization_id) {
          const authToken = await user.getIdToken();
          fetch('/.netlify/functions/searchPeople', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.uid, authToken, organizationId: company.apollo_organization_id, titles: icpTitles, maxResults: 3 }),
          }).then(res => res.json()).then(async result => {
            if (result.success && result.people?.length > 0) {
              for (const person of result.people) {
                const contactId = `${company.id}_${person.id}`;

                // Identity resolution before every auto-discovered write.
                // This path runs in the BACKGROUND after a swipe, so a
                // duplicate created here is one the user never saw made and
                // has no reason to look for.
                const decision = await prepareContactWrite(user.uid, {
                  contactId,
                  apollo_person_id: person.id,
                  email: person.email,
                  linkedin_url: person.linkedin_url,
                  name: person.name,
                  company_id: company.id,
                  company_name: company.name,
                  source: 'icp_auto_discovery',
                }, { source: 'DailyLeads.autoDiscovery', recordStatus: RECORD_STATUS.SUGGESTED });

                if (decision.action === 'merge') {
                  await applyContactMerge(user.uid, decision);
                  continue;
                }

                await setDoc(doc(db, 'users', user.uid, 'contacts', contactId), {
                  ...person,
                  // Identity envelope after the spread, never from it: `person`
                  // is an enrichment API payload and carries no archival state,
                  // no normalized identifiers and no status dimensions.
                  ...decision.fields,
                  company_id: company.id, company_name: company.name,
                  lead_owner: user.uid, status: 'suggested', source: 'icp_auto_discovery',
                  discovered_at: new Date().toISOString(),
                });

                // Shadow (Sprint 2), after the legacy write. This search ran
                // because of an ICP, so the person was genuinely encountered
                // under it — a DIRECT association, not an inherited one.
                // activeICPId is the same ICP the company was just swiped for.
                if (activeICPId) {
                  await recordPersonEncounter({
                    userId: user.uid,
                    contactId,
                    icpId: activeICPId,
                    causeId: swipedAt,
                    source: 'icp_auto_discovery',
                  });
                }
              }
              await updateDoc(companyRef, { auto_contact_status: 'completed', auto_contact_count: result.people.length, auto_contact_searched_at: new Date().toISOString() });
            }
          }).catch(err => console.error('Background contact search failed:', err));
        }
      }
      if (direction === 'right' && !hasSeenTitleSetup) {
        const titlePrefsRef = doc(db, 'users', user.uid, 'contactScoring', 'titlePreferences');
        const titlePrefsDoc = await getDoc(titlePrefsRef);
        if (!titlePrefsDoc.exists()) {
          if (icpTitles.length > 0) {
            await setDoc(titlePrefsRef, { titles: icpTitles.map((title, index) => ({ title, priority: 50, order: index })), updatedAt: new Date().toISOString() });
          } else {
            setShowTitleSetup(true);
          }
        }
        setHasSeenTitleSetup(true);
        await setDoc(swipeProgressRef, { dailySwipeCount: newSwipeCount, lastSwipeDate: today, hasSeenTitleSetup: true });
      }
      // ── Session stats ─────────────────────────────────────────────────────
      const newReviewed = sessionReviewed + 1;
      const newSaved = isInterested ? sessionSaved + 1 : sessionSaved;
      const newRejected = !isInterested ? sessionRejected + 1 : sessionRejected;
      setSessionReviewed(newReviewed);
      setSessionSaved(newSaved);
      setSessionRejected(newRejected);
      if (isInterested) {
        setSessionSavedCompanies(prev => [...prev, company]);
      }

      // ── Undo history (keep last 5) ────────────────────────────────────────
      const historyEntry = { company, direction, index: currentIndex, previousSwipeCount: dailySwipeCount };
      setSwipeHistory(prev => [...prev.slice(-4), historyEntry]);
      setLastSwipe(historyEntry);

      // Show undo button for skips (5 seconds), clear timer
      if (!isInterested) {
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        setShowUndo(true);
        setRejectedInSession(prev => [...prev, company.id]);
        undoTimerRef.current = setTimeout(() => setShowUndo(false), 5000);
      } else {
        setShowUndo(false);
        // Remove from the rejected list if re-swiped right
        setRejectedInSession(prev => prev.filter(id => id !== company.id));
      }

      // ── Streak update (first swipe of today) ─────────────────────────────
      if (lastSwipeDate !== today) {
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        const streakRef = doc(db, 'users', user.uid, 'scoutProgress', 'streak');
        const streakDoc = await getDoc(streakRef);
        const currentStreak = streakDoc.exists() ? (streakDoc.data().currentStreak || 0) : 0;
        const lastActive = streakDoc.exists() ? (streakDoc.data().lastActiveDate || '') : '';
        const newStreak = lastActive === yesterday ? currentStreak + 1 : 1;
        await setDoc(streakRef, { currentStreak: newStreak, lastActiveDate: today, longestStreak: Math.max(newStreak, streakDoc.exists() ? (streakDoc.data().longestStreak || 0) : 0) }, { merge: true });
        setStreakDays(newStreak);
        if ([3, 7, 14, 30].includes(newStreak)) {
          setShowStreakMilestone(newStreak);
          setTimeout(() => setShowStreakMilestone(null), 3000);
        }
      }

      // ── Barry nudge — check pattern every 5 saves ─────────────────────────
      if (isInterested && newSaved > 0 && newSaved % 5 === 0) {
        const recentSaves = [...sessionSavedCompanies, company];
        const last5 = recentSaves.slice(-5);
        const industryCounts = {};
        last5.forEach(c => { if (c.industry) industryCounts[c.industry] = (industryCounts[c.industry] || 0) + 1; });
        const topIndustry = Object.entries(industryCounts).sort((a, b) => b[1] - a[1])[0];
        if (topIndustry && topIndustry[1] >= 3 && !showNudge) {
          setNudgeData({ industry: topIndustry[0], count: topIndustry[1] });
          setShowNudge(true);
        }
      }

      // ── Batch tracking ───────────────────────────────────────────────────
      const updatedBatchSaves = isInterested ? batchSaves + 1 : batchSaves;
      const updatedBatchSwipeCount = batchSwipeCount + 1;
      if (isInterested) {
        setBatchSaves(updatedBatchSaves);
        setBatchSavedCompanies(prev => [...prev, company]);
      }
      setBatchSwipeCount(updatedBatchSwipeCount);
      if (updatedBatchSwipeCount >= BATCH_SIZE) {
        setShowBatchEnd(true);
        return; // Batch complete — show batch end screen instead of advancing
      }
      if (currentIndex < companies.length - 1) {
        setCurrentIndex(currentIndex + 1);
      } else {
        // Queue exhausted — show session summary
        setShowSessionSummary(true);
      }
    } catch (error) {
      console.error('Error handling swipe:', error);
      // The user is being told to try again, so the subject must be decidable
      // again. Released here rather than in `finally` — a decision that SUCCEEDED
      // keeps its claim until an undo retracts it.
      decidedSubjectsRef.current.delete(company.id);
      alert('Failed to save swipe. Please try again.');
    } finally {
      // Released however this decision ended — committed, early-returned on a
      // full batch, or thrown. A lock that leaked on the error path would wedge
      // the queue for the rest of the session.
      swipeInFlightRef.current = false;
    }
  };

  /**
   * Skip — "not now", and explicitly not a decision.
   *
   * The legacy document keeps `status: 'pending'`. That is the whole point of
   * the approved shape: `pending` already blocks rediscovery, so skip needs no
   * change to DEDUP_BLOCKING_STATUSES and adds nothing to the overwrite
   * exposure. What hides the card is `skippedInCycle` plus the queue filter in
   * loadTodayLeads; what brings it back is the cycle id moving on, which
   * happens on the next discovery run.
   *
   * Nothing here writes a decision: no swipedAt, no swipeDirection, no
   * swipedForICPId, no swipe_gesture. A skip that left decision fields behind
   * would read as a rejection to every consumer of those fields.
   */
  const handleSkipCompany = async (subjectId = null) => {
    const user = getEffectiveUser();
    if (!user) return;
    const company = companies[currentIndex];
    if (!company) return;
    // Not a decision, so no ledger entry — but a stale skip must no more land on
    // the wrong company than a stale decision does.
    if (subjectId && subjectId !== company.id) return;

    try {
      const skippedAt = new Date().toISOString();

      // Legacy first, and field-scoped: this document carries a lifetime of
      // provenance that an unmasked write would delete.
      await updateDoc(doc(db, 'users', user.uid, 'companies', company.id), {
        skippedInCycle: currentCycleId ?? null,
        skippedAt,
      });

      // Shadow second, fail-soft. The relationship moves to `skipped` and
      // records the cycle, so the guard agrees on both sides at cutover.
      if (activeICPId) {
        await recordSkip({
          userId: user.uid,
          subjectId: company.id,
          icpId: activeICPId,
          causeId: skippedAt,
          cycleId: currentCycleId ?? null,
          source: company.source ?? null,
        });
      }

      setActionToast({ message: `${company.name} — back next run`, type: 'info' });
      setTimeout(() => setActionToast(null), 2200);
      setCompanies(prev => prev.filter(c => c.id !== company.id));
      setCurrentIndex(i => Math.min(i, Math.max(0, companies.length - 2)));
    } catch (err) {
      console.error('Skip failed:', err);
    }
  };

  const handleUndo = async () => {
    // Pop from history (last item is the most recent)
    const entry = swipeHistory.length > 0 ? swipeHistory[swipeHistory.length - 1] : lastSwipe;
    if (!entry) return;
    const user = getEffectiveUser();
    if (!user) return;
    const today = new Date().toISOString().split('T')[0];
    try {
      const companyRef = doc(db, 'users', user.uid, 'companies', entry.company.id);
      await updateDoc(companyRef, { status: 'pending', swipedAt: null, swipeDirection: null, swipe_gesture: null });
      if (entry.direction === 'right') {
        const swipeProgressRef = doc(db, 'users', user.uid, 'scoutProgress', 'swipes');
        await setDoc(swipeProgressRef, { dailySwipeCount: entry.previousSwipeCount, lastSwipeDate: today, hasSeenTitleSetup });
        setDailySwipeCount(entry.previousSwipeCount);
        setTotalAcceptedCompanies(prev => Math.max(0, prev - 1));
        await updateDoc(companyRef, { selected_titles: null, titles_updated_at: null, titles_source: null, auto_contact_status: null, auto_contact_count: null, auto_contact_searched_at: null });
        const autoContactsQuery = query(collection(db, 'users', user.uid, 'contacts'), where('company_id', '==', entry.company.id), where('source', '==', 'icp_auto_discovery'));
        const autoContactDocs = await getDocs(autoContactsQuery);
        for (const contactDoc of autoContactDocs.docs) await deleteDoc(contactDoc.ref);
        setSessionSaved(prev => Math.max(0, prev - 1));
        setSessionSavedCompanies(prev => prev.filter(c => c.id !== entry.company.id));
      } else {
        setSessionRejected(prev => Math.max(0, prev - 1));
        setRejectedInSession(prev => prev.filter(id => id !== entry.company.id));
      }
      setSessionReviewed(prev => Math.max(0, prev - 1));
      // The company is genuinely undecided again, so it becomes decidable again.
      // This is what keeps swipe → undo → re-swipe a real second decision rather
      // than something `decidedSubjectsRef` swallows.
      decidedSubjectsRef.current.delete(entry.company.id);
      // Pop from history
      setSwipeHistory(prev => prev.slice(0, -1));
      setLastSwipe(swipeHistory.length > 1 ? swipeHistory[swipeHistory.length - 2] : null);
      setCurrentIndex(entry.index);
      setShowUndo(false);
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    } catch (error) {
      console.error('Error undoing swipe:', error);
      alert('Failed to undo swipe. Please try again.');
    }
  };

  const handleTitleSetupComplete = () => setShowTitleSetup(false);

  // ── Batch Mode helpers ───────────────────────────────────────────────────────

  const resetBatch = () => {
    setBatchSaves(0);
    setBatchSwipeCount(0);
    setBatchSavedCompanies([]);
    setShowBatchEnd(false);
    setShowICPChat(false);
  };

  const triggerAdaptiveSearch = async (savedCompanies) => {
    if (!savedCompanies || savedCompanies.length === 0) return;
    const user = getEffectiveUser();
    if (!user) return;
    try {
      // icpId is not optional here, and it comes from the canonical resolver
      // rather than the bridge projection. search-companies now refuses a search
      // with no identity, and the queue filters on `!c.icpId || c.icpId === activeId`,
      // so an unattributed adaptive search would spend Apollo credits writing
      // companies its own user could never see.
      const searchIcp = await resolveSearchIcp(user);
      if (!searchIcp.icpId) {
        console.warn(`[DailyLeads] adaptive search skipped — ICP unresolved (${searchIcp.reason})`);
        return;
      }
      const authToken = await user.getIdToken();

      // Extract industry signals from companies saved in this batch
      const savedIndustries = [...new Set(savedCompanies.map(c => c.industry).filter(Boolean))];

      fetch('/.netlify/functions/search-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          companyProfile: searchIcp.profile,
          icpId: searchIcp.icpId,
          adaptiveSignals: { savedIndustries },
          reconConfidence,
        }),
      }).catch(err => console.error('Adaptive search error:', err));
    } catch (err) {
      console.error('Error triggering adaptive search:', err);
    }
  };

  const handleNextBatch = async () => {
    const snapshot = [...batchSavedCompanies];
    const thisBatchSaves = batchSaves;

    // Track consecutive zero-match batches to surface feedback impact to user
    if (thisBatchSaves === 0) {
      const newConsecutive = consecutiveZeroBatches + 1;
      setConsecutiveZeroBatches(newConsecutive);
      if (newConsecutive >= 2) {
        // G1-11 (C1): the old copy claimed "adjusting your targeting now".
        // Nothing on this path adjusts targeting — handleNextBatch only
        // increments a counter. Reinstate the original wording only once
        // adaptive signals are persisted to icpProfiles and read server-side.
        setFeedbackImpactMsg(`Barry has noted ${newConsecutive} batches with no matches. Adjust your ICP in Settings to change what Scout finds.`);
        setTimeout(() => setFeedbackImpactMsg(null), 6000);
      }
    } else {
      // Reset streak when user saves at least one company
      if (consecutiveZeroBatches >= 1) {
        setFeedbackImpactMsg('Your saves are helping Barry sharpen your queue.');
        setTimeout(() => setFeedbackImpactMsg(null), 4000);
      }
      setConsecutiveZeroBatches(0);
    }

    resetBatch();
    // Advance to next card first (so the UI is responsive)
    if (currentIndex < companies.length - 1) setCurrentIndex(currentIndex + 1);
    else loadTodayLeads();
    // Fire adaptive search in background
    triggerAdaptiveSearch(snapshot);
  };

  // ── People Mode ─────────────────────────────────────────────────────────────

  const handleTabSwitch = async (newTab) => {
    if (newTab === tab) return;
    setTab(newTab);
    if (newTab === 'people' && !peopleModeInitRef.current) {
      await loadPeopleMode();
    }
  };

  const loadPeopleMode = async () => {
    const user = getEffectiveUser();
    if (!user) return;
    setPeopleLoading(true);
    setPeopleModeEmpty(null);
    const today = new Date().toISOString().split('T')[0];
    todayRef.current = today;
    try {
      // Same rule as the swipe handler: the People tab searches the titles of
      // the ICP on screen, not whichever ICP the bridge happens to project.
      // No resolved ICP means no titles, which the existing 'no_titles' state
      // already handles.
      const peopleIcp = await resolveSearchIcp(user);
      const titles = peopleIcp.profile?.targetTitles ?? [];
      if (titles.length === 0) { setPeopleModeEmpty('no_titles'); setPeopleLoading(false); return; }
      setTargetTitles(titles);
      targetTitlesRef.current = titles;
      const companiesRef = collection(db, 'users', user.uid, 'companies');
      const companiesSnap = await getDocs(query(companiesRef, where('status', 'in', ['pending', 'accepted'])));
      const allCompanies = companiesSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.apollo_organization_id || c.apollo_id);
      if (allCompanies.length === 0) { setPeopleModeEmpty('no_contacts'); setPeopleLoading(false); return; }
      companyPoolRef.current = allCompanies;
      nextCompanyIdxRef.current = 0;
      peopleModeInitRef.current = true;
      await fetchMorePeople(user, titles, today);
    } catch (err) {
      console.error('Error loading People Mode:', err);
      setPeopleModeEmpty('no_contacts');
    } finally {
      setPeopleLoading(false);
    }
  };

  const fetchMorePeople = async (user, titles, today) => {
    if (isFetchingPeopleRef.current) return;
    if (nextCompanyIdxRef.current >= companyPoolRef.current.length) {
      setPeopleQueue(prev => { if (prev.length === 0) setPeopleModeEmpty('exhausted'); return prev; });
      return;
    }
    isFetchingPeopleRef.current = true;
    try {
      const authToken = await user.getIdToken();
      const batchSize = 3;
      const startIdx = nextCompanyIdxRef.current;
      const endIdx = Math.min(startIdx + batchSize, companyPoolRef.current.length);
      const newPeople = [];
      for (let i = startIdx; i < endIdx; i++) {
        const company = companyPoolRef.current[i];
        const orgId = company.apollo_organization_id || company.apollo_id;
        try {
          const existingSnap = await getDocs(query(collection(db, 'users', user.uid, 'contacts'), where('company_id', '==', company.id)));
          const existingByPersonId = {};
          for (const d of existingSnap.docs) { const data = d.data(); if (data.apollo_person_id) existingByPersonId[data.apollo_person_id] = data; }
          const res = await fetch('/.netlify/functions/searchPeople', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user.uid, authToken, organizationId: orgId, titles, maxResults: 3 }) });
          const data = await res.json();
          if (data.success && data.people?.length > 0) {
            for (const person of data.people) {
              const existing = existingByPersonId[person.id];
              if (!existing) { newPeople.push({ person, company }); }
              else if (existing.status === 'people_mode_skipped' && existing.skipped_date !== today) { newPeople.push({ person, company }); }
            }
          }
        } catch (err) { console.error(`Failed to fetch people for ${company.name}:`, err); }
      }
      nextCompanyIdxRef.current = endIdx;
      if (newPeople.length > 0) { setPeopleQueue(prev => [...prev, ...newPeople]); }
      else if (nextCompanyIdxRef.current >= companyPoolRef.current.length) { setPeopleQueue(prev => { if (prev.length === 0) setPeopleModeEmpty('exhausted'); return prev; }); }
      else { isFetchingPeopleRef.current = false; await fetchMorePeople(user, titles, today); return; }
    } finally { isFetchingPeopleRef.current = false; }
  };

  const getBarryText = (person, company, titles) => {
    if (!titles || titles.length === 0) return null;
    const personTitle = (person.title || '').toLowerCase();
    const exactMatch = titles.find(t => personTitle.includes(t.toLowerCase()) || t.toLowerCase().includes(personTitle));
    if (exactMatch) return `Matches your ${exactMatch} target`;
    const keywordMatch = titles.find(t => {
      const words = t.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      return words.some(word => personTitle.includes(word));
    });
    if (keywordMatch) return `Similar role to your ${keywordMatch} target`;
    return 'Title match — outside your target industry.';
  };

  // Same one-at-a-time lock as handleSwipe, for the same reason: this reads
  // peopleQueue[currentPersonIdx] up front and advances the index only at the
  // end, so overlapping calls decide the same person twice.
  const personSwipeInFlightRef = useRef(false);

  // Same subject ledger as `decidedSubjectsRef`, for the identical 280ms hole:
  // the person card defers its callback behind the same exit animation, and the
  // lock above is unclaimed for that whole window. People mode has no undo, so
  // nothing retracts a claim here — a settled person stays settled for the
  // session, which is already true of the queue itself.
  const decidedPeopleRef = useRef(new Set());

  const handlePersonSwipe = async (direction, feedback = null, subjectId = null) => {
    if (personSwipeInFlightRef.current) return;
    const user = getEffectiveUser();
    if (!user) return;
    const today = todayRef.current;
    const personItem = peopleQueue[currentPersonIdx];
    if (!personItem) return;
    const { person, company } = personItem;
    const contactId = `${company.id}_${person.id}`;
    // The gesture decides the card it was made on, or nothing. See handleSwipe.
    if (subjectId && subjectId !== contactId) return;
    if (decidedPeopleRef.current.has(contactId)) return;
    const contactRef = doc(db, 'users', user.uid, 'contacts', contactId);
    // One timestamp for this decision, shared by the legacy write and the
    // shadow event — and it doubles as the event's causeId, so a retry lands on
    // the same event id and is recognised as already recorded.
    const personDecidedAt = new Date().toISOString();
    personSwipeInFlightRef.current = true;
    decidedPeopleRef.current.add(contactId);
    try {
      if (direction === 'right') {
        // Identity resolution before the write. The composite id already
        // dedups THIS person at THIS company; the resolver catches the same
        // human already saved from a different source.
        const decision = await prepareContactWrite(user.uid, {
          contactId,
          apollo_person_id: person.id,
          email: person.email,
          linkedin_url: person.linkedin_url,
          name: person.name,
          company_id: company.id,
          company_name: company.name,
          source: 'people_mode',
        }, { source: 'DailyLeads.peopleSwipe', recordStatus: RECORD_STATUS.SUGGESTED });

        if (decision.action === 'merge') {
          await applyContactMerge(user.uid, decision);
        } else {
          // The identity envelope goes after the spread, never from it —
          // `person` is an enrichment API payload and carries no archival
          // state, no normalized identifiers and no status dimensions.
          await setDoc(contactRef, { ...person, ...decision.fields, apollo_person_id: person.id, company_id: company.id, company_name: company.name, lead_owner: user.uid, status: 'suggested', source: 'people_mode', saved_at: new Date().toISOString(), ...(feedback ? { barryFeedback: feedback, feedbackAt: new Date().toISOString() } : {}) }, { merge: true });
        }
        // Shadow: the People tab runs against the active ICP, so saving someone
        // here is a decision made under it.
        if (activeICPId) {
          await recordPersonDecision({
            userId: user.uid, contactId, icpId: activeICPId,
            accepted: true, causeId: personDecidedAt, source: 'people_mode',
          });
        }
        if (company.status === 'pending') {
          const companyRef = doc(db, 'users', user.uid, 'companies', company.id);
          await updateDoc(companyRef, { status: 'accepted', swipedAt: new Date().toISOString(), swipeDirection: 'right', swipe_source: 'people_mode' });
          if (targetTitlesRef.current.length > 0) {
            const formattedTitles = targetTitlesRef.current.map((title, idx) => ({ title, rank: idx + 1, score: 100 - (idx * 10) }));
            await updateDoc(companyRef, { selected_titles: formattedTitles, titles_updated_at: new Date().toISOString(), titles_source: 'icp_auto' });
          }
        }
      } else if (direction === 'left') {
        // Rejecting a lead archives it. This wrote status and archived_at but
        // not is_archived, so readers that key off the boolean — quick search
        // among them — kept treating rejected people as live contacts.
        await setDoc(contactRef, { apollo_person_id: person.id, company_id: company.id, status: 'people_mode_archived', source: 'people_mode', is_archived: true, archived_at: new Date().toISOString(), ...(feedback ? { barryRejectionFeedback: feedback, rejectionFeedbackAt: new Date().toISOString() } : {}) }, { merge: true });
        if (activeICPId) {
          await recordPersonDecision({
            userId: user.uid, contactId, icpId: activeICPId,
            accepted: false, causeId: personDecidedAt, source: 'people_mode',
          });
        }
      } else if (direction === 'skip') {
        await setDoc(contactRef, { apollo_person_id: person.id, company_id: company.id, status: 'people_mode_skipped', source: 'people_mode', skipped_date: today }, { merge: true });
        // The cycle recorded is the DAY, matching people-mode's existing
        // skipped_date semantics rather than inventing a second notion of
        // "comes back later" for the same control.
        if (activeICPId) {
          await recordPersonSkip({
            userId: user.uid, contactId, icpId: activeICPId,
            causeId: personDecidedAt, cycleId: today, source: 'people_mode',
          });
        }
      }
      const nextIdx = currentPersonIdx + 1;
      const remaining = peopleQueue.length - nextIdx;
      if (remaining < 5) { const activeUser = auth.currentUser; if (activeUser) fetchMorePeople(activeUser, targetTitlesRef.current, today); }
      setCurrentPersonIdx(nextIdx);
      if (nextIdx >= peopleQueue.length && nextCompanyIdxRef.current >= companyPoolRef.current.length) setPeopleModeEmpty('exhausted');
    } catch (err) {
      console.error('Error handling person swipe:', err);
      // Told to try again, so it must be retryable. Mirrors handleSwipe.
      decidedPeopleRef.current.delete(contactId);
      alert('Failed to save. Please try again.');
    } finally {
      personSwipeInFlightRef.current = false;
    }
  };

  // ── Rendering ───────────────────────────────────────────────────────────────

  const currentCompany = companies[currentIndex];
  const visibleCompanies = companies.slice(currentIndex);
  const nextCompany = companies[currentIndex + 1] || null;

  // A floor under the stage, so the deck does not resize on every swipe.
  //
  // Card height follows content, and content is uneven: a company with an HQ, a
  // CEO, four measured ICP factors and a long Barry Intel renders ~90px taller
  // than a sparse one on desktop and ~151px taller on mobile. Measured over ten
  // cards spanning sparse to dense, these are the medians — 564/522 for company
  // cards, 512/456 for person cards, which are consistently shorter. The desktop
  // company figure came down from 584 when the card went to CARD_MAX_W: the same
  // text over a wider measure is fewer lines, so the median card is shorter.
  //
  // It is a floor, not a cap: a card taller than this still sets its own height,
  // and nothing clips or scrolls. Cards shorter than it sit at a stable height
  // instead of shrinking the deck under the queue.
  //
  // `flexShrink: 0` travels with the floor. The stage is a flex item in the
  // card column, and an explicit min-height replaces the automatic minimum size
  // that was keeping a content-sized item from being shrunk below its content —
  // without it, a card taller than the floor gets squeezed back to the floor and
  // paints over whatever follows.
  const COMPANY_STAGE_MIN_H = isDesktop ? 564 : 522;
  const PERSON_STAGE_MIN_H = isDesktop ? 512 : 456;

  // Ghost cards for depth effect. They stretch to the stage — i.e. to the real
  // card's own height — instead of carrying a viewport-derived height of their
  // own, so the deck stays a deck whatever the card in front of it measures.
  const renderGhostCards = (count) =>
    Array.from({ length: Math.min(count, 2) }).map((_, i) => (
      <div key={i} style={{
        position: 'absolute', top: (i + 1) * 8, left: (i + 1) * 8, right: (i + 1) * 8,
        bottom: -(i + 1) * 8,
        background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 22,
        opacity: 0.15 + (i === 0 ? 0.15 : 0), pointerEvents: 'none',
      }} />
    ));

  // ICP chips. Above 1024px they sit on the title line, which is 44px tall
  // anyway once they are in it — so the chip row stops costing a row of its
  // own (46px plus its 6px gap) without any chip losing its 44px tap target.
  const renderIcpChips = () => {
    const chips = icpList.filter(i => i.status !== 'pending');
    if (chips.length <= 1) return null;
    return (
      <div style={{
        display: 'flex', gap: 6, alignItems: 'center',
        marginBottom: isWide ? 0 : 6,
        ...(isWide ? { flex: '1 1 auto', minWidth: 0, justifyContent: 'flex-end' } : null),
        overflowX: 'auto',
        msOverflowStyle: 'none', scrollbarWidth: 'none',
      }}>
        {chips.map(icp => (
          <button
            key={icp.id}
            onClick={() => handleICPSwitch(icp.id)}
            onDoubleClick={() => navigate(`/scout?tab=icp-settings&icpId=${icp.id}`)}
            title="Double-click to edit ICP"
            style={{
              padding: '5px 14px', minHeight: 44, borderRadius: 20,
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
              border: `1.5px solid ${activeICPId === icp.id ? BRAND.pink : T.border2}`,
              background: activeICPId === icp.id ? T.accentBg : T.surface,
              color: activeICPId === icp.id ? BRAND.pink : T.textMuted,
              transition: 'all 0.15s', whiteSpace: 'nowrap', flexShrink: 0,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {icp.name || 'ICP'}
          </button>
        ))}
      </div>
    );
  };

  // Progress. The dot rows that used to sit between the tabs and the card are
  // gone: ten 7px dots cost a 27px band above a card that already overhangs the
  // fold, and they said nothing the count beside them did not. The count itself
  // stays — it moves onto the header's subtitle line, which had room for it.
  const progressLabel = tab === 'people'
    ? (peopleQueue.length > 0 ? `${currentPersonIdx}/${peopleQueue.length}${isDesktop ? ' reviewed' : ''}` : null)
    : `${batchSwipeCount}/${BATCH_SIZE}${isDesktop ? ' this batch' : ''}`;

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: T.textMuted }}>
        <Loader size={28} color={BRAND.pink} style={{ animation: 'spin 1s linear infinite' }} />
        <p style={{ fontSize: 13, margin: 0 }}>Loading your discoveries...</p>
        <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
      </div>
    );
  }

  // ── ICP validation gate ─────────────────────────────────────────────────────
  // Block entry to Daily Leads if no ICP is configured — prevents confusing zero-match experience
  if (!icpProfile && icpList.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 0, padding: '32px 24px' }}>
        <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} } @keyframes slideUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }`}</style>
        <div style={{ maxWidth: 380, width: '100%', textAlign: 'center', animation: 'slideUp 0.3s ease' }}>
          <BarryAvatar size={64} style={{ margin: '0 auto 20px' }} />
          <div style={{ fontSize: 20, fontWeight: 700, color: T.text, marginBottom: 8 }}>
            Let's set up your ICP first
          </div>
          <p style={{ fontSize: 13, color: T.textFaint, lineHeight: 1.7, marginBottom: 28 }}>
            Scout needs to know who you're targeting before it can find your matches. Tell Barry who you're after and he'll take it from there.
          </p>
          <button
            onClick={() => navigate('/onboarding', { state: { arrival: ARRIVAL_REVIEW_ICP } })}
            style={{
              width: '100%', padding: '13px',
              borderRadius: 12,
              background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`,
              border: 'none', color: '#fff',
              fontWeight: 700, fontSize: 14,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              marginBottom: 10,
            }}
          >
            <MessageCircle size={16} />Talk to Barry
          </button>
          <button
            onClick={() => navigate('/scout?tab=icp-settings')}
            style={{
              width: '100%', padding: '10px',
              borderRadius: 12,
              background: T.surface, border: `1px solid ${T.border2}`,
              color: T.textMuted, fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Set up manually instead
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: 1 }}>
      {/* Streak milestone celebration */}
      {showStreakMilestone && (
        <div style={{
          position: 'fixed', top: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 600,
          background: `linear-gradient(135deg,${STATUS.amber},#f97316)`,
          color: '#fff', padding: '10px 20px', borderRadius: 20,
          fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8,
          boxShadow: `0 8px 24px ${STATUS.amber}60`,
          animation: 'slideUp 0.3s ease',
        }}>
          <Flame size={16} /> {showStreakMilestone}-day streak — keep going!
        </div>
      )}

      {/* Keyboard hint (first visit only) */}
      {showKeyHint && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 600,
          background: T.cardBg, border: `1px solid ${T.border2}`, borderRadius: 12,
          padding: '10px 14px', fontSize: 11, color: T.textMuted,
          boxShadow: `0 4px 16px ${T.isDark ? '#00000060' : '#00000018'}`,
          animation: 'slideUp 0.3s ease',
        }}>
          <div style={{ fontWeight: 700, color: T.text, marginBottom: 6 }}>Keyboard shortcuts</div>
          {[['→ / L', 'Save'], ['← / J', 'Skip'], ['U', 'Undo'], ['B', 'Barry']].map(([k, d]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 2 }}>
              <span style={{ color: BRAND.pink, fontWeight: 600 }}>{k}</span>
              <span>{d}</span>
            </div>
          ))}
          <button onClick={() => setShowKeyHint(false)} style={{ marginTop: 8, width: '100%', padding: '4px 0', background: 'none', border: 'none', color: T.textFaint, fontSize: 10, cursor: 'pointer' }}>Got it</button>
        </div>
      )}

      {/* Header + tabs. Type scale is untouched; what came out is the band
          around it — the title and its subtitle share a line now instead of
          stacking, and the padding above them is half what it was.
          ─────────────────────────────────────────────────────────────────────
          THIS HEADER HAS NO SLACK LEFT AT 1280x720. The card below it is
          content-sized (see COMPANY_STAGE_MIN_H) and the two fit the viewport
          by single-digit pixels: the median card clears the fold by 5.6px and
          the next card in the measured spread misses it by 7.4px. A row added
          here — a banner, a filter, a second line of anything — puts the
          decision buttons back under the fold on a 720p laptop, which is the
          bug PR #657 and #658 were about. The tests pin these paddings and the
          floors against accidents; they cannot stop a deliberate addition.
          If you need a row here, re-measure first and take it from somewhere:
          the levers and what each is worth are costed in #658. */}
      <div style={{ padding: isDesktop ? '4px 32px 0' : '10px 26px 0', background: T.appBg }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: isDesktop ? 6 : 8 }}>
          {/* Inline above 1024px, where the two fit on one line. Narrower than
              that they wrap, and a wrapped pair is taller than a stacked one —
              so on mobile they stay stacked and the saving comes from the
              padding around them instead. */}
          <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: isDesktop ? 10 : 0, minWidth: 0, flexShrink: 0, ...(isDesktop ? null : { display: 'block' }) }}>
            <h2 style={{ margin: 0, fontSize: isDesktop ? 22 : 18, fontWeight: 700, color: T.text }}>Daily Discoveries</h2>
            <p style={{ margin: isDesktop ? 0 : '2px 0 0', fontSize: isDesktop ? 13 : 11, color: T.textFaint }}>
              Matches based on {icpList.length > 1 ? (icpList.find(i => i.id === activeICPId)?.name || 'your ICP') : 'your ICP'}
            </p>
          </div>
          {isWide && renderIcpChips()}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {/* The batch count the dot row used to carry. It rides the control
                cluster rather than the subtitle, so it costs no height and no
                width that a narrow viewport would have to wrap. */}
            {progressLabel && (
              <span style={{ fontSize: 10, color: T.textFaint, whiteSpace: 'nowrap' }}>{progressLabel}</span>
            )}
            {isDesktop && (
              <button
                onClick={toggleQueueList}
                data-queue-trigger
                title="View Queue"
                style={{ width: 34, height: 34, borderRadius: 9, background: queueListOpen ? T.accentBg : T.surface, border: `1px solid ${queueListOpen ? T.accentBdr : T.border2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <List size={14} color={queueListOpen ? BRAND.pink : T.textMuted} />
              </button>
            )}
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              title="Refresh queue"
              style={{ width: 34, height: 34, borderRadius: 9, background: T.surface, border: `1px solid ${T.border2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: isRefreshing ? 'not-allowed' : 'pointer', opacity: isRefreshing ? 0.5 : 1 }}
            >
              <RefreshCw size={14} color={T.textMuted} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
            </button>
          </div>
        </div>
        {/* Action toast — brief confirmation for save/skip actions */}
        {actionToast && (
          <div style={{
            marginBottom: 8, padding: '8px 14px', borderRadius: 8,
            background: actionToast.type === 'success' ? '#dcfce7' : T.accentBg,
            border: `1px solid ${actionToast.type === 'success' ? '#86efac' : T.accentBdr}`,
            color: actionToast.type === 'success' ? '#15803d' : BRAND.pink,
            fontSize: 12, fontWeight: 600, transition: 'opacity 0.3s ease',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {actionToast.type === 'success' && <span>&#10003;</span>}
            {actionToast.message}
          </div>
        )}
        {refreshMessage && (
          <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: T.accentBg, border: `1px solid ${T.accentBdr}`, color: BRAND.pink, fontSize: 12 }}>
            {refreshMessage}
          </div>
        )}
        {feedbackImpactMsg && !showBatchEnd && (
          <div style={{
            marginBottom: 10, padding: '8px 12px', borderRadius: 8,
            background: T.accentBg, border: `1px solid ${T.accentBdr}`,
            color: BRAND.pink, fontSize: 12,
            display: 'flex', alignItems: 'center', gap: 7,
            animation: 'slideUp 0.3s ease',
          }}>
            <BarryAvatar size={16} />
            {feedbackImpactMsg}
          </div>
        )}
        {/* Below 1280px the chips keep a row of their own — see renderIcpChips
            for why the title line only takes them when it is wide enough. */}
        {!isWide && renderIcpChips()}

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${T.border}` }}>
          {[['companies', 'Companies'], ['people', 'People']].map(([id, label]) => (
            <div
              key={id}
              onClick={() => handleTabSwitch(id)}
              style={{
                padding: '7px 22px', minHeight: 44, fontSize: 13, cursor: 'pointer',
                borderBottom: `2px solid ${tab === id ? BRAND.pink : 'transparent'}`,
                color: tab === id ? BRAND.pink : T.textMuted,
                background: tab === id ? T.accentBg : 'transparent',
                marginBottom: -1, transition: 'all 0.15s',
                display: 'flex', alignItems: 'center',
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Content area — two-column on desktop */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minWidth: 0 }}>

        {/* ── Card column ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: isDesktop ? '4px 16px 6px' : '10px 12px 6px', overflowY: 'auto', overflowX: 'hidden', position: 'relative', WebkitOverflowScrolling: 'touch' }}>

          {/* ── Companies Tab ── */}
          {tab === 'companies' && (
            <>
              {companies.length === 0 ? (
                /* Empty queue — session summary if we reviewed something, else find more */
                showSessionSummary || sessionReviewed > 0 ? (
                  <SessionSummaryScreen
                    reviewed={sessionReviewed}
                    saved={sessionSaved}
                    rejected={sessionRejected}
                    streak={streakDays}
                    savedCompanies={sessionSavedCompanies}
                    onViewSaved={() => onNavigate ? onNavigate('saved') : navigate('/scout', { state: { activeTab: 'saved-companies' } })}
                    onDismiss={() => setShowSessionSummary(false)}
                    onRefresh={handleManualRefresh}
                    isRefreshing={isRefreshing}
                  />
                ) : icpUnresolvedReason ? (
                  /* Discovery is ICP-dependent, so this surface — and only a
                     surface like it — explains that it needs a target profile.
                     The account is not broken and nothing else is withheld. */
                  <div style={{ textAlign: 'center', padding: 50, color: T.textMuted }}>
                    <div style={{ fontSize: 44, marginBottom: 12 }}>🎯</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: BRAND.pink, marginBottom: 8 }}>
                      {icpUnresolvedReason === 'none-active' ? 'CHOOSE A TARGET PROFILE' : 'NO TARGET PROFILE YET'}
                    </div>
                    <p style={{ fontSize: 12, color: T.textFaint, marginBottom: 16, maxWidth: 320, margin: '0 auto 16px' }}>
                      {explainUnresolved({ reason: icpUnresolvedReason })}
                    </p>
                    <button onClick={() => onNavigate ? onNavigate('icpsettings') : navigate('/scout', { state: { activeTab: 'icp-settings' } })} style={{ padding: '10px 22px', borderRadius: 10, background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, margin: '0 auto' }}>
                      <Settings size={14} />
                      {icpUnresolvedReason === 'none-active' ? 'Choose Profile' : 'Set Up Targeting'}
                    </button>
                  </div>
                ) : barrySearching ? (
                  <div style={{ textAlign: 'center', padding: 50, color: T.textMuted }}>
                    <div style={{ fontSize: 44, marginBottom: 12 }}>🔍</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: BRAND.pink, marginBottom: 8 }}>BARRY IS SEARCHING</div>
                    <p style={{ fontSize: 12, color: T.textFaint, marginBottom: 16 }}>Barry is finding companies that match your targeting. This usually takes a moment.</p>
                    <Loader size={20} style={{ animation: 'spin 1s linear infinite', color: BRAND.pink, margin: '0 auto' }} />
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: 50, color: T.textMuted }}>
                    <div style={{ fontSize: 44, marginBottom: 12 }}>🎯</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: BRAND.pink, marginBottom: 8 }}>QUEUE EMPTY</div>
                    <p style={{ fontSize: 12, color: T.textFaint, marginBottom: 16 }}>No pending companies. Barry will find new targets.</p>
                    <button onClick={handleManualRefresh} disabled={isRefreshing} style={{ padding: '10px 22px', borderRadius: 10, background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, margin: '0 auto' }}>
                      {isRefreshing ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />}
                      Find More Targets
                    </button>
                  </div>
                )
              ) : showSessionSummary || currentIndex >= companies.length ? (
                <SessionSummaryScreen
                  reviewed={sessionReviewed}
                  saved={sessionSaved}
                  rejected={sessionRejected}
                  streak={streakDays}
                  savedCompanies={sessionSavedCompanies}
                  onViewSaved={() => onNavigate ? onNavigate('saved') : navigate('/scout', { state: { activeTab: 'saved-companies' } })}
                  onDismiss={() => { setShowSessionSummary(false); resetBatch(); setCurrentIndex(0); loadTodayLeads(); }}
                  onRefresh={handleManualRefresh}
                  isRefreshing={isRefreshing}
                />
              ) : showBatchEnd ? (
                /* ── Batch end screen ───────────────────────────────────── */
                <div style={{ textAlign: 'center', padding: '32px 24px', maxWidth: 400, width: '100%' }}>
                  {feedbackImpactMsg && (
                    <div style={{
                      marginBottom: 16, padding: '10px 14px', borderRadius: 10,
                      background: T.accentBg, border: `1px solid ${T.accentBdr}`,
                      color: BRAND.pink, fontSize: 12, fontWeight: 500,
                      display: 'flex', alignItems: 'center', gap: 8,
                      animation: 'slideUp 0.3s ease',
                    }}>
                      <BarryAvatar size={20} />
                      {feedbackImpactMsg}
                    </div>
                  )}
                  <BarryAvatar size={52} style={{ margin: '0 auto 18px' }} />
                  {batchSaves === 0 ? (
                    <>
                      <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 8 }}>
                        Let me sharpen your targeting
                      </div>
                      <p style={{ fontSize: 13, color: T.textFaint, marginBottom: 24, lineHeight: 1.65 }}>
                        None of those felt right — that's useful data. Let's talk through who you're actually looking for so I can find better matches.
                      </p>
                      <button
                        onClick={() => setShowICPChat(true)}
                        style={{
                          width: '100%', padding: '13px',
                          borderRadius: 12,
                          background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`,
                          border: 'none', color: '#fff',
                          fontWeight: 700, fontSize: 14,
                          cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                          marginBottom: 10,
                        }}
                      >
                        <MessageCircle size={16} />Talk to Barry
                      </button>
                      <button
                        onClick={handleNextBatch}
                        style={{ width: '100%', padding: '10px', borderRadius: 12, background: T.surface, border: `1px solid ${T.border2}`, color: T.textMuted, fontSize: 13, cursor: 'pointer' }}
                      >
                        Skip — keep swiping
                      </button>
                    </>
                  ) : batchSaves >= BATCH_SIZE ? (
                    <>
                      <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 8 }}>
                        Perfect 10 — you're locked in!
                      </div>
                      <p style={{ fontSize: 13, color: T.textFaint, marginBottom: 24, lineHeight: 1.65 }}>
                        Every company matched. I'm finding more exactly like these.
                      </p>
                      <button
                        onClick={handleNextBatch}
                        style={{
                          width: '100%', padding: '13px',
                          borderRadius: 12,
                          background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`,
                          border: 'none', color: '#fff',
                          fontWeight: 700, fontSize: 14,
                          cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        }}
                      >
                        <ArrowRight size={16} />Next Batch
                      </button>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 8 }}>
                        Good eye — {batchSaves} of 10 matched
                      </div>
                      <p style={{ fontSize: 13, color: T.textFaint, marginBottom: 24, lineHeight: 1.65 }}>
                        Using your saves to find more companies like {batchSavedCompanies[0]?.name || 'those'}.
                      </p>
                      <button
                        onClick={handleNextBatch}
                        style={{
                          width: '100%', padding: '13px',
                          borderRadius: 12,
                          background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`,
                          border: 'none', color: '#fff',
                          fontWeight: 700, fontSize: 14,
                          cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                          marginBottom: 10,
                        }}
                      >
                        <ArrowRight size={16} />Find More Like These
                      </button>
                      <button
                        onClick={() => setShowICPChat(true)}
                        style={{ width: '100%', padding: '10px', borderRadius: 12, background: T.surface, border: `1px solid ${T.border2}`, color: T.textMuted, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                      >
                        <MessageCircle size={13} />Refine with Barry
                      </button>
                    </>
                  )}
                  {batchSaves > 0 && (
                    <div style={{ marginTop: 16, fontSize: 11, color: T.textFaint }}>
                      {batchSaves} {batchSaves === 1 ? 'company' : 'companies'} added to your hunt list
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Card stage — no height, no max-height, no overflow, and a
                      measured floor. `height: CARD_H` with `overflowX: hidden`
                      used to live here; because a box cannot clip one axis and
                      leave the other visible, the browser resolved overflow-y to
                      `auto` and the card scrolled inside the stage. The stage
                      now takes its height from the card, never the reverse. */}
                  <div style={{ position: 'relative', width: '100%', maxWidth: isDesktop ? CARD_MAX_W + 20 : 440, minHeight: COMPANY_STAGE_MIN_H, flexShrink: 0 }}>
                    {visibleCompanies.length > 1 && renderGhostCards(visibleCompanies.length - 1)}
                    {currentCompany && (
                      <CompanySwipeCard
                        key={currentCompany.id}
                        company={currentCompany}
                        onAccept={(feedback, gesture, subjectId) => handleSwipe('right', feedback, gesture, subjectId)}
                        onReject={(feedback, gesture, subjectId) => handleSwipe('left', feedback, gesture, subjectId)}
                        onSkip={handleSkipCompany}
                        wide={isDesktop}
                        icpProfile={icpProfile}
                        icpWeights={icpWeights}
                      />
                    )}

                    {/* Preload next card's logo so it's ready instantly */}
                    {nextCompany && (
                      <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }} aria-hidden>
                        <CompanyLogo company={nextCompany} size="small" />
                      </div>
                    )}

                    {/* Barry nudge card (overlaid at bottom of card) */}
                    {showNudge && nudgeData && (
                      <BarryNudgeCard
                        industry={nudgeData.industry}
                        count={nudgeData.count}
                        onAccept={() => { setShowNudge(false); setBarryNudgeContext(nudgeData); setBarryPanelOpen(true); }}
                        onDismiss={() => setShowNudge(false)}
                      />
                    )}
                  </div>

                  {/* Undo button — floats below card, disappears after 5s */}
                  {showUndo && swipeHistory.length > 0 && (
                    <button
                      onClick={handleUndo}
                      style={{ marginTop: 10, padding: '7px 16px', borderRadius: 10, background: T.surface, border: `1px solid ${T.border2}`, color: T.textMuted, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, animation: 'slideUp 0.2s ease' }}
                    >
                      <RotateCcw size={13} />Undo last skip
                    </button>
                  )}
                  <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: isDesktop ? CARD_MAX_W + 20 : 440, fontSize: 10, color: T.textGhost }}>
                    <span>← Sharpens targeting</span>
                    <span>Add to hunt list →</span>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── People Tab ── */}
          {tab === 'people' && (
            <>
              {peopleLoading ? (
                <div style={{ textAlign: 'center', padding: 50, color: T.textMuted }}>
                  <Loader size={28} color={BRAND.pink} style={{ animation: 'spin 1s linear infinite', marginBottom: 12 }} />
                  <p style={{ fontSize: 13, margin: 0 }}>Finding people that match your ICP...</p>
                </div>
              ) : peopleModeEmpty === 'no_titles' ? (
                <div style={{ textAlign: 'center', padding: 50 }}>
                  <div style={{ fontSize: 44, marginBottom: 12 }}>🎯</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 8 }}>Set Your Target Titles</div>
                  <p style={{ fontSize: 12, color: T.textFaint, marginBottom: 16 }}>Configure your ICP target titles to start seeing people.</p>
                  <button
                    onClick={() => navigate('/scout?tab=icp-settings')}
                    style={{ padding: '8px 20px', borderRadius: 10, background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, margin: '0 auto' }}
                  >
                    <Settings size={13} />Configure ICP
                  </button>
                </div>
              ) : peopleModeEmpty === 'no_contacts' ? (
                <div style={{ textAlign: 'center', padding: 50, color: T.textMuted }}>
                  <div style={{ fontSize: 44, marginBottom: 12 }}>👥</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 8 }}>No Companies in Queue</div>
                  <p style={{ fontSize: 12, color: T.textFaint }}>Review some companies first to find people inside them.</p>
                </div>
              ) : peopleModeEmpty === 'exhausted' || currentPersonIdx >= peopleQueue.length ? (
                <div style={{ textAlign: 'center', padding: 50 }}>
                  <div style={{ fontSize: 44, marginBottom: 12 }}>🎯</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: BRAND.pink, marginBottom: 8 }}>ALL PEOPLE REVIEWED</div>
                  <button
                    onClick={() => { setPeopleQueue([]); setCurrentPersonIdx(0); peopleModeInitRef.current = false; loadPeopleMode(); }}
                    style={{ marginTop: 8, padding: '8px 20px', borderRadius: 10, background: T.accentBg, border: `1px solid ${T.accentBdr}`, color: BRAND.pink, cursor: 'pointer', fontSize: 12 }}
                  >Reset Queue</button>
                </div>
              ) : (
                <>
                  <div style={{ position: 'relative', width: '100%', maxWidth: isDesktop ? CARD_MAX_W + 20 : 440, minHeight: PERSON_STAGE_MIN_H, flexShrink: 0 }}>
                    {peopleQueue.slice(currentPersonIdx + 1, currentPersonIdx + 3).map((_, i) => (
                      <div key={i} style={{ position: 'absolute', top: (i + 1) * 8, left: (i + 1) * 8, right: (i + 1) * 8, bottom: -(i + 1) * 8, background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 22, opacity: 0.15 + (i === 0 ? 0.15 : 0), pointerEvents: 'none' }} />
                    ))}
                    <PersonSwipeCard
                      key={`${peopleQueue[currentPersonIdx].company.id}_${peopleQueue[currentPersonIdx].person.id}`}
                      person={peopleQueue[currentPersonIdx].person}
                      company={peopleQueue[currentPersonIdx].company}
                      matchText={getBarryText(peopleQueue[currentPersonIdx].person, peopleQueue[currentPersonIdx].company, targetTitles)}
                      onAccept={(feedback, subjectId) => handlePersonSwipe('right', feedback, subjectId)}
                      onReject={(feedback, subjectId) => handlePersonSwipe('left', feedback, subjectId)}
                      onSkip={(subjectId) => handlePersonSwipe('skip', null, subjectId)}
                      wide={isDesktop}
                    />
                  </div>
                  <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: isDesktop ? CARD_MAX_W + 20 : 440, fontSize: 10, color: T.textGhost }}>
                    <span>← Not this person</span>
                    <span>Save to engage →</span>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* ── Desktop sidebar ── */}
        {isDesktop && (
          <div style={{
            width: 256, flexShrink: 0,
            borderLeft: `1px solid ${T.border}`,
            background: T.navBg,
            display: 'flex', flexDirection: 'column',
            padding: '20px 16px',
            overflowY: 'auto',
            gap: 14,
          }}>
            {/* Daily progress bar */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 9, letterSpacing: 2, fontWeight: 700, color: T.textFaint }}>TODAY'S PROGRESS</div>
                {streakDays > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: STATUS.amber }}>
                    <Flame size={12} color={STATUS.amber} />{streakDays}d
                  </div>
                )}
              </div>
              <div style={{ height: 5, background: T.border, borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min((dailySwipeCount / DAILY_SWIPE_LIMIT) * 100, 100)}%`,
                  background: `linear-gradient(90deg, ${BRAND.pink}, ${BRAND.cyan})`,
                  borderRadius: 3, transition: 'width 0.4s ease',
                }} />
              </div>
              <div style={{ fontSize: 11, color: T.textMuted }}>
                <span style={{ fontWeight: 700, color: T.text }}>{dailySwipeCount}</span>
                <span style={{ color: T.textFaint }}> / {DAILY_SWIPE_LIMIT} matches today</span>
              </div>
            </div>

            {/* Session stats — 4-up grid */}
            <div>
              <div style={{ fontSize: 9, letterSpacing: 2, fontWeight: 700, color: T.textFaint, marginBottom: 8 }}>THIS SESSION</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                {[
                  ['REVIEWED', sessionReviewed, T.text, T.surface],
                  ['SAVED', sessionSaved, BRAND.pink, T.accentBg],
                  ['NOT A MATCH', sessionRejected, T.textMuted, T.surface],
                  ['MATCH %', sessionReviewed > 0 ? `${Math.round((sessionSaved / sessionReviewed) * 100)}%` : '—', STATUS.green, `${STATUS.green}10`],
                ].map(([label, value, color, bg]) => (
                  <div key={label} style={{ padding: '8px 10px', background: bg, borderRadius: 9, border: `1px solid ${T.border2}` }}>
                    <div style={{ fontSize: 9, letterSpacing: 1.5, color: T.textFaint, marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Queue count */}
            <div style={{ padding: '10px 12px', background: T.surface, borderRadius: 10, border: `1px solid ${T.border2}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 9, letterSpacing: 1.5, color: T.textFaint, marginBottom: 4 }}>IN QUEUE</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: T.text, lineHeight: 1 }}>{Math.max(0, companies.length - currentIndex)}</div>
              </div>
              <button
                onClick={toggleQueueList}
                data-queue-trigger
                style={{ padding: '5px 10px', borderRadius: 7, background: queueListOpen ? T.accentBg : 'transparent', border: `1px solid ${queueListOpen ? T.accentBdr : T.border2}`, color: queueListOpen ? BRAND.pink : T.textFaint, fontSize: 11, cursor: 'pointer' }}
              >
                View
              </button>
            </div>

            {/* Today's saved quick preview */}
            {sessionSavedCompanies.length > 0 && (
              <div>
                <div
                  onClick={() => setSavedTodayOpen(o => !o)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', marginBottom: savedTodayOpen ? 8 : 0 }}
                >
                  <div style={{ fontSize: 9, letterSpacing: 2, fontWeight: 700, color: T.textFaint }}>SAVED TODAY ({sessionSavedCompanies.length})</div>
                  <ChevronDown size={12} color={T.textFaint} style={{ transform: savedTodayOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                </div>
                {savedTodayOpen && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {sessionSavedCompanies.slice(-4).reverse().map(co => (
                      <div key={co.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: T.surface, borderRadius: 8, border: `1px solid ${T.border2}` }}>
                        <CompanyLogo company={co} size="small" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{co.name}</div>
                          {/* G1-06: "0/100" is a measured verdict; an unscored
                              company has not earned one. */}
                          <div style={{ fontSize: 10, color: T.textFaint }}>
                            {co.fit_score == null ? UNSCORED_LABEL : `${co.fit_score}/100`}
                          </div>
                        </div>
                        <button
                          onClick={() => navigate('/recon', { state: { companyId: co.id } })}
                          style={{ padding: '3px 7px', borderRadius: 5, background: T.accentBg, border: `1px solid ${T.accentBdr}`, color: BRAND.pink, fontSize: 9, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          Recon
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => onNavigate ? onNavigate('saved') : navigate('/scout', { state: { activeTab: 'saved-companies' } })}
                      style={{ padding: '7px', borderRadius: 8, background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, border: 'none', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                    >
                      View All Saved →
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Divider */}
            <div style={{ height: 1, background: T.border }} />

            {/* Keyboard shortcuts reference */}
            <div>
              <div style={{ fontSize: 9, letterSpacing: 2, fontWeight: 700, color: T.textFaint, marginBottom: 8 }}>SHORTCUTS</div>
              {[
                ['→ / L', 'Save'],
                ['← / J', 'Skip'],
                ['U', 'Undo'],
                ['B', 'Barry'],
              ].map(([key, desc]) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${T.border}` }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: BRAND.pink }}>{key}</span>
                  <span style={{ fontSize: 11, color: T.textFaint }}>{desc}</span>
                </div>
              ))}
            </div>

            {/* Barry branding + Chat button */}
            <div style={{ marginTop: 'auto' }}>
              <button
                onClick={() => setBarryPanelOpen(true)}
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 10,
                  background: T.accentBg, border: `1px solid ${T.accentBdr}`,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                  textAlign: 'left',
                }}
              >
                <BarryAvatar size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: BRAND.pink }}>Chat with Barry</div>
                  <div style={{ fontSize: 9, color: T.textFaint }}>Refine your ICP targeting</div>
                </div>
                <ArrowRight size={13} color={BRAND.pink} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Title setup modal */}
      {showTitleSetup && <ContactTitleSetup onComplete={handleTitleSetupComplete} />}

      {/* ICP Chat modal (post-batch) */}
      {showICPChat && (
        <IcpReclarificationModal
          userId={auth.currentUser?.uid}
          icpId={activeICPId}
          reconConfidence={reconConfidence}
          onClose={() => setShowICPChat(false)}
          onSearchComplete={() => {
            resetBatch();
            loadTodayLeads();
          }}
        />
      )}

      {/* Barry ICP-aware side panel (manual trigger or nudge) */}
      {barryPanelOpen && (
        <BarryICPPanel
          userId={auth.currentUser?.uid}
          icpProfile={icpProfile}
          nudgeContext={barryNudgeContext}
          onClose={() => { setBarryPanelOpen(false); setBarryNudgeContext(null); }}
          onSearchComplete={() => {
            setBarryPanelOpen(false);
            setBarryNudgeContext(null);
            loadTodayLeads();
          }}
        />
      )}

      {/* Queue list panel — sidebar on desktop, bottom-sheet on mobile */}
      {queueListOpen && (
        <QueueListPanel
          companies={companies}
          currentIndex={currentIndex}
          rejectedIds={rejectedInSession}
          onJumpTo={(idx) => setCurrentIndex(idx)}
          onClose={closeQueueList}
          mobile={!isDesktop}
          returnFocusRef={queueTriggerRef}
        />
      )}

      {/* Mobile queue FAB — floating button visible only on mobile during active swiping */}
      {!isDesktop && !showBatchEnd && !showSessionSummary && companies.length > 0 && currentIndex < companies.length && tab === 'companies' && (
        <button
          onClick={() => setQueueListOpen(o => !o)}
          style={{
            position: 'fixed', bottom: 24, right: 16, zIndex: 480,
            width: 44, height: 44, borderRadius: 22,
            background: T.cardBg, border: `1.5px solid ${T.border2}`,
            boxShadow: `0 4px 16px ${T.isDark ? '#00000060' : '#00000020'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <List size={16} color={T.textMuted} />
          {companies.length - currentIndex > 0 && (
            <span style={{
              position: 'absolute', top: -4, right: -4,
              background: BRAND.pink, color: '#fff',
              fontSize: 9, fontWeight: 700,
              borderRadius: 8, padding: '1px 5px',
              minWidth: 16, textAlign: 'center',
              border: `1.5px solid ${T.appBg}`,
            }}>
              {companies.length - currentIndex}
            </span>
          )}
        </button>
      )}

      {/* Debug layout overlay — activated by ?debug=layout */}
      {typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug') &&
        new URLSearchParams(window.location.search).get('debug') === 'layout' && (
        <LayoutDebugOverlay isDesktop={isDesktop} />
      )}

      {/* Keyframe animations */}
      <style>{`
        @keyframes slideUpSheet { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes feedbackFlipIn { from { opacity: 0; transform: scaleY(0.9); } to { opacity: 1; transform: scaleY(1); } }
      `}</style>
    </div>
  );
}
