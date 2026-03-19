/**
 * Barry Coaching Endpoint — evaluates a completed RECON section and returns
 * a Mirror, Inference block, and optional Output Preview that the section
 * editor displays after the user saves.
 *
 * POST /.netlify/functions/barry-coach-section
 */

import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './utils/logApiUsage.js';
import { db } from './firebase-admin.js';

// ─── Section metadata ─────────────────────────────────────────────────────────

const SECTION_LABELS = {
  1: 'Business Foundation',
  2: 'Product Deep Dive',
  3: 'Target Market Firmographics',
  4: 'Customer Psychographics',
  5: 'Pain Points & Motivations',
  6: 'Buying Behavior & Triggers',
  7: 'Decision Process',
  8: 'Competitive Landscape',
  9: 'Messaging & Value Proposition',
  10: 'Behavioral Signals',
};

const SECTION_WEIGHT_TIER = {
  1: 'high', 2: 'high', 3: 'high', 5: 'high',
  9: 'medium',
  4: 'low', 6: 'low', 7: 'low', 8: 'low', 10: 'low',
};

const CRITICAL_SECTIONS = [1, 2, 3, 5];

function getConfidenceImpact(quality, sectionId) {
  const tier = SECTION_WEIGHT_TIER[sectionId] || 'low';
  if (quality === 'strong') {
    if (tier === 'high')   return 10;
    if (tier === 'medium') return 5;
    return 2;
  }
  if (quality === 'weak') {
    if (tier === 'high')   return -15;
    if (tier === 'medium') return -10;
    return -5;
  }
  if (quality === 'incomplete') {
    return CRITICAL_SECTIONS.includes(sectionId) ? -25 : -10;
  }
  return 0;
}

// ─── Coaching prompt ──────────────────────────────────────────────────────────

