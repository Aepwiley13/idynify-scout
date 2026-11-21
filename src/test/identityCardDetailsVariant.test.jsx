/**
 * IdentityCard's variant="details" (the redesigned profile), on the real component.
 *
 * It is the card with ONLY the contact details: email, phones and social profiles, with their existing editors.
 * The photo, name, title, company and stickers are the header's now. Nothing about the default, "full" or "simple"
 * card changes (identityCardSimpleVariant.test.jsx holds that; the unchanged output was also compared byte for
 * byte against the card as it was, for four contacts in each of the three).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeStickers, sticker } from './helpers/stickersUi';

const fake = vi.hoisted(() => ({ current: null, updates: [] }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal()),
  doc: (_db, ...path) => ({ path: path.join('/') }),
  updateDoc: async (ref, data) => { fake.updates.push({ path: ref.path, data }); },
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

vi.setConfig({ testTimeout: 20000 });
const BOARD = sticker('Board');
const contact = {
  id: 'c1', name: 'Avery Quinn', title: 'Program Director', company_name: 'Utah Advocacy Coalition',
  photo_url: 'https://images.example.com/avery.jpg', email: 'avery@uac.test', phone_mobile: '+1 555 010 0001',
  linkedin_url: 'https://www.linkedin.com/in/avery', tags: ['gala-2024'], sticker_ids: [BOARD.id], stage: 'hunter', brigade: 'leads',
};

beforeEach(() => {
  fake.current = createFakeStickers();
  fake.current.state.registry = [BOARD];
  fake.updates = [];
});

const renderCard = (props = {}) => render(
  <StickersProvider uid="u1"><IdentityCard contact={contact} onUpdate={() => {}} onRefreshPhoto={() => {}} {...props} /></StickersProvider>,
);

describe('the details card', () => {
  it('shows the email, the phone and the social profile, which is all it is for', async () => {
    renderCard({ variant: 'details' });
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(document.body.textContent).toContain('avery@uac.test');
    expect(document.querySelector('.idc-contact-details')).not.toBeNull();
    expect(screen.getByRole('link', { name: /linkedin/i })).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/555/);
  });

  it('leaves out what the header draws: the banner, the photo, the name, title, company, stickers and the sales layer', async () => {
    const { container } = renderCard({ variant: 'details' });
    await screen.findByText('Email');
    for (const selector of ['.idc-banner', '.idc-avatar-row', '.idc-photo', '.idc-name', '.idc-sub-text', '.idc-company-text', '.idc-company-link', '.idc-chips-row', '.idc-tags-section', '.idc-divider', '[data-testid="contact-stickers"]']) {
      expect(container.querySelector(selector), selector).toBeNull();
    }
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByText('Avery Quinn')).toBeNull();
    expect(screen.queryByText('Program Director')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is marked as the details card, and the other variants are not', () => {
    const { container, unmount } = renderCard({ variant: 'details' });
    expect(container.querySelector('.idc-card')).toHaveClass('idc-card--details');
    unmount();
    for (const variant of [undefined, 'full', 'simple']) {
      const r = renderCard({ variant });
      expect(r.container.querySelector('.idc-card')).not.toHaveClass('idc-card--details');
      r.unmount();
    }
  });

  it('keeps the existing email editor: adding an email writes the emails list to the contact\'s own document', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    renderCard({ variant: 'details', onUpdate });
    await user.click(screen.getByText('add email'));
    const input = document.querySelector('.idc-multi-entries input:not([readonly])');
    expect(input).not.toBeNull();
    await user.type(input, 'second@uac.test{Enter}');
    const write = fake.updates.find((u) => u.data.emails);
    expect(write.path).toBe('users/u1/contacts/c1');
    expect(write.data.emails.map((e) => e.value)).toContain('second@uac.test');
    expect(onUpdate).toHaveBeenCalled();
  });

  it('keeps the existing phone editor', () => {
    renderCard({ variant: 'details' });
    expect(document.querySelector('.idc-contact-details')).toHaveTextContent(/Phone/i);
    expect(within(document.querySelector('.idc-contact-details')).getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('draws the same details as the full card, in the same place', () => {
    const full = renderCard({ variant: 'full' });
    const fullDetails = full.container.querySelector('.idc-contact-details').innerHTML.replace(/(id|for|aria-labelledby|aria-controls|aria-describedby)=":[^"]*"/g, '$1=""');
    full.unmount();
    const details = renderCard({ variant: 'details' });
    const detailsDetails = details.container.querySelector('.idc-contact-details').innerHTML.replace(/(id|for|aria-labelledby|aria-controls|aria-describedby)=":[^"]*"/g, '$1=""');
    expect(detailsDetails).toBe(fullDetails);
  });
});
