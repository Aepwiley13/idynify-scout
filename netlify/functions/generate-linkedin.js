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

    const prompt = `Generate a personalized LinkedIn message for this lead:

Lead Info:
- Name: ${lead.name}
- Title: ${lead.title}
- Company: ${lead.company}

ICP Context:
- Industry: ${icpData.industry}
- Pain Points: ${icpData.painPoints}
- Value Proposition: ${icpData.valueProposition}

Create a SHORT LinkedIn connection request message (max 300 characters including spaces) that:
1. Is friendly and professional
2. Mentions a shared interest or pain point
3. Gives them a reason to accept

Keep it extremely brief - LinkedIn has character limits. Be warm but not salesy.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
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
    const messageContent = data.content[0].text;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        message: messageContent
      })
    };

  } catch (error) {
    console.error('Error generating LinkedIn message:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to generate LinkedIn message',
        message: error.message 
      })
    };
  }
};