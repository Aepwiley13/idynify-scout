#!/usr/bin/env node

/**
 * SCOUT GAME — BLOCKER 1 TEST HARNESS (Direct HTTP version)
 * Calls Claude API directly via fetch, compatible with proxy environments.
 */

const TEST_CASES = [
  {
    id: 1,
    name: 'Auto-constructed intent (full fields)',
    intentType: 'System-built',
    userIntent: 'Initial cold outreach to VP of Sales at Acme Corp in SaaS industry — goal is to schedule an introductory meeting to discuss their sales pipeline challenges',
    engagementIntent: 'prospect',
    contact: {
      firstName: 'Sarah', lastName: 'Chen', name: 'Sarah Chen',
      title: 'VP of Sales', company_name: 'Acme Corp', company_industry: 'SaaS',
      seniority: 'executive', email: 'sarah@acme.com', linkedin_url: 'linkedin.com/in/sarah-chen'
    },
    expectedQuality: 'Comparable to manual'
  },
  {
    id: 2,
    name: 'Auto-constructed intent (minimal fields)',
    intentType: 'System-built (degraded)',
    userIntent: 'Cold outreach to schedule a meeting',
    engagementIntent: 'prospect',
    contact: {
      firstName: 'Sarah', lastName: 'Chen', name: 'Sarah Chen',
      title: 'VP of Sales', company_name: 'Acme Corp'
    },
    expectedQuality: 'Acceptable'
  },
  {
    id: 3,
    name: 'User-written intent (baseline)',
    intentType: 'Manual free-form',
    userIntent: "I want to reach out to Sarah and see if she's open to a quick chat about how we help SaaS sales teams close deals faster. Keep it casual.",
    engagementIntent: 'prospect',
    contact: {
      firstName: 'Sarah', lastName: 'Chen', name: 'Sarah Chen',
      title: 'VP of Sales', company_name: 'Acme Corp', company_industry: 'SaaS',
      seniority: 'executive', email: 'sarah@acme.com', linkedin_url: 'linkedin.com/in/sarah-chen'
    },
    expectedQuality: 'Baseline'
  }
];

const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 2000;

function buildPrompt(tc) {
  const c = tc.contact;
  const firstName = c.firstName || 'there';
  const lastName = c.lastName || '';
  const fullName = `${firstName} ${lastName}`.trim();
  const title = c.title || '';
  const company = c.company_name || '';
  const industry = c.company_industry || '';
  const seniority = c.seniority || '';
  const toneGuidance = 'This is a NEW contact - be professional, establish credibility, spark curiosity without being pushy';

  return `You are Barry, an expert B2B engagement assistant. Your job is to help the user reach out to a contact with highly personalized, context-aware messages.

THE USER'S GOAL (THIS IS THE PRIMARY DRIVER):
"${tc.userIntent}"

CONTACT INFORMATION:
- Name: ${fullName}
- Title: ${title || 'Not specified'}
- Company: ${company || 'Not specified'}
- Industry: ${industry || 'Not specified'}
- Seniority: ${seniority || 'Not specified'}
- Email: ${c.email || 'Not available'}
- Phone: Not available
- LinkedIn: ${c.linkedin_url || 'Not available'}

RELATIONSHIP CONTEXT:
${toneGuidance}

USER'S COMPANY (if available):
Not specified

YOUR TASK:
Generate 3 DISTINCT message approaches that fulfill the user's goal. Each must be clearly different in strategy and tone.

CRITICAL REQUIREMENTS:
1. Messages must be SPECIFIC to this contact - reference their name, title, company, or industry
2. Messages must address the user's stated goal directly
3. Messages should feel human, not templated
4. Each approach should work for a different personality type
5. Include subject lines for email (max 50 characters)
6. Include brief reasoning explaining WHY this approach fits

OUTPUT FORMAT (respond ONLY with this JSON structure):
{
  "messages": [
    {
      "strategy": "direct",
      "label": "Direct & Short",
      "subject": "Subject line here (50 chars max)",
      "message": "The full message body here. Keep it concise but personalized.",
      "reasoning": "Why this approach works for ${firstName}: Brief explanation of the strategy."
    },
    {
      "strategy": "warm",
      "label": "Warm & Personal",
      "subject": "Subject line here",
      "message": "The full message body here. More relationship-focused.",
      "reasoning": "Why this approach works for ${firstName}: Brief explanation."
    },
    {
      "strategy": "value",
      "label": "Value-Led",
      "subject": "Subject line here",
      "message": "The full message body here. Lead with value/insight.",
      "reasoning": "Why this approach works for ${firstName}: Brief explanation."
    }
  ],
  "dataUsed": {
    "contact": true,
    "recon": false,
    "barryContext": false
  }
}

STYLE GUIDELINES:
- No buzzwords like "game-changer", "revolutionize", "synergy"
- No generic phrases like "I hope this email finds you well"
- Be conversational and genuine
- Match the relationship context (${tc.engagementIntent || 'prospect'})
- Keep messages between 3-6 sentences unless user specified otherwise

Generate the messages now. Respond ONLY with valid JSON.`;
}

