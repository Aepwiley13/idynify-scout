import { Check, RefreshCw } from 'lucide-react';
import './TargetingProposal.css';

/**
 * TargetingProposal — Barry's plan, in words, waiting on a yes.
 *
 * This replaces a field list on the Prospecting path. The difference is not
 * cosmetic: a field list asks the user to verify Barry's data model, and every
 * blank in it reads as homework. A proposal asks them to agree with his
 * reasoning, and the blanks are things Barry says out loud in his own voice —
 * "you didn't mention where, so I'm looking everywhere" — which is information
 * rather than an unfinished form.
 *
 * Confirming is the authority boundary. Until the user presses it, nothing has
 * been created, activated or searched.
 */
export default function TargetingProposal({ proposal, onConfirm, onRefine, onAnswer }) {
  // Nothing defensible to propose yet: one question, and the conversation
  // continues in the normal input below. No field list, no completion meter.
  if (!proposal?.canPropose) {
    return (
      <div className="targeting-proposal targeting-proposal--asking">
        <p className="tp-greeting">{proposal?.greeting}</p>
        <p className="tp-question">{proposal?.question}</p>
        {onAnswer && (
          <button className="tp-btn tp-btn--quiet" onClick={onAnswer}>
            Tell Barry more
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="targeting-proposal">
      <p className="tp-greeting">{proposal.greeting}</p>

      {proposal.goal && (
        <p className="tp-line">
          <span className="tp-lead">You&rsquo;re trying to</span> {proposal.goal}
        </p>
      )}

      <p className="tp-line tp-line--target">
        <span className="tp-lead">So I&rsquo;ll go looking for</span> {proposal.target}.
      </p>

      {proposal.learned.length > 0 && (
        <div className="tp-block">
          <p className="tp-block-label">What I picked up along the way</p>
          <ul className="tp-list">
            {proposal.learned.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </div>
      )}

      {proposal.uncertain.length > 0 && (
        <div className="tp-block tp-block--unsure">
          <p className="tp-block-label">Where I&rsquo;m less sure</p>
          <ul className="tp-list">
            {proposal.uncertain.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </div>
      )}

      <p className="tp-plan">{proposal.plan}</p>

      {proposal.broad && (
        <p className="tp-broad">
          That&rsquo;s a wide net on purpose — I&rsquo;d rather start finding people and
          tighten it with you than keep asking questions first.
        </p>
      )}

      <div className="tp-actions">
        <button className="tp-btn tp-btn--quiet" onClick={onRefine}>
          <RefreshCw className="w-4 h-4" />
          <span>Let me adjust</span>
        </button>
        <button className="tp-btn tp-btn--go" onClick={onConfirm}>
          <Check className="w-4 h-4" />
          <span>That&rsquo;s right — go find them</span>
        </button>
      </div>
    </div>
  );
}
