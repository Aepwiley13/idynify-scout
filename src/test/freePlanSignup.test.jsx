/**
 * Signup with the Free plan switched on.
 *
 * No tier in the link: a Free account — no card, and no billing fields at all, so nothing the
 * server trusts is ever written by the browser — then straight to Contact Hub. A tier in the link
 * still creates that paid tier's account and goes to its checkout, exactly as before.
 * (signupAuth.test.jsx covers the switch-off behaviour, which is unchanged.)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const createUser = vi.fn();
const setDocMock = vi.fn();

vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: (...a) => createUser(...a),
  validatePassword: async () => ({ isValid: true, passwordPolicy: { customStrengthOptions: {} } }),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...path) => ({ __doc: path.join('/') }),
  setDoc: (...a) => setDocMock(...a),
}));
vi.mock('../services/analytics', () => ({ logEvent: vi.fn(), EVENTS: {} }));

// The real module with the switch on.
vi.mock('../constants/freePlan', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    FREE_PLAN: Object.freeze({ mode: 'on', enabled: true, signups: true }),
    signupPlanFor: (tier) => real.signupPlanFor(tier, { enabled: true }),
  };
});

const { default: Signup } = await import('../pages/Signup');

async function renderSignup(search = '') {
  render(
    <MemoryRouter initialEntries={[`/signup${search}`]}>
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="/checkout" element={<div>CHECKOUT</div>} />
        <Route path="/contact-hub" element={<div>MY PEOPLE</div>} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {});
}

async function fill() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), 'new@example.com');
  await user.type(screen.getByLabelText('Password'), 'Abcdefg1');
  await user.click(screen.getByRole('button', { name: /create account/i }));
}

beforeEach(() => {
  createUser.mockReset().mockResolvedValue({ user: { uid: 'uid-1', getIdToken: async () => 'good-token' } });
  setDocMock.mockReset().mockResolvedValue(undefined);
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true }));
});

describe('signup with the Free plan on', () => {
  it('no tier: a Free account with no billing fields, then Contact Hub', async () => {
    await renderSignup();
    await fill();
    await waitFor(() => expect(setDocMock).toHaveBeenCalledTimes(1));
    const [ref, payload] = setDocMock.mock.calls[0];
    expect(ref.__doc).toBe('users/uid-1');
    expect(Object.keys(payload).sort()).toEqual(['createdAt', 'email']);
    expect(await screen.findByText('MY PEOPLE')).toBeInTheDocument();
    // Email and plan are chosen on the server, not trusted from the client.
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const welcome = globalThis.fetch.mock.calls.find(([url]) => String(url).includes('send-welcome-email'));
    expect(welcome[1].headers.Authorization).toBe('Bearer good-token');
    expect(JSON.parse(welcome[1].body)).toEqual({});
  });

  it('?tier=pro: a Pro account, then its checkout, as before', async () => {
    await renderSignup('?tier=pro');
    await fill();
    await waitFor(() => expect(setDocMock).toHaveBeenCalledTimes(1));
    const payload = setDocMock.mock.calls[0][1];
    expect(payload.selectedTier).toBe('pro');
    expect(payload.hasCompletedPayment).toBe(false);
    expect(await screen.findByText('CHECKOUT')).toBeInTheDocument();
  });

  it('?tier=starter: a Starter account, then its checkout', async () => {
    await renderSignup('?tier=starter');
    await fill();
    await waitFor(() => expect(setDocMock).toHaveBeenCalledTimes(1));
    expect(setDocMock.mock.calls[0][1].selectedTier).toBe('starter');
    expect(await screen.findByText('CHECKOUT')).toBeInTheDocument();
  });

  it('creates the account once even when the button is double-pressed', async () => {
    await renderSignup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Password'), 'Abcdefg1');
    const button = screen.getByRole('button', { name: /create account/i });
    await user.dblClick(button);
    await waitFor(() => expect(setDocMock).toHaveBeenCalled());
    expect(createUser).toHaveBeenCalledTimes(1);
  });
});
