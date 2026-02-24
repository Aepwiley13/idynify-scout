import { useEffect, useState, useRef, useCallback } from 'react';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { getScoreBreakdown } from '../../utils/icpScoring';
import { getActiveMissions, assignCompanyToMission } from '../../services/missionService';
import { generateOpeningMessage, copyToClipboard } from '../../services/outreachService';
import { deprioritizeCompany } from '../../services/statusService';
import OutreachConsole from './OutreachConsole';
import MissionAssignModal from './MissionAssignModal';
import './MissionControl.css';

const ICP_SCORE_THRESHOLD = 70;

function seededRandom(seed) {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

function getCategory(company) {
  if (
    company.status === 'accepted' ||
    (company.fit_score && company.fit_score >= ICP_SCORE_THRESHOLD)
  ) {
    return 'som';
  } else if (company.status !== 'rejected' && company.status !== 'deprioritized') {
    return 'sam';
  }
  return 'tam';
}

function getDotColor(company) {
  const score = company.fit_score || 0;
  if (score >= 70) return '#00FF88';
  if (score >= 40) return '#FFD700';
  return '#5A6A7A';
}

function getScoreColor(score) {
  if (score >= 70) return '#00FF88';
  if (score >= 40) return '#FFD700';
  return '#FF4466';
}

function getClassification(score) {
  if (score >= 70) return 'HIGH VALUE TARGET';
  if (score >= 40) return 'MONITOR';
  return 'LOW PRIORITY';
}

function getStatusLabel(status) {
  if (!status || status === 'not_reviewed') return 'NOT REVIEWED';
  if (status === 'accepted' || status === 'interested') return 'INTERESTED';
  if (status === 'rejected' || status === 'archived') return 'ARCHIVED';
  if (status === 'deprioritized') return 'DEPRIORITIZED';
  return status.toUpperCase().replace(/_/g, ' ');
}

function getStatusClass(status) {
  if (status === 'accepted' || status === 'interested') return 'interested';
  if (status === 'rejected' || status === 'archived') return 'archived';
  if (status === 'deprioritized') return 'archived';
  return 'not-reviewed';
}

function formatTimestamp(ts) {
  if (!ts) return '';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
  return date.toLocaleDateString();
}

function getRankScore(company) {
  const fitScore = company.fit_score || 0;
  const hasSignals =
    (company.signals && company.signals.length > 0) || company.status === 'accepted' ? 1 : 0;
  const statusWeight =
    company.status === 'accepted' || company.status === 'interested'
      ? 1
      : company.status === 'rejected' ||
        company.status === 'archived' ||
        company.status === 'deprioritized'
      ? 0
      : 0.5;
  return fitScore * 0.5 + hasSignals * 30 + statusWeight * 20;
}

function rankCompanies(companiesArr) {
  return [...companiesArr]
    .map((c) => ({ ...c, rankScore: getRankScore(c) }))
    .sort((a, b) => b.rankScore - a.rankScore);
}

function useCountUp(target, duration = 1400, active = false) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (target === 0) { setValue(0); return; }
    let start = null;
    const step = (ts) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration, active]);
  return value;
}

