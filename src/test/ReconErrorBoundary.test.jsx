/**
 * Tests for ReconErrorBoundary — Phase 5 of the validation plan.
 *
 * Verifies that the error boundary:
 *   1. Catches render-time exceptions that async try/catch cannot handle
 *   2. Shows a recovery UI ("Something went wrong" + "Try again") instead
 *      of a blank screen
 *   3. Resets correctly when the user clicks "Try again"
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, beforeEach, afterEach, expect } from 'vitest';
import ReconErrorBoundary from '../components/recon/ReconErrorBoundary';

// Silence React's console.error output for expected error boundary activations
let consoleErrorSpy;
beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleErrorSpy.mockRestore();
});

// A component that unconditionally throws during render
const AlwaysThrows = () => {
  throw new Error('Test render exception');
};

// A component whose throw behaviour can be toggled
let shouldThrow = true;
const ConditionalThrow = () => {
  if (shouldThrow) throw new Error('Conditional render exception');
  return <div>Recovered content</div>;
};

describe('Phase 5 — ReconErrorBoundary catches render errors', () => {
  it('shows fallback UI instead of a blank screen when a child throws', () => {
    render(
      <ReconErrorBoundary>
        <AlwaysThrows />
      </ReconErrorBoundary>
    );

    expect(
      screen.getByText('Something went wrong loading this page.')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Try again' })
    ).toBeInTheDocument();
  });

  it('does not render null — container always has content on error', () => {
    const { container } = render(
      <ReconErrorBoundary>
        <AlwaysThrows />
      </ReconErrorBoundary>
    );

    expect(container.firstChild).not.toBeNull();
  });

  it('renders children normally when no error occurs', () => {
    render(
      <ReconErrorBoundary>
        <div>Normal content</div>
      </ReconErrorBoundary>
    );

    expect(screen.getByText('Normal content')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong loading this page.')).not.toBeInTheDocument();
  });

  it('"Try again" resets the error state so children can re-render', () => {
    shouldThrow = true;

    render(
      <ReconErrorBoundary>
        <ConditionalThrow />
      </ReconErrorBoundary>
    );

    expect(
      screen.getByText('Something went wrong loading this page.')
    ).toBeInTheDocument();

    // Stop throwing, then click Try again
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('Recovered content')).toBeInTheDocument();
    expect(
      screen.queryByText('Something went wrong loading this page.')
    ).not.toBeInTheDocument();
  });

  it('logs the error to console.error for debugging', () => {
    render(
      <ReconErrorBoundary>
        <AlwaysThrows />
      </ReconErrorBoundary>
    );

    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
