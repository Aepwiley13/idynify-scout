/**
 * The "What Barry Knows" readout renders one card per context area, each with
 * an optional "Impact:" line.
 *
 * Two of those areas — Ideal Customer Profile and Behavioral Signals — used to
 * claim Scout behaviour that is not implemented ("Scout lead scoring reflects
 * your actual ideal customer characteristics", "Scout prioritizes leads showing
 * active buying signals"). Removing the claims left the fields undefined, and
 * the impact block hardcodes its "Impact: " label, so an unguarded render
 * produced a styled box reading "Impact:" with nothing after it.
 *
 * These tests pin the guard: an area with no verified impact to state shows no
 * impact block at all, and an area that does have one still shows it. Delete
 * the guard and the first test fails on a stray "Impact:".
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { vi, describe, it, beforeEach, expect } from 'vitest';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'test-user-uid' } },
  db: {},
}));

vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'test-user-uid' }),
}));

vi.mock('../components/recon/ReconBreadcrumbs', () => ({ default: () => null }));

const mockInitializeDashboard = vi.fn();
vi.mock('../utils/dashboardUtils', () => ({
  initializeDashboard: (...args) => mockInitializeDashboard(...args),
}));

const mockGetDoc = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: (...args) => mockGetDoc(...args),
}));

/** Every RECON section completed, so every context area reads as covered. */
const allSectionsComplete = {
  exists: () => true,
  data: () => ({
    modules: [
      {
        id: 'recon',
        sections: Array.from({ length: 10 }, (_, i) => ({
          sectionId: i + 1,
          title: `Section ${i + 1}`,
          status: 'completed',
          unlocked: true,
        })),
      },
    ],
  }),
};

import BarryTraining from '../pages/Recon/BarryTraining';

/** The card for a named context area, found via its heading. */
function areaCard(label) {
  const heading = screen.getByText(label);
  return heading.closest('.barry-dimension-card');
}

describe('What Barry Knows — impact block is omitted when there is nothing verified to state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDoc.mockResolvedValue(allSectionsComplete);
  });

  it('renders no impact block for Ideal Customer Profile', async () => {
    render(<BarryTraining />);
    await waitFor(() => expect(screen.getByText('Ideal Customer Profile')).toBeInTheDocument());

    const card = areaCard('Ideal Customer Profile');
    expect(card).not.toBeNull();
    expect(card.querySelector('.barry-dimension-impact')).toBeNull();
    expect(within(card).queryByText(/Impact:/)).toBeNull();
  });

  it('renders no impact block for Behavioral Signals', async () => {
    render(<BarryTraining />);
    await waitFor(() => expect(screen.getByText('Behavioral Signals')).toBeInTheDocument());

    const card = areaCard('Behavioral Signals');
    expect(card).not.toBeNull();
    expect(card.querySelector('.barry-dimension-impact')).toBeNull();
    expect(within(card).queryByText(/Impact:/)).toBeNull();
  });

  it('still renders the impact block for areas that have a verified impact', async () => {
    render(<BarryTraining />);
    await waitFor(() => expect(screen.getByText('Messaging Framework')).toBeInTheDocument());

    const card = areaCard('Messaging Framework');
    const impact = card.querySelector('.barry-dimension-impact');
    expect(impact).not.toBeNull();
    expect(impact.textContent).toContain('Impact:');
    expect(impact.textContent).toContain('reflects your actual voice and positioning');
  });

  it('never renders a bare "Impact:" label anywhere on the page', async () => {
    const { container } = render(<BarryTraining />);
    await waitFor(() => expect(screen.getByText('What Barry Knows')).toBeInTheDocument());

    for (const block of container.querySelectorAll('.barry-dimension-impact')) {
      expect(block.textContent.replace('Impact:', '').trim()).not.toBe('');
    }
  });
});
