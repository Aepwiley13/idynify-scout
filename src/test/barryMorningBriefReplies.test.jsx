/**
 * BarryMorningBrief — Sprint 3 pending-replies indicator.
 *
 * The brief is a summary, not an inbox: the indicator shows only when there is
 * something waiting, stays to one line, and must survive a backend that has not
 * been redeployed yet (no pendingRepliesCount in the payload at all).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import BarryMorningBrief from '../components/mission-control/BarryMorningBrief';

const T = {
  cardBg: '#fff', border: '#eee', text: '#111', textMuted: '#666',
  surface2: '#f5f5f5', accent: '#e8197d',
};

const ready = (extra = {}) => ({
  status: 'ready',
  brief: 'Two missions in flight.',
  suggestedPrompts: [],
  ...extra,
});

const renderBrief = (orientation) =>
  render(<BarryMorningBrief orientation={orientation} openBarry={() => {}} T={T} />);

describe('pending replies indicator', () => {
  it('is hidden when no replies are waiting', () => {
    renderBrief(ready({ pendingRepliesCount: 0 }));
    expect(screen.queryByText(/waiting for you/i)).not.toBeInTheDocument();
  });

  it('is hidden when the backend has not been redeployed yet', () => {
    renderBrief(ready());
    expect(screen.queryByText(/waiting for you/i)).not.toBeInTheDocument();
  });

  it('shows a singular count with the first name', () => {
    renderBrief(ready({
      pendingRepliesCount: 1,
      pendingRepliesPreview: [{ name: 'Jane Doe', company: 'Acme' }],
    }));
    expect(screen.getByText('1 reply')).toBeInTheDocument();
    expect(screen.getByText(/Jane Doe replied/)).toBeInTheDocument();
  });

  it('pluralises correctly — never "2 replys"', () => {
    renderBrief(ready({ pendingRepliesCount: 2, pendingRepliesPreview: [] }));
    expect(screen.getByText('2 replies')).toBeInTheDocument();
    expect(screen.queryByText(/replys/i)).not.toBeInTheDocument();
  });

  it('renders without a preview array', () => {
    renderBrief(ready({ pendingRepliesCount: 3 }));
    expect(screen.getByText('3 replies')).toBeInTheDocument();
    expect(screen.getByText(/waiting for you/i)).toBeInTheDocument();
  });

  it('ignores a non-numeric count rather than rendering NaN', () => {
    renderBrief(ready({ pendingRepliesCount: 'lots' }));
    expect(screen.queryByText(/waiting for you/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('stays hidden while the brief is still loading', () => {
    renderBrief({ status: 'loading', pendingRepliesCount: 4 });
    expect(screen.queryByText(/waiting for you/i)).not.toBeInTheDocument();
  });

  it('stays hidden when the brief failed', () => {
    renderBrief({ status: 'error', pendingRepliesCount: 4 });
    expect(screen.queryByText(/waiting for you/i)).not.toBeInTheDocument();
  });

  it('still renders the brief body alongside the indicator', () => {
    renderBrief(ready({ pendingRepliesCount: 1, pendingRepliesPreview: [{ name: 'Jane' }] }));
    expect(screen.getByText('Two missions in flight.')).toBeInTheDocument();
    expect(screen.getByText('1 reply')).toBeInTheDocument();
  });
});
