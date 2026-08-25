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
  it('BarryWorkspace renders FE inline via _feCard cards (B3 replaces FirstExperience import)', () => {
    expect(workspace).toMatch(/turn\._feCard/);
    expect(workspace).toMatch(/<BarryOnboarding/);
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

// ═══════════════════════════════════════════════════════════════════════════
// C1 — G2-C1: /barry has a functional composer after First Experience
// ═══════════════════════════════════════════════════════════════════════════

const workspaceClean = code(workspace);

describe('C1 — /barry has a functional composer', () => {
  it('BarryWorkspace has a textarea input for composing messages', () => {
    expect(workspace).toMatch(/<textarea[\s\S]*?className="barry-workspace-input"/);
  });

  it('BarryWorkspace has a Send button', () => {
    expect(workspace).toMatch(/<button[\s\S]*?className="barry-workspace-send"/);
  });

  it('sendMessage calls barryMissionChat endpoint', () => {
    expect(workspaceClean).toMatch(/barryMissionChat/);
    expect(workspaceClean).toMatch(/fetch\(.*barryMissionChat/);
  });

  it('sendMessage appends user turn to canonical via appendTurn', () => {
    expect(workspaceClean).toMatch(/await appendTurn\(db,\s*user\.uid,\s*\{.*role:\s*'user'/s);
  });

  it('sendMessage appends assistant turn to canonical via appendTurn', () => {
    expect(workspaceClean).toMatch(/await appendTurn\(db,\s*user\.uid,\s*\{.*role:\s*'assistant'/s);
  });

  it('composer sends conversationHistory and contextStack to barryMissionChat', () => {
    expect(workspaceClean).toMatch(/conversationHistory/);
    expect(workspaceClean).toMatch(/contextStack/);
  });

  it('Enter key triggers sendMessage', () => {
    expect(workspaceClean).toMatch(/handleKeyDown/);
    expect(workspaceClean).toMatch(/e\.key\s*===\s*'Enter'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C2 — Workspace ↔ Sidecar continuity through same canonical conversation
// ═══════════════════════════════════════════════════════════════════════════

describe('C2 — Workspace and Sidecar share canonical conversation', () => {
  it('both import appendTurn from barryCanonical', () => {
    expect(workspace).toMatch(/import.*appendTurn.*from.*barryCanonical/);
    expect(chatPanel).toMatch(/import.*appendTurn.*from.*barryCanonical/);
  });

  it('both import loadOrSeedRecentTurns from barryCanonical', () => {
    expect(workspace).toMatch(/import.*loadOrSeedRecentTurns.*from.*barryCanonical/);
    expect(chatPanel).toMatch(/import.*loadOrSeedRecentTurns.*from.*barryCanonical/);
  });

  it('all surfaces write through the same appendTurn function', () => {
    const appendFn = canonical.slice(
      canonical.indexOf('export async function appendTurn'),
      canonical.indexOf('export async function loadRecentTurns')
    );
    expect(appendFn).toContain("turnsRef(db, uid)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C3 — Workspace cannot create a second conversation authority
// ═══════════════════════════════════════════════════════════════════════════

describe('C3 — no second conversation authority', () => {
  it('Workspace does not import addDoc directly', () => {
    expect(workspace).not.toMatch(/import.*addDoc.*from.*firebase\/firestore/);
  });

  it('Workspace does not import collection directly', () => {
    expect(workspace).not.toMatch(/import.*collection.*from.*firebase\/firestore/);
  });

  it('Workspace writes only through barryCanonical appendTurn', () => {
    const sendFn = workspaceClean.slice(
      workspaceClean.indexOf('async function sendMessage'),
      workspaceClean.indexOf('function handleKeyDown')
    );
    expect(sendFn).not.toMatch(/addDoc\(/);
    expect(sendFn).toMatch(/appendTurn\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C4 — Structured angle turns do not render as bracketed speech
// ═══════════════════════════════════════════════════════════════════════════

describe('C4 — structured angles, no bracketed speech', () => {
  it('appendTurn accepts a kind parameter', () => {
    const appendSig = canonical.slice(
      canonical.indexOf('export async function appendTurn'),
      canonical.indexOf('return addDoc')
    );
    expect(appendSig).toContain('kind');
  });

  it('appendTurn writes kind to Firestore when not "message"', () => {
    const appendFn = canonical.slice(
      canonical.indexOf('export async function appendTurn'),
      canonical.indexOf('export async function loadRecentTurns')
    );
    expect(appendFn).toMatch(/if\s*\(kind && kind !== 'message'\)/);
    expect(appendFn).toMatch(/turnDoc\.kind\s*=\s*kind/);
  });

  it('Workspace renders structured kinds via ConversationCard, not brackets', () => {
    expect(workspace).toMatch(/ConversationCard/);
    expect(workspaceClean).not.toMatch(/\[Message angles generated/);
  });

  it('Sidecar does not wrap angles in brackets', () => {
    const chatClean = code(chatPanel);
    expect(chatClean).not.toMatch(/\[Message angles generated/);
  });

  it('Workspace uses kind discriminator to render structured turns', () => {
    expect(workspaceClean).toMatch(/turn\.kind/);
    expect(workspaceClean).toMatch(/ConversationCard\s+kind=/);
  });

  it('Sidecar uses kind: "angles" for angle turns', () => {
    const chatClean = code(chatPanel);
    expect(chatClean).toMatch(/turnKind\s*=\s*'angles'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C5 — Legacy seed concurrency cannot duplicate history
// ═══════════════════════════════════════════════════════════════════════════

describe('C5 — seed concurrency safety', () => {
  const seedFn = canonical.slice(
    canonical.indexOf('export async function seedFromLegacy'),
    canonical.indexOf('export async function loadOrSeedRecentTurns')
  );

  it('checks seedComplete before starting', () => {
    expect(seedFn).toMatch(/seedComplete/);
    expect(seedFn).toMatch(/if\s*\(data\.seedComplete\)\s*return false/);
  });

  it('checks seeding lock with stale detection', () => {
    expect(seedFn).toMatch(/data\.seeding/);
    expect(seedFn).toMatch(/seedingAt/);
    expect(seedFn).toMatch(/120_000/);
  });

  it('claims lock atomically with seedingAt timestamp', () => {
    expect(seedFn).toMatch(/txn\.set\(metaRef/);
    expect(seedFn).toMatch(/seeding:\s*true/);
    expect(seedFn).toMatch(/seedingAt:\s*serverTimestamp\(\)/);
  });

  it('seedComplete is set only after successful import', () => {
    expect(seedFn).toMatch(/seedComplete:\s*true.*seeding:\s*false/s);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C6 — Failed/interrupted seeding remains recoverable
// ═══════════════════════════════════════════════════════════════════════════

describe('C6 — failed seeding is recoverable', () => {
  const seedFn = canonical.slice(
    canonical.indexOf('export async function seedFromLegacy'),
    canonical.indexOf('export async function loadOrSeedRecentTurns')
  );

  it('clears seeding flag on failure so next caller can retry', () => {
    expect(seedFn).toMatch(/seeding:\s*false/);
    expect(seedFn).toMatch(/\{\s*seeding:\s*false\s*\}/);
  });

  it('does not set seedComplete on error', () => {
    expect(seedFn).toMatch(/const complete = imported \|\| !hadError/);
  });

  it('stale lock (>2 min) can be reclaimed', () => {
    expect(seedFn).toMatch(/age\s*<\s*120_000/);
  });

  it('catches per-doc errors and continues to next', () => {
    expect(seedFn).toMatch(/catch\s*\(err\)/);
    expect(seedFn).toMatch(/hadError\s*=\s*true/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C7 — First Experience uses controller (replaced soft progress stepper)
// ═══════════════════════════════════════════════════════════════════════════

describe('C7 — First Experience uses controller instead of stepper', () => {
  it('imports useFirstExperienceController', () => {
    expect(workspace).toMatch(/import useFirstExperienceController/);
  });

  it('does not use SOFT_PROGRESS_STATES or deriveSoftProgress', () => {
    expect(workspaceClean).not.toMatch(/SOFT_PROGRESS_STATES/);
    expect(workspaceClean).not.toMatch(/deriveSoftProgress/);
  });

  it('does not render progress stepper markup', () => {
    expect(workspaceClean).not.toMatch(/barry-workspace-progress/);
    expect(workspaceClean).not.toMatch(/barry-progress-step/);
  });

  it('routes composer to controller during First Experience', () => {
    expect(workspaceClean).toMatch(/feCtrl\.handleUserInput/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C8 — Gate 0 invariants remain intact
// ═══════════════════════════════════════════════════════════════════════════

describe('C8 — Gate 0 invariants', () => {
  it('/barry route remains inside ShellRoute', () => {
    expect(app).toMatch(/ShellRoute[\s\S]*?path="\/barry"/);
  });

  it('ShellRoute is defined in App.jsx', () => {
    expect(app).toMatch(/function ShellRoute/);
  });

  it('BarryWorkspace is imported in App.jsx', () => {
    expect(app).toMatch(/import.*BarryWorkspace/);
  });

  it('legacy /onboarding routes still redirect to /barry', () => {
    expect(app).toMatch(/path="\/onboarding"\s+element=\{<Navigate to="\/barry"/);
  });

  it('canonical subcollection path unchanged', () => {
    expect(canonical).toContain("'barryConversations', 'canonical', 'turns'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C9 — Gate 1 append-only / continuity invariants remain intact
// ═══════════════════════════════════════════════════════════════════════════

describe('C9 — Gate 1 append-only and continuity invariants', () => {
  it('appendTurn validates role is user or assistant', () => {
    const appendFn = canonical.slice(
      canonical.indexOf('export async function appendTurn'),
      canonical.indexOf('export async function loadRecentTurns')
    );
    expect(appendFn).toMatch(/role !== 'user' && role !== 'assistant'/);
  });

  it('appendTurn validates content is truthy', () => {
    const appendFn = canonical.slice(
      canonical.indexOf('export async function appendTurn'),
      canonical.indexOf('export async function loadRecentTurns')
    );
    expect(appendFn).toMatch(/if\s*\(!content\)\s*return null/);
  });

  it('loadOrSeedRecentTurns falls back to seedFromLegacy', () => {
    const fn = canonical.slice(
      canonical.indexOf('export async function loadOrSeedRecentTurns')
    );
    expect(fn).toMatch(/seedFromLegacy/);
  });

  it('turns include createdAt timestamp', () => {
    const appendFn = canonical.slice(
      canonical.indexOf('export async function appendTurn'),
      canonical.indexOf('export async function loadRecentTurns')
    );
    expect(appendFn).toMatch(/createdAt:\s*serverTimestamp\(\)/);
  });

  it('Workspace assistant append is awaited', () => {
    expect(workspaceClean).toMatch(/await appendTurn\(db,\s*user\.uid,\s*\{.*role:\s*'assistant'/s);
  });
});
