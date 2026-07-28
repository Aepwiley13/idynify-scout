import { describe, it, expect } from 'vitest';
import { formatRecommendationTitle } from '../utils/recommendationCopy';

function makeRec(overrides) {
  return {
    type: null,
    contactName: null,
    missionName: null,
    campaignName: null,
    action: { label: 'View' },
    reasoning: { observed: '', whyItMatters: '' },
    ...overrides,
  };
}

describe('formatRecommendationTitle', () => {

  // ── next_step_overdue ──
  it('next_step_overdue with contact name', () => {
    expect(formatRecommendationTitle(makeRec({
      type: 'next_step_overdue', contactName: 'David Butterfield',
    }))).toBe('Follow up with David Butterfield');
  });

  it('next_step_overdue without contact name', () => {
    expect(formatRecommendationTitle(makeRec({
      type: 'next_step_overdue',
    }))).toBe('Complete overdue step');
  });

  // ── stalled_awaiting_reply ──
  it('stalled_awaiting_reply with contact name', () => {
    expect(formatRecommendationTitle(makeRec({
      type: 'stalled_awaiting_reply', contactName: 'Angela Phillips',
    }))).toBe('Follow up with Angela Phillips');
  });

  it('stalled_awaiting_reply without contact name', () => {
    expect(formatRecommendationTitle(makeRec({
      type: 'stalled_awaiting_reply',
    }))).toBe('Follow up on stalled conversation');
  });

  // ── stalled_mission_inactive ──
  it('stalled_mission_inactive with mission name', () => {
    expect(formatRecommendationTitle(makeRec({
      type: 'stalled_mission_inactive', missionName: 'Acme Corp',
    }))).toBe('Review stalled mission with Acme Corp');
  });

  it('stalled_mission_inactive without mission name', () => {
    expect(formatRecommendationTitle(makeRec({
      type: 'stalled_mission_inactive',
    }))).toBe('Review stalled mission');
  });

  // ── stalled_outcome_not_recorded ──
  it('stalled_outcome_not_recorded with contact name', () => {
    expect(formatRecommendationTitle(makeRec({
      type: 'stalled_outcome_not_recorded', contactName: 'Jordan Lee',
    }))).toBe('Record outcome for Jordan Lee');
  });

  // ── high_value_no_mission ──
  it('high_value_no_mission with contact name', () => {
    expect(formatRecommendationTitle(makeRec({
      type: 'high_value_no_mission', contactName: 'Sarah Johnson',
    }))).toBe('Start a mission with Sarah Johnson');
  });

  // ── high_value_no_engagement ──
  it('high_value_no_engagement with contact name', () => {
    expect(formatRecommendationTitle(makeRec({
      type: 'high_value_no_engagement', contactName: 'Taylor Kim',
    }))).toBe('Engage Taylor Kim');
  });

  // ── high_value_dormant ──
  it('high_value_dormant with contact name', () => {
    expect(formatRecommendationTitle(makeRec({
      type: 'high_value_dormant', contactName: 'Sarah Johnson',
    }))).toBe('Re-engage Sarah Johnson');
  });

  it('high_value_dormant without contact name', () => {
    expect(formatRecommendationTitle(makeRec({
      type: 'high_value_dormant',
    }))).toBe('Re-engage dormant contact');
  });

  // ── momentum_channel_switch ──
  it('momentum_channel_switch with contact name', () => {
    expect(formatRecommendationTitle(makeRec({
      type: 'momentum_channel_switch', contactName: 'Alex Morgan',
    }))).toBe('Try a new channel with Alex Morgan');
  });

  // ── momentum_accelerate ──
  it('momentum_accelerate with contact name', () => {
    expect(formatRecommendationTitle(makeRec({
      type: 'momentum_accelerate', contactName: 'Angela Phillips',
    }))).toBe('Follow up with Angela Phillips');
  });

  // ── momentum_compress ──
  it('momentum_compress with contact name', () => {
    expect(formatRecommendationTitle(makeRec({
      type: 'momentum_compress', contactName: 'Chris Park',
    }))).toBe('Compress sequence for Chris Park');
  });

  // ── strategic_gap_no_engagement ──
  it('strategic_gap_no_engagement with campaign name', () => {
    expect(formatRecommendationTitle(makeRec({
      type: 'strategic_gap_no_engagement', campaignName: 'Q3 Outreach',
    }))).toBe('Re-engage contacts in Q3 Outreach');
  });

  // ── strategic_gap_never_contacted ──
  it('strategic_gap_never_contacted with campaign name', () => {
    expect(formatRecommendationTitle(makeRec({
      type: 'strategic_gap_never_contacted', campaignName: 'Enterprise Push',
    }))).toBe('Activate contacts in Enterprise Push');
  });

  // ── strategic_gap_no_outcome ──
  it('strategic_gap_no_outcome with campaign name', () => {
    expect(formatRecommendationTitle(makeRec({
      type: 'strategic_gap_no_outcome', campaignName: 'Summer Campaign',
    }))).toBe('Record outcomes for Summer Campaign');
  });

  // ── Unknown / future type fallback ──
  it('unknown type with entity name falls back to actionLabel — entityName', () => {
    expect(formatRecommendationTitle(makeRec({
      type: 'some_future_type', contactName: 'Jane Doe', action: { label: 'Check In' },
    }))).toBe('Check In — Jane Doe');
  });

  it('unknown type without entity falls back to reason', () => {
    expect(formatRecommendationTitle(makeRec({
      type: 'some_future_type', reasoning: { observed: 'Something happened' },
    }))).toBe('Something happened');
  });

  it('unknown type without entity or reason falls back to actionLabel', () => {
    expect(formatRecommendationTitle(makeRec({
      type: 'some_future_type',
    }))).toBe('View');
  });

  it('null type uses fallback path', () => {
    expect(formatRecommendationTitle(makeRec({
      type: null, contactName: 'Pat', action: { label: 'Open' },
    }))).toBe('Open — Pat');
  });
});
