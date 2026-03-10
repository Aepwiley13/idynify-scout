/**
 * DailyLeads.jsx — Swipe-triage queue for companies and people.
 *
 * UI: idynify-v5 design with theme tokens.
 * Data: Firebase Firestore + Apollo (all original wiring preserved).
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import {
  collection, query, where, getDocs, doc, getDoc,
  setDoc, updateDoc, deleteDoc,
} from 'firebase/firestore';
import { Globe, Linkedin, Check, X, RefreshCw, Loader, Settings, RotateCcw, MessageCircle, ArrowRight, MapPin, User, List, ChevronDown, Flame, Trophy } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND, STATUS, ASSETS } from '../../theme/tokens';
import ContactTitleSetup from '../../components/scout/ContactTitleSetup';
import { getScoreBreakdown, DEFAULT_WEIGHTS } from '../../utils/icpScoring';

// ─── BarryAvatar ─────────────────────────────────────────────────────────────
function BarryAvatar({ size = 20, style = {} }) {
  const glow = `0 0 ${size * 0.5}px ${BRAND.cyan}50`;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg,${BRAND.pink},${BRAND.cyan})`,
      border: `2px solid ${BRAND.cyan}50`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.46, flexShrink: 0, boxShadow: glow, overflow: 'hidden', ...style,
    }}>
      <img
        src={ASSETS.barryAvatar}
        alt="Barry AI"
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '🐻'; }}
      />
    </div>
  );
}

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

// ─── Match feedback ───────────────────────────────────────────────────────────
const MATCH_REASONS = ['Industry fit', 'Right size', 'Good location', 'Revenue match', 'Strong signals', 'Known brand'];

function FeedbackFace({ entityName, reasons, setReasons, note, setNote, onSkip, onSubmit, T, wide }) {
  const toggle = (r) => setReasons(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: wide ? '28px 24px 20px' : '22px 18px 16px', gap: 12, animation: 'feedbackFlipIn 0.25s ease' }}>
      <div style={{ fontSize: 30 }}>🎯</div>
      <div style={{ fontSize: wide ? 16 : 14, fontWeight: 700, color: T.text, textAlign: 'center' }}>Great catch!</div>
      <div style={{ fontSize: wide ? 12 : 11, color: T.textMuted, textAlign: 'center', lineHeight: 1.55 }}>
        Why is <strong>{entityName}</strong> a good fit?
        <br />
        <span style={{ fontSize: 10, color: T.textFaint }}>Help Barry find more matches like this.</span>
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
function CompanySwipeCard({ company, onAccept, onReject, wide = false, icpProfile, icpWeights }) {
  const T = useT();
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [gone, setGone] = useState(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackReasons, setFeedbackReasons] = useState([]);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [isFlipping, setIsFlipping] = useState(false);
  const s = useRef(null);

  const xy = e => e.touches ? [e.touches[0].clientX, e.touches[0].clientY] : [e.clientX, e.clientY];
  const down = e => { s.current = xy(e); };
  const move = e => {
    if (!s.current) return;
    const [cx, cy] = xy(e);
    setDx(cx - s.current[0]);
    setDy(cy - s.current[1]);
  };
  const up = () => {
    if (dx > 100) { setGone('r'); setTimeout(() => onAccept(null), 280); }
    else if (dx < -100) { setGone('l'); setTimeout(onReject, 280); }
    else { setDx(0); setDy(0); }
    s.current = null;
  };

  const handleMatchClick = (e) => {
    e.stopPropagation();
    setIsFlipping(true);
    setTimeout(() => { setShowFeedback(true); setIsFlipping(false); }, 140);
  };
  const handleSkipFeedback = () => { setGone('r'); setTimeout(() => onAccept(null), 280); };
  const handleSendFeedback = () => { setGone('r'); setTimeout(() => onAccept({ reasons: feedbackReasons, note: feedbackNote }), 280); };

  const tx = gone === 'r' ? 700 : gone === 'l' ? -700 : dx;
  const score = company.fit_score || company.score || 0;
  const sc = score >= 75 ? STATUS.green : score >= 50 ? STATUS.amber : STATUS.red;
  const scoreLabel = score >= 75 ? 'Strong Fit' : score >= 50 ? 'Good Match' : 'Low Fit';
  const barryText = company.barry_intel || company.barry_context || company.barryIntel
    || `${company.name} is a ${company.industry || 'company'} — review their profile to assess fit.`;

  // ICP factor breakdown (calculated live from stored profile)
  const breakdown = (icpProfile && company) ? getScoreBreakdown(company, icpProfile, icpWeights || DEFAULT_WEIGHTS) : null;

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
        position: 'absolute', width: '100%', maxWidth: wide ? 540 : 420,
        transform: `translateX(calc(-50% + ${tx}px)) translateY(${dy * 0.1}px) rotate(${dx * 0.04}deg)`,
        transition: gone || Math.abs(dx) < 5 ? 'all 0.28s ease' : 'none',
        opacity: gone ? 0 : 1, cursor: 'grab', userSelect: 'none',
        touchAction: 'pan-y', top: 0, left: '50%',
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

      {/* Card — no overflow scroll, content sized to fit */}
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
              onSkip={handleSkipFeedback} onSubmit={handleSendFeedback}
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

        {/* Confidence badge — top right */}
        <div style={{
          position: 'absolute', top: 12, right: 12, zIndex: 6,
          fontSize: 9, color: confColor, fontWeight: 700, letterSpacing: 1,
          padding: '3px 8px', background: `${confColor}18`, borderRadius: 5,
          border: `1px solid ${confColor}40`,
        }}>
          {confidence} confidence
        </div>

        {/* Header */}
        <div style={{
          padding: wide ? '22px 28px 16px' : '18px 22px 12px', display: 'flex', flexDirection: 'column',
          alignItems: 'center', background: T.cardBg2, borderBottom: `1px solid ${T.border}`,
        }}>
          <div style={{
            width: wide ? 72 : 60, height: wide ? 72 : 60, borderRadius: 16, background: T.surface,
            border: `1px solid ${T.border2}`, display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: wide ? 32 : 26, marginBottom: 12,
          }}>
            {company.emoji || company.logo || '🏢'}
          </div>
          <div style={{ fontSize: wide ? 20 : 18, fontWeight: 700, color: T.text, textAlign: 'center' }}>{company.name}</div>
          <div style={{ fontSize: 10, color: T.textFaint, marginTop: 3, letterSpacing: 1.5 }}>
            {(company.industry || '').toUpperCase()}
          </div>
        </div>

        {/* Stats grid — 3 rows: Industry/Employees, Revenue/Founded, HQ/CEO */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: `1px solid ${T.border}` }}>
          {[
            ['INDUSTRY',  company.industry || 'N/A'],
            ['EMPLOYEES', company.employee_count || company.company_size || 'N/A'],
            ['REVENUE',   company.revenue || 'N/A'],
            ['FOUNDED',   company.founded_year || 'N/A'],
            ['HQ',        hqLocation || '—'],
            ['CEO',       ceoName || '—'],
          ].map(([l, v]) => (
            <div key={l} style={{ padding: wide ? '10px 18px' : '8px 14px', borderRight: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 9, letterSpacing: 2, color: T.textFaint, marginBottom: 2 }}>{l}</div>
              <div style={{ fontSize: wide ? 12 : 11, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div>
            </div>
          ))}
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
            onClick={e => { e.stopPropagation(); setGone('l'); setTimeout(onReject, 280); }}
            style={{ flex: 1, padding: wide ? 12 : 10, borderRadius: 11, border: `1.5px solid ${STATUS.red}40`, background: `${STATUS.red}0c`, color: STATUS.red, fontSize: wide ? 13 : 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          ><X size={14} />Not a Match</button>
          <button
            onClick={handleMatchClick}
            style={{ flex: 1, padding: wide ? 12 : 10, borderRadius: 11, border: `1.5px solid ${STATUS.green}40`, background: `${STATUS.green}0c`, color: STATUS.green, fontSize: wide ? 13 : 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          ><Check size={14} />This is a Match</button>
        </div>
      </div>
    </div>
  );
}

// ─── PersonSwipeCard ──────────────────────────────────────────────────────────
function PersonSwipeCard({ person, company, matchText, onAccept, onReject, onSkip, wide = false }) {
  const T = useT();
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [gone, setGone] = useState(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackReasons, setFeedbackReasons] = useState([]);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [isFlipping, setIsFlipping] = useState(false);
  const s = useRef(null);

  const xy = e => e.touches ? [e.touches[0].clientX, e.touches[0].clientY] : [e.clientX, e.clientY];
  const down = e => { s.current = xy(e); };
  const move = e => {
    if (!s.current) return;
    const [cx, cy] = xy(e);
    setDx(cx - s.current[0]);
    setDy(cy - s.current[1]);
  };
  const up = () => {
    if (dx > 100) { setGone('r'); setTimeout(() => onAccept(null), 280); }
    else if (dx < -100) { setGone('l'); setTimeout(onReject, 280); }
    else { setDx(0); setDy(0); }
    s.current = null;
  };

  const handleMatchClick = (e) => {
    e.stopPropagation();
    setIsFlipping(true);
    setTimeout(() => { setShowFeedback(true); setIsFlipping(false); }, 140);
  };
  const handleSkipFeedback = () => { setGone('r'); setTimeout(() => onAccept(null), 280); };
  const handleSendFeedback = () => { setGone('r'); setTimeout(() => onAccept({ reasons: feedbackReasons, note: feedbackNote }), 280); };

  const tx = gone === 'r' ? 700 : gone === 'l' ? -700 : dx;
  const initials = (person.name || person.first_name || '??').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const color = BRAND.pink;

  return (
    <div
      onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up}
      onTouchStart={down} onTouchMove={move} onTouchEnd={up}
      style={{
        position: 'absolute', width: '100%', maxWidth: wide ? 540 : 420,
        transform: `translateX(calc(-50% + ${tx}px)) translateY(${dy}px) rotate(${dx * 0.055}deg)`,
        transition: gone || Math.abs(dx) < 5 ? 'all 0.28s ease' : 'none',
        opacity: gone ? 0 : 1, cursor: 'grab', userSelect: 'none',
        touchAction: 'pan-y',
        top: 0, left: '50%',
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
            ['INDUSTRY',  company?.industry || person.industry || 'N/A'],
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
            onClick={e => { e.stopPropagation(); setGone('l'); setTimeout(onReject, 280); }}
            style={{ flex: 1, padding: wide ? 13 : 11, borderRadius: 11, border: `1.5px solid ${STATUS.red}40`, background: `${STATUS.red}0c`, color: STATUS.red, fontSize: wide ? 14 : 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
          ><X size={15} />Not a Match</button>
          <button
            onClick={handleMatchClick}
            style={{ flex: 1, padding: wide ? 13 : 11, borderRadius: 11, border: `1.5px solid ${STATUS.green}40`, background: `${STATUS.green}0c`, color: STATUS.green, fontSize: wide ? 14 : 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
          ><Check size={15} />This is a Match</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', padding: wide ? '6px 16px 8px' : '4px 12px 6px' }}>
          <button
            onClick={e => { e.stopPropagation(); onSkip(); }}
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
function QueueListPanel({ companies, currentIndex, skippedIds, onJumpTo, onClose }) {
  const T = useT();
  const upcoming = companies.slice(currentIndex);
  const skipped = companies.filter(c => skippedIds.includes(c.id));

  const ScorePip = ({ score }) => {
    const c = score >= 75 ? STATUS.green : score >= 50 ? STATUS.amber : STATUS.red;
    return (
      <span style={{ fontSize: 10, fontWeight: 700, color: c, padding: '2px 6px', background: `${c}18`, borderRadius: 4, border: `1px solid ${c}40` }}>
        {score}
      </span>
    );
  };

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 320, zIndex: 500,
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
              <div style={{ fontSize: 18, flexShrink: 0 }}>{co.emoji || co.logo || '🏢'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: i === 0 ? 700 : 500, color: i === 0 ? BRAND.pink : T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {i === 0 && '▶ '}{co.name}
                </div>
                <div style={{ fontSize: 10, color: T.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{co.industry || '—'}</div>
              </div>
              <ScorePip score={co.fit_score || co.score || 0} />
            </div>
          ))}
          {upcoming.length === 0 && (
            <div style={{ padding: '24px 18px', textAlign: 'center', color: T.textFaint, fontSize: 12 }}>Queue is empty</div>
          )}
        </div>

        {/* Skipped */}
        {skipped.length > 0 && (
          <>
            <div style={{ padding: '8px 18px 4px', fontSize: 9, letterSpacing: 2, color: T.textFaint, fontWeight: 700, borderTop: `1px solid ${T.border}` }}>
              SKIPPED THIS SESSION
            </div>
            {skipped.map(co => (
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
                <div style={{ fontSize: 16, flexShrink: 0 }}>{co.emoji || co.logo || '🏢'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{co.name}</div>
                  <div style={{ fontSize: 10, color: T.textFaint }}>Re-review</div>
                </div>
                <ScorePip score={co.fit_score || co.score || 0} />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ─── SessionSummaryScreen ─────────────────────────────────────────────────────
function SessionSummaryScreen({ reviewed, saved, skipped, streak, savedCompanies, onViewSaved, onDismiss, onRefresh, isRefreshing }) {
  const T = useT();
  const matchRate = reviewed > 0 ? Math.round((saved / reviewed) * 100) : 0;
  const topMatch = savedCompanies.length > 0
    ? savedCompanies.reduce((best, c) => ((c.fit_score || 0) > (best.fit_score || 0) ? c : best), savedCompanies[0])
    : null;

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
          ['Skipped', skipped, T.textMuted, T.surface],
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
          <div style={{ fontSize: 28, flexShrink: 0 }}>{topMatch.emoji || topMatch.logo || '🏢'}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, letterSpacing: 1.5, color: T.textFaint, marginBottom: 2 }}>TOP MATCH</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{topMatch.name}</div>
            <div style={{ fontSize: 10, color: T.textFaint }}>{topMatch.industry || '—'}</div>
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: STATUS.green, flexShrink: 0 }}>{topMatch.fit_score || 0}</div>
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

// ─── BarryICPPanel ────────────────────────────────────────────────────────────
// Side panel version of ICP chat — user can see the card while chatting
function BarryICPPanel({ userId, icpProfile, onClose, onSearchComplete }) {
  const T = useT();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasEnoughContext, setHasEnoughContext] = useState(false);
  const [icpParams, setIcpParams] = useState(null);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const messagesEndRef = useRef(null);

  // On mount: load prior conversation from Firestore, then open a fresh Barry turn
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const user = auth.currentUser;
      if (!user) { setHistoryLoaded(true); sendToBarry('__ICP_RECLARIFICATION__', [], icpProfile); return; }

      try {
        const convRef = doc(db, 'users', user.uid, 'barryConversations', 'icpChat');
        const convDoc = await getDoc(convRef);
        if (!cancelled && convDoc.exists()) {
          const saved = convDoc.data();
          const priorHistory = saved.messages || [];
          if (priorHistory.length > 0) {
            // Rebuild display messages from history
            const displayMsgs = priorHistory.map(h => ({
              role: h.role === 'assistant' ? 'barry' : 'user',
              content: h.content,
            }));
            const sessionLabel = saved.updatedAt?.toDate
              ? saved.updatedAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
              : 'previous session';
            setMessages([
              { role: 'system', content: `— Resumed from ${sessionLabel} —` },
              ...displayMsgs,
            ]);
            setConversationHistory(priorHistory);
            setHistoryLoaded(true);
            // Don't re-open — just let Barry pick up where they left off
            return;
          }
        }
      } catch (err) {
        console.warn('Could not load Barry conversation history:', err);
      }

      if (!cancelled) {
        setHistoryLoaded(true);
        sendToBarry('__ICP_RECLARIFICATION__', [], icpProfile);
      }
    }
    init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const sendToBarry = async (msg, history, profileOverride) => {
    setLoading(true);
    try {
      const user = auth.currentUser;
      if (!user) return;
      const authToken = await user.getIdToken();
      const profileToSend = profileOverride !== undefined ? profileOverride : icpProfile;
      const res = await fetch('/.netlify/functions/barryMissionChat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          authToken,
          message: msg,
          conversationHistory: history,
          icpMode: true,
          icpProfile: profileToSend,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessages(prev => [...prev, { role: 'barry', content: data.response_text }]);
        // Use server-returned history (includes Firestore persistence on server side)
        const newHistory = data.updatedHistory || [
          ...history,
          ...(msg !== '__ICP_RECLARIFICATION__' ? [{ role: 'user', content: msg }] : []),
          { role: 'assistant', content: data.response_text },
        ];
        setConversationHistory(newHistory);
        if (data.has_enough_context) { setHasEnoughContext(true); setIcpParams(data.icp_params); }
      }
    } catch (err) {
      console.error('Barry ICP panel error:', err);
      setMessages(prev => [...prev, { role: 'barry', content: "Something went wrong — please try again." }]);
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
      const user = auth.currentUser;
      if (!user) { onSearchComplete(); return; }
      const authToken = await user.getIdToken();
      const mergedProfile = {
        ...icpProfile,
        ...(icpParams.industries?.length > 0 && { industries: icpParams.industries }),
        ...(icpParams.companySizes?.length > 0 && { companySizes: icpParams.companySizes }),
        ...(icpParams.targetTitles?.length > 0 && { targetTitles: icpParams.targetTitles }),
        ...(icpParams.companyKeywords?.length > 0 && { companyKeywords: icpParams.companyKeywords }),
      };
      await fetch('/.netlify/functions/search-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, authToken, companyProfile: mergedProfile }),
      });
    } catch (err) {
      console.error('ICP search error:', err);
    } finally {
      onSearchComplete();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 498, background: 'rgba(0,0,0,0.4)' }} />

      {/* Side panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 380, zIndex: 499,
        background: T.cardBg, borderLeft: `3px solid ${BRAND.pink}`,
        display: 'flex', flexDirection: 'column',
        boxShadow: `-8px 0 40px rgba(0,0,0,0.3), -2px 0 20px ${BRAND.pink}22`,
        animation: 'slideIn 0.22s ease',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border2}`, background: T.accentBg, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <BarryAvatar size={36} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: T.text }}>Barry</span>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, padding: '2px 7px', borderRadius: 20, background: T.accentBdr, color: T.accent, border: `1px solid ${T.accentBdr}` }}>ICP CHAT</span>
            </div>
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>ICP-aware targeting assistant</div>
          </div>
          {messages.length > 0 && (
            <button
              onClick={async () => {
                const user = auth.currentUser;
                if (user) {
                  try { await deleteDoc(doc(db, 'users', user.uid, 'barryConversations', 'icpChat')); } catch (_) {}
                }
                setMessages([]);
                setConversationHistory([]);
                setHasEnoughContext(false);
                setIcpParams(null);
                sendToBarry('__ICP_RECLARIFICATION__', [], icpProfile);
              }}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 11, padding: '4px 8px', borderRadius: 6 }}
              title="Start over"
            >
              Start over
            </button>
          )}
          <button onClick={onClose} style={{ marginLeft: messages.length > 0 ? 0 : 'auto', background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 22, lineHeight: 1, padding: 4 }}>×</button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!historyLoaded ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Loader size={20} color={BRAND.pink} style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : messages.map((msg, i) => (
            msg.role === 'system' ? (
              <div key={i} style={{ textAlign: 'center', fontSize: 11, color: T.textFaint, padding: '4px 0' }}>
                {msg.content}
              </div>
            ) : (
            <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 8, alignItems: 'flex-end' }}>
              {msg.role === 'barry' && <BarryAvatar size={26} style={{ flexShrink: 0 }} />}
              <div style={{
                maxWidth: '82%', padding: '10px 14px',
                borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: msg.role === 'user' ? `linear-gradient(135deg,${BRAND.pink},#c0146a)` : T.surface2,
                color: msg.role === 'user' ? '#fff' : T.text,
                fontSize: 13, lineHeight: 1.55,
                border: msg.role === 'barry' ? `1px solid ${T.border2}` : 'none',
                borderLeft: msg.role === 'barry' ? `3px solid ${BRAND.pink}60` : undefined,
              }}>
                {msg.content}
              </div>
            </div>
            )
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
          <div style={{ padding: '0 20px 10px', flexShrink: 0 }}>
            <button
              onClick={handleFindCompanies}
              disabled={isSearching}
              style={{ width: '100%', padding: 13, borderRadius: 12, background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, border: 'none', color: '#fff', fontWeight: 700, fontSize: 14, cursor: isSearching ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: isSearching ? 0.75 : 1 }}
            >
              {isSearching ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <ArrowRight size={16} />}
              {isSearching ? 'Finding companies…' : 'Find My Companies'}
            </button>
          </div>
        )}

        {/* Input */}
        <div style={{ padding: hasEnoughContext ? '0 20px 16px' : '12px 20px', borderTop: `1px solid ${T.border2}`, display: 'flex', gap: 8, flexShrink: 0 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder={hasEnoughContext ? 'Anything else to add…' : "Tell Barry who you're targeting…"}
            disabled={loading || isSearching}
            style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${T.border2}`, background: T.surface, color: T.text, fontSize: 13, outline: 'none' }}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim() || isSearching}
            style={{ padding: '10px 14px', borderRadius: 10, background: hasEnoughContext ? T.surface : `linear-gradient(135deg,${BRAND.pink},#c0146a)`, border: hasEnoughContext ? `1px solid ${T.border2}` : 'none', color: hasEnoughContext ? T.textMuted : '#fff', cursor: loading || !input.trim() ? 'not-allowed' : 'pointer', opacity: loading || !input.trim() ? 0.5 : 1 }}
          >
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </>
  );
}

// ─── DailyLeads ──────────────────────────────────────────────────────────────
// ─── ICP Reclarification Modal ────────────────────────────────────────────────
function IcpReclarificationModal({ userId, onClose, onSearchComplete }) {
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
      const user = auth.currentUser;
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
      const user = auth.currentUser;
      if (!user) { onSearchComplete(); return; }
      const authToken = await user.getIdToken();
      const profileRef = doc(db, 'users', user.uid, 'companyProfile', 'current');
      const profileDoc = await getDoc(profileRef);
      const baseProfile = profileDoc.exists() ? profileDoc.data() : {};
      const mergedProfile = {
        ...baseProfile,
        ...(icpParams.industries?.length > 0 && { industries: icpParams.industries }),
        ...(icpParams.companySizes?.length > 0 && { companySizes: icpParams.companySizes }),
        ...(icpParams.targetTitles?.length > 0 && { targetTitles: icpParams.targetTitles }),
        ...(icpParams.companyKeywords?.length > 0 && { companyKeywords: icpParams.companyKeywords }),
      };
      await fetch('/.netlify/functions/search-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, authToken, companyProfile: mergedProfile }),
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

        {/* Input */}
        <div style={{ padding: hasEnoughContext ? '0 20px 16px' : '12px 20px', borderTop: hasEnoughContext ? 'none' : `1px solid ${T.border}`, display: 'flex', gap: 8, flexShrink: 0 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder={hasEnoughContext ? 'Anything else to add...' : 'Tell Barry who you\'re targeting...'}
            disabled={loading || isSearching}
            style={{
              flex: 1, padding: '10px 14px',
              borderRadius: 10, border: `1px solid ${T.border2}`,
              background: T.surface, color: T.text,
              fontSize: 13, outline: 'none',
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

export default function DailyLeads({ onNavigate }) {
  const T = useT();
  const navigate = useNavigate();

  // ── Responsive state ────────────────────────────────────────────────────────
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024);
  useEffect(() => {
    const handler = () => setIsDesktop(window.innerWidth >= 1024);
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

  // ── ICP profile (for score breakdown) ───────────────────────────────────────
  const [icpProfile, setIcpProfile] = useState(null);
  const [icpWeights, setIcpWeights] = useState(DEFAULT_WEIGHTS);

  // ── Session stats ────────────────────────────────────────────────────────────
  const [sessionReviewed, setSessionReviewed] = useState(0);
  const [sessionSaved, setSessionSaved] = useState(0);
  const [sessionSkipped, setSessionSkipped] = useState(0);
  const [sessionSavedCompanies, setSessionSavedCompanies] = useState([]);

  // ── Extended undo history (up to 5) ──────────────────────────────────────────
  const [swipeHistory, setSwipeHistory] = useState([]);
  const [skippedInSession, setSkippedInSession] = useState([]); // company ids
  const undoTimerRef = useRef(null);

  // ── Queue list view ──────────────────────────────────────────────────────────
  const [queueListOpen, setQueueListOpen] = useState(false);

  // ── Barry side panel ─────────────────────────────────────────────────────────
  const [barryPanelOpen, setBarryPanelOpen] = useState(false);

  // ── Daily streak ─────────────────────────────────────────────────────────────
  const [streakDays, setStreakDays] = useState(0);
  const [showStreakMilestone, setShowStreakMilestone] = useState(null);

  // ── Barry nudge between swipes ───────────────────────────────────────────────
  const [nudgeData, setNudgeData] = useState(null);
  const [showNudge, setShowNudge] = useState(false);

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

      if (tab === 'companies' && !showBatchEnd) {
        if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') { e.preventDefault(); handleSwipeRef.current?.('right'); }
        if (e.key === 'ArrowLeft' || e.key === 'j' || e.key === 'J') { e.preventDefault(); handleSwipeRef.current?.('left'); }
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
      const user = auth.currentUser;
      if (!user) { navigate('/login'); return; }

      // Load ICP profile (for score breakdown + Barry panel)
      const profileRef = doc(db, 'users', user.uid, 'companyProfile', 'current');
      const profileDoc = await getDoc(profileRef);
      if (!profileDoc.exists()) { setLoading(false); return; }
      const profile = profileDoc.data();
      setIcpProfile(profile);
      if (profile.scoringWeights) setIcpWeights(profile.scoringWeights);

      const companiesRef = collection(db, 'users', user.uid, 'companies');
      const q = query(companiesRef, where('status', '==', 'pending'));
      const snapshot = await getDocs(q);
      const companiesData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      companiesData.sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));
      setCompanies(companiesData);
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

  const handleManualRefresh = async () => {
    const user = auth.currentUser;
    if (!user || isRefreshing) return;
    setIsRefreshing(true);
    setRefreshMessage('Barry is finding new targets...');
    try {
      const authToken = await user.getIdToken();
      const profileRef = doc(db, 'users', user.uid, 'companyProfile', 'current');
      const profileDoc = await getDoc(profileRef);
      if (!profileDoc.exists()) {
        setRefreshMessage('Set up your ICP first to find targets.');
        setIsRefreshing(false);
        return;
      }
      const response = await fetch('/.netlify/functions/search-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, authToken, companyProfile: profileDoc.data() }),
      });
      const data = await response.json();
      if (data.success) {
        if (data.companiesAdded > 0) {
          setRefreshMessage(`Found ${data.companiesAdded} new targets.`);
          setTimeout(() => { setRefreshMessage(''); loadTodayLeads(); }, 1500);
        } else {
          setRefreshMessage(data.currentQueueSize > 0 ? 'Queue is already full.' : 'No new matches found.');
          setTimeout(() => setRefreshMessage(''), 3000);
        }
      } else {
        setRefreshMessage(data.error || 'Refresh failed. Try again.');
        setTimeout(() => setRefreshMessage(''), 3000);
      }
    } catch (error) {
      console.error('Error refreshing leads:', error);
      setRefreshMessage('Refresh failed. Try again.');
      setTimeout(() => setRefreshMessage(''), 3000);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSwipe = async (direction, feedback = null) => {
    const user = auth.currentUser;
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
    try {
      const companyRef = doc(db, 'users', user.uid, 'companies', company.id);
      await updateDoc(companyRef, {
        status: direction === 'right' ? 'accepted' : 'rejected',
        swipedAt: new Date().toISOString(),
        swipeDirection: direction,
        ...(feedback ? { barryFeedback: feedback, feedbackAt: new Date().toISOString() } : {}),
      });
      const isInterested = direction === 'right';
      const newSwipeCount = isInterested
        ? (lastSwipeDate === today ? dailySwipeCount + 1 : 1)
        : dailySwipeCount;
      const swipeProgressRef = doc(db, 'users', user.uid, 'scoutProgress', 'swipes');
      await setDoc(swipeProgressRef, { dailySwipeCount: newSwipeCount, lastSwipeDate: today, hasSeenTitleSetup });
      setDailySwipeCount(newSwipeCount);
      setLastSwipeDate(today);
      if (isInterested) setTotalAcceptedCompanies(totalAcceptedCompanies + 1);
      setLastSwipe({ company, direction, index: currentIndex, previousSwipeCount: dailySwipeCount });
      setShowUndo(true);
      const icpProfileRef = doc(db, 'users', user.uid, 'companyProfile', 'current');
      const icpProfileDoc = await getDoc(icpProfileRef);
      const icpTitles = icpProfileDoc.exists() ? icpProfileDoc.data().targetTitles || [] : [];
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
                await setDoc(doc(db, 'users', user.uid, 'contacts', contactId), {
                  ...person, company_id: company.id, company_name: company.name,
                  lead_owner: user.uid, status: 'suggested', source: 'icp_auto_discovery',
                  discovered_at: new Date().toISOString(),
                });
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
      const newSkipped = !isInterested ? sessionSkipped + 1 : sessionSkipped;
      setSessionReviewed(newReviewed);
      setSessionSaved(newSaved);
      setSessionSkipped(newSkipped);
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
        setSkippedInSession(prev => [...prev, company.id]);
        undoTimerRef.current = setTimeout(() => setShowUndo(false), 5000);
      } else {
        setShowUndo(false);
        // Remove from skipped list if re-swiped right
        setSkippedInSession(prev => prev.filter(id => id !== company.id));
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
      alert('Failed to save swipe. Please try again.');
    }
  };

  const handleUndo = async () => {
    // Pop from history (last item is the most recent)
    const entry = swipeHistory.length > 0 ? swipeHistory[swipeHistory.length - 1] : lastSwipe;
    if (!entry) return;
    const user = auth.currentUser;
    if (!user) return;
    const today = new Date().toISOString().split('T')[0];
    try {
      const companyRef = doc(db, 'users', user.uid, 'companies', entry.company.id);
      await updateDoc(companyRef, { status: 'pending', swipedAt: null, swipeDirection: null });
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
        setSessionSkipped(prev => Math.max(0, prev - 1));
        setSkippedInSession(prev => prev.filter(id => id !== entry.company.id));
      }
      setSessionReviewed(prev => Math.max(0, prev - 1));
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
    const user = auth.currentUser;
    if (!user) return;
    try {
      const authToken = await user.getIdToken();
      const profileRef = doc(db, 'users', user.uid, 'companyProfile', 'current');
      const profileDoc = await getDoc(profileRef);
      if (!profileDoc.exists()) return;

      // Extract industry signals from companies saved in this batch
      const savedIndustries = [...new Set(savedCompanies.map(c => c.industry).filter(Boolean))];

      // Pull titles from ALL accepted companies' contacts as ICP signal
      const contactsSnap = await getDocs(collection(db, 'users', user.uid, 'contacts'));
      const savedTitles = [...new Set(contactsSnap.docs.map(d => d.data().title).filter(Boolean))];

      fetch('/.netlify/functions/search-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          companyProfile: profileDoc.data(),
          adaptiveSignals: { savedIndustries, savedTitles },
        }),
      }).catch(err => console.error('Adaptive search error:', err));
    } catch (err) {
      console.error('Error triggering adaptive search:', err);
    }
  };

  const handleNextBatch = async () => {
    const snapshot = [...batchSavedCompanies];
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
    const user = auth.currentUser;
    if (!user) return;
    setPeopleLoading(true);
    setPeopleModeEmpty(null);
    const today = new Date().toISOString().split('T')[0];
    todayRef.current = today;
    try {
      const profileRef = doc(db, 'users', user.uid, 'companyProfile', 'current');
      const profileDoc = await getDoc(profileRef);
      const titles = profileDoc.exists() ? (profileDoc.data().targetTitles ?? []) : [];
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

  const handlePersonSwipe = async (direction, feedback = null) => {
    const user = auth.currentUser;
    if (!user) return;
    const today = todayRef.current;
    const personItem = peopleQueue[currentPersonIdx];
    if (!personItem) return;
    const { person, company } = personItem;
    const contactId = `${company.id}_${person.id}`;
    const contactRef = doc(db, 'users', user.uid, 'contacts', contactId);
    try {
      if (direction === 'right') {
        await setDoc(contactRef, { ...person, apollo_person_id: person.id, company_id: company.id, company_name: company.name, lead_owner: user.uid, status: 'suggested', source: 'people_mode', saved_at: new Date().toISOString(), ...(feedback ? { barryFeedback: feedback, feedbackAt: new Date().toISOString() } : {}) }, { merge: true });
        if (company.status === 'pending') {
          const companyRef = doc(db, 'users', user.uid, 'companies', company.id);
          await updateDoc(companyRef, { status: 'accepted', swipedAt: new Date().toISOString(), swipeDirection: 'right', swipe_source: 'people_mode' });
          if (targetTitlesRef.current.length > 0) {
            const formattedTitles = targetTitlesRef.current.map((title, idx) => ({ title, rank: idx + 1, score: 100 - (idx * 10) }));
            await updateDoc(companyRef, { selected_titles: formattedTitles, titles_updated_at: new Date().toISOString(), titles_source: 'icp_auto' });
          }
        }
      } else if (direction === 'left') {
        await setDoc(contactRef, { apollo_person_id: person.id, company_id: company.id, status: 'people_mode_archived', source: 'people_mode', archived_at: new Date().toISOString() }, { merge: true });
      } else if (direction === 'skip') {
        await setDoc(contactRef, { apollo_person_id: person.id, company_id: company.id, status: 'people_mode_skipped', source: 'people_mode', skipped_date: today }, { merge: true });
      }
      const nextIdx = currentPersonIdx + 1;
      const remaining = peopleQueue.length - nextIdx;
      if (remaining < 5) { const activeUser = auth.currentUser; if (activeUser) fetchMorePeople(activeUser, targetTitlesRef.current, today); }
      setCurrentPersonIdx(nextIdx);
      if (nextIdx >= peopleQueue.length && nextCompanyIdxRef.current >= companyPoolRef.current.length) setPeopleModeEmpty('exhausted');
    } catch (err) {
      console.error('Error handling person swipe:', err);
      alert('Failed to save. Please try again.');
    }
  };

  // ── Rendering ───────────────────────────────────────────────────────────────

  const currentCompany = companies[currentIndex];
  const visibleCompanies = companies.slice(currentIndex);

  // Ghost cards for depth effect — CARD_H accounts for header + batch dots + hints
  // so the outer column never overflows and shows no scrollbar
  const CARD_H = isDesktop
    ? 'clamp(440px, calc(100vh - 280px), 660px)'
    : 'clamp(400px, calc(100vh - 300px), 560px)';
  const renderGhostCards = (count) =>
    Array.from({ length: Math.min(count, 2) }).map((_, i) => (
      <div key={i} style={{
        position: 'absolute', top: (i + 1) * 8, left: (i + 1) * 8, right: (i + 1) * 8,
        background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 22,
        height: CARD_H, opacity: 0.15 + (i === 0 ? 0.15 : 0), pointerEvents: 'none',
      }} />
    ));

  // Batch progress dots (10 dots, one per swipe in current batch)
  const renderBatchDots = () => (
    <div style={{ display: 'flex', gap: 5, marginBottom: 16, alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: BATCH_SIZE }).map((_, i) => (
        <div key={i} style={{
          width: 7, height: 7, borderRadius: 4,
          background: i < batchSwipeCount
            ? (i < batchSaves ? BRAND.pink : T.isDark ? '#ffffff30' : '#00000020')
            : T.isDark ? '#ffffff0d' : '#00000010',
          transition: 'all 0.3s',
        }} />
      ))}
      <span style={{ fontSize: 10, color: T.textFaint, marginLeft: 6 }}>{batchSwipeCount}/{BATCH_SIZE}</span>
    </div>
  );

  // Progress dots
  const renderDots = (total, current) => {
    const displayTotal = Math.min(total, 8);
    const remaining = total - current;
    return (
      <div style={{ display: 'flex', gap: 5, marginBottom: 16, alignItems: 'center', justifyContent: 'center' }}>
        {Array.from({ length: displayTotal }).map((_, i) => (
          <div key={i} style={{
            width: i === 0 ? 18 : 7, height: 7, borderRadius: 4,
            background: i < remaining ? (i === 0 ? BRAND.pink : T.isDark ? '#ffffff30' : '#00000020') : T.isDark ? '#ffffff0d' : '#00000010',
            transition: 'all 0.3s',
          }} />
        ))}
        {total > 8 && <span style={{ fontSize: 10, color: T.textFaint }}>+{total - 8}</span>}
        <span style={{ fontSize: 10, color: T.textFaint, marginLeft: 4 }}>{current}/{total}</span>
      </div>
    );
  };

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: T.textMuted }}>
        <Loader size={28} color={BRAND.pink} style={{ animation: 'spin 1s linear infinite' }} />
        <p style={{ fontSize: 13, margin: 0 }}>Loading lead insights...</p>
        <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
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

      {/* Header + tabs */}
      <div style={{ padding: isDesktop ? '20px 32px 0' : '16px 26px 0', background: T.appBg }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isDesktop ? 16 : 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: isDesktop ? 22 : 18, fontWeight: 700, color: T.text }}>Daily Lead Insights</h2>
            <p style={{ margin: '3px 0 0', fontSize: isDesktop ? 13 : 11, color: T.textFaint }}>AI-curated prospects matching your ICP</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isDesktop && (
              <button
                onClick={() => setQueueListOpen(o => !o)}
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
        {refreshMessage && (
          <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: T.accentBg, border: `1px solid ${T.accentBdr}`, color: BRAND.pink, fontSize: 12 }}>
            {refreshMessage}
          </div>
        )}
        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${T.border}` }}>
          {[['companies', 'Companies'], ['people', 'People']].map(([id, label]) => (
            <div
              key={id}
              onClick={() => handleTabSwitch(id)}
              style={{
                padding: '7px 22px', fontSize: 13, cursor: 'pointer',
                borderBottom: `2px solid ${tab === id ? BRAND.pink : 'transparent'}`,
                color: tab === id ? BRAND.pink : T.textMuted,
                background: tab === id ? T.accentBg : 'transparent',
                marginBottom: -1, transition: 'all 0.15s',
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Content area — two-column on desktop */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Card column ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: isDesktop ? '20px 16px 8px' : '18px 12px 8px', overflowY: 'hidden', overflowX: 'hidden', position: 'relative' }}>

          {/* ── Companies Tab ── */}
          {tab === 'companies' && (
            <>
              {companies.length === 0 ? (
                /* Empty queue — session summary if we reviewed something, else find more */
                showSessionSummary || sessionReviewed > 0 ? (
                  <SessionSummaryScreen
                    reviewed={sessionReviewed}
                    saved={sessionSaved}
                    skipped={sessionSkipped}
                    streak={streakDays}
                    savedCompanies={sessionSavedCompanies}
                    onViewSaved={() => onNavigate ? onNavigate('saved') : navigate('/scout', { state: { activeTab: 'saved-companies' } })}
                    onDismiss={() => setShowSessionSummary(false)}
                    onRefresh={handleManualRefresh}
                    isRefreshing={isRefreshing}
                  />
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
                  skipped={sessionSkipped}
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
                  {renderBatchDots()}
                  <div style={{ position: 'relative', width: '100%', maxWidth: isDesktop ? 560 : 440, height: CARD_H, overflowX: 'hidden' }}>
                    {visibleCompanies.length > 1 && renderGhostCards(visibleCompanies.length - 1)}
                    {currentCompany && (
                      <CompanySwipeCard
                        key={currentCompany.id}
                        company={currentCompany}
                        onAccept={(feedback) => handleSwipe('right', feedback)}
                        onReject={() => handleSwipe('left')}
                        wide={isDesktop}
                        icpProfile={icpProfile}
                        icpWeights={icpWeights}
                      />
                    )}

                    {/* Barry nudge card (overlaid at bottom of card) */}
                    {showNudge && nudgeData && (
                      <BarryNudgeCard
                        industry={nudgeData.industry}
                        count={nudgeData.count}
                        onAccept={() => { setShowNudge(false); if (onNavigate) onNavigate('icpsettings'); }}
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
                  <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: isDesktop ? 560 : 440, fontSize: 10, color: T.textGhost }}>
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
                    onClick={() => navigate('/recon')}
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
                  {renderDots(peopleQueue.length, currentPersonIdx)}
                  <div style={{ position: 'relative', width: '100%', maxWidth: isDesktop ? 560 : 440, height: CARD_H, overflowX: 'hidden' }}>
                    {peopleQueue.slice(currentPersonIdx + 1, currentPersonIdx + 3).map((_, i) => (
                      <div key={i} style={{ position: 'absolute', top: (i + 1) * 8, left: (i + 1) * 8, right: (i + 1) * 8, background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 22, height: CARD_H, opacity: 0.15 + (i === 0 ? 0.15 : 0), pointerEvents: 'none' }} />
                    ))}
                    <PersonSwipeCard
                      key={`${peopleQueue[currentPersonIdx].company.id}_${peopleQueue[currentPersonIdx].person.id}`}
                      person={peopleQueue[currentPersonIdx].person}
                      company={peopleQueue[currentPersonIdx].company}
                      matchText={getBarryText(peopleQueue[currentPersonIdx].person, peopleQueue[currentPersonIdx].company, targetTitles)}
                      onAccept={(feedback) => handlePersonSwipe('right', feedback)}
                      onReject={() => handlePersonSwipe('left')}
                      onSkip={() => handlePersonSwipe('skip')}
                      wide={isDesktop}
                    />
                  </div>
                  <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: isDesktop ? 560 : 440, fontSize: 10, color: T.textGhost }}>
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
                  ['SKIPPED', sessionSkipped, T.textMuted, T.surface],
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
                onClick={() => setQueueListOpen(o => !o)}
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
                        <div style={{ fontSize: 16, flexShrink: 0 }}>{co.emoji || co.logo || '🏢'}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{co.name}</div>
                          <div style={{ fontSize: 10, color: T.textFaint }}>{co.fit_score || 0}/100</div>
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
          onClose={() => setShowICPChat(false)}
          onSearchComplete={() => {
            resetBatch();
            loadTodayLeads();
          }}
        />
      )}

      {/* Barry ICP-aware side panel (manual trigger) */}
      {barryPanelOpen && (
        <BarryICPPanel
          userId={auth.currentUser?.uid}
          icpProfile={icpProfile}
          onClose={() => setBarryPanelOpen(false)}
          onSearchComplete={() => {
            setBarryPanelOpen(false);
            loadTodayLeads();
          }}
        />
      )}

      {/* Queue list panel */}
      {queueListOpen && isDesktop && (
        <QueueListPanel
          companies={companies}
          currentIndex={currentIndex}
          skippedIds={skippedInSession}
          onJumpTo={(idx) => setCurrentIndex(idx)}
          onClose={() => setQueueListOpen(false)}
        />
      )}
    </div>
  );
}
