/**
 * extractBusinessCard — DEPRECATED. The legacy business-card OCR endpoint.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  NOTHING IN THE APP CALLS THIS ANY MORE. EVERY CALL IS UNEXPECTED.       ║
 * ║                                                                          ║
 * ║  Its one client, BusinessCardCapture, is not reachable from any screen.  ║
 * ║  The endpoint stays deployed only until we can show that nothing outside ║
 * ║  this repo depends on it. Deletion is a separate PR with its own         ║
 * ║  criteria: docs/deprecations/legacy-business-card-endpoint.md            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * WHAT CHANGED WHEN IT WAS LOCKED DOWN, AND WHY
 * ─────────────────────────────────────────────
 * - It logged the card itself: Vision's raw response, the first 200
 *   characters of OCR text, and the parsed name, email, phone and company. It
 *   also logged whole error objects, which can carry the request URL, and the
 *   Vision API key travels in that URL's query string. Every request now
 *   writes one structured line (LOG_EVENT) of outcome, sizes and counts —
 *   never values.
 * - Auth went through the Identity Toolkit REST lookup. It now uses the Admin
 *   SDK like the other functions, but deliberately NOT verifyAuthToken: that
 *   helper lets any admin act as any user. Here the token's user must be the
 *   requested user, so admin impersonation is refused with a 403. It was
 *   always refused in effect, by accident, as a 500.
 * - Every failure was a 500 carrying the raw error message, Vision's response
 *   body included. Each failure now has its own status and a stable `code`,
 *   and the messages say nothing about internals.
 * - logApiUsage defaults the provider to Apollo, so every scan was booked as
 *   APOLLO_EXTRACTBUSINESSCARD at one Apollo credit. It is a Google Vision
 *   call. New rows are GOOGLE_EXTRACTBUSINESSCARD at zero credits; historical
 *   rows are left exactly as they are.
 * - Any call raises a throttled ops alert, because any call means a caller we
 *   do not know about.
 *
 * WHAT DID NOT CHANGE
 * ───────────────────
 * The success response (`success`, `extractedData`, `rawText`) and
 * parseBusinessCardText are exactly as they were, so a caller we have not yet
 * found keeps working while we look for it.
 */

import { admin, db } from './firebase-admin.js';
import { logApiUsage } from './utils/logApiUsage.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { alertOps } from './utils/alertOps.js';

const OPERATION = 'extractBusinessCard';
const ENDPOINT_PATH = '/.netlify/functions/extractBusinessCard';

/** The one structured line every request writes. Search the function log for it. */
export const LOG_EVENT = 'legacy_endpoint.extractBusinessCard';

/**
 * Kill switch. Only the value 'off' (trimmed, any case) disables the endpoint.
 * Unset or anything else leaves it on — how it behaved before — so a typo
 * keeps the status quo instead of breaking a caller we have not found yet.
 * Netlify applies a changed environment variable on the next deploy.
 */
export const KILL_SWITCH_ENV = 'LEGACY_CARD_SCAN_ENDPOINT';

/**
 * RFC 9745 `Deprecation` header: an RFC 9651 Date, "@" + Unix seconds.
 * 1791936000 is 2026-10-14T00:00:00Z, the day this endpoint was deprecated.
 */
export const DEPRECATION_HEADER = '@1791936000';

