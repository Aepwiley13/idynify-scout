/**
 * barryFirstTouch.js — Generate a First Touch message for Scout-to-Hunter engagement.
 *
 * Receives: userId, authToken, contactId, serviceProfileId ('default' or a real ID),
 *           optional userContext (300 char max).
 *
 * Reads in parallel: contact document, active ICP profile messaging,
 *   service profile (if not 'default'), and RECON sections 1, 2, 5.
 *
 * Returns: { subjectLine, openingParagraph, serviceUsed, signalsUsed }
 * max_tokens: 800. No streaming.
 */

import Anthropic from '@anthropic-ai/sdk';
import { db } from './firebase-admin.js';
import { logApiUsage } from './utils/logApiUsage.js';
import { compileReconForPrompt } from './utils/reconCompiler.js';

async function verifyAuthToken(authToken, userId) {
  const firebaseApiKey = process.env.FIREBASE_API_KEY;
  if (!firebaseApiKey) throw new Error('Firebase API key not configured');
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: authToken }),
    }
  );
  if (!res.ok) throw new Error('Invalid authentication token');
  const data = await res.json();
  if (!data.users || data.users[0].localId !== userId) throw new Error('Token/userId mismatch');
}

function extractJson(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function getSection(dashboardData, sectionId) {
  if (!dashboardData?.modules) return null;
  const recon = dashboardData.modules.find(m => m.id === 'recon');
  if (!recon?.sections) return null;
  const s = recon.sections.find(s => s.sectionId === sectionId);
  if (!s?.data || s.status !== 'completed') return null;
  return typeof s.data === 'object' ? s.data : null;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const startTime = Date.now();
  let userId;

  try {
    const body = JSON.parse(event.body);
    userId = body.userId;
    const authToken = body.authToken;
    const contactId = body.contactId;
    const serviceProfileId = body.serviceProfileId || 'default';
    const userContext = (body.userContext || '').slice(0, 300);

    if (!userId || !authToken || !contactId) {
      throw new Error('Missing required parameters: userId, authToken, contactId');
    }
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

    await verifyAuthToken(authToken, userId);

    const userRef = db.collection('users').doc(userId);

    // Parallel reads
    const reads = [
      userRef.collection('contacts').doc(contactId).get(),
      db.collection('dashboards').doc(userId).get(),
      userRef.collection('icpProfiles').where('isActive', '==', true).where('status', '==', 'active').limit(1).get(),
    ];
    if (serviceProfileId !== 'default') {
      reads.push(userRef.collection('serviceProfiles').doc(serviceProfileId).get());
    }

    const results = await Promise.all(reads);
    const [contactDoc, dashboardDoc, icpSnap, serviceProfileDoc] = results;

    if (!contactDoc.exists) throw new Error('Contact not found');

    const contact = contactDoc.data();
    const dashboardData = dashboardDoc.exists ? dashboardDoc.data() : null;
    const icpMessaging = icpSnap.empty ? null : (icpSnap.docs[0].data()?.messaging || null);
    const serviceProfile = serviceProfileDoc?.exists ? serviceProfileDoc.data() : null;

    // Extract key RECON sections (1=Business Foundation, 2=Product, 5=Pain Points)
    const s1 = getSection(dashboardData, 1);
    const s2 = getSection(dashboardData, 2);
    const s5 = getSection(dashboardData, 5);

    // Build contact context block
    const contactBlock = [
      `Name: ${contact.name || contact.first_name || 'Unknown'}`,
      contact.title ? `Title: ${contact.title}` : null,
      contact.company_name ? `Company: ${contact.company_name}` : null,
      contact.industry ? `Industry: ${contact.industry}` : null,
      contact.num_employees ? `Company size: ~${contact.num_employees} employees` : null,
      contact.location ? `Location: ${contact.location}` : null,
      contact.relationship_state && contact.relationship_state !== 'unaware'
        ? `Relationship: ${contact.relationship_state}`
        : null,
    ].filter(Boolean).join('\n');

    // Identify signals
    const signals = [];
    if (contact.num_employees && Number(contact.num_employees) < 10) signals.push('small team (<10 employees)');
    if (contact.job_start_date) {
      const daysSince = (Date.now() - new Date(contact.job_start_date).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince >= 0 && daysSince < 180) signals.push('recently started new role');
    }
    if (contact.headline?.toLowerCase().includes('growing') || contact.headline?.toLowerCase().includes('scaling')) {
      signals.push('scaling signals in headline');
    }

    // Build service profile block
    const serviceBlock = serviceProfile
      ? [
          `Service: ${serviceProfile.name || 'Unknown'}`,
          serviceProfile.description ? `What it does: ${serviceProfile.description}` : null,
          serviceProfile.painPoints?.length
            ? `Pain points it solves: ${serviceProfile.painPoints.join('; ')}`
            : null,
          serviceProfile.primaryBuyer ? `Best for: ${serviceProfile.primaryBuyer}` : null,
          serviceProfile.positioningNote ? `Positioning: ${serviceProfile.positioningNote}` : null,
        ].filter(Boolean).join('\n')
      : 'No specific service selected — use RECON context for positioning.';

    // ICP messaging block
    const messagingBlock = icpMessaging
      ? Object.entries(icpMessaging)
          .filter(([, v]) => v && typeof v === 'string')
          .map(([k, v]) => `${k}: ${v}`)
          .slice(0, 4)
          .join('\n')
      : null;

    // Business context from RECON
    const businessContext = [
      s1?.whatYouDo ? `What you do: ${s1.whatYouDo}` : null,
      s1?.problemSolved ? `Problem you solve: ${s1.problemSolved}` : null,
      s2?.uniqueValue || s2?.differentiator ? `Differentiator: ${s2?.uniqueValue || s2?.differentiator}` : null,
      s5?.primaryPain || s5?.mainPain ? `Buyer pain: ${s5?.primaryPain || s5?.mainPain}` : null,
    ].filter(Boolean).join('\n');

    const prompt = `You are Barry, an expert B2B sales intelligence AI. Generate a first-touch outreach message.

CONTACT:
${contactBlock}${signals.length > 0 ? `\nEngagement signals: ${signals.join(', ')}` : ''}

SERVICE BEING PITCHED:
${serviceBlock}

YOUR BUSINESS CONTEXT:
${businessContext || 'Not yet configured — use general positioning.'}

${messagingBlock ? `MESSAGING VOICE & POSITIONING:\n${messagingBlock}\n` : ''}
${userContext ? `PERSONAL CONTEXT FROM USER: "${userContext}"\n` : ''}
RULES:
1. Subject line: under 8 words, no clickbait, not a question unless it's sharp
2. Opening paragraph: under 100 words. Lead with a specific signal or observation about the contact. One clear angle. One CTA (soft ask — don't close on first touch).
3. Write as the user — first person. Reference at least one specific detail from the contact or company.
4. Don't name-drop the service directly unless the context makes it natural. Show relevance first.
5. Tone: confident and peer-to-peer. Not salesy. Like someone who has done their homework.

Return valid JSON only:
{
  "subjectLine": "Subject line here",
  "openingParagraph": "Opening paragraph here",
  "serviceUsed": "${serviceProfile?.name || 'general'}",
  "signalsUsed": ${JSON.stringify(signals)}
}`;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    let result = null;
    try {
      const response = await anthropic.messages.create(
        {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          messages: [{ role: 'user', content: prompt }],
        },
        { signal: controller.signal }
      );
      result = extractJson(response.content[0].text);
    } catch (aiErr) {
      if (controller.signal.aborted) console.warn('[barryFirstTouch] Timed out');
      else console.warn('[barryFirstTouch] AI call failed:', aiErr.message);
    } finally {
      clearTimeout(timeout);
    }

    if (!result?.subjectLine || !result?.openingParagraph) {
      throw new Error('AI did not produce a valid message draft');
    }

    await logApiUsage(userId, 'barryFirstTouch', 'success', {
      responseTime: Date.now() - startTime,
      metadata: { contactId, serviceProfileId, hasUserContext: !!userContext },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, ...result }),
    };

  } catch (error) {
    console.error('[barryFirstTouch] Error:', error.message);
    try {
      if (userId) {
        await logApiUsage(userId, 'barryFirstTouch', 'error', {
          responseTime: Date.now() - startTime,
          errorCode: error.message,
          metadata: {},
        });
      }
    } catch (_) {}
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
