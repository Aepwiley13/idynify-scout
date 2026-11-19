/* global process */
/**
 * PersonHeader, the component: what it draws from a display model, and what it never draws.
 *
 * What is held here: it draws the model and nothing else; every part with nothing to show is
 * left out; every link is one the model made and is safe; there is no control without an
 * action (so, in this milestone, no button at all); long and international text is whole in
 * the page, whatever the stylesheet does to the eye; a photo that does not load falls back to
 * the initials; and the component imports nothing but React, icons, tokens and pure helpers.
 * How it looks is checked in real Chrome (scripts/visual/person-header); the stylesheet is
 * held in place by personHeaderStyling.test.js.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PersonHeader from '../components/contacts/personHeader/PersonHeader';
import { buildPersonHeaderModel } from '../components/contacts/personHeader/personHeaderModel';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const sticker = (id, name, color, emoji) => [id, { id, name, color, emoji, status: 'active' }];
const REGISTRY = new Map([sticker('p', 'Partner', 'purple', '🤝'), sticker('e', 'Education', 'blue'), sticker('c', 'Community', 'green', '🌱')]);

const JORDAN = {
  id: 'c1', name: 'Jordan Lee', title: 'Community Partner', company_name: 'Community Partners', city: 'Salt Lake City', state: 'UT',
  photo_url: 'https://images.example.com/jordan.jpg', phones: [{ id: '1', value: '(801) 555-0199', label: 'mobile' }],
  emails: [{ id: '0', value: 'jordan@communityslc.org' }], linkedin_url: 'https://www.linkedin.com/in/jordan-lee',
  social_profiles: [{ platform: 'instagram', handle: 'jordan.lee', url: 'https://www.instagram.com/jordan.lee' }],
  sticker_ids: ['p', 'e'], last_message_at: '2026-11-10T00:00:00Z',
};
const model = (contact, withRegistry = true) => buildPersonHeaderModel(contact, { stickersById: withRegistry ? REGISTRY : null, now: NOW });
const draw = (contact, props = {}, withRegistry = true) => render(<PersonHeader person={model(contact, withRegistry)} {...props} />);
const card = () => screen.getByRole('article');

describe('what it draws', () => {
  it('draws a full contact: name, subtitle, location, the two pills, the profile links and the stickers', () => {
    draw(JORDAN);
    expect(card()).toHaveAccessibleName('Contact: Jordan Lee');
    expect(screen.getByRole('heading', { level: 2, name: 'Jordan Lee' })).toBeInTheDocument();
    expect(within(card()).getByText('Community Partner')).toBeInTheDocument();
    expect(within(card()).getByText('Community Partners')).toBeInTheDocument();
    expect(within(card()).getByText('Salt Lake City, UT')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call (801) 555-0199' })).toHaveAttribute('href', 'tel:8015550199');
    expect(screen.getByRole('link', { name: 'Email jordan@communityslc.org' })).toHaveAttribute('href', 'mailto:jordan@communityslc.org');
    expect(screen.getAllByRole('link')).toHaveLength(4);
    const stickers = screen.getByRole('list', { name: 'Stickers' });
    expect(within(stickers).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Education', '🤝Partner']);
  });

  it('uses the heading level it is given (1 to 6), and level 2 otherwise', () => {
    for (const [level, expected] of [[1, 1], [3, 3], [6, 6], [undefined, 2], [0, 1], [9, 6], [2.5, 2], ['4', 2]]) {
      const { unmount } = draw(JORDAN, { headingLevel: level });
      expect(screen.getByRole('heading', { level: expected })).toHaveTextContent('Jordan Lee');
      unmount();
    }
  });

  it('draws nothing for nothing: no model, no card', () => {
    const { container } = render(<PersonHeader person={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(render(<PersonHeader person={undefined} />).container).toBeEmptyDOMElement();
  });

  it.each([
    ['title and organization', { title: 'Director', company_name: 'Acme' }, 'Director', 'Acme'],
    ['title only', { title: 'Director' }, 'Director', null],
    ['organization only', { company: 'Acme' }, null, 'Acme'],
  ])('shows %s, with a separator only between two', (_label, extra, title, org) => {
    draw({ name: 'Ana Lopez', ...extra });
    const subtitle = card().querySelector('.ph-subtitle');
    expect(subtitle).not.toBeNull();
    if (title) expect(subtitle).toHaveTextContent(title);
    if (org) expect(subtitle).toHaveTextContent(org);
    expect(subtitle.querySelectorAll('.ph-sep')).toHaveLength(title && org ? 1 : 0);
    expect(subtitle.querySelector('.ph-sep')?.getAttribute('aria-hidden') ?? 'true').toBe('true');
  });

  it('leaves out every part there is nothing for, and says "Unknown contact" for a nameless one', () => {
    draw({ id: 'x' });
    expect(screen.getByRole('heading')).toHaveTextContent('Unknown contact');
    expect(card().querySelector('.ph-subtitle')).toBeNull();
    expect(card().querySelector('.ph-location')).toBeNull();
    expect(card().querySelector('.ph-contacts')).toBeNull();
    expect(card().querySelector('.ph-stickers')).toBeNull();
    expect(within(card()).queryAllByRole('link')).toHaveLength(0);
    expect(card().querySelector('.ph-avatar-initials')).toHaveTextContent('?');
  });

  it('tells a screen reader the location is one, and where a title ends and an organization begins', () => {
    draw({ name: 'Ana', title: 'Director', company_name: 'Acme', location: 'Provo' });
    expect(card().querySelector('.ph-location')).toHaveTextContent('Location: Provo');
    // Between the two a screen reader hears a comma; the dot is for the eye only.
    expect(card().querySelector('.ph-subtitle .ph-sr')).toHaveTextContent(',');
    expect(card().querySelector('.ph-subtitle .ph-sep')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('the pills and links', () => {
  it('draws the phone and the email only when the model has a safe link for them', () => {
    draw({ name: 'Casey', phones: [{ id: '1', value: 'call the desk' }], emails: [{ value: 'casey@@broken' }], email: 'nope', linkedin_url: 'javascript:alert(1)' });
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(card().querySelector('.ph-contacts')).toBeNull();
  });

  it('opens a profile in a new tab, safely, and says so', () => {
    draw(JORDAN);
    const linkedin = screen.getByRole('link', { name: /LinkedIn profile of Jordan Lee/ });
    expect(linkedin).toHaveAttribute('href', 'https://www.linkedin.com/in/jordan-lee');
    expect(linkedin).toHaveAttribute('target', '_blank');
    expect(linkedin.getAttribute('rel')).toBe('noopener noreferrer');
    expect(linkedin).toHaveAccessibleName('LinkedIn profile of Jordan Lee (opens in a new tab)');
    expect(screen.getByRole('link', { name: /Instagram profile/ })).toHaveAttribute('href', 'https://www.instagram.com/jordan.lee');
  });

  it('does not open a phone or an email in a new tab', () => {
    draw(JORDAN);
    for (const name of ['Call (801) 555-0199', 'Email jordan@communityslc.org']) {
      expect(screen.getByRole('link', { name })).not.toHaveAttribute('target');
    }
  });

  it('never draws a link whose address is not tel:, mailto: or https:, whatever it is handed', () => {
    const base = model(JORDAN);
    const hostile = {
      ...base,
      phone: { text: 'x', href: 'javascript:alert(1)', label: 'mobile' },
      email: { address: 'x@y.co', href: 'data:text/html,<script>' },
      social: [
        { platform: 'linkedin', label: 'LinkedIn', url: 'http://insecure.example/in/x', handle: 'x' },
        { platform: 'instagram', label: 'Instagram', url: 'javascript:alert(1)', handle: 'x' },
        { platform: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/x', handle: 'x' },
      ],
    };
    render(<PersonHeader person={hostile} />);
    const hrefs = screen.queryAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://www.facebook.com/x']);
  });

  it('has a link a person can use: reachable by keyboard, in a list', () => {
    draw(JORDAN);
    const list = screen.getByRole('list', { name: 'Ways to reach them' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    for (const a of within(list).getAllByRole('link')) expect(a).not.toHaveAttribute('tabindex', '-1');
  });

  it('tells the parent a link was used, and only that: the link still does its work', async () => {
    const onContactAction = vi.fn();
    draw(JORDAN, { actions: { onContactAction } });
    const user = userEvent.setup();
    // jsdom does not navigate; the click is what is being observed.
    const swallow = (event) => event.preventDefault();
    document.addEventListener('click', swallow);
    await user.click(screen.getByRole('link', { name: 'Call (801) 555-0199' }));
    await user.click(screen.getByRole('link', { name: 'Email jordan@communityslc.org' }));
    await user.click(screen.getByRole('link', { name: /Instagram profile/ }));
    document.removeEventListener('click', swallow);
    expect(onContactAction.mock.calls).toEqual([['phone', {}], ['email', {}], ['social', { platform: 'instagram' }]]);
  });

  it('works with no callbacks at all, and with callbacks that are not functions', () => {
    for (const actions of [undefined, null, {}, { onContactAction: 'x' }, 'actions']) {
      const { unmount } = draw(JORDAN, { actions });
      const link = screen.getByRole('link', { name: 'Call (801) 555-0199' });
      fireEvent.click(link);
      expect(link).toBeInTheDocument();
      unmount();
    }
  });
});

describe('no control without an action', () => {
  const CONTACTS = [
    JORDAN, { name: 'Ana' }, {}, { ...JORDAN, photo_url: '' }, { ...JORDAN, sticker_ids: [] }, { ...JORDAN, linkedin_url: '', social_profiles: [] },
  ];

  it('draws no button, no form control and nothing focusable except its links, for any contact', () => {
    for (const contact of CONTACTS) {
      for (const withRegistry of [true, false]) {
        const { container, unmount } = draw(contact, {}, withRegistry);
        expect(container.querySelectorAll('button, input, select, textarea, [role="button"], [contenteditable], summary')).toHaveLength(0);
        for (const el of container.querySelectorAll('[tabindex]')) expect(el.getAttribute('tabindex')).toBe('-1');
        const focusable = [...container.querySelectorAll('a[href], [tabindex]')];
        expect(focusable.every((el) => el.tagName === 'A')).toBe(true);
        unmount();
      }
    }
  });

  it('draws no edit, photo, add-sticker or remove-sticker control even when a parent supplies those callbacks (they arrive with their behaviour, later)', () => {
    const noop = vi.fn();
    const { container } = draw(JORDAN, { actions: { onEdit: noop, onPhotoClick: noop, onAddSticker: noop, onRemoveSticker: noop } });
    expect(container.querySelectorAll('button, [role="button"]')).toHaveLength(0);
    expect(screen.queryByText(/add sticker/i)).toBeNull();
    expect(screen.queryByLabelText(/remove|edit/i)).toBeNull();
    expect(noop).not.toHaveBeenCalled();
  });
});

describe('the stickers', () => {
  it('are drawn as a list of soft pills with their name, and their emoji or a colour dot', () => {
    draw({ ...JORDAN, sticker_ids: ['p', 'e', 'c'] });
    const items = within(screen.getByRole('list', { name: 'Stickers' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['🌱Community', 'Education', '🤝Partner']);
    expect(items[0].querySelector('.ph-sticker-emoji')).not.toBeNull();
    expect(items[1].querySelector('.ph-sticker-dot')).not.toBeNull();
    expect(items[1].querySelector('.ph-sticker-emoji')).toBeNull();
  });

  it('take their colour from the sticker, in the tint the existing sticker chips use', () => {
    draw({ ...JORDAN, sticker_ids: ['e'] });
    const pill = screen.getByText('Education').closest('li');
    expect(pill.style.getPropertyValue('--ph-sticker-tint')).toBe('#3b82f624');
    expect(pill.style.getPropertyValue('--ph-sticker-border')).toBe('#3b82f673');
    expect(pill.style.getPropertyValue('--ph-sticker-dot')).toBe('#3b82f6');
  });

  it('leave no sticker area where stickers are unavailable, and none where there are none to show', () => {
    draw(JORDAN, {}, false);
    expect(card().querySelector('.ph-stickers')).toBeNull();
    expect(card().querySelector('.ph-card')).toHaveAttribute('data-layout', 'c1s0');
    draw({ ...JORDAN, sticker_ids: [] }, {}, true);
    expect(document.querySelectorAll('.ph-stickers')).toHaveLength(0);
  });

  it('do not draw a sticker the model did not give, or a registry', () => {
    const person = { ...model(JORDAN), stickers: [{ id: 'z', name: 'Only this', color: 'teal', emoji: null }] };
    render(<PersonHeader person={person} />);
    expect(screen.getByRole('list', { name: 'Stickers' }).textContent).toBe('Only this');
  });

  it('keep a long name whole, with the full name on hover', () => {
    const name = 'Community partner, school fundraiser and annual gala volunteer committee member';
    render(<PersonHeader person={{ ...model(JORDAN), stickers: [{ id: 'l', name, color: 'teal', emoji: null }] }} />);
    expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByText(name).closest('li')).toHaveAttribute('title', name);
  });
});

describe('the photo and the initials', () => {
  it('draws the photo when there is one, hidden from a screen reader, with no referrer', () => {
    draw(JORDAN);
    const img = card().querySelector('img');
    expect(img).toHaveAttribute('src', 'https://images.example.com/jordan.jpg');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(img.closest('.ph-avatar')).toHaveAttribute('aria-hidden', 'true');
    expect(card().querySelector('.ph-avatar-initials')).toBeNull();
  });

  it('falls back to the initials when there is no photo, or a placeholder, or the photo does not load', () => {
    draw({ ...JORDAN, photo_url: '' });
    expect(card().querySelector('img')).toBeNull();
    expect(card().querySelector('.ph-avatar-initials')).toHaveTextContent('JL');
    draw({ ...JORDAN, id: 'p', photo_url: 'https://static.licdn.com/sc/h/9c8pery4andzj6ohjkjp54ma2' });
    expect(document.querySelectorAll('.ph-avatar img')).toHaveLength(0);

    const { unmount } = draw({ ...JORDAN, id: 'q' });
    const imgs = [...document.querySelectorAll('.ph-avatar img')];
    fireEvent.error(imgs[imgs.length - 1]);
    expect(document.querySelectorAll('.ph-avatar img')).toHaveLength(0);
    expect([...document.querySelectorAll('.ph-avatar-initials')].map((e) => e.textContent)).toEqual(['JL', 'JL', 'JL']);
    unmount();
  });

  it('tries again for a different photo address after one failed', () => {
    const { rerender } = render(<PersonHeader person={model(JORDAN)} />);
    fireEvent.error(card().querySelector('img'));
    expect(card().querySelector('img')).toBeNull();
    rerender(<PersonHeader person={model({ ...JORDAN, photo_url: 'https://images.example.com/other.jpg' })} />);
    expect(card().querySelector('img')).toHaveAttribute('src', 'https://images.example.com/other.jpg');
  });

  it('says in words whether the person has been active, quietly', () => {
    draw(JORDAN);
    expect(screen.getByRole('img', { name: 'Active in the last 30 days' })).toHaveClass('ph-activity--on');
    draw({ name: 'Old', id: 'o', last_message_at: '2025-01-01T00:00:00Z' });
    expect(screen.getByRole('img', { name: 'No recent activity' })).toHaveClass('ph-activity--off');
  });
});

describe('long, international and unusual text', () => {
  const LONG = 'Bartholomew-Alexandrovich Featherstonehaugh-Cholmondeley '.repeat(30).trim();
  const LONG_EMAIL = `${'very-long-address-part.'.repeat(8)}name@example-organization.example`;

  it('keeps every value whole in the page: the stylesheet only changes how much of it the eye sees', () => {
    draw({ name: LONG, title: LONG, company_name: LONG, location: LONG, emails: [{ value: LONG_EMAIL }] });
    expect(screen.getByRole('heading')).toHaveTextContent(LONG);
    expect(card().querySelector('.ph-subtitle').textContent.replace(/, /g, ' ')).toContain(LONG);
    expect(card().querySelector('.ph-location-text')).toHaveTextContent(LONG);
    expect(screen.getByRole('link', { name: `Email ${LONG_EMAIL}` })).toHaveTextContent(LONG_EMAIL);
    expect(card().textContent).not.toContain('…');
  });

  it('gives the full text where it may be cut: a hover title and, for a pill, the accessible name', () => {
    draw({ name: LONG, title: 'T'.repeat(300), company_name: 'C'.repeat(300), location: LONG, emails: [{ value: LONG_EMAIL }], phones: [{ value: '+44 20 7946 0958 x204', label: 'work' }] });
    expect(screen.getByRole('heading')).toHaveAttribute('title', LONG);
    expect(card().querySelector('.ph-subtitle')).toHaveAttribute('title', `${'T'.repeat(300)} · ${'C'.repeat(300)}`);
    expect(card().querySelector('.ph-location')).toHaveAttribute('title', LONG);
    expect(screen.getByRole('link', { name: `Email ${LONG_EMAIL}` })).toHaveAttribute('title', LONG_EMAIL);
    expect(screen.getByRole('link', { name: 'Call +44 20 7946 0958 x204' })).toBeInTheDocument();
  });

  it('draws international names whole, with the text direction following the text', () => {
    for (const [name, initials] of [['李小龍', '李'], ['José Ünal Ñandú', 'JÑ'], ['محمد علي الحسن', 'ما'], ['田中 太郎', '田太'], ['Мария Иванова', 'МИ']]) {
      const { unmount } = draw({ name, title: name, company_name: name, city: name });
      expect(screen.getByRole('heading')).toHaveTextContent(name);
      expect(screen.getByRole('heading')).toHaveAttribute('dir', 'auto');
      expect(card().querySelector('.ph-subtitle')).toHaveAttribute('dir', 'auto');
      expect(card().querySelector('.ph-location')).toHaveAttribute('dir', 'auto');
      expect(card().querySelector('.ph-avatar-initials')).toHaveTextContent(initials);
      unmount();
    }
  });

  it('draws markup-looking text as text', () => {
    draw({ name: '<IMG src=x onError=alert(1)>', title: '<b>CEO</b>' });
    expect(screen.getByRole('heading')).toHaveTextContent('<IMG src=x onError=alert(1)>');
    expect(card().querySelector('img')).toBeNull();
    expect(card().querySelector('b')).toBeNull();
  });
});

describe('the layout hook: which optional rows exist', () => {
  it.each([
    [JORDAN, true, 'c1s1'],
    [JORDAN, false, 'c1s0'],
    [{ ...JORDAN, phones: [], emails: [], email: '', linkedin_url: '', social_profiles: [] }, true, 'c0s1'],
    [{ name: 'Ana', sticker_ids: [] }, true, 'c0s0'],
    [{ name: 'Ana', sticker_ids: ['p'] }, false, 'c0s0'],
    [{ name: 'Ana', sticker_ids: ['p'] }, true, 'c0s1'],
  ])('%#: contacts and stickers say %s', (contact, withRegistry, expected) => {
    draw({ sticker_ids: ['p'], ...contact }, {}, withRegistry);
    expect(card().querySelector('.ph-card')).toHaveAttribute('data-layout', expected);
  });
});

describe('it is only a presentation', () => {
  it('does not change the model it is given, and a frozen model is fine', () => {
    const person = model(JORDAN);
    const before = JSON.stringify(person);
    render(<PersonHeader person={person} />);
    expect(JSON.stringify(person)).toBe(before);
    expect(Object.isFrozen(person)).toBe(true);
  });

  it('imports only React, icons, the design tokens, the sticker palette and the header\'s own files', () => {
    const dir = resolve(process.cwd(), 'src/components/contacts/personHeader');
    const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const source = strip(readFileSync(resolve(dir, 'PersonHeader.jsx'), 'utf8'));
    const imports = [...source.matchAll(/(?:^|\n)\s*import\b[^'"]*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    const allowed = [/^react$/, /^lucide-react$/, /^\.\.\/\.\.\/\.\.\/theme\/tokens$/, /^\.\.\/\.\.\/stickers\/stickerPalette$/, /^\.\/personHeaderContract$/, /^\.\/PersonHeader\.css$/];
    for (const from of imports) expect(allowed.some((re) => re.test(from)), from).toBe(true);
    expect(source).not.toMatch(/firebase|firestore|useNavigate|react-router|ContactHub|billing|Scout|\/services\/|\/context\/|fetch\(|localStorage|sessionStorage|updateDoc|setDoc/);
  });
});
