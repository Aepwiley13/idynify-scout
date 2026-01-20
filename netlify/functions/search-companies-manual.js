import { logApiUsage } from './utils/logApiUsage.js';
import { APOLLO_ENDPOINTS, getApolloHeaders } from './utils/apolloConstants.js';
import { logApolloError } from './utils/apolloErrorLogger.js';

/**
 * Manual Company Search via Apollo API
 * Searches for companies by name and returns up to 10 matches
 */

export async function handler(event, context) {
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
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    const { companyName, authToken, userId } = JSON.parse(event.body);

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

    console.log('🔍 Searching for:', companyName);

    // Verify Firebase Auth
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Server configuration error' })
      };
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

    // Build Apollo query - CORRECT FORMAT
    const apolloQuery = {
      page: 1,
      per_page: 10,
      q_organization_keyword_tags: [companyName.trim().toLowerCase()],
      sort_by_field: 'organization_num_employees',
      sort_ascending: false
    };

    // Call Apollo API - API key in HEADERS only
    const apolloResponse = await fetch(APOLLO_ENDPOINTS.COMPANIES_SEARCH, {
      method: 'POST',
      headers: getApolloHeaders(),
      body: JSON.stringify(apolloQuery)
    });

    if (!apolloResponse.ok) {
      await logApolloError(apolloResponse, apolloQuery, 'search-companies-manual');

      let userMessage = 'Company search service unavailable';
      let statusCode = 500;

      if (apolloResponse.status === 422) {
        userMessage = 'Invalid search parameters';
        statusCode = 400;
      } else if (apolloResponse.status === 429) {
        userMessage = 'Rate limit exceeded. Try again in a few minutes';
        statusCode = 429;
      } else if (apolloResponse.status === 401 || apolloResponse.status === 403) {
        userMessage = 'Search service authentication error';
        statusCode = 500;
      } else if (apolloResponse.status >= 500) {
        userMessage = 'Search service experiencing issues';
        statusCode = 503;
      }

      return {
        statusCode,
        headers,
        body: JSON.stringify({ success: false, error: userMessage })
      };
    }

    const apolloData = await apolloResponse.json();
    const companies = apolloData.organizations || [];

    console.log(`✅ Found ${companies.length} companies`);

    // Transform to frontend format
    const transformedCompanies = companies.map(company => {
      const location = company.primary_location || company.headquarters_location || {};
      const locationStr = [location.city, location.state, location.country]
        .filter(Boolean)
        .join(', ');

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
    console.error('❌ Search error:', error.message);

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
