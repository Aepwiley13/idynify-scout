#!/usr/bin/env node

/**
 * SCOUT GAME — BLOCKER 1 TEST HARNESS
 *
 * Runs the 3 test cases from BLOCKER-1-RESOLUTION.md against the live Claude API
 * using the EXACT prompt construction from generate-engagement-message.js (lines 249-335).
 *
 * This script bypasses Firebase auth/Firestore and injects test data directly.
 * The prompt, model, and parameters are identical to production.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/test-auto-intent.mjs
 *
 * Evaluation criteria (from BLOCKER-1-RESOLUTION.md):
 *   1. Are all 3 messages specific to the contact — name, title, company referenced?
 *   2. Do subject lines avoid generic templates?
 *   3. Is there meaningful differentiation between the 3 strategies?
 *   4. Would you be comfortable if a user sent this to a real prospect?
 */

import Anthropic from '@anthropic-ai/sdk';

// --- CONFIG ---
const MODEL = 'claude-sonnet-4-5-20250929'; // Same as production (line 340)
const MAX_TOKENS = 2000;                     // Same as production (line 341)

// --- TEST CASES (from BLOCKER-1-RESOLUTION.md) ---

const TEST_CASES = [
  {
    id: 1,
    name: 'Auto-constructed intent (full fields)',
    intentType: 'System-built',
    userIntent: 'Initial cold outreach to VP of Sales at Acme Corp in SaaS industry — goal is to schedule an introductory meeting to discuss their sales pipeline challenges',
    engagementIntent: 'prospect',
    contact: {
      firstName: 'Sarah',
      lastName: 'Chen',
      name: 'Sarah Chen',
      title: 'VP of Sales',
      company_name: 'Acme Corp',
      company_industry: 'SaaS',
      seniority: 'executive',
      email: 'sarah@acme.com',
      linkedin_url: 'linkedin.com/in/sarah-chen'
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
      firstName: 'Sarah',
      lastName: 'Chen',
      name: 'Sarah Chen',
      title: 'VP of Sales',
      company_name: 'Acme Corp'
    },
    expectedQuality: 'Acceptable'
  },
  {
    id: 3,
    name: 'User-written intent (baseline)',
    intentType: 'Manual free-form',
    userIntent: 'I want to reach out to Sarah and see if she\'s open to a quick chat about how we help SaaS sales teams close deals faster. Keep it casual.',
    engagementIntent: 'prospect',
    contact: {
      firstName: 'Sarah',
      lastName: 'Chen',
      name: 'Sarah Chen',
      title: 'VP of Sales',
      company_name: 'Acme Corp',
      company_industry: 'SaaS',
      seniority: 'executive',
      email: 'sarah@acme.com',
      linkedin_url: 'linkedin.com/in/sarah-chen'
    },
    expectedQuality: 'Baseline'
  }
];

// --- PROMPT BUILDER (exact replica of generate-engagement-message.js lines 171-335) ---

function buildPrompt(testCase) {
  const c = testCase.contact;
  const firstName = c.firstName || c.name?.split(' ')[0] || 'there';
  const lastName = c.lastName || '';
  const fullName = `${firstName} ${lastName}`.trim();
  const title = c.title || c.current_position_title || '';
  const company = c.company_name || c.current_company_name || '';
  const industry = c.company_industry || c.industry || '';
  const seniority = c.seniority || '';

  // No RECON data or barryContext in test — mirrors a net-new Scout Game contact
  const reconContext = '';
  const barryContextString = '';
  const reconLoaded = false;
  const existingBarryContext = null;

  const intentToneMap = {
    prospect: 'This is a NEW contact - be professional, establish credibility, spark curiosity without being pushy',
    warm: 'This is someone the user ALREADY KNOWS - be warm, reference shared context, conversational tone',
    customer: 'This is an EXISTING CUSTOMER - be helpful, service-oriented, assume rapport',
    partner: 'This is a BUSINESS PARTNER - be collaborative, peer-to-peer, mutual value focused'
  };
  const toneGuidance = intentToneMap[testCase.engagementIntent] || intentToneMap.prospect;

  // Exact prompt from lines 249-335
  return `You are Barry, an expert B2B engagement assistant. Your job is to help the user reach out to a contact with highly personalized, context-aware messages.

THE USER'S GOAL (THIS IS THE PRIMARY DRIVER):
"${testCase.userIntent}"

CONTACT INFORMATION:
- Name: ${fullName}
- Title: ${title || 'Not specified'}
- Company: ${company || 'Not specified'}
- Industry: ${industry || 'Not specified'}
- Seniority: ${seniority || 'Not specified'}
- Email: ${c.email || 'Not available'}
- Phone: ${c.phone || c.phone_mobile || 'Not available'}
- LinkedIn: ${c.linkedin_url || 'Not available'}

RELATIONSHIP CONTEXT:
${toneGuidance}
${barryContextString}
${reconContext}

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
    "recon": ${reconLoaded},
    "barryContext": ${!!existingBarryContext}
  }
}

STYLE GUIDELINES:
- No buzzwords like "game-changer", "revolutionize", "synergy"
- No generic phrases like "I hope this email finds you well"
- Be conversational and genuine
- Match the relationship context (${testCase.engagementIntent || 'prospect'})
- Keep messages between 3-6 sentences unless user specified otherwise

Generate the messages now. Respond ONLY with valid JSON.`;
}

