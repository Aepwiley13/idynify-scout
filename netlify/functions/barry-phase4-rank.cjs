exports.handler = async (event, context) => {
  console.log('⭐ PHASE 4: AI Ranking - Starting');
  
  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  try {
    const { userId, contacts, scoutData } = JSON.parse(event.body);
    
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    
    if (!anthropicKey) {
      throw new Error('Anthropic API key not configured');
    }

    if (!contacts || contacts.length === 0) {
      throw new Error('No contacts provided for ranking');
    }

    console.log(`⭐ Ranking ${contacts.length} contacts with Barry AI`);

    // Use Barry to rank all contacts
    const rankedContacts = await rankContactsWithBarry(contacts, scoutData, anthropicKey);

    console.log(`✅ Barry ranked ${rankedContacts.length} contacts`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        rankedContacts: rankedContacts,
        totalRanked: rankedContacts.length,
        message: `Barry ranked ${rankedContacts.length} contacts by fit score`,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('💥 Error in Phase 4:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: error.message,
        rankedContacts: []
      })
    };
  }
};

async function rankContactsWithBarry(contacts, scoutData, anthropicKey) {
  // Build context for Barry
  const prompt = `You are Barry, an expert AI SDR. Rank these ${contacts.length} contacts from BEST (100) to WORST (1) based on their fit for outreach.

USER'S ICP:
- Target Industries: ${scoutData.industries?.join(', ') || 'Various'}
- Target Company Sizes: ${scoutData.companySizes?.join(', ') || 'Various'}
- Solution: B2B sales/lead generation tool

CONTACTS TO RANK:
${contacts.map((c, idx) => {
  const company = c.companyContext || c.organization || {};
  return `${idx}. ${c.name} - ${c.title} at ${company.name} (${company.size || '?'} employees)
   - Seniority: ${c.seniority || 'Unknown'}
   - Email: ${c.email ? 'Yes' : 'No'}
   - LinkedIn: ${c.linkedinUrl ? 'Yes' : 'No'}`;
}).join('\n\n')}

RANKING CRITERIA (weighted):
1. Decision-making power (30%)
   - Right seniority for company size
   - Budget authority likely
   
2. ICP fit (25%)
   - Company matches target industries
   - Company size in target range
   
3. Reachability (25%)
   - Has verified email
   - LinkedIn profile available
   - Active department (Sales, Marketing, Ops)
   
4. Likelihood to respond (20%)
   - Title indicates pain point awareness
   - Role benefits from solution
   - Not too senior (avoids C-suite gatekeepers at large companies)

SCORING:
- 90-100: Perfect fit, high-value target
- 80-89: Excellent prospect
- 70-79: Good prospect
- 60-69: Decent prospect
- Below 60: Lower priority

Return ONLY valid JSON array (no markdown):
[
  {
    "index": 0,
    "score": 95,
    "rank": 1,
    "reasoning": "Sales Manager at 200-person SaaS company - perfect decision maker level, has budget authority, verified email"
  },
  {
    "index": 5,
    "score": 88,
    "rank": 2,
    "reasoning": "VP Sales at 50-person startup - direct decision maker, high pain point, strong reachability"
  }
]

Rank ALL ${contacts.length} contacts. Be strategic and specific in reasoning.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192, // Increased for many contacts
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.content[0].text;
    
    console.log('Barry ranking response:', text.substring(0, 500));
    
    // Parse JSON response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    
    if (!jsonMatch) {
      console.warn('Could not parse Barry rankings, using fallback');
      // Fallback: simple scoring
      return contacts.map((contact, idx) => {
        const baseScore = 70;
        const emailBonus = contact.email ? 10 : 0;
        const linkedinBonus = contact.linkedinUrl ? 5 : 0;
        const seniorityBonus = contact.seniority === 'manager' ? 10 : 
                               contact.seniority === 'director' ? 8 : 5;
        
        return {
          ...contact,
          barryScore: baseScore + emailBonus + linkedinBonus + seniorityBonus,
          barryRank: idx + 1,
          barryReasoning: 'Ranked by basic scoring criteria'
        };
      }).sort((a, b) => b.barryScore - a.barryScore);
    }
    
    const rankings = JSON.parse(jsonMatch[0]);
    
    // Map rankings back to contacts with enriched data
    const rankedContacts = rankings.map(ranking => {
      const contact = contacts[ranking.index];
      if (!contact) {
        console.warn(`Contact at index ${ranking.index} not found`);
        return null;
      }
      
      return {
        ...contact,
        barryScore: ranking.score,
        barryRank: ranking.rank,
        barryReasoning: ranking.reasoning
      };
    }).filter(Boolean);
    
    // Sort by rank (just in case Barry didn't return in order)
    rankedContacts.sort((a, b) => a.barryRank - b.barryRank);
    
    return rankedContacts;
    
  } catch (err) {
    console.error('Error in Barry ranking:', err);
    
    // Fallback: simple scoring
    return contacts.map((contact, idx) => {
      const baseScore = 70;
      const emailBonus = contact.email ? 10 : 0;
      const linkedinBonus = contact.linkedinUrl ? 5 : 0;
      const seniorityBonus = contact.seniority === 'manager' ? 10 : 
                             contact.seniority === 'director' ? 8 : 5;
      
      return {
        ...contact,
        barryScore: baseScore + emailBonus + linkedinBonus + seniorityBonus,
        barryRank: idx + 1,
        barryReasoning: 'Ranked by basic criteria (Barry unavailable)'
      };
    }).sort((a, b) => b.barryScore - a.barryScore)
      .map((c, idx) => ({ ...c, barryRank: idx + 1 }));
  }
}
