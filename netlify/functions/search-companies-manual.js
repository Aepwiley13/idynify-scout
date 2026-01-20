/**
 * Manual Company Search via Apollo API
 *
 * This function allows users to manually search for companies by name
 * and returns matching results for user confirmation before saving.
 *
 * Unlike search-companies.js (which uses ICP settings), this function
 * accepts a direct company name query from the user.
 *
 * Endpoint: /.netlify/functions/search-companies-manual
 * Method: POST
 * Auth: Requires valid Firebase auth token
 */

import { logApiUsage } from './utils/logApiUsage.js';
import { APOLLO_ENDPOINTS, getApolloHeaders } from './utils/apolloConstants.js';
import { logApolloError } from './utils/apolloErrorLogger.js';

export async function handler(event, context) {
  const startTime = Date.now();

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    const { companyName, authToken, userId } = JSON.parse(event.body);

    // Validate input
    if (!companyName || !companyName.trim()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Company name is required' })
      };
    }

    if (!authToken || !userId) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ success: false, error: 'Authentication required' })
      };
    }

    console.log('🔍 Manual company search for:', companyName);
    console.log('👤 User ID:', userId);

    // Verify Firebase Auth token
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
      throw new Error('Firebase API key not configured');
    }

    const verifyResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: authToken })
      }
    );

    if (!verifyResponse.ok) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ success: false, error: 'Invalid authentication token' })
      };
    }

    const verifyData = await verifyResponse.json();
    const tokenUserId = verifyData.users[0].localId;

    if (tokenUserId !== userId) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ success: false, error: 'Token does not match user ID' })
      };
    }

    console.log('✅ Auth token verified');

    // Build Apollo search query
    // CRITICAL: API key goes in HEADERS (via getApolloHeaders), NOT in body
    // CRITICAL: Use q_organization_keyword_tags, NOT q_organization_name
    const apolloQuery = {
      page: 1,
      per_page: 10,
      q_organization_keyword_tags: [companyName.trim().toLowerCase()],
      sort_by_field: 'organization_num_employees',
      sort_ascending: false
    };

    console.log('📊 Apollo query:', JSON.stringify(apolloQuery, null, 2));

    // Call Apollo API
    const apolloResponse = await fetch(APOLLO_ENDPOINTS.COMPANIES_SEARCH, {
      method: 'POST',
      headers: getApolloHeaders(),
      body: JSON.stringify(apolloQuery)
    });

    console.log('📡 Apollo API response status:', apolloResponse.status);

    if (!apolloResponse.ok) {
      const errorText = await logApolloError(apolloResponse, apolloQuery, 'search-companies-manual');

      let userMessage = 'Company search service is temporarily unavailable.';
      let statusCode = 500;

      if (apolloResponse.status === 422) {
        console.error('❌ VALIDATION ERROR: Invalid search parameters');
        userMessage = 'Invalid search parameters. The search query may contain unsupported characters.';
        statusCode = 400;
      } else if (apolloResponse.status === 429) {
        userMessage = 'Search rate limit exceeded. Please try again in a few minutes.';
        statusCode = 429;
      } else if (apolloResponse.status === 401 || apolloResponse.status === 403) {
        userMessage = 'Search service authentication error. Please contact support.';
        statusCode = 500;
      } else if (apolloResponse.status >= 500) {
        userMessage = 'External search service is experiencing issues. Please try again later.';
        statusCode = 503;
      }

      return {
        statusCode,
        headers,
        body: JSON.stringify({
          success: false,
          error: userMessage
        })
      };
    }

    const apolloData = await apolloResponse.json();
    const companies = apolloData.organizations || [];

    console.log(`✅ Found ${companies.length} matching companies`);

    // Transform companies to our format
    const transformedCompanies = companies.map(company => {
      const location = company.primary_location || company.headquarters_location || {};
      const locationStr = [
        location.city,
        location.state,
        location.country
      ].filter(Boolean).join(', ');

      let revenue = null;
      if (company.estimated_annual_revenue) {
        const revenueNum = parseFloat(company.estimated_annual_revenue);
        if (revenueNum >= 1e9) {
          revenue = `$${(revenueNum / 1e9).toFixed(1)}B`;
        } else if (revenueNum >= 1e6) {
          revenue = `$${(revenueNum / 1e6).toFixed(0)}M`;
        } else if (revenueNum >= 1e3) {
          revenue = `$${(revenueNum / 1e3).toFixed(0)}K`;
        }
      }

      return {
        apollo_organization_id: company.id,
        name: company.name,
        industry: company.industry || company.primary_industry || 'Unknown',
        employee_count: company.estimated_num_employees || 0,
        revenue: revenue,
        founded_year: company.founded_year || null,
        phone: company.phone || null,
        website_url: company.website_url || null,
        linkedin_url: company.linkedin_url || null,
        location: locationStr || 'Unknown',
        description: company.short_description || company.description || null,
        logo_url: company.logo_url || null,
        raw_revenue: company.estimated_annual_revenue || null,
        technology_names: company.technology_names || [],
        keywords: company.keywords || []
      };
    });

    // Log API usage
    await logApiUsage({
      userId,
      endpoint: 'search-companies-manual',
      requestType: 'apollo_company_search',
      apolloCreditsUsed: 1,
      timestamp: new Date().toISOString(),
      metadata: {
        companyName: companyName,
        resultsCount: companies.length
      }
    });

    const responseTime = Date.now() - startTime;
    console.log(`✅ Returning ${transformedCompanies.length} companies (${responseTime}ms)`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        companies: transformedCompanies,
        count: transformedCompanies.length,
        query: companyName
      })
    };

  } catch (error) {
    console.error('❌ Manual company search error:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to search companies'
      })
    };
  }
}
