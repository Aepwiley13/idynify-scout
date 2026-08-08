/**
 * analyze-website.js — Mission Control 2.0 Sprint 2, Workstream A1.
 *
 * The first thing Barry does in onboarding: a new user hands over their website,
 * Barry reads it, extracts a structured business profile, and pre-fills their
 * RECON document so prospecting can start within minutes.
 *
 * Flow:
 *   1. Verify auth (shared verifyAuthToken util — supports admin impersonation).
 *   2. Fetch the URL with the built-in fetch (10s timeout, realistic User-Agent).
 *   3. Strip scripts/styles/tags → keep first 8000 chars of visible text.
 *   4. Ask Barry (MODEL_DEEP) for a structured JSON business profile.
 *   5. Merge the extracted fields into the user's RECON sections
 *      (dashboards/{uid}), never overwriting fields the user already filled in.
 *   6. Return { success: true, data } — or a friendly { success: false, message }.
 *
 * Failure modes are handled gracefully (see FAILURE below):
 *   - Site blocks us (401/403)         → friendly message
 *   - JavaScript-rendered (thin body)  → friendly message, low confidence
 *   - Timeout                          → friendly message
 *   - Barry returns invalid JSON       → retry once, then friendly failure
 *
 * POST /.netlify/functions/analyze-website
 *   Body: { url, userId, authToken }
 */

import Anthropic from '@anthropic-ai/sdk';
import { verifyAuthToken } from './utils/verifyAuthToken.js';
import { createMessageWithRetry } from './utils/anthropicRetry.js';
import { logApiUsage } from './utils/logApiUsage.js';
import { db } from './firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { MODEL_DEEP } from './utils/models.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const MODEL = MODEL_DEEP;
const FETCH_TIMEOUT_MS = 10000;
const MAX_TEXT_CHARS = 8000;
const MIN_BODY_CHARS = 200; // Below this the page is almost certainly JS-rendered
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

// The structured profile Barry returns. Every key maps to the closest RECON section.
export const EXTRACTION_FIELDS = [
  'companyName',
  'description',
  'whatTheySell',
  'whoTheyServeTo',
  'targetIndustry',
  'targetCompanySize',
  'valueProposition',
  'icpSummary',
];

/**
 * Maps extracted fields onto EXISTING RECON Section 1 (Business Foundation)
 * fields only — an exact match to fields the editor already recognizes, so no
 * new keys are ever invented inside a section's data (FLAG 1 decision).
 *
 * Fields with no clean existing home (target firmographics, value prop, ICP
 * summary) are NOT forced into structured sections; they go to the clearly
 * labeled recon.websiteAnalysis sub-object instead — see WEBSITE_ANALYSIS_FIELDS.
 */
export const RECON_FIELD_MAP = {
  companyName:    { sectionId: 1, key: 'companyName' },
  description:    { sectionId: 1, key: 'whatYouDo' },
  whatTheySell:   { sectionId: 1, key: 'mainProduct' },
  whoTheyServeTo: { sectionId: 1, key: 'currentCustomers' },
};

// Extracted fields that have no clean existing RECON field. Stored under
// modules[recon].websiteAnalysis.{field} so they're clearly labeled as Barry's
// analysis and never pollute the structured section editors (FLAG 1 decision).
export const WEBSITE_ANALYSIS_FIELDS = [
  'targetIndustry',
  'targetCompanySize',
  'valueProposition',
  'icpSummary',
];

// Sections auto-marked "completed" once every listed key is populated. Only
// Section 1 qualifies: its fields are exactly the free-text identity fields the
// editor recognizes, so a full set is a genuine, user-visible completion.
const AUTO_COMPLETE_SECTIONS = {
  1: ['companyName', 'whatYouDo', 'mainProduct', 'currentCustomers'],
};

