/**
 * The top bar's account control, and the identity it displays.
 *
 * What this replaced: the raw email address in a pill, a bordered "Log out"
 * button, and a separate Settings gear — three controls across the top right
 * of every screen, one of them printing the user's address at all times.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../theme/ThemeContext';
import UserMenu from '../components/layout/UserMenu';
import { displayNameFor, initialsFor } from '../utils/userIdentity';
import { supportMailto } from '../constants/support';

vi.mock('../firebase/config', () => ({
  auth: { currentUser: null, onAuthStateChanged: () => () => {} },
  db: {},
}));

function renderMenu(user, onLogout = vi.fn()) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <UserMenu user={user} onLogout={onLogout} />
      </ThemeProvider>
    </MemoryRouter>
  );
}

const AARON = { email: 'aaron@idynify.com', firstName: 'Aaron', lastName: 'Wiley' };

beforeEach(() => { localStorage.clear(); });

describe('display identity', () => {
  it('prefers a real first and last name', () => {
    expect(displayNameFor(AARON)).toBe('Aaron Wiley');
    expect(initialsFor(AARON)).toBe('AW');
  });

  it('falls back through the fields that actually exist on the user doc', () => {
    expect(displayNameFor({ name: 'Aaron Wiley' })).toBe('Aaron Wiley');
    expect(displayNameFor({ displayName: 'Aaron Wiley' })).toBe('Aaron Wiley');
    expect(displayNameFor({ firstName: 'Aaron' })).toBe('Aaron');
  });

  it('derives a name from the email rather than showing the address', () => {
    // The product has never stored a name for the account holder, so this is
    // the path most users take. The point of the whole change is that the top
    // bar stops reading like a mail header.
    expect(displayNameFor({ email: 'aaron@idynify.com' })).toBe('Aaron');
    expect(displayNameFor({ email: 'aaron.wiley@idynify.com' })).toBe('Aaron Wiley');
    expect(displayNameFor({ email: 'aaron_wiley2@idynify.com' })).toBe('Aaron Wiley');
    expect(initialsFor({ email: 'aaron.wiley@idynify.com' })).toBe('AW');
  });

  it('never returns an avatar with no glyph in it', () => {
    // An empty circle reads as a broken image, which this shell already has
    // enough of with the missing logo assets.
    expect(initialsFor({ email: 'x@y.com' })).toBe('X');
    expect(initialsFor({})).toBe('?');
    expect(initialsFor(null)).toBe('?');
  });
});

describe('UserMenu', () => {
  it('shows the name and initials, and not the email address', () => {
    renderMenu(AARON);

    expect(screen.getByText('Aaron Wiley')).toBeInTheDocument();
    expect(screen.getByText('AW')).toBeInTheDocument();
    expect(screen.queryByText('aaron@idynify.com')).toBeNull();
  });

  it('puts the email inside the dropdown, where it identifies the account', async () => {
    const user = userEvent.setup();
    renderMenu(AARON);

    await user.click(screen.getByRole('button', { name: /account menu/i }));

    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('aaron@idynify.com')).toBeInTheDocument();
  });

  it('gathers Settings, Theme and Log out under one control', async () => {
    const user = userEvent.setup();
    renderMenu(AARON);

    await user.click(screen.getByRole('button', { name: /account menu/i }));
    const items = screen.getAllByRole('menuitem').map(b => b.textContent);

    expect(items).toEqual(['Settings', 'Dark mode', 'Log out']);
  });

  it('labels the theme item with what it switches TO, not what is on', async () => {
    // The More sheet used to say "Light Mode" while in light mode, which reads
    // as a status rather than an action.
    const user = userEvent.setup();
    renderMenu(AARON);

    await user.click(screen.getByRole('button', { name: /account menu/i }));
    await user.click(screen.getByRole('menuitem', { name: 'Dark mode' }));

    await user.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByRole('menuitem', { name: 'Light mode' })).toBeInTheDocument();
  });

  it('logs out through the shell, not through its own auth call', async () => {
    const onLogout = vi.fn();
    const user = userEvent.setup();
    renderMenu(AARON, onLogout);

    await user.click(screen.getByRole('button', { name: /account menu/i }));
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }));

    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('reports its open state and closes on Escape', async () => {
    const user = userEvent.setup();
    renderMenu(AARON);

    const trigger = screen.getByRole('button', { name: /account menu/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    // Focus goes back to the trigger — a menu that dumps focus on <body>
    // strands keyboard users at the top of the document.
    expect(trigger).toHaveFocus();
  });

  it('moves through items with the arrow keys', async () => {
    const user = userEvent.setup();
    renderMenu(AARON);

    await user.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Dark mode' })).toHaveFocus();

    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toHaveFocus();

    // Wraps rather than dead-ending.
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveFocus();
  });
});

describe('support link', () => {
  it('points at the support address with a subject line', () => {
    // Was a Crisp-if-loaded fork falling back to support@idynify.com, an
    // address nothing answers — so the fallback silently went nowhere.
    expect(supportMailto()).toBe('mailto:aaron@idynify.com?subject=Idynify%20Support%20Request');
  });
});
