/**
 * ModuleErrorBoundary — a module crash must not blank the application.
 *
 * WHY THIS EXISTS. The shell had no error boundary around module content, so
 * anything a module threw during render unmounted the entire React tree. On a
 * dark theme that is a **black screen** — no message, no navigation, no way out
 * except a reload, and nothing on screen to tell the user (or us) what
 * happened. That is what "the CSM tab renders a black screen" looks like from
 * the inside, and it is the same failure mode for every module.
 *
 * The important part is not the message. It is that **the shell survives**:
 * this boundary sits INSIDE the shell, wrapping only `<Outlet/>`, so the
 * hamburger, the bottom bar, the top bar and Barry all keep working. A user who
 * hits a broken section can move to a working one instead of being stranded.
 *
 * It resets on navigation — keyed by pathname — so leaving a broken section and
 * coming back is a genuine retry rather than a permanently poisoned boundary.
 *
 * This is a safety net, not a substitute for the fix. The error is logged in
 * full so the real cause is still findable.
 */

import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

class ModuleErrorBoundaryInner extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Logged, not swallowed. A boundary that hides the stack trades a black
    // screen for an unfindable bug.
    console.error(
      `[ModuleErrorBoundary] ${this.props.moduleLabel || 'Module'} crashed while rendering.`,
      error,
      info?.componentStack
    );
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="module-error" role="alert">
        <div className="module-error-icon" aria-hidden="true">
          <AlertTriangle size={26} />
        </div>

        <h2 className="module-error-title">
          {this.props.moduleLabel || 'This section'} could not load
        </h2>

        <p className="module-error-body">
          Something in this section failed to render. The rest of Idynify is
          still working — use the menu or the bar below to go somewhere else.
        </p>

        <button
          type="button"
          className="module-error-retry"
          onClick={() => this.setState({ error: null })}
        >
          <RotateCcw size={15} aria-hidden="true" />
          Try again
        </button>

        {/* The message, not the stack: enough for a user to quote back to
            support without turning the screen into a debugger. */}
        <p className="module-error-detail">{String(error?.message || error)}</p>
      </div>
    );
  }
}

/**
 * Keyed by pathname so navigating away and back clears a caught error. Without
 * the key the boundary stays in its error state for the rest of the session,
 * and every subsequent section would look broken too.
 */
export default function ModuleErrorBoundary({ resetKey, moduleLabel, children }) {
  return (
    <ModuleErrorBoundaryInner key={resetKey} moduleLabel={moduleLabel}>
      {children}
    </ModuleErrorBoundaryInner>
  );
}
