/**
 * B3a — First Experience intent classification.
 *
 * Two things are under test: the contract that turns untrusted model output
 * into a routing decision, and the placement of the classifier itself.
 *
 * The placement matters as much as the contract. Classification had to happen
 * without running ICP extraction over turns that have nothing to do with
 * targeting, so these assertions pin where the branch sits and what vocabulary
 * it is allowed to carry.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  INTENTS,
  INTENT_EXPLORATION,
  INTENT_COMMUNICATION,
  INTENT_OUTREACH,
  INTENT_PIPELINE,
  INTENT_ENGAGEMENT,
  INTENT_PREPARATION,
  INTENT_REFERRAL,
  INTENT_PROSPECTING,
  INTENT_UNCLEAR,
  OPENING_QUESTION,
  CONFIRM_BELOW,
  normalizeIntent,
  normalizeClassification,
  unclearClassification,
  orderCompound,
} from '../utils/firstExperienceIntent.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');

/** Source with comments removed — comments name the things code must not do. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('1 — the taxonomy is nine categories and stays internal', () => {
  it('has exactly the nine categories the routing table is written against', () => {
    expect(INTENTS).toEqual([
      INTENT_EXPLORATION,
      INTENT_COMMUNICATION,
      INTENT_OUTREACH,
      INTENT_PIPELINE,
      INTENT_ENGAGEMENT,
      INTENT_PREPARATION,
      INTENT_REFERRAL,
      INTENT_PROSPECTING,
      INTENT_UNCLEAR,
    ]);
  });

  it('asks one open question rather than offering a menu', () => {
    expect(OPENING_QUESTION).toMatch(/\?$/);
    // A question that named the categories would be the nine-button menu with
    // extra steps.
    for (const intent of INTENTS) {
      expect(OPENING_QUESTION.toUpperCase()).not.toContain(intent);
    }
  });

  it('no longer opens by presuming the user came to prospect', () => {
    expect(OPENING_QUESTION.toLowerCase()).not.toContain('hunting');
  });
});

describe('2 — untrusted model output is coerced, never trusted', () => {
  it.each(INTENTS)('accepts %s in any casing', (intent) => {
    expect(normalizeIntent(intent)).toBe(intent);
    expect(normalizeIntent(intent.toLowerCase())).toBe(intent);
    expect(normalizeIntent(` ${intent} `)).toBe(intent);
  });

  it.each([
    ['an unknown label', 'BUY_A_SANDWICH'],
    ['an empty string', ''],
    ['a number', 7],
    ['null', null],
    ['undefined', undefined],
    ['an object', { intent: 'OUTREACH' }],
  ])('turns %s into UNCLEAR', (_label, value) => {
    expect(normalizeIntent(value)).toBe(INTENT_UNCLEAR);
  });

  it('never converts an unreadable classification into PROSPECTING', () => {
    // The asymmetry that matters: a wrong question costs one turn, a wrong ICP
    // costs a workspace.
    for (const value of ['???', 'PROSPECT', 'prospekting', null, 42]) {
      expect(normalizeIntent(value)).not.toBe(INTENT_PROSPECTING);
    }
  });

  it('clamps confidence into 0..1 and treats nonsense as zero', () => {
    expect(normalizeClassification({ intent: INTENT_OUTREACH, confidence: 5 }).confidence).toBe(1);
    expect(normalizeClassification({ intent: INTENT_OUTREACH, confidence: -3 }).confidence).toBe(0);
    expect(normalizeClassification({ intent: INTENT_OUTREACH, confidence: 'high' }).confidence).toBe(0);
    expect(normalizeClassification({ intent: INTENT_OUTREACH, confidence: 0.72 }).confidence).toBe(0.72);
  });

  it('bounds free text so model output cannot flood component state', () => {
    const long = 'x'.repeat(5000);
    const c = normalizeClassification({ intent: INTENT_OUTREACH, restatement: long, subject: long });
    expect(c.restatement.length).toBe(400);
    expect(c.subject.length).toBe(120);
  });

  it('treats whitespace-only text as absent', () => {
    const c = normalizeClassification({ intent: INTENT_PIPELINE, restatement: '   ', subject: '\n' });
    expect(c.restatement).toBeNull();
    expect(c.subject).toBeNull();
  });
});

describe('3 — ambiguity confirms rather than acting', () => {
  it('flags low confidence for confirmation', () => {
    const c = normalizeClassification({ intent: INTENT_ENGAGEMENT, confidence: CONFIRM_BELOW - 0.01 });
    expect(c.needsConfirmation).toBe(true);
  });

  it('acts on confidence at or above the threshold', () => {
    const c = normalizeClassification({ intent: INTENT_ENGAGEMENT, confidence: CONFIRM_BELOW });
    expect(c.needsConfirmation).toBe(false);
  });

  it('does not ask UNCLEAR to confirm — it has its own question', () => {
    const c = normalizeClassification({ intent: 'NONSENSE', confidence: 0.1 });
    expect(c.intent).toBe(INTENT_UNCLEAR);
    expect(c.needsConfirmation).toBe(false);
  });

  it('a failed classifier asks rather than deciding', () => {
    const c = unclearClassification('timeout');
    expect(c.intent).toBe(INTENT_UNCLEAR);
    expect(c.confidence).toBe(0);
    expect(c.failureReason).toBe('timeout');
  });
});

describe('4 — compound intent is served one at a time, most actionable first', () => {
  it('keeps a genuine second intent', () => {
    const c = normalizeClassification({ intent: INTENT_PROSPECTING, secondaryIntent: INTENT_PIPELINE });
    expect(c.secondaryIntent).toBe(INTENT_PIPELINE);
  });

  it('drops a secondary that merely repeats the primary', () => {
    const c = normalizeClassification({ intent: INTENT_OUTREACH, secondaryIntent: 'outreach' });
    expect(c.secondaryIntent).toBeNull();
  });

  it('drops an unreadable secondary rather than inventing a compound intent', () => {
    const c = normalizeClassification({ intent: INTENT_OUTREACH, secondaryIntent: 'MAYBE?' });
    expect(c.secondaryIntent).toBeNull();
  });

  it('serves the acting intent before the multi-turn one', () => {
    // "I need more leads, and I should chase the Acme deal" — the deal is a
    // real outcome now; the leads are a conversation first.
    expect(orderCompound(INTENT_PROSPECTING, INTENT_PIPELINE)).toEqual([INTENT_PIPELINE, INTENT_PROSPECTING]);
  });

  it('serves anything before exploration, which is always available anyway', () => {
    expect(orderCompound(INTENT_EXPLORATION, INTENT_COMMUNICATION)).toEqual([INTENT_COMMUNICATION, INTENT_EXPLORATION]);
  });

  it('leaves an already-ordered pair alone', () => {
    expect(orderCompound(INTENT_COMMUNICATION, INTENT_PROSPECTING)).toEqual([INTENT_COMMUNICATION, INTENT_PROSPECTING]);
  });

  it('returns a null partner when there is no second intent', () => {
    expect(orderCompound(INTENT_PREPARATION, null)).toEqual([INTENT_PREPARATION, null]);
  });
});

describe('5 — intent is transient: the contract writes nothing', () => {
  const src = read('../utils/firstExperienceIntent.js');

  it('imports no persistence', () => {
    expect(src).not.toMatch(/from ['"]firebase|firebase\/firestore|setDoc|updateDoc|addDoc/);
  });

  it('names no storage field', () => {
    expect(code(src)).not.toMatch(/intentHistory|lastIntent|savedIntent|intentField/);
  });
});

describe('6 — classification never runs ICP extraction', () => {
  const chat = read('../../netlify/functions/barryMissionChat.js');
  const icpConversation = read('../../netlify/functions/barryICPConversation.js');

  it('the classifier prompt carries no targeting vocabulary', () => {
    const start = chat.indexOf('function buildFirstExperienceClassifierPrompt');
    expect(start).toBeGreaterThan(-1);
    const prompt = chat.slice(start, chat.indexOf('\n}', start));
    expect(prompt).not.toMatch(/INDUSTRY_NAMES|APOLLO_INDUSTRIES|COMPANY_SIZE_OPTIONS|US_STATES/);
    // It may say the word "targeting" in a rule about not starting one; what it
    // must not do is ask for targeting fields back.
    expect(prompt).not.toMatch(/"industries"|"companySizes"|"locations"|"targetTitles"/);
  });

  it('the classification branch does not call barryICPConversation', () => {
    const start = chat.indexOf('if (isFirstExperience)');
    expect(start).toBeGreaterThan(-1);
    const branch = chat.slice(start, chat.indexOf('// ── Load RECON server-side', start));
    expect(branch).not.toContain('barryICPConversation');
    expect(branch).not.toContain('icpProfiles');
  });

  it('barryICPConversation gained no intent classification', () => {
    expect(code(icpConversation)).not.toMatch(/firstExperience|secondaryIntent|classifyIntent/);
  });
});

describe('7 — the branch is additive and cannot reach existing paths', () => {
  const chat = read('../../netlify/functions/barryMissionChat.js');

  it('is gated on a request flag no existing caller sends', () => {
    expect(chat).toMatch(/body\.firstExperience === true/);
    const callers = ['../components/dashboard/BarryChatPanel.jsx'];
    for (const rel of callers) {
      expect(read(rel)).not.toContain('firstExperience: true');
    }
  });

  it('returns before the dashboard, RECON and capability loads', () => {
    const branch = chat.indexOf('if (isFirstExperience)');
    const recon = chat.indexOf("// ── Load RECON server-side");
    const capability = chat.indexOf('const capabilityBlock = buildCapabilityBlock');
    const openingBrief = chat.indexOf('const isOpeningBrief =');
    expect(branch).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(recon);
    expect(branch).toBeLessThan(capability);
    expect(branch).toBeLessThan(openingBrief);
  });

  it('still verifies the caller before doing anything', () => {
    const verify = chat.indexOf('await verifyAuthToken(authToken, userId)');
    expect(verify).toBeGreaterThan(-1);
    expect(verify).toBeLessThan(chat.indexOf('if (isFirstExperience)'));
  });

  it('writes nothing on the classification path', () => {
    const start = chat.indexOf('if (isFirstExperience)');
    const branch = chat.slice(start, chat.indexOf('// ── Load RECON server-side', start));
    expect(branch).not.toMatch(/\.set\(|\.update\(|FieldValue/);
  });

  it('does not copy the user turn into telemetry', () => {
    const start = chat.indexOf('if (isFirstExperience)');
    const branch = chat.slice(start, chat.indexOf('// ── Load RECON server-side', start));
    const metaStart = branch.indexOf('metadata: { type: ');
    const meta = branch.slice(metaStart, branch.indexOf('\n', metaStart));
    expect(meta).not.toMatch(/message|turn:|userInput/);
  });
});