function evaluateMessages(tc, result) {
  const scores = {
    contactSpecific: { pass: true, notes: [] },
    subjectQuality: { pass: true, notes: [] },
    strategyDiff: { pass: true, notes: [] },
    sendReady: { pass: true, notes: [] }
  };
  const c = tc.contact;
  const terms = [c.firstName?.toLowerCase(), c.company_name?.toLowerCase(), c.title?.toLowerCase()].filter(Boolean);

  for (const msg of result.messages) {
    const combined = ((msg.message || '') + ' ' + (msg.subject || '')).toLowerCase();
    const refs = terms.filter(t => combined.includes(t));
    if (refs.length < 2) {
      scores.contactSpecific.pass = false;
      scores.contactSpecific.notes.push(`[${msg.strategy}] Only ${refs.length}/3 refs: ${refs.join(', ') || 'none'}`);
    }
    const subject = (msg.subject || '').toLowerCase();
    const genericSubjects = ['quick question', 'touching base', 'hello', 'hi there', 'introduction', "let's connect", 'reaching out', 'following up'];
    if (genericSubjects.some(g => subject === g || subject.startsWith(g + ' '))) {
      scores.subjectQuality.pass = false;
      scores.subjectQuality.notes.push(`[${msg.strategy}] Generic subject: "${msg.subject}"`);
    }
    if ((msg.subject || '').length > 50) {
      scores.subjectQuality.notes.push(`[${msg.strategy}] Subject over 50 chars: ${(msg.subject || '').length}`);
    }
    const body = (msg.message || '').toLowerCase();
    for (const bw of ['game-changer', 'revolutionize', 'synergy', 'leverage', 'paradigm']) {
      if (body.includes(bw)) { scores.sendReady.pass = false; scores.sendReady.notes.push(`[${msg.strategy}] Buzzword: "${bw}"`); }
    }
    for (const gp of ['i hope this email finds you well', 'i hope this message finds you']) {
      if (body.includes(gp)) { scores.sendReady.pass = false; scores.sendReady.notes.push(`[${msg.strategy}] Generic phrase`); }
    }
  }
  if (result.messages.length === 3) {
    const strats = new Set(result.messages.map(m => m.strategy));
    if (strats.size < 3) { scores.strategyDiff.pass = false; scores.strategyDiff.notes.push(`Only ${strats.size} unique strategies`); }
    const bodies = result.messages.map(m => m.message);
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const wA = new Set(bodies[i].toLowerCase().split(/\s+/));
        const wB = new Set(bodies[j].toLowerCase().split(/\s+/));
        const inter = new Set([...wA].filter(x => wB.has(x)));
        const union = new Set([...wA, ...wB]);
        const sim = inter.size / union.size;
        if (sim > 0.6) { scores.strategyDiff.pass = false; scores.strategyDiff.notes.push(`Msgs ${i+1}&${j+1} too similar (${sim.toFixed(2)})`); }
      }
    }
  }
  return { scores, allPass: Object.values(scores).every(s => s.pass) };
}