export const CODES = Object.freeze({
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  USER_MISMATCH: 'USER_MISMATCH',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  NO_TEXT_FOUND: 'NO_TEXT_FOUND',
  UPSTREAM_OCR_FAILURE: 'UPSTREAM_OCR_FAILURE',
  LEGACY_ENDPOINT_DISABLED: 'LEGACY_ENDPOINT_DISABLED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

/** The outcome recorded for a successful extraction. Never sent as a `code`. */
export const SUCCESS = 'SUCCESS';

/** The steps a request passes through, in order. Telemetry records the last one reached. */
export const STAGES = Object.freeze({
  REQUEST: 'request',   // kill switch, method, body validation
  AUTH: 'auth',         // token present and verified, user match
  CONFIG: 'config',     // Vision key present
  OCR: 'ocr',           // the Vision call
  PARSE: 'parse',       // parseBusinessCardText
  USAGE: 'usage',       // the apiLogs row
  RESPOND: 'respond',
});

// Generic on purpose: no provider, variable or step is named. NO_TEXT_FOUND
// keeps the wording the old client already shows its users.
const FAILURES = {
  [CODES.INVALID_REQUEST]:          { status: 400, message: 'Invalid request.' },
  [CODES.UNAUTHORIZED]:             { status: 401, message: 'Authentication required.' },
  [CODES.USER_MISMATCH]:            { status: 403, message: 'Not permitted.' },
  [CODES.METHOD_NOT_ALLOWED]:       { status: 405, message: 'Method not allowed.' },
  [CODES.LEGACY_ENDPOINT_DISABLED]: { status: 410, message: 'This endpoint is no longer available.' },
  [CODES.NO_TEXT_FOUND]:            { status: 422, message: 'No text found in image. Please try a clearer photo.' },
  [CODES.INTERNAL_ERROR]:           { status: 500, message: 'Something went wrong. Please try again.' },
  [CODES.UPSTREAM_OCR_FAILURE]:     { status: 502, message: 'The card could not be read. Please try again or enter the details manually.' },
};

/**
 * At most one alert per hour per key — alertOps' own cooldown, kept in
 * ops_alerts/{key}. Two keys, so a stream of unauthenticated probes cannot
 * hold the cooldown and hide a real signed-in caller for an hour.
 */
export const ALERT_JOBS = Object.freeze({
  AUTHENTICATED: 'extractBusinessCard.legacy.authenticated',
  UNAUTHENTICATED: 'extractBusinessCard.legacy.unauthenticated',
});

/**
 * The alert is awaited, because a function can be frozen as soon as it
 * returns, but never for longer than this. alertOps' own send timeout is 10s,
 * and a caller should not wait that long on a notification about itself.
 */
export const ALERT_BUDGET_MS = 3000;

const HEADERS = Object.freeze({
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  Deprecation: DEPRECATION_HEADER,
});

function respond(statusCode, payload) {
  return { statusCode, headers: { ...HEADERS }, body: JSON.stringify(payload) };
}

function failure(code) {
  const { status, message } = FAILURES[code];
  return respond(status, { success: false, error: message, code });
}

function isDisabled(env = process.env) {
  return String(env[KILL_SWITCH_ENV] ?? '').trim().toLowerCase() === 'off';
}

/** Netlify's request id, so a log line and an alert can be matched up. */
function requestIdOf(event, context) {
  return event.headers?.['x-nf-request-id'] || context?.awsRequestId || null;
}

/**
 * Host only, never the whole Origin or Referer. A URL can carry credentials
 * (user:pass@) or identifiers in its path and query; URL#host has none of
 * them by definition.
 */
function originHostOf(headers = {}) {
  const raw = headers.origin || headers.Origin || headers.referer || headers.Referer;
  if (!raw) return null;
  try {
    return new URL(raw).host.slice(0, 253) || null;
  } catch {
    return null;
  }
}

async function alertUnexpectedUse(record) {
  const job = record.authenticated ? ALERT_JOBS.AUTHENTICATED : ALERT_JOBS.UNAUTHENTICATED;
  let timer;
  const budget = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ sent: false, reason: 'alert_budget_exceeded' }), ALERT_BUDGET_MS);
  });
  try {
    const result = await Promise.race([
      alertOps({
        db,
        job,
        severity: 'unexpected_use',
        summary: 'The deprecated legacy business-card endpoint was called. Nothing in the app calls it, '
          + 'so the caller needs to be found. See docs/deprecations/legacy-business-card-endpoint.md.',
        // Request envelope only: no card content, no token, no key, no upstream
        // response, and no user identifier. When the caller was verified, the
        // GOOGLE_EXTRACTBUSINESSCARD apiLogs row at this timestamp names them.
        detail: {
          endpoint: ENDPOINT_PATH,
          requestId: record.requestId ?? 'n/a',
          timestamp: record.timestamp,
          outcome: record.outcome,
          status: record.status,
          originHost: record.originHost ?? 'n/a',
          authenticated: record.authenticated,
          userMismatch: record.userMismatch,
        },
      }),
      budget,
    ]);
    return { job, ...result };
  } finally {
    clearTimeout(timer);
  }
}

