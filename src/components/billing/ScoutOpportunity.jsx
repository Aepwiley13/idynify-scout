/**
 * W1: what Scout could do for this person, on their Contact Hub page.
 *
 * Built only from the contact record already on the page (utils/scoutOpportunity.js), so it
 * makes no request of any kind, paid or not. The account's plan comes from the shell
 * (accountPlanContext.js):
 *
 *   free     what Scout would look up for this person, and Upgrade to Scout: a choice of plan,
 *            each going to the authenticated checkout with this person as the place to return to
 *            (utils/checkoutReturn.js). After payment the customer lands on this same person in
 *            Scout, where enrichment runs
 *   paid     Open in Scout, the same person's Scout page
 *   unknown  nothing: an account whose plan could not be confirmed is never offered a purchase
 *
 * Nothing here changes the contact.
 */
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { PLAN, isPaidPlan } from '../../utils/accountPlan';
import { PLAN_DETAILS } from '../../constants/plans';
import { checkoutPath } from '../../utils/checkoutReturn';
import { scoutOpportunityFor, listInWords, scoutContactPath } from '../../utils/scoutOpportunity';
import { useAccountPlan } from './accountPlanContext';
import './ScoutOpportunity.css';

const PAID_PLANS = ['starter', 'pro'];

function lead(opportunity) {
  const { name, missing, company } = opportunity;
  if (missing.length > 0) {
    const looks = `${name} has no ${listInWords(missing.map((m) => m.label))} on file. Scout can look ${missing.length === 1 ? 'it' : 'them'} up`;
    return company ? `${looks}, and find more people at ${company}.` : `${looks}.`;
  }
  return company
    ? `Scout can find more people at ${company}, and others like ${name}.`
    : `Scout can find more people like ${name}.`;
}

export default function ScoutOpportunity({ contact }) {
  const T = useT();
  const plan = useAccountPlan();
  const headingId = useId();
  const [choosing, setChoosing] = useState(false);
  const opportunity = scoutOpportunityFor(contact);
  if (!opportunity || plan === PLAN.UNKNOWN) return null;

  const scoutPage = scoutContactPath(contact.id);
  const paid = isPaidPlan(plan);

  return (
    <section className="hub-card scout-opportunity" aria-labelledby={headingId} style={{ background: T.cardBg, borderColor: T.border }}>
      <div className="scout-opportunity-head">
        <Sparkles size={18} aria-hidden="true" style={{ color: T.accent }} />
        <h2 id={headingId} className="scout-opportunity-title">
          {opportunity.missing.length > 0 ? 'Scout can fill in the rest' : 'Find more people with Scout'}
        </h2>
      </div>
      <p className="scout-opportunity-lead" style={{ color: T.textMuted }}>{lead(opportunity)}</p>

      {paid ? (
        <Link className="hub-primary-btn scout-opportunity-cta" to={scoutPage} style={{ background: T.accent }}>
          Open in Scout
        </Link>
      ) : (
        <>
          <button
            type="button"
            className="hub-primary-btn scout-opportunity-cta"
            style={{ background: T.accent }}
            aria-expanded={choosing}
            onClick={() => setChoosing((open) => !open)}
          >
            Upgrade to Scout
          </button>
          {choosing && (
            <div className="scout-opportunity-plans" role="group" aria-label="Choose a plan">
              {PAID_PLANS.map((id) => {
                const details = PLAN_DETAILS[id];
                return (
                  <Link
                    key={id}
                    className="scout-opportunity-plan"
                    to={checkoutPath(id, scoutPage)}
                    style={{ borderColor: T.border, color: T.text }}
                  >
                    <span className="scout-opportunity-plan-name">{details.name}</span>
                    <span className="scout-opportunity-plan-price">{details.price}</span>
                    <span className="scout-opportunity-plan-summary" style={{ color: T.textMuted }}>{details.summary}</span>
                  </Link>
                );
              })}
            </div>
          )}
          <p className="scout-opportunity-note" style={{ color: T.textMuted }}>
            Same account, same people. Your contacts, stickers and notes stay exactly as they are.
          </p>
        </>
      )}
    </section>
  );
}
