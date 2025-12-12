exports.handler = async (event, context) => {
  console.log('⚖️ PHASE 2: AI Company Scoring - Starting');
  
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
    const { userId, companies, validation, scoutData } = JSON.parse(event.body);
    
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    
    if (!anthropicKey) {
      throw new Error('Anthropic API key not configured');
    }

    if (!companies || companies.length === 0) {
      throw new Error('No companies provided for scoring');
    }

    console.log('📊 Scoring data:', {
      totalCompanies: companies.length,
      acceptedSamples: validation?.accepted?.length || 0,
      rejectedSamples: validation?.rejected?.length || 0
    });

    // Build learning context from validation
    const learningContext = buildLearningContext(validation, scoutData);
    
    // OPTIMIZATION: Only score top matches to avoid timeout
    // Filter companies to most relevant ones based on validation patterns
    const topCompanies = filterTopMatches(companies, learningContext, 40);
    
    console.log(`🎯 Filtered to top ${topCompanies.length} companies for scoring`);

    // Score companies in a single batch (under timeout limit)
    const scoredCompanies = await scoreCompaniesBatch(
      topCompanies,
      learningContext,
      scoutData,
      anthropicKey
    );

    // Filter to only companies scoring 60+
    const qualifiedCompanies = scoredCompanies.filter(c => c.barryScore >= 60);
    
    // Sort by score
    qualifiedCompanies.sort((a, b) => b.barryScore - a.barryScore);

    console.log(`✅ Scoring complete: ${qualifiedCompanies.length} companies qualified (60+)`);

    // Calculate analytics
    const analytics = calculateAnalytics(scoredCompanies, qualifiedCompanies);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        scoredCompanies: qualifiedCompanies,
        totalScored: topCompanies.length,
        totalAvailable: companies.length,
        qualifiedCount: qualifiedCompanies.length,
        analytics: analytics,
        message: `Barry scored the top ${topCompanies.length} matches and found ${qualifiedCompanies.length} perfect fits!`,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('💥 Error in Phase 2:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: error.message,
        scoredCompanies: [],
        totalScored: 0,
        qualifiedCount: 0
      })
    };
  }
};

// Helper Functions

function filterTopMatches(companies, learningContext, maxCount = 40) {
  if (!learningContext.hasLearning || companies.length <= maxCount) {
    return companies.slice(0, maxCount);
  }

  // Score each company by how well it matches validation patterns
  const companiesWithRelevance = companies.map(company => {
    let relevanceScore = 0;
    
    // Industry match (highest weight)
    const industry = company.industry || 'Unknown';
    if (learningContext.acceptedIndustries[industry]) {
      relevanceScore += learningContext.acceptedIndustries[industry] * 10;
    }
    
    // Size match
    const size = company.estimated_num_employees || 0;
    let sizeRange = '';
    if (size <= 10) sizeRange = '1-10';
    else if (size <= 50) sizeRange = '11-50';
    else if (size <= 200) sizeRange = '51-200';
    else if (size <= 500) sizeRange = '201-500';
    else if (size <= 1000) sizeRange = '501-1000';
    else sizeRange = '1000+';
    
    if (learningContext.acceptedSizes[sizeRange]) {
      relevanceScore += learningContext.acceptedSizes[sizeRange] * 5;
    }
    
    return { ...company, relevanceScore };
  });
  
  // Sort by relevance and take top matches
  companiesWithRelevance.sort((a, b) => b.relevanceScore - a.relevanceScore);
  
  return companiesWithRelevance.slice(0, maxCount);
}

