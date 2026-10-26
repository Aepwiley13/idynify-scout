/**
 * Clicking a contact's photo opens ContactIdentityViewer: the photo at its own
 * framing, name, title, company, and View LinkedIn when there is a LinkedIn.
 *
 * Pins which photos count as a real face (placeholders, company logos and
 * non-http URLs do not), that a real photo opens the viewer and a missing or
 * placeholder one keeps the Search LinkedIn / Paste photo URL menu, that Esc,
 * the backdrop and X close it, that focus returns to the avatar, that page
 * scroll is locked only while it is open, and that a small source is not
 * stretched past 1.5× its own size.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContactIdentityViewer from '../components/contacts/ContactIdentityViewer';
import IdentityCard from '../components/contacts/IdentityCard';
import { isPlaceholderPhoto, hasRealContactPhoto, resolveContactPhotoSources } from '../utils/contactPhoto';

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal()),
  doc: (_db, ...path) => ({ path: path.join('/') }),
  updateDoc: vi.fn(async () => {}),
}));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => ({ uid: 'u1' }) }));
vi.mock('../services/peopleService', () => ({ getUniqueTags: async () => [] }));
vi.mock('../components/scout/CompanyDetailModal', () => ({ default: () => null }));

const PHOTO = 'https://media.licdn.com/dms/image/v2/abc/profile-displayphoto-shrink_400_400/0/1?e=1&t=x';

const JIMMY = {
  id: 'c1',
  name: 'Jimmy Choi',
  title: 'Chief Executive Officer',
  company_name: 'Bridge',
  photo_url: PHOTO,
  linkedin_url: 'https://www.linkedin.com/in/jimmychoi',
};

const avatar = () => screen.getByRole('button', { name: "View Jimmy Choi's profile" });
const openViewer = async (user) => {
  await user.click(avatar());
  return screen.getByRole('dialog', { name: 'Jimmy Choi' });
};

// ─── What counts as a real photo ────────────────────────────────────────────

describe('a real photo is an http(s) image of a face', () => {
  it('placeholders, logos, banners and non-http URLs are not', () => {
    expect(isPlaceholderPhoto(PHOTO)).toBe(false);
    expect(isPlaceholderPhoto('https://images.apollo.io/abc123.jpg')).toBe(false);

    [
      null, '', '   ',
      'https://static.licdn.com/sc/h/1c5u578iilxfi4m4dvc4q810q',
      'https://cdn.example.com/ghost-person.png',
      'https://cdn.example.com/default-avatar.png',
      'https://via.placeholder.com/150',
      'https://media.licdn.com/dms/image/C4E0BAQ/company-logo_200_200/0/1',
      'https://media.licdn.com/dms/image/D4E16AQ/profile-displaybackgroundimage-shrink_350_1400/0/1',
      'data:image/png;base64,iVBOR',
      '/images/me.png',
    ].forEach(url => expect(isPlaceholderPhoto(url)).toBe(true));
  });

  it('one stored URL serves both sizes; no photo, no sources', () => {
    expect(resolveContactPhotoSources(JIMMY)).toEqual({ thumbnail: PHOTO, full: PHOTO });
    expect(resolveContactPhotoSources({ photo_url: null })).toEqual({ thumbnail: null, full: null });
    expect(hasRealContactPhoto({})).toBe(false);
  });
});

// ─── From the profile avatar ────────────────────────────────────────────────

describe('clicking the avatar on the contact profile', () => {
  it('a real photo opens the identity viewer with name, title, company and the full-size photo', async () => {
    const user = userEvent.setup();
    render(<IdentityCard contact={JIMMY} onUpdate={vi.fn()} />);

    const dialog = await openViewer(user);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('img', { name: 'Profile photo of Jimmy Choi' })).toHaveAttribute('src', PHOTO);
    expect(within(dialog).getByText('Chief Executive Officer')).toBeInTheDocument();
    expect(within(dialog).getByText('Bridge')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('a placeholder photo shows initials and opens the photo-source menu, not the viewer', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <IdentityCard contact={{ ...JIMMY, photo_url: 'https://static.licdn.com/sc/h/ghost' }} onUpdate={vi.fn()} />,
    );

    expect(screen.queryByRole('button', { name: "View Jimmy Choi's profile" })).toBeNull();
    expect(container.querySelector('.idc-initials')).toHaveTextContent('JC');
    await user.click(container.querySelector('.idc-photo--click'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Paste photo URL' })).toBeInTheDocument();
  });

  it('no photo keeps the Search LinkedIn / Paste photo URL workflow', async () => {
    const user = userEvent.setup();
    const { container } = render(<IdentityCard contact={{ ...JIMMY, photo_url: null }} onUpdate={vi.fn()} />);

    await user.click(container.querySelector('.idc-photo--click'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Search LinkedIn' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paste photo URL' })).toBeInTheDocument();
  });

  it('Esc closes it, returns focus to the avatar and unlocks page scroll', async () => {
    const user = userEvent.setup();
    render(<IdentityCard contact={JIMMY} onUpdate={vi.fn()} />);

    await openViewer(user);
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(avatar()).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('clicking the backdrop closes it; clicking inside the panel does not', async () => {
    const user = userEvent.setup();
    render(<IdentityCard contact={JIMMY} onUpdate={vi.fn()} />);

    const dialog = await openViewer(user);
    await user.click(within(dialog).getByText('Chief Executive Officer'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByTestId('contact-identity-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(avatar()).toHaveFocus();
  });

  it('the X closes it', async () => {
    const user = userEvent.setup();
    render(<IdentityCard contact={JIMMY} onUpdate={vi.fn()} />);

    const dialog = await openViewer(user);
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Tab stays inside the viewer', async () => {
    const user = userEvent.setup();
    render(<IdentityCard contact={JIMMY} onUpdate={vi.fn()} />);

    const dialog = await openViewer(user);
    const close = within(dialog).getByRole('button', { name: 'Close' });
    const linkedin = within(dialog).getByRole('link', { name: /View LinkedIn/ });
    await user.tab();
    expect(linkedin).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(linkedin).toHaveFocus();
  });
});

// ─── The viewer on its own ──────────────────────────────────────────────────

describe('ContactIdentityViewer', () => {
  it('View LinkedIn appears only when the contact has a LinkedIn URL, and opens it in a new tab', () => {
    const { rerender } = render(<ContactIdentityViewer contact={JIMMY} open onClose={vi.fn()} />);
    const link = screen.getByRole('link', { name: /View LinkedIn/ });
    expect(link).toHaveAttribute('href', JIMMY.linkedin_url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));

    rerender(<ContactIdentityViewer contact={{ ...JIMMY, linkedin_url: null }} open onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Jimmy Choi' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /View LinkedIn/ })).toBeNull();
  });

  it('fills the viewer with a photo, but never enlarges a small source more than 1.5×', () => {
    render(<ContactIdentityViewer contact={JIMMY} open onClose={vi.fn()} />);
    const img = screen.getByRole('img', { name: 'Profile photo of Jimmy Choi' });
    Object.defineProperty(img, 'naturalWidth', { value: 160 });
    Object.defineProperty(img, 'naturalHeight', { value: 200 });
    fireEvent.load(img);

    expect(img).toHaveStyle({ maxWidth: '240px', maxHeight: '300px' });
    expect(img.closest('.civ-photo')).toHaveStyle({ aspectRatio: '160 / 200' });
    expect(img.closest('.civ-photo').querySelector('.civ-photo-fill')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders nothing, and leaves scroll alone, for a contact without a real photo', () => {
    render(<ContactIdentityViewer contact={{ ...JIMMY, photo_url: null }} open onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('works from contact data alone: first/last name, company field, no title', () => {
    render(
      <ContactIdentityViewer
        contact={{ first_name: 'Dana', last_name: 'Ruiz', company: 'Acme', photo_url: PHOTO }}
        open
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Dana Ruiz' });
    expect(within(dialog).getByText('Acme')).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'Profile photo of Dana Ruiz' })).toBeInTheDocument();
  });
});