export default function MissionControl() {
  const [companies, setCompanies] = useState([]);
  const [icpProfile, setIcpProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all');
  const [hoveredCompany, setHoveredCompany] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [statsReady, setStatsReady] = useState(false);

  // Phase 2 state
  const [barryBriefings, setBarryBriefings] = useState({});
  const [barryLoading, setBarryLoading] = useState(false);
  const [activeMissionTab, setActiveMissionTab] = useState('ready');
  const [collapsedSections, setCollapsedSections] = useState({});

  // Phase 3 state
  const [outreachTarget, setOutreachTarget] = useState(null);   // company for outreach modal
  const [missionTarget, setMissionTarget] = useState(null);      // company for assign modal
  const [deprioritizeConfirm, setDeprioritizeConfirm] = useState(null); // companyId pending confirm
  const [toasts, setToasts] = useState([]);

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const animFrameRef = useRef(null);
  const dotsRef = useRef([]);
  const sweepAngleRef = useRef(0);
  const activeFilterRef = useRef('all');
  const lastTimeRef = useRef(0);
  const dossierRef = useRef(null);
  const deprioritizeTimerRef = useRef(null);
  const toastCountRef = useRef(0);
  const deprioritizedIdsRef = useRef(new Set()); // for canvas dim — no re-render needed

  useEffect(() => { loadData(); }, []);
  useEffect(() => { activeFilterRef.current = activeFilter; }, [activeFilter]);

  // ESC closes dossier (modals handle their own ESC)
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape' && !outreachTarget && !missionTarget) {
        setSelectedTarget(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [outreachTarget, missionTarget]);

  // Clean up deprioritize timer on unmount
  useEffect(() => {
    return () => clearTimeout(deprioritizeTimerRef.current);
  }, []);

  // Barry dossier briefing — fetch when target opens, cache per session
  useEffect(() => {
    if (!selectedTarget) return;
    const id = selectedTarget.id;
    if (barryBriefings[id]) return;

    async function fetchBriefing() {
      setBarryLoading(true);
      try {
        const user = auth.currentUser;
        if (!user) return;
        const authToken = await user.getIdToken();
        const resp = await fetch('/.netlify/functions/barryDossierBriefing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ authToken, userId: user.uid, company: selectedTarget, icpProfile }),
        });
        const data = await resp.json();
        if (data.briefing) {
          setBarryBriefings((prev) => ({ ...prev, [id]: data.briefing }));
        }
      } catch (err) {
        console.error('Barry briefing error:', err);
      } finally {
        setBarryLoading(false);
      }
    }
    fetchBriefing();
  }, [selectedTarget?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const [profileDoc, companiesSnapshot] = await Promise.all([
        getDoc(doc(db, 'users', user.uid, 'companyProfile', 'current')),
        getDocs(collection(db, 'users', user.uid, 'companies')),
      ]);
      const profile = profileDoc.exists() ? profileDoc.data() : null;
      setIcpProfile(profile);
      const allCompanies = companiesSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setCompanies(allCompanies);
      setLoading(false);
      setTimeout(() => setStatsReady(true), 200);
    } catch (error) {
      console.error('Failed to load mission control data:', error);
      setLoading(false);
    }
  }

  function openDossier(company) {
    setSelectedTarget(company);
    setCollapsedSections({});
    setDeprioritizeConfirm(null);
    clearTimeout(deprioritizeTimerRef.current);
  }

  function toggleSection(key) {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  // ── Toast System ──────────────────────────────────────────────────────────
  function addToast(message, type = 'success') {
    const id = ++toastCountRef.current;
    setToasts((prev) => [...prev.slice(-2), { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }

  // ── Deprioritize Handlers ─────────────────────────────────────────────────
  function handleDeprioritizeClick(companyId) {
    if (deprioritizeConfirm === companyId) return;
    setDeprioritizeConfirm(companyId);
    clearTimeout(deprioritizeTimerRef.current);
    deprioritizeTimerRef.current = setTimeout(() => setDeprioritizeConfirm(null), 5000);
  }

  function handleDeprioritizeCancel() {
    clearTimeout(deprioritizeTimerRef.current);
    setDeprioritizeConfirm(null);
  }

  async function handleDeprioritizeConfirm(company) {
    clearTimeout(deprioritizeTimerRef.current);
    setDeprioritizeConfirm(null);
    const user = auth.currentUser;
    if (!user) return;

    const result = await deprioritizeCompany(user.uid, company.id);
    if (result.success) {
      // Dim on radar
      deprioritizedIdsRef.current = new Set([...deprioritizedIdsRef.current, company.id]);
      // Update companies list so ranking re-sorts
      setCompanies((prev) =>
        prev.map((c) => (c.id === company.id ? { ...c, status: 'deprioritized' } : c))
      );
      // Close dossier if it was for this company
      if (selectedTarget?.id === company.id) setSelectedTarget(null);
      addToast('TARGET DEPRIORITIZED — moved to Long Range');
    } else {
      addToast('Failed to deprioritize — try again', 'error');
    }
  }

  // ── Mission Assign Success ────────────────────────────────────────────────
  function handleMissionAssignSuccess(missionName) {
    addToast(`TARGET ASSIGNED — ${missionName}`);
  }

  // ── Derived Data ──────────────────────────────────────────────────────────
  const tam = companies;
  const sam = companies.filter((c) => c.status !== 'rejected' && c.status !== 'deprioritized');
  const som = companies.filter(
    (c) =>
      c.status === 'accepted' ||
      (c.fit_score && c.fit_score >= ICP_SCORE_THRESHOLD)
  );

  const signalPct = tam.length > 0 ? (som.length / tam.length) * 100 : 0;
  const marketStatus = signalPct > 20 ? '🔥 HOT' : signalPct > 10 ? '⚡ WARM' : '❄️ COLD';
  const marketStatusClass = signalPct > 20 ? 'hot' : signalPct > 10 ? 'warm' : 'cold';

  const now = new Date();
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  const timeframe = `Q${quarter} ${now.getFullYear()}`;

  const territory = icpProfile
    ? [
        icpProfile.industries?.slice(0, 2).join(', '),
        icpProfile.isNationwide ? 'Nationwide' : icpProfile.locations?.slice(0, 3).join(', '),
      ].filter(Boolean).join(' · ')
    : '—';

  const industryName = icpProfile?.industries?.[0] || 'your target segment';

  const tickerItems = [
    `● ${industryName} segment activity up 23% this month`,
    `● ${sam.length} accounts showing active status this week`,
    `● Companies in ${industryName} convert 1.8× faster than average`,
    `● ${Math.max(0, tam.length - sam.length)} archived accounts removed from active pipeline`,
    `● Barry detected triggers in ${som.length} priority accounts`,
    `● ${som.length} priority targets identified in your obtainable market`,
    `● ${tam.length} total companies mapped in your universe`,
    `● ICP high-priority rate: ${tam.length > 0 ? Math.round((som.length / tam.length) * 100) : 0}% of market`,
  ];

  const tamCount = useCountUp(tam.length, 1400, statsReady);
  const samCount = useCountUp(sam.length, 1400, statsReady);
  const somCount = useCountUp(som.length, 1400, statsReady);

  // ── Mission Target Ranking ─────────────────────────────────────────────────
  const ranked = rankCompanies(companies);
  const missionReady = ranked.slice(0, 10);
  const warming = ranked.slice(10, 35);
  const longRange = ranked.slice(35);
  const activeBucket =
    activeMissionTab === 'ready' ? missionReady :
    activeMissionTab === 'warming' ? warming : longRange;

  // ── Radar Dot Generation ──────────────────────────────────────────────────
  function generateDots(companiesArr, canvasW, canvasH) {
    const cx = canvasW / 2;
    const cy = canvasH / 2;
    const maxR = Math.min(cx, cy) * 0.88;

    return companiesArr.map((company, i) => {
      const category = getCategory(company);
      let minR, maxRing;
      if (category === 'som') { minR = maxR * 0.04; maxRing = maxR * 0.30; }
      else if (category === 'sam') { minR = maxR * 0.34; maxRing = maxR * 0.60; }
      else { minR = maxR * 0.64; maxRing = maxR * 0.90; }

      const angle = seededRandom(i * 2.3 + 1) * Math.PI * 2;
      const r = minR + seededRandom(i * 3.7 + 2) * (maxRing - minR);
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      const dotSize = 2.5 + seededRandom(i * 1.7 + 3) * 3.0;
      const color = getDotColor(company);
      const hasSignal =
        company.status === 'accepted' ||
        (company.fit_score && company.fit_score >= ICP_SCORE_THRESHOLD);

      return { ...company, x, y, dotAngle: angle, dotR: r, category, color, dotSize, hasSignal };
    });
  }

  // ── Canvas Animation ──────────────────────────────────────────────────────
  useEffect(() => {
    if (loading || !canvasRef.current || !containerRef.current) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;

    function resize() {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      canvas.width = rect.width;
      canvas.height = rect.height;
      dotsRef.current = generateDots(companies, canvas.width, canvas.height);
    }

    resize();
    const resizeObs = new ResizeObserver(resize);
    resizeObs.observe(container);
    const ctx = canvas.getContext('2d');
    const RPM = 0.5;
    const SWEEP_SPEED = (RPM * 2 * Math.PI) / 60;

    function draw(timestamp) {
      if (!canvas.width || !canvas.height) {
        animFrameRef.current = requestAnimationFrame(draw);
        return;
      }
      const dt = lastTimeRef.current ? Math.min((timestamp - lastTimeRef.current) / 1000, 0.05) : 0;
      lastTimeRef.current = timestamp;
      sweepAngleRef.current = (sweepAngleRef.current + SWEEP_SPEED * dt) % (Math.PI * 2);

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const maxR = Math.min(cx, cy) * 0.88;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Background grid
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.04)';
      ctx.lineWidth = 0.5;
      for (let gx = 0; gx < canvas.width; gx += 50) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, canvas.height); ctx.stroke();
      }
      for (let gy = 0; gy < canvas.height; gy += 50) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(canvas.width, gy); ctx.stroke();
      }

      // Crosshair lines
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.06)';
      ctx.lineWidth = 0.5;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR);
        ctx.stroke();
      }

      // Rings
      const rings = [
        { r: maxR * 0.90, label: 'TAM', rgb: '0,212,255', opacity: 0.22 },
        { r: maxR * 0.60, label: 'SAM', rgb: '0,212,255', opacity: 0.38 },
        { r: maxR * 0.30, label: 'SOM', rgb: '0,255,136', opacity: 0.60 },
      ];
      rings.forEach((ring) => {
        ctx.beginPath();
        ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${ring.rgb},${ring.opacity})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
          const inner = ring.r - 4; const outer = ring.r + 4;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
          ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
          ctx.strokeStyle = `rgba(${ring.rgb},${ring.opacity * 1.6})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
        ctx.fillStyle = `rgba(${ring.rgb},0.45)`;
        ctx.font = '9px "Courier New", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(ring.label, cx + ring.r + 8, cy + 4);
      });

      // Radar sweep
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(sweepAngleRef.current);
      const sweepGrad = ctx.createLinearGradient(0, 0, maxR, 0);
      sweepGrad.addColorStop(0, 'rgba(0,212,255,0.0)');
      sweepGrad.addColorStop(0.4, 'rgba(0,212,255,0.04)');
      sweepGrad.addColorStop(1, 'rgba(0,212,255,0.0)');
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, maxR, -0.45, 0.45); ctx.closePath();
      ctx.fillStyle = sweepGrad; ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(maxR, 0);
      ctx.strokeStyle = 'rgba(0,212,255,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();

      // Dots
      const filter = activeFilterRef.current;
      dotsRef.current.forEach((dot, idx) => {
        const isDeprioritized = deprioritizedIdsRef.current.has(dot.id);
        const inFilter = filter === 'all' || dot.category === filter;

        let alpha;
        if (isDeprioritized) {
          alpha = 0.15;
        } else if (!inFilter) {
          alpha = 0.07;
        } else {
          if (dot.category === 'som') alpha = 1.0;
          else if (dot.category === 'sam') alpha = 0.7;
          else alpha = 0.35;
        }

        let dotAngle = dot.dotAngle % (Math.PI * 2);
        if (dotAngle < 0) dotAngle += Math.PI * 2;
        let angleDiff = Math.abs(dotAngle - sweepAngleRef.current);
        if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
        const sweepHit = angleDiff < 0.18 && inFilter && !isDeprioritized;

        let size = dot.dotSize;
        let fillColor = dot.color;
        let glowSize = 0;
        let glowColor = dot.color;

        if (dot.hasSignal && dot.category === 'som' && !sweepHit && !isDeprioritized) {
          const pulse = 0.82 + Math.sin(timestamp * 0.002 + idx * 1.3) * 0.18;
          size = dot.dotSize * pulse;
          glowSize = 8;
        }
        if (sweepHit && dot.hasSignal) {
          size = dot.dotSize * 2.2;
          fillColor = '#FFFFFF';
          glowSize = 22;
          glowColor = '#00D4FF';
          alpha = 1;
        }

        ctx.globalAlpha = alpha;
        ctx.shadowBlur = glowSize;
        ctx.shadowColor = glowColor;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, size, 0, Math.PI * 2);
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      });

      // Center beacon
      ctx.shadowBlur = 14; ctx.shadowColor = '#00D4FF';
      ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#00D4FF'; ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,212,255,0.45)'; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(cx - 14, cy); ctx.lineTo(cx + 14, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy + 14); ctx.stroke();
      const pulse = 0.7 + Math.sin(timestamp * 0.0015) * 0.3;
      ctx.fillStyle = `rgba(0,212,255,${pulse})`;
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('BARRY ACTIVE', cx, cy - 18);
      ctx.fillStyle = `rgba(0,212,255,${pulse * 0.6})`;
      ctx.font = '8px "Courier New", monospace';
      ctx.fillText('Scanning for opportunities', cx, cy + 26);

      animFrameRef.current = requestAnimationFrame(draw);
    }

    animFrameRef.current = requestAnimationFrame(draw);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      resizeObs.disconnect();
      lastTimeRef.current = 0;
    };
  }, [loading, companies]);

  // ── Mouse Handlers ────────────────────────────────────────────────────────
  function handleCanvasMouseMove(e) {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = dotsRef.current.find((dot) => {
      const dx = dot.x - x; const dy = dot.y - y;
      return Math.sqrt(dx * dx + dy * dy) <= Math.max(dot.dotSize + 7, 10);
    });
    if (hit) {
      setHoveredCompany(hit);
      setTooltipPos({ x: e.clientX, y: e.clientY });
      canvasRef.current.style.cursor = 'pointer';
    } else {
      setHoveredCompany(null);
      if (canvasRef.current) canvasRef.current.style.cursor = 'default';
    }
  }

  function handleCanvasClick(e) {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = dotsRef.current.find((dot) => {
      const dx = dot.x - x; const dy = dot.y - y;
      return Math.sqrt(dx * dx + dy * dy) <= Math.max(dot.dotSize + 7, 10);
    });
    if (hit) openDossier(hit);
    else setSelectedTarget(null);
  }

  // ── ICP Breakdown ─────────────────────────────────────────────────────────
  function buildBreakdownRows(company, profile) {
    if (!profile) return null;
    const breakdown = getScoreBreakdown(company, profile);
    const rows = [
      { label: 'Industry match', matched: breakdown.industry.match === 100, partial: breakdown.industry.match === 50 },
      { label: 'Revenue range match', matched: breakdown.revenue.match === 100, partial: breakdown.revenue.match === 50 },
      { label: 'Company size match', matched: breakdown.employeeSize.match === 100, partial: breakdown.employeeSize.match === 50 },
      { label: profile.isNationwide ? 'Nationwide territory' : 'Location match', matched: breakdown.location.match === 100, partial: breakdown.location.match === 50 },
    ];
    const matched = rows.filter((r) => r.matched).length;
    const partial = rows.filter((r) => r.partial).length;
    const total = rows.length;
    let summary;
    if (matched === total) summary = `Perfect fit — all ${total} ICP criteria matched`;
    else if (matched >= 3) summary = `Strong fit — ${matched} of ${total} ICP criteria matched`;
    else if (matched >= 2 || partial > 0) summary = `Partial fit — ${matched} of ${total} criteria matched${partial > 0 ? `, ${partial} partial` : ''}`;
    else summary = `Weak fit — only ${matched} of ${total} ICP criteria matched`;
    return { rows, summary };
  }

  // ── Dossier Action Buttons ────────────────────────────────────────────────
  function renderDossierActions(company) {
    const isConfirming = deprioritizeConfirm === company.id;
    return (
      <div className="mc-dossier-footer">
        <div className="mc-dossier-footer-label">ACTION CONSOLE</div>
        <div className="mc-dossier-actions">
          {/* INITIATE CONTACT */}
          <button
            className="mc-dossier-action-btn initiate"
            onClick={() => setOutreachTarget(company)}
          >
            <span className="mc-dossier-action-icon">◈</span>
            INITIATE CONTACT
          </button>

          {/* ASSIGN TO MISSION */}
          <button
            className="mc-dossier-action-btn assign"
            onClick={() => setMissionTarget(company)}
          >
            <span className="mc-dossier-action-icon">◎</span>
            ASSIGN TO MISSION
          </button>

          {/* DEPRIORITIZE — inline confirm */}
          {isConfirming ? (
            <div className="mc-dossier-depr-confirm">
              <button
                className="mc-dossier-action-btn confirm-depr"
                onClick={() => handleDeprioritizeConfirm(company)}
              >
                CONFIRM DEPRIORITIZE
              </button>
              <button
                className="mc-dossier-action-btn cancel-depr"
                onClick={handleDeprioritizeCancel}
              >
                CANCEL
              </button>
            </div>
          ) : (
            <button
              className="mc-dossier-action-btn deprioritize"
              onClick={() => handleDeprioritizeClick(company.id)}
            >
              <span className="mc-dossier-action-icon">◇</span>
              DEPRIORITIZE
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Dossier Panel ─────────────────────────────────────────────────────────
  function renderDossier() {
    if (!selectedTarget) return null;
    const t = selectedTarget;
    const score = t.fit_score || 0;
    const scoreColor = getScoreColor(score);
    const classification = getClassification(score);
    const statusLabel = getStatusLabel(t.status);
    const statusClass = getStatusClass(t.status);
    const briefing = barryBriefings[t.id];
    const breakdown = icpProfile ? buildBreakdownRows(t, icpProfile) : null;
    const signals = t.signals || [];
    const hasActiveSignals =
      signals.length > 0 ||
      t.status === 'accepted' ||
      (t.fit_score && t.fit_score >= ICP_SCORE_THRESHOLD);

    const radius = 32;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (score / 100) * circumference;

    return (
      <div className="mc-dossier" ref={dossierRef}>
        <div className="mc-dossier-head">
          <span className="mc-dossier-eyebrow">TARGET DOSSIER</span>
          <button className="mc-dossier-close" onClick={() => setSelectedTarget(null)} title="Close (ESC)">✕</button>
        </div>

        <div className="mc-dossier-body">
          {/* Company header */}
          <div className="mc-dossier-company-header">
            <span className={`mc-dossier-status-badge ${statusClass}`}>{statusLabel}</span>
            <div className="mc-dossier-name">{(t.name || 'UNKNOWN').toUpperCase()}</div>
            {(t.industry || t.revenue) && (
              <div className="mc-dossier-subtitle">{[t.industry, t.revenue].filter(Boolean).join(' · ')}</div>
            )}
          </div>

          {/* Score gauge */}
          <div className="mc-dossier-gauge-row">
            <div className="mc-dossier-gauge">
              <svg width="84" height="84" viewBox="0 0 84 84">
                <circle cx="42" cy="42" r={radius} fill="none" stroke="rgba(0,212,255,0.12)" strokeWidth="5" />
                <circle cx="42" cy="42" r={radius} fill="none" stroke={scoreColor} strokeWidth="5"
                  strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
                  transform="rotate(-90 42 42)" style={{ filter: `drop-shadow(0 0 6px ${scoreColor})` }} />
                <text x="42" y="38" textAnchor="middle" fill={scoreColor} fontSize="17" fontWeight="700" fontFamily="Courier New, monospace">{score}</text>
                <text x="42" y="52" textAnchor="middle" fill="rgba(200,216,232,0.45)" fontSize="8" fontFamily="Courier New, monospace">ICP FIT</text>
              </svg>
            </div>
            <div className="mc-dossier-classification">
              <div className="mc-dossier-class-label">CLASSIFICATION</div>
              <div className="mc-dossier-class-value" style={{ color: scoreColor }}>{classification}</div>
              <div className="mc-dossier-class-sub">
                {score >= 70 ? 'Strong match across ICP criteria' : score >= 40 ? 'Partial match — worth monitoring' : 'Low match — nurture only'}
              </div>
            </div>
          </div>

          {/* FIRMOGRAPHIC INTEL */}
          <div className="mc-dossier-section">
            <button className="mc-dossier-section-header" onClick={() => toggleSection('firmographic')}>
              <span className="mc-dossier-section-toggle">{collapsedSections.firmographic ? '▶' : '▼'}</span>
              FIRMOGRAPHIC INTEL
            </button>
            {!collapsedSections.firmographic && (
              <div className="mc-dossier-section-body">
                {t.industry && <div className="mc-dossier-row"><span className="mc-dossier-key">INDUSTRY</span><span className="mc-dossier-val">{t.industry}</span></div>}
                {t.revenue && <div className="mc-dossier-row"><span className="mc-dossier-key">REVENUE</span><span className="mc-dossier-val">{t.revenue}</span></div>}
                {(t.employee_count || t.company_size) && <div className="mc-dossier-row"><span className="mc-dossier-key">SIZE</span><span className="mc-dossier-val">{t.employee_count || t.company_size}</span></div>}
                {t.founded_year && <div className="mc-dossier-row"><span className="mc-dossier-key">FOUNDED</span><span className="mc-dossier-val">{t.founded_year}</span></div>}
                {(t.state || t.location) && <div className="mc-dossier-row"><span className="mc-dossier-key">LOCATION</span><span className="mc-dossier-val">{t.state || t.location}</span></div>}
                {t.website && (
                  <div className="mc-dossier-row">
                    <span className="mc-dossier-key">WEBSITE</span>
                    <a href={t.website.startsWith('http') ? t.website : `https://${t.website}`} target="_blank" rel="noopener noreferrer" className="mc-dossier-link">
                      {t.website.replace(/^https?:\/\//, '')} ↗
                    </a>
                  </div>
                )}
                {!t.industry && !t.revenue && !t.employee_count && !t.company_size && !t.state && !t.location && (
                  <div className="mc-dossier-empty">No firmographic data on file</div>
                )}
              </div>
            )}
          </div>

          {/* FIT SCORE BREAKDOWN */}
          <div className="mc-dossier-section">
            <button className="mc-dossier-section-header" onClick={() => toggleSection('breakdown')}>
              <span className="mc-dossier-section-toggle">{collapsedSections.breakdown ? '▶' : '▼'}</span>
              FIT SCORE BREAKDOWN
            </button>
            {!collapsedSections.breakdown && (
              <div className="mc-dossier-section-body">
                {breakdown ? (
                  <>
                    {breakdown.rows.map((row, i) => (
                      <div key={i} className="mc-dossier-breakdown-row">
                        <span className={`mc-dossier-criterion-icon ${row.matched ? 'matched' : row.partial ? 'partial' : 'missed'}`}>
                          {row.matched ? '✓' : row.partial ? '~' : '✗'}
                        </span>
                        <span className="mc-dossier-criterion-label">{row.label}</span>
                      </div>
                    ))}
                    <div className="mc-dossier-breakdown-summary">{breakdown.summary}</div>
                  </>
                ) : (
                  <div className="mc-dossier-empty">ICP profile not configured</div>
                )}
              </div>
            )}
          </div>

          {/* BUYING SIGNALS */}
          <div className="mc-dossier-section">
            <button className="mc-dossier-section-header" onClick={() => toggleSection('signals')}>
              <span className="mc-dossier-section-toggle">{collapsedSections.signals ? '▶' : '▼'}</span>
              BUYING SIGNALS
              {hasActiveSignals && <span className="mc-dossier-signal-dot" />}
            </button>
            {!collapsedSections.signals && (
              <div className="mc-dossier-section-body">
                {signals.length > 0 ? (
                  signals.map((sig, i) => (
                    <div key={i} className="mc-dossier-signal-row">
                      <span className="mc-dossier-signal-pulse" />
                      <div className="mc-dossier-signal-content">
                        <div className="mc-dossier-signal-type">{sig.type || 'SIGNAL'}</div>
                        <div className="mc-dossier-signal-desc">{sig.description || sig.desc || ''}</div>
                        {sig.timestamp && <div className="mc-dossier-signal-time">{formatTimestamp(sig.timestamp)}</div>}
                      </div>
                    </div>
                  ))
                ) : t.status === 'accepted' ? (
                  <div className="mc-dossier-signal-row">
                    <span className="mc-dossier-signal-pulse" />
                    <div className="mc-dossier-signal-content">
                      <div className="mc-dossier-signal-type">QUALIFIED</div>
                      <div className="mc-dossier-signal-desc">Manually marked as interested target</div>
                    </div>
                  </div>
                ) : (
                  <div className="mc-dossier-empty">No active signals detected — Barry is monitoring</div>
                )}
              </div>
            )}
          </div>

          {/* BARRY'S ASSESSMENT */}
          <div className="mc-dossier-section">
            <button className="mc-dossier-section-header" onClick={() => toggleSection('barry')}>
              <span className="mc-dossier-section-toggle">{collapsedSections.barry ? '▶' : '▼'}</span>
              BARRY'S ASSESSMENT
            </button>
            {!collapsedSections.barry && (
              <div className="mc-dossier-section-body">
                {barryLoading && !briefing ? (
                  <div className="mc-dossier-barry-loading">
                    <div className="mc-dossier-spinner" />
                    <span>BARRY ANALYZING...</span>
                  </div>
                ) : briefing ? (
                  <p className="mc-dossier-barry-text">{briefing}</p>
                ) : (
                  <div className="mc-dossier-empty">Analysis unavailable</div>
                )}
              </div>
            )}
          </div>

          {/* ACTION CONSOLE — Phase 3 wired */}
          {renderDossierActions(t)}
        </div>
      </div>
    );
  }

  // ── Mission Target Card ───────────────────────────────────────────────────
  function renderMissionCard(company, rank) {
    const score = company.fit_score || 0;
    const scoreColor = getScoreColor(score);
    const hasActiveSignals =
      (company.signals && company.signals.length > 0) ||
      company.status === 'accepted' ||
      (company.fit_score && company.fit_score >= ICP_SCORE_THRESHOLD);
    const statusLabel = getStatusLabel(company.status);
    const statusClass = getStatusClass(company.status);
    const isConfirming = deprioritizeConfirm === company.id;

    return (
      <div key={company.id} className="mc-mission-card">
        <div className="mc-mission-card-rank">#{rank}</div>

        {/* Main row */}
        <div className="mc-mission-card-main">
          <div className="mc-mission-card-left">
            <div className="mc-mission-card-name">{company.name || 'Unknown'}</div>
            <div className="mc-mission-card-meta">
              {[company.industry, company.revenue].filter(Boolean).join(' · ') || 'No data'}
            </div>
          </div>

          <div className="mc-mission-card-center">
            <div className="mc-mission-card-score" style={{ color: scoreColor, borderColor: scoreColor }}>
              {score}
            </div>
            <div className={`mc-mission-card-signal ${hasActiveSignals ? 'active' : 'monitoring'}`}>
              <span className="mc-mission-card-signal-dot" />
              {hasActiveSignals ? 'ACTIVE SIGNALS' : 'MONITORING'}
            </div>
          </div>

          <div className="mc-mission-card-right">
            <button className="mc-mission-card-btn" onClick={() => openDossier(company)}>
              PULL DOSSIER →
            </button>
            <span className={`mc-mission-card-status ${statusClass}`}>{statusLabel}</span>
          </div>
        </div>

        {/* Action row */}
        <div className="mc-mission-card-actions">
          <button
            className="mc-card-action-btn initiate"
            onClick={() => setOutreachTarget(company)}
          >
            ◈ CONTACT
          </button>
          <button
            className="mc-card-action-btn assign"
            onClick={() => setMissionTarget(company)}
          >
            ◎ MISSION
          </button>
          {isConfirming ? (
            <>
              <button
                className="mc-card-action-btn confirm-depr"
                onClick={() => handleDeprioritizeConfirm(company)}
              >
                CONFIRM
              </button>
              <button
                className="mc-card-action-btn cancel-depr"
                onClick={handleDeprioritizeCancel}
              >
                CANCEL
              </button>
            </>
          ) : (
            <button
              className="mc-card-action-btn deprioritize"
              onClick={() => handleDeprioritizeClick(company.id)}
            >
              ◇ DEPRIORITIZE
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Loading State ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mc-loading">
        <div className="mc-loading-radar">
          <div className="mc-loading-ring r1" />
          <div className="mc-loading-ring r2" />
          <div className="mc-loading-ring r3" />
          <div className="mc-loading-sweep" />
          <div className="mc-loading-center">INITIALIZING</div>
        </div>
        <p className="mc-loading-text">MISSION CONTROL LOADING...</p>
        <p className="mc-loading-sub">Scanning your market universe</p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="mission-control">

      {/* ── SECTION 1: MISSION HEADER ─────────────────────────────────── */}
      <header className="mc-header">
        <div className="mc-header-left">
          <div className="mc-mission-eyebrow">CLASSIFIED MISSION BRIEFING</div>
          <h1 className="mc-mission-name">OPERATION MARKET DOMINANCE</h1>
          <div className="mc-header-meta">
            <span className="mc-status-badge"><span className="mc-status-dot" />ACTIVE</span>
            {territory && (
              <span className="mc-meta-chip">
                <span className="mc-meta-key">TERRITORY</span>
                <span className="mc-meta-val">{territory}</span>
              </span>
            )}
            <span className="mc-meta-chip">
              <span className="mc-meta-key">TIMEFRAME</span>
              <span className="mc-meta-val">{timeframe}</span>
            </span>
          </div>
        </div>
        <div className="mc-header-right">
          <div className={`mc-market-status ${marketStatusClass}`}>
            <div className="mc-market-status-label">MARKET STATUS</div>
            <div className="mc-market-status-value">{marketStatus}</div>
          </div>
          <div className="mc-header-counters">
            <div className="mc-header-counter">
              <span className="mc-header-counter-num">{sam.length.toLocaleString()}</span>
              <span className="mc-header-counter-label">ACTIVE TARGETS</span>
            </div>
            <div className="mc-header-counter priority">
              <span className="mc-header-counter-num">{som.length.toLocaleString()}</span>
              <span className="mc-header-counter-label">PRIORITY TARGETS</span>
            </div>
          </div>
        </div>
      </header>

      {/* ── SECTION 2: MARKET SCOPE STRIP ────────────────────────────── */}
      <div className="mc-scope-strip">
        <button className={`mc-scope-block${activeFilter === 'tam' ? ' active' : ''}`}
          onClick={() => setActiveFilter(activeFilter === 'tam' ? 'all' : 'tam')}>
          <div className="mc-scope-ring tam-ring" />
          <div className="mc-scope-label">TOTAL ADDRESSABLE MARKET</div>
          <div className="mc-scope-number">{tamCount.toLocaleString()}</div>
          <div className="mc-scope-sub">Your full reachable universe</div>
        </button>
        <div className="mc-scope-div" />
        <button className={`mc-scope-block${activeFilter === 'sam' ? ' active' : ''}`}
          onClick={() => setActiveFilter(activeFilter === 'sam' ? 'all' : 'sam')}>
          <div className="mc-scope-ring sam-ring" />
          <div className="mc-scope-label">SERVICEABLE MARKET</div>
          <div className="mc-scope-number">{samCount.toLocaleString()}</div>
          <div className="mc-scope-sub">Accounts you can sell to</div>
        </button>
        <div className="mc-scope-div" />
        <button className={`mc-scope-block${activeFilter === 'som' ? ' active' : ''}`}
          onClick={() => setActiveFilter(activeFilter === 'som' ? 'all' : 'som')}>
          <div className="mc-scope-ring som-ring" />
          <div className="mc-scope-label">OBTAINABLE NOW</div>
          <div className="mc-scope-number som-num">{somCount.toLocaleString()}</div>
          <div className="mc-scope-sub">Where you should focus today</div>
        </button>
      </div>

      {/* ── SECTION 3: TARGET RADAR ───────────────────────────────────── */}
      <div className="mc-radar-section">
        {activeFilter !== 'all' && (
          <div className="mc-filter-badge">
            <span>FILTERING: {activeFilter.toUpperCase()}</span>
            <button className="mc-filter-clear" onClick={() => setActiveFilter('all')}>✕ CLEAR</button>
          </div>
        )}
        <div className="mc-radar-legend">
          <span className="mc-legend-item"><span className="mc-legend-dot green" />STRONG FIT (70+)</span>
          <span className="mc-legend-item"><span className="mc-legend-dot yellow" />MODERATE FIT</span>
          <span className="mc-legend-item"><span className="mc-legend-dot grey" />LOW FIT</span>
          <span className="mc-legend-item"><span className="mc-legend-pulse" />ACTIVE SIGNAL</span>
        </div>
        <div ref={containerRef} className="mc-radar-wrap">
          <canvas ref={canvasRef} className="mc-radar-canvas"
            onMouseMove={handleCanvasMouseMove}
            onMouseLeave={() => setHoveredCompany(null)}
            onClick={handleCanvasClick}
          />
        </div>

        {/* Hover tooltip */}
        {hoveredCompany && (
          <div className="mc-tooltip" style={{ left: tooltipPos.x + 14, top: tooltipPos.y - 10 }}>
            <div className="mc-tooltip-name">{hoveredCompany.name || 'Unknown'}</div>
            {hoveredCompany.industry && <div className="mc-tooltip-row">{hoveredCompany.industry}</div>}
            <div className="mc-tooltip-score">ICP FIT: <span style={{ color: hoveredCompany.color }}>{hoveredCompany.fit_score ?? '—'}</span></div>
            <div className="mc-tooltip-cat">{hoveredCompany.category.toUpperCase()}</div>
          </div>
        )}

        {/* Full Target Dossier */}
        {renderDossier()}
      </div>

      {/* ── SECTION 4: MISSION-READY TARGET LIST ─────────────────────── */}
      {companies.length > 0 && (
        <div className="mc-mission-list">
          <div className="mc-mission-list-header">
            <div className="mc-mission-list-title">TODAY'S MISSION TARGETS</div>
            <div className="mc-mission-list-sub">Ranked by Barry — Fit × Signals × Recency</div>
          </div>
          <div className="mc-mission-tabs">
            <button className={`mc-mission-tab${activeMissionTab === 'ready' ? ' active' : ''}`} onClick={() => setActiveMissionTab('ready')}>
              <span className="mc-mission-tab-dot ready" />MISSION READY<span className="mc-mission-tab-count">{missionReady.length}</span>
            </button>
            <button className={`mc-mission-tab${activeMissionTab === 'warming' ? ' active' : ''}`} onClick={() => setActiveMissionTab('warming')}>
              <span className="mc-mission-tab-dot warming" />WARMING<span className="mc-mission-tab-count">{warming.length}</span>
            </button>
            <button className={`mc-mission-tab${activeMissionTab === 'long-range' ? ' active' : ''}`} onClick={() => setActiveMissionTab('long-range')}>
              <span className="mc-mission-tab-dot long-range" />LONG RANGE<span className="mc-mission-tab-count">{longRange.length}</span>
            </button>
          </div>
          <div className="mc-mission-cards">
            {activeBucket.length > 0 ? (
              activeBucket.map((company, i) => {
                const rankBase = activeMissionTab === 'ready' ? 0 : activeMissionTab === 'warming' ? 10 : 35;
                return renderMissionCard(company, rankBase + i + 1);
              })
            ) : (
              <div className="mc-mission-empty">No targets in this bucket yet</div>
            )}
          </div>
        </div>
      )}

      {/* ── SECTION 5: INTELLIGENCE TICKER ───────────────────────────── */}
      <div className="mc-ticker">
        <div className="mc-ticker-label">◈ INTEL FEED</div>
        <div className="mc-ticker-track">
          <div className="mc-ticker-content">
            {[...tickerItems, ...tickerItems].map((item, i) => (
              <span key={i} className="mc-ticker-item">
                {item}<span className="mc-ticker-sep">◆</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── PHASE 3: MODALS ──────────────────────────────────────────── */}
      {outreachTarget && (
        <OutreachConsole
          company={outreachTarget}
          icpProfile={icpProfile}
          onClose={() => setOutreachTarget(null)}
        />
      )}

      {missionTarget && (
        <MissionAssignModal
          company={missionTarget}
          onClose={() => setMissionTarget(null)}
          onSuccess={handleMissionAssignSuccess}
        />
      )}

      {/* ── PHASE 3: TOAST SYSTEM ────────────────────────────────────── */}
      <div className="mc-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`mc-toast mc-toast--${t.type}`}>
            <span className="mc-toast-dot" />
            <span className="mc-toast-message">{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
