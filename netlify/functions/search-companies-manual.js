import { logApiUsage } from './utils/logApiUsage.js';
import { APOLLO_ENDPOINTS, getApolloApiKey, getApolloHeaders } from './utils/apolloConstants.js';
import { logApolloError } from './utils/apolloErrorLogger.js';

/**
 * Manual Company Search via Apollo API
 *
 * This function allows users to manually search for companies by name
 * and returns matching results for user confirmation before saving.
 *
 * Unlike search-companies.js (which uses ICP settings), this function
 * accepts a direct company name query from the user.
 */

export async function handler(event, context) {
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
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { companyName, authToken, userId } = JSON.parse(event.body);

    // Validate input
    if (!companyName || !companyName.trim()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Company name is required' })
      };
    }

    if (!authToken || !userId) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Authentication required' })
      };
    }

    console.log('🔍 Manual company search for:', companyName);
    console.log('👤 User ID:', userId);

    // Get Apollo API key
    const apolloApiKey = getApolloApiKey();

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
      throw new Error('Invalid authentication token');
    }

    const verifyData = await verifyResponse.json();
    const tokenUserId = verifyData.users[0].localId;

    if (tokenUserId !== userId) {
      throw new Error('Token does not match user ID');
    }

    console.log('✅ Auth token verified');

    // Build Apollo search query for company name
    const apolloQuery = {
      api_key: apolloApiKey,
      q_organization_name: companyName.trim(),
      page: 1,
      per_page: 10, // Return up to 10 matches for user selection
      organization_num_employees_ranges: [], // No employee filter
      organization_locations: [], // No location filter
      sort_by_field: 'organization_num_employees', // Sort by size (larger companies first)
      sort_ascending: false
    };

    console.log('📊 Apollo query:', JSON.stringify(apolloQuery, null, 2));

    // Call Apollo API
    const apolloResponse = await fetch(APOLLO_ENDPOINTS.COMPANIES_SEARCH, {
      method: 'POST',
      headers: getApolloHeaders(),
      body: JSON.stringify(apolloQuery)
    });

    if (!apolloResponse.ok) {
      const errorText = await logApolloError(apolloResponse, apolloQuery, 'search-companies-manual');
      throw new Error(`Apollo API request failed: ${apolloResponse.status}`);
    }

    const apolloData = await apolloResponse.json();
    const companies = apolloData.organizations || [];

    console.log(`✅ Found ${companies.length} matching companies from Apollo`);

    // Transform companies to our format (similar to search-companies.js)
    const transformedCompanies = companies.map(company => {
      // Extract and format location
      const location = company.primary_location || company.headquarters_location || {};
      const locationStr = [
        location.city,
        location.state,
        location.country
      ].filter(Boolean).join(', ');

      // Format revenue
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
        // Additional metadata for display
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
      apolloCreditsUsed: 1, // Apollo charges 1 credit per search
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
    console.error('❌ Manual company search error:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: error.message || 'Failed to search companies'
      })
    };
  }
}
