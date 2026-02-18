import { Component } from 'react';

/**
 * Error boundary for RECON pages.
 * Catches render-time exceptions (the one case that try/catch in async
 * code cannot handle) and renders a recovery UI instead of a blank screen.
 */
export default class ReconErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('RECON render error:', error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="recon-module-loading">
          <p className="loading-text" style={{ color: 'var(--color-red-600, #dc2626)' }}>
            Something went wrong loading this page.
          </p>
          <button
            onClick={this.handleReset}
            style={{ marginTop: '1rem', padding: '0.5rem 1rem', cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
