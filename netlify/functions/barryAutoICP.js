import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './utils/logApiUsage.js';
import { APOLLO_ENDPOINTS, getApolloHeaders } from './utils/apolloConstants.js';

// --- Function signatures (implementations in Steps 2-6) ---

/**
 * Scrape website content via the crawl-website-content function.
 * @param {string} websiteUrl
 * @param {string} userId
 * @param {string} authToken
 * @returns {Promise<Object>} { companyName, domain, metaDescription, headings, bodyTextSample, customerLogos }
 */
async function scrapeWebsite(websiteUrl, userId, authToken) {
  const baseUrl = process.env.URL || 'http://localhost:8888';
  const response = await fetch(`${baseUrl}/.netlify/functions/crawl-website-content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, authToken, websiteUrl })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || 'Website scrape failed');
  }

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || 'Website scrape returned no content');
  }

  return data.content;
}

/**
 * Enrich a single seed company via Apollo Organizations Enrich.
 * @param {string} companyDomain - e.g. "acme.com"
 * @returns {Promise<Object|null>} Apollo org data or null on failure
 */
async function enrichSeedCompany(companyDomain) {
  if (!companyDomain) return null;

  const domain = companyDomain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

  try {
    const response = await fetch(APOLLO_ENDPOINTS.ORGANIZATIONS_ENRICH, {
      method: 'POST',
      headers: getApolloHeaders(),
      body: JSON.stringify({ domain })
    });

    if (!response.ok) return null;

    const data = await response.json();
    const org = data.organization;
    if (!org) return null;

    return {
      name: org.name,
      domain: org.primary_domain || domain,
      industry: org.industry,
      employeeCount: org.estimated_num_employees,
      revenue: org.annual_revenue_printed,
      location: org.city ? `${org.city}, ${org.state}` : org.state,
      state: org.state,
      keywords: (org.keywords || []).slice(0, 10),
      description: (org.short_description || '').slice(0, 500)
    };
  } catch {
    return null;
  }
}

/**
 * Send scraped + enriched data to Claude to extract structured ICP fields.
 * @param {Object} scrapedContent - Output from scrapeWebsite
 * @param {Object[]} enrichedSeeds - Array of Apollo org objects
 * @param {string} claudeApiKey
 * @returns {Promise<Object>} Extracted ICP fields
 */
async function extractICPWithClaude(scrapedContent, enrichedSeeds, claudeApiKey) {
  const anthropic = new Anthropic({ apiKey: claudeApiKey });

  const industryList = [
    "Accounting","Airlines/Aviation","Alternative Medicine","Animation",
    "Apparel & Fashion","Architecture & Planning","Automotive","Aviation & Aerospace",
    "Banking","Biotechnology","Building Materials","Business Supplies and Equipment",
    "Capital Markets","Chemicals","Civil Engineering","Commercial Real Estate",
    "Computer & Network Security","Computer Games","Computer Hardware","Computer Networking",
    "Computer Software","Construction","Consumer Electronics","Consumer Goods",
    "Consumer Services","Cosmetics","Defense & Space","Design","E-Learning",
    "Education Management","Electrical/Electronic Manufacturing","Entertainment",
    "Environmental Services","Events Services","Facilities Services","Farming",
    "Financial Services","Food & Beverages","Food Production","Furniture",
    "Government Administration","Graphic Design","Health, Wellness and Fitness",
    "Higher Education","Hospital & Health Care","Hospitality","Human Resources",
    "Import and Export","Industrial Automation","Information Services",
    "Information Technology and Services","Insurance","Internet","Investment Banking",
    "Investment Management","Law Practice","Legal Services","Leisure, Travel & Tourism",
    "Logistics and Supply Chain","Luxury Goods & Jewelry","Machinery",
    "Management Consulting","Maritime","Market Research","Marketing and Advertising",
    "Mechanical or Industrial Engineering","Media Production","Medical Devices",
    "Medical Practice","Mental Health Care","Mining & Metals","Music",
    "Non-Profit Organization Management","Oil & Energy","Online Media",
    "Outsourcing/Offshoring","Package/Freight Delivery","Packaging and Containers",
    "Performing Arts","Pharmaceuticals","Photography","Plastics",
    "Primary/Secondary Education","Printing","Professional Training & Coaching",
    "Public Relations and Communications","Publishing","Real Estate",
    "Recreational Facilities and Services","Renewables & Environment","Research",
    "Restaurants","Retail","Security and Investigations","Semiconductors",
    "Sporting Goods","Sports","Staffing and Recruiting","Supermarkets",
    "Telecommunications","Textiles","Transportation/Trucking/Railroad","Utilities",
    "Venture Capital & Private Equity","Veterinary","Warehousing","Wholesale",
    "Wine and Spirits","Wireless","Writing and Editing"
  ];

  const seedSummary = enrichedSeeds.map(s =>
    `- ${s.name}: ${s.industry || 'unknown industry'}, ${s.employeeCount || '?'} employees, ${s.state || '?'}, keywords: ${(s.keywords || []).join(', ')}`
  ).join('\n');

  const userPrompt = [
    'Analyze this company website content and seed customer data.',
    'Return a JSON object with the ICP fields listed below.',
    '',
    'WEBSITE CONTENT:',
    `Company: ${scrapedContent.companyName || 'Unknown'}`,
    `Description: ${scrapedContent.metaDescription || ''}`,
    `Headings: ${(scrapedContent.headings || []).slice(0, 10).join(' | ')}`,
    `Body excerpt: ${(scrapedContent.bodyTextSample || '').slice(0, 3000)}`,
    `Customer logos: ${(scrapedContent.customerLogos || []).join(', ')}`,
    '',
    'SEED COMPANIES:',
    seedSummary || '(none provided)',
    '',
    'VALID INDUSTRIES (pick ONLY from this list):',
    industryList.join(', '),
    '',
    'Return ONLY valid JSON with these fields:',
    '{',
    '  "industries": ["exact industry names from the list above, 1-3 picks"],',
    '  "companySizes": ["ranges like 11-20, 51-100, 201-500"],',
    '  "locations": ["US state names"] or "nationwide",',
    '  "targetTitles": ["job titles of likely buyers, 3-5"],',
    '  "companyKeywords": ["3-5 keywords describing ideal customers"],',
    '  "painPoints": ["2-3 problems the product solves"],',
    '  "valueProposition": "one sentence summary of what the company offers",',
    '  "confidence": 0-100',
    '}'
  ].join('\n');

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: userPrompt }],
    system: 'You are a B2B sales data analyst. Extract structured ICP data from website and seed company information. Return only valid JSON, no markdown.'
  });

  const text = message.content[0]?.text || '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude returned no valid JSON');

  return JSON.parse(jsonMatch[0]);
}

/**
 * Assemble the final draftICP object from Claude's extraction.
 * @param {Object} extracted - Claude's structured output
 * @param {Object} scrapedContent - Original scraped data
 * @param {Object[]} enrichedSeeds - Seed company data
 * @returns {Object} { draftICP, analysis }
 */
function assembleDraftICP(extracted, scrapedContent, enrichedSeeds) {
  const isNationwide = extracted.locations === 'nationwide' ||
    (Array.isArray(extracted.locations) && extracted.locations.length === 0);

  const locations = isNationwide ? [] : (extracted.locations || []);

  const lookalikeSeed = enrichedSeeds.length > 0 ? {
    name: enrichedSeeds[0].name,
    domain: enrichedSeeds[0].domain
  } : null;

  const draftICP = {
    industries: extracted.industries || [],
    companySizes: extracted.companySizes || [],
    revenueRanges: [],
    skipRevenue: true,
    locations,
    isNationwide,
    targetTitles: extracted.targetTitles || [],
    companyKeywords: extracted.companyKeywords || [],
    lookalikeSeed,
    searchStrategy: lookalikeSeed ? 'lookalike' : 'industry_only',
    painPoints: extracted.painPoints || [],
    valueProposition: extracted.valueProposition || '',
    foundedAgeRange: null,
    scoringWeights: { industry: 50, location: 25, employeeSize: 15, revenue: 10 },
    autoGenerated: true,
    sourceWebsite: scrapedContent.domain || '',
    seedCompanies: enrichedSeeds.map(s => ({ name: s.name, domain: s.domain })),
    managedByBarry: true,
    source: 'barry_auto_icp'
  };

  const analysis = {
    confidenceScore: extracted.confidence || 70,
    reasoning: buildReasoning(scrapedContent, enrichedSeeds, extracted)
  };

  return { draftICP, analysis };
}

function buildReasoning(scraped, seeds, extracted) {
  const parts = [];
  if (scraped.companyName) parts.push(`Analyzed ${scraped.companyName} website`);
  if (seeds.length > 0) parts.push(`enriched ${seeds.length} seed company${seeds.length > 1 ? 'ies' : 'y'}`);
  if ((extracted.industries || []).length > 0) parts.push(`identified ${extracted.industries.join(', ')} as target industries`);
  if ((extracted.targetTitles || []).length > 0) parts.push(`targeting ${extracted.targetTitles.slice(0, 3).join(', ')}`);
  return parts.join('. ') + '.';
}

// --- Main handler ---

export async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  try {
    const { userId, authToken, websiteUrl, seedCompanies } = JSON.parse(event.body);

    if (!userId || !authToken) {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Authentication required' }) };
    }

    if (!websiteUrl) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Website URL is required' }) };
    }

    // Auth verification
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    const verifyResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: authToken }) }
    );
    if (!verifyResponse.ok) {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Invalid token' }) };
    }
    const verifyData = await verifyResponse.json();
    if (verifyData.users[0].localId !== userId) {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Token mismatch' }) };
    }

    // Step 2: Scrape
    const scrapedContent = await scrapeWebsite(websiteUrl, userId, authToken);

    // Step 3: Enrich seeds
    const seeds = seedCompanies || [];
    const enrichedSeeds = (await Promise.all(
      seeds.map(s => enrichSeedCompany(typeof s === 'string' ? s : s.domain))
    )).filter(Boolean);

    // Step 4: Extract ICP via Claude
    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeApiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Claude API key not configured' }) };
    }
    const extracted = await extractICPWithClaude(scrapedContent, enrichedSeeds, claudeApiKey);

    // Step 5: Assemble
    const result = assembleDraftICP(extracted, scrapedContent, enrichedSeeds);

    await logApiUsage(userId, 'barryAutoICP', 'success', {
      metadata: { domain: scrapedContent.domain, seedCount: enrichedSeeds.length }
    }).catch(() => {});

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, ...result })
    };

  } catch (error) {
    console.error('barryAutoICP error:', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message || 'Auto-ICP generation failed' })
    };
  }
}
