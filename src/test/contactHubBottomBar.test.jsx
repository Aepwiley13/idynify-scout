/**
 * Contact Hub's mobile bottom bar: My People · Sticker Wall.
 *
 * The shell's own BottomNav, driven by Contact Hub's entry in the mobile
 * navigation table, so Contact Hub has no bar of its own making. The real
 * BottomNav is rendered here, with the switch on, to show which cell is lit
 * at each Contact Hub address, that there is no More and no Import yet, that
 * it never falls back to the global list of modules (Scout, Hunter, …), and
 * that every other module's bar is untouched.
 *
 * The switch is read at module load, so each case loads fresh modules.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

async function renderBarAt(url, switchValue = 'on') {
  vi.resetModules();
  vi.stubEnv('VITE_CONTACT_HUB', switchValue);
  const { render, screen, cleanup, fireEvent } = await import('@testing-library/react');
  const { MemoryRouter, useLocation } = await import('react-router-dom');
  const { default: BottomNav } = await import('../components/layout/BottomNav');
  // Where the app is, so a tap on a cell can be followed.
  function At() { const l = useLocation(); return <span data-testid="at">{l.pathname + l.search}</span>; }
  render(<MemoryRouter initialEntries={[url]}><At /><BottomNav onOpenMore={() => {}} /></MemoryRouter>);
  return { screen, cleanup, fireEvent };
}

let cleanupLast = null;
afterEach(() => { cleanupLast?.(); cleanupLast = null; vi.unstubAllEnvs(); vi.resetModules(); });

const labels = (screen) => screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));

describe('switch ON', () => {
  const current = (screen) => screen.getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'page').map((b) => b.getAttribute('aria-label'));

  it.each([
    ['/contact-hub', 'My People'],
    // A filtered list and a person are both inside My People.
    ['/contact-hub?sticker=abc', 'My People'],
    ['/contact-hub/person/c1', 'My People'],
    ['/contact-hub/stickers', 'Sticker Wall'],
    ['/contact-hub/stickers/', 'Sticker Wall'],
  ])('%s: the bar is My People and Sticker Wall, with %s lit and nothing else', async (url, lit) => {
    const { screen, cleanup } = await renderBarAt(url);
    cleanupLast = cleanup;
    expect(screen.getByRole('navigation', { name: 'Contact Hub sections' })).toBeInTheDocument();
    expect(labels(screen)).toEqual(['My People', 'Sticker Wall']);
    expect(current(screen)).toEqual([lit]);
  });

  it('has no More and no Import: Import is added when its screen exists', async () => {
    const { screen, cleanup } = await renderBarAt('/contact-hub');
    cleanupLast = cleanup;
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    expect(screen.queryByText(/import/i)).toBeNull();
  });

  it('a cell goes to its own address: Sticker Wall, then My People', async () => {
    const { screen, cleanup, fireEvent } = await renderBarAt('/contact-hub/person/c1');
    cleanupLast = cleanup;
    fireEvent.click(screen.getByRole('button', { name: 'Sticker Wall' }));
    expect(screen.getByTestId('at')).toHaveTextContent('/contact-hub/stickers');
    expect(current(screen)).toEqual(['Sticker Wall']);
    fireEvent.click(screen.getByRole('button', { name: 'My People' }));
    expect(screen.getByTestId('at').textContent).toBe('/contact-hub');
    expect(current(screen)).toEqual(['My People']);
  });

  it('never offers Scout or Hunter under a Contact Hub screen', async () => {
    const { screen, cleanup } = await renderBarAt('/contact-hub');
    cleanupLast = cleanup;
    expect(screen.queryByText(/scout|hunter|sniper|basecamp/i)).toBeNull();
  });

  it('other modules keep their own bar', async () => {
    const { screen, cleanup } = await renderBarAt('/command-center?tab=people');
    cleanupLast = cleanup;
    expect(screen.getByRole('navigation', { name: 'Command Center sections' })).toBeInTheDocument();
    expect(labels(screen)).toEqual(['People', 'Missions', 'Campaigns', 'Arsenal', 'More']);
  });

  it('Mission Control keeps the global bar', async () => {
    const { screen, cleanup } = await renderBarAt('/mission-control-v2');
    cleanupLast = cleanup;
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(labels(screen)).toEqual(['Scout', 'Hunter', 'Sniper', 'Basecamp', 'More']);
  });
});

describe('switch OFF (the default): the bar is exactly as it was', () => {
  it('other modules are unchanged', async () => {
    const { screen, cleanup } = await renderBarAt('/command-center?tab=people', '');
    cleanupLast = cleanup;
    expect(labels(screen)).toEqual(['People', 'Missions', 'Campaigns', 'Arsenal', 'More']);
  });

  it('/contact-hub is not a module, so it gets what any unknown path gets', async () => {
    const { screen, cleanup } = await renderBarAt('/contact-hub', '');
    cleanupLast = cleanup;
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
  });
});
