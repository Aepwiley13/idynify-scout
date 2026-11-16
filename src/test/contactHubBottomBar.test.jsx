/**
 * Contact Hub has no mobile bottom bar in Phase 1A.
 *
 * It has one view, so a bar would be navigation with nowhere to go, and the
 * fallback (the global list of modules) would put Scout and Hunter under a
 * Contact Hub screen. The real BottomNav is rendered here, with the switch on,
 * to show it draws nothing on both Contact Hub paths and is untouched
 * everywhere else.
 *
 * The switch is read at module load, so each case loads fresh modules.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

async function renderBarAt(url, switchValue = 'on') {
  vi.resetModules();
  vi.stubEnv('VITE_CONTACT_HUB', switchValue);
  const { render, screen, cleanup } = await import('@testing-library/react');
  const { MemoryRouter } = await import('react-router-dom');
  const { default: BottomNav } = await import('../components/layout/BottomNav');
  render(<MemoryRouter initialEntries={[url]}><BottomNav onOpenMore={() => {}} /></MemoryRouter>);
  return { screen, cleanup };
}

let cleanupLast = null;
afterEach(() => { cleanupLast?.(); cleanupLast = null; vi.unstubAllEnvs(); vi.resetModules(); });

const labels = (screen) => screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));

describe('switch ON', () => {
  it.each([['/contact-hub'], ['/contact-hub/person/c1']])('%s draws no bottom bar at all', async (url) => {
    const { screen, cleanup } = await renderBarAt(url);
    cleanupLast = cleanup;
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
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
