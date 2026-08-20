/**
 * relationshipSnapshot.js — what Barry already knows about one person.
 *
 * Existing intelligence first, and often existing intelligence only. A user who
 * says "I should reconnect with Dana" wants to know where things stand and what
 * to say next. IDYNIFY already holds the answer to the first part — when they
 * last spoke, what was tried, what worked, what Barry remembers — and none of
 * it costs an external call.
 *
 * ── Why this is deliberately not an enrichment trigger ──────────────────────
 * Enriching a contact reaches Apollo up to three times for one person. That is
 * worth spending when it changes what Barry can do — a draft with no email to
 * send it to, say — and worth nothing when it only makes the answer look
 * fuller. `enrichmentWouldHelp` encodes that distinction: it is true only when
 * something the user asked for is actually blocked, and there is an identifier
 * to enrich against.
 *
 * ── What Barry must never claim ─────────────────────────────────────────────
 * There is no news producer in this product, no relationship graph, and no
 * competitive intelligence. Contacts are flat records. A snapshot says what is
 * in the record and stops; the gaps are stated as gaps.
 */

export const ENGAGEMENT = 'engagement';
export const PREPARATION = 'preparation';

const DAY = 24 * 60 * 60 * 1000;

/** Days since a Firestore timestamp, ISO string or Date. Infinity when unknown. */
export function daysSince(value) {
  if (!value) return Infinity;
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return Infinity;
  return Math.floor((Date.now() - date.getTime()) / DAY);
}

function displayName(contact) {
  const full = contact?.name || `${contact?.first_name || ''} ${contact?.last_name || ''}`.trim();
  return full || 'them';
}

function companyOf(contact) {
  return contact?.company || contact?.company_name || contact?.organization_name || null;
}

function elapsedPhrase(days) {
  if (!Number.isFinite(days)) return null;
  if (days <= 1) return 'today';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `about ${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `about ${Math.round(days / 30)} months ago`;
  return 'over two years ago';
}

/**
 * Everything Barry has, and nothing he does not.
 *
 * @param {object} contact - the stored contact record
 * @param {{intent?: string}} [options]
 * @returns {{
 *   name: string, company: string|null, title: string|null,
 *   headline: string, known: string[], gaps: string[],
 *   lastContactDays: number, suggestion: string|null,
 *   canDraft: boolean, hasEmail: boolean, thin: boolean
 * }}
 */
export function buildSnapshot(contact, { intent = ENGAGEMENT } = {}) {
  const name = displayName(contact);
  const company = companyOf(contact);
  const title = contact?.title || contact?.current_position_title || null;
  const memory = contact?.barry_memory || {};
  const summary = contact?.engagement_summary || {};

  const lastContactDays = daysSince(
    summary.last_contact_at || contact?.last_interaction || contact?.last_contacted_at || null
  );

  // What Barry can point at. Every line is read from the record — none of it is
  // inferred, and none of it is about the outside world.
  const known = [];

  const elapsed = elapsedPhrase(lastContactDays);
  if (elapsed) {
    known.push(
      elapsed === 'today'
        ? `You were in touch today.`
        : `You last spoke ${elapsed}.`
    );
  }

  if (memory.who_they_are) known.push(memory.who_they_are);
  if (memory.relationship_summary) known.push(memory.relationship_summary);
  if (memory.current_goal) known.push(`Last time, the goal was: ${memory.current_goal}`);

  const lastSession =
    contact?.engage_state?.last_barry_session?.summary || contact?.lastSessionSummary || null;
  if (lastSession) known.push(lastSession);

  const nextStep = contact?.engage_state?.last_barry_session?.next_step || null;
  if (nextStep) known.push(`The next step you landed on was: ${nextStep}`);

  if (Array.isArray(memory.what_has_worked) && memory.what_has_worked.length) {
    known.push(`What's landed before: ${memory.what_has_worked.slice(0, 2).join('; ')}`);
  }
  if (Array.isArray(memory.what_has_not_worked) && memory.what_has_not_worked.length) {
    known.push(`What hasn't: ${memory.what_has_not_worked.slice(0, 2).join('; ')}`);
  }

  if (summary.total_messages_sent > 0) {
    const replies = summary.replies_received || 0;
    known.push(
      replies > 0
        ? `${summary.total_messages_sent} messages out, ${replies} back.`
        : `${summary.total_messages_sent} messages out, nothing back yet.`
    );
  }

  // Gaps, stated as gaps. A missing field is information; a filled-in guess is
  // a fabrication.
  const hasEmail = Boolean(contact?.email || contact?.work_email);
  const gaps = [];
  if (!title) gaps.push(`I don't have their role.`);
  if (!company) gaps.push(`I don't have where they work.`);
  if (!hasEmail) gaps.push(`I don't have an email address for them.`);
  if (!Number.isFinite(lastContactDays)) gaps.push(`I don't have a record of when you last spoke.`);

  const thin = known.length <= 1;

  const headline =
    intent === PREPARATION
      ? `Here's what I have on ${name}${company ? ` at ${company}` : ''}.`
      : `Here's where things stand with ${name}${company ? ` at ${company}` : ''}.`;

  return {
    name,
    company,
    title,
    headline,
    known,
    gaps,
    lastContactDays,
    hasEmail,
    canDraft: true,
    thin,
    suggestion: suggestFor(contact, { intent, lastContactDays, nextStep }),
  };
}

