/**
 * firstValueRouting.js — from what the user asked for to something real.
 *
 * B4. One pure function maps a classified intent plus a few facts about the
 * workspace onto a decision: go here, ask this, or say plainly why not.
 *
 * ── The rule that shapes everything below ───────────────────────────────────
 * Nothing is simulated to close a gap. Where a capability exists, this routes
 * to the surface that actually delivers it. Where a precondition is missing,
 * Barry says what is missing and offers a real alternative. Where no producer
 * exists at all, Barry says so. A first experience that fabricates its first
 * value teaches the user that Barry makes things up, which is a worse outcome
 * than an honest empty hand.
 *
 * ── Why preconditions are checked here rather than downstream ───────────────
 * Sending someone to the replies view when they have no contacts is not a
 * routing success, it is a dead end with extra steps. The facts are cheap to
 * read and checking them is what lets Barry answer "I can't do that yet, and
 * here's why" in the same turn.
 */

import {
  INTENT_EXPLORATION,
  INTENT_COMMUNICATION,
  INTENT_OUTREACH,
  INTENT_PIPELINE,
  INTENT_ENGAGEMENT,
  INTENT_PREPARATION,
  INTENT_REFERRAL,
  INTENT_PROSPECTING,
  INTENT_UNCLEAR,
} from './firstExperienceIntent.js';

/** Stay in the First Experience conversation — it is itself the capability. */
export const ROUTE_IN_PLACE = 'in-place';
/** Hand off to an existing surface that delivers the outcome. */
export const ROUTE_NAVIGATE = 'navigate';
/** Read the intent back and wait for a yes. */
export const ROUTE_CONFIRM = 'confirm';
/** Ask one question. */
export const ROUTE_CLARIFY = 'clarify';
/** Understood, but something real is missing before it can happen. */
export const ROUTE_BLOCKED = 'blocked';
/** Understood, and the branch that serves it has not been built yet. */
export const ROUTE_DEFERRED = 'deferred';

/**
 * Destinations, all of which exist today.
 *
 * Hunter's tabs are the honest homes for three of these: `replied` is the
 * contacts who have written back, `today` is due follow-ups and priority
 * contacts, `all` is the engagement feed where a message gets drafted.
 */
const MISSION_CONTROL = { path: '/mission-control-v2' };
const HUNTER_REPLIED = { path: '/hunter?tab=replied' };
const HUNTER_TODAY = { path: '/hunter?tab=today' };
const HUNTER_ALL = { path: '/hunter?tab=all' };
const GMAIL_SETUP = { path: '/settings' };

/** Offers are always real next steps, never placeholders for missing features. */
const OFFER_LOOK_AROUND = { id: 'explore', label: 'Show me around instead', intent: INTENT_EXPLORATION };
const OFFER_FIND_PEOPLE = { id: 'prospect', label: 'Help me find people first', intent: INTENT_PROSPECTING };

function decision(kind, intent, extra = {}) {
  return { kind, intent, destination: null, headline: '', detail: null, options: [], ...extra };
}

/** Someone to work with. Everything relationship-shaped depends on it. */
function needsSomeone(intent, what) {
  return decision(ROUTE_BLOCKED, intent, {
    reason: 'no-contacts',
    headline: `I can do that as soon as there's someone to do it with.`,
    detail: `${what} There's nobody in your workspace yet — want me to help you find people first?`,
    options: [OFFER_FIND_PEOPLE, OFFER_LOOK_AROUND],
  });
}

/**
 * @param {object} classification - from normalizeClassification
 * @param {{hasContacts?: boolean, gmailConnected?: boolean, hasIcp?: boolean}} readiness
 * @returns {{kind: string, intent: string, destination: object|null, headline: string,
 *            detail: string|null, options: Array, reason?: string}}
 */
