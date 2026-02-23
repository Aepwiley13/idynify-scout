import Anthropic from '@anthropic-ai/sdk';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { authToken, userId, company, icpProfile } = JSON.parse(event.body);

    if (!authToken || !userId || !company) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required parameters' }),
      };
    }

    // Verify Firebase Auth token
    const firebaseApiKey =
      process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Firebase API key not configured' }),
      };
    }

    const verifyResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: authToken }),
      }
    );

    if (!verifyResponse.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid auth token' }) };
    }

    const verifyData = await verifyResponse.json();
    if (verifyData.users?.[0]?.localId !== userId) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Token mismatch' }) };
    }

    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeApiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Claude API key not configured' }),
      };
    }

    const client = new Anthropic({ apiKey: claudeApiKey });

    // Build company context string
    const companyLines = [
      `Company: ${company.name || 'Unknown'}`,
      `Industry: ${company.industry || 'Unknown'}`,
      `Revenue: ${company.revenue || 'Unknown'}`,
      `Employee Count: ${company.employee_count || company.company_size || 'Unknown'}`,
      `Location: ${company.state || company.location || 'Unknown'}`,
      `Founded: ${company.founded_year || 'Unknown'}`,
      `ICP Fit Score: ${company.fit_score != null ? company.fit_score : 'Unknown'}/100`,
      `Status: ${company.status || 'Not reviewed'}`,
    ].join('\n');

    // Build ICP context string
    const icpLines = icpProfile
      ? [
          `Target Industries: ${(icpProfile.industries || []).join(', ') || 'Not specified'}`,
          `Target Locations: ${
            icpProfile.isNationwide
              ? 'Nationwide'
              : (icpProfile.locations || []).join(', ') || 'Not specified'
          }`,
          `Target Company Sizes: ${
            (icpProfile.companySizes || []).join(', ') || 'Not specified'
          }`,
          `Target Revenue Ranges: ${
            (icpProfile.revenueRanges || []).join(', ') || 'Not specified'
          }`,
        ].join('\n')
      : 'ICP profile not available';

    const prompt = `You are an elite sales intelligence analyst. Here is a target company and the rep's ICP:

TARGET COMPANY:
${companyLines}

REP'S ICP:
${icpLines}

Write a 3-5 sentence briefing explaining why this company is or isn't a strong target right now, what's happening at the company that's relevant to the rep's ICP, and one specific angle the rep could use to open a conversation. Be specific. Be confident. No fluff. Tone: classified intelligence briefing. Flowing prose only — no bullet points.`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const briefing = message.content[0]?.text || 'Analysis unavailable.';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ briefing }),
    };
  } catch (error) {
    console.error('Barry dossier briefing error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to generate briefing', message: error.message }),
    };
  }
};
