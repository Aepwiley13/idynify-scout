import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './campaign.css';

const NAV_LINKS = [
  { label: 'Home', href: '/campaign' },
  { label: 'Issues', href: '/issues' },
  { label: 'About', href: '/campaign/about' },
  { label: 'Volunteer', href: '/volunteer' },
];

export default function CampaignNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  return (
    <nav className="c-nav">
      <div className="c-nav-inner">
        {/* Brand */}
        <Link to="/campaign" className="c-nav-brand">
          Aaron Wiley <span>· HD-21</span>
        </Link>

        {/* Desktop links */}
        <ul className="c-nav-links">
          {NAV_LINKS.map((l) => (
            <li key={l.href}>
              <Link
                to={l.href}
                style={
                  pathname === l.href || (l.href !== '/campaign' && pathname.startsWith(l.href))
                    ? { color: '#e86042' }
                    : {}
                }
              >
                {l.label}
              </Link>
            </li>
          ))}
          <li>
            <a
              href="#donate"
              className="c-nav-donate"
              onClick={(e) => {
                e.preventDefault();
                window.open('https://secure.actblue.com', '_blank', 'noopener');
              }}
            >
              Donate
            </a>
          </li>
        </ul>

        {/* Mobile hamburger */}
        <button
          className="c-nav-hamburger"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Toggle navigation"
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      {/* Mobile dropdown */}
      <div className={`c-nav-mobile ${menuOpen ? 'open' : ''}`}>
        {NAV_LINKS.map((l) => (
          <Link key={l.href} to={l.href} onClick={() => setMenuOpen(false)}>
            {l.label}
          </Link>
        ))}
        <a
          href="#donate"
          style={{ color: '#e86042', fontWeight: 700 }}
          onClick={(e) => {
            e.preventDefault();
            setMenuOpen(false);
            window.open('https://secure.actblue.com', '_blank', 'noopener');
          }}
        >
          Donate →
        </a>
      </div>
    </nav>
  );
}
