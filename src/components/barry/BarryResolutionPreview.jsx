/**
 * BarryResolutionPreview — a `resolution_preview` turn in the canonical thread.
 *
 * Barry has checked the selection against what the workspace already knows and
 * is reporting back before anything is written. Three ideas govern this surface:
 *
 * 1. NOTHING HAS BEEN SAVED YET. The preview is a dry run. The approval button
 *    is the first moment anything would persist.
 *
 * 2. IF BARRY IS UNCERTAIN ABOUT WHO, BARRY ASKS. An ambiguous person is not a
 *    validation error and is not rendered as one — it is a question, phrased the
 *    way a colleague would ask it, and it BLOCKS approval until answered. Barry
 *    never guesses and never silently creates a second record for one human.
 *
 * 3. THE UI NEVER IMPLIES CERTAINTY THE IDENTITY LAYER DOES NOT HAVE. Counts
 *    come from the resolver. This component does no matching of its own.
 */

import { useState } from 'react';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';
import { OUTCOME } from '../../utils/resolutionContract';
import './BarryStructuredTurn.css';

// Outcome vocabulary and summary keys come from
// docs/GATE2_CANDIDATE_CONTRACT.md — matched · created · ambiguous · refused.
const TONE = {
  [OUTCOME.MATCHED]:   { label: 'already yours', hue: '#2F7D5C', key: 'matched' },
  [OUTCOME.CREATED]:   { label: 'would be new',  hue: '#0B6E7F', key: 'created' },
  [OUTCOME.AMBIGUOUS]: { label: 'needs you',     hue: '#B4611A', key: 'ambiguous' },
  [OUTCOME.REFUSED]:   { label: "can't tell apart", hue: '#8A93A0', key: 'refused' },
};

export default function BarryResolutionPreview({ preview, onApprove, onCancel, settled = null }) {
  const T = useT();
  const [choices, setChoices] = useState({});   // clientRef -> optionRef | 'neither'
  const [expanded, setExpanded] = useState(null);

  if (!preview) {
    return <p className="bst-expired" style={{ color: T.textFaint }}>This preview is no longer available.</p>;
  }

  const { results, summary } = preview;
  const ambiguous = results.filter(r => r.outcome === OUTCOME.AMBIGUOUS);
  const unanswered = ambiguous.filter(r => !choices[r.clientRef]);
  const blocked = unanswered.length > 0;

  if (settled) {
    return (
      <p className="bst-settled" style={{ color: T.textFaint }}>
        {settled.approved ? 'Approved — ready to save.' : 'Cancelled. Nothing was saved.'}
      </p>
    );
  }

  function choose(clientRef, optionRef) {
    setChoices(prev => ({ ...prev, [clientRef]: optionRef }));
    setExpanded(null);
  }

  // Contract: ambiguous and refused are NEVER written. An ambiguous row only
  // counts once the user has answered, and 'neither' turns it into a creation.
  const willSave = results.filter(r =>
    r.outcome === OUTCOME.MATCHED ||
    r.outcome === OUTCOME.CREATED ||
    (r.outcome === OUTCOME.AMBIGUOUS && choices[r.clientRef] && choices[r.clientRef] !== 'neither')
  ).length;
  const willCreate = results.filter(r =>
    r.outcome === OUTCOME.CREATED || (r.outcome === OUTCOME.AMBIGUOUS && choices[r.clientRef] === 'neither')
  ).length;

  return (
    <div className="bst">
      <div className="bst-tallies">
        {Object.entries(TONE).map(([outcome, tone]) => {
          const n = summary[tone.key];
          if (!n) return null;
          return (
            <span key={outcome} className="bst-tally" style={{ borderColor: `${tone.hue}55`, background: `${tone.hue}12`, color: tone.hue }}>
              <strong>{n}</strong> {tone.label}
            </span>
          );
        })}
      </div>

      {/* The question. Not an error banner — a thing Barry is asking. */}
      {ambiguous.map(r => {
        const answered = choices[r.clientRef];
        const isOpen = expanded === r.clientRef || (!answered && ambiguous.length === 1);
        return (
          <div key={r.clientRef} className="bst-ask" style={{ borderColor: `${TONE[OUTCOME.AMBIGUOUS].hue}44`, background: `${TONE[OUTCOME.AMBIGUOUS].hue}08` }}>
            <p className="bst-ask-q" style={{ color: T.text }}>
              I found two people who could be {r.name}. Which one did you mean?
            </p>

            {answered ? (
              <p className="bst-ask-a" style={{ color: T.textFaint }}>
                {answered === 'neither'
                  ? `Neither — I'll treat ${r.name} as someone new.`
                  : `Got it — ${r.candidates.find(o => o.contactId === answered)?.company_name}.`}
                <button type="button" className="bst-linkbtn" style={{ color: BRAND.pink }} onClick={() => setExpanded(r.clientRef)}>
                  change
                </button>
              </p>
            ) : isOpen ? (
              <div className="bst-options">
                {r.candidates.map(o => (
                  <button key={o.contactId} type="button" className="bst-option"
                    onClick={() => choose(r.clientRef, o.contactId)}
                    style={{ borderColor: T.border, background: T.surface, color: T.text }}>
                    <span className="bst-name">{o.existingName} — {o.company_name}</span>
                    <span className="bst-meta" style={{ color: T.textFaint }}>
                      {o.title} · last spoke {o.lastInteraction}
                    </span>
                  </button>
                ))}
                <button type="button" className="bst-option bst-option--quiet"
                  onClick={() => choose(r.clientRef, 'neither')}
                  style={{ borderColor: T.border, color: T.textFaint }}>
                  Neither — this is someone new
                </button>
              </div>
            ) : (
              <button type="button" className="bst-linkbtn" style={{ color: BRAND.pink }} onClick={() => setExpanded(r.clientRef)}>
                Help me sort this one
              </button>
            )}
          </div>
        );
      })}

      {/* Refusals stated plainly, with the actual reason. */}
      {results.filter(r => r.outcome === OUTCOME.REFUSED).map(r => (
        <p key={r.clientRef} className="bst-refused" style={{ color: T.textFaint }}>
          I can&apos;t tell which record {r.name || 'one of these'} is — {r.reason}. I&apos;ll leave them out rather than guess.
        </p>
      ))}

      <div className="bst-actions bst-actions--split">
        <button type="button" className="bst-quiet" onClick={onCancel} style={{ color: T.textFaint, borderColor: T.border }}>
          Not now
        </button>
        <button
          type="button"
          className="bst-primary"
          disabled={blocked}
          onClick={() => onApprove?.({ choices, willSave, willCreate })}
          style={{
            background: blocked ? T.border : BRAND.pink,
            color: blocked ? T.textFaint : '#fff',
            cursor: blocked ? 'not-allowed' : 'pointer',
          }}
        >
          {blocked
            ? `Answer ${unanswered.length} question${unanswered.length === 1 ? '' : 's'} first`
            : `Save ${willSave}${willCreate ? ` — ${willCreate} new` : ''}`}
        </button>
      </div>
    </div>
  );
}
