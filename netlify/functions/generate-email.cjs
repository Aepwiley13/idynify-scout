export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { lead, icpData } = JSON.parse(event.body);
    
    if (!lead || !icpData) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Lead and ICP data are required' })
      };
    }

    const prompt = `Generate a personalized cold email for this lead:

Lead Info:
- Name: ${lead.name}
- Title: ${lead.title}
- Company: ${lead.company}

ICP Context:
- Industry: ${icpData.industry}
- Pain Points: ${icpData.painPoints}
- Value Proposition: ${icpData.valueProposition}

Create a short, personalized cold email (3-4 sentences max) that:
1. References their role/company
2. Mentions a specific pain point they likely face
3. Suggests how our solution helps
4. Includes a soft CTA

Keep it casual, concise, and conversational. Don't sound salesy.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Claude API error: ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    const emailContent = data.content[0].text;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        email: emailContent
      })
    };

  } catch (error) {
    console.error('Error generating email:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to generate email',
        message: error.message 
      })
    };
  }
};