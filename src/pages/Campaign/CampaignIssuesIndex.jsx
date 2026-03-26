import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import CampaignNav from './CampaignNav';
import CampaignFooter from './CampaignFooter';
import { ISSUES } from './issueData';
import './campaign.css';

// Icon map — simple SVG glyphs for each issue card
const ICONS = {
  housing: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e86042" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  environment: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e86042" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  education: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e86042" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </svg>
  ),
  'mental-health': (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e86042" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  representation: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e86042" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  'small-business': (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e86042" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <line x1="9" y1="22" x2="9" y2="12" />
      <line x1="15" y1="22" x2="15" y2="12" />
      <rect x="9" y="12" width="6" height="10" />
    </svg>
  ),
  rights: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e86042" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M6 20v-2a6 6 0 0 1 12 0v2" />
    </svg>
  ),
};

export default function CampaignIssuesIndex() {
  useEffect(() => {
    document.title = 'Issues | Aaron Wiley for House District 21';
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    meta.content =
      'Aaron Wiley is running for Utah House District 21 on issues that matter to the West Side — housing, clean air, education, healthcare, fair representation, small business, and rights.';
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="cw">
      <CampaignNav />

      {/* ── HERO ────────────────────────────────────────────────────── */}
      <section className="c-hero">
        <div className="c-hero-badge">Aaron Wiley · District 21</div>
        <h1>
          Fighting for the <span className="cw-accent">Future</span> of District 21
        </h1>
        <p className="c-hero-sub">
          I'm running for the Utah Legislature because the West Side deserves more than
          promises — we deserve results.
        </p>
      </section>

      {/* ── INTRO TEXT ──────────────────────────────────────────────── */}
      <section className="c-issues-intro" style={{ paddingTop: '56px', paddingBottom: '0' }}>
        <div className="c-issues-intro-inner">
          <p style={{ fontFamily: "'Barlow', sans-serif", fontSize: '18px', lineHeight: '1.65', color: 'rgba(255,255,255,0.8)', marginBottom: 0 }}>
            For too long, our neighborhoods have been treated like an afterthought while
            decisions were made without us at the table. My commitment is simple: listen
            to our community, fight for what matters, and deliver real solutions. These
            are the priorities I'll take with me to the Capitol.
          </p>
        </div>
      </section>

      {/* ── ISSUE CARDS GRID ────────────────────────────────────────── */}
      <section className="c-issues-grid-section">
        <div className="c-issues-grid">
          {ISSUES.map((issue) => (
            <Link
              key={issue.slug}
              to={`/issues/${issue.slug}`}
              className="c-issue-card"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {ICONS[issue.slug]}
                <span className="c-issue-card-tag">Issue</span>
              </div>
              <h3>{issue.navLabel}</h3>
              <p>{issue.cardTeaser}</p>
              <span className="c-issue-card-cta">Read Aaron's position →</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── CTA ROW ─────────────────────────────────────────────────── */}
      <div className="c-cta-row">
        <div className="c-inner">
          <h3>Ready to make a difference?</h3>
          <p>Join the fight for District 21. Every hour counts.</p>
          <div className="c-cta-buttons">
            <Link to="/volunteer" className="btn-coral">
              Volunteer — Join the Fight
            </Link>
          </div>
          <p className="c-cta-donate">
            Financial support matters too —{' '}
            <a
              href="https://secure.actblue.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              Donate via ActBlue →
            </a>
          </p>
        </div>
      </div>

      <CampaignFooter />
    </div>
  );
}
