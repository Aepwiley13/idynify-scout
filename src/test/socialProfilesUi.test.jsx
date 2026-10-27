/**
 * Social profiles on screen: the review's Social section, the save gate, and
 * the rows on the contact profile (display only). Every handle is fictional.
 */
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const T = { cardBg: '#fff', surface: '#fafafa', border: '#ddd', text: '#111', textMuted: '#555', textFaint: '#888', input: '#fff', isDark: false };
const api = vi.hoisted(() => ({ preview: vi.fn(), save: vi.fn() }));

vi.mock('../theme/ThemeContext', () => ({ useT: () => T }));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => ({ uid: 'u1' }) }));
vi.mock('../firebase/config', () => ({ auth: { currentUser: { uid: 'u1' } }, db: {} }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal()),
  doc: (_db, ...path) => ({ path: path.join('/') }),
  updateDoc: vi.fn(async () => {}),
}));
vi.mock('../components/capture/captureSave.js', () => ({
  previewCapturePerson: (...a) => api.preview(...a),
  saveCapturePerson: (...a) => api.save(...a),
}));
vi.mock('../services/peopleService', () => ({ getUniqueTags: async () => [] }));
vi.mock('../components/scout/CompanyDetailModal', () => ({ default: () => null }));

const { default: CaptureReview } = await import('../components/capture/CaptureReview.jsx');
const { default: CaptureSavePanel } = await import('../components/capture/CaptureSavePanel.jsx');
const { default: IdentityCard } = await import('../components/contacts/IdentityCard');

const row = (n, text, platform, over = {}) => ({ id: `social-${n}`, platform, text, observed: text, fromCard: true, confirmed: false, unsure: false, ...over });
const person = (socials) => ({
  key: 'person-1', name: 'Kristin Sokol', title: '', company: 'Sokol Studio', email: '', otherEmails: [],
  linkedinUrl: '', website: '', phones: [], socials, toCheck: [],
});

/** The review screen holding its own state, as CaptureFlow does. */
function Review({ initial, onPeople }) {
  const [people, setPeople] = useState(initial);
  return (
    <>
      <CaptureReview people={people} T={T} onChange={(i, next) => { const list = people.map((p, j) => (j === i ? next : p)); setPeople(list); onPeople?.(list); }} />
      <CaptureSavePanel operationId="cap_3f2a9c1e" people={people} onSaved={() => {}} T={T} />
    </>
  );
}

describe('review: the Social section', () => {
  it('a bare @handle asks which network; Continue waits until the user chooses', async () => {
    const user = userEvent.setup();
    const seen = [];
    render(<Review initial={[person([row(1, '@KRISTINSOKOL', null)])]} onPeople={list => seen.push(list)} />);

    const platform = screen.getByRole('combobox', { name: 'Platform for @KRISTINSOKOL' });
    expect(platform).toHaveValue('');
    expect(screen.getByText(/Which network is this\?/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getByText('Choose a network for each social profile, or remove it, to continue.')).toBeInTheDocument();

    await user.selectOptions(platform, 'instagram');
    expect(screen.queryByText(/Which network is this\?/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    expect(seen.at(-1)[0].socials[0]).toMatchObject({ platform: 'instagram', text: '@KRISTINSOKOL', confirmed: true });
  });

  it('a network the card showed is preselected and not yet confirmed', () => {
    render(<Review initial={[person([row(1, 'instagram.com/kristinsokol', 'instagram')])]} />);
    expect(screen.getByRole('combobox', { name: 'Platform for instagram.com/kristinsokol' })).toHaveValue('instagram');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('typing a profile address takes the network the address names', async () => {
    const user = userEvent.setup();
    const seen = [];
    render(<Review initial={[person([])]} onPeople={list => seen.push(list)} />);
    await user.click(screen.getByRole('button', { name: /add social profile/ }));
    await user.type(screen.getByRole('textbox', { name: 'Handle or profile address for new profile' }), 'facebook.com/sokol.studio');
    expect(seen.at(-1)[0].socials[0]).toMatchObject({ platform: 'facebook', text: 'facebook.com/sokol.studio', fromCard: false, confirmed: true });
  });

  it('a handle can be removed; one that is not a handle for its network is flagged', async () => {
    const user = userEvent.setup();
    render(<Review initial={[person([row(1, '@kristinsokol', null), row(2, 'kristin sokol', 'facebook')])]} />);
    expect(screen.getByText('Not a Facebook handle or profile address.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove @kristinsokol' }));
    await user.click(screen.getByRole('button', { name: 'Remove kristin sokol' }));
    expect(screen.queryAllByTestId('capture-social-row')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });
});

describe('the contact profile shows social profiles (display only)', () => {
  const at = '2026-10-27T22:00:00.000Z';
  const contact = {
    id: 'c1', name: 'Kristin Sokol',
    linkedin_url: 'https://www.linkedin.com/in/kristin-sokol',
    twitter_url: 'https://x.com/kristin',
    social_profiles: [
      { platform: 'instagram', handle: 'kristinsokol', url: 'https://www.instagram.com/kristinsokol', observed: '@KRISTINSOKOL', source: 'business_card', status: 'observed', added_at: at },
      { platform: 'facebook', handle: 'sokol.studio', url: 'https://www.facebook.com/sokol.studio', observed: '@sokol.studio', source: 'business_card', status: 'user_confirmed', added_at: at },
    ],
  };

  it('LinkedIn as before, then Instagram and Facebook as links; one only read from a card says so; no X yet', () => {
    render(<IdentityCard contact={contact} onUpdate={() => {}} />);
    expect(screen.getByTestId('social-linkedin').querySelector('a')).toHaveAttribute('href', 'https://www.linkedin.com/in/kristin-sokol');
    expect(screen.getByText('LinkedIn Profile →')).toBeInTheDocument();

    const instagram = screen.getByTestId('social-instagram');
    expect(instagram.querySelector('a')).toHaveAttribute('href', 'https://www.instagram.com/kristinsokol');
    expect(instagram).toHaveTextContent('@kristinsokol');
    expect(instagram).toHaveTextContent('from card');

    const facebook = screen.getByTestId('social-facebook');
    expect(facebook.querySelector('a')).toHaveAttribute('href', 'https://www.facebook.com/sokol.studio');
    expect(facebook).not.toHaveTextContent('from card');
    expect(screen.queryByText(/x\.com/)).toBeNull();
  });

  it('an older contact with only facebook_url shows it; a LinkedIn value that does not parse still shows, as before', () => {
    render(<IdentityCard contact={{ id: 'c2', name: 'Avery Quinn', facebook_url: 'facebook.com/avery.quinn', linkedin_url: 'linkedin.com/pub/avery' }} onUpdate={() => {}} />);
    expect(screen.getByTestId('social-facebook').querySelector('a')).toHaveAttribute('href', 'https://www.facebook.com/avery.quinn');
    expect(screen.getByTestId('social-linkedin').querySelector('a')).toHaveAttribute('href', 'linkedin.com/pub/avery');
  });
});
