import { logApiUsage } from './utils/logApiUsage.js';

export const handler = async (event) => {
  const startTime = Date.now();

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, authToken, contactId, contactName, companyName, linkedinUrl } = JSON.parse(event.body);

    if (!userId || !authToken || !contactId) {
      throw new Error('Missing required parameters');
    }

    console.log('🔍 Enriching public profile for:', contactName);

    // Validate Firebase API key
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
      console.error('❌ FIREBASE_API_KEY not configured');
      throw new Error('Firebase API key not configured');
    }

    // Verify Firebase Auth token using REST API
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

    // Check for Google Search API credentials
    const GOOGLE_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
    const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;

    if (!GOOGLE_API_KEY || !GOOGLE_SEARCH_ENGINE_ID) {
      console.error('❌ Google Search API not configured');
      throw new Error('Search API not configured. Please add GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID to environment variables.');
    }

    // Build search queries
    const searchQueries = [
      `"${contactName}" "${companyName}" LinkedIn profile`,
      `"${contactName}" "${companyName}" bio`,
      `"${contactName}" interview`,
      `"${contactName}" "${companyName}" experience`,
      `"${contactName}" education`,
      `"${contactName}" book OR podcast OR speaking`
    ];

    let allResults = [];

    // Execute searches
    for (const query of searchQueries) {
      try {
        const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&num=5`;
        
        const response = await fetch(searchUrl);
        const data = await response.json();

        if (data.items) {
          allResults.push(...data.items);
        }
      } catch (err) {
        console.warn(`Search query failed: ${query}`, err);
      }
    }

    console.log(`✅ Found ${allResults.length} search results`);

    // Structure the profile data
    const structuredProfile = structureProfileData(contactName, companyName, linkedinUrl, allResults);

    // Log API usage
    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'enrichPublicProfile', 'success', {
      responseTime,
      metadata: {
        contactId,
        contactName,
        resultsCount: allResults.length
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        profileData: structuredProfile
      })
    };

  } catch (error) {
    console.error('❌ Enrichment error:', error);
    
    // Log failed usage
    const responseTime = Date.now() - startTime;
    try {
      const { userId } = JSON.parse(event.body);
      await logApiUsage(userId, 'enrichPublicProfile', 'error', {
        responseTime,
        error: error.message
      });
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to enrich profile'
      })
    };
  }
};

// Helper function to structure profile data from search results
function structureProfileData(name, company, linkedinUrl, searchResults) {
  const profile = {
    name: name,
    verified_identity: {
      full_name: name,
      linkedin_url: linkedinUrl || '',
      company: company,
      title: ''
    },
    professional_summary: '',
    experience: [],
    education: [],
    publications_and_media: [],
    public_social_profiles: {
      linkedin: linkedinUrl || '',
      twitter: '',
      other: []
    },
    notable_awards_and_recognition: [],
    key_skills_and_expertise: []
  };

  // Parse search results to extract structured data
  for (const result of searchResults) {
    const title = result.title || '';
    const snippet = result.snippet || '';
    const link = result.link || '';

    // Identify LinkedIn profile
    if (link.includes('linkedin.com/in/') && !profile.verified_identity.linkedin_url) {
      profile.public_social_profiles.linkedin = link;
      profile.verified_identity.linkedin_url = link;
    }

    // Identify Twitter/X profile
    if (link.includes('twitter.com/') || link.includes('x.com/')) {
      profile.public_social_profiles.twitter = link;
    }

    // Identify publications (books, articles, podcasts)
    if (snippet.toLowerCase().includes('podcast') || title.toLowerCase().includes('podcast')) {
      profile.publications_and_media.push({
        type: 'podcast',
        title: title,
        url: link
      });
    }

    if (snippet.toLowerCase().includes('book') || snippet.toLowerCase().includes('author')) {
      profile.publications_and_media.push({
        type: 'book',
        title: title,
        url: link
      });
    }

    if (snippet.toLowerCase().includes('interview') || title.toLowerCase().includes('interview')) {
      profile.publications_and_media.push({
        type: 'interview',
        title: title,
        url: link
      });
    }

    // Extract education mentions
    const educationKeywords = ['university', 'college', 'mba', 'bachelor', 'master', 'phd', 'degree'];
    if (educationKeywords.some(keyword => snippet.toLowerCase().includes(keyword))) {
      profile.education.push({
        institution: extractUniversityName(snippet),
        degree: extractDegree(snippet),
        years: ''
      });
    }

    // Build professional summary from snippets
    if (snippet.length > 50 && snippet.includes(company)) {
      profile.professional_summary += snippet + ' ';
    }
  }

  // Deduplicate and clean up
  profile.publications_and_media = deduplicateArray(profile.publications_and_media, 'url');
  profile.education = deduplicateArray(profile.education, 'institution');
  profile.professional_summary = profile.professional_summary.trim().substring(0, 500);

  return profile;
}

// Helper: Extract university name from text
function extractUniversityName(text) {
  const universityMatch = text.match(/(?:at|from)\s+([A-Z][a-z]+\s(?:University|College|Institute))/i);
  return universityMatch ? universityMatch[1] : 'Not specified';
}

// Helper: Extract degree from text
function extractDegree(text) {
  const degreeMatch = text.match(/(MBA|Bachelor|Master|PhD|B\.?S\.?|M\.?S\.?|B\.?A\.?|M\.?A\.?)/i);
  return degreeMatch ? degreeMatch[1] : 'Not specified';
}

// Helper: Deduplicate array by key
function deduplicateArray(arr, key) {
  const seen = new Set();
  return arr.filter(item => {
    const value = item[key];
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}
