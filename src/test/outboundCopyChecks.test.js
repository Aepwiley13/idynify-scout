// @vitest-environment node
/**
 * The comparison's outbound-copy check for Barry's four message writers (#699).
 *
 * Drafts from sequence-step, campaign-message, engagement-message and followup
 * are sent as written: nothing fills in a placeholder or checks a claim first.
 * The comparison fails a draft that contains anything below, so these cases
 * pin what it catches. Most failing drafts are quoted, shortened, from the
 * 330-call comparison (Actions run 39478139161, 2026-10-20).
 */
import { describe, it, expect } from 'vitest';
import { CHECKS, outboundCopyProblems, promptText } from '../../scripts/sonnet-compare/checks.mjs';
import { OUTBOUND_COPY_RULES } from '../../netlify/functions/utils/outboundCopyRules.js';

// The context the fixtures give: RECON pain and goal, a cold contact, no history.
const COLD_PROMPT = `CONTACT:
- Name: Maria Okafor
- Title: VP of Merchandising
- Company: Northfield Markets
Pain Points:
- Primary Pain: Fresh-food spoilage
- Cost of Pain: About 3% of fresh sales written off
- What Success Looks Like: Half the write-offs within two quarters

${OUTBOUND_COPY_RULES}`;

const CLEAN = 'Hi Maria,\n\nMost regional chains write off around 3% of fresh sales. Our goal with customers is to cut that in half within two quarters.\n\nWould you be open to a 15-minute call? Let me know what time suits you.\n\nBest,';

const fails = (draft, prompt = COLD_PROMPT) => outboundCopyProblems(draft, prompt);

describe('a clean draft passes', () => {
  it('the 3% figure and the 50% goal it was given, stated as a goal, ending "Best,"', () => {
    expect(fails(CLEAN)).toEqual([]);
  });

  it('a real Sonnet 5.5 follow-up from the comparison', () => {
    const draft = 'Hi Dev,\n\nThank you for taking the time to reply. I appreciate you sharing how things work at Prairie Fresh.\n\nWould you be open to a 20-minute call this week or next?\n\nBest,';
    expect(fails(draft, 'Outcome: replied\nOriginal Message:\nHi Dev, how does Prairie Fresh decide reorder quantities today?')).toEqual([]);
  });
});

describe('bracketed placeholders fail', () => {
  it.each(['[Your Name]', '[Your name]', '[Name]', '[Company]', '[calendar link]', '[date]', '[number]'])('%s', (placeholder) => {
    expect(fails(`Hi Maria,\n\nWould a call work? ${placeholder}\n\nBest,`)).toContain(`bracketed placeholder ${placeholder}`);
  });

  it('the sign-off Sonnet 5.5 left in 26 of 40 drafts', () => {
    expect(fails('Hi Maria,\n\nWould you be open to a 15-minute call next week?\n\nBest,\n[Your Name]').join()).toMatch(/bracketed placeholder \[Your Name\]/);
  });
});

describe('Barry as the sender fails', () => {
  it.each([
    'Hi Omar,\n\nI\'d like to offer Cedar Valley a free produce shrink benchmark.\n\nThanks,\nBarry',
    'Hi Omar,\n\nWould a 15-minute call be worth your time?\n\nBarry',
    'Hi Omar, I\'m Barry, and I help grocers cut spoilage.',
  ])('%#', (draft) => {
    expect(fails(draft)).toContain('signed or introduced as Barry');
  });

  it('a made-up sender name fails too: none of these endpoints is given one', () => {
    expect(fails('Hi Maria,\n\nWould a call work?\n\nBest,\nSam')).toContain('signs with a name it was not given');
  });
});

describe('invented meeting times and attachments fail', () => {
  const RESOURCE_SHARE = 'Attached is a one-page summary from a regional co-op about your size.\n\nCould we grab 30 minutes on video next week? I could do Tuesday at 10am or Thursday at 2pm Central.';

  it('the Sonnet 5.5 resource-share draft', () => {
    const problems = fails(RESOURCE_SHARE);
    expect(problems).toEqual(expect.arrayContaining([
      'invented date or time "Tuesday"', 'invented date or time "10am"', 'invented date or time "2pm"', 'mentions an attachment',
    ]));
  });

  it('a calendar date', () => {
    expect(fails('Are you free on October 23?')).toContain('invented date or time "October 23"');
  });

  it('a day or attachment the input supplied passes', () => {
    expect(fails('Following up on Tuesday\'s panel.', `${COLD_PROMPT}\nWe met at the panel on Tuesday`)).toEqual([]);
    expect(fails('Attached is the checklist.', `${COLD_PROMPT}\nAttach the checklist we handed out`)).toEqual([]);
  });

  it('the output rules naming attachments do not count as the input supplying one', () => {
    expect(OUTBOUND_COPY_RULES).toMatch(/attachments/);
    expect(promptText({ messages: [{ role: 'user', content: COLD_PROMPT }] })).not.toMatch(/attachments/);
  });
});

