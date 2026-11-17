/**
 * The Contact Hub switch OFF (the default): the sidebar has no Contact Hub
 * item and draws no place for its entries, at any address. The list of
 * modules is exactly the navigation model's.
 *
 * Switch on: contactHubSidebarNav.test.jsx.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setViewportWidth } from './helpers/matchMedia';

const shell = vi.hoisted(() => ({ mode: 'wide' }));
vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('../context/ShellContext', () => ({
  useShell: () => ({ openBarry() {}, sidebarMode: shell.mode, toggleSidebar() {}, isFirstExperience: false }),
}));

import Sidebar from '../components/layout/Sidebar';
import { CONTACT_HUB } from '../constants/contactHub';
import { sidebarDestinations } from '../constants/navigationModel';

afterEach(() => { setViewportWidth(1024); shell.mode = 'wide'; });

const renderSidebar = (url) => render(
  <MemoryRouter initialEntries={[url]}>
    <Sidebar user={{ email: 'aaron@example.test' }} onLogout={() => {}} />
  </MemoryRouter>,
);

describe('switch OFF', () => {
  it('is off in this build', () => {
    expect(CONTACT_HUB.enabled).toBe(false);
  });

  it.each([
    ['/contact-hub', 'wide', 1024],
    ['/contact-hub/stickers', 'wide', 1024],
    ['/contact-hub?sticker=abc', 'wide', 1024],
    ['/scout', 'wide', 1024],
    ['/contact-hub', 'compact', 1024],
    ['/contact-hub', 'wide', 375],
  ])('%s (%s sidebar, %ipx): no Contact Hub item, no place for its entries', (url, mode, width) => {
    shell.mode = mode;
    setViewportWidth(width);
    renderSidebar(url);
    const nav = screen.getByRole('navigation', { name: 'Global navigation' });
    expect(within(nav).queryByRole('button', { name: 'Contact Hub' })).toBeNull();
    expect(document.querySelector('.sidebar-subnav')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Contact Hub sections' })).toBeNull();
    const modules = [...nav.querySelectorAll('.sidebar-module')].map((b) => b.getAttribute('aria-label'));
    expect(modules).toEqual(expect.arrayContaining(sidebarDestinations().map((d) => d.label)));
    expect(modules).not.toContain('Contact Hub');
  });
});
