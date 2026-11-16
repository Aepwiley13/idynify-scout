/**
 * The screen shown when the account could not be checked with the server.
 * It offers a way forward and nothing else: no access, no purchase.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountUnverified from '../components/AccountUnverified';

const setup = (props = {}) => {
  const handlers = { onRetry: vi.fn(), onReload: vi.fn(), onSignOut: vi.fn() };
  const view = render(<AccountUnverified {...handlers} {...props} />);
  return { ...handlers, ...view };
};

describe('AccountUnverified', () => {
  it('says the account could not be verified, in the approved words', () => {
    setup();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent('We couldn’t verify your account right now.');
  });

  it('offers Retry, Reload page and Sign out', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('does nothing on its own: no retry, reload or sign-out without a press', () => {
    const { onRetry, onReload, onSignOut } = setup();
    expect(onRetry).not.toHaveBeenCalled();
    expect(onReload).not.toHaveBeenCalled();
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('each button does its one thing', async () => {
    const { onRetry, onReload, onSignOut } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(onReload).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers no purchase, plan or price, and no link anywhere', () => {
    const { container } = setup();
    expect(container.textContent).not.toMatch(/\$|month|upgrade|subscribe|buy|plan|checkout|starter|pro\b/i);
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });

  it('shows no error text', () => {
    const { container } = setup();
    expect(container.querySelector('.acct-unverified-card').textContent).not.toMatch(/firestore|permission|assertion|b815|users\//i);
  });
});
