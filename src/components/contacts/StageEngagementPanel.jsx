/**
 * StageEngagementPanel — Orchestrator that renders the correct per-stage panel.
 *
 * Routes to:
 *   ScoutEngagementPanel       — stage: 'scout'
 *   HunterEngagementPanel      — stage: 'hunter'
 *   SniperEngagementPanel      — stage: 'sniper'
 *   BasecampEngagementPanel    — stage: 'basecamp'
 *   ReinforcementsEngagementPanel — stage: 'reinforcements'
 *   FallbackEngagementPanel    — stage: 'fallback'
 *
 * Returns null for partner/network contacts (no pipeline stage).
 */

import { resolveContactStage } from '../../constants/stageSystem';
import ScoutEngagementPanel from './ScoutEngagementPanel';
import HunterEngagementPanel from './HunterEngagementPanel';
import SniperEngagementPanel from './SniperEngagementPanel';
import BasecampEngagementPanel from './BasecampEngagementPanel';
import ReinforcementsEngagementPanel from './ReinforcementsEngagementPanel';
import FallbackEngagementPanel from './FallbackEngagementPanel';

const STAGE_PANELS = {
  scout:          ScoutEngagementPanel,
  hunter:         HunterEngagementPanel,
  sniper:         SniperEngagementPanel,
  basecamp:       BasecampEngagementPanel,
  reinforcements: ReinforcementsEngagementPanel,
  fallback:       FallbackEngagementPanel,
};

export default function StageEngagementPanel({ contact, onMoved }) {
  if (!contact) return null;

  const stage = resolveContactStage(contact);
  const Panel = STAGE_PANELS[stage];

  if (!Panel) return null;

  return <Panel contact={contact} onMoved={onMoved} />;
}
