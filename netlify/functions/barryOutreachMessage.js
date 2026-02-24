import Anthropic from '@anthropic-ai/sdk';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { authToken, userId, company, icpProfile, signals } = JSON.parse(event.body);

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

    // Build company context
    const companyLines = [
      `Company: ${company.name || 'Unknown'}`,
      `Industry: ${company.industry || 'Unknown'}`,
      `Revenue: ${company.revenue || 'Unknown'}`,
      `Size: ${company.employee_count || company.company_size || 'Unknown'}`,
      `Location: ${company.state || company.location || 'Unknown'}`,
      `ICP Fit Score: ${company.fit_score != null ? company.fit_score : 'Unknown'}/100`,
    ].join('\n');

    // Build ICP context
    const icpLines = icpProfile
      ? [
          `Target Industries: ${(icpProfile.industries || []).join(', ') || 'Not specified'}`,
          `Target Revenue: ${(icpProfile.revenueRanges || []).join(', ') || 'Not specified'}`,
          `Target Sizes: ${(icpProfile.companySizes || []).join(', ') || 'Not specified'}`,
        ].join('\n')
      : 'ICP profile not available';

    // Build signals context
    const signalLines =
      signals && signals.length > 0
        ? signals.map((s) => `- ${s.type || 'Signal'}: ${s.description || s.desc || ''}`).join('\n')
        : company.status === 'accepted'
        ? '- Manually qualified as a high-priority target'
        : 'No specific signals detected';

    const prompt = `You are Barry, an elite sales intelligence analyst and outreach specialist. Using the company profile, ICP match data, and buying signals provided, write a single personalized cold outreach message for a B2B sales rep.

TARGET COMPANY:
${companyLines}

REP'S ICP:
${icpLines}

BUYING SIGNALS:
${signalLines}

Requirements:
- 3-4 sentences maximum
- Lead with the most relevant signal or insight about this specific company
- Reference something specific about the company (industry, size, signals, or fit)
- End with a low-friction call to action (not "schedule a demo")
- Tone: confident, direct, human — not robotic or corporate
- Do NOT use generic openers like "I hope this finds you well" or "My name is..."
- Do NOT mention AI or that this message was generated
- Do NOT use bullet points or lists

Output the message only. No labels, no subject line, no preamble.`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const outreachMessage = message.content[0]?.text || '';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: outreachMessage }),
    };
  } catch (error) {
    console.error('Barry outreach message error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to generate message', message: error.message }),
    };
  }
};
