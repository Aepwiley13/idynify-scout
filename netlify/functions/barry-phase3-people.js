exports.handler = async (event, context) => {
  console.log('👥 PHASE 3: Decision Maker Discovery - Starting');
  
  // Handle CORS
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
    const { userId, selectedCompanies, targetTitles } = JSON.parse(event.body);
    
    const apolloKey = process.env.APOLLO_API_KEY;
    
    if (!apolloKey) {
      throw new Error('Apollo API key not configured');
    }

    if (!selectedCompanies || selectedCompanies.length === 0) {
      throw new Error('No companies provided');
    }

    console.log('🎯 Finding people in', selectedCompanies.length, 'companies');
    console.log('🎯 Target titles:', targetTitles);

    let allPeople = [];
    
    // Search for people in each company
    for (const company of selectedCompanies) {
      console.log(`🔍 Searching people in: ${company.name}`);
      
      try {
        const people = await findPeopleInCompany(company, targetTitles, apolloKey);
        
        // Add company context to each person
        const enrichedPeople = people.map(person => ({
          ...person,
          companyContext: {
            name: company.name,
            id: company.id,
            domain: company.website_url,
            barryScore: company.barryScore
          }
        }));
        
        allPeople = allPeople.concat(enrichedPeople);
        
        console.log(`✅ Found ${people.length} people in ${company.name}`);
        
      } catch (err) {
        console.error(`Error finding people in ${company.name}:`, err);
        // Continue with other companies
      }
    }

    console.log(`✅ Total people found: ${allPeople.length}`);

    // Calculate analytics
    const analytics = calculateAnalytics(allPeople, selectedCompanies);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        people: allPeople,
        totalPeople: allPeople.length,
        companiesSearched: selectedCompanies.length,
        analytics: analytics,
        message: `Found ${allPeople.length} decision makers across ${selectedCompanies.length} companies!`,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('💥 Error in Phase 3:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: error.message,
        people: [],
        totalPeople: 0
      })
    };
  }
};

// Helper Functions

async function findPeopleInCompany(company, targetTitles, apolloKey) {
  console.log(`\n🔍 Searching for people in: ${company.name}`);
  console.log(`   Org ID: ${company.organization_id || 'N/A'}`);
  console.log(`   Domain: ${company.website_url || 'N/A'}`);
  
  // Strategy 1: Try organization_id first (most reliable)
  if (company.organization_id) {
    console.log('   📍 Using organization_id');
    
    const organizationIds = [company.organization_id];
    const titleKeywords = buildTitleKeywords(targetTitles);
    
    const searchParams = {
      api_key: apolloKey,
      page: 1,
      per_page: 15, // Get more contacts for better selection
      organization_ids: organizationIds,
      person_titles: titleKeywords,
      contact_email_status: ['verified', 'guessed', 'unavailable']
    };

    try {
      const response = await fetch('https://api.apollo.io/v1/mixed_people/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify(searchParams)
      });

      if (!response.ok) {
        console.error(`   ❌ Apollo API error: ${response.status}`);
        throw new Error(`Apollo API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.people && data.people.length > 0) {
        console.log(`   ✅ Found ${data.people.length} people via organization_id`);
        return formatPeopleData(data.people, company);
      } else {
        console.warn(`   ⚠️ No people found via organization_id`);
      }
    } catch (err) {
      console.error(`   ❌ Error with organization_id search:`, err.message);
    }
  }
  
  // Strategy 2: Try domain if available
  if (company.website_url) {
    console.log('   📍 Trying domain search...');
    const domain = company.website_url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    console.log(`   🌐 Domain: ${domain}`);
    
    const titleKeywords = buildTitleKeywords(targetTitles);
    
    const searchParams = {
      api_key: apolloKey,
      page: 1,
      per_page: 15,
      organization_domains: [domain],
      person_titles: titleKeywords,
      contact_email_status: ['verified', 'guessed', 'unavailable']
    };
    
    try {
      const response = await fetch('https://api.apollo.io/v1/mixed_people/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify(searchParams)
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.people && data.people.length > 0) {
          console.log(`   ✅ Found ${data.people.length} people via domain`);
          return formatPeopleData(data.people, company);
        }
      }
    } catch (err) {
      console.error(`   ❌ Error with domain search:`, err.message);
    }
  }
  
  // Strategy 3: Last resort - company name search
  const cleanName = company.name.replace(/®|™|©/g, '').trim();
  if (cleanName) {
    console.log('   📍 Trying company name search...');
    console.log(`   🏢 Name: "${cleanName}"`);
    
    const titleKeywords = buildTitleKeywords(targetTitles);
    
    const searchParams = {
      api_key: apolloKey,
      page: 1,
      per_page: 15,
      q_organization_name: cleanName,
      person_titles: titleKeywords,
      contact_email_status: ['verified', 'guessed', 'unavailable']
    };
    
    try {
      const response = await fetch('https://api.apollo.io/v1/mixed_people/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify(searchParams)
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.people && data.people.length > 0) {
          console.log(`   ✅ Found ${data.people.length} people via company name`);
          return formatPeopleData(data.people, company);
        }
      }
    } catch (err) {
      console.error(`   ❌ Error with name search:`, err.message);
    }
  }
  
  console.warn(`   ⚠️ No people found for ${company.name} after all strategies`);
  return [];
}

function formatPeopleData(people, company) {
  return people.map(person => ({
    id: person.id,
    name: person.name,
    firstName: person.first_name,
    lastName: person.last_name,
    title: person.title,
    headline: person.headline,
    photoUrl: person.photo_url,
    linkedinUrl: person.linkedin_url,
    
    // Contact info
    email: person.email,
    emailStatus: person.email_status,
    phone: person.phone_numbers?.[0]?.sanitized_number || null,
    
    // Professional details
    seniority: person.seniority,
    departments: person.departments || [],
    
    // Employment history
    employmentHistory: person.employment_history?.slice(0, 3).map(job => ({
      title: job.title,
      company: job.organization_name,
      startDate: job.start_date,
      endDate: job.end_date,
      current: job.current
    })) || [],
    
    // Current organization
    organization: {
      name: person.organization?.name || company.name,
      domain: person.organization?.website_url || company.website_url
    }
  }));
}

function buildTitleKeywords(targetTitles) {
  if (!targetTitles || targetTitles.length === 0) {
    // Default to common decision maker titles
    return ['CEO', 'CTO', 'VP', 'Director', 'Head of', 'Manager', 'Founder'];
  }
  
  // Use target titles directly
  return targetTitles;
}

function calculateAnalytics(people, companies) {
  const analytics = {
    totalPeople: people.length,
    totalCompanies: companies.length,
    avgPerCompany: Math.round((people.length / companies.length) * 10) / 10,
    
    // Seniority breakdown
    bySeniority: {},
    
    // Email status
    emailStatus: {
      verified: 0,
      guessed: 0,
      unavailable: 0
    },
    
    // Contact availability
    withEmail: 0,
    withPhone: 0,
    withLinkedIn: 0
  };

  people.forEach(person => {
    // Seniority
    const seniority = person.seniority || 'Unknown';
    analytics.bySeniority[seniority] = (analytics.bySeniority[seniority] || 0) + 1;
    
    // Email status
    const emailStatus = person.emailStatus || 'unavailable';
    if (analytics.emailStatus[emailStatus] !== undefined) {
      analytics.emailStatus[emailStatus]++;
    }
    
    // Contact availability
    if (person.email) analytics.withEmail++;
    if (person.phone) analytics.withPhone++;
    if (person.linkedinUrl) analytics.withLinkedIn++;
  });

  return analytics;
}
