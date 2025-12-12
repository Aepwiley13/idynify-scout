// Module 9: Contact Suggestions - Apollo Contact Suggest Function
// Fetches contacts from Apollo and scores them using user weights

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
    const { apollo_company_id, user_weights, excludeIds = [] } = JSON.parse(event.body);

    // Validate input
    if (!apollo_company_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing apollo_company_id' })
      };
    }

    // Check for Apollo API key
    if (!process.env.APOLLO_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Apollo API key not configured' })
      };
    }

    // Default weights if not provided
    const weights = user_weights || {
      title_match_weight: 30,
      industry_match_weight: 20,
      company_size_weight: 10
    };

    // Call Apollo API to get contacts for this company
    const apiUrl = 'https://api.apollo.io/v1/mixed_people/search';

    const requestBody = {
      api_key: process.env.APOLLO_API_KEY,
      organization_ids: [apollo_company_id],
      page: 1,
      per_page: 50 // Get more than 10 to allow for scoring and filtering
    };

    const response = await axios.post(apiUrl, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      timeout: 30000
    });

    // Parse response
    if (!response.data || !response.data.people) {
      return {
        statusCode: 200,
        body: JSON.stringify({ contacts: [] })
      };
    }

    // Extract and score contacts
    const contacts = response.data.people
      .filter(person => !excludeIds.includes(person.id)) // Exclude previously shown
      .map(person => {
        // Simple scoring based on weights
        // In a real implementation, this would match against ICP criteria
        // For now, we'll use a simple scoring system
        let score = 0;

        // Title scoring (higher score for senior titles)
        const title = (person.title || '').toLowerCase();
        if (title.includes('ceo') || title.includes('founder') || title.includes('president')) {
          score += weights.title_match_weight * 1.5;
        } else if (title.includes('vp') || title.includes('vice president') || title.includes('chief')) {
          score += weights.title_match_weight * 1.2;
        } else if (title.includes('director') || title.includes('head')) {
          score += weights.title_match_weight * 1.0;
        } else if (title.includes('manager')) {
          score += weights.title_match_weight * 0.8;
        } else {
          score += weights.title_match_weight * 0.5;
        }

        // Add some randomness to make it more dynamic
        score += Math.random() * 10;

        return {
          apollo_person_id: person.id,
          name: person.name || 'Unknown',
          first_name: person.first_name || '',
          last_name: person.last_name || '',
          title: person.title || 'No title',
          email: person.email || '',
          phone: person.phone_numbers?.[0]?.sanitized_number || '',
          linkedin_url: person.linkedin_url || '',
          company_name: person.organization?.name || '',
          company_id: apollo_company_id,
          score: Math.round(score * 10) / 10 // Round to 1 decimal
        };
      })
      .sort((a, b) => b.score - a.score) // Sort by score descending
      .slice(0, 10); // Return top 10

    return {
      statusCode: 200,
      body: JSON.stringify({
        contacts: contacts,
        total: response.data.pagination?.total_entries || contacts.length
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
        error: 'Failed to fetch contacts',
        message: error.message
      })
    };
  }
};
