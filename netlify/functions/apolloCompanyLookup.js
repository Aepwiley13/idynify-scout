// Module 6: Company Matching - Apollo Company Lookup Function
// Fetches companies from Apollo API based on ICP criteria

const axios = require('axios');

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { industries, sizes, keywords, domain, companyName } = JSON.parse(event.body);

    // Check for Apollo API key
    if (!process.env.APOLLO_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Apollo API key not configured' })
      };
    }

    // Build Apollo API query
    let apiUrl = 'https://api.apollo.io/v1/organizations/search';

    // Build request body for Apollo API
    const requestBody = {
      api_key: process.env.APOLLO_API_KEY,
      page: 1,
      per_page: 20
    };

    // Add filters based on input
    if (domain) {
      // Search by domain (for manual add)
      requestBody.organization_domains = [domain];
    } else if (companyName) {
      // Search by company name (for manual add)
      requestBody.q_organization_name = companyName;
    } else {
      // Search by ICP criteria
      if (industries && industries.length > 0) {
        requestBody.organization_industry_tag_ids = industries;
      }

      if (sizes && sizes.length > 0) {
        // Convert size ranges to Apollo's employee count format
        requestBody.organization_num_employees_ranges = sizes.map(size => {
          switch(size) {
            case '1-10': return '1,10';
            case '11-50': return '11,50';
            case '51-200': return '51,200';
            case '201-1000': return '201,1000';
            case '1000+': return '1001,MAX';
            default: return null;
          }
        }).filter(Boolean);
      }

      if (keywords && keywords.length > 0) {
        requestBody.q_keywords = keywords.join(' OR ');
      }
    }

    // Call Apollo API
    const response = await axios.post(apiUrl, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      timeout: 30000
    });

    // Parse response
    if (!response.data || !response.data.organizations) {
      return {
        statusCode: 200,
        body: JSON.stringify({ companies: [] })
      };
    }

    // Extract and format company data
    const companies = response.data.organizations.map(org => ({
      apollo_company_id: org.id,
      name: org.name || 'Unknown',
      industry: org.industry || 'Not specified',
      size: org.estimated_num_employees || 'Unknown',
      website: org.website_url || org.primary_domain || '',
      domain: org.primary_domain || '',
      description: org.short_description || '',
      location: org.city && org.state ? `${org.city}, ${org.state}` : org.country || ''
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        companies: companies.slice(0, 20), // Limit to 20 companies
        total: response.data.pagination?.total_entries || companies.length
      })
    };

  } catch (error) {
    console.error('Error calling Apollo API:', error);

    // Handle specific Apollo API errors
    if (error.response) {
      return {
        statusCode: error.response.status,
        body: JSON.stringify({
          error: 'Apollo API error',
          message: error.response.data?.message || error.message,
          details: error.response.data
        })
      };
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to fetch companies',
        message: error.message
      })
    };
  }
};