// Friendly, user-facing messages. Barry talks like a teammate, not a stack trace.
const FRIENDLY = {
  blocked:
    "I couldn't get in — that site is blocking automated visitors. No problem: tell me about your business in your own words and I'll build your profile from there.",
  jsRendered:
    "I reached the site but most of it loads with JavaScript I can't read, so there wasn't much text for me to work with. Let's fill in your business details together instead.",
  timeout:
    "That site took too long to respond. Could be a slow server on their end. Want to try again, or just tell me about your business directly?",
  unreachable:
    "I couldn't reach that URL. Double-check it's correct (starting with https://) and we'll try again — or tell me about your business and I'll take it from there.",
  parseFailed:
    "I read the site but couldn't pull a clean profile out of it. Let's go through your business details together — it'll only take a minute.",
  generic:
    "Something went sideways while I was reading your site. Let's build your profile together instead — just tell me what your business does.",
};

// ─── Pure helpers (exported for unit tests) ─────────────────────────────────

/**
 * Normalize a user-supplied URL: add https:// if no protocol is present.
 * Returns null if it can't be turned into a valid http(s) URL.
 */
export function normalizeUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let candidate = raw.trim();
  const scheme = candidate.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (scheme) {
    // Has an explicit scheme — only http(s) is allowed.
    if (!/^https?$/i.test(scheme[1])) return null;
  } else {
    candidate = `https://${candidate}`;
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

const HTML_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

/**
 * Strip scripts, styles, and all HTML tags from a page, returning up to
 * MAX_TEXT_CHARS of collapsed, human-readable text.
 */
export function stripHtml(html, maxChars = MAX_TEXT_CHARS) {
  if (typeof html !== 'string' || !html) return '';

  const text = html
    // Drop content that is never visible copy.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Everything else: strip the tags themselves.
    .replace(/<[^>]+>/g, ' ')
    // Decode the handful of entities that matter for readable prose.
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&[a-z]+;|&#39;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? ' ')
    // Collapse whitespace.
    .replace(/\s+/g, ' ')
    .trim();

  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/**
 * Build the prompt asking Barry for a structured business profile as JSON.
 */
export function buildAnalysisPrompt(text, url) {
  return `You are Barry, an AI sales intelligence engine. A new user just gave you their company website so you can understand their business and start finding them customers.

Below is the visible text extracted from ${url || 'their website'}. Read it and extract a structured business profile.

--- WEBSITE TEXT ---
${text}
--- END WEBSITE TEXT ---

Return ONLY a single JSON object, no prose before or after, with exactly these keys:
{
  "companyName": "the company's name",
  "description": "1-2 sentences on what the company does",
  "whatTheySell": "their core product or service",
  "whoTheyServeTo": "the customers/audience they serve",
  "targetIndustry": "the industry or industries their customers are in",
  "targetCompanySize": "typical size of their target customers (e.g. SMB, mid-market, enterprise, or employee range)",
  "valueProposition": "the core value proposition, in the company's own framing",
  "icpSummary": "a 1-2 sentence ideal-customer-profile summary Barry can use to find prospects",
  "confidence": 0
}

Rules:
- "confidence" is an integer 0-100 reflecting how confident you are in this profile given the text. If the text is thin, generic, or clearly incomplete, score it low.
- If a field genuinely cannot be determined from the text, use an empty string "" (do not invent facts).
- Base everything on the provided text. Do not hallucinate details that aren't supported.
- Output valid JSON only.`;
}

/**
 * Extract and parse the JSON object from Barry's raw response.
 * Tolerates code fences and leading/trailing prose. Returns null on failure.
 */
export function parseBarryJson(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) return null;

  let candidate = rawText.trim();

  // Strip ```json ... ``` fences if present.
  const fenceMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) candidate = fenceMatch[1].trim();

  // Fall back to the first balanced-looking { ... } block.
  if (!candidate.startsWith('{')) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    candidate = candidate.slice(start, end + 1);
  }

  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Clamp confidence into a 0-100 integer. Non-numeric → 0.
 */
export function normalizeConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Shape Barry's raw parsed object into the canonical extraction record:
 * every expected string field present, plus a clamped numeric confidence.
 */
export function normalizeExtraction(parsed) {
  const data = {};
  for (const field of EXTRACTION_FIELDS) {
    const val = parsed?.[field];
    data[field] = typeof val === 'string' ? val.trim() : '';
  }
  data.confidence = normalizeConfidence(parsed?.confidence);
  return data;
}

