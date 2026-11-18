/* global process */
/**
 * Billing Phase 1d: the shell does not offer Barry to an account the server would refuse.
 *
 * The server is the gate (paidAiAccess.test.js). This covers the screens: a Free account sees no
 * Barry control in the sidebar or the More sheet, and Barry's panel, which asks the server for an
 * opening brief as soon as it mounts, is not mounted. Paid accounts and admins keep Barry.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../theme/ThemeContext';
import { ShellProvider } from '../context/ShellContext';
import Sidebar from '../components/layout/Sidebar';
import MoreSheet from '../components/layout/MoreSheet';
import { barryAvailableFor } from '../utils/barryAccess';

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { email: 'someone@example.test' }, onAuthStateChanged: () => () => {} },
  db: {},
}));

describe('barryAvailableFor', () => {
  it('paid accounts and admins: yes', () => {
    expect(barryAvailableFor({ hasCompletedPayment: true, subscriptionTier: 'starter' })).toBe(true);
    expect(barryAvailableFor({ role: 'admin' })).toBe(true);
    expect(barryAvailableFor({ role: 'super_admin' })).toBe(true);
  });

  it('Free and lapsed accounts: no', () => {
    expect(barryAvailableFor({ email: 'free@example.test', createdAt: 1 })).toBe(false);
    expect(barryAvailableFor({ hasCompletedPayment: false, subscriptionStatus: 'canceled' })).toBe(false);
    expect(barryAvailableFor({ hasCompletedPayment: 'true' })).toBe(false);
    expect(barryAvailableFor({ role: 'member' })).toBe(false);
  });

  it('no account data yet: unchanged (the server still decides)', () => {
    expect(barryAvailableFor(undefined)).toBe(true);
    expect(barryAvailableFor(null)).toBe(true);
  });
});

const inShell = (ui) => render(
  <MemoryRouter initialEntries={['/contact-hub']}>
    <ThemeProvider>
      <ShellProvider user={{ id: 'u-1' }} userData={{}}>{ui}</ShellProvider>
    </ThemeProvider>
  </MemoryRouter>,
);

describe('the shell controls', () => {
  it('the sidebar shows Barry by default and hides him when Barry is not available', () => {
    const { unmount } = inShell(<Sidebar />);
    expect(screen.getByRole('button', { name: /open barry/i })).toBeInTheDocument();
    unmount();
    inShell(<Sidebar barryAvailable={false} />);
    expect(screen.queryByRole('button', { name: /open barry/i })).toBeNull();
  });

  it('the More sheet shows the Barry tile by default and hides it when Barry is not available', () => {
    const { unmount } = inShell(<MoreSheet isOpen onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /barry/i })).toBeInTheDocument();
    unmount();
    inShell(<MoreSheet isOpen onClose={() => {}} barryAvailable={false} />);
    expect(screen.queryByRole('button', { name: /barry/i })).toBeNull();
  });
});

describe('MainLayout wiring', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/components/layout/MainLayout.jsx'), 'utf8');

  it('decides once, from the account data it is given', () => {
    expect(src).toMatch(/<ShellChrome user=\{user\} barryAvailable=\{barryAvailableFor\(userData\)\}>/);
  });

  it('passes the decision to the sidebar and the More sheet, and mounts Barry\'s panel only when available', () => {
    expect(src).toMatch(/<Sidebar[\s\S]{0,400}barryAvailable=\{barryAvailable\}/);
    expect(src).toMatch(/<MoreSheet[\s\S]{0,300}barryAvailable=\{barryAvailable\}/);
    expect(src).toMatch(/\{barryAvailable && \(\(\) => \{[\s\S]{0,2500}<BarryChatPanel/);
  });
});
