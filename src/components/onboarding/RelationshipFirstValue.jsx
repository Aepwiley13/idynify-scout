import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../firebase/config';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { searchPeople, loadPeopleForLens } from '../../services/peopleService';
import { logEvent, EVENTS } from '../../services/analytics';
import {
  matchNamedPerson,
  searchTermFor,
  FOUND,
  SEVERAL,
  NONE,
  UNNAMED,
} from '../../utils/findNamedPerson';
import {
  buildSnapshot,
  enrichmentWouldHelp,
  daysSince,
  ENGAGEMENT,
  PREPARATION,
} from '../../utils/relationshipSnapshot';
import './RelationshipFirstValue.css';

/**
 * RelationshipFirstValue — Engagement and Preparation, answered from the record.
 *
 * The First Value here is not a data-acquisition run. It is Barry saying where
 * things stand with one person and what he'd do next, assembled from what
 * IDYNIFY already holds. That is useful on its own, costs nothing external, and
 * is correct in a workspace with no ICP.
 *
 * Retrieval is offered exactly once, for exactly one person, and only when the
 * thing the user asked for is genuinely blocked — a message with nowhere to
 * send it. Never because enrichment happens to be available.
 *
 * What Barry does not say here, because the product cannot know it: what is new
 * at their company, who they are connected to, or anything about competitors.
 */
