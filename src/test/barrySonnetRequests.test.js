// @vitest-environment node
/* global process */
/**
 * What the Barry Sonnet endpoints send, and log, on each model (#699).
 *
 * These run the real handlers. scripts/sonnet-compare/capture-json.mjs imports
 * every endpoint with the SDK, Firestore and usage logging stubbed, feeds it
 * the 110 synthetic fixtures, and records each Claude request it builds, what
 * it returned, and the usage rows it logged. Nothing is sent anywhere. The
 * model comes from BARRY_MODEL_SONNET, as it does in production.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SONNET_4_5, SONNET_5_5, SONNET_4_6, BARRY_SONNET_5_5_SETTINGS } from '../../netlify/functions/utils/models.js';
import { CHECKS } from '../../scripts/sonnet-compare/checks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const work = mkdtempSync(join(tmpdir(), 'barry-sonnet-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** Run every fixture through the real handlers with these environment variables. */
function capture(name, env = {}) {
  const out = join(work, `${name}.json`);
  const childEnv = { ...process.env, ...env };
  for (const key of ['BARRY_MODEL_SONNET', 'SONNET_COMPARE_REPLY']) if (!(key in env)) delete childEnv[key];
  execFileSync(process.execPath, [resolve(root, 'scripts/sonnet-compare/capture-json.mjs'), out], { env: childEnv, cwd: root });
  return JSON.parse(readFileSync(out, 'utf8'));
}

const SITES = [
  'mission-sequence', 'icp-initial', 'icp-followup', 'icp-example-company', 'icp-summary',
  'context', 'sequence-step', 'validate-contact', 'campaign-message', 'followup', 'engagement-message',
];

const MAX_TOKENS = {
  'mission-sequence': 3000, // was 1800; Sonnet 5.5 used up to 1672
  'icp-initial': 1500, 'icp-followup': 1500, 'icp-example-company': 1500, 'icp-summary': 500,
  context: 1500, 'sequence-step': 1000, 'validate-contact': 500,
  'campaign-message': 1024, followup: 1000, 'engagement-message': 4096,
};

// The per-endpoint choice from the comparison, written out here so a change to
// models.js has to change this too.
const LOW_EFFORT = { output_config: { effort: 'low' } };
const THINKING_OFF = { thinking: { type: 'between_tools' } };
const ON_SONNET_5_5 = Object.fromEntries(SITES.map((site) => [site, THINKING_OFF]));
ON_SONNET_5_5['icp-example-company'] = LOW_EFFORT;
ON_SONNET_5_5['engagement-message'] = LOW_EFFORT;

let onDefault;
let on55;
let on46;
beforeAll(() => {
  onDefault = capture('default');
  on55 = capture('sonnet-5-5', { BARRY_MODEL_SONNET: SONNET_5_5 });
  on46 = capture('sonnet-4-6', { BARRY_MODEL_SONNET: SONNET_4_6 });
});