// --- EVALUATOR ---

function evaluateMessages(testCase, result) {
  const scores = {
    contactSpecific: { pass: true, notes: [] },
    subjectQuality: { pass: true, notes: [] },
    strategyDiff: { pass: true, notes: [] },
    sendReady: { pass: true, notes: [] }
  };

  const c = testCase.contact;
  const contactTerms = [
    c.firstName?.toLowerCase(),
    c.company_name?.toLowerCase(),
    c.title?.toLowerCase()
  ].filter(Boolean);

  for (const msg of result.messages) {
    const body = (msg.message || '').toLowerCase();
    const subject = (msg.subject || '').toLowerCase();
    const combined = body + ' ' + subject;

    // Criterion 1: Contact-specific references
    const refsFound = contactTerms.filter(term => combined.includes(term));
    if (refsFound.length < 2) {
      scores.contactSpecific.pass = false;
      scores.contactSpecific.notes.push(
        `[${msg.strategy}] Only found ${refsFound.length}/3 contact refs: ${refsFound.join(', ') || 'none'}`
      );
    }

    // Criterion 2: Subject line quality
    const genericSubjects = [
      'quick question', 'touching base', 'hello', 'hi there',
      'introduction', 'let\'s connect', 'reaching out', 'following up'
    ];
    const isGeneric = genericSubjects.some(g => subject === g || subject.startsWith(g + ' '));
    if (isGeneric) {
      scores.subjectQuality.pass = false;
      scores.subjectQuality.notes.push(`[${msg.strategy}] Generic subject: "${msg.subject}"`);
    }
    if (subject.length > 50) {
      scores.subjectQuality.notes.push(`[${msg.strategy}] Subject over 50 chars: ${subject.length}`);
    }

    // Criterion 4: Send-ready quality
    const buzzwords = ['game-changer', 'revolutionize', 'synergy', 'leverage', 'paradigm'];
    const genericPhrases = ['i hope this email finds you well', 'i hope this message finds you'];
    for (const bw of buzzwords) {
      if (body.includes(bw)) {
        scores.sendReady.pass = false;
        scores.sendReady.notes.push(`[${msg.strategy}] Contains buzzword: "${bw}"`);
      }
    }
    for (const gp of genericPhrases) {
      if (body.includes(gp)) {
        scores.sendReady.pass = false;
        scores.sendReady.notes.push(`[${msg.strategy}] Contains generic phrase`);
      }
    }
  }

  // Criterion 3: Strategy differentiation
  if (result.messages.length === 3) {
    const strategies = result.messages.map(m => m.strategy);
    const uniqueStrategies = new Set(strategies);
    if (uniqueStrategies.size < 3) {
      scores.strategyDiff.pass = false;
      scores.strategyDiff.notes.push(`Only ${uniqueStrategies.size} unique strategies: ${[...uniqueStrategies].join(', ')}`);
    }

    // Check message bodies are meaningfully different
    const bodies = result.messages.map(m => m.message);
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const similarity = computeJaccard(bodies[i], bodies[j]);
        if (similarity > 0.6) {
          scores.strategyDiff.pass = false;
          scores.strategyDiff.notes.push(
            `Messages ${i + 1} and ${j + 1} too similar (Jaccard=${similarity.toFixed(2)})`
          );
        }
      }
    }
  }

  const allPass = Object.values(scores).every(s => s.pass);
  return { scores, allPass };
}

function computeJaccard(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.size / union.size;
}

