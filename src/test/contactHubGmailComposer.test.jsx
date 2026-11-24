import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { user } = vi.hoisted(() => ({ user: { uid: 'owner', getIdToken: vi.fn(async () => 'token') } }));
vi.mock('../firebase/config', () => ({ auth: { currentUser: user } }));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => user }));
vi.mock('../pages/ContactHub/ContactHubPhotoHeader', () => ({
  default: ({ onEmail }) => onEmail ? <button onClick={onEmail}>Email</button> : <a href="mailto:alex@example.com">Email</a>,
}));

let Header;
let fetchMail;
const result = (value, status = 200) => ({ status, ok: status < 400, json: async () => value });
const linked = { recipient: 'alex@example.com', connected: true, sender: 'me@example.com' };

function mount({ url = '/contact-hub/person/alex', readOnly = false } = {}) {
  return render(<MemoryRouter initialEntries={[url]}><Header uid="owner" contact={{ id: 'alex' }} readOnly={readOnly} /></MemoryRouter>);
}

beforeEach(async () => {
  vi.stubEnv('VITE_CONTACT_HUB_GMAIL', 'on');
  Header = (await import('../pages/ContactHub/ContactHubGmailHeader')).default;
  fetchMail = vi.fn(async () => result(linked));
  vi.stubGlobal('fetch', fetchMail);
  sessionStorage.clear();
  vi.stubGlobal('HTMLDialogElement', window.HTMLDialogElement);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true, value() { this.setAttribute('open', ''); },
  });
});

afterEach(() => {
  cleanup();
  delete HTMLDialogElement.prototype.showModal;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Contact Hub Gmail composer', () => {
  it('offers Gmail connection for disconnected contacts and finalizes OAuth before returning to composition', async () => {
    fetchMail.mockResolvedValueOnce(result({ ...linked, connected: false }));
    const view = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Email' }));
    expect(await screen.findByRole('button', { name: 'Connect Gmail' })).toBeDefined();
    view.unmount();
    fetchMail.mockClear();
    fetchMail.mockResolvedValueOnce(result({ status: 'connected' }));
    mount({ url: '/contact-hub/person/alex?compose=email&gmail_connection=complete' });
    expect(await screen.findByText('From me@example.com')).toBeDefined();
    expect(fetchMail.mock.calls.map(([, options]) => JSON.parse(options.body).action)).toEqual(['finish_connect', 'status']);
  });

  it('submits the displayed sender and recipient only once and reports confirmed delivery', async () => {
    let complete;
    fetchMail.mockResolvedValueOnce(result(linked)).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Email' }));
    fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 'Hello' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Great to meet you' } });
    const send = screen.getByRole('button', { name: 'Send email' });
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(fetchMail).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMail.mock.calls[1][1].body)).toMatchObject({
      action: 'send', recipient: 'alex@example.com', sender: 'me@example.com', contactId: 'alex', subject: 'Hello',
    });
    await act(async () => complete(result({ status: 'sent' })));
    expect(await screen.findByText('Email sent.')).toBeDefined();
  });

  it('cannot open the Gmail composer from a read-only session, even with a return URL', () => {
    mount({ url: '/contact-hub/person/alex?compose=email', readOnly: true });
    expect(screen.getByRole('link', { name: 'Email' })).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMail).not.toHaveBeenCalled();
  });
});
