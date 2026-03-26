import { Link } from 'react-router-dom';
import './campaign.css';

export default function CampaignFooter() {
  return (
    <footer className="c-footer">
      <div className="c-footer-inner">
        {/* Brand column */}
        <div>
          <div className="c-footer-brand">
            Aaron Wiley <span>· HD-21</span>
          </div>
          <p className="c-footer-tagline">
            Fighting for the West Side and all of House District 21.
            <br />
            Utah State Legislature — 2026.
          </p>
        </div>

        {/* Issues column */}
        <div className="c-footer-col">
          <h4>Issues</h4>
          <ul>
            <li><Link to="/issues/housing">Housing & Cost of Living</Link></li>
            <li><Link to="/issues/environment">Clean Air & Environment</Link></li>
            <li><Link to="/issues/education">Education & Opportunity</Link></li>
            <li><Link to="/issues/mental-health">Mental Health & Healthcare</Link></li>
            <li><Link to="/issues/representation">Fair Representation</Link></li>
            <li><Link to="/issues/small-business">Small Business & Economy</Link></li>
            <li><Link to="/issues/rights">Rights & Freedoms</Link></li>
          </ul>
        </div>

        {/* Get involved column */}
        <div className="c-footer-col">
          <h4>Get Involved</h4>
          <ul>
            <li><Link to="/volunteer">Volunteer</Link></li>
            <li>
              <a
                href="https://secure.actblue.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                Donate via ActBlue
              </a>
            </li>
            <li><Link to="/campaign/about">About Aaron</Link></li>
            <li><Link to="/campaign">Home</Link></li>
          </ul>
        </div>
      </div>

      <div className="c-footer-bottom">
        <span className="c-footer-legal">
          © 2026 Aaron Wiley for House District 21. Paid for by Aaron Wiley for HD-21.
        </span>
        <span className="c-footer-legal">
          Authorized and paid for by the Aaron Wiley Campaign Committee.
        </span>
      </div>
    </footer>
  );
}
