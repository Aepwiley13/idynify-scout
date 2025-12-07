export const handler = async (event, context) => {
  console.log('🎯 Generate Leads - ULTRA BROAD');
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' };
  }

  try {
    const { scoutData } = JSON.parse(event.body);
    const apolloKey = process.env.APOLLO_API_KEY;
    if (!apolloKey) throw new Error('APOLLO_API_KEY not found');

    // Try progressively broader searches until we get results
    const searches = [
      { per_page: 10, person_titles: ['VP Sales', 'Director Sales'], person_locations: ['United States'] },
      { per_page: 10, person_titles: ['VP'], person_locations: ['United States'] },
      { per_page: 10, person_seniorities: ['VP', 'Director'], person_locations: ['United States'] },
      { per_page: 10, person_locations: ['United States'] }
    ];

    let apolloData = null;
    for (let i = 0; i < searches.length; i++) {
      console.log(`🎯 Attempt ${i + 1}...`);
      const response = await fetch('https://api.apollo.io/v1/mixed_people/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apolloKey },
        body: JSON.stringify({ page: 1, ...searches[i] })
      });
      
      apolloData = await response.json();
      console.log(`📊 Got ${apolloData.people?.length || 0} results`);
      
      if (apolloData.people && apolloData.people.length > 0) break;
    }

    const leads = (apolloData.people || []).map(person => ({
      name: person.name || 'Unknown',
      title: person.title || 'Unknown',
      company: person.organization?.name || 'Unknown',
      email: person.email || 'No email',
      linkedinUrl: person.linkedin_url || '',
      photoUrl: person.photo_url || ''
    }));

    console.log('🎉 Returning', leads.length, 'leads');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ leads })
    };
  } catch (error) {
    console.error('💥 ERROR:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message, leads: [] })
    };
  }
};