describe('the fixtures', () => {
  it('cover every Barry Sonnet call site, with about ten cases each', () => {
    expect([...SITES].sort()).toEqual(Object.keys(CHECKS).sort());
    expect([...SITES].sort()).toEqual(Object.keys(BARRY_SONNET_5_5_SETTINGS).sort());
    for (const site of SITES) {
      expect(onDefault.filter((c) => c.site === site).length, site).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('on Sonnet 4.5, the default, requests are unchanged', () => {
  it('every call sends only model, max_tokens and messages — no thinking or effort settings', () => {
    for (const { site, label, request } of onDefault) {
      expect(Object.keys(request).sort(), `${site} / ${label}`).toEqual(['max_tokens', 'messages', 'model']);
      expect(request.model).toBe(SONNET_4_5);
    }
  });

  it('max_tokens is as before, except mission-sequence, which is now 3000', () => {
    for (const { site, label, request } of onDefault) {
      expect(request.max_tokens, `${site} / ${label}`).toBe(MAX_TOKENS[site]);
    }
  });
});

describe('on Sonnet 5.5, each call site gets its own setting and nothing else changes', () => {
  it.each(SITES)('%s', (site) => {
    const cases55 = on55.filter((c) => c.site === site);
    const cases45 = onDefault.filter((c) => c.site === site);
    expect(cases55).toHaveLength(cases45.length);
    cases55.forEach(({ label, request }, i) => {
      expect(request, `${site} / ${label}`).toEqual({
        ...cases45[i].request,
        model: SONNET_5_5,
        ...ON_SONNET_5_5[site],
      });
    });
  });
});

describe('on Sonnet 4.6, the fallback, requests are the 4.5 ones with only the model changed', () => {
  it('sends no Sonnet 5.5 setting, which 4.6 would reject', () => {
    expect(on46).toHaveLength(onDefault.length);
    on46.forEach(({ site, label, request }, i) => {
      expect(request, `${site} / ${label}`).toEqual({ ...onDefault[i].request, model: SONNET_4_6 });
    });
  });
});

describe('the follow-up prompt', () => {
  const prompts = (outcome) => onDefault
    .filter((c) => c.site === 'followup' && c.request.messages[0].content.includes(`- Outcome: ${outcome}\n`))
    .map((c) => c.request.messages[0].content);

  it('for a reply, says the reply is not available instead of asking the model to reference it', () => {
    const replied = prompts('replied');
    expect(replied.length).toBeGreaterThanOrEqual(3);
    for (const prompt of replied) {
      expect(prompt).toContain('Their reply is not included here, so you do not know what it said');
      expect(prompt).toContain('Do not quote, summarize, or guess at what they said');
      expect(prompt).not.toMatch(/check their email for context|Reference their response/);
    }
  });

  it('asks for the email only: no notes, disclaimers, alternatives or placeholders', () => {
    for (const prompt of [...prompts('replied'), ...prompts('no_response')]) {
      expect(prompt).toContain('Output only the email itself: no notes, explanations, disclaimers, alternative versions, or any text before or after it');
      expect(prompt).toContain('No placeholders or bracketed text to fill in');
    }
  });
});

describe('the comparison fails a follow-up draft that is not just the email', () => {
  // Drafts Sonnet 4.5 and 5.5 wrote for the "replied" case in the comparison
  // run of 2026-10-20 (Actions run 39467017652), shortened.
  const SEEN = {
    'sonnet-4.5 placeholder': 'Hi Dev,\n\nThanks for getting back to me.\n\n[Reference to their specific response - since I don\'t have their actual reply, you\'ll need to insert a sentence here.]\n\nBest,\n[Your name]',
    'sonnet-5.5 trailing note': 'Hi Dev,\n\nThanks for getting back to me.\n\nWould sometime next week work?\n\nBest regards,\n\n---\n\nNote: I didn\'t have access to Dev\'s actual reply, so the second paragraph is framed as a clarifying question.',
    'sonnet-5.5 declines': 'I can\'t write this email yet, because the context doesn\'t include Dev\'s reply.\n\n**Version with placeholders:**\n\nHi Dev,\n\nThanks for getting back to me.',
  };

  it.each(Object.entries(SEEN))('%s fails', (_, draft) => {
    expect(CHECKS.followup(draft).ok).toBe(false);
  });

  it('a plain email passes', () => {
    const draft = 'Hi Dev,\n\nThanks for getting back to me, I appreciate it.\n\nIf it would help, I can walk you through how other co-ops set reorder quantities. Would a 15-minute call next week work?\n\nBest,';
    expect(CHECKS.followup(draft)).toEqual({ ok: true, note: '' });
  });
});

describe('a failed reply keeps its reason where the endpoint already reports', () => {
  const REASONS = {
    truncated: 'claude_truncated:max_tokens',
    refusal: 'claude_refusal:cyber',
    malformed: 'claude_malformed',
    empty: 'claude_empty:end_turn',
  };
  // Endpoints that write a usage row when the call fails.
  const LOGGED = ['mission-sequence', 'icp-initial', 'icp-followup', 'icp-example-company', 'icp-summary', 'context', 'sequence-step', 'engagement-message'];

  describe.each(Object.entries(REASONS))('%s reply', (reply, code) => {
    let runs;
    beforeAll(() => { runs = capture(`fail-${reply}`, { SONNET_COMPARE_REPLY: reply }); });
    const first = (site) => runs.find((c) => c.site === site);

    it.each(LOGGED)('%s logs an error row with the reason', (site) => {
      const { response, usage } = first(site);
      expect(response.statusCode).toBe(500);
      expect(usage).toEqual([expect.objectContaining({ status: 'error', errorCode: code })]);
    });

    it('validate-contact still falls back to the top match, and records why', () => {
      const { response, usage } = first('validate-contact');
      expect(response.statusCode).toBe(200);
      expect(usage).toEqual([expect.objectContaining({ status: 'success', metadata: expect.objectContaining({ fallbackReason: code }) })]);
    });

    it('campaign-message still returns its fallback draft, and logs why', () => {
      const { response, problems } = first('campaign-message');
      expect(response.statusCode).toBe(200);
      expect(problems.join('\n')).toContain(code);
    });

    it('followup returns 500 and logs why', () => {
      const { response, problems } = first('followup');
      expect(response.statusCode).toBe(500);
      expect(problems.join('\n')).toContain(code);
    });

    it('the message users see is unchanged', () => {
      expect(JSON.parse(first('mission-sequence').response.body).error).toBe('Failed to generate valid mission sequence');
      expect(JSON.parse(first('context').response.body).error).toBe('Failed to generate valid context');
      expect(JSON.parse(first('sequence-step').response.body).error).toBe('Failed to generate step content');
      expect(JSON.parse(first('engagement-message').response.body).error).toBe('Message generation failed — please try again.');
    });
  });
});
