/**
 * The authentication surface, as a test.
 *
 * The point of this file is not coverage. It is that the sprint replaced the
 * PRESENTATION of authentication while the BEHAVIOUR — who gets an account,
 * what is written for them, and where they land — had to survive untouched,
 * and there was previously not one test on any auth page to notice if it did
 * not.
 *
 * Two tests earn their place above the rest:
 *
 *   · `?tier=pro` (tests 10-11). The redesign deliberately removes every trace
 *     of tier from the UI. That is exactly what makes it dangerous: if the
 *     parameter stopped flowing, nothing on screen would look wrong, and a
 *     customer who chose Pro would silently be created as Starter.
 *
 *   · The setDoc payload (test 12). `credits` is written as a number here and
 *     replaced by an object at checkout. That inconsistency is documented debt
 *     this sprint must not disturb, so the payload is asserted field by field.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ── Mocks ───────────────────────────────────────────────────────────────────

const createUser = vi.fn();
const signIn = vi.fn();
const sendReset = vi.fn();
const validatePasswordMock = vi.fn();
const setDocMock = vi.fn();
const resolveMfa = vi.fn();

vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: null } }));

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: (...a) => createUser(...a),
  signInWithEmailAndPassword: (...a) => signIn(...a),
  sendPasswordResetEmail: (...a) => sendReset(...a),
  validatePassword: (...a) => validatePasswordMock(...a),
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db, ...path) => ({ __doc: path.join('/') }),
  setDoc: (...a) => setDocMock(...a),
}));

vi.mock('../utils/mfa', () => ({ resolveMfaSignIn: (...a) => resolveMfa(...a) }));

// Analytics writes are exercised via the buffer, never through Firestore.
vi.mock('../services/analytics', () => ({
  logEvent: vi.fn(),
  EVENTS: {},
}));

import Signup from '../pages/Signup';
import Login from '../pages/Login';
import ForgotPassword from '../pages/ForgotPassword';
import { rowsFromStatus } from '../components/auth/passwordPolicy';

/** A policy fixture matching what REL-AUTH-001 configures in the console. */
const POLICY = (over = {}) => ({
  isValid: false,
  meetsMinPasswordLength: false,
  containsUppercaseLetter: false,
  containsLowercaseLetter: false,
  containsNumericCharacter: false,
  passwordPolicy: {
    // These are the SDK's names, not the REST endpoint's. The SDK renames
    // containsUppercaseCharacter -> containsUppercaseLetter (and the lowercase
    // pair) when it builds the policy object; numeric keeps its name. Getting
    // this wrong drops the case rule from the checklist and nothing else, so
    // the fixture uses what the SDK actually hands the component.
    customStrengthOptions: {
      minPasswordLength: 8,
      containsUppercaseLetter: true,
      containsLowercaseLetter: true,
      containsNumericCharacter: true,
    },
  },
  ...over,
});

async function renderSignup(search = '') {
  const utils = render(
    <MemoryRouter initialEntries={[`/signup${search}`]}>
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="/checkout" element={<div>CHECKOUT</div>} />
        <Route path="/login" element={<div>LOGIN PAGE</div>} />
      </Routes>
    </MemoryRouter>
  );
  // PasswordRequirements resolves the policy on mount. Flushing it here keeps
  // every test free of act() warnings without each one having to know why.
  await act(async () => {});
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
  setDocMock.mockResolvedValue(undefined);
  createUser.mockResolvedValue({ user: { uid: 'uid-1' } });
  validatePasswordMock.mockResolvedValue(POLICY());
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true }));
});

// ── 1. Composition ──────────────────────────────────────────────────────────

