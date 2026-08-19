/**
 * B4 — intent to First Value routing.
 *
 * The two properties that matter most are negative ones: only Prospecting ever
 * reaches the ICP conversation, and nothing is simulated to cover a capability
 * that does not exist. Both are asserted directly rather than left to review.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
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
  INTENTS,
  normalizeClassification,
} from '../utils/firstExperienceIntent.js';
import {
  routeIntent,
  intentLabel,
  reachesIcpConversation,
  ROUTE_IN_PLACE,
  ROUTE_NAVIGATE,
  ROUTE_CONFIRM,
  ROUTE_CLARIFY,
  ROUTE_BLOCKED,
  ROUTE_DEFERRED,
} from '../utils/firstValueRouting.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');

const EMPTY = { hasContacts: false, gmailConnected: false };
const WORKING = { hasContacts: true, gmailConnected: true };

const sure = (intent, extra = {}) =>
  normalizeClassification({ intent, confidence: 0.9, ...extra });

describe('1 — one route per supported intent, on a workspace that can serve it', () => {
  it('Exploration goes to Mission Control, where the orientation brief lives', () => {
    const d = routeIntent(sure(INTENT_EXPLORATION), EMPTY);
    expect(d.kind).toBe(ROUTE_NAVIGATE);
    expect(d.destination.path).toBe('/mission-control-v2');
  });

  it('Communication goes to the replies view', () => {
    const d = routeIntent(sure(INTENT_COMMUNICATION), WORKING);
    expect(d.kind).toBe(ROUTE_NAVIGATE);
    expect(d.destination.path).toBe('/hunter?tab=replied');
  });

  it('Outreach goes to the engagement feed, and names the person if one was given', () => {
    const d = routeIntent(sure(INTENT_OUTREACH, { subject: 'Dana at Acme' }), WORKING);
    expect(d.kind).toBe(ROUTE_NAVIGATE);
    expect(d.destination.path).toBe('/hunter?tab=all');
    expect(d.headline).toContain('Dana at Acme');
  });

  it('Pipeline goes to the due-and-quiet view', () => {
    const d = routeIntent(sure(INTENT_PIPELINE), WORKING);
    expect(d.kind).toBe(ROUTE_NAVIGATE);
    expect(d.destination.path).toBe('/hunter?tab=today');
  });

  it('Prospecting stays in the conversation that defines targeting', () => {
    const d = routeIntent(sure(INTENT_PROSPECTING), EMPTY);
    expect(d.kind).toBe(ROUTE_IN_PLACE);
  });

  it('Referral drafts the ask through the outreach path', () => {
    const d = routeIntent(sure(INTENT_REFERRAL, { subject: 'Sam' }), WORKING);
    expect(d.kind).toBe(ROUTE_NAVIGATE);
    expect(d.destination.path).toBe('/hunter?tab=all');
    expect(d.headline).toContain('Sam');
  });

  it('Referral never implies it can see who knows whom', () => {
    const d = routeIntent(sure(INTENT_REFERRAL), WORKING);
    // The product has no relationship graph — contacts are flat records — so
    // this line is a correctness requirement, not tone.
    expect(d.detail).toMatch(/can't see who's connected/i);
    expect(d.detail).not.toMatch(/second-degree|mutual connection|path to/i);
  });

  it('every category resolves to a decision rather than falling through', () => {
    for (const intent of INTENTS) {
      for (const facts of [EMPTY, WORKING]) {
        const d = routeIntent(sure(intent), facts);
        expect(d.kind).toBeTruthy();
        expect(d.headline.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('2 — a missing precondition is stated, not routed around', () => {
  it('Communication with no mailbox connected offers to connect one', () => {
    const d = routeIntent(sure(INTENT_COMMUNICATION), { hasContacts: true, gmailConnected: false });
    expect(d.kind).toBe(ROUTE_BLOCKED);
    expect(d.reason).toBe('gmail-not-connected');
    expect(d.destination.path).toBe('/settings');
  });

  it('Communication with a mailbox but nobody to hear from says which is missing', () => {
    const d = routeIntent(sure(INTENT_COMMUNICATION), { hasContacts: false, gmailConnected: true });
    expect(d.kind).toBe(ROUTE_BLOCKED);
    expect(d.reason).toBe('no-contacts');
  });

  it.each([INTENT_OUTREACH, INTENT_PIPELINE, INTENT_REFERRAL])(
    '%s with nobody in the workspace blocks and offers a real alternative',
    (intent) => {
      const d = routeIntent(sure(intent), EMPTY);
      expect(d.kind).toBe(ROUTE_BLOCKED);
      expect(d.reason).toBe('no-contacts');
      expect(d.options.map(o => o.intent)).toContain(INTENT_PROSPECTING);
    }
  );

  it('never sends a user to a surface that would be empty for them', () => {
    for (const intent of INTENTS) {
      const d = routeIntent(sure(intent), EMPTY);
      if (d.kind === ROUTE_NAVIGATE) {
        // Only exploration survives an empty workspace, and it is honest there
        // by construction: the brief reports real platform state.
        expect(d.intent).toBe(INTENT_EXPLORATION);
      }
    }
  });

  it('offers only real capabilities, never a placeholder', () => {
    for (const intent of INTENTS) {
      for (const facts of [EMPTY, WORKING]) {
        for (const option of routeIntent(sure(intent), facts).options) {
          expect(INTENTS).toContain(option.intent);
          expect(option.label.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('3 — unbuilt branches say so rather than inventing an outcome', () => {
  it.each([INTENT_ENGAGEMENT, INTENT_PREPARATION])('%s is recognized and deferred', (intent) => {
    const d = routeIntent(sure(intent), WORKING);
    expect(d.kind).toBe(ROUTE_DEFERRED);
    expect(d.reason).toBe('branch-not-wired');
    // Deferred means no handoff is offered as if it were the outcome.
    expect(d.destination).toBeNull();
  });

  it('Engagement never claims to know what is new at a company', () => {
    // There is no news producer anywhere in the product. Asserting the absence
    // of the claim is the only thing standing between honesty and a plausible
    // sentence a future edit could add.
    const d = routeIntent(sure(INTENT_ENGAGEMENT, { subject: 'Acme' }), WORKING);
    const copy = `${d.headline} ${d.detail}`;
    expect(copy).not.toMatch(/news|announced|in the press|recently raised|headline/i);
  });

  it('Preparation never claims a meeting briefing was produced', () => {
    const d = routeIntent(sure(INTENT_PREPARATION, { subject: 'the Acme call' }), WORKING);
    const copy = `${d.headline} ${d.detail}`;
    expect(copy).not.toMatch(/here's your brief|I've prepared|I've put together/i);
  });

  it('names the subject back without pretending to have acted on it', () => {
    const d = routeIntent(sure(INTENT_PREPARATION, { subject: 'the Acme call' }), WORKING);
    expect(d.headline).toContain('the Acme call');
    expect(d.headline).toMatch(/not from here yet/);
  });
});

describe('4 — ambiguity confirms, and nothing unclear becomes prospecting', () => {
  it('a low-confidence reading is read back before it is acted on', () => {
    const d = routeIntent(normalizeClassification({ intent: INTENT_ENGAGEMENT, confidence: 0.3, restatement: 'You want to reconnect with people you already know.' }), WORKING);
    expect(d.kind).toBe(ROUTE_CONFIRM);
    expect(d.headline).toContain('reconnect');
  });

  it('a confirmed reading then routes normally', () => {
    const low = normalizeClassification({ intent: INTENT_PIPELINE, confidence: 0.2 });
    expect(routeIntent(low, WORKING).kind).toBe(ROUTE_CONFIRM);
    expect(routeIntent({ ...low, needsConfirmation: false }, WORKING).kind).toBe(ROUTE_NAVIGATE);
  });

  it('an unreadable intent asks one question', () => {
    const d = routeIntent(normalizeClassification({ intent: 'GIBBERISH' }), WORKING);
    expect(d.kind).toBe(ROUTE_CLARIFY);
    expect(d.headline).toMatch(/\?$/);
  });

  it('uses the classifier question when it offered one', () => {
    const d = routeIntent(normalizeClassification({ intent: INTENT_UNCLEAR, clarifyingQuestion: 'What would a good week look like?' }), WORKING);
    expect(d.headline).toBe('What would a good week look like?');
  });

  it('an absent classification asks rather than assuming', () => {
    expect(routeIntent(null, WORKING).kind).toBe(ROUTE_CLARIFY);
    expect(routeIntent(undefined, EMPTY).intent).toBe(INTENT_UNCLEAR);
  });

  it.each([null, undefined, { intent: 'GIBBERISH' }, { intent: INTENT_UNCLEAR }])(
    'never lands on the ICP conversation from %s',
    (payload) => {
      const d = routeIntent(payload ? normalizeClassification(payload) : payload, EMPTY);
      expect(reachesIcpConversation(d)).toBe(false);
    }
  );
});

describe('5 — only prospecting reaches the ICP conversation', () => {
  it('holds for every other category, in every workspace state', () => {
    for (const intent of INTENTS.filter(i => i !== INTENT_PROSPECTING)) {
      for (const facts of [EMPTY, WORKING]) {
        for (const confidence of [0.1, 0.9]) {
          const d = routeIntent(normalizeClassification({ intent, confidence }), facts);
          expect(reachesIcpConversation(d)).toBe(false);
        }
      }
    }
  });

  it('and prospecting still gets there', () => {
    expect(reachesIcpConversation(routeIntent(sure(INTENT_PROSPECTING), EMPTY))).toBe(true);
    expect(reachesIcpConversation(routeIntent(sure(INTENT_PROSPECTING), WORKING))).toBe(true);
  });

  it('a low-confidence prospecting reading confirms before creating anything', () => {
    const d = routeIntent(normalizeClassification({ intent: INTENT_PROSPECTING, confidence: 0.2 }), EMPTY);
    expect(d.kind).toBe(ROUTE_CONFIRM);
    expect(reachesIcpConversation(d)).toBe(false);
  });
});

describe('6 — zero ICP is a working state on every non-prospecting route', () => {
  it('no branch reads, requires or mentions an ICP', () => {
    const src = read('../utils/firstValueRouting.js');
    expect(src).not.toMatch(/resolveActiveIcp|icpProfiles|DEFAULT_ICP_ID|getActiveIcpId/);
  });

  it('routing never consults ICP state', () => {
    // hasIcp is deliberately absent from every decision: an empty workspace is
    // a valid workspace, and a relationship-shaped intent must work in one.
    for (const intent of INTENTS) {
      const without = routeIntent(sure(intent), { ...WORKING, hasIcp: false });
      const with_ = routeIntent(sure(intent), { ...WORKING, hasIcp: true });
      expect(without).toEqual(with_);
    }
  });
});

describe('7 — the taxonomy never reaches the screen', () => {
  it('no user-facing string contains a category name', () => {
    for (const intent of INTENTS) {
      for (const facts of [EMPTY, WORKING]) {
        const d = routeIntent(sure(intent, { subject: 'Acme' }), facts);
        const copy = `${d.headline} ${d.detail || ''} ${d.options.map(o => o.label).join(' ')}`;
        for (const name of INTENTS) {
          // The literal token, not the English word: "a pipeline needs people
          // in it" is plain language, whereas a rendered `PIPELINE` is the
          // taxonomy leaking onto the screen.
          expect(copy).not.toContain(name);
        }
      }
    }
  });

  it('no user-facing string exposes internal architecture terms', () => {
    const banned = /proto-targeting|attribution|\bD7\b|ICP architecture|retrieval constraint|barryState/i;
    for (const intent of INTENTS) {
      for (const facts of [EMPTY, WORKING]) {
        const d = routeIntent(sure(intent), facts);
        expect(`${d.headline} ${d.detail || ''}`).not.toMatch(banned);
      }
    }
  });

  it('a held second intent is named in words, not as a category', () => {
    for (const intent of INTENTS) {
      const label = intentLabel(intent);
      expect(label).toBe(label.toLowerCase());
      expect(INTENTS).not.toContain(label.toUpperCase());
    }
  });
});

describe('8 — the route wires classification to routing and writes nothing', () => {
  const shell = read('../pages/Onboarding/FirstExperience.jsx');

  it('classifies through the mode surface, not the ICP endpoint', () => {
    expect(shell).toContain('firstExperience: true');
    expect(shell).toContain('barryMissionChat');
    expect(shell).not.toContain('barryICPConversation');
  });

  it('persists no intent', () => {
    // The shell reads to route and writes nothing on the intent path. WHO's
    // name write lives in resolveWho, deliberately outside this file.
    expect(shell).not.toMatch(/setDoc|updateDoc|addDoc|deleteDoc|writeBatch/);
    const imports = shell.slice(shell.indexOf("from 'firebase/firestore'") - 200, shell.indexOf("from 'firebase/firestore'"));
    expect(imports).not.toMatch(/setDoc|updateDoc|addDoc/);
  });

  it('asks the intent question only at the beginning of a first conversation', () => {
    expect(shell).toContain('MODE_BEGIN');
    expect(shell).toMatch(/setAskingIntent\(beginning/);
  });

  it('a resumed or refining visit goes straight to the targeting conversation', () => {
    expect(shell).toMatch(/if \(!beginning\)[\s\S]{0,160}INTENT_PROSPECTING/);
  });

  it('only the in-place decision renders the ICP conversation', () => {
    const renders = shell.split('<BarryOnboarding').length - 1;
    // Two: the ROUTE_IN_PLACE branch, and the final fallback that exists so a
    // decision-less render can never be a blank screen.
    expect(renders).toBe(2);
    expect(shell).toMatch(/decision\?\.kind === ROUTE_IN_PLACE[\s\S]{0,120}<BarryOnboarding/);
  });

  it('a failed classifier asks rather than routing', () => {
    expect(shell).toContain("unclearClassification('request-failed')");
    expect(shell).toContain("unclearClassification('unclassified')");
  });
});
