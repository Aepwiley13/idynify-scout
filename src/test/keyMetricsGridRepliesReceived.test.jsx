/**
 * KeyMetricsGrid's reply metric used to read contact.engagement_summary.
 * replies_received directly — a legacy mirror the live reply pipeline
 * (replyPolling.js) never wrote on its own, and a value getReplyCount()'s
 * canonical-first read already exists precisely to replace.
 *
 * It was also displayed as a percentage capped at 100% (replies_received /
 * total_messages_sent), which implied a bounded "fraction of my messages
 * that got a reply" the data model cannot actually support — reply_count
 * has no pairing to which outbound message each reply answered. A
 * follow-up attempt to express it as an uncapped ratio ("2.0x") still
 * invited reading it as a per-send responsiveness score a single
 * contact's count doesn't represent. Settled on the one claim the data
 * straightforwardly supports: a plain count, "Replies Received". Reply-
 * to-send ratios belong at the campaign/cadence level, not this per-
 * contact card.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import KeyMetricsGrid from '../components/contacts/KeyMetricsGrid.jsx';

function contact(overrides) {
  return { engagement_summary: { total_messages_sent: 4 }, ...overrides };
}

describe('KeyMetricsGrid Replies Received: shows the canonical reply count, plainly', () => {
  it('prefers the canonical relationship.reply_count over the legacy mirror', () => {
    render(<KeyMetricsGrid contact={contact({
      relationship: { reply_count: 2 },
      engagement_summary: { total_messages_sent: 4, replies_received: 99 },
    })} />);
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByText('99')).toBeNull();
  });

  it('falls back to the legacy mirror when canonical is absent (pre-backfill contacts)', () => {
    render(<KeyMetricsGrid contact={contact({
      engagement_summary: { total_messages_sent: 4, replies_received: 1 },
    })} />);
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('shows the full count even when it exceeds touchpoints — no capping, no percentage, no ratio', () => {
    render(<KeyMetricsGrid contact={contact({
      relationship: { reply_count: 3 },
      engagement_summary: { total_messages_sent: 1 },
    })} />);
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.queryByText('300%')).toBeNull();
    expect(screen.queryByText('3.0x')).toBeNull();
  });

  it('shows 0 for a contact with no replies at all, independent of touchpoints', () => {
    render(<KeyMetricsGrid contact={contact({ engagement_summary: { total_messages_sent: 2 } })} />);
    expect(screen.getAllByText('0').length).toBeGreaterThan(0); // Replies Received (Referrals Out also defaults to 0 here)
    expect(screen.getByText('2')).toBeTruthy(); // touchpoints, distinct from the 0 replies
  });

  it('labels the metric "Replies Received", not "Reply Rate" or "Replies/Send"', () => {
    render(<KeyMetricsGrid contact={contact({ relationship: { reply_count: 1 } })} />);
    expect(screen.getByText('Replies Received')).toBeTruthy();
    expect(screen.queryByText('Reply Rate')).toBeNull();
    expect(screen.queryByText('Replies/Send')).toBeNull();
  });
});
