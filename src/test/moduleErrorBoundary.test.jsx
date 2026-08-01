/**
 * A module crash must not blank the application.
 *
 * The shell had no boundary around module content, so anything a module threw
 * during render unmounted the whole React tree. On a dark theme that is a
 * black screen: no message, no navigation, no way out but a reload — and
 * nothing on screen to say what happened. That is what a "black screen on the
 * CSM tab" looks like from the inside, and it is the same failure for every
 * module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModuleErrorBoundary from '../components/layout/ModuleErrorBoundary';

function Boom() {
  throw new Error('health score exploded');
}

let spy;
beforeEach(() => { spy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => spy.mockRestore());

describe('ModuleErrorBoundary', () => {
  it('shows a readable failure instead of nothing at all', () => {
    render(
      <ModuleErrorBoundary resetKey="/basecamp" moduleLabel="Basecamp">
        <Boom />
      </ModuleErrorBoundary>
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Basecamp could not load/i)).toBeInTheDocument();
    // The user is told the rest of the product still works — the whole point
    // of the boundary being inside the shell rather than around it.
    expect(screen.getByText(/rest of Idynify is\s+still working/i)).toBeInTheDocument();
  });

  it('surfaces the error message without dumping a stack at the user', () => {
    render(
      <ModuleErrorBoundary resetKey="/basecamp" moduleLabel="Basecamp">
        <Boom />
      </ModuleErrorBoundary>
    );
    expect(screen.getByText('health score exploded')).toBeInTheDocument();
  });

  it('logs the failure rather than swallowing it', () => {
    // A boundary that hides the stack trades a black screen for an
    // unfindable bug.
    render(
      <ModuleErrorBoundary resetKey="/basecamp" moduleLabel="Basecamp">
        <Boom />
      </ModuleErrorBoundary>
    );
    expect(spy).toHaveBeenCalled();
  });

  it('renders children untouched when nothing throws', () => {
    render(
      <ModuleErrorBoundary resetKey="/scout" moduleLabel="Scout">
        <div>module content</div>
      </ModuleErrorBoundary>
    );
    expect(screen.getByText('module content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers a retry that re-renders the module', async () => {
    const user = userEvent.setup();
    let shouldThrow = true;
    const Flaky = () => {
      if (shouldThrow) throw new Error('transient');
      return <div>recovered</div>;
    };

    render(
      <ModuleErrorBoundary resetKey="/scout" moduleLabel="Scout">
        <Flaky />
      </ModuleErrorBoundary>
    );

    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });

  it('clears when the user navigates away', () => {
    // Keyed by pathname. Without that the boundary stays in its error state
    // for the rest of the session and every later section looks broken too.
    const { rerender } = render(
      <ModuleErrorBoundary resetKey="/basecamp" moduleLabel="Basecamp">
        <Boom />
      </ModuleErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(
      <ModuleErrorBoundary resetKey="/scout" moduleLabel="Scout">
        <div>scout content</div>
      </ModuleErrorBoundary>
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('scout content')).toBeInTheDocument();
  });
});
