import { describe, it, expect } from 'vitest';

// buildMorningSummary is not exported from TodaysPriorities (it's a local function),
// so we replicate its logic here for unit testing. The function is also tested
// indirectly through visual verification of the rendered component.
function buildMorningSummary(priorityCount, replyCount, matchCount) {
  const parts = [];
  parts.push(`${priorityCount} ${priorityCount === 1 ? 'priority' : 'priorities'}`);
  if (replyCount > 0) {
    parts.push(`${replyCount} ${replyCount === 1 ? 'reply' : 'replies'} waiting`);
  }
  if (matchCount > 0) {
    parts.push(`${matchCount} strong ${matchCount === 1 ? 'match' : 'matches'} ready`);
  }
  if (parts.length === 1) return `Today you have ${parts[0]}.`;
  if (parts.length === 2) return `Today you have ${parts[0]} and ${parts[1]}.`;
  return `Today you have ${parts[0]}, ${parts[1]}, and ${parts[2]}.`;
}

describe('buildMorningSummary', () => {

  // ── Singular / plural priorities ──
  it('singular priority', () => {
    expect(buildMorningSummary(1, 0, 0)).toBe('Today you have 1 priority.');
  });

  it('plural priorities', () => {
    expect(buildMorningSummary(3, 0, 0)).toBe('Today you have 3 priorities.');
  });

  // ── Priorities only ──
  it('priorities only — no replies, no matches', () => {
    expect(buildMorningSummary(5, 0, 0)).toBe('Today you have 5 priorities.');
  });

  // ── Priorities + replies ──
  it('priorities and singular reply', () => {
    expect(buildMorningSummary(3, 1, 0)).toBe('Today you have 3 priorities and 1 reply waiting.');
  });

  it('priorities and plural replies', () => {
    expect(buildMorningSummary(2, 4, 0)).toBe('Today you have 2 priorities and 4 replies waiting.');
  });

  // ── Priorities + strong matches ──
  it('priorities and singular strong match', () => {
    expect(buildMorningSummary(3, 0, 1)).toBe('Today you have 3 priorities and 1 strong match ready.');
  });

  it('priorities and plural strong matches', () => {
    expect(buildMorningSummary(3, 0, 7)).toBe('Today you have 3 priorities and 7 strong matches ready.');
  });

  // ── All three segments ──
  it('all segments present — singular reply', () => {
    expect(buildMorningSummary(1, 1, 7)).toBe(
      'Today you have 1 priority, 1 reply waiting, and 7 strong matches ready.'
    );
  });

  it('all segments present — plural', () => {
    expect(buildMorningSummary(3, 1, 7)).toBe(
      'Today you have 3 priorities, 1 reply waiting, and 7 strong matches ready.'
    );
  });

  it('all segments present — large numbers', () => {
    expect(buildMorningSummary(5, 12, 42)).toBe(
      'Today you have 5 priorities, 12 replies waiting, and 42 strong matches ready.'
    );
  });
});
