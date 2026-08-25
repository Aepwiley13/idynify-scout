/**
 * Gate 2 — Barry Workspace Foundation
 *
 * Structural invariants verified by source scan:
 *
 * W1  /barry route exists in both ShellRoute and fallback blocks.
 * W2  All legacy /onboarding routes redirect to /barry.
 * W3  BarryWorkspace renders FirstExperience inline during onboarding.
 * W4  Sidebar hides module nav during First Experience.
 * W5  MainLayout suppresses the Barry slide-in panel on /barry.
 * W6  seedFromLegacy uses a transaction for the seeded flag (G2-D1).
 * W7  BarryChatPanel persists angles-only responses canonically (G2-D2).
 * W8  BarryChatPanel awaits assistant turn append (G2-D3).
 * W9  SmartRedirect sends new users to /barry, not /onboarding.
 * W10 Workspace reads from the same canonical subcollection as Sidecar.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const app = read('../App.jsx');
const workspace = read('../pages/Barry/BarryWorkspace.jsx');
const sidebar = read('../components/layout/Sidebar.jsx');
const mainLayout = read('../components/layout/MainLayout.jsx');
const canonical = read('../utils/barryCanonical.js');
const chatPanel = read('../components/dashboard/BarryChatPanel.jsx');
const shellContext = read('../context/ShellContext.jsx');

// ═══════════════════════════════════════════════════════════════════════════
// W1 — /barry route in both ShellRoute and fallback blocks
// ═══════════════════════════════════════════════════════════════════════════

describe('W1 — /barry route exists in both code paths', () => {
  it('ShellRoute block contains a /barry route', () => {
    expect(app).toMatch(/path="\/barry"\s+element=\{<BarryWorkspace/);
  });

  it('fallback block contains a /barry route with ProtectedRoute', () => {
    expect(app).toMatch(/ProtectedRoute withLayout.*BarryWorkspace/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W2 — legacy onboarding routes redirect to /barry
// ═══════════════════════════════════════════════════════════════════════════

describe('W2 — all legacy /onboarding routes redirect to /barry', () => {
  const onboardingRoutes = [
    '/onboarding',
    '/onboarding/flow',
    '/onboarding/recon',
    '/onboarding/barry',
    '/onboarding/company-profile',
  ];

  for (const route of onboardingRoutes) {
    it(`${route} redirects to /barry`, () => {
      const pattern = new RegExp(`path="${route.replace(/\//g, '\\/')}".*Navigate to="\/barry"`);
      expect(app).toMatch(pattern);
    });
  }

  it('no onboarding route still points to /onboarding as a destination', () => {
    const stripped = code(app);
    expect(stripped).not.toMatch(/Navigate to="\/onboarding"/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W3 — BarryWorkspace renders FirstExperience inline
// ═══════════════════════════════════════════════════════════════════════════

describe('W3 — FirstExperience composition', () => {
  it('BarryWorkspace imports FirstExperience', () => {
    expect(workspace).toMatch(/import FirstExperience from/);
  });

  it('BarryWorkspace renders <FirstExperience /> when isFirstExperience is true', () => {
    expect(workspace).toMatch(/<FirstExperience\s*\/>/);
  });

  it('BarryWorkspace checks onboardingComplete to determine first experience', () => {
    expect(workspace).toMatch(/onboardingComplete/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W4 — Sidebar hides module nav during First Experience
// ═══════════════════════════════════════════════════════════════════════════

describe('W4 — simplified nav during First Experience', () => {
  it('ShellContext exports isFirstExperience', () => {
    expect(shellContext).toMatch(/isFirstExperience/);
  });

  it('ShellContext exports setFirstExperience', () => {
    expect(shellContext).toMatch(/setFirstExperience/);
  });

  it('Sidebar reads isFirstExperience from useShell', () => {
    expect(sidebar).toMatch(/isFirstExperience/);
  });

  it('desktop nav is gated on !isFirstExperience', () => {
    const stripped = code(sidebar);
    expect(stripped).toMatch(/!isMobile && !isFirstExperience/);
  });

  it('mobile nav is gated on !isFirstExperience', () => {
    const stripped = code(sidebar);
    expect(stripped).toMatch(/isMobile && !isFirstExperience/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W5 — Barry panel suppressed on /barry route
// ═══════════════════════════════════════════════════════════════════════════

describe('W5 — MainLayout hides Barry slide-in on /barry', () => {
  it('MainLayout checks for /barry pathname', () => {
    expect(mainLayout).toMatch(/\/barry/);
  });

  it('the barry-panel-host is hidden when on the Barry page', () => {
    const stripped = code(mainLayout);
    expect(stripped).toMatch(/onBarryPage/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W6 — G2-D1: seedFromLegacy uses transaction
// ═══════════════════════════════════════════════════════════════════════════

describe('W6 — seedFromLegacy race condition fix (G2-D1)', () => {
  it('barryCanonical imports runTransaction', () => {
    expect(canonical).toMatch(/runTransaction/);
  });

  it('seedFromLegacy uses runTransaction for the seeded flag', () => {
    const fnBody = canonical.slice(
      canonical.indexOf('export async function seedFromLegacy'),
      canonical.indexOf('export async function loadOrSeedRecentTurns')
    );
    expect(fnBody).toMatch(/runTransaction/);
  });

  it('the transaction checks seeded and sets it atomically', () => {
    const fnBody = canonical.slice(
      canonical.indexOf('export async function seedFromLegacy'),
      canonical.indexOf('export async function loadOrSeedRecentTurns')
    );
    expect(fnBody).toMatch(/txn\.get/);
    expect(fnBody).toMatch(/txn\.set/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W7 — G2-D2: angles-only responses persisted canonically
// ═══════════════════════════════════════════════════════════════════════════

describe('W7 — angles-only canonical persistence (G2-D2)', () => {
  it('BarryChatPanel synthesizes content for angles-only responses', () => {
    expect(chatPanel).toMatch(/has_message_angles.*angles\.length/);
    expect(chatPanel).toMatch(/Message angles generated/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W8 — G2-D3: assistant turn append is awaited
// ═══════════════════════════════════════════════════════════════════════════

describe('W8 — assistant append is awaited (G2-D3)', () => {
  it('assistant appendTurn is called with await, not fire-and-forget', () => {
    const stripped = code(chatPanel);
    expect(stripped).toMatch(/await appendTurn\(db, user\.uid.*role: 'assistant'/s);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W9 — SmartRedirect targets /barry for new users
// ═══════════════════════════════════════════════════════════════════════════

describe('W9 — SmartRedirect routes new users to /barry', () => {
  it('SmartRedirect navigates to /barry for incomplete onboarding', () => {
    expect(app).toMatch(/Navigate to="\/barry"/);
  });

  it('SmartRedirect does not navigate to /onboarding', () => {
    const smartRedirect = app.slice(
      app.indexOf('const SmartRedirect'),
      app.indexOf('if (loading) {', app.indexOf('const SmartRedirect') + 100)
    );
    expect(smartRedirect).not.toContain('Navigate to="/onboarding"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W10 — Workspace ↔ Sidecar continuity
// ═══════════════════════════════════════════════════════════════════════════

describe('W10 — Workspace reads from the same canonical store', () => {
  it('BarryWorkspace imports loadOrSeedRecentTurns', () => {
    expect(workspace).toMatch(/import.*loadOrSeedRecentTurns.*from.*barryCanonical/);
  });

  it('BarryChatPanel imports loadOrSeedRecentTurns', () => {
    expect(chatPanel).toMatch(/import.*loadOrSeedRecentTurns.*from.*barryCanonical/);
  });

  it('both use the same canonical subcollection path', () => {
    expect(canonical).toContain("'barryConversations', 'canonical', 'turns'");
  });
});
