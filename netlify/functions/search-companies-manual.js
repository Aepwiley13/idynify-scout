/**
 * Search Companies Manual
 *
 * Simple company search function that takes a query string and returns
 * up to 10 matching companies from Apollo API.
 *
 * This is a lightweight version without the complex filtering, queuing,
 * and duplicate checking of the main search-companies function.
 *
 * Endpoint: /.netlify/functions/search-companies-manual
 * Method: POST
 * Auth: Requires valid Firebase auth token
 */

import { APOLLO_ENDPOINTS, getApolloHeaders } from './utils/apolloConstants.js';
import { logApolloError } from './utils/apolloErrorLogger.js';

export const handler = async (event) => {
  const startTime = Date.now();

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle OPTIONS request for CORS
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
    // Parse request body
    const { query: searchQuery, authToken } = JSON.parse(event.body || '{}');

    console.log('🔍 Manual company search request:', {
      query: searchQuery,
      hasAuthToken: !!authToken
    });

    // Validate inputs
    if (!searchQuery || typeof searchQuery !== 'string' || searchQuery.trim().length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Missing or invalid query parameter. Please provide a company name to search.'
        })
      };
    }

    if (!authToken) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Authentication required. Please provide authToken.'
        })
      };
    }

    // Build Apollo API request
    // IMPORTANT: Apollo expects keyword search, not exact name match
    const apolloQuery = {
      page: 1,
      per_page: 10,
      q_organization_keyword_tags: [searchQuery.trim().toLowerCase()]
    };

    console.log('📋 Apollo API request:', JSON.stringify(apolloQuery, null, 2));

    // Call Apollo API
    // NOTE: API key goes in HEADERS (X-Api-Key), NOT in body
    const apolloResponse = await fetch(APOLLO_ENDPOINTS.COMPANIES_SEARCH, {
      method: 'POST',
      headers: getApolloHeaders(), // Contains X-Api-Key header
      body: JSON.stringify(apolloQuery)
    });

    console.log('📡 Apollo API response status:', apolloResponse.status);

    // Handle API errors with detailed logging
    if (!apolloResponse.ok) {
      // Log detailed error for debugging
      const errorText = await logApolloError(apolloResponse, apolloQuery, 'search-companies-manual');

      // Return user-friendly error messages
      let userMessage = 'Company search service is temporarily unavailable.';
      let statusCode = 500;

      if (apolloResponse.status === 422) {
        console.error('❌ VALIDATION ERROR: Apollo rejected the request parameters');
        console.error('   Query sent:', apolloQuery);
        userMessage = 'Invalid search parameters. The search query may contain unsupported characters or format.';
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
          error: userMessage,
          details: process.env.NODE_ENV === 'development' ? {
            apolloStatus: apolloResponse.status,
            apolloError: errorText.substring(0, 200)
          } : undefined
        })
      };
    }

    // Parse response
    const apolloData = await apolloResponse.json();
    const companies = apolloData.organizations || [];

    console.log(`✅ Found ${companies.length} companies from Apollo`);

    // Transform companies to simplified format
    const results = companies.map(company => ({
      id: company.id,
      name: company.name,
      website: company.website_url || company.primary_domain,
      domain: company.primary_domain,
      industry: company.industry || company.primary_industry,
      employees: company.estimated_num_employees,
      location: {
        city: company.city,
        state: company.state,
        country: company.country
      },
      description: company.short_description || company.description,
      linkedinUrl: company.linkedin_url,
      logo: company.logo_url
    }));

    const responseTime = Date.now() - startTime;

    console.log(`✅ Returning ${results.length} companies (${responseTime}ms)`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        count: results.length,
        companies: results,
        query: searchQuery,
        responseTime: `${responseTime}ms`
      })
    };

  } catch (error) {
    console.error('💥 Error in search-companies-manual:', error);
    console.error('   Error message:', error.message);
    console.error('   Error stack:', error.stack);

    const responseTime = Date.now() - startTime;

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'An unexpected error occurred while searching for companies.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        responseTime: `${responseTime}ms`
      })
    };
  }
};
