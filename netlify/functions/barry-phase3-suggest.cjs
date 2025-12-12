exports.handler = async (event, context) => {
  console.log('👥 PHASE 3: Smart Contact Suggestions - Starting');
  
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
    const { userId, company, scoutData, excludeContactIds = [] } = JSON.parse(event.body);
    
    const apolloKey = process.env.APOLLO_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    
    if (!apolloKey || !anthropicKey) {
      throw new Error('API keys not configured');
    }

    if (!company) {
      throw new Error('No company provided');
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('🏢 COMPANY DATA RECEIVED FROM FRONTEND:');
    console.log('═══════════════════════════════════════════════════════');
    console.log('   Name:', company.name);
    console.log('   Organization ID:', company.organization_id || 'MISSING');
    console.log('   Domain:', company.website_url || 'MISSING');
    console.log('   Industry:', company.industry || 'MISSING');
    console.log('   Employee Count:', company.estimated_num_employees || 'MISSING');
    console.log('   Already excluded:', excludeContactIds.length, 'contacts');
    console.log('═══════════════════════════════════════════════════════\n');

    // Step 1: Get ALL potential contacts from Apollo (up to 25)
    const allContacts = await fetchContactsFromApollo(company, apolloKey, excludeContactIds);
    
    console.log(`\n📊 APOLLO SEARCH RESULT: ${allContacts.length} contacts found\n`);
    
    if (allContacts.length === 0) {
      console.warn('❌ NO CONTACTS FOUND - Returning empty response');
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          contacts: [],
          company: company,
          totalAvailable: 0,
          message: `No contacts found in ${company.name}`,
          timestamp: new Date().toISOString()
        })
      };
    }

    console.log(`✅ Found ${allContacts.length} total contacts from Apollo`);

    // Step 2: Use Barry (Claude) to pick the BEST 3-5 and explain WHY
    const smartSuggestions = await getBarrySmartSuggestions(
      company,
      allContacts,
      scoutData,
      anthropicKey
    );

    console.log(`✅ Barry selected ${smartSuggestions.length} smart suggestions`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        contacts: smartSuggestions,
        company: company,
        totalAvailable: allContacts.length,
        message: `Barry suggests ${smartSuggestions.length} contacts for ${company.name}`,
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
        contacts: [],
        totalAvailable: 0
      })
    };
  }
};

// Helper Functions

async function fetchContactsFromApollo(company, apolloKey, excludeIds = []) {
  console.log(`\n🔍 Starting search for: ${company.name}`);
  console.log(`   Org ID: ${company.organization_id || 'N/A'}`);
  console.log(`   Domain: ${company.website_url || 'N/A'}`);
  console.log(`   Industry: ${company.industry || 'N/A'}`);

  // Strategy 1: Use organization_id if available (MOST RELIABLE)
  if (company.organization_id) {
    console.log('   📍 Strategy 1: Using organization_id (most reliable)');
    
    const searchParams = {
      api_key: apolloKey,
      page: 1,
      per_page: 25,
      organization_ids: [company.organization_id],
      contact_email_status: ['verified', 'guessed', 'unavailable']
    };

    console.log('   📤 Request params:', JSON.stringify(searchParams, null, 2));

    try {
      const response = await fetch('https://api.apollo.io/v1/mixed_people/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify(searchParams)
      });

      const responseText = await response.text();
      console.log('   📥 Raw response status:', response.status);
      console.log('   📥 Raw response:', responseText.substring(0, 500));

      if (response.ok) {
        const data = JSON.parse(responseText);
        console.log(`   📊 Apollo found: ${data.people?.length || 0} people`);
        console.log(`   📊 Total in db: ${data.pagination?.total_entries || 'unknown'}`);
        
        if (data.people && data.people.length > 0) {
          const filteredPeople = data.people.filter(person => !excludeIds.includes(person.id));
          console.log(`   ✅ Strategy 1 SUCCESS: Returning ${filteredPeople.length} contacts\n`);
          return formatPeopleData(filteredPeople, company);
        } else {
          console.log('   ⚠️ Strategy 1: API returned 0 people');
        }
      } else {
        console.log(`   ❌ Strategy 1 failed with status ${response.status}`);
        console.log(`   Error response: ${responseText}`);
      }
    } catch (err) {
      console.error(`   ❌ Strategy 1 exception:`, err.message);
    }
  } else {
    console.log('   ⚠️ Strategy 1 SKIPPED: No organization_id provided');
  }

  // Strategy 2: Try domain only
  if (company.website_url) {
    console.log('   📍 Strategy 2: Trying domain-only search...');
    const domain = company.website_url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    console.log(`   🌐 Using domain: ${domain}`);
    
    const searchParams = {
      api_key: apolloKey,
      page: 1,
      per_page: 25,
      organization_domains: [domain],
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
      
      const responseText = await response.text();
      console.log('   📥 Raw response status:', response.status);
      
      if (response.ok) {
        const data = JSON.parse(responseText);
        console.log(`   📊 Apollo found: ${data.people?.length || 0} people`);
        
        if (data.people && data.people.length > 0) {
          const filteredPeople = data.people.filter(person => !excludeIds.includes(person.id));
          console.log(`   ✅ Strategy 2 SUCCESS: Returning ${filteredPeople.length} contacts\n`);
          return formatPeopleData(filteredPeople, company);
        } else {
          console.log('   ⚠️ Strategy 2: API returned 0 people');
        }
      } else {
        console.log(`   ❌ Strategy 2 failed with status ${response.status}`);
      }
    } catch (err) {
      console.error(`   ❌ Strategy 2 exception:`, err.message);
    }
  } else {
    console.log('   ⚠️ Strategy 2 SKIPPED: No website_url provided');
  }
  
  // Strategy 3: Try company name (broad search)
  const cleanName = company.name.replace(/®|™|©/g, '').trim();
  if (cleanName) {
    console.log('   📍 Strategy 3: Trying company name search...');
    console.log(`   🏢 Using name: "${cleanName}"`);
    
    const searchParams = {
      api_key: apolloKey,
      page: 1,
      per_page: 25,
      q_organization_name: cleanName,
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
      
      const responseText = await response.text();
      console.log('   📥 Raw response status:', response.status);
      
      if (response.ok) {
        const data = JSON.parse(responseText);
        console.log(`   📊 Apollo found: ${data.people?.length || 0} people`);
        
        if (data.people && data.people.length > 0) {
          const filteredPeople = data.people.filter(person => !excludeIds.includes(person.id));
          console.log(`   ✅ Strategy 3 SUCCESS: Returning ${filteredPeople.length} contacts\n`);
          return formatPeopleData(filteredPeople, company);
        } else {
          console.log('   ⚠️ Strategy 3: API returned 0 people');
        }
      } else {
        console.log(`   ❌ Strategy 3 failed with status ${response.status}`);
      }
    } catch (err) {
      console.error(`   ❌ Strategy 3 exception:`, err.message);
    }
  } else {
    console.log('   ⚠️ Strategy 3 SKIPPED: No company name available');
  }

  console.warn(`   ⚠️ FINAL: No people found for ${company.name} after all strategies`);
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

