/* global process */
/**
 * A crash outside every module must not leave a blank screen.
 *
 * ModuleErrorBoundary only wraps module content. Anything the shell itself
 * threw (top bar, sidebar, sign-in gate, theme provider) unmounted the whole
 * application and left the bare background: black, on a dark theme.
 */
import { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AppErrorBoundary from '../components/AppErrorBoundary';
import { ThemeProvider } from '../theme/ThemeContext';

const SECRET = 'users/abc123/notifications permission-denied at secretFile.js:42';
function Boom() {
  throw new Error(SECRET);
}

let spy;
beforeEach(() => { spy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => spy.mockRestore());

describe('AppErrorBoundary', () => {
  it('renders the application untouched when nothing fails', () => {
    render(<AppErrorBoundary><p>the app</p></AppErrorBoundary>);
    expect(screen.getByText('the app')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a friendly message and a Reload button when rendering fails', () => {
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /contact support/i })).toHaveAttribute('href', expect.stringMatching(/^mailto:/));
  });

  it('keeps the error text, paths and stack off the screen', () => {
    const { container } = render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    const shown = container.querySelector('.app-error-card').textContent;
    expect(shown).not.toMatch(/abc123|permission-denied|secretFile|users\/|\bat \w+ \(/);
  });

  it('logs the full error for whoever is diagnosing it', () => {
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    const logged = spy.mock.calls.find((call) => String(call[0]).includes('[AppErrorBoundary]'));
    expect(logged).toBeTruthy();
    expect(logged[1]).toBeInstanceOf(Error);
    expect(logged[1].message).toBe(SECRET);
  });

  it('reloads only when Reload is pressed, never on its own', async () => {
    const onReload = vi.fn();
    render(<AppErrorBoundary onReload={onReload}><Boom /></AppErrorBoundary>);
    expect(onReload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('still renders when the failure is inside the theme provider', () => {
    render(
      <AppErrorBoundary>
        <ThemeProvider><Boom /></ThemeProvider>
      </AppErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
  });

  it('a failing effect in the shell is caught too (the case that blanked the app)', () => {
    function ThrowsInEffect() {
      useEffect(() => { throw new Error('listener setup failed'); }, []);
      return <p>top bar</p>;
    }
    render(<AppErrorBoundary><ThrowsInEffect /></AppErrorBoundary>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    const logged = spy.mock.calls.find((call) => String(call[0]).includes('[AppErrorBoundary]'));
    expect(logged[1].message).toBe('listener setup failed');
  });
});

describe('where the boundary sits', () => {
  const main = readFileSync(resolve(process.cwd(), 'src/main.jsx'), 'utf8');

  it('wraps the theme provider, so it survives the provider failing', () => {
    const boundary = main.indexOf('<AppErrorBoundary>');
    const theme = main.indexOf('<ThemeProvider>');
    expect(boundary).toBeGreaterThan(-1);
    expect(theme).toBeGreaterThan(boundary);
    expect(main.indexOf('</ThemeProvider>')).toBeLessThan(main.indexOf('</AppErrorBoundary>'));
  });

  it('has no code path that reloads without a press', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/AppErrorBoundary.jsx'), 'utf8');
    expect(source.match(/location\.reload\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/setTimeout|setInterval|componentDidUpdate/);
  });
});
