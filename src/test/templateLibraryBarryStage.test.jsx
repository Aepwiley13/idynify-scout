/**
 * TEMPLATE LIBRARY — Barry's greeting names the stage the user is on
 *
 * The empty state's "Ask Barry to create a template" button opened the create
 * modal (setting the stage) and then, 100ms later, Barry's chat. The chat
 * opener ran from the render that existed before the click, so it read the
 * previous stage: on the Sniper tab Barry offered to write a template for the
 * default stage instead.
 *
 * The test uses Sniper, not Scout, on purpose: Scout is the default, so a
 * stale read would still say "Scout" and the bug would pass unseen.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import TemplateLibrary from '../components/hunter/TemplateLibrary';

vi.mock('../firebase/config', () => ({ auth: {}, db: {} }));

vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'test-user', getIdToken: () => Promise.resolve('fake-token') }),
}));

beforeEach(() => {
  // No saved templates, so the library renders its empty state.
  globalThis.fetch = vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ templates: [] }),
  }));
});

describe('TemplateLibrary — Ask Barry from the empty state', () => {
  it('greets with the active tab\'s stage, not the previous one', async () => {
    render(<TemplateLibrary initialStage="sniper" />);

    fireEvent.click(await screen.findByText('Ask Barry to create a template'));

    expect(await screen.findByText(/create a Sniper template/)).toBeTruthy();
    expect(screen.queryByText(/create a Scout template/)).toBeNull();
  });
});
