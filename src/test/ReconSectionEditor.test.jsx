/**
 * Regression tests for the RECON blank screen P1 bug.
 *
 * Bug 3: ReconSectionEditor called navigate() inside loadSection() but the
 *        finally block still fired setLoading(false), causing a re-render
 *        with section=null that flashed "Section not found" before React
 *        Router completed the redirect. Users saw a visible error message
 *        for a brief but noticeable moment.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, beforeEach, expect } from 'vitest';

// ─── Mutable state shared between mocks and tests ──────────────────────────
let mockSectionId = '1';
const mockNavigate = vi.fn();

// ─── Module mocks ───────────────────────────────────────────────────────────
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ sectionId: mockSectionId }),
    useLocation: () => ({ pathname: `/recon/section/${mockSectionId}` }),
  };
});

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'test-user-uid' } },
  db: {},
}));

const mockGetSectionData = vi.fn();
const mockStartSection = vi.fn();
vi.mock('../utils/dashboardUtils', () => ({
  getSectionData: (...args) => mockGetSectionData(...args),
  startSection: (...args) => mockStartSection(...args),
  saveSectionData: vi.fn(),
  completeSection: vi.fn(),
}));

import ReconSectionEditor from '../pages/Recon/ReconSectionEditor';

describe('Bug 3 — no "Section not found" flash when redirecting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSectionId = '1';
    mockStartSection.mockResolvedValue({ success: true });
  });

  it('never shows "Section not found" when getSectionData returns null', async () => {
    mockGetSectionData.mockResolvedValueOnce(null);

    render(<ReconSectionEditor />);

    // Wait for navigate to be called (redirect happens)
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/recon/icp-intelligence');
    });

    // "Section not found" must never have appeared at any point
    expect(screen.queryByText('Section not found')).not.toBeInTheDocument();
  });

  it('never shows "Section not found" when section is locked', async () => {
    mockGetSectionData.mockResolvedValueOnce({
      sectionId: 1,
      unlocked: false,
      status: 'not_started',
      title: 'Business Foundation',
      data: null,
    });

    render(<ReconSectionEditor />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/recon/icp-intelligence');
    });

    expect(screen.queryByText('Section not found')).not.toBeInTheDocument();
  });

  it('uses /recon as fallback when sectionId does not map to a module', async () => {
    // sectionId 999 is not in SECTION_TO_MODULE, so parentModule is undefined
    mockSectionId = '999';
    mockGetSectionData.mockResolvedValueOnce(null);

    render(<ReconSectionEditor />);

    await waitFor(() => {
      // Should fall back to '/recon' not '/recon/' or '/recon/undefined'
      expect(mockNavigate).toHaveBeenCalledWith('/recon');
    });
  });

  it('does not redirect and does not show error when section is valid and unlocked', async () => {
    mockGetSectionData.mockResolvedValueOnce({
      sectionId: 1,
      unlocked: true,
      status: 'not_started',
      title: 'Business Foundation',
      description: 'Core business information',
      order: 1,
      estimatedTime: '5-7 minutes',
      data: {},
    });

    render(<ReconSectionEditor />);

    // Wait for loadSection to complete (startSection is awaited inside)
    await waitFor(() => {
      expect(mockStartSection).toHaveBeenCalledWith('test-user-uid', 'recon', 1);
    });

    // The core Bug 3 assertions: no redirect, no error flash
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.queryByText('Section not found')).not.toBeInTheDocument();
  });
});
