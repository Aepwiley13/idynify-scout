/**
 * UpgradeRequired — what a verified Free account sees on a paid page.
 *
 * Rendered by the shell's account gate (App.jsx ShellRoute) in place of the
 * page, inside the app, so a free customer who opens Scout from the sidebar
 * stays in the product with a way back to their Contact Hub instead of being
 * sent to a full-screen checkout.
 *
 * It starts nothing by itself. The plan buttons go to /checkout, which needs
 * the server's own answer about the account before it offers a purchase, and
 * the server refuses a second subscription for anyone who already has one.
 */
import { Link } from 'react-router-dom';
import { ArrowLeft, Check } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { FREE_PLAN_HOME } from '../../constants/freePlan';
import { PLAN_DETAILS } from '../../constants/plans';
import './UpgradeRequired.css';

const PAID = ['starter', 'pro'];

export default function UpgradeRequired() {
  const T = useT();
  return (
    <section className="upgrade-required" aria-labelledby="upgrade-required-title" style={{ color: T.text }}>
      <h1 id="upgrade-required-title" className="upgrade-required-title">This is part of Scout</h1>
      <p className="upgrade-required-lead" style={{ color: T.textMuted }}>
        You’re on the Free plan. Your contacts, stickers and notes stay free in Contact Hub.
        Scout adds prospecting, outreach and enrichment credits.
      </p>
      <div className="upgrade-required-plans">
        {PAID.map((id) => {
          const plan = PLAN_DETAILS[id];
          return (
            <div key={id} className="upgrade-required-plan" style={{ background: T.cardBg, borderColor: T.border }}>
              <h2 className="upgrade-required-plan-name">{plan.name}</h2>
              <p className="upgrade-required-plan-price">{plan.price}</p>
              <p className="upgrade-required-plan-summary" style={{ color: T.textMuted }}>
                <Check size={14} aria-hidden="true" /> {plan.summary}
              </p>
              <Link
                className="upgrade-required-cta"
                to={`/checkout?tier=${id}`}
                style={{ background: T.accent, color: '#fff' }}
              >
                Choose {plan.name}
              </Link>
            </div>
          );
        })}
      </div>
      <Link className="upgrade-required-back" to={FREE_PLAN_HOME} style={{ color: T.text }}>
        <ArrowLeft size={16} aria-hidden="true" /> Back to Contact Hub
      </Link>
    </section>
  );
}
