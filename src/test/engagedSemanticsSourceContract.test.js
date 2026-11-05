/**
 * The three surfaces this correction touches whose own component is too
 * large to mount cleanly in a unit test (InlineEngagementSection.jsx,
 * HunterContactDrawer.jsx, PersistentEngageBar.jsx — each 800-1900 lines,
 * with heavy, mostly-unrelated Firebase/Barry dependency surfaces). The
 * underlying primitives they call (updateContactStatus, withEngagementGuard,
 * logEngageSessionStarted) are already behaviorally tested directly in
 * contactStateMachineEngagedSemantics.test.js; this file is the source-text
 * contract proving each surface actually calls the right one, in the shape
 * already established elsewhere in this codebase for exactly this situation
 * (see barryCompositionInvariant.test.js).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (relPath) => readFileSync(resolve(here, '..', relPath), 'utf8');

describe('InlineEngagementSection.jsx: composer-open no longer touches contact_status', () => {
  const file = src('components/contacts/InlineEngagementSection.jsx');

  it('never references STATUS_TRIGGERS.ENGAGE_CLICKED or calls updateContactStatus — only mentions it in an explanatory comment', () => {
    expect(file).not.toMatch(/STATUS_TRIGGERS\.ENGAGE_CLICKED/);
    expect(file).not.toMatch(/updateContactStatus\(/);
  });

  it('activateFlow and startWithIntent both call logEngageSessionStarted, guarded', () => {
    expect(file).toMatch(/import \{ logEngageSessionStarted \} from '\.\.\/\.\.\/utils\/engagementHistoryLogger';/);
    const calls = file.match(/withEngagementGuard\(\s*\n\s*engagementGuardKey\(user\.uid, contact\.id, 'engage_session_started'\),\s*\n\s*\(\) => logEngageSessionStarted\(user\.uid, contact\.id, \{[^}]*\}\),\s*\n\s*\);/g) || [];
    expect(calls.length).toBe(2); // activateFlow + startWithIntent
  });

  it('the hunter_status/hunter_engaged_at write at both sites is untouched', () => {
    const writes = file.match(/hunter_status: 'engaged_pending',\s*\n\s*hunter_engaged_at: new Date\(\)\.toISOString\(\),/g) || [];
    expect(writes.length).toBe(2);
  });
});

describe('HunterContactDrawer.jsx: the drawer-open effect no longer touches contact_status', () => {
  const file = src('components/hunter/HunterContactDrawer.jsx');

  it('its mount effect calls logEngageSessionStarted, guarded, not updateContactStatus with ENGAGE_CLICKED', () => {
    expect(file).not.toMatch(/STATUS_TRIGGERS\.ENGAGE_CLICKED/);
    expect(file).toMatch(/import \{ logEngageSessionStarted \} from '\.\.\/\.\.\/utils\/engagementHistoryLogger';/);
    expect(file).toMatch(/withEngagementGuard\(\s*\n\s*engagementGuardKey\(user\.uid, contact\.id, 'engage_session_started'\),\s*\n\s*\(\) => logEngageSessionStarted\(user\.uid, contact\.id, \{[^}]*\}\),\s*\n\s*\);/);
  });

  it('still uses updateContactStatus for MISSION_ASSIGNED elsewhere — that trigger is untouched by this correction', () => {
    expect(file).toMatch(/trigger: STATUS_TRIGGERS\.MISSION_ASSIGNED/);
  });
});

describe('PersistentEngageBar.jsx: "Brief Barry" is the one path that can advance Engaged', () => {
  const file = src('components/contacts/PersistentEngageBar.jsx');

  it('handleBriefBarry calls updateContactStatus with MANUAL_INTERACTION_LOGGED, after its existing outreach_logged write', () => {
    const briefFn = file.slice(file.indexOf('async function handleBriefBarry'), file.indexOf('async function handleBriefBarry') + 1500);
    expect(briefFn).toMatch(/type: 'outreach_logged'/);
    expect(briefFn).toMatch(/trigger: STATUS_TRIGGERS\.MANUAL_INTERACTION_LOGGED/);
    expect(briefFn).toMatch(/currentStatus: contact\.contact_status/);
    // outreach_logged (the activity record) must be written before the
    // status call, not after — ordering, not just presence.
    expect(briefFn.indexOf("type: 'outreach_logged'")).toBeLessThan(briefFn.indexOf('MANUAL_INTERACTION_LOGGED'));
  });

  it('handleLogReply (the other write site in this file) still uses POSITIVE_REPLY — untouched by this correction', () => {
    expect(file).toMatch(/trigger: STATUS_TRIGGERS\.POSITIVE_REPLY/);
  });
});

describe('FollowUpCard.jsx and barryPipelineAction.js/barryLink.js: no stray reference survives', () => {
  it('FollowUpCard.jsx no longer writes contact_status at all — only mentions it in an explanatory comment', () => {
    expect(src('components/hunter/FollowUpCard.jsx')).not.toMatch(/contact_status:\s*'Engaged'/);
  });

  it("barryPipelineAction.js's STAGE_STATUS_MAP.hunter is null, not 'Engaged'", () => {
    const file = readFileSync(resolve(here, '..', '..', 'netlify/functions/barryPipelineAction.js'), 'utf8');
    const mapBlock = file.slice(file.indexOf('const STAGE_STATUS_MAP'), file.indexOf('};', file.indexOf('const STAGE_STATUS_MAP')));
    expect(mapBlock).toMatch(/hunter:\s*null/);
    expect(mapBlock).not.toMatch(/hunter:\s*'Engaged'/);
  });

  it("barryLink.js's STAGE_STATUS_MAP[STAGE.HUNTER] is null, not 'Engaged' — the two maps stay mirrored", () => {
    const file = readFileSync(resolve(here, '..', '..', 'netlify/functions/barryLink.js'), 'utf8');
    const mapBlock = file.slice(file.indexOf('const STAGE_STATUS_MAP'), file.indexOf('};', file.indexOf('const STAGE_STATUS_MAP')));
    expect(mapBlock).toMatch(/\[STAGE\.HUNTER\]:\s*null/);
    expect(mapBlock).not.toMatch(/\[STAGE\.HUNTER\]:\s*'Engaged'/);
  });

  it("barryPipelineAction.js's engageContact no longer writes contact_status: 'Engaged'", () => {
    const file = readFileSync(resolve(here, '..', '..', 'netlify/functions/barryPipelineAction.js'), 'utf8');
    const fnStart = file.indexOf('async function engageContact');
    const fnBody = file.slice(fnStart, file.indexOf('\n}', fnStart));
    expect(fnBody).not.toMatch(/contact_status:\s*'Engaged'/);
  });
});
