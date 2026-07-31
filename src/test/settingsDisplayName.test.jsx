/**
 * Settings → Account → Display name.
 *
 * Until this field existed there was nowhere in the product to set a name,
 * which is why every surface printed the raw email address. `displayName` on
 * `users/{uid}` is now the canonical field; everything else in
 * `userIdentity.js` is fallback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../theme/ThemeContext';
import { ShellProvider, useShell } from '../context/ShellContext';

const updateDoc = vi.fn().mockResolvedValue(undefined);
const userDoc = { displayName: '', bookingLink: '' };

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'u1', email: 'aaron@idynify.com' }, onAuthStateChanged: () => () => {} },
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  doc: (...args) => ({ path: args.slice(1).join('/') }),
  getDoc: async () => ({ exists: () => true, data: () => ({ ...userDoc }) }),
  getDocs: async () => ({ docs: [] }),
  collection: () => ({}),
  updateDoc: (...args) => updateDoc(...args),
  writeBatch: () => ({ update: () => {}, commit: async () => {} }),
  serverTimestamp: () => null,
}));

vi.mock('firebase/auth', () => ({ sendPasswordResetEmail: vi.fn() }));
vi.mock('../components/serviceProfiles/ServiceProfileSetup', () => ({ default: () => null }));
vi.mock('../utils/mfa', () => ({
  isMfaEnrolled: async () => false,
  getEnrolledFactors: async () => [],
  startTotpEnrollment: () => {}, completeTotpEnrollment: () => {}, unenrollFactor: () => {},
}));
vi.mock('../hooks/useUserPreference', () => ({
  useUserPreference: (_key, initial) => [initial, () => {}],
}));

const { default: UserSettings } = await import('../pages/UserSettings');

/** Reports what the chrome would render for the user right now. */
function ChromeProbe() {
  const { shellUser } = useShell();
  return <div data-testid="chrome-name">{shellUser?.displayName ?? '(unset)'}</div>;
}

function renderSettings(user = { id: 'u1', uid: 'u1', email: 'aaron@idynify.com' }) {
  window.matchMedia = (q) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });

  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <ThemeProvider>
        <ShellProvider user={user} userData={{}}>
          <ChromeProbe />
          <UserSettings />
        </ShellProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  updateDoc.mockClear();
  userDoc.displayName = '';
  localStorage.clear();
});

describe('Display name field', () => {
  it('lives in Settings → Account, the section the brief names', async () => {
    renderSettings();
    expect(await screen.findByLabelText('Display name')).toBeInTheDocument();
  });

  it('says what happens if you leave it blank, and shows the derived name', async () => {
    // Blank is a supported state, not an error: it falls back to a name
    // derived from the email, which is what every user sees today.
    renderSettings();
    const input = await screen.findByLabelText('Display name');

    expect(input).toHaveAttribute('placeholder', 'Aaron');
    expect(screen.getByText(/Leave blank to use\s+Aaron\./)).toBeInTheDocument();
  });

  it('saves to users/{uid}.displayName', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.type(await screen.findByLabelText('Display name'), 'Aaron Wiley');
    await user.click(screen.getByRole('button', { name: /save display name/i }));

    await waitFor(() => expect(updateDoc).toHaveBeenCalled());
    expect(updateDoc.mock.calls[0][1]).toEqual({ displayName: 'Aaron Wiley' });
  });

  it('reaches the top bar immediately, not on the next reload', async () => {
    // App reads users/{uid} once, when auth resolves, and never again. Without
    // the shell being told, you would type your name, press Save, see "Saved",
    // and watch the corner keep calling you something else.
    const user = userEvent.setup();
    renderSettings();

    expect(screen.getByTestId('chrome-name')).toHaveTextContent('(unset)');

    await user.type(await screen.findByLabelText('Display name'), 'Ren');
    await user.click(screen.getByRole('button', { name: /save display name/i }));

    await waitFor(() =>
      expect(screen.getByTestId('chrome-name')).toHaveTextContent('Ren'));
  });

  it('trims what it stores', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.type(await screen.findByLabelText('Display name'), '  Aaron Wiley  ');
    await user.click(screen.getByRole('button', { name: /save display name/i }));

    await waitFor(() => expect(updateDoc).toHaveBeenCalled());
    expect(updateDoc.mock.calls[0][1]).toEqual({ displayName: 'Aaron Wiley' });
  });

  it('loads the saved name back into the field', async () => {
    userDoc.displayName = 'Aaron Wiley';
    renderSettings();

    await waitFor(() =>
      expect(screen.getByLabelText('Display name')).toHaveValue('Aaron Wiley'));
  });

  it('disables Save until something actually changed', async () => {
    userDoc.displayName = 'Aaron Wiley';
    const user = userEvent.setup();
    renderSettings();

    await waitFor(() =>
      expect(screen.getByLabelText('Display name')).toHaveValue('Aaron Wiley'));

    const save = screen.getByRole('button', { name: /save display name/i });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText('Display name'), '!');
    expect(save).toBeEnabled();
  });

  it('keeps the email in the Profile section as a read-only fact', async () => {
    // The email stops being the name; it does not stop being shown. This is
    // where you check which account you are in.
    renderSettings();
    await screen.findByLabelText('Display name');

    const profile = screen.getByText('Profile').closest('section');
    expect(within(profile).getByText('Email address')).toBeInTheDocument();
    expect(within(profile).getByText('aaron@idynify.com')).toBeInTheDocument();
  });
});