describe('a prior conversation the input does not show fails', () => {
  it.each([
    ['Following up on our earlier conversation about spoilage at Northfield Markets.', 'Following up on our earlier conversation'],
    ['Following up on where we left off.', 'where we left off'],
    ['Since we\'ve been in touch before, I wanted to follow up.', 'Since we\'ve been in touch'],
    ['Great speaking with you last week.', 'Great speaking'],
    ['As discussed, here is the summary.', 'As discussed'],
    ['You mentioned produce ordering is manual.', 'You mentioned'],
  ])('%s', (draft, quoted) => {
    expect(fails(draft)).toContain(`implies a prior conversation ("${quoted}")`);
  });

  it('passes when the input shows contact: a positive reply in the history, or a meeting in the user\'s goal', () => {
    expect(fails('Thanks for the call last week.', `${COLD_PROMPT}\n  Step 1: Results check-in call → contact replied positively`)).toEqual([]);
    expect(fails('Great meeting you at the produce panel.', `${COLD_PROMPT}\nFollow up on the trade show where we met briefly at the produce panel.`)).toEqual([]);
  });

  it('referring to your own earlier, unanswered note is not a conversation', () => {
    expect(fails('I sent a note last week about produce spoilage.')).toEqual([]);
  });
});

describe('unsupported numbers fail', () => {
  it.each([
    ['Their produce write-offs dropped 47% in 9 weeks.', ['unsupported number "47%"', 'unsupported number "9 weeks"']],
    ['We recently helped a similar-sized grocer reduce markdown waste by 23%.', ['unsupported number "23%"']],
    ['We work with 41 stores like yours.', ['unsupported number "41 stores"']],
    ['That is $40,000 a year in waste.', ['unsupported number "$40,000"']],
  ])('%s', (draft, expected) => {
    expect(fails(draft)).toEqual(expect.arrayContaining(expected));
  });

  it('numbers from the input pass', () => {
    expect(fails('Most chains write off around 3% of fresh sales across 62 stores.', `${COLD_PROMPT}\nRegional grocery chain with 62 stores`)).toEqual([]);
  });
});

describe('a goal stated as an achieved result fails', () => {
  it.each([
    'Our customers have cut that roughly in half within two quarters.',
    'One of our regional grocery customers cut fresh write-offs roughly in half within two quarters.',
    'Chains that fix this have cut write-offs in half within two quarters.',
    'We help chains cut those write-offs roughly in half within two quarters.',
  ])('%s', (draft) => {
    expect(fails(draft).join()).toMatch(/states a goal as an achieved result/);
  });

  it.each([
    'A realistic goal is cutting write-offs in half within two quarters.',
    'Our aim is to help you cut write-offs in half within two quarters.',
    "I'd like to help you cut it in half within two quarters.",
  ])('framed as a goal passes: %s', (draft) => {
    expect(fails(draft)).toEqual([]);
  });

  it('passes when the input says the result was achieved', () => {
    expect(fails('Our customers have cut write-offs in half within two quarters.', `${COLD_PROMPT}\nResults achieved: customers have cut write-offs in half`)).toEqual([]);
  });
});

describe('each message writer applies the check to what the user sends', () => {
  const request = { messages: [{ role: 'user', content: COLD_PROMPT }] };

  it('sequence-step: subject and body', () => {
    const ok = JSON.stringify({ subject: 'Fresh-food write-offs', body: CLEAN, channel: 'email' });
    expect(CHECKS['sequence-step'](ok, request)).toEqual({ ok: true, note: '' });
    const bad = JSON.stringify({ subject: 'Fresh-food write-offs', body: `${CLEAN}\n[Your name]`, channel: 'email' });
    expect(CHECKS['sequence-step'](bad, request).note).toMatch(/bracketed placeholder \[Your name\]/);
  });

  it('campaign-message: the subject and body after SUBJECT:/BODY:', () => {
    expect(CHECKS['campaign-message'](`SUBJECT: Fresh-food write-offs\nBODY:\n${CLEAN}`, request)).toEqual({ ok: true, note: '' });
    expect(CHECKS['campaign-message'](`SUBJECT: Fresh-food write-offs\nBODY:\nFollowing up on where we left off.\n\nBest,`, request).note)
      .toMatch(/implies a prior conversation/);
  });

  it('engagement-message: every one of the messages', () => {
    const messages = (last) => JSON.stringify({ messages: [{ subject: 'a', message: CLEAN }, { subject: 'b', message: CLEAN }, { subject: 'c', message: last }] });
    expect(CHECKS['engagement-message'](messages(CLEAN), request)).toEqual({ ok: true, note: '' });
    expect(CHECKS['engagement-message'](messages('Hi Omar,\n\nWorth a call?\n\nThanks,\nBarry'), request).note).toMatch(/signed or introduced as Barry/);
  });

  it('followup: the same rules', () => {
    expect(CHECKS.followup('Hi Maria,\n\nAre you free Thursday at 2pm?\n\nBest,', request).note).toMatch(/invented date or time/);
  });

  it('the handler-level failures still come first', () => {
    expect(CHECKS['sequence-step']('{"subject": "x"}', request).note).toBe('missing body');
    expect(CHECKS['engagement-message']('{"messages": []}', request).note).toBe('fewer than 3 messages');
  });
});
