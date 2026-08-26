/**
 * Gate 3 — First Value Company Results
 *
 * Structural invariants verified by source scan:
 *
 * R1  Embedded mode suppresses auto-navigate after ICP confirmation.
 * R2  barryState === 'READY' drives the results interaction.
 * R3  Results use real canonical pending Company documents.
 * R4  Scoring/ranking does not alter persisted Match/ICP authority.
 * R5  Accepting updates that exact Company document (pending → accepted).
 * R6  No new Person records are created by this flow.
 * R7  No new Company/result/batch persistence exists.
 * R8  CompanyResultsCard renders in the workspace _feCard system.
 * R9  ICP confirmation still uses the verified authority sequence.
 * R10 Canonical Barry conversation remains intact.
 * R11 Scout navigation uses existing route.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const onboarding = read('../pages/Onboarding/BarryOnboarding.jsx');
const onboardingCode = code(onboarding);
const workspace = read('../pages/Barry/BarryWorkspace.jsx');
const workspaceCode = code(workspace);
const resultsCard = read('../components/onboarding/CompanyResultsCard.jsx');
const resultsCardCode = code(resultsCard);
const resultsCss = read('../components/onboarding/CompanyResultsCard.css');

// ═══════════════════════════════════════════════════════════════════════════
// R1 — Embedded mode suppresses auto-navigate
// ═══════════════════════════════════════════════════════════════════════════

describe('R1 — Embedded mode suppresses auto-navigate', () => {
  it('navigate to mission-control-v2 is guarded by !embedded', () => {
    expect(onboardingCode).toMatch(/if \(!embedded\)[\s\S]*?navigate\('\/mission-control-v2'\)/);
  });

  it('embedded mode does not call navigate after confirmation', () => {
    const lines = onboardingCode.split('\n');
    const navLine = lines.findIndex(l => l.includes("navigate('/mission-control-v2')"));
    expect(navLine).toBeGreaterThan(-1);
    const contextBefore = lines.slice(Math.max(0, navLine - 5), navLine + 1).join('\n');
    expect(contextBefore).toMatch(/!embedded/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R2 — barryState === 'READY' drives the results interaction
// ═══════════════════════════════════════════════════════════════════════════

describe('R2 — barryState drives results', () => {
  it('workspace imports useOnboardingState', () => {
    expect(workspace).toMatch(/import.*useOnboardingState/);
  });

  it('workspace destructures barryState from useOnboardingState', () => {
    expect(workspaceCode).toMatch(/barryState.*useOnboardingState/);
  });

  it('results loading is gated on barryState READY', () => {
    expect(workspaceCode).toMatch(/barryState !== 'READY'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R3 — Results use real canonical pending Company documents
// ═══════════════════════════════════════════════════════════════════════════

describe('R3 — Real canonical pending companies', () => {
  it('queries companies collection with status pending', () => {
    expect(workspaceCode).toMatch(/where\('status', '==', 'pending'\)/);
  });

  it('reads from users/{uid}/companies path', () => {
    expect(workspaceCode).toMatch(/collection\(db, 'users',.*'companies'\)/);
  });

  it('scores with calculateICPScore', () => {
    expect(workspaceCode).toMatch(/calculateICPScore/);
    expect(workspace).toMatch(/import.*calculateICPScore/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R4 — Scoring does not alter persisted data
// ═══════════════════════════════════════════════════════════════════════════

describe('R4 — Scoring does not alter persisted data', () => {
  it('workspace does not write to icpProfiles', () => {
    expect(workspaceCode).not.toMatch(/setDoc.*icpProfiles/);
  });

  it('workspace does not write to companyProfile', () => {
    expect(workspaceCode).not.toMatch(/setDoc.*companyProfile/);
  });

  it('fit score is stored as a local prop (_fitScore), not written back', () => {
    expect(workspaceCode).toMatch(/_fitScore/);
    expect(workspaceCode).not.toMatch(/updateDoc.*_fitScore/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R5 — Accepting updates the exact Company document
// ═══════════════════════════════════════════════════════════════════════════

describe('R5 — Company acceptance uses canonical document', () => {
  it('CompanyResultsCard writes status accepted via updateDoc', () => {
    expect(resultsCardCode).toMatch(/updateDoc/);
    expect(resultsCardCode).toMatch(/status: 'accepted'/);
  });

  it('writes to users/{uid}/companies/{companyId}', () => {
    expect(resultsCardCode).toMatch(/doc\(db, 'users',.*'companies', company\.id\)/);
  });

  it('skip sets status to rejected', () => {
    expect(resultsCardCode).toMatch(/updateDoc/);
    expect(resultsCardCode).toMatch(/status: 'rejected'/);
  });

  it('sets swipe_source to barry_first_value', () => {
    expect(resultsCardCode).toMatch(/swipe_source: 'barry_first_value'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R6 — No new Person records created
// ═══════════════════════════════════════════════════════════════════════════

describe('R6 — No Person records from this flow', () => {
  it('CompanyResultsCard does not call searchPeople', () => {
    expect(resultsCardCode).not.toMatch(/searchPeople/);
  });

  it('CompanyResultsCard does not write to contacts collection', () => {
    expect(resultsCardCode).not.toMatch(/contacts/);
  });

  it('CompanyResultsCard does not import prepareContactWrite', () => {
    expect(resultsCard).not.toMatch(/prepareContactWrite/);
  });

  it('workspace results effect does not call searchPeople', () => {
    const resultsEffect = workspaceCode.split("barryState !== 'READY'")[1]?.split('async function init')[0] || '';
    expect(resultsEffect).not.toMatch(/searchPeople/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R7 — No new Company/result/batch persistence
// ═══════════════════════════════════════════════════════════════════════════

describe('R7 — No new persistence models', () => {
  it('CompanyResultsCard does not create collections', () => {
    expect(resultsCardCode).not.toMatch(/setDoc.*collection/);
    expect(resultsCardCode).not.toMatch(/addDoc/);
  });

  it('no discovery batch or result set persisted in workspace', () => {
    expect(workspaceCode).not.toMatch(/discoveryBatch/);
    expect(workspaceCode).not.toMatch(/resultSet/);
    expect(workspaceCode).not.toMatch(/firstValueResults/);
  });

  it('CompanyResultsCard does not duplicate Company documents', () => {
    expect(resultsCardCode).not.toMatch(/setDoc/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R8 — CompanyResultsCard renders in the _feCard system
// ═══════════════════════════════════════════════════════════════════════════

describe('R8 — Results card in _feCard system', () => {
  it('workspace imports CompanyResultsCard', () => {
    expect(workspace).toMatch(/import CompanyResultsCard/);
  });

  it('results turn carries _feCard results', () => {
    expect(workspaceCode).toMatch(/_feCard: 'results'/);
  });

  it('workspace renders CompanyResultsCard for _feCard results', () => {
    expect(workspaceCode).toMatch(/_feCard === 'results'/);
    expect(workspaceCode).toMatch(/<CompanyResultsCard/);
  });

  it('rendered inside barry-workspace-fe-card container', () => {
    const cardSection = workspaceCode.split("_feCard === 'results'")[1]?.split('_feCard ===')[0] || '';
    expect(cardSection).toMatch(/barry-workspace-fe-card/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R9 — ICP authority sequence preserved
// ═══════════════════════════════════════════════════════════════════════════

describe('R9 — ICP authority sequence preserved', () => {
  it('resolveActiveIcp still called', () => {
    expect(onboardingCode).toMatch(/resolveActiveIcp\(user\.uid\)/);
  });

  it('icpProfiles write still present', () => {
    expect(onboardingCode).toMatch(/'icpProfiles', icpId/);
  });

  it('setActiveIcpProfile still called', () => {
    expect(onboardingCode).toMatch(/setActiveIcpProfile\(user\.uid, icpId\)/);
  });

  it('icpIdSource attribution preserved', () => {
    expect(onboardingCode).toMatch(/icpIdSource: 'barry_onboarding_confirmed'/);
  });

  it('search-companies trigger still present', () => {
    expect(onboardingCode).toMatch(/search-companies/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R10 — Canonical conversation intact
// ═══════════════════════════════════════════════════════════════════════════

describe('R10 — Canonical conversation intact', () => {
  it('workspace still appends FE turns to canonical store', () => {
    expect(workspaceCode).toMatch(/appendTurn\(db,.*surface: 'workspace'/);
  });

  it('workspace does not duplicate barryICPConversation', () => {
    expect(workspaceCode).not.toMatch(/barryICPConversation/);
  });

  it('controller still does not call appendTurn', () => {
    const ctrl = read('../hooks/useFirstExperienceController.js');
    const ctrlCode = code(ctrl);
    expect(ctrlCode).not.toMatch(/appendTurn\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R11 — Scout navigation
// ═══════════════════════════════════════════════════════════════════════════

describe('R11 — Scout navigation from results', () => {
  it('workspace navigates to /scout with daily-leads tab', () => {
    expect(workspaceCode).toMatch(/navigate\('\/scout'.*activeTab: 'daily-leads'/);
  });

  it('Review button text is present', () => {
    expect(workspaceCode).toMatch(/Review these in Scout/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CSS — CompanyResultsCard uses CSS-var tokens
// ═══════════════════════════════════════════════════════════════════════════

describe('CompanyResultsCard CSS uses CSS-var tokens', () => {
  it('uses --border token', () => {
    expect(resultsCss).toMatch(/var\(--border/);
  });

  it('uses --surface token', () => {
    expect(resultsCss).toMatch(/var\(--surface/);
  });

  it('uses --text token', () => {
    expect(resultsCss).toMatch(/var\(--text/);
  });

  it('uses --accent token', () => {
    expect(resultsCss).toMatch(/var\(--accent/);
  });

  it('uses --text-muted token', () => {
    expect(resultsCss).toMatch(/var\(--text-muted/);
  });
});
