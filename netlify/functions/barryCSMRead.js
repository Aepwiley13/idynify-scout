/**
 * barryCSMRead — Barry's CSM health read for a customer contact.
 *
 * Generates a natural-language health assessment and recommendation
 * for a specific customer. Uses claude-sonnet-4-6 (not Haiku) for
 * deeper analysis as specified in the CSM module spec.
 *
 * Caching: result is written back to the contact record as:
 *   barry_csm_read:          string (the assessment)
 *   barry_csm_read_at:       ISO timestamp
 *   barry_csm_read_bucket:   health bucket at time of generation
 *
 * Regenerate only when health_bucket has changed since barry_csm_read_at.
 *
 * Request body:
 *   { userId, authToken, contact, healthResult, portfolioSummary }
 *
 * Response:
 *   { success, read, recommendation, cached }
 */

import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './utils/logApiUsage.js';
import { db } from './firebase-admin.js';

export const handler = async (event) => {
  const startTime = Date.now();

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { userId, authToken, contact, healthResult, portfolioSummary } = JSON.parse(event.body);

    if (!userId || !authToken || !contact) {
      throw new Error('Missing required parameters: userId, authToken, contact');
    }

    // Validate auth
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    const verifyResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: authToken }),
      }
    );

    if (!verifyResponse.ok) throw new Error('Invalid authentication token');
    const verifyData = await verifyResponse.json();
    if (verifyData.users[0].localId !== userId) throw new Error('Token does not match user ID');

    // ── Cache check ─────────────────────────────────────────
    const cachedRead = contact.barry_csm_read;
    const cachedBucket = contact.barry_csm_read_bucket;
    const currentBucket = healthResult?.bucket;

    if (cachedRead && cachedBucket && cachedBucket === currentBucket) {
      console.log('🐻 CSM read cache hit for:', contact.name);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true, read: cachedRead, cached: true }),
      };
    }

    // ── Build context ───────────────────────────────────────
    const name = contact.name || 'this customer';
    const firstName = contact.first_name || name.split(' ')[0];
    const company = contact.company_name || 'their company';
    const healthScore = healthResult?.score ?? 'unknown';
    const healthBucket = healthResult?.bucket || 'unknown';
    const healthLabel = healthResult?.label || 'Unknown';

    // Engagement data
    const engSummary = contact.engagement_summary || {};
    const lastContactAt = engSummary.last_contact_at;
    const daysSinceContact = lastContactAt
      ? Math.round((Date.now() - new Date(lastContactAt).getTime()) / (1000 * 60 * 60 * 24))
      : 'Never';
    const repliesReceived = engSummary.replies_received || 0;
    const messagesSent = engSummary.total_messages_sent || 0;
    const consecutiveNoReplies = engSummary.consecutive_no_replies || 0;
    const lastOutcome = engSummary.last_outcome || 'none';

    // Milestones
    const milestones = contact.milestones || [];
    const milestoneSummary = milestones.length > 0
      ? milestones.map(m => `${m.label}: ${m.completed ? '✓' : '✗'}`).join(', ')
      : 'No milestones configured';

    // Signals
    const signals = healthResult?.signals || {};
    const signalSummary = Object.entries(signals)
      .map(([k, v]) => `${k}: ${v}/100`)
      .join(', ');

    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeApiKey) throw new Error('Claude API key not configured');

    const anthropic = new Anthropic({ apiKey: claudeApiKey });

    const prompt = `You are Barry — the CSM (Customer Success Manager) AI advisor. Your job: write a health assessment and specific recommendation for a customer.

CUSTOMER:
Name: ${name} (${firstName})
Company: ${company}
Health Score: ${healthScore}/100 (${healthLabel})
Health Bucket: ${healthBucket}

ENGAGEMENT DATA:
Last contacted: ${daysSinceContact === 'Never' ? 'Never' : daysSinceContact + ' days ago'}
Messages sent: ${messagesSent}
Replies received: ${repliesReceived}
Consecutive no-replies: ${consecutiveNoReplies}
Last outcome: ${lastOutcome}

MILESTONES: ${milestoneSummary}

SIGNAL SCORES: ${signalSummary}

${portfolioSummary ? `PORTFOLIO CONTEXT: ${portfolioSummary}` : ''}

YOUR TASK: Write a 2-3 sentence health assessment followed by one specific, actionable recommendation.

FORMAT:
Line 1-2: Assessment (what Barry sees — situation + risk/opportunity)
Line 3: "→ " followed by ONE specific action (e.g. "→ Call ${firstName} this week to discuss the onboarding gap")

VOICE RULES:
- Direct, warm, strategic. You're a CSM coach, not a robot.
- Use ${firstName}'s name naturally.
- Be specific — reference actual data (days, milestones, reply rates).
- The recommendation must be a single concrete action, not vague advice.
- For at-risk: urgent but not panicked. For healthy: forward-looking, expansion-minded.
- Maximum 60 words total. Every word earns its place.

Respond with ONLY the assessment and recommendation. No labels, no headers.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });

    const fullRead = response.content[0].text.trim();

    // Split into assessment and recommendation
    const lines = fullRead.split('\n').filter(l => l.trim());
    const recommendation = lines.find(l => l.startsWith('→'))?.replace('→ ', '') || '';
    const assessment = lines.filter(l => !l.startsWith('→')).join(' ');

    // ── Write back to Firestore (fire-and-forget) ───────────
    if (contact.id) {
      db.collection('users').doc(userId).collection('contacts').doc(contact.id).update({
        barry_csm_read: fullRead,
        barry_csm_read_at: new Date().toISOString(),
        barry_csm_read_bucket: healthBucket,
      }).catch(err => console.warn('⚠️ Could not cache CSM read:', err.message));
    }

    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'barryCSMRead', 'success', {
      responseTime,
      metadata: { contactName: name, healthBucket, cached: false },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        read: fullRead,
        assessment,
        recommendation,
        cached: false,
      }),
    };

  } catch (error) {
    console.error('❌ barryCSMRead error:', error);

    const responseTime = Date.now() - startTime;
    try {
      const body = JSON.parse(event.body || '{}');
      await logApiUsage(body.userId || 'unknown', 'barryCSMRead', 'error', {
        responseTime,
        errorCode: error.message,
      });
    } catch (_) {}

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