export default function RelationshipFirstValue({ decision, knownName = null }) {
  const navigate = useNavigate();
  const intent = decision?.mode === 'preparation' ? PREPARATION : ENGAGEMENT;

  const [loading, setLoading] = useState(true);
  const [match, setMatch] = useState(null);
  const [contact, setContact] = useState(null);
  const [quiet, setQuiet] = useState([]);
  const [enriching, setEnriching] = useState(false);
  const [enrichNote, setEnrichNote] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const user = getEffectiveUser() || auth.currentUser;
      if (!user) { setLoading(false); return; }

      const subject = decision?.subject || '';
      const term = searchTermFor(subject);

      // Local search over records the user already owns. No external call.
      let candidates = [];
      if (term && term.length >= 2) {
        candidates = await searchPeople(user.uid, term).catch(() => []);
      }

      const result = matchNamedPerson(subject, candidates);

      // Nobody named: for Engagement that is a real request — "who's gone
      // quiet" is answerable from elapsed time alone.
      let quietList = [];
      if (result.status === UNNAMED || (!subject && intent === ENGAGEMENT)) {
        // Deliberately not searchPeople with a blank term — it short-circuits
        // to [] below two characters, which would have made this list silently
        // and permanently empty. A bounded lens read is the honest way to ask
        // for "everyone".
        const page = await loadPeopleForLens(user.uid, 'all', { pageSize: 200 }).catch(() => null);
        quietList = rankByQuiet(page?.people || []).slice(0, 3);
      }

      if (cancelled) return;
      setMatch(result);
      setContact(result.contact);
      setQuiet(quietList);
      setLoading(false);

      logEvent(EVENTS.FIRST_VALUE_ATTEMPTED, { intent, match_status: result.status, has_quiet: quietList.length > 0 });

      if (result.status === FOUND || (result.status === UNNAMED && quietList.length > 0)) {
        logEvent(EVENTS.FIRST_VALUE_DELIVERED, { intent, branch: 'relationship', outcome: result.status === FOUND ? 'snapshot' : 'quiet_list' });
      } else if (result.status === NONE) {
        logEvent(EVENTS.FIRST_VALUE_BLOCKED, { intent, reason: 'person_not_found' });
      }
    })();

    return () => { cancelled = true; };
  }, [decision?.subject, decision?.mode, intent]);

  /**
   * One person, one attempt, and only when something is actually blocked.
   *
   * The attempt is instrumented so external retrieval behaviour can be measured
   * later. The event carries no name, no email, no phone number and no Apollo
   * payload — only whether it was tried, on what kind of identifier, and how it
   * came out.
   */
  async function fillTheGap() {
    if (!contact || enriching) return;
    const { helpful, identifier } = enrichmentWouldHelp(contact, { wants: 'draft' });
    if (!helpful) return;

    setEnriching(true);
    setEnrichNote(null);
    logEvent(EVENTS.ENRICHMENT_ATTEMPTED, { surface: 'first_experience', intent, identifier });

    try {
      const user = getEffectiveUser() || auth.currentUser;
      const authToken = await user.getIdToken();
      const response = await fetch('/.netlify/functions/barryEnrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          // Exactly the person the user named. No list, no company sweep.
          contact: {
            id: contact.id,
            name: contact.name || null,
            company_name: contact.company_name || contact.company || null,
            title: contact.title || null,
            apollo_person_id: contact.apollo_person_id || null,
            linkedin_url: contact.linkedin_url || null,
          },
        }),
      });

      const data = response.ok ? await response.json() : null;
      const enriched = data?.enrichedData || null;
      if (enriched) setContact(prev => ({ ...prev, ...enriched }));

      // Success is measured against what the user asked for, not against
      // whether the call returned something. A lookup that comes back with a
      // job title when the ask was an address did not solve anything, and
      // recording it as a win would make the cost data say the opposite of
      // what happened.
      const gotAddress = Boolean(enriched?.email || enriched?.work_email);

      if (gotAddress) {
        logEvent(EVENTS.ENRICHMENT_SUCCEEDED, { surface: 'first_experience', intent, identifier });
        setEnrichNote(null);
      } else {
        logEvent(EVENTS.ENRICHMENT_FAILED, { surface: 'first_experience', intent, identifier, reason: 'no_data' });
        setEnrichNote(`I couldn't turn up an address for them. You can add one on their profile and I'll use it from there.`);
      }
    } catch (err) {
      // A failed lookup changes nothing about the snapshot above it. Barry says
      // so and the rest of the answer still stands.
      console.warn('[RelationshipFirstValue] enrichment failed:', err.message);
      logEvent(EVENTS.ENRICHMENT_FAILED, { surface: 'first_experience', intent, identifier, reason: 'request_failed' });
      setEnrichNote(`That lookup didn't come back. Everything above still holds — it's just what I already had.`);
    } finally {
      setEnriching(false);
    }
  }

  if (loading) {
    return (
      <div className="rfv">
        <p className="rfv-headline">One moment&hellip;</p>
      </div>
    );
  }

  // ── Several people share that name ─────────────────────────────────────────
  if (match?.status === SEVERAL) {
    return (
      <div className="rfv">
        <p className="rfv-headline">
          I have more than one {match.person}. Which one?
        </p>
        <div className="rfv-actions">
          {match.candidates.map(c => (
            <button key={c.id} className="rfv-btn rfv-btn--quiet" onClick={() => { setContact(c); setMatch({ ...match, status: FOUND }); }}>
              {c.name}{(c.company || c.company_name) ? ` — ${c.company || c.company_name}` : ''}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Nobody named, and the ask was about people generally ───────────────────
  if (match?.status === UNNAMED || (!decision?.subject && !contact)) {
    if (quiet.length > 0) {
      return (
        <div className="rfv">
          <p className="rfv-headline">These are the ones it&rsquo;s been longest with.</p>
          <ul className="rfv-list">
            {quiet.map(c => (
              <li key={c.id}>
                <strong>{c.name}</strong>
                {(c.company || c.company_name) ? ` at ${c.company || c.company_name}` : ''}
                {Number.isFinite(daysSince(c.engagement_summary?.last_contact_at || c.last_interaction))
                  ? ` — ${daysSince(c.engagement_summary?.last_contact_at || c.last_interaction)} days`
                  : ' — no record of a last conversation'}
              </li>
            ))}
          </ul>
          <p className="rfv-suggestion">
            Name one and I&rsquo;ll tell you where it stands and what I&rsquo;d say.
          </p>
          <div className="rfv-actions">
            {quiet.map(c => (
              <button key={c.id} className="rfv-btn rfv-btn--quiet" onClick={() => setContact(c)}>
                {c.name}
              </button>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div className="rfv">
        <p className="rfv-headline">Who did you have in mind?</p>
        <p className="rfv-suggestion">Give me a name and I&rsquo;ll tell you where things stand.</p>
        <div className="rfv-actions">
          <button className="rfv-btn rfv-btn--quiet" onClick={() => navigate('/hunter')}>
            Show me everyone
          </button>
        </div>
      </div>
    );
  }

  // ── Named, but not in the workspace ────────────────────────────────────────
  if (match?.status === NONE || !contact) {
    return (
      <div className="rfv">
        <p className="rfv-headline">
          I don&rsquo;t have {match?.person || 'them'} in your workspace.
        </p>
        <p className="rfv-suggestion">
          Add them and I&rsquo;ll have something to work with. I only know about people
          you&rsquo;ve brought in.
        </p>
        <div className="rfv-actions">
          <button className="rfv-btn rfv-btn--go" onClick={() => navigate('/scout/plus?view=manual')}>
            Add them
          </button>
          <button className="rfv-btn rfv-btn--quiet" onClick={() => navigate('/hunter')}>
            Show me everyone
          </button>
        </div>
      </div>
    );
  }

  // ── The snapshot ───────────────────────────────────────────────────────────
  const snapshot = buildSnapshot(contact, { intent });
  const gap = enrichmentWouldHelp(contact, { wants: 'draft' });

  return (
    <div className="rfv">
      <p className="rfv-headline">
        {knownName ? `${knownName} — ` : ''}{snapshot.headline}
      </p>

      {snapshot.known.length > 0 ? (
        <ul className="rfv-list">
          {snapshot.known.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      ) : (
        <p className="rfv-suggestion">
          Honestly, not much — they&rsquo;re in your workspace but there&rsquo;s no history
          on them yet.
        </p>
      )}

      {snapshot.gaps.length > 0 && (
        <p className="rfv-gaps">{snapshot.gaps.join(' ')}</p>
      )}

      {snapshot.suggestion && <p className="rfv-suggestion">{snapshot.suggestion}</p>}

      {enrichNote && <p className="rfv-gaps">{enrichNote}</p>}

      <div className="rfv-actions">
        <button
          className="rfv-btn rfv-btn--go"
          onClick={() => navigate(`/contact/${contact.id}`)}
        >
          {intent === PREPARATION ? 'Open their profile' : 'Write to them'}
        </button>

        {gap.helpful && (
          <button className="rfv-btn rfv-btn--quiet" onClick={fillTheGap} disabled={enriching}>
            {enriching ? 'Looking…' : 'See if I can find an address'}
          </button>
        )}

        <button className="rfv-btn rfv-btn--quiet" onClick={() => navigate('/hunter')}>
          Show me everyone
        </button>
      </div>
    </div>
  );
}

/** Longest since a conversation first. Elapsed time is intelligence we own. */
function rankByQuiet(people) {
  return (people || [])
    .filter(p => p && p.name)
    .map(p => ({ p, days: daysSince(p.engagement_summary?.last_contact_at || p.last_interaction) }))
    .filter(({ days }) => days > 30)
    .sort((a, b) => b.days - a.days)
    .map(({ p }) => p);
}
