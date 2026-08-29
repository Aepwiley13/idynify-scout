/**
 * The health indicator has to live somewhere a user can actually reach.
 *
 * The first attempt put it in GmailConnectButton, which no module imports —
 * the same mistake as usePendingReplies, which the Gate 2 audit found had been
 * written complete with a scan cap and truncation reporting and then never
 * called by anything. A warning nobody can navigate to is not visibility; it is
 * a second copy of the original defect.
 *
 * So this asserts reachability structurally, by reading the source graph:
 * the hook is consumed by UserSettings, and UserSettings is routed. Rendering
 * the page would prove less and cost more — it needs Firebase, auth, theme and
 * router context, and would fail for reasons unrelated to whether the indicator
 * is wired up.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(here, rel), 'utf8');

const settings = read('../pages/UserSettings.jsx');
const app = read('../App.jsx');

describe('the health surface is mounted on a routed page', () => {
  it('UserSettings imports the health hook', () => {
    expect(settings).toMatch(/import\s*\{\s*useGmailSyncHealth\s*\}\s*from\s*'\.\.\/hooks\/useGmailSyncHealth'/);
  });

  it('UserSettings calls it, rather than merely importing it', () => {
    expect(settings).toMatch(/useGmailSyncHealth\s*\(\s*\)/);
  });

  it('renders the health message in the Gmail integration card', () => {
    expect(settings).toContain('gmailSyncHealth?.actionable');
    expect(settings).toContain('gmailSyncHealth.message');
  });

  it('UserSettings is reachable through a route', () => {
    expect(app).toMatch(/import\s+UserSettings\s+from\s+'\.\/pages\/UserSettings'/);
    expect(app).toMatch(/path="\/settings"/);
    expect(app).toContain('<UserSettings />');
  });
});

describe('the indicator is not orphaned the way the last one was', () => {
  it('is consumed by at least one module other than its own definition', () => {
    // The specific regression: a component that exists, works, is tested, and
    // is imported by nothing.
    const consumers = ['../pages/UserSettings.jsx'];
    const importing = consumers.filter(rel => read(rel).includes('useGmailSyncHealth'));
    expect(importing.length).toBeGreaterThan(0);
  });

  it('warns only when there is something to act on', () => {
    // Guarded on `actionable`, so a healthy mailbox renders nothing and the
    // indicator keeps its meaning when it does appear.
    expect(settings).toMatch(/gmailSyncHealth\?\.actionable\s*&&/);
  });
});
