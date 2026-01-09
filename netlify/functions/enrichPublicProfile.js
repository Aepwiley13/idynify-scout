const fetch = require('node-fetch');
const admin = require('firebase-admin');

// Initialize Firebase Admin if not already done
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, authToken, contactId, contactName, companyName, linkedinUrl } = JSON.parse(event.body);

    // Validate authentication
    if (!authToken || !userId) {
      return {
        statusCode: 401,
        body: JSON.stringify({ success: false, error: 'Unauthorized' })
      };
    }

    // Verify Firebase token
    try {
      await admin.auth().verifyIdToken(authToken);
    } catch (error) {
      return {
        statusCode: 401,
        body: JSON.stringify({ success: false, error: 'Invalid auth token' })
      };
    }

    console.log(`🔍 Enriching public profile for: ${contactName} at ${companyName}`);

    // Step 1: Build search queries
    const searchQueries = [
      `"${contactName}" "${companyName}" LinkedIn profile`,
      `"${contactName}" "${companyName}" bio`,
      `"${contactName}" interview`,
      `"${contactName}" "${companyName}" experience`,
      `"${contactName}" education`,
      `"${contactName}" book OR podcast OR speaking`
    ];

    // Step 2: Call Google Programmable Search API
    const GOOGLE_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
    const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;

    if (!GOOGLE_API_KEY || !GOOGLE_SEARCH_ENGINE_ID) {
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          success: false, 
          error: 'Search API not configured. Please add GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID to environment variables.' 
        })
      };
    }

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

    // Step 3: Structure the data
    const structuredProfile = await structureProfileData(contactName, companyName, linkedinUrl, allResults);

    // Step 4: Save to Firestore
    const db = admin.firestore();
    const contactRef = db.collection('users').doc(userId).collection('contacts').doc(contactId);

    await contactRef.update({
      publicProfile: structuredProfile,
      publicProfile_enriched_at: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`✅ Public profile saved to Firestore`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        profileData: structuredProfile
      })
    };

  } catch (error) {
    console.error('❌ Enrichment error:', error);
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
async function structureProfileData(name, company, linkedinUrl, searchResults) {
  // Extract relevant information from search results
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
      // Basic education extraction - can be enhanced with NLP
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