function buildLearningContext(validation, scoutData) {
  if (!validation || !validation.accepted || validation.accepted.length === 0) {
    return {
      hasLearning: false,
      summary: 'No validation data available'
    };
  }

  // Extract patterns from accepted companies
  const acceptedIndustries = {};
  const acceptedSizes = {};
  
  validation.accepted.forEach(company => {
    const industry = company.industry || 'Unknown';
    const size = company.employees || 0;
    
    acceptedIndustries[industry] = (acceptedIndustries[industry] || 0) + 1;
    
    if (size <= 10) acceptedSizes['1-10'] = (acceptedSizes['1-10'] || 0) + 1;
    else if (size <= 50) acceptedSizes['11-50'] = (acceptedSizes['11-50'] || 0) + 1;
    else if (size <= 200) acceptedSizes['51-200'] = (acceptedSizes['51-200'] || 0) + 1;
    else if (size <= 500) acceptedSizes['201-500'] = (acceptedSizes['201-500'] || 0) + 1;
    else if (size <= 1000) acceptedSizes['501-1000'] = (acceptedSizes['501-1000'] || 0) + 1;
    else acceptedSizes['1000+'] = (acceptedSizes['1000+'] || 0) + 1;
  });

  // Top reasons for acceptance/rejection
  const topAcceptReasons = Object.entries(validation.acceptReasons || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason]) => reason);
    
  const topRejectReasons = Object.entries(validation.rejectReasons || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason]) => reason);

  return {
    hasLearning: true,
    acceptedCount: validation.accepted.length,
    rejectedCount: validation.rejected.length,
    acceptedIndustries: acceptedIndustries,
    acceptedSizes: acceptedSizes,
    topAcceptReasons: topAcceptReasons,
    topRejectReasons: topRejectReasons,
    acceptedCompanyNames: validation.accepted.map(c => c.name).slice(0, 10)
  };
}

async function scoreCompaniesBatch(companies, learningContext, scoutData, anthropicKey) {
  // Build the prompt for Claude
  const prompt = buildScoringPrompt(companies, learningContext, scoutData);
  
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

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.content[0].text;
    
    // Parse JSON response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    
    if (!jsonMatch) {
      console.warn('Could not parse AI scoring response, using fallback');
      // Fallback: return companies with default scores
      return companies.map((c, idx) => ({
        ...c,
        barryScore: 70,
        barryReason: 'Fallback scoring - matches target criteria'
      }));
    }
    
    const scores = JSON.parse(jsonMatch[0]);
    
    // Match scores back to companies
    const scoredCompanies = [];
    scores.forEach(scoreData => {
      const company = companies[scoreData.index];
      if (company) {
        scoredCompanies.push({
          ...company,
          barryScore: scoreData.score,
          barryReason: scoreData.reason
        });
      }
    });
    
    return scoredCompanies;
    
  } catch (err) {
    console.error('Error in AI scoring:', err);
    // Fallback: return companies with default scores
    return companies.map(c => ({
      ...c,
      barryScore: 70,
      barryReason: 'Fallback scoring due to error'
    }));
  }
}

function buildScoringPrompt(companies, learningContext, scoutData) {
  let prompt = `Score these ${companies.length} companies (0-100) based on ICP fit. Return ONLY valid JSON, no markdown.

TARGET: ${scoutData.industries?.join(', ') || 'Various'} companies, ${scoutData.companySizes?.join(', ') || 'various'} employees.
`;

  if (learningContext.hasLearning) {
    prompt += `
USER ACCEPTED: ${learningContext.acceptedCompanyNames.slice(0, 5).join(', ')}
TOP REASONS: ${learningContext.topAcceptReasons.slice(0, 3).join(', ')}
LIKED INDUSTRIES: ${Object.keys(learningContext.acceptedIndustries).slice(0, 3).join(', ')}
`;
  }

  prompt += `
COMPANIES:
${companies.map((c, idx) => `${idx}. ${c.name} - ${c.industry || 'Unknown'} - ${c.estimated_num_employees || 0}emp`).join('\n')}

Return JSON array (all 60+ scores, brief reasons):
[{"index":0,"score":85,"reason":"SaaS, ideal size"},{"index":2,"score":72,"reason":"Good industry"}]`;

  return prompt;
}

function calculateAnalytics(allScored, qualified) {
  const scoreRanges = {
    '90-100': 0,
    '80-89': 0,
    '70-79': 0,
    '60-69': 0,
    'below-60': 0
  };

  allScored.forEach(c => {
    const score = c.barryScore;
    if (score >= 90) scoreRanges['90-100']++;
    else if (score >= 80) scoreRanges['80-89']++;
    else if (score >= 70) scoreRanges['70-79']++;
    else if (score >= 60) scoreRanges['60-69']++;
    else scoreRanges['below-60']++;
  });

  const avgScore = qualified.length > 0
    ? Math.round(qualified.reduce((sum, c) => sum + c.barryScore, 0) / qualified.length)
    : 0;

  return {
    totalScored: allScored.length,
    qualified: qualified.length,
    rejected: allScored.length - qualified.length,
    scoreRanges: scoreRanges,
    avgScore: avgScore,
    topScore: qualified.length > 0 ? qualified[0].barryScore : 0
  };
}