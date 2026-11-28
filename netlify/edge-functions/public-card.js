/**
 * Netlify Edge Function: the public My Card page, /c/<id>, with /c/<id>/contact.vcf and /c/<id>/photo.jpg.
 *
 * No account, no cookies, no scripts, no trackers. It reads ONE document, publicCards/<id>, through
 * Firestore's public REST endpoint with no key, and builds the page, the .vcf, the photo and the preview
 * tags from it alone (lib/publicCard.js). It never reads the private card.
 *
 * ENVIRONMENT (per deploy context; see netlify.toml)
 *   MY_CARD_SHARING_ENABLED     must be exactly "true" or every /c/* path returns the unavailable page.
 *                               On in branch and preview deploys, OFF in production until release approval.
 *   MY_CARD_FIREBASE_PROJECT_ID the project whose publicCards to read; falls back to VITE_FIREBASE_PROJECT_ID,
 *                               then FIREBASE_PROJECT_ID. Staging links read staging data.
 *
 * EVERY response, hit or miss, carries Cache-Control/Netlify-CDN-Cache-Control: no-store,
 * X-Robots-Tag: noindex and Referrer-Policy: no-referrer. Every miss is the same page with the same
 * status and headers, so nothing tells an unknown ID from a retired or taken-down one.
 */
import { SECURITY_HEADERS, ID_PATTERN, fetchPublicDocument, parsePublicCard, photoBytes, projectIdFrom, renderCard, renderUnavailable } from './lib/publicCard.js';
import { buildPublicVCard, vcardFileName } from './lib/vcard.js';

/* global Netlify, Deno, process */
const readEnv = (name) => {
  try {
    if (typeof Netlify !== 'undefined' && Netlify.env) return Netlify.env.get(name) || '';
  } catch { /* fall through */ }
  try {
    if (typeof Deno !== 'undefined') return Deno.env.get(name) || '';
  } catch { /* fall through */ }
  return (typeof process !== 'undefined' && process.env && process.env[name]) || '';
};

const respond = (body, contentType, status = 200, extra = {}) => new Response(body, {
  status,
  headers: { ...SECURITY_HEADERS, 'Content-Type': contentType, ...extra },
});

/** The same response for every miss. 404 and one body, whatever the reason. */
const unavailable = () => respond(renderUnavailable(), 'text/html; charset=utf-8', 404);

/** @param {Request} request  @param {{ getEnv?: Function, fetchImpl?: Function }} [options] for tests */
export async function handle(request, { getEnv = readEnv, fetchImpl = fetch } = {}) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return unavailable();
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/c\/([^/]+?)(?:\/(contact\.vcf|photo\.jpg))?\/?$/);
  if (!match || !ID_PATTERN.test(match[1])) return unavailable();
  if (getEnv('MY_CARD_SHARING_ENABLED') !== 'true') return unavailable();
  const [, id, asset] = match;

  const doc = await fetchPublicDocument(id, { projectId: projectIdFrom(getEnv), fetchImpl });
  const card = parsePublicCard(doc);
  if (!card) return unavailable();

  if (asset === 'contact.vcf') {
    return respond(buildPublicVCard(card), 'text/vcard; charset=utf-8', 200, {
      'Content-Disposition': `attachment; filename="${vcardFileName(card.name)}"`,
    });
  }
  if (asset === 'photo.jpg') {
    const bytes = photoBytes(card);
    return bytes ? respond(bytes, 'image/jpeg') : unavailable();
  }
  return respond(renderCard(card, { origin: url.origin, id }), 'text/html; charset=utf-8');
}

export default (request) => handle(request);

export const config = {
  path: ['/c/*'],
  // Netlify rate limiting covers this function only, not direct Firestore REST reads.
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
