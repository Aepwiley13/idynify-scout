/**
 * KeyMetricsGrid's Reply Rate used to read contact.engagement_summary.
 * replies_received directly — a legacy mirror the live reply pipeline
 * (replyPolling.js) never wrote on its own, and a value getReplyCount()'s
 * canonical-first read already exists precisely to replace. It also had no
 * ceiling: a contact with several genuine replies to one send could show
 * over 100%, which reads as "more people replied than we contacted" on a
 * per-contact card.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import KeyMetricsGrid from '../components/contacts/KeyMetricsGrid.jsx';

function contact(overrides) {
  return { engagement_summary: { total_messages_sent: 4 }, ...overrides };
}

describe('KeyMetricsGrid Reply Rate: reads the canonical reply count, capped at 100%', () => {
  it('prefers the canonical relationship.reply_count over the legacy mirror', () => {
    render(<KeyMetricsGrid contact={contact({
      relationship: { reply_count: 2 },
      engagement_summary: { total_messages_sent: 4, replies_received: 99 },
    })} />);
    expect(screen.getByText('50%')).toBeTruthy();
  });

  it('falls back to the legacy mirror when canonical is absent (pre-backfill contacts)', () => {
    render(<KeyMetricsGrid contact={contact({
      engagement_summary: { total_messages_sent: 4, replies_received: 1 },
    })} />);
    expect(screen.getByText('25%')).toBeTruthy();
  });

  it('caps the displayed rate at 100% when reply_count exceeds touchpoints', () => {
    render(<KeyMetricsGrid contact={contact({
      relationship: { reply_count: 3 },
      engagement_summary: { total_messages_sent: 1 },
    })} />);
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.queryByText('300%')).toBeNull();
  });

  it('shows — when there are no touchpoints at all', () => {
    render(<KeyMetricsGrid contact={contact({ engagement_summary: { total_messages_sent: 0 } })} />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
