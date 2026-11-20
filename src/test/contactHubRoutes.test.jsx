/**
 * Contact Hub's routes, with a real router and the real switch.
 *
 * OFF (the default): neither route exists. /contact-hub and
 * /contact-hub/person/:id land on the application's catch-all, exactly like a
 * URL that was never part of the app. ON: My People (with or without a
 * sticker in the address), the Sticker Wall and a person render.
 *
 * The switch is read at module load, so each case stubs the variable, resets
 * the module registry and loads everything fresh — React and the router
 * included, so the route elements and the router share one instance.
 *
 * The three screens are stand-ins here; what they show is covered in
 * contactHubPage.test.jsx. The subject is only whether a URL reaches them.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../pages/ContactHub/ContactHubMain', async () => {
  const { Outlet } = await import('react-router-dom');
  return { default: () => <div data-testid="hub"><Outlet /></div> };
});
vi.mock('../pages/ContactHub/HubPeople', () => ({ default: () => <div data-testid="hub-people" /> }));
vi.mock('../pages/ContactHub/MyCardPage', () => ({ default: () => <div data-testid="my-card-page" /> }));
vi.mock('../pages/ContactHub/HubPerson', async () => {
  const { useParams } = await import('react-router-dom');
  function HubPersonStandIn() { return <div data-testid="hub-person">{useParams().contactId}</div>; }
  return { default: HubPersonStandIn };
});

async function renderAt(url, switchValue) {
  vi.resetModules();
  vi.stubEnv('VITE_CONTACT_HUB', switchValue ?? '');
  const { render, screen, cleanup } = await import('@testing-library/react');
  const { MemoryRouter, Routes, Route, Outlet } = await import('react-router-dom');
  const { contactHubRoutes } = await import('../pages/ContactHub/contactHubRoutes');
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        {/* The same shape as App.jsx: a layout group, then the catch-all. */}
        <Route element={<div data-testid="shell"><Outlet /></div>}>
          <Route path="/command-center" element={<div data-testid="command-center" />} />
          {contactHubRoutes()}
        </Route>
        <Route path="*" element={<div data-testid="catch-all" />} />
      </Routes>
    </MemoryRouter>,
  );
  return { screen, cleanup, routes: contactHubRoutes() };
}

let cleanupLast = null;
afterEach(() => { cleanupLast?.(); cleanupLast = null; vi.unstubAllEnvs(); vi.resetModules(); });

describe('switch OFF (the default): the routes do not exist', () => {
  it('contactHubRoutes() returns nothing', async () => {
    const { routes, cleanup } = await renderAt('/command-center', undefined);
    cleanupLast = cleanup;
    expect(routes).toBeNull();
  });

  it.each([
    ['/contact-hub'],
    ['/contact-hub/person/c1'],
    ['/contact-hub/stickers'],
    ['/contact-hub?sticker=abc'],
    ['/contact-hub/anything/else'],
  ])('%s reaches the catch-all, not the Contact Hub', async (url) => {
    const { screen, cleanup } = await renderAt(url, undefined);
    cleanupLast = cleanup;
    expect(screen.getByTestId('catch-all')).toBeInTheDocument();
    expect(screen.queryByTestId('hub')).toBeNull();
    expect(screen.queryByTestId('hub-people')).toBeNull();
    expect(screen.queryByTestId('hub-person')).toBeNull();
  });

  it.each([['off'], ['false'], ['0'], ['ON'], ['yes']])('a value of "%s" is still off', async (value) => {
    const { screen, cleanup } = await renderAt('/contact-hub', value);
    cleanupLast = cleanup;
    expect(screen.getByTestId('catch-all')).toBeInTheDocument();
    expect(screen.queryByTestId('hub')).toBeNull();
  });

  it('other routes are untouched', async () => {
    const { screen, cleanup } = await renderAt('/command-center', undefined);
    cleanupLast = cleanup;
    expect(screen.getByTestId('command-center')).toBeInTheDocument();
  });

  it.each([['/contact-hub/my-card'], ['/contact-hub/my-card/']])('%s reaches the catch-all: My Card does not exist either', async (url) => {
    const { screen, cleanup } = await renderAt(url, undefined);
    cleanupLast = cleanup;
    expect(screen.getByTestId('catch-all')).toBeInTheDocument();
    expect(screen.queryByTestId('my-card-page')).toBeNull();
    expect(screen.queryByTestId('hub')).toBeNull();
  });
});

