/**
 * useStickersAvailability: sticker controls show only when the server says
 * enabled and not read-only, never while an admin is viewing as another user,
 * and never on an error or while the answer is unknown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const fetchStickersConfig = vi.hoisted(() => vi.fn());
const effectiveUser = vi.hoisted(() => ({ value: { uid: 'U' } }));

vi.mock('../components/stickers/stickersApi.js', () => ({ fetchStickersConfig }));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => effectiveUser.value }));

import { useStickersAvailability } from '../components/stickers/useStickersAvailability.js';

beforeEach(() => {
  fetchStickersConfig.mockReset();
  effectiveUser.value = { uid: 'U' };
});

describe('useStickersAvailability', () => {
  it('is checking, then available, when enabled and writable', async () => {
    fetchStickersConfig.mockResolvedValue({ status: 200, body: { enabled: true, mode: 'beta', readOnly: false } });
    const { result } = renderHook(() => useStickersAvailability());
    expect(result.current).toBe('checking');
    await waitFor(() => expect(result.current).toBe('available'));
  });

  it.each([
    ['disabled', { status: 200, body: { enabled: false, mode: 'off', readOnly: false } }],
    ['read-only', { status: 200, body: { enabled: true, mode: 'on', readOnly: true } }],
    ['an error status', { status: 403, body: { error: 'forbidden' } }],
    ['no body', { status: 200, body: null }],
    ['enabled as a string', { status: 200, body: { enabled: 'true' } }],
  ])('is unavailable when %s', async (_label, answer) => {
    fetchStickersConfig.mockResolvedValue(answer);
    const { result } = renderHook(() => useStickersAvailability());
    await waitFor(() => expect(result.current).toBe('unavailable'));
  });

  it('is unavailable when the request fails', async () => {
    fetchStickersConfig.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useStickersAvailability());
    await waitFor(() => expect(result.current).toBe('unavailable'));
  });

  it('never asks, and is unavailable, while an admin views as another user', async () => {
    effectiveUser.value = { uid: 'U', _isImpersonated: true };
    const { result } = renderHook(() => useStickersAvailability());
    expect(result.current).toBe('unavailable');
    expect(fetchStickersConfig).not.toHaveBeenCalled();
  });
});
