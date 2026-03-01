import { logApiUsage } from './utils/logApiUsage.js';
import { load } from 'cheerio';

/**
 * Crawl Website Contacts
 *
 * Takes a website URL, scrapes homepage + /contact + /about in parallel,
 * extracts email addresses, and returns a contact preview object.
 *
 * Auth + logging pattern mirrors search-companies-manual.js.
 */

export async function handler(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    const { userId, authToken, websiteUrl } = JSON.parse(event.body);

    if (!websiteUrl || !websiteUrl.trim()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Website URL is required' })
      };
    }

    if (!authToken || !userId) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ success: false, error: 'Authentication required' })
      };
    }

    // Verify Firebase Auth
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Server configuration error' })
      };
    }

    const verifyResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: authToken })
      }
    );

    if (!verifyResponse.ok) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ success: false, error: 'Invalid authentication token' })
      };
    }

    const verifyData = await verifyResponse.json();
    const tokenUserId = verifyData.users[0].localId;

    if (tokenUserId !== userId) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ success: false, error: 'Token does not match user ID' })
      };
    }

    // Clean and validate the URL
    const normalizedUrl = websiteUrl.startsWith('http') ? websiteUrl.trim() : `https://${websiteUrl.trim()}`;
    let url, domain;
    try {
      url = new URL(normalizedUrl);
      domain = url.hostname.replace('www.', '');
    } catch {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Invalid website URL' })
      };
    }

    console.log('🌐 Crawling website:', domain);

    // Fetch pages in parallel
    const pages = ['', '/contact', '/about'];
    const results = await Promise.all(
      pages.map(path =>
        fetch(`https://${domain}${path}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research-bot/1.0)' },
          signal: AbortSignal.timeout(5000)
        })
        .then(r => r.text())
        .catch(() => '') // fail silently per page
      )
    );

    // Extract emails from all pages combined
    const allHTML = results.join(' ');
    const emails = extractEmailsFromHTML(allHTML, domain);

    // Extract company name from <title> tag or og:site_name
    const firstPageHTML = results[0];
    const $ = load(firstPageHTML);
    const ogSiteName = $('meta[property="og:site_name"]').attr('content');
    const pageTitle = $('title').text().trim();
    const companyName = ogSiteName ||
      (pageTitle ? pageTitle.split(/[|\-–—]/)[0].trim() : '') ||
      domain;

    console.log(`✅ Crawl complete: ${emails.length} emails found for ${domain}`);

    // Log credit usage
    try {
      await logApiUsage(userId, 'crawlWebsiteContacts', 'success', {
        metadata: {
          domain,
          emailsFound: emails.length
        }
      });
    } catch (err) {
      console.warn('⚠️ Failed to log API usage:', err);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        contact: {
          companyName,
          domain,
          websiteUrl: normalizedUrl,
          email: emails[0] || null,
          emailSource: 'website',
          confidence: emails.length > 0 ? 'found' : 'not_found'
        }
      })
    };

  } catch (error) {
    console.error('❌ Crawl error:', error.message);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to crawl website'
      })
    };
  }
}

/**
 * Extract emails from HTML using cheerio and regex.
 * Prioritizes emails matching the domain.
 */
function extractEmailsFromHTML(html, domain) {
  const $ = load(html);
  const emails = new Set();

  // Method 1: mailto: links
  $('a[href^="mailto:"]').each((_, el) => {
    const email = $(el).attr('href').replace('mailto:', '').split('?')[0].trim();
    if (email.includes('@')) emails.add(email.toLowerCase());
  });

  // Method 2: regex scan of visible text and raw HTML
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = html.match(emailRegex) || [];
  matches.forEach(email => {
    // Filter out image/asset false positives
    if (!email.includes('.png') && !email.includes('.jpg') && !email.includes('.svg')) {
      emails.add(email.toLowerCase());
    }
  });

  // Method 3: prioritize emails matching the domain
  const domainEmails = [...emails].filter(e => e.includes(domain));
  return domainEmails.length > 0 ? domainEmails : [...emails];
}
