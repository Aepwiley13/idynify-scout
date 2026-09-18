/**
 * RootErrorBoundary — the last resort, and deliberately the least useful one.
 *
 * Every other boundary in this app exists to keep the application usable after
 * a failure: ModuleErrorBoundary keeps the shell alive when a page throws,
 * ShellRegionBoundary keeps the shell alive when an overlay throws. Both can
 * offer "go somewhere else" because somewhere else still exists.
 *
 * This one cannot. It wraps the providers, the router and the auth screens, so
 * by the time it catches anything there is no navigation left to offer — only a
 * reload. That makes a full-page fallback the honest response HERE, and the
 * wrong response anywhere else. It is the reason the scoped boundaries exist:
 * they keep failures away from this one.
 *
 * It is not a substitute for them. Anything this catches is a bug that should
 * be caught closer to where it happened.
 */

import React from 'react';

export default class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(
      '[RootErrorBoundary] The application crashed above the shell.',
      error,
      info?.componentStack
    );
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="root-error" role="alert">
        <div className="root-error-card">
          <h1 className="root-error-title">Idynify could not start</h1>
          <p className="root-error-body">
            Something failed before the application finished loading. Reloading
            usually clears it. If it keeps happening, send us the detail below.
          </p>
          <button
            type="button"
            className="root-error-reload"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          {/* Visible, not hidden in a console nobody can reach on a phone. */}
          <p className="root-error-detail">{String(error?.message || error)}</p>
        </div>
      </div>
    );
  }
}
