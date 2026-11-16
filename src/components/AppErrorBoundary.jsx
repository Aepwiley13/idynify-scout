/**
 * AppErrorBoundary: the last resort, around the whole application.
 *
 * WHY THIS EXISTS. ModuleErrorBoundary sits inside the shell and only wraps
 * module content. Anything thrown by the shell itself (the top bar, the
 * sidebar, the sign-in gate, the theme provider) had no boundary above it, so
 * React unmounted everything and left the bare page background. On a dark
 * theme that is a black screen with no message and no way out. The case that
 * showed it: the Firestore client failed internally, and the notification
 * bell's next call to it threw from the top bar.
 *
 * RULES THIS FOLLOWS.
 *   - It never reloads on its own. A page that fails again after a reload
 *     shows this message again; an automatic reload would loop.
 *   - It shows no raw error text, path or stack. Those go to the console,
 *     in full, for whoever is diagnosing it.
 *   - It does not depend on the theme provider, the router or any app CSS,
 *     because any of those may be what failed. Colours come from the shell's
 *     theme variables when they are set, with built-in light and dark
 *     fallbacks when they are not.
 *
 * WHAT IT DOES NOT CATCH. React boundaries only see errors thrown while
 * rendering or in effects. Errors in event handlers, timers and promise
 * callbacks never reach it, so those are handled where they happen.
 */

import React from 'react';
import { supportMailto } from '../constants/support';

const CSS = `
.app-error {
  --app-error-bg: var(--bg-primary, #f8f7fc);
  --app-error-card: var(--bg-card, #ffffff);
  --app-error-border: var(--border, #e0d8f0);
  --app-error-text: var(--text-primary, #12082a);
  --app-error-muted: var(--text-secondary, #5a4880);
  position: fixed; inset: 0; z-index: 2147483000;
  display: flex; align-items: center; justify-content: center;
  padding: calc(16px + env(safe-area-inset-top, 0px)) 16px calc(16px + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box; overflow-y: auto;
  background: var(--app-error-bg); color: var(--app-error-text);
  font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif;
}
@media (prefers-color-scheme: dark) {
  html:not([data-theme]) .app-error {
    --app-error-bg: #06040f; --app-error-card: #110e1e; --app-error-border: #2a2440;
    --app-error-text: #f4f1fb; --app-error-muted: #b9aed6;
  }
}
.app-error-card {
  width: 100%; max-width: 440px; box-sizing: border-box; padding: 28px 24px;
  background: var(--app-error-card); border: 1px solid var(--app-error-border);
  border-radius: 18px; text-align: center;
}
.app-error-title { margin: 0 0 10px; font-size: 22px; font-weight: 800; line-height: 1.25; }
.app-error-body { margin: 0 0 22px; font-size: 16px; line-height: 1.5; color: var(--app-error-muted); }
.app-error-reload {
  min-height: 48px; width: 100%; padding: 0 22px; border: none; border-radius: 12px; cursor: pointer;
  background: var(--app-error-text); color: var(--app-error-card);
  font: inherit; font-size: 17px; font-weight: 700;
}
.app-error-reload:focus-visible, .app-error-help:focus-visible { outline: 3px solid var(--app-error-muted); outline-offset: 3px; }
.app-error-help {
  display: inline-flex; align-items: center; justify-content: center; min-height: 44px; margin-top: 10px; padding: 0 12px;
  font-size: 15px; font-weight: 600; color: var(--app-error-text);
}
`;

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    // Logged in full and never shown: the screen stays free of error text.
    console.error('[AppErrorBoundary] The application crashed while rendering.', error, info?.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    // Only ever on a press: no automatic reload, so no reload loop.
    const reload = this.props.onReload ?? (() => window.location.reload());

    return (
      <div className="app-error" role="alert">
        <style>{CSS}</style>
        <div className="app-error-card">
          <h1 className="app-error-title">Something went wrong</h1>
          <p className="app-error-body">
            Idynify hit a problem and could not show this page. Your data is safe.
            Reloading usually fixes it.
          </p>
          <button type="button" className="app-error-reload" onClick={reload}>
            Reload
          </button>
          <a className="app-error-help" href={supportMailto()}>
            Still not working? Contact support
          </a>
        </div>
      </div>
    );
  }
}
