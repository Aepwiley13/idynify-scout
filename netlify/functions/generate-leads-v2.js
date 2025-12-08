exports.handler = async (event, context) => {
  console.log('🎯 Barry Enhanced Lead Generation V2 - Starting Mission');
  
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
    const { userId, scoutData, icpBrief } = JSON.parse(event.body);
    
    const apolloKey = process.env.APOLLO_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    
    if (!apolloKey || !anthropicKey) {
      throw new Error('API keys not configured');
    }

    console.log('📊 Scout Data:', {
      industries: scoutData.industries?.length,
      jobTitles: scoutData.jobTitles?.length,
      companySizes: scoutData.companySizes?.length,
      perfectFit: scoutData.perfectFitCompanies
    });

    // STEP 1: Barry analyzes ICP and creates search strategy
    console.log('🧠 Step 1: Barry is analyzing your ICP...');
    const searchStrategy = await createIntelligentSearchStrategy(scoutData, icpBrief, anthropicKey);
    console.log('✅ Strategy created:', searchStrategy.summary);

    // STEP 2: Discover companies (not people yet)
    console.log('🔍 Step 2: Discovering companies in your TAM...');
    const companiesData = await discoverCompanies(searchStrategy, scoutData, apolloKey);
    console.log(`✅ Found ${companiesData.organizations?.length || 0} companies`);

    if (!companiesData.organizations || companiesData.organizations.length === 0) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          leads: [],
          count: 0,
          message: 'No companies found matching your criteria. Try broadening your search parameters.',
          analytics: {
            totalCompaniesFound: 0,
            phase: 'company_discovery'
          }
        })
      };
    }

    // STEP 3: Barry scores companies with AI
    console.log('⚖️ Step 3: Scoring companies against your ICP...');
    const scoredCompanies = await scoreCompaniesWithAI(
      companiesData.organizations.slice(0, 50), // Score first 50
      scoutData,
      icpBrief,
      anthropicKey
    );
    console.log(`✅ ${scoredCompanies.length} companies qualified (score >= 60)`);

    if (scoredCompanies.length === 0) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          leads: [],
          count: 0,
          message: 'Found companies but none met the quality threshold. Barry is being selective!',
          analytics: {
            totalCompaniesFound: companiesData.organizations.length,
            companiesScored: 50,
            qualifiedCompanies: 0,
            phase: 'company_scoring'
          }
        })
      };
    }

    // STEP 4: Find decision-makers in top companies
    console.log('👥 Step 4: Finding decision-makers in top companies...');
    const topCompanies = scoredCompanies.slice(0, 15); // Top 15 companies
    const leads = await findDecisionMakers(topCompanies, scoutData, apolloKey);
    console.log(`✅ Found ${leads.length} decision-makers`);

    if (leads.length === 0) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          leads: [],
          count: 0,
          message: 'Found great companies but no decision-makers with your target titles.',
          analytics: {
            totalCompaniesFound: companiesData.organizations.length,
            qualifiedCompanies: topCompanies.length,
            leadsFound: 0,
            phase: 'decision_maker_discovery'
          }
        })
      };
    }

    // STEP 5: Enrich leads with additional data
    console.log('🔬 Step 5: Enriching lead profiles...');
    const enrichedLeads = await enrichLeadsWithData(leads, apolloKey);
    console.log(`✅ Enriched ${enrichedLeads.length} leads`);

    // STEP 6: Final scoring with your existing scoring function
    console.log('🎯 Step 6: Final lead scoring...');
    const finalLeads = enrichedLeads.map(lead => {
      const { score, breakdown, matchDetails } = calculateLeadScore(lead, scoutData, icpBrief);
      return {
        id: lead.id || Math.random().toString(36),
        name: lead.name || 'Unknown',
        title: lead.title || 'Unknown',
        company: lead.organization?.name || 'Unknown',
        industry: lead.organization?.industry || 'Unknown',
        employees: lead.organization?.estimated_num_employees || 0,
        location: `${lead.city || ''}${lead.city && lead.state ? ', ' : ''}${lead.state || ''}`.trim() || 'Unknown',
        email: lead.email || null,
        linkedin: lead.linkedin_url || null,
        phone: lead.phone_numbers?.[0]?.sanitized_number || null,
        photoUrl: lead.photo_url || null,
        website: lead.organization?.website_url || null,
        score: score,
        scoreBreakdown: breakdown,
        matchDetails: matchDetails,
        companyScore: lead.companyScore || 0,
        companyReason: lead.companyReason || '',
        companyGrowth: lead.companyGrowth || calculateGrowthSignal(lead.organization),
        createdAt: new Date().toISOString()
      };
    });

    // Filter and sort
    const qualifiedLeads = finalLeads.filter(lead => lead.score >= 60);
    qualifiedLeads.sort((a, b) => b.score - a.score);
    const top10Leads = qualifiedLeads.slice(0, 10);

    console.log(`🎉 Mission complete! Returning ${top10Leads.length} top-quality leads`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        leads: top10Leads,
        count: top10Leads.length,
        analytics: {
          totalCompaniesFound: companiesData.organizations.length,
          companiesScored: scoredCompanies.length,
          qualifiedCompanies: topCompanies.length,
          leadsFound: leads.length,
          finalLeads: top10Leads.length,
          searchStrategy: searchStrategy.summary,
          avgScore: Math.round(top10Leads.reduce((acc, l) => acc + l.score, 0) / top10Leads.length)
        },
        message: `Barry analyzed ${companiesData.organizations.length} companies and found ${top10Leads.length} perfect-fit leads for you!`,
        generatedAt: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('💥 Barry encountered an error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: error.message || 'Unknown error occurred',
        errorType: error.name || 'Error',
        leads: [],
        count: 0,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};

// Helper Functions

async function createIntelligentSearchStrategy(scoutData, icpBrief, anthropicKey) {
  const prompt = `You are Barry, an expert AI SDR. Analyze this ICP and create a smart search strategy.

BUSINESS INFO:
Goal: ${scoutData.goal}
Industries: ${scoutData.industries?.join(', ')}
Perfect Fit Companies: ${scoutData.perfectFitCompanies || 'None provided'}
Avoid List: ${scoutData.avoidList || 'None'}
Pain Points: ${scoutData.painPoints}

ICP BRIEF:
${icpBrief ? JSON.stringify(icpBrief.firmographics || {}, null, 2) : 'Not available'}

Create a search strategy. Return ONLY valid JSON (no markdown):
{
  "primaryIndustryKeywords": ["keyword1", "keyword2"],
  "companySignals": ["signal1", "signal2"],
  "avoidSignals": ["avoid1", "avoid2"],
  "summary": "brief explanation of strategy"
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await response.json();
  const text = data.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  
  if (!jsonMatch) {
    // Fallback strategy
    return {
      primaryIndustryKeywords: scoutData.industries || [],
      companySignals: [],
      avoidSignals: scoutData.avoidList?.split(',').map(s => s.trim()) || [],
      summary: "Using direct industry and size targeting"
    };
  }
  
  return JSON.parse(jsonMatch[0]);
}

async function discoverCompanies(strategy, scoutData, apolloKey) {
  const searchPayload = {
    page: 1,
    per_page: 100,
    organization_locations: buildLocationArray(scoutData)
  };

  // Add industry keywords
  if (strategy.primaryIndustryKeywords?.length > 0) {
    searchPayload.q_organization_keyword_tags = strategy.primaryIndustryKeywords.slice(0, 3);
  }

  // Add company sizes
  if (scoutData.companySizes?.length > 0) {
    const sizes = [];
    scoutData.companySizes.forEach(range => {
      if (range.includes('1-10')) sizes.push('1-10');
      if (range.includes('11-50')) sizes.push('11-50');
      if (range.includes('51-200')) sizes.push('51-200');
      if (range.includes('201-500')) sizes.push('201-500');
      if (range.includes('501-1000')) sizes.push('501-1000');
      if (range.includes('1000+')) sizes.push('1001-10000');
    });
    if (sizes.length > 0) {
      searchPayload.organization_num_employees_ranges = sizes;
    }
  }

  const response = await fetch('https://api.apollo.io/v1/organizations/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apolloKey
    },
    body: JSON.stringify(searchPayload)
  });

  return await response.json();
}

async function scoreCompaniesWithAI(companies, scoutData, icpBrief, anthropicKey) {
  // Process in smaller batches to avoid token limits
  const batchSize = 25;
  const allScoredCompanies = [];

  for (let i = 0; i < companies.length; i += batchSize) {
    const batch = companies.slice(i, i + batchSize);
    
    const prompt = `You are Barry, scoring companies against this ICP.

PERFECT FIT EXAMPLES: ${scoutData.perfectFitCompanies || 'Not provided'}
AVOID: ${scoutData.avoidList || 'None'}
TARGET INDUSTRIES: ${scoutData.industries?.join(', ')}

Score these companies (0-100). Only include companies scoring 60+:

${batch.map((c, idx) => `${idx + 1}. ${c.name} - ${c.industry || 'Unknown'} - ${c.estimated_num_employees || 0} employees`).join('\n')}

Return ONLY valid JSON array (no markdown):
[
  {"index": 1, "score": 85, "reason": "Perfect fit because..."},
  {"index": 3, "score": 72, "reason": "Good fit..."}
]

Skip companies below 60 score.`;

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
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const data = await response.json();
      const text = data.content[0].text;
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      
      if (jsonMatch) {
        const scores = JSON.parse(jsonMatch[0]);
        
        scores.forEach(scoreData => {
          const company = batch[scoreData.index - 1];
          if (company && scoreData.score >= 60) {
            allScoredCompanies.push({
              ...company,
              barryScore: scoreData.score,
              barryReason: scoreData.reason
            });
          }
        });
      }
    } catch (err) {
      console.error('Error scoring batch:', err);
      // Continue with next batch
    }
  }

  return allScoredCompanies.sort((a, b) => b.barryScore - a.barryScore);
}

async function findDecisionMakers(companies, scoutData, apolloKey) {
  const leads = [];
  
  // Process up to 15 companies
  for (const company of companies.slice(0, 15)) {
    try {
      const searchPayload = {
        page: 1,
        per_page: 3,
        organization_ids: [company.id],
        person_titles: scoutData.jobTitles?.slice(0, 5) || []
      };

      const response = await fetch('https://api.apollo.io/v1/mixed_people/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': apolloKey
        },
        body: JSON.stringify(searchPayload)
      });

      const data = await response.json();
      
      if (data.people && data.people.length > 0) {
        // Take best match from this company
        const person = data.people[0];
        leads.push({
          ...person,
          companyScore: company.barryScore,
          companyReason: company.barryReason
        });
      }
    } catch (err) {
      console.error(`Error finding decision makers for ${company.name}:`, err);
    }
  }
  
  return leads;
}

async function enrichLeadsWithData(leads, apolloKey) {
  // For now, return leads as-is
  // Apollo match API can be added here for additional enrichment
  return leads.map(lead => ({
    ...lead,
    companyGrowth: calculateGrowthSignal(lead.organization)
  }));
}

function calculateGrowthSignal(org) {
  if (!org) return 'Unknown';
  
  const signals = [];
  const currentYear = new Date().getFullYear();
  const companyAge = org.founded_year ? currentYear - org.founded_year : null;
  
  if (companyAge && companyAge < 5 && org.estimated_num_employees > 50) {
    signals.push('Fast-growing startup');
  }
  
  if (org.estimated_num_employees > 200 && companyAge && companyAge < 10) {
    signals.push('High-growth company');
  }
  
  if (org.technologies && org.technologies.length > 10) {
    signals.push('Tech-forward');
  }
  
  return signals.length > 0 ? signals.join(', ') : 'Established company';
}

function buildLocationArray(scoutData) {
  const locations = [];
  
  if (scoutData.locationScope?.includes('All US')) {
    return ['United States'];
  }
  
  if (scoutData.targetStates?.length > 0) {
    locations.push(...scoutData.targetStates.map(state => `${state}, United States`));
  }
  
  if (scoutData.targetCities?.length > 0) {
    locations.push(...scoutData.targetCities.map(city => {
      const cityName = city.replace(' Metro', '').replace(' Area', '').replace(' Bay', '');
      return cityName;
    }));
  }
  
  return locations.length > 0 ? locations : ['United States'];
}

// Keep your existing calculateLeadScore function
function calculateLeadScore(lead, scoutData, icpBrief) {
  let score = 0;
  const breakdown = {
    title: 0,
    industry: 0,
    size: 0,
    location: 0,
    notAvoid: 0,
    dataQuality: 0
  };
  const matchDetails = [];

  // Title matching
  const targetTitles = scoutData.jobTitles || [];
  const leadTitle = (lead.title || '').toLowerCase();
  
  for (const targetTitle of targetTitles) {
    const target = targetTitle.toLowerCase();
    if (leadTitle.includes(target) || target.includes(leadTitle)) {
      if (leadTitle === target) {
        breakdown.title = 25;
        matchDetails.push(`✓ Exact title match (${lead.title})`);
      } else {
        breakdown.title = 20;
        matchDetails.push(`✓ Close title match (${lead.title})`);
      }
      break;
    }
  }

  // Industry matching
  const targetIndustries = scoutData.industries || [];
  const leadIndustry = (lead.organization?.industry || '').toLowerCase();
  
  for (const targetIndustry of targetIndustries) {
    const target = targetIndustry.toLowerCase();
    if (leadIndustry.includes(target) || target.includes(leadIndustry)) {
      breakdown.industry = 20;
      matchDetails.push(`✓ Industry match (${lead.organization?.industry})`);
      break;
    }
  }

  // Size matching
  const leadEmployees = lead.organization?.estimated_num_employees || 0;
  const targetSizes = scoutData.companySizes || [];
  
  for (const sizeRange of targetSizes) {
    const match = sizeRange.match(/(\d+)-(\d+)/);
    if (match) {
      const min = parseInt(match[1]);
      const max = parseInt(match[2]);
      if (leadEmployees >= min && leadEmployees <= max) {
        breakdown.size = 20;
        matchDetails.push(`✓ Ideal size (${leadEmployees} employees)`);
        break;
      }
    }
  }

  // Location matching
  if (scoutData.locationScope?.includes('All US')) {
    breakdown.location = 15;
    matchDetails.push(`✓ US location`);
  }

  // Not in avoid list
  const avoidList = (scoutData.avoidList || '').toLowerCase();
  const companyName = (lead.organization?.name || '').toLowerCase();
  
  if (!avoidList || !avoidList.split(',').some(avoid => companyName.includes(avoid.trim()))) {
    breakdown.notAvoid = 10;
  }

  // Data quality
  if (lead.email) breakdown.dataQuality += 5;
  if (lead.linkedin_url) breakdown.dataQuality += 3;
  if (lead.phone_numbers?.length) breakdown.dataQuality += 2;

  score = Object.values(breakdown).reduce((a, b) => a + b, 0);

  return { score, breakdown, matchDetails };
}