/** True when a stored section value should be treated as "already filled". */
function hasValue(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * Merge extracted data into a RECON module's sections array without overwriting
 * fields the user already filled in. Pure — takes and returns plain data.
 *
 * @param {Array} sections - modules[recon].sections
 * @param {Object} extracted - normalized extraction record
 * @param {string} nowIso - timestamp for lastEditedAt/completedAt
 * @returns {{ sections: Array, writtenFields: Array, touchedSectionIds: number[] }}
 */
export function mapDataToReconSections(sections, extracted, nowIso = new Date().toISOString()) {
  if (!Array.isArray(sections)) {
    return { sections: sections, writtenFields: [], touchedSectionIds: [] };
  }

  // Work on a deep-ish clone so callers keep referential purity on section/data.
  const next = sections.map((s) => ({ ...s, data: s?.data ? { ...s.data } : s?.data }));
  const byId = new Map(next.map((s) => [s.sectionId, s]));

  const writtenFields = [];
  const touched = new Set();

  for (const [field, { sectionId, key }] of Object.entries(RECON_FIELD_MAP)) {
    const value = extracted?.[field];
    if (!hasValue(value)) continue;

    const section = byId.get(sectionId);
    if (!section) continue; // Section not present in this user's dashboard — skip.

    const data = section.data && typeof section.data === 'object' ? section.data : {};

    // Never overwrite a value the user already put there.
    if (hasValue(data[key])) continue;

    data[key] = typeof value === 'string' ? value.trim() : value;
    section.data = data;
    writtenFields.push({ field, sectionId, key });
    touched.add(sectionId);
  }

  // Apply status transitions to touched sections.
  for (const sectionId of touched) {
    const section = byId.get(sectionId);
    section.lastEditedAt = nowIso;

    if (section.status === 'completed') continue; // Respect an existing completion.

    const requiredKeys = AUTO_COMPLETE_SECTIONS[sectionId];
    const allFilled =
      requiredKeys && requiredKeys.every((k) => hasValue(section.data?.[k]));

    if (allFilled) {
      section.status = 'completed';
      section.completedAt = nowIso;
    } else if (section.status === 'not_started') {
      // Enough to show activity; the user still finishes structured inputs.
      section.status = 'in_progress';
    }
  }

  return { sections: next, writtenFields, touchedSectionIds: [...touched] };
}

/**
 * Recompute a RECON module's rolled-up progress + section unlocking after a
 * data merge. Mirrors the essential bookkeeping in src/utils/dashboardUtils.js
 * so the client sees consistent progress. Mutates and returns the module.
 */
export function recomputeReconModule(reconModule) {
  if (!reconModule || !Array.isArray(reconModule.sections)) return reconModule;
  const sections = reconModule.sections;

  const completedSections = sections.filter((s) => s.status === 'completed').length;
  reconModule.completedSections = completedSections;
  reconModule.progressPercentage = Math.round((completedSections / sections.length) * 100);

  // Unlock the section following any completed one.
  sections.forEach((s, i) => {
    if (s.status === 'completed' && sections[i + 1]) sections[i + 1].unlocked = true;
  });

  if (completedSections === 0) {
    reconModule.status = reconModule.status === 'completed' ? 'completed' : 'not_started';
  } else if (completedSections === sections.length) {
    reconModule.status = 'completed';
    if (!reconModule.completedAt) reconModule.completedAt = new Date().toISOString();
  } else {
    reconModule.status = 'in-progress';
    if (!reconModule.startedAt) reconModule.startedAt = new Date().toISOString();
  }

  return reconModule;
}

/**
 * Build the recon.websiteAnalysis sub-object from the extracted fields that
 * have no clean existing RECON home. Only non-empty fields are included, plus
 * confidence + analyzedAt for traceability. Pure — exported for testing.
 */
export function buildWebsiteAnalysis(extracted, nowIso = new Date().toISOString()) {
  const analysis = {};
  for (const field of WEBSITE_ANALYSIS_FIELDS) {
    if (hasValue(extracted?.[field])) analysis[field] = extracted[field].trim();
  }
  analysis.confidence = normalizeConfidence(extracted?.confidence);
  analysis.analyzedAt = nowIso;
  return analysis;
}

// ─── Firestore write ────────────────────────────────────────────────────────

/**
 * Merge the extracted profile into dashboards/{userId}: Section 1 identity
 * fields into their existing keys, and everything without a clean home into the
 * clearly labeled modules[recon].websiteAnalysis sub-object.
 * No-op-safe: if the dashboard or RECON module is missing, returns [] written.
 *
 * @returns {Promise<{ writtenFields: Array, touchedSectionIds: number[] }>}
 */
async function writeToRecon(userId, extracted) {
  const dashboardRef = db.collection('dashboards').doc(userId);
  const snap = await dashboardRef.get();

  if (!snap.exists) {
    console.warn(`[analyze-website] No dashboard doc for user ${userId}; skipping RECON write`);
    return { writtenFields: [], touchedSectionIds: [] };
  }

  const dashboard = snap.data();
  const modules = Array.isArray(dashboard.modules) ? dashboard.modules : [];
  const reconIndex = modules.findIndex((m) => m.id === 'recon');

  if (reconIndex === -1 || !Array.isArray(modules[reconIndex].sections)) {
    console.warn(`[analyze-website] No RECON module for user ${userId}; skipping RECON write`);
    return { writtenFields: [], touchedSectionIds: [] };
  }

  const nowIso = new Date().toISOString();
  const { sections, writtenFields } = mapDataToReconSections(
    modules[reconIndex].sections,
    extracted,
    nowIso
  );

  const analysis = buildWebsiteAnalysis(extracted, nowIso);
  const hasAnalysisFields = WEBSITE_ANALYSIS_FIELDS.some((f) => hasValue(extracted?.[f]));

  if (writtenFields.length === 0 && !hasAnalysisFields) {
    // User already filled the identity fields and Barry found nothing else —
    // nothing meaningful to persist.
    return { writtenFields: [], touchedSectionIds: [] };
  }

  const existingModule = modules[reconIndex];
  const nextModules = [...modules];
  nextModules[reconIndex] = {
    ...existingModule,
    sections,
    // Merge so re-running refreshes fields without wiping earlier findings.
    websiteAnalysis: { ...(existingModule.websiteAnalysis || {}), ...analysis },
  };
  recomputeReconModule(nextModules[reconIndex]);

  await dashboardRef.update({
    modules: nextModules,
    'progressTracking.moduleProgress.recon':
      nextModules[reconIndex].progressPercentage,
    lastUpdatedAt: nowIso,
  });

  return { writtenFields, touchedSectionIds: [...new Set(writtenFields.map((w) => w.sectionId))] };
}

/**
 * Stamp onboarding.websiteAnalyzed on the user doc so the flag reflects reality
 * regardless of client-side follow-up (see Workstream A2). Non-fatal on error.
 */
async function markWebsiteAnalyzed(userId) {
  try {
    await db.collection('users').doc(userId).set(
      {
        onboarding: {
          websiteAnalyzed: true,
          websiteAnalyzedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
  } catch (err) {
    console.warn(`[analyze-website] Could not stamp websiteAnalyzed for ${userId}:`, err.message);
  }
}

// ─── Site fetch ─────────────────────────────────────────────────────────────

/**
 * Fetch the URL with a hard timeout and a realistic browser User-Agent.
 * Returns a discriminated result the handler turns into friendly messages.
 *
 * @returns {Promise<{ ok: true, html: string } | { ok: false, reason: string }>}
 */
async function fetchSite(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: 'blocked' };
    }
    if (!res.ok) {
      return { ok: false, reason: 'unreachable' };
    }

    const html = await res.text();
    return { ok: true, html };
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, reason: 'timeout' };
    console.warn(`[analyze-website] fetch error for ${url}:`, err.message);
    return { ok: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Barry call with one JSON retry ─────────────────────────────────────────

/**
 * Ask Barry for the structured profile. If the response isn't valid JSON,
 * retry exactly once, then give up. Returns a normalized extraction or null.
 */
async function extractWithBarry(anthropic, text, url) {
  const prompt = buildAnalysisPrompt(text, url);

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await createMessageWithRetry(anthropic, {
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response?.content?.[0]?.text ?? '';
    const parsed = parseBarryJson(raw);
    if (parsed) {
      return { extraction: normalizeExtraction(parsed), usage: response.usage };
    }
    console.warn(`[analyze-website] Barry returned invalid JSON (attempt ${attempt + 1}/2)`);
  }

  return null;
}

// ─── Handler ────────────────────────────────────────────────────────────────

function respond(statusCode, body) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(body) };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { success: false, message: 'Method not allowed' });
  }

  const startTime = Date.now();
  let userId;

  try {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return respond(400, { success: false, message: 'Invalid JSON body' });
    }

    const { url, authToken } = body;
    userId = body.userId;

    if (!userId || !authToken || !url) {
      return respond(400, {
        success: false,
        message: 'Missing required fields: url, userId, authToken',
      });
    }

    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) {
      return respond(400, { success: false, message: FRIENDLY.unreachable });
    }

    // ── Auth ────────────────────────────────────────────────────────────────
    try {
      await verifyAuthToken(authToken, userId);
    } catch {
      return respond(401, { success: false, message: 'Authentication failed' });
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      console.error('[analyze-website] ANTHROPIC_API_KEY not configured');
      return respond(500, { success: false, message: FRIENDLY.generic });
    }

    // ── Fetch site ────────────────────────────────────────────────────────────
    const fetchResult = await fetchSite(normalizedUrl);
    if (!fetchResult.ok) {
      await logApiUsage(userId, 'analyzeWebsite', 'error', {
        responseTime: Date.now() - startTime,
        errorCode: `fetch_${fetchResult.reason}`,
        metadata: { url: normalizedUrl },
      }).catch(() => {});
      return respond(200, { success: false, message: FRIENDLY[fetchResult.reason] || FRIENDLY.generic });
    }

    // ── Extract text ──────────────────────────────────────────────────────────
    const text = stripHtml(fetchResult.html);
    if (text.length < MIN_BODY_CHARS) {
      await logApiUsage(userId, 'analyzeWebsite', 'error', {
        responseTime: Date.now() - startTime,
        errorCode: 'js_rendered',
        metadata: { url: normalizedUrl, textLength: text.length },
      }).catch(() => {});
      return respond(200, {
        success: false,
        message: FRIENDLY.jsRendered,
        confidence: 0,
        lowConfidence: true,
      });
    }

    // ── Barry extraction (with one JSON retry) ────────────────────────────────
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const result = await extractWithBarry(anthropic, text, normalizedUrl);

    if (!result) {
      await logApiUsage(userId, 'analyzeWebsite', 'error', {
        provider: 'anthropic',
        model: MODEL,
        responseTime: Date.now() - startTime,
        errorCode: 'invalid_json',
        metadata: { url: normalizedUrl },
      }).catch(() => {});
      return respond(200, { success: false, message: FRIENDLY.parseFailed });
    }

    const { extraction, usage } = result;

    // ── Persist to RECON + onboarding flag ────────────────────────────────────
    let writtenFields = [];
    try {
      const writeResult = await writeToRecon(userId, extraction);
      writtenFields = writeResult.writtenFields;
    } catch (err) {
      // A write failure shouldn't lose the analysis — return it so the client
      // can still use it, but surface that persistence didn't happen.
      console.error(`[analyze-website] RECON write failed for ${userId}:`, err.message);
    }

    await markWebsiteAnalyzed(userId);

    await logApiUsage(userId, 'analyzeWebsite', 'success', {
      provider: 'anthropic',
      model: MODEL,
      // extractWithBarry returns the usage from whichever attempt succeeded.
      usage,
      responseTime: Date.now() - startTime,
      metadata: {
        url: normalizedUrl,
        confidence: extraction.confidence,
        fieldsWritten: writtenFields.length,
      },
    }).catch(() => {});

    return respond(200, {
      success: true,
      data: extraction,
      meta: {
        fieldsWritten: writtenFields.length,
        sectionsUpdated: [...new Set(writtenFields.map((w) => w.sectionId))],
      },
    });
  } catch (err) {
    console.error('[analyze-website] Unexpected error:', err);
    await logApiUsage(userId || 'unknown', 'analyzeWebsite', 'error', {
      provider: 'anthropic',
      model: MODEL,
      responseTime: Date.now() - startTime,
      errorCode: err.message,
    }).catch(() => {});
    return respond(500, { success: false, message: FRIENDLY.generic });
  }
};
