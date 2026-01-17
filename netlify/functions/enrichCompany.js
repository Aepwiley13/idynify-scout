import { logApiUsage } from './utils/logApiUsage.js';
import { APOLLO_ENDPOINTS, getApolloApiKey, getApolloHeaders } from './utils/apolloConstants.js';
import { logApolloError } from './utils/apolloErrorLogger.js';
import { mapApolloToScoutContact, validateScoutContact, logValidationErrors } from './utils/scoutContactContract.js';

export const handler = async (event) => {
  const startTime = Date.now();

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

    // Get Apollo API key (throws if not configured)
    const apolloApiKey = getApolloApiKey();

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
    const orgBody = { domain: domain };

    const orgResponse = await fetch(APOLLO_ENDPOINTS.ORGANIZATIONS_ENRICH, {
      method: 'POST',
      headers: getApolloHeaders(),
      body: JSON.stringify(orgBody)
    });

    if (!orgResponse.ok) {
      const errorText = await logApolloError(orgResponse, orgBody, 'enrichCompany');
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
        // Step 1: Search for decision makers (gets IDs and basic info)
        const searchBody = {
          organization_ids: [orgId],
          person_seniority: ['director', 'vp', 'c_suite', 'founder', 'owner'],
          person_departments: ['sales', 'marketing', 'operations', 'finance'],
          page: 1,
          per_page: 3  // Only get top 3 decision makers
        };

        const searchResponse = await fetch(APOLLO_ENDPOINTS.PEOPLE_SEARCH, {
          method: 'POST',
          headers: getApolloHeaders(),
          body: JSON.stringify(searchBody)
        });

        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          const searchResults = (searchData.people || []).slice(0, 3);
          console.log('✅ Found decision maker candidates:', searchResults.length);

          // Step 2: Enrich each decision maker individually to get full data
          const enrichedDecisionMakers = [];

          for (const candidate of searchResults) {
            try {
              console.log(`🔄 Enriching: ${candidate.first_name || 'Unknown'} (ID: ${candidate.id})`);

              const enrichResponse = await fetch(APOLLO_ENDPOINTS.PEOPLE_MATCH, {
                method: 'POST',
                headers: getApolloHeaders(),
                body: JSON.stringify({ id: candidate.id })
              });

              if (enrichResponse.ok) {
                const enrichData = await enrichResponse.json();
                const enrichedPerson = enrichData.person;

                if (enrichedPerson) {
                  // Use canonical mapper from Scout Contact Contract
                  const mappedPerson = mapApolloToScoutContact(enrichedPerson);

                  // Validate mapped contact (Phase 2: early warning if Apollo changes API)
                  const validation = validateScoutContact(mappedPerson);
                  if (!validation.valid) {
                    logValidationErrors(validation, mappedPerson, 'enrichCompany');
                  }

                  enrichedDecisionMakers.push(mappedPerson);
                  console.log(`  ✅ Enriched: ${mappedPerson.name || enrichedPerson.first_name}`);
                }
              } else {
                console.warn(`  ⚠️ Could not enrich ${candidate.first_name}, using basic data`);
                enrichedDecisionMakers.push(mapApolloToScoutContact(candidate));
              }
            } catch (enrichError) {
              console.error(`  ❌ Error enriching ${candidate.first_name}:`, enrichError.message);
              enrichedDecisionMakers.push(mapApolloToScoutContact(candidate));
            }
          }

          decisionMakers = enrichedDecisionMakers;
          console.log('✅ Enriched decision makers:', decisionMakers.length);

          // Diagnostic: Log first enriched decision maker
          if (decisionMakers.length > 0) {
            console.log('📋 Sample enriched decision maker:', {
              id: decisionMakers[0].id,
              first_name: decisionMakers[0].first_name,
              last_name: decisionMakers[0].last_name,
              name: decisionMakers[0].name,
              title: decisionMakers[0].title,
              email: decisionMakers[0].email,
              photo_url: decisionMakers[0].photo_url,
              linkedin_url: decisionMakers[0].linkedin_url,
              has_departments: !!decisionMakers[0].departments,
              has_functions: !!decisionMakers[0].functions
            });
          }
        } else {
          console.warn('⚠️ Could not search for decision makers, continuing without them');
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
        linkedin_url: organization.linkedin_url,
        facebook_url: organization.facebook_url,
        twitter_url: organization.twitter_url,
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
        // Construct full name from first_name + last_name if name doesn't exist
        name: person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim() || null,
        title: person.title,
        email: person.email || null,
        seniority: person.seniority,
        department: person.departments?.[0] || person.functions?.[0] || null,
        departments: person.departments || person.functions || [],
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
    // Diagnostic: Log mapped decision makers being returned to frontend
    if (enrichedData.decisionMakers && enrichedData.decisionMakers.length > 0) {
      console.log('📤 Mapped decision makers (sent to frontend):', enrichedData.decisionMakers.map(dm => ({
        id: dm.id,
        name: dm.name,
        title: dm.title,
        email: dm.email,
        photo_url: dm.photo_url,
        linkedin_url: dm.linkedin_url
      })));
    }

    // Log API usage for admin tracking
    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'enrichCompany', 'success', {
      responseTime,
      metadata: {
        domain,
        companyName: organization.name
      }
    });

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

    // Log failed API usage (extract userId from body if available)
    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(userId, 'enrichCompany', 'error', {
          responseTime,
          errorCode: error.message,
          metadata: {}
        });
      }
    } catch (logError) {
      console.error('Failed to log API error:', logError);
    }

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
