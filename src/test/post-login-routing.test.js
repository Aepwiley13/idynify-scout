/**
 * Post-login routing: Login.jsx → SmartRedirect → /barry or Mission Control.
 *
 * Login.jsx used to hardcode navigate('/mission-control-v2'), which bypassed
 * the onboarding-completion check in SmartRedirect and let users with
 * incomplete First Experience reach Mission Control directly, where the
 * legacy sidecar (BarryChatPanel) appeared as a competing onboarding surface.
 *
 * The fix: Login navigates to '/', SmartRedirect inspects userData, and routes
 * accordingly. These structural tests prove the routing contracts hold by
 * reading the source.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const login = read('../pages/Login.jsx');
const loginCode = code(login);
const app = read('../App.jsx');
const appCode = code(app);
const mainLayout = read('../components/layout/MainLayout.jsx');
const mainLayoutCode = code(mainLayout);

// ═════════════════════════════════════════════════════════════════════════════
// Login.jsx — post-login navigate target
// ═════════════════════════════════════════════════════════════════════════════

describe('Login.jsx — post-login routing', () => {
  it('does not hardcode navigate to /mission-control-v2', () => {
    expect(loginCode).not.toMatch(/navigate\(['"]\/mission-control-v2['"]\)/);
  });

  it('navigates to / after successful sign-in', () => {
    expect(loginCode).toMatch(/navigate\(['"]\/['"]\)/);
  });

  it('navigates to / after successful MFA verification', () => {
    const mfaBlock = loginCode.slice(loginCode.indexOf('handleMfaVerify'));
    expect(mfaBlock).toMatch(/navigate\(['"]\/['"]\)/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// App.jsx — SmartRedirect is the authoritative post-auth routing decision
// ═════════════════════════════════════════════════════════════════════════════

describe('App.jsx — SmartRedirect', () => {
  it('SmartRedirect checks onboardingComplete OR onboarding.completed', () => {
    expect(appCode).toMatch(/onboardingComplete/);
    expect(appCode).toMatch(/onboarding\?\.completed/);
  });

  it('SmartRedirect routes incomplete users to /barry', () => {
    expect(appCode).toMatch(/Navigate to="\/barry"/);
  });

  it('SmartRedirect routes complete users to /mission-control-v2', () => {
    expect(appCode).toMatch(/Navigate to="\/mission-control-v2"/);
  });

  it('/login redirect uses SmartRedirect, not a hardcoded path', () => {
    const loginRoute = appCode.match(/path="\/login"[^>]*element=\{([^}]+)\}/);
    expect(loginRoute).not.toBeNull();
    expect(loginRoute[1]).toMatch(/SmartRedirect/);
    expect(loginRoute[1]).not.toMatch(/Navigate/);
  });

  it('/forgot-password redirect uses SmartRedirect', () => {
    const forgotRoute = appCode.match(/path="\/forgot-password"[^>]*element=\{([^}]+)\}/);
    expect(forgotRoute).not.toBeNull();
    expect(forgotRoute[1]).toMatch(/SmartRedirect/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// MainLayout.jsx — sidecar suppression during First Experience
// ═════════════════════════════════════════════════════════════════════════════

describe('MainLayout.jsx — sidecar suppression', () => {
  it('destructures isFirstExperience from useShell', () => {
    expect(mainLayoutCode).toMatch(/isFirstExperience/);
    expect(mainLayoutCode).toMatch(/useShell\(\)/);
  });

  it('hides the Barry panel host when isFirstExperience is true', () => {
    expect(mainLayoutCode).toMatch(/isFirstExperience/);
    expect(mainLayoutCode).toMatch(/hidden.*isFirstExperience/s);
  });

  it('redirects sidecar opens to /barry during First Experience', () => {
    expect(mainLayoutCode).toMatch(/isFirstExperience && barryOpen/);
    expect(mainLayoutCode).toMatch(/navigate\(['"]\/barry['"]\)/);
  });
});
