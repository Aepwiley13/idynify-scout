import { useEffect } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import CampaignNav from './CampaignNav';
import CampaignFooter from './CampaignFooter';
import { getIssueBySlug } from './issueData';
import './campaign.css';

export default function CampaignIssuePage() {
  const { slug } = useParams();
  const issue = getIssueBySlug(slug);

  // Scroll to top and set meta on route change — always called (hooks rules)
  useEffect(() => {
    window.scrollTo(0, 0);
    if (!issue) return;
    document.title = issue.pageTitle;
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    meta.content = issue.metaDescription;
  }, [slug, issue]);

  // 404 redirect to index if slug not found
  if (!issue) return <Navigate to="/issues" replace />;

  return (
    <div className="cw">
      <CampaignNav />

      {/* ── HERO ────────────────────────────────────────────────────── */}
      <section className="c-hero">
        <div className="c-hero-badge">Aaron Wiley · District 21</div>
        <h1>
          {issue.heroPrefix}
          <span className="cw-accent">{issue.heroAccent}</span>
          {issue.heroSuffix}
        </h1>
        <p className="c-hero-sub">{issue.framing}</p>
      </section>

      {/* ── WHY IT MATTERS ──────────────────────────────────────────── */}
      <section className="c-section c-section-dark1">
        <div className="c-inner">
          <p className="c-section-label">Why it matters to District 21</p>
          <p className="c-body-text">{issue.whyItMatters}</p>

          <div className="c-pull-quote">
            <p>{issue.pullQuote}</p>
          </div>
        </div>
      </section>

      {/* ── AARON'S POSITION ────────────────────────────────────────── */}
      <section className="c-section c-section-dark2">
        <div className="c-inner">
          <p className="c-section-label">Aaron's Position</p>
          <h2>Where I Stand</h2>
          <p className="c-commitments-intro">
            Here's where I stand and what I'll fight for at the Capitol.
          </p>
          <ul className="c-commitments">
            {issue.commitments.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── COMMUNITY CONNECTION ────────────────────────────────────── */}
      <section className="c-section c-section-dark1">
        <div className="c-inner">
          <p className="c-section-label">What This Means for Our Community</p>
          <p className="c-body-text">{issue.community}</p>

          {issue.stat && (
            <div className="c-stat-wrap">
              <div className="c-stat-card">
                <span className="c-stat-number">{issue.stat.value}</span>
                <span className="c-stat-label">{issue.stat.label}</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── CTA ROW ─────────────────────────────────────────────────── */}
      <div className="c-cta-row">
        <div className="c-inner">
          <h3>Ready to Make a Difference?</h3>
          <p>District 21 needs real representation. Join the fight.</p>
          <div className="c-cta-buttons">
            <Link to="/volunteer" className="btn-coral">
              Volunteer — Join the Fight
            </Link>
            <Link to="/issues" className="btn-outline">
              Back to All Issues
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
