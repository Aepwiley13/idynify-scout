import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './utils/logApiUsage.js';
import { db } from './firebase-admin.js';
import { compileReconForPrompt } from './utils/reconCompiler.js';
import { loadCompanyFactsForBarry, formatCompanyFactsBlock, resolveDisplayCompanyFields } from './utils/barryCompanyFacts.js';
import { MODEL_BARRY_SONNET, barrySonnetOptions } from './utils/models.js';
import { readClaudeText, claudeErrorCode } from './utils/claudeResponse.js';

/**
 * A minimal RECON-shaped messaging block built from JUST the deciding ICP's
 * own messaging — for when compileReconForPrompt has nothing to wrap it in
 * (see the call site: no dashboard document, or one with zero completed
 * RECON sections). Deliberately not added to reconCompiler.js itself: that
 * module is shared by other Barry endpoints this fix has no reason to touch.
 */
function formatIcpMessagingOnly(icpMessaging) {
  const entries = Object.entries(icpMessaging || {}).filter(([, v]) => typeof v === 'string' && v.trim());
  if (!entries.length) return '';
  const formatKey = (key) => key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
  const lines = entries.map(([key, value]) => `- ${formatKey(key)}: ${value}`);
  return `\nMESSAGING & VALUE PROPOSITION (the deciding ICP's own voice):\n${lines.join('\n')}\n`;
}

