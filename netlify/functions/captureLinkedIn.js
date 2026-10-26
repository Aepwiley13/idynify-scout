/**
 * captureLinkedIn — likely LinkedIn profiles for a person just added through
 * Scan Business Card. Read-only: it finds and ranks profiles, and a person
 * confirms which one is them. Nothing here writes to a contact.
 *
 *   POST  Authorization: Bearer <Firebase ID token>
 *   { userId, person: { name, company?, title?, domain?, email?, location? } }
 *
 *   200 { candidates: [{ linkedinUrl, name, headline, company, location, photoUrl,
 *                        sources, strength, reasons }] }      at most three, best first
 *
 * Two existing sources, each optional:
 *   Apollo people/match         name with the email, company or domain → one person record
 *   Google Custom Search        linkedinSearch.searchLinkedInCandidates → profiles in the index
 * One failing does not stop the other. 503 `unavailable` only when every
 * source that ran failed, or none is configured. Ranking and the reasons
 * shown are utils/capture/linkedinCandidates.js.
 *
 * Gated like captureExtract: the token's own user only, and only when the
 * capture mode covers them. Logs through captureLog only: outcome codes,
 * counts and source names, never a name, email, company, title or URL.
 */
import process from 'node:process';
import { admin, db } from './firebase-admin.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { checkAdminAccess } from './utils/adminAuth.js';
import { checkSuperAdminAccess } from './utils/superAdminAuth.js';
import { resolveCaptureConfig, isEnrolled } from './utils/captureFlags.js';
import { logApiUsage } from './utils/logApiUsage.js';
import { APOLLO_ENDPOINTS, getApolloHeaders } from './utils/apolloConstants.js';
import { searchLinkedInCandidates } from './utils/linkedinSearch.js';
import { rankLinkedInCandidates } from './utils/capture/linkedinCandidates.js';
import { captureLog } from './utils/capture/captureLog.js';

export const OPERATION = 'captureLinkedIn';

const HEADERS = Object.freeze({
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
});

export const STATUS = Object.freeze({
  method_not_allowed: 405,
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  capture_disabled: 404,
  unavailable: 503,
  internal_error: 500,
});

const USER_ID = /^[A-Za-z0-9_-]{1,128}$/;
const PERSON_FIELDS = Object.freeze(['name', 'company', 'title', 'domain', 'email', 'location']);
const MAX_FIELD = 300;

function respond(statusCode, payload) {
  return { statusCode, headers: { ...HEADERS }, body: JSON.stringify(payload) };
}

function failure(code, { reason, log = {} } = {}) {
  const status = STATUS[code] ?? 500;
  captureLog('linkedin', { outcome: code, httpStatus: status, reason, ...log }, { level: status >= 500 ? 'error' : 'warn' });
  return respond(status, { error: code, ...(reason ? { reason } : {}) });
}

/** The person to look for: short strings only, and a name. */
export function readPerson(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const person = {};
  for (const key of PERSON_FIELDS) {
    const value = raw[key];
    if (value === undefined || value === null) { person[key] = null; continue; }
    if (typeof value !== 'string' || value.length > MAX_FIELD) return null;
    person[key] = value.replace(/\s+/g, ' ').trim() || null;
  }
  return person.name ? person : null;
}

/** Admins and super admins, through the existing checks. */
async function isCaptureAdmin(uid) {
  return (await checkAdminAccess(uid)) || (await checkSuperAdminAccess(uid));
}

/**
 * Apollo's one best person record for this name with the email, company or
 * domain. Only a record with a LinkedIn URL is a profile to offer.
 */
async function apolloProfile(person) {
  if (!process.env.APOLLO_API_KEY) return { ran: false, failed: false, found: [] };
  const [first, ...rest] = person.name.split(' ');
  const last = rest.join(' ');
  if (!first || !last) return { ran: false, failed: false, found: [] };

  const body = { first_name: first, last_name: last };
  if (person.email) body.email = person.email;
  if (person.company) body.organization_name = person.company;
  if (person.domain) body.domain = person.domain;
  try {
    const response = await fetch(APOLLO_ENDPOINTS.PEOPLE_MATCH, { method: 'POST', headers: getApolloHeaders(), body: JSON.stringify(body) });
    if (response.status === 404) return { ran: true, failed: false, found: [] };
    if (!response.ok) return { ran: true, failed: true, found: [] };
    const match = (await response.json())?.person;
    if (!match?.linkedin_url) return { ran: true, failed: false, found: [] };
    return {
      ran: true,
      failed: false,
      found: [{
        source: 'apollo',
        linkedinUrl: match.linkedin_url,
        name: match.name || [match.first_name, match.last_name].filter(Boolean).join(' ') || null,
        headline: match.headline || match.title || null,
        company: match.organization?.name || match.organization_name || null,
        companyDomain: match.organization?.primary_domain || null,
        location: [match.city, match.state].filter(Boolean).join(', ') || match.country || null,
        photoUrl: match.photo_url || null,
        text: [match.title, match.headline].filter(Boolean).join(' '),
      }],
    };
  } catch {
    return { ran: true, failed: true, found: [] };
  }
}

export const handler = async (event) => {
  const startedAt = Date.now();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { ...HEADERS }, body: '' };
  if (event.httpMethod !== 'POST') return failure('method_not_allowed');

  let body;
  try {
    body = JSON.parse(event.body || '');
  } catch {
    return failure('invalid_request');
  }
  const userId = body?.userId;
  if (typeof userId !== 'string' || !USER_ID.test(userId)) return failure('invalid_request');
  const person = readPerson(body?.person);
  if (!person) return failure('invalid_request');

  const authToken = extractAuthToken(event);
  if (!authToken) return failure('unauthorized');
  let uid;
  try {
    uid = (await admin.auth().verifyIdToken(authToken)).uid;
  } catch {
    return failure('unauthorized');
  }
  if (uid !== userId) return failure('forbidden');

  try {
    const config = await resolveCaptureConfig(uid, {
      env: process.env,
      isAdmin: isCaptureAdmin,
      enrolled: id => isEnrolled(db, id),
    });
    if (!config.enabled) return failure('capture_disabled');

    const [apollo, search] = await Promise.all([
      apolloProfile(person),
      searchLinkedInCandidates({ name: person.name, company: person.company, title: person.title, domain: person.domain, env: process.env }),
    ]);
    const sources = [...(apollo.ran ? ['apollo'] : []), ...(search.configured ? ['search'] : [])];
    const failed = [...(apollo.failed ? ['apollo'] : []), ...(search.failed ? ['search'] : [])];
    if (sources.length === 0) return failure('unavailable', { reason: 'not_configured' });
    if (failed.length === sources.length) return failure('unavailable', { reason: 'sources_failed', log: { sources } });

    const candidates = rankLinkedInCandidates(person, [
      ...apollo.found,
      ...search.results.map(result => ({ ...result, source: 'search' })),
    ]);
    const totalMs = Date.now() - startedAt;
    captureLog('linkedin', { outcome: 'ok', httpStatus: 200, candidates: candidates.length, sources, totalMs });
    await logApiUsage(uid, OPERATION, 'success', {
      responseTime: totalMs,
      metadata: { candidates: candidates.length, sources, failedSources: failed },
    });
    return respond(200, { candidates });
  } catch {
    return failure('internal_error');
  }
};

export default { handler };
