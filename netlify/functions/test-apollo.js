export const handler = async (event, context) => {
  console.log('🧪 COMPREHENSIVE Apollo Test...');
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' };
  }

  try {
    const apiKey = process.env.APOLLO_API_KEY;
    console.log('🔑 API Key exists:', !!apiKey);

    const results = {};

    // TEST 1: NO FILTERS AT ALL
    console.log('\n🧪 TEST 1: No filters at all...');
    const t1 = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ page: 1, per_page: 5 })
    });
    const d1 = await t1.json();
    results.noFilters = { count: d1.people?.length || 0, status: t1.status };
    console.log('📊 No filters:', d1.people?.length || 0, 'people');
    if (d1.people?.[0]) console.log('Sample:', d1.people[0].name, '-', d1.people[0].title);

    // TEST 2: Just CEO
    console.log('\n🧪 TEST 2: Just CEO...');
    const t2 = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ page: 1, per_page: 5, person_titles: ['CEO'] })
    });
    const d2 = await t2.json();
    results.justCEO = { count: d2.people?.length || 0, status: t2.status };
    console.log('📊 Just CEO:', d2.people?.length || 0, 'people');

    // TEST 3: CEO + US Location
    console.log('\n🧪 TEST 3: CEO + US Location...');
    const t3 = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ 
        page: 1, 
        per_page: 5, 
        person_titles: ['CEO'],
        person_locations: ['United States']
      })
    });
    const d3 = await t3.json();
    results.ceoUS = { count: d3.people?.length || 0, status: t3.status };
    console.log('📊 CEO + US:', d3.people?.length || 0, 'people');

    // TEST 4: CEO + Company Size
    console.log('\n🧪 TEST 4: CEO + Company Size...');
    const t4 = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ 
        page: 1, 
        per_page: 5, 
        person_titles: ['CEO'],
        organization_num_employees_ranges: ['11-50', '51-200']
      })
    });
    const d4 = await t4.json();
    results.ceoSize = { count: d4.people?.length || 0, status: t4.status };
    console.log('📊 CEO + Size:', d4.people?.length || 0, 'people');

    // TEST 5: The "broad" search from generate-leads
    console.log('\n🧪 TEST 5: Broad search (what generate-leads uses)...');
    const t5 = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ 
        page: 1, 
        per_page: 10,
        person_titles: ['VP Sales', 'Director of Sales'],
        person_seniorities: ['VP', 'Director'],
        organization_num_employees_ranges: ['11-50', '51-200', '201-500'],
        person_locations: ['United States']
      })
    });
    const d5 = await t5.json();
    results.broadSearch = { count: d5.people?.length || 0, status: t5.status };
    console.log('📊 Broad search:', d5.people?.length || 0, 'people');
    console.log('Full response:', JSON.stringify(d5, null, 2));

    console.log('\n📊 SUMMARY:');
    console.log(JSON.stringify(results, null, 2));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(results)
    };
  } catch (error) {
    console.error('ERROR:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
