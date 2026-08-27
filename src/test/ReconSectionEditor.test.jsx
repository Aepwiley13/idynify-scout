/**
 * Regression tests for the RECON blank screen P1 bug.
 *
 * Bug 3: ReconSectionEditor called navigate() inside loadSection() but the
 *        finally block still fired setLoading(false), causing a re-render
 *        with section=null that flashed "Section not found" before React
 *        Router completed the redirect. Users saw a visible error message
 *        for a brief but noticeable moment.
 *
 * The fix has since moved on from the redirect entirely. An unreadable or
 * locked section now sets `blockedSection` and renders the lock gate in
 * place — nobody is bounced to another route mid-load, and "Section not
 * found" has no path to the screen at all. The Bug 3 guarantee is unchanged
 * and these specs still hold it; what they no longer assert is the redirect
 * that used to deliver it.
 *
 * Worth knowing why that drift went unnoticed: every spec here threw on
 * `window.matchMedia` before reaching an assertion, so the suite reported
 * failures rather than false greens, and the stale expectations sat behind
 * them. The shim in src/test/setup.js is what let them run.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

    // Unreadable section resolves to the lock gate, rendered in place.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /is locked/i })).toBeInTheDocument();
    });

    // "Section not found" must never have appeared at any point
    expect(screen.queryByText('Section not found')).not.toBeInTheDocument();
    // And the user is not bounced to another route mid-load.
    expect(mockNavigate).not.toHaveBeenCalled();
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

    // The gate names the section it is holding, and the prerequisite to clear.
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /Business Foundation is locked/i })
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/Section 0:/)).toBeInTheDocument();

    expect(screen.queryByText('Section not found')).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('uses /recon as fallback when sectionId does not map to a module', async () => {
    // sectionId 999 is not in SECTION_TO_MODULE, so parentModule is undefined.
    // The fallback now lives on the lock gate's Back button rather than on an
    // automatic redirect, but the string it must never produce is the same one:
    // '/recon/undefined'.
    mockSectionId = '999';
    mockGetSectionData.mockResolvedValueOnce(null);

    render(<ReconSectionEditor />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(mockNavigate).toHaveBeenCalledWith('/recon');
    expect(mockNavigate).not.toHaveBeenCalledWith('/recon/undefined');
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
