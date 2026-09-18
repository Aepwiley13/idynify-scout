/**
 * The server must refuse to guess which Firebase project it is talking to.
 *
 * Twenty-two call sites read `process.env.FIREBASE_PROJECT_ID ||
 * 'idynify-scout-dev'`. That fallback is why a deploy with no environment
 * configured did not fail: it connected to the one project serving real
 * customers, from previews and branch deploys as readily as from production.
 * The literal looked like a safety net and worked as a trapdoor.
 *
 * These tests pin the replacement behaviour — throw, with a message that names
 * the variable — because the failure mode being prevented is silent, and a
 * silent regression here looks exactly like success.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { requireProjectId } from '../../netlify/functions/utils/firebaseEnv.js';

const ORIGINAL = process.env.FIREBASE_PROJECT_ID;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.FIREBASE_PROJECT_ID;
  else process.env.FIREBASE_PROJECT_ID = ORIGINAL;
});

describe('requireProjectId', () => {
  it('returns the configured project', () => {
    process.env.FIREBASE_PROJECT_ID = 'some-project';
    expect(requireProjectId()).toBe('some-project');
  });

  it('throws when the variable is unset', () => {
    delete process.env.FIREBASE_PROJECT_ID;
    expect(() => requireProjectId()).toThrow(/FIREBASE_PROJECT_ID is not set/);
  });

  it('throws on empty string — a blank var is misconfiguration, not a value', () => {
    process.env.FIREBASE_PROJECT_ID = '';
    expect(() => requireProjectId()).toThrow(/FIREBASE_PROJECT_ID is not set/);
  });

  it('never falls back to the production project', () => {
    delete process.env.FIREBASE_PROJECT_ID;
    // The specific regression: returning 'idynify-scout-dev' rather than
    // throwing is what let a misconfigured deploy reach real customer data.
    let returned;
    try { returned = requireProjectId(); } catch { /* expected */ }
    expect(returned).toBeUndefined();
  });

  it('names the variable so the fix is obvious from the function log', () => {
    delete process.env.FIREBASE_PROJECT_ID;
    expect(() => requireProjectId()).toThrow(/Netlify environment/);
  });
});

describe('the client config is environment-driven', () => {
  it('src/firebase/config.js reads every value from import.meta.env', async () => {
    // Checked as source rather than by importing: importing would initialise a
    // real Firebase app. The point is that no literal survives in the config
    // object, which is a property of the text.
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../firebase/config.js'), 'utf8');
    const configBlock = src.slice(
      src.indexOf('const firebaseConfig'), src.indexOf('};', src.indexOf('const firebaseConfig'))
    );

    for (const key of [
      'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID',
      'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID',
    ]) {
      expect(configBlock).toContain(`import.meta.env.${key}`);
    }
    // No quoted literals left in the config object at all.
    expect(configBlock).not.toMatch(/["'][a-z0-9-]*idynify[a-z0-9-]*["']/i);
  });
});
