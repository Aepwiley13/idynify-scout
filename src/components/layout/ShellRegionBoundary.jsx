/**
 * ShellRegionBoundary — one broken overlay must not take the shell with it.
 *
 * WHY THIS EXISTS. ModuleErrorBoundary sits inside the shell and wraps only
 * `<Outlet/>`, so it protects the routed page and nothing else. Everything the
 * shell renders BESIDE `<main>` — the sidebar, the top bar, the bottom nav, the
 * More sheets, the session history panel, the command bar and the Barry host —
 * was outside every boundary in the app. A render error in any of them
 * unmounted the whole React tree: white page, or on a dark theme a black one.
 *
 * That was not hypothetical. PipelineMoveRow read `T.textMuted` with no `T` in
 * scope and threw ReferenceError on every render, and the only thing standing
 * between that and a blank app was the fact that few people asked Barry to
 * organize their pipeline.
 *
 * The fallback is deliberately SMALL. These are regions, not pages: a crashed
 * overlay should cost the user that overlay, not the screen. The rest of the
 * shell keeps rendering, so the user can close it, navigate away, or carry on
 * working somewhere else. A full-page "something went wrong" here would turn a
 * contained failure into a total one, which is the outcome this exists to
 * prevent.
 *
 * Errors are logged in full, never swallowed — a boundary that hides the stack
 * trades a blank screen for an unfindable bug.
 */

import React from 'react';

class ShellRegionBoundaryInner extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(
      `[ShellRegionBoundary] ${this.props.label || 'A shell region'} crashed while rendering.`,
      error,
      info?.componentStack
    );
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="shell-region-error" role="alert">
        <span className="shell-region-error-text">
          {this.props.label || 'This panel'} hit an error.
        </span>
        <button
          type="button"
          className="shell-region-error-retry"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </div>
    );
  }
}

/**
 * `resetKey` clears a caught error when it changes — pass the thing whose
 * change should count as a genuine retry (a route, or an overlay's open flag).
 * Without it the region stays broken for the rest of the session even after
 * the user closes and reopens it.
 */
export default function ShellRegionBoundary({ label, resetKey, children }) {
  return (
    <ShellRegionBoundaryInner key={resetKey} label={label}>
      {children}
    </ShellRegionBoundaryInner>
  );
}
