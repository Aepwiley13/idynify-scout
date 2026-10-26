/**
 * The LinkedIn card on Settings → Integrations.
 *
 * Pins the two states (Connect LinkedIn / Connected with name, email and
 * date), that Connect calls linkedin-oauth-init with the Firebase token in a
 * header and goes to LinkedIn, that Disconnect calls linkedin-disconnect,
 * and that the callback's `?linkedin=<outcome>` shows a clear message once
 * and is removed from the URL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

const getDoc = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...path) => ({ path: path.join('/') }),
  getDoc: (...args) => getDoc(...args),
}));
vi.mock('../firebase/config', () => ({ db: {} }));

const { default: LinkedInIntegrationCard } = await import('../components/settings/LinkedInIntegrationCard');
const { LINKEDIN_OUTCOME_MESSAGES } = await import('../components/settings/linkedinOutcomeMessages');

const user = { uid: 'A', getIdToken: vi.fn(async () => 'id-token-A') };
const CONNECTED = {
  provider: 'linkedin', status: 'connected', linkedinMemberId: 'member-1',
  name: 'Jimmy Choi', email: 'jimmy@bridge.com', connectedAt: '2026-10-26T20:00:00.000Z',
};

const docSnap = (data) => ({ exists: () => !!data, data: () => data });

let location;
function LocationProbe() { location = useLocation(); return null; }

function renderCard(url = '/settings?tab=integrations') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <LinkedInIntegrationCard user={user} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getDoc.mockReset();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('LinkedIn card', () => {
  it('disconnected: "Connect your LinkedIn account." and a Connect LinkedIn button', async () => {
    getDoc.mockResolvedValue(docSnap(null));
    renderCard();
    expect(await screen.findByText('Connect your LinkedIn account.')).toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect LinkedIn' })).toBeInTheDocument();
    expect(getDoc.mock.calls[0][0].path).toBe('users/A/integrations/linkedin');
  });

  it('connected: name, email, connected date, Reconnect and Disconnect', async () => {
    getDoc.mockResolvedValue(docSnap(CONNECTED));
    renderCard();
    expect(await screen.findByText('Jimmy Choi')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('jimmy@bridge.com')).toBeInTheDocument();
    expect(screen.getByText(/^Connected Oct 2\d, 2026$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect LinkedIn' })).toBeInTheDocument();
  });

  it('a disconnected integration document reads as not connected', async () => {
    getDoc.mockResolvedValue(docSnap({ ...CONNECTED, status: 'disconnected' }));
    renderCard();
    expect(await screen.findByRole('button', { name: 'Connect LinkedIn' })).toBeInTheDocument();
  });

  it('Connect sends the Firebase token in a header to linkedin-oauth-init and goes to LinkedIn', async () => {
    getDoc.mockResolvedValue(docSnap(null));
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    fetch.mockResolvedValue({ ok: true, json: async () => ({ authUrl: 'https://www.linkedin.com/oauth/v2/authorization?x=1' }) });
    renderCard();

    await userEvent.click(await screen.findByRole('button', { name: 'Connect LinkedIn' }));
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/.netlify/functions/linkedin-oauth-init');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer id-token-A');
    expect(init.body).toBeUndefined();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://www.linkedin.com/oauth/v2/authorization?x=1'));
  });

  it('Connect failing to start shows the server message', async () => {
    getDoc.mockResolvedValue(docSnap(null));
    fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'LinkedIn is not set up yet. Please contact support.' }) });
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Connect LinkedIn' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('LinkedIn is not set up yet. Please contact support.');
    expect(screen.getByRole('button', { name: 'Connect LinkedIn' })).toBeEnabled();
  });

  it('Disconnect calls linkedin-disconnect and returns to Connect LinkedIn', async () => {
    getDoc.mockResolvedValue(docSnap(CONNECTED));
    fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect LinkedIn' }));
    expect(fetch.mock.calls[0][0]).toBe('/.netlify/functions/linkedin-disconnect');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer id-token-A');
    expect(await screen.findByRole('button', { name: 'Connect LinkedIn' })).toBeInTheDocument();
    expect(screen.queryByText('Jimmy Choi')).toBeNull();
  });

  it('back from LinkedIn connected: shows "LinkedIn connected." once and clears it from the URL', async () => {
    getDoc.mockResolvedValue(docSnap(CONNECTED));
    renderCard('/settings?tab=integrations&linkedin=connected');
    expect(await screen.findByRole('status')).toHaveTextContent('LinkedIn connected.');
    await waitFor(() => expect(location.search).toBe('?tab=integrations'));
  });

  it.each(Object.entries(LINKEDIN_OUTCOME_MESSAGES).filter(([k]) => k !== 'connected'))(
    'back from LinkedIn with "%s": shows a clear error',
    async (outcome, message) => {
      getDoc.mockResolvedValue(docSnap(null));
      renderCard(`/settings?tab=integrations&linkedin=${outcome}`);
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      await waitFor(() => expect(location.search).toBe('?tab=integrations'));
    },
  );

  it('an unknown outcome falls back to a generic error', async () => {
    getDoc.mockResolvedValue(docSnap(null));
    renderCard('/settings?tab=integrations&linkedin=<script>');
    expect(await screen.findByRole('alert')).toHaveTextContent(LINKEDIN_OUTCOME_MESSAGES.error);
  });
});