// --- MAIN ---

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('\n ERROR: ANTHROPIC_API_KEY environment variable is required.');
    console.error(' Usage: ANTHROPIC_API_KEY=sk-ant-... node scripts/test-auto-intent.mjs\n');
    process.exit(1);
  }

  const anthropic = new Anthropic({ apiKey });

  console.log('='.repeat(80));
  console.log('SCOUT GAME — BLOCKER 1: AUTO-INTENT QUALITY TEST');
  console.log('Model:', MODEL);
  console.log('Date:', new Date().toISOString());
  console.log('='.repeat(80));

  const results = [];

  for (const testCase of TEST_CASES) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`TEST CASE ${testCase.id}: ${testCase.name}`);
    console.log(`Intent type: ${testCase.intentType}`);
    console.log(`Intent: "${testCase.userIntent}"`);
    console.log(`${'─'.repeat(80)}`);

    const prompt = buildPrompt(testCase);
    const startTime = Date.now();

    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }]
      });

      const responseTime = Date.now() - startTime;
      const responseText = response.content[0].text;

      // Parse JSON (same logic as production, line 351-354)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      const result = JSON.parse(jsonMatch[0]);

      if (!result.messages || result.messages.length < 3) {
        throw new Error('Invalid response structure — fewer than 3 messages');
      }

      console.log(`\n  Response time: ${responseTime}ms`);
      console.log(`  Messages returned: ${result.messages.length}`);

      // Display messages
      for (const msg of result.messages) {
        console.log(`\n  --- ${msg.label} (${msg.strategy}) ---`);
        console.log(`  Subject: ${msg.subject}`);
        console.log(`  Message: ${msg.message}`);
        console.log(`  Reasoning: ${msg.reasoning}`);
      }

      // Evaluate
      const evaluation = evaluateMessages(testCase, result);

      console.log(`\n  EVALUATION:`);
      console.log(`  [${evaluation.scores.contactSpecific.pass ? 'PASS' : 'FAIL'}] Criterion 1: Contact-specific references`);
      if (evaluation.scores.contactSpecific.notes.length > 0)
        evaluation.scores.contactSpecific.notes.forEach(n => console.log(`         ${n}`));

      console.log(`  [${evaluation.scores.subjectQuality.pass ? 'PASS' : 'FAIL'}] Criterion 2: Subject line quality`);
      if (evaluation.scores.subjectQuality.notes.length > 0)
        evaluation.scores.subjectQuality.notes.forEach(n => console.log(`         ${n}`));

      console.log(`  [${evaluation.scores.strategyDiff.pass ? 'PASS' : 'FAIL'}] Criterion 3: Strategy differentiation`);
      if (evaluation.scores.strategyDiff.notes.length > 0)
        evaluation.scores.strategyDiff.notes.forEach(n => console.log(`         ${n}`));

      console.log(`  [${evaluation.scores.sendReady.pass ? 'PASS' : 'FAIL'}] Criterion 4: Send-ready quality`);
      if (evaluation.scores.sendReady.notes.length > 0)
        evaluation.scores.sendReady.notes.forEach(n => console.log(`         ${n}`));

      console.log(`\n  OVERALL: ${evaluation.allPass ? 'PASS' : 'FAIL'}`);

      results.push({
        id: testCase.id,
        name: testCase.name,
        intentType: testCase.intentType,
        expectedQuality: testCase.expectedQuality,
        responseTime,
        allPass: evaluation.allPass,
        scores: evaluation.scores,
        messages: result.messages
      });

    } catch (error) {
      console.error(`\n  ERROR: ${error.message}`);
      results.push({
        id: testCase.id,
        name: testCase.name,
        intentType: testCase.intentType,
        expectedQuality: testCase.expectedQuality,
        error: error.message,
        allPass: false
      });
    }
  }

  // --- SUMMARY TABLE (for Appendix A) ---

  console.log(`\n${'='.repeat(80)}`);
  console.log('SUMMARY — APPENDIX A TABLE');
  console.log('='.repeat(80));
  console.log('');
  console.log('| Test Case | Intent Type | Expected Quality | Actual Quality | Pass/Fail |');
  console.log('|-----------|-------------|-----------------|----------------|-----------|');

  for (const r of results) {
    const actual = r.error ? `ERROR: ${r.error}` : (r.allPass ? 'All 4 criteria pass' : 'See notes');
    const verdict = r.error ? 'ERROR' : (r.allPass ? 'PASS' : 'FAIL');
    console.log(`| ${r.id}. ${r.name} | ${r.intentType} | ${r.expectedQuality} | ${actual} | ${verdict} |`);
  }

  console.log('');

  // --- DECISION ---

  const test1 = results.find(r => r.id === 1);
  const test3 = results.find(r => r.id === 3);

  if (test1?.allPass && test3?.allPass) {
    console.log('DECISION: Test 1 passes. C+D Hybrid CONFIRMED. Proceed to Gate 3.');
  } else if (test1 && !test1.allPass && !test1.error) {
    console.log('DECISION: Test 1 borderline. Default to Option C (auto-intent with one-tap override).');
  } else {
    console.log('DECISION: Test 1 failed or errored. TAG CTO IMMEDIATELY.');
  }

  console.log(`\nCompleted at: ${new Date().toISOString()}`);

  // --- JSON OUTPUT (for machine-readable archival) ---
  const outputPath = new URL('../docs/scout-game/test-case-results.json', import.meta.url).pathname;
  const fs = await import('fs');
  fs.writeFileSync(outputPath, JSON.stringify({
    runDate: new Date().toISOString(),
    model: MODEL,
    results: results.map(r => ({
      id: r.id,
      name: r.name,
      intentType: r.intentType,
      expectedQuality: r.expectedQuality,
      responseTime: r.responseTime || null,
      allPass: r.allPass,
      error: r.error || null,
      criteria: r.scores ? {
        contactSpecific: r.scores.contactSpecific.pass,
        subjectQuality: r.scores.subjectQuality.pass,
        strategyDiff: r.scores.strategyDiff.pass,
        sendReady: r.scores.sendReady.pass
      } : null,
      messages: r.messages || null
    }))
  }, null, 2));

  console.log(`\nResults written to: docs/scout-game/test-case-results.json`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
