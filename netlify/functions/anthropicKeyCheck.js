/* global process */
/**
 * Anthropic key check — read-only, no cost (#699).
 *
 * Answers one question about the deploy it runs in: does the ANTHROPIC_API_KEY
 * this deploy injects into functions authenticate, and can it reach the Barry
 * Sonnet models? It exists so a key rotation and a model switch can be verified
 * against the real production context without anyone running diagnostics by
 * hand: .github/workflows/sonnet-migration.yml calls it on production.
 *
 * It calls only endpoints that cost nothing — the Models API and
 * messages/count_tokens — and returns codes and booleans. It never returns,
 * logs or derives anything from the key itself. Results are cached for a
 * minute per instance, so repeated calls cannot be used to hammer the API.
 */
import { MODEL_BARRY_SONNET, SONNET_4_5, SONNET_5_5, SONNET_4_6 } from './utils/models.js';

const API = 'https://api.anthropic.com/v1';
const CACHE_MS = 60_000;
let cached = null;

async function anthropic(path, apiKey, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  return res.status;
}

/** HTTP status → a word; nothing from the response body is passed on. */
function verdict(status) {
  if (status === 200) return 'ok';
  if (status === 401) return 'rejected';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  return `http_${status}`;
}

/** Exported for testing. */
export async function checkKey(env = process.env) {
  const apiKey = env.ANTHROPIC_API_KEY;
  const result = { key: 'missing', configuredModel: MODEL_BARRY_SONNET, models: {}, configuredModelAcceptsMessages: null };
  if (typeof apiKey !== 'string' || !apiKey.trim()) return result;

  try {
    result.key = verdict(await anthropic('/models?limit=1', apiKey));
    if (result.key !== 'ok') return result;
    for (const model of [...new Set([SONNET_4_5, SONNET_5_5, SONNET_4_6, MODEL_BARRY_SONNET])]) {
      result.models[model] = verdict(await anthropic(`/models/${encodeURIComponent(model)}`, apiKey));
    }
    // A free messages-shaped request against the model Barry is configured to call.
    result.configuredModelAcceptsMessages = verdict(await anthropic('/messages/count_tokens', apiKey, {
      method: 'POST',
      body: JSON.stringify({ model: MODEL_BARRY_SONNET, messages: [{ role: 'user', content: 'ping' }] }),
    }));
  } catch (error) {
    result.key = error?.name === 'TimeoutError' ? 'timeout' : 'network_error';
  }
  return result;
}

export const handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'GET only' }) };

  if (!cached || Date.now() - cached.at > CACHE_MS) {
    cached = { at: Date.now(), result: await checkKey() };
  }
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ...cached.result, checkedAt: new Date(cached.at).toISOString() }),
  };
};