describe('signup — composition', () => {
  it('renders the wordmark, headline, both fields and the CTA', async () => {
    await renderSignup();
    expect(screen.getByAltText('IDYNIFY')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/create your\s*IDYNIFY account/i);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('does not show tier, pricing, SSO buttons, an or-divider, or a security badge', async () => {
    await renderSignup('?tier=pro');
    const body = document.body.textContent;
    expect(body).not.toMatch(/\$\d/);
    expect(body).not.toMatch(/credits/i);
    expect(body).not.toMatch(/\bpro\b/i);
    expect(body).not.toMatch(/enterprise-grade/i);
    expect(screen.queryByText(/continue with google/i)).toBeNull();
    expect(screen.queryByText(/continue with microsoft/i)).toBeNull();
    expect(screen.queryByText(/^or$/i)).toBeNull();
  });

  it('ships no Terms or Privacy line while LEGAL-001 is deferred', async () => {
    await renderSignup();
    expect(document.body.textContent).not.toMatch(/terms of service|privacy policy/i);
    // ...and no dead links standing in for them.
    const hrefs = [...document.querySelectorAll('a')].map(a => a.getAttribute('href'));
    expect(hrefs).not.toContain('/terms');
    expect(hrefs).not.toContain('/privacy');
  });
});

// ── 2-3. Accessibility of the fields ────────────────────────────────────────

describe('signup — field accessibility', () => {
  it('gives every input a real label via for/id', async () => {
    await renderSignup();
    for (const input of document.querySelectorAll('input')) {
      expect(input.id).toBeTruthy();
      expect(document.querySelector(`label[for="${input.id}"]`)).toBeTruthy();
    }
  });

  it('sets the autocomplete attributes password managers need', async () => {
    await renderSignup();
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
  });
});

// ── 4. Email validation ─────────────────────────────────────────────────────

describe('signup — email validation', () => {
  it('announces an invalid address and wires it to the field', async () => {
    const user = userEvent.setup();
    await renderSignup();
    const email = screen.getByLabelText('Email');

    await user.type(email, 'not-an-email');
    await user.tab();

    const err = await screen.findByRole('alert');
    expect(err).toHaveTextContent('Enter a valid email address.');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email.getAttribute('aria-describedby')).toBe(err.id);
  });

  it('does not shout on first blur through an empty field', async () => {
    const user = userEvent.setup();
    await renderSignup();
    await user.click(screen.getByLabelText('Email'));
    await user.tab();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears the error as soon as the address becomes valid', async () => {
    const user = userEvent.setup();
    await renderSignup();
    const email = screen.getByLabelText('Email');
    await user.type(email, 'bad');
    await user.tab();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.type(email, '@example.com');
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

// ── 5-6. Password requirements come from the live policy ────────────────────

describe('password requirements', () => {
  it('renders exactly the rules the policy enforces, not a hardcoded list', async () => {
    await renderSignup();
    expect(await screen.findByText('8+ characters')).toBeInTheDocument();
    expect(screen.getByText('Upper & lowercase letters')).toBeInTheDocument();
    expect(screen.getByText('At least one number')).toBeInTheDocument();
  });

  it('reads the case rule under the SDK field names, not the REST ones', () => {
    // Pins the exact mismatch that hid this rule during visual QA.
    const rows = rowsFromStatus({
      containsUppercaseLetter: true,
      containsLowercaseLetter: false,
      passwordPolicy: {
        customStrengthOptions: {
          containsUppercaseLetter: true,
          containsLowercaseLetter: true,
        },
      },
    });
    expect(rows.map(r => r.key)).toContain('case');
    expect(rows.find(r => r.key === 'case').met).toBe(false);
  });

  it('still understands the REST spelling if the SDK ever stops renaming', () => {
    const rows = rowsFromStatus({
      containsUppercaseLetter: true,
      containsLowercaseLetter: true,
      passwordPolicy: {
        customStrengthOptions: {
          containsUppercaseCharacter: true,
          containsLowercaseCharacter: true,
        },
      },
    });
    expect(rows.find(r => r.key === 'case')?.met).toBe(true);
  });

  it('follows the policy when the policy differs', () => {
    const rows = rowsFromStatus({
      meetsMinPasswordLength: true,
      passwordPolicy: { customStrengthOptions: { minPasswordLength: 12 } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('12+ characters');
  });

  it('marks a rule met once the password satisfies it', async () => {
    const user = userEvent.setup();
    validatePasswordMock.mockResolvedValue(POLICY({ meetsMinPasswordLength: true }));
    await renderSignup();
    await user.type(screen.getByLabelText('Password'), 'Abcdefg1');
    const row = (await screen.findByText('8+ characters')).closest('li');
    await waitFor(() => expect(row).toHaveClass('met'));
  });

  it('shows no checklist at all when the policy cannot be retrieved', async () => {
    validatePasswordMock.mockRejectedValue(new Error('offline'));
    await renderSignup();
    await waitFor(() => expect(screen.queryByText(/\d\+ characters/)).toBeNull());
    // The field still works — an unreachable policy must not block signup.
    expect(screen.getByLabelText('Password')).toBeEnabled();
  });
});

// ── 7. Reveal toggle ────────────────────────────────────────────────────────

describe('password reveal', () => {
  it('toggles type and keeps its accessible name honest', async () => {
    const user = userEvent.setup();
    await renderSignup();
    const pw = screen.getByLabelText('Password');
    expect(pw).toHaveAttribute('type', 'password');

    const toggle = screen.getByRole('button', { name: 'Show password' });
    await user.click(toggle);

    expect(pw).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument();
  });

  it('is a non-submitting button so pressing it cannot create an account', async () => {
    const user = userEvent.setup();
    await renderSignup();
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveAttribute('type', 'button');
    await user.click(toggle);
    expect(createUser).not.toHaveBeenCalled();
  });
});

// ── 7b. Sticky CTA dock ─────────────────────────────────────────────────────

describe('sticky CTA dock', () => {
  it('wraps the CTA so it can pin above an on-screen keyboard', async () => {
    await renderSignup();
    const cta = screen.getByRole('button', { name: /create account/i });
    // The dock is what carries position:sticky at <=1023px. Without the
    // wrapper the CTA has nothing to pin with, which is the state Phase 4
    // measured at 22-113px below the fold.
    expect(cta.closest('.auth-cta-dock')).not.toBeNull();
  });

  it('keeps the CTA in the form and in normal tab order', async () => {
    await renderSignup();
    const cta = screen.getByRole('button', { name: /create account/i });
    // Sticky, not fixed: still submits the form it belongs to, still reached by
    // tabbing rather than needing a separate focus stop.
    expect(cta.closest('form')).not.toBeNull();
    expect(cta).toHaveAttribute('type', 'submit');
    expect(cta.tabIndex).toBe(0);
  });
});

// ── 8. Duplicate submission ─────────────────────────────────────────────────

describe('signup — submission', () => {
  it('creates the account once even when the CTA is double-pressed', async () => {
    const user = userEvent.setup();
    let release;
    createUser.mockImplementation(() => new Promise(r => { release = () => r({ user: { uid: 'uid-1' } }); }));

    await renderSignup();
    await user.type(screen.getByLabelText('Email'), 'a@b.com');
    await user.type(screen.getByLabelText('Password'), 'Abcdefg1');

    const cta = screen.getByRole('button', { name: /create account/i });
    await user.click(cta);
    await user.click(cta);

    expect(createUser).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /creating your account/i })).toBeDisabled();

    release();
    await waitFor(() => expect(screen.getByText('CHECKOUT')).toBeInTheDocument());
  });

  it('shows a spinner and a working label while in flight', async () => {
    const user = userEvent.setup();
    createUser.mockImplementation(() => new Promise(() => {}));
    await renderSignup();
    await user.type(screen.getByLabelText('Email'), 'a@b.com');
    await user.type(screen.getByLabelText('Password'), 'Abcdefg1');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/creating your account/i)).toBeInTheDocument();
  });
});

// ── 9. Errors ───────────────────────────────────────────────────────────────

describe('signup — errors', () => {
  const submit = async (user) => {
    await user.type(screen.getByLabelText('Email'), 'taken@example.com');
    await user.type(screen.getByLabelText('Password'), 'Abcdefg1');
    await user.click(screen.getByRole('button', { name: /create account/i }));
  };

  it('offers a real sign-in link when the email is already registered', async () => {
    const user = userEvent.setup();
    createUser.mockRejectedValue({ code: 'auth/email-already-in-use' });
    await renderSignup();
    await submit(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('An account already exists with this email.');
    const link = screen.getByRole('link', { name: /sign in instead/i });
    expect(link).toHaveAttribute('href', '/login');
  });

  it('maps a network failure to something actionable', async () => {
    const user = userEvent.setup();
    createUser.mockRejectedValue({ code: 'auth/network-request-failed' });
    await renderSignup();
    await submit(user);
    expect(await screen.findByRole('alert'))
      .toHaveTextContent('Connection issue — check your internet and try again.');
  });

  it('never leaks a raw Firebase code', async () => {
    const user = userEvent.setup();
    createUser.mockRejectedValue({ code: 'auth/internal-error-xyz' });
    await renderSignup();
    await submit(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong. Please try again.');
    expect(alert.textContent).not.toMatch(/auth\//);
  });

  it('keeps what the user typed, and re-enables the CTA', async () => {
    const user = userEvent.setup();
    createUser.mockRejectedValue({ code: 'auth/weak-password' });
    await renderSignup();
    await submit(user);
    await screen.findByRole('alert');

    expect(screen.getByLabelText('Email')).toHaveValue('taken@example.com');
    expect(screen.getByLabelText('Password')).toHaveValue('Abcdefg1');
    expect(screen.getByRole('button', { name: /create account/i })).toBeEnabled();
  });
});

// ── 10-12. The tier regression guard, and the write shape ───────────────────

describe('signup — tier survives a UI that no longer mentions it', () => {
  const fill = async (user) => {
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Password'), 'Abcdefg1');
    await user.click(screen.getByRole('button', { name: /create account/i }));
  };

  it('?tier=pro creates a Pro account and reaches checkout as Pro', async () => {
    const user = userEvent.setup();
    await renderSignup('?tier=pro');
    await fill(user);

    await waitFor(() => expect(setDocMock).toHaveBeenCalled());
    const payload = setDocMock.mock.calls[0][1];
    expect(payload.selectedTier).toBe('pro');
    expect(payload.subscriptionTier).toBe('pro');
    expect(payload.credits).toBe(1250);
    expect(payload.monthlyCredits).toBe(1250);
    await waitFor(() => expect(screen.getByText('CHECKOUT')).toBeInTheDocument());
  });

  it('?tier=starter creates a Starter account', async () => {
    const user = userEvent.setup();
    await renderSignup('?tier=starter');
    await fill(user);

    await waitFor(() => expect(setDocMock).toHaveBeenCalled());
    const payload = setDocMock.mock.calls[0][1];
    expect(payload.selectedTier).toBe('starter');
    expect(payload.credits).toBe(400);
  });

  it('no tier parameter still defaults to starter', async () => {
    const user = userEvent.setup();
    await renderSignup();
    await fill(user);
    await waitFor(() => expect(setDocMock).toHaveBeenCalled());
    expect(setDocMock.mock.calls[0][1].selectedTier).toBe('starter');
  });

  it('writes exactly the fields production writes today, with credits as a number', async () => {
    const user = userEvent.setup();
    await renderSignup('?tier=starter');
    await fill(user);
    await waitFor(() => expect(setDocMock).toHaveBeenCalled());

    const [ref, payload] = setDocMock.mock.calls[0];
    expect(ref.__doc).toBe('users/uid-1');
    expect(Object.keys(payload).sort()).toEqual([
      'createdAt', 'credits', 'email', 'hasCompletedPayment',
      'monthlyCredits', 'selectedTier', 'status', 'subscriptionTier',
    ]);
    expect(payload.email).toBe('new@example.com');
    expect(payload.status).toBe('pending_payment');
    expect(payload.hasCompletedPayment).toBe(false);
    expect(payload.createdAt).toBeInstanceOf(Date);
    // Documented debt: a number at signup, an object after checkout. Not this
    // sprint's to fix — and not this sprint's to change either.
    expect(typeof payload.credits).toBe('number');
  });
});

// ── 13. Welcome email must not gate the redirect ────────────────────────────

describe('signup — welcome email', () => {
  it('reaches checkout even when the email service is failing', async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('resend down')));
    await renderSignup('?tier=starter');
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Password'), 'Abcdefg1');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(screen.getByText('CHECKOUT')).toBeInTheDocument());
  });
});

// ── 14-15. Sign in, including the untouched MFA branch ──────────────────────

describe('sign in', () => {
  const renderLogin = async () => {
    const utils = render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<div>HOME</div>} />
        <Route path="/mission-control-v2" element={<div>MISSION CONTROL</div>} />
      </Routes>
    </MemoryRouter>
    );
    await act(async () => {});
    return utils;
  };

  it('signs in and lands on the root (SmartRedirect decides destination)', async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue({});
    await renderLogin();

    await user.type(screen.getByLabelText('Email'), 'a@b.com');
    await user.type(screen.getByLabelText('Password'), 'pw');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(signIn).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument());
  });

  it('uses current-password so managers offer the saved credential', async () => {
    await renderLogin();
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('MFA still prompts and still resolves through resolveMfaSignIn', async () => {
    const user = userEvent.setup();
    const mfaErr = { code: 'auth/multi-factor-auth-required' };
    signIn.mockRejectedValue(mfaErr);
    resolveMfa.mockResolvedValue({});
    await renderLogin();

    await user.type(screen.getByLabelText('Email'), 'a@b.com');
    await user.type(screen.getByLabelText('Password'), 'pw');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    const code = await screen.findByLabelText('Verification code');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');

    await user.type(code, '123456');
    await user.click(screen.getByRole('button', { name: /verify and continue/i }));

    expect(resolveMfa).toHaveBeenCalledWith(mfaErr, '123456');
    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument());
  });

  it('keeps the verify button disabled until six digits are entered', async () => {
    const user = userEvent.setup();
    signIn.mockRejectedValue({ code: 'auth/multi-factor-auth-required' });
    await renderLogin();
    await user.type(screen.getByLabelText('Email'), 'a@b.com');
    await user.type(screen.getByLabelText('Password'), 'pw');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    const verify = await screen.findByRole('button', { name: /verify and continue/i });
    expect(verify).toBeDisabled();
    await user.type(screen.getByLabelText('Verification code'), '123456');
    expect(verify).toBeEnabled();
  });
});

// ── 16. Forgot password ─────────────────────────────────────────────────────

describe('forgot password', () => {
  const renderForgot = async () => {
    const utils = render(<MemoryRouter><ForgotPassword /></MemoryRouter>);
    await act(async () => {});
    return utils;
  };

  it('sends the reset email and confirms it', async () => {
    const user = userEvent.setup();
    sendReset.mockResolvedValue();
    await renderForgot();

    await user.type(screen.getByLabelText('Email'), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(sendReset).toHaveBeenCalledWith(expect.anything(), 'a@b.com');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/check your\s*inbox/i));
  });

  it('announces a failure without losing the address', async () => {
    const user = userEvent.setup();
    sendReset.mockRejectedValue({ code: 'auth/network-request-failed' });
    await renderForgot();

    await user.type(screen.getByLabelText('Email'), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByRole('alert'))
      .toHaveTextContent('Connection issue — check your internet and try again.');
    expect(screen.getByLabelText('Email')).toHaveValue('a@b.com');
  });
});