async function callClaude(prompt) {
  const baseURL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  const apiKey = process.env.ANTHROPIC_API_KEY || 'not-needed';

  const resp = await fetch(`${baseURL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`API ${resp.status}: ${err.substring(0, 200)}`);
  }
  return await resp.json();
}

async function main() {
  console.log('='.repeat(80));
  console.log('SCOUT GAME — BLOCKER 1: AUTO-INTENT QUALITY TEST');
  console.log('Model:', MODEL);
  console.log('Date:', new Date().toISOString());
  console.log('='.repeat(80));

  const results = [];

  for (const tc of TEST_CASES) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`TEST CASE ${tc.id}: ${tc.name}`);
    console.log(`Intent type: ${tc.intentType}`);
    console.log(`Intent: "${tc.userIntent}"`);
    console.log('─'.repeat(80));

    const prompt = buildPrompt(tc);
    const start = Date.now();

    try {
      const response = await callClaude(prompt);
      const responseTime = Date.now() - start;
      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');
      const result = JSON.parse(jsonMatch[0]);
      if (!result.messages || result.messages.length < 3) throw new Error('Fewer than 3 messages');

      console.log(`\n  Response time: ${responseTime}ms`);
      console.log(`  Messages returned: ${result.messages.length}`);
      for (const msg of result.messages) {
        console.log(`\n  --- ${msg.label} (${msg.strategy}) ---`);
        console.log(`  Subject: ${msg.subject}`);
        console.log(`  Message: ${msg.message}`);
        console.log(`  Reasoning: ${msg.reasoning}`);
      }
      const ev = evaluateMessages(tc, result);
      console.log(`\n  EVALUATION:`);
      for (const [key, label] of [['contactSpecific','Contact-specific'],['subjectQuality','Subject quality'],['strategyDiff','Strategy diff'],['sendReady','Send-ready']]) {
        console.log(`  [${ev.scores[key].pass ? 'PASS' : 'FAIL'}] ${label}`);
        ev.scores[key].notes.forEach(n => console.log(`         ${n}`));
      }
      console.log(`\n  OVERALL: ${ev.allPass ? 'PASS' : 'FAIL'}`);
      results.push({ id: tc.id, name: tc.name, intentType: tc.intentType, expectedQuality: tc.expectedQuality, responseTime, allPass: ev.allPass, scores: ev.scores, messages: result.messages });
    } catch (error) {
      console.error(`\n  ERROR: ${error.message}`);
      results.push({ id: tc.id, name: tc.name, intentType: tc.intentType, expectedQuality: tc.expectedQuality, error: error.message, allPass: false });
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('SUMMARY — APPENDIX A TABLE');
  console.log('='.repeat(80));
  console.log('');
  console.log('| Test Case | Intent Type | Expected Quality | Actual Quality | Pass/Fail |');
  console.log('|-----------|-------------|-----------------|----------------|-----------|');
  for (const r of results) {
    const actual = r.error ? `ERROR` : (r.allPass ? 'All 4 criteria pass' : 'See notes');
    const verdict = r.error ? 'ERROR' : (r.allPass ? 'PASS' : 'FAIL');
    console.log(`| ${r.id}. ${r.name} | ${r.intentType} | ${r.expectedQuality} | ${actual} | ${verdict} |`);
  }

  const t1 = results.find(r => r.id === 1);
  const t3 = results.find(r => r.id === 3);
  console.log('');
  if (t1?.allPass && t3?.allPass) console.log('DECISION: Test 1 passes. C+D Hybrid CONFIRMED.');
  else if (t1 && !t1.allPass && !t1.error) console.log('DECISION: Test 1 borderline. Default to Option C.');
  else console.log('DECISION: Test 1 failed or errored. See details above.');

  const fs = await import('fs');
  const outPath = new URL('../docs/scout-game/test-case-results.json', import.meta.url).pathname;
  fs.writeFileSync(outPath, JSON.stringify({
    runDate: new Date().toISOString(), model: MODEL,
    results: results.map(r => ({
      id: r.id, name: r.name, intentType: r.intentType, expectedQuality: r.expectedQuality,
      responseTime: r.responseTime || null, allPass: r.allPass, error: r.error || null,
      criteria: r.scores ? { contactSpecific: r.scores.contactSpecific.pass, subjectQuality: r.scores.subjectQuality.pass, strategyDiff: r.scores.strategyDiff.pass, sendReady: r.scores.sendReady.pass } : null,
      messages: r.messages || null
    }))
  }, null, 2));
  console.log(`\nResults written to: ${outPath}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
