/**
 * LinkedIn Profile Search via Google Custom Search API
 *
 * Fallback when Apollo fails - searches Google for LinkedIn profiles
 * using available contact data (name, company, title, email domain).
 *
 * Returns LinkedIn URL if found with high confidence.
 */

const GOOGLE_SEARCH_API = 'https://www.googleapis.com/customsearch/v1';

/**
 * Search for a LinkedIn profile using Google Custom Search API
 *
 * @param {Object} params - Search parameters
 * @param {string} params.name - Full name of the person
 * @param {string} params.company - Company name (optional but recommended)
 * @param {string} params.title - Job title (optional)
 * @param {string} params.emailDomain - Email domain for domain-assisted search (optional)
 * @returns {Object} - { success, linkedinUrl, photoUrl, confidence, searchQuery, message }
 */
export async function searchLinkedInProfile({ name, company, title, emailDomain }) {
  // Use existing Google Search API keys (avoid adding new env vars that exceed Lambda limit)
  const apiKey = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY || process.env.GOOGLE_SEARCH_API_KEY;
  const searchEngineId = process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID || process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !searchEngineId) {
    console.log('⚠️ Google Custom Search API not configured - skipping LinkedIn search');
    return {
      success: false,
      linkedinUrl: null,
      confidence: 'none',
      searchQuery: null,
      message: 'Google Custom Search API not configured'
    };
  }

  // Build search queries in order of specificity
  const searchStrategies = [];

  // Strategy 1: Name + Company (most specific)
  if (name && company) {
    searchStrategies.push({
      query: `"${name}" "${company}" site:linkedin.com/in/`,
      strategy: 'name_company'
    });
  }

  // Strategy 2: Name + Title (fallback if company is vague)
  if (name && title) {
    searchStrategies.push({
      query: `"${name}" "${title}" site:linkedin.com/in/`,
      strategy: 'name_title'
    });
  }

  // Strategy 3: Name + Email Domain (high signal for founders/execs)
  if (name && emailDomain && !emailDomain.includes('gmail') && !emailDomain.includes('yahoo') && !emailDomain.includes('hotmail')) {
    searchStrategies.push({
      query: `"${name}" site:linkedin.com/in/ ${emailDomain}`,
      strategy: 'name_email_domain'
    });
  }

  // Strategy 4: Name only (last resort)
  if (name) {
    searchStrategies.push({
      query: `"${name}" site:linkedin.com/in/`,
      strategy: 'name_only'
    });
  }

  // Try each strategy until we find a confident match
  for (const { query, strategy } of searchStrategies) {
    console.log(`🔍 LinkedIn Search (${strategy}): ${query}`);

    try {
      const url = new URL(GOOGLE_SEARCH_API);
      url.searchParams.append('key', apiKey);
      url.searchParams.append('cx', searchEngineId);
      url.searchParams.append('q', query);
      url.searchParams.append('num', '5'); // Get top 5 results

      const response = await fetch(url.toString());

      if (!response.ok) {
        console.error(`Google Search API error: ${response.status}`);
        continue;
      }

      const data = await response.json();
      const items = data.items || [];

      // Find LinkedIn profile URLs in results
      for (const item of items) {
        const link = item.link || '';

        // Must be a LinkedIn profile URL (not company page, not jobs, etc.)
        if (link.includes('linkedin.com/in/')) {
          // Extract the profile URL (clean it up)
          const linkedinUrl = extractLinkedInProfileUrl(link);

          if (linkedinUrl) {
            // Calculate confidence based on strategy and result quality
            const confidence = calculateConfidence(strategy, item, name, company);

            if (confidence === 'high' || confidence === 'medium') {
              // Extract profile photo from Google's pagemap data
              const photoUrl = extractPhotoFromSearchResult(item);

              console.log(`✅ LinkedIn found (${confidence}): ${linkedinUrl}`);
              if (photoUrl) {
                console.log(`📷 Photo found: ${photoUrl}`);
              }

              return {
                success: true,
                linkedinUrl,
                photoUrl,
                confidence,
                searchQuery: query,
                strategy,
                message: `Found via ${strategy} search`
              };
            }
          }
        }
      }

      console.log(`No confident match for strategy: ${strategy}`);

    } catch (err) {
      console.error(`Search strategy ${strategy} failed:`, err.message);
    }
  }

  // No match found across all strategies
  return {
    success: false,
    linkedinUrl: null,
    photoUrl: null,
    confidence: 'none',
    searchQuery: searchStrategies[0]?.query || null,
    message: 'No confident LinkedIn profile match found'
  };
}

/**
 * Extract clean LinkedIn profile URL from search result
 */
