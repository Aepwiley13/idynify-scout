// SIMPLE TEST VERSION - Use this to verify Netlify Functions are working
// Replace with full version once this works

exports.handler = async (event, context) => {
  console.log('🧪 TEST: Generate Leads function called');
  console.log('Method:', event.httpMethod);
  console.log('Body:', event.body);
  
  // Handle CORS preflight
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
    // Test 1: Can we parse the request?
    let requestData;
    try {
      requestData = JSON.parse(event.body);
      console.log('✅ Successfully parsed request body');
    } catch (e) {
      console.error('❌ Failed to parse body:', e.message);
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'Invalid JSON in request body',
          test: 'parsing',
          success: false
        })
      };
    }

    // Test 2: Do we have the required data?
    const { scoutData } = requestData;
    if (!scoutData) {
      console.error('❌ No scoutData in request');
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'scoutData is required',
          test: 'validation',
          success: false
        })
      };
    }
    console.log('✅ scoutData found');

    // Test 3: Do we have the API key?
    const apolloKey = process.env.APOLLO_API_KEY;
    if (!apolloKey) {
      console.error('❌ APOLLO_API_KEY not set');
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'APOLLO_API_KEY not configured in Netlify environment variables',
          test: 'environment',
          success: false,
          hint: 'Add APOLLO_API_KEY in Netlify dashboard under Site Settings > Environment Variables'
        })
      };
    }
    console.log('✅ APOLLO_API_KEY found');

    // Test 4: Can we call Apollo API?
    console.log('🔍 Testing Apollo API connection...');
    
    const testPayload = {
      page: 1,
      per_page: 1,  // Just get 1 lead for testing
      person_locations: ['United States']
    };

    const response = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apolloKey
      },
      body: JSON.stringify(testPayload)
    });

    console.log('Apollo response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Apollo API error:', errorText);
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: `Apollo API returned ${response.status}`,
          test: 'apollo_api',
          success: false,
          apolloError: errorText,
          hint: response.status === 401 ? 'Check if APOLLO_API_KEY is valid' : 'Apollo API issue'
        })
      };
    }

    const apolloData = await response.json();
    console.log('✅ Apollo API responded successfully');
    console.log('Got people:', apolloData.people?.length || 0);

    // ALL TESTS PASSED!
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        message: 'All tests passed! Function is working correctly.',
        tests: {
          parsing: 'PASSED ✅',
          validation: 'PASSED ✅',
          environment: 'PASSED ✅',
          apollo_api: 'PASSED ✅'
        },
        apolloTestResult: {
          peopleFound: apolloData.people?.length || 0,
          firstPerson: apolloData.people?.[0]?.name || 'N/A'
        },
        leads: [],  // Return empty for now
        count: 0,
        note: 'This is the test version. Replace with full version once verified.'
      })
    };

  } catch (error) {
    console.error('💥 Unexpected error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: error.message,
        errorType: error.name,
        test: 'general',
        success: false,
        stack: error.stack
      })
    };
  }
};