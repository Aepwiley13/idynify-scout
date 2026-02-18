/**
 * Regression tests for the RECON blank screen P1 bug.
 *
 * Bug 1: ReconModulePage returned null when moduleId was unrecognised,
 *        producing a blank screen before the useEffect redirect fired.
 * Bug 2: loadSections() swallowed Firestore errors silently, leaving the
 *        user with an empty-looking page and no recovery path.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, beforeEach, expect } from 'vitest';

// ─── Mutable state shared between mocks and tests ──────────────────────────
let mockModuleId = 'icp-intelligence';
const mockNavigate = vi.fn();

// ─── Module mocks ───────────────────────────────────────────────────────────
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ moduleId: mockModuleId }),
    useLocation: () => ({ pathname: `/recon/${mockModuleId}` }),
  };
});

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'test-user-uid' } },
  db: {},
}));

const mockInitializeDashboard = vi.fn();
vi.mock('../utils/dashboardUtils', () => ({
  initializeDashboard: (...args) => mockInitializeDashboard(...args),
}));

const mockGetDoc = vi.fn();
const mockDoc = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: (...args) => mockDoc(...args),
  getDoc: (...args) => mockGetDoc(...args),
}));

// Minimal dashboard payload with ICP Intelligence sections
const successfulDashboard = {
  exists: () => true,
  data: () => ({
    modules: [
      {
        id: 'recon',
        sections: [
          { sectionId: 1, title: 'Business Foundation', description: 'Core info', status: 'not_started', unlocked: true, estimatedTime: '5 min' },
          { sectionId: 2, title: 'Product Deep Dive', description: 'Product details', status: 'not_started', unlocked: false, estimatedTime: '6 min' },
          { sectionId: 3, title: 'Target Market', description: 'Firmographics', status: 'not_started', unlocked: false, estimatedTime: '5 min' },
          { sectionId: 4, title: 'Customer Psychographics', description: 'Psychology', status: 'not_started', unlocked: false, estimatedTime: '5 min' },
        ],
      },
    ],
  }),
};

import ReconModulePage from '../pages/Recon/ReconModulePage';

describe('Bug 1 — invalid moduleId never shows a blank screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModuleId = 'this-module-does-not-exist';
  });

  it('renders a spinner (not null) when moduleId is not in MODULE_CONFIG', () => {
    const { container } = render(<ReconModulePage />);

    // Must not return null — container must have a child element
    expect(container.firstChild).not.toBeNull();

    // Must show the loading spinner text
    expect(screen.getByText('Loading module...')).toBeInTheDocument();
  });

  it('calls navigate("/recon") to redirect away from the invalid route', async () => {
    render(<ReconModulePage />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/recon');
    });
  });
});

describe('Bug 2 — Firestore error shows error UI, not a blank/empty page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModuleId = 'icp-intelligence';
    mockDoc.mockReturnValue({});
  });

  it('shows the error message when initializeDashboard throws', async () => {
    mockInitializeDashboard.mockRejectedValueOnce(
      new Error('Firestore permission denied')
    );

    render(<ReconModulePage />);

    await waitFor(() => {
      expect(
        screen.getByText('Firestore permission denied')
      ).toBeInTheDocument();
    });
  });

  it('shows a Retry button when an error occurs', async () => {
    mockInitializeDashboard.mockRejectedValueOnce(new Error('Network error'));

    render(<ReconModulePage />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Retry' })
      ).toBeInTheDocument();
    });
  });

  it('Retry resets to spinner (loading=true) before re-fetching, never blank', async () => {
    // First call fails, second call succeeds
    mockInitializeDashboard
      .mockRejectedValueOnce(new Error('Temporary network error'))
      .mockResolvedValueOnce({ success: true, alreadyExists: true });
    mockGetDoc.mockResolvedValue(successfulDashboard);

    render(<ReconModulePage />);

    // Wait for error UI to appear
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    );

    // Click Retry — loading spinner must appear immediately (not a blank)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByText('Loading module...')).toBeInTheDocument();
  });

  it('does not render null or an empty container on error', async () => {
    mockInitializeDashboard.mockRejectedValueOnce(new Error('Error'));

    const { container } = render(<ReconModulePage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    );

    // Container must always have content
    expect(container.firstChild).not.toBeNull();
  });

  it('shows module sections after a successful retry', async () => {
    mockInitializeDashboard
      .mockRejectedValueOnce(new Error('Temporary error'))
      .mockResolvedValueOnce({ success: true, alreadyExists: true });
    mockGetDoc.mockResolvedValue(successfulDashboard);

    render(<ReconModulePage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByText('Business Foundation')).toBeInTheDocument();
    });
  });
});
