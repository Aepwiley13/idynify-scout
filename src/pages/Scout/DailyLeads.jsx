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
import { Globe, Linkedin, Check, X, RefreshCw, Loader, Settings, RotateCcw } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND, STATUS, ASSETS } from '../../theme/tokens';
import ContactTitleSetup from '../../components/scout/ContactTitleSetup';

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

// ─── CompanySwipeCard ─────────────────────────────────────────────────────────
function CompanySwipeCard({ company, onAccept, onReject, wide = false }) {
  const T = useT();
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [gone, setGone] = useState(null);
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
    if (dx > 100) { setGone('r'); setTimeout(onAccept, 280); }
    else if (dx < -100) { setGone('l'); setTimeout(onReject, 280); }
    else { setDx(0); setDy(0); }
    s.current = null;
  };

  const tx = gone === 'r' ? 700 : gone === 'l' ? -700 : dx;
  const sc = (company.fit_score || company.score || 0) >= 80
    ? STATUS.green
    : (company.fit_score || company.score || 0) >= 60
    ? STATUS.amber
    : STATUS.red;

  const score = company.fit_score || company.score || 0;
  const barryText = company.barry_intel || company.barry_context || company.barryIntel
    || `${company.name} is a ${company.industry || 'company'} — review their profile to assess fit.`;

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
        <div style={{
          position: 'absolute', top: 22, left: 16, zIndex: 10,
          padding: '5px 13px', borderRadius: 8,
          border: `3px solid ${STATUS.green}`, color: STATUS.green,
          fontSize: 13, fontWeight: 700, transform: 'rotate(-11deg)',
          background: `${STATUS.green}10`,
        }}>✓ IT'S A MATCH</div>
      )}
      {dx < -30 && (
        <div style={{
          position: 'absolute', top: 22, right: 16, zIndex: 10,
          padding: '5px 13px', borderRadius: 8,
          border: `3px solid ${STATUS.red}`, color: STATUS.red,
          fontSize: 13, fontWeight: 700, transform: 'rotate(11deg)',
          background: `${STATUS.red}10`,
        }}>✗ NOT A MATCH</div>
      )}
      <div style={{
        background: T.cardBg, border: `1px solid ${T.border2}`,
        borderRadius: 22, overflow: 'hidden',
        boxShadow: `0 28px 70px ${T.isDark ? '#00000099' : '#00000018'}`,
        maxHeight: wide ? 'clamp(500px, calc(100vh - 160px), 700px)' : 'clamp(460px, calc(100vh - 200px), 570px)',
        overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{
          padding: wide ? '24px 28px 18px' : '20px 22px 14px', display: 'flex', flexDirection: 'column',
          alignItems: 'center', background: T.cardBg2, borderBottom: `1px solid ${T.border}`,
        }}>
          <div style={{
            width: wide ? 80 : 68, height: wide ? 80 : 68, borderRadius: 18, background: T.surface,
            border: `1px solid ${T.border2}`, display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: wide ? 36 : 30, marginBottom: 14,
          }}>
            {company.emoji || company.logo || '🏢'}
          </div>
          <div style={{ fontSize: wide ? 22 : 20, fontWeight: 700, color: T.text }}>{company.name}</div>
          <div style={{ fontSize: 10, color: T.textFaint, marginTop: 3, letterSpacing: 1.5 }}>
            {(company.industry || '').toUpperCase()}
          </div>
        </div>
        {/* Stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: `1px solid ${T.border}` }}>
          {[
            ['INDUSTRY',  company.industry || 'N/A'],
            ['EMPLOYEES', company.employee_count || company.company_size || 'N/A'],
            ['REVENUE',   company.revenue || 'N/A'],
            ['FOUNDED',   company.founded_year || 'N/A'],
          ].map(([l, v]) => (
            <div key={l} style={{ padding: wide ? '13px 20px' : '11px 16px', borderRight: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 9, letterSpacing: 2, color: T.textFaint, marginBottom: 3 }}>{l}</div>
              <div style={{ fontSize: wide ? 13 : 12, color: T.textMuted }}>{v}</div>
            </div>
          ))}
        </div>
        {/* Barry Intel */}
        <div style={{ padding: wide ? '14px 20px' : '12px 16px', borderBottom: `1px solid ${T.border}`, background: T.accentBg }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
            <BarryAvatar size={20} />
            <span style={{ fontSize: 9, letterSpacing: 2, color: BRAND.pink, fontWeight: 700 }}>BARRY INTEL</span>
          </div>
          <p style={{ margin: 0, fontSize: wide ? 13 : 12, color: T.isDark ? '#d0a0c0' : T.textMuted, lineHeight: 1.6 }}>
            {barryText}
          </p>
        </div>
        {/* Action links */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: wide ? '13px 16px' : '11px 12px', borderBottom: `1px solid ${T.border}` }}>
          <button
            onClick={e => { e.stopPropagation(); if (company.website_url) window.open(company.website_url, '_blank'); }}
            style={{ padding: wide ? '10px 12px' : 8, borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#7c5ce4,#6c4fd6)', color: '#fff', fontSize: wide ? 12 : 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
          ><Globe size={13} />Visit Website</button>
          <button
            onClick={e => { e.stopPropagation(); if (company.linkedin_url) window.open(company.linkedin_url, '_blank'); }}
            style={{ padding: wide ? '10px 12px' : 8, borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#0077b5,#005e94)', color: '#fff', fontSize: wide ? 12 : 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
          ><Linkedin size={13} />LinkedIn</button>
        </div>
        {/* Decision buttons */}
        <div style={{ display: 'flex', gap: 8, padding: wide ? '13px 16px' : '11px 12px' }}>
          <button
            onClick={e => { e.stopPropagation(); setGone('l'); setTimeout(onReject, 280); }}
            style={{ flex: 1, padding: wide ? 13 : 11, borderRadius: 11, border: `1.5px solid ${STATUS.red}40`, background: `${STATUS.red}0c`, color: STATUS.red, fontSize: wide ? 14 : 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
          ><X size={15} />Not a Match</button>
          <button
            onClick={e => { e.stopPropagation(); setGone('r'); setTimeout(onAccept, 280); }}
            style={{ flex: 1, padding: wide ? 13 : 11, borderRadius: 11, border: `1.5px solid ${STATUS.green}40`, background: `${STATUS.green}0c`, color: STATUS.green, fontSize: wide ? 14 : 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
          ><Check size={15} />This is a Match</button>
        </div>
        {/* Score footer */}
        <div style={{ padding: wide ? '11px 20px 16px' : '9px 16px 14px', borderTop: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 9, letterSpacing: 2, color: T.textFaint, marginBottom: 2 }}>COMPANY LEAD SCORE</div>
            <span style={{ fontSize: wide ? 22 : 20, fontWeight: 800, color: sc }}>{score}</span>
            <span style={{ fontSize: 11, color: T.textFaint }}>/100</span>
          </div>
          <div style={{ fontSize: 9, color: T.textFaint, padding: '3px 9px', background: T.surface, borderRadius: 6, border: `1px solid ${T.border}` }}>
            {score >= 80 ? 'STRONG FIT' : score >= 60 ? 'NEEDS REVIEW' : 'LOW FIT'}
          </div>
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
    if (dx > 100) { setGone('r'); setTimeout(onAccept, 280); }
    else if (dx < -100) { setGone('l'); setTimeout(onReject, 280); }
    else { setDx(0); setDy(0); }
    s.current = null;
  };

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
      <div style={{ background: T.cardBg, border: `1px solid ${T.border2}`, borderRadius: 22, overflow: 'hidden', boxShadow: `0 28px 70px ${T.isDark ? '#00000099' : '#00000018'}`, maxHeight: wide ? 'clamp(500px, calc(100vh - 160px), 700px)' : 'clamp(460px, calc(100vh - 200px), 570px)', overflowY: 'auto' }}>
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
          <button
            onClick={e => { e.stopPropagation(); if (company?.website_url || person.organization?.website_url) window.open(company?.website_url || person.organization?.website_url, '_blank'); }}
            style={{ padding: wide ? '10px 12px' : 8, borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#7c5ce4,#6c4fd6)', color: '#fff', fontSize: wide ? 12 : 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
          ><Globe size={13} />Visit Website</button>
          <button
            onClick={e => { e.stopPropagation(); if (person.linkedin_url) window.open(person.linkedin_url, '_blank'); }}
            style={{ padding: wide ? '10px 12px' : 8, borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#0077b5,#005e94)', color: '#fff', fontSize: wide ? 12 : 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
          ><Linkedin size={13} />LinkedIn</button>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: wide ? '13px 16px 6px' : '11px 12px 6px' }}>
          <button
            onClick={e => { e.stopPropagation(); setGone('l'); setTimeout(onReject, 280); }}
            style={{ flex: 1, padding: wide ? 13 : 11, borderRadius: 11, border: `1.5px solid ${STATUS.red}40`, background: `${STATUS.red}0c`, color: STATUS.red, fontSize: wide ? 14 : 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
          ><X size={15} />Not a Match</button>
          <button
            onClick={e => { e.stopPropagation(); setGone('r'); setTimeout(onAccept, 280); }}
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

// ─── DailyLeads ──────────────────────────────────────────────────────────────
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

  // ── Company Mode ────────────────────────────────────────────────────────────

  const loadTodayLeads = async () => {
    try {
      const user = auth.currentUser;
      if (!user) { navigate('/login'); return; }

      const profileRef = doc(db, 'users', user.uid, 'companyProfile', 'current');
      const profileDoc = await getDoc(profileRef);
      if (!profileDoc.exists()) { setLoading(false); return; }

      const companiesRef = collection(db, 'users', user.uid, 'companies');
      const q = query(companiesRef, where('status', '==', 'pending'));
      const snapshot = await getDocs(q);
      const companiesData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      companiesData.sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));
      setCompanies(companiesData);

      const acceptedQuery = query(companiesRef, where('status', '==', 'accepted'));
      const acceptedSnapshot = await getDocs(acceptedQuery);
      setTotalAcceptedCompanies(acceptedSnapshot.size);

      const swipeProgressRef = doc(db, 'users', user.uid, 'scoutProgress', 'swipes');
      const swipeProgressDoc = await getDoc(swipeProgressRef);
      if (swipeProgressDoc.exists()) {
        const data = swipeProgressDoc.data();
        const today = new Date().toISOString().split('T')[0];
        if (data.lastSwipeDate === today) setDailySwipeCount(data.dailySwipeCount || 0);
        else setDailySwipeCount(0);
        setLastSwipeDate(data.lastSwipeDate || '');
        setHasSeenTitleSetup(data.hasSeenTitleSetup || false);
      }
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

  const handleSwipe = async (direction) => {
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
    try {
      const companyRef = doc(db, 'users', user.uid, 'companies', company.id);
      await updateDoc(companyRef, {
        status: direction === 'right' ? 'accepted' : 'rejected',
        swipedAt: new Date().toISOString(),
        swipeDirection: direction,
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
      if (currentIndex < companies.length - 1) setCurrentIndex(currentIndex + 1);
      else loadTodayLeads();
    } catch (error) {
      console.error('Error handling swipe:', error);
      alert('Failed to save swipe. Please try again.');
    }
  };

  const handleUndo = async () => {
    if (!lastSwipe) return;
    const user = auth.currentUser;
    if (!user) return;
    const today = new Date().toISOString().split('T')[0];
    try {
      const companyRef = doc(db, 'users', user.uid, 'companies', lastSwipe.company.id);
      await updateDoc(companyRef, { status: 'pending', swipedAt: null, swipeDirection: null });
      if (lastSwipe.direction === 'right') {
        const swipeProgressRef = doc(db, 'users', user.uid, 'scoutProgress', 'swipes');
        await setDoc(swipeProgressRef, { dailySwipeCount: lastSwipe.previousSwipeCount, lastSwipeDate: today, hasSeenTitleSetup });
        setDailySwipeCount(lastSwipe.previousSwipeCount);
        setTotalAcceptedCompanies(totalAcceptedCompanies - 1);
        await updateDoc(companyRef, { selected_titles: null, titles_updated_at: null, titles_source: null, auto_contact_status: null, auto_contact_count: null, auto_contact_searched_at: null });
        const autoContactsQuery = query(collection(db, 'users', user.uid, 'contacts'), where('company_id', '==', lastSwipe.company.id), where('source', '==', 'icp_auto_discovery'));
        const autoContactDocs = await getDocs(autoContactsQuery);
        for (const contactDoc of autoContactDocs.docs) await deleteDoc(contactDoc.ref);
      }
      setCurrentIndex(lastSwipe.index);
      setLastSwipe(null);
      setShowUndo(false);
    } catch (error) {
      console.error('Error undoing swipe:', error);
      alert('Failed to undo swipe. Please try again.');
    }
  };

  const handleTitleSetupComplete = () => setShowTitleSetup(false);

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

  const handlePersonSwipe = async (direction) => {
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
        await setDoc(contactRef, { ...person, apollo_person_id: person.id, company_id: company.id, company_name: company.name, lead_owner: user.uid, status: 'suggested', source: 'people_mode', saved_at: new Date().toISOString() }, { merge: true });
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

  // Ghost cards for depth effect — height matches card wrapper
  const CARD_H = isDesktop
    ? 'clamp(500px, calc(100vh - 160px), 700px)'
    : 'clamp(460px, calc(100vh - 200px), 570px)';
  const renderGhostCards = (count) =>
    Array.from({ length: Math.min(count, 2) }).map((_, i) => (
      <div key={i} style={{
        position: 'absolute', top: (i + 1) * 8, left: (i + 1) * 8, right: (i + 1) * 8,
        background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 22,
        height: CARD_H, opacity: 0.15 + (i === 0 ? 0.15 : 0), pointerEvents: 'none',
      }} />
    ));

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
      {/* Header + tabs */}
      <div style={{ padding: isDesktop ? '20px 32px 0' : '16px 26px 0', background: T.appBg }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isDesktop ? 16 : 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: isDesktop ? 22 : 18, fontWeight: 700, color: T.text }}>Daily Lead Insights</h2>
            <p style={{ margin: '3px 0 0', fontSize: isDesktop ? 13 : 11, color: T.textFaint }}>AI-curated prospects matching your ICP</p>
          </div>
          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            title="Refresh queue"
            style={{ width: 34, height: 34, borderRadius: 9, background: T.surface, border: `1px solid ${T.border2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: isRefreshing ? 'not-allowed' : 'pointer', opacity: isRefreshing ? 0.5 : 1 }}
          >
            <RefreshCw size={14} color={T.textMuted} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
          </button>
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
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: isDesktop ? '20px 16px 8px' : '18px 12px 8px', overflowY: 'auto', overflowX: 'hidden' }}>

          {/* ── Companies Tab ── */}
          {tab === 'companies' && (
            <>
              {companies.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 50, color: T.textMuted }}>
                  <div style={{ fontSize: 44, marginBottom: 12 }}>🎯</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: BRAND.pink, marginBottom: 8 }}>ALL COMPANIES REVIEWED</div>
                  <p style={{ fontSize: 12, color: T.textFaint, marginBottom: 16 }}>
                    {companies.length === 0 ? "No pending companies in your queue." : "You've reviewed all companies for today."}
                  </p>
                  <button
                    onClick={handleManualRefresh}
                    disabled={isRefreshing}
                    style={{ padding: '10px 22px', borderRadius: 10, background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, margin: '0 auto' }}
                  >
                    {isRefreshing ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />}
                    Find More Targets
                  </button>
                  {totalAcceptedCompanies > 0 && (
                    <button
                      onClick={() => onNavigate ? onNavigate('saved') : navigate('/scout', { state: { activeTab: 'saved-companies' } })}
                      style={{ marginTop: 10, padding: '8px 20px', borderRadius: 10, background: T.cyanBg, border: `1px solid ${T.cyanBdr}`, color: T.cyan, fontSize: 12, cursor: 'pointer' }}
                    >
                      View {totalAcceptedCompanies} Saved Companies →
                    </button>
                  )}
                </div>
              ) : currentIndex >= companies.length ? (
                <div style={{ textAlign: 'center', padding: 50, color: T.textMuted }}>
                  <div style={{ fontSize: 44, marginBottom: 12 }}>🎯</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: BRAND.pink, marginBottom: 8 }}>SESSION COMPLETE</div>
                  <p style={{ fontSize: 12, color: T.textFaint, marginBottom: 16 }}>You've reviewed all targets in this session.</p>
                  <button
                    onClick={() => { setCurrentIndex(0); loadTodayLeads(); }}
                    style={{ padding: '8px 20px', borderRadius: 10, background: T.accentBg, border: `1px solid ${T.accentBdr}`, color: BRAND.pink, cursor: 'pointer', fontSize: 12 }}
                  >Reset Queue</button>
                </div>
              ) : (
                <>
                  {renderDots(companies.length, currentIndex)}
                  <div style={{ position: 'relative', width: '100%', maxWidth: isDesktop ? 560 : 440, height: CARD_H, overflowX: 'hidden' }}>
                    {visibleCompanies.length > 1 && renderGhostCards(visibleCompanies.length - 1)}
                    {currentCompany && (
                      <CompanySwipeCard
                        key={currentCompany.id}
                        company={currentCompany}
                        onAccept={() => handleSwipe('right')}
                        onReject={() => handleSwipe('left')}
                        wide={isDesktop}
                      />
                    )}
                  </div>
                  {showUndo && lastSwipe && (
                    <button
                      onClick={handleUndo}
                      style={{ marginTop: 14, padding: '8px 18px', borderRadius: 10, background: T.surface, border: `1px solid ${T.border2}`, color: T.textMuted, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}
                    >
                      <RotateCcw size={13} />Undo last swipe
                    </button>
                  )}
                  <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: isDesktop ? 560 : 440, fontSize: 10, color: T.textGhost }}>
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
                      onAccept={() => handlePersonSwipe('right')}
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
            gap: 16,
          }}>
            {/* Daily progress */}
            <div>
              <div style={{ fontSize: 9, letterSpacing: 2, fontWeight: 700, color: T.textFaint, marginBottom: 10 }}>TODAY'S PROGRESS</div>
              <div style={{ height: 5, background: T.border, borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min((dailySwipeCount / DAILY_SWIPE_LIMIT) * 100, 100)}%`,
                  background: `linear-gradient(90deg, ${BRAND.pink}, ${BRAND.cyan})`,
                  borderRadius: 3,
                  transition: 'width 0.4s ease',
                }} />
              </div>
              <div style={{ fontSize: 11, color: T.textMuted }}>
                <span style={{ fontWeight: 700, color: T.text }}>{dailySwipeCount}</span>
                <span style={{ color: T.textFaint }}> / {DAILY_SWIPE_LIMIT} matches today</span>
              </div>
            </div>

            {/* Stats grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ padding: '10px 12px', background: T.surface, borderRadius: 10, border: `1px solid ${T.border2}` }}>
                <div style={{ fontSize: 9, letterSpacing: 1.5, color: T.textFaint, marginBottom: 5 }}>IN QUEUE</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: T.text, lineHeight: 1 }}>
                  {Math.max(0, companies.length - currentIndex)}
                </div>
              </div>
              <div style={{ padding: '10px 12px', background: T.accentBg, borderRadius: 10, border: `1px solid ${T.accentBdr}` }}>
                <div style={{ fontSize: 9, letterSpacing: 1.5, color: T.textFaint, marginBottom: 5 }}>SAVED</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: BRAND.pink, lineHeight: 1 }}>
                  {totalAcceptedCompanies}
                </div>
              </div>
            </div>

            {/* View saved button */}
            {totalAcceptedCompanies > 0 && (
              <button
                onClick={() => onNavigate ? onNavigate('saved') : navigate('/scout', { state: { activeTab: 'saved-companies' } })}
                style={{
                  padding: '10px 14px', borderRadius: 10,
                  background: `linear-gradient(135deg, ${BRAND.pink}, #c0146a)`,
                  border: 'none', color: '#fff', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', width: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                View {totalAcceptedCompanies} Saved →
              </button>
            )}

            {/* Divider */}
            <div style={{ height: 1, background: T.border }} />

            {/* How it works */}
            <div>
              <div style={{ fontSize: 9, letterSpacing: 2, fontWeight: 700, color: T.textFaint, marginBottom: 10 }}>HOW IT WORKS</div>
              {[
                ['→ Right drag', 'Add to hunt list'],
                ['← Left drag', 'Sharpens targeting'],
                ['↩ Undo', 'Reverse last action'],
                ['↻ Refresh', 'Find new targets'],
              ].map(([key, desc]) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${T.border}` }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: BRAND.pink }}>{key}</span>
                  <span style={{ fontSize: 11, color: T.textFaint }}>{desc}</span>
                </div>
              ))}
            </div>

            {/* Barry branding */}
            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: T.accentBg, borderRadius: 10, border: `1px solid ${T.accentBdr}` }}>
              <BarryAvatar size={24} />
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: BRAND.pink }}>Barry AI</div>
                <div style={{ fontSize: 9, color: T.textFaint }}>Curating your queue daily</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {showTitleSetup && <ContactTitleSetup onComplete={handleTitleSetupComplete} />}
    </div>
  );
}