export const handler = async (event) => {
  const startTime = Date.now();

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, authToken, contact } = JSON.parse(event.body);

    if (!userId || !authToken || !contact) {
      throw new Error('Missing required parameters');
    }

    console.log('🐻 Barry generating context for:', contact.name);

    // Validate environment variables
    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeApiKey) {
      console.error('❌ ANTHROPIC_API_KEY not configured');
      throw new Error('Claude API key not configured');
    }

    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
      console.error('❌ FIREBASE_API_KEY not configured');
      throw new Error('Firebase API key not configured');
    }

    // Verify Firebase Auth token
    const verifyResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: authToken })
      }
    );

    if (!verifyResponse.ok) {
      throw new Error('Invalid authentication token');
    }

    const verifyData = await verifyResponse.json();
    const tokenUserId = verifyData.users[0].localId;

    if (tokenUserId !== userId) {
      throw new Error('Token does not match user ID');
    }

    console.log('✅ Auth token verified');

    // ─── Load verified company facts + the deciding ICP, if any ───
    // Reads the actual company document this contact belongs to — never the
    // client-supplied payload the frontend used to pass (always null in
    // practice, which is why this panel used to have nothing to ground on).
    let companyFacts = { facts: {}, icpId: null, companyFound: false };
    try {
      companyFacts = await loadCompanyFactsForBarry(db, userId, contact?.company_id);
    } catch (companyError) {
      console.warn('⚠️ Could not load company facts (non-fatal):', companyError.message);
    }
    const { facts: verifiedCompanyFacts, icpId, companyFound } = companyFacts;

    // ─── Fetch RECON training data + the deciding ICP's messaging ───
    let reconContext = '';
    try {
      const [dashboardDoc, icpDoc] = await Promise.all([
        db.collection('dashboards').doc(userId).get(),
        icpId ? db.collection('users').doc(userId).collection('icpProfiles').doc(icpId).get() : null,
      ]);
      // No icpId means no company, or a company decided with no explicit
      // surface ICP — proceed without ICP messaging rather than guess one.
      const icpMessaging = icpDoc?.exists ? (icpDoc.data()?.messaging || null) : null;
      if (dashboardDoc.exists) {
        reconContext = compileReconForPrompt(dashboardDoc.data(), icpMessaging);
      }
      // compileReconForPrompt requires at least one of the dashboard's OWN
      // RECON sections to be completed before it emits anything at all —
      // including icpMessaging, which has nothing to do with whether the
      // user separately finished RECON onboarding. Without this, a real
      // deciding ICP's voice was silently dropped whenever there was no
      // dashboard document (or one with nothing completed yet) to carry it.
      if (!reconContext && icpMessaging) {
        reconContext = formatIcpMessagingOnly(icpMessaging);
      }
      if (reconContext) {
        console.log('🧠 RECON training data loaded and compiled');
      }
    } catch (reconError) {
      // Non-fatal — Barry works without RECON, just less personalized
      console.warn('⚠️ Could not load RECON data (non-fatal):', reconError.message);
    }

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: claudeApiKey
    });

    // Prepare contact data for Barry
    //
    // Company/industry come from resolveDisplayCompanyFields, never a plain
    // `contact.company_name || verifiedCompanyFacts.industry` fallback chain:
    // once a real company record is found, ITS facts are authoritative for
    // every field it covers — present or "Unknown" — and must not be
    // quietly overridden by a stale or conflicting cached field on the
    // contact doc. The contact-level fields are consulted ONLY when no
    // company record exists at all (see the function's own doc comment).
    const displayCompany = resolveDisplayCompanyFields(verifiedCompanyFacts, companyFound, {
      name: contact.company_name, industry: contact.company_industry,
    });
    const contactSummary = {
      name: contact.name || 'Unknown',
      title: contact.title || 'Not specified',
      company: displayCompany.name || 'Unknown company',
      industry: displayCompany.industry || 'Not specified',
      seniority: contact.seniority || 'Not specified',
      department: contact.department || (contact.departments && contact.departments[0]) || 'Not specified',
      location: [contact.city, contact.state, contact.country].filter(Boolean).join(', ') || 'Not specified',
      linkedin: contact.linkedin_url ? 'Available' : 'Not available',
      tenure: contact.job_start_date || 'Unknown'
    };

    // Structured context fields (Step 3)
    // These are strategic classification fields — separate from engagementIntent.
    // relationship_type: How the user structurally classifies this contact for planning.
    // warmth_level: Current temperature of the relationship.
    // strategic_value: How important this contact is to current goals.
    const structuredContext = {
      relationship_type: contact.relationship_type || null,
      warmth_level: contact.warmth_level || null,
      strategic_value: contact.strategic_value || null,
      engagement_intent: contact.engagementIntent || null
    };

    // Company context block: rendered only when a real company record was
    // found — not merely when a company_id was given (a dangling id with no
    // document behind it has nothing to verify, and falls back to the plain
    // contact-level fields above instead, via resolveDisplayCompanyFields;
    // showing a block full of "Unknown" lines on top of that fallback would
    // contradict it). Once a record IS found, a field it doesn't verify is
    // stated as unknown here, never left out — an omitted field invites a
    // guess, an explicit "Unknown" instruction constrains one. See
    // loadCompanyFactsForBarry for the conflict rule.
    const companyFactsBlock = companyFound ? formatCompanyFactsBlock(verifiedCompanyFacts) : null;

    // Build the prompt for Barry — now with RECON context
    const prompt = `You are Barry, a contextual intelligence guide helping a user prepare for a first conversation with another person.

Your role is NOT sales enablement. Your role is human orientation through calm, grounded context.
${reconContext}
CONTACT INFORMATION:
Name: ${contactSummary.name}
Title: ${contactSummary.title}
Company: ${contactSummary.company}
Industry: ${contactSummary.industry}
Seniority: ${contactSummary.seniority}
Department: ${contactSummary.department}
Location: ${contactSummary.location}
LinkedIn: ${contactSummary.linkedin}
${structuredContext.relationship_type || structuredContext.warmth_level || structuredContext.strategic_value ? `
STRATEGIC CONTEXT (user-classified):
${structuredContext.relationship_type ? `Relationship Type: ${structuredContext.relationship_type} (Prospect = net new, Known = existing relationship, Partner = collaborator, Delegate = gatekeeper or proxy)` : ''}
${structuredContext.warmth_level ? `Warmth Level: ${structuredContext.warmth_level} (Cold = no prior interaction, Warm = some prior contact, Hot = active conversation)` : ''}
${structuredContext.strategic_value ? `Strategic Value: ${structuredContext.strategic_value} (Low / Medium / High — how important this contact is to the user's current goals)` : ''}
${structuredContext.engagement_intent ? `Engagement Intent: ${structuredContext.engagement_intent} (prospect / warm / customer / partner — relationship context for messaging)` : ''}