export function routeIntent(classification, readiness = {}) {
  const intent = classification?.intent || INTENT_UNCLEAR;
  const hasContacts = readiness.hasContacts === true;
  const gmailConnected = readiness.gmailConnected === true;
  const subject = classification?.subject || null;

  // Unclear asks its own question first — there is nothing to confirm.
  if (intent === INTENT_UNCLEAR) {
    return decision(ROUTE_CLARIFY, intent, {
      headline:
        classification?.clarifyingQuestion ||
        `Tell me a bit more — what would make today useful?`,
      options: [OFFER_LOOK_AROUND],
    });
  }

  // A reading Barry is not confident about gets read back rather than acted on.
  // One sentence to correct a wrong guess beats a wrong first experience.
  if (classification?.needsConfirmation) {
    return decision(ROUTE_CONFIRM, intent, {
      headline: classification.restatement || `Let me make sure I've got this right.`,
      detail: `Is that what you're after?`,
    });
  }

  switch (intent) {
    // ── Fully supported ─────────────────────────────────────────────────────

    case INTENT_EXPLORATION:
      // The one intent with no precondition at all: an honest orientation from
      // real platform state, correct in a workspace with nothing in it.
      return decision(ROUTE_NAVIGATE, intent, {
        destination: MISSION_CONTROL,
        headline: `Let me show you where things stand.`,
      });

    case INTENT_PROSPECTING:
      // Stays here. Defining who you're trying to reach IS this conversation,
      // and it is the one intent the First Experience serves itself.
      return decision(ROUTE_IN_PLACE, intent, {
        headline: `Let's work out who you're trying to reach.`,
      });

    case INTENT_COMMUNICATION:
      if (!gmailConnected) {
        return decision(ROUTE_BLOCKED, intent, {
          reason: 'gmail-not-connected',
          destination: GMAIL_SETUP,
          headline: `I'll need access to your email before I can read what's waiting.`,
          detail: `Connect Gmail and I'll go through what's come in and draft the replies.`,
          options: [OFFER_LOOK_AROUND],
        });
      }
      if (!hasContacts) {
        return needsSomeone(intent, `Replies come in against people you're tracking.`);
      }
      return decision(ROUTE_NAVIGATE, intent, {
        destination: HUNTER_REPLIED,
        headline: `Here's what's come back.`,
      });

    case INTENT_OUTREACH:
      if (!hasContacts) {
        return needsSomeone(intent, `I write to a specific person, not a list.`);
      }
      return decision(ROUTE_NAVIGATE, intent, {
        destination: HUNTER_ALL,
        headline: subject
          ? `Let's write to ${subject}.`
          : `Pick who it's going to and I'll draft it.`,
      });

    case INTENT_PIPELINE:
      if (!hasContacts) {
        return needsSomeone(intent, `A pipeline needs people in it.`);
      }
      return decision(ROUTE_NAVIGATE, intent, {
        destination: HUNTER_TODAY,
        headline: `Here's what's moving and what's gone quiet.`,
      });

    case INTENT_REFERRAL:
      // Routed through the outreach path for a named person, as authorized.
      // The honesty line is not decoration: v1.0 describes referral as
      // second-degree path detection, and there is no relationship graph in
      // this product — contacts are flat records. Barry drafts the ask; Barry
      // does not work out who knows whom, and must not imply that it does.
      if (!hasContacts) {
        return needsSomeone(intent, `An introduction has to come from someone you know.`);
      }
      return decision(ROUTE_NAVIGATE, intent, {
        destination: HUNTER_ALL,
        headline: subject
          ? `Let's ask ${subject} for the introduction.`
          : `Tell me who you'd like to ask and I'll draft it.`,
        detail: `I can write the ask to anyone you name — I can't see who's connected to whom.`,
      });

    // ── Recognized, branch not built yet ────────────────────────────────────
    //
    // Both are understood correctly and both have a real outcome available
    // from stored context — a reconnect suggestion, and context on a person
    // and company before a meeting. Neither is wired here. Saying so is the
    // whole point: the alternative is inventing an outcome, and Barry
    // inventing things is the failure this phase exists to prevent.

    case INTENT_ENGAGEMENT:
      return decision(ROUTE_DEFERRED, intent, {
        reason: 'branch-not-wired',
        headline: subject
          ? `Reconnecting with ${subject} — I can help with that, but not from here yet.`
          : `Reconnecting with people you've lost touch with — I can help with that, but not from here yet.`,
        detail: hasContacts
          ? `Open anyone in Hunter and I'll give you what I have on them and a way back in.`
          : `Once there are people in your workspace I'll be able to tell you who's gone cold.`,
        options: hasContacts ? [OFFER_LOOK_AROUND] : [OFFER_FIND_PEOPLE, OFFER_LOOK_AROUND],
      });

    case INTENT_PREPARATION:
      return decision(ROUTE_DEFERRED, intent, {
        reason: 'branch-not-wired',
        headline: subject
          ? `Getting you ready for ${subject} — I can pull that together, but not from here yet.`
          : `Getting you ready for a meeting — I can pull that together, but not from here yet.`,
        detail: hasContacts
          ? `Open the person in Hunter and I'll show you everything I have on them and their company.`
          : `I'd need the person in your workspace first.`,
        options: hasContacts ? [OFFER_LOOK_AROUND] : [OFFER_FIND_PEOPLE, OFFER_LOOK_AROUND],
      });

    default:
      // Unreachable by construction — normalizeIntent only emits known
      // categories. Falls to a question rather than a guess.
      return decision(ROUTE_CLARIFY, INTENT_UNCLEAR, {
        headline: `Tell me a bit more — what would make today useful?`,
        options: [OFFER_LOOK_AROUND],
      });
  }
}

/** Intents this batch routes to a real surface or serves in place. */
export const FULLY_ROUTED = [
  INTENT_EXPLORATION,
  INTENT_COMMUNICATION,
  INTENT_OUTREACH,
  INTENT_PIPELINE,
  INTENT_REFERRAL,
  INTENT_PROSPECTING,
];

/**
 * Human words for an intent, for the one place a held second intent has to be
 * named back to the user. Never the category name — the taxonomy is internal.
 */
const LABELS = {
  [INTENT_EXPLORATION]: 'show you around',
  [INTENT_COMMUNICATION]: 'go through your replies',
  [INTENT_OUTREACH]: 'draft a message',
  [INTENT_PIPELINE]: 'check where things stand',
  [INTENT_ENGAGEMENT]: 'help you reconnect',
  [INTENT_PREPARATION]: 'get you ready for that meeting',
  [INTENT_REFERRAL]: 'ask for that introduction',
  [INTENT_PROSPECTING]: 'work out who to reach',
};

export function intentLabel(intent) {
  return LABELS[intent] || 'pick this up';
}

/** Only Prospecting reaches the ICP conversation. Asserted by test. */
export function reachesIcpConversation(decisionOrKind) {
  const d = typeof decisionOrKind === 'string' ? { kind: decisionOrKind } : decisionOrKind;
  return d?.kind === ROUTE_IN_PLACE && d?.intent === INTENT_PROSPECTING;
}