function extractLinkedInProfileUrl(url) {
  try {
    const parsed = new URL(url);

    // Ensure it's linkedin.com
    if (!parsed.hostname.includes('linkedin.com')) {
      return null;
    }

    // Extract the /in/username part
    const match = parsed.pathname.match(/\/in\/([^\/\?]+)/);
    if (match) {
      return `https://www.linkedin.com/in/${match[1]}`;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract profile photo URL from Google search result's pagemap data
 * Google indexes LinkedIn profile photos in cse_image or cse_thumbnail
 */
function extractPhotoFromSearchResult(item) {
  try {
    const pagemap = item.pagemap || {};

    // Try cse_image first (higher quality)
    if (pagemap.cse_image && pagemap.cse_image[0]?.src) {
      const photoUrl = pagemap.cse_image[0].src;
      // Validate it's a real image URL (not a placeholder or icon)
      if (isValidLinkedInPhoto(photoUrl)) {
        return photoUrl;
      }
    }

    // Try cse_thumbnail as fallback
    if (pagemap.cse_thumbnail && pagemap.cse_thumbnail[0]?.src) {
      const photoUrl = pagemap.cse_thumbnail[0].src;
      if (isValidLinkedInPhoto(photoUrl)) {
        return photoUrl;
      }
    }

    // Try metatags og:image
    if (pagemap.metatags && pagemap.metatags[0]?.['og:image']) {
      const photoUrl = pagemap.metatags[0]['og:image'];
      if (isValidLinkedInPhoto(photoUrl)) {
        return photoUrl;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Validate that a URL is a real LinkedIn profile photo (not a placeholder)
 */
function isValidLinkedInPhoto(url) {
  if (!url) return false;

  // Reject common placeholder patterns
  const placeholderPatterns = [
    'ghost-person',
    'ghost_person',
    'default-avatar',
    'no-photo',
    'placeholder',
    '/static.licdn.com/sc/h/',  // LinkedIn icon assets
    'data:image',  // Base64 placeholders
  ];

  const urlLower = url.toLowerCase();
  for (const pattern of placeholderPatterns) {
    if (urlLower.includes(pattern)) {
      return false;
    }
  }

  // Must be a real image URL
  return url.startsWith('http');
}

/**
 * Calculate confidence based on search strategy and result quality
 */
function calculateConfidence(strategy, searchResult, targetName, targetCompany) {
  const title = (searchResult.title || '').toLowerCase();
  const snippet = (searchResult.snippet || '').toLowerCase();
  const combined = `${title} ${snippet}`;

  const nameParts = (targetName || '').toLowerCase().split(' ');
  const companyLower = (targetCompany || '').toLowerCase();

  // Check if name appears in result
  const nameMatch = nameParts.every(part =>
    part.length > 2 && combined.includes(part)
  );

  // Check if company appears in result
  const companyMatch = companyLower && combined.includes(companyLower);

  // Strategy-based confidence
  if (strategy === 'name_company' && nameMatch && companyMatch) {
    return 'high';
  }

  if (strategy === 'name_company' && nameMatch) {
    return 'medium';
  }

  if (strategy === 'name_title' && nameMatch) {
    return 'medium';
  }

  if (strategy === 'name_email_domain' && nameMatch) {
    return 'medium';
  }

  if (strategy === 'name_only' && nameMatch) {
    return 'low';
  }

  return 'low';
}

/**
 * Extract email domain from email address
 */
export function extractEmailDomain(email) {
  if (!email || !email.includes('@')) return null;
  return email.split('@')[1];
}

/**
 * Search for a LinkedIn profile photo using Google Custom Search
 * Use this when you have a LinkedIn URL but no photo
 *
 * @param {Object} params - Search parameters
 * @param {string} params.linkedinUrl - The LinkedIn profile URL
 * @param {string} params.name - Person's name (optional, improves search accuracy)
 * @returns {Object} - { success, photoUrl, message }
 */
export async function searchLinkedInPhoto({ linkedinUrl, name }) {
  const apiKey = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY || process.env.GOOGLE_SEARCH_API_KEY;
  const searchEngineId = process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID || process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !searchEngineId) {
    return {
      success: false,
      photoUrl: null,
      message: 'Google Custom Search API not configured'
    };
  }

  if (!linkedinUrl) {
    return {
      success: false,
      photoUrl: null,
      message: 'No LinkedIn URL provided'
    };
  }

  try {
    // Extract the LinkedIn username from the URL
    const usernameMatch = linkedinUrl.match(/linkedin\.com\/in\/([^\/\?]+)/);
    const username = usernameMatch ? usernameMatch[1] : null;

    // Build a targeted search query
    const searchQuery = name
      ? `"${name}" site:linkedin.com/in/${username || ''}`
      : `site:linkedin.com/in/${username || ''}`;

    console.log(`📷 LinkedIn Photo Search: ${searchQuery}`);

    const url = new URL(GOOGLE_SEARCH_API);
    url.searchParams.append('key', apiKey);
    url.searchParams.append('cx', searchEngineId);
    url.searchParams.append('q', searchQuery);
    url.searchParams.append('num', '3');

    const response = await fetch(url.toString());

    if (!response.ok) {
      console.error(`Google Search API error: ${response.status}`);
      return {
        success: false,
        photoUrl: null,
        message: `Google API error: ${response.status}`
      };
    }

    const data = await response.json();
    const items = data.items || [];

    // Look for the matching LinkedIn profile and extract photo
    for (const item of items) {
      const link = item.link || '';

      // Must be the correct LinkedIn profile
      if (link.includes('linkedin.com/in/')) {
        const photoUrl = extractPhotoFromSearchResult(item);

        if (photoUrl) {
          console.log(`✅ LinkedIn photo found: ${photoUrl}`);
          return {
            success: true,
            photoUrl,
            message: 'Photo found via Google search'
          };
        }
      }
    }

    return {
      success: false,
      photoUrl: null,
      message: 'No photo found in search results'
    };

  } catch (err) {
    console.error('LinkedIn photo search failed:', err.message);
    return {
      success: false,
      photoUrl: null,
      message: err.message
    };
  }
}