describe('switch ON: the routes exist, inside the shell', () => {
  it('/contact-hub shows My People', async () => {
    const { screen, cleanup } = await renderAt('/contact-hub', 'on');
    cleanupLast = cleanup;
    expect(screen.getByTestId('shell')).toContainElement(screen.getByTestId('hub'));
    expect(screen.getByTestId('hub')).toContainElement(screen.getByTestId('hub-people'));
    expect(screen.queryByTestId('catch-all')).toBeNull();
  });

  it('/contact-hub/person/:id shows that person', async () => {
    const { screen, cleanup } = await renderAt('/contact-hub/person/c1', 'on');
    cleanupLast = cleanup;
    expect(screen.getByTestId('hub')).toContainElement(screen.getByTestId('hub-person'));
    expect(screen.getByTestId('hub-person')).toHaveTextContent('c1');
    expect(screen.queryByTestId('hub-people')).toBeNull();
  });

  it.each([
    ['/contact-hub/stickers'],
    ['/contact-hub/stickers/'],
    ['/contact-hub?sticker=abc'],
  ])('%s shows My People\'s screen (the Sticker Wall and a sticker filter are part of it)', async (url) => {
    const { screen, cleanup } = await renderAt(url, 'on');
    cleanupLast = cleanup;
    expect(screen.getByTestId('hub')).toContainElement(screen.getByTestId('hub-people'));
    expect(screen.queryByTestId('hub-person')).toBeNull();
    expect(screen.queryByTestId('catch-all')).toBeNull();
  });

  it.each([
    ['/contact-hub/anything/else'],
    ['/contact-hub/stickers/extra'],
    // Import / Export has no route until that screen exists.
    ['/contact-hub/import'],
    ['/contact-hub/export'],
  ])('%s is not a Contact Hub address and still reaches the catch-all', async (url) => {
    const { screen, cleanup } = await renderAt(url, 'on');
    cleanupLast = cleanup;
    expect(screen.getByTestId('catch-all')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-people')).toBeNull();
  });

  it('other routes are untouched', async () => {
    const { screen, cleanup } = await renderAt('/command-center', 'on');
    cleanupLast = cleanup;
    expect(screen.getByTestId('command-center')).toBeInTheDocument();
  });

  describe('My Card, at /contact-hub/my-card', () => {
    it.each([['/contact-hub/my-card'], ['/contact-hub/my-card/']])('%s shows My Card, inside the shell', async (url) => {
      const { screen, cleanup } = await renderAt(url, 'on');
      cleanupLast = cleanup;
      expect(screen.getByTestId('shell')).toContainElement(screen.getByTestId('my-card-page'));
      expect(screen.queryByTestId('catch-all')).toBeNull();
    });

    it('stands beside My People, not inside it: opening it does not mount the part that loads every contact', async () => {
      const { screen, cleanup } = await renderAt('/contact-hub/my-card', 'on');
      cleanupLast = cleanup;
      expect(screen.queryByTestId('hub')).toBeNull();
      expect(screen.queryByTestId('hub-people')).toBeNull();
      expect(screen.queryByTestId('hub-person')).toBeNull();
    });

    it('is not taken for a person or a sticker, and My People is not taken for My Card', async () => {
      const person = await renderAt('/contact-hub/person/my-card', 'on');
      expect(person.screen.getByTestId('hub-person')).toHaveTextContent('my-card');
      expect(person.screen.queryByTestId('my-card-page')).toBeNull();
      person.cleanup();
      const list = await renderAt('/contact-hub', 'on');
      cleanupLast = list.cleanup;
      expect(list.screen.getByTestId('hub-people')).toBeInTheDocument();
      expect(list.screen.queryByTestId('my-card-page')).toBeNull();
    });

    it('has no addresses beneath it', async () => {
      const { screen, cleanup } = await renderAt('/contact-hub/my-card/extra', 'on');
      cleanupLast = cleanup;
      expect(screen.getByTestId('catch-all')).toBeInTheDocument();
      expect(screen.queryByTestId('my-card-page')).toBeNull();
    });

    it('is a route like the others: one element in the route list, and the existing three are unchanged', async () => {
      const { routes, cleanup } = await renderAt('/contact-hub', 'on');
      cleanupLast = cleanup;
      const { Children } = await import('react');
      const paths = Children.toArray(routes.props.children).map((route) => route.props.path);
      expect(paths).toEqual(['/contact-hub/my-card', '/contact-hub']);
    });
  });
});
