import { logApiUsage } from './utils/logApiUsage.js';
import { load } from 'cheerio';

const SCRAPE_PATHS = ['', '/about', '/pricing', '/solutions', '/customers', '/services'];
const MAX_BODY_TEXT = 8000;
const FETCH_TIMEOUT = 6000;

export async function handler(event) {
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

    const normalizedUrl = websiteUrl.startsWith('http') ? websiteUrl.trim() : `https://${websiteUrl.trim()}`;
    let domain;
    try {
      const url = new URL(normalizedUrl);
      domain = url.hostname.replace('www.', '');
    } catch {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Invalid website URL' })
      };
    }

    console.log('🌐 Crawling website content:', domain);

    const pageResults = await Promise.all(
      SCRAPE_PATHS.map(path =>
        fetch(`https://${domain}${path}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research-bot/1.0)' },
          signal: AbortSignal.timeout(FETCH_TIMEOUT)
        })
        .then(r => r.ok ? r.text() : '')
        .catch(() => '')
      )
    );

    const homepageHTML = pageResults[0];
    if (!homepageHTML) {
      return {
        statusCode: 422,
        headers,
        body: JSON.stringify({ success: false, error: 'Could not reach website' })
      };
    }

    const $ = load(homepageHTML);
    const ogSiteName = $('meta[property="og:site_name"]').attr('content');
    const pageTitle = $('title').text().trim();
    const companyName = ogSiteName ||
      (pageTitle ? pageTitle.split(/[|\-–—]/)[0].trim() : '') ||
      domain;

    const metaDescription = $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') || '';

    const headings = [];
    $('h1, h2').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length < 200) headings.push(text);
    });

    let bodyTextSample = '';
    const allHTML = pageResults.join('\n');
    const $all = load(allHTML);
    $all('script, style, nav, footer, header').remove();
    bodyTextSample = $all('body').text()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_BODY_TEXT);

    const pricingIndicators = [];
    const pricingHTML = pageResults[2] || '';
    if (pricingHTML) {
      const $p = load(pricingHTML);
      $p('[class*="price"], [class*="plan"], [class*="tier"]').each((_, el) => {
        const text = $p(el).text().trim().slice(0, 100);
        if (text) pricingIndicators.push(text);
      });
    }
    if (pricingIndicators.length === 0) {
      const priceMatches = allHTML.match(/\$[\d,]+(?:\/mo|\/month|\/yr|\/year)?/gi) || [];
      pricingIndicators.push(...priceMatches.slice(0, 5));
    }

    const customerLogos = [];
    const customersHTML = pageResults[4] || homepageHTML;
    const $c = load(customersHTML);
    $c('img[alt]').each((_, el) => {
      const alt = $c(el).attr('alt')?.trim();
      const src = ($c(el).attr('src') || '').toLowerCase();
      if (alt && alt.length > 2 && alt.length < 60 &&
          (src.includes('logo') || src.includes('customer') || src.includes('client') ||
           $c(el).closest('[class*="logo"], [class*="customer"], [class*="client"], [class*="partner"]').length > 0)) {
        customerLogos.push(alt);
      }
    });

    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = [...new Set(
      (allHTML.match(emailRegex) || [])
        .filter(e => !e.includes('.png') && !e.includes('.jpg') && !e.includes('.svg'))
        .map(e => e.toLowerCase())
    )];

    console.log(`✅ Content crawl complete for ${domain}: ${headings.length} headings, ${customerLogos.length} logos`);

    try {
      await logApiUsage(userId, 'crawlWebsiteContent', 'success', {
        metadata: { domain, headingsFound: headings.length, bodyLength: bodyTextSample.length }
      });
    } catch (err) {
      console.warn('⚠️ Failed to log API usage:', err);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        content: {
          companyName,
          domain,
          metaDescription,
          headings: headings.slice(0, 20),
          bodyTextSample,
          pricingIndicators: pricingIndicators.slice(0, 10),
          customerLogos: [...new Set(customerLogos)].slice(0, 15),
          emails: emails.slice(0, 5)
        }
      })
    };

  } catch (error) {
    console.error('❌ Content crawl error:', error.message);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to crawl website content'
      })
    };
  }
}
