export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, authToken, domain, organizationId } = JSON.parse(event.body);

    if (!userId || !authToken || !domain) {
      throw new Error('Missing required parameters');
    }

    console.log('🔄 Enriching company:', domain);

    // Validate environment variables
    const apolloApiKey = process.env.APOLLO_API_KEY;
    if (!apolloApiKey) {
      console.error('❌ APOLLO_API_KEY not configured');
      throw new Error('Apollo API key not configured');
    }

    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
      console.error('❌ FIREBASE_API_KEY not configured');
      throw new Error('Firebase API key not configured');
    }

    // Verify Firebase Auth token
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

    // Step 1: Enrich company data with Apollo Organizations API
    console.log('📊 Calling Apollo Organizations Enrich API...');
    const orgResponse = await fetch('https://api.apollo.io/v1/organizations/enrich', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apolloApiKey
      },
      body: JSON.stringify({
        domain: domain
      })
    });

    if (!orgResponse.ok) {
      const errorText = await orgResponse.text();
      console.error('❌ Apollo Organizations API error:', orgResponse.status, errorText);
      throw new Error(`Apollo Organizations API failed: ${orgResponse.status}`);
    }

    const orgData = await orgResponse.json();
    const organization = orgData.organization;

    if (!organization) {
      throw new Error('Organization data not found');
    }

    console.log('✅ Organization data enriched:', organization.name);

    // Step 2: Get decision makers (Director+ in Sales/RevOps/Marketing/Ops)
    let decisionMakers = [];

    if (organization.id || organizationId) {
      const orgId = organization.id || organizationId;

      console.log('👥 Fetching decision makers...');

      try {
        const peopleResponse = await fetch('https://api.apollo.io/v1/mixed_people/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'X-Api-Key': apolloApiKey
          },
          body: JSON.stringify({
            organization_ids: [orgId],
            person_seniority: ['director', 'vp', 'c_suite', 'founder', 'owner'],
            person_departments: ['sales', 'marketing', 'operations', 'finance'],
            page: 1,
            per_page: 3  // Only get top 3 decision makers
          })
        });

        if (peopleResponse.ok) {
          const peopleData = await peopleResponse.json();
          decisionMakers = (peopleData.people || []).slice(0, 3); // Limit to 3
          console.log('✅ Found decision makers:', decisionMakers.length);
        } else {
          console.warn('⚠️ Could not fetch decision makers, continuing without them');
        }
      } catch (error) {
        console.warn('⚠️ Error fetching decision makers:', error.message);
        // Continue without decision makers - not critical
      }
    }

    // Step 3: Structure enriched data for UI sections
    const enrichedData = {
      // Section 1: Company Snapshot
      snapshot: {
        name: organization.name,
        website_url: organization.website_url,
        domain: organization.primary_domain,
        industry: organization.industry,
        description: organization.short_description || organization.description || null,
        keywords: organization.keywords || [],
        sic_codes: organization.sic_codes || [],
        phone: organization.phone || organization.sanitized_phone || null,
        estimated_num_employees: organization.estimated_num_employees,
        employee_count_range: organization.employee_count || null,
        annual_revenue: organization.annual_revenue,
        revenue_range: organization.estimated_annual_revenue || null,
        founded_year: organization.founded_year,
        organization_type: organization.organizationally_subordinate_with || null,
        location: {
          city: organization.primary_location?.city || organization.city || null,
          state: organization.primary_location?.state || organization.state || null,
          country: organization.primary_location?.country || organization.country || null,
          full: formatLocation(organization)
        }
      },

      // Section 2: Growth & Hiring Signals
      growth: {
        employee_growth_6mo: organization.employee_growth_6mo || null,
        employee_growth_12mo: organization.employee_growth_12mo || null,
        headcount_trend: organization.headcount_trend || null,
        job_postings_count: organization.total_job_openings || organization.job_postings_count || 0,
        job_postings: filterRelevantJobPostings(organization.job_postings || []),
        hiring_velocity: calculateHiringVelocity(organization)
      },

      // Section 3: Department Breakdown
      departments: {
        sales: organization.department_headcount_sales || organization.department_headcounts?.sales || null,
        marketing: organization.department_headcount_marketing || organization.department_headcounts?.marketing || null,
        engineering: organization.department_headcount_engineering || organization.department_headcounts?.engineering || null,
        operations: organization.department_headcount_operations || organization.department_headcounts?.operations || null,
        finance: organization.department_headcount_finance || organization.department_headcounts?.finance || null
      },

      // Section 4: Tech Stack (limit to 6 relevant tools)
      techStack: filterTechStack(organization.current_technologies || []),

      // Section 5: Decision Makers (2-3 max)
      decisionMakers: decisionMakers.map(person => ({
        id: person.id,
        first_name: person.first_name,
        last_name: person.last_name,
        name: person.name,
        title: person.title,
        seniority: person.seniority,
        department: person.departments?.[0] || person.functions?.[0] || null,
        linkedin_url: person.linkedin_url,
        photo_url: person.photo_url
      })),

      // Section 6: Data Confidence & Freshness
      dataQuality: {
        organization_status: organization.organization_status || 'active',
        linkedin_url: organization.linkedin_url,
        facebook_url: organization.facebook_url,
        twitter_url: organization.twitter_url,
        last_updated_at: organization.modality || new Date().toISOString(),
        data_source: 'Apollo',
        confidence: organization.sanitized_phone ? 'high' : 'medium'
      },

      // Store full organization object for reference
      _raw: {
        apolloOrgId: organization.id,
        enrichedAt: Date.now(),
        domain: domain
      }
    };

    console.log('✅ Company enrichment complete');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        data: enrichedData
      })
    };

  } catch (error) {
    console.error('❌ Error in enrichCompany:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};

// Helper function to format location
function formatLocation(org) {
  const parts = [];
  const city = org.primary_location?.city || org.city;
  const state = org.primary_location?.state || org.state;
  const country = org.primary_location?.country || org.country;

  if (city) parts.push(city);
  if (state) parts.push(state);
  if (country && country !== 'United States') parts.push(country);

  return parts.length > 0 ? parts.join(', ') : 'Unknown';
}

// Helper function to calculate hiring velocity
function calculateHiringVelocity(org) {
  const jobCount = org.total_job_openings || org.job_postings_count || 0;

  if (jobCount === 0) return 'Low';
  if (jobCount >= 20) return 'High';
  if (jobCount >= 5) return 'Medium';
  return 'Low';
}

// Helper function to filter relevant job postings
function filterRelevantJobPostings(postings) {
  const relevantKeywords = [
    'sales', 'revenue', 'business development', 'account executive',
    'marketing', 'demand gen', 'growth',
    'revops', 'sales ops', 'revenue operations',
    'operations manager', 'ops'
  ];

  return postings
    .filter(posting => {
      const title = (posting.title || '').toLowerCase();
      return relevantKeywords.some(keyword => title.includes(keyword));
    })
    .slice(0, 5); // Limit to 5 most relevant postings
}

// Helper function to filter tech stack to relevant tools
function filterTechStack(technologies) {
  // Prioritize CRM, Marketing Automation, Analytics
  const priorityCategories = [
    'crm', 'customer relationship management',
    'marketing automation', 'email marketing',
    'analytics', 'data', 'business intelligence'
  ];

  const categorized = technologies.map(tech => {
    const nameLower = (tech.name || '').toLowerCase();
    const categoryLower = (tech.category || '').toLowerCase();

    const isPriority = priorityCategories.some(cat =>
      nameLower.includes(cat) || categoryLower.includes(cat)
    );

    return {
      ...tech,
      isPriority
    };
  });

  // Sort: priority first, then by name
  const sorted = categorized.sort((a, b) => {
    if (a.isPriority && !b.isPriority) return -1;
    if (!a.isPriority && b.isPriority) return 1;
    return 0;
  });

  // Return top 6
  return sorted.slice(0, 6).map(tech => ({
    name: tech.name,
    category: tech.category,
    uid: tech.uid
  }));
}