export const handler = async (event, context) => {
  const startedAt = Date.now();
  const telemetry = {
    requestId: requestIdOf(event, context),
    originHost: originHostOf(event.headers),
    // The last step the request reached (STAGES). With errorName, it is what
    // makes an INTERNAL_ERROR diagnosable without logging a single value.
    stage: STAGES.REQUEST,
    authenticated: false,
    userMismatch: false,
    uid: null,
  };

  const finish = async (response, outcome, extra = {}) => {
    const record = {
      ...telemetry,
      ...extra,
      outcome,
      status: response.statusCode,
      timestamp: new Date().toISOString(),
      ms: Date.now() - startedAt,
    };
    const alert = await alertUnexpectedUse(record);
    // Written whether or not an alert went out: the alert is throttled, this line is not.
    console.warn(LOG_EVENT, { ...record, alertJob: alert.job, alert: alert.sent ? 'sent' : alert.reason });
    return response;
  };

  // Kill switch first: no parsing, no auth, no Vision call, no card processing.
  if (isDisabled()) {
    return finish(failure(CODES.LEGACY_ENDPOINT_DISABLED), CODES.LEGACY_ENDPOINT_DISABLED);
  }

  if (event.httpMethod !== 'POST') {
    return finish(failure(CODES.METHOD_NOT_ALLOWED), CODES.METHOD_NOT_ALLOWED);
  }

  try {
    let body;
    try {
      body = JSON.parse(event.body || '');
    } catch {
      return finish(failure(CODES.INVALID_REQUEST), CODES.INVALID_REQUEST);
    }

    const userId = body?.userId;
    const imageBase64 = body?.imageBase64;
    if (typeof userId !== 'string' || !userId || typeof imageBase64 !== 'string' || !imageBase64) {
      return finish(failure(CODES.INVALID_REQUEST), CODES.INVALID_REQUEST);
    }

    telemetry.stage = STAGES.AUTH;
    const authToken = extractAuthToken(event);
    if (!authToken) {
      return finish(failure(CODES.UNAUTHORIZED), CODES.UNAUTHORIZED);
    }

    let tokenUid;
    try {
      tokenUid = (await admin.auth().verifyIdToken(authToken)).uid;
    } catch {
      return finish(failure(CODES.UNAUTHORIZED), CODES.UNAUTHORIZED);
    }
    telemetry.authenticated = true;
    // The verified identity only. The body's userId is a claim and is never recorded.
    telemetry.uid = tokenUid;

    // From here every outcome is attributable, so each one also gets an apiLogs
    // row under the verified user, as a successful scan always did.
    const settle = async (code, extra = {}) => {
      await logApiUsage(tokenUid, OPERATION, 'error', {
        provider: 'google',
        responseTime: Date.now() - startedAt,
        errorCode: code,
        metadata: { legacy: true },
      });
      return finish(failure(code), code, extra);
    };

    // The token must belong to the requested user. Admin impersonation is
    // refused on purpose; see the header comment.
    if (tokenUid !== userId) {
      telemetry.userMismatch = true;
      return settle(CODES.USER_MISMATCH);
    }

    telemetry.stage = STAGES.CONFIG;
    const googleVisionApiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!googleVisionApiKey) {
      return settle(CODES.INTERNAL_ERROR, { errorName: 'ConfigMissing' });
    }

    // Remove data URL prefix if present
    const base64Image = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
    telemetry.imageChars = base64Image.length;

    telemetry.stage = STAGES.OCR;
    let visionData;
    try {
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
        // The body is never read: it is not logged and not returned.
        return settle(CODES.UPSTREAM_OCR_FAILURE, { upstreamStatus: visionResponse.status });
      }
      visionData = await visionResponse.json();
    } catch (err) {
      // Name only. A fetch error can carry the request URL, and the key is in it.
      return settle(CODES.UPSTREAM_OCR_FAILURE, { upstreamError: err?.name || 'Error' });
    }

    const annotation = visionData?.responses?.[0];
    // A per-image failure arrives inside a 200. Its numeric code is kept; its message is not.
    if (annotation?.error) {
      return settle(CODES.UPSTREAM_OCR_FAILURE, { upstreamStatus: annotation.error.code ?? null });
    }

    const fullText = annotation?.textAnnotations?.[0]?.description;
    if (!fullText) {
      return settle(CODES.NO_TEXT_FOUND);
    }

    // Parse text into structured contact fields
    telemetry.stage = STAGES.PARSE;
    const extractedData = parseBusinessCardText(fullText);
    const fieldsExtracted = Object.keys(extractedData).filter(k => extractedData[k]).length;
    telemetry.textChars = fullText.length;
    telemetry.fieldsExtracted = fieldsExtracted;

    telemetry.stage = STAGES.USAGE;
    await logApiUsage(tokenUid, OPERATION, 'success', {
      provider: 'google',
      responseTime: Date.now() - startedAt,
      metadata: { textLength: fullText.length, fieldsExtracted, legacy: true },
    });

    // The unchanged contract: the same three fields, with the same values.
    telemetry.stage = STAGES.RESPOND;
    return finish(respond(200, { success: true, extractedData, rawText: fullText }), SUCCESS);
  } catch (err) {
    // Name only, never the message or stack, for the same reason as above.
    return finish(failure(CODES.INTERNAL_ERROR), CODES.INTERNAL_ERROR, { errorName: err?.name || 'Error' });
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
