/**
 * B8 / D1 — Engagement and Preparation, answered from what IDYNIFY already holds.
 *
 * Three properties carry the weight, and all three are negative:
 *   1. Barry never guesses who the user meant.
 *   2. Barry never claims what the product cannot know — news, connections,
 *      competitors, a briefing.
 *   3. Barry never spends an external lookup to make an answer look fuller.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  matchNamedPerson,
  splitSubject,
  namesAnIndividual,
  searchTermFor,
  FOUND,
  SEVERAL,
  NONE,
  UNNAMED,
} from '../utils/findNamedPerson.js';
import {
  buildSnapshot,
  enrichmentWouldHelp,
  daysSince,
  ENGAGEMENT,
  PREPARATION,
} from '../utils/relationshipSnapshot.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString();

const DANA = {
  id: 'c1',
  name: 'Dana Whitfield',
  company: 'Acme Roofing',
  title: 'Ops Director',
  email: 'dana@acme.example',
  barry_memory: {
    who_they_are: 'Runs facilities for six sites.',
    what_has_worked: ['short direct notes'],
    what_has_not_worked: ['long decks'],
  },
  engagement_summary: { last_contact_at: daysAgo(90), total_messages_sent: 3, replies_received: 1 },
  engage_state: { last_barry_session: { next_step: 'send the Q3 maintenance quote' } },
};

const ROSTER = [
  DANA,
  { id: 'c2', name: 'Dana Kim', company: 'Northwind' },
  { id: 'c3', name: 'Danielle Cross', company: 'Acme Roofing' },
];

describe('1 — Barry never guesses who was meant', () => {
  it('a full name resolves', () => {
    const r = matchNamedPerson('Dana Whitfield', ROSTER);
    expect(r.status).toBe(FOUND);
    expect(r.contact.id).toBe('c1');
  });

  it('a first name plus a company resolves', () => {
    expect(matchNamedPerson('Dana at Acme Roofing', ROSTER).contact.id).toBe('c1');
  });

  it('an ambiguous first name asks rather than picking one', () => {
    const r = matchNamedPerson('Dana', ROSTER);
    expect(r.status).toBe(SEVERAL);
    expect(r.contact).toBeNull();
    expect(r.candidates.map(c => c.id)).toEqual(['c1', 'c2']);
  });

  it('does not fall back to the most recent, or any other plausible tiebreak', () => {
    // A confident snapshot of the wrong person is the failure this prevents.
    // `exact[0]` after a length-1 check is not a tiebreak; ordering the
    // candidates and taking the front of the list would be.
    const src = code(read('../utils/findNamedPerson.js'));
    expect(src).not.toMatch(/\.sort\(|last_contact_at|last_interaction|mostRecent|bestGuess/);

    // And behaviourally: the answer does not depend on which order the
    // records arrive in, which is what a hidden tiebreak would show up as.
    const reversed = [...ROSTER].reverse();
    expect(matchNamedPerson('Dana', reversed).status).toBe(SEVERAL);
    expect(matchNamedPerson('Dana', reversed).contact).toBeNull();
  });

  it('matches whole words, so a short name does not swallow a longer one', () => {
    const r = matchNamedPerson('Dan', ROSTER);
    expect(r.status).toBe(NONE);
  });

  it('strips the words people put around a name', () => {
    expect(matchNamedPerson('my contact Dana Kim', ROSTER).contact.id).toBe('c2');
    expect(splitSubject('with Dana at Acme')).toEqual({ person: 'Dana', company: 'Acme' });
  });

  it('a company match alone is never a person match', () => {
    const r = matchNamedPerson('Acme Roofing', ROSTER);
    expect(r.status).toBe(NONE);
  });

  it('recognizes when no individual was named at all', () => {
    for (const subject of ['old clients', 'people I have lost touch with', 'a few customers', 'everyone']) {
      expect(namesAnIndividual(subject), subject).toBe(false);
      expect(matchNamedPerson(subject, ROSTER).status).toBe(UNNAMED);
    }
  });

  it('says so plainly when the named person is not there', () => {
    expect(matchNamedPerson('Riley Chen', ROSTER).status).toBe(NONE);
    expect(matchNamedPerson('Riley Chen', []).status).toBe(NONE);
  });

  it('searches on the name, not the filler around it', () => {
    expect(searchTermFor('my contact Dana at Acme')).toBe('Dana');
  });

  it('tolerates malformed input without throwing', () => {
    for (const bad of [null, undefined, '', 42, {}]) {
      expect(() => matchNamedPerson(bad, ROSTER)).not.toThrow();
      expect(() => matchNamedPerson('Dana', bad)).not.toThrow();
    }
  });
});

describe('2 — the snapshot is read from the record and nothing else', () => {
  const s = buildSnapshot(DANA, { intent: ENGAGEMENT });

  it('says where things stand', () => {
    expect(s.headline).toContain('Dana Whitfield');
    expect(s.headline).toContain('Acme Roofing');
    expect(s.known.join(' ')).toMatch(/last spoke about 3 months ago/);
  });

  it('surfaces what was tried and what landed', () => {
    const copy = s.known.join(' ');
    expect(copy).toContain('Runs facilities for six sites.');
    expect(copy).toContain('short direct notes');
    expect(copy).toContain('send the Q3 maintenance quote');
    expect(copy).toMatch(/3 messages out, 1 back/);
  });

  it('recommends a move derived from the record', () => {
    expect(s.suggestion).toContain('send the Q3 maintenance quote');
  });

  it('changes its recommendation when messages are going unanswered', () => {
    const cold = buildSnapshot(
      { ...DANA, engage_state: {}, engagement_summary: { ...DANA.engagement_summary, consecutive_no_replies: 3 } },
      { intent: ENGAGEMENT }
    );
    expect(cold.suggestion).toMatch(/change the approach/i);
  });

  it('acknowledges a long gap rather than pretending it is not there', () => {
    const old = buildSnapshot(
      { ...DANA, engage_state: {}, engagement_summary: { last_contact_at: daysAgo(400) } },
      { intent: ENGAGEMENT }
    );
    expect(old.suggestion).toMatch(/acknowledging the gap/i);
  });

  it('states gaps as gaps rather than filling them in', () => {
    const thin = buildSnapshot({ id: 'x', name: 'Sam' }, { intent: ENGAGEMENT });
    expect(thin.thin).toBe(true);
    expect(thin.gaps.join(' ')).toMatch(/don't have their role/);
    expect(thin.gaps.join(' ')).toMatch(/don't have an email address/);
    expect(thin.known).toEqual([]);
  });

  it('never invents a history it does not have', () => {
    const thin = buildSnapshot({ id: 'x', name: 'Sam' }, { intent: PREPARATION });
    expect(thin.suggestion).toMatch(/don't have any history/i);
    expect(thin.suggestion).not.toMatch(/pick up where/i);
  });

  it('reads preparation and engagement differently', () => {
    expect(buildSnapshot(DANA, { intent: PREPARATION }).headline).toMatch(/what I have on/);
    expect(buildSnapshot(DANA, { intent: ENGAGEMENT }).headline).toMatch(/where things stand/);
  });

  it('handles a missing or malformed contact without throwing', () => {
    for (const bad of [null, undefined, {}, { name: '' }]) {
      expect(() => buildSnapshot(bad)).not.toThrow();
    }
    expect(daysSince(null)).toBe(Infinity);
    expect(daysSince('not a date')).toBe(Infinity);
  });
});

describe('3 — unsupported capabilities are not simulated', () => {
  const banned = {
    news: /\bnews\b|announced|press release|recently raised|funding round|in the headlines/i,
    graph: /second.degree|mutual connection|who they know|connected to|introduction path/i,
    competitive: /competitor|competitive landscape|market share|versus their rivals/i,
    briefing: /here'?s your brief|I'?ve prepared a brief|briefing document/i,
  };

  const CONTACTS = [
    DANA,
    { id: 'x', name: 'Sam' },
    { ...DANA, engage_state: {}, engagement_summary: { last_contact_at: daysAgo(400) } },
    { ...DANA, engagement_summary: { ...DANA.engagement_summary, consecutive_no_replies: 4 } },
  ];

  it.each(Object.entries(banned))('never claims %s', (_label, pattern) => {
    for (const contact of CONTACTS) {
      for (const intent of [ENGAGEMENT, PREPARATION]) {
        const s = buildSnapshot(contact, { intent });
        const copy = [s.headline, s.suggestion, ...s.known, ...s.gaps].filter(Boolean).join(' ');
        expect(copy).not.toMatch(pattern);
      }
    }
  });

  it('the module has no producer for any of them', () => {
    const src = code(read('../utils/relationshipSnapshot.js'));
    expect(src).not.toMatch(/news|competitor|second.degree|graph|introduction/i);
  });

  it('the rendered branch adds no claim of its own', () => {
    const src = code(read('../components/onboarding/RelationshipFirstValue.jsx'));
    for (const pattern of Object.values(banned)) {
      expect(src).not.toMatch(pattern);
    }
  });
});

describe('4 — existing intelligence first', () => {
  it('a full snapshot needs no external lookup at all', () => {
    const s = buildSnapshot(DANA, { intent: ENGAGEMENT });
    expect(s.known.length).toBeGreaterThan(3);
    expect(enrichmentWouldHelp(DANA, { wants: 'draft' }).helpful).toBe(false);
  });

  it('neither module can reach an external service', () => {
    // `contact.apollo_person_id` is a stored field being read; what must be
    // absent is any way to place a call.
    for (const rel of ['../utils/relationshipSnapshot.js', '../utils/findNamedPerson.js']) {
      const src = code(read(rel));
      expect(src, rel).not.toMatch(/fetch\(|barryEnrich|APOLLO_ENDPOINTS|apollo\.io|axios|XMLHttpRequest|\.netlify/);
    }
  });

  it('the snapshot renders before anything external is even offered', () => {
    const src = read('../components/onboarding/RelationshipFirstValue.jsx');
    const snapshotAt = src.indexOf('const snapshot = buildSnapshot');
    const gapAt = src.indexOf('const gap = enrichmentWouldHelp');
    expect(snapshotAt).toBeGreaterThan(-1);
    expect(snapshotAt).toBeLessThan(gapAt);
  });

  it('the person lookup uses the local search, not a directory', () => {
    const src = read('../components/onboarding/RelationshipFirstValue.jsx');
    expect(src).toContain("from '../../services/peopleService'");
    expect(src).not.toMatch(/searchPeople'.*netlify|\/\.netlify\/functions\/searchPeople/);
  });
});

describe('5 — enrichment is spent only when something is actually blocked', () => {
  it('is offered when a draft has nowhere to go and there is an identifier', () => {
    const noEmail = { ...DANA, email: null, apollo_person_id: 'p_1' };
    const r = enrichmentWouldHelp(noEmail, { wants: 'draft' });
    expect(r.helpful).toBe(true);
    expect(r.reason).toBe('no-send-address');
    expect(r.identifier).toBe('apollo_person_id');
  });

  it('accepts a LinkedIn URL as an identifier too', () => {
    const r = enrichmentWouldHelp({ name: 'X', linkedin_url: 'https://li/x' }, { wants: 'draft' });
    expect(r.identifier).toBe('linkedin_url');
    expect(r.helpful).toBe(true);
  });

  it('is refused with no identifier, however thin the record', () => {
    // Searching by name alone for a contact the user already owns is
    // speculative spend on a record we cannot confidently match.
    const r = enrichmentWouldHelp({ name: 'Sam' }, { wants: 'draft' });
    expect(r.helpful).toBe(false);
    expect(r.reason).toBe('no-identifier');
  });

  it('is refused when nothing is blocked', () => {
    const hasEverything = { ...DANA, apollo_person_id: 'p_1' };
    expect(enrichmentWouldHelp(hasEverything, { wants: 'draft' }).reason).toBe('not-blocking');
  });

  it('is refused when the user did not ask for a draft', () => {
    const noEmail = { ...DANA, email: null, apollo_person_id: 'p_1' };
    expect(enrichmentWouldHelp(noEmail).helpful).toBe(false);
    expect(enrichmentWouldHelp(noEmail, { wants: 'snapshot' }).helpful).toBe(false);
  });

  it('a missing title or photo is never a reason to spend a lookup', () => {
    const noTitle = { ...DANA, title: null, photo_url: null, apollo_person_id: 'p_1' };
    expect(enrichmentWouldHelp(noTitle, { wants: 'draft' }).helpful).toBe(false);
  });

  it('the button only exists when the check passes', () => {
    const src = read('../components/onboarding/RelationshipFirstValue.jsx');
    expect(src).toMatch(/\{gap\.helpful && \([\s\S]{0,300}fillTheGap/);
  });

  it('and the handler refuses again even if it is reached', () => {
    const src = read('../components/onboarding/RelationshipFirstValue.jsx');
    expect(src).toMatch(/const \{ helpful, identifier \} = enrichmentWouldHelp\(contact, \{ wants: 'draft' \}\);\s*\n\s*if \(!helpful\) return;/);
  });
});

describe('6 — one person, no fan-out', () => {
  const src = read('../components/onboarding/RelationshipFirstValue.jsx');
  const handler = src.slice(src.indexOf('async function fillTheGap'), src.indexOf('if (loading)'));

  it('sends exactly one contact, never a list', () => {
    expect(handler).toMatch(/contact: \{/);
    expect(handler).not.toMatch(/contacts:|\.map\(|forEach|for \(/);
  });

  it('is called at most once per interaction', () => {
    expect(handler).toMatch(/if \(!contact \|\| enriching\) return;/);
    expect((handler.match(/fetch\(/g) || []).length).toBe(1);
  });

  it('reaches exactly one external endpoint', () => {
    const endpoints = [...src.matchAll(/\/\.netlify\/functions\/([\w-]+)/g)].map(m => m[1]);
    expect([...new Set(endpoints)]).toEqual(['barryEnrich']);
  });

  it('never enriches anyone the user did not name', () => {
    // The quiet list and the candidate list are both rendered, and neither is
    // wired to anything external.
    const quiet = src.slice(src.indexOf('function rankByQuiet'));
    expect(quiet).not.toMatch(/fetch\(|barryEnrich|logEvent/);
    expect(src).not.toMatch(/candidates\.map[\s\S]{0,200}fillTheGap/);
  });

  it('does not enrich on mount — only on an explicit press', () => {
    const effect = src.slice(src.indexOf('useEffect(()'), src.indexOf('async function fillTheGap'));
    expect(effect).not.toMatch(/fillTheGap|barryEnrich|fetch\(/);
  });
});

describe('7 — a failed lookup changes nothing about the answer', () => {
  const src = read('../components/onboarding/RelationshipFirstValue.jsx');

  it('the snapshot is built from the record, not from the lookup', () => {
    // buildSnapshot reads `contact`; a failed enrichment leaves it untouched.
    expect(src).toMatch(/const snapshot = buildSnapshot\(contact, \{ intent \}\)/);
  });

  it('says the answer still stands', () => {
    expect(src).toMatch(/Everything above still holds/);
  });

  it('catches the failure rather than surfacing an error boundary', () => {
    const handler = src.slice(src.indexOf('async function fillTheGap'), src.indexOf('if (loading)'));
    expect(handler).toMatch(/catch \(err\)/);
    expect(handler).toMatch(/finally \{\s*\n\s*setEnriching\(false\);/);
  });

  it('records the outcome either way', () => {
    expect(src).toContain('EVENTS.ENRICHMENT_ATTEMPTED');
    expect(src).toContain('EVENTS.ENRICHMENT_SUCCEEDED');
    expect(src).toContain('EVENTS.ENRICHMENT_FAILED');
  });
});

describe('8 — telemetry measures the boundary, it does not copy the data', () => {
  const src = read('../components/onboarding/RelationshipFirstValue.jsx');
  const analytics = read('../services/analytics.js');

  it('the events exist and are named for the cost boundary', () => {
    for (const name of ['ENRICHMENT_ATTEMPTED', 'ENRICHMENT_SUCCEEDED', 'ENRICHMENT_FAILED']) {
      expect(analytics).toContain(name);
    }
  });

  it('no event carries a name, address, phone number or payload', () => {
    for (const call of src.matchAll(/logEvent\(([^;]+)\);/g)) {
      const body = call[1];
      expect(body).not.toMatch(/contact\.|\.name|email|phone|linkedin_url|company|enriched|apolloRaw/);
    }
  });

  it('carries only what a cost question needs', () => {
    for (const call of src.matchAll(/logEvent\(([^;]+)\);/g)) {
      const body = call[1];
      // `identifier` is the kind of id used ('apollo_person_id'), not an id.
      expect(body).toMatch(/surface|intent|identifier|reason/);
    }
  });
});

describe('9 — zero ICP remains valid throughout', () => {
  it('nothing in the relationship path reads or requires an ICP', () => {
    for (const rel of [
      '../utils/relationshipSnapshot.js',
      '../utils/findNamedPerson.js',
      '../components/onboarding/RelationshipFirstValue.jsx',
    ]) {
      const src = code(read(rel));
      expect(src, rel).not.toMatch(/resolveActiveIcp|icpProfiles|icpId|DEFAULT_ICP_ID|getActiveIcpId|hasRetrievalConstraint/);
    }
  });

  it('the snapshot is identical whatever the workspace targeting looks like', () => {
    // There is no ICP input to buildSnapshot at all, which is the strongest
    // form of the guarantee.
    const a = buildSnapshot(DANA, { intent: ENGAGEMENT });
    const b = buildSnapshot(DANA, { intent: ENGAGEMENT });
    expect(a).toEqual(b);
  });
});

describe('10 — provenance never decides whether Barry may reason', () => {
  it.each([
    ['manually created', { id: 'm1', name: 'Dana Whitfield', source: 'manual' }],
    ['from networking', { id: 'm2', name: 'Dana Whitfield', source: 'networking' }],
    ['imported', { id: 'm3', name: 'Dana Whitfield', source: 'csv' }],
    ['Scout-discovered', { id: 'm4', name: 'Dana Whitfield', source: 'apollo_api' }],
    ['no source at all', { id: 'm5', name: 'Dana Whitfield' }],
  ])('a %s record produces the same answer', (_label, contact) => {
    const withHistory = { ...contact, ...DANA, id: contact.id, source: contact.source };
    const s = buildSnapshot(withHistory, { intent: ENGAGEMENT });
    expect(s.known.length).toBeGreaterThan(3);
    expect(s.suggestion).toContain('send the Q3 maintenance quote');
    expect(matchNamedPerson('Dana Whitfield', [contact]).status).toBe(FOUND);
  });

  it('no branch reads a source field', () => {
    for (const rel of [
      '../utils/relationshipSnapshot.js',
      '../utils/findNamedPerson.js',
      '../components/onboarding/RelationshipFirstValue.jsx',
    ]) {
      const src = code(read(rel));
      expect(src, rel).not.toMatch(/\.source\b|source ===|apollo_api|people_mode/);
    }
  });

  it('a manually created contact with no Apollo id still gets a full answer', () => {
    const manual = { ...DANA, id: 'm', source: 'manual', apollo_person_id: null, linkedin_url: null };
    const s = buildSnapshot(manual, { intent: ENGAGEMENT });
    expect(s.known.length).toBeGreaterThan(3);
    // It simply never gets offered a lookup, which is correct rather than a
    // reduced service: there is no identifier to look up against.
    expect(enrichmentWouldHelp(manual, { wants: 'draft' }).helpful).toBe(false);
  });
});
