import { useEffect, useState, useRef } from 'react';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import './MissionControl.css';

const ICP_SCORE_THRESHOLD = 70;

// Seeded pseudo-random so dot positions are consistent each load
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
  } else if (company.status !== 'rejected') {
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

// Count-up hook for animated numbers
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

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const animFrameRef = useRef(null);
  const dotsRef = useRef([]);
  const sweepAngleRef = useRef(0);
  const activeFilterRef = useRef('all');
  const lastTimeRef = useRef(0);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    activeFilterRef.current = activeFilter;
  }, [activeFilter]);

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

      const allCompanies = companiesSnapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      setCompanies(allCompanies);
      setLoading(false);
      setTimeout(() => setStatsReady(true), 200);
    } catch (error) {
      console.error('Failed to load mission control data:', error);
      setLoading(false);
    }
  }

  // ── Derived Data ──────────────────────────────────────────────────────────
  const tam = companies;
  const sam = companies.filter((c) => c.status !== 'rejected');
  const som = companies.filter(
    (c) =>
      c.status === 'accepted' ||
      (c.fit_score && c.fit_score >= ICP_SCORE_THRESHOLD)
  );

  const signalPct = tam.length > 0 ? (som.length / tam.length) * 100 : 0;
  const marketStatus =
    signalPct > 20 ? '🔥 HOT' : signalPct > 10 ? '⚡ WARM' : '❄️ COLD';
  const marketStatusClass =
    signalPct > 20 ? 'hot' : signalPct > 10 ? 'warm' : 'cold';

  const now = new Date();
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  const timeframe = `Q${quarter} ${now.getFullYear()}`;

  const territory = icpProfile
    ? [
        icpProfile.industries?.slice(0, 2).join(', '),
        icpProfile.isNationwide
          ? 'Nationwide'
          : icpProfile.locations?.slice(0, 3).join(', '),
      ]
        .filter(Boolean)
        .join(' · ')
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
    `● ICP high-priority rate: ${
      tam.length > 0 ? Math.round((som.length / tam.length) * 100) : 0
    }% of market`,
  ];

  // Count-up animations
  const tamCount = useCountUp(tam.length, 1400, statsReady);
  const samCount = useCountUp(sam.length, 1400, statsReady);
  const somCount = useCountUp(som.length, 1400, statsReady);

  // ── Radar Dot Generation ──────────────────────────────────────────────────
  function generateDots(companiesArr, canvasW, canvasH) {
    const cx = canvasW / 2;
    const cy = canvasH / 2;
    const maxR = Math.min(cx, cy) * 0.88;

    return companiesArr.map((company, i) => {
      const category = getCategory(company);

      let minR, maxRing;
      if (category === 'som') {
        minR = maxR * 0.04;
        maxRing = maxR * 0.30;
      } else if (category === 'sam') {
        minR = maxR * 0.34;
        maxRing = maxR * 0.60;
      } else {
        minR = maxR * 0.64;
        maxRing = maxR * 0.90;
      }

      const angle = seededRandom(i * 2.3 + 1) * Math.PI * 2;
      const r = minR + seededRandom(i * 3.7 + 2) * (maxRing - minR);
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      const dotSize = 2.5 + seededRandom(i * 1.7 + 3) * 3.0;
      const color = getDotColor(company);
      const hasSignal =
        company.status === 'accepted' ||
        (company.fit_score && company.fit_score >= ICP_SCORE_THRESHOLD);

      return {
        ...company,
        x,
        y,
        dotAngle: angle,
        dotR: r,
        category,
        color,
        dotSize,
        hasSignal,
      };
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

      const dt = lastTimeRef.current
        ? Math.min((timestamp - lastTimeRef.current) / 1000, 0.05)
        : 0;
      lastTimeRef.current = timestamp;
      sweepAngleRef.current =
        (sweepAngleRef.current + SWEEP_SPEED * dt) % (Math.PI * 2);

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const maxR = Math.min(cx, cy) * 0.88;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // ── Background grid ──
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.04)';
      ctx.lineWidth = 0.5;
      const gridSize = 50;
      for (let gx = 0; gx < canvas.width; gx += gridSize) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, canvas.height);
        ctx.stroke();
      }
      for (let gy = 0; gy < canvas.height; gy += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(canvas.width, gy);
        ctx.stroke();
      }

      // ── Crosshair guide lines ──
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.06)';
      ctx.lineWidth = 0.5;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR);
        ctx.stroke();
      }

      // ── Rings ──
      const rings = [
        { r: maxR * 0.90, label: 'TAM', rgb: '0,212,255', opacity: 0.22 },
        { r: maxR * 0.60, label: 'SAM', rgb: '0,212,255', opacity: 0.38 },
        { r: maxR * 0.30, label: 'SOM', rgb: '0,255,136', opacity: 0.60 },
      ];

      rings.forEach((ring) => {
        // Main ring arc
        ctx.beginPath();
        ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${ring.rgb},${ring.opacity})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Tick marks on ring
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
          const inner = ring.r - 4;
          const outer = ring.r + 4;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
          ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
          ctx.strokeStyle = `rgba(${ring.rgb},${ring.opacity * 1.6})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }

        // Ring label
        ctx.fillStyle = `rgba(${ring.rgb},0.45)`;
        ctx.font = '9px "Courier New", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(ring.label, cx + ring.r + 8, cy + 4);
      });

      // ── Radar sweep ──
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(sweepAngleRef.current);

      const sweepGrad = ctx.createLinearGradient(0, 0, maxR, 0);
      sweepGrad.addColorStop(0, 'rgba(0,212,255,0.0)');
      sweepGrad.addColorStop(0.4, 'rgba(0,212,255,0.04)');
      sweepGrad.addColorStop(1, 'rgba(0,212,255,0.0)');
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, maxR, -0.45, 0.45);
      ctx.closePath();
      ctx.fillStyle = sweepGrad;
      ctx.fill();

      // Sweep line
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(maxR, 0);
      ctx.strokeStyle = 'rgba(0,212,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.restore();

      // ── Dots ──
      const filter = activeFilterRef.current;

      dotsRef.current.forEach((dot, idx) => {
        const inFilter = filter === 'all' || dot.category === filter;

        let alpha;
        if (!inFilter) {
          alpha = 0.07;
        } else {
          if (dot.category === 'som') alpha = 1.0;
          else if (dot.category === 'sam') alpha = 0.7;
          else alpha = 0.35;
        }

        // Sweep proximity flare
        let dotAngle = dot.dotAngle % (Math.PI * 2);
        if (dotAngle < 0) dotAngle += Math.PI * 2;
        let angleDiff = Math.abs(dotAngle - sweepAngleRef.current);
        if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
        const sweepHit = angleDiff < 0.18 && inFilter;

        let size = dot.dotSize;
        let fillColor = dot.color;
        let glowSize = 0;
        let glowColor = dot.color;

        // Pulse for SOM dots
        if (dot.hasSignal && dot.category === 'som' && !sweepHit) {
          const pulse = 0.82 + Math.sin(timestamp * 0.002 + idx * 1.3) * 0.18;
          size = dot.dotSize * pulse;
          glowSize = 8;
        }

        // Flare when sweep hits a high-intent dot
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

      // ── Center beacon ──
      ctx.shadowBlur = 14;
      ctx.shadowColor = '#00D4FF';
      ctx.beginPath();
      ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#00D4FF';
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = 'rgba(0,212,255,0.45)';
      ctx.lineWidth = 0.6;
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
      const dx = dot.x - x;
      const dy = dot.y - y;
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
      const dx = dot.x - x;
      const dy = dot.y - y;
      return Math.sqrt(dx * dx + dy * dy) <= Math.max(dot.dotSize + 7, 10);
    });

    setSelectedTarget(hit || null);
  }

  // ── Loading State ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mc-loading">
        <div className="mc-loading-radar">
          <div className="mc-loading-ring r1"></div>
          <div className="mc-loading-ring r2"></div>
          <div className="mc-loading-ring r3"></div>
          <div className="mc-loading-sweep"></div>
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
            <span className="mc-status-badge">
              <span className="mc-status-dot" />
              ACTIVE
            </span>
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
        <button
          className={`mc-scope-block${activeFilter === 'tam' ? ' active' : ''}`}
          onClick={() => setActiveFilter(activeFilter === 'tam' ? 'all' : 'tam')}
        >
          <div className="mc-scope-ring tam-ring" />
          <div className="mc-scope-label">TOTAL ADDRESSABLE MARKET</div>
          <div className="mc-scope-number">{tamCount.toLocaleString()}</div>
          <div className="mc-scope-sub">Your full reachable universe</div>
        </button>

        <div className="mc-scope-div" />

        <button
          className={`mc-scope-block${activeFilter === 'sam' ? ' active' : ''}`}
          onClick={() => setActiveFilter(activeFilter === 'sam' ? 'all' : 'sam')}
        >
          <div className="mc-scope-ring sam-ring" />
          <div className="mc-scope-label">SERVICEABLE MARKET</div>
          <div className="mc-scope-number">{samCount.toLocaleString()}</div>
          <div className="mc-scope-sub">Accounts you can sell to</div>
        </button>

        <div className="mc-scope-div" />

        <button
          className={`mc-scope-block${activeFilter === 'som' ? ' active' : ''}`}
          onClick={() => setActiveFilter(activeFilter === 'som' ? 'all' : 'som')}
        >
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
            <button
              className="mc-filter-clear"
              onClick={() => setActiveFilter('all')}
            >
              ✕ CLEAR
            </button>
          </div>
        )}

        <div className="mc-radar-legend">
          <span className="mc-legend-item"><span className="mc-legend-dot green" />STRONG FIT (70+)</span>
          <span className="mc-legend-item"><span className="mc-legend-dot yellow" />MODERATE FIT</span>
          <span className="mc-legend-item"><span className="mc-legend-dot grey" />LOW FIT</span>
          <span className="mc-legend-item"><span className="mc-legend-pulse" />ACTIVE SIGNAL</span>
        </div>

        <div ref={containerRef} className="mc-radar-wrap">
          <canvas
            ref={canvasRef}
            className="mc-radar-canvas"
            onMouseMove={handleCanvasMouseMove}
            onMouseLeave={() => setHoveredCompany(null)}
            onClick={handleCanvasClick}
          />
        </div>

        {/* Hover tooltip */}
        {hoveredCompany && (
          <div
            className="mc-tooltip"
            style={{ left: tooltipPos.x + 14, top: tooltipPos.y - 10 }}
          >
            <div className="mc-tooltip-name">
              {hoveredCompany.name || 'Unknown'}
            </div>
            {hoveredCompany.industry && (
              <div className="mc-tooltip-row">{hoveredCompany.industry}</div>
            )}
            <div className="mc-tooltip-score">
              ICP FIT:{' '}
              <span style={{ color: hoveredCompany.color }}>
                {hoveredCompany.fit_score != null
                  ? hoveredCompany.fit_score
                  : '—'}
              </span>
            </div>
            <div className="mc-tooltip-cat">
              {hoveredCompany.category.toUpperCase()}
            </div>
          </div>
        )}

        {/* Target Dossier (Phase 2 placeholder) */}
        {selectedTarget && (
          <div className="mc-dossier">
            <div className="mc-dossier-head">
              <span className="mc-dossier-eyebrow">TARGET DOSSIER</span>
              <button
                className="mc-dossier-close"
                onClick={() => setSelectedTarget(null)}
              >
                ✕
              </button>
            </div>
            <div className="mc-dossier-body">
              <div className="mc-dossier-name">{selectedTarget.name}</div>
              <div className="mc-dossier-loading">
                <div className="mc-dossier-spinner" />
                Target Intel Loading...
              </div>
              <div className="mc-dossier-meta">
                {selectedTarget.industry && (
                  <div className="mc-dossier-row">
                    <span className="mc-dossier-key">INDUSTRY</span>
                    <span>{selectedTarget.industry}</span>
                  </div>
                )}
                {selectedTarget.revenue && (
                  <div className="mc-dossier-row">
                    <span className="mc-dossier-key">REVENUE</span>
                    <span>{selectedTarget.revenue}</span>
                  </div>
                )}
                {selectedTarget.fit_score != null && (
                  <div className="mc-dossier-row">
                    <span className="mc-dossier-key">ICP SCORE</span>
                    <span style={{ color: selectedTarget.color }}>
                      {selectedTarget.fit_score}
                    </span>
                  </div>
                )}
                {selectedTarget.status && (
                  <div className="mc-dossier-row">
                    <span className="mc-dossier-key">STATUS</span>
                    <span>{selectedTarget.status}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── SECTION 4: INTELLIGENCE TICKER ───────────────────────────── */}
      <div className="mc-ticker">
        <div className="mc-ticker-label">◈ INTEL FEED</div>
        <div className="mc-ticker-track">
          <div className="mc-ticker-content">
            {[...tickerItems, ...tickerItems].map((item, i) => (
              <span key={i} className="mc-ticker-item">
                {item}
                <span className="mc-ticker-sep">◆</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
