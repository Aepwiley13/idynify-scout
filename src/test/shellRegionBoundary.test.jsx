/**
 * An overlay crash must not blank the shell around it.
 *
 * ModuleErrorBoundary wraps `<Outlet/>` and nothing else, so every sibling of
 * `<main>` — the sidebar, the top bar, the bottom nav, the sheets, the command
 * bar and the Barry host — was outside every boundary in the app. A render
 * error in any of them unmounted the whole React tree.
 *
 * The real instance: PipelineMoveRow read `T.textMuted` with no `T` in scope
 * and threw ReferenceError on every render, inside the Barry overlay, with
 * nothing above it to catch. The headline test below reproduces that shape —
 * a throwing component in the Barry host, inside a shell that also renders
 * navigation and page content — and asserts the rest of the shell is still on
 * screen afterwards.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShellRegionBoundary from '../components/layout/ShellRegionBoundary';
import RootErrorBoundary from '../components/RootErrorBoundary';

function Boom({ message = 'T is not defined' }) {
  throw new ReferenceError(message);
}

let spy;
beforeEach(() => { spy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => spy.mockRestore());

/**
 * A stand-in for ShellChrome with the same shape that matters here: page
 * content and navigation as siblings of the Barry host, each region boundaried
 * the way MainLayout now boundaries them.
 */
function Shell({ barryChildren }) {
  return (
    <div className="main-layout">
      <ShellRegionBoundary label="The sidebar">
        <nav aria-label="Sidebar">Sidebar nav</nav>
      </ShellRegionBoundary>

      <main>
        <h1>Mission Control</h1>
      </main>

      <ShellRegionBoundary label="The bottom bar">
        <nav aria-label="Bottom">Bottom nav</nav>
      </ShellRegionBoundary>

      <div className="barry-panel-host">
        <button type="button">Close Barry</button>
        <ShellRegionBoundary label="Barry" resetKey={true}>
          {barryChildren}
        </ShellRegionBoundary>
      </div>
    </div>
  );
}

describe('a throwing Barry overlay', () => {
  it('leaves the rest of the shell rendered', () => {
    render(<Shell barryChildren={<Boom />} />);

    // The whole point: everything outside the crashed region survives.
    expect(screen.getByText('Mission Control')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Bottom' })).toBeInTheDocument();
    // And the user can still dismiss the overlay that broke.
    expect(screen.getByRole('button', { name: 'Close Barry' })).toBeInTheDocument();
  });

  it('names the region that failed instead of failing silently', () => {
    render(<Shell barryChildren={<Boom />} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Barry hit an error/i)).toBeInTheDocument();
  });

  it('logs the error rather than swallowing it', () => {
    render(<Shell barryChildren={<Boom />} />);
    expect(spy).toHaveBeenCalled();
  });

  it('keeps the fallback small — no full-page takeover', () => {
    render(<Shell barryChildren={<Boom />} />);
    // A root-style fallback here would mean the contained failure had been
    // escalated into a total one.
    expect(screen.queryByText(/Idynify could not start/i)).not.toBeInTheDocument();
  });
});

describe('ShellRegionBoundary', () => {
  it('renders children untouched when nothing throws', () => {
    render(
      <ShellRegionBoundary label="Barry">
        <p>Barry is fine</p>
      </ShellRegionBoundary>
    );
    expect(screen.getByText('Barry is fine')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('recovers when the user retries and the cause is gone', async () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('transient');
      return <p>recovered</p>;
    }

    render(
      <ShellRegionBoundary label="Barry">
        <Flaky />
      </ShellRegionBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    shouldThrow = false;
    await userEvent.click(screen.getByRole('button', { name: /Try again/i }));

    expect(screen.getByText('recovered')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears a caught error when resetKey changes', () => {
    const { rerender } = render(
      <ShellRegionBoundary label="Barry" resetKey="closed"><Boom /></ShellRegionBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Reopening the overlay is a genuine retry, not a permanently poisoned
    // boundary for the rest of the session.
    rerender(
      <ShellRegionBoundary label="Barry" resetKey="open"><p>Barry again</p></ShellRegionBoundary>
    );
    expect(screen.getByText('Barry again')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('RootErrorBoundary', () => {
  it('catches what the scoped boundaries cannot', () => {
    render(<RootErrorBoundary><Boom message="provider exploded" /></RootErrorBoundary>);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Idynify could not start/i)).toBeInTheDocument();
    // Reload is the only honest option here — there is no surviving shell to
    // navigate with. That is exactly why it must not be the fallback anywhere
    // a scoped boundary could have handled it instead.
    expect(screen.getByRole('button', { name: /Reload/i })).toBeInTheDocument();
    expect(screen.getByText('provider exploded')).toBeInTheDocument();
  });

  it('renders children untouched when nothing throws', () => {
    render(<RootErrorBoundary><p>app booted</p></RootErrorBoundary>);
    expect(screen.getByText('app booted')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
