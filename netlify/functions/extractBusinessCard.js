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
    const { userId, authToken, imageBase64 } = JSON.parse(event.body);

    if (!userId || !authToken || !imageBase64) {
      throw new Error('Missing required parameters');
    }

    console.log('🔍 Extracting business card data via OCR');

    // Validate environment variables
    const googleVisionApiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!googleVisionApiKey) {
      console.error('❌ GOOGLE_VISION_API_KEY not configured');
      throw new Error('OCR service not configured');
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

    // Remove data URL prefix if present
    const base64Image = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');

    // Call Google Cloud Vision API for OCR
    const visionResponse = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${googleVisionApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64Image },
              features: [
                { type: 'TEXT_DETECTION', maxResults: 1 }
              ]
            }
          ]
        })
      }
    );

    if (!visionResponse.ok) {
      const errorText = await visionResponse.text();
      console.error('❌ Google Vision API error:', visionResponse.status, errorText);
      throw new Error('OCR extraction failed');
    }

    const visionData = await visionResponse.json();
    const textAnnotations = visionData.responses[0]?.textAnnotations;

    if (!textAnnotations || textAnnotations.length === 0) {
      console.log('⚠️ No text detected in image');
      throw new Error('No text found in image. Please try a clearer photo.');
    }

    // Extract full text
    const fullText = textAnnotations[0].description;
    console.log('📄 Extracted text:', fullText);

    // Parse text into structured contact fields
    const extractedData = parseBusinessCardText(fullText);

    console.log('✅ Parsed contact data:', extractedData);

    // Log API usage
    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'extractBusinessCard', 'success', {
      responseTime,
      metadata: {
        textLength: fullText.length,
        fieldsExtracted: Object.keys(extractedData).filter(k => extractedData[k]).length
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
        extractedData,
        rawText: fullText
      })
    };

  } catch (error) {
    console.error('❌ Error in extractBusinessCard:', error);

    // Log failed API usage
    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(userId, 'extractBusinessCard', 'error', {
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

// Parse extracted text into structured contact fields
function parseBusinessCardText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  const result = {
    name: '',
    email: '',
    phone: '',
    company: '',
    title: '',
    website: '',
    address: ''
  };

  // Email regex
  const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
  const emails = text.match(emailRegex);
  if (emails && emails.length > 0) {
    // Prefer corporate email over generic domains
    const corporateEmail = emails.find(e => !e.match(/@(gmail|yahoo|hotmail|outlook|icloud|aol)\./i));
    result.email = corporateEmail || emails[0];
  }

  // Phone regex (multiple formats)
  const phoneRegex = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g;
  const phones = text.match(phoneRegex);
  if (phones && phones.length > 0) {
    result.phone = phones[0];
  }

  // Website regex
  const websiteRegex = /((?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/gi;
  const websites = text.match(websiteRegex);
  if (websites && websites.length > 0) {
    // Filter out email domains
    const actualWebsite = websites.find(w => !w.includes('@'));
    if (actualWebsite) {
      result.website = actualWebsite;
    }
  }

  // Detect name (usually first line or second line, typically all caps or title case)
  const namePatterns = [
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)$/,  // Title Case Name
    /^([A-Z\s]{4,})$/,  // ALL CAPS NAME
  ];

  for (let i = 0; i < Math.min(3, lines.length); i++) {
    const line = lines[i];
    for (const pattern of namePatterns) {
      if (pattern.test(line) && line.length > 3 && line.length < 50) {
        result.name = line;
        break;
      }
    }
    if (result.name) break;
  }

  // If no name found, use first line as fallback
  if (!result.name && lines.length > 0) {
    // Skip lines that look like company names (all caps with short words)
    const firstNonCompanyLine = lines.find(l =>
      !l.match(/^[A-Z\s&]{3,}$/) || l.split(' ').length > 3
    );
    if (firstNonCompanyLine) {
      result.name = firstNonCompanyLine;
    }
  }

  // Detect title (lines with job-related keywords)
  const titleKeywords = ['director', 'manager', 'ceo', 'cto', 'cfo', 'vp', 'vice president',
                        'president', 'head', 'chief', 'lead', 'senior', 'junior',
                        'specialist', 'consultant', 'engineer', 'developer', 'designer',
                        'analyst', 'coordinator', 'executive', 'officer', 'founder', 'owner'];

  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    if (titleKeywords.some(kw => lowerLine.includes(kw))) {
      result.title = line;
      break;
    }
  }

  // Detect company name (usually all caps, comes before title or after name)
  const companyPatterns = [
    /^([A-Z][A-Z\s&.,]{2,})$/,  // ALL CAPS or Mostly Caps
    /^(.+(?:Inc|LLC|Ltd|Corp|Corporation|Co\.|Company|Group|Associates|Partners|Consulting|Services))\.?$/i
  ];

  for (const line of lines) {
    // Skip if it's the detected name
    if (line === result.name) continue;

    for (const pattern of companyPatterns) {
      if (pattern.test(line) && line.length > 2 && line.length < 60) {
        result.company = line;
        break;
      }
    }
    if (result.company) break;
  }

  // If company has email domain, try to extract from email
  if (!result.company && result.email) {
    const domain = result.email.split('@')[1];
    if (domain) {
      const companyFromDomain = domain.split('.')[0];
      result.company = companyFromDomain.charAt(0).toUpperCase() + companyFromDomain.slice(1);
    }
  }

  // Clean up extracted data
  result.name = result.name.replace(/[^a-zA-Z\s.-]/g, '').trim();
  result.company = result.company.replace(/[^\w\s&.,()-]/g, '').trim();
  result.title = result.title.replace(/[^\w\s&.,()-]/g, '').trim();

  // Detect address (lines with street, city, state, zip patterns)
  const addressLines = lines.filter(line => {
    const lower = line.toLowerCase();
    return lower.match(/\d+\s+[a-z]+\s+(street|st|avenue|ave|road|rd|blvd|drive|dr|lane|ln|way|court|ct)/i) ||
           lower.match(/\b[a-z]+,\s*[a-z]{2}\s+\d{5}/i) ||
           lower.match(/\d{5}(-\d{4})?$/);
  });

  if (addressLines.length > 0) {
    result.address = addressLines.join(', ');
  }

  return result;
}
