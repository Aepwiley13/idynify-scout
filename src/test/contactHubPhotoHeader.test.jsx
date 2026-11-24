import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';

const fake = vi.hoisted(() => {
  vi.stubEnv('VITE_CONTACT_HUB_PHOTO_OVERRIDES', 'on');
  return { props: null, auth: { currentUser: null }, effective: null, read: vi.fn() };
});
vi.mock('../firebase/config', () => ({ auth: fake.auth, db: {} }));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => fake.effective }));
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...segments) => segments.join('/'),
  getDocFromServer: (...args) => fake.read(...args),
}));
vi.mock('../components/contacts/personHeader/ConnectedPersonHeader', () => ({
  default: (props) => { fake.props = props; return null; },
}));

import ContactHubPhotoHeader from '../pages/ContactHub/ContactHubPhotoHeader';

const contact = { id: 'c1', photo_url: 'https://example.test/original.jpg', photo_source: 'apollo' };

beforeEach(() => {
  fake.auth.currentUser = { uid: 'u1', getIdToken: vi.fn(async () => 'fixture-token') };
  fake.effective = fake.auth.currentUser;
  fake.read.mockReset().mockResolvedValue({ data: () => undefined });
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ status: 'saved', version: '3:0' }),
  })));
});
afterEach(() => vi.unstubAllGlobals());

describe('Contact Hub photo persistence adapter', () => {
  it('loads just the opened contact and sends its expected version without mutating the original photo', async () => {
    fake.read.mockResolvedValue({ data: () => ({ kind: 'hidden', updatedAt: { seconds: 2, nanoseconds: 0 } }) });
    const onPatch = vi.fn();
    render(<ContactHubPhotoHeader uid="u1" contact={contact} onPatch={onPatch} />);
    await waitFor(() => expect(fake.props.photoEditor.saveOverride).toBeTypeOf('function'));
    expect(fake.read.mock.calls).toEqual([['users/u1/contacts/c1/private/photo']]);
    expect(fake.props.contact).toMatchObject({ ...contact, contact_hub_photo: 'hidden' });

    await act(async () => fake.props.photoEditor.saveOverride('c1', { photoOverride: null }, { expectUid: 'u1' }));
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe('/.netlify/functions/contact-photo-write');
    expect(request.headers.Authorization).toBe('Bearer fixture-token');
    expect(JSON.parse(request.body)).toEqual({ uid: 'u1', contactId: 'c1', expectedVersion: '2:0', photo: null });
    expect(onPatch.mock.calls).toEqual([['c1', { contact_hub_photo: null }]]);
  });

  it('fails closed for read-only views and for an unavailable override read', async () => {
    const view = render(<ContactHubPhotoHeader uid="u1" readOnly contact={contact} onPatch={vi.fn()} />);
    expect(fake.read).not.toHaveBeenCalled();
    expect(fake.props.photoEditor.saveOverride).toBeUndefined();
    fake.read.mockRejectedValue(new Error('Unavailable'));
    view.rerender(<ContactHubPhotoHeader key="owner" uid="u1" contact={contact} onPatch={vi.fn()} />);
    await waitFor(() => expect(fake.read).toHaveBeenCalledTimes(1));
    expect(fake.props.photoEditor.saveOverride).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('discards the pending send after the account changes during token acquisition', async () => {
    let grantToken;
    fake.auth.currentUser.getIdToken.mockImplementation(() => new Promise((resolve) => { grantToken = resolve; }));
    const onPatch = vi.fn();
    render(<ContactHubPhotoHeader uid="u1" contact={contact} onPatch={onPatch} />);
    await waitFor(() => expect(fake.props.photoEditor.saveOverride).toBeTypeOf('function'));
    const attempted = fake.props.photoEditor.saveOverride('c1', { photoOverride: { kind: 'hidden' } }, { expectUid: 'u1' });
    fake.auth.currentUser = { uid: 'u2' };
    fake.effective = fake.auth.currentUser;
    grantToken('old-token');
    await expect(attempted).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fetch).not.toHaveBeenCalled();
    expect(onPatch).not.toHaveBeenCalled();
  });
});
