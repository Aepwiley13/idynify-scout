#!/usr/bin/env node
/**
 * STAGING ONLY: a local stand-in for the Apollo API, for the end-to-end test.
 *
 * Listens on 127.0.0.1 only. The functions reach it through APOLLO_MOCK_URL, which
 * netlify/functions/utils/apolloConstants.js honours for a loopback address and nothing else.
 * It answers the four endpoints Idynify uses with fixed, made-up records (example.test
 * addresses, no real people), costs nothing and calls nothing.
 *
 *   POST /v1/people/match            one person built from the request (name, email, id)
 *   POST /v1/mixed_people/api_search three people at the organization
 *   POST /v1/organizations/enrich    one organization for the domain
 *   POST /v1/mixed_companies/search  two organizations
 *   GET  /__calls                    every call so far: path, the key it carried, its body
 *   POST /__reset                    forget the calls
 *
 * A request without the mock key (X-Api-Key: apollo-mock) is answered 401 and recorded, so the
 * test can prove no real Apollo key ever reached it.
 *
 *   node scripts/staging/apolloMock.mjs --port=8899
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';

export const APOLLO_MOCK_KEY = 'apollo-mock';
export const DEFAULT_APOLLO_MOCK_PORT = 8899;

const titleCase = (s) => String(s ?? '').replace(/\b\w/g, (c) => c.toUpperCase());

/** A made-up person for a people/match request. Pure. */
export function mockPerson(request = {}) {
  const fromEmail = typeof request.email === 'string' ? request.email.split('@')[0].replace(/[._-]+/g, ' ') : '';
  const first = request.first_name || titleCase(fromEmail.split(' ')[0]) || 'Pat';
  const last = request.last_name || titleCase(fromEmail.split(' ').slice(1).join(' ')) || 'Example';
  const slug = `${first}-${last}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return {
    id: request.id || `mock_${slug}`,
    first_name: first,
    last_name: last,
    name: `${first} ${last}`,
    title: 'Head of Partnerships',
    email: request.email || `${slug}@mock-company.example.test`,
    email_status: 'verified',
    phone_numbers: [{ sanitized_number: '+15555550142', type: 'work_direct' }],
    linkedin_url: `https://www.linkedin.com/in/${slug}-mock`,
    city: 'Salt Lake City',
    state: 'Utah',
    country: 'United States',
    organization: { id: 'mock_org_1', name: request.organization_name || 'Mock Company', primary_domain: request.domain || 'mock-company.example.test' },
  };
}

/** The answer for one request. Pure: { status, body }. */
export function answer(path, body) {
  switch (path) {
    case '/v1/people/match':
      return { status: 200, body: { person: mockPerson(body) } };
    case '/v1/mixed_people/api_search':
      return {
        status: 200,
        body: {
          people: ['Avery Stone', 'Blake Rivera', 'Casey Morgan'].map((n, i) => {
            const [first_name, last_name] = n.split(' ');
            return { id: `mock_search_${i + 1}`, first_name, last_name, name: n, title: i === 0 ? 'CEO' : 'VP Sales', organization: { id: body?.organization_ids?.[0] ?? 'mock_org_1', name: 'Mock Company' } };
          }),
          pagination: { page: 1, per_page: 3, total_entries: 3, total_pages: 1 },
        },
      };
    case '/v1/organizations/enrich':
      return { status: 200, body: { organization: { id: 'mock_org_1', name: 'Mock Company', primary_domain: body?.domain || 'mock-company.example.test', estimated_num_employees: 42, industry: 'computer software' } } };
    case '/v1/mixed_companies/search':
      return {
        status: 200,
        body: {
          organizations: [
            { id: 'mock_org_1', name: 'Mock Company', primary_domain: 'mock-company.example.test', estimated_num_employees: 42 },
            { id: 'mock_org_2', name: 'Example Partners', primary_domain: 'example-partners.example.test', estimated_num_employees: 18 },
          ],
          accounts: [],
          pagination: { page: 1, per_page: 2, total_entries: 2, total_pages: 1 },
        },
      };
    default:
      return { status: 404, body: { error: 'not mocked', path } };
  }
}

/** Starts the stand-in. Resolves to { url, port, calls, close }. */
export function startApolloMock({ port = DEFAULT_APOLLO_MOCK_PORT } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 1_000_000) req.destroy(); });
    req.on('end', () => {
      const path = new URL(req.url, 'http://127.0.0.1').pathname;
      const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (req.method === 'GET' && path === '/__calls') return send(200, { calls });
      if (req.method === 'POST' && path === '/__reset') { calls.length = 0; return send(200, { ok: true }); }
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
      const key = req.headers['x-api-key'] ?? null;
      calls.push({ at: new Date().toISOString(), method: req.method, path, mockKey: key === APOLLO_MOCK_KEY, body });
      if (key !== APOLLO_MOCK_KEY) return send(401, { error: 'not the mock key' });
      const { status, body: out } = answer(path, body);
      return send(status, out);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      resolve({ url: `http://127.0.0.1:${actual}`, port: actual, calls, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const portArg = process.argv.slice(2).find((a) => a.startsWith('--port='));
  const mock = await startApolloMock({ port: portArg ? Number(portArg.slice(7)) : DEFAULT_APOLLO_MOCK_PORT });
  console.log(`Apollo stand-in listening on ${mock.url} (127.0.0.1 only). Ctrl+C to stop.`);
}
