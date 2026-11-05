/**
 * StickersProvider: one availability answer and one registry subscription
 * per page, however many sticker surfaces or nested providers it holds
 * (UI spec §0, "no duplicate registry subscriptions").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { createFakeStickers, sticker, config } from './helpers/stickersUi';

const fake = vi.hoisted(() => ({ current: null }));
const viewer = vi.hoisted(() => ({ value: { uid: 'u1' } }));
vi.mock('../components/stickers/stickersApi.js', () => ({ fetchStickersConfig: (...a) => fake.current.services.fetchStickersConfig(...a) }));
vi.mock('../services/stickerService', () => ({ subscribeStickers: (...a) => fake.current.services.subscribeStickers(...a) }));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => viewer.value }));

import { StickersProvider } from '../components/stickers/StickersContext';
import { useStickers } from '../components/stickers/stickersRegistry';

function Probe({ id }) {
  const s = useStickers();
  return <span data-testid={id}>{`${s.availability}|${s.status}|${s.ready}|${s.active.map((x) => x.name).join(',')}|${s.archived.length}`}</span>;
}

beforeEach(() => {
  fake.current = createFakeStickers();
  viewer.value = { uid: 'u1' };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('StickersProvider', () => {
  it('three surfaces and a nested provider share one config answer and one subscription', async () => {
    fake.current.state.registry = [sticker('Donor'), sticker('Board'), sticker('Old', { status: 'archived' })];
    render(
      <StickersProvider uid="u1">
        <Probe id="a" />
        <Probe id="b" />
        <StickersProvider uid="u1">
          <Probe id="c" />
        </StickersProvider>
      </StickersProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('c')).toHaveTextContent('available|ready|true|Board,Donor|1'));
    expect(screen.getByTestId('a')).toHaveTextContent('available|ready|true|Board,Donor|1');
    expect(fake.current.state.configFetches).toBe(1);
    expect(fake.current.state.subscriptions).toBe(1);
  });

  it('does not subscribe when stickers are unavailable', async () => {
    fake.current.state.config = config({ enabled: false, mode: 'off', readOnly: false });
    render(<StickersProvider uid="u1"><Probe id="a" /></StickersProvider>);
    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('unavailable|idle|false||0'));
    expect(fake.current.state.subscriptions).toBe(0);
  });

  it('does not subscribe while impersonating, nor ask the server', async () => {
    viewer.value = { uid: 'u1', _isImpersonated: true };
    render(<StickersProvider uid="u1"><Probe id="a" /></StickersProvider>);
    await act(async () => {});
    expect(screen.getByTestId('a')).toHaveTextContent('unavailable|idle|false');
    expect(fake.current.state.configFetches).toBe(0);
    expect(fake.current.state.subscriptions).toBe(0);
  });

  it('does not subscribe without a user id', async () => {
    render(<StickersProvider uid={null}><Probe id="a" /></StickersProvider>);
    await waitFor(() => expect(fake.current.state.configFetches).toBe(1));
    expect(fake.current.state.subscriptions).toBe(0);
    expect(screen.getByTestId('a')).toHaveTextContent('available|idle|false');
  });

  it('unsubscribes when the page unmounts', async () => {
    const view = render(<StickersProvider uid="u1"><Probe id="a" /></StickersProvider>);
    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('ready'));
    view.unmount();
    expect(fake.current.state.unsubscribed).toBe(1);
  });

  it('a registry error hides the surfaces (not ready) and logs only a code', async () => {
    const logs = [];
    console.warn.mockImplementation((...a) => logs.push(JSON.stringify(a)));
    fake.current.services.subscribeStickers = (_uid, _next, onError) => {
      fake.current.state.subscriptions += 1;
      Promise.resolve().then(() => onError({ code: 'permission_denied' }));
      return () => {};
    };
    render(<StickersProvider uid="u1"><Probe id="a" /></StickersProvider>);
    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('available|error|false'));
    expect(logs.join('')).toContain('permission_denied');
    expect(logs.join('')).not.toContain('u1');
  });

  it('outside any provider, surfaces are unavailable', () => {
    render(<Probe id="a" />);
    expect(screen.getByTestId('a')).toHaveTextContent('unavailable|idle|false');
  });
});