Use these classifications to calibrate tone, depth, and framing:
- Cold + Prospect → minimal assumptions, maximum curiosity, zero familiarity
- Warm + Known → reference shared context, be conversational
- Hot + High value → precision matters, be sharp and relevant
- Delegate → orient around the person they represent, not just them
If fields are missing, do not guess — work with what is available.
` : ''}
${companyFactsBlock ? `COMPANY CONTEXT (verified from the company record — treat any "Unknown" line as a hard constraint, not an invitation to infer):
${companyFactsBlock}
` : ''}

YOUR TASK:
Generate a contextual orientation layer to help the user feel calm, oriented, and confident before meeting this person.
${reconContext ? '\nBecause the user has provided RECON training data, you should subtly incorporate awareness of their business context, ideal customer profile, and competitive landscape into your analysis. This means your conversation starters and role analysis should be more relevant to what the user actually does and sells. However, maintain the calm, grounded tone — do not turn this into a sales pitch.' : ''}

CRITICAL GUARDRAILS (YOU MUST FOLLOW THESE):
- NEVER assume pain, urgency, or buying intent
- NEVER use sales language (pipeline, ROI, close, objection, etc.)
- NEVER reference the user's product or offering directly in conversation starters
- NEVER score, rank, or qualify this person
- NEVER overclaim certainty
- Use probabilistic language: "Often responsible for...", "Usually focused on...", "Commonly evaluated on..."
- When unsure, say less, not more
- Base company insights ONLY on observable public signals

REQUIRED OUTPUT FORMAT (JSON):
{
  "whoYoureMeeting": "One calm, factual sentence: '[Name] is [role] at [company], operating in [industry/context].' No interpretation. No hype.",

  "whatRoleCaresAbout": [
    "Bullet using probabilistic language (Often responsible for...)",
    "Bullet using probabilistic language (Usually focused on...)",
    "Bullet using probabilistic language (Commonly evaluated on...)"
  ],

  "whatCompanyFocusedOn": [
    "Based on public signals: [observable fact about company focus]",
    "Based on public signals: [observable fact about company direction]"
  ],

  "conversationStarters": [
    "Curiosity-based opening (no pitch, no product mention)",
    "Curiosity-based opening (no CTA)",
    "Curiosity-based opening (genuine curiosity only)"
  ],

  "calmReframe": "One grounding sentence to reduce pressure. Example tone: 'You don't need to impress here — curiosity is enough.'"${reconContext ? `,

  "reconInsight": "One sentence noting how this contact relates to the user's business context (if RECON data is available). Example: 'This person operates in a segment you've identified as a target market.' If no relevant connection, say null."` : ''}
}

TONE REQUIREMENTS:
- Quiet, not loud
- Orienting, not instructing
- Calm, not clever
- Reducing anxiety, not adding pressure

Generate the contextual layer now. Respond ONLY with valid JSON.`;

    // Call Claude API using SDK
    const claudeResponse = await anthropic.messages.create({
      model: MODEL_BARRY_SONNET,
      max_tokens: 1500,
      ...barrySonnetOptions('context'),
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    console.log('🐻 Barry context generated');

    // Parse Claude's response
    let barryContext;
    try {
      const responseText = readClaudeText(claudeResponse);

      // Extract JSON from response (in case Claude added any extra text)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        barryContext = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }

      // Validate structure
      if (!barryContext.whoYoureMeeting ||
          !barryContext.whatRoleCaresAbout ||
          !barryContext.whatCompanyFocusedOn ||
          !barryContext.conversationStarters ||
          !barryContext.calmReframe) {
        throw new Error('Invalid context structure');
      }

    } catch (parseError) {
      console.error('Error parsing Barry response:', parseError);
      throw new Error('Failed to generate valid context', { cause: parseError });
    }

    // Log API usage
    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'barryGenerateContext', 'success', {
      provider: 'anthropic',
      model: MODEL_BARRY_SONNET,
      usage: claudeResponse?.usage,
      responseTime,
      metadata: {
        contactName: contact.name,
        hasCompanyData: !!companyFactsBlock,
        hasReconData: !!reconContext
      }
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        barryContext: {
          ...barryContext,
          generatedAt: new Date().toISOString(),
          reconEnhanced: !!reconContext
        }
      })
    };

  } catch (error) {
    console.error('❌ Error in barryGenerateContext:', error);

    // Log failed API usage
    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(userId, 'barryGenerateContext', 'error', {
          provider: 'anthropic',
          model: MODEL_BARRY_SONNET,
          responseTime,
          errorCode: claudeErrorCode(error),
          metadata: {}
        });
      }
    } catch (logError) {
      console.error('Failed to log API error:', logError);
    }

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
