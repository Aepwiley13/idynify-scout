/**
 * IdentityCard's variant="simple" (Contact Hub), on the real component.
 *
 * Two promises:
 *   1. The default card is unchanged: with no variant, or variant="full", it
 *      renders exactly what it did before the prop existed. Every existing
 *      caller passes no variant.
 *   2. The simple card is the same card minus the sales layer, and nothing
 *      else: identity, contact details and stickers all stay.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeStickers, sticker } from './helpers/stickersUi';

const fake = vi.hoisted(() => ({ current: null }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal()),
  doc: (_db, ...path) => ({ path: path.join('/') }),
  updateDoc: async () => {},
}));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => ({ uid: 'u1' }), useImpersonation: () => ({ isImpersonating: false }) }));
vi.mock('../services/peopleService', () => ({ getUniqueTags: async () => [] }));
vi.mock('../components/scout/CompanyDetailModal', () => ({ default: () => <div data-testid="company-modal" /> }));
vi.mock('../components/stickers/stickersApi.js', () => ({ fetchStickersConfig: (...a) => fake.current.services.fetchStickersConfig(...a) }));
vi.mock('../services/stickerService', () => ({
  subscribeStickers: (...a) => fake.current.services.subscribeStickers(...a),
  createSticker: (...a) => fake.current.services.createSticker(...a),
}));
vi.mock('../services/contactStickers', () => ({
  addSticker: (...a) => fake.current.services.addSticker(...a),
  removeSticker: (...a) => fake.current.services.removeSticker(...a),
}));

import IdentityCard from '../components/contacts/IdentityCard';
import { StickersProvider } from '../components/stickers/StickersContext';

// These render whole screens and type into them. On a loaded machine that can
// pass the 5s default without anything being wrong (the suite's other
// full-page tests allow 20s for the same reason).
vi.setConfig({ testTimeout: 20000 });
const BOARD = sticker('Board');
const contact = {
  id: 'c1',
  name: 'Avery Quinn',
  title: 'Program Director',
  company_name: 'Utah Advocacy Coalition',
  company_id: 'co1',
  email: 'avery@uac.test',
  phone_mobile: '+1 555 010 0001',
  linkedin_url: 'https://www.linkedin.com/in/avery',
  tags: ['gala-2024'],
  sticker_ids: [BOARD.id],
  stage: 'hunter',
  brigade: 'leads',
};

beforeEach(() => {
  fake.current = createFakeStickers();
  fake.current.state.registry = [BOARD];
});

const renderCard = (props = {}) => render(
  <StickersProvider uid="u1"><IdentityCard contact={contact} onUpdate={() => {}} onRefreshPhoto={() => {}} {...props} /></StickersProvider>,
);

/** The card's markup with run-specific ids removed, for comparing two renders. */
const markup = (container) => container.innerHTML.replace(/(id|for|aria-labelledby|aria-controls|aria-describedby)=":[^"]*"/g, '$1=""');

describe('the default card is unchanged', () => {
  it('no variant and variant="full" render identical markup', async () => {
    const plain = renderCard();
    await screen.findByTestId('contact-stickers');
    const before = markup(plain.container);
    plain.unmount();

    const full = renderCard({ variant: 'full' });
    await screen.findByTestId('contact-stickers');
    expect(markup(full.container)).toBe(before);
  });

  it('an unknown variant falls back to the full card, not to something in between', async () => {
    const plain = renderCard();
    await screen.findByTestId('contact-stickers');
    const before = markup(plain.container);
    plain.unmount();

    const odd = renderCard({ variant: 'compact' });
    await screen.findByTestId('contact-stickers');
    expect(markup(odd.container)).toBe(before);
  });

  it('still has the whole sales layer: stage badge, classification chips, tags, company link, LinkedIn photo lookup', async () => {
    const user = userEvent.setup();
    const { container } = renderCard();
    await screen.findByTestId('contact-stickers');
    expect(container.querySelector('.idc-stage-badge')).not.toBeNull();
    expect(container.querySelector('.idc-chips-row')).not.toBeNull();
    expect(container.querySelectorAll('.idc-chips-row .idc-chip').length).toBeGreaterThanOrEqual(4);
    expect(container.querySelector('.idc-tags-section')).not.toBeNull();
    expect(container.querySelector('.idc-tag-pill')).toHaveTextContent('gala-2024');
    expect(container.querySelector('.idc-company-link')).not.toBeNull();
    await user.click(container.querySelector('.idc-company-link'));
    expect(screen.getByTestId('company-modal')).toBeInTheDocument();
    await user.click(container.querySelector('.idc-photo-wrap button, .idc-photo-wrap [role="button"], .idc-photo-wrap > div'));
    expect(await screen.findByText('Search LinkedIn')).toBeInTheDocument();
  });
});

describe('variant="simple"', () => {
  it('removes the sales layer', async () => {
    const { container } = renderCard({ variant: 'simple' });
    await screen.findByTestId('contact-stickers');
    expect(container.querySelector('.idc-stage-badge')).toBeNull();
    expect(container.querySelector('.idc-chips-row')).toBeNull();
    expect(container.querySelector('.idc-tags-section')).toBeNull();
    expect(screen.queryByText('gala-2024')).toBeNull();
    expect(screen.queryByText('Add tag')).toBeNull();
    for (const word of ['Brigade', 'Relationship', 'Value']) expect(screen.queryByText(word)).toBeNull();
  });

  it('shows the company as plain text, with no way into the company record', async () => {
    const { container } = renderCard({ variant: 'simple' });
    await screen.findByTestId('contact-stickers');
    expect(container.querySelector('.idc-company-link')).toBeNull();
    expect(container.querySelector('.idc-company-text')).toHaveTextContent('Utah Advocacy Coalition');
    expect(screen.queryByTestId('company-modal')).toBeNull();
  });

  it('offers no LinkedIn photo lookup, even when the caller passes a handler', async () => {
    const user = userEvent.setup();
    const onRefreshPhoto = vi.fn();
    const { container } = renderCard({ variant: 'simple', onRefreshPhoto });
    await screen.findByTestId('contact-stickers');
    await user.click(container.querySelector('.idc-photo-wrap button, .idc-photo-wrap [role="button"], .idc-photo-wrap > div'));
    await act(async () => {});
    expect(screen.queryByText('Search LinkedIn')).toBeNull();
    expect(onRefreshPhoto).not.toHaveBeenCalled();
  });

  it('keeps identity, contact details, quick actions and stickers', async () => {
    const { container } = renderCard({ variant: 'simple' });
    await screen.findByTestId('contact-stickers');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Avery Quinn');
    expect(screen.getByText('Program Director')).toBeInTheDocument();
    expect(screen.getByText('Board').closest('.stk-chip')).not.toBeNull();
    expect(container.querySelector('.idc-contact-details')).not.toBeNull();
    expect(container.querySelector('a[href="mailto:avery@uac.test"]')).not.toBeNull();
    expect(container.querySelector('a[href="tel:+1 555 010 0001"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://www.linkedin.com/in/avery"]')).not.toBeNull();
  });

  it('the stickers row sits directly above the divider, where the tags used to be', async () => {
    renderCard({ variant: 'simple' });
    const row = await screen.findByTestId('contact-stickers');
    expect(row.nextElementSibling).toHaveClass('idc-divider');
  });
});
