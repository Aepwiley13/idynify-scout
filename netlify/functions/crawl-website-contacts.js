import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './utils/logApiUsage.js';
import { MODEL_DEEP } from './utils/models.js';
import { load } from 'cheerio';

export async function handler(event, context) {
  const startTime = Date.now();
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

    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeApiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'AI service not configured' })
      };
    }

    // Verify Firebase Auth
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
    const pageLabels = ['homepage', 'contact', 'about'];
    const pagePaths = ['', '/contact', '/about'];
    const rawResults = await Promise.all(
      pagePaths.map(path =>
        fetch(`https://${domain}${path}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research-bot/1.0)' },
          signal: AbortSignal.timeout(8000)
        })
        .then(r => r.text())
        .catch(() => '')
      )
    );

    // Extract visible text from each page for Barry
    const pageTexts = rawResults.map((html, i) => {
      if (!html) return '';
      const $ = load(html);
      $('script, style, noscript, svg, iframe').remove();
      const text = $('body').text().replace(/\s+/g, ' ').trim();
      return text.slice(0, 8000);
    });

    // Extract emails (keep this — Barry can't click mailto links)
    const allHTML = rawResults.join(' ');
    const emails = extractEmailsFromHTML(allHTML, domain);

    // Extract social links from the HTML
    const socialLinks = extractSocialLinks(allHTML);

    // Extract logo from meta tags / link tags
    const $ = load(rawResults[0]);
    const ogImage = $('meta[property="og:image"]').attr('content') || '';
    const favicon = $('link[rel="icon"], link[rel="shortcut icon"]').attr('href') || '';

    const siteContent = pageLabels
      .map((label, i) => pageTexts[i] ? `--- ${label.toUpperCase()} PAGE ---\n${pageTexts[i]}` : '')
      .filter(Boolean)
      .join('\n\n');

    if (!siteContent.trim()) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          error: "Couldn't load the website. Check the URL and try again."
        })
      };
    }

    console.log('🐻 Barry analyzing website content...');

    const anthropic = new Anthropic({ apiKey: claudeApiKey });

    const prompt = `You are Barry, an AI research assistant. A user pasted a website URL and you need to build a company profile card from the website content below — the same quality as what a sales intelligence database would provide.

Website: ${domain}
URL: ${normalizedUrl}
${emails.length > 0 ? `Emails found on website: ${emails.join(', ')}` : 'No emails found on website.'}
${socialLinks.linkedin ? `LinkedIn found on website: ${socialLinks.linkedin}` : ''}

--- WEBSITE CONTENT ---
${siteContent}
--- END ---

Extract as much company information as you can find. For fields you cannot determine from the content, use null.

Respond ONLY with valid JSON in this exact format:
{
  "name": "Company Name",
  "industry": "Their industry (e.g., Email Marketing, SaaS, Consulting)",
  "employee_count": 25,
  "revenue": "$5M" or null,
  "founded_year": 2018 or null,
  "phone": "+1-555-123-4567" or null,
  "linkedin_url": "https://linkedin.com/company/..." or null,
  "location": "City, State" or "City, Country",
  "description": "1-2 sentence company description — what they do and who they serve",
  "barry_intel": "2-3 sentences of sales intelligence — what makes this company interesting as a prospect, their market position, growth signals, or anything a salesperson should know before reaching out"
}`;

    const claudeResponse = await anthropic.messages.create({
      model: MODEL_DEEP,
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = claudeResponse.content[0].text;
    console.log('🐻 Barry response:', responseText);

    let barryAnalysis;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        barryAnalysis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Error parsing Barry response:', parseError);
      const ogSiteName = $('meta[property="og:site_name"]').attr('content');
      const pageTitle = $('title').text().trim();
      barryAnalysis = {
        name: ogSiteName || (pageTitle ? pageTitle.split(/[|\-–—]/)[0].trim() : '') || domain,
        industry: null,
        employee_count: null,
        revenue: null,
        founded_year: null,
        phone: null,
        linkedin_url: socialLinks.linkedin || null,
        location: null,
        description: null,
        barry_intel: null,
      };
    }

    // Resolve logo URL to absolute
    let logoUrl = null;
    if (ogImage) {
      try {
        logoUrl = new URL(ogImage, normalizedUrl).href;
      } catch { /* ignore */ }
    }

    const company = {
      companyName: barryAnalysis.name || domain,
      domain,
      websiteUrl: normalizedUrl,
      email: emails[0] || null,
      industry: barryAnalysis.industry || null,
      employee_count: barryAnalysis.employee_count || null,
      revenue: barryAnalysis.revenue || null,
      founded_year: barryAnalysis.founded_year || null,
      phone: barryAnalysis.phone || null,
      linkedin_url: barryAnalysis.linkedin_url || socialLinks.linkedin || null,
      location: barryAnalysis.location || null,
      description: barryAnalysis.description || null,
      barry_intel: barryAnalysis.barry_intel || null,
      logo_url: logoUrl,
      confidence: 'barry_analyzed',
    };

    console.log(`✅ Barry analysis complete for ${domain}`);

    const responseTime = Date.now() - startTime;
    try {
      await logApiUsage(userId, 'crawlWebsiteContacts', 'success', {
        provider: 'anthropic',
        model: MODEL_DEEP,
        usage: claudeResponse?.usage,
        responseTime,
        metadata: {
          domain,
          emailsFound: emails.length,
          fieldsExtracted: Object.values(company).filter(v => v != null).length
        }
      });
    } catch (err) {
      console.warn('⚠️ Failed to log API usage:', err);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, contact: company })
    };

  } catch (error) {
    console.error('❌ Crawl error:', error.message);

    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(userId, 'crawlWebsiteContacts', 'error', {
          provider: 'anthropic',
          model: MODEL_DEEP,
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
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to analyze website'
      })
    };
  }
}

function extractEmailsFromHTML(html, domain) {
  const $ = load(html);
  const emails = new Set();

  $('a[href^="mailto:"]').each((_, el) => {
    const email = $(el).attr('href').replace('mailto:', '').split('?')[0].trim();
    if (email.includes('@')) emails.add(email.toLowerCase());
  });

  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = html.match(emailRegex) || [];
  matches.forEach(email => {
    if (!email.includes('.png') && !email.includes('.jpg') && !email.includes('.svg')) {
      emails.add(email.toLowerCase());
    }
  });

  const domainEmails = [...emails].filter(e => e.includes(domain));
  return domainEmails.length > 0 ? domainEmails : [...emails];
}

function extractSocialLinks(html) {
  const links = { linkedin: null };
  const linkedinMatch = html.match(/https?:\/\/(www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9_-]+\/?/);
  if (linkedinMatch) links.linkedin = linkedinMatch[0];
  return links;
}
