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
 * @returns {Object} - { success, linkedinUrl, confidence, searchQuery, message }
 */
export async function searchLinkedInProfile({ name, company, title, emailDomain }) {
  const apiKey = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
  const searchEngineId = process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID;

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
              console.log(`✅ LinkedIn found (${confidence}): ${linkedinUrl}`);
              return {
                success: true,
                linkedinUrl,
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