/**
 * The move Barry recommends, derived from the record.
 *
 * Deliberately modest. It suggests a next action from elapsed time and stored
 * outcome — it does not claim a reason to reach out that Barry cannot see.
 */
function suggestFor(contact, { intent, lastContactDays, nextStep }) {
  if (intent === PREPARATION) {
    if (nextStep) return `Going in, the thing you left open was: ${nextStep}. Worth picking that back up.`;
    if (!Number.isFinite(lastContactDays)) {
      // No history to go in on. Saying "pick up where you left off" here would
      // be Barry inventing a relationship that does not exist in the record.
      return `I don't have any history with them, so treat this as a first conversation.`;
    }
    return `I'd go in on where you left it rather than starting cold.`;
  }

  if (nextStep) return `You'd already decided on: ${nextStep}. That's the natural thing to pick up.`;

  const summary = contact?.engagement_summary || {};
  if ((summary.consecutive_no_replies || 0) >= 2) {
    return `Two or more messages have gone unanswered, so I'd change the approach rather than send another like the last one.`;
  }

  if (!Number.isFinite(lastContactDays)) {
    return `I don't have a history with them, so I'd keep the first note short and ask rather than pitch.`;
  }
  if (lastContactDays > 180) {
    return `It's been long enough that I'd lead by acknowledging the gap rather than pretending it isn't there.`;
  }
  if (lastContactDays > 60) {
    return `Long enough for a genuine check-in, short enough to pick up the thread.`;
  }
  return `Recent enough to just continue the conversation.`;
}

/**
 * Should Barry spend an external lookup on this person?
 *
 * True only when both halves hold: something the user is trying to do is
 * actually blocked by missing data, AND there is an identifier to look up
 * against. Availability alone is never a reason.
 *
 * @param {object} contact
 * @param {{wants?: string}} [options] - 'draft' when the user asked for a message
 * @returns {{helpful: boolean, reason: string|null, identifier: string|null}}
 */
export function enrichmentWouldHelp(contact, { wants = null } = {}) {
  const identifier = contact?.apollo_person_id
    ? 'apollo_person_id'
    : contact?.linkedin_url
      ? 'linkedin_url'
      : null;

  // No identifier, no lookup. The fuzzy fallback path exists but searching by
  // name alone for a contact the user already owns is speculative spend.
  if (!identifier) return { helpful: false, reason: 'no-identifier', identifier: null };

  const hasEmail = Boolean(contact?.email || contact?.work_email);

  // The one case that is genuinely blocked: the user wants a message and there
  // is nowhere to send it.
  if (wants === 'draft' && !hasEmail) {
    return { helpful: true, reason: 'no-send-address', identifier };
  }

  // Everything else — a missing title, a missing photo, a fuller profile —
  // would make the answer look richer without changing what the user can do.
  return { helpful: false, reason: 'not-blocking', identifier };
}