async function getBarrySmartSuggestions(company, allContacts, scoutData, anthropicKey) {
  const companySize = company.estimated_num_employees || 0;
  const industry = company.industry || 'Unknown';
  
  // Build context for Barry
  const prompt = `You are Barry, an expert AI SDR. Analyze these contacts and select the BEST 3-5 people to target for this company.

COMPANY CONTEXT:
- Name: ${company.name}
- Size: ${companySize} employees
- Industry: ${industry}
- Barry Score: ${company.barryScore || 'N/A'}

USER'S ICP:
- Target Industries: ${scoutData.industries?.join(', ') || 'Various'}
- Target Company Sizes: ${scoutData.companySizes?.join(', ') || 'Various'}

AVAILABLE CONTACTS (${allContacts.length} total):
${allContacts.map((c, idx) => `${idx}. ${c.name} - ${c.title} (${c.seniority || 'Unknown'} level)`).join('\n')}

SELECTION CRITERIA:
1. Company size matters:
   - 1-50 employees: Target CEO, Founder, Owner
   - 51-200 employees: Target Directors, VPs, Heads of
   - 201-500 employees: Target Managers, Directors
   - 500+ employees: Target Managers, Senior roles (NOT C-suite)

2. Diverse suggestions:
   - Mix seniorities and departments
   - Include decision makers AND influencers
   - Consider budget holders

3. Reasoning required:
   - Explain WHY each person is a good fit
   - Be specific about their role

Return ONLY valid JSON (no markdown):
[
  {
    "index": 0,
    "reason": "CEO at small company - direct decision maker for sales tools"
  },
  {
    "index": 3,
    "reason": "Sales Manager at mid-size - has budget authority and feels pain"
  }
]

Select 3-5 contacts. Be strategic.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.content[0].text;
    
    // Parse JSON response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    
    if (!jsonMatch) {
      console.warn('Could not parse Barry suggestions, using fallback');
      // Fallback: return first 4 contacts
      return allContacts.slice(0, 4).map(contact => ({
        ...contact,
        barryReason: 'Good fit based on role and seniority'
      }));
    }
    
    const selections = JSON.parse(jsonMatch[0]);
    
    // Map selections back to contacts
    const suggestions = [];
    selections.forEach(selection => {
      const contact = allContacts[selection.index];
      if (contact) {
        suggestions.push({
          ...contact,
          barryReason: selection.reason
        });
      }
    });
    
    return suggestions;
    
  } catch (err) {
    console.error('Error in Barry suggestions:', err);
    // Fallback: return first 4 contacts
    return allContacts.slice(0, 4).map(contact => ({
      ...contact,
      barryReason: 'Suggested based on role and company fit'
    }));
  }
}