function buildCoachingPrompt(sectionId, sectionLabel, sectionData) {
  const dataJson = JSON.stringify(sectionData, null, 2);

  return `You are Barry, an AI sales intelligence engine. A user has just saved their RECON training data for section ${sectionId} (${sectionLabel}). Your job is to evaluate the quality of this training data and return a structured coaching response.

SECTION DATA:
${dataJson}

QUALITY RUBRIC:
- "strong": ≥3 substantive responses; no empty or placeholder values; array fields have ≥2 specific items; free-text fields contain ≥20 words with concrete detail; responses are specific to this user's business, not generic
- "weak": Section is "completed" but responses are surface-level; <2 items in multi-selects; free-text fields are vague, generic, or <10 words; key fields filled with placeholders (e.g. "TBD", "software", "various")
- "incomplete": ≥1 required field is null, empty string, or empty array

RESPONSE FORMAT — respond with ONLY this JSON (no markdown, no prose):
{
  "quality": "strong" | "weak" | "incomplete",
  "headline": "one-sentence summary of what Barry received (no adjectives, plain declarative)",
  "mirror": "Barry paraphrases what was received. Plain declarative, no evaluation, no compliments. 1-3 sentences. Only includes what IS present.",
  "inference": "What Barry will now assume in downstream interactions. First-person operational statements ('I will...', 'I won\\'t...'). Number of statements: strong-high=3-4, strong-medium=2-3, strong-low=1-2, weak=1-2 with hedge naming what Barry cannot infer. incomplete-critical=null (use gap_warning instead).",
  "gap_warning": "Only present when quality=incomplete AND section is critical (1/2/3/5). Factual statement of what Barry cannot do + what to do about it. Null otherwise.",
  "output_preview": "Short excerpt showing what a live Barry output looks like with this section trained. Present only when quality=strong. Written in Barry's actual voice as if generating context for a real contact. 2-4 sentences. Null when quality≠strong.",
  "coach_version": "1.0"
}

RULES Barry never breaks:
- No compliments ("Great answer", "Perfect", "I love that")
- No scores or percentages in the text
- Mirror only paraphrases what IS present, never hallucinate specifics
- Inference uses "I" not "we"
- Gap Warning is one factual statement + one link instruction, not a lecture`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  const startTime = Date.now();

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let userId, sectionId, sectionData, authToken;

  try {
    ({ userId, authToken, sectionId, sectionData } = JSON.parse(event.body));
    if (!userId || !authToken || !sectionId || !sectionData) {
      throw new Error('Missing required parameters: userId, authToken, sectionId, sectionData');
    }
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: err.message }) };
  }

  try {
    // ── Auth verification ───────────────────────────────────────────────────
    const firebaseApiKey =
      process.env.FIREBASE_API_KEY;
    if (!firebaseApiKey) throw new Error('Firebase API key not configured');

    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: authToken }),
      }
    );
    if (!verifyRes.ok) throw new Error('Invalid authentication token');

    const verifyData = await verifyRes.json();
    if (verifyData.users[0].localId !== userId) {
      throw new Error('Token does not match userId');
    }

    // ── Claude call ─────────────────────────────────────────────────────────
    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeApiKey) throw new Error('Anthropic API key not configured');

    const sectionLabel = SECTION_LABELS[sectionId] || `Section ${sectionId}`;
    const prompt = buildCoachingPrompt(sectionId, sectionLabel, sectionData);

    const anthropic = new Anthropic({ apiKey: claudeApiKey });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });

    await logApiUsage(userId, 'barryCoachSection', 'success', {
      responseTime: Date.now() - startTime,
      metadata: { sectionId, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    });

    // ── Parse response ──────────────────────────────────────────────────────
    const raw = response.content[0].text.trim();
    let coaching;
    try {
      coaching = JSON.parse(raw);
    } catch {
      // Claude sometimes wraps JSON in ```json … ``` — strip it
      const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) coaching = JSON.parse(match[1].trim());
      else throw new Error('Failed to parse coaching JSON from Claude response');
    }

    const confidenceImpact = getConfidenceImpact(coaching.quality, sectionId);
    coaching.confidenceImpact = confidenceImpact;

    // ── Write quality + coaching headline back to Firestore section ─────────
    // This lets computeReconHealth() read quality per section for weighted score.
    const dashRef = db.collection('dashboards').doc(userId);
    const dashSnap = await dashRef.get();

    if (dashSnap.exists) {
      const data = dashSnap.data();
      const modules = data.modules || [];
      const reconIdx = modules.findIndex((m) => m.id === 'recon');

      if (reconIdx !== -1) {
        const sections = [...(modules[reconIdx].sections || [])];
        const sIdx = sections.findIndex((s) => s.sectionId === sectionId);

        if (sIdx !== -1) {
          sections[sIdx] = {
            ...sections[sIdx],
            quality: coaching.quality,
            coachingHeadline: coaching.headline,
            lastCoachedAt: new Date().toISOString(),
          };
          modules[reconIdx] = { ...modules[reconIdx], sections };
          await dashRef.update({ modules });
        }
      }

      // ── ICP snapshot for Section 3 ─────────────────────────────────────
      if (sectionId === 3 && coaching.quality !== 'incomplete') {
        const icpSnap = await db
          .collection('users')
          .doc(userId)
          .collection('companyProfile')
          .doc('current')
          .get();

        if (icpSnap.exists) {
          const icp = icpSnap.data();
          await dashRef.update({
            'reconHealth.icpSnapshotAtLastReconSave': {
              industries: icp.industries || [],
              companySizes: icp.companySizes || [],
              revenueRanges: icp.revenueRanges || [],
              locations: icp.locations || [],
              isNationwide: icp.isNationwide || false,
              savedAt: new Date().toISOString(),
            },
          });
        }
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, coaching }),
    };
  } catch (err) {
    console.error('[barry-coach-section] error:', err);
    await logApiUsage(userId || 'unknown', 'barryCoachSection', 'error', {
      responseTime: Date.now() - startTime,
      errorCode: err.message,
    }).catch(() => {});

    